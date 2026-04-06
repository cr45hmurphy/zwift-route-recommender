// scorer.js — route scoring logic
// All thresholds are named constants. Tune these after seeing real recommendations.

const FLAT_DISTANCE_TARGET  = 40;   // km   — routes at/above this get full distance points
const FLAT_GRADIENT_MAX     = 15;   // m/km — routes above this lose flatness points

const CLIMB_ELEVATION_TARGET = 800;  // m    — routes at/above this get full elevation points
const CLIMB_ELEVATION_BIG    = 1000; // m    — routes at/above this get the gradient bonus regardless of gradient ratio
const CLIMB_DISTANCE_TARGET  = 28;  // km   — routes at/above this get full distance points
const CLIMB_GRADIENT_MIN     = 8;   // m/km — lower bound of the "good climbing" band
const CLIMB_GRADIENT_MAX     = 25;  // m/km — upper bound of the "good climbing" band

const PUNCH_GRADIENT_TARGET  = 32;  // m/km — routes at/above this get full punch points
const PUNCH_DISTANCE_MAX     = 18;  // km   — routes below this get full short-route bonus
const PUNCH_ELEVATION_CAP    = 400; // m    — routes above this score 0 in PEAK (sustained climbers, not punchy)
const RECOVERY_DISTANCE_MAX  = 30;  // km   — routes above this score near 0 in RECOVERY
const RECOVERY_ELEVATION_MAX = 200; // m    — routes above this score near 0 in RECOVERY

function valueOr(...values) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function formatSegmentList(segments) {
  if (!segments.length) return '';
  if (segments.length === 1) return segments[0].name;
  if (segments.length === 2) return `${segments[0].name} and ${segments[1].name}`;
  return `${segments.slice(0, -1).map(segment => segment.name).join(', ')}, and ${segments.at(-1).name}`;
}

function firstNumber(obj, keys) {
  return valueOr(...keys.map(key => obj?.[key]));
}

function wotdDurationMinutes(wotd) {
  const durationSeconds = firstNumber(wotd, ['duration', 'durationSeconds', 'seconds', 'totalDuration']);
  if (durationSeconds === null) return null;
  return durationSeconds > 300 ? durationSeconds / 60 : durationSeconds;
}

export function classifyWOTD(wotd) {
  if (!wotd) return 'recovery';

  const totalXSS = firstNumber(wotd, ['xss', 'totalXSS', 'total_xss', 'workoutXss', 'plannedXSS']);
  if (!totalXSS) return 'recovery';

  const lowXSS = firstNumber(wotd, ['lowXSS', 'low', 'xlss', 'low_xss']);
  const highXSS = firstNumber(wotd, ['highXSS', 'high', 'xhss', 'high_xss']);
  const peakXSS = firstNumber(wotd, ['peakXSS', 'peak', 'xpss', 'peak_xss']);
  const durationMin = wotdDurationMinutes(wotd);

  if (lowXSS === null || highXSS === null || peakXSS === null || durationMin === null) {
    return 'aerobic_endurance';
  }

  const highRatio = highXSS / totalXSS;
  const peakRatio = peakXSS / totalXSS;
  const lowRatio = lowXSS / totalXSS;

  if (peakRatio > 0.25) return 'sprint_power';
  if (highRatio > 0.4 && durationMin > 45) return 'sustained_climb';
  if (highRatio > 0.4 && durationMin <= 45) return 'repeated_punchy';
  if (lowRatio > 0.7) return 'aerobic_endurance';
  return 'aerobic_endurance';
}

export function analyzeTrainingDay(tl, targetXSS, wotd) {
  return {
    bucket: detectBucket(tl, targetXSS),
    wotdStructure: classifyWOTD(wotd),
  };
}

/**
 * detectBucket — determine which energy system needs work most.
 *
 * @param {object} tl        — { low, high, peak } current training loads
 * @param {object} targetXSS — { low, high, peak } daily targets
 * @returns {'low'|'high'|'peak'|'recovery'}
 */
export function detectBucket(tl, targetXSS) {
  const deficits = {
    low:  targetXSS.low  - tl.low,
    high: targetXSS.high - tl.high,
    peak: targetXSS.peak - tl.peak,
  };

  const max = Math.max(deficits.low, deficits.high, deficits.peak);

  if (max <= 0) return 'recovery';

  return Object.keys(deficits).find(k => deficits[k] === max);
}

/**
 * scoreRoute — score a single route 0-100 against a target bucket.
 *
 * @param {object} route  — zwift-data route object
 * @param {string} bucket — 'low' | 'high' | 'peak' | 'recovery'
 * @returns {number}
 */
export function scoreRoute(route, bucket) {
  const { distance, elevation } = route;
  const gradientRatio = distance > 0 ? elevation / distance : 0;

  if (bucket === 'low') {
    const distanceScore = Math.min(distance / FLAT_DISTANCE_TARGET, 1) * 60;
    const flatnessScore = Math.max(0, 1 - gradientRatio / FLAT_GRADIENT_MAX) * 40;
    return Math.round(distanceScore + flatnessScore);
  }

  if (bucket === 'recovery') {
    const distancePenalty  = Math.max(0, 1 - Math.max(0, distance - RECOVERY_DISTANCE_MAX) / RECOVERY_DISTANCE_MAX);
    const elevationPenalty = Math.max(0, 1 - Math.max(0, elevation - RECOVERY_ELEVATION_MAX) / RECOVERY_ELEVATION_MAX);
    const flatnessScore    = Math.max(0, 1 - gradientRatio / FLAT_GRADIENT_MAX) * 100;
    return Math.round(flatnessScore * distancePenalty * elevationPenalty);
  }

  if (bucket === 'high') {
    const elevationScore = Math.min(elevation / CLIMB_ELEVATION_TARGET, 1) * 50;
    const distanceScore  = Math.min(distance / CLIMB_DISTANCE_TARGET, 1) * 30;
    const bigClimb    = elevation >= CLIMB_ELEVATION_BIG ? 20 : 0;
    const midGradient = (gradientRatio >= CLIMB_GRADIENT_MIN && gradientRatio <= CLIMB_GRADIENT_MAX) ? 20 : 0;
    const gradientBonus = Math.max(bigClimb, midGradient);
    return Math.round(elevationScore + distanceScore + gradientBonus);
  }

  if (bucket === 'peak') {
    if (elevation > PUNCH_ELEVATION_CAP) return 0;
    const punchScore = Math.min(gradientRatio / PUNCH_GRADIENT_TARGET, 1) * 60;
    const shortScore = Math.max(0, 1 - distance / PUNCH_DISTANCE_MAX) * 40;
    return Math.round(punchScore + shortScore);
  }

  return 0;
}

/**
 * rankRoutes — filter, score, and sort routes for a given bucket.
 * Returns top 15 (top 5 primary + up to 10 "other options").
 *
 * @param {Array}  routes — full zwift-data routes array
 * @param {string} bucket — 'low' | 'high' | 'peak' | 'recovery'
 * @returns {Array} routes with added `score` property, sorted descending
 */
export function rankRoutes(routes, bucket) {
  const eligible = routes.filter(r =>
    !r.eventOnly &&
    Array.isArray(r.sports) &&
    r.sports.includes('cycling')
  );

  const scored = eligible.map(r => ({ ...r, score: scoreRoute(r, bucket) }));
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, 15);
}

export function generateRideCue(route, bucket, wotdStructure, routeSegments) {
  const climbs = routeSegments?.climbs ?? [];
  const sprints = routeSegments?.sprints ?? [];

  if (bucket === 'recovery') {
    return 'Easy spin only. If you hit a sprint banner, roll through it with no efforts today.';
  }

  if (bucket === 'high' && wotdStructure === 'sustained_climb') {
    if (climbs.length) {
      return `Ride ${climbs[0].name} at threshold pace - that's your HIGH XSS generator today. Keep efforts steady on the way up.`;
    }
    return 'Use the route\'s main climb for steady threshold work. Keep the effort controlled all the way up.';
  }

  if (bucket === 'high' && wotdStructure === 'repeated_punchy') {
    const namedClimbs = climbs.slice(0, 2);
    if (namedClimbs.length === 2) {
      return `Hit ${formatSegmentList(namedClimbs)} hard, then recover between them. Repeated threshold efforts are what Xert wants today.`;
    }
    if (namedClimbs.length === 1) {
      return `Repeat ${namedClimbs[0].name} hard, then recover between efforts. Repeated threshold efforts are what Xert wants today.`;
    }
    return 'Use the route\'s punchier climbs for repeated threshold efforts, and fully recover between each one.';
  }

  if (bucket === 'peak' && wotdStructure === 'sprint_power') {
    const namedSprints = sprints.slice(0, 2);
    if (namedSprints.length) {
      return `Sprint every banner at max effort. ${formatSegmentList(namedSprints)} are your PEAK XSS targets today.`;
    }
    return 'Treat every short rise or sprint banner like a match strike. Full gas, then fully recover.';
  }

  if (bucket === 'low') {
    return 'Keep it steady in Z2 the whole way. Resist the urge to push the climbs.';
  }

  if (bucket === 'high') {
    return 'Use the route\'s main climbs for steady threshold work. Keep the surges controlled.';
  }

  if (bucket === 'peak') {
    return 'Treat short rises or sprint banners as match strikes. Full gas, then fully recover.';
  }

  return 'Ride this route with a steady aerobic focus and let the terrain support the day\'s intent.';
}

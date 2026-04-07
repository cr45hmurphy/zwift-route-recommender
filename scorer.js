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
const OPTIMIZER_ACTIVE_BUCKET_BOOST = 0.15;
const OPTIMIZER_SORT_EPSILON = 0.001;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function stableRouteKey(route) {
  return String(route?.slug ?? route?.name ?? '').toLowerCase();
}

function compareOptimizedRoutes(a, b, availableMinutes) {
  const utilityDiff = b.utility - a.utility;
  if (Math.abs(utilityDiff) >= OPTIMIZER_SORT_EPSILON) {
    return utilityDiff;
  }

  const aTimeDelta = Math.abs((a.estimatedMinutes ?? availableMinutes) - availableMinutes);
  const bTimeDelta = Math.abs((b.estimatedMinutes ?? availableMinutes) - availableMinutes);
  if (aTimeDelta !== bTimeDelta) return aTimeDelta - bTimeDelta;

  if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0);

  return stableRouteKey(a).localeCompare(stableRouteKey(b));
}

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

function routeContributions(route) {
  return {
    low: scoreRoute(route, 'low') / 100,
    high: scoreRoute(route, 'high') / 100,
    peak: scoreRoute(route, 'peak') / 100,
    recovery: scoreRoute(route, 'recovery') / 100,
  };
}

function normalizeDeficits(deficits = {}) {
  const positive = {
    low: Math.max(deficits.low ?? 0, 0),
    high: Math.max(deficits.high ?? 0, 0),
    peak: Math.max(deficits.peak ?? 0, 0),
  };
  const total = positive.low + positive.high + positive.peak;

  if (total <= 0) return { ...positive, total, weights: { low: 0, high: 0, peak: 0 } };

  return {
    ...positive,
    total,
    weights: {
      low: positive.low / total,
      high: positive.high / total,
      peak: positive.peak / total,
    },
  };
}

function timeFitScore(estimatedMinutes, availableMinutes) {
  if (!Number.isFinite(estimatedMinutes) || estimatedMinutes <= 0) return 0.5;
  if (!Number.isFinite(availableMinutes) || availableMinutes <= 0) return 1;

  const diff = estimatedMinutes - availableMinutes;
  if (diff === 0) return 1;

  if (diff < 0) {
    const underRatio = Math.abs(diff) / availableMinutes;
    return clamp(1 - underRatio * 0.55, 0.5, 1);
  }

  const overRatio = diff / availableMinutes;
  return clamp(1 - overRatio * 0.95, 0.15, 1);
}

function describeTimeFit(estimatedMinutes, availableMinutes) {
  if (!Number.isFinite(estimatedMinutes) || !Number.isFinite(availableMinutes)) return 'time-unknown';
  const diff = estimatedMinutes - availableMinutes;
  const absDiff = Math.abs(diff);

  if (absDiff <= 10) return 'near-time';
  if (diff < 0) return 'under-time';
  return 'over-time';
}

function optimizerReason(contributions, weights, bucket, timeFitTag) {
  const weighted = ['low', 'high', 'peak']
    .map(name => ({
      bucket: name,
      value: contributions[name] * (weights[name] ?? 0),
    }))
    .filter(item => item.value >= 0.08)
    .sort((a, b) => b.value - a.value);

  const top = weighted.slice(0, 2).map(item => item.bucket);
  const bucketLabel = bucket?.toUpperCase();

  if (bucket === 'recovery') {
    if (timeFitTag === 'over-time') return 'Recovery-friendly, but longer than your target.';
    if (timeFitTag === 'under-time') return 'Recovery-friendly and comfortably within your time budget.';
    return 'Recovery-friendly and right on your target time.';
  }

  if (!top.length) {
    if (timeFitTag === 'over-time') return `Closest match for your ${bucketLabel} focus, but a bit long.`;
    return `Balanced best fit for your ${bucketLabel} focus and time target.`;
  }

  const joined = top.length === 2 ? `${top[0]} + ${top[1]}` : top[0];

  if (timeFitTag === 'near-time') return `Best blend of ${joined} support and time fit.`;
  if (timeFitTag === 'under-time') return `Strong ${joined} match that fits comfortably inside your time budget.`;
  return `Strong ${joined} match if you can go a little longer today.`;
}

export function optimizeRoutes(routes, options = {}) {
  const {
    bucket = 'low',
    deficits = {},
    availableMinutes = 60,
    estimateMinutes = () => null,
    limit = 15,
    recoveryMode = bucket === 'recovery',
  } = options;

  const eligible = routes.filter(r =>
    !r.eventOnly &&
    Array.isArray(r.sports) &&
    r.sports.includes('cycling')
  );

  if (recoveryMode) {
    return eligible
      .map(route => {
        const estimatedMinutes = estimateMinutes(route);
        const timeFit = timeFitScore(estimatedMinutes, availableMinutes);
        const score = scoreRoute(route, 'recovery');
        const contributions = routeContributions(route);
        return {
          ...route,
          score,
          estimatedMinutes,
          optimizerTimeFit: timeFit,
          optimizerBreakdown: contributions,
          optimizerReason: optimizerReason(contributions, {}, 'recovery', describeTimeFit(estimatedMinutes, availableMinutes)),
          utility: Math.round(score * timeFit),
        };
      })
      .sort((a, b) => compareOptimizedRoutes(a, b, availableMinutes))
      .slice(0, limit);
  }

  const deficitState = normalizeDeficits(deficits);
  const weights = deficitState.weights;

  return eligible
    .map(route => {
      const estimatedMinutes = estimateMinutes(route);
      const contributions = routeContributions(route);
      const weightedContribution =
        contributions.low * weights.low +
        contributions.high * weights.high +
        contributions.peak * weights.peak;
      const activeContribution = contributions[bucket] ?? 0;
      const boostedContribution = weightedContribution + (activeContribution * OPTIMIZER_ACTIVE_BUCKET_BOOST);
      const timeFit = timeFitScore(estimatedMinutes, availableMinutes);
      const utility = boostedContribution * timeFit;

      return {
        ...route,
        score: Math.round(utility * 100),
        estimatedMinutes,
        optimizerTimeFit: timeFit,
        optimizerBreakdown: contributions,
        optimizerReason: optimizerReason(contributions, weights, bucket, describeTimeFit(estimatedMinutes, availableMinutes)),
        utility,
      };
    })
    .sort((a, b) => compareOptimizedRoutes(a, b, availableMinutes))
    .slice(0, limit);
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

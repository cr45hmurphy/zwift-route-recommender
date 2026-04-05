// scorer.js — route scoring logic
// All thresholds are named constants. Tune these after seeing real recommendations.

const FLAT_DISTANCE_TARGET  = 40;   // km   — routes at/above this get full distance points
const FLAT_GRADIENT_MAX     = 15;   // m/km — routes above this lose flatness points

const CLIMB_ELEVATION_TARGET = 800;  // m    — routes at/above this get full elevation points
const CLIMB_ELEVATION_BIG    = 1000; // m    — routes at/above this get the gradient bonus regardless of gradient ratio
const CLIMB_DISTANCE_TARGET  = 25;  // km   — routes at/above this get full distance points
const CLIMB_GRADIENT_MIN     = 8;   // m/km — lower bound of the "good climbing" band
const CLIMB_GRADIENT_MAX     = 25;  // m/km — upper bound of the "good climbing" band

const PUNCH_GRADIENT_TARGET  = 30;  // m/km — routes at/above this get full punch points
const PUNCH_DISTANCE_MAX     = 20;  // km   — routes below this get full short-route bonus
const PUNCH_ELEVATION_CAP    = 500; // m    — routes above this score 0 in PEAK (sustained climbers, not punchy)
const RECOVERY_DISTANCE_MAX  = 30;  // km   — routes above this score near 0 in RECOVERY
const RECOVERY_ELEVATION_MAX = 200; // m    — routes above this score near 0 in RECOVERY

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

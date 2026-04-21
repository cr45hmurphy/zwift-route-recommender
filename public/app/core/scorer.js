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
const WORLD_SEGMENT_FALLBACK_MULTIPLIER = 0.55;
const ACTIVE_BUCKET_WEIGHT   = 0.65; // how strongly the active bucket's route contribution dominates deficit scoring (0–1)
const OPTIMIZER_SORT_EPSILON = 0.001;
const FAVORITE_BOOST         = 0.08; // utility multiplier for starred routes (self-limiting: only matters when close to top)
const WOTD_SIGNAL_BOOST      = 1.6; // deficit multiplier when Xert has explicitly targeted HIGH or PEAK work today
const TIME_HARD_CUTOFF_RATIO = 1.6; // routes estimated at more than this multiple of availableMinutes are excluded

// Segment bucket classification thresholds
const PUNCHY_GRADE_MIN    = 8;   // % — climbs at/above this grade are PEAK-capable when short
const PUNCHY_DISTANCE_MAX = 2;   // km — climbs shorter than this can generate PEAK neuromuscular work
const PEAK_COMPACT_DISTANCE_MAX = 0.55; // km — very short rises can still be PEAK even when avg grade is muted by smoothing
const PEAK_COMPACT_GAIN_MIN     = 14;   // m  — compact punchy climbs should gain meaningful elevation quickly
const PEAK_SUPPORT_THRESHOLD    = 0.52; // route-level support needed before calling a route truly mixed
const HIGH_SUPPORT_TARGET       = 1.6;  // summed segment support needed for "full" HIGH support
const PEAK_SUPPORT_TARGET       = 1.2;  // summed segment support needed for "full" PEAK support
const PEAK_ROUTE_MIN_SUPPORT    = 0.28; // below this, a route should not contend on PEAK days
const PEAK_ROUTE_STRONG_SUPPORT = 0.5;  // clear PEAK-day contender threshold
const MIXED_COPY_PEAK_THRESHOLD = PEAK_SUPPORT_THRESHOLD; // mixed copy must match the route-truth threshold
const TERRAIN_FIT_THRESHOLDS = {
  peak: { partial: PEAK_ROUTE_MIN_SUPPORT, good: PEAK_ROUTE_STRONG_SUPPORT },
  high: { partial: 0.25, good: 0.5 },
  low:  { partial: 0.4, good: 0.65 },
};

/**
 * DEFAULTS — exported snapshot of every tunable constant.
 * Used by scorer-test.html to populate sliders and by the reset button.
 * The production app never reads this — it uses the constants directly.
 */
export const DEFAULTS = {
  FLAT_DISTANCE_TARGET,
  FLAT_GRADIENT_MAX,
  CLIMB_ELEVATION_TARGET,
  PUNCH_ELEVATION_CAP,
  PUNCH_DISTANCE_MAX,
  PUNCH_GRADIENT_TARGET,
  ACTIVE_BUCKET_WEIGHT,
  FAVORITE_BOOST,
  WOTD_SIGNAL_BOOST,
  TIME_HARD_CUTOFF_RATIO,
  PUNCHY_GRADE_MIN,
  PUNCHY_DISTANCE_MAX,
};

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

function isGenericEffortName(name = '') {
  const normalized = String(name).trim().toLowerCase();
  return (
    normalized === 'sprint' ||
    normalized === 'sprint reverse' ||
    normalized === 'sprint forward end' ||
    normalized === 'sprint reverse end' ||
    normalized === 'kom' ||
    normalized === 'kom reverse' ||
    normalized === 'qom' ||
    normalized === 'qom reverse' ||
    normalized === 'unknown segment'
  );
}

function summarizeOccurrenceList(occurrences, maxNames = 4) {
  const filtered = occurrences.filter(segment => !isGenericEffortName(segment?.name));
  const source = filtered.length ? filtered : occurrences;
  if (!source.length) return '';
  const visible = source.slice(0, maxNames).map(segment => ({ name: segment.name }));
  const base = formatSegmentList(visible);
  const remaining = source.length - visible.length;
  return remaining > 0 ? `${base}, then ${remaining} more later` : base;
}

function spacingNote(occurrences, shortGapKm = 2) {
  const shortRecoveries = occurrences
    .filter(item => Number.isFinite(item?.recoveryGapKm) && item.recoveryGapKm < shortGapKm)
    .length;

  if (!shortRecoveries) return 'Recovery gaps are workable between efforts.';
  if (shortRecoveries === 1) return 'One recovery gap is short, so expect one effort to be slightly compromised.';
  return `${shortRecoveries} recovery gaps are short, so later efforts will be somewhat degraded.`;
}

function orderedTimelineOccurrences(routeTimeline, type = null) {
  if (!routeTimeline?.occurrences?.length) return [];
  return routeTimeline.occurrences.filter(item =>
    (!type || item.type === type) &&
    item.name &&
    !isGenericEffortName(item.name)
  );
}

function orderedTimelineEfforts(routeTimeline) {
  return orderedTimelineOccurrences(routeTimeline)
    .filter(item => {
      if (item.type !== 'sprint' && item.type !== 'climb') return false;
      // Skip climb occurrences that are net downhill (reverse traversal of a climb segment).
      // avgGradePct < 0 on a climb type means the route traverses it in the descent direction.
      if (item.type === 'climb' && typeof item.avgGradePct === 'number' && item.avgGradePct < 0) return false;
      return true;
    });
}

function firstNumber(obj, keys) {
  return valueOr(...keys.map(key => obj?.[key]));
}

function segmentDistanceKm(segment = {}) {
  return valueOr(segment.distanceKm, segment.distance, segment.lengthKm, 0) ?? 0;
}

function segmentAverageGradePct(segment = {}) {
  return valueOr(segment.avgGradePct, segment.avgIncline);
}

function segmentElevationGainM(segment = {}) {
  // If net elevation delta is negative (downhill traversal), treat gain as 0 for scoring purposes.
  const delta = segment.elevationDeltaM ?? null;
  if (delta !== null && delta < 0) return 0;
  return Math.max(
    valueOr(segment.elevationGainM, segment.elevation, segment.elevationDeltaM, 0) ?? 0,
    0
  );
}

function segmentSupport(segment) {
  if (!segment) return { high: 0, peak: 0 };

  if (segment?.type !== 'climb') {
    const distance = segmentDistanceKm(segment);
    const grade = segmentAverageGradePct(segment);
    const flatness = grade === null ? 0.7 : clamp(1 - (Math.abs(grade) / 5), 0.3, 1);
    const sprintLength = clamp(distance / 0.35, 0.45, 1);
    return {
      high: clamp(0.45 + (flatness * 0.3) + (sprintLength * 0.2), 0.45, 0.95),
      peak: 0,
    };
  }

  const distance = segmentDistanceKm(segment);
  const avgGrade = segmentAverageGradePct(segment);
  const elevationGain = segmentElevationGainM(segment);
  const shortness = distance > 0 ? clamp(1 - (distance / 1.4), 0, 1) : 0;
  const compactRise = clamp(elevationGain / 28, 0, 1);
  const steepness = avgGrade === null ? 0.35 : clamp((avgGrade - 4.5) / 4, 0, 1);
  const sustainedness = Math.max(
    clamp(distance / 2.6, 0, 1),
    clamp(elevationGain / 140, 0, 1),
    avgGrade === null ? 0.25 : clamp((avgGrade - 3.5) / 4.5, 0, 1)
  );

  const explicitPunch = (
    avgGrade !== null &&
    avgGrade >= PUNCHY_GRADE_MIN &&
    distance > 0 &&
    distance < PUNCHY_DISTANCE_MAX
  ) ? 1 : 0;
  const compactPunch = (
    distance > 0 &&
    distance <= PEAK_COMPACT_DISTANCE_MAX &&
    elevationGain >= PEAK_COMPACT_GAIN_MIN
  ) ? 0.92 : 0;
  const shortRisePunch = (
    distance > 0 &&
    distance <= 0.9 &&
    elevationGain >= 24 &&
    (avgGrade === null || avgGrade >= 5.5)
  ) ? 0.8 : 0;

  let peak = Math.max(
    explicitPunch,
    compactPunch,
    shortRisePunch,
    (steepness * 0.45) + (shortness * 0.35) + (compactRise * 0.3)
  );

  const isSteep = avgGrade !== null && avgGrade >= 8;

  if (distance >= 3 || elevationGain >= 140) {
    peak *= isSteep ? 0.35 : 0.12;
  } else if (distance >= 2 || elevationGain >= 90) {
    peak *= isSteep ? 0.65 : 0.35;
  }

  return {
    high: clamp(0.35 + (sustainedness * 0.6) + Math.min(peak * 0.18, 0.12), 0.35, 1),
    peak: clamp(peak, 0, 1),
  };
}

function normalizeSupportValue(value) {
  if (value === null || value === undefined) return null;
  return clamp(value, 0, 1);
}

function aggregateSegmentSupport(segments = []) {
  if (!segments.length) return { high: 0, peak: 0, maxPeak: 0, peakOccurrences: 0 };

  let totalHigh = 0;
  let totalPeak = 0;
  let maxPeak = 0;
  let peakOccurrences = 0;

  for (const segment of segments) {
    const support = segmentSupport(segment);
    totalHigh += support.high;
    totalPeak += support.peak;
    maxPeak = Math.max(maxPeak, support.peak);
    if (support.peak >= 0.5) peakOccurrences += 1;
  }

  const peakRepeatBonus = peakOccurrences > 1 ? Math.min((peakOccurrences - 1) * 0.08, 0.18) : 0;

  return {
    high: clamp(totalHigh / HIGH_SUPPORT_TARGET, 0, 1),
    peak: clamp(Math.max(totalPeak / PEAK_SUPPORT_TARGET, maxPeak * 0.85) + peakRepeatBonus, 0, 1),
    maxPeak,
    peakOccurrences,
  };
}

export function deriveRouteBucketSupport(route, routeSegments, routeTimeline = null, lapCount = 1, C = {}) {
  const low = scoreRoute(route, 'low', C) / 100;
  const fallback = {
    low,
    high: scoreRoute(route, 'high', C) / 100,
    peak: scoreRoute(route, 'peak', C) / 100,
    source: routeSegments?.source ?? 'world',
    peakMeaningful: false,
  };

  if (!routeSegments || routeSegments.source === 'world') {
    const fPeak = fallback.peak;
    const fHigh = fallback.high;
    return {
      ...fallback,
      fitQuality: fPeak < 0.2 && fHigh < 0.2 ? 'low' : fPeak < PEAK_SUPPORT_THRESHOLD ? 'partial' : 'good',
    };
  }

  const occurrenceSource = Array.isArray(routeTimeline?.occurrences) && routeTimeline.occurrences.length
    ? routeTimeline.occurrences
    : [...(routeSegments.climbs ?? []), ...(routeSegments.sprints ?? [])];

  const aggregated = aggregateSegmentSupport(occurrenceSource);
  const peakThreshold = C.PEAK_SUPPORT_THRESHOLD ?? PEAK_SUPPORT_THRESHOLD;
  const routeDistance = route?.distance ?? 0;
  const peakDistanceFactor = clamp(1 - (routeDistance / 90), 0.5, 1);
  const high = normalizeSupportValue(aggregated.high);
  const peak = normalizeSupportValue(aggregated.peak * peakDistanceFactor);
  const peakMeaningful =
    peak >= peakThreshold &&
    aggregated.maxPeak >= 0.72 &&
    (aggregated.peakOccurrences >= 2 || routeDistance <= 25);

  return {
    low,
    high,
    peak,
    source: routeSegments.source,
    peakMeaningful,
    peakOccurrences: aggregated.peakOccurrences,
    lapCount,
    fitQuality: peak < 0.2 && high < 0.2 ? 'low' : peak < PEAK_SUPPORT_THRESHOLD ? 'partial' : 'good',
  };
}

function wotdDurationMinutes(wotd) {
  const durationSeconds = firstNumber(wotd, ['duration', 'durationSeconds', 'seconds', 'totalDuration']);
  if (durationSeconds === null) return null;
  return durationSeconds > 300 ? durationSeconds / 60 : durationSeconds;
}

/**
 * classifySegmentBucket — which energy bucket a segment primarily fills.
 *
 * Flat/rolling sprint banners are threshold (HIGH) work, not neuromuscular.
 * Only short, steep climb segments demand PEAK effort.
 *
 * @param {object} segment — segment record (from segments-data.js or merged timeline entry)
 * @returns {'high'|'peak'}
 */
export function classifySegmentBucket(segment) {
  return segmentSupport(segment).peak >= 0.5 ? 'peak' : 'high';
}

/**
 * routeHonestyLabel — terrain-honest description of what buckets a route can fill.
 *
 * @param {object} routeSegments — { climbs, sprints, source }
 * @returns {'low'|'low-high'|'true-mixed'|null}
 */
export function routeHonestyLabel(route, routeSegments, routeTimeline = null, lapCount = 1, C = {}) {
  if (!routeSegments || routeSegments.source === 'world') return null;

  const support = deriveRouteBucketSupport(route, routeSegments, routeTimeline, lapCount, C);
  if ((support.high ?? 0) < 0.12) return null;

  return support.peakMeaningful ? 'true-mixed' : 'low-high';
}

export function classifyWOTD(wotd, ftp = null) {
  if (!wotd) return null;

  const description = String(wotd?.description ?? '');
  const tags = Array.isArray(wotd?.tags) ? wotd.tags : [];
  if (
    /#mixedmode\b/i.test(description) ||
    /\bmixed mode\b/i.test(description) ||
    tags.some(t => /mixedmode/i.test(t))
  ) {
    return 'mixed_mode';
  }

  const totalXSS = firstNumber(wotd, ['xss', 'totalXSS', 'total_xss', 'workoutXss', 'plannedXSS']);
  if (!totalXSS) return null;

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
  const normalizedFtp = ftp ?? firstNumber(wotd, ['ftp']);
  const intervalPower = firstNumber(wotd, ['intervalPower', 'interval_power', 'intervalWatts', 'interval_watts']);
  const intervalDurationSeconds = firstNumber(wotd, ['intervalDuration', 'interval_duration', 'intervalSeconds', 'interval_seconds']);

  if (
    normalizedFtp &&
    intervalPower !== null &&
    intervalDurationSeconds !== null &&
    intervalPower > (1.5 * normalizedFtp) &&
    intervalDurationSeconds <= 30 &&
    lowRatio > 0.6
  ) {
    return 'mixed_mode';
  }

  if (peakXSS > 0 && lowRatio > 0.7 && durationMin > 60) {
    return 'mixed_mode';
  }

  if (peakRatio > 0.25) return 'sprint_power';
  if (highRatio > 0.4 && durationMin >= 60) return 'sustained_climb';
  if (highRatio > 0.4 && durationMin < 60) return 'repeated_punchy';
  if (lowRatio > 0.7) return 'aerobic_endurance';
  return 'aerobic_endurance';
}

export function analyzeTrainingDay(tl, targetXSS, wotd, ftp = null) {
  return {
    bucket: detectBucket(tl, targetXSS),
    wotdStructure: classifyWOTD(wotd, ftp),
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

  if (targetXSS.high > 0) deficits.high *= WOTD_SIGNAL_BOOST;
  if (targetXSS.peak > 0) deficits.peak *= WOTD_SIGNAL_BOOST;

  const max = Math.max(deficits.low, deficits.high, deficits.peak);

  if (max <= 0) return 'recovery';

  return Object.keys(deficits).find(k => deficits[k] === max);
}

/**
 * scoreRoute — score a single route 0-100 against a target bucket.
 *
 * @param {object} route  — normalized route object from the generated Zwift snapshot
 * @param {string} bucket — 'low' | 'high' | 'peak' | 'recovery'
 * @returns {number}
 */
export function scoreRoute(route, bucket, C = {}) {
  const flatDistTarget   = C.FLAT_DISTANCE_TARGET   ?? FLAT_DISTANCE_TARGET;
  const flatGradMax      = C.FLAT_GRADIENT_MAX       ?? FLAT_GRADIENT_MAX;
  const climbElevTarget  = C.CLIMB_ELEVATION_TARGET  ?? CLIMB_ELEVATION_TARGET;
  const punchElevCap     = C.PUNCH_ELEVATION_CAP     ?? PUNCH_ELEVATION_CAP;
  const punchDistMax     = C.PUNCH_DISTANCE_MAX      ?? PUNCH_DISTANCE_MAX;
  const punchGradTarget  = C.PUNCH_GRADIENT_TARGET   ?? PUNCH_GRADIENT_TARGET;

  const { distance, elevation } = route;
  const gradientRatio = distance > 0 ? elevation / distance : 0;

  if (bucket === 'low') {
    const distanceScore = Math.min(distance / flatDistTarget, 1) * 60;
    const flatnessScore = Math.max(0, 1 - gradientRatio / flatGradMax) * 40;
    return Math.round(distanceScore + flatnessScore);
  }

  if (bucket === 'recovery') {
    const distancePenalty  = Math.max(0, 1 - Math.max(0, distance - RECOVERY_DISTANCE_MAX) / RECOVERY_DISTANCE_MAX);
    const elevationPenalty = Math.max(0, 1 - Math.max(0, elevation - RECOVERY_ELEVATION_MAX) / RECOVERY_ELEVATION_MAX);
    const flatnessScore    = Math.max(0, 1 - gradientRatio / flatGradMax) * 100;
    return Math.round(flatnessScore * distancePenalty * elevationPenalty);
  }

  if (bucket === 'high') {
    const elevationScore = Math.min(elevation / climbElevTarget, 1) * 50;
    const distanceScore  = Math.min(distance / CLIMB_DISTANCE_TARGET, 1) * 30;
    const bigClimb    = elevation >= CLIMB_ELEVATION_BIG ? 20 : 0;
    const midGradient = (gradientRatio >= CLIMB_GRADIENT_MIN && gradientRatio <= CLIMB_GRADIENT_MAX) ? 20 : 0;
    const gradientBonus = Math.max(bigClimb, midGradient);
    return Math.round(elevationScore + distanceScore + gradientBonus);
  }

  if (bucket === 'peak') {
    if (elevation > punchElevCap) return 0;
    const punchScore = Math.min(gradientRatio / punchGradTarget, 1) * 60;
    const shortScore = Math.max(0, 1 - distance / punchDistMax) * 40;
    return Math.round(punchScore + shortScore);
  }

  return 0;
}

/**
 * rankRoutes — filter, score, and sort routes for a given bucket.
 * Returns top 15 (top 5 primary + up to 10 "other options").
 *
 * @param {Array}  routes — full normalized routes array
 * @param {string} bucket — 'low' | 'high' | 'peak' | 'recovery'
 * @returns {Array} routes with added `score` property, sorted descending
 */
export function rankRoutes(routes, bucket, tuning = {}) {
  const eligible = routes.filter(r =>
    !r.eventOnly &&
    Array.isArray(r.sports) &&
    r.sports.includes('cycling')
  );

  const scored = eligible.map(r => ({ ...r, score: scoreRoute(r, bucket, tuning) }));
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, 15);
}

function routeContributions(route, C = {}) {
  return {
    low: scoreRoute(route, 'low', C) / 100,
    high: scoreRoute(route, 'high', C) / 100,
    peak: scoreRoute(route, 'peak', C) / 100,
    recovery: scoreRoute(route, 'recovery', C) / 100,
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
    return clamp(1 - underRatio * 0.3, 0.65, 1);
  }

  const overRatio = diff / availableMinutes;
  return clamp(1 - overRatio * 0.95, 0.15, 1);
}

function describeTimeFit(estimatedMinutes, availableMinutes) {
  if (!Number.isFinite(estimatedMinutes) || !Number.isFinite(availableMinutes)) return 'time-unknown';
  const diff = estimatedMinutes - availableMinutes;
  const threshold = Math.max(10, availableMinutes * 0.12);
  const absDiff = Math.abs(diff);

  if (absDiff <= threshold) return 'near-time';
  if (diff < 0) return 'under-time';
  return 'over-time';
}

function countSprintSegments(routeSegments) {
  return routeSegments?.sprints?.length ?? 0;
}

function countClimbSegments(routeSegments) {
  return routeSegments?.climbs?.length ?? 0;
}

function segmentConfidence(routeSegments) {
  return routeSegments?.source === 'world' ? WORLD_SEGMENT_FALLBACK_MULTIPLIER : 1;
}

function highestRatedClimbs(routeSegments, count = 2) {
  return (routeSegments?.climbs ?? []).slice(0, count);
}

export function wotdTerrainScore(route, wotdStructure, routeSegments) {
  if (wotdStructure === null || wotdStructure === undefined) return 0.5;

  const distance = route?.distance ?? 0;
  const elevation = route?.elevation ?? 0;
  const gradientRatio = distance > 0 ? elevation / distance : 0;
  const sprintCount = countSprintSegments(routeSegments);
  const climbCount = countClimbSegments(routeSegments);
  const confidence = segmentConfidence(routeSegments);
  const effectiveSprintCount = sprintCount * confidence;
  const effectiveClimbCount = climbCount * confidence;
  const hasRouteLinkedSegments = routeSegments?.source === 'route' || routeSegments?.source === 'route-list';

  if (wotdStructure === 'sustained_climb') {
    if (elevation >= 1000) return 1.0;
    if (elevation >= 500) return 0.7;
    if (elevation >= 200) return 0.3;
    return 0.1;
  }

  if (wotdStructure === 'repeated_punchy') {
    if (gradientRatio >= 28 && elevation >= 150 && elevation <= 900) {
      return clamp(0.82 + Math.min(effectiveClimbCount, 2) * 0.09, 0, 1);
    }
    if (gradientRatio >= 20 && elevation >= 120 && elevation <= 900) {
      return clamp(0.6 + Math.min(effectiveClimbCount, 2) * 0.08, 0, 0.9);
    }
    if (gradientRatio >= 15) return clamp(0.3 + effectiveClimbCount * 0.05, 0, 0.55);
    return 0.1;
  }

  if (wotdStructure === 'sprint_power') {
    if (effectiveSprintCount === 0) return 0.05;
    const sprintScore = clamp(0.2 + effectiveSprintCount * 0.32, 0, 1);
    return hasRouteLinkedSegments ? sprintScore : Math.min(sprintScore, 0.45);
  }

  if (wotdStructure === 'mixed_mode') {
    if (effectiveSprintCount >= 1.5 && distance >= 18) return 1.0;
    if (effectiveSprintCount >= 1 && distance >= 15) return 0.82;
    if (effectiveSprintCount >= 0.5) return 0.62;
    if (distance >= 20 && gradientRatio <= 20) return hasRouteLinkedSegments ? 0.5 : 0.4;
    return 0.3;
  }

  if (wotdStructure === 'aerobic_endurance') {
    if (gradientRatio <= 15 && distance >= 20) return 1.0;
    if (gradientRatio <= 20 && distance >= 15) return 0.8;
    if (gradientRatio <= 25) return 0.5;
    return 0.2;
  }

  if (wotdStructure === 'recovery') {
    if (distance <= 20 && elevation <= 150) return 1.0;
    if (distance <= 30 && elevation <= 200) return 0.5;
    return 0.1;
  }

  return 0.5;
}

function routeTruthProfile(contributions = {}) {
  const peak = contributions.peak ?? 0;
  const high = contributions.high ?? 0;

  if (peak >= PEAK_SUPPORT_THRESHOLD) return 'true-mixed';
  if (high >= 0.12) return 'low-high';
  return 'low';
}

function terrainScoreForStructure(route, wotdStructure, routeSegments, contributions = null) {
  if (!contributions) return wotdTerrainScore(route, wotdStructure, routeSegments);

  const baseScore = wotdTerrainScore(route, wotdStructure, routeSegments);
  const truth = routeTruthProfile(contributions);
  const peak = contributions.peak ?? 0;
  const high = contributions.high ?? 0;

  if (wotdStructure === 'sprint_power') {
    if (peak < PEAK_ROUTE_MIN_SUPPORT) return Math.min(baseScore, 0.08);
    if (peak < PEAK_ROUTE_STRONG_SUPPORT) return Math.min(baseScore, 0.45);
    return clamp(Math.max(baseScore, 0.78) + Math.min((peak - PEAK_ROUTE_STRONG_SUPPORT) * 0.45, 0.18), 0, 1);
  }

  if (wotdStructure === 'mixed_mode') {
    if (truth !== 'true-mixed' || peak < MIXED_COPY_PEAK_THRESHOLD) {
      return Math.min(baseScore, 0.62);
    }
    return clamp(Math.max(baseScore, 0.82) + Math.min(high * 0.12, 0.12), 0, 1);
  }

  return baseScore;
}

function bucketDeficitScore(contributions, bucket, deficits, C = {}) {
  const activeBucketWeight = C.ACTIVE_BUCKET_WEIGHT ?? ACTIVE_BUCKET_WEIGHT;
  const deficitState = normalizeDeficits(deficits);
  const weights = deficitState.weights;
  const weightedContribution =
    contributions.low  * weights.low +
    contributions.high * weights.high +
    contributions.peak * weights.peak;
  const activeContribution = contributions[bucket] ?? 0;
  // activeBucketWeight (default 0.65) on the active bucket's route fit so specialist routes
  // win over all-rounders. Remainder on the deficit-weighted balance so routes that address
  // multiple depleted buckets still get credit when deficits are spread.
  return clamp(
    activeContribution * activeBucketWeight +
    weightedContribution * (1 - activeBucketWeight),
    0, 1
  );
}

function optimizerReason(contributions, weights, bucket, timeFitTag, wotdStructure = null) {
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

  if (wotdStructure === 'mixed_mode') {
    const peak = contributions.peak ?? 0;
    if (peak >= MIXED_COPY_PEAK_THRESHOLD) {
      if (timeFitTag === 'near-time') return 'Best support for low + high + peak work at your target time.';
      if (timeFitTag === 'under-time') return 'Strong low + high + peak support that fits comfortably inside your time budget.';
      return 'Strong low + high + peak support if you can go a little longer today.';
    }
    if (timeFitTag === 'near-time') return 'Best support for low + high work at your target time.';
    if (timeFitTag === 'under-time') return 'Strong low + high support that fits comfortably inside your time budget.';
    return 'Strong low + high support if you can go a little longer today.';
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

function optimizerWeights(wotdStructure) {
  if (!wotdStructure) {
    return { terrain: 0, deficit: 0.55, time: 0.45 };
  }

  if (wotdStructure === 'sprint_power') {
    return { terrain: 0.58, deficit: 0.24, time: 0.18 };
  }

  if (wotdStructure === 'mixed_mode') {
    return { terrain: 0.5, deficit: 0.3, time: 0.2 };
  }

  if (wotdStructure === 'repeated_punchy' || wotdStructure === 'sustained_climb') {
    return { terrain: 0.5, deficit: 0.32, time: 0.18 };
  }

  if (wotdStructure === 'aerobic_endurance') {
    return { terrain: 0.42, deficit: 0.38, time: 0.2 };
  }

  return { terrain: 0.45, deficit: 0.35, time: 0.2 };
}

export function optimizeRoutes(routes, options = {}) {
  const {
    bucket = 'low',
    deficits = {},
    availableMinutes = 60,
    estimateMinutes = () => null,
    getRouteSegments = () => ({ climbs: [], sprints: [] }),
    getRouteSupport = null,
    wotdStructure = null,
    limit = 15,
    recoveryMode = bucket === 'recovery',
    tuning = {},
    favorites = null,
  } = options;

  const eligible = routes.filter(r => {
    if (r.eventOnly) return false;
    if (!Array.isArray(r.sports) || !r.sports.includes('cycling')) return false;
    const est = estimateMinutes(r);
    if (Number.isFinite(est) && Number.isFinite(availableMinutes)) {
      if (est > availableMinutes * TIME_HARD_CUTOFF_RATIO) return false;
    }
    return true;
  });

  if (recoveryMode) {
    return eligible
      .map(route => {
        const estimatedMinutes = estimateMinutes(route);
        const timeFit = timeFitScore(estimatedMinutes, availableMinutes);
        const rawScore = scoreRoute(route, 'recovery', tuning);
        const routeSegments = getRouteSegments(route);
        const contributions = getRouteSupport
          ? getRouteSupport(route, routeSegments, estimatedMinutes)
          : routeContributions(route, tuning);
        const utility = (rawScore / 100) * timeFit;
        return {
          ...route,
          score: Math.round(utility * 100),
          rawScore,
          estimatedMinutes,
          optimizerTimeFit: timeFit,
          optimizerBreakdown: contributions,
          wotdTerrainScore: terrainScoreForStructure(route, wotdStructure, routeSegments, contributions),
          optimizerReason: optimizerReason(contributions, {}, 'recovery', describeTimeFit(estimatedMinutes, availableMinutes), wotdStructure),
          noFit: timeFit < 0.4 || estimatedMinutes > availableMinutes * 1.5,
          terrainFit: 'good',
          utility,
        };
      })
      .sort((a, b) => compareOptimizedRoutes(a, b, availableMinutes))
      .slice(0, limit);
  }

  return eligible
    .map(route => {
      const estimatedMinutes = estimateMinutes(route);
      const routeSegments = getRouteSegments(route);
      const contributions = getRouteSupport
        ? getRouteSupport(route, routeSegments, estimatedMinutes)
        : routeContributions(route, tuning);
      const terrainScore = terrainScoreForStructure(route, wotdStructure, routeSegments, contributions);
      const deficitScore = bucketDeficitScore(contributions, bucket, deficits, tuning);
      const timeFit = timeFitScore(estimatedMinutes, availableMinutes);
      const weights = optimizerWeights(wotdStructure);
      const fitThresholds = TERRAIN_FIT_THRESHOLDS[bucket] ?? TERRAIN_FIT_THRESHOLDS.low;
      const bucketContribution = contributions[bucket] ?? 0;
      let utility = (terrainScore * weights.terrain) + (deficitScore * weights.deficit) + (timeFit * weights.time);

      if (bucket === 'peak' && wotdStructure === 'sprint_power') {
        if ((contributions.peak ?? 0) < PEAK_ROUTE_MIN_SUPPORT) {
          utility = 0;
        } else {
          utility = (utility * 0.8) + ((contributions.peak ?? 0) * 1.1);
          if ((contributions.peak ?? 0) >= PEAK_ROUTE_STRONG_SUPPORT) {
            utility += 0.08;
          }
        }
      }

      if (favorites && favorites.has(route.slug || route.name)) {
        utility = Math.min(1, utility * (1 + FAVORITE_BOOST));
      }

      return {
        ...route,
        score: Math.round(utility * 100),
        estimatedMinutes,
        optimizerTimeFit: timeFit,
        optimizerBreakdown: contributions,
        wotdTerrainScore: terrainScore,
        optimizerReason: optimizerReason(contributions, normalizeDeficits(deficits).weights, bucket, describeTimeFit(estimatedMinutes, availableMinutes), wotdStructure),
        noFit: timeFit < 0.4 || estimatedMinutes > availableMinutes * 1.5,
        terrainFit: bucketContribution < fitThresholds.partial ? 'low'
                  : bucketContribution < fitThresholds.good ? 'partial'
                  : 'good',
        utility,
      };
    })
    .sort((a, b) => compareOptimizedRoutes(a, b, availableMinutes))
    .slice(0, limit);
}

export function generateRideCue(route, bucket, wotdStructure, routeSegments, routeTimeline = null) {
  const namedSegmentsAvailable = routeSegments?.source !== 'world';
  const climbs = namedSegmentsAvailable ? (routeSegments?.climbs ?? []) : [];
  const sprints = namedSegmentsAvailable ? (routeSegments?.sprints ?? []) : [];
  const timelineClimbs = orderedTimelineOccurrences(routeTimeline, 'climb');
  const timelineSprints = orderedTimelineOccurrences(routeTimeline, 'sprint');
  const namedClimbs = climbs.filter(segment => !isGenericEffortName(segment?.name));
  const namedSprints = sprints.filter(segment => !isGenericEffortName(segment?.name));
  const distance = route?.distance ?? 0;
  const elevation = route?.elevation ?? 0;
  const gradientRatio = distance > 0 ? elevation / distance : 0;
  const routeSupport = route?.bucketSupport ?? null;
  const peakSupport = routeSupport?.peak ?? 0;
  const trueMixed = peakSupport >= PEAK_SUPPORT_THRESHOLD;

  if (bucket === 'recovery') {
    return 'Easy spin only. Roll through any sprint banners with no efforts today.';
  }

  if (wotdStructure === 'sustained_climb') {
    const [climb] = highestRatedClimbs(routeSegments, 1);
    if (climb) {
      return `Ride ${climb.name} at steady threshold pace. One long controlled effort is what today's workout calls for, so don't sprint the top.`;
    }
    return 'Find your threshold pace on the climbs and hold it. One long sustained effort, not intervals and not sprints.';
  }

  if (wotdStructure === 'repeated_punchy') {
    if (timelineClimbs.length) {
      return `Hit every punchy climb in order: ${summarizeOccurrenceList(timelineClimbs)}. ${spacingNote(timelineClimbs)} Today calls for repeated surges, not one steady grind.`;
    }
    const namedClimbs = highestRatedClimbs(routeSegments, 2);
    if (namedClimbs.length === 2) {
      return `Hit ${formatSegmentList(namedClimbs)} hard, then fully recover between them. Today calls for repeated threshold surges, not a steady grind.`;
    }
    if (namedClimbs.length === 1) {
      return `Hit ${namedClimbs[0].name} hard, recover, then repeat if the route loops. Today calls for repeated efforts with full recovery between.`;
    }
    return 'Push every rise hard, then recover fully on the flats. Today calls for repeated threshold surges, not a steady grind.';
  }

  if (wotdStructure === 'sprint_power') {
    if (peakSupport < PEAK_ROUTE_MIN_SUPPORT) {
      if (timelineClimbs.length) {
        return `No true sprint terrain here. Use climbs in order: ${summarizeOccurrenceList(timelineClimbs, 3)} for your best surge approximation on this route.`;
      }
      if (namedClimbs.length) {
        return `No true sprint terrain here. Hit ${formatSegmentList(namedClimbs.slice(0, 2))} as hard as you can - best surge approximation this route offers.`;
      }
      return 'No true sprint terrain here. Push every rise as hard as you can for the best surge approximation this route offers.';
    }
    if (peakSupport < PEAK_SUPPORT_THRESHOLD) {
      if (timelineClimbs.length) {
        return `Reasonable sprint approximation here. Hit climbs in order: ${summarizeOccurrenceList(timelineClimbs, 3)} - push each one hard and expect some genuine neuromuscular work mixed with the HIGH.`;
      }
      if (namedClimbs.length) {
        return `Reasonable sprint approximation. Hit ${formatSegmentList(namedClimbs.slice(0, 2))} hard - punchy enough to earn some real neuromuscular work, even if repeatability is limited.`;
      }
      if (namedSprints.length) {
        return `Reasonable sprint approximation. Sprint ${formatSegmentList(namedSprints.slice(0, 2))} hard - punchy enough to earn some real neuromuscular work, even if repeatability is limited.`;
      }
      return 'Reasonable sprint approximation. Push the sharpest rises hard - punchy enough to earn some real neuromuscular work, even if repeatability is limited.';
    }
    const timelineEfforts = orderedTimelineEfforts(routeTimeline);
    if (timelineSprints.length) {
      if (timelineClimbs.length && timelineEfforts.length) {
        return `Sprint day: follow the route order: ${summarizeOccurrenceList(timelineEfforts, 6)}. ${spacingNote(timelineSprints)} Sprint banners are full gas; KOMs are controlled bridges, not extra max efforts.`;
      }
      return `Sprint every viable banner in order: ${summarizeOccurrenceList(timelineSprints)}. ${spacingNote(timelineSprints)} Go full gas, then recover completely.`;
    }
    if (namedClimbs.length) {
      if (namedClimbs.length === 1) {
        return `Punch ${namedClimbs[0].name} at absolute max, then recover fully before the next hard effort. This route earns its PEAK support from short sharp climbs, not flat sprint runways.`;
      }
      return `Punch the climbs in order: ${formatSegmentList(namedClimbs.slice(0, 3))}. Full gas on each rise, recover completely.`;
    }
    if (namedSprints.length >= 2) {
      return `Sprint ${formatSegmentList(namedSprints)} at absolute max effort. Full gas, then fully recover.`;
    }
    if (namedSprints.length === 1) {
      return `Sprint ${namedSprints[0].name} at absolute max effort. Recover completely, then repeat if the route allows with no half-efforts.`;
    }
    return 'Treat every rise or flat surge like a match strike. Full gas, then fully recover with no half-efforts today.';
  }

  if (wotdStructure === 'mixed_mode') {
    const timelineEfforts = orderedTimelineEfforts(routeTimeline);
    if (!trueMixed) {
      if (timelineClimbs.length) {
        return `This is a LOW+HIGH venue, not a true mixed route. Use climbs in order: ${summarizeOccurrenceList(timelineClimbs, 3)}. Keep everything else in Z2 and do not expect much PEAK work.`;
      }
      if (timelineSprints.length) {
        return `This is a LOW+HIGH venue, not a true mixed route. Ride flats in Z2, then hit sprints in order: ${summarizeOccurrenceList(timelineSprints)}. ${spacingNote(timelineSprints)} Expect little true PEAK work.`;
      }
    }
    if (timelineSprints.length) {
      if (timelineClimbs.length && timelineEfforts.length) {
        return `Ride Z2 between efforts, then follow the route order: ${summarizeOccurrenceList(timelineEfforts, 5)}. Sprints are max efforts; climbs are controlled hard efforts. ${spacingNote(timelineEfforts)}`;
      }
      return `Ride the flats in Z2, then hit every viable sprint in order: ${summarizeOccurrenceList(timelineSprints)}. ${spacingNote(timelineSprints)}`;
    }
    if (timelineClimbs.length) {
      return `This is mostly a climb route. Use climbs in order: ${summarizeOccurrenceList(timelineClimbs, 3)}. Keep everything else in Z2; expect LOW+HIGH more than true PEAK.`;
    }
    const namedSprints = sprints.slice(0, 2);
    if (namedSprints.length >= 1) {
      return `Ride the flats in Z2 to build aerobic base, sprint ${formatSegmentList(namedSprints)} at absolute max when you hit them. Full recovery between efforts, then back to Z2.`;
    }
    return 'Keep it Z2 between any rises, then punch every short climb or surge at max effort. This is a mixed day, aerobic base plus explosive efforts.';
  }

  if (wotdStructure === 'aerobic_endurance' || wotdStructure === null || wotdStructure === undefined) {
    if (gradientRatio > 30) {
      return 'Keep the climbs controlled and stay in Z2 the whole way. Today is aerobic base work, not efforts.';
    }
    if (gradientRatio > 15 && climbs.length) {
      return 'Ride the climbs in Z2 and resist the urge to push them. Today is about aerobic volume, not threshold work.';
    }
    return 'Steady Z2 the whole way. Today is aerobic base, so let the distance do the work.';
  }

  return 'Ride to feel and match your effort to your freshness today.';
}

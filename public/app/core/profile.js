function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function percentileFromSorted(values, ratio) {
  if (!Array.isArray(values) || !values.length) return 0;
  if (values.length === 1) return Number(values[0]) || 0;

  const clampedRatio = clamp(Number(ratio) || 0, 0, 1);
  const index = (values.length - 1) * clampedRatio;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lowerValue = Number(values[lowerIndex]) || 0;
  const upperValue = Number(values[upperIndex]) || 0;
  if (lowerIndex === upperIndex) return lowerValue;

  const mix = index - lowerIndex;
  return lowerValue + ((upperValue - lowerValue) * mix);
}

export function normalizeProfilePayload(route) {
  const profile = route?.profile;
  if (Array.isArray(profile) && profile.length >= 2) {
    const points = profile.map(([profileKm, elevationM, routeKm = profileKm]) => ([
      Number(profileKm) || 0,
      Number(elevationM) || 0,
      Number(routeKm) || Number(profileKm) || 0,
    ]));
    return {
      points,
      totalProfileKm: Number(points.at(-1)?.[0] ?? 0),
      totalRouteKm: Number(points.at(-1)?.[2] ?? points.at(-1)?.[0] ?? 0),
    };
  }

  if (profile && Array.isArray(profile.points) && profile.points.length >= 2) {
    const points = profile.points.map(([profileKm, elevationM, routeKm = profileKm]) => ([
      Number(profileKm) || 0,
      Number(elevationM) || 0,
      Number(routeKm) || Number(profileKm) || 0,
    ]));
    return {
      points,
      totalProfileKm: Number(profile.totalProfileKm ?? points.at(-1)?.[0] ?? 0),
      totalRouteKm: Number(profile.totalRouteKm ?? points.at(-1)?.[2] ?? points.at(-1)?.[0] ?? 0),
    };
  }

  return null;
}

export function summarizeProfile(route, profilePayload = normalizeProfilePayload(route)) {
  if (!profilePayload?.points?.length) return null;

  const points = profilePayload.points;
  const minDistance = Number(points[0]?.[0]) || 0;
  const maxDistance = Number(points.at(-1)?.[0]) || minDistance;
  const routeDistanceKm = Math.max(Number(route?.distance) || maxDistance || 0, maxDistance || 0);
  const routeElevationGainM = Math.max(Number(route?.elevation) || 0, 0);
  const gradientMPerKm = routeDistanceKm > 0 ? routeElevationGainM / routeDistanceKm : 0;

  const elevations = points.map(point => Number(point[1]) || 0);
  const sortedElevations = elevations.slice().sort((a, b) => a - b);
  const minElevation = sortedElevations[0] ?? 0;
  const maxElevation = sortedElevations.at(-1) ?? minElevation;
  const actualElevationRange = Math.max(maxElevation - minElevation, 1);
  const percentile10 = percentileFromSorted(sortedElevations, 0.1);
  const percentile25 = percentileFromSorted(sortedElevations, 0.25);
  const percentile50 = percentileFromSorted(sortedElevations, 0.5);
  const percentile75 = percentileFromSorted(sortedElevations, 0.75);
  const percentile90 = percentileFromSorted(sortedElevations, 0.9);
  const robustElevationRange = Math.max(percentile90 - percentile10, 1);
  const interquartileRange = Math.max(percentile75 - percentile25, 1);
  const isFlatLike = routeElevationGainM <= 90 && gradientMPerKm <= 4.5;
  const flatAuditFlag = isFlatLike && actualElevationRange > Math.max((routeElevationGainM * 2.35), (robustElevationRange * 1.55), 110);

  return {
    points,
    minDistance,
    maxDistance,
    routeDistanceKm,
    routeElevationGainM,
    gradientMPerKm,
    minElevation,
    maxElevation,
    actualElevationRange,
    percentile10,
    percentile25,
    percentile50,
    percentile75,
    percentile90,
    robustElevationRange,
    interquartileRange,
    isFlatLike,
    flatAuditFlag,
  };
}

export function computeProfileScale(route, profilePayload = normalizeProfilePayload(route)) {
  const summary = summarizeProfile(route, profilePayload);
  if (!summary) return null;

  const {
    minElevation,
    maxElevation,
    actualElevationRange,
    percentile10,
    percentile50,
    percentile90,
    robustElevationRange,
    routeDistanceKm,
    routeElevationGainM,
    isFlatLike,
  } = summary;

  const distanceFloorM = clamp(routeDistanceKm * 6, 90, 240);
  const climbFloorM = clamp(Math.max(routeElevationGainM * 1.35, 120), 120, 640);
  let visualFloorM = Math.max(distanceFloorM, climbFloorM);
  let centerElevation = (minElevation + maxElevation) / 2;

  if (isFlatLike) {
    const flatDistanceFloorM = clamp(routeDistanceKm * 14, 220, 420);
    const flatEffortFloorM = clamp(
      Math.max(routeElevationGainM * 4.5, robustElevationRange * 3.2, 220),
      220,
      420
    );
    visualFloorM = Math.max(visualFloorM, flatDistanceFloorM, flatEffortFloorM);
    centerElevation = percentile50;

    const trimmedCenter = (percentile10 + percentile90) / 2;
    if (Number.isFinite(trimmedCenter)) {
      centerElevation = (centerElevation + trimmedCenter) / 2;
    }
  }

  const elevationRange = Math.max(actualElevationRange, visualFloorM);
  const visualTopElevation = centerElevation + (elevationRange / 2);
  const visualBottomElevation = centerElevation - (elevationRange / 2);

  return {
    ...summary,
    distanceFloorM,
    climbFloorM,
    visualFloorM,
    elevationRange,
    centerElevation,
    visualTopElevation,
    visualBottomElevation,
    scalingMode: isFlatLike ? 'flat-conservative' : 'default',
  };
}

export function scaleProfilePoints(route, { width = 240, height = 56, inset = 4 } = {}) {
  const profilePayload = normalizeProfilePayload(route);
  const scale = computeProfileScale(route, profilePayload);
  if (!profilePayload || !scale) return null;

  const usableHeight = Math.max(height - (inset * 2), 8);
  const scaled = profilePayload.points.map(([distance, elevation]) => {
    const x = scale.maxDistance > scale.minDistance
      ? ((Number(distance) - scale.minDistance) / (scale.maxDistance - scale.minDistance)) * width
      : 0;
    const y = inset + ((scale.visualTopElevation - Number(elevation)) / scale.elevationRange) * usableHeight;
    return [Number(x.toFixed(2)), Number(y.toFixed(2))];
  });

  return {
    profilePayload,
    scale,
    scaled,
    width,
    height,
    inset,
    usableHeight,
  };
}

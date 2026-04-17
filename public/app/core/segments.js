import { segments } from '../data/segments-data.js';

const CLIMB_WEIGHTS = {
  HC: 5,
  '1': 4,
  '2': 3,
  '3': 2,
  '4': 1,
};

export function climbWeight(climbType) {
  return CLIMB_WEIGHTS[climbType] ?? 0;
}

function compareClimbs(a, b) {
  return (
    climbWeight(b.climbType) - climbWeight(a.climbType) ||
    (b.elevation ?? 0) - (a.elevation ?? 0) ||
    (b.avgIncline ?? 0) - (a.avgIncline ?? 0) ||
    (b.distance ?? 0) - (a.distance ?? 0) ||
    a.name.localeCompare(b.name)
  );
}

function compareSprints(a, b) {
  return (
    (b.distance ?? 0) - (a.distance ?? 0) ||
    a.name.localeCompare(b.name)
  );
}

function partitionSegments(list) {
  const climbs = list.filter(segment => segment.type === 'climb').sort(compareClimbs);
  const sprints = list.filter(segment => segment.type === 'sprint').sort(compareSprints);
  return { climbs, sprints };
}

export function getSegmentsForWorld(worldSlug) {
  return partitionSegments(segments.filter(segment => segment.world === worldSlug));
}

export function getSegmentsForRoute(route) {
  const routeSegmentSlugs = new Set([
    ...(Array.isArray(route?.segmentsOnRoute) ? route.segmentsOnRoute.map(item => item.segment).filter(Boolean) : []),
    ...(Array.isArray(route?.segments) ? route.segments.filter(Boolean) : []),
  ]);

  if (routeSegmentSlugs.size) {
    return {
      ...partitionSegments(segments.filter(segment => routeSegmentSlugs.has(segment.slug))),
      source: Array.isArray(route?.segmentsOnRoute) && route.segmentsOnRoute.length ? 'route' : 'route-list',
    };
  }

  return {
    ...getSegmentsForWorld(route?.world),
    source: 'world',
  };
}

import { routeTimelinesBySignature } from '../data/route-timelines-data.js';
import { segments } from '../data/segments-data.js';

const segmentsBySlug = new Map(segments.map(segment => [segment.slug, segment]));

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

export function getRouteTimeline(route) {
  if (!route?.signature) return null;
  return routeTimelinesBySignature[route.signature] ?? null;
}

export function recommendedLapCount(route, availableMinutes) {
  const estimatedMinutes = Number(route?.estimatedMinutes ?? 0);
  if (!route?.supportedLaps || !Number.isFinite(estimatedMinutes) || estimatedMinutes <= 0) return 1;
  if (!Number.isFinite(availableMinutes) || availableMinutes <= 0) return 1;

  const lapCount = Math.floor(availableMinutes / estimatedMinutes);
  if (lapCount < 2) return 1;
  if (estimatedMinutes > availableMinutes * 0.6) return 1;
  return lapCount;
}

export function expandTimelineForLaps(route, timeline, lapCount = 1) {
  if (!timeline) return [];

  const supportsLaps = Boolean(route?.supportedLaps && timeline.supportsLaps && timeline.lapKm > 0);
  const effectiveLapCount = supportsLaps ? Math.max(1, lapCount) : 1;
  const leadInKm = timeline.leadInKm ?? 0;
  const lapKm = timeline.lapKm ?? 0;
  const occurrences = [];

  for (const segment of timeline.segments ?? []) {
    const base = {
      ...segment,
      lapNumber: 1,
      occurrenceKey: `${segment.occurrenceId}:lap1`,
    };
    occurrences.push(base);

    if (!supportsLaps || segment.leadinOnly) continue;

    for (let lap = 2; lap <= effectiveLapCount; lap += 1) {
      const lapOffsetKm = lapKm * (lap - 1);
      const routeOffsetKm = segment.routeOffsetKm ?? Math.max(0, (segment.startKm ?? 0) - leadInKm);
      const startKm = round3(leadInKm + lapOffsetKm + routeOffsetKm);
      const endKm = round3(startKm + (segment.distanceKm ?? 0));

      occurrences.push({
        ...segment,
        startKm,
        endKm,
        lapNumber: lap,
        occurrenceKey: `${segment.occurrenceId}:lap${lap}`,
      });
    }
  }

  return occurrences.sort((a, b) => a.startKm - b.startKm || a.order - b.order || a.lapNumber - b.lapNumber);
}

export function withRecoveryGaps(occurrences) {
  return occurrences.map((occurrence, index) => {
    const next = occurrences[index + 1] ?? null;
    const recoveryGapKm = next
      ? round3(Math.max((next.startKm ?? 0) - (occurrence.endKm ?? 0), 0))
      : null;

    return {
      ...occurrence,
      recoveryGapKm,
    };
  });
}

export function uniqueTimelineSegments(occurrences, type = null) {
  const ordered = [];
  const seen = new Set();

  for (const occurrence of occurrences) {
    if (type && occurrence.type !== type) continue;
    const key = occurrence.segmentSlug ?? `${occurrence.type}:${occurrence.name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const enriched = occurrence.segmentSlug
      ? { ...segmentsBySlug.get(occurrence.segmentSlug), ...occurrence }
      : occurrence;
    ordered.push(enriched);
  }

  return ordered;
}

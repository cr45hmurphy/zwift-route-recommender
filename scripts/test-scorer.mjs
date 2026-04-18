import assert from 'node:assert/strict';

import { routes } from '../public/app/data/routes-data.js';
import { getSegmentsForRoute } from '../public/app/core/segments.js';
import { expandTimelineForLaps, getRouteTimeline, recommendedLapCount, withRecoveryGaps } from '../public/app/core/timelines.js';
import { deriveRouteBucketSupport, generateRideCue, optimizeRoutes } from '../public/app/core/scorer.js';

const routeByName = Object.fromEntries(routes.map(route => [route.name, route]));

const namedRecoveryEstimates = new Map([
  ['Flat Out Fast', 56],
  ['Tempus Fugit', 44],
  ['Tick Tock', 46],
  ['Going Coastal', 46],
  ['Red Zone Repeats', 56],
]);

function estimateMinutes(route) {
  if (namedRecoveryEstimates.has(route.name)) return namedRecoveryEstimates.get(route.name);
  return Math.round((route.distance / 28) * 60 + (route.elevation / 700) * 60);
}

function assertDescendingByScore(ranked, label) {
  for (let i = 1; i < ranked.length; i += 1) {
    assert.ok(
      ranked[i - 1].score >= ranked[i].score,
      `${label}: expected descending scores, but ${ranked[i - 1].name} (${ranked[i - 1].score}) came before ${ranked[i].name} (${ranked[i].score})`
    );
  }
}

function testRecoveryScoreMatchesDisplayedRanking() {
  const subset = [
    routeByName['Flat Out Fast'],
    routeByName['Tempus Fugit'],
    routeByName['Tick Tock'],
    routeByName['Going Coastal'],
    routeByName['Red Zone Repeats'],
  ];

  const ranked = optimizeRoutes(subset, {
    bucket: 'recovery',
    deficits: { low: 0, high: 0, peak: 0 },
    availableMinutes: 60,
    estimateMinutes,
    getRouteSegments: route => getSegmentsForRoute(route),
    recoveryMode: true,
    limit: subset.length,
  });

  assert.equal(ranked[0]?.name, 'Flat Out Fast', 'recovery scenario should keep Flat Out Fast on top for the 60-minute budget fixture');
  assert.equal(ranked[1]?.name, 'Tempus Fugit', 'Tempus Fugit should remain the next-best recovery option in the fixture');

  ranked.forEach(route => {
    assert.equal(
      route.score,
      Math.round(route.utility * 100),
      `recovery score should match displayed ranking value for ${route.name}`
    );
    assert.ok(
      Number.isFinite(route.rawScore),
      `recovery route ${route.name} should keep rawScore for debugging`
    );
  });

  assertDescendingByScore(ranked, 'recovery fixture');
}

function testGeneralLowModeStillUsesDisplayedRankingScore() {
  const subset = [
    routeByName['Flat Out Fast'],
    routeByName['Tempus Fugit'],
    routeByName['Tick Tock'],
    routeByName['Going Coastal'],
  ];

  const ranked = optimizeRoutes(subset, {
    bucket: 'low',
    deficits: { low: 35, high: 5, peak: 0 },
    availableMinutes: 60,
    estimateMinutes,
    getRouteSegments: route => getSegmentsForRoute(route),
    recoveryMode: false,
    limit: subset.length,
  });

  ranked.forEach(route => {
    assert.equal(
      route.score,
      Math.round(route.utility * 100),
      `non-recovery score should continue matching displayed ranking value for ${route.name}`
    );
  });

  assertDescendingByScore(ranked, 'low fixture');
}

function cueForRouteName(name, bucket, wotdStructure, availableMinutes = 60) {
  const route = routeByName[name];
  assert.ok(route, `expected route fixture ${name}`);
  const routeSegments = getSegmentsForRoute(route);
  const timeline = getRouteTimeline(route);
  const lapCount = recommendedLapCount(route, availableMinutes);
  const occurrences = timeline ? withRecoveryGaps(expandTimelineForLaps(route, timeline, lapCount)) : [];
  const routeTimeline = timeline ? { ...timeline, occurrences } : null;
  const bucketSupport = deriveRouteBucketSupport(route, routeSegments, routeTimeline, lapCount);
  return generateRideCue({ ...route, bucketSupport }, bucket, wotdStructure, routeSegments, routeTimeline);
}

function testCueCopyRegressions() {
  const tempusMixedCue = cueForRouteName('Tempus Fugit', 'low', 'mixed_mode', 60);
  assert.match(tempusMixedCue, /LOW\+HIGH venue|Expect little true PEAK work/, 'Tempus Fugit mixed cue should not overpromise true mixed work');
  assert.doesNotMatch(tempusMixedCue, /plus \d+ later efforts/, 'mixed cue should avoid awkward "plus N later efforts" wording');

  const roadToSkyCue = cueForRouteName('Road to Sky', 'high', 'sustained_climb', 90);
  assert.match(roadToSkyCue, /steady threshold|sustained effort/i, 'Road to Sky cue should stay climb-control focused');

  const knightsCue = cueForRouteName('Knights of the Roundabout', 'peak', 'mixed_mode', 90);
  assert.doesNotMatch(knightsCue, /plus \d+ later efforts/, 'interleaved route cue should use clearer repeat wording');

  const greenwayCue = cueForRouteName('The Greenway', 'peak', 'mixed_mode', 90);
  assert.doesNotMatch(greenwayCue, /plus \d+ later efforts/, 'busy route cue should use clearer repeat wording');

  const worldsShortLapCue = cueForRouteName('2018 Worlds Short Lap', 'peak', 'sprint_power', 60);
  assert.match(worldsShortLapCue, /Leg Snapper KOM/, 'PEAK cue should use rider-facing climb name on 2018 Worlds Short Lap');
}

function main() {
  testRecoveryScoreMatchesDisplayedRanking();
  testGeneralLowModeStillUsesDisplayedRankingScore();
  testCueCopyRegressions();
  console.log('PASS scripts/test-scorer.mjs');
}

main();

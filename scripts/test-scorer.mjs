import assert from 'node:assert/strict';

import { routes } from '../public/app/data/routes-data.js';
import { getSegmentsForRoute } from '../public/app/core/segments.js';
import { expandTimelineForLaps, getRouteTimeline, recommendedLapCount, withRecoveryGaps } from '../public/app/core/timelines.js';
import { deriveRouteBucketSupport, detectBucket, generateRideCue, optimizeRoutes } from '../public/app/core/scorer.js';

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

function testPeakDistanceFactorFloor() {
  // A 45km route with a single punchy short segment.
  // Before A1: peakDistanceFactor = clamp(1 - 45/60, 0.25, 1) = 0.25, which is too harsh.
  // After A1:  peakDistanceFactor = clamp(1 - 45/90, 0.5,  1) = 0.5.
  const route = routeByName['Cobbled Climbs'] ?? routeByName['Volcano Climb'];
  assert.ok(route, 'expected a punchy route fixture for A1 test');
  const routeSegments = getSegmentsForRoute(route);
  const support = deriveRouteBucketSupport(route, routeSegments, null, 1);
  assert.ok(
    support.peak >= 0.08,
    `${route.name} (${route.distance}km) PEAK support should not be gutted by distance (got ${support.peak.toFixed(3)})`
  );
}

function testSteepLongSegmentRetainsPeakSupport() {
  // Test through deriveRouteBucketSupport with a synthetic route+segments.
  const syntheticRoute = { name: 'Synthetic Steep 3.5km', distance: 20, elevation: 420 };
  const steepLongSegment = {
    type: 'climb',
    name: 'Long Steep KOM',
    distanceKm: 3.5,
    avgGradePct: 12,
    elevationDeltaM: 420,
    elevationGainM: 420,
  };
  const routeSegments = { source: 'route', climbs: [steepLongSegment], sprints: [] };
  const support = deriveRouteBucketSupport(syntheticRoute, routeSegments, null, 1);
  assert.ok(
    support.peak >= 0.1,
    `steep 3.5km segment should retain meaningful PEAK support after A2 fix (got ${support.peak.toFixed(3)})`
  );
}

function testDetectBucketWotdBoost() {
  // LOW deficit is largest by raw magnitude, but Xert targeted HIGH work today.
  const tl        = { low: 50, high: 40, peak: 0 };
  const targetXSS = { low: 65, high: 50, peak: 0 };

  assert.equal(
    detectBucket(tl, targetXSS),
    'high',
    'when Xert targets HIGH work and deficit is close, HIGH should win over larger raw LOW deficit'
  );

  const tlNoTarget = { low: 50, high: 42, peak: 0 };
  const targetNoHigh = { low: 65, high: 0, peak: 0 };
  assert.equal(
    detectBucket(tlNoTarget, targetNoHigh),
    'low',
    'when HIGH target is zero, no boost; LOW deficit wins normally'
  );

  assert.equal(
    detectBucket({ low: 70, high: 55, peak: 10 }, { low: 65, high: 50, peak: 5 }),
    'recovery',
    'recovery mode should still fire when all boosted deficits are <= 0'
  );
}

function testFitQualityField() {
  const tempus = routeByName['Tempus Fugit'];
  assert.ok(tempus, 'expected Tempus Fugit fixture');
  const tempusSegments = getSegmentsForRoute(tempus);
  const tempusSupport = deriveRouteBucketSupport(tempus, tempusSegments, null, 1);
  assert.ok(
    ['low', 'partial'].includes(tempusSupport.fitQuality),
    `Tempus Fugit should have low or partial fitQuality (got ${tempusSupport.fitQuality})`
  );

  const roadToSky = routeByName['Road to Sky'];
  assert.ok(roadToSky, 'expected Road to Sky fixture');
  const rtsSegments = getSegmentsForRoute(roadToSky);
  const rtsSupport = deriveRouteBucketSupport(roadToSky, rtsSegments, null, 1);
  assert.ok(
    ['partial', 'good'].includes(rtsSupport.fitQuality),
    `Road to Sky should have partial or good fitQuality (got ${rtsSupport.fitQuality})`
  );
}

function testTerrainFitAndNoFitFlags() {
  const flatSubset = [
    routeByName['Flat Out Fast'],
    routeByName['Tempus Fugit'],
    routeByName['Tick Tock'],
  ].filter(Boolean);

  const peakResults = optimizeRoutes(flatSubset, {
    bucket: 'peak',
    deficits: { low: 5, high: 5, peak: 30 },
    availableMinutes: 60,
    estimateMinutes,
    getRouteSegments: route => getSegmentsForRoute(route),
    limit: flatSubset.length,
  });

  peakResults.forEach(route => {
    assert.equal(
      route.terrainFit,
      'low',
      `flat route ${route.name} on a PEAK day should have terrainFit 'low' (got '${route.terrainFit}')`
    );
  });

  const longRoute = flatSubset[0];
  const shortBudgetResults = optimizeRoutes([longRoute], {
    bucket: 'low',
    deficits: { low: 30, high: 0, peak: 0 },
    availableMinutes: 35,
    estimateMinutes,
    getRouteSegments: route => getSegmentsForRoute(route),
    limit: 1,
  });

  assert.equal(
    shortBudgetResults[0]?.noFit,
    true,
    'route with time estimate far over available minutes should have noFit: true'
  );
}

function testTimeHardCutoff() {
  const uberPretzel = routeByName['The Uber Pretzel'] ?? routeByName['London PRL FULL'];
  assert.ok(uberPretzel, 'expected a long-route fixture for hard cutoff test');

  const results = optimizeRoutes([uberPretzel], {
    bucket: 'low',
    deficits: { low: 40, high: 0, peak: 0 },
    availableMinutes: 60,
    estimateMinutes,
    getRouteSegments: route => getSegmentsForRoute(route),
    limit: 5,
  });

  assert.equal(
    results.length,
    0,
    `${uberPretzel.name} should be excluded from results on a 60-minute budget because it is too far over the hard cutoff`
  );
}

function testTimeFitCalibration() {
  const tickTock = routeByName['Tick Tock'];
  assert.ok(tickTock, 'expected Tick Tock fixture for B2 test');

  const results = optimizeRoutes([tickTock], {
    bucket: 'low',
    deficits: { low: 30, high: 0, peak: 0 },
    availableMinutes: 90,
    estimateMinutes,
    getRouteSegments: route => getSegmentsForRoute(route),
    limit: 1,
  });

  const timeFit = results[0]?.optimizerTimeFit ?? 0;
  assert.ok(
    timeFit >= 0.75,
    `a short route on a much longer budget should have higher time fit under B2 (got ${timeFit.toFixed(3)}, expected >= 0.75)`
  );
}

function testSprintPowerCueRewrites() {
  const tempus = routeByName['Tempus Fugit'];
  assert.ok(tempus, 'expected Tempus Fugit fixture');
  const tempusCue = cueForRouteName('Tempus Fugit', 'peak', 'sprint_power', 60);
  assert.doesNotMatch(
    tempusCue,
    /only fake/i,
    'C1: low PEAK support cue should not contain "only fake"'
  );
  assert.match(
    tempusCue,
    /No true sprint terrain/i,
    'C1: low PEAK support cue should lead with "No true sprint terrain"'
  );

  const worldsShortCue = cueForRouteName('2018 Worlds Short Lap', 'peak', 'sprint_power', 60);
  assert.doesNotMatch(
    worldsShortCue,
    /because these are your best PEAK opportunities/i,
    'C3: strong PEAK cue should not have trailing justification clause'
  );
}

function main() {
  testRecoveryScoreMatchesDisplayedRanking();
  testGeneralLowModeStillUsesDisplayedRankingScore();
  testCueCopyRegressions();
  testPeakDistanceFactorFloor();
  testSteepLongSegmentRetainsPeakSupport();
  testDetectBucketWotdBoost();
  testFitQualityField();
  testTerrainFitAndNoFitFlags();
  testTimeHardCutoff();
  testTimeFitCalibration();
  testSprintPowerCueRewrites();
  console.log('PASS scripts/test-scorer.mjs');
}

main();

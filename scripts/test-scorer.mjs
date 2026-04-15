import assert from 'node:assert/strict';

import { routes } from '../public/app/data/routes-data.js';
import { getSegmentsForRoute } from '../public/app/core/segments.js';
import { optimizeRoutes } from '../public/app/core/scorer.js';

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

function main() {
  testRecoveryScoreMatchesDisplayedRanking();
  testGeneralLowModeStillUsesDisplayedRankingScore();
  console.log('PASS scripts/test-scorer.mjs');
}

main();

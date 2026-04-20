import assert from 'node:assert/strict';

import { routes } from '../public/app/data/routes-data.js';
import { scaleProfilePoints, summarizeProfile } from '../public/app/core/profile.js';

const routeByName = Object.fromEntries(routes.map(route => [route.name, route]));

function scaledSpread(name, options = { width: 240, height: 56, inset: 4 }) {
  const route = routeByName[name];
  assert.ok(route, `missing fixture route: ${name}`);

  const geometry = scaleProfilePoints(route, options);
  assert.ok(geometry, `expected profile geometry for ${name}`);

  const ys = geometry.scaled.map(([, y]) => y);
  return {
    route,
    geometry,
    spread: Math.max(...ys) - Math.min(...ys),
  };
}

function testFlatRoutesStayConservative() {
  const flatFixtures = [
    ['Flat Out Fast', 18],
    ['Tempus Fugit', 16],
    ['Tick Tock', 13],
    ['Going Coastal', 8],
  ];

  flatFixtures.forEach(([name, maxSpread]) => {
    const { geometry, spread } = scaledSpread(name);
    assert.equal(
      geometry.scale.scalingMode,
      'flat-conservative',
      `${name} should use flat-conservative scaling`
    );
    assert.ok(
      spread <= maxSpread,
      `${name} should render as a restrained flat profile (spread ${spread.toFixed(2)} > ${maxSpread})`
    );
  });
}

function testClimbingRoutesStillReadLikeClimbs() {
  const { geometry, spread } = scaledSpread('Road to Sky');
  assert.equal(geometry.scale.scalingMode, 'default', 'Road to Sky should keep default scaling');
  assert.ok(
    spread >= 40,
    `Road to Sky should still consume most of the chart height (${spread.toFixed(2)} < 40)`
  );
}

function testFlatProfileAuditTreatsRepairedFixturesAsClean() {
  ['Flat Out Fast', 'Tempus Fugit'].forEach(name => {
    const route = routeByName[name];
    const summary = summarizeProfile(route);
    assert.equal(summary?.flatAuditFlag, false, `${name} should not need flat-profile audit follow-up`);
  });
}

function testFlatProfileAuditStillFlagsSyntheticOddballs() {
  const profile = Array.from({ length: 21 }, (_, index) => [
    index,
    index === 10 ? 260 : 100,
    index,
  ]);
  const summary = summarizeProfile({
    name: 'Synthetic flat route with phantom spike',
    distance: 20,
    elevation: 20,
    profile,
  });

  assert.equal(summary?.flatAuditFlag, true, 'obvious phantom spikes on flat routes should still be flagged');
}

function main() {
  testFlatRoutesStayConservative();
  testClimbingRoutesStillReadLikeClimbs();
  testFlatProfileAuditTreatsRepairedFixturesAsClean();
  testFlatProfileAuditStillFlagsSyntheticOddballs();
  console.log('PASS scripts/test-profile-scaling.mjs');
}

main();

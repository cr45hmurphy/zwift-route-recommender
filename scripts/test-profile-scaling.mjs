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
    ['Tick Tock', 12],
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

function testFlatProfileAuditStillFlagsOddballs() {
  ['Flat Out Fast', 'Tempus Fugit'].forEach(name => {
    const route = routeByName[name];
    const summary = summarizeProfile(route);
    assert.ok(summary?.flatAuditFlag, `${name} should remain flagged for flat-profile audit follow-up`);
  });
}

function main() {
  testFlatRoutesStayConservative();
  testClimbingRoutesStillReadLikeClimbs();
  testFlatProfileAuditStillFlagsOddballs();
  console.log('PASS scripts/test-profile-scaling.mjs');
}

main();

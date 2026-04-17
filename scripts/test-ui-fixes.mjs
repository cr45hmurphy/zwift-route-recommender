import assert from 'node:assert/strict';

function response(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    },
  };
}

function mockBrowserGlobals({ relayWorlds = null, wozWorlds = null, ziWorlds = ['makuri-islands'] } = {}) {
  global.window = {
    location: {
      hostname: 'localhost',
      port: '5173',
    },
  };
  global.localStorage = {
    getItem() {
      return null;
    },
    setItem() {},
  };
  global.fetch = async url => {
    if (String(url).includes('/relay/worlds')) {
      if (!relayWorlds) throw new Error('relay unavailable');
      return response(relayWorlds.map(name => ({ name })));
    }

    const source = new URL(url).searchParams.get('source');
    if (source === 'woz') {
      if (!wozWorlds) throw new Error('woz unavailable');
      return response({
        sourceLabel: "What's on Zwift",
        guestWorlds: wozWorlds,
      });
    }

    if (source === 'zi') {
      if (!ziWorlds) throw new Error('zi unavailable');
      return response({
        sourceLabel: 'ZwiftInsider',
        guestWorlds: ziWorlds,
      });
    }

    throw new Error(`unexpected fetch for ${url}`);
  };
}

async function testIncompleteLiveWorldContextIsSupplemented() {
  mockBrowserGlobals();
  const { getPreferredWorldContext } = await import('../public/app/core/routes.js?test-ui-fixes=worlds');
  const context = await getPreferredWorldContext(['london', 'new-york'], new Date('2026-04-16T12:00:00Z'));

  assert.equal(context.source, 'ZwiftInsider + schedule fallback');
  assert.deepEqual(context.guestWorlds, ['makuri-islands', 'scotland']);
  assert.deepEqual([...context.worlds], ['watopia', 'makuri-islands', 'scotland']);
}

async function testCompleteLaterProxyBeatsPartialEarlierProxy() {
  mockBrowserGlobals({
    wozWorlds: ['makuri-islands'],
    ziWorlds: ['makuri-islands', 'new-york'],
  });
  const { getPreferredWorldContext } = await import('../public/app/core/routes.js?test-ui-fixes=complete-proxy');
  const context = await getPreferredWorldContext(['london', 'new-york'], new Date('2026-04-16T12:00:00Z'));

  assert.equal(context.source, 'ZwiftInsider');
  assert.deepEqual(context.guestWorlds, ['makuri-islands', 'new-york']);
  assert.deepEqual([...context.worlds], ['watopia', 'makuri-islands', 'new-york']);
}

async function testWorldContextLabelSeparatesSourceAttribution() {
  const { formatWorldContextLabel, formatWorldContextSourceDetail } = await import('../public/app/core/ui.js');
  const label = formatWorldContextLabel(
    { worlds: new Set(['watopia', 'makuri-islands', 'new-york']), source: 'ZwiftInsider' },
    world => ({
      watopia: 'Watopia',
      'makuri-islands': 'Makuri Islands',
      'new-york': 'New York',
    })[world] ?? world
  );

  assert.equal(label, 'Watopia · Makuri Islands · New York (via ZwiftInsider)');

  const detail = formatWorldContextSourceDetail({
    source: 'ZwiftInsider + schedule fallback',
    fetchedAt: Date.parse('2026-04-16T18:30:00Z'),
  });
  assert.equal(
    detail,
    'Source: ZwiftInsider + schedule fallback. Fetched: Apr 16, 2026, 6:30 PM UTC. Includes built-in schedule fallback for missing guest worlds.'
  );
}

async function testRouteCountUsesRenderedCardsNotWorldGroups() {
  const { countRouteCards } = await import('../public/app/core/ui.js');
  const groupedList = {
    children: [{}, {}],
    querySelectorAll(selector) {
      assert.equal(selector, '.route-card');
      return Array.from({ length: 40 }, () => ({}));
    },
  };

  assert.equal(countRouteCards(groupedList), 40);
}

async function main() {
  await testIncompleteLiveWorldContextIsSupplemented();
  await testCompleteLaterProxyBeatsPartialEarlierProxy();
  await testWorldContextLabelSeparatesSourceAttribution();
  await testRouteCountUsesRenderedCardsNotWorldGroups();
  console.log('PASS scripts/test-ui-fixes.mjs');
}

main();

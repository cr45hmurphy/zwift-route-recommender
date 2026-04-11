// build-zwift-data.mjs — generates browser route data from Zwift's public CDN XML.
// Temporary compatibility note: zwift-data is still used only to preserve slugs,
// external links, and Strava segment URLs during the cutover.

import { writeFileSync } from 'node:fs';
import { routes as legacyRoutes, segments as legacySegments } from 'zwift-data';

const GAME_DICTIONARY_URL = 'https://cdn.zwift.com/gameassets/GameDictionary.xml';
const MAP_SCHEDULE_URL = 'https://cdn.zwift.com/gameassets/MapSchedule_v2.xml';
const PORTAL_SCHEDULE_URL = 'https://cdn.zwift.com/gameassets/PortalRoadSchedule_v1.xml';
const ZWIFT_VERSION_URL = 'https://cdn.zwift.com/gameassets/Zwift_Updates_Root/Zwift_ver_cur.xml';

const ROUTES_OUTPUT = 'public/app/data/routes-data.js';
const SEGMENTS_OUTPUT = 'public/app/data/segments-data.js';
const METADATA_OUTPUT = 'public/app/data/zwift-metadata.js';

const ROUTE_WORLD_TO_SLUG = {
  WATOPIA: 'watopia',
  RICHMOND: 'richmond',
  LONDON: 'london',
  NEWYORK: 'new-york',
  INNSBRUCK: 'innsbruck',
  BOLOGNATT: 'bologna',
  YORKSHIRE: 'yorkshire',
  FRANCE: 'france',
  MAKURIISLANDS: 'makuri-islands',
  PARIS: 'paris',
  SCOTLAND: 'scotland',
  CRITCITY: 'crit-city',
  'GRAVEL MOUNTAIN': 'gravel-mountain',
};

const SEGMENT_WORLD_TO_SLUG = {
  1: 'watopia',
  2: 'richmond',
  3: 'london',
  4: 'new-york',
  5: 'innsbruck',
  6: 'bologna',
  7: 'yorkshire',
  8: 'crit-city',
  9: 'makuri-islands',
  10: 'france',
  11: 'paris',
  12: 'gravel-mountain',
  13: 'scotland',
};

function decodeXmlEntities(value = '') {
  return String(value)
    .replace(/&apos;/g, '\'')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseAttributes(attributeText = '') {
  const attrs = {};
  for (const match of attributeText.matchAll(/([A-Za-z0-9_:-]+)="([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function parseElements(xmlText, tagName) {
  const pattern = new RegExp(`<${tagName}\\s+([^>]+?)\\/?>`, 'g');
  return [...xmlText.matchAll(pattern)].map(match => parseAttributes(match[1]));
}

function normalizeName(value = '') {
  return decodeXmlEntities(value)
    .toLowerCase()
    .replace(/\brev(?:\.)?\b/g, ' reverse ')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeNameLoose(value = '') {
  return normalizeName(value)
    .replace(/\b(reverse|forward|rev|fwd)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value = '') {
  return decodeXmlEntities(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function asNumber(value, divisor = 1) {
  const num = Number(value);
  return Number.isFinite(num) ? num / divisor : 0;
}

function asNullableNumber(value, divisor = 1) {
  const num = Number(value);
  return Number.isFinite(num) ? num / divisor : null;
}

function asBoolean(value) {
  return String(value) === '1' || String(value).toLowerCase() === 'true';
}

function parseZwiftDate(value) {
  if (!value) return null;
  return new Date(String(value).replace(/([+-]\d{2})$/, '$1:00'));
}

function inferSports(rawSports, legacyRoute = null) {
  if (Array.isArray(legacyRoute?.sports) && legacyRoute.sports.length) {
    return [...legacyRoute.sports];
  }

  return String(rawSports) === '2'
    ? ['running']
    : ['running', 'cycling'];
}

function worldSlugFromRoute(routeAttrs) {
  return ROUTE_WORLD_TO_SLUG[routeAttrs.map] ?? 'unknown';
}

function worldSlugFromSegment(segmentAttrs) {
  return SEGMENT_WORLD_TO_SLUG[Number(segmentAttrs.world)] ?? 'unknown';
}

function buildLegacyRouteMap() {
  return new Map(legacyRoutes.map(route => [normalizeName(route.name), route]));
}

function buildLegacySegmentMaps() {
  const exact = new Map();
  const loose = new Map();

  for (const segment of legacySegments) {
    const exactKey = normalizeName(segment.name);
    const looseKey = normalizeNameLoose(segment.name);
    exact.set(exactKey, segment);
    if (!loose.has(looseKey)) {
      loose.set(looseKey, segment);
    }
  }

  return { exact, loose };
}

function chooseSegmentDisplayName(segmentAttrs) {
  const rawCandidates = [
    segmentAttrs.jerseyName,
    segmentAttrs.archFriendlyNameR,
    segmentAttrs.archFriendlyFemaleNameR,
    segmentAttrs.name,
  ];

  const decodedCandidates = rawCandidates
    .map(candidate => decodeXmlEntities(candidate ?? '')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean);

  const specific = decodedCandidates.find(candidate =>
    !isGenericSegmentLabel(candidate) && candidate.toLowerCase() !== 'none'
  );
  if (specific) return specific;

  for (const candidate of rawCandidates) {
    const decoded = decodeXmlEntities(candidate ?? '')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (decoded && decoded.toLowerCase() !== 'none') return decoded;
  }

  return 'Unknown Segment';
}

function isGenericSegmentLabel(value = '') {
  const normalized = normalizeName(value);
  return (
    !normalized ||
    normalized === 'none' ||
    normalized === 'sprint' ||
    normalized === 'kom' ||
    normalized === 'qom' ||
    normalized === 'uci lap' ||
    normalized === 'uci course' ||
    normalized === 'london loop'
  );
}

function expandCandidateNames(candidate, direction) {
  const decoded = decodeXmlEntities(candidate ?? '').trim();
  if (!decoded) return [];

  const variants = [];
  const push = value => {
    if (value && !variants.includes(value)) variants.push(value);
  };

  if (direction === 'reverse' && !/\b(reverse|rev\.?)\b/i.test(decoded)) {
    push(`${decoded} Rev.`);
    push(`${decoded} Reverse`);
  }
  push(decoded);
  if (/ reverse$/i.test(decoded)) {
    push(decoded.replace(/ reverse$/i, ' Rev.'));
  }
  if (/ rev\.?$/i.test(decoded)) {
    push(decoded.replace(/ rev\.?$/i, ' Reverse'));
  }
  return variants;
}

function classifySegment(segmentAttrs, legacyMatch) {
  if (legacyMatch?.type) return legacyMatch.type;

  const icon = String(segmentAttrs.jerseyIconPath ?? '').toLowerCase();
  const names = [
    segmentAttrs.name,
    segmentAttrs.archFriendlyNameR,
    segmentAttrs.archFriendlyFemaleNameR,
    segmentAttrs.jerseyName,
  ].map(value => normalizeName(value));
  const haystack = names.join(' ');

  if (icon.includes('greenjersey') || /\bsprint\b/.test(haystack)) {
    return 'sprint';
  }

  if (
    icon.includes('orangejersey') ||
    /\b(kom|climb|hill|ascent)\b/.test(haystack)
  ) {
    return 'climb';
  }

  return null;
}

function resolveLegacySegment(segmentAttrs, legacyMaps) {
  const candidates = [
    segmentAttrs.name,
    segmentAttrs.archFriendlyNameR,
    segmentAttrs.archFriendlyFemaleNameR,
    segmentAttrs.jerseyName,
  ].filter(Boolean);

  for (const candidate of candidates) {
    for (const variant of expandCandidateNames(candidate, segmentAttrs.direction)) {
      const key = normalizeName(variant);
      if (legacyMaps.exact.has(key)) {
        return { legacy: legacyMaps.exact.get(key), exact: true };
      }
    }
  }

  for (const candidate of candidates) {
    for (const variant of expandCandidateNames(candidate, segmentAttrs.direction)) {
      const key = normalizeNameLoose(variant);
      if (legacyMaps.loose.has(key)) {
        return { legacy: legacyMaps.loose.get(key), exact: false };
      }
    }
  }

  return { legacy: null, exact: false };
}

function uniqueSlug(baseSlug, usedSlugs) {
  let slug = baseSlug || 'unknown-segment';
  let index = 2;
  while (usedSlugs.has(slug)) {
    slug = `${baseSlug}-${index}`;
    index += 1;
  }
  usedSlugs.add(slug);
  return slug;
}

function buildSegments(gameDictionaryXml) {
  const xmlSegments = parseElements(gameDictionaryXml, 'SEGMENT');
  const legacyMaps = buildLegacySegmentMaps();
  const usedSlugs = new Set();
  const segmentsByKey = new Map();
  const routeSegmentMap = new Map();

  for (const segmentAttrs of xmlSegments) {
    const { legacy, exact } = resolveLegacySegment(segmentAttrs, legacyMaps);
    const displayName = chooseSegmentDisplayName(segmentAttrs);
    const type = classifySegment(segmentAttrs, legacy);
    if (!type) continue;

    const world = legacy?.world ?? worldSlugFromSegment(segmentAttrs);
    if (world === 'unknown') continue;

    const preferredSlug = exact && legacy?.slug
      ? legacy.slug
      : slugify(displayName);
    const key = exact && legacy?.slug
      ? `legacy:${legacy.slug}`
      : `xml:${segmentAttrs.signature || displayName}:${segmentAttrs.direction || 'forward'}`;

    let segment = segmentsByKey.get(key);
    if (!segment) {
      const slug = legacy?.slug
        ? uniqueSlug(legacy.slug, usedSlugs)
        : uniqueSlug(preferredSlug, usedSlugs);

      segment = {
        name: legacy?.name && (exact || isGenericSegmentLabel(displayName)) ? legacy.name : displayName,
        slug,
        type: legacy?.type ?? type,
        world,
        distance: legacy?.distance ?? asNumber(segmentAttrs.archSegmentDistanceInKilometers),
        elevation: legacy?.elevation ?? null,
        avgIncline: legacy?.avgIncline ?? null,
        climbType: legacy?.climbType ?? null,
        stravaSegmentUrl: exact ? (legacy?.stravaSegmentUrl ?? null) : null,
      };
      segmentsByKey.set(key, segment);
    }

    const routeSignatures = String(segmentAttrs.onRoutes ?? '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);

    for (const signature of routeSignatures) {
      if (!routeSegmentMap.has(signature)) {
        routeSegmentMap.set(signature, new Set());
      }
      routeSegmentMap.get(signature).add(segment.slug);
    }
  }

  const segments = [...segmentsByKey.values()].sort((a, b) =>
    a.world.localeCompare(b.world) ||
    a.type.localeCompare(b.type) ||
    a.name.localeCompare(b.name)
  );

  return { segments, routeSegmentMap };
}

function buildRoutes(gameDictionaryXml, routeSegmentMap) {
  const legacyRouteMap = buildLegacyRouteMap();
  const xmlRoutes = parseElements(gameDictionaryXml, 'ROUTE')
    .filter(route => route.map);

  const routes = xmlRoutes.map(routeAttrs => {
    const name = decodeXmlEntities(routeAttrs.name);
    const legacyRoute = legacyRouteMap.get(normalizeName(name));
    const signature = String(routeAttrs.signature ?? '');
    const xmlSegmentSlugs = [...(routeSegmentMap.get(signature) ?? new Set())];

    const fallbackSegments = Array.isArray(legacyRoute?.segments)
      ? legacyRoute.segments.filter(Boolean)
      : [];
    const segmentSlugs = xmlSegmentSlugs.length ? xmlSegmentSlugs : fallbackSegments;
    const segmentsOnRoute = segmentSlugs.map(segment => ({
      from: null,
      to: null,
      segment,
    }));

    return {
      name,
      slug: legacyRoute?.slug ?? slugify(name),
      world: legacyRoute?.world ?? worldSlugFromRoute(routeAttrs),
      distance: asNumber(routeAttrs.distanceInMeters, 1000),
      elevation: Math.round(asNumber(routeAttrs.ascentInMeters)),
      eventOnly: asBoolean(routeAttrs.eventOnly),
      sports: inferSports(routeAttrs.sports, legacyRoute),
      segments: segmentSlugs,
      segmentsOnRoute,
      zwiftInsiderUrl: legacyRoute?.zwiftInsiderUrl ?? null,
      whatsOnZwiftUrl: legacyRoute?.whatsOnZwiftUrl ?? null,
      signature,
      leadInDistance: asNumber(routeAttrs.leadinDistanceInMeters, 1000),
      leadInElevation: Math.round(asNumber(routeAttrs.leadinAscentInMeters)),
      levelLocked: asBoolean(routeAttrs.levelLocked),
      supportedLaps: asBoolean(routeAttrs.supportedLaps),
    };
  });

  return routes.sort((a, b) =>
    a.world.localeCompare(b.world) ||
    a.name.localeCompare(b.name)
  );
}

function buildWorldSchedule(mapScheduleXml) {
  return parseElements(mapScheduleXml, 'appointment')
    .map(appointment => ({
      map: appointment.map,
      world: ROUTE_WORLD_TO_SLUG[appointment.map] ?? null,
      start: appointment.start,
    }))
    .filter(appointment => appointment.world)
    .sort((a, b) => parseZwiftDate(a.start) - parseZwiftDate(b.start));
}

function buildPortalData(portalScheduleXml) {
  const metadata = new Map(
    parseElements(portalScheduleXml, 'PortalRoadMetadata').map(item => [
      String(item.id),
      {
        id: String(item.id),
        name: decodeXmlEntities(item.name),
        distance: asNumber(item.distanceCentimeters, 100000),
        elevation: Math.round(asNumber(item.elevCentimeters, 100)),
      },
    ])
  );

  const appointments = parseElements(portalScheduleXml, 'appointment')
    .map(item => ({
      road: String(item.road),
      world: SEGMENT_WORLD_TO_SLUG[Number(item.world)] ?? ROUTE_WORLD_TO_SLUG[item.world] ?? null,
      portalOfMonth: asBoolean(item.portal_of_month),
      portal: item.portal,
      start: item.start,
      metadata: metadata.get(String(item.road)) ?? null,
    }))
    .filter(item => item.world && item.metadata)
    .sort((a, b) => parseZwiftDate(a.start) - parseZwiftDate(b.start));

  return {
    roads: [...metadata.values()].sort((a, b) => a.name.localeCompare(b.name)),
    appointments,
  };
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function writeModule(filePath, exportName, value) {
  writeFileSync(
    filePath,
    `// Auto-generated by build-zwift-data.mjs — do not edit manually.\nexport const ${exportName} = ${JSON.stringify(value, null, 2)};\n`
  );
}

async function main() {
  const [gameDictionaryXml, mapScheduleXml, portalScheduleXml, zwiftVersionXml] = await Promise.all([
    fetchText(GAME_DICTIONARY_URL),
    fetchText(MAP_SCHEDULE_URL),
    fetchText(PORTAL_SCHEDULE_URL),
    fetchText(ZWIFT_VERSION_URL),
  ]);

  const { segments, routeSegmentMap } = buildSegments(gameDictionaryXml);
  const routes = buildRoutes(gameDictionaryXml, routeSegmentMap);
  const worldSchedule = buildWorldSchedule(mapScheduleXml);
  const portalData = buildPortalData(portalScheduleXml);
  const versionAttrs = parseAttributes((zwiftVersionXml.match(/<Zwift\s+([^>]+?)\/?>/) ?? [])[1] ?? '');

  writeModule(ROUTES_OUTPUT, 'routes', routes);
  writeModule(SEGMENTS_OUTPUT, 'segments', segments);
  writeFileSync(
    METADATA_OUTPUT,
    `// Auto-generated by build-zwift-data.mjs — do not edit manually.\n` +
    `export const zwiftMetadata = ${JSON.stringify({
      generatedAt: new Date().toISOString(),
      version: versionAttrs.sversion ?? versionAttrs.version ?? null,
      gameVersion: versionAttrs.version ?? null,
      routeCount: routes.length,
      segmentCount: segments.length,
    }, null, 2)};\n` +
    `export const guestWorldAppointments = ${JSON.stringify(worldSchedule, null, 2)};\n` +
    `export const portalRoadMetadata = ${JSON.stringify(portalData.roads, null, 2)};\n` +
    `export const portalRoadAppointments = ${JSON.stringify(portalData.appointments, null, 2)};\n`
  );

  console.log(`Zwift version: ${versionAttrs.sversion ?? versionAttrs.version ?? 'unknown'}`);
  console.log(`Wrote ${routes.length} routes to ${ROUTES_OUTPUT}`);
  console.log(`Wrote ${segments.length} segments to ${SEGMENTS_OUTPUT}`);
  console.log(`Wrote metadata to ${METADATA_OUTPUT}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

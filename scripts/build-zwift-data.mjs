// build-zwift-data.mjs — generates browser route data from Zwift's public CDN XML
// and route-position timelines from Sauce for Zwift's public release bundle.
// Temporary compatibility note: zwift-data is still used only to preserve slugs,
// external links, and Strava segment URLs during the cutover.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';
import { extractAll } from '@electron/asar';
import { routes as legacyRoutes, segments as legacySegments } from 'zwift-data';
import { summarizeProfile } from '../public/app/core/profile.js';

const GAME_DICTIONARY_URL = 'https://cdn.zwift.com/gameassets/GameDictionary.xml';
const MAP_SCHEDULE_URL = 'https://cdn.zwift.com/gameassets/MapSchedule_v2.xml';
const PORTAL_SCHEDULE_URL = 'https://cdn.zwift.com/gameassets/PortalRoadSchedule_v1.xml';
const ZWIFT_VERSION_URL = 'https://cdn.zwift.com/gameassets/Zwift_Updates_Root/Zwift_ver_cur.xml';

const SAUCE_RELEASE_VERSION = '2.2.1';
const SAUCE_RELEASE_URL =
  `https://github.com/SauceLLC/sauce4zwift-releases/releases/download/v${SAUCE_RELEASE_VERSION}/sauce4zwift-${SAUCE_RELEASE_VERSION}.zip`;

const ROUTES_OUTPUT = 'public/app/data/routes-data.js';
const SEGMENTS_OUTPUT = 'public/app/data/segments-data.js';
const TIMELINES_OUTPUT = 'public/app/data/route-timelines-data.js';
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

const WORLD_PREFIX_BY_SLUG = {
  watopia: 'watopia',
  richmond: 'richmond',
  london: 'london',
  'new-york': 'new york',
  'makuri-islands': 'makuri',
  'gravel-mountain': 'gravel mountain',
};

const SAUCE_ROUTE_ALIASES = {
  'richmond|richmond uci worlds': '2015 worlds course',
};

const ROUTE_METADATA_OVERRIDES = {
  'flat-out-fast': {
    zwiftInsiderUrl: 'https://zwiftinsider.com/route/flat-out-fast/',
    whatsOnZwiftUrl: 'https://whatsonzwift.com/world/watopia/route/flat-out-fast',
  },
};

// Segments missing from Sauce route projection for specific routes.
// Keyed by route slug → array of segment slugs to append.
// Use when Sauce's routes.json omits a segment that the route clearly passes through.
// Note: only add real timed Zwift game segments, not ZwiftInsider listing labels.
const ROUTE_SEGMENT_OVERRIDES = {
  'scotland-after-party': ['breakaway-brae'],
  'loch-loop':            ['breakaway-brae'],
  'loch-loop-reverse':    ['breakaway-brae-rev'],
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

function routeNameVariants(value = '', worldSlug = '') {
  const variants = new Set();
  const normalized = normalizeName(value);
  if (normalized) variants.add(normalized);
  if (normalized.startsWith('the ')) variants.add(normalized.slice(4));

  const worldPrefix = WORLD_PREFIX_BY_SLUG[worldSlug];
  if (worldPrefix && normalized.startsWith(`${worldPrefix} `)) {
    variants.add(normalized.slice(worldPrefix.length + 1));
  }
  if (worldPrefix && normalized.startsWith(`the ${worldPrefix} `)) {
    variants.add(normalized.slice(worldPrefix.length + 5));
  }

  return [...variants].filter(Boolean);
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

function classifySauceSegment(segment, fallbackType = null) {
  if (fallbackType) return fallbackType;

  const name = normalizeName(segment?.name);
  const color = String(segment?.color ?? '').toLowerCase();

  if (/\bsprint\b/.test(name) || color.includes('00b700')) return 'sprint';
  if (/\b(kom|qom|climb|grade|mountain|summit)\b/.test(name) || color.includes('ff0000')) {
    return 'climb';
  }
  return 'segment';
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
    const routeSlug = legacyRoute?.slug ?? slugify(name);
    const metadataOverride = ROUTE_METADATA_OVERRIDES[routeSlug] ?? null;
    const xmlSegmentSlugs = [...(routeSegmentMap.get(signature) ?? new Set())];

    const fallbackSegments = Array.isArray(legacyRoute?.segments)
      ? legacyRoute.segments.filter(Boolean)
      : [];
    const baseSegmentSlugs = xmlSegmentSlugs.length ? xmlSegmentSlugs : fallbackSegments;
    const overrideSegmentSlugs = ROUTE_SEGMENT_OVERRIDES[routeSlug] ?? [];
    const segmentSlugs = [...new Set([...baseSegmentSlugs, ...overrideSegmentSlugs])];
    const segmentsOnRoute = segmentSlugs.map(segment => ({
      from: null,
      to: null,
      segment,
    }));

    return {
      name,
      slug: routeSlug,
      world: legacyRoute?.world ?? worldSlugFromRoute(routeAttrs),
      distance: asNumber(routeAttrs.distanceInMeters, 1000),
      elevation: Math.round(asNumber(routeAttrs.ascentInMeters)),
      eventOnly: asBoolean(routeAttrs.eventOnly),
      sports: inferSports(routeAttrs.sports, legacyRoute),
      segments: segmentSlugs,
      segmentsOnRoute,
      zwiftInsiderUrl: metadataOverride?.zwiftInsiderUrl ?? legacyRoute?.zwiftInsiderUrl ?? null,
      whatsOnZwiftUrl: metadataOverride?.whatsOnZwiftUrl ?? legacyRoute?.whatsOnZwiftUrl ?? null,
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

async function downloadFile(url, filePath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  writeFileSync(filePath, Buffer.from(arrayBuffer));
}

async function ensureSauceDataDir() {
  const cacheRoot = join(tmpdir(), 'zwift-route-recommender-cache', `sauce4zwift-${SAUCE_RELEASE_VERSION}`);
  const zipPath = join(cacheRoot, `sauce4zwift-${SAUCE_RELEASE_VERSION}.zip`);
  const extractedZipDir = join(cacheRoot, 'release');
  const extractedAppDir = join(cacheRoot, 'app');
  const dataDir = join(extractedAppDir, 'shared', 'deps', 'data');

  mkdirSync(cacheRoot, { recursive: true });

  if (!existsSync(zipPath)) {
    console.log(`Downloading Sauce for Zwift release ${SAUCE_RELEASE_VERSION}...`);
    await downloadFile(SAUCE_RELEASE_URL, zipPath);
  }

  if (!existsSync(dataDir)) {
    if (!existsSync(extractedZipDir)) {
      console.log('Extracting Sauce release zip...');
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractedZipDir, true);
    }

    const appAsarPath = listFilesSync(extractedZipDir)
      .find(filePath => filePath.endsWith('app.asar'));

    if (!appAsarPath) {
      throw new Error('Could not locate Sauce app.asar in release bundle.');
    }

    console.log('Extracting Sauce app.asar...');
    extractAll(appAsarPath, extractedAppDir);
  }

  return dataDir;
}

function listFilesSync(rootDir) {
  const queue = [rootDir];
  const files = [];
  while (queue.length) {
    const current = queue.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function clamp01(value) {
  return Math.min(Math.max(Number(value) || 0, 0), 1);
}

function roadPointFromNode(node) {
  if (!Array.isArray(node) || node.length < 3) return null;
  return {
    x: Number(node[0]) / 100,
    y: Number(node[1]) / 100,
    z: Number(node[2]) / 100,
  };
}

function distance3d(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
}

function buildRoadGeometry(road) {
  const points = (road.path ?? [])
    .map(roadPointFromNode)
    .filter(Boolean);

  if (points.length < 2) {
    return {
      looped: Boolean(road.looped),
      totalLengthM: 0,
      points,
      cumulativeM: [0],
    };
  }

  const cumulativeM = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulativeM[index] = cumulativeM[index - 1] + distance3d(points[index - 1], points[index]);
  }

  return {
    looped: Boolean(road.looped),
    totalLengthM: cumulativeM.at(-1) ?? 0,
    points,
    cumulativeM,
  };
}

function positionForRoadTime(roadGeometry, roadTime) {
  const t = clamp01(roadTime);
  const totalLengthM = roadGeometry?.totalLengthM ?? 0;
  const points = roadGeometry?.points ?? [];
  const cumulativeM = roadGeometry?.cumulativeM ?? [];

  if (!points.length) {
    return { x: 0, y: 0, z: 0, distanceM: 0 };
  }

  if (points.length === 1 || totalLengthM <= 0) {
    return { ...points[0], distanceM: 0 };
  }

  const targetDistanceM = totalLengthM * t;
  for (let index = 1; index < cumulativeM.length; index += 1) {
    if (targetDistanceM > cumulativeM[index]) continue;

    const segmentStartM = cumulativeM[index - 1];
    const segmentLengthM = cumulativeM[index] - segmentStartM;
    const ratio = segmentLengthM > 0 ? (targetDistanceM - segmentStartM) / segmentLengthM : 0;
    const start = points[index - 1];
    const end = points[index];

    return {
      x: start.x + ((end.x - start.x) * ratio),
      y: start.y + ((end.y - start.y) * ratio),
      z: start.z + ((end.z - start.z) * ratio),
      distanceM: targetDistanceM,
    };
  }

  return {
    ...points.at(-1),
    distanceM: totalLengthM,
  };
}

function distanceAlongRoad(roadGeometry, startTime, endTime, { reverse = false } = {}) {
  const start = positionForRoadTime(roadGeometry, startTime);
  const end = positionForRoadTime(roadGeometry, endTime);
  const totalLengthM = roadGeometry?.totalLengthM ?? 0;
  const looped = Boolean(roadGeometry?.looped);

  if (totalLengthM <= 0) return 0;

  // Reversed manifest sections should travel directly from end -> start,
  // not wrap around the entire looped road.
  if (!reverse && looped && end.distanceM < start.distanceM) {
    return (totalLengthM - start.distanceM) + end.distanceM;
  }

  return Math.abs(end.distanceM - start.distanceM);
}

function roadSectionTimeAtRatio(roadGeometry, startTime, endTime, ratio, { reverse = false } = {}) {
  if (reverse) {
    const fromTime = endTime;
    const toTime = startTime;
    return fromTime + ((toTime - fromTime) * ratio);
  }

  let t = startTime + ((endTime - startTime) * ratio);
  if (roadGeometry.looped && endTime < startTime) {
    t = startTime + (((endTime + 1) - startTime) * ratio);
    if (t > 1) t -= 1;
  }
  return t;
}

function sampleRoadSectionStats(roadGeometry, startTime, endTime, steps = 24, options = {}) {
  if (!roadGeometry || (roadGeometry.totalLengthM ?? 0) <= 0) {
    return {
      distanceM: 0,
      elevationDeltaM: 0,
      elevationGainM: 0,
      avgGradePct: null,
      roadLengthM: 0,
    };
  }

  const normalizedSteps = Math.max(2, steps);
  const samples = [];

  for (let index = 0; index < normalizedSteps; index += 1) {
    const ratio = normalizedSteps === 1 ? 0 : index / (normalizedSteps - 1);
    const t = roadSectionTimeAtRatio(roadGeometry, startTime, endTime, ratio, options);
    samples.push(positionForRoadTime(roadGeometry, t));
  }

  let distanceM = 0;
  let elevationGainM = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    distanceM += distance3d(previous, current);
    const deltaZ = current.z - previous.z;
    if (deltaZ > 0) elevationGainM += deltaZ;
  }

  const elevationDeltaM = samples.at(-1).z - samples[0].z;
  const avgGradePct = distanceM > 0 ? Number(((elevationDeltaM / distanceM) * 100).toFixed(2)) : null;

  return {
    distanceM,
    elevationDeltaM: Number(elevationDeltaM.toFixed(1)),
    elevationGainM: Number(elevationGainM.toFixed(1)),
    avgGradePct,
    roadLengthM: Number((roadGeometry.totalLengthM ?? 0).toFixed(1)),
  };
}

function sampleRoadSectionPoints(roadGeometry, startTime, endTime, steps = 24, options = {}) {
  if (!roadGeometry || (roadGeometry.totalLengthM ?? 0) <= 0) return [];

  const normalizedSteps = Math.max(2, steps);
  const samples = [];

  for (let index = 0; index < normalizedSteps; index += 1) {
    const ratio = normalizedSteps === 1 ? 0 : index / (normalizedSteps - 1);
    const t = roadSectionTimeAtRatio(roadGeometry, startTime, endTime, ratio, options);
    samples.push(positionForRoadTime(roadGeometry, t));
  }

  return samples;
}

function downsampleProfile(profile, maxPoints = 120) {
  if (!Array.isArray(profile) || profile.length <= maxPoints) return profile ?? [];
  if (maxPoints < 3) return [profile[0], profile.at(-1)];

  const lastIndex = profile.length - 1;
  const result = [profile[0]];

  for (let index = 1; index < maxPoints - 1; index += 1) {
    const sampleIndex = Math.round((index / (maxPoints - 1)) * lastIndex);
    result.push(profile[sampleIndex]);
  }

  result.push(profile.at(-1));
  return result;
}

function smoothProfilePass(rawProfile, windowKm) {
  return rawProfile.map((point, index) => {
    if (index === 0 || index === rawProfile.length - 1) return point;

    const centerKm = Number(point.profileKm ?? 0);
    let weightedElevation = 0;
    let totalWeight = 0;

    for (const sample of rawProfile) {
      const distanceKm = Math.abs((Number(sample.profileKm ?? 0)) - centerKm);
      if (distanceKm > windowKm) continue;
      const weight = 1 - (distanceKm / windowKm);
      weightedElevation += (Number(sample.elevationM ?? 0) * weight);
      totalWeight += weight;
    }

    if (totalWeight <= 0) return point;
    return {
      ...point,
      elevationM: Number((weightedElevation / totalWeight).toFixed(1)),
    };
  });
}

function smoothProfile(rawProfile, totalRouteKm) {
  if (!Array.isArray(rawProfile) || rawProfile.length < 5) return rawProfile ?? [];

  const windowKm = Math.min(Math.max((Number(totalRouteKm) || 0) * 0.006, 0.18), 0.40);
  const firstPass = smoothProfilePass(rawProfile, windowKm);
  return smoothProfilePass(firstPass, Math.max(windowKm * 0.50, 0.14));
}

function buildRouteProfile(sauceRoute, worldRoadGeometry, totalRouteKm, maxPoints = 120) {
  const manifest = Array.isArray(sauceRoute?.manifest) ? sauceRoute.manifest : [];
  if (!manifest.length || !worldRoadGeometry?.size) return null;

  const rawProfile = [];
  let cumulativeM = 0;

  for (const manifestEntry of manifest) {
    const roadGeometry = worldRoadGeometry.get(Number(manifestEntry?.roadId));
    if (!roadGeometry) continue;

    const startTime = Number.isFinite(Number(manifestEntry?.start)) ? Number(manifestEntry.start) : 0;
    const endTime = Number.isFinite(Number(manifestEntry?.end)) ? Number(manifestEntry.end) : 1;
    const reverse = Boolean(manifestEntry?.reverse);
    const sectionDistanceM = distanceAlongRoad(roadGeometry, startTime, endTime, { reverse });
    const sectionSteps = Math.min(48, Math.max(2, Math.ceil(sectionDistanceM / 150) + 1));
    const sectionPoints = sampleRoadSectionPoints(roadGeometry, startTime, endTime, sectionSteps, { reverse });
    if (!sectionPoints.length) continue;

    if (!rawProfile.length) {
      const firstPoint = sectionPoints[0];
      rawProfile.push({
        profileKm: 0,
        elevationM: Number(firstPoint.z.toFixed(1)),
      });
    }

    let previousPoint = sectionPoints[0];
    for (let index = 1; index < sectionPoints.length; index += 1) {
      const point = sectionPoints[index];
      if (!point) continue;
      cumulativeM += distance3d(previousPoint, point);
      rawProfile.push({
        profileKm: Number((cumulativeM / 1000).toFixed(3)),
        elevationM: Number(point.z.toFixed(1)),
      });
      previousPoint = point;
    }
  }

  if (rawProfile.length < 2) return null;
  const smoothedProfile = smoothProfile(rawProfile, totalRouteKm);
  const totalProfileKm = smoothedProfile.at(-1)?.profileKm ?? 0;
  if (totalProfileKm <= 0) return null;

  const routeKmScale = Number.isFinite(totalRouteKm) && totalRouteKm > 0
    ? totalRouteKm / totalProfileKm
    : 1;
  const points = smoothedProfile.map(point => ([
    point.profileKm,
    point.elevationM,
    Number((point.profileKm * routeKmScale).toFixed(3)),
  ]));

  return {
    totalProfileKm: Number(totalProfileKm.toFixed(3)),
    totalRouteKm: Number(((Number.isFinite(totalRouteKm) && totalRouteKm > 0) ? totalRouteKm : totalProfileKm).toFixed(3)),
    points: downsampleProfile(points, maxPoints),
  };
}

function isGenericMarkerName(name = '') {
  const normalized = normalizeName(name);
  return (
    normalized === 'sprint' ||
    normalized === 'sprint reverse' ||
    normalized === 'sprint forward end' ||
    normalized === 'sprint reverse end' ||
    normalized === 'kom' ||
    normalized === 'kom reverse' ||
    normalized === 'qom' ||
    normalized === 'qom reverse' ||
    normalized === 'unknown segment'
  );
}

function profileMarkerPriority(occurrence) {
  const distanceKm = Number(occurrence?.distanceKm ?? 0);
  const elevationGainM = Math.max(Number(occurrence?.elevationGainM ?? 0), 0);
  const avgGradePct = Math.max(Number(occurrence?.avgGradePct ?? 0), 0);
  const namedBonus = isGenericMarkerName(occurrence?.name) ? 0 : 18;
  const routeBonus = occurrence?.sourceSection === 'route' ? 6 : occurrence?.sourceSection === 'lap' ? 3 : 0;

  if (occurrence?.type === 'climb') {
    return Number((namedBonus + routeBonus + elevationGainM + (distanceKm * 18) + (avgGradePct * 6)).toFixed(2));
  }

  if (occurrence?.type === 'sprint') {
    const flatness = Math.max(0, 5 - Math.abs(Number(occurrence?.avgGradePct ?? 0)));
    return Number((namedBonus + routeBonus + (distanceKm * 42) + (flatness * 3)).toFixed(2));
  }

  return 0;
}

function pickProfileMarkers(occurrences, profile, limit = 6) {
  if (!Array.isArray(occurrences) || !occurrences.length || !profile) return [];

  const totalProfileKm = Number(profile.totalProfileKm ?? 0);
  const totalRouteKm = Number(profile.totalRouteKm ?? 0);
  if (totalProfileKm <= 0 || totalRouteKm <= 0) return [];

  const seen = new Set();
  const deduped = [];

  for (const occurrence of occurrences) {
    if (occurrence?.type !== 'climb' && occurrence?.type !== 'sprint') continue;
    if (!occurrence?.name || isGenericMarkerName(occurrence.name)) continue;

    const key = occurrence.segmentSlug || `${occurrence.type}:${normalizeNameLoose(occurrence.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const routeStartKm = Number(occurrence.startKm ?? 0);
    const routeEndKm = Number(occurrence.endKm ?? routeStartKm);
    const profileStartKm = Number(((routeStartKm / totalRouteKm) * totalProfileKm).toFixed(3));
    const profileEndKm = Number(((routeEndKm / totalRouteKm) * totalProfileKm).toFixed(3));

    deduped.push({
      type: occurrence.type,
      name: occurrence.name,
      segmentSlug: occurrence.segmentSlug ?? null,
      routeStartKm,
      routeEndKm,
      profileStartKm,
      profileEndKm,
      priority: profileMarkerPriority(occurrence),
      sourceSection: occurrence.sourceSection ?? 'route',
    });
  }

  const climbs = deduped
    .filter(marker => marker.type === 'climb')
    .sort((a, b) => b.priority - a.priority || a.routeStartKm - b.routeStartKm)
    .slice(0, 3);
  const sprints = deduped
    .filter(marker => marker.type === 'sprint')
    .sort((a, b) => b.priority - a.priority || a.routeStartKm - b.routeStartKm)
    .slice(0, 3);

  const selected = [];
  const selectedKeys = new Set();
  for (const marker of [...climbs, ...sprints].sort((a, b) => b.priority - a.priority || a.routeStartKm - b.routeStartKm)) {
    const key = marker.segmentSlug || `${marker.type}:${normalizeNameLoose(marker.name)}`;
    if (selectedKeys.has(key)) continue;
    selected.push(marker);
    selectedKeys.add(key);
  }

  if (selected.length < limit) {
    for (const marker of deduped.sort((a, b) => b.priority - a.priority || a.routeStartKm - b.routeStartKm)) {
      const key = marker.segmentSlug || `${marker.type}:${normalizeNameLoose(marker.name)}`;
      if (selectedKeys.has(key)) continue;
      selected.push(marker);
      selectedKeys.add(key);
      if (selected.length >= limit) break;
    }
  }

  return selected
    .slice(0, limit)
    .sort((a, b) => a.routeStartKm - b.routeStartKm || b.priority - a.priority);
}

function buildRoadGeometryIndex(sauceDataDir) {
  const byWorldId = new Map();
  const worldsDir = join(sauceDataDir, 'worlds');

  for (const worldId of readdirSync(worldsDir)) {
    const roadsPath = join(worldsDir, worldId, 'roads.json');
    if (!existsSync(roadsPath)) continue;

    const roads = readJson(roadsPath);
    byWorldId.set(
      Number(worldId),
      new Map(roads.map(road => [Number(road.id), buildRoadGeometry(road)]))
    );
  }

  return byWorldId;
}

function buildAppSegmentIndexes(appSegments) {
  const exact = new Map();
  const byWorld = new Map();

  for (const segment of appSegments) {
    const exactKey = `${segment.world}|${normalizeName(segment.name)}`;
    if (!exact.has(exactKey)) exact.set(exactKey, []);
    exact.get(exactKey).push(segment);

    if (!byWorld.has(segment.world)) byWorld.set(segment.world, []);
    byWorld.get(segment.world).push(segment);
  }

  return { exact, byWorld };
}

function matchAppSegment(occurrenceName, worldSlug, routeSegmentSlugs, appSegmentsBySlug, indexes) {
  const routeSegments = routeSegmentSlugs
    .map(slug => appSegmentsBySlug.get(slug))
    .filter(Boolean);
  const exactKey = `${worldSlug}|${normalizeName(occurrenceName)}`;
  const exactMatches = indexes.exact.get(exactKey) ?? [];

  const routeScopedExact = exactMatches.filter(segment => routeSegmentSlugs.includes(segment.slug));
  if (routeScopedExact.length === 1) return routeScopedExact[0];
  if (exactMatches.length === 1) return exactMatches[0];

  const looseName = normalizeNameLoose(occurrenceName);
  const routeScopedLoose = routeSegments.filter(segment => normalizeNameLoose(segment.name) === looseName);
  if (routeScopedLoose.length === 1) return routeScopedLoose[0];

  const worldLoose = (indexes.byWorld.get(worldSlug) ?? [])
    .filter(segment => normalizeNameLoose(segment.name) === looseName);
  if (worldLoose.length === 1) return worldLoose[0];

  return null;
}

function enrichSegmentsWithSauceGeometry(appSegments, sauceDataDir, roadGeometryByWorldId) {
  const appSegmentsBySlug = new Map(appSegments.map(segment => [segment.slug, segment]));
  const appSegmentIndexes = buildAppSegmentIndexes(appSegments);
  const worldSegmentFiles = readdirSync(join(sauceDataDir, 'worlds'));

  for (const worldIdText of worldSegmentFiles) {
    const worldId = Number(worldIdText);
    const worldSlug = SEGMENT_WORLD_TO_SLUG[worldId];
    if (!worldSlug) continue;

    const segmentsPath = join(sauceDataDir, 'worlds', worldIdText, 'segments.json');
    if (!existsSync(segmentsPath)) continue;

    const worldSegments = readJson(segmentsPath);
    const roadGeometryById = roadGeometryByWorldId.get(worldId) ?? new Map();

    for (const sauceSegment of worldSegments) {
      const appSegment = matchAppSegment(
        sauceSegment?.name ?? '',
        worldSlug,
        [],
        appSegmentsBySlug,
        appSegmentIndexes
      );
      if (!appSegment) continue;

      const roadGeometry = roadGeometryById.get(Number(sauceSegment.roadId));
      if (!roadGeometry) continue;
      const sauceType = classifySauceSegment(sauceSegment, null);
      if (sauceType && appSegment.type && sauceType !== appSegment.type) continue;

      const stats = sampleRoadSectionStats(
        roadGeometry,
        sauceSegment.roadStart,
        sauceSegment.roadFinish,
        24,
        { reverse: Boolean(sauceSegment.reverse) }
      );
      const computedDistanceKm = Number((stats.distanceM / 1000).toFixed(3));
      if ((appSegment.distance ?? 0) > 0 && computedDistanceKm > 0) {
        const ratio = Math.max(appSegment.distance, computedDistanceKm) / Math.max(Math.min(appSegment.distance, computedDistanceKm), 0.001);
        if (ratio > 2.5) continue;
      }

      if ((appSegment.avgIncline ?? null) === null && stats.avgGradePct !== null) {
        appSegment.avgIncline = stats.avgGradePct;
      }
      if ((appSegment.elevation ?? null) === null && stats.elevationGainM > 0) {
        appSegment.elevation = Math.round(stats.elevationGainM);
      }
      if ((appSegment.distance ?? 0) <= 0 && stats.distanceM > 0) {
        appSegment.distance = computedDistanceKm;
      }
    }
  }
}

function buildSauceRouteIndex(sauceRoutes) {
  const index = new Map();

  for (const route of sauceRoutes) {
    const worldSlug = SEGMENT_WORLD_TO_SLUG[route.worldId];
    for (const variant of routeNameVariants(route.name, worldSlug)) {
      const key = `${worldSlug}|${variant}`;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(route);
    }
  }

  return index;
}

function matchSauceRoute(appRoute, sauceRouteIndex) {
  let candidates = [];
  for (const variant of routeNameVariants(appRoute.name, appRoute.world)) {
    candidates.push(...(sauceRouteIndex.get(`${appRoute.world}|${variant}`) ?? []));
  }

  if (!candidates.length) {
    const alias = SAUCE_ROUTE_ALIASES[`${appRoute.world}|${normalizeName(appRoute.name)}`];
    if (alias) {
      candidates.push(...(sauceRouteIndex.get(`${appRoute.world}|${alias}`) ?? []));
    }
  }

  const uniqueCandidates = [...new Map(candidates.map(candidate => [candidate.id, candidate])).values()];
  if (uniqueCandidates.length !== 1) return null;
  return uniqueCandidates[0];
}

function buildRouteTimelines(appRoutes, appSegments, sauceDataDir, roadGeometryByWorldId) {
  const sauceRoutes = readJson(join(sauceDataDir, 'routes.json'));
  const worldSegmentMaps = new Map();
  const sauceRouteIndex = buildSauceRouteIndex(sauceRoutes);
  const appSegmentsBySlug = new Map(appSegments.map(segment => [segment.slug, segment]));
  const appSegmentIndexes = buildAppSegmentIndexes(appSegments);
  const routeTimelinesBySignature = {};
  const routeProfilesBySignature = {};
  const routeProfileMarkersBySignature = {};
  const unmatchedRoutes = [];

  for (const appRoute of appRoutes) {
    const sauceRoute = matchSauceRoute(appRoute, sauceRouteIndex);
    if (!sauceRoute) {
      unmatchedRoutes.push({
        name: appRoute.name,
        world: appRoute.world,
        signature: appRoute.signature,
      });
      continue;
    }

    if (!worldSegmentMaps.has(sauceRoute.worldId)) {
      const worldSegments = readJson(join(sauceDataDir, 'worlds', String(sauceRoute.worldId), 'segments.json'));
      worldSegmentMaps.set(
        sauceRoute.worldId,
        new Map(worldSegments.map(segment => [String(segment.id), segment]))
      );
    }

    const worldSegmentsById = worldSegmentMaps.get(sauceRoute.worldId);
    const worldRoadGeometry = roadGeometryByWorldId.get(Number(sauceRoute.worldId)) ?? new Map();
    const leadInKm = Number(((sauceRoute.leadinDistanceInMeters ?? appRoute.leadInDistance * 1000 ?? 0) / 1000).toFixed(3));
    const totalKm = Number(((sauceRoute.distanceInMeters ?? appRoute.distance * 1000 ?? 0) / 1000).toFixed(3));
    const lapKm = Number(Math.max(totalKm - leadInKm, 0).toFixed(3));
    routeProfilesBySignature[appRoute.signature] = buildRouteProfile(sauceRoute, worldRoadGeometry, totalKm);
    const routeSegmentSlugs = [
      ...new Set([
        ...(appRoute.segmentsOnRoute ?? []).map(item => item.segment).filter(Boolean),
        ...(appRoute.segments ?? []).filter(Boolean),
      ]),
    ];

    const occurrences = (sauceRoute.segments ?? [])
      .map((occurrence, index) => {
        const sauceSegment = worldSegmentsById.get(String(occurrence.id)) ?? null;
        const appSegment = matchAppSegment(
          sauceSegment?.name ?? '',
          appRoute.world,
          routeSegmentSlugs,
          appSegmentsBySlug,
          appSegmentIndexes
        );
        const type = classifySauceSegment(sauceSegment, appSegment?.type ?? null);
        const offsetMeters = Number(occurrence.offset ?? 0);
        const roadGeometry = sauceSegment ? worldRoadGeometry.get(Number(sauceSegment.roadId)) : null;
        const geometryStats = sauceSegment && roadGeometry
          ? sampleRoadSectionStats(
            roadGeometry,
            sauceSegment.roadStart,
            sauceSegment.roadFinish,
            24,
            { reverse: Boolean(sauceSegment.reverse) }
          )
          : null;
        const rawDistanceMeters =
          Number(occurrence.distance ?? 0) ||
          Number(sauceSegment?.distance ?? 0) ||
          Number(geometryStats?.distanceM ?? 0);
        const distanceKm = Number((rawDistanceMeters / 1000).toFixed(3));
        const startKm = Number(((offsetMeters + (sauceRoute.leadinDistanceInMeters ?? 0)) / 1000).toFixed(3));
        const endKm = Number((startKm + distanceKm).toFixed(3));

        return {
          occurrenceId: `${appRoute.signature}:${index + 1}`,
          segmentId: String(occurrence.id),
          segmentSlug: appSegment?.slug ?? null,
          name: appSegment?.name ?? sauceSegment?.name ?? `Segment ${occurrence.id}`,
          type,
          order: index + 1,
          startKm,
          endKm,
          distanceKm,
          routeOffsetKm: Number((offsetMeters / 1000).toFixed(3)),
          roadId: sauceSegment?.roadId ?? null,
          reverse: Boolean(sauceSegment?.reverse),
          roadStart: Number.isFinite(Number(sauceSegment?.roadStart)) ? Number(sauceSegment.roadStart) : null,
          roadFinish: Number.isFinite(Number(sauceSegment?.roadFinish)) ? Number(sauceSegment.roadFinish) : null,
          roadLengthKm: geometryStats ? Number((geometryStats.roadLengthM / 1000).toFixed(3)) : null,
          avgGradePct: geometryStats?.avgGradePct ?? appSegment?.avgIncline ?? null,
          elevationDeltaM: geometryStats?.elevationDeltaM ?? null,
          elevationGainM: geometryStats?.elevationGainM ?? null,
          sourceSection: occurrence.leadinOnly ? 'leadin' : (appRoute.supportedLaps ? 'lap' : 'route'),
          leadinOnly: Boolean(occurrence.leadinOnly),
        };
      })
      .sort((a, b) => a.startKm - b.startKm || a.order - b.order);

    routeTimelinesBySignature[appRoute.signature] = {
      signature: appRoute.signature,
      routeSlug: appRoute.slug,
      routeName: appRoute.name,
      world: appRoute.world,
      sauceRouteId: String(sauceRoute.id),
      sauceRouteName: sauceRoute.name,
      leadInKm,
      lapKm,
      totalKm,
      supportsLaps: Boolean(appRoute.supportedLaps),
      matchedSegmentCount: occurrences.filter(item => item.segmentSlug).length,
      segments: occurrences,
    };
    routeProfileMarkersBySignature[appRoute.signature] = pickProfileMarkers(
      occurrences,
      routeProfilesBySignature[appRoute.signature],
    );
  }

  return { routeTimelinesBySignature, routeProfilesBySignature, routeProfileMarkersBySignature, unmatchedRoutes };
}

function writeModule(filePath, exportName, value) {
  writeFileSync(
    filePath,
    `// Auto-generated by build-zwift-data.mjs — do not edit manually.\nexport const ${exportName} = ${JSON.stringify(value, null, 2)};\n`
  );
}

function logProfileAudit(routesWithProfiles) {
  const flagged = routesWithProfiles
    .map(route => {
      const summary = summarizeProfile(route);
      if (!summary?.flatAuditFlag) return null;
      return {
        name: route.name,
        world: route.world,
        elevation: route.elevation,
        profileRange: summary.actualElevationRange,
        robustRange: summary.robustElevationRange,
        gradientMPerKm: summary.gradientMPerKm,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.profileRange - a.profileRange || a.elevation - b.elevation);

  console.log(`Profile audit flags: ${flagged.length}`);
  if (!flagged.length) return;

  console.log(flagged
    .slice(0, 10)
    .map(route => (
      `- ${route.world}: ${route.name} | route elev ${route.elevation} m | ` +
      `profile span ${route.profileRange.toFixed(1)} m | robust span ${route.robustRange.toFixed(1)} m | ` +
      `${route.gradientMPerKm.toFixed(1)} m/km`
    ))
    .join('\n'));
}

async function main() {
  const sauceDataDir = await ensureSauceDataDir();
  const roadGeometryByWorldId = buildRoadGeometryIndex(sauceDataDir);
  const [gameDictionaryXml, mapScheduleXml, portalScheduleXml, zwiftVersionXml] = await Promise.all([
    fetchText(GAME_DICTIONARY_URL),
    fetchText(MAP_SCHEDULE_URL),
    fetchText(PORTAL_SCHEDULE_URL),
    fetchText(ZWIFT_VERSION_URL),
  ]);

  const { segments, routeSegmentMap } = buildSegments(gameDictionaryXml);
  enrichSegmentsWithSauceGeometry(segments, sauceDataDir, roadGeometryByWorldId);
  const routes = buildRoutes(gameDictionaryXml, routeSegmentMap);
  const { routeTimelinesBySignature, routeProfilesBySignature, routeProfileMarkersBySignature, unmatchedRoutes } = buildRouteTimelines(routes, segments, sauceDataDir, roadGeometryByWorldId);
  const routesWithProfiles = routes.map(route => ({
    ...route,
    profile: routeProfilesBySignature[route.signature] ?? null,
    profileMarkers: routeProfileMarkersBySignature[route.signature] ?? [],
  }));
  const worldSchedule = buildWorldSchedule(mapScheduleXml);
  const portalData = buildPortalData(portalScheduleXml);
  const versionAttrs = parseAttributes((zwiftVersionXml.match(/<Zwift\s+([^>]+?)\/?>/) ?? [])[1] ?? '');

  writeModule(ROUTES_OUTPUT, 'routes', routesWithProfiles);
  writeModule(SEGMENTS_OUTPUT, 'segments', segments);
  writeModule(TIMELINES_OUTPUT, 'routeTimelinesBySignature', routeTimelinesBySignature);
  writeFileSync(
    METADATA_OUTPUT,
    `// Auto-generated by build-zwift-data.mjs — do not edit manually.\n` +
    `export const zwiftMetadata = ${JSON.stringify({
      generatedAt: new Date().toISOString(),
      version: versionAttrs.sversion ?? versionAttrs.version ?? null,
      gameVersion: versionAttrs.version ?? null,
      routeCount: routesWithProfiles.length,
      segmentCount: segments.length,
      timelineRouteCount: Object.keys(routeTimelinesBySignature).length,
      sauceReleaseVersion: SAUCE_RELEASE_VERSION,
      unmatchedTimelineRoutes: unmatchedRoutes,
    }, null, 2)};\n` +
    `export const guestWorldAppointments = ${JSON.stringify(worldSchedule, null, 2)};\n` +
    `export const portalRoadMetadata = ${JSON.stringify(portalData.roads, null, 2)};\n` +
    `export const portalRoadAppointments = ${JSON.stringify(portalData.appointments, null, 2)};\n`
  );

  console.log(`Zwift version: ${versionAttrs.sversion ?? versionAttrs.version ?? 'unknown'}`);
  console.log(`Wrote ${routesWithProfiles.length} routes to ${ROUTES_OUTPUT}`);
  console.log(`Wrote ${segments.length} segments to ${SEGMENTS_OUTPUT}`);
  console.log(`Wrote ${Object.keys(routeTimelinesBySignature).length} route timelines to ${TIMELINES_OUTPUT}`);
  logProfileAudit(routesWithProfiles);
  console.log(`Unmatched timeline routes: ${unmatchedRoutes.length}`);
  if (unmatchedRoutes.length) {
    console.log(unmatchedRoutes.map(route => `- ${route.world}: ${route.name}`).join('\n'));
  }
  console.log(`Wrote metadata to ${METADATA_OUTPUT}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

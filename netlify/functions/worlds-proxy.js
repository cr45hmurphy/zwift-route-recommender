const DEFAULT_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'cache-control': 'public, max-age=300',
};

const WORLD_SLUGS = new Set([
  'watopia',
  'london',
  'new-york',
  'innsbruck',
  'richmond',
  'bologna',
  'yorkshire',
  'crit-city',
  'makuri-islands',
  'france',
  'paris',
  'scotland',
  'gravel-mountain',
]);

function json(statusCode, body) {
  return {
    statusCode,
    headers: DEFAULT_HEADERS,
    body: JSON.stringify(body),
  };
}

function titleCaseSlug(slug) {
  return slug
    .split('-')
    .map(part => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part)
    .join(' ');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractWhatsOnZwiftWorlds(html) {
  const start = html.indexOf('Currently active worlds:');
  if (start < 0) throw new Error("Could not find What's on Zwift active worlds section.");
  const end = html.indexOf('</ul>', start);
  if (end < 0) throw new Error("Could not find What's on Zwift active worlds list end.");

  const section = html.slice(start, end);
  const slugs = [];
  const regex = /https:\/\/whatsonzwift\.com\/world\/([a-z-]+)/gi;
  let match;
  while ((match = regex.exec(section))) {
    const slug = match[1].toLowerCase();
    if (WORLD_SLUGS.has(slug)) slugs.push(slug);
  }
  return unique(slugs);
}

function chicagoDayOfMonth(now = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    day: 'numeric',
  }).format(now);
}

function extractZwiftInsiderWorlds(html, now = new Date()) {
  const day = chicagoDayOfMonth(now);
  const classNeedle = `spiffy-day-${day}`;
  const start = html.indexOf(classNeedle);
  if (start < 0) throw new Error(`Could not find ZwiftInsider schedule cell for day ${day}.`);
  const end = html.indexOf('</td>', start);
  if (end < 0) throw new Error('Could not find ZwiftInsider schedule cell end.');

  const section = html.slice(start, end);
  const slugs = [];
  const regex = /https:\/\/zwiftinsider\.com\/([a-z-]+)\//gi;
  let match;
  while ((match = regex.exec(section))) {
    const slug = match[1].toLowerCase();
    if (WORLD_SLUGS.has(slug)) slugs.push(slug);
  }
  return unique(slugs);
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; route-recommender/1.0)',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed with ${response.status}`);
  }

  return response.text();
}

async function scrapeWhatsOnZwift() {
  const html = await fetchHtml('https://whatsonzwift.com/');
  const guestWorlds = extractWhatsOnZwiftWorlds(html).filter(world => world !== 'watopia');
  return {
    source: 'woz',
    sourceLabel: "What's on Zwift",
    guestWorlds,
    worlds: ['watopia', ...guestWorlds],
    fetchedAt: new Date().toISOString(),
  };
}

async function scrapeZwiftInsider() {
  const html = await fetchHtml('https://zwiftinsider.com/schedule/');
  const guestWorlds = extractZwiftInsiderWorlds(html).filter(world => world !== 'watopia');
  return {
    source: 'zi',
    sourceLabel: 'ZwiftInsider',
    guestWorlds,
    worlds: ['watopia', ...guestWorlds],
    fetchedAt: new Date().toISOString(),
  };
}

export const handler = async (event) => {
  const source = event.queryStringParameters?.source || 'woz';

  try {
    const payload =
      source === 'zi'
        ? await scrapeZwiftInsider()
        : await scrapeWhatsOnZwift();

    if (!payload.guestWorlds.length) {
      throw new Error(`No guest worlds found from ${payload.sourceLabel}.`);
    }

    return json(200, payload);
  } catch (error) {
    return json(500, {
      error: String(error?.message || error),
      source,
      sourceLabel: source === 'zi' ? 'ZwiftInsider' : "What's on Zwift",
      hint: `Unable to scrape active worlds from ${source === 'zi' ? 'ZwiftInsider' : "What's on Zwift"}.`,
      knownWorldSlugs: [...WORLD_SLUGS].map(titleCaseSlug),
    });
  }
};

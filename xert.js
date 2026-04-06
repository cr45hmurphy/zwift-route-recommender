// xert.js — Xert API wrapper
// All requests route through the local proxy at localhost:3000.

const PROXY_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3000'
  : '/.netlify/functions/xert-proxy';
const TOKEN_KEY    = 'xert_token';
const TOKEN_TS_KEY = 'xert_token_ts';
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// --- Token storage ---

function saveToken(token) {
  localStorage.setItem(TOKEN_KEY,    token);
  localStorage.setItem(TOKEN_TS_KEY, Date.now().toString());
}

function loadToken() {
  const token = localStorage.getItem(TOKEN_KEY);
  const ts    = parseInt(localStorage.getItem(TOKEN_TS_KEY) || '0', 10);
  if (!token) return null;
  if (Date.now() - ts > TOKEN_TTL_MS) return null; // expired
  return token;
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_TS_KEY);
}

export function hasToken() {
  return loadToken() !== null;
}

async function fetchWithToken(path, options = {}) {
  const token = loadToken();

  if (!token) {
    throw new Error('No token — supply credentials to re-authenticate.');
  }

  const res = await fetch(`${PROXY_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401) {
    clearToken();
    throw new Error('Session expired. Please log in again.');
  }

  if (!res.ok) {
    throw new Error(`Xert request failed (${res.status}) for ${path}`);
  }

  return res.json();
}

// --- Auth ---

/**
 * authenticate — fetch an OAuth token using password grant.
 * Stores token in localStorage on success.
 *
 * @param {string} username
 * @param {string} password
 * @returns {Promise<string>} access token
 * @throws {Error} on auth failure or network error
 */
export async function authenticate(username, password) {
  const params = new URLSearchParams({
    grant_type:    'password',
    client_id:     'xert_public',
    client_secret: 'xert_public',
    username,
    password,
  });

  const res = await fetch(`${PROXY_BASE}/oauth/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params.toString(),
  });

  const data = await res.json();

  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Auth failed (${res.status})`);
  }

  saveToken(data.access_token);
  return data.access_token;
}

// --- Training info ---

/**
 * fetchTrainingInfo — fetch /oauth/training_info using the stored token.
 * Re-authenticates if token is missing or expired.
 *
 * @param {string} [username] — required only if token is expired
 * @param {string} [password] — required only if token is expired
 * @returns {Promise<object>} training_info payload
 * @throws {Error} if no token available and no credentials supplied
 */
export async function fetchTrainingInfo(username, password) {
  let token = loadToken();

  if (!token) {
    if (!username || !password) {
      throw new Error('No token — supply credentials to re-authenticate.');
    }
    token = await authenticate(username, password);
  }

  const res = await fetch(`${PROXY_BASE}/oauth/training_info`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    // Token rejected — clear it and surface a clean error
    clearToken();
    throw new Error('Session expired. Please log in again.');
  }

  if (!res.ok) {
    throw new Error(`training_info request failed (${res.status})`);
  }

  return res.json();
}

export async function fetchActivitiesInRange(from, to, username, password) {
  let token = loadToken();

  if (!token) {
    if (!username || !password) {
      throw new Error('No token — supply credentials to re-authenticate.');
    }
    token = await authenticate(username, password);
  }

  return fetchWithToken(`/oauth/activity?from=${from}&to=${to}`);
}

export async function fetchActivityDetail(path, username, password) {
  let token = loadToken();

  if (!token) {
    if (!username || !password) {
      throw new Error('No token — supply credentials to re-authenticate.');
    }
    token = await authenticate(username, password);
  }

  return fetchWithToken(`/oauth/activity/${path}`);
}

// --- Data helpers ---

/**
 * parseTrainingData — extract the fields the app needs from a raw training_info response.
 *
 * @param {object} raw — full training_info payload
 * @returns {object}
 */
export function parseTrainingData(raw) {
  return {
    status: raw.status ?? 'Unknown',
    weight: raw.weight ?? null,
    signature: {
      ftp: raw.signature?.ftp ?? null,
      ltp: raw.signature?.ltp ?? null,
      hie: raw.signature?.hie ?? null,
      pp:  raw.signature?.pp  ?? null,
    },
    tl: {
      low:   raw.tl?.low   ?? 0,
      high:  raw.tl?.high  ?? 0,
      peak:  raw.tl?.peak  ?? 0,
      total: raw.tl?.total ?? 0,
    },
    targetXSS: {
      low:   raw.targetXSS?.low   ?? 0,
      high:  raw.targetXSS?.high  ?? 0,
      peak:  raw.targetXSS?.peak  ?? 0,
      total: raw.targetXSS?.total ?? 0,
    },
    wotd: {
      name:        raw.wotd?.name        ?? null,
      difficulty:  raw.wotd?.difficulty  ?? null,
      description: raw.wotd?.description ?? null,
    },
  };
}

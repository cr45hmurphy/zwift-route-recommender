import { authenticate, fetchTrainingInfo, parseTrainingData, clearToken, hasToken } from './xert.js';
import { routes } from './routes.js';
import { filterToAvailableWorlds, todaysWorlds, worldName } from './routes.js';
import { detectBucket, rankRoutes } from './scorer.js';

// ── Constants ─────────────────────────────────────

// Rough XSS generation rate per bucket type (XSS per hour).
// Used only for time-based planning estimates — not precise.
const XSS_RATE = { low: 65, high: 90, peak: 50, recovery: 40 };

// Unit conversion factors (metric is the internal standard; these are display-only)
const KM_TO_MI = 0.621371;
const M_TO_FT  = 3.28084;
const GRAD_TO_IMPERIAL = M_TO_FT / KM_TO_MI; // m/km → ft/mi ≈ 5.28

function getUnits() {
  return localStorage.getItem('units') || 'metric';
}

function getTodayOnly() {
  return localStorage.getItem('today-only') !== 'false';
}

function displayDist(km) {
  return getUnits() === 'imperial'
    ? `${(km * KM_TO_MI).toFixed(1)} mi`
    : `${km.toFixed(1)} km`;
}

function displayElev(m) {
  return getUnits() === 'imperial'
    ? `${Math.round(m * M_TO_FT)} ft`
    : `${m} m`;
}

function displayGrad(mPerKm) {
  return getUnits() === 'imperial'
    ? `${(mPerKm * GRAD_TO_IMPERIAL).toFixed(1)} ft/mi`
    : `${mPerKm} m/km`;
}

// ── State ─────────────────────────────────────────

let state = {
  trainingData:   null,
  bucket:         null,
  bucketOverride: null,
  ranked:         [],
  lastUpdated:    null,
  todayOnly:      true,
};

// ── Init ──────────────────────────────────────────

async function init() {
  const ts = localStorage.getItem('xert_last_updated');
  if (ts) state.lastUpdated = new Date(parseInt(ts, 10));

  // Restore saved unit preference (updates button state + speed label without re-rendering)
  const savedUnit = getUnits();
  document.getElementById('units-metric').classList.toggle('active', savedUnit === 'metric');
  document.getElementById('units-imperial').classList.toggle('active', savedUnit === 'imperial');
  document.getElementById('speed-unit-label').textContent = savedUnit === 'imperial' ? 'mph' : 'km/h';
  if (savedUnit === 'imperial') {
    const speedInput = document.getElementById('avg-speed');
    speedInput.value = Math.round(parseFloat(speedInput.value) * KM_TO_MI);
  }

  state.todayOnly = getTodayOnly();
  document.getElementById('today-only-toggle').checked = state.todayOnly;
  const worlds = [...todaysWorlds()].map(worldName).join(' · ');
  document.getElementById('today-worlds-label').textContent = worlds;

  if (hasToken()) {
    showApp();
    await refresh();
  } else {
    showAuth();
  }
}

// ── Auth ──────────────────────────────────────────

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl    = document.getElementById('auth-error');
  const btn      = document.getElementById('auth-btn');

  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Signing in…';

  try {
    await authenticate(username, password);
    // Store credentials for refresh
    document.getElementById('settings-username').value = username;
    document.getElementById('settings-password').value = password;
    showApp();
    await refresh(username, password);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
}

async function handleRefresh() {
  const username = document.getElementById('settings-username').value.trim();
  const password = document.getElementById('settings-password').value;
  await refresh(username || undefined, password || undefined);
}

async function handleLogout() {
  clearToken();
  state = {
    trainingData:   null,
    bucket:         null,
    bucketOverride: null,
    ranked:         [],
    lastUpdated:    null,
    todayOnly:      getTodayOnly(),
  };
  showAuth();
}

// ── Data ──────────────────────────────────────────

async function refresh(username, password) {
  setLoading(true);
  hideError();

  try {
    const raw        = await fetchTrainingInfo(username, password);
    state.trainingData = parseTrainingData(raw);
    const rawBucket = detectBucket(state.trainingData.tl, state.trainingData.targetXSS);
    const { bucket, overrideNote } = applyFreshnessOverride(rawBucket, state.trainingData.status);
    state.bucket = bucket;
    state.bucketOverride = overrideNote;
    const eligibleRoutes = state.todayOnly ? filterToAvailableWorlds(routes) : routes;
    state.ranked = rankRoutes(eligibleRoutes, state.bucket);
    state.lastUpdated  = new Date();
    localStorage.setItem('xert_last_updated', Date.now().toString());
    renderAll();
  } catch (err) {
    if (err.message.includes('Session expired') || err.message.includes('No token')) {
      showAuth('Session expired. Please sign in again.');
    } else {
      showError(err.message);
    }
  } finally {
    setLoading(false);
  }
}

// ── Render ────────────────────────────────────────

function renderAll() {
  renderStatus();
  renderRecommendation();
  renderTimeSummary();
  renderRoutes();
  renderLastUpdated();
}

function renderStatus() {
  const d = state.trainingData;

  // Freshness badge
  const badge    = document.getElementById('freshness-badge');
  badge.textContent = d.status;
  badge.className   = 'freshness-badge ' + freshnessClass(d.status);

  // Meta pills
  document.getElementById('stat-ftp').textContent    = `${Math.round(d.signature.ftp)} W`;
  document.getElementById('stat-weight').textContent = `${d.weight ? d.weight.toFixed(1) : '—'} kg`;

  // Bucket bars
  renderBucketBar('low',  d.tl.low,  d.targetXSS.low,  state.bucket === 'low');
  renderBucketBar('high', d.tl.high, d.targetXSS.high, state.bucket === 'high');
  renderBucketBar('peak', d.tl.peak, d.targetXSS.peak, state.bucket === 'peak');
}

function renderBucketBar(name, current, target, highlighted) {
  const pct    = target > 0 ? Math.min(current / target * 100, 100) : 100;
  const deficit = target - current;

  document.getElementById(`bar-fill-${name}`).style.width = `${pct.toFixed(1)}%`;
  document.getElementById(`bar-fill-${name}`).classList.toggle('highlighted', highlighted);
  document.getElementById(`bar-label-${name}`).classList.toggle('highlighted', highlighted);

  const valEl = document.getElementById(`bar-values-${name}`);
  valEl.title = 'Training load vs daily target';
  valEl.innerHTML = `TL ${current.toFixed(1)} · ${target.toFixed(1)}`;
  if (deficit > 0) {
    valEl.innerHTML += ` <span class="deficit">−${deficit.toFixed(1)}</span>`;
  }
}

function renderRecommendation() {
  const d = state.trainingData;
  const b = state.bucket;

  const titles = {
    low:      'Your aerobic base needs work',
    high:     'Your high intensity bucket needs work',
    peak:     'Your peak power bucket needs work',
    recovery: 'You\'re on top of all your targets',
  };

  const subtitles = {
    low:      `Your aerobic training load is ${(d.targetXSS.low - d.tl.low).toFixed(1)} XSS below your daily target — a long flat ride will help.`,
    high:     `Your threshold training load is ${(d.targetXSS.high - d.tl.high).toFixed(1)} XSS below your daily target — a climbing route will help.`,
    peak:     `Your peak power training load is ${(d.targetXSS.peak - d.tl.peak).toFixed(1)} XSS below your daily target — a short punchy route will help.`,
    recovery: 'All buckets at or above target. Take it easy — flat and short today.',
  };

  document.getElementById('rec-title').textContent    = titles[b]    ?? '';
  document.getElementById('rec-subtitle').textContent = subtitles[b] ?? '';

  const wotdEl = document.getElementById('wotd');
  if (d.wotd.name) {
    wotdEl.style.display = 'block';
    wotdEl.innerHTML = `<strong>Workout of the Day:</strong> ${d.wotd.name}` +
      (d.wotd.difficulty ? ` — difficulty ${d.wotd.difficulty}` : '') +
      (d.wotd.description ? `<br>${d.wotd.description}` : '');
  } else {
    wotdEl.style.display = 'none';
  }

  const overrideEl = document.getElementById('override-note');
  if (state.bucketOverride) {
    overrideEl.textContent = state.bucketOverride;
    overrideEl.style.display = 'block';
  } else {
    overrideEl.style.display = 'none';
  }
}

function renderRoutes() {
  const { minutes: timeMin, speed } = getTimeSettings();

  const withinBudget = state.ranked.filter(r => estimateRouteMinutes(r, speed) <= timeMin);
  const overBudget   = state.ranked
    .filter(r => estimateRouteMinutes(r, speed) > timeMin)
    .sort((a, b) => estimateRouteMinutes(a, speed) - estimateRouteMinutes(b, speed));

  // Primary grid: top 5 within budget
  document.getElementById('route-grid').innerHTML =
    withinBudget.slice(0, 5).map(r => routeCardHTML(r, false)).join('') ||
    '<p class="no-routes">No routes fit your time budget — check the "If you had more time" section below.</p>';

  // Other options: within-budget overflow
  const otherList = document.getElementById('other-list');
  otherList.innerHTML = withinBudget.slice(5).map(r => routeCardHTML(r, true)).join('');
  document.getElementById('other-toggle').textContent =
    `▼ Other options (${withinBudget.slice(5).length} more)`;
  document.getElementById('other-options').style.display =
    withinBudget.length > 5 ? 'block' : 'none';

  // "If you had more time": over-budget routes
  const moreSection = document.getElementById('more-time-options');
  const moreList    = document.getElementById('more-time-list');
  moreList.innerHTML = overBudget.map(r => routeCardHTML(r, true)).join('');
  moreSection.style.display = overBudget.length ? 'block' : 'none';
  document.getElementById('more-time-toggle').textContent =
    `▼ If you had more time (${overBudget.length} routes)`;
}

function routeCardHTML(route, compact) {
  const gr    = route.distance > 0 ? (route.elevation / route.distance).toFixed(1) : '—';
  const world = worldName(route.world);
  const reason = routeReason(route, state.bucket);

  const { minutes: timeMin, speed } = getTimeSettings();
  const estMin  = estimateRouteMinutes(route, speed);
  const overTime = estMin > timeMin;
  const overBy   = estMin - timeMin;

  const timeTag = overTime
    ? `<span class="time-tag over-time">~${formatMinutes(estMin)} · +${formatMinutes(overBy)} over</span>`
    : `<span class="time-tag fits-time">~${formatMinutes(estMin)}</span>`;

  const b = state.bucket;
  const targetXss = (state.trainingData && b !== 'recovery') ? state.trainingData.targetXSS[b] : null;
  const fillPct = targetXss ? Math.round((XSS_RATE[b] * estMin / 60) / targetXss * 100) : null;
  const fillTag = fillPct !== null
    ? `<span class="xss-fill">~${fillPct}% ${b} target</span>`
    : '';

  const cls = compact ? 'route-card compact' : 'route-card';

  const links = [
    route.zwiftInsiderUrl ? `<a href="${route.zwiftInsiderUrl}" target="_blank" rel="noopener">ZwiftInsider</a>` : '',
    route.whatsOnZwiftUrl ? `<a href="${route.whatsOnZwiftUrl}" target="_blank" rel="noopener">What's on Zwift</a>` : '',
  ].filter(Boolean).join('');

  return `
    <div class="${cls}">
      <div class="route-card-header">
        <span class="route-world">${world}</span>
        <span class="route-score">${route.score}</span>
      </div>
      <div class="route-name">${route.name}</div>
      <div class="route-stats">
        <span class="route-stat">${displayDist(route.distance)}</span>
        <span class="route-stat">${displayElev(route.elevation)}</span>
        <span class="gradient-badge">${displayGrad(parseFloat(gr))}</span>
        ${timeTag}
        ${fillTag}
      </div>
      ${reason ? `<div class="route-reason">${reason}</div>` : ''}
      ${links ? `<div class="route-links">${links}</div>` : ''}
    </div>`;
}

function routeReason(route, bucket) {
  const gr = route.distance > 0 ? route.elevation / route.distance : 0;

  if (bucket === 'recovery') {
    return route.distance < 20 ? 'Short and easy — good recovery spin' : 'Gentle endurance — active recovery';
  }
  if (bucket === 'low') {
    if (route.distance >= 40) return 'Long ride builds aerobic base';
    if (gr < 5)               return 'Flat roads keep you in the endurance zone';
    return 'Steady aerobic effort';
  }
  if (bucket === 'high') {
    if (route.elevation >= 800) return 'Big climbing volume for sustained threshold work';
    if (gr >= 8 && gr <= 25)    return 'Sustained gradients target your HIE system';
    return 'Good mix of distance and climbing for threshold';
  }
  if (bucket === 'peak') {
    if (gr >= 30)         return 'Steep, punchy gradients target peak power';
    if (route.distance < 10) return 'Short explosive effort for neuromuscular work';
    return 'High gradient ratio for PP development';
  }
  return '';
}

function getTimeSettings() {
  const minutes    = parseInt(document.getElementById('time-available')?.value || '60', 10);
  const rawSpeed   = parseFloat(document.getElementById('avg-speed')?.value || '28');
  // Internal calculations always use km/h; convert from mph if user is in imperial
  const speed = getUnits() === 'imperial' ? rawSpeed / KM_TO_MI : rawSpeed;
  return { minutes, speed };
}

function estimateRouteMinutes(route, speedKmh) {
  const baseMin  = (route.distance / speedKmh) * 60;
  const climbMin = (route.elevation / 600) * 60; // rough: 600m elevation added per hour
  return Math.round(baseMin + climbMin);
}

function formatMinutes(min) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function renderTimeSummary() {
  if (!state.trainingData) return;
  const d = state.trainingData;
  const b = state.bucket;
  const { minutes: timeMin } = getTimeSettings();

  const xssRate      = XSS_RATE[b] ?? 65;
  const estimatedXss = Math.round((timeMin / 60) * xssRate);
  const targetXss    = (b !== 'recovery') ? d.targetXSS[b] : null;

  const el = document.getElementById('time-summary');
  if (!el) return;

  if (b === 'recovery' || !targetXss) {
    el.textContent = `With ${timeMin} min available, an easy spin is plenty today.`;
  } else {
    const fillPct = Math.round(estimatedXss / targetXss * 100);
    el.textContent =
      `With ${timeMin} min at your pace, you'd generate roughly ${estimatedXss} XSS` +
      ` — about ${fillPct}% of your ${targetXss.toFixed(0)} ${b} target.`;
  }
}

function renderLastUpdated() {
  const el = document.getElementById('last-updated');
  if (!state.lastUpdated) { el.textContent = ''; return; }
  el.textContent = `Updated ${state.lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

// ── UI helpers ────────────────────────────────────

function showAuth(message) {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').classList.remove('visible');
  if (message) {
    const errEl = document.getElementById('auth-error');
    errEl.textContent = message;
    errEl.style.display = 'block';
  }
}

function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').classList.add('visible');
}

function setLoading(on) {
  const el = document.getElementById('loading');
  el.style.display = on ? 'block' : 'none';
}

function showError(msg) {
  const el = document.getElementById('app-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideError() {
  document.getElementById('app-error').style.display = 'none';
}

function applyUnits(unit) {
  localStorage.setItem('units', unit);
  document.getElementById('units-metric').classList.toggle('active', unit === 'metric');
  document.getElementById('units-imperial').classList.toggle('active', unit === 'imperial');
  document.getElementById('speed-unit-label').textContent = unit === 'imperial' ? 'mph' : 'km/h';

  // Convert the displayed speed value between units
  const speedInput  = document.getElementById('avg-speed');
  const currentVal  = parseFloat(speedInput.value);
  if (unit === 'imperial') {
    speedInput.value = Math.round(currentVal * KM_TO_MI);
  } else {
    speedInput.value = Math.round(currentVal / KM_TO_MI);
  }

  if (state.trainingData) renderRoutes();
}

function freshnessClass(status) {
  const s = (status ?? '').toLowerCase();
  if (s.includes('very tired') || s.includes('detrain')) return 'very-tired';
  if (s.includes('tired'))  return 'tired';
  return 'fresh';
}

function applyFreshnessOverride(bucket, status) {
  const s = (status ?? '').toLowerCase();
  if (s.includes('very tired') || s.includes('detrain')) {
    return { bucket: 'recovery', overrideNote: `Your Xert status is "${status}" — overriding to Recovery. Rest up.` };
  }
  if (s.includes('tired') && bucket !== 'recovery') {
    return { bucket: 'recovery', overrideNote: `Your Xert status is "${status}" — biasing toward easier routes today.` };
  }
  return { bucket, overrideNote: null };
}

// ── Event wiring ──────────────────────────────────

document.getElementById('auth-form').addEventListener('submit', handleLogin);
document.getElementById('refresh-btn').addEventListener('click', handleRefresh);
document.getElementById('logout-btn').addEventListener('click', handleLogout);

document.getElementById('time-available').addEventListener('input', () => {
  const val = document.getElementById('time-available').value;
  document.getElementById('time-label').textContent = `${val} min`;
  if (state.trainingData) { renderTimeSummary(); renderRoutes(); }
});

document.getElementById('avg-speed').addEventListener('change', () => {
  if (state.trainingData) renderRoutes();
});

document.getElementById('today-only-toggle').addEventListener('change', (e) => {
  state.todayOnly = e.target.checked;
  localStorage.setItem('today-only', state.todayOnly);
  if (state.trainingData) {
    const eligibleRoutes = state.todayOnly ? filterToAvailableWorlds(routes) : routes;
    state.ranked = rankRoutes(eligibleRoutes, state.bucket);
    renderRoutes();
  }
});

document.getElementById('other-toggle').addEventListener('click', () => {
  const list   = document.getElementById('other-list');
  const toggle = document.getElementById('other-toggle');
  const open   = list.classList.toggle('open');
  const count  = list.children.length;
  toggle.textContent = `${open ? '▲' : '▼'} Other options (${count} more)`;
});

document.getElementById('more-time-toggle').addEventListener('click', () => {
  const list   = document.getElementById('more-time-list');
  const toggle = document.getElementById('more-time-toggle');
  const open   = list.classList.toggle('open');
  const count  = list.children.length;
  toggle.textContent = `${open ? '▲' : '▼'} If you had more time (${count} routes)`;
});

document.getElementById('units-metric').addEventListener('click', () => applyUnits('metric'));
document.getElementById('units-imperial').addEventListener('click', () => applyUnits('imperial'));

init();

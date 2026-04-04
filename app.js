import { authenticate, fetchTrainingInfo, parseTrainingData, clearToken, hasToken } from './xert.js';
import { routes } from './routes.js';
import { worldName } from './routes.js';
import { detectBucket, rankRoutes } from './scorer.js';

// ── State ─────────────────────────────────────────

let state = {
  trainingData: null,
  bucket:       null,
  ranked:       [],
  lastUpdated:  null,
};

// ── Init ──────────────────────────────────────────

async function init() {
  const ts = localStorage.getItem('xert_last_updated');
  if (ts) state.lastUpdated = new Date(parseInt(ts, 10));

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
  state = { trainingData: null, bucket: null, ranked: [], lastUpdated: null };
  showAuth();
}

// ── Data ──────────────────────────────────────────

async function refresh(username, password) {
  setLoading(true);
  hideError();

  try {
    const raw        = await fetchTrainingInfo(username, password);
    state.trainingData = parseTrainingData(raw);
    state.bucket       = detectBucket(state.trainingData.tl, state.trainingData.targetXSS);
    state.ranked       = rankRoutes(routes, state.bucket);
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
  valEl.innerHTML = `${current.toFixed(1)} / ${target.toFixed(1)}`;
  if (deficit > 0) {
    valEl.innerHTML += ` <span class="deficit">-${deficit.toFixed(1)}</span>`;
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
    low:      `You're ${(d.targetXSS.low - d.tl.low).toFixed(1)} XSS short of your aerobic target — a long flat ride will help.`,
    high:     `You're ${(d.targetXSS.high - d.tl.high).toFixed(1)} XSS short of your threshold target — a climbing route will help.`,
    peak:     `You're ${(d.targetXSS.peak - d.tl.peak).toFixed(1)} XSS short of your peak power target — a short punchy route will help.`,
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
}

function renderRoutes() {
  const top5  = state.ranked.slice(0, 5);
  const other = state.ranked.slice(5, 15);

  document.getElementById('route-grid').innerHTML = top5.map(r => routeCardHTML(r, false)).join('');

  const otherList = document.getElementById('other-list');
  otherList.innerHTML = other.map(r => routeCardHTML(r, true)).join('');

  const toggle = document.getElementById('other-toggle');
  toggle.textContent = `▼ Other options (${other.length} more)`;
}

function routeCardHTML(route, compact) {
  const gr    = route.distance > 0 ? (route.elevation / route.distance).toFixed(1) : '—';
  const world = worldName(route.world);
  const reason = routeReason(route, state.bucket);
  const cls   = compact ? 'route-card compact' : 'route-card';

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
        <span class="route-stat"><strong>${route.distance.toFixed(1)}</strong> km</span>
        <span class="route-stat"><strong>${route.elevation}</strong> m</span>
        <span class="gradient-badge">${gr} m/km</span>
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

function freshnessClass(status) {
  const s = (status ?? '').toLowerCase();
  if (s.includes('very tired') || s.includes('detrain')) return 'very-tired';
  if (s.includes('tired'))  return 'tired';
  return 'fresh';
}

// ── Event wiring ──────────────────────────────────

document.getElementById('auth-form').addEventListener('submit', handleLogin);
document.getElementById('refresh-btn').addEventListener('click', handleRefresh);
document.getElementById('logout-btn').addEventListener('click', handleLogout);
document.getElementById('other-toggle').addEventListener('click', () => {
  const list   = document.getElementById('other-list');
  const toggle = document.getElementById('other-toggle');
  const open   = list.classList.toggle('open');
  toggle.textContent = `${open ? '▲' : '▼'} Other options (${state.ranked.slice(5).length} more)`;
});

init();

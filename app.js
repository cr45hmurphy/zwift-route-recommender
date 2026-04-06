import { authenticate, fetchTrainingInfo, fetchActivitiesInRange, fetchActivityDetail, parseTrainingData, clearToken, hasToken } from './xert.js';
import { routes } from './routes.js';
import { filterToAvailableWorlds, todaysWorlds, worldName } from './routes.js';
import { getSegmentsForRoute } from './segments.js';
import { analyzeTrainingDay, generateRideCue, rankRoutes } from './scorer.js';

// ── Constants ─────────────────────────────────────

// Rough XSS generation rate per bucket type (XSS per hour).
// Used only for time-based planning estimates — not precise.
const XSS_RATE = { low: 65, high: 90, peak: 50, recovery: 40 };
const DEFAULT_SPEED_KMH = 28;
const TIMING_MODE_KEY = 'timing-mode';
const HISTORY_KEY = 'xert_history';
const HISTORY_LIMIT = 10;

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

function getTimingMode() {
  return localStorage.getItem(TIMING_MODE_KEY) === 'manual' ? 'manual' : 'auto';
}

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];

    const normalized = normalizeHistory(parsed);
    saveHistory(normalized);
    return normalized;
  } catch {
    return [];
  }
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_LIMIT)));
}

function normalizeHistory(history) {
  const byDay = new Map();

  for (const entry of history) {
    if (!entry || typeof entry !== 'object') continue;
    const ts = Number(entry.ts);
    if (!Number.isFinite(ts)) continue;

    const normalized = {
      ...entry,
      ts,
      dayKey: entry.dayKey || getLocalDayKey(ts),
    };

    const existing = byDay.get(normalized.dayKey);
    if (!existing || normalized.ts >= existing.ts) {
      byDay.set(normalized.dayKey, normalized);
    }
  }

  return [...byDay.values()]
    .sort((a, b) => a.ts - b.ts)
    .slice(-HISTORY_LIMIT);
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

function displaySpeed(kmh) {
  return getUnits() === 'imperial'
    ? `${Math.round(kmh * KM_TO_MI)} mph`
    : `${Math.round(kmh)} km/h`;
}

// ── State ─────────────────────────────────────────

let state = {
  trainingData:   null,
  rawWotd:        null,
  dailySummary:   null,
  bucket:         null,
  bucketOverride: null,
  wotdStructure:  'recovery',
  history:        [],
  ranked:         [],
  lastUpdated:    null,
  timingMode:     'auto',
  todayOnly:      true,
};

// ── Init ──────────────────────────────────────────

async function init() {
  const ts = localStorage.getItem('xert_last_updated');
  if (ts) state.lastUpdated = new Date(parseInt(ts, 10));
  state.history = loadHistory();
  state.timingMode = getTimingMode();

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
  renderTimingControls();

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
    rawWotd:        null,
    dailySummary:   null,
    bucket:         null,
    bucketOverride: null,
    wotdStructure:  'recovery',
    history:        loadHistory(),
    ranked:         [],
    lastUpdated:    null,
    timingMode:     getTimingMode(),
    todayOnly:      getTodayOnly(),
  };
  showAuth();
}

// ── Data ──────────────────────────────────────────

async function refresh(username, password) {
  setLoading(true);
  hideError();

  try {
    const raw = await fetchTrainingInfo(username, password);
    state.trainingData = parseTrainingData(raw);
    state.rawWotd = raw?.wotd ?? null;
    const dailySummary = await fetchTodaysDailySummary(state.trainingData.targetXSS, username, password);
    state.dailySummary = dailySummary;
    const { bucket: analyzedBucket, wotdStructure } = analyzeTrainingDay(
      state.dailySummary.completed,
      state.dailySummary.targets,
      state.rawWotd
    );
    state.wotdStructure = wotdStructure;
    const { bucket, overrideNote } = applyFreshnessOverride(analyzedBucket, state.trainingData.status);
    state.bucket = bucket;
    state.bucketOverride = overrideNote;
    const eligibleRoutes = state.todayOnly ? filterToAvailableWorlds(routes) : routes;
    state.ranked = enrichRoutes(rankRoutes(eligibleRoutes, state.bucket), state.bucket, state.wotdStructure);
    const now = Date.now();
    state.lastUpdated = new Date(now);
    state.history = recordHistorySnapshot(state.trainingData, now);
    localStorage.setItem('xert_last_updated', now.toString());
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
  renderHistory();
  renderRecommendation();
  renderTimingControls();
  renderTimeSummary();
  renderRoutes();
  renderLastUpdated();
}

function renderStatus() {
  const d = state.trainingData;
  const summary = state.dailySummary;

  // Freshness badge
  const badge    = document.getElementById('freshness-badge');
  badge.textContent = d.status;
  badge.className   = 'freshness-badge ' + freshnessClass(d.status);

  // Meta pills
  document.getElementById('stat-ftp').textContent    = d.signature.ftp ? `${Math.round(d.signature.ftp)} W` : '—';
  document.getElementById('stat-weight').textContent = `${d.weight ? d.weight.toFixed(1) : '—'} kg`;
  const riderWkg = getRiderWkg(d);
  document.getElementById('stat-wkg').textContent = riderWkg ? riderWkg.toFixed(1) : '—';

  // Bucket bars
  renderBucketBar('low',  summary.completed.low,  summary.targets.low,  summary.remaining.low,  state.bucket === 'low');
  renderBucketBar('high', summary.completed.high, summary.targets.high, summary.remaining.high, state.bucket === 'high');
  renderBucketBar('peak', summary.completed.peak, summary.targets.peak, summary.remaining.peak, state.bucket === 'peak');
}

function renderHistory() {
  const chartEl = document.getElementById('history-chart');
  const captionEl = document.getElementById('history-caption');
  const history = state.history ?? [];

  if (history.length < 2) {
    captionEl.textContent = history.length === 1 ? '1 saved day' : 'No saved days';
    chartEl.innerHTML = '<div class="history-empty">Recent Progress shows a trend once there are at least two saved days. Right now it is keeping one snapshot per day and updating today when you refresh again.</div>';
    return;
  }

  captionEl.textContent = `Last ${history.length} days`;
  chartEl.innerHTML = ['low', 'high', 'peak'].map(bucket => historyRowHTML(bucket, history)).join('');
}

function historyRowHTML(bucket, history) {
  const values = history.map(snapshot => snapshot.completed?.[bucket] ?? 0);
  const targets = history.map(snapshot => snapshot.targets?.[bucket] ?? 0);
  const current = values.at(-1) ?? 0;
  const first = values[0] ?? 0;
  const target = targets.at(-1) ?? 0;
  const delta = current - first;
  const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
  const columns = values.map((value, index) => {
    const rawTarget = targets[index] ?? 0;
    const fillHeight = rawTarget > 0
      ? Math.max(8, Math.min((value / rawTarget) * 100, 100))
      : value > 0
        ? 100
        : 0;
    const currentClass = index === values.length - 1 ? ' is-current' : '';
    return `
      <span class="history-day${currentClass}">
        <span class="history-target-track"></span>
        <span class="history-fill ${bucket}" style="height:${fillHeight}%"></span>
      </span>`;
  }).join('');

  return `
    <div class="history-row">
      <span class="history-label ${bucket}">${bucket}</span>
      <div class="history-spark">${columns}</div>
      <span class="history-trend">${current.toFixed(1)} / ${target.toFixed(1)} · ${arrow} ${Math.abs(delta).toFixed(1)}</span>
    </div>`;
}

function renderBucketBar(name, completed, target, remaining, highlighted) {
  const current = completed;
  const pct    = target > 0 ? Math.min(current / target * 100, 100) : 100;

  document.getElementById(`bar-fill-${name}`).style.width = `${pct.toFixed(1)}%`;
  document.getElementById(`bar-fill-${name}`).classList.toggle('highlighted', highlighted);
  document.getElementById(`bar-label-${name}`).classList.toggle('highlighted', highlighted);

  const valEl = document.getElementById(`bar-values-${name}`);
  valEl.title = 'Completed vs daily target';
  valEl.innerHTML = `${current.toFixed(1)} / ${target.toFixed(1)}`;
  if (remaining > 0) {
    valEl.innerHTML += ` <span class="deficit">${remaining.toFixed(1)} left</span>`;
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
    low:      `You still have ${state.dailySummary.remaining.low.toFixed(1)} low XSS left today — a long flat ride will help.`,
    high:     `You still have ${state.dailySummary.remaining.high.toFixed(1)} high XSS left today — a climbing route will help.`,
    peak:     `You still have ${state.dailySummary.remaining.peak.toFixed(1)} peak XSS left today — a short punchy route will help.`,
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

function enrichRoutes(rankedRoutes, bucket, wotdStructure) {
  return rankedRoutes.map(route => {
    const routeSegments = getSegmentsForRoute(route);
    return {
      ...route,
      rideCue: generateRideCue(route, bucket, wotdStructure, routeSegments),
      relevantClimbs: routeSegments.climbs.slice(0, 3),
      relevantSprints: routeSegments.sprints,
      segmentSource: routeSegments.source,
    };
  });
}

function renderRoutes() {
  const settings = getTimeSettings();
  const { minutes: timeMin } = settings;

  const withinBudget = state.ranked.filter(r => estimateRouteMinutes(r, settings, state.trainingData) <= timeMin);
  const overBudget   = state.ranked
    .filter(r => estimateRouteMinutes(r, settings, state.trainingData) > timeMin)
    .sort((a, b) => estimateRouteMinutes(a, settings, state.trainingData) - estimateRouteMinutes(b, settings, state.trainingData));

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

  const settings = getTimeSettings();
  const { minutes: timeMin } = settings;
  const estMin  = estimateRouteMinutes(route, settings, state.trainingData);
  const overTime = estMin > timeMin;
  const overBy   = estMin - timeMin;

  const timeTag = overTime
    ? `<span class="time-tag over-time">~${formatMinutes(estMin)} · +${formatMinutes(overBy)} over</span>`
    : `<span class="time-tag fits-time">~${formatMinutes(estMin)}</span>`;

  const b = state.bucket;
  const remainingXss = (state.dailySummary && b !== 'recovery') ? state.dailySummary.remaining[b] : null;
  const estimatedBucketXss = estimateBucketImpactXss(estMin, b);
  const fillPct = remainingXss ? Math.min(Math.round(estimatedBucketXss / Math.max(remainingXss, 1) * 100), 100) : null;
  const fillTag = fillPct !== null
    ? `<span class="xss-fill">~${fillPct}% of ${b} left</span>`
    : '';
  const impactTag = b === 'recovery'
    ? '<span class="route-impact recovery">Recovery-friendly</span>'
    : `<span class="route-impact">${estimatedBucketXss} XSS toward ${b}</span>`;
  const matchTag = b === 'recovery'
    ? '<span class="route-match">Recovery day</span>'
    : `<span class="route-match">Best for ${b} remaining</span>`;

  const cls = compact ? 'route-card compact' : 'route-card';

  const links = [
    route.zwiftInsiderUrl ? `<a href="${route.zwiftInsiderUrl}" target="_blank" rel="noopener">ZwiftInsider</a>` : '',
    route.whatsOnZwiftUrl ? `<a href="${route.whatsOnZwiftUrl}" target="_blank" rel="noopener">What's on Zwift</a>` : '',
  ].filter(Boolean).join('');
  const showSegmentRow = route.segmentSource !== 'world';
  const segmentItems = [
    ...(route.relevantClimbs ?? []).map(segment => segmentChipHTML(segment, 'climb')),
    ...(route.relevantSprints ?? []).map(segment => segmentChipHTML(segment, 'sprint')),
  ].join('');

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
        ${impactTag}
        ${matchTag}
      </div>
      ${route.rideCue ? `<div class="ride-cue"><span class="ride-cue-icon">🎯</span><span>${route.rideCue}</span></div>` : ''}
      ${showSegmentRow && segmentItems ? `
        <div class="segment-row">
          <span class="segment-label">Segments on this route:</span>
          <div class="segment-chips">${segmentItems}</div>
        </div>` : ''}
      ${reason ? `<div class="route-reason">${reason}</div>` : ''}
      ${links ? `<div class="route-links">${links}</div>` : ''}
    </div>`;
}

function segmentChipHTML(segment, kind) {
  const cls = `segment-chip ${kind}`;
  if (segment.stravaSegmentUrl) {
    return `<a class="${cls}" href="${segment.stravaSegmentUrl}" target="_blank" rel="noopener">${segment.name}</a>`;
  }
  return `<span class="${cls}">${segment.name}</span>`;
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
  const rawSpeed   = parseFloat(document.getElementById('avg-speed')?.value || `${DEFAULT_SPEED_KMH}`);
  // Internal calculations always use km/h; convert from mph if user is in imperial
  const speed = getUnits() === 'imperial' ? rawSpeed / KM_TO_MI : rawSpeed;
  return { minutes, mode: state.timingMode, speed };
}

function estimateRouteMinutesManual(route, speedKmh) {
  const baseMin  = (route.distance / Math.max(speedKmh, 1)) * 60;
  const climbMin = (route.elevation / 600) * 60; // rough: 600m elevation added per hour
  return Math.round(baseMin + climbMin);
}

function estimateRouteMinutesAuto(route, trainingData) {
  const riderWkg = getRiderWkg(trainingData);
  if (!riderWkg) return estimateRouteMinutesManual(route, DEFAULT_SPEED_KMH);

  const flatSpeed = estimateFlatSpeedKmh(riderWkg);
  const gradientRatio = route.distance > 0 ? route.elevation / route.distance : 0;
  const slowdown = clamp(1 - gradientRatio / (58 + riderWkg * 10), 0.42, 1);
  const effectiveSpeed = flatSpeed * slowdown;
  return Math.round((route.distance / effectiveSpeed) * 60);
}

function estimateRouteMinutes(route, settings, trainingData) {
  if (settings.mode === 'manual') {
    return estimateRouteMinutesManual(route, settings.speed);
  }
  return estimateRouteMinutesAuto(route, trainingData);
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
  const { minutes: timeMin, mode } = getTimeSettings();

  const xssRate      = XSS_RATE[b] ?? 65;
  const estimatedXss = Math.round((timeMin / 60) * xssRate);
  const remainingXss = (b !== 'recovery') ? state.dailySummary.remaining[b] : null;
  const riderWkg = getRiderWkg(d);
  const timingLead = mode === 'manual'
    ? 'Using your manual pace, '
    : riderWkg
      ? `Using your ${riderWkg.toFixed(1)} W/kg profile, `
      : `Using a default ${displaySpeed(DEFAULT_SPEED_KMH)} pace, `;

  const el = document.getElementById('time-summary');
  if (!el) return;

  if (b === 'recovery' || !remainingXss) {
    el.textContent = `${timingLead}with ${timeMin} min available, an easy spin is plenty today.`;
  } else {
    const fillPct = Math.min(Math.round(estimatedXss / Math.max(remainingXss, 1) * 100), 100);
    el.textContent =
      `${timingLead}${timeMin} min should generate roughly ${estimatedXss} XSS` +
      ` — about ${fillPct}% of your ${remainingXss.toFixed(0)} remaining ${b} target.`;
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

  renderTimingControls();
  if (state.trainingData) {
    renderTimeSummary();
    renderRoutes();
  }
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

function setTimingMode(mode) {
  state.timingMode = mode === 'manual' ? 'manual' : 'auto';
  localStorage.setItem(TIMING_MODE_KEY, state.timingMode);
  renderTimingControls();
  if (state.trainingData) {
    renderTimeSummary();
    renderRoutes();
  }
}

function renderTimingControls() {
  const autoBtn = document.getElementById('timing-auto');
  const manualBtn = document.getElementById('timing-manual');
  const manualRow = document.getElementById('manual-speed-row');
  const hintEl = document.getElementById('timing-hint');
  const auto = state.timingMode === 'auto';

  autoBtn.classList.toggle('active', auto);
  manualBtn.classList.toggle('active', !auto);
  manualRow.style.display = auto ? 'none' : 'flex';

  if (auto) {
    const riderWkg = getRiderWkg(state.trainingData);
    if (riderWkg) {
      hintEl.textContent = `${riderWkg.toFixed(1)} W/kg profile · ~${displaySpeed(estimateFlatSpeedKmh(riderWkg))} flat pace`;
    } else {
      hintEl.textContent = `Uses FTP and weight after refresh; falls back to ${displaySpeed(DEFAULT_SPEED_KMH)} if unavailable.`;
    }
  } else {
    hintEl.textContent = 'Manual pace override for route time estimates.';
  }
}

function getRiderWkg(trainingData) {
  const ftp = trainingData?.signature?.ftp;
  const weight = trainingData?.weight;
  if (!ftp || !weight) return null;
  return ftp / weight;
}

function estimateFlatSpeedKmh(riderWkg) {
  return clamp(18 + riderWkg * 4.5, 18, 40);
}

function estimateBucketImpactXss(minutes, bucket) {
  return Math.round((minutes / 60) * (XSS_RATE[bucket] ?? 0));
}

function buildHistorySnapshot(trainingData, ts) {
  return {
    ts,
    dayKey: getLocalDayKey(ts),
    status: trainingData.status,
    ftp: trainingData.signature.ftp,
    weight: trainingData.weight,
    completed: state.dailySummary?.completed ?? null,
    remaining: state.dailySummary?.remaining ?? null,
    targets: state.dailySummary?.targets ?? null,
  };
}

function getLocalDayKey(ts) {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function snapshotSignature(snapshot) {
  return JSON.stringify({
    status: snapshot.status,
    ftp: snapshot.ftp,
    weight: snapshot.weight,
    completed: snapshot.completed,
    remaining: snapshot.remaining,
    targets: snapshot.targets,
  });
}

function recordHistorySnapshot(trainingData, ts) {
  const history = loadHistory();
  const snapshot = buildHistorySnapshot(trainingData, ts);
  const existingIndex = history.findIndex(entry => entry.dayKey === snapshot.dayKey);

  if (existingIndex >= 0) {
    history[existingIndex] = snapshot;
  } else {
    history.push(snapshot);
  }

  const trimmed = history.slice(-HISTORY_LIMIT);
  saveHistory(trimmed);
  return trimmed;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getTodayRangeLocal() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  return {
    from: Math.floor(start.getTime() / 1000),
    to: Math.floor(end.getTime() / 1000),
  };
}

async function fetchTodaysDailySummary(targetXSS, username, password) {
  const { from, to } = getTodayRangeLocal();
  const list = await fetchActivitiesInRange(from, to, username, password);
  const activities = Array.isArray(list.activities) ? list.activities : [];

  const detailResults = await Promise.allSettled(
    activities
      .filter(activity => activity?.path)
      .map(activity => fetchActivityDetail(activity.path, username, password))
  );
  const details = detailResults
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value);

  const completed = {
    low: 0,
    high: 0,
    peak: 0,
    total: 0,
  };

  for (const detail of details) {
    const summary = detail?.summary;
    completed.low += summary?.xlss ?? 0;
    completed.high += summary?.xhss ?? 0;
    completed.peak += summary?.xpss ?? 0;
    completed.total += summary?.xss ?? 0;
  }

  const targets = {
    low: targetXSS?.low ?? 0,
    high: targetXSS?.high ?? 0,
    peak: targetXSS?.peak ?? 0,
    total: targetXSS?.total ?? 0,
  };

  return {
    count: details.length,
    completed,
    targets,
    remaining: {
      low: Math.max(targets.low - completed.low, 0),
      high: Math.max(targets.high - completed.high, 0),
      peak: Math.max(targets.peak - completed.peak, 0),
      total: Math.max(targets.total - completed.total, 0),
    },
  };
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
  if (state.trainingData) {
    renderTimeSummary();
    renderRoutes();
  }
});

document.getElementById('today-only-toggle').addEventListener('change', (e) => {
  state.todayOnly = e.target.checked;
  localStorage.setItem('today-only', state.todayOnly);
  if (state.trainingData) {
    const eligibleRoutes = state.todayOnly ? filterToAvailableWorlds(routes) : routes;
    state.ranked = enrichRoutes(rankRoutes(eligibleRoutes, state.bucket), state.bucket, state.wotdStructure);
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
document.getElementById('timing-auto').addEventListener('click', () => setTimingMode('auto'));
document.getElementById('timing-manual').addEventListener('click', () => setTimingMode('manual'));

init();

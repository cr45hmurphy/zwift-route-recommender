import { authenticate, fetchTrainingInfo, fetchWorkout, fetchActivitiesInRange, fetchActivityDetail, parseTrainingData, clearToken, hasToken } from './core/xert.js';
import { routes } from './core/routes.js';
import { getPreferredWorldContext, getWorldScheduleContext, filterRoutesToWorlds, worldName } from './core/routes.js';
import { getTodaysPortalRoad } from './core/portal.js';
import { scaleProfilePoints } from './core/profile.js';
import { getSegmentsForRoute } from './core/segments.js';
import { expandTimelineForLaps, getRouteTimeline, recommendedLapCount, uniqueTimelineSegments, withRecoveryGaps } from './core/timelines.js';
import { analyzeTrainingDay, deriveRouteBucketSupport, generateRideCue, optimizeRoutes, routeHonestyLabel, wotdTerrainScore } from './core/scorer.js';
import { countRouteCards, formatWorldContextLabel, formatWorldContextSourceDetail } from './core/ui.js';
import { DATA_SOURCE_OPTIONS, MOCK_SCENARIOS } from './data/mock-data.js';

// ── Constants ─────────────────────────────────────

// Rough XSS generation rate per bucket type (XSS per hour).
// Used only for time-based planning estimates — not precise.
const XSS_RATE = { low: 65, high: 90, peak: 50, recovery: 40 };
// Multipliers applied to bucketSupport-weighted XSS to produce a low/high range.
// Anchored to tuning log data; add a log entry before changing.
const XSS_RANGE_FLOOR = { low: 0.75, high: 0.12, peak: 0.08, recovery: 0.8 };
const XSS_RANGE_CEIL  = { low: 1.0,  high: 0.85, peak: 0.75, recovery: 1.0 };
const FAVORITES_KEY = 'xert_favorites';
const DEFAULT_SPEED_KMH = 28;
const TIMING_MODE_KEY = 'timing-mode';
const DATA_SOURCE_KEY = 'data-source';
const ROUTE_PICKER_KEY = 'route-picker';
const MANUAL_SPEED_MIN_KMH = 15;
const MANUAL_SPEED_MAX_KMH = 50;
const DAILY_SUMMARY_BUFFER_HOURS = 12;
const TIME_SLIDER_MIN = 15;
const TIME_SLIDER_MAX = 480;
const TIME_SLIDER_STEP = 15;
let recommendedTimeCache = { key: null, value: null };
let evaluatedRoutesCache = { key: null, routes: [] };

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

function getGuestWorlds() {
  try { return JSON.parse(localStorage.getItem('guest-worlds')) ?? ['london', 'new-york']; }
  catch { return ['london', 'new-york']; }
}

function saveGuestWorlds(worlds) {
  localStorage.setItem('guest-worlds', JSON.stringify(worlds));
}

function getTimingMode() {
  return localStorage.getItem(TIMING_MODE_KEY) === 'manual' ? 'manual' : 'auto';
}

function getDataSourceId() {
  const stored = localStorage.getItem(DATA_SOURCE_KEY) || 'live';
  return stored === 'live' || MOCK_SCENARIOS[stored] ? stored : 'live';
}

function getRoutePickerValue() {
  return localStorage.getItem(ROUTE_PICKER_KEY) || '';
}

function isLiveDataSource(dataSourceId = state.dataSourceId) {
  return dataSourceId === 'live';
}

function getMockScenario(dataSourceId = state.dataSourceId) {
  return MOCK_SCENARIOS[dataSourceId] ?? null;
}

function loadFavorites() {
  try { return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]')); }
  catch { return new Set(); }
}

function saveFavorites(set) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...set]));
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

function formatClockMinutes(minutes) {
  const safe = Math.max(0, Math.round(minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function formatDurationText(minutes) {
  const safe = Math.max(0, Math.round(minutes));
  if (safe < 60) return `${safe} min`;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function snapMinutes(value) {
  return clamp(Math.round(value / TIME_SLIDER_STEP) * TIME_SLIDER_STEP, TIME_SLIDER_MIN, TIME_SLIDER_MAX);
}

function bucketColorClass(bucket) {
  if (bucket === 'low' || bucket === 'high' || bucket === 'peak') return bucket;
  return '';
}

function wotdDisplayLabel(wotdStructure) {
  const labels = {
    sustained_climb: 'sustained climb workout',
    repeated_punchy: 'threshold interval workout',
    sprint_power: 'sprint power workout',
    mixed_mode: 'mixed workout',
    aerobic_endurance: 'aerobic endurance workout',
    recovery: 'recovery',
  };
  return labels[wotdStructure] ?? null;
}

function wotdTargetBucket(wotdStructure, fallbackBucket) {
  const map = {
    sustained_climb: 'high',
    repeated_punchy: 'high',
    sprint_power: 'peak',
    aerobic_endurance: 'low',
    recovery: 'recovery',
  };
  return map[wotdStructure] ?? fallbackBucket;
}

function emphasizedTitle(text, emphasis, bucketClass) {
  if (!emphasis || !text.includes(emphasis)) return text;
  return text.replace(emphasis, `<span class="bucket-word ${bucketClass}">${emphasis}</span>`);
}

function bucketBadgeHTML(baseClass, bucket, innerHtml) {
  return `<span class="${baseClass} ${bucketColorClass(bucket)}">${innerHtml}</span>`;
}

function isGenericSegmentName(name = '') {
  const normalized = String(name).trim().toLowerCase();
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

function preferNamedSegments(segments = []) {
  const named = segments.filter(segment => !isGenericSegmentName(segment?.name));
  return named.length ? named : segments;
}

function isDisplayableRouteSegment(segment) {
  return segment?.type === 'sprint' || segment?.type === 'climb' || segment?.type === 'segment';
}

function segmentDisplayKind(segment) {
  if (segment?.type === 'climb') return 'climb';
  if (segment?.type === 'sprint') return 'sprint';
  return 'segment';
}

function buildInformationalProfileMarkers(routeTimeline, routeProfile) {
  const occurrences = Array.isArray(routeTimeline?.segments) ? routeTimeline.segments : [];
  const totalProfileKm = Number(routeProfile?.totalProfileKm ?? 0);
  const totalRouteKm = Number(routeProfile?.totalRouteKm ?? 0);
  if (!occurrences.length || totalProfileKm <= 0 || totalRouteKm <= 0) return [];

  const seen = new Set();
  const markers = [];

  for (const occurrence of occurrences) {
    if (occurrence?.type !== 'segment') continue;
    if (!occurrence?.name || isGenericSegmentName(occurrence.name)) continue;

    const key = occurrence.segmentSlug || `segment:${String(occurrence.name).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const routeStartKm = Number(occurrence.startKm ?? 0);
    const routeEndKm = Number(occurrence.endKm ?? routeStartKm);
    const profileStartKm = Number(((routeStartKm / totalRouteKm) * totalProfileKm).toFixed(3));
    const profileEndKm = Number(((routeEndKm / totalRouteKm) * totalProfileKm).toFixed(3));
    const distanceKm = Math.max(Number(occurrence.distanceKm ?? routeEndKm - routeStartKm), 0);

    markers.push({
      type: 'segment',
      name: occurrence.name,
      segmentSlug: occurrence.segmentSlug ?? null,
      routeStartKm,
      routeEndKm,
      profileStartKm,
      profileEndKm,
      priority: Number((26 + (distanceKm * 5)).toFixed(2)),
      sourceSection: occurrence.sourceSection ?? 'route',
    });
  }

  return markers;
}

function mergeProfileMarkers(baseMarkers = [], extraMarkers = []) {
  const merged = [];
  const seen = new Set();

  for (const marker of [...baseMarkers, ...extraMarkers]) {
    if (!marker) continue;
    const key = marker.segmentSlug || `${marker.type}:${String(marker.name ?? '').toLowerCase()}:${Number(marker.routeStartKm ?? 0).toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(marker);
  }

  return merged;
}

function orderedRelevantSegments(route) {
  if (Array.isArray(route.orderedSegments) && route.orderedSegments.length) {
    const ordered = preferNamedSegments(route.orderedSegments)
      .filter(isDisplayableRouteSegment);
    if (ordered.length) return ordered;
  }

  return [
    ...preferNamedSegments(route.relevantClimbs ?? []),
    ...preferNamedSegments(route.relevantSprints ?? []),
  ];
}

function segmentRowHTML(route) {
  const orderedSegments = orderedRelevantSegments(route);
  if (!orderedSegments.length) return '';

  const previewLimit = 6;
  const previewSegments = orderedSegments.slice(0, previewLimit);
  const remainingCount = orderedSegments.length - previewSegments.length;
  const previewItems = previewSegments
    .map(segment => segmentChipHTML(segment, segmentDisplayKind(segment)))
    .join('');

  if (remainingCount <= 0) {
    return `
      <div class="segment-row">
        <span class="segment-label">Segments on this route:</span>
        <div class="segment-chips">${previewItems}</div>
      </div>`;
  }

  const fullItems = orderedSegments
    .map(segment => segmentChipHTML(segment, segmentDisplayKind(segment)))
    .join('');

  return `
    <div class="segment-row">
      <span class="segment-label">Segments on this route:</span>
      <div class="segment-chips">${previewItems}</div>
      <details class="segment-details">
        <summary>Show full route sequence (${orderedSegments.length} efforts)</summary>
        <div class="segment-chips segment-chips-full">${fullItems}</div>
      </details>
    </div>`;
}

function getDisplayTarget(wotdStructure, fallbackBucket) {
  if (wotdStructure === 'mixed_mode') {
    return { mode: 'mixed' };
  }
  return { mode: 'bucket', bucket: wotdTargetBucket(wotdStructure, fallbackBucket) };
}

function wotdDurationMinutes(wotd) {
  const duration = Number(wotd?.duration ?? wotd?.durationSeconds ?? wotd?.seconds ?? wotd?.totalDuration);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return duration > 300 ? duration / 60 : duration;
}

function estimateMixedSupportXss(minutes, route = null) {
  const contributions = route?.optimizerBreakdown ?? { low: 1, high: 1, peak: 1 };
  const low = estimateBucketImpactXss(minutes, 'low') * (contributions.low ?? 0);
  const high = estimateBucketImpactXss(minutes, 'high') * (contributions.high ?? 0);
  const peak = estimateBucketImpactXss(minutes, 'peak') * (contributions.peak ?? 0);
  return Math.round(low + high + peak);
}

function estimateWorkoutLoadXss(minutes, rawWotd, fallbackTotal = null) {
  const totalXss = Number(rawWotd?.xss ?? rawWotd?.totalXSS ?? rawWotd?.total_xss ?? rawWotd?.workoutXss ?? rawWotd?.plannedXSS);
  const durationMin = wotdDurationMinutes(rawWotd);
  if (!Number.isFinite(totalXss) || !Number.isFinite(durationMin) || durationMin <= 0) {
    return Number.isFinite(fallbackTotal) ? Math.round(Math.min(fallbackTotal, (minutes / 60) * XSS_RATE.low)) : null;
  }
  return Math.round((minutes / durationMin) * totalXss);
}

// ── State ─────────────────────────────────────────

let state = {
  trainingData:   null,
  rawWotd:        null,
  dailySummary:   null,
  dataSourceId:   'live',
  bucket:         null,
  bucketOverride: null,
  wotdStructure:  'recovery',
  ranked:         [],
  selectedRouteKey: '',
  lastUpdated:    null,
  timingMode:     'auto',
  todayOnly:      true,
  guestWorlds:    [],
  worldContext:   getWorldScheduleContext(getGuestWorlds()),
  wotdDetailLoaded: false,
};

function activeWorldContext() {
  return state.worldContext ?? getWorldScheduleContext(state.guestWorlds);
}

async function refreshWorldContext({ rerender = true } = {}) {
  const previousWorlds = [...activeWorldContext().worlds].sort().join(',');
  state.worldContext = await getPreferredWorldContext(state.guestWorlds);
  const nextWorlds = [...activeWorldContext().worlds].sort().join(',');

  updateGuestWorldsLabel();
  updateGuestWorldsPickerVisibility();

  if (!rerender || !state.trainingData) return;

  if (previousWorlds !== nextWorlds || state.todayOnly) {
    recomputeRankedRoutes();
    renderRoutes();
    renderRouteInspector();
  }
}

// ── Init ──────────────────────────────────────────

async function init() {
  const params = new URLSearchParams(window.location.search);

  // Apply ?mock=<id> URL param before reading localStorage, so the param wins
  const mockParam = params.get('mock');
  if (mockParam && MOCK_SCENARIOS[mockParam]) {
    localStorage.setItem(DATA_SOURCE_KEY, mockParam);
  }

  // Gate dev panel behind ?dev=1
  if (params.has('dev')) {
    document.body.classList.add('dev-mode');
  }

  const ts = localStorage.getItem('xert_last_updated');
  if (ts) state.lastUpdated = new Date(parseInt(ts, 10));
  state.timingMode = getTimingMode();
  state.dataSourceId = getDataSourceId();
  state.selectedRouteKey = getRoutePickerValue();

  populateDataSourceOptions();
  populateRoutePickerOptions();
  syncDataSourceControls();

  // Restore saved unit preference (updates button state + speed label without re-rendering)
  const savedUnit = getUnits();
  document.getElementById('units-metric').classList.toggle('active', savedUnit === 'metric');
  document.getElementById('units-imperial').classList.toggle('active', savedUnit === 'imperial');
  document.getElementById('speed-unit-label').textContent = savedUnit === 'imperial' ? 'mph' : 'km/h';
  if (savedUnit === 'imperial') {
    const speedInput = document.getElementById('avg-speed');
    speedInput.value = Math.round(parseFloat(speedInput.value) * KM_TO_MI);
  }
  updateManualSpeedBounds();

  state.todayOnly = getTodayOnly();
  state.guestWorlds = getGuestWorlds();
  state.worldContext = getWorldScheduleContext(state.guestWorlds);
  document.getElementById('today-only-toggle').checked = state.todayOnly;
  document.querySelectorAll('.guest-world-cb').forEach(cb => {
    cb.checked = state.guestWorlds.includes(cb.value);
  });
  updateGuestWorldsLabel();
  updateGuestWorldsPickerVisibility();
  updateGuestWorldCheckboxes();
  updateTimeLabel();
  renderTimingControls();
  renderSourceNotes();

  if (!isLiveDataSource()) {
    void refreshWorldContext();
    loadMockScenario();
    return;
  }

  if (hasToken()) {
    showApp();
    void refreshWorldContext();
    await refresh();
  } else {
    void refreshWorldContext({ rerender: false });
    showAuth();
  }
}

// ── Auth ──────────────────────────────────────────

async function handleLogin(e) {
  e.preventDefault();
  if (!isLiveDataSource()) {
    loadMockScenario();
    return;
  }
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
  if (!isLiveDataSource()) {
    loadMockScenario();
    return;
  }
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
    dataSourceId:   getDataSourceId(),
    bucket:         null,
    bucketOverride: null,
    wotdStructure:  'recovery',
    ranked:         [],
    selectedRouteKey: getRoutePickerValue(),
    lastUpdated:    null,
    timingMode:     getTimingMode(),
    todayOnly:      getTodayOnly(),
    guestWorlds:    getGuestWorlds(),
    worldContext:   getWorldScheduleContext(getGuestWorlds()),
    wotdDetailLoaded: false,
  };
  syncDataSourceControls();
  renderSourceNotes();
  updateGuestWorldsLabel();
  updateGuestWorldsPickerVisibility();
  showAuth();
}

// ── Data ──────────────────────────────────────────

async function refresh(username, password) {
  setLoading(true);
  hideError();
  const todayPlanSection = document.getElementById('today-plan');
  if (todayPlanSection) todayPlanSection.style.display = 'none';

  try {
    const raw = await fetchTrainingInfo(username, password);
    state.trainingData = parseTrainingData(raw);
    // Mirror the same wotd-vs-workouts[0] fallback used in parseTrainingData so rawWotd
    // is always populated when a workout exists, regardless of which field Xert used.
    const wotdSrc = raw?.wotd ?? raw?.workouts?.[0] ?? null;
    state.rawWotd = wotdSrc
      ? { ...wotdSrc, workoutId: wotdSrc.workoutId ?? wotdSrc.path ?? wotdSrc._id ?? null }
      : null;
    state.wotdDetailLoaded = false;
    if (state.rawWotd?.workoutId) {
      try {
        const workoutDetail = await fetchWorkout(state.rawWotd.workoutId);
        const intervals = Array.isArray(workoutDetail?.workout) ? workoutDetail.workout : [];
        const sprintInterval = intervals
          .filter(i => Number(i?.duration) <= 30 && Number(i?.power) > 0)
          .sort((a, b) => Number(b.power) - Number(a.power))[0] ?? null;
        state.rawWotd = {
          ...state.rawWotd,
          ...workoutDetail,
          intervalPower: sprintInterval ? Number(sprintInterval.power) : null,
          intervalDuration: sprintInterval ? Number(sprintInterval.duration) : null,
        };
        state.wotdDetailLoaded = true;
        // Patch display fields if training_info wotd was sparse
        if (!state.trainingData.wotd.name && state.rawWotd.name) {
          state.trainingData.wotd.name = state.rawWotd.name;
        }
        if (!state.trainingData.wotd.description && state.rawWotd.description) {
          state.trainingData.wotd.description = state.rawWotd.description;
        }
      } catch (_) { /* use training_info wotd as-is */ }
    }
    const dailySummary = await fetchTodaysDailySummary(state.trainingData.targetXSS, username, password);
    state.dailySummary = dailySummary;
    const { bucket: analyzedBucket, wotdStructure } = analyzeTrainingDay(
      state.dailySummary.completed,
      state.dailySummary.targets,
      state.rawWotd,
      state.trainingData?.signature?.ftp
    );
    state.wotdStructure = wotdStructure;
    const { bucket, overrideNote } = applyFreshnessOverride(analyzedBucket, state.trainingData.status);
    state.bucket = bucket;
    state.bucketOverride = overrideNote;
    recomputeRankedRoutes();
    const now = Date.now();
    state.lastUpdated = new Date(now);
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

function loadMockScenario() {
  const scenario = getMockScenario();
  if (!scenario) return;

  state.trainingData = JSON.parse(JSON.stringify(scenario.trainingData));
  state.rawWotd = JSON.parse(JSON.stringify(scenario.rawWotd ?? null));
  state.dailySummary = JSON.parse(JSON.stringify(scenario.dailySummary));
  state.wotdDetailLoaded = Boolean(state.rawWotd?.workoutId && (
    Number.isFinite(Number(state.rawWotd?.intervalPower)) ||
    Number.isFinite(Number(state.rawWotd?.intervalDuration))
  ));

  const { bucket: analyzedBucket, wotdStructure } = analyzeTrainingDay(
    state.dailySummary.completed,
    state.dailySummary.targets,
    state.rawWotd,
    state.trainingData?.signature?.ftp
  );
  state.wotdStructure = wotdStructure;
  const { bucket, overrideNote } = applyFreshnessOverride(analyzedBucket, state.trainingData.status);
  state.bucket = bucket;
  state.bucketOverride = overrideNote;
  recomputeRankedRoutes();
  state.lastUpdated = new Date();
  renderAll();
  showApp();
}

// ── Render ────────────────────────────────────────

function renderAll() {
  renderSourceNotes();
  renderStatus();
  renderRecommendation();
  renderTimingControls();
  renderTimeSummary();
  renderRoutes();
  renderRouteInspector();
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

  const noteEl = document.getElementById('daily-summary-note');
  if (!noteEl) return;

  if (!isLiveDataSource()) {
    noteEl.className = 'summary-note';
    noteEl.textContent =
      `Mock summary: ${summary.count ?? 0} activities already counted today. Total completed XSS: ${Math.round(summary.completed.total ?? 0)} / ${Math.round(summary.targets.total ?? 0)}.`;
    return;
  }

  const activityCount = summary.count ?? 0;
  const fallbackCount = summary.fallbackCount ?? 0;
  const failedCount = summary.failedCount ?? 0;
  const totalCompleted = Math.round(summary.completed.total ?? 0);
  const totalTarget = Math.round(summary.targets.total ?? 0);
  const parts = [
    `Today's totals use ${activityCount} ${activityCount === 1 ? 'activity' : 'activities'}`,
    `${totalCompleted} / ${totalTarget} total XSS completed`,
  ];

  if (fallbackCount > 0) {
    parts.push(`${fallbackCount} ${fallbackCount === 1 ? 'activity used' : 'activities used'} summary fallback data`);
  }

  noteEl.textContent = `${parts.join(' · ')}.`;
  noteEl.className = failedCount > 0 ? 'summary-note warning' : 'summary-note';

  if (failedCount > 0) {
    noteEl.textContent += ` ${failedCount} ${failedCount === 1 ? 'activity detail failed to load' : 'activity details failed to load'}, so today's totals may be understated.`;
  }
}

function renderBucketBar(name, completed, target, remaining, highlighted) {
  const current = completed;
  const pct    = target > 0 ? Math.min(current / target * 100, 100) : 100;

  document.getElementById(`bar-fill-${name}`).style.width = `${pct.toFixed(1)}%`;
  document.getElementById(`bar-fill-${name}`).classList.toggle('highlighted', highlighted);
  document.getElementById(`bar-fill-${name}`).classList.add(name);
  document.getElementById(`bar-label-${name}`).classList.toggle('highlighted', highlighted);

  const valEl = document.getElementById(`bar-values-${name}`);
  valEl.title = 'Completed vs daily target';
  valEl.innerHTML = `${current.toFixed(1)} done / ${target.toFixed(1)} target`;
  if (remaining > 0) {
    valEl.innerHTML += ` <span class="deficit ${name}">${remaining.toFixed(1)} left</span>`;
  } else {
    valEl.innerHTML += ' met';
  }
}

function renderRecommendation() {
  const d = state.trainingData;
  const b = state.bucket;
  const recTitleEl = document.getElementById('rec-title');
  const recSubtitleEl = document.getElementById('rec-subtitle');
  const remaining = state.dailySummary?.remaining ?? {};

  if (b === 'recovery' || state.wotdStructure === 'recovery') {
    recTitleEl.innerHTML = emphasizedTitle('Recovery day', 'Recovery', 'low');
    recSubtitleEl.textContent = 'Keep it easy — short, flat, no efforts.';
  } else if (state.wotdStructure === 'mixed_mode') {
    recTitleEl.textContent = 'Today calls for mixed efforts';
    const hasWotd = !!state.trainingData?.wotd?.name;
    recSubtitleEl.textContent = hasWotd
      ? 'Xert\'s workout builds aerobic base with explosive peak intervals — find routes with sprint segments and flat recovery between them.'
      : 'Your training targets span low, high, and peak — look for routes that blend aerobic distance with sprint or climbing segments.';
  } else if (state.wotdStructure === 'sustained_climb') {
    recTitleEl.innerHTML = emphasizedTitle('Today calls for sustained climbing', 'climbing', 'high');
    recSubtitleEl.textContent = `Xert's workout targets ${remaining.high.toFixed(1)} high XSS — one long threshold effort on a climb will do it.`;
  } else if (state.wotdStructure === 'repeated_punchy') {
    recTitleEl.innerHTML = emphasizedTitle('Today calls for repeated threshold efforts', 'threshold efforts', 'high');
    recSubtitleEl.textContent = `Xert's workout targets ${remaining.high.toFixed(1)} high XSS — repeated hard surges with full recovery between.`;
  } else if (state.wotdStructure === 'sprint_power') {
    recTitleEl.innerHTML = emphasizedTitle('Today calls for short maximal efforts', 'maximal efforts', 'peak');
    recSubtitleEl.textContent = `Xert's workout targets ${remaining.peak.toFixed(1)} peak XSS — sprint every banner at absolute max.`;
  } else if (state.wotdStructure === 'aerobic_endurance') {
    recTitleEl.innerHTML = emphasizedTitle('Today calls for aerobic base work', 'aerobic base work', 'low');
    recSubtitleEl.textContent = `Xert's workout targets ${remaining.low.toFixed(1)} low XSS — steady Z2, let the distance do the work.`;
  } else {
    const activeNeeds = ['low', 'high', 'peak'].filter(name => (remaining[name] ?? 0) > 0.5);
    if (activeNeeds.length >= 2) {
      recTitleEl.textContent = 'Multiple buckets still need work';
      recSubtitleEl.textContent =
        `You still have ${remaining.low.toFixed(1)} low, ${remaining.high.toFixed(1)} high, and ${remaining.peak.toFixed(1)} peak XSS left today — the top route is being chosen by best overall fit, not just one bucket.`;
    } else {
      const titles = {
        low: emphasizedTitle('Your low bucket needs work', 'low', 'low'),
        high: emphasizedTitle('Your high bucket needs work', 'high', 'high'),
        peak: emphasizedTitle('Your peak bucket needs work', 'peak', 'peak'),
        recovery: 'You\'re on top of all your targets',
      };

      const subtitles = {
        low: `You still have ${remaining.low.toFixed(1)} low XSS left today — a long flat ride will help.`,
        high: `You still have ${remaining.high.toFixed(1)} high XSS left today — a climbing route will help.`,
        peak: `You still have ${remaining.peak.toFixed(1)} peak XSS left today — a short punchy route will help.`,
        recovery: 'All buckets at or above target. Take it easy — flat and short today.',
      };

      recTitleEl.innerHTML = titles[b] ?? '';
      recSubtitleEl.textContent = subtitles[b] ?? '';
    }
  }

  const wotdEl = document.getElementById('wotd');
  if (d.wotd.name) {
    wotdEl.style.display = 'block';
    wotdEl.innerHTML = `<strong>Workout of the Day:</strong> ${d.wotd.name}` +
      (d.wotd.difficulty ? ` — difficulty ${d.wotd.difficulty}` : '') +
      (d.wotd.description ? `<br>${d.wotd.description}` : '') +
      (state.rawWotd?.workoutId
        ? `<div class="wotd-meta${state.wotdDetailLoaded ? '' : ' warning'}">${state.wotdDetailLoaded ? `Workout detail loaded. Classified as ${wotdDisplayLabel(state.wotdStructure) ?? 'workout'} for route matching.` : `Workout detail fetch did not complete, so ${wotdDisplayLabel(state.wotdStructure) ?? 'workout'} matching is based on training_info only.`}</div>`
        : `<div class="wotd-meta warning">No workoutId was provided by training_info, so workout validation could not go past the summary payload.</div>`);
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

  const portalEl = document.getElementById('portal-today');
  const portal = getTodaysPortalRoad();
  if (portal) {
    const featured = portal.portalOfMonth ? ' · portal of the month' : '';
    portalEl.innerHTML = `<strong>Today's Climb Portal:</strong> ${portal.name} · ${displayDist(portal.distance)} / ${displayElev(portal.elevation)} · ${portal.worldName}${featured}`;
    portalEl.style.display = 'block';
  } else {
    portalEl.style.display = 'none';
  }
}

function enrichRoute(route, bucket, wotdStructure, availableMinutes) {
  const routeSegments = getSegmentsForRoute(route);
  const timeline = getRouteTimeline(route);
  const lapCount = recommendedLapCount(route, availableMinutes);
  const expandedTimeline = timeline ? withRecoveryGaps(expandTimelineForLaps(route, timeline, lapCount)) : [];
  const timelineClimbs = uniqueTimelineSegments(expandedTimeline, 'climb');
  const timelineSprints = uniqueTimelineSegments(expandedTimeline, 'sprint');
  const routeTimeline = timeline ? { ...timeline, occurrences: expandedTimeline } : null;
  const orderedSegments = timeline
    ? preferNamedSegments((timeline.segments ?? []).filter(isDisplayableRouteSegment))
    : [];
  const informationalProfileMarkers = buildInformationalProfileMarkers(timeline, route.profile);
  const relevantClimbs = timelineClimbs.length ? timelineClimbs.slice(0, 4) : preferNamedSegments(routeSegments.climbs).slice(0, 4);
  const relevantSprints = timelineSprints.length ? timelineSprints : preferNamedSegments(routeSegments.sprints);
  const bucketSupport = deriveRouteBucketSupport(route, routeSegments, routeTimeline, lapCount);
  const lapPrefix = lapCount >= 2 && bucket !== 'recovery'
    ? `Plan ${lapCount} laps (~${formatMinutes(Math.round((route.estimatedMinutes ?? 0) * lapCount))}). `
    : '';

  return {
    ...route,
    rideCue: generateRideCue({ ...route, bucketSupport }, bucket, wotdStructure, routeSegments, routeTimeline, lapPrefix),
    wotdTerrainScore: route.wotdTerrainScore ?? wotdTerrainScore(route, wotdStructure, routeSegments),
    relevantClimbs,
    relevantSprints,
    segmentSource: routeSegments.source,
    bucketSupport,
    honestyLabel: routeHonestyLabel(route, routeSegments, routeTimeline, lapCount),
    routeTimeline,
    timelineOccurrences: expandedTimeline,
    orderedSegments,
    profileMarkers: mergeProfileMarkers(
      Array.isArray(route.profileMarkers) ? route.profileMarkers : [],
      informationalProfileMarkers,
    ),
    recommendedLapCount: lapCount,
  };
}

function enrichRoutes(rankedRoutes, bucket, wotdStructure, availableMinutes) {
  return rankedRoutes.map(route => enrichRoute(route, bucket, wotdStructure, availableMinutes));
}

function getRouteSupportForScenario(route, availableMinutes) {
  const routeSegments = getSegmentsForRoute(route);
  const timeline = getRouteTimeline(route);
  const lapCount = recommendedLapCount(route, availableMinutes);
  const expandedTimeline = timeline ? withRecoveryGaps(expandTimelineForLaps(route, timeline, lapCount)) : [];
  const routeTimeline = timeline ? { ...timeline, occurrences: expandedTimeline } : null;
  return deriveRouteBucketSupport(route, routeSegments, routeTimeline, lapCount);
}

function recomputeRankedRoutes() {
  if (!state.trainingData || !state.dailySummary || !state.bucket) {
    state.ranked = [];
    return;
  }

  const settings = getTimeSettings();
  state.ranked = getEvaluatedRoutes(settings);
}

function routeRecommendationViable(route) {
  return (route?.score ?? 0) > 0;
}

function visibleRankedRoutes() {
  return state.ranked;
}

function recommendationSettingsForMinutes(minutes) {
  const baseSettings = getTimeSettings();
  return {
    minutes,
    mode: baseSettings.mode,
    speed: baseSettings.speed,
  };
}

function evaluatedRoutesCacheKey(settings = getTimeSettings()) {
  const riderWkg = getRiderWkg(state.trainingData);
  const context = activeWorldContext();
  return JSON.stringify({
    bucket: state.bucket,
    wotdStructure: state.wotdStructure,
    dataSourceId: state.dataSourceId,
    todayOnly: state.todayOnly,
    worlds: context.worlds,
    source: context.source,
    timingMode: settings.mode,
    manualSpeed: settings.mode === 'manual' ? settings.speed : null,
    riderWkg: Number.isFinite(riderWkg) ? riderWkg.toFixed(3) : null,
    remaining: state.dailySummary?.remaining ?? null,
    minutes: settings.minutes,
  });
}

function getEvaluatedRoutes(settings = getTimeSettings()) {
  if (!state.trainingData || !state.dailySummary || !state.bucket) return [];

  const cacheKey = evaluatedRoutesCacheKey(settings);
  if (evaluatedRoutesCache.key === cacheKey) {
    return evaluatedRoutesCache.routes;
  }

  const eligibleRoutes = state.todayOnly ? filterRoutesToWorlds(routes, activeWorldContext().worlds) : routes;
  const optimized = optimizeRoutes(eligibleRoutes, {
    bucket: state.bucket,
    deficits: state.dailySummary.remaining,
    availableMinutes: settings.minutes,
    estimateMinutes: route => estimateRouteMinutes(route, settings, state.trainingData),
    getRouteSegments: route => getSegmentsForRoute(route),
    getRouteSupport: route => getRouteSupportForScenario(route, settings.minutes),
    wotdStructure: state.wotdStructure,
    recoveryMode: state.bucket === 'recovery',
    favorites: loadFavorites(),
    limit: eligibleRoutes.length,
  });
  const enriched = enrichRoutes(optimized, state.bucket, state.wotdStructure, settings.minutes);

  evaluatedRoutesCache = { key: cacheKey, routes: enriched };
  return enriched;
}

function recommendationAvailability(settings = getTimeSettings()) {
  const { minutes: timeMin } = settings;
  const visible = getEvaluatedRoutes(settings);
  const withinBudget = visible.filter(route => (route.estimatedMinutes ?? estimateRouteMinutes(route, settings, state.trainingData)) <= timeMin);
  const overBudget = visible.filter(route => (route.estimatedMinutes ?? estimateRouteMinutes(route, settings, state.trainingData)) > timeMin);
  const viableWithinBudget = withinBudget.filter(routeRecommendationViable);
  const viableOverBudget = overBudget
    .filter(routeRecommendationViable)
    .sort((a, b) => {
      const aOver = (a.estimatedMinutes ?? estimateRouteMinutes(a, settings, state.trainingData)) - timeMin;
      const bOver = (b.estimatedMinutes ?? estimateRouteMinutes(b, settings, state.trainingData)) - timeMin;
      if (aOver !== bOver) return aOver - bOver;
      if ((b.utility ?? 0) !== (a.utility ?? 0)) return (b.utility ?? 0) - (a.utility ?? 0);
      if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0);
      return String(a.slug || a.name).localeCompare(String(b.slug || b.name));
    });
  const approximateWithinBudget = withinBudget.filter(route => !routeRecommendationViable(route));
  return {
    visible,
    withinBudget,
    overBudget,
    viableWithinBudget,
    viableOverBudget,
    approximateWithinBudget,
  };
}

function renderRoutes() {
  const settings = getTimeSettings();
  const favorites = loadFavorites();
  const {
    viableWithinBudget,
    viableOverBudget,
    approximateWithinBudget,
  } = recommendationAvailability(settings);

  // Primary grid: top 5 within budget
  document.getElementById('route-grid').innerHTML = viableWithinBudget.length
    ? viableWithinBudget.slice(0, 5).map(route => routeCardHTML(route, false, favorites)).join('')
    : `<p class="no-routes">${noRouteMessage(approximateWithinBudget.length, viableOverBudget.length)}</p>`;

  // Other options: viable within-budget overflow, or approximation-only fallback if nothing viable fits. Capped at 5.
  const OTHER_CAP = 5;
  const otherList = document.getElementById('other-list');
  const otherToggle = document.getElementById('other-toggle');
  const allOverflow = viableWithinBudget.length ? viableWithinBudget.slice(5) : approximateWithinBudget;
  const overflowRoutes = allOverflow.slice(0, OTHER_CAP);
  const overflowHidden = allOverflow.length - overflowRoutes.length;
  const overflowHiddenNote = overflowHidden > 0 ? ` · ${overflowHidden} not shown` : '';
  const otherLabel = viableWithinBudget.length
    ? `▼ Other options (${overflowRoutes.length} more${overflowHiddenNote})`
    : `▼ Best approximate options (${overflowRoutes.length} routes${overflowHiddenNote})`;
  otherList.innerHTML = groupedByWorldHTML(overflowRoutes, favorites);
  otherToggle.textContent = otherLabel;
  otherToggle.dataset.hiddenCount = overflowHidden;
  document.getElementById('other-options').style.display = overflowRoutes.length ? 'block' : 'none';

  // "If you had more time": over-budget routes, sorted by nearest overrun, capped at 8
  const MORE_TIME_CAP = 8;
  const moreSection = document.getElementById('more-time-options');
  const moreList    = document.getElementById('more-time-list');
  const moreTimeToggle = document.getElementById('more-time-toggle');
  const cappedOverBudget = viableOverBudget.slice(0, MORE_TIME_CAP);
  const overBudgetHidden = viableOverBudget.length - cappedOverBudget.length;
  const overBudgetHiddenNote = overBudgetHidden > 0 ? ` · ${overBudgetHidden} not shown` : '';
  moreList.innerHTML = groupedByWorldHTML(cappedOverBudget, favorites, { profile: { height: 42 } });
  moreSection.style.display = cappedOverBudget.length ? 'block' : 'none';
  moreTimeToggle.textContent = `▼ If you had more time (${cappedOverBudget.length} routes${overBudgetHiddenNote})`;
  moreTimeToggle.dataset.hiddenCount = overBudgetHidden;
}

function setToggleOpen(toggleId, listId, label) {
  const list = document.getElementById(listId);
  const toggle = document.getElementById(toggleId);
  if (!list || !toggle) return;
  list.classList.add('open');
  const count = list.querySelectorAll('.route-card').length;
  toggle.textContent = `▲ ${label} (${count} ${label === 'Other options' ? 'more' : 'routes'})`;
}

function groupedByWorldHTML(routes, favorites, cardOptions = {}) {
  const groups = new Map();
  for (const route of routes) {
    const w = route.world ?? '';
    if (!groups.has(w)) groups.set(w, []);
    groups.get(w).push(route);
  }
  return [...groups.entries()].map(([world, worldRoutes]) => {
    const label = worldName(world);
    const cards = worldRoutes.map(r => routeCardHTML(r, true, favorites, cardOptions)).join('');
    return `<div class="world-group">
      <div class="world-group-header"><span class="world-group-label route-world" data-world="${world}">${label}</span></div>
      <div class="world-group-cards">${cards}</div>
    </div>`;
  }).join('');
}

function openSectionForRouteCard(routeKey) {
  const escapedKey = CSS.escape(routeKey);
  if (document.querySelector(`#other-list .route-card[data-route-key="${escapedKey}"]`)) {
    setToggleOpen('other-toggle', 'other-list', 'Other options');
  }
  if (document.querySelector(`#more-time-list .route-card[data-route-key="${escapedKey}"]`)) {
    setToggleOpen('more-time-toggle', 'more-time-list', 'If you had more time');
  }
}

function jumpToInspector(routeKey) {
  if (!routeKey) return;
  state.selectedRouteKey = routeKey;
  localStorage.setItem(ROUTE_PICKER_KEY, state.selectedRouteKey);
  renderRouteInspector();
  document.getElementById('route-inspector')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function jumpToRecommendationCard(routeKey) {
  if (!routeKey) return;
  openSectionForRouteCard(routeKey);
  const card = document.querySelector(`#routes-section > .route-grid .route-card[data-route-key="${CSS.escape(routeKey)}"]`)
    || document.querySelector(`#other-list .route-card[data-route-key="${CSS.escape(routeKey)}"]`)
    || document.querySelector(`#more-time-list .route-card[data-route-key="${CSS.escape(routeKey)}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.add('route-card-focused');
  setTimeout(() => card.classList.remove('route-card-focused'), 1600);
}

function noRouteMessage(approximateCount, overBudgetCount) {
  const displayTarget = getDisplayTarget(state.wotdStructure, state.bucket);
  const targetLabel = displayTarget.mode === 'mixed'
    ? 'today\'s mixed workout'
    : `today's ${String(displayTarget.bucket ?? state.bucket ?? 'workout').toUpperCase()} work`;
  const guidance = getRecommendedTimeGuidance();
  const viableText = Number.isFinite(guidance?.firstViableMinutes)
    ? ` The first honest route fit starts around ${formatClockMinutes(guidance.firstViableMinutes)}.`
    : '';

  if (approximateCount > 0) {
    return `No routes honestly support ${targetLabel} inside this time budget.${viableText} The approximation section below shows the least-wrong venues if you still want to ride now.`;
  }
  if (overBudgetCount > 0) {
    return `No routes honestly support ${targetLabel} inside this time budget.${viableText} Check the "If you had more time" section below.`;
  }
  return `No routes currently support ${targetLabel} with today's world and time constraints.`;
}

function currentEligibleRouteKeys() {
  return new Set(getEvaluatedRoutes(getTimeSettings()).map(route => route.slug || route.name));
}

function todaysAvailableRouteKeys() {
  return new Set(filterRoutesToWorlds(routes, activeWorldContext().worlds).map(route => route.slug || route.name));
}

function routeCardStatus(route) {
  const routeKey = route.slug || route.name;
  const outsideTodayWorlds = !todaysAvailableRouteKeys().has(routeKey);
  return {
    outsideTodayWorlds,
    eventOnly: Boolean(route.eventOnly),
    inspectorOnly: Boolean(route.inspectorOnly),
  };
}

function inspectableRoutes() {
  return routes
    .filter(route => Array.isArray(route.sports) && route.sports.includes('cycling'))
    .slice()
    .sort((a, b) =>
      worldName(a.world).localeCompare(worldName(b.world)) ||
      a.name.localeCompare(b.name)
    );
}

function routeSupportsBucket(route, bucket) {
  const gr = route.distance > 0 ? route.elevation / route.distance : 0;
  if (bucket === 'low') return gr < 12;
  if (bucket === 'high') return gr >= 8 && gr <= 35;
  if (bucket === 'peak') return gr >= 20 && route.distance <= 25;
  return true;
}

function populateRoutePickerOptions() {
  const picker = document.getElementById('route-picker');
  if (!picker) return;

  const worldFilter = document.getElementById('inspector-world-filter');
  if (worldFilter && worldFilter.options.length <= 1) {
    const worlds = [...new Set(inspectableRoutes().map(r => r.world).filter(Boolean))]
      .sort((a, b) => worldName(a).localeCompare(worldName(b)));
    worlds.forEach(w => {
      const opt = document.createElement('option');
      opt.value = w;
      opt.textContent = worldName(w);
      worldFilter.appendChild(opt);
    });
  }

  const searchVal = (document.getElementById('inspector-search')?.value ?? '').toLowerCase().trim();
  const worldVal = worldFilter?.value ?? '';
  const bucketVal = document.getElementById('inspector-bucket-filter')?.value ?? '';

  const currentValue = state.selectedRouteKey || '';
  const allRoutes = inspectableRoutes();
  const filtered = allRoutes.filter(route => {
    if (searchVal && !route.name.toLowerCase().includes(searchVal)) return false;
    if (worldVal && route.world !== worldVal) return false;
    if (bucketVal && !routeSupportsBucket(route, bucketVal)) return false;
    return true;
  });

  const options = filtered.map(route => {
    const key = route.slug || route.name;
    const selected = key === currentValue ? ' selected' : '';
    const eventTag = route.eventOnly ? ' · event only' : '';
    return `<option value="${key}"${selected}>${worldName(route.world)} · ${route.name}${eventTag}</option>`;
  }).join('');

  picker.innerHTML = `<option value="">Choose a route…</option>${options}`;
  picker.value = currentValue;

  const countEl = document.getElementById('inspector-route-count');
  if (countEl) {
    countEl.textContent = filtered.length < allRoutes.length
      ? `${filtered.length} of ${allRoutes.length} routes`
      : `${allRoutes.length} routes`;
  }
}

function selectedInspectableRoute() {
  if (!state.selectedRouteKey) return null;
  return routes.find(route => (route.slug || route.name) === state.selectedRouteKey) ?? null;
}

function renderRouteInspector() {
  const picker = document.getElementById('route-picker');
  const note = document.getElementById('route-picker-note');
  const card = document.getElementById('route-picked-card');
  if (!picker || !note || !card) return;

  if (!picker.options.length || picker.options.length === 1) {
    populateRoutePickerOptions();
  }
  picker.value = state.selectedRouteKey || '';

  const route = selectedInspectableRoute();
  if (!route || !state.trainingData || !state.dailySummary || !state.bucket) {
    note.textContent = route ? 'Route inspector is ready after training data loads.' : 'Pick any route to see exactly what the app would say for the current scenario.';
    card.innerHTML = '';
    return;
  }

  const settings = getTimeSettings();
  const eligibleRouteKeys = currentEligibleRouteKeys();
  const todaysRouteKeys = todaysAvailableRouteKeys();
  const rankedMatch = state.ranked.find(item => (item.slug || item.name) === (route.slug || route.name));
  const baseRoute = rankedMatch ?? optimizeRoutes([route], {
    bucket: state.bucket,
    deficits: state.dailySummary.remaining,
    availableMinutes: settings.minutes,
    estimateMinutes: item => estimateRouteMinutes(item, settings, state.trainingData),
    getRouteSegments: item => getSegmentsForRoute(item),
    getRouteSupport: item => getRouteSupportForScenario(item, settings.minutes),
    wotdStructure: state.wotdStructure,
    recoveryMode: state.bucket === 'recovery',
    favorites: loadFavorites(),
  })[0] ?? {
    ...route,
    score: 0,
    estimatedMinutes: estimateRouteMinutes(route, settings, state.trainingData),
    optimizerBreakdown: { low: 0, high: 0, peak: 0 },
    optimizerReason: 'Direct route inspection.',
  };

  const inspectedRoute = {
    ...enrichRoute(baseRoute, state.bucket, state.wotdStructure, settings.minutes),
    outsideTodayWorlds: !todaysRouteKeys.has(route.slug || route.name),
    inspectorOnly: !rankedMatch,
  };
  card.innerHTML = routeCardHTML(inspectedRoute, false, loadFavorites(), {
    profile: {
      height: 78,
      maxMarkers: 5,
      showSummary: false,
      showLabels: false,
    },
    inspectorMode: true,
    allowJumpToRecommendation: eligibleRouteKeys.has(route.slug || route.name),
  });

  const noteParts = [];
  if (inspectedRoute.outsideTodayWorlds) {
    noteParts.push(state.todayOnly ? 'Outside today\'s current world filter.' : 'Not in today\'s worlds, but shown because world filtering is off.');
  }
  if (route.eventOnly) {
    noteParts.push('This route is event only.');
  }
  if (inspectedRoute.inspectorOnly) {
    noteParts.push('Shown via direct inspection instead of current ranked results.');
  }
  note.textContent = noteParts.join(' ') || 'Showing this route with the current scenario, time budget, and cue logic.';
}

function buildShareText(route, estMin, fillPct, bucket) {
  const lines = [];
  const isMixed = bucket === 'mixed';
  const dayLabel = isMixed ? 'MIXED' : (bucket || 'RECOVERY').toUpperCase();
  const fillPart = (!isMixed && fillPct !== null && bucket && bucket !== 'recovery')
    ? ` · covers ~${fillPct}% of ${bucket.toUpperCase()} gap`
    : '';
  lines.push(`${route.name} · ${worldName(route.world)} · ${dayLabel} day · ~${formatMinutes(estMin)}${fillPart}`);
  if (route.rideCue) lines.push(`Ride cue: ${route.rideCue}`);
  return lines.join('\n');
}

function abbreviateProfileMarkerName(name = '', maxLength = 18) {
  const trimmed = String(name).trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}

function visibleProfileMarkers(route, maxMarkers = 3) {
  const markers = Array.isArray(route?.profileMarkers) ? route.profileMarkers.slice() : [];
  const selected = markers
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.routeStartKm ?? 0) - (b.routeStartKm ?? 0))
    .slice(0, maxMarkers);

  const hasSegment = selected.some(marker => marker?.type === 'segment');
  const segmentCandidate = markers
    .filter(marker => marker?.type === 'segment')
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.routeStartKm ?? 0) - (b.routeStartKm ?? 0))[0];

  if (!hasSegment && segmentCandidate && selected.length && maxMarkers > 0) {
    selected[selected.length - 1] = segmentCandidate;
  }

  return selected
    .sort((a, b) => (a.routeStartKm ?? 0) - (b.routeStartKm ?? 0) || (b.priority ?? 0) - (a.priority ?? 0));
}

function routeProfileSummaryHTML(markers = []) {
  if (!markers.length) return '';
  const pills = markers
    .map(marker => `<span class="route-profile-pill ${marker.type}">${abbreviateProfileMarkerName(marker.name, 24)}</span>`)
    .join('');
  const label = markers.some(marker => marker?.type === 'segment') ? 'Key route features' : 'Key efforts';
  return `
    <div class="route-profile-summary">
      <span class="route-profile-summary-label">${label}</span>
      <div class="route-profile-pill-row">${pills}</div>
    </div>`;
}

function routeProfileContextHTML(route, scale) {
  if (!scale || scale.scalingMode !== 'flat-conservative') return '';

  let label = 'Minor rollers';
  if ((route?.elevation ?? 0) <= 30) {
    label = 'Mostly flat';
  } else if ((route?.elevation ?? 0) >= 70) {
    label = 'Gentle rollers';
  }

  return `<span class="route-profile-context">${label}</span>`;
}

function routeProfileSVG(route, { height = 56, maxMarkers = 3, showSummary = false, showLabels = false } = {}) {
  const geometry = scaleProfilePoints(route, { width: 240, height, inset: 4 });
  if (!geometry) return '';

  const { scaled, width, inset } = geometry;
  const {
    minDistance,
    maxDistance,
  } = geometry.scale;
  const selectedMarkers = visibleProfileMarkers(route, maxMarkers);

  const linePath = scaled
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`)
    .join(' ');
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;
  const markerElements = selectedMarkers.map((marker, index) => {
    const startX = maxDistance > minDistance
      ? ((Number(marker.profileStartKm ?? 0) - minDistance) / (maxDistance - minDistance)) * width
      : 0;
    const endX = maxDistance > minDistance
      ? ((Number(marker.profileEndKm ?? marker.profileStartKm ?? 0) - minDistance) / (maxDistance - minDistance)) * width
      : startX;
    const clampedStartX = Math.max(2, Math.min(width - 2, startX));
    const clampedEndX = Math.max(clampedStartX + 2, Math.min(width - 2, endX));
    const midX = Number((((clampedStartX + clampedEndX) / 2)).toFixed(2));
    const labelY = index % 2 === 0 ? 12 : 24;
    const label = showLabels ? `<text class="route-profile-marker-text ${marker.type}" x="${midX}" y="${labelY}">${abbreviateProfileMarkerName(marker.name, 14)}</text>` : '';

    return `
      <g class="route-profile-marker ${marker.type}">
        <rect class="route-profile-marker-band ${marker.type}" x="${Number(clampedStartX.toFixed(2))}" y="${inset}" width="${Number((clampedEndX - clampedStartX).toFixed(2))}" height="${Number((height - (inset * 2)).toFixed(2))}"></rect>
        <line class="route-profile-marker-tick ${marker.type}" x1="${midX}" y1="${inset}" x2="${midX}" y2="${height - inset}"></line>
        ${label}
      </g>`;
  }).join('');
  const detailedClass = showSummary || showLabels ? ' detailed' : '';
  const contextMarkup = routeProfileContextHTML(route, geometry.scale);
  const summaryMarkup = showSummary ? routeProfileSummaryHTML(selectedMarkers) : '';

  return `
    <div class="route-profile${detailedClass}" aria-label="Route elevation profile">
      <div class="route-profile-header">
        <span class="route-profile-label">Profile ${contextMarkup}</span>
        <span class="route-profile-caption">${displayDist(route.distance)} / ${displayElev(route.elevation)}</span>
      </div>
      <svg class="route-profile-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-hidden="true" style="height:${height}px">
        <path class="route-profile-area" d="${areaPath}"></path>
        ${markerElements}
        <path class="route-profile-line" d="${linePath}"></path>
      </svg>
      ${summaryMarkup}
    </div>`;
}

function routeCardHTML(route, compact, favorites = new Set(), options = {}) {
  const gr    = route.distance > 0 ? (route.elevation / route.distance).toFixed(1) : '—';
  const world = worldName(route.world);

  const settings = getTimeSettings();
  const { minutes: timeMin } = settings;
  const estMin  = estimateRouteMinutes(route, settings, state.trainingData);
  const overTime = estMin > timeMin;
  const overBy   = estMin - timeMin;

  const timeTag = overTime
    ? `<span class="time-tag over-time">~${formatMinutes(estMin)} · +${formatMinutes(overBy)} over</span>`
    : `<span class="time-tag fits-time">~${formatMinutes(estMin)}</span>`;

  const displayTarget = getDisplayTarget(state.wotdStructure, state.bucket);
  const executionFirstLowDay = (state.wotdStructure === 'aerobic_endurance' || state.wotdStructure === null) && displayTarget.mode === 'bucket' && displayTarget.bucket === 'low';
  let bucketXssTag = '';
  let shareFillPct = null;
  let shareBucket = displayTarget.mode === 'mixed' ? 'mixed' : state.bucket;

  // Per-bucket XSS estimates use the same weighted support model as ranking + honesty labels.
  // Lo/hi bounds communicate that rider execution is the variable, not the route.
  const bucketSupport = route.bucketSupport ?? { low: 1, high: 0, peak: 0, source: route.segmentSource ?? 'world' };
  const perBucketXssLo = executionFirstLowDay
    ? { low: Math.round(estimateBucketImpactXss(estMin, 'low') * XSS_RANGE_FLOOR.low), high: 0, peak: 0 }
    : {
      low:  Math.round(estimateBucketImpactXss(estMin, 'low')  * Math.max(bucketSupport.low  ?? 0, 0.15) * XSS_RANGE_FLOOR.low),
      high: Math.round(estimateBucketImpactXss(estMin, 'high') * Math.max(bucketSupport.high ?? 0, 0)    * XSS_RANGE_FLOOR.high),
      peak: Math.round(estimateBucketImpactXss(estMin, 'peak') * Math.max(bucketSupport.peak ?? 0, 0)    * XSS_RANGE_FLOOR.peak),
    };
  const perBucketXssHi = executionFirstLowDay
    ? { low: Math.round(estimateBucketImpactXss(estMin, 'low') * XSS_RANGE_CEIL.low), high: 0, peak: 0 }
    : {
      low:  Math.round(estimateBucketImpactXss(estMin, 'low')  * Math.max(bucketSupport.low  ?? 0, 0.15) * XSS_RANGE_CEIL.low),
      high: Math.round(estimateBucketImpactXss(estMin, 'high') * Math.max(bucketSupport.high ?? 0, 0)    * XSS_RANGE_CEIL.high),
      peak: Math.round(estimateBucketImpactXss(estMin, 'peak') * Math.max(bucketSupport.peak ?? 0, 0)    * XSS_RANGE_CEIL.peak),
    };

  const xssRangeStr = (lo, hi) => lo === hi ? `${lo}` : `${lo}–${hi}`;

  if (displayTarget.mode === 'mixed') {
    const parts = ['low', 'high', 'peak'].map(b => {
      const lo = perBucketXssLo[b], hi = perBucketXssHi[b];
      if (lo === null) return '';
      const rem = state.dailySummary?.remaining?.[b] ?? null;
      const target = rem !== null ? `<span class="xss-target">/${Math.round(rem)}</span>` : '';
      return `<span class="xss-fill ${b}"><span class="bucket-word ${b}">${b.toUpperCase()}</span> ${xssRangeStr(lo, hi)}${target}</span>`;
    }).filter(Boolean);
    bucketXssTag = parts.join('');
  } else {
    const b = displayTarget.bucket;
    shareBucket = b;
    if (b === 'recovery') {
      bucketXssTag = `<span class="xss-fill">${xssRangeStr(perBucketXssLo.low, perBucketXssHi.low)} LOW XSS est.</span>`;
    } else {
      const parts = ['low', 'high', 'peak'].map(bkt => {
        const lo = perBucketXssLo[bkt], hi = perBucketXssHi[bkt];
        if (lo === null || (executionFirstLowDay && bkt !== 'low')) return '';
        const rem = state.dailySummary?.remaining?.[bkt] ?? null;
        if (rem !== null && rem <= 0 && bkt !== b) return '';
        const target = rem !== null ? `<span class="xss-target">/${Math.round(rem)}</span>` : '';
        return `<span class="xss-fill ${bkt}"><span class="bucket-word ${bkt}">${bkt.toUpperCase()}</span> ${xssRangeStr(lo, hi)}${target}</span>`;
      }).filter(Boolean);
      bucketXssTag = parts.join('');
      const bXss = estimateBucketImpactXss(estMin, b);
      const remainingForBucket = state.dailySummary?.remaining?.[b] ?? null;
      shareFillPct = remainingForBucket
        ? Math.min(Math.round(bXss / Math.max(remainingForBucket, 1) * 100), 100)
        : null;
    }
  }

  const routeKey = route.slug || route.name;
  const isFavorited = favorites.has(routeKey);
  const favoriteBtn = `<button class="favorite-btn${isFavorited ? ' favorited' : ''}" data-route-key="${routeKey}" aria-label="Favorite">★</button>`;
  const shareText = buildShareText(route, estMin, shareFillPct, shareBucket);
  const escapedShareText = shareText.replace(/"/g, '&quot;');
  const shareBtn = `<button class="share-btn" data-share-mode="image" data-share-text="${escapedShareText}" aria-label="Copy route card image">Image</button><button class="share-btn share-text-btn" data-share-mode="text" data-share-text="${escapedShareText}" aria-label="Copy route card text">Text</button>`;
  const cls = compact ? 'route-card compact' : 'route-card';
  const favCls = isFavorited ? ` favorited` : '';
  const inspectorMode = Boolean(options.inspectorMode);

  const links = [
    route.zwiftInsiderUrl ? `<a href="${route.zwiftInsiderUrl}" target="_blank" rel="noopener">ZwiftInsider</a>` : '',
    route.whatsOnZwiftUrl ? `<a href="${route.whatsOnZwiftUrl}" target="_blank" rel="noopener">What's on Zwift</a>` : '',
    !inspectorMode ? `<button class="route-nav-link" type="button" data-route-key="${routeKey}" data-nav-action="inspect">Inspect in Route Picker</button>` : '',
    !compact && inspectorMode && options.allowJumpToRecommendation ? `<button class="route-nav-link" type="button" data-route-key="${routeKey}" data-nav-action="recommendation">Jump to recommendation card</button>` : '',
  ].filter(Boolean).join('');
  const status = routeCardStatus(route);
  const honestyFlagText = { 'true-mixed': 'TRUE mixed', 'low-high': 'LOW+HIGH route' };
  const routeFlags = [
    route.leadInDistance > 0.1 ? `<span class="route-flag">+${displayDist(route.leadInDistance)} lead-in</span>` : '',
    route.supportedLaps ? '<span class="route-flag">Lap route</span>' : '',
    route.honestyLabel ? `<span class="route-flag honesty ${route.honestyLabel}">${honestyFlagText[route.honestyLabel]}</span>` : '',
    status.outsideTodayWorlds ? '<span class="route-flag warning">Not in today\'s worlds</span>' : '',
    status.eventOnly ? '<span class="route-flag warning">Event only</span>' : '',
    status.inspectorOnly ? '<span class="route-flag">Direct inspection</span>' : '',
    route.levelLocked ? '<span class="route-flag warning">Level locked</span>' : '',
  ].filter(Boolean).join('');
  const showSegmentRow = route.segmentSource !== 'world';
  const segmentRow = showSegmentRow ? segmentRowHTML(route) : '';
  const routeFacts = [
    `<span class="route-stat">${displayDist(route.distance)}</span>`,
    `<span class="route-stat">${displayElev(route.elevation)}</span>`,
    `<span class="gradient-badge">${displayGrad(parseFloat(gr))}</span>`,
    timeTag,
  ].join('');
  const routeFit = [
    bucketXssTag,
  ].filter(Boolean).join('');
  const profileMarkup = (!compact || options.profile) ? routeProfileSVG(route, options.profile ?? {}) : '';


  return `
    <div class="${cls}${favCls}" data-route-key="${routeKey}">
      <div class="route-card-header">
        <span class="route-world" data-world="${route.world ?? ''}">${world}</span>
        <div class="route-card-actions">
          ${shareBtn}
          ${favoriteBtn}
          <span class="route-score">${route.score}</span>
        </div>
      </div>
      <div class="route-name">${route.name}</div>
      <div class="route-card-meta">
        <div class="route-stats route-stats-primary">
          ${routeFacts}
        </div>
        <div class="route-stats route-stats-secondary">
          ${routeFit}
        </div>
      </div>
      ${route.rideCue ? `<div class="ride-cue"><span class="ride-cue-icon">🎯</span><span>${route.rideCue}</span></div>` : ''}
      ${routeFlags ? `<div class="route-flags">${routeFlags}</div>` : ''}
      ${profileMarkup}
      ${segmentRow}
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

function getTimeSettings() {
  const minutes    = parseInt(document.getElementById('time-available')?.value || '60', 10);
  const rawSpeed   = parseFloat(document.getElementById('avg-speed')?.value || `${DEFAULT_SPEED_KMH}`);
  // Internal calculations always use km/h; convert from mph if user is in imperial
  const speed = getUnits() === 'imperial' ? rawSpeed / KM_TO_MI : rawSpeed;
  return { minutes, mode: state.timingMode, speed };
}

// Gradient penalty factor: effective speed degrades as gradient ratio (m/km) increases.
// Calibrated against real ride data: Flat Out Fast (2.15 m/km) and Sugar Cookie (7.45 m/km).
const GRADIENT_PENALTY_K = 0.065;

function estimateRouteMinutesManual(route, speedKmh) {
  const gradRatio = route.distance > 0 ? (route.elevation ?? 0) / route.distance : 0;
  const effectiveSpeed = speedKmh / (1 + gradRatio * GRADIENT_PENALTY_K);
  return Math.round((route.distance / Math.max(effectiveSpeed, 1)) * 60);
}

function estimateRouteMinutesAuto(route, trainingData) {
  const riderWkg = getRiderWkg(trainingData);
  if (!riderWkg) return estimateRouteMinutesManual(route, DEFAULT_SPEED_KMH);

  const flatSpeed = estimateFlatSpeedKmh(riderWkg);
  const gradRatio = route.distance > 0 ? (route.elevation ?? 0) / route.distance : 0;
  const effectiveSpeed = flatSpeed / (1 + gradRatio * GRADIENT_PENALTY_K);
  return Math.round((route.distance / Math.max(effectiveSpeed, 1)) * 60);
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

function theoreticalRecommendedTimeMinutes() {
  const displayTarget = getDisplayTarget(state.wotdStructure, state.bucket);
  if (displayTarget.mode === 'mixed') {
    const remainingTotal = state.dailySummary?.remaining?.total ?? 0;
    if (remainingTotal <= 0) return TIME_SLIDER_MIN;

    const workoutTotalXss = Number(
      state.rawWotd?.xss ??
      state.rawWotd?.totalXSS ??
      state.rawWotd?.total_xss ??
      state.rawWotd?.workoutXss ??
      state.rawWotd?.plannedXSS
    );
    const workoutDurationMin = wotdDurationMinutes(state.rawWotd);

    if (Number.isFinite(workoutTotalXss) && workoutTotalXss > 0 && Number.isFinite(workoutDurationMin) && workoutDurationMin > 0) {
      return snapMinutes((remainingTotal / workoutTotalXss) * workoutDurationMin);
    }

    const blendedRate = ((XSS_RATE.low ?? 0) + (XSS_RATE.high ?? 0) + (XSS_RATE.peak ?? 0)) / 3;
    return snapMinutes((remainingTotal / Math.max(blendedRate, 1)) * 60);
  }

  if (displayTarget.bucket === 'recovery') {
    return snapMinutes(45);
  }

  const remainingXss = state.dailySummary?.remaining?.[displayTarget.bucket] ?? 0;
  const xssRate = XSS_RATE[displayTarget.bucket] ?? 65;
  return snapMinutes((remainingXss / Math.max(xssRate, 1)) * 60);
}

function firstViableRouteMinutes(theoreticalMinutes) {
  for (let minutes = theoreticalMinutes; minutes <= TIME_SLIDER_MAX; minutes += TIME_SLIDER_STEP) {
    if (hasViableRouteAtMinutes(minutes)) return minutes;
  }
  return null;
}

function recommendedTimeScenarioKey() {
  const riderWkg = getRiderWkg(state.trainingData);
  const timingSettings = getTimeSettings();
  const context = activeWorldContext();
  return JSON.stringify({
    bucket: state.bucket,
    wotdStructure: state.wotdStructure,
    dataSourceId: state.dataSourceId,
    todayOnly: state.todayOnly,
    worlds: context.worlds,
    source: context.source,
    timingMode: state.timingMode,
    manualSpeed: state.timingMode === 'manual' ? timingSettings.speed : null,
    riderWkg: Number.isFinite(riderWkg) ? riderWkg.toFixed(3) : null,
    remaining: state.dailySummary?.remaining ?? null,
    rawWotdXss: state.rawWotd?.xss ?? state.rawWotd?.totalXSS ?? state.rawWotd?.plannedXSS ?? null,
    rawWotdDuration: wotdDurationMinutes(state.rawWotd),
  });
}

function hasViableRouteAtMinutes(minutes) {
  const candidateSettings = recommendationSettingsForMinutes(minutes);
  const evaluated = getEvaluatedRoutes(candidateSettings);
  return evaluated.some(route => routeRecommendationViable(route) && (route.estimatedMinutes ?? Infinity) <= minutes);
}

function getRecommendedTimeGuidance() {
  if (!state.trainingData || !state.dailySummary) return null;
  const cacheKey = recommendedTimeScenarioKey();
  if (recommendedTimeCache.key === cacheKey) {
    return recommendedTimeCache.value;
  }

  const theoreticalMinutes = theoreticalRecommendedTimeMinutes();
  const firstViableMinutes = firstViableRouteMinutes(theoreticalMinutes);
  const recommendedMinutes = Number.isFinite(firstViableMinutes)
    ? Math.max(theoreticalMinutes, firstViableMinutes)
    : null;
  const guidance = {
    theoreticalMinutes,
    firstViableMinutes,
    recommendedMinutes,
  };

  recommendedTimeCache = { key: cacheKey, value: guidance };
  return guidance;
}

function getRecommendedTimeMinutes() {
  return getRecommendedTimeGuidance()?.recommendedMinutes ?? null;
}

function updateTimeLabel() {
  const slider = document.getElementById('time-available');
  const label = document.getElementById('time-label');
  if (!slider || !label) return;
  label.textContent = formatClockMinutes(parseInt(slider.value || '60', 10));
}

function applyTimeAvailable(minutes) {
  const slider = document.getElementById('time-available');
  if (!slider) return;
  slider.value = String(snapMinutes(minutes));
  updateTimeLabel();
  if (state.trainingData) {
    recomputeRankedRoutes();
    renderTimeSummary();
    renderRoutes();
    renderRouteInspector();
  }
}

function renderTimeSummary() {
  if (!state.trainingData) return;
  const d = state.trainingData;
  const displayTarget = getDisplayTarget(state.wotdStructure, state.bucket);
  const { minutes: timeMin, mode } = getTimeSettings();
  const riderWkg = getRiderWkg(d);
  const timingLead = mode === 'manual'
    ? 'Using your manual pace, '
    : riderWkg
      ? `Using your ${riderWkg.toFixed(1)} W/kg profile, `
      : `Using a default ${displaySpeed(DEFAULT_SPEED_KMH)} pace, `;

  const el = document.getElementById('time-summary');
  if (!el) return;

  if (state.bucketOverride) {
    el.textContent = 'With your current fatigue level, keep today\'s ride short and easy.';
    return;
  }
  const availability = recommendationAvailability(getTimeSettings());
  const noViableWithinBudget = availability.viableWithinBudget.length === 0;
  const guidance = getRecommendedTimeGuidance();
  const firstViableMinutes = guidance?.firstViableMinutes ?? null;
  const theoreticalMinutes = guidance?.theoreticalMinutes ?? null;
  const theoreticalMismatch = (
    Number.isFinite(theoreticalMinutes) &&
    Number.isFinite(firstViableMinutes) &&
    firstViableMinutes > theoreticalMinutes
  );
  const noViableAnywhere = !Number.isFinite(firstViableMinutes);

  if (displayTarget.mode === 'mixed') {
    const remainingTotal = state.dailySummary?.remaining?.total ?? 0;
    const estimatedXss = estimateWorkoutLoadXss(timeMin, state.rawWotd, remainingTotal);
    if (estimatedXss !== null) {
      const fillPct = remainingTotal > 0
        ? Math.min(Math.round(estimatedXss / Math.max(remainingTotal, 1) * 100), 100)
        : 100;
      el.innerHTML =
        `${timingLead}${formatDurationText(timeMin)} should support roughly ${estimatedXss} XSS of today's mixed workout` +
        ` — about ${fillPct}% of today's remaining <span class="bucket-word low">low</span> + <span class="bucket-word high">high</span> + <span class="bucket-word peak">peak</span> gap.`;
    } else {
      el.innerHTML =
        `${timingLead}${formatDurationText(timeMin)} should support today's mixed workout across your remaining ` +
        `<span class="bucket-word low">low</span> + <span class="bucket-word high">high</span> + <span class="bucket-word peak">peak</span> load.`;
    }
    if (noViableWithinBudget) {
      if (theoreticalMismatch) {
        el.innerHTML += ` Bucket math says about ${formatClockMinutes(theoreticalMinutes)}, but the first honest route fit starts around ${formatClockMinutes(firstViableMinutes)}, so the best options below are longer or compromise venues.`;
      } else if (noViableAnywhere) {
        el.innerHTML += ' No route currently fits that workload honestly anywhere in the current slider range, so the best options below are compromise venues only.';
      } else {
        el.innerHTML += ` No route currently fits that workload honestly inside this time budget, so the best options below are longer or compromise venues.`;
      }
    }
    return;
  }

  const b = displayTarget.bucket;
  const xssRate = XSS_RATE[b] ?? 65;
  const estimatedXss = Math.round((timeMin / 60) * xssRate);
  const remainingXss = (b !== 'recovery') ? state.dailySummary.remaining[b] : null;

  if (b === 'recovery' || !remainingXss) {
    el.textContent = `${timingLead}with ${formatDurationText(timeMin)} available, an easy spin is plenty today.`;
  } else {
    const fillPct = Math.min(Math.round(estimatedXss / Math.max(remainingXss, 1) * 100), 100);
    el.textContent =
      `${timingLead}${formatDurationText(timeMin)} should generate roughly ${estimatedXss} XSS` +
      ` — about ${fillPct}% of today's remaining ${b.toUpperCase()} gap (${remainingXss.toFixed(0)} XSS).`;
  }
  if (noViableWithinBudget && b !== 'recovery' && remainingXss > 0) {
    if (theoreticalMismatch) {
      el.textContent += ` Bucket math says about ${formatClockMinutes(theoreticalMinutes)}, but the first honest route fit starts around ${formatClockMinutes(firstViableMinutes)}.`;
    } else if (noViableAnywhere) {
      el.textContent += ' No current route actually fits that budget honestly anywhere in the current slider range, so only approximation venues remain.';
    } else {
      el.textContent += ' No current route actually fits that budget honestly, so you will need more time or an approximation.';
    }
  }
}

function renderLastUpdated() {
  const el = document.getElementById('last-updated');
  if (!state.lastUpdated) { el.textContent = ''; return; }
  const prefix = isLiveDataSource() ? 'Updated' : 'Mock data loaded';
  el.textContent = `${prefix} ${state.lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

// ── UI helpers ────────────────────────────────────

function showAuth(message) {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').classList.remove('visible');
  renderSourceNotes();
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


function populateDataSourceOptions() {
  const authSelect = document.getElementById('auth-data-source');
  const settingsSelect = document.getElementById('settings-data-source');
  const optionsHtml = DATA_SOURCE_OPTIONS.map(option =>
    `<option value="${option.id}">${option.label}</option>`
  ).join('');
  authSelect.innerHTML = optionsHtml;
  settingsSelect.innerHTML = optionsHtml;
}

function syncDataSourceControls() {
  document.getElementById('auth-data-source').value = state.dataSourceId;
  document.getElementById('settings-data-source').value = state.dataSourceId;
}

function renderSourceNotes() {
  const authBtn = document.getElementById('auth-btn');
  const scenarioBtn = document.getElementById('auth-scenario-btn');
  const authNote = document.getElementById('auth-source-note');
  const settingsNote = document.getElementById('settings-source-note');
  const live = isLiveDataSource();
  const scenario = getMockScenario();

  authBtn.disabled = !live;
  authBtn.textContent = 'Sign in';
  scenarioBtn.style.display = live ? 'none' : 'block';
  authNote.textContent = live
    ? 'Live Xert uses real account data. Mock scenarios are available below for testing only.'
    : `${scenario?.title ?? 'Mock'} scenario loaded for testing.`;
  settingsNote.textContent = live
    ? 'Live Xert is the default.'
    : `${scenario?.title ?? 'Mock'} scenario active for testing.`;
}

function getManualSpeedBounds() {
  if (getUnits() === 'imperial') {
    return {
      min: Math.round(MANUAL_SPEED_MIN_KMH * KM_TO_MI),
      max: Math.round(MANUAL_SPEED_MAX_KMH * KM_TO_MI),
      step: 1,
    };
  }

  return { min: MANUAL_SPEED_MIN_KMH, max: MANUAL_SPEED_MAX_KMH, step: 1 };
}

function updateManualSpeedBounds() {
  const speedInput = document.getElementById('avg-speed');
  const { min, max, step } = getManualSpeedBounds();
  speedInput.min = String(min);
  speedInput.max = String(max);
  speedInput.step = String(step);
  const currentVal = parseFloat(speedInput.value);
  if (Number.isFinite(currentVal)) {
    speedInput.value = String(clamp(Math.round(currentVal), min, max));
  }
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
  updateManualSpeedBounds();

  renderTimingControls();
  if (state.trainingData) {
    recomputeRankedRoutes();
    renderTimeSummary();
    renderRoutes();
    renderRouteInspector();
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
    recomputeRankedRoutes();
    renderTimeSummary();
    renderRoutes();
    renderRouteInspector();
  }
}

function updateGuestWorldsLabel() {
  const context = activeWorldContext();
  const label = document.getElementById('today-worlds-label');
  label.textContent = formatWorldContextLabel(context, worldName);
  label.title = formatWorldContextSourceDetail(context);

  const hint = document.querySelector('.world-cb-hint');
  if (hint) {
    hint.textContent = context.source === 'manual fallback'
      ? 'Fallback mode: select up to 2 guest worlds alongside Watopia.'
      : `Current worlds are coming from ${context.source}. Manual picks stay hidden unless all live and fallback sources fail.`;
  }
}

function updateGuestWorldsPickerVisibility() {
  const context = activeWorldContext();
  document.getElementById('guest-worlds-picker').style.display =
    state.todayOnly && context.source === 'manual fallback' ? '' : 'none';
}

function updateGuestWorldCheckboxes() {
  const cbs = [...document.querySelectorAll('.guest-world-cb')];
  const selectedCount = cbs.filter(cb => cb.checked).length;
  cbs.forEach(cb => {
    if (!cb.checked) cb.disabled = selectedCount >= 2;
  });
}

function renderTimingControls() {
  const autoBtn = document.getElementById('timing-auto');
  const manualBtn = document.getElementById('timing-manual');
  const manualRow = document.getElementById('manual-speed-row');
  const hintEl = document.getElementById('timing-hint');
  const recommendedBtn = document.getElementById('time-recommended');
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

  if (recommendedBtn) {
    const recommended = getRecommendedTimeMinutes();
    recommendedBtn.disabled = !recommended;
    recommendedBtn.textContent = recommended
      ? `Use recommended time (${formatClockMinutes(recommended)})`
      : 'Use recommended time';
  }
}

function getRiderWkg(trainingData) {
  const ftp = trainingData?.signature?.ftp;
  const weight = trainingData?.weight;
  if (!ftp || !weight) return null;
  return ftp / weight;
}

function estimateFlatSpeedKmh(riderWkg) {
  return clamp(20 + riderWkg * 5, 20, 42);
}

function estimateBucketImpactXss(minutes, bucket) {
  return Math.round((minutes / 60) * (XSS_RATE[bucket] ?? 0));
}

function getLocalDayKey(ts) {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function firstNumeric(...values) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return 0;
}

function summarizeActivityXss(source) {
  const summary = source?.summary ?? source ?? {};
  return {
    low: firstNumeric(summary?.xlss, summary?.lowXSS, summary?.low, summary?.low_xss),
    high: firstNumeric(summary?.xhss, summary?.highXSS, summary?.high, summary?.high_xss),
    peak: firstNumeric(summary?.xpss, summary?.peakXSS, summary?.peak, summary?.peak_xss),
    total: firstNumeric(summary?.xss, summary?.totalXSS, summary?.total_xss, summary?.workoutXss, summary?.plannedXSS),
  };
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

function getSummaryQueryRangeLocal() {
  const { from, to } = getTodayRangeLocal();
  const bufferSeconds = DAILY_SUMMARY_BUFFER_HOURS * 60 * 60;
  return {
    from: from - bufferSeconds,
    to: to + bufferSeconds,
  };
}

function parseTimestampMs(value) {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }

  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim() !== '') {
      return numeric > 1e12 ? numeric : numeric * 1000;
    }

    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

function firstTimestampMs(...values) {
  for (const value of values) {
    const parsed = parseTimestampMs(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function activityTimestampMs(activity, detail) {
  return firstTimestampMs(
    detail?.start_date,
    detail?.startDate,
    detail?.date,
    detail?.timestamp,
    detail?.datetime,
    detail?.summary?.start_date,
    activity?.start_date,
    activity?.startDate,
    activity?.date,
    activity?.timestamp,
    activity?.datetime
  );
}

async function fetchTodaysDailySummary(targetXSS, username, password) {
  const { from, to } = getSummaryQueryRangeLocal();
  const todayKey = getLocalDayKey(Date.now());
  const list = await fetchActivitiesInRange(from, to, username, password);
  const activities = Array.isArray(list.activities) ? list.activities : [];
  const activitiesWithPath = [...new Map(
    activities
      .filter(activity => activity?.path)
      .map(activity => [activity.path, activity])
  ).values()];
  const activitiesWithoutPath = activities.filter(activity => !activity?.path);
  const detailResults = await Promise.allSettled(
    activitiesWithPath.map(activity => fetchActivityDetail(activity.path, username, password))
  );

  const completed = {
    low: 0,
    high: 0,
    peak: 0,
    total: 0,
  };

  let countedActivities = 0;
  let fallbackCount = 0;
  let failedCount = 0;

  for (let i = 0; i < activitiesWithPath.length; i += 1) {
    const result = detailResults[i];
    const activity = activitiesWithPath[i];
    const usableSource = result?.status === 'fulfilled' ? result.value : activity;

    if (result?.status !== 'fulfilled') {
      failedCount += 1;
      if (!activity?.summary) {
        continue;
      }
      fallbackCount += 1;
    }

    const detail = result?.status === 'fulfilled' ? result.value : null;
    const timestampMs = activityTimestampMs(activity, detail);
    if (timestampMs !== null && getLocalDayKey(timestampMs) !== todayKey) {
      continue;
    }

    const totals = summarizeActivityXss(usableSource);
    completed.low += totals.low;
    completed.high += totals.high;
    completed.peak += totals.peak;
    completed.total += totals.total;
    countedActivities += 1;
  }

  for (const activity of activitiesWithoutPath) {
    if (!activity?.summary) continue;

    const timestampMs = activityTimestampMs(activity, null);
    if (timestampMs !== null && getLocalDayKey(timestampMs) !== todayKey) {
      continue;
    }

    const totals = summarizeActivityXss(activity);
    completed.low += totals.low;
    completed.high += totals.high;
    completed.peak += totals.peak;
    completed.total += totals.total;
    countedActivities += 1;
    fallbackCount += 1;
  }

  const targets = {
    low: targetXSS?.low ?? 0,
    high: targetXSS?.high ?? 0,
    peak: targetXSS?.peak ?? 0,
    total: targetXSS?.total ?? 0,
  };

  const remaining = {
    low: Math.max(targets.low - completed.low, 0),
    high: Math.max(targets.high - completed.high, 0),
    peak: Math.max(targets.peak - completed.peak, 0),
    total: Math.max(targets.total - completed.total, 0),
  };
  console.log('[coverage-debug] daily summary', {
    targetXSS_low: targets.low,
    targetXSS_high: targets.high,
    targetXSS_peak: targets.peak,
    completed_low: completed.low,
    completed_high: completed.high,
    completed_peak: completed.peak,
    remaining_low: remaining.low,
    remaining_high: remaining.high,
    remaining_peak: remaining.peak,
    activityCount: countedActivities,
  });

  return {
    count: countedActivities,
    totalActivities: activities.length,
    detailedCount: countedActivities - fallbackCount,
    fallbackCount,
    failedCount,
    completed,
    targets,
    remaining,
  };
}

// ── Event wiring ──────────────────────────────────

document.getElementById('auth-form').addEventListener('submit', handleLogin);
document.getElementById('refresh-btn').addEventListener('click', handleRefresh);
document.getElementById('logout-btn').addEventListener('click', handleLogout);

document.getElementById('time-available').addEventListener('input', () => {
  updateTimeLabel();
  if (state.trainingData) {
    recomputeRankedRoutes();
    renderTimeSummary();
    renderRoutes();
    renderRouteInspector();
  }
});

document.getElementById('avg-speed').addEventListener('change', () => {
  if (state.trainingData) {
    recomputeRankedRoutes();
    renderTimeSummary();
    renderRoutes();
    renderRouteInspector();
  }
});

document.getElementById('avg-speed').addEventListener('input', () => {
  if (state.trainingData && state.timingMode === 'manual') {
    recomputeRankedRoutes();
    renderTimeSummary();
    renderRoutes();
    renderRouteInspector();
  }
});

document.getElementById('time-recommended').addEventListener('click', () => {
  const recommended = getRecommendedTimeMinutes();
  if (recommended) {
    applyTimeAvailable(recommended);
  }
});

document.getElementById('today-only-toggle').addEventListener('change', (e) => {
  state.todayOnly = e.target.checked;
  localStorage.setItem('today-only', state.todayOnly);
  updateGuestWorldsPickerVisibility();
  if (state.trainingData) {
    recomputeRankedRoutes();
    renderRoutes();
    renderRouteInspector();
  }
});

document.getElementById('guest-worlds-picker').addEventListener('change', () => {
  const checked = [...document.querySelectorAll('.guest-world-cb:checked')].map(el => el.value);
  state.guestWorlds = checked.slice(0, 2);
  saveGuestWorlds(state.guestWorlds);
  state.worldContext = getWorldScheduleContext(state.guestWorlds);
  updateGuestWorldsLabel();
  updateGuestWorldsPickerVisibility();
  updateGuestWorldCheckboxes();
  if (state.trainingData) {
    recomputeRankedRoutes();
    renderRoutes();
    renderRouteInspector();
  }
  void refreshWorldContext();
});

document.getElementById('inspector-search').addEventListener('input', () => {
  populateRoutePickerOptions();
});

document.getElementById('inspector-world-filter').addEventListener('change', () => {
  populateRoutePickerOptions();
});

document.getElementById('inspector-bucket-filter').addEventListener('change', () => {
  populateRoutePickerOptions();
});

document.getElementById('route-picker').addEventListener('change', (e) => {
  state.selectedRouteKey = e.target.value;
  localStorage.setItem(ROUTE_PICKER_KEY, state.selectedRouteKey);
  renderRouteInspector();
});

document.getElementById('other-toggle').addEventListener('click', () => {
  const list   = document.getElementById('other-list');
  const toggle = document.getElementById('other-toggle');
  const open   = list.classList.toggle('open');
  const count  = countRouteCards(list);
  const hidden = parseInt(toggle.dataset.hiddenCount ?? '0', 10);
  const hiddenNote = hidden > 0 ? ` · ${hidden} not shown` : '';
  toggle.textContent = `${open ? '▲' : '▼'} Other options (${count} more${hiddenNote})`;
});

document.getElementById('more-time-toggle').addEventListener('click', () => {
  const list   = document.getElementById('more-time-list');
  const toggle = document.getElementById('more-time-toggle');
  const open   = list.classList.toggle('open');
  const count  = countRouteCards(list);
  const hidden = parseInt(toggle.dataset.hiddenCount ?? '0', 10);
  const hiddenNote = hidden > 0 ? ` · ${hidden} not shown` : '';
  toggle.textContent = `${open ? '▲' : '▼'} If you had more time (${count} routes${hiddenNote})`;
});

document.getElementById('units-metric').addEventListener('click', () => applyUnits('metric'));
document.getElementById('units-imperial').addEventListener('click', () => applyUnits('imperial'));
document.getElementById('timing-auto').addEventListener('click', () => setTimingMode('auto'));
document.getElementById('timing-manual').addEventListener('click', () => setTimingMode('manual'));
document.getElementById('auth-scenario-btn').addEventListener('click', () => loadMockScenario());
document.getElementById('auth-data-source').addEventListener('change', async (e) => {
  state.dataSourceId = e.target.value;
  localStorage.setItem(DATA_SOURCE_KEY, state.dataSourceId);
  syncDataSourceControls();
  renderSourceNotes();
  hideError();
  if (!isLiveDataSource()) {
    loadMockScenario();
  }
});
document.getElementById('settings-data-source').addEventListener('change', async (e) => {
  state.dataSourceId = e.target.value;
  localStorage.setItem(DATA_SOURCE_KEY, state.dataSourceId);
  syncDataSourceControls();
  renderSourceNotes();
  hideError();

  if (isLiveDataSource()) {
    const username = document.getElementById('settings-username').value.trim();
    const password = document.getElementById('settings-password').value;
    if (hasToken() || username || password) {
      await refresh(username || undefined, password || undefined);
    } else {
      showAuth('Switch back to Live Xert and sign in to fetch real data.');
    }
    return;
  }

  loadMockScenario();
});

// ── Delegated: Share button ───────────────────────

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas produced no PNG blob')), 'image/png');
  });
}

function fullSequenceCount(details) {
  const summaryText = details?.querySelector('summary')?.textContent ?? '';
  const match = summaryText.match(/\((\d+)\s+efforts?\)/i);
  return match ? Number(match[1]) : 0;
}

function prepareRouteCardCloneForShare(clonedCard) {
  if (!clonedCard) return;

  clonedCard.querySelectorAll('.segment-row').forEach(row => {
    const details = row.querySelector('.segment-details');
    const totalCount = fullSequenceCount(details);
    details?.remove();

    const chips = Array.from(row.querySelectorAll('.segment-chips:not(.segment-chips-full) .segment-chip'));
    const shareLimit = 4;
    chips.slice(shareLimit).forEach(chip => chip.remove());

    if (totalCount > shareLimit && chips.length > shareLimit) {
      const moreChip = row.ownerDocument.createElement('span');
      moreChip.className = 'segment-chip segment';
      moreChip.textContent = `+${totalCount - shareLimit} more`;
      row.querySelector('.segment-chips')?.appendChild(moreChip);
    }
  });
}

async function renderRouteCardPng(card) {
  if (!card) { console.error('[copy-image] card element not found'); return null; }
  if (!window.html2canvas) { console.error('[copy-image] html2canvas not loaded (CDN blocked?)'); return null; }
  const canvas = await window.html2canvas(card, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#1a1a1a',
    onclone: (_document, clonedCard) => prepareRouteCardCloneForShare(clonedCard),
  }).catch(err => { console.error('[copy-image] html2canvas render failed:', err); return null; });
  if (!canvas) return null;
  return canvasToPngBlob(canvas).catch(err => { console.error('[copy-image] toBlob failed:', err); return null; });
}

async function writeClipboardItem(items) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Rich clipboard unavailable');
  }
  await navigator.clipboard.write([new ClipboardItem(items)]);
}

async function copyRouteCardToClipboard(card, text) {
  const pngBlob = await renderRouteCardPng(card).catch(() => null);

  if (pngBlob) {
    await writeClipboardItem({ 'image/png': pngBlob });
    return 'image';
  }

  await navigator.clipboard.writeText(text);
  return 'text';
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.share-btn');
  if (!btn) return;
  const text = btn.getAttribute('data-share-text') || '';
  const card = btn.closest('.route-card');
  const mode = btn.getAttribute('data-share-mode') || 'image';
  const idleLabel = btn.textContent;

  const finish = (label, success) => {
    btn.textContent = label;
    btn.classList.toggle('copied', success);
    setTimeout(() => { btn.textContent = idleLabel; btn.classList.remove('copied'); }, 1500);
  };

  try {
    if (mode === 'text') {
      await navigator.clipboard.writeText(text);
      finish('Text copied', true);
      return;
    }

    const copied = await copyRouteCardToClipboard(card, text);
    finish(copied === 'image' ? 'Image copied!' : 'Text copied', true);
  } catch (err) {
    console.error('[copy-image] clipboard write failed:', err);
    navigator.clipboard.writeText(text)
      .then(() => finish('Text copied', true))
      .catch(() => finish('Error', false));
  }
});

// ── Delegated: Favorite button ────────────────────

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.favorite-btn');
  if (!btn) return;
  const routeKey = btn.getAttribute('data-route-key');
  if (!routeKey) return;
  const favs = loadFavorites();
  if (favs.has(routeKey)) {
    favs.delete(routeKey);
  } else {
    favs.add(routeKey);
  }
  saveFavorites(favs);
  const isFav = favs.has(routeKey);
  btn.classList.toggle('favorited', isFav);
  // Update all cards with this route key (card may appear in multiple lists)
  document.querySelectorAll(`.route-card[data-route-key="${CSS.escape(routeKey)}"]`).forEach(card => {
    card.classList.toggle('favorited', isFav);
  });
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.route-nav-link');
  if (!btn) return;
  const routeKey = btn.getAttribute('data-route-key');
  const action = btn.getAttribute('data-nav-action');
  if (!routeKey || !action) return;

  if (action === 'inspect') {
    jumpToInspector(routeKey);
    return;
  }

  if (action === 'recommendation') {
    jumpToRecommendationCard(routeKey);
  }
});

init();


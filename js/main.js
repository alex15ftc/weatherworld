import { Atmosphere } from './atmosphere.js?v=2.20.1';
import { Renderer } from './renderer.js?v=2.25.1';
import { generateScenario } from './scenarios/scenarioGenerator.js?v=2.20.1';
import { initializeEvolution, advanceAtmosphere } from './evolution.js?v=2.20.1';
import { SIMULATION_CONFIG } from './simulationConfig.js?v=2.20.1';
import { UI } from './ui.js?v=2.25.1';
import { buildSounding, drawSounding, drawHodograph } from './sounding.js?v=2.20.1';
import { getOutlookSpec, updatePredictiveOutlooks } from './forecast/OutlookCycleEngine.js?v=2.20.1';
import { WorldStateStore } from './world/WorldStateStore.js?v=2.20.1';
import { WeatherAuthorityClock, SIM_HOURS_PER_STEP } from './world/WeatherAuthority.js?v=2.20.1';
import { hydrateStormInternalField, serializeStormInternalField } from './storms/StormInternalField.js?v=2.20.1';
import { WeatherProductClient } from './api/WeatherProductClient.js?v=2.20.1';
import { buildOutlookDiscussion } from './forecast/OutlookDiscussionEngine.js?v=2.25.1';
import { TimelinePrecomputeClient } from './api/TimelinePrecomputeClient.js?v=2.27.3';

const worldStore = new WorldStateStore();
const productClient = new WeatherProductClient();
let activeTimelineClient = null;
let activeTimelineDescriptor = null;
let upcomingTimelineClient = null;
let activeTimelineFrameCache = new Map();
let activeTimelinePrefetching = new Set();
let activeTimelineGeneration = 0;
let persistDebounceTimer = null;
const authorityOwnerId = globalThis.crypto?.randomUUID?.() ?? `weather-page-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let persistedRevision = 0;
const authorityClock = new WeatherAuthorityClock();
const PAGE_MODE = document.body?.dataset?.page ?? 'live';
const FIXED_OUTLOOK_DAY = PAGE_MODE.startsWith('day') ? PAGE_MODE : null;
const ui = new UI();
let atmosphere = new Atmosphere(SIMULATION_CONFIG.defaultColumns, SIMULATION_CONFIG.defaultRows);
const renderer = new Renderer(ui.canvas, atmosphere);
renderer.forecastDay = FIXED_OUTLOOK_DAY ?? 'day1';
let currentConfig = null;
let playTimer = null;
let liveTimer = null;
let systemNumber = 1;
let upcomingSystem = null;
let persistedUpcomingSeed = null;
let systemStartHour = 12;
let playGeneration = 0;
let seekGeneration = 0;
let selectedSoundingCell = null;
let hourlyStateCache = new Map();
let seekDebounceTimer = null;
let renderFrame = null;
let pendingLayerOnly = false;
let pendingForceFullRender = false;
let soundingRenderKey = '';
let activeStateIsCached = false;
let renderFast = false;
let metadataFrame = null;
let playTick = 0;
let scenarioRevision = 0;
let authorityRealTimestamp = Date.now();
let authorityTimer = null;
let remoteAuthorityMode = false;
let productArchive = { day1: [], day2: [], day3: [] };
let catchupInProgress = false;
const SEEK_DEBOUNCE_MS = 90;
const FULL_PLAY_REFRESH_INTERVAL = 3;
const PLAY_DELAY_MS = 650;
const LIVE_TICK_MS = 120_000;
const LIVE_SIM_HOURS_PER_TICK = 0.5;
const SYSTEM_CYCLE_HOURS = 72;
const UPCOMING_PRECOMPUTE_LEAD_HOURS = 36;
const SEEK_STEPS_PER_FRAME = 2;
const SESSION_SNAPSHOT_KEY = 'fake-plains-weather-session-snapshot-v2.20.1';
const SESSION_SNAPSHOT_MIN_INTERVAL_MS = 15000;
const TIMELINE_CACHE_RADIUS_STEPS = 8;
const TIMELINE_CACHE_MAX_FRAMES = 32;
const PERSIST_DEBOUNCE_MS = 1200;
let lastSessionSnapshotWrite = 0;
let sessionSnapshotDirty = false;

function generate({ persist = true, seed = Number(ui.seed.value), baseHour = SIMULATION_CONFIG.startHourUtc, systemIndex = 1 } = {}) {
  stopPlaying();
  stopLiveMode();
  const width = SIMULATION_CONFIG.fixedColumns;
  const height = SIMULATION_CONFIG.fixedRows;
  ui.width.value = width;
  ui.height.value = height;
  atmosphere.resize(width, height);
  renderer.atmosphere = atmosphere;
  renderer.selectedCell = null;
  renderer.hoverCell = null;
  renderer.resize();
  scenarioRevision += 1;
  ui.seed.value = seed;
  currentConfig = generateScenario(atmosphere, seed);
  upcomingSystem = null;
  persistedUpcomingSeed = null;
  atmosphere.upcomingSystemForecast = null;
  initializeEvolution(atmosphere, currentConfig);
  systemStartHour = baseHour;
  systemNumber = systemIndex;
  atmosphere.validHourUtc = baseHour;
  if (atmosphere.evolution) atmosphere.evolution.elapsedHours = 0;
  setForecastContext();
  updatePredictiveOutlooks(atmosphere, { force: true });
  currentConfig = { ...currentConfig, ...atmosphere.evolution.outlookAnalysis };
  hourlyStateCache = new Map();
  cacheCurrentState();
  updateAll();
  startActiveTimeline({ seed, startHourUtc: baseHour });
  ui.cellTitle.textContent = 'No cell selected';
  ui.info.className = 'cell-info muted';
  ui.info.textContent = 'Click a cell to open its atmospheric profile and sounding.';
  ui.openSounding.disabled = true;
  selectedSoundingCell = null;
  if (persist) {
    authorityRealTimestamp = Date.now();
    productArchive = { day1: [], day2: [], day3: [] };
    persistWorldState();
  }
}

function advance(hours = 0.5, { authorityCatchup = false, persist = true } = {}) {
  if (!currentConfig) return;
  detachCachedStateForMutation();
  const analysis = advanceAtmosphere(atmosphere, hours);
  currentConfig = { ...currentConfig, ...analysis };
  cacheCurrentState();
  maybeCycleProceduralSystem();
  playTick += 1;
  if (playTimer && playTick % FULL_PLAY_REFRESH_INTERVAL !== 0) updateFastFrame();
  else updateAll();
  if (!authorityCatchup) authorityRealTimestamp = Date.now();
  if (persist) persistWorldState();
}

async function seekToHour(targetHour, { preview = false } = {}) {
  const target = clampInteger(targetHour, SIMULATION_CONFIG.startHourUtc, SIMULATION_CONFIG.endHourUtc);
  stopPlaying();
  const generation = ++seekGeneration;

  if (await restorePrecomputedFrame(target)) {
    if (generation !== seekGeneration) return;
    if (preview) updateFastFrame();
    else updateAll();
    return;
  }

  if (restoreCachedState(target)) {
    if (preview) updateFastFrame();
    else updateAll();
    return;
  }

  const cachedHour = nearestCachedHourAtOrBefore(target);
  if (cachedHour !== null) restoreCachedState(cachedHour);
  else generate();

  if (target > atmosphere.validHourUtc) {
    detachCachedStateForMutation();
    let stepsThisFrame = 0;
    while (atmosphere.validHourUtc < target) {
      if (generation !== seekGeneration) return;
      const analysis = advanceAtmosphere(atmosphere, 0.5);
      currentConfig = { ...currentConfig, ...analysis };
      cacheCurrentState();
      stepsThisFrame += 1;
      if (stepsThisFrame >= SEEK_STEPS_PER_FRAME && atmosphere.validHourUtc < target) {
        updateFastFrame();
        stepsThisFrame = 0;
        await nextAnimationFrame();
      }
    }
  }
  if (preview) updateFastFrame();
  else updateAll();
}

async function restorePrecomputedFrame(targetHour) {
  if (!activeTimelineClient || !activeTimelineDescriptor) return false;
  const offset = targetHour - systemStartHour;
  if (offset < -1e-6 || offset > SYSTEM_CYCLE_HOURS + 1e-6) return false;
  const frameIndex = Math.round(offset / 0.5);
  const cached = activeTimelineFrameCache.get(frameIndex);
  if (cached) {
    applyTimelineFrame(cached);
    prefetchTimelineWindow(frameIndex);
    return true;
  }
  const availableHours = Number(activeTimelineDescriptor.completedHours ?? 0);
  if (activeTimelineDescriptor.status !== 'ready' && offset > availableHours + 1e-6) return false;
  try {
    const started = performance.now();
    const frame = await activeTimelineClient.getFrame(offset);
    frame.navigationTiming = { transferMs: performance.now() - started };
    rememberTimelineFrame(frameIndex, frame);
    applyTimelineFrame(frame);
    prefetchTimelineWindow(frameIndex);
    return true;
  } catch (error) {
    console.warn('[weather-sim] Unable to restore precomputed frame; falling back to live evolution.', error);
    return false;
  }
}

function applyTimelineFrame(state) {
  const dimensionsChanged = atmosphere.width !== Number(state.width) || atmosphere.height !== Number(state.height);
  atmosphere.width = Number(state.width) || SIMULATION_CONFIG.fixedColumns;
  atmosphere.height = Number(state.height) || SIMULATION_CONFIG.fixedRows;
  atmosphere.validHourUtc = Number(state.validHourUtc);
  atmosphere.cells = state.cells;
  atmosphere.evolution = state.evolution;
  atmosphere.analysis = state.analysis;
  atmosphere.storms = state.storms ?? [];
  for (const storm of atmosphere.storms) if (storm.internalField) storm.internalField = hydrateStormInternalField(storm.internalField);
  atmosphere.stormEngine = state.stormEngine;
  atmosphere.stormOutflows = state.stormOutflows ?? [];
  atmosphere.mesoscale = state.mesoscale;
  atmosphere.airMassEngine = state.airMassEngine;
  atmosphere.regions = state.regions ?? [];
  atmosphere.synopticCoherence = state.synopticCoherence;
  atmosphere.setupForecast = state.setupForecast;
  atmosphere.outlookCycle = state.outlookCycle;
  atmosphere.upcomingSystemForecast = state.upcomingSystemForecast;
  atmosphere.radarNetwork = state.radarNetwork;
  currentConfig = state.config;
  activeStateIsCached = false;
  renderer.atmosphere = atmosphere;
  if (dimensionsChanged) renderer.resize();
  renderer.setStateKey(`timeline:${Number(ui.seed.value)}:${atmosphere.validHourUtc}`);
  restoreSelectionByCoordinates(false);
}

function updateTimelineFrame() {
  renderFast = true;
  restoreSelectionByCoordinates(false);
  updateClock();
  scheduleRender(true);
}

async function stepForward() {
  const target = atmosphere.validHourUtc + 0.5;
  if (await restorePrecomputedFrame(target)) {
    updateTimelineFrame();
    schedulePersistWorldState();
    return;
  }
  advance(0.5, { persist: false });
  schedulePersistWorldState();
}

function startActiveTimeline({ seed, startHourUtc }) {
  const generation = ++activeTimelineGeneration;
  activeTimelineClient?.close();
  activeTimelineClient = new TimelinePrecomputeClient();
  activeTimelineDescriptor = { seed, startHourUtc, hours: SYSTEM_CYCLE_HOURS, stepHours: 0.5, status: 'generating', completedHours: 0 };
  activeTimelineFrameCache = new Map();
  activeTimelinePrefetching = new Set();
  activeTimelineClient.onProgress(progress => {
    if (generation !== activeTimelineGeneration) return;
    activeTimelineDescriptor = progress;
    const currentIndex = Math.max(0, Math.round((atmosphere.validHourUtc - systemStartHour) / 0.5));
    prefetchTimelineWindow(currentIndex);
  });
  activeTimelineClient.start({ seed, startHourUtc, hours: SYSTEM_CYCLE_HOURS, stepHours: 0.5 })
    .then(status => {
      if (generation !== activeTimelineGeneration) return;
      activeTimelineDescriptor = status;
      prefetchTimelineWindow(Math.max(0, Math.round((atmosphere.validHourUtc - systemStartHour) / 0.5)));
    })
    .catch(error => {
      if (generation !== activeTimelineGeneration) return;
      console.warn('[weather-sim] Active timeline generation failed; live evolution remains available.', error);
      activeTimelineDescriptor = { ...activeTimelineDescriptor, status: 'error' };
    });
}

function prefetchTimelineWindow(centerIndex) {
  if (!activeTimelineClient || !activeTimelineDescriptor || activeTimelineDescriptor.status === 'error') return;
  const availableSteps = activeTimelineDescriptor.status === 'ready'
    ? Math.round(SYSTEM_CYCLE_HOURS / 0.5)
    : Math.floor(Number(activeTimelineDescriptor.completedHours ?? 0) / 0.5);
  const end = Math.min(availableSteps, centerIndex + TIMELINE_CACHE_RADIUS_STEPS);
  for (let index = Math.max(0, centerIndex - 2); index <= end; index += 1) {
    if (activeTimelineFrameCache.has(index) || activeTimelinePrefetching.has(index)) continue;
    activeTimelinePrefetching.add(index);
    activeTimelineClient.getFrame(index * 0.5).then(frame => {
      rememberTimelineFrame(index, frame);
    }).catch(() => {}).finally(() => activeTimelinePrefetching.delete(index));
  }
}

function rememberTimelineFrame(index, frame) {
  activeTimelineFrameCache.set(index, frame);
  while (activeTimelineFrameCache.size > TIMELINE_CACHE_MAX_FRAMES) {
    const current = Math.round((atmosphere.validHourUtc - systemStartHour) / 0.5);
    const oldest = [...activeTimelineFrameCache.keys()].sort((a, b) => Math.abs(b - current) - Math.abs(a - current))[0];
    activeTimelineFrameCache.delete(oldest);
  }
}

function schedulePersistWorldState() {
  clearTimeout(persistDebounceTimer);
  persistDebounceTimer = setTimeout(() => {
    persistDebounceTimer = null;
    persistWorldState();
  }, PERSIST_DEBOUNCE_MS);
}

function cacheCurrentState({ forceCheckpoint = false } = {}) {
  const hour = atmosphere.validHourUtc;
  renderer.setStateKey(`${scenarioRevision}:${hour}`);
  activeStateIsCached = false;
  // Live Analysis must become interactive before duplicating the entire 2,500-cell
  // atmosphere. Keep only sparse six-hour checkpoints, created during idle time.
  if (PAGE_MODE === 'live' && !forceCheckpoint) {
    if (Math.abs(hour / 6 - Math.round(hour / 6)) > 1e-6) return;
    const captureHour = hour;
    const capture = () => {
      if (Math.abs(atmosphere.validHourUtc - captureHour) > 1e-6 || hourlyStateCache.has(captureHour)) return;
      cacheCurrentState({ forceCheckpoint: true });
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(capture, { timeout: 2500 });
    else setTimeout(capture, 250);
    return;
  }
  hourlyStateCache.set(hour, {
    validHourUtc: hour,
    cells: structuredClone(atmosphere.cells), evolution: structuredClone(atmosphere.evolution),
    analysis: structuredClone(atmosphere.analysis ?? null), storms: structuredClone(atmosphere.storms ?? []),
    stormEngine: structuredClone(atmosphere.stormEngine ?? null), stormOutflows: structuredClone(atmosphere.stormOutflows ?? []), mesoscale: structuredClone(atmosphere.mesoscale ?? null),
    airMassEngine: structuredClone(atmosphere.airMassEngine ?? null), regions: structuredClone(atmosphere.regions ?? []),
    synopticCoherence: structuredClone(atmosphere.synopticCoherence ?? null), setupForecast: structuredClone(atmosphere.setupForecast ?? null),
    outlookCycle: structuredClone(atmosphere.outlookCycle ?? null), upcomingSystemForecast: structuredClone(atmosphere.upcomingSystemForecast ?? null),
    config: structuredClone(currentConfig)
  });
  const maxStates = PAGE_MODE === 'live' ? 4 : 10;
  while (hourlyStateCache.size > maxStates) hourlyStateCache.delete(hourlyStateCache.keys().next().value);
}

function restoreCachedState(hour) {
  const state = hourlyStateCache.get(hour);
  if (!state) return false;
  atmosphere.validHourUtc = state.validHourUtc;
  atmosphere.cells = state.cells;
  atmosphere.evolution = state.evolution;
  atmosphere.analysis = state.analysis;
  atmosphere.storms = state.storms ?? [];
  atmosphere.stormEngine = state.stormEngine ?? null;
  atmosphere.stormOutflows = state.stormOutflows ?? [];
  atmosphere.mesoscale = state.mesoscale ?? null;
  atmosphere.airMassEngine = state.airMassEngine ?? null;
  atmosphere.regions = state.regions ?? [];
  atmosphere.synopticCoherence = state.synopticCoherence ?? null;
  atmosphere.setupForecast = state.setupForecast ?? null;
  atmosphere.outlookCycle = state.outlookCycle ?? null;
  atmosphere.upcomingSystemForecast = state.upcomingSystemForecast ?? null;
  currentConfig = state.config;
  activeStateIsCached = true;
  renderer.atmosphere = atmosphere;
  renderer.setStateKey(`${scenarioRevision}:${hour}`);
  restoreSelectionByCoordinates(false);
  return true;
}


function detachCachedStateForMutation() {
  if (!activeStateIsCached) return;
  atmosphere.cells = structuredClone(atmosphere.cells);
  atmosphere.evolution = structuredClone(atmosphere.evolution);
  atmosphere.analysis = structuredClone(atmosphere.analysis ?? null);
  atmosphere.storms = structuredClone(atmosphere.storms ?? []);
  atmosphere.stormEngine = structuredClone(atmosphere.stormEngine ?? null);
  atmosphere.mesoscale = structuredClone(atmosphere.mesoscale ?? null);
  atmosphere.airMassEngine = structuredClone(atmosphere.airMassEngine ?? null);
  atmosphere.regions = structuredClone(atmosphere.regions ?? []);
  atmosphere.synopticCoherence = structuredClone(atmosphere.synopticCoherence ?? null);
  atmosphere.setupForecast = structuredClone(atmosphere.setupForecast ?? null);
  atmosphere.upcomingSystemForecast = structuredClone(atmosphere.upcomingSystemForecast ?? null);
  currentConfig = structuredClone(currentConfig);
  activeStateIsCached = false;
  renderer.atmosphere = atmosphere;
  renderer.setStateKey(`${scenarioRevision}:${atmosphere.validHourUtc}`);
  restoreSelectionByCoordinates(false);
}

function updateFastFrame() {
  renderFast = true;
  updateClock();
  scheduleRender(true);
  if (metadataFrame !== null) return;
  metadataFrame = requestAnimationFrame(() => {
    metadataFrame = null;
    const selected = selectedSoundingCell && atmosphere.getCell(selectedSoundingCell.x, selectedSoundingCell.y);
    if (selected && ui.soundingModal.classList.contains('hidden')) ui.showCell(selected);
  });
}

function nearestCachedHourAtOrBefore(target) {
  const candidates = [...hourlyStateCache.keys()].filter(hour => hour <= target);
  return candidates.length ? Math.max(...candidates) : null;
}

function restoreSelectionByCoordinates(refreshInfo = true) {
  if (!selectedSoundingCell) return;
  const replacement = atmosphere.getCell(selectedSoundingCell.x, selectedSoundingCell.y);
  selectedSoundingCell = replacement;
  renderer.selectedCell = replacement;
  if (replacement && refreshInfo) ui.showCell(replacement);
}

function updateAll() {
  renderFast = false;
  restoreSelectionByCoordinates(true);
  updateDomainLabel();
  updateClock();
  const selectedDay = FIXED_OUTLOOK_DAY ?? ui.outlookDay?.value ?? 'day1';
  renderer.forecastDay = selectedDay;
  renderer.outlookOnly = PAGE_MODE !== 'live';
  const product = atmosphere.outlookCycle?.products?.[selectedDay];
  const displayedRisk = product?.overallRisk ?? currentConfig.overallRisk;
  const spec = getOutlookSpec(selectedDay);
  if (PAGE_MODE === 'live') {
    ui.mapTitle.textContent = 'Live mesoscale analysis';
  } else {
    ui.mapTitle.textContent = `${spec.label} ${displayedRisk} · predictive outlook`;
  }
  if (ui.diagnosedRisk) {
    ui.diagnosedRisk.textContent = displayedRisk;
    ui.diagnosedRisk.dataset.risk = displayedRisk;
  }
  const outlookHour = atmosphere.evolution?.outlookValidHourUtc ?? atmosphere.validHourUtc;
  if (ui.diagnosedDescription) ui.diagnosedDescription.textContent = `${spec.label} issued ${formatHour(product?.issuedHourUtc ?? outlookHour)} · valid ${formatHour(product?.validStartHour ?? outlookHour)}–${formatHour(product?.validEndHour ?? outlookHour + 24)} · Seed ${currentConfig.seed} · ${currentConfig.narrativeLabel ?? currentConfig.regime} · ${atmosphere.setupForecast?.label ?? currentConfig.setupLabel ?? 'Plains cyclone'}`;
  if (ui.outlookIssueLabel) ui.outlookIssueLabel.textContent = `${spec.label}: issued ${formatHour(product?.issuedHourUtc ?? outlookHour)} · next update ${formatHour(atmosphere.outlookCycle?.nextIssueHour?.[selectedDay] ?? outlookHour + spec.cadence)} · confidence ${atmosphere.getCell(0,0)?.predictiveOutlook?.[selectedDay]?.confidence ?? '—'}% · cycle ${product?.cycleId ?? 'legacy'} · rev ${product?.sourceWorldRevision ?? persistedRevision} · ${product?.sourceSystem ?? 'current'} system${product?.upcomingSystemWeight ? ` (${product.upcomingSystemWeight}% next pattern)` : ''}`;
  if (ui.primaryHazard) ui.primaryHazard.textContent = capitalize(currentConfig.primaryHazard);
  if (ui.stormMode) ui.stormMode.textContent = currentConfig.stormMode;
  if (ui.analysisReasons) ui.analysisReasons.innerHTML = listItems(currentConfig.reasons, 'No strong supporting signal diagnosed.');
  if (ui.analysisLimitations) ui.analysisLimitations.innerHTML = listItems(currentConfig.limitations, 'No dominant limiting factor.');
  const discussion = buildOutlookDiscussion(atmosphere, currentConfig, selectedDay);
  if (ui.synopticPattern) ui.synopticPattern.textContent = discussion.pattern;
  if (ui.synopticStage) ui.synopticStage.textContent = discussion.stage;
  if (ui.analogConfidence) ui.analogConfidence.textContent = `${discussion.ensemble.agreement} · ${discussion.confidence}% · ${discussion.ensemble.memberCount} members`;
  if (ui.outlookDiscussion) ui.outlookDiscussion.textContent = discussion.discussion;
  if (ui.analysisReasons) ui.analysisReasons.innerHTML = listItems(discussion.supportingFactors, 'No strong supporting signal diagnosed.');
  if (ui.analysisLimitations) ui.analysisLimitations.innerHTML = listItems(discussion.limitingFactors, 'No dominant limiting factor.');
  updateSummary();
  updateLayer();
  if (selectedSoundingCell && !ui.soundingModal.classList.contains('hidden')) showSounding(selectedSoundingCell);
}

function updateClock() {
  const hour = atmosphere.validHourUtc;
  const day = Math.floor(hour / 24) + 1;
  const zValue = ((hour % 24) + 24) % 24;
  const whole = Math.floor(zValue);
  const minutes = Math.round((zValue - whole) * 60);
  const z = `${String(whole).padStart(2, '0')}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`;
  ui.simulationTime.value = hour;
  ui.timeLabel.textContent = `${z}Z Day ${day}`;
  const outlookHour = atmosphere.evolution?.outlookValidHourUtc ?? hour;
  const selectedDay = FIXED_OUTLOOK_DAY ?? ui.outlookDay?.value ?? 'day1';
  const product = atmosphere.outlookCycle?.products?.[selectedDay];
  ui.mapSubtitle.textContent = PAGE_MODE === 'live'
    ? `Live atmosphere ${z}Z Day ${day} · system ${systemNumber} · 10 mi grid · no outlook overlays`
    : `${getOutlookSpec(selectedDay).label} issued ${formatHour(product?.issuedHourUtc ?? outlookHour)} · valid ${formatHour(product?.validStartHour ?? outlookHour)}–${formatHour(product?.validEndHour ?? outlookHour + 24)} · system ${systemNumber} · cycle ${product?.cycleId ?? 'legacy'}`;
  if (ui.liveStatus) {
    const age = Math.max(0, hour - systemStartHour);
    const nextEta = Math.max(0, SYSTEM_CYCLE_HOURS - age);
    const nextDay1 = Math.max(0, (atmosphere.outlookCycle?.nextIssueHour?.day1 ?? hour) - hour);
    const nextDay2 = Math.max(0, (atmosphere.outlookCycle?.nextIssueHour?.day2 ?? hour) - hour);
    const nextDay3 = Math.max(0, (atmosphere.outlookCycle?.nextIssueHour?.day3 ?? hour) - hour);
    ui.liveStatus.textContent = `${catchupInProgress ? 'CATCHING UP' : 'AUTHORITY LIVE'} · system ${systemNumber} age ${age.toFixed(1)}h · next system ≤${nextEta.toFixed(1)}h · D1 ${nextDay1.toFixed(1)}h · D2 ${nextDay2.toFixed(1)}h · D3 ${nextDay3.toFixed(1)}h`;
  }
}

function updateDomainLabel() {
  const width = SIMULATION_CONFIG.fixedColumns;
  const height = SIMULATION_CONFIG.fixedRows;
  ui.domainSize.textContent = `${(width * 10).toLocaleString()} × ${(height * 10).toLocaleString()} mi · ${(width * height).toLocaleString()} cells · each cell 10 × 10 mi`;
}

function updateLayer({ forceFull = false } = {}) {
  const layer = ui.layer.value;
  ui.setLegend(renderer.getLayerInfo(layer));
  scheduleRender(false, { forceFull });
}

function scheduleRender(layerOnly = false, { forceFull = false } = {}) {
  pendingLayerOnly = pendingLayerOnly || layerOnly;
  pendingForceFullRender = pendingForceFullRender || forceFull;
  if (renderFrame !== null) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = null;
    renderer.draw(ui.layer.value, { fast: renderFast && !pendingForceFullRender });
    pendingLayerOnly = false;
    pendingForceFullRender = false;
  });
}

function updateSummary() {
  let minPressure = Infinity, maxCape = 0, maxSrh = 0, maxStp = 0, maxTor = 0, maxHail = 0, maxWind = 0;
  atmosphere.forEachCell(cell => {
    minPressure = Math.min(minPressure, cell.surface.seaLevelPressure);
    maxCape = Math.max(maxCape, cell.derived.cape);
    maxSrh = Math.max(maxSrh, cell.derived.srh);
    maxStp = Math.max(maxStp, cell.derived.stp);
    maxTor = Math.max(maxTor, cell.derived.hazards.tornadoProbability);
    maxHail = Math.max(maxHail, cell.derived.hazards.hailProbability);
    maxWind = Math.max(maxWind, cell.derived.hazards.windProbability);
  });
  const boundaries = atmosphere.evolution?.boundaries ?? {};
  ui.summary.innerHTML = [`MSLP ${minPressure.toFixed(0)} mb`,`CAPE ${maxCape.toFixed(0)}`,`SRH ${maxSrh.toFixed(0)}`,`STP ${maxStp.toFixed(1)}`,`TOR ${maxTor}%`,`HAIL ${maxHail}%`,`WIND ${maxWind}%`,`Fronts ${(boundaries.coldCount ?? 0) + (boundaries.warmCount ?? 0)}`,`Dryline ${boundaries.drylineCount ?? 0}`,`Coherence ${Math.round((atmosphere.synopticCoherence?.score ?? 1)*100)}%`,`EML ${Math.round((atmosphere.airMassEngine?.eml?.strength ?? 0)*100)}%`,`Expected storms ${atmosphere.setupForecast?.forecastVsRealization?.expectedStorms ?? 0}`,`Active storms ${atmosphere.setupForecast?.forecastVsRealization?.realizedStorms ?? 0}`,`Splits ${atmosphere.stormEngine?.totalSplits ?? 0}`,`Mergers ${atmosphere.stormEngine?.totalMergers ?? 0}`,`Modes ${[...new Set((atmosphere.storms ?? []).map(storm => storm.mode))].join(' / ') || 'none'}`,`${atmosphere.width}×${atmosphere.height}`].map(text => `<span>${text}</span>`).join('');
}

function togglePlay() {
  if (playTimer) return stopPlaying();
  ui.playTime.textContent = 'Pause';
  ui.playTime.classList.add('active');
  playTick = 0;
  const generation = ++playGeneration;
  const tick = () => {
    if (generation !== playGeneration || !playTimer) return;
    const started = performance.now();
    advance(0.5);
    if (!playTimer || generation !== playGeneration) return;
    const elapsed = performance.now() - started;
    playTimer = setTimeout(tick, Math.max(16, PLAY_DELAY_MS - elapsed));
  };
  playTimer = setTimeout(tick, 0);
}
function stopPlaying() {
  playGeneration += 1;
  if (playTimer) clearTimeout(playTimer);
  playTimer = null;
  ui.playTime.textContent = 'Fast preview';
  ui.playTime.classList.remove('active');
}

ui.generate.addEventListener('click', () => generate({ persist: true, seed: Number(ui.seed.value), baseHour: SIMULATION_CONFIG.startHourUtc, systemIndex: 1 }));
ui.stepTime.addEventListener('click', () => { void stepForward(); });
ui.playTime.addEventListener('click', togglePlay);
ui.simulationTime.addEventListener('input', () => {
  const target = Number(ui.simulationTime.value);
  ui.timeLabel.textContent = formatHour(target);
  clearTimeout(seekDebounceTimer);
  seekDebounceTimer = setTimeout(() => seekToHour(target, { preview: true }), SEEK_DEBOUNCE_MS);
});
ui.simulationTime.addEventListener('change', () => {
  clearTimeout(seekDebounceTimer);
  seekToHour(Number(ui.simulationTime.value));
});
ui.layer.addEventListener('change', updateLayer);
bindOptionalControl(ui.outlookDay, 'change', () => { renderer.forecastDay = ui.outlookDay.value; updateAll(); });
bindOptionalControl(ui.liveMode, 'click', toggleLiveMode);
ui.randomSeed.addEventListener('click', () => {
  const previousSeed = Number(ui.seed.value);
  let nextSeed = previousSeed;
  while (nextSeed === previousSeed) nextSeed = secureRandomSeed();
  ui.seed.value = nextSeed;
  generate({ persist: true, seed: nextSeed, baseHour: SIMULATION_CONFIG.startHourUtc, systemIndex: 1 });
});

function toggleLiveMode() {
  if (liveTimer) return stopLiveMode();
  stopPlaying();
  ui.liveMode.textContent = 'Pause foreground updates';
  ui.liveMode.classList.add('active');
  ui.liveStatus.textContent = 'AUTHORITY LIVE · foreground page synchronized every 2 real minutes';
  liveTimer = setInterval(() => synchronizeAuthority(), LIVE_TICK_MS);
}
function stopLiveMode() {
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = null;
  if (ui.liveMode) { ui.liveMode.textContent = 'Resume foreground updates'; ui.liveMode.classList.remove('active'); }
  if (ui.liveStatus) ui.liveStatus.textContent = 'Authority persists by elapsed real time; foreground auto-refresh is paused.';
}

async function synchronizeAuthority(savedState = null) {
  if (!worldStore.acquireAuthorityLease(authorityOwnerId)) {
    const followerState = worldStore.load();
    scheduleAuthorityWake(followerState);
    return;
  }
  const descriptor = savedState ?? worldStore.load();
  if (!descriptor) return;
  const steps = authorityClock.dueSteps(descriptor);
  if (steps <= 0) {
    scheduleAuthorityWake(descriptor);
    return;
  }
  catchupInProgress = true;
  const consumed = authorityClock.consume(descriptor, steps);
  for (let i = 0; i < steps; i++) {
    if (i > 0 && i % 8 === 0) worldStore.renewAuthorityLease(authorityOwnerId);
    advance(SIM_HOURS_PER_STEP, { authorityCatchup: true, persist: false });
    if (i > 0 && i % 8 === 0) await nextAnimationFrame();
  }
  authorityRealTimestamp = consumed.authorityRealTimestamp;
  catchupInProgress = false;
  updateAll();
  persistWorldState();
  scheduleAuthorityWake();
}

function scheduleAuthorityWake(state = null) {
  if (remoteAuthorityMode) return;
  if (authorityTimer) clearTimeout(authorityTimer);
  const descriptor = state ?? worldStore.load() ?? { authorityRealTimestamp };
  const delay = Math.max(250, authorityClock.nextTickInMs(descriptor));
  authorityTimer = setTimeout(() => synchronizeAuthority(), delay);
}

function maybeCycleProceduralSystem() {
  const age = atmosphere.validHourUtc - systemStartHour;
  if (age >= UPCOMING_PRECOMPUTE_LEAD_HOURS && !upcomingSystem) void prepareUpcomingSystem();
  const activeStorms = atmosphere.storms?.length ?? 0;
  let maxRiskIndex = 0;
  const order = ['TSTM','MRGN','SLGT','ENH','MDT','HIGH'];
  atmosphere.forEachCell(cell => { maxRiskIndex = Math.max(maxRiskIndex, order.indexOf(cell.derived?.risk ?? 'TSTM')); });
  const remnantsDone = age >= 48 && activeStorms === 0 && maxRiskIndex <= 1;
  const hardHandoff = age >= SYSTEM_CYCLE_HOURS;
  if (!remnantsDone && !hardHandoff) return;
  const keepLive = Boolean(liveTimer);
  const absoluteHour = atmosphere.validHourUtc;
  if (!upcomingSystem?.readyFrame) return; // Never interrupt users with synchronous seed generation.
  const nextSeed = upcomingSystem.seed;
  ui.seed.value = nextSeed;
  applyTimelineFrame(upcomingSystem.readyFrame);
  systemStartHour = absoluteHour;
  systemNumber += 1;
  activeTimelineClient?.close();
  activeTimelineClient = upcomingTimelineClient;
  activeTimelineDescriptor = upcomingSystem.timeline;
  activeTimelineFrameCache = new Map([[0, upcomingSystem.readyFrame]]);
  activeTimelinePrefetching = new Set();
  upcomingTimelineClient = null;
  upcomingSystem = null;
  atmosphere.upcomingSystemForecast = null;
  hourlyStateCache = new Map(); cacheCurrentState(); updateAll();
  persistWorldState();
  if (keepLive && !liveTimer) toggleLiveMode();
}


async function prepareUpcomingSystem() {
  if (upcomingSystem?.status === 'generating' || upcomingSystem?.readyFrame) return;
  const nextSeed = persistedUpcomingSeed ?? secureRandomSeed();
  persistedUpcomingSeed = null;
  const handoffHour = systemStartHour + SYSTEM_CYCLE_HOURS;
  upcomingTimelineClient?.close();
  upcomingTimelineClient = new TimelinePrecomputeClient();
  upcomingSystem = { seed: nextSeed, handoffHour, status: 'generating', progress: 0, readyFrame: null, timeline: null };
  upcomingTimelineClient.onProgress(progress => {
    if (!upcomingSystem || upcomingSystem.seed !== nextSeed) return;
    upcomingSystem.progress = progress.progress;
    upcomingSystem.status = progress.status;
    upcomingSystem.timeline = progress;
  });

  // Publish a lightweight preview immediately for Day 2/3 blending while the
  // authoritative 72-hour timeline continues in the worker.
  const preview = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
  const previewConfig = generateScenario(preview, nextSeed);
  initializeEvolution(preview, previewConfig);
  atmosphere.upcomingSystemForecast = {
    seed: nextSeed, handoffHour, width: preview.width, height: preview.height,
    cells: structuredClone(preview.cells), narrativeLabel: previewConfig.narrativeLabel ?? previewConfig.regime,
    primaryHazard: previewConfig.primaryHazard, stormMode: previewConfig.stormMode,
    precomputeStatus: 'generating', precomputeProgress: 0
  };
  updatePredictiveOutlooks(atmosphere, { force: true });
  persistWorldState();

  try {
    const timeline = await upcomingTimelineClient.start({ seed: nextSeed, startHourUtc: handoffHour, hours: SYSTEM_CYCLE_HOURS, stepHours: 0.5 });
    if (!upcomingSystem || upcomingSystem.seed !== nextSeed) return;
    upcomingSystem.timeline = timeline;
    upcomingSystem.status = timeline.status;
    upcomingSystem.readyFrame = await upcomingTimelineClient.getFrame(0);
    atmosphere.upcomingSystemForecast.precomputeStatus = 'ready';
    atmosphere.upcomingSystemForecast.precomputeProgress = 1;
    atmosphere.upcomingSystemForecast.generationMs = timeline.generationMs;
    persistWorldState();
    // If the old pattern is already eligible to leave, the prepared seed can
    // swap in on the next event-loop turn without a loading intermission.
    queueMicrotask(() => maybeCycleProceduralSystem());
  } catch (error) {
    console.warn('[weather-sim] Background timeline generation failed; current seed will remain active.', error);
    if (upcomingSystem?.seed === nextSeed) upcomingSystem.status = 'error';
    if (atmosphere.upcomingSystemForecast?.seed === nextSeed) atmosphere.upcomingSystemForecast.precomputeStatus = 'error';
  }
}

function secureRandomSeed() {
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return 1 + (values[0] % 2_000_000_000);
  }
  return 1 + Math.floor(Math.random() * 2_000_000_000);
}
function bindOptionalControl(element, eventName, handler) {
  if (!element) {
    console.warn(`[weather-sim] Optional UI control missing; skipped ${eventName} binding.`);
    return;
  }
  element.addEventListener(eventName, handler);
}

bindOptionalControl(ui.toggleRegions, 'click', () => { renderer.showRegions = !renderer.showRegions; ui.toggleRegions.textContent = renderer.showRegions ? 'Hide region borders' : 'Show region borders'; ui.toggleRegions.classList.toggle('active', renderer.showRegions); updateLayer({ forceFull: true }); });
bindOptionalControl(ui.toggleRegionLabels, 'click', () => { renderer.showRegionLabels = !renderer.showRegionLabels; ui.toggleRegionLabels.textContent = renderer.showRegionLabels ? 'Hide region labels' : 'Show region labels'; ui.toggleRegionLabels.classList.toggle('active', renderer.showRegionLabels); updateLayer({ forceFull: true }); });
bindOptionalControl(ui.toggleGrid, 'click', () => { renderer.showGrid = !renderer.showGrid; ui.toggleGrid.textContent = renderer.showGrid ? 'Hide 10 mi grid' : 'Show 10 mi grid'; ui.toggleGrid.classList.toggle('active', renderer.showGrid); updateLayer(); });
bindOptionalControl(ui.toggleFeatures, 'click', () => { renderer.showFeatures = !renderer.showFeatures; ui.toggleFeatures.textContent = renderer.showFeatures ? 'Hide boundaries' : 'Show boundaries'; ui.toggleFeatures.classList.toggle('active', renderer.showFeatures); updateLayer({ forceFull: true }); });
bindOptionalControl(ui.toggleSmoothing, 'click', () => { renderer.smoothGeometry = !renderer.smoothGeometry; ui.toggleSmoothing.textContent = renderer.smoothGeometry ? 'Use straight geometry' : 'Use curved geometry'; ui.toggleSmoothing.classList.toggle('active', renderer.smoothGeometry); updateLayer(); });
// The canvas itself is the authoritative interaction surface. Earlier overlay
// layers could wind up with a zero-sized or misaligned hit area, which made both
// hover outlines and sounding clicks silently fail.
const mapHitTarget = ui.canvas;

function cellFromMapPointer(event) {
  const rect = ui.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  const cssX = event.clientX - rect.left;
  const cssY = event.clientY - rect.top;
  if (!Number.isFinite(cssX) || !Number.isFinite(cssY)) return null;
  if (cssX < 0 || cssY < 0 || cssX >= rect.width || cssY >= rect.height) return null;

  // Derive the cell directly from the displayed grid proportions. This remains
  // correct if CSS, browser zoom, or device-pixel scaling changes the canvas size.
  const x = Math.min(atmosphere.width - 1, Math.floor((cssX / rect.width) * atmosphere.width));
  const y = Math.min(atmosphere.height - 1, Math.floor((cssY / rect.height) * atmosphere.height));
  return atmosphere.getCell(x, y) ?? null;
}

function updateMapHover(event) {
  const cell = cellFromMapPointer(event);
  if (renderer.hoverCell !== cell) {
    renderer.hoverCell = cell;
    scheduleRender(true);
  }
  if (!cell) {
    ui.hideTooltip();
    return;
  }
  const info = renderer.getLayerInfo(ui.layer.value);
  ui.showTooltip(cell, event, info, renderer.valueForLayer(cell, ui.layer.value));
}

function selectMapCellFromEvent(event) {
  const cell = cellFromMapPointer(event);
  if (!cell) return false;

  renderer.hoverCell = cell;
  renderer.selectedCell = cell;
  selectedSoundingCell = cell;
  ui.showCell(cell);
  ui.openSounding.disabled = false;
  scheduleRender(true);

  try {
    showSounding(cell);
  } catch (error) {
    console.error('Unable to render sounding for selected cell.', error);
    ui.info.insertAdjacentHTML('beforeend', `<div class="info-group"><h3>Sounding error</h3><div>${String(error?.message ?? error)}</div></div>`);
  }
  return true;
}

mapHitTarget.addEventListener('mousemove', updateMapHover);
mapHitTarget.addEventListener('mouseleave', () => {
  renderer.hoverCell = null;
  scheduleRender(true);
  ui.hideTooltip();
});

// A normal browser click is the primary desktop interaction, matching the older
// versions where users clicked the rendered grid directly.
mapHitTarget.addEventListener('click', selectMapCellFromEvent);

// Touch browsers do not always synthesize a click reliably after panning. Handle
// a stationary touch/pen release while avoiding duplicate mouse selection.
let touchPointerStart = null;
mapHitTarget.addEventListener('pointerdown', event => {
  if (event.pointerType === 'mouse') return;
  touchPointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
});
mapHitTarget.addEventListener('pointerup', event => {
  if (!touchPointerStart || touchPointerStart.id !== event.pointerId) return;
  const moved = Math.hypot(event.clientX - touchPointerStart.x, event.clientY - touchPointerStart.y);
  touchPointerStart = null;
  if (moved <= 8) selectMapCellFromEvent(event);
});
mapHitTarget.addEventListener('pointercancel', () => { touchPointerStart = null; });

mapHitTarget.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  const cell = renderer.hoverCell ?? renderer.selectedCell ?? atmosphere.getCell(0, 0);
  if (!cell) return;
  renderer.hoverCell = cell;
  renderer.selectedCell = cell;
  selectedSoundingCell = cell;
  ui.showCell(cell);
  ui.openSounding.disabled = false;
  showSounding(cell);
  scheduleRender(true);
});
ui.openSounding.addEventListener('click', () => selectedSoundingCell && showSounding(selectedSoundingCell));
ui.closeSounding.addEventListener('click', () => { ui.soundingModal.classList.add('hidden'); soundingRenderKey = ''; });
ui.soundingModal.addEventListener('click', event => { if (event.target === ui.soundingModal) { ui.soundingModal.classList.add('hidden'); soundingRenderKey = ''; } });

function showSounding(cell) {
  const renderKey = `${atmosphere.validHourUtc}:${cell.x}:${cell.y}`;
  if (renderKey === soundingRenderKey && !ui.soundingModal.classList.contains('hidden')) return;
  const sounding = buildSounding(cell);
  soundingRenderKey = renderKey;
  ui.soundingTitle.textContent = `Cell (${cell.x}, ${cell.y}) sounding`;
  ui.soundingSubtitle.textContent = `${formatHour(atmosphere.validHourUtc)} · elevation ${cell.terrain.elevationM.toFixed(0)} m · ${cell.x*10}–${(cell.x+1)*10} km E`;
  const p = sounding.params;
  const boxes = [
    ['SBCAPE', `${p.sbcape.toFixed(0)} J/kg`], ['MLCAPE', `${p.mlcape.toFixed(0)} J/kg`], ['MUCAPE', `${p.mucape.toFixed(0)} J/kg`], ['SBCIN', `${p.sbcin.toFixed(0)} J/kg`],
    ['LCL', `${p.lclM.toFixed(0)} m MSL`], ['LFC', `${p.lfcM.toFixed(0)} m MSL`], ['EL', `${p.elM.toFixed(0)} m MSL`], ['Freezing level', `${Number.isFinite(p.freezingM)?p.freezingM.toFixed(0):'—'} m`],
    ['Wet-bulb zero', `${Number.isFinite(p.wetBulbZeroM)?p.wetBulbZeroM.toFixed(0):'—'} m`], ['Lifted Index', `${p.liftedIndex.toFixed(1)} °C`], ['PWAT', `${p.precipWater.toFixed(2)} in`], ['Convective temp', `${p.convectiveTempC.toFixed(1)} °C`],
    ['0–1 km shear', `${p.shear01.toFixed(0)} kt`], ['0–3 km shear', `${p.shear03.toFixed(0)} kt`], ['0–6 km shear', `${p.shear06.toFixed(0)} kt`], ['Critical angle', `${p.criticalAngle.toFixed(0)}°`],
    ['0–1 km SRH', `${p.srh01.toFixed(0)} m²/s²`], ['0–3 km SRH', `${p.srh03.toFixed(0)} m²/s²`], ['STP', p.stp.toFixed(1)], ['STP tendency', stpTendencyText(cell)], ['VTP', (p.vtp ?? 0).toFixed(1)], ['SCP', p.scp.toFixed(1)]
  ];
  ui.soundingMetrics.innerHTML = boxes.map(([k,v]) => `<div class="metric-box"><small>${k}</small><strong>${v}</strong></div>`).join('');
  const d=cell.dynamics;
  ui.forcingDetails.innerHTML = [
    ['Forcing score', d.forcingScore.toFixed(2)], ['Convective readiness', `${((d.convectiveReadiness ?? 0)*100).toFixed(0)}%`], ['Trigger strength', `${((d.triggerStrength ?? 0)*100).toFixed(0)}%`], ['Initiation potential', `${(d.initiationPotential*100).toFixed(0)}%`], ['Hazard occurrence support', `${((d.initiationCoverage ?? 0)*100).toFixed(0)}%`], ['Surface convergence', `${(d.surfaceConvergenceS1*1e4).toFixed(2)} ×10⁻⁴ s⁻¹`], ['Moisture-flux convergence', d.moistureFluxConvergence.toExponential(2)],
    ['Frontogenesis', `${d.frontogenesis.toFixed(2)} °F/100 km/h`], ['Terrain lift', `${d.terrainLiftMs.toFixed(2)} m/s`], ['Upper divergence', `${(d.upperDivergenceS1*1e4).toFixed(2)} ×10⁻⁴ s⁻¹`], ['Vertical motion', `${d.verticalVelocityMs.toFixed(2)} m/s`]
  ].map(([k,v])=>`<div><small>${k}</small><strong>${v}</strong></div>`).join('');
  ui.profileTableBody.innerHTML = sounding.profile.map(r=>`<tr><td>${r.p} mb</td><td>${r.heightM.toFixed(0)} m</td><td>${r.t.toFixed(1)} °C</td><td>${r.td.toFixed(1)} °C</td><td>${r.rh.toFixed(0)}%</td><td>${r.dir.toFixed(0)}° @ ${r.spd.toFixed(0)} kt</td></tr>`).join('');
  drawSounding(ui.skewTCanvas,sounding); drawHodograph(ui.hodoCanvas,sounding);
  ui.soundingModal.classList.remove('hidden');
}

function stpTendencyText(cell) {
  const d=cell.derived??{}, previous=cell._previousStpIngredients??null;
  const current={cape:Number(d.cape)||0,srh:Number(d.srh)||0,shear:Number(d.bulkShear)||0,lcl:Number(d.lclAgl??d.lcl)||1800,cin:Number(d.cin)||0,stp:Number(d.stp)||0};
  cell._previousStpIngredients=current;
  if(!previous)return 'baseline';
  const parts=[['CAPE',(current.cape-previous.cape)/600],['SRH',(current.srh-previous.srh)/80],['shear',(current.shear-previous.shear)/12],['lower LCL',(previous.lcl-current.lcl)/350],['weaker cap',(previous.cin-current.cin)/45]].sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
  const delta=current.stp-previous.stp, driver=parts[0];
  if(Math.abs(delta)<0.08)return `steady · ${driver[0]} nearly unchanged`;
  return `${delta>0?'rising':'falling'} · ${driver[1]>=0?driver[0]:`less favorable ${driver[0]}`}`;
}

function nextAnimationFrame() { return new Promise(resolve => requestAnimationFrame(resolve)); }

function formatHour(hour) { const value = Number(hour) || 0; const day = Math.floor(value / 24) + 1; const z = ((value % 24) + 24) % 24; const whole = Math.floor(z); const minutes = Math.round((z - whole) * 60); return `${String(whole).padStart(2, '0')}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}Z Day ${day}`; }
function clampInteger(value, min, max) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed * 2) / 2)) : min; }
function capitalize(value) { return value ? value.charAt(0).toUpperCase() + value.slice(1) : '—'; }
function listItems(items, fallback) { return (items?.length ? items : [fallback]).map(item => `<li>${item}</li>`).join(''); }

updateDomainLabel();
configurePageMode();
restoreSharedWorld();
window.addEventListener('storage', event => {
  if (!event.key?.includes('fake-plains-weather-world')) return;
  const latest = worldStore.load();
  if (!latest || latest.writerId === authorityOwnerId || latest.revision <= persistedRevision) return;
  persistedRevision = latest.revision;
  location.reload();
});
window.addEventListener('pagehide', () => { if (sessionSnapshotDirty) persistSessionSnapshot(true); worldStore.releaseAuthorityLease(authorityOwnerId); });


function setForecastContext() {
  atmosphere.forecastContext = {
    worldRevision: persistedRevision,
    systemNumber,
    currentSeed: Number(currentConfig?.seed ?? ui.seed.value),
    upcomingSeed: upcomingSystem?.seed ?? atmosphere.upcomingSystemForecast?.seed ?? null
  };
}

function persistWorldState() {
  setForecastContext();
  persistSessionSnapshot(false);
  productArchive = mergeProductArchive(productArchive, atmosphere.outlookCycle?.archive);
  const saveResult = worldStore.save({
    currentSeed: Number(currentConfig?.seed ?? ui.seed.value),
    validHourUtc: atmosphere.validHourUtc,
    systemStartHour,
    systemNumber,
    upcomingSeed: upcomingSystem?.seed ?? atmosphere.upcomingSystemForecast?.seed ?? null,
    upcomingHandoffHour: upcomingSystem?.handoffHour ?? atmosphere.upcomingSystemForecast?.handoffHour ?? null,
    authorityRealTimestamp,
    productArchive,
    forecastProducts: atmosphere.outlookCycle?.products ?? {},
    radarSnapshot: null
  }, { writerId: authorityOwnerId, expectedRevision: persistedRevision });
  if (saveResult.ok) persistedRevision = saveResult.record.revision;
  else if (saveResult.conflict && saveResult.record) persistedRevision = saveResult.record.revision;
}


function persistSessionSnapshot(force = false) {
  const now = Date.now();
  sessionSnapshotDirty = true;
  if (!force && now - lastSessionSnapshotWrite < SESSION_SNAPSHOT_MIN_INTERVAL_MS) return;
  try {
    const state = {
      revision: persistedRevision,
      seed: Number(currentConfig?.seed ?? ui.seed.value),
      systemNumber,
      systemStartHour,
      validHourUtc: atmosphere.validHourUtc,
      cells: atmosphere.cells,
      evolution: atmosphere.evolution,
      analysis: atmosphere.analysis ?? null,
      storms: (atmosphere.storms ?? []).map(storm => ({ ...storm, internalField: serializeStormInternalField(storm.internalField) })),
      stormEngine: atmosphere.stormEngine ?? null,
      stormOutflows: atmosphere.stormOutflows ?? [],
      mesoscale: atmosphere.mesoscale ?? null,
      airMassEngine: atmosphere.airMassEngine ?? null,
      regions: atmosphere.regions ?? [],
      synopticCoherence: atmosphere.synopticCoherence ?? null,
      setupForecast: atmosphere.setupForecast ?? null,
      outlookCycle: atmosphere.outlookCycle ?? null,
      upcomingSystemForecast: atmosphere.upcomingSystemForecast ?? null,
      radarNetwork: atmosphere.radarNetwork ?? null,
      config: currentConfig
    };
    sessionStorage.setItem(SESSION_SNAPSHOT_KEY, JSON.stringify(state, (_key, value) => ArrayBuffer.isView(value) ? Array.from(value) : value));
    lastSessionSnapshotWrite = now;
    sessionSnapshotDirty = false;
  } catch (error) {
    try { sessionStorage.removeItem(SESSION_SNAPSHOT_KEY); } catch {}
    console.warn('[weather-sim] Session snapshot skipped.', error);
  }
}

function restoreSessionSnapshot(saved) {
  try {
    const raw=sessionStorage.getItem(SESSION_SNAPSHOT_KEY); if(!raw)return null;
    const state=JSON.parse(raw);
    if(Number(state.seed)!==Number(saved.currentSeed)||Number(state.systemNumber)!==Number(saved.systemNumber))return null;
    if(!Array.isArray(state.cells)||!Number.isFinite(state.validHourUtc)||state.validHourUtc>saved.validHourUtc+1e-6)return null;
    atmosphere.width=state.cells[0]?.length ?? atmosphere.width; atmosphere.height=state.cells.length;
    atmosphere.cells=state.cells; atmosphere.validHourUtc=state.validHourUtc;
    atmosphere.evolution=state.evolution; atmosphere.analysis=state.analysis; atmosphere.storms=state.storms??[];
    for (const storm of atmosphere.storms) if (storm.internalField) storm.internalField = hydrateStormInternalField(storm.internalField);
    atmosphere.stormEngine=state.stormEngine; atmosphere.stormOutflows=state.stormOutflows??[]; atmosphere.mesoscale=state.mesoscale; atmosphere.airMassEngine=state.airMassEngine;
    atmosphere.regions=state.regions??[]; atmosphere.synopticCoherence=state.synopticCoherence; atmosphere.setupForecast=state.setupForecast;
    atmosphere.outlookCycle=state.outlookCycle; atmosphere.upcomingSystemForecast=state.upcomingSystemForecast; atmosphere.radarNetwork=state.radarNetwork;
    currentConfig=state.config??currentConfig; renderer.atmosphere=atmosphere; renderer.resize(); hourlyStateCache=new Map(); renderer.setStateKey(`${scenarioRevision}:${atmosphere.validHourUtc}`);
    return state.validHourUtc;
  } catch { return null; }
}


function hydrateRemoteAuthorityState(remote) {
  remoteAuthorityMode = true;
  const state = remote.atmosphere;
  persistedRevision = Number(remote.revision) || 0;
  authorityRealTimestamp = Number(remote.authorityRealTimestamp) || Date.now();
  systemStartHour = Number(remote.systemStartHour) || SIMULATION_CONFIG.startHourUtc;
  systemNumber = Number(remote.systemNumber) || 1;
  ui.seed.value = Number(remote.currentSeed ?? remote.seed) || 20270503;
  atmosphere.width = Number(state.width) || SIMULATION_CONFIG.fixedColumns;
  atmosphere.height = Number(state.height) || SIMULATION_CONFIG.fixedRows;
  atmosphere.cells = state.cells;
  atmosphere.validHourUtc = Number(state.validHourUtc) || SIMULATION_CONFIG.startHourUtc;
  atmosphere.evolution = state.evolution;
  atmosphere.analysis = state.analysis;
  atmosphere.storms = state.storms ?? [];
  for (const storm of atmosphere.storms) if (storm.internalField) storm.internalField = hydrateStormInternalField(storm.internalField);
  atmosphere.stormEngine = state.stormEngine;
  atmosphere.stormOutflows = state.stormOutflows ?? [];
  atmosphere.mesoscale = state.mesoscale;
  atmosphere.airMassEngine = state.airMassEngine;
  atmosphere.regions = state.regions ?? [];
  atmosphere.synopticCoherence = state.synopticCoherence;
  atmosphere.setupForecast = state.setupForecast;
  atmosphere.outlookCycle = state.outlookCycle;
  atmosphere.upcomingSystemForecast = state.upcomingSystemForecast;
  atmosphere.radarNetwork = state.radarNetwork;
  currentConfig = state.config ?? { seed: Number(ui.seed.value) };
  renderer.atmosphere = atmosphere;
  renderer.resize();
  renderer.setStateKey(`remote:${persistedRevision}:${atmosphere.validHourUtc}`);
  hourlyStateCache = new Map();
  scenarioRevision += 1;
}

async function restoreSharedWorld() {
  // 2.20.1: when served by the Node authority, hydrate one published world
  // instead of regenerating and replaying it independently in every page.
  if (await productClient.health()) {
    try {
      const remote = await productClient.getAuthorityState();
      if (remote?.atmosphere?.cells?.length) {
        hydrateRemoteAuthorityState(remote);
        updateAll();
        scheduleAuthorityWake();
        return;
      }
    } catch (error) { console.warn('[weather-sim] Remote authority unavailable; using local fallback.', error); }
  }
  const saved = worldStore.load();
  if (!saved) {
    generate({ persist: true, seed: Number(ui.seed.value), baseHour: SIMULATION_CONFIG.startHourUtc, systemIndex: 1 });
    scheduleAuthorityWake();
    return;
  }

  persistedRevision = saved.revision ?? 0;
  authorityRealTimestamp = saved.authorityRealTimestamp ?? saved.updatedAt ?? Date.now();
  productArchive = saved.productArchive ?? { day1: [], day2: [], day3: [] };
  const dueSteps = authorityClock.dueSteps(saved);
  const targetHour = Math.max(saved.systemStartHour, saved.validHourUtc) + dueSteps * SIM_HOURS_PER_STEP;
  systemStartHour = saved.systemStartHour;
  systemNumber = saved.systemNumber;
  ui.seed.value = saved.currentSeed;
  const restoredSessionHour = restoreSessionSnapshot(saved);
  if (restoredSessionHour === null) {
    generate({ persist: false, seed: saved.currentSeed, baseHour: saved.systemStartHour, systemIndex: saved.systemNumber });
  } else {
    scenarioRevision += 1;
    setForecastContext();
    updateAll();
  }
  persistedUpcomingSeed = saved.upcomingSeed;
  catchupInProgress = dueSteps > 0;

  let replaySteps = 0;
  while (atmosphere.validHourUtc + 1e-6 < targetHour) {
    const step = Math.min(SIM_HOURS_PER_STEP, targetHour - atmosphere.validHourUtc);
    const analysis = advanceAtmosphere(atmosphere, step);
    currentConfig = { ...currentConfig, ...analysis };
    maybeCycleProceduralSystem();
    replaySteps += 1;
    if (replaySteps % 8 === 0) await nextAnimationFrame();
  }

  const consumed = authorityClock.consume(saved, dueSteps);
  authorityRealTimestamp = consumed.authorityRealTimestamp;
  catchupInProgress = false;
  if (saved.upcomingSeed && !upcomingSystem && targetHour - systemStartHour >= 48) {
    persistedUpcomingSeed = saved.upcomingSeed;
    prepareUpcomingSystem();
  }
  hourlyStateCache = new Map();
  renderer.setStateKey(`${scenarioRevision}:${atmosphere.validHourUtc}`);
  updateAll();
  if (dueSteps > 0) persistWorldState();
  else { sessionSnapshotDirty = true; setTimeout(() => persistSessionSnapshot(false), 1000); }
  scheduleAuthorityWake();
}

function mergeProductArchive(existing, generated) {
  const result = { day1: [], day2: [], day3: [] };
  for (const key of Object.keys(result)) {
    const combined = [...(existing?.[key] ?? []), ...(generated?.[key] ?? [])];
    const unique = new Map();
    for (const item of combined) unique.set(item.cycleId ?? `${item.issuedHourUtc}:${item.overallRisk}:${item.sourceSystem}`, { ...item, systemNumber: item.sourceSystemNumber ?? systemNumber });
    result[key] = [...unique.values()].sort((a,b) => a.issuedHourUtc - b.issuedHourUtc).slice(-24);
  }
  return result;
}

function configurePageMode() {
  document.querySelectorAll('[data-nav-page]').forEach(link => link.classList.toggle('active', link.dataset.navPage === PAGE_MODE));
  if (FIXED_OUTLOOK_DAY && ui.outlookDay) ui.outlookDay.value = FIXED_OUTLOOK_DAY;
  if (PAGE_MODE === 'live') {
    const forbidden = new Set(['risk','tornadoRisk','hailRisk','windRisk']);
    [...ui.layer.options].forEach(option => { if (forbidden.has(option.value)) option.remove(); });
    if (forbidden.has(ui.layer.value)) ui.layer.value = 'temperature';
  } else {
    const allowed = new Set(['risk','tornadoRisk','hailRisk','windRisk']);
    [...ui.layer.options].forEach(option => { if (!allowed.has(option.value)) option.remove(); });
    ui.layer.value = 'risk';
  }
}

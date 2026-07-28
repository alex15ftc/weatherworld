import { Atmosphere } from '../atmosphere.js';
import { generateScenario } from '../scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../evolution.js';
import { SIMULATION_CONFIG } from '../simulationConfig.js';
import { updatePredictiveOutlooks } from '../forecast/OutlookCycleEngine.js';
import { serializeStormInternalField } from '../storms/StormInternalField.js';

const DEFAULT_HOURS = 72;
const DEFAULT_STEP_HOURS = 0.5;
let generationToken = 0;
let timeline = emptyTimeline();

self.onmessage = async event => {
  const { id, type, payload = {} } = event.data ?? {};
  try {
    let result;
    if (type === 'start') result = await buildTimeline(payload);
    else if (type === 'status') result = timelineStatus();
    else if (type === 'frame') result = frameByOffset(payload.hourOffset);
    else if (type === 'frame-at') result = frameAtHour(payload.validHourUtc);
    else if (type === 'cancel') result = cancelTimeline();
    else throw new Error(`Unknown timeline request: ${type}`);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message ?? String(error) });
  }
};

async function buildTimeline({ seed, startHourUtc, hours = DEFAULT_HOURS, stepHours = DEFAULT_STEP_HOURS }) {
  const token = ++generationToken;
  const safeSeed = Number(seed) || 20270503;
  const safeStart = Number.isFinite(Number(startHourUtc)) ? Number(startHourUtc) : SIMULATION_CONFIG.startHourUtc;
  const safeHours = Math.max(0.5, Math.min(72, Number(hours) || DEFAULT_HOURS));
  const safeStep = Math.max(0.5, Number(stepHours) || DEFAULT_STEP_HOURS);
  const totalSteps = Math.round(safeHours / safeStep);
  const startedAt = performance.now();

  timeline = {
    token, seed: safeSeed, startHourUtc: safeStart, hours: safeHours, stepHours: safeStep,
    status: 'generating', completedSteps: 0, totalSteps, frames: [], config: null,
    startedAtMs: Date.now(), completedAtMs: null, generationMs: null, error: null
  };

  const atmosphere = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
  const config = generateScenario(atmosphere, safeSeed);
  initializeEvolution(atmosphere, config);
  atmosphere.validHourUtc = safeStart;
  if (atmosphere.evolution) atmosphere.evolution.elapsedHours = 0;
  updatePredictiveOutlooks(atmosphere, { force: true });
  timeline.config = structuredClone(config);
  timeline.frames.push(captureFrame(atmosphere, config, 0));
  publishProgress('initializing');

  for (let step = 1; step <= totalSteps; step += 1) {
    if (token !== generationToken) return { cancelled: true, ...timelineStatus() };
    const analysis = advanceAtmosphere(atmosphere, safeStep);
    const mergedConfig = { ...config, ...analysis };
    updatePredictiveOutlooks(atmosphere);
    timeline.frames.push(captureFrame(atmosphere, mergedConfig, step * safeStep));
    timeline.completedSteps = step;
    if (step === totalSteps || step % 2 === 0) publishProgress('simulating');
    // Yield inside the worker so status/cancel messages are serviced promptly.
    if (step % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }

  if (token !== generationToken) return { cancelled: true, ...timelineStatus() };
  timeline.status = 'ready';
  timeline.completedAtMs = Date.now();
  timeline.generationMs = performance.now() - startedAt;
  publishProgress('ready');
  return timelineStatus();
}

function captureFrame(atmosphere, config, hourOffset) {
  return {
    seed: timeline.seed,
    hourOffset,
    validHourUtc: atmosphere.validHourUtc,
    width: atmosphere.width,
    height: atmosphere.height,
    cells: structuredClone(atmosphere.cells),
    evolution: structuredClone(atmosphere.evolution),
    analysis: structuredClone(atmosphere.analysis ?? null),
    storms: (atmosphere.storms ?? []).map(storm => ({ ...structuredClone(storm), internalField: serializeStormInternalField(storm.internalField) })),
    stormEngine: structuredClone(atmosphere.stormEngine ?? null),
    stormOutflows: structuredClone(atmosphere.stormOutflows ?? []),
    mesoscale: structuredClone(atmosphere.mesoscale ?? null),
    airMassEngine: structuredClone(atmosphere.airMassEngine ?? null),
    regions: structuredClone(atmosphere.regions ?? []),
    synopticCoherence: structuredClone(atmosphere.synopticCoherence ?? null),
    setupForecast: structuredClone(atmosphere.setupForecast ?? null),
    outlookCycle: structuredClone(atmosphere.outlookCycle ?? null),
    upcomingSystemForecast: null,
    radarNetwork: structuredClone(atmosphere.radarNetwork ?? null),
    config: structuredClone(config)
  };
}

function frameByOffset(value) {
  const offset = Math.max(0, Math.min(timeline.hours, Number(value) || 0));
  const index = Math.round(offset / timeline.stepHours);
  const frame = timeline.frames[index];
  if (!frame) throw new Error(`Timeline frame ${offset}h is not generated yet.`);
  return frame;
}

function frameAtHour(value) {
  ensureReady();
  return frameByOffset(Number(value) - timeline.startHourUtc);
}

function ensureReady() {
  if (timeline.status !== 'ready') throw new Error(`Timeline is ${timeline.status}.`);
}

function cancelTimeline() {
  generationToken += 1;
  timeline.status = 'cancelled';
  timeline.frames = [];
  publishProgress('cancelled');
  return timelineStatus();
}

function timelineStatus() {
  const completedHours = timeline.completedSteps * timeline.stepHours;
  return {
    seed: timeline.seed,
    startHourUtc: timeline.startHourUtc,
    hours: timeline.hours,
    stepHours: timeline.stepHours,
    status: timeline.status,
    completedSteps: timeline.completedSteps,
    totalSteps: timeline.totalSteps,
    completedHours,
    progress: timeline.totalSteps ? timeline.completedSteps / timeline.totalSteps : 0,
    frameCount: timeline.frames.length,
    generationMs: timeline.generationMs,
    startedAtMs: timeline.startedAtMs,
    completedAtMs: timeline.completedAtMs,
    error: timeline.error
  };
}

function publishProgress(stage) {
  self.postMessage({ type: 'timeline-progress', progress: { ...timelineStatus(), stage } });
}

function emptyTimeline() {
  return {
    token: 0, seed: null, startHourUtc: null, hours: 0, stepHours: DEFAULT_STEP_HOURS,
    status: 'idle', completedSteps: 0, totalSteps: 0, frames: [], config: null,
    startedAtMs: null, completedAtMs: null, generationMs: null, error: null
  };
}

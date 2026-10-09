import { diagnoseCellEnvironment, diagnoseEventRisk } from './diagnostics/riskDiagnosis.js';
import { clamp } from './scenarios/math.js';
import { diagnoseBoundaries } from './diagnostics/boundaryDiagnosis.js';
import { diagnoseForcing } from './diagnostics/forcingDiagnosis.js';
import { updateCellDiagnostics } from './sounding.js';
import { sampleSynopticPattern, samplePatternWinds, cyclonicGradientWindKt } from './scenarios/synopticPattern.js';
import { airMassSurfaceState } from './scenarios/scenarioGenerator.js';
import { analyzeMapFeatures } from './analysis/mapAnalysis.js';
import { INITIAL_VALID_HOUR_UTC, OUTLOOK_INTERVAL_HOURS, PRESSURE_LEVELS_HPA } from './constants.js';
import { initializeStormEngine, advanceStormEngine, applyStormFeedback } from './storms/StormEngine.js';
import { initializeMesoscaleEngine, advanceMesoscaleEngine, projectBoundaryInfluence, projectBoundaryMetadata } from './mesoscale/MesoscaleEngine.js';
import { updateMesoscaleFields } from './mesoscale/MesoscaleFieldEngine.js';
import { initializeWorldFramework, preserveStaticFeatures } from './world/WorldFramework.js';
import { initializeAirMassEngine, advanceAirMassEngine } from './scenarios/AirMassEngine.js';
import { diagnoseSynopticCoherence } from './scenarios/SynopticCoherence.js';
import { initializeSetupForecast, updateSetupForecast } from './scenarios/SetupForecastEngine.js';
import { initializeOutlookCycle, updatePredictiveOutlooks } from './forecast/OutlookCycleEngine.js';
import { initializeStormObservationLayer, publishStormObservations } from './storms/StormObservationLayer.js';
import { initializeCoupledAtmosphere, advanceCoupledAtmosphere, projectStormInfluence } from './coupling/CoupledAtmosphereEngine.js';
import { initializeSynopticObjects, advanceSynopticObjects } from './synoptic/SynopticObjectEngine.js';
import { resolveRuntimeProfile } from './runtime/RuntimeProfile.js';
import { initializeMeteorologicalIntegrity, runMeteorologicalIntegrity } from './atmosphere/MeteorologicalIntegrityEngine.js';
import { applyBoundaryLayer, nocturnalCoolingFph } from './atmosphere/BoundaryLayerClosure.js';
import { advanceUpperAirTemperature } from './atmosphere/UpperAirTransport.js';

// Strong spring troughs top out near 85 kt at 500 mb and ~150 kt at 250 mb; higher
// values pushed 0-6 km bulk shear past 140 kt.


export function initializeEvolution(world, config, { profile = 'gameplay' } = {}) {
  const runtimeProfile = resolveRuntimeProfile(profile);
  world.runtime = { profile: runtimeProfile, initializedAtMs: nowMs(), phaseMs: {}, phaseRuns: {}, deferred: {} };
  world.validHourUtc = INITIAL_VALID_HOUR_UTC;
  world.evolution = {
    config,
    elapsedHours: 0,
    outlookValidHourUtc: INITIAL_VALID_HOUR_UTC,
    outlookAnalysis: null,
    performance: createEvolutionPerformanceState(),
    cadence: { mediumHours: runtimeProfile.mediumAnalysisHours, slowHours: runtimeProfile.slowAnalysisHours, thermodynamicsHours: runtimeProfile.fullThermodynamicsCadenceHours, mesoscaleHours: runtimeProfile.mesoscaleCadenceHours, coupledHours: runtimeProfile.coupledCadenceHours }
  };

  // 2.13.2 establishes immutable world geography before the atmosphere begins.
  // Regions, terrain and land-surface properties never advect with weather.
  initializeWorldFramework(world);
  world.forEachCell(cell => {
    cell.surface.seaLevelPressure = cell.surface.pressure;
    cell.surface.pressure = stationPressure(cell.surface.seaLevelPressure, cell.terrain.elevationM);
  });

  applyDiurnalAdjustment(world, INITIAL_VALID_HOUR_UTC);
  // Settle generator winds into the boundary layer before anything is diagnosed.
  applyBoundaryLayer(world, 2);
  enforcePhysicalConstraints(world);
  // Severe indices come only from soundings of the generated profiles.
  updateSoundingDiagnostics(world);
  diagnoseBoundaries(world);
  initializeSynopticObjects(world, config);
  initializeMesoscaleEngine(world);
  initializeCoupledAtmosphere(world);
  initializeAirMassEngine(world, config.synopticPattern);
  updateSoundingDiagnostics(world);
  initializeMeteorologicalIntegrity(world);
  projectBoundaryInfluence(world, 0);
  projectBoundaryMetadata(world);
  diagnoseForcing(world);
  updateMesoscaleFields(world, 0);
  initializeSetupForecast(world);
  world.forEachCell(cell => diagnoseCellEnvironment(cell));
  analyzeMapFeatures(world);
  diagnoseSynopticCoherence(world);
  updateOutlook(world);
  initializeStormEngine(world);
  advanceStormEngine(world, 0);
  initializeStormObservationLayer(world);
  initializeOutlookCycle(world, { initialDays: runtimeProfile.initialOutlookDays });

  // Store the exact initialized/displayed category as the only initial
  // authoritative outlook. Tests use this snapshot to catch future pipeline
  // divergence.
  world.initialAuthoritativeOutlook = {
    validHourUtc: world.validHourUtc,
    overallRisk: world.evolution.outlookAnalysis?.overallRisk ?? 'TSTM',
    riskLabel: world.evolution.outlookAnalysis?.riskLabel ?? 'General Thunderstorms'
  };
}

export function advanceAtmosphere(world, hours = 1, { advanceStorms = true } = {}) {
  const requested = Math.max(0, Number(hours) || 0);
  const configuredStep = Number(world.runtime?.profile?.atmosphereStepHours) || 0.5;
  const stepHours = Math.min(configuredStep, requested || configuredStep);
  const steps = Math.max(1, Math.round(requested / stepHours));

  for (let step = 0; step < steps; step++) {
    const stepStarted = nowMs();
    const previous = runEvolutionPhase(world, 'snapshot', () => createSnapshotBuffer(world));
    world.validHourUtc = Number((world.validHourUtc + stepHours).toFixed(2));
    world.evolution.elapsedHours = Number((world.evolution.elapsedHours + stepHours).toFixed(2));

    runEvolutionPhase(world, 'transport', () => {
      advectAndEvolve(world, previous, stepHours);
      applySynopticCoupling(world, stepHours);
      advanceUpperAirTemperature(world, stepHours);
      advanceAirMassEngine(world, world.evolution.config.synopticPattern, stepHours);
      applyTerrainForcing(world, stepHours);
      applyDiurnalAdjustment(world, world.validHourUtc, stepHours);
      applyBoundaryLayer(world, stepHours);
      enforcePhysicalConstraints(world);
    });

    runEvolutionPhase(world, 'fastDiagnostics', () => {
      const thermoDue = isCadenceDue(world, 'thermodynamics', world.evolution.cadence?.thermodynamicsHours ?? 1);
      if (thermoDue) runEvolutionPhase(world, 'thermodynamics', () => updateSoundingDiagnostics(world));
      else markEvolutionPhaseSkipped(world, 'thermodynamics');
      runEvolutionPhase(world, 'boundaryDiagnosis', () => diagnoseBoundaries(world, previous));
    });
    if (isCadenceDue(world, 'mesoscale', world.evolution.cadence?.mesoscaleHours ?? 1)) {
      runEvolutionPhase(world, 'mesoscale', () => {
        advanceSynopticObjects(world, stepHours);
        advanceMesoscaleEngine(world, stepHours);
        projectBoundaryInfluence(world, stepHours);
        enforcePhysicalConstraints(world);
        diagnoseForcing(world, previous);
        updateMesoscaleFields(world, stepHours);
      });
    } else {
      markEvolutionPhaseSkipped(world, 'mesoscale');
      projectBoundaryInfluence(world, stepHours);
    }

    runEvolutionPhase(world, 'meteorologicalIntegrity', () => runMeteorologicalIntegrity(world));

    if (isCadenceDue(world, 'medium', world.evolution.cadence?.mediumHours ?? 1)) {
      runEvolutionPhase(world, 'mediumAnalysis', () => {
        analyzeMapFeatures(world);
        updateSetupForecast(world);
      });
    } else markEvolutionPhaseSkipped(world, 'mediumAnalysis');

    if (isCadenceDue(world, 'slow', world.evolution.cadence?.slowHours ?? 3)) {
      runEvolutionPhase(world, 'slowAnalysis', () => diagnoseSynopticCoherence(world));
    } else markEvolutionPhaseSkipped(world, 'slowAnalysis');

    if (advanceStorms) {
      runEvolutionPhase(world, 'storms', () => {
        advanceStormEngine(world, stepHours);
        publishStormObservations(world, stepHours);
      });
    } else {
      runEvolutionPhase(world, 'storms', () => applyStormFeedback(world, stepHours));
    }
    if (isCadenceDue(world, 'coupling', world.evolution.cadence?.coupledHours ?? 1)) {
      runEvolutionPhase(world, 'coupling', () => {
        projectStormInfluence(world);
        advanceCoupledAtmosphere(world, stepHours);
      });
    } else markEvolutionPhaseSkipped(world, 'coupling');
    if (world.stormEngine?.feedbackApplied && world.runtime?.profile?.verification) {
      runEvolutionPhase(world, 'feedbackDiagnostics', () => {
        enforcePhysicalConstraints(world);
        runEvolutionPhase(world, 'feedbackThermodynamics', () => updateSoundingDiagnostics(world));
        diagnoseBoundaries(world, previous);
        diagnoseForcing(world, previous);
        updateMesoscaleFields(world, stepHours);
        analyzeMapFeatures(world);
        updateSetupForecast(world);
      });
    }
    projectBoundaryMetadata(world);

    if (isDay1OutlookCheckpoint(world.validHourUtc)) {
      world.forEachCell(cell => diagnoseCellEnvironment(cell));
      updateOutlook(world);
    }
    runEvolutionPhase(world, 'predictiveOutlooks', () => updatePredictiveOutlooks(world, { days: world.runtime?.profile?.verification ? null : ['day1'] }));
    const perf = world.evolution.performance ?? (world.evolution.performance = createEvolutionPerformanceState());
    perf.totalSteps += 1;
    perf.lastStepMs = nowMs() - stepStarted;
  }

  return world.evolution.outlookAnalysis;
}


export function advanceStormLayer(world, hours = 1 / 12, { applyFeedback = false, initiate = true } = {}) {
  const requested = Math.max(0, Number(hours) || 0);
  if (requested <= 0) return world.stormEngine;
  const cadenceHours = 1 / 12;
  const steps = Math.max(1, Math.round(requested / cadenceHours));
  const dtHours = requested / steps;
  for (let i = 0; i < steps; i++) {
    advanceStormEngine(world, dtHours, { applyFeedback, initiate });
    publishStormObservations(world, dtHours);
  }
  return world.stormEngine;
}

export function isDay1OutlookCheckpoint(hourUtc) {
  return Math.abs(hourUtc / OUTLOOK_INTERVAL_HOURS - Math.round(hourUtc / OUTLOOK_INTERVAL_HOURS)) < 1e-6;
}

function updateOutlook(world) {
  world.evolution.outlookAnalysis = diagnoseEventRisk(world);
  world.evolution.outlookValidHourUtc = world.validHourUtc;
}

function advectAndEvolve(world, previous, dtHours = 1) {

  world.forEachCell((cell, x, y) => {
    const localIndex = y * world.width + x;
    const local = readSnapshot(previous, localIndex);
    const speedKmH = local.windSpeed * 1.852;
    const directionRad = local.windDirection * Math.PI / 180;
    const towardEastKmH = -Math.sin(directionRad) * speedKmH;
    const towardSouthKmH = Math.cos(directionRad) * speedKmH;

    const sourceX = x - (towardEastKmH * dtHours / world.cellSizeKm) * 0.28;
    const sourceY = y - (towardSouthKmH * dtHours / world.cellSizeKm) * 0.28;
    const src = sampleSnapshot(previous, sourceX, sourceY, world.width, world.height);

    const neighborPressure = neighborhoodMean(previous, x, y, 'seaLevelPressure');
    const pressureDiffusion = (neighborPressure - local.seaLevelPressure) * 0.08;
    const thermalMix = 0.12;
    const moistureMix = 0.15;

    cell.surface.seaLevelPressure = src.seaLevelPressure + pressureDiffusion;
    cell.surface.pressure = stationPressure(cell.surface.seaLevelPressure, cell.terrain.elevationM);
    cell.surface.temperature = local.temperature * (1 - thermalMix) + src.temperature * thermalMix;
    cell.surface.dewpoint = local.dewpoint * (1 - moistureMix) + src.dewpoint * moistureMix;
    cell.surface.wind.speed = clamp(local.windSpeed * 0.82 + src.windSpeed * 0.18, 2, 70);
    cell.surface.wind.direction = blendDirection(local.windDirection, src.windDirection, 0.18);

    for (const level of PRESSURE_LEVELS_HPA) {
      cell.levels[level].temperature = local.levels[level].temperature * 0.86 + src.levels[level].temperature * 0.14;
      cell.levels[level].windSpeed = clamp(local.levels[level].windSpeed * 0.84 + src.levels[level].windSpeed * 0.16, 5, 190);
      cell.levels[level].windDirection = blendDirection(local.levels[level].windDirection, src.levels[level].windDirection, 0.16);
      const localTd = local.levels[level].dewpoint, srcTd = src.levels[level].dewpoint;
      if (Number.isFinite(localTd)) cell.levels[level].dewpoint = Number.isFinite(srcTd) ? localTd * 0.86 + srcTd * 0.14 : localTd;
    }

    // Atmospheric feature metadata may advect, but permanent geography may not.
    const fixedRegionId = cell.features.regionId;
    cell.features = { ...src.features, regionId: fixedRegionId };
    preserveStaticFeatures(world, cell, x, y);
  });
}


// Large-scale forcing from the evolving synoptic state (SynopticDynamics): the model's
// pressure, 500/250 mb heights and upper winds relax toward the balanced pattern; 850 mb winds
// respond to the model's own (smoothed) pressure gradient plus thermal wind and the synoptic
// low-level jet; and each air mass resupplies its moisture (Gulf moisture in tropical air).
const PRESSURE_RELAX_HOURS = 3;
const UPPER_RELAX_HOURS = 3;
const LOW_LEVEL_RELAX_HOURS = 2;
const MOISTURE_SOURCE_PER_HOUR = { mT: 0.10, other: 0.07 };
const POST_FRONTAL_TEMPERATURE_PER_HOUR = 0.04;
const MID_LEVEL_RELAX_HOURS = 12;
const MOIST_LEVELS_HPA = [850, 700];
const RHO = 1.15, CORIOLIS = 1e-4, MS_TO_KT = 1.943844;

function applySynopticCoupling(world, dtHours = 1) {
  const config = world.evolution?.config;
  const pattern = config?.synopticPattern;
  if (!pattern || !(dtHours > 0)) return;
  const elapsed = world.evolution.elapsedHours;
  const rotation = Number(config.patternRotationDegrees) || 0;
  const upperRate = clamp(dtHours / UPPER_RELAX_HOURS, 0, 1);
  const pressureRate = clamp(dtHours / PRESSURE_RELAX_HOURS, 0, 1);
  const lowLevelRate = clamp(dtHours / LOW_LEVEL_RELAX_HOURS, 0, 1);
  const samples = [];
  world.forEachCell((cell, x, y) => {
    const point = displayToPatternCoordinates(x / Math.max(1, world.width - 1), y / Math.max(1, world.height - 1), config);
    const synoptic = { ...sampleSynopticPattern(pattern, point.x, point.y, elapsed), ...samplePatternWinds(pattern, point.x, point.y) };
    samples[y * world.width + x] = synoptic;

    cell.surface.seaLevelPressure += (synoptic.seaLevelPressureHpa - cell.surface.seaLevelPressure) * pressureRate;
    cell.surface.pressure = stationPressure(cell.surface.seaLevelPressure, cell.terrain.elevationM);
    cell.levels[500].heightDm = Number.isFinite(cell.levels[500].heightDm)
      ? cell.levels[500].heightDm + (synoptic.height500Dm - cell.levels[500].heightDm) * upperRate
      : synoptic.height500Dm;
    cell.levels[250].heightDm = 1035 + (cell.levels[500].heightDm - 570) * 0.72;
    relaxWind(cell.levels[500], rotateToDisplay({ e: synoptic.u500Kt, n: synoptic.v500Kt }, rotation), upperRate);
    relaxWind(cell.levels[250], rotateToDisplay({ e: synoptic.u250Kt, n: synoptic.v250Kt }, rotation), upperRate);

    const airMass = config.ingredients ? airMassSurfaceState(config, synoptic, point.x, point.y) : null;
    if (airMass) {
      const moistureRate = (synoptic.airMass === 'mT' ? MOISTURE_SOURCE_PER_HOUR.mT : MOISTURE_SOURCE_PER_HOUR.other) * dtHours;
      cell.surface.dewpoint += (airMass.dewpointF - cell.surface.dewpoint) * clamp(moistureRate, 0, 1);
      // Cold air advection behind fronts (not resolved by the damped transport step).
      const coolAir = clamp(synoptic.postFrontal + synoptic.coolSector, 0, 1);
      cell.surface.temperature += (airMass.meanTemperatureF - cell.surface.temperature) * clamp(POST_FRONTAL_TEMPERATURE_PER_HOUR * coolAir * dtHours, 0, 1);
      // Mid-level air masses (EML cap, trough cold core) are advected in and resupplied.
      const midRate = clamp(dtHours / MID_LEVEL_RELAX_HOURS, 0, 1);
      cell.levels[700].temperature += (airMass.t700C - cell.levels[700].temperature) * midRate;
      cell.levels[500].temperature += (airMass.t500C - cell.levels[500].temperature) * midRate;
      // Moisture aloft: the moist layer's depth is part of each air mass.
      if (Number.isFinite(cell.levels[850].dewpoint)) cell.levels[850].dewpoint += (airMass.td850C - cell.levels[850].dewpoint) * clamp(moistureRate, 0, 1);
      if (Number.isFinite(cell.levels[700].dewpoint)) cell.levels[700].dewpoint += (airMass.td700C - cell.levels[700].dewpoint) * midRate;
      cell.features.airMassTemperatureF = airMass.meanTemperatureF;
      cell.features.airMass850C = airMass.t850C;
    }
    cell.features.airMass = synoptic.airMass;
    cell.features.warmSector = synoptic.warmSector > 0.42;
    cell.features.synopticAscent = synoptic.upperSupport;
    cell.features.upperTrough = synoptic.troughCore > 0.48;
    cell.features.shortwaveTrough = synoptic.shortwaveCore > 0.52;
    cell.features.jetStreak = synoptic.jetCore > 0.56;
    cell.features.synopticLifecycle = synoptic.lifecycle;
  });

  // 850 mb wind: geostrophic from the model's smoothed pressure field, plus 25% of the
  // thermal wind toward 500 mb and the synoptic low-level jet downstream of the low.
  diagnoseIsallobaricWind(world, dtHours);

  // Balance the synoptic-scale pressure field (two 5x5 passes, ~45 km): frontal-scale and
  // storm-scale pressure features are not in geostrophic balance.
  const pressure = smoothedField(world, cell => cell.surface.seaLevelPressure, 2, 2);
  const metres = world.cellSizeKm * 1000;
  const llj = lowLevelJetCenter(config, pattern);
  world.forEachCell((cell, x, y) => {
    const at = (i, j) => pressure[clampIndex(j, world.height) * world.width + clampIndex(i, world.width)];
    const dpdx = (at(x + 1, y) - at(x - 1, y)) * 100 / (2 * metres);
    const dpdNorth = (at(x, y - 1) - at(x, y + 1)) * 100 / (2 * metres);
    const point = displayToPatternCoordinates(x / Math.max(1, world.width - 1), y / Math.max(1, world.height - 1), config);
    const vg = cyclonicGradientWindKt({ e: -dpdNorth / (RHO * CORIOLIS) * MS_TO_KT, n: dpdx / (RHO * CORIOLIS) * MS_TO_KT }, Math.hypot(point.x - pattern.lowX, point.y - pattern.lowY) * pattern.domainKm);
    const w500 = windComponents(cell.levels[500]);
    const synoptic = samples[y * world.width + x];
    const base = { e: 0.95 * vg.e + 0.25 * (w500.e - vg.e), n: 0.95 * vg.n + 0.25 * (w500.n - vg.n) };
    const jetCore = Math.exp(-((point.x - llj.x) ** 2 + (point.y - llj.y) ** 2) / (0.32 * 0.32)) * synoptic.southOfWarmFront * synoptic.aheadOfColdFront;
    const baseSpeed = Math.hypot(base.e, base.n) || 1;
    const jet = 0.5 * (Number(pattern.lljKt) || 0) * jetCore;
    relaxWind(cell.levels[850], { e: base.e + jet * base.e / baseSpeed, n: base.n + jet * base.n / baseSpeed }, lowLevelRate);
  });
}

// Isallobaric wind: boundary-layer air accelerates toward falling pressure, so surface winds
// back ahead of an approaching or deepening low (and blow out of rising pressure behind it).
// V = -(1/(rho f^2)) grad(dp/dt), from the smoothed model pressure tendency.
const ISALLOBARIC_LIMIT_KT = 20; // numerical safeguard against abrupt pressure jumps
function diagnoseIsallobaricWind(world, dtHours) {
  const w = world.width, h = world.height;
  const tendency = smoothedField(world, cell => {
    const previous = Number(cell.dynamics?.previousSeaLevelPressure);
    return Number.isFinite(previous) ? (cell.surface.seaLevelPressure - previous) / dtHours : 0;
  }, 2, 2);
  const metres = world.cellSizeKm * 1000;
  world.forEachCell((cell, x, y) => {
    const at = (i, j) => tendency[clampIndex(j, h) * w + clampIndex(i, w)] * 100 / 3600; // Pa/s
    const dTdx = (at(x + 1, y) - at(x - 1, y)) / (2 * metres);
    const dTdNorth = (at(x, y - 1) - at(x, y + 1)) / (2 * metres);
    const k = MS_TO_KT / (RHO * CORIOLIS * CORIOLIS);
    let e = -k * dTdx, n = -k * dTdNorth;
    const speed = Math.hypot(e, n);
    if (speed > ISALLOBARIC_LIMIT_KT) { e *= ISALLOBARIC_LIMIT_KT / speed; n *= ISALLOBARIC_LIMIT_KT / speed; }
    cell.dynamics ??= {};
    cell.dynamics.isallobaricWindKt = { e, n };
    cell.dynamics.pressureTendencyHpaPerHour = tendency[y * w + x];
    cell.dynamics.previousSeaLevelPressure = cell.surface.seaLevelPressure;
  });
}

// The synoptic low-level jet sits south-southeast of the surface low and moves with it.
function lowLevelJetCenter(config, pattern) {
  return { x: pattern.lowX + (Number(config.lljOffsetX) || 0.2), y: pattern.lowY + (Number(config.lljOffsetY) || 0.3) };
}

function relaxWind(level, target, rate) {
  const current = windComponents(level);
  const e = current.e + (target.e - current.e) * rate, n = current.n + (target.n - current.n) * rate;
  level.windSpeed = Math.hypot(e, n);
  level.windDirection = ((Math.atan2(-e, -n) * 180 / Math.PI) % 360 + 360) % 360;
}

function windComponents(level) {
  const speed = Number(level?.windSpeed) || 0, dir = (Number(level?.windDirection) || 0) * Math.PI / 180;
  return { e: -speed * Math.sin(dir), n: -speed * Math.cos(dir) };
}

// The display frame is the pattern frame rotated counterclockwise by patternRotationDegrees.
function rotateToDisplay(w, degrees) {
  const r = degrees * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return { e: w.e * c - w.n * s, n: w.e * s + w.n * c };
}

function smoothedField(world, get, radius = 1, passes = 1) {
  const w = world.width, h = world.height;
  let field = new Float64Array(w * h);
  world.forEachCell((cell, x, y) => { field[y * w + x] = get(cell); });
  for (let pass = 0; pass < passes; pass++) {
    const out = new Float64Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let j = -radius; j <= radius; j++) for (let i = -radius; i <= radius; i++) { sum += field[clampIndex(y + j, h) * w + clampIndex(x + i, w)]; n++; }
      out[y * w + x] = sum / n;
    }
    field = out;
  }
  return field;
}

function clampIndex(i, n) { return i < 0 ? 0 : i >= n ? n - 1 : i; }

function displayToPatternCoordinates(x, y, config = {}) {
  let px = x;
  let py = y;
  switch ((((Number(config.patternOrientation) || 0) % 4) + 4) % 4) {
    case 1: px = y; py = 1 - x; break;
    case 2: px = 1 - x; py = 1 - y; break;
    case 3: px = 1 - y; py = x; break;
  }
  if (config.patternMirror) px = 1 - px;
  const radians = (Number(config.patternRotationDegrees) || 0) * Math.PI / 180;
  if (radians) {
    const dx = px - 0.5;
    const dy = py - 0.5;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    px = 0.5 + dx * cos - dy * sin;
    py = 0.5 + dx * sin + dy * cos;
  }
  return { x: px, y: py };
}

function applyTerrainForcing(world, dtHours = 1) {
  world.forEachCell((cell, x, y) => {
    if (!cell.terrain._slopeCached) {
    const west = world.getCell(Math.max(0, x - 1), y)?.terrain.elevationM ?? cell.terrain.elevationM;
    const east = world.getCell(Math.min(world.width - 1, x + 1), y)?.terrain.elevationM ?? cell.terrain.elevationM;
    const north = world.getCell(x, Math.max(0, y - 1))?.terrain.elevationM ?? cell.terrain.elevationM;
    const south = world.getCell(x, Math.min(world.height - 1, y + 1))?.terrain.elevationM ?? cell.terrain.elevationM;

    const slopeEast = (east - west) / (2 * world.cellSizeKm);
    const slopeSouth = (south - north) / (2 * world.cellSizeKm);
    cell.terrain.slopeX = slopeEast;
    cell.terrain.slopeY = slopeSouth;
    cell.terrain._slopeCached = true;
    }
    const slopeEast = cell.terrain.slopeX ?? 0;
    const slopeSouth = cell.terrain.slopeY ?? 0;

    const windRad = cell.surface.wind.direction * Math.PI / 180;
    const flowEast = -Math.sin(windRad);
    const flowSouth = Math.cos(windRad);
    const upslope = flowEast * slopeEast + flowSouth * slopeSouth;

    if (upslope > 0) {
      cell.surface.temperature -= Math.min(0.35, upslope * 0.018) * dtHours;
      cell.surface.dewpoint += Math.min(0.22, upslope * 0.012) * dtHours;
      cell.surface.seaLevelPressure -= Math.min(0.12, upslope * 0.004) * dtHours;
    } else {
      const downslope = Math.abs(upslope);
      cell.surface.temperature += Math.min(0.32, downslope * 0.016) * dtHours;
      cell.surface.dewpoint -= Math.min(0.28, downslope * 0.014) * dtHours;
    }

    cell.surface.pressure = stationPressure(cell.surface.seaLevelPressure, cell.terrain.elevationM);
  });
}

export function applyDiurnalAdjustment(world, absoluteHour, dtHours = 1) {
  const utcHour = ((absoluteHour % 24) + 24) % 24;
  const localHour = ((utcHour - 6) % 24 + 24) % 24; // representative central-Plains solar time
  // Smooth clear-sky heating begins at sunrise instead of waiting for late morning.
  // The half-sine is intentionally non-zero shortly after 06 local and peaks near 14:30.
  const daylight = localHour < 5.75 || localHour > 20.75 ? 0
    : Math.sin(Math.PI * (localHour - 5.75) / 15);
  const solar = clamp(daylight, 0, 1);
  const afternoonMixing = localHour < 10 || localHour > 19 ? 0 : Math.sin((localHour - 10) / 9 * Math.PI);

  world.forEachCell(cell => {
    const elevationCoolingF = cell.terrain.elevationM * 0.0032;
    const soilFactor = 0.75 + (1 - (cell.terrain.soilMoisture ?? 0.45)) * 0.5;
    const strictWarmSector = cell.features?.warmSector ? 1 : 0;
    const broaderSevereAirMass = clamp(Math.max(Number(cell.forecast?.openWarmSectorSupport) || 0, Number(cell.forecast?.moistureTransport) || 0, ((Number(cell.surface?.dewpoint)||45)-52)/18), 0, 1);
    const warmSector = Math.max(strictWarmSector, broaderSevereAirMass * 0.82);
    const processedAir = clamp(Number(cell.memory?.processedAir ?? cell.features?.stormProcessedAir) || 0, 0, 1);
    const coldPool = clamp(Number(cell.memory?.coldPoolMemory ?? cell.features?.coldPoolInfluence) || 0, 0, 1);
    const cloudCover = clamp(Number(cell.memory?.cloudCover ?? cell.features?.cloudCover) || 0, 0, 1);
    const activeStormInfluence = clamp(Number(cell.memory?.activeStormInfluence ?? cell.features?.activeStormInfluence) || 0, 0, 1);
    const recoveryEligibility = clamp((0.35 + 0.65 * warmSector) * Math.max(0.18, solar) * (1 - processedAir) * (1 - coldPool) * (1 - activeStormInfluence) * (1 - 0.55 * cloudCover), 0, 1);
    const preConvectiveRecovery = solar > 0.02 ? recoveryEligibility : 0;

    // Daytime heating drives the surface toward the mixed-layer temperature: 850 mb air
    // brought dry-adiabatically to the ground plus a shallow superadiabatic surface layer.
    // Afternoon highs therefore follow the air mass aloft (and terrain height) instead of
    // a fixed heating rate.
    const t850 = Number(cell.levels?.[850]?.temperature);
    const mixedLayerF = Number.isFinite(t850) ? (t850 + 0.0098 * Math.max(0, 1457 - cell.terrain.elevationM) + 1.5) * 9 / 5 + 32 : cell.surface.temperature;
    const shading = (1 - 0.6 * cloudCover) * (1 - 0.6 * Math.max(coldPool, activeStormInfluence)) * (1 - 0.4 * processedAir);
    const solarHeatingFph = solar * clamp((mixedLayerF - cell.surface.temperature) / 3, 0, 4) * shading * soilFactor;
    // Night cooling relaxes toward a dewpoint-limited floor (BoundaryLayerClosure); the
    // former constant 0.30 F/h let surface temperatures climb ~10-20 F per day.
    const radiativeCoolingFph = Math.max(solar < 0.02 ? 0.30 : 0.08 * (1 - solar), nocturnalCoolingFph(cell, solar));
    const recoveryHeatingFph = 0;
    const temperatureTendencyFph = solarHeatingFph + recoveryHeatingFph - radiativeCoolingFph;
    cell.surface.temperature += temperatureTendencyFph * dtHours - elevationCoolingF * 0.012;

    const dewpointDepression = Math.max(0, cell.surface.temperature - cell.surface.dewpoint);
    const mixingDryingFph = afternoonMixing * clamp(dewpointDepression / 35, 0, 1) * 0.18 * (1 - 0.35 * warmSector);
    const wind850 = cell.levels?.[850]?.wind ?? cell.levels?.[850] ?? {};
    const fromSouth = Math.max(0, Math.cos(((Number(wind850.direction ?? wind850.windDirection) || 180) - 180) * Math.PI / 180));
    const lowLevelFlow = clamp(((Number(wind850.speed ?? wind850.windSpeed) || 0) - 12) / 36, 0, 1);
    const moistureAdvectionFph = (0.10 + 0.36 * solar) * fromSouth * lowLevelFlow * (0.22 + 0.78 * warmSector) * (1 - 0.45 * processedAir);
    const moistureRecoveryFph = 0.14 * preConvectiveRecovery;
    const dewpointTendencyFph = moistureAdvectionFph + moistureRecoveryFph - mixingDryingFph;
    cell.surface.dewpoint += dewpointTendencyFph * dtHours;

    const diagnostics = cell.derived?.diagnostics ?? (cell.derived.diagnostics = {});
    const energyBudget = {
      hourUtc: absoluteHour,
      localSolarHour: localHour,
      solarHeatingFph,
      recoveryHeatingFph,
      radiativeCoolingFph,
      moistureAdvectionFph,
      moistureRecoveryFph,
      mixingDryingFph,
      netTemperatureTendencyFph: temperatureTendencyFph,
      netDewpointTendencyFph: dewpointTendencyFph,
      preConvectiveRecovery,
      recoveryEligibility,
      recoveryBlockedReason: processedAir > 0.35 ? 'processed-air' : coldPool > 0.35 ? 'cold-pool' : activeStormInfluence > 0.35 ? 'active-storm' : cloudCover > 0.8 ? 'cloud-cover' : solar <= 0.02 ? 'night' : null,
      broaderSevereAirMass,
      processedAir,
      coldPoolInfluence: coldPool,
      activeStormInfluence,
      cloudCover
    };
    diagnostics.energyBudget = energyBudget;
    cell.environmentDiagnostics ??= {};
    cell.environmentDiagnostics.energyBudget = energyBudget;
  });
}


function createEvolutionPerformanceState() {
  return {
    phaseMs: {},
    phaseRuns: {},
    phaseSkips: {},
    totalSteps: 0,
    lastStepMs: 0
  };
}

function runEvolutionPhase(world, name, callback) {
  const perf = world.evolution?.performance ?? (world.evolution.performance = createEvolutionPerformanceState());
  const started = nowMs();
  const result = callback();
  perf.phaseMs[name] = (perf.phaseMs[name] ?? 0) + (nowMs() - started);
  perf.phaseRuns[name] = (perf.phaseRuns[name] ?? 0) + 1;
  return result;
}

function markEvolutionPhaseSkipped(world, name) {
  const perf = world.evolution?.performance ?? (world.evolution.performance = createEvolutionPerformanceState());
  perf.phaseSkips[name] = (perf.phaseSkips[name] ?? 0) + 1;
}

function isCadenceDue(world, key, intervalHours) {
  const cadence = world.evolution._cadenceState ??= {};
  const current = Number(world.evolution.elapsedHours) || 0;
  const tick = Math.floor((current + 1e-6) / intervalHours);
  if (tick <= 0 || cadence[key] === tick) return false;
  cadence[key] = tick;
  return true;
}

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function updateSoundingDiagnostics(world) {
  world.forEachCell(cell => updateCellDiagnostics(cell));
}

function enforcePhysicalConstraints(world) {
  world.forEachCell(cell => {
    cell.surface.dewpoint = Math.min(cell.surface.temperature, cell.surface.dewpoint);
    cell.surface.seaLevelPressure = clamp(cell.surface.seaLevelPressure, 930, 1065);
    cell.surface.pressure = stationPressure(cell.surface.seaLevelPressure, cell.terrain.elevationM);
    for (const level of MOIST_LEVELS_HPA) if (Number.isFinite(cell.levels[level].dewpoint)) cell.levels[level].dewpoint = Math.min(cell.levels[level].dewpoint, cell.levels[level].temperature);
    for (const level of [850,700,500,250]) {
      const data=cell.levels[level];
      data.windSpeed=clamp(data.windSpeed,0,200);
      data.windDirection=((data.windDirection%360)+360)%360;
    }
  });
}

function stationPressure(seaLevelPressure, elevationM) {
  return seaLevelPressure * Math.exp(-elevationM / 8434.5);
}

function createSnapshotBuffer(world) {
  const count = world.width * world.height;
  let buffer = world.evolution?.snapshotBuffer;
  if (!buffer || buffer.width !== world.width || buffer.height !== world.height) buffer = {
    width: world.width,
    height: world.height,
    seaLevelPressure: new Float32Array(count),
    temperature: new Float32Array(count),
    dewpoint: new Float32Array(count),
    windSpeed: new Float32Array(count),
    windDirection: new Float32Array(count),
    levelTemperature: {},
    levelWindSpeed: {},
    levelWindDirection: {},
    levelDewpoint: {},
    features: new Array(count)
  };
  for (const level of PRESSURE_LEVELS_HPA) {
    buffer.levelTemperature[level] ??= new Float32Array(count);
    buffer.levelWindSpeed[level] ??= new Float32Array(count);
    buffer.levelWindDirection[level] ??= new Float32Array(count);
  }
  buffer.levelDewpoint ??= {};
  for (const level of MOIST_LEVELS_HPA) buffer.levelDewpoint[level] ??= new Float32Array(count);
  if (world.evolution) world.evolution.snapshotBuffer = buffer;
  world.forEachCell((cell, x, y) => {
    const index = y * world.width + x;
    buffer.seaLevelPressure[index] = cell.surface.seaLevelPressure ?? cell.surface.pressure;
    buffer.temperature[index] = cell.surface.temperature;
    buffer.dewpoint[index] = cell.surface.dewpoint;
    buffer.windSpeed[index] = cell.surface.wind.speed;
    buffer.windDirection[index] = cell.surface.wind.direction;
    for (const level of PRESSURE_LEVELS_HPA) {
      buffer.levelTemperature[level][index] = cell.levels[level].temperature;
      buffer.levelWindSpeed[level][index] = cell.levels[level].windSpeed;
      buffer.levelWindDirection[level][index] = cell.levels[level].windDirection;
    }
    for (const level of MOIST_LEVELS_HPA) buffer.levelDewpoint[level][index] = Number.isFinite(cell.levels[level].dewpoint) ? cell.levels[level].dewpoint : NaN;
    buffer.features[index] = cell.features;
  });
  return buffer;
}

function readSnapshot(buffer, index) {
  return {
    seaLevelPressure: buffer.seaLevelPressure[index],
    temperature: buffer.temperature[index],
    dewpoint: buffer.dewpoint[index],
    windSpeed: buffer.windSpeed[index],
    windDirection: buffer.windDirection[index],
    levels: Object.fromEntries(PRESSURE_LEVELS_HPA.map(level => [level, {
      temperature: buffer.levelTemperature[level][index],
      windSpeed: buffer.levelWindSpeed[level][index],
      windDirection: buffer.levelWindDirection[level][index],
      dewpoint: buffer.levelDewpoint?.[level]?.[index]
    }])),
    features: buffer.features[index]
  };
}

function sampleSnapshot(grid, x, y, width, height) {
  const safeX = clamp(x, 0, width - 1);
  const safeY = clamp(y, 0, height - 1);
  const x0 = Math.floor(safeX);
  const y0 = Math.floor(safeY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = safeX - x0;
  const ty = safeY - y0;
  const a = y0 * width + x0;
  const b = y0 * width + x1;
  const c = y1 * width + x0;
  const d = y1 * width + x1;

  return {
    seaLevelPressure: bilerp(grid.seaLevelPressure[a], grid.seaLevelPressure[b], grid.seaLevelPressure[c], grid.seaLevelPressure[d], tx, ty),
    temperature: bilerp(grid.temperature[a], grid.temperature[b], grid.temperature[c], grid.temperature[d], tx, ty),
    dewpoint: bilerp(grid.dewpoint[a], grid.dewpoint[b], grid.dewpoint[c], grid.dewpoint[d], tx, ty),
    windSpeed: bilerp(grid.windSpeed[a], grid.windSpeed[b], grid.windSpeed[c], grid.windSpeed[d], tx, ty),
    windDirection: blendDirection(blendDirection(grid.windDirection[a], grid.windDirection[b], tx), blendDirection(grid.windDirection[c], grid.windDirection[d], tx), ty),
    levels: Object.fromEntries(PRESSURE_LEVELS_HPA.map(level => [level, {
      temperature: bilerp(grid.levelTemperature[level][a], grid.levelTemperature[level][b], grid.levelTemperature[level][c], grid.levelTemperature[level][d], tx, ty),
      windSpeed: bilerp(grid.levelWindSpeed[level][a], grid.levelWindSpeed[level][b], grid.levelWindSpeed[level][c], grid.levelWindSpeed[level][d], tx, ty),
      windDirection: blendDirection(blendDirection(grid.levelWindDirection[level][a], grid.levelWindDirection[level][b], tx), blendDirection(grid.levelWindDirection[level][c], grid.levelWindDirection[level][d], tx), ty),
      dewpoint: grid.levelDewpoint?.[level] ? bilerp(grid.levelDewpoint[level][a], grid.levelDewpoint[level][b], grid.levelDewpoint[level][c], grid.levelDewpoint[level][d], tx, ty) : NaN
    }])),
    features: tx + ty < 1 ? grid.features[a] : grid.features[d]
  };
}

function neighborhoodMean(grid, x, y, key) {
  const values = grid[key];
  let sum = 0;
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= grid.height) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= grid.width) continue;
      const value = values[yy * grid.width + xx];
      if (Number.isFinite(value)) { sum += value; count++; }
    }
  }
  return count ? sum / count : values[y * grid.width + x];
}

function bilerp(a, b, c, d, tx, ty) {
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

function blendDirection(a, b, t) {
  const ar = a * Math.PI / 180;
  const br = b * Math.PI / 180;
  const u = (1 - t) * Math.sin(ar) + t * Math.sin(br);
  const v = (1 - t) * Math.cos(ar) + t * Math.cos(br);
  return (Math.atan2(u, v) * 180 / Math.PI + 360) % 360;
}

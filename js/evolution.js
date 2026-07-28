import { diagnoseCellEnvironment, diagnoseEventRisk } from './diagnostics/riskDiagnosis.js?v=2.20.1';
import { clamp } from './scenarios/math.js?v=2.20.1';
import { diagnoseBoundaries } from './diagnostics/boundaryDiagnosis.js?v=2.20.1';
import { diagnoseForcing } from './diagnostics/forcingDiagnosis.js?v=2.20.1';
import { updateCellDiagnostics } from './sounding.js?v=2.20.1';
import { sampleSynopticPattern, airMassThermodynamics } from './scenarios/synopticPattern.js?v=2.20.1';
import { analyzeMapFeatures } from './analysis/mapAnalysis.js?v=2.20.1';
import { INITIAL_VALID_HOUR_UTC, OUTLOOK_INTERVAL_HOURS, PRESSURE_LEVELS_HPA } from './constants.js?v=2.20.1';
import { initializeStormEngine, advanceStormEngine, applyStormFeedback } from './storms/StormEngine.js?v=2.22.0';
import { initializeMesoscaleEngine, advanceMesoscaleEngine, projectBoundaryInfluence, projectBoundaryMetadata } from './mesoscale/MesoscaleEngine.js?v=2.20.1';
import { updateMesoscaleFields } from './mesoscale/MesoscaleFieldEngine.js?v=2.20.1';
import { initializeWorldFramework, preserveStaticFeatures } from './world/WorldFramework.js?v=2.20.1';
import { initializeAirMassEngine, advanceAirMassEngine } from './scenarios/AirMassEngine.js?v=2.20.1';
import { diagnoseSynopticCoherence } from './scenarios/SynopticCoherence.js?v=2.20.1';
import { initializeSetupForecast, updateSetupForecast } from './scenarios/SetupForecastEngine.js?v=2.20.1';
import { initializeOutlookCycle, updatePredictiveOutlooks } from './forecast/OutlookCycleEngine.js?v=2.20.1';
import { initializeStormObservationLayer, publishStormObservations } from './storms/StormObservationLayer.js?v=2.20.1';
import { initializeCoupledAtmosphere, advanceCoupledAtmosphere, projectStormInfluence } from './coupling/CoupledAtmosphereEngine.js?v=2.21.4';


export function initializeEvolution(world, config) {
  world.validHourUtc = INITIAL_VALID_HOUR_UTC;
  world.evolution = {
    config,
    elapsedHours: 0,
    outlookValidHourUtc: INITIAL_VALID_HOUR_UTC,
    outlookAnalysis: null,
    performance: createEvolutionPerformanceState(),
    cadence: { mediumHours: 1, slowHours: 3 }
  };

  // 2.13.2 establishes immutable world geography before the atmosphere begins.
  // Regions, terrain and land-surface properties never advect with weather.
  initializeWorldFramework(world);
  world.forEachCell(cell => {
    cell.surface.seaLevelPressure = cell.surface.pressure;
    cell.surface.pressure = stationPressure(cell.surface.seaLevelPressure, cell.terrain.elevationM);
  });

  applyInitialMorningPhaseAdjustment(world, INITIAL_VALID_HOUR_UTC);
  applyDiurnalAdjustment(world, INITIAL_VALID_HOUR_UTC);
  enforcePhysicalConstraints(world);
  // Initial derived fields already come from the authoritative generation formulas.
  diagnoseBoundaries(world);
  initializeMesoscaleEngine(world);
  initializeCoupledAtmosphere(world);
  initializeAirMassEngine(world, config.synopticPattern);
  updateSoundingDiagnostics(world);
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
  initializeOutlookCycle(world);

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
  const stepHours = 0.5;
  const steps = Math.round(requested / stepHours);

  for (let step = 0; step < steps; step++) {
    const stepStarted = nowMs();
    const previous = runEvolutionPhase(world, 'snapshot', () => createSnapshotBuffer(world));
    world.validHourUtc = Number((world.validHourUtc + stepHours).toFixed(2));
    world.evolution.elapsedHours = Number((world.evolution.elapsedHours + stepHours).toFixed(2));

    runEvolutionPhase(world, 'transport', () => {
      advectAndEvolve(world, previous, stepHours);
      applySynopticCoupling(world, stepHours);
      advanceAirMassEngine(world, world.evolution.config.synopticPattern, stepHours);
      applyTerrainForcing(world, stepHours);
      applyDiurnalAdjustment(world, world.validHourUtc, stepHours);
      enforcePhysicalConstraints(world);
    });

    runEvolutionPhase(world, 'fastDiagnostics', () => {
      runEvolutionPhase(world, 'thermodynamics', () => updateSoundingDiagnostics(world));
      runEvolutionPhase(world, 'boundaryDiagnosis', () => diagnoseBoundaries(world, previous));
    });
    runEvolutionPhase(world, 'mesoscale', () => {
      advanceMesoscaleEngine(world, stepHours);
      projectBoundaryInfluence(world, stepHours);
      enforcePhysicalConstraints(world);
      diagnoseForcing(world, previous);
      updateMesoscaleFields(world, stepHours);
    });

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
    runEvolutionPhase(world, 'coupling', () => {
      projectStormInfluence(world);
      advanceCoupledAtmosphere(world, stepHours);
    });
    if (world.stormEngine?.feedbackApplied) {
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
    runEvolutionPhase(world, 'predictiveOutlooks', () => updatePredictiveOutlooks(world));
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
    }

    // Atmospheric feature metadata may advect, but permanent geography may not.
    const fixedRegionId = cell.features.regionId;
    cell.features = { ...src.features, regionId: fixedRegionId };
    preserveStaticFeatures(world, cell, x, y);
  });
}


function applySynopticCoupling(world, dtHours = 1) {
  const pattern = world.evolution?.config?.synopticPattern;
  if (!pattern) return;
  const elapsed = world.evolution.elapsedHours;
  world.forEachCell((cell, x, y) => {
    const displayNx = x / Math.max(1, world.width - 1);
    const displayNy = y / Math.max(1, world.height - 1);
    const patternPoint = displayToPatternCoordinates(displayNx, displayNy, world.evolution?.config);
    const nx = patternPoint.x;
    const ny = patternPoint.y;
    const synoptic = sampleSynopticPattern(pattern, nx, ny, elapsed);
    const lifecycle = scenarioLifecycle(world.evolution?.config?.scenarioEvolution, elapsed);
    const airMass = airMassThermodynamics(synoptic.airMass, ny, pattern.intensity);
    const config = world.evolution?.config ?? {};

    // Large-scale pressure tendencies are tied to the translating upper wave.
    // Advection retains mesoscale detail while this weak nudge prevents the
    // surface low, fronts and 500-mb pattern from drifting apart.
    const pressureNudge = (0.10 + synoptic.upperSupport * 0.08) * lifecycle.forcing * dtHours;
    cell.surface.seaLevelPressure += (synoptic.seaLevelPressureHpa - cell.surface.seaLevelPressure) * pressureNudge;
    cell.surface.pressure = stationPressure(cell.surface.seaLevelPressure, cell.terrain.elevationM);

    cell.levels[500].heightDm = Number.isFinite(cell.levels[500].heightDm)
      ? cell.levels[500].heightDm * 0.78 + synoptic.height500Dm * 0.22
      : synoptic.height500Dm;
    cell.levels[250].heightDm = 1035 + (cell.levels[500].heightDm - 570) * 0.72;
    cell.levels[500].windSpeed = clamp(cell.levels[500].windSpeed * (1 - 0.18*lifecycle.kinematic) + synoptic.jet500Kt * (0.18*lifecycle.kinematic), 18, 120);
    cell.levels[250].windSpeed = clamp(cell.levels[250].windSpeed * (1 - 0.20*lifecycle.kinematic) + synoptic.jet250Kt * (0.20*lifecycle.kinematic), 35, 195);

    const sourceStrength = (synoptic.airMass === 'mT' ? 0.055 : 0.035) * lifecycle.moisture;
    const significantEnvelope = ['significant_regional','extreme_regional'].includes(config.atmosphericEnvelope);
    const analogMoistureTarget = Number(config.gulfDewpoint)
      - Number(config.northMoistureLoss ?? 7) * (1 - ny)
      - (1 - lifecycle.moisture) * 3.5;
    const dewpointTarget = significantEnvelope && synoptic.airMass === 'mT'
      ? Math.max(airMass.dewpointF * pattern.moistureFactor, analogMoistureTarget)
      : airMass.dewpointF * pattern.moistureFactor;
    cell.surface.temperature += (airMass.temperatureF - cell.surface.temperature) * sourceStrength;
    cell.surface.dewpoint += (dewpointTarget - cell.surface.dewpoint) * sourceStrength;
    if (significantEnvelope && synoptic.airMass === 'mT') {
      const coolingTarget = Number(config.temp500Base);
      if (Number.isFinite(coolingTarget) && cell.levels[500].temperature > coolingTarget) {
        const coolingWeight = (0.008 + 0.020 * synoptic.upperSupport) * lifecycle.forcing * dtHours;
        cell.levels[500].temperature += (coolingTarget - cell.levels[500].temperature) * coolingWeight;
      }
    }

    cell.features.airMass = synoptic.airMass;
    // Sector membership is diagnostic geometry, not a transported tracer.
    // Rebuild it from the same evolving synoptic frame that controls the low
    // and fronts so instability cannot remain in a stale, displaced sector.
    cell.features.warmSector = synoptic.warmSector > 0.42;
    cell.features.synopticAscent = synoptic.upperSupport * lifecycle.forcing;
    cell.features.scenarioMaturity = lifecycle.maturity;
    cell.features.scenarioStage = lifecycle.stage;
    cell.features.upperTrough = synoptic.troughCore > 0.48;
    cell.features.shortwaveTrough = synoptic.shortwaveCore > 0.52;
    cell.features.jetStreak = synoptic.jetCore > 0.56;
    cell.features.synopticLifecycle = synoptic.lifecycle;
  });
}

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

function scenarioLifecycle(profile = {}, elapsed = 0) {
  const peak = Number(profile.peakHour ?? 24);
  const develop = Math.max(3, Number(profile.developmentHours ?? 16));
  const decay = Math.max(6, Number(profile.decayHours ?? 20));
  const initial = clamp(Number(profile.initialMaturity ?? 0.35), 0.08, 0.75);
  const rising = elapsed <= peak ? initial + (1-initial)*smoothstepValue(Math.max(0, peak-develop), peak, elapsed) : 1-smoothstepValue(peak, peak+decay, elapsed)*0.48;
  const realization = clamp(Number(profile.realization ?? 0.8), 0.2, 1);
  const moistureLag = Number(profile.moistureLagHours ?? 4);
  const forcingLag = Number(profile.forcingLagHours ?? 2);
  const moisture = clamp(initial*0.7 + smoothstepValue(Math.max(0, peak-develop+moistureLag), peak+moistureLag, elapsed)*(1-initial*0.7), 0.12, 1);
  const forcing = clamp(initial*0.55 + smoothstepValue(Math.max(0, peak-develop+forcingLag), peak+forcingLag, elapsed)*(1-initial*0.55), 0.10, 1);
  return { stage: elapsed < peak-develop*0.35 ? 'incipient' : elapsed < peak ? 'deepening' : elapsed < peak+decay*0.35 ? 'mature' : 'decaying', maturity: clamp(rising*realization,0.08,1), moisture, forcing, kinematic: clamp(0.35+0.65*rising,0.2,1), realization, peakHour:peak };
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
    const lifecycleRecovery = Number(world.evolution?.config?.patternLifecycle?.recoveryMultiplier) || 1;
    const recoveryEligibility = clamp((0.35 + 0.65 * warmSector) * Math.max(0.18, solar) * (1 - processedAir) * (1 - coldPool) * (1 - activeStormInfluence) * (1 - 0.55 * cloudCover) * lifecycleRecovery, 0, 1);
    const preConvectiveRecovery = solar > 0.02 ? recoveryEligibility : 0;

    const solarHeatingFph = solar * (1.20 + 0.42 * preConvectiveRecovery) * soilFactor;
    const radiativeCoolingFph = solar < 0.02 ? 0.30 : 0.08 * (1 - solar);
    const recoveryHeatingFph = 0.30 * preConvectiveRecovery;
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

function applyInitialMorningPhaseAdjustment(world, absoluteHour) {
  const utcHour=((absoluteHour%24)+24)%24;
  const localHour=((utcHour-6)%24+24)%24;
  if(localHour>9.5) return;
  const morningFraction=clamp((9.5-localHour)/3.5,0,1);
  world.forEachCell(cell=>{
    const warmSector=cell.features?.warmSector?1:clamp(Number(cell.forecast?.openWarmSectorSupport)||0,0,1);
    if(warmSector<0.35) return;
    const moisture=clamp(((Number(cell.surface?.dewpoint)||45)-50)/25,0,1);
    const suppression=(2.8+3.2*warmSector+1.2*moisture)*morningFraction;
    cell.surface.temperature-=suppression;
    cell.surface.dewpoint-=Math.min(1.6,suppression*0.18);
  });
}

function smoothstepValue(a,b,value){const t=clamp((value-a)/Math.max(1e-6,b-a),0,1);return t*t*(3-2*t);}

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
    features: new Array(count)
  };
  for (const level of PRESSURE_LEVELS_HPA) {
    buffer.levelTemperature[level] ??= new Float32Array(count);
    buffer.levelWindSpeed[level] ??= new Float32Array(count);
    buffer.levelWindDirection[level] ??= new Float32Array(count);
  }
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
      windDirection: buffer.levelWindDirection[level][index]
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
      windDirection: blendDirection(blendDirection(grid.levelWindDirection[level][a], grid.levelWindDirection[level][b], tx), blendDirection(grid.levelWindDirection[level][c], grid.levelWindDirection[level][d], tx), ty)
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

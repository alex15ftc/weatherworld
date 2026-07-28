import { Atmosphere } from '../atmosphere.js';
import { generateScenario } from '../scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../evolution.js';
import { SIMULATION_CONFIG } from '../simulationConfig.js';
import { performance } from 'node:perf_hooks';
import { categoryFromHazard } from '../diagnostics/riskDiagnosis.js';
import { buildOutlookDiscussion } from '../forecast/OutlookDiscussionEngine.js';

const RISK_ORDER = ['TSTM','MRGN','SLGT','ENH','MDT','HIGH'];
const HAZARDS = ['tornado','hail','wind'];
const TORNADO_THRESHOLDS = [0.02, 0.05, 0.10, 0.15, 0.30];

export function runSeedVerification(seed, { hours = 72, stepHours = 0.5, neighborhoodMiles = 25, neighborhoodCells = null } = {}) {
  const numericSeed = Math.trunc(Number(seed));
  if (!Number.isFinite(numericSeed)) throw new Error('A finite numeric seed is required');
  if (!Number.isFinite(hours) || hours < 0) throw new Error('hours must be a finite non-negative number');
  if (!Number.isFinite(stepHours) || stepHours <= 0) throw new Error('stepHours must be a finite positive number');
  if (!Number.isFinite(neighborhoodMiles) || neighborhoodMiles <= 0) throw new Error('neighborhoodMiles must be a finite positive number');
  const runStarted = performance.now();
  const timings = { initializationMs: 0, simulationMs: 0, truthCaptureMs: 0, scoringMs: 0 };
  let phaseStarted = performance.now();
  const world = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
  const config = generateScenario(world, numericSeed);
  config.seed = numericSeed;
  world.seed = numericSeed;
  world.config = config;
  initializeEvolution(world, config);
  // Verification samples authoritative storm objects directly. Disable the one-minute
  // observation fan-out so long batch runs do not allocate millions of transient reports.
  timings.initializationMs = performance.now() - phaseStarted;
  if (world.stormObservationLayer) {
    world.stormObservationLayer.nextReportHourUtc = 1e9;
    world.stormObservationLayer.lastReportHourUtc = 1e9;
    world.stormObservationLayer.reports = [];
    world.stormObservationLayer.radarFrames = [];
  }

  const issued = new Map();
  const truthFrames = [];
  const atmosphericEnvironmentSamples = [];
  const seenStormIds = new Set();
  const stormRecords = new Map();
  const initiations = [];
  captureIssued(world, issued, config);
  phaseStarted = performance.now();
  captureTruth(world, truthFrames, seenStormIds, initiations, stormRecords);
  captureSixHourlyEnvironmentSample(world, atmosphericEnvironmentSamples);
  timings.truthCaptureMs += performance.now() - phaseStarted;

  phaseStarted = performance.now();
  let loopTruthCaptureMs = 0;
  let simulatedHours = 0;
  while (simulatedHours < Math.max(0, hours) - 1e-9) {
    const dt = Math.min(stepHours, Math.max(0, hours) - simulatedHours);
    advanceAtmosphere(world, dt);
    simulatedHours += dt;
    captureIssued(world, issued, config);
    const captureStarted = performance.now();
    captureTruth(world, truthFrames, seenStormIds, initiations, stormRecords);
    captureSixHourlyEnvironmentSample(world, atmosphericEnvironmentSamples);
    const captureMs = performance.now() - captureStarted;
    loopTruthCaptureMs += captureMs;
    timings.truthCaptureMs += captureMs;
  }

  timings.simulationMs = performance.now() - phaseStarted - loopTruthCaptureMs;
  phaseStarted = performance.now();
  const allIssuedProducts = [...issued.values()];
  const completeProducts = allIssuedProducts.filter(p => p.validStartHour >= SIMULATION_CONFIG.startHourUtc - 1e-6 && p.validEndHour <= world.validHourUtc + 1e-6);
  const incompleteProducts = allIssuedProducts.filter(p => !completeProducts.includes(p)).map(p => ({
    cycleId: p.cycleId, key: p.key, issuedHourUtc: p.issuedHourUtc, validStartHour: p.validStartHour, validEndHour: p.validEndHour,
    status: 'UNVERIFIED_INCOMPLETE_TRUTH_WINDOW'
  }));
  const radiusCells = Number.isFinite(neighborhoodCells) ? neighborhoodCells : neighborhoodMiles / Math.max(0.1, world.cellSizeMiles);
  const products = completeProducts.map(p => scoreProduct(p, truthFrames, initiations, world, radiusCells));
  const byDay = Object.fromEntries(['day1','day2','day3'].map(day => [day, summarizeDay(products.filter(p => p.key === day))]));
  const event = summarizeEvent(world, truthFrames, initiations);
  finalizeStormRecords(stormRecords, world);
  const calibration = summarizeCalibration(products);
  timings.scoringMs = performance.now() - phaseStarted;
  const totalMs = performance.now() - runStarted;
  return {
    schemaVersion: 8,
    verifierVersion: '2.32.6',
    seed: numericSeed,
    scenario: {
      setupType: config.setupType ?? null,
      narrative: config.narrative ?? null,
      topology: [...(config.boundaryTopology ?? [])],
      intensity: Number(config.intensity) || 0,
      primaryHazard: config.primaryHazard ?? null
    },
    simulation: { startHourUtc: SIMULATION_CONFIG.startHourUtc, endHourUtc: world.validHourUtc, hours, stepHours, width: world.width, height: world.height, cellSizeMiles: world.cellSizeMiles, hazardProbabilityBasis: 'deterministic-event-within-radius', observedProbabilityMethod: 'spatial-density-tier-not-ensemble-frequency', hazardRadiusMiles: neighborhoodMiles, hazardRadiusCells: radiusCells },
    event,
    atmosphericEnvironmentSamples,
    storms: [...stormRecords.values()].sort((a,b)=>b.maxIntensity-a.maxIntensity),
    forecast: { productsScored: products.length, productsSkipped: incompleteProducts.length, byDay, calibration },
    performance: { ...timings, totalMs, simulatedHoursPerSecond: totalMs > 0 ? hours / (totalMs / 1000) : 0, truthFrames: truthFrames.length },
    products,
    incompleteProducts,
    calibrationSummary: buildCalibrationSummary(products, event, atmosphericEnvironmentSamples),
    recommendations: buildRecommendations(products, event, calibration)
  };
}

export function captureSixHourlyEnvironmentSample(world, samples) {
  const hourUtc = Number(world.validHourUtc);
  if (!Number.isFinite(hourUtc)) return;
  const roundedHour = Math.round(hourUtc);
  if (Math.abs(hourUtc - roundedHour) > 1e-6 || ((roundedHour % 6) + 6) % 6 !== 0) return;
  if (samples.some(sample => Math.abs(sample.hourUtc - roundedHour) <= 1e-6)) return;
  samples.push(buildAtmosphericEnvironmentSample(world, roundedHour));
}

export function buildAtmosphericEnvironmentSample(world, hourUtc) {
  const cells = [];
  world.forEachCell?.((cell, x, y) => cells.push(sampleEnvironmentCell(cell, x, y, world.cellSizeKm)));
  if (!cells.length) return { hourUtc, domainSummary: null, representativeSamples: [] };

  const meanOf = key => mean(cells.map(cell => cell[key]));
  const maxOf = key => Math.max(0, ...cells.map(cell => cell[key]));
  const minOf = key => Math.min(...cells.map(cell => cell[key]));
  const percentile = (key, fraction) => {
    const values = cells.map(cell => cell[key]).sort((a, b) => a - b);
    return values[Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * fraction)))] ?? 0;
  };
  const select = (label, score) => {
    const cell = [...cells].sort((a, b) => score(b) - score(a))[0];
    return cell ? { label, ...cell } : null;
  };

  const warmSectorCells = cells.filter(cell => cell.warmSectorSupport >= 0.5);
  const broaderSevereAirMassCells = cells.filter(cell => cell.broaderSevereAirMass >= 0.35 || (cell.surfaceDewpointF >= 55 && cell.cape >= 500));
  const warmMean = key => mean(warmSectorCells.map(cell => cell[key]));
  const warmMax = key => Math.max(0, ...warmSectorCells.map(cell => cell[key]));
  const warmPercentile = (key, fraction) => {
    const values = warmSectorCells.map(cell => cell[key]).sort((a, b) => a - b);
    return values[Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * fraction)))] ?? 0;
  };

  const representativeSamples = [
    select('maximum-severe-composite', cell => cell.stp + cell.cape / 1500 + cell.srh / 250 + cell.bulkShear / 50),
    select('maximum-instability', cell => cell.cape),
    select('maximum-low-level-rotation', cell => cell.srh),
    select('maximum-forcing', cell => cell.forcing),
    select('maximum-initiation-potential', cell => cell.initiationProbability),
    select('maximum-hail-environment', cell => cell.cape / 1200 + cell.bulkShear / 45 + cell.lapseRate700500 / 7),
    select('maximum-wind-environment', cell => cell.dcape / 900 + cell.bulkShear / 55 + cell.coldPoolSpeedMs / 20)
  ].filter(Boolean);

  return {
    hourUtc,
    sampleIntervalHours: 6,
    domainSummary: {
      cellCount: cells.length,
      mean: {
        cape: meanOf('cape'), cin: meanOf('cin'), dcape: meanOf('dcape'), srh: meanOf('srh'),
        bulkShear: meanOf('bulkShear'), lclAgl: meanOf('lclAgl'), stp: meanOf('stp'),
        surfaceTemperatureF: meanOf('surfaceTemperatureF'), surfaceDewpointF: meanOf('surfaceDewpointF'),
        forcing: meanOf('forcing'), initiationProbability: meanOf('initiationProbability')
      },
      maximum: {
        cape: maxOf('cape'), dcape: maxOf('dcape'), srh: maxOf('srh'), bulkShear: maxOf('bulkShear'),
        stp: maxOf('stp'), forcing: maxOf('forcing'), initiationProbability: maxOf('initiationProbability'),
        coldPoolSpeedMs: maxOf('coldPoolSpeedMs'), realizedUpdraftMs: maxOf('realizedUpdraftMs')
      },
      minimum: { cin: minOf('cin'), surfaceDewpointF: minOf('surfaceDewpointF') },
      percentile90: {
        cape: percentile('cape', .9), dcape: percentile('dcape', .9), srh: percentile('srh', .9),
        bulkShear: percentile('bulkShear', .9), stp: percentile('stp', .9),
        forcing: percentile('forcing', .9), initiationProbability: percentile('initiationProbability', .9)
      }
    },
    warmSectorSummary: {
      cellCount: warmSectorCells.length,
      fractionOfDomain: warmSectorCells.length / Math.max(1, cells.length),
      mean: {
        surfaceTemperatureF: warmMean('surfaceTemperatureF'), surfaceDewpointF: warmMean('surfaceDewpointF'),
        cape: warmMean('cape'), cin: warmMean('cin'), forcing: warmMean('forcing'),
        netTemperatureTendencyFph: warmMean('netTemperatureTendencyFph'),
        netDewpointTendencyFph: warmMean('netDewpointTendencyFph'),
        preConvectiveRecovery: warmMean('preConvectiveRecovery')
      },
      maximum: {
        surfaceTemperatureF: warmMax('surfaceTemperatureF'), surfaceDewpointF: warmMax('surfaceDewpointF'),
        cape: warmMax('cape'), forcing: warmMax('forcing')
      },
      percentile90: { cape: warmPercentile('cape', .9), surfaceTemperatureF: warmPercentile('surfaceTemperatureF', .9) }
    },
    broaderSevereAirMassSummary: summarizeAirMass(broaderSevereAirMassCells),
    representativeSamples
  };
}

function summarizeAirMass(cells) {
  const avg = key => mean(cells.map(cell => cell[key]));
  const max = key => Math.max(0, ...cells.map(cell => cell[key]));
  return {
    cellCount: cells.length,
    mean: { surfaceTemperatureF: avg('surfaceTemperatureF'), surfaceDewpointF: avg('surfaceDewpointF'), cape: avg('cape'), cin: avg('cin'), preConvectiveRecovery: avg('preConvectiveRecovery') },
    maximum: { surfaceTemperatureF: max('surfaceTemperatureF'), surfaceDewpointF: max('surfaceDewpointF'), cape: max('cape') }
  };
}

function sampleEnvironmentCell(cell, x, y, cellSizeKm = 10) {
  const derived = cell?.derived ?? {};
  const diagnostics = derived.diagnostics ?? {};
  const energyBudget = diagnostics.energyBudget ?? cell?.environmentDiagnostics?.energyBudget ?? {};
  const dynamics = cell?.dynamics ?? {};
  const surface = cell?.surface ?? {};
  const forecast = cell?.forecast ?? {};
  const levels = cell?.levels ?? {};
  const realization = diagnostics.stormRealization ?? diagnostics.realization ?? {};
  return {
    x, y,
    centerKm: { x: (x + .5) * cellSizeKm, y: (y + .5) * cellSizeKm },
    cape: Number(derived.cape) || 0,
    cin: Number(derived.cin) || 0,
    cinSigned: Number(derived.mlcinSigned ?? -(derived.cin ?? 0)) || 0,
    cinMagnitude: Number(derived.mlcinMagnitude ?? derived.cin) || 0,
    dcape: Number(derived.dcape) || 0,
    srh: Number(derived.srh) || 0,
    bulkShear: Number(derived.bulkShear) || 0,
    lclAgl: Number(derived.lclAgl ?? derived.lcl) || 0,
    lapseRate01km: Number(derived.lapseRate01km) || 0,
    lapseRate03km: Number(derived.lapseRate03km) || 0,
    lapseRate700500: Number(derived.lapseRate700500 ?? derived.midLevelLapseRate) || 0,
    lapseRate850500: Number(derived.lapseRate850500) || 0,
    stpComponents: { ...(derived.stpComponents ?? {}) },
    stp: Number(derived.stp) || 0,
    surfacePressureHpa: Number(surface.pressure) || 0,
    surfaceTemperatureF: Number(surface.temperature) || 0,
    surfaceDewpointF: Number(surface.dewpoint) || 0,
    surfaceWind: { direction: Number(surface.wind?.direction) || 0, speedKt: Number(surface.wind?.speed) || 0 },
    levels: Object.fromEntries([850, 700, 500, 250].map(level => [level, {
      temperatureC: Number(levels[level]?.temperature) || 0,
      heightDm: Number(levels[level]?.heightDm) || 0,
      windDirection: Number(levels[level]?.windDirection) || 0,
      windSpeedKt: Number(levels[level]?.windSpeed) || 0
    }])),
    forcing: Number(dynamics.forcingScore ?? diagnostics.forcing) || 0,
    dynamics: {
      surfaceConvergenceS1: Number(dynamics.surfaceConvergenceS1) || 0,
      moistureFluxConvergence: Number(dynamics.moistureFluxConvergence) || 0,
      frontogenesis: Number(dynamics.frontogenesis) || 0,
      verticalVelocityMs: Number(dynamics.verticalVelocityMs) || 0,
      upperDivergenceS1: Number(dynamics.upperDivergenceS1) || 0,
      vorticityAdvection: Number(dynamics.vorticityAdvection) || 0,
      capErosionRate: Number(dynamics.capErosionRate) || 0,
      triggerStrength: Number(dynamics.triggerStrength) || 0
    },
    initiationProbability: Number(forecast.initiationProbability ?? dynamics.initiationPotential) || 0,
    capBreakProbability: Number(forecast.capBreakProbability ?? forecast.capFailureProbability) || 0,
    expectedCapBreakHourUtc: forecast.expectedCapBreakHourUtc ?? null,
    capState: cell?.cap?.state ?? 'unknown',
    cinTendencyJkgPerHour: Number(cell?.cap?.tendencyJkgPerHour) || 0,
    realizedUpdraftMs: Number(realization.realizedUpdraftMs ?? diagnostics.realizedUpdraftMs) || 0,
    coldPoolSpeedMs: Number(realization.coldPoolSpeedMs ?? diagnostics.coldPoolSpeedMs) || 0,
    stormCoverage: Number(forecast.stormCoverage) || 0,
    warmSectorSupport: cell?.features?.warmSector ? 1 : clamp(Number(forecast.openWarmSectorSupport) || 0, 0, 1),
    broaderSevereAirMass: clamp(Number(energyBudget.broaderSevereAirMass ?? forecast.openWarmSectorSupport) || 0, 0, 1),
    energyBudget: { ...energyBudget },
    netTemperatureTendencyFph: Number(energyBudget.netTemperatureTendencyFph) || 0,
    netDewpointTendencyFph: Number(energyBudget.netDewpointTendencyFph) || 0,
    preConvectiveRecovery: Number(energyBudget.preConvectiveRecovery) || 0,
    risk: derived.risk ?? 'TSTM'
  };
}

function finalizeStormRecords(records, world) {
  const activeIds = new Set((world.storms ?? []).filter(storm => storm.active).map(storm => storm.id));
  for (const record of records.values()) {
    record.active = activeIds.has(record.id);
    if (!record.active) record.endedHourUtc = record.lastObservedHourUtc;
  }
}

function updateStormRecord(records, storm, observedHourUtc) {
  const summary = summarizeStorms([storm])[0];
  if (!summary) return;
  const previous = records.get(storm.id);
  if (!previous) {
    records.set(storm.id, { ...summary, lastObservedHourUtc: observedHourUtc });
    return;
  }
  previous.parentId = previous.parentId ?? summary.parentId;
  previous.mode = summary.mode ?? previous.mode;
  previous.active = summary.active;
  previous.ageHours = Math.max(previous.ageHours, summary.ageHours);
  previous.maxIntensity = Math.max(previous.maxIntensity, summary.maxIntensity);
  previous.trackKm = Math.max(previous.trackKm, summary.trackKm);
  previous.diagnostics.peakUpdraftStrength = Math.max(previous.diagnostics.peakUpdraftStrength, summary.diagnostics.peakUpdraftStrength);
  previous.diagnostics.peakRotationStrength = Math.max(previous.diagnostics.peakRotationStrength, summary.diagnostics.peakRotationStrength);
  previous.diagnostics.peakColdPoolStrength = Math.max(previous.diagnostics.peakColdPoolStrength, summary.diagnostics.peakColdPoolStrength);
  previous.diagnostics.mesocycloneCycles = Math.max(previous.diagnostics.mesocycloneCycles, summary.diagnostics.mesocycloneCycles);
  previous.diagnostics.lifecycleTransitions = Math.max(previous.diagnostics.lifecycleTransitions, summary.diagnostics.lifecycleTransitions);
  previous.lastObservedHourUtc = observedHourUtc;
  previous.tornado.maxWindMph = Math.max(previous.tornado.maxWindMph, summary.tornado.maxWindMph);
  previous.tornado.maxWidthYards = Math.max(previous.tornado.maxWidthYards, summary.tornado.maxWidthYards);
  previous.tornado.maxPathLengthKm = Math.max(previous.tornado.maxPathLengthKm, summary.tornado.maxPathLengthKm);
  previous.tornado.cycles = Math.max(previous.tornado.cycles, summary.tornado.cycles);
  if (summary.tornado.maxWindMph >= previous.tornado.maxWindMph) previous.tornado.maxEfRating = summary.tornado.maxEfRating;
  previous.wind.maxSustainedMph = Math.max(previous.wind.maxSustainedMph, summary.wind.maxSustainedMph);
  previous.wind.maxGustMph = Math.max(previous.wind.maxGustMph, summary.wind.maxGustMph);
  previous.hail.maxSizeInches = Math.max(previous.hail.maxSizeInches, summary.hail.maxSizeInches);
}

function captureIssued(world, issued, config) {
  for (const product of Object.values(world.outlookCycle?.products ?? {})) {
    if (issued.has(product.cycleId)) continue;
    const snapshot = structuredClone(product);
    const diagnosis = buildOutlookDiscussion(world, config, product.key);
    snapshot.forecastReasoning = {
      narrative: diagnosis.discussion,
      pattern: diagnosis.pattern,
      patternKey: diagnosis.patternKey,
      stage: diagnosis.stage,
      confidence: diagnosis.confidence,
      supportingFactors: diagnosis.supportingFactors,
      limitingFactors: diagnosis.limitingFactors,
      representativeEnvironment: diagnosis.metrics?.env ?? null,
      corridorMetrics: {
        meanInitiation: diagnosis.metrics?.meanInitiation ?? 0,
        meanCoverage: diagnosis.metrics?.meanCoverage ?? 0,
        peakHourUtc: diagnosis.metrics?.peakHour ?? snapshot.peakForecastHourUtc,
        maxProbabilities: { tornado: diagnosis.metrics?.maxTor ?? 0, hail: diagnosis.metrics?.maxHail ?? 0, wind: diagnosis.metrics?.maxWind ?? 0 },
        maxCig: { tornado: diagnosis.metrics?.maxTorCig ?? 0, hail: diagnosis.metrics?.maxHailCig ?? 0, wind: diagnosis.metrics?.maxWindCig ?? 0 }
      },
      ensemble: diagnosis.ensemble
    };
    snapshot.decisionTree = buildDecisionTree(snapshot);
    issued.set(product.cycleId, snapshot);
  }
}

export function captureTruth(world, frames, seenStormIds, initiations, stormRecords) {
  const n = world.width * world.height;
  const previousHourUtc = frames.at(-1)?.hourUtc ?? Number.NEGATIVE_INFINITY;
  const frame = {
    hourUtc: world.validHourUtc,
    storm: new Uint8Array(n), tornado: new Uint8Array(n), tornadoSig: new Uint8Array(n), tornadoExtreme: new Uint8Array(n), tornadoViolent: new Uint8Array(n), hail: new Uint8Array(n), hailSig: new Uint8Array(n), hailExtreme: new Uint8Array(n), wind: new Uint8Array(n), windSig: new Uint8Array(n), windExtreme: new Uint8Array(n),
    maxIntensity: 0, activeStorms: 0, tornadoes: 0, severeHail: 0, severeWind: 0, modes: {}, tornadoTrackPoints: [], environment: summarizeAuthoritativeEnvironment(world)
  };
  for (const storm of world.storms ?? []) {
    if (!storm.active) continue;
    updateStormRecord(stormRecords, storm, world.validHourUtc);
    const x = clamp(Math.floor(storm.positionKm.x / world.cellSizeKm), 0, world.width - 1);
    const y = clamp(Math.floor(storm.positionKm.y / world.cellSizeKm), 0, world.height - 1);
    const idx = y * world.width + x;
    const intensity = Number(storm.intensity) || 0;
    const hazards = storm.hazards ?? {};
    const gust = Number(storm.surfaceWind?.gustMph ?? 0);
    const tornadoTruthPoints = collectTornadoTruthPoints(storm, previousHourUtc, world.validHourUtc);
    const tornadoOnGround = Boolean(storm.tornado?.onGround);
    const hailSize = Number(storm.hazardExtremes?.hail?.maxSizeInches ?? hazards.hailSizeInches ?? 0);
    const peakGust = Math.max(gust, Number(storm.hazardExtremes?.wind?.maxGustMph ?? 0));
    const hailOccurred = hailSize >= 1;
    const windOccurred = peakGust >= 58;
    if (intensity >= 0.22) frame.storm[idx] = 1;
    const tornadoEf = maxTornadoEf(storm);
    for (const point of tornadoTruthPoints) {
      const tx = clamp(Math.floor(point.x / world.cellSizeKm), 0, world.width - 1);
      const ty = clamp(Math.floor(point.y / world.cellSizeKm), 0, world.height - 1);
      const tidx = ty * world.width + tx;
      frame.tornado[tidx] = 1;
      if (tornadoEf >= 2) frame.tornadoSig[tidx] = 1;
      if (tornadoEf >= 3) frame.tornadoExtreme[tidx] = 1;
      if (tornadoEf >= 4) frame.tornadoViolent[tidx] = 1;
      frame.tornadoTrackPoints.push({ stormId:storm.id, xKm:point.x, yKm:point.y, hourUtc:Number(point.hourUtc ?? world.validHourUtc), ef:tornadoEf });
    }
    if (hailOccurred) frame.hail[idx] = 1;
    if (hailSize >= 2) frame.hailSig[idx] = 1;
    if (hailSize >= 3.5) frame.hailExtreme[idx] = 1;
    if (windOccurred) frame.wind[idx] = 1;
    if (peakGust >= 75) frame.windSig[idx] = 1;
    if (peakGust >= 100) frame.windExtreme[idx] = 1;
    frame.maxIntensity = Math.max(frame.maxIntensity, intensity);
    frame.activeStorms++;
    frame.tornadoes += tornadoOnGround ? 1 : 0;
    frame.severeHail += hailOccurred ? 1 : 0;
    frame.severeWind += windOccurred ? 1 : 0;
    frame.modes[storm.mode] = (frame.modes[storm.mode] ?? 0) + 1;
    if (!seenStormIds.has(storm.id)) {
      seenStormIds.add(storm.id);
      initiations.push({ stormId: storm.id, hourUtc: storm.createdHourUtc, x, y, sourceCell: { ...storm.sourceCell }, mode: storm.mode });
    }
  }
  frames.push(frame);
}



function maxTornadoEf(storm) {
  const ratings = [storm.hazardExtremes?.tornado?.maxEfRating, storm.tornado?.efRating, ...(storm.tornadoHistory ?? []).map(t => t.efRating ?? t.maxEfRating)];
  return ratings.reduce((best, value) => {
    const match = String(value ?? '').match(/EF([0-5])/i);
    return match ? Math.max(best, Number(match[1])) : best;
  }, -1);
}

export function collectTornadoTruthPoints(storm, previousHourUtc, currentHourUtc) {
  const epsilon = 1e-6;
  const points = [];
  const seen = new Set();
  const addPoint = point => {
    const x = Number(point?.x), y = Number(point?.y), hourUtc = Number(point?.hourUtc);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (Number.isFinite(hourUtc) && (hourUtc <= previousHourUtc + epsilon || hourUtc > currentHourUtc + epsilon)) return;
    const key = `${x.toFixed(4)}|${y.toFixed(4)}|${Number.isFinite(hourUtc) ? hourUtc.toFixed(4) : 'current'}`;
    if (seen.has(key)) return;
    seen.add(key);
    points.push({ x, y, hourUtc: Number.isFinite(hourUtc) ? hourUtc : currentHourUtc });
  };

  for (const point of storm.tornado?.trackPoints ?? []) addPoint(point);
  for (const tornado of storm.tornadoHistory ?? []) {
    for (const point of tornado.trackPoints ?? []) addPoint(point);
  }

  // An on-ground tornado can exist before its first stored track point. Capture its
  // current tornado position, never the parent storm position or a stale event tag.
  if (storm.tornado?.onGround && !points.length) {
    addPoint({ ...storm.tornado.positionKm, hourUtc: currentHourUtc });
  }
  return points;
}

function scoreProduct(product, frames, initiations, world, radius) {
  const validFrames = frames.filter(f => f.hourUtc + 1e-6 >= product.validStartHour && f.hourUtc < product.validEndHour - 1e-6);
  const validInitiations = initiations.filter(row => row.hourUtc + 1e-6 >= product.validStartHour && row.hourUtc < product.validEndHour - 1e-6);
  const truth = aggregateTruth(validFrames, validInitiations, world.width, world.height, radius, world.cellSizeMiles);
  const hazardScores = {};
  for (const hazard of HAZARDS) {
    const probabilityKey = `${hazard}Probability`;
    const probs = product.grid.map(c => normalizeProbability(c[probabilityKey]));
    hazardScores[hazard] = binaryScores(probs, truth[hazard]);
    if (hazard === 'tornado') {
      hazardScores[hazard].thresholdDiagnostics = Object.fromEntries(
        TORNADO_THRESHOLDS.map(threshold => [probabilityLabel(threshold), binaryScores(probs, truth[hazard], threshold)])
      );
      hazardScores[hazard].exactTrackDiagnostics = Object.fromEntries(
        TORNADO_THRESHOLDS.map(threshold => [probabilityLabel(threshold), binaryScores(probs, truth.tornadoExact, threshold)])
      );
    }
  }
  const intensityScores = Object.fromEntries(HAZARDS.map(hazard => {
    const forecast = product.grid.map(c => Math.max(0, Number(c[`${hazard}Cig`] ?? 0)));
    const observed = Array.from(truth.observedCig[hazard]);
    return [hazard, ordinalIntensityScores(forecast, observed)];
  }));
  const riskTruth = truth.risk;
  let exact = 0, withinOne = 0, over = 0, under = 0;
  for (let i = 0; i < product.grid.length; i++) {
    const forecastRank = RISK_ORDER.indexOf(product.grid[i].risk);
    const observedRank = RISK_ORDER.indexOf(riskTruth[i]);
    if (forecastRank === observedRank) exact++;
    if (Math.abs(forecastRank - observedRank) <= 1) withinOne++;
    if (forecastRank > observedRank) over++;
    if (forecastRank < observedRank) under++;
  }
  const forecastCi = product.grid.map(c => Number(c.peakInitiation ?? 0));
  const ciScore = binaryScores(forecastCi.map(v => clamp(v,0,1)), truth.initiation, 0.35);
  const observedOverall = riskTruth.reduce((best, risk) => RISK_ORDER.indexOf(risk) > RISK_ORDER.indexOf(best) ? risk : best, 'TSTM');
  const spatialCategorical = buildSpatialCategoricalDiagnostics(product.grid, truth);
  const trackPlacement = buildTornadoTrackPlacementDiagnostics(product, validFrames, world);
  const magnitudeScore = magnitudeProductScore(hazardScores, intensityScores, ciScore, withinOne / product.grid.length);
  const placementScore = trackPlacement.placementScore;
  const score = placementScore == null ? magnitudeScore : magnitudeScore*.65 + placementScore*.35;
  return {
    cycleId: product.cycleId, key: product.key, issuedHourUtc: product.issuedHourUtc,
    validStartHour: product.validStartHour, validEndHour: product.validEndHour,
    peakForecastHourUtc: product.peakForecastHourUtc ?? null,
    forecastOverallRisk: product.overallRisk, observedOverallRisk: observedOverall,
    categorical: { exactAccuracy: exact / product.grid.length, withinOneAccuracy: withinOne / product.grid.length, overforecastFraction: over / product.grid.length, underforecastFraction: under / product.grid.length, spatial: spatialCategorical },
    spatialPlacement: { ...buildSpatialPlacementDiagnostics(product, truth), tornadoTracks: trackPlacement },
    hazards: hazardScores, intensity: intensityScores, initiation: ciScore,
    forecastReasoning: product.forecastReasoning ?? null,
    decisionTree: product.decisionTree ?? null,
    environmentalEvolution: buildEnvironmentalEvolution(validFrames),
    forecastVsObserved: buildForecastObservedComparison(product, validFrames, truth, observedOverall),
    bustContributors: diagnoseBustContributors(product, validFrames, truth, observedOverall),
    truthSummary: summarizeTruth(truth),
    scoreComponents:{magnitude:magnitudeScore,trackPlacement:placementScore,combined:score},
    score
  };
}


export function buildSpatialPlacementDiagnostics(product, truth) {
  const overall = eventPlacementForMask(product, truth, 'overall');
  const hazards = Object.fromEntries(HAZARDS.map(hazard => [hazard, eventPlacementForMask(product, truth, hazard)]));
  return { overall, hazards };
}

export function buildTornadoTrackPlacementDiagnostics(product, frames, world) {
  const raw = frames.flatMap(frame => frame.tornadoTrackPoints ?? []);
  const points = [];
  const seen = new Set();
  for (const point of raw.sort((a,b) => a.hourUtc - b.hourUtc)) {
    const key = `${point.stormId}|${Number(point.hourUtc).toFixed(3)}|${Number(point.xKm).toFixed(2)}|${Number(point.yKm).toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const x = clamp(Math.floor(point.xKm / world.cellSizeKm), 0, world.width - 1);
    const y = clamp(Math.floor(point.yKm / world.cellSizeKm), 0, world.height - 1);
    points.push({ ...point, x, y, index:y*world.width+x, ef:Number(point.ef)||0 });
  }
  const driver = product.decisionTree?.drivingHazard ?? null;
  const empty = {
    tornadoCount:0, trackPointCount:0, totalPathLengthMiles:0, intensityWeightedPathMiles:0,
    hazardDriver:driver, overallRisk:product.overallRisk, tornadoCoreCategory:'TSTM',
    categoryExposure:{}, overallRiskExposure:{}, contourCapture:{}, intensityWeightedContourCapture:{},
    bullseye:{coreCellCount:0,componentCount:0,tornadoHitRate:null,coreUtilizationWithin25Miles:null},
    displacementMiles:{}, placementScore:null
  };
  if (!points.length) return empty;

  const byStorm = new Map();
  for (const point of points) {
    const rows = byStorm.get(point.stormId) ?? [];
    rows.push(point);
    byStorm.set(point.stormId, rows);
  }
  let totalWeight = 0, intensityWeight = 0;
  for (const rows of byStorm.values()) {
    rows.sort((a,b)=>a.hourUtc-b.hourUtc);
    for (let i=0;i<rows.length;i++) {
      const distanceKm = i ? Math.hypot(rows[i].xKm-rows[i-1].xKm,rows[i].yKm-rows[i-1].yKm) : world.cellSizeKm*.35;
      rows[i].pathMiles = Math.max(world.cellSizeMiles*.15,distanceKm*.621371);
      rows[i].intensityWeight = tornadoEfWeight(rows[i].ef);
      totalWeight += rows[i].pathMiles;
      intensityWeight += rows[i].pathMiles*rows[i].intensityWeight;
    }
  }

  const categoryExposure = Object.fromEntries(RISK_ORDER.map(r=>[r,0]));
  const overallRiskExposure = Object.fromEntries(RISK_ORDER.map(r=>[r,0]));
  const contourCapture = Object.fromEntries([2,5,10,15,30].map(level=>[`${level}pct`,0]));
  const weightedCapture = Object.fromEntries([2,5,10,15,30].map(level=>[`${level}pct`,0]));
  for (const point of points) {
    const cell = product.grid[point.index] ?? {};
    const tornadoCategory = cell.categories?.tornado ?? categoryFromHazard('tornado',cell.tornadoProbability??0,cell.tornadoCig??0);
    categoryExposure[tornadoCategory] += point.pathMiles;
    overallRiskExposure[cell.risk ?? 'TSTM'] += point.pathMiles;
    for (const level of [2,5,10,15,30]) if ((Number(cell.tornadoProbability)||0)>=level) {
      contourCapture[`${level}pct`] += point.pathMiles;
      weightedCapture[`${level}pct`] += point.pathMiles*point.intensityWeight;
    }
  }
  for (const key of Object.keys(categoryExposure)) categoryExposure[key] = safeRatio(categoryExposure[key],totalWeight);
  for (const key of Object.keys(overallRiskExposure)) overallRiskExposure[key] = safeRatio(overallRiskExposure[key],totalWeight);
  for (const level of [2,5,10,15,30]) {
    contourCapture[`${level}pct`] = safeRatio(contourCapture[`${level}pct`],totalWeight);
    weightedCapture[`${level}pct`] = safeRatio(weightedCapture[`${level}pct`],intensityWeight);
  }

  const tornadoRanks = product.grid.map(cell => RISK_ORDER.indexOf(cell.categories?.tornado ?? categoryFromHazard('tornado',cell.tornadoProbability??0,cell.tornadoCig??0)));
  const maxRank = Math.max(0,...tornadoRanks);
  const coreMask = Uint8Array.from(tornadoRanks, rank => rank===maxRank&&rank>0?1:0);
  const coreIndices = [...coreMask.keys()].filter(index=>coreMask[index]);
  const components = connectedMaskComponents(coreMask,world.width,world.height);
  const tornadoHits = [...byStorm.values()].filter(rows=>rows.some(point=>coreMask[point.index])).length;
  const radiusCells = 25/Math.max(.1,world.cellSizeMiles);
  const utilizedCore = coreIndices.filter(index => points.some(point => gridDistance(index,point.index,world.width)<=radiusCells)).length;
  const displacementMiles = {};
  for (const level of [2,5,10,15,30]) {
    const eligible = product.grid.map((cell,index)=>(Number(cell.tornadoProbability)||0)>=level?index:-1).filter(index=>index>=0);
    const distances = points.map(point => nearestGridDistanceMiles(point.index,eligible,world.width,world.cellSizeMiles)).filter(Number.isFinite).sort((a,b)=>a-b);
    displacementMiles[`${level}pct`] = {
      median: distances.length?distances[Math.floor((distances.length-1)/2)]:null,
      percentile90: distances.length?distances[Math.floor((distances.length-1)*.9)]:null
    };
  }
  const bullseyeHit = safeRatio(tornadoHits,byStorm.size);
  const utilization = safeRatio(utilizedCore,coreIndices.length);
  const coreContourByRank = [2,2,5,10,15,30];
  const expectedCoreContour = coreContourByRank[maxRank] ?? 2;
  const coreKey = `${expectedCoreContour}pct`;
  const coreContourCapture = weightedCapture[coreKey] ?? 0;
  const coreMedianDisplacement = displacementMiles[coreKey]?.median;
  const coreVectors=points.map(point=>nearestGridVectorMiles(point.index,coreIndices,world.width,world.cellSizeMiles)).filter(Boolean);
  const signedCoreDisplacementMiles={
    east:median(coreVectors.map(vector=>vector.east)),
    south:median(coreVectors.map(vector=>vector.south))
  };
  const coreDistanceSkill = coreMedianDisplacement==null?0:clamp(1-coreMedianDisplacement/100,0,1);
  // A broad low-end contour is useful, but cannot by itself verify a displaced
  // MDT/HIGH bullseye. The forecast's own maximum tornado tier sets the contour
  // against which its strongest claim is verified.
  const placementScore = 100*clamp(
    .25*contourCapture['5pct']+
    .30*coreContourCapture+
    .20*bullseyeHit+
    .15*utilization+
    .10*coreDistanceSkill,
    0,1
  );
  return {
    tornadoCount:byStorm.size, trackPointCount:points.length, totalPathLengthMiles:totalWeight,
    intensityWeightedPathMiles:intensityWeight, hazardDriver:driver, overallRisk:product.overallRisk,
    tornadoCoreCategory:RISK_ORDER[maxRank], categoryExposure, overallRiskExposure,
    contourCapture, intensityWeightedContourCapture:weightedCapture,
    bullseye:{
      coreCellCount:coreIndices.length,componentCount:components.length,tornadoHitRate:bullseyeHit,
      coreUtilizationWithin25Miles:utilization,expectedCoreContour,
      intensityWeightedCoreCapture:coreContourCapture,medianCoreDisplacementMiles:coreMedianDisplacement,
      signedCoreDisplacementMiles
    },
    displacementMiles, placementScore
  };
}

function tornadoEfWeight(ef) {
  return ef>=4?6:ef===3?4:ef===2?2.5:ef===1?1.5:1;
}
function safeRatio(a,b){return b?a/b:0}
function gridDistance(a,b,width){return Math.hypot(a%width-b%width,Math.floor(a/width)-Math.floor(b/width))}
function nearestGridDistanceMiles(index,eligible,width,cellMiles){
  if(!eligible.length)return Infinity;
  let best=Infinity;for(const target of eligible)best=Math.min(best,gridDistance(index,target,width)*cellMiles);return best;
}
function nearestGridVectorMiles(index,eligible,width,cellMiles){
  if(!eligible.length)return null;
  const x=index%width,y=Math.floor(index/width);
  let best=null,bestDistance=Infinity;
  for(const target of eligible){
    const dx=target%width-x,dy=Math.floor(target/width)-y,distance=Math.hypot(dx,dy);
    if(distance<bestDistance){bestDistance=distance;best={east:dx*cellMiles,south:dy*cellMiles};}
  }
  return best;
}
function median(values){
  const finite=values.filter(Number.isFinite).sort((a,b)=>a-b);
  return finite.length?finite[Math.floor((finite.length-1)/2)]:null;
}
function connectedMaskComponents(mask,width,height){
  const seen=new Uint8Array(mask.length),components=[];
  for(let start=0;start<mask.length;start++){if(!mask[start]||seen[start])continue;const queue=[start],component=[];seen[start]=1;for(let head=0;head<queue.length;head++){const i=queue[head];component.push(i);const x=i%width,y=Math.floor(i/width);for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(nx<0||nx>=width||ny<0||ny>=height)continue;const ni=ny*width+nx;if(mask[ni]&&!seen[ni]){seen[ni]=1;queue.push(ni)}}}components.push(component)}
  return components;
}

function eventPlacementForMask(product, truth, hazard) {
  const mask = hazard === 'overall'
    ? Uint8Array.from(product.grid, (_, i) => truth.tornadoExact[i] || truth.hailExact[i] || truth.windExact[i] ? 1 : 0)
    : truth[`${hazard}Exact`];
  let count = 0, exact = 0, withinOne = 0, under = 0, severeUnder = 0;
  const forecastCategoryCounts = Object.fromEntries(RISK_ORDER.map(r => [r, 0]));
  const observedCategoryCounts = Object.fromEntries(RISK_ORDER.map(r => [r, 0]));
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    count++;
    const forecastCategory = hazard === 'overall'
      ? product.grid[i].risk
      : (product.grid[i].categories?.[hazard] ?? categoryFromHazard(hazard, Number(product.grid[i][`${hazard}Probability`]) || 0, Number(product.grid[i][`${hazard}Cig`]) || 0));
    const observedCategory = hazard === 'overall'
      ? truth.risk[i]
      : categoryFromHazard(hazard, truth.observedProbability[hazard][i] || 0, truth.observedCig[hazard][i] || 0);
    const fr = Math.max(0, RISK_ORDER.indexOf(forecastCategory));
    const or = Math.max(0, RISK_ORDER.indexOf(observedCategory));
    forecastCategoryCounts[forecastCategory] = (forecastCategoryCounts[forecastCategory] || 0) + 1;
    observedCategoryCounts[observedCategory] = (observedCategoryCounts[observedCategory] || 0) + 1;
    if (fr === or) exact++;
    if (Math.abs(fr - or) <= 1) withinOne++;
    if (fr < or) under++;
    if (fr + 1 < or) severeUnder++;
  }
  const safe = value => count ? value / count : 1;
  const distance = nearestAdequateRiskDistances(product, truth, mask, hazard);
  return {
    eventCellCount: count,
    exactCategoryRate: safe(exact),
    withinOneCategoryRate: safe(withinOne),
    underforecastRate: safe(under),
    severeUnderforecastRate: safe(severeUnder),
    forecastCategoryCounts,
    observedCategoryCounts,
    ...distance
  };
}


function nearestAdequateRiskDistances(product, truth, mask, hazard) {
  const width = truth.width;
  const cellMiles = truth.cellMiles;
  const distances = [];
  for (let i=0;i<mask.length;i++) {
    if (!mask[i]) continue;
    const observed = hazard === 'overall' ? truth.risk[i] : categoryFromHazard(hazard, truth.observedProbability[hazard][i] || 0, truth.observedCig[hazard][i] || 0);
    const targetRank = Math.max(0,RISK_ORDER.indexOf(observed));
    let best = Infinity;
    const x=i%width,y=Math.floor(i/width);
    for(let j=0;j<product.grid.length;j++){
      const forecast = hazard === 'overall' ? product.grid[j].risk : (product.grid[j].categories?.[hazard] ?? product.grid[j].risk);
      if(Math.max(0,RISK_ORDER.indexOf(forecast)) < targetRank) continue;
      const dx=(j%width)-x,dy=Math.floor(j/width)-y; best=Math.min(best,Math.hypot(dx,dy)*cellMiles);
    }
    distances.push(Number.isFinite(best)?best:null);
  }
  const finite=distances.filter(Number.isFinite).sort((a,b)=>a-b);
  const median=finite.length?finite[Math.floor((finite.length-1)/2)]:null;
  return { medianEventToAdequateRiskDistanceMiles: median, percentWithin25Miles: distances.length?distances.filter(d=>Number.isFinite(d)&&d<=25).length/distances.length:1, percentWithin50Miles: distances.length?distances.filter(d=>Number.isFinite(d)&&d<=50).length/distances.length:1 };
}

export function buildSpatialCategoricalDiagnostics(grid, truth){
  const forecastRanks=grid.map(c=>Math.max(0,RISK_ORDER.indexOf(c.risk)));
  const observedRanks=truth.risk.map(r=>Math.max(0,RISK_ORDER.indexOf(r)));
  const byObservedCategory={};
  for(let rank=1;rank<RISK_ORDER.length;rank++){
    let count=0,covered=0,exact=0,underByTwo=0,rankSum=0;
    for(let i=0;i<observedRanks.length;i++){if(observedRanks[i]!==rank)continue;count++;rankSum+=forecastRanks[i];if(forecastRanks[i]>=rank)covered++;if(forecastRanks[i]===rank)exact++;if(forecastRanks[i]<=rank-2)underByTwo++;}
    byObservedCategory[RISK_ORDER[rank]]={cellCount:count,adequateCoverage:count?covered/count:1,exactCoverage:count?exact/count:1,severeUnderforecastFraction:count?underByTwo/count:0,meanForecastRank:count?rankSum/count:0};
  }
  const hazardPlacement={};
  for(const hazard of HAZARDS){
    const exact=truth[`${hazard}Exact`]??truth[hazard];
    const counts=Object.fromEntries(RISK_ORDER.map(r=>[r,0]));
    let total=0, atLeastSlight=0, atLeastEnhanced=0, atLeastModerate=0;
    for(let i=0;i<exact.length;i++){if(!exact[i])continue;total++;const risk=grid[i]?.risk??'TSTM';counts[risk]=(counts[risk]??0)+1;const rank=forecastRanks[i];if(rank>=2)atLeastSlight++;if(rank>=3)atLeastEnhanced++;if(rank>=4)atLeastModerate++;}
    hazardPlacement[hazard]={eventCells:total,forecastRiskDistribution:counts,atLeastSlightFraction:total?atLeastSlight/total:1,atLeastEnhancedFraction:total?atLeastEnhanced/total:1,atLeastModerateFraction:total?atLeastModerate/total:1,maximumForecastRiskAtEvent:total?RISK_ORDER[Math.max(...exact.map((v,i)=>v?forecastRanks[i]:0))]:'TSTM'};
  }
  const significantHazardMask=truth.tornadoSig.map((_,i)=>truth.tornadoSig[i]||truth.hailSig[i]||truth.windSig[i]);
  let sigCount=0,sigEnhanced=0,sigModerate=0;
  for(let i=0;i<significantHazardMask.length;i++){if(!significantHazardMask[i])continue;sigCount++;if(forecastRanks[i]>=3)sigEnhanced++;if(forecastRanks[i]>=4)sigModerate++;}
  return {byObservedCategory,hazardPlacement,significantHazardPlacement:{eventCells:sigCount,atLeastEnhancedFraction:sigCount?sigEnhanced/sigCount:1,atLeastModerateFraction:sigCount?sigModerate/sigCount:1}};
}

export function aggregateTruth(frames, initiations, width, height, radius, cellMiles) {
  const n = width * height;
  const result = { width, height, cellMiles, storm:new Uint8Array(n), tornado:new Uint8Array(n), tornadoExact:new Uint8Array(n), tornadoSig:new Uint8Array(n), tornadoExtreme:new Uint8Array(n), tornadoViolent:new Uint8Array(n), hail:new Uint8Array(n), hailExact:new Uint8Array(n), hailSig:new Uint8Array(n), hailExtreme:new Uint8Array(n), wind:new Uint8Array(n), windExact:new Uint8Array(n), windSig:new Uint8Array(n), windExtreme:new Uint8Array(n), initiation:new Uint8Array(n), risk:Array(n).fill('TSTM'), observedProbability:{}, observedCig:{} };
  for (let fi = 0; fi < frames.length; fi++) {
    const frame = frames[fi];
    for (let i = 0; i < n; i++) {
      if (frame.tornado[i]) result.tornadoExact[i] = 1;
      if (frame.hail[i]) result.hailExact[i] = 1;
      if (frame.wind[i]) result.windExact[i] = 1;
    }
    for (const key of ['storm','tornado','tornadoSig','tornadoExtreme','tornadoViolent','hail','hailSig','hailExtreme','wind','windSig','windExtreme']) for (let i = 0; i < n; i++) if (frame[key][i]) spread(result[key], i, width, height, radius);
  }
  for (const initiation of initiations) {
    const x = clamp(Number(initiation.x) || 0, 0, width - 1);
    const y = clamp(Number(initiation.y) || 0, 0, height - 1);
    spread(result.initiation, y * width + x, width, height, radius);
  }
  result.observedProbability = {
    tornado: localOccurrenceProbability(result.tornadoExact, width, height, radius, [2,5,10,15,30,45,60]),
    hail: localOccurrenceProbability(result.hailExact, width, height, radius, [5,15,30,45,60]),
    wind: localOccurrenceProbability(result.windExact, width, height, radius, [5,15,30,45,60,75,90])
  };
  result.observedCig = {
    tornado: deriveObservedCig(result.tornadoSig, result.tornadoExtreme, result.tornadoViolent, 3),
    hail: deriveObservedCig(result.hailSig, result.hailExtreme, null, 2),
    wind: deriveObservedCig(result.windSig, result.windExtreme, null, 3)
  };
  for (let i = 0; i < n; i++) {
    const categories = HAZARDS.map(h => categoryFromHazard(h, result.observedProbability[h][i], result.observedCig[h][i]));
    result.risk[i] = categories.reduce((best, risk) => RISK_ORDER.indexOf(risk) > RISK_ORDER.indexOf(best) ? risk : best, 'TSTM');
  }
  return result;
}

function localOccurrenceProbability(exact, width, height, radius, levels) {
  const out = new Uint8Array(exact.length);
  const span = Math.ceil(radius);
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    let hits=0, total=0;
    for (let dy=-span;dy<=span;dy++) for (let dx=-span;dx<=span;dx++) {
      if (Math.hypot(dx,dy)>radius+1e-9) continue;
      const xx=x+dx, yy=y+dy;
      if (xx<0||xx>=width||yy<0||yy>=height) continue;
      total++; hits += exact[yy*width+xx] ? 1 : 0;
    }
    const raw = total ? 100*hits/total : 0;
    let discrete = 0;
    for (const level of levels) if (raw >= level) discrete = level;
    out[y*width+x] = discrete;
  }
  return out;
}

function deriveObservedCig(sig, extreme, violent, maximum) {
  const out = new Uint8Array(sig.length);
  for (let i=0;i<out.length;i++) {
    if (sig[i]) out[i]=1;
    if (extreme?.[i]) out[i]=Math.min(maximum,2);
    if (violent?.[i]) out[i]=Math.min(maximum,3);
  }
  return out;
}

function binaryScores(probabilities, observed, threshold = 0.15) {
  let tp=0, fp=0, tn=0, fn=0, brier=0, sumP=0, obsCount=0;
  for (let i=0;i<observed.length;i++) {
    const p=clamp(Number(probabilities[i])||0,0,1), o=observed[i]?1:0, yes=p>=threshold;
    if (yes&&o)tp++; else if(yes&&!o)fp++; else if(!yes&&o)fn++; else tn++;
    brier+=(p-o)**2; sumP+=p; obsCount+=o;
  }
  const safe=(a,b)=>b?a/b:0;
  return { threshold, tp,fp,tn,fn, forecastAreaFraction:safe(tp+fp,observed.length), observedAreaFraction:safe(tp+fn,observed.length), brierScore:brier/observed.length, baseRate:obsCount/observed.length, meanForecastProbability:sumP/observed.length,
    probabilityOfDetection:safe(tp,tp+fn), falseAlarmRatio:safe(fp,tp+fp), criticalSuccessIndex:safe(tp,tp+fp+fn), precision:safe(tp,tp+fp), specificity:safe(tn,tn+fp), accuracy:safe(tp+tn,observed.length) };
}


function buildDecisionTree(product) {
  const maxima = {};
  for (const hazard of HAZARDS) {
    maxima[hazard] = product.grid.reduce((best, cell) => {
      const probability = Number(cell[`${hazard}Probability`]) || 0;
      const cig = Number(cell[`${hazard}Cig`]) || 0;
      const category = cell.categories?.[hazard] ?? categoryFromHazard(hazard, probability, cig);
      return RISK_ORDER.indexOf(category) > RISK_ORDER.indexOf(best.category) || (category === best.category && probability > best.probability)
        ? { probability, cig, category, peakInitiation: Number(cell.peakInitiation)||0, peakCoverage: Number(cell.peakCoverage)||0, peakHourUtc: cell.peakHourUtc ?? product.peakForecastHourUtc }
        : best;
    }, { probability:0, cig:0, category:'TSTM', peakInitiation:0, peakCoverage:0, peakHourUtc:product.peakForecastHourUtc });
  }
  const driver = Object.entries(maxima).sort((a,b)=>RISK_ORDER.indexOf(b[1].category)-RISK_ORDER.indexOf(a[1].category) || b[1].probability-a[1].probability)[0];
  return { overallRisk: product.overallRisk, drivingHazard: driver?.[0] ?? null, drivingCategory: driver?.[1]?.category ?? 'TSTM', hazardBranches: maxima };
}

function summarizeAuthoritativeEnvironment(world) {
  const rows=[];
  world.forEachCell?.(cell=>rows.push({cape:Number(cell.derived?.cape)||0,cin:Number(cell.derived?.cin)||0,srh:Number(cell.derived?.srh)||0,shear:Number(cell.derived?.bulkShear)||0,lcl:Number(cell.derived?.lclAgl??cell.derived?.lcl)||0,stp:Number(cell.derived?.stp)||0,dewpoint:Number(cell.surface?.dewpoint)||0,forcing:Number(cell.dynamics?.forcingScore??cell.derived?.diagnostics?.forcing)||0,initiation:Number(cell.forecast?.initiationProbability??cell.dynamics?.initiationPotential)||0}));
  if(!rows.length)return null;
  const ranked=[...rows].sort((a,b)=>(b.stp+b.cape/1500+b.srh/250)-(a.stp+a.cape/1500+a.srh/250));
  const corridor=ranked.slice(0,Math.max(1,Math.ceil(rows.length*.08)));
  const avg=k=>mean(corridor.map(r=>r[k])); const mx=k=>Math.max(0,...rows.map(r=>r[k]));
  return {corridorMean:{cape:avg('cape'),cin:avg('cin'),srh:avg('srh'),shear:avg('shear'),lcl:avg('lcl'),stp:avg('stp'),dewpoint:avg('dewpoint'),forcing:avg('forcing'),initiation:avg('initiation')},domainMax:{cape:mx('cape'),srh:mx('srh'),shear:mx('shear'),stp:mx('stp'),initiation:mx('initiation')}};
}

function buildEnvironmentalEvolution(frames){
  return frames.map(f=>({hourUtc:f.hourUtc,activeStorms:f.activeStorms,maxIntensity:f.maxIntensity,...(f.environment??{})}));
}

function buildForecastObservedComparison(product, frames, truth, observedOverall){
  const forecast=product.forecastReasoning?.representativeEnvironment??{};
  const envs=frames.map(f=>f.environment?.corridorMean).filter(Boolean);
  const peak=k=>envs.length?Math.max(...envs.map(e=>Number(e[k])||0)):0;
  return {forecastOverallRisk:product.overallRisk,observedOverallRisk:observedOverall,representativeForecastEnvironment:forecast,observedPeakEnvironment:{cape:peak('cape'),srh:peak('srh'),shear:peak('shear'),stp:peak('stp'),initiation:peak('initiation')},observedHazardMaximum:{tornado:Math.max(0,...truth.observedProbability.tornado),hail:Math.max(0,...truth.observedProbability.hail),wind:Math.max(0,...truth.observedProbability.wind)}};
}

function diagnoseBustContributors(product, frames, truth, observedOverall){
  const factors=[]; const reasoning=product.forecastReasoning??{}; const envs=frames.map(f=>f.environment?.corridorMean).filter(Boolean);
  const peak=k=>envs.length?Math.max(...envs.map(e=>Number(e[k])||0)):0; const first=envs[0]??{}; const last=envs.at(-1)??{};
  const forecastInit=Number(reasoning.corridorMetrics?.meanInitiation)||0; const observedInit=sum(truth.initiation)/Math.max(1,truth.initiation.length);
  if(forecastInit-observedInit>.12)factors.push({factor:'Storm initiation substantially lower than forecast',severity:clamp((forecastInit-observedInit)*3,0,1)});
  if((Number(reasoning.representativeEnvironment?.cape)||0)-peak('cape')>700)factors.push({factor:'Instability failed to reach the forecast corridor magnitude',severity:clamp(((Number(reasoning.representativeEnvironment?.cape)||0)-peak('cape'))/1800,0,1)});
  if((Number(reasoning.representativeEnvironment?.srh)||0)-peak('srh')>80)factors.push({factor:'Low-level shear or hodograph curvature underperformed',severity:clamp(((Number(reasoning.representativeEnvironment?.srh)||0)-peak('srh'))/220,0,1)});
  if((Number(last.stp)||0)<(Number(first.stp)||0)*.7 && frames.length>2)factors.push({factor:'Tornadic composite weakened through the valid period',severity:clamp(1-(Number(last.stp)||0)/Math.max(.1,Number(first.stp)||0),0,1)});
  if(RISK_ORDER.indexOf(product.overallRisk)-RISK_ORDER.indexOf(observedOverall)>=2)factors.push({factor:'Categorical risk substantially exceeded observed severity',severity:1});
  for(const text of reasoning.limitingFactors??[])factors.push({factor:`Forecast limitation: ${text}`,severity:.35});
  return factors.sort((a,b)=>b.severity-a.severity).slice(0,8);
}

function summarizeDay(products) {
  if (!products.length) return { count:0, meanScore:null, best:null, latest:null };
  const sorted=[...products].sort((a,b)=>a.issuedHourUtc-b.issuedHourUtc);
  return { count:products.length, meanScore:mean(products.map(p=>p.score)), best:[...products].sort((a,b)=>b.score-a.score)[0], latest:sorted.at(-1) };
}

function summarizeEvent(world, frames, initiations) {
  const maxActive = Math.max(0,...frames.map(f=>f.activeStorms));
  const maxTornado = Math.max(0,...frames.map(f=>f.tornadoes));
  const maxHail = Math.max(0,...frames.map(f=>f.severeHail));
  const maxWind = Math.max(0,...frames.map(f=>f.severeWind));
  const peak = [...frames].sort((a,b)=>(b.activeStorms+b.maxIntensity)-(a.activeStorms+a.maxIntensity))[0];
  const modeTotals={}; for(const f of frames) for(const [m,c] of Object.entries(f.modes)) modeTotals[m]=(modeTotals[m]??0)+c;
  const peakByDay = {};
  for (let day = 1; day <= 3; day++) {
    const dayStart = SIMULATION_CONFIG.startHourUtc + (day - 1) * 24;
    const dayFrames = frames.filter(f => f.hourUtc >= dayStart && f.hourUtc < dayStart + 24);
    const dayPeak = [...dayFrames].sort((a,b)=>(b.activeStorms+b.maxIntensity)-(a.activeStorms+a.maxIntensity))[0];
    peakByDay[`day${day}`] = dayPeak?.hourUtc ?? null;
  }
  const initiationPeakByDay = {};
  for (let day = 1; day <= 3; day++) {
    const dayStart = SIMULATION_CONFIG.startHourUtc + (day - 1) * 24;
    const rows = initiations.filter(i => Number(i.hourUtc ?? i.createdHourUtc) >= dayStart && Number(i.hourUtc ?? i.createdHourUtc) < dayStart + 24);
    const bins = new Map(); for (const i of rows) { const h = Math.floor(Number(i.hourUtc ?? i.createdHourUtc)); bins.set(h,(bins.get(h)||0)+1); }
    initiationPeakByDay[`day${day}`] = bins.size ? [...bins].sort((a,b)=>b[1]-a[1])[0][0] : null;
  }
  return { stormsCreated:world.stormEngine?.totalCreated??initiations.length, initiations:initiations.length, totalTornadoes:world.stormEngine?.totalTornadoes??0,
    maximumConcurrentStorms:maxActive, maximumConcurrentTornadoes:maxTornado, maximumConcurrentSevereHailStorms:maxHail, maximumConcurrentSevereWindStorms:maxWind,
    peakConvectiveHourUtc:peak?.hourUtc??null, peakConvectiveHourByDay:peakByDay, peakInitiationHourByDay:initiationPeakByDay,
    peakStormIntensity:peak?.maxIntensity??0, dominantModes:Object.entries(modeTotals).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([mode,count])=>({mode,count})) };
}

function summarizeCalibration(products) {
  const all = products.flatMap(p => HAZARDS.map(h => ({ hazard:h, ...p.hazards[h] })));
  return Object.fromEntries(HAZARDS.map(h => {
    const rows=all.filter(r=>r.hazard===h); return [h,{ meanBrier:mean(rows.map(r=>r.brierScore)), meanPOD:mean(rows.map(r=>r.probabilityOfDetection)), meanFAR:mean(rows.map(r=>r.falseAlarmRatio)), meanCSI:mean(rows.map(r=>r.criticalSuccessIndex)), forecastBias:mean(rows.map(r=>r.meanForecastProbability-r.baseRate)) }];
  }));
}

function buildCalibrationSummary(products, event, samples) {
  const first=samples[0], afternoon=samples.find(s=>s.hourUtc===18)||samples[1];
  const day1=products.filter(p=>p.key==='day1');
  const under=mean(day1.map(p=>p.categorical?.underforecastFraction||0));
  const highObserved=day1.some(p=>p.observedOverallRisk==='HIGH');
  const highForecast=day1.some(p=>p.forecastOverallRisk==='HIGH');
  return {
    diurnalCycleStatus: first && afternoon && afternoon.domainSummary?.mean?.surfaceTemperatureF > first.domainSummary?.mean?.surfaceTemperatureF ? 'healthy' : 'weak-or-reversed',
    warmSectorDetectionStatus: first?.warmSectorSummary?.cellCount ? 'detected' : first?.broaderSevereAirMassSummary?.cellCount ? 'strict-too-restrictive' : 'absent',
    day1TimingStatus: Number(event.peakConvectiveHourByDay?.day1) >= 18 && Number(event.peakConvectiveHourByDay?.day1) <= 30 ? 'on-time' : 'off-cycle',
    categoricalBias: under > 0.25 ? 'underforecast' : under < 0.08 ? 'overforecast-or-broad' : 'balanced',
    highRiskStatus: highObserved && !highForecast ? 'missed-high-risk' : 'no-missed-high-risk'
  };
}

function buildRecommendations(products, event, calibration) {
  const notes=[];
  const observedCounts={tornado:event.maximumConcurrentTornadoes,hail:event.maximumConcurrentSevereHailStorms,wind:event.maximumConcurrentSevereWindStorms};
  for(const h of HAZARDS){const c=calibration[h]; if(c.forecastBias>0.05)notes.push(`${cap(h)} probabilities are overforecast on average by ${(c.forecastBias*100).toFixed(1)} percentage points.`); if(c.forecastBias<-0.03)notes.push(`${cap(h)} probabilities are underforecast on average by ${Math.abs(c.forecastBias*100).toFixed(1)} percentage points.`); if(c.meanFAR>0.65)notes.push(`${cap(h)} spatial coverage is too broad; reduce low-end expansion or increase occurrence gating.`); if(c.meanPOD<0.45 && (observedCounts[h]??0)>0)notes.push(`${cap(h)} detection is weak; inspect hazard thresholds and storm-environment coupling.`);}
  const day1=products.filter(p=>p.key==='day1'); if(day1.length&&mean(day1.map(p=>p.initiation.falseAlarmRatio))>0.65)notes.push('Convective-initiation forecasts cover too much area relative to realized initiation.');
  if(!notes.length)notes.push('No dominant calibration failure was detected in this seed; expand to a multi-seed sample before tuning.');
  return notes;
}

export function summarizeStorms(storms){
  return storms.map(storm=>{
    const tornado=storm.hazardExtremes?.tornado??{};
    const wind=storm.hazardExtremes?.wind??{};
    const hail=storm.hazardExtremes?.hail??{};
    const startedHourUtc = Number(storm.createdHourUtc) || 0;
    return { id:storm.id, parentId:storm.parentId??null, mode:storm.mode,
      createdHourUtc:startedHourUtc, startedHourUtc, startedDay:Math.floor(startedHourUtc/24)+1, startedTimeLabel:formatSimulationTime(startedHourUtc),
      active:Boolean(storm.active), ageHours:Number(storm.ageHours)||0, maxIntensity:Number(storm.maxIntensity??storm.intensity)||0,
      diagnostics:{ peakUpdraftStrength:Number(storm.peakUpdraftStrength??storm.updraftStrength)||0, peakRotationStrength:Number(storm.peakRotationStrength??storm.mesocycloneStrength)||0, peakColdPoolStrength:Number(storm.peakColdPoolStrength??storm.coldPoolStrength)||0, mesocycloneCycles:Number(storm.mesocycloneCycle?.cyclesCompleted)||0, lifecycleTransitions:Number(storm.lifecycle?.transitionCount)||0 },
      tornado:{ maxEfRating:tornado.maxEfRating??null, maxWindMph:Number(tornado.maxWindMph)||0, maxWidthYards:Number(tornado.maxWidthYards)||0, maxPathLengthKm:Number(tornado.maxPathLengthKm)||0, cycles:Number(tornado.cycles)||0 },
      wind:{ maxSustainedMph:Number(wind.maxSustainedMph??storm.surfaceWind?.maxSustainedMph)||0, maxGustMph:Number(wind.maxGustMph??storm.surfaceWind?.maxGustMph)||0 },
      hail:{ maxSizeInches:Number(hail.maxSizeInches)||0 }, trackKm:Number(storm.trackKm)||0 };
  }).sort((a,b)=>b.maxIntensity-a.maxIntensity);
}

function formatSimulationTime(hourUtc){
  const totalMinutes=Math.round((Number(hourUtc)||0)*60);
  const day=Math.floor(totalMinutes/(24*60))+1;
  const minuteOfDay=((totalMinutes%(24*60))+(24*60))%(24*60);
  const hour=Math.floor(minuteOfDay/60);
  const minute=minuteOfDay%60;
  return `Day ${day} ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}Z`;
}

function summarizeTruth(t){return { stormCells:sum(t.storm), tornadoCells:sum(t.tornado), tornadoExactTrackCells:sum(t.tornadoExact), tornadoNeighborhoodCells:sum(t.tornado), significantTornadoCells:sum(t.tornadoSig), violentTornadoCells:sum(t.tornadoViolent), hailCells:sum(t.hail), significantHailCells:sum(t.hailSig), extremeHailCells:sum(t.hailExtreme), windCells:sum(t.wind), significantWindCells:sum(t.windSig), extremeWindCells:sum(t.windExtreme), initiationCells:sum(t.initiation), observedMaximumProbability:Object.fromEntries(HAZARDS.map(h=>[h,Math.max(0,...t.observedProbability[h])])), observedMaximumCig:Object.fromEntries(HAZARDS.map(h=>[h,Math.max(0,...t.observedCig[h])])) };}
function ordinalIntensityScores(forecast, observed){let exact=0,withinOne=0,over=0,under=0,mae=0;for(let i=0;i<observed.length;i++){const f=Math.round(forecast[i]||0),o=Math.round(observed[i]||0),d=f-o;if(d===0)exact++;if(Math.abs(d)<=1)withinOne++;if(d>0)over++;if(d<0)under++;mae+=Math.abs(d);}const n=observed.length||1;return{exactAccuracy:exact/n,withinOneAccuracy:withinOne/n,overforecastFraction:over/n,underforecastFraction:under/n,meanAbsoluteError:mae/n,forecastMaximum:Math.max(0,...forecast),observedMaximum:Math.max(0,...observed)};}
function magnitudeProductScore(h,intensity,ci,cat){const b=mean(HAZARDS.map(k=>1-h[k].brierScore));const skill=mean(HAZARDS.map(k=>h[k].criticalSuccessIndex));const intSkill=mean(HAZARDS.map(k=>1-clamp(intensity[k].meanAbsoluteError/3,0,1)));return clamp(100*(0.30*b+0.25*skill+0.15*intSkill+0.15*ci.criticalSuccessIndex+0.15*cat),0,100);}
function spread(arr,index,w,h,r){const x=index%w,y=Math.floor(index/w),span=Math.ceil(r);for(let dy=-span;dy<=span;dy++)for(let dx=-span;dx<=span;dx++){if(Math.hypot(dx,dy)>r+1e-9)continue;const xx=x+dx,yy=y+dy;if(xx>=0&&xx<w&&yy>=0&&yy<h)arr[yy*w+xx]=1;}}
function normalizeProbability(v){const n=Number(v)||0;return n>1?n/100:n;}
function probabilityLabel(threshold){return `${Math.round(threshold*100)}pct`;}
function sum(a){let n=0;for(const v of a)n+=v;return n;}
function mean(a){return a.length?a.reduce((x,y)=>x+(Number(y)||0),0)/a.length:0;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function cap(s){return s.charAt(0).toUpperCase()+s.slice(1);}

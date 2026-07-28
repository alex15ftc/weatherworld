import { categoryFromHazard, categoryFromDay3TotalSevere, publishedCigForHazard } from '../diagnostics/riskDiagnosis.js?v=2.28.12';
import { diagnoseOutlookRealizationChain } from '../storms/StormRealizationPhysics.js?v=2.28.14.1';
const SPECS = {
  day1: { label: 'Day 1', dayOffset: 0, cadence: 6, radius: 1, confidence: 0.96 },
  day2: { label: 'Day 2', dayOffset: 1, cadence: 12, radius: 2, confidence: 0.86 },
  day3: { label: 'Day 3', dayOffset: 2, cadence: 24, radius: 3, confidence: 0.72 }
};
// SPC-style convective days are anchored at 12Z, not civil-midnight. Day 1
// runs from issuance through the next 12Z boundary; Day 2/3 use the following
// complete 12Z-to-12Z periods.
const CONVECTIVE_DAY_START_UTC = 12;
const RISKS = ['TSTM','MRGN','SLGT','ENH','MDT','HIGH'];

export function initializeOutlookCycle(world) {
  world.outlookCycle = { version: 3, physicsVersion: '2.28.14.3', products: {}, selectedDay: 'day1', nextIssueHour: {}, updateLog: [], archive: { day1: [], day2: [], day3: [] } };
  for (const [key, spec] of Object.entries(SPECS)) world.outlookCycle.nextIssueHour[key] = nextIssue(world.validHourUtc, spec.cadence);
  updatePredictiveOutlooks(world, { force: true });
}

export function updatePredictiveOutlooks(world, { force = false } = {}) {
  if (!world.outlookCycle) initializeOutlookCycle(world);
  for (const [key, spec] of Object.entries(SPECS)) {
    if (!force && world.validHourUtc + 1e-6 < world.outlookCycle.nextIssueHour[key]) continue;
    issue(world, key, spec);
    world.outlookCycle.nextIssueHour[key] = nextIssue(world.validHourUtc + 0.001, spec.cadence);
  }
}

export function getOutlookSpec(key) { return SPECS[key] ?? SPECS.day1; }

function issue(world, key, spec) {
  const sourceRevision = Math.max(0, Number(world.forecastContext?.worldRevision ?? world.stateRevision) || 0);
  const sourceSystemNumber = Math.max(1, Number(world.forecastContext?.systemNumber) || 1);
  const sourceSeed = Number(world.forecastContext?.currentSeed ?? world.seed ?? world.config?.seed);
  const upcomingSeed = Number.isFinite(Number(world.upcomingSystemForecast?.seed)) ? Number(world.upcomingSystemForecast.seed) : null;
  const issueSlot = Math.floor((world.validHourUtc + 1e-6) / spec.cadence);
  const cycleId = `${key}-s${sourceSystemNumber}-i${issueSlot}-r${sourceRevision}-${seedTag(sourceSeed)}${upcomingSeed !== null ? `-${seedTag(upcomingSeed)}` : ''}`;
  const grid = [];
  const convectiveDayStart = operationalDayStart(world.validHourUtc);
  const fullStart = convectiveDayStart + spec.dayOffset * 24;
  const fullEnd = fullStart + 24;
  const validStart = key === 'day1' ? Math.max(world.validHourUtc, fullStart) : fullStart;
  const validEnd = key === 'day1' ? Math.max(fullEnd, world.validHourUtc + 24) : fullEnd;
  // Outlooks represent the most consequential convective period within the valid
  // window. Surface-based Plains events usually peak near 20-23Z; elevated MCS
  // setups retain a nocturnal 03Z target. Using the window midpoint was causing
  // 12Z environments to dominate both forecast probabilities and storm timing.
  const lead = peakLeadForWindow(world, validStart, validEnd);
  const handoff = world.upcomingSystemForecast?.handoffHour;
  const upcomingWeight = Number.isFinite(handoff) ? clamp((validEnd - handoff) / Math.max(1, validEnd - validStart), 0, 1) : 0;
  const counts = Object.fromEntries(RISKS.map(r => [r, 0]));
  let overallRisk = 'TSTM';
  const priorGuidance = findPriorGuidance(world, key, validStart, validEnd);
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
    const index = y * world.width + x;
    const forecast = projectCellWindow(world, x, y, validStart, validEnd, spec, upcomingWeight, priorGuidance?.grid?.[index] ?? null);
    grid.push(forecast);
  }
  relocateHazardGuidanceCores(grid, world.width, world.height);
  applyTrajectoryUncertaintyEnvelopes(grid, world.width, world.height, key);
  applyTwentyFiveMileHazardRule(grid, world.width, world.height, world.cellSizeMiles ?? 10);
  smoothHazardProbabilities(grid, world.width, world.height, key === 'day1' ? 1 : 2);
  regionalizeHazardGuidance(grid, world.width, world.height, key);
  enforceHazardProbabilityNesting(grid, world.width, world.height);
  enforceForecastCigSpatialCoherence(grid, world.width, world.height);
  validateAndRepairHazardProducts(grid, key);
  enforceCategoricalContourNesting(grid, world.width, world.height, key);
  validateAndRepairHazardProducts(grid, key);
  const synthesis = synthesizeCategoricalOutlook(grid, world.width, world.height, key);
  grid.forEach((forecast, i) => {
    counts[forecast.risk]++;
    if (RISKS.indexOf(forecast.risk) > RISKS.indexOf(overallRisk)) overallRisk = forecast.risk;
    const cell = world.getCell(i % world.width, Math.floor(i / world.width));
    cell.predictiveOutlook ??= {};
    cell.predictiveOutlook[key] = forecast;
  });
  const previousProduct = world.outlookCycle.products[key];
  if (previousProduct) {
    world.outlookCycle.archive ??= { day1: [], day2: [], day3: [] };
    const history = world.outlookCycle.archive[key] ??= [];
    history.push(structuredClone(previousProduct));
    if (history.length > 24) history.shift();
  }
  world.outlookCycle.products[key] = {
    productSchemaVersion: 4, cycleId, key, label: spec.label, issuedHourUtc: world.validHourUtc,
    validStartHour: validStart,
    validEndHour: validEnd,
    cadenceHours: spec.cadence, overallRisk, counts, synthesis,
    upcomingSystemWeight: Math.round(upcomingWeight * 100),
    sourceSystem: upcomingWeight >= 0.5 ? 'upcoming' : upcomingWeight > 0 ? 'transition' : 'current',
    currentSeed: Number.isFinite(sourceSeed) ? sourceSeed : null,
    upcomingSeed, sourceWorldRevision: sourceRevision, sourceSystemNumber,
    generatedFrom: { currentSeed: Number.isFinite(sourceSeed) ? sourceSeed : null, upcomingSeed, worldRevision: sourceRevision, systemNumber: sourceSystemNumber },
    forecastLeadHours: lead,
    peakForecastHourUtc: world.validHourUtc + lead,
    // Store the issued field so later Day-1 cycles can compare against the prior
    // Day-2/3 forecast for the same valid period rather than forgetting it.
    grid: grid.map(f => ({ risk:f.risk, categories:f.categories, tornadoProbability:f.tornadoProbability, tornadoCig:f.tornadoCig, hailProbability:f.hailProbability, hailCig:f.hailCig, windProbability:f.windProbability, windCig:f.windCig, peakHourUtc:f.peakHourUtc, hazardOverlapScore:f.hazardOverlapScore, peakCoverage:f.peakCoverage, peakInitiation:f.peakInitiation, conditionalTornadoIntensity:f.conditionalTornadoIntensity, conditionalHailIntensity:f.conditionalHailIntensity, conditionalWindIntensity:f.conditionalWindIntensity, projectedStormOccupancy:f.projectedStormOccupancy, hazardCorridors:f.hazardCorridors, boundaryRelativePlacement:f.boundaryRelativePlacement, forecastInitiationHourUtc:f.forecastInitiationHourUtc, corridorRelocation:f.corridorRelocation, cigDiagnostics:f.cigDiagnostics, periodIntegration:f.periodIntegration, regionalization:f.regionalization, day3TotalSevere:f.day3TotalSevere, activeStormSignal:f.activeStormSignal, leadTimeConfidence:f.leadTimeConfidence, trajectory:f.trajectory, projectedEnvironment:f.projectedEnvironment, provenance:f.provenance })),
    frozen: true
  };
  world.outlookCycle.updateLog.push({ cycleId, key, issuedHourUtc: world.validHourUtc, overallRisk, sourceWorldRevision: sourceRevision, sourceSystemNumber });
  if (world.outlookCycle.updateLog.length > 36) world.outlookCycle.updateLog.shift();
}

function projectCellWindow(world, x, y, validStart, validEnd, spec, upcomingWeight = 0, prior = null) {
  const sampleHours = forecastSampleHours(validStart, validEnd);
  const candidates = [];
  let best = null;
  for (const absoluteHour of sampleHours) {
    const lead = Math.max(0, absoluteHour - world.validHourUtc);
    const candidate = projectCellAtLead(world, x, y, lead, spec, upcomingWeight, prior);
    candidates.push(candidate);
    const score = candidate.hazardOverlapScore;
    if (!best || score > best.hazardOverlapScore || (score === best.hazardOverlapScore && RISKS.indexOf(candidate.risk) > RISKS.indexOf(best.risk))) best = candidate;
  }

  // Outlook probability represents the chance of at least one event during the
  // valid period, not just the single most favorable sampled instant. Adjacent
  // samples are correlated, so only a fraction of each additional sample is
  // treated as independent evidence.
  const integrated = {};
  for (const hazard of ['tornado','hail','wind']) {
    const field = `${hazard}Probability`;
    let survival = 1;
    for (let i = 0; i < candidates.length; i++) {
      const p = clamp((Number(candidates[i][field]) || 0) / 100, 0, 0.95);
      const independence = i === 0 ? 1 : 0.24;
      survival *= 1 - p * independence;
    }
    const continuous = 100 * (1 - survival);
    integrated[hazard] = quantize(Math.max(best[field] || 0, continuous), hazard === 'tornado');
  }
  best.tornadoProbability = integrated.tornado;
  best.hailProbability = integrated.hail;
  best.windProbability = integrated.wind;
  best.hazardCorridors = {};
  for (const hazard of ['tornado','hail','wind']) {
    const winner = [...candidates].sort((a,b) =>
      (Number(b.hazardCorridorScores?.[hazard])||0) - (Number(a.hazardCorridorScores?.[hazard])||0)
    )[0];
    best.hazardCorridors[hazard] = {
      score: Number(winner?.hazardCorridorScores?.[hazard]) || 0,
      peakHourUtc: winner?.peakHourUtc ?? best.peakHourUtc,
      trajectory: winner?.hazardTrajectories?.[hazard] ?? winner?.trajectory ?? best.trajectory,
      projectedStormOccupancy: winner?.projectedStormOccupancy ?? 0
    };
  }
  best.periodIntegration = {
    method: 'correlated-poisson-window',
    samples: candidates.length,
    sampleHours,
    continuousProbability: integrated
  };
  recomputeForecastRisk(best);
  return best;
}

function projectCellAtLead(world, x, y, lead, spec, upcomingWeight = 0, prior = null) {
  const local = world.getCell(x, y);
  const preliminaryMode = local.forecast?.discreteFraction >= local.forecast?.linearFraction ? 'discrete' : 'linear';
  const trajectory = forecastStormTrajectory(local, lead, preliminaryMode, world.cellSizeKm, world);
  const sx = clamp(Math.round(x - trajectory.dxCells), 0, world.width - 1);
  const sy = clamp(Math.round(y - trajectory.dyCells), 0, world.height - 1);
  const source = world.getCell(sx, sy);
  const mean = neighborhood(world, x, y, spec.radius);
  const future = upcomingWeight > 0 ? upcomingCell(world, x, y) : null;
  const futureMean = future ? upcomingNeighborhood(world, x, y, spec.radius) : null;
  const mix = (value, average) => value * spec.confidence + average * (1 - spec.confidence);

  // Version 2.28.7: the atmosphere is authoritative. The outlook consumes the
  // occurrence-aware hazard diagnostics already produced from the generated
  // atmospheric state. It must not rebuild a more favorable future atmosphere,
  // impose initiation/coverage floors, or apply analog/setup hazard bonuses.
  const projectionContext = {
    issuedHourUtc: world.validHourUtc,
    elapsedHours: Number(world.evolution?.elapsedHours) || 0,
    config: world.evolution?.config ?? world.config ?? {}
  };
  const sourceEnvironment = projectEnvironmentAtHour(source, world.validHourUtc + lead, projectionContext);
  const targetEnvironment = projectEnvironmentAtHour(local, world.validHourUtc + lead, projectionContext);
  const projectedEnvironment = coupleTrajectoryEnvironment(sourceEnvironment, targetEnvironment);
  const projectedHazards = projectHazardsFromEnvironment(local, projectedEnvironment);
  const projectionWeight = clamp(lead / 6, 0, 1);
  const targetHazardsNow = local.derived?.hazards ?? {};
  const projectedLocal = {
    tornado: lerp(Number(targetHazardsNow.tornadoProbability) || 0, projectedHazards.tornado, projectionWeight),
    hail: lerp(Number(targetHazardsNow.hailProbability) || 0, projectedHazards.hail, projectionWeight),
    wind: lerp(Number(targetHazardsNow.windProbability) || 0, projectedHazards.wind, projectionWeight)
  };
  const neighborhoodTrend = clamp(projectedEnvironment.lifecycleRatio ?? 1, 0.45, 1.2);
  const current = {
    tornado: mix(projectedLocal.tornado, mean.tornado * neighborhoodTrend),
    hail: mix(projectedLocal.hail, mean.hail * neighborhoodTrend),
    wind: mix(projectedLocal.wind, mean.wind * neighborhoodTrend)
  };
  const next = future ? {
    tornado: mix(Math.max(future.derived.hazards.tornadoProbability, projectedHazards.tornado), futureMean.tornado),
    hail: mix(Math.max(future.derived.hazards.hailProbability, projectedHazards.hail), futureMean.hail),
    wind: mix(Math.max(future.derived.hazards.windProbability, projectedHazards.wind), futureMean.wind)
  } : current;

  const sourceForecast = source.forecast ?? {};
  const targetForecast = local.forecast ?? {};
  const peakInitiation = clamp(lerp(Number(sourceForecast.initiationProbability) || 0, sourceEnvironment.initiationProbability, projectionWeight), 0, 1);
  const peakCoverage = clamp(lerp(Number(sourceForecast.stormCoverage) || 0, projectedEnvironment.qualifyingStormOpportunity, projectionWeight), 0, 1);
  const torIntensity = clamp(targetForecast.conditionalTornadoIntensity ?? local.derived.hazards.tornado ?? 0, 0, 1.2);
  const hailIntensity = clamp(targetForecast.conditionalHailIntensity ?? local.derived.hazards.hail ?? 0, 0, 1.2);
  const windIntensity = clamp(targetForecast.conditionalWindIntensity ?? local.derived.hazards.wind ?? 0, 0, 1.2);
  const persistence = forecastPersistence(source, lead, 0);

  // Lead time may reduce confidence, but it cannot make a weak environment more
  // favorable. Day-2/3 uncertainty is expressed only as conservative decay.
  const leadDecay = clamp(1 - Math.max(0, lead - 6) / 120, 0.55, 1);
  const leadTimeConfidence = clamp(spec.confidence * leadDecay, 0.35, 1);
  const blend = (a, b) => a * (1 - upcomingWeight) + b * upcomingWeight;
  const activeRealization = activeStormRealization(world, x, y, lead);
  const occupancyInput = cell => ({
    initiation:Math.max(
      Number(cell.forecast?.initiationProbability)||0,
      Number(cell.forecast?.initiationCorridor)||0,
      Number(cell.dynamics?.initiationPotential)||0,
      Number(cell.dynamics?.triggerStrength)||0
    ),
    coverage:Number(cell.forecast?.stormCoverage)||0,
    track:Number(cell.forecast?.projectedStormTrackSupport)||0,
    organization:Number(cell.forecast?.discreteFraction)||0
  });
  const projectedStormOccupancy = diagnoseProjectedStormOccupancy(
    occupancyInput(source),occupancyInput(local),persistence,
    projectedEnvironment.environmentSuitability,activeRealization.signal
  );
  const hazardTrajectories = {
    tornado: forecastStormTrajectory(local, lead, 'discrete', world.cellSizeKm, world),
    hail: forecastStormTrajectory(local, lead, 'discrete', world.cellSizeKm, world),
    wind: forecastStormTrajectory(local, lead, 'linear', world.cellSizeKm, world)
  };
  const hazardOccupancy = {};
  for (const hazard of ['tornado','hail','wind']) {
    const ht = hazardTrajectories[hazard];
    const hx = clamp(Math.round(x-ht.dxCells),0,world.width-1);
    const hy = clamp(Math.round(y-ht.dyCells),0,world.height-1);
    const upstream = world.getCell(hx,hy);
    hazardOccupancy[hazard] = diagnoseProjectedStormOccupancy(
      occupancyInput(upstream),occupancyInput(local),forecastPersistence(upstream,lead,0),
      projectedEnvironment.environmentSuitability,activeRealization.signal
    );
  }

  const recoveredTornado = blend(current.tornado, next.tornado) * (0.72 + 0.28 * persistence);
  const recoveredHail = blend(current.hail, next.hail) * (0.76 + 0.24 * persistence);
  const recoveredWind = blend(current.wind, next.wind) * (0.76 + 0.24 * persistence);
  let tornado = quantizeForecast(Math.max(recoveredTornado * leadTimeConfidence, activeRealization.tornado), true);
  let hail = quantizeForecast(Math.max(recoveredHail * leadTimeConfidence, activeRealization.hail), false);
  let wind = quantizeForecast(Math.max(recoveredWind * leadTimeConfidence, activeRealization.wind), false);

  // Prior outlooks are metadata for comparison, not a source of hazard energy.
  // No continuity blend is applied because a bad prior forecast must be allowed
  // to collapse immediately when the diagnosed atmosphere no longer supports it.
  void prior;

  const targetHazards = local.derived?.hazards ?? {};
  const futureHazards = future?.derived?.hazards ?? targetHazards;
  const diagnosedCig = diagnoseForecastCig(local, { torIntensity, hailIntensity, windIntensity, persistence, peakInitiation, peakCoverage });
  let tornadoCig = Math.max(Math.round(blend(targetHazards.tornadoCig ?? 0, futureHazards.tornadoCig ?? 0)), diagnosedCig.tornado.cig);
  let hailCig = Math.max(Math.round(blend(targetHazards.hailCig ?? 0, futureHazards.hailCig ?? 0)), diagnosedCig.hail.cig);
  let windCig = Math.max(Math.round(blend(targetHazards.windCig ?? 0, futureHazards.windCig ?? 0)), diagnosedCig.wind.cig);

  // Version 2.28.12: all published probability/CIG pairings are passed
  // through one authoritative cap. In particular, 2% and 5% tornado areas
  // may never display more than CIG1.
  const rawCig = { tornado: tornadoCig, hail: hailCig, wind: windCig };
  tornadoCig = publishedCigForHazard('tornado', tornado, tornadoCig);
  hailCig = publishedCigForHazard('hail', hail, hailCig);
  windCig = publishedCigForHazard('wind', wind, windCig);

  const categories = {
    tornado: categoryFromHazard('tornado', tornado, tornadoCig),
    hail: categoryFromHazard('hail', hail, hailCig),
    wind: categoryFromHazard('wind', wind, windCig)
  };
  const risk = highestRisk(Object.values(categories));
  const hazardOverlapScore = Math.max(
    tornado / 30 * torIntensity * (1 + tornadoCig * 0.18),
    hail / 60 * hailIntensity * (1 + hailCig * 0.16),
    wind / 60 * windIntensity * (1 + windCig * 0.16)
  ) * projectedStormOccupancy;
  const absoluteHour = world.validHourUtc + lead;
  const expectedBreak = Number(sourceForecast.expectedCapBreakHourUtc);
  const nominalInitiation = expectedInitiationHour(world.setupForecast?.key, absoluteHour);
  const initiationHour = Number.isFinite(expectedBreak)
    ? Math.max(expectedBreak, nominalInitiation - 1.5)
    : nominalInitiation;
  const hoursSinceInitiation = absoluteHour - initiationHour;
  const phase = {
    tornado: gaussianPhase(hoursSinceInitiation, 2.5, 2.8),
    hail: gaussianPhase(hoursSinceInitiation, 2.0, 3.3),
    wind: gaussianPhase(hoursSinceInitiation, 5.0, 4.2)
  };
  const hazardCorridorScores = {
    tornado: hazardOccupancy.tornado * torIntensity * (0.42 + 0.58 * clamp(Number(sourceForecast.discreteFraction)||0,0,1)) * phase.tornado
      * (0.52 + 0.48 * projectedTornadoGenesisSupport(world,local,Math.max(0,initiationHour-world.validHourUtc)))
      * boundaryRelativeHazardSupport(local,'tornado'),
    hail: hazardOccupancy.hail * hailIntensity * (0.52 + 0.48 * clamp(Number(sourceForecast.discreteFraction)||0,0,1)) * phase.hail
      * boundaryRelativeHazardSupport(local,'hail'),
    wind: hazardOccupancy.wind * windIntensity * (0.48 + 0.52 * clamp(Number(sourceForecast.linearFraction)||0,0,1)) * phase.wind
      * boundaryRelativeHazardSupport(local,'wind')
  };

  return {
    risk, tornadoProbability: tornado, tornadoCig,
    hailProbability: hail, hailCig, windProbability: wind, windCig,
    categories, confidence: Math.round(leadTimeConfidence * 100),
    morningConvectionSignal: 'atmosphere-authoritative',
    persistenceSignal: Math.round(persistence * 100),
    activeStormSignal: activeRealization.signal,
    peakHourUtc: world.validHourUtc + lead, hazardOverlapScore,
    peakCoverage, peakInitiation,
    projectedStormOccupancy,
    conditionalTornadoIntensity: torIntensity,
    conditionalHailIntensity: hailIntensity,
    conditionalWindIntensity: windIntensity,
    hazardCorridorScores,
    boundaryRelativePlacement: {
      tornado: boundaryRelativeHazardSupport(local,'tornado'),
      hail: boundaryRelativeHazardSupport(local,'hail'),
      wind: boundaryRelativeHazardSupport(local,'wind'),
      boundaryInfluence: clamp(Number(local.features?.explicitBoundaryInfluence)||0,0,1),
      openWarmSectorSupport: clamp(Number(local.forecast?.openWarmSectorSupport)||0,0,1),
      prefrontalSupercellSupport: clamp(Number(local.forecast?.prefrontalSupercellSupport)||0,0,1)
    },
    forecastInitiationHourUtc: initiationHour,
    cigDiagnostics: diagnosedCig,
    trajectory, hazardTrajectories, leadTimeConfidence,
    provenance: {
      mode: 'atmosphere-authoritative',
      sourceX: sx, sourceY: sy,
      targetX: x, targetY: y,
      currentHazards: current,
      upcomingHazards: next,
      initiationProbability: peakInitiation,
      stormCoverage: peakCoverage,
      projectedStormOccupancy,
      syntheticEnvironmentProjection: true,
      projectedEnvironment,
      sourceEnvironment,
      targetEnvironment,
      realizationChain: projectedEnvironment?.realizationChain ?? null,
      confidenceComponents: { pattern: leadTimeConfidence, initiation: projectedEnvironment?.realizationChain?.initiation ?? 0, organization: projectedEnvironment?.realizationChain?.organization ?? 0, hazard: projectedEnvironment?.qualifyingStormOpportunity ?? 0 },
      rawCig,
      analogHazardWeighting: false
    }
  };
}

// Initiation commonly occurs on a front or dryline, but the highest tornado
// and large-hail probabilities usually mature in the unstable inflow sector
// downstream of it. Wind/QLCS guidance remains allowed to hug the lifting axis.
export function boundaryRelativeHazardSupport(cell, hazard) {
  const boundary=clamp(Number(cell?.features?.explicitBoundaryInfluence)||0,0,1);
  const openSector=clamp(Number(cell?.forecast?.openWarmSectorSupport)||0,0,1);
  const prefrontal=clamp(Number(cell?.forecast?.prefrontalSupercellSupport)||0,0,1);
  const warmSector=cell?.features?.warmSector?1:0;
  const matureSector=clamp(.48*prefrontal+.32*openSector+.20*warmSector,0,1);
  if(hazard==='wind'){
    const linear=clamp(Number(cell?.forecast?.linearFraction)||0,0,1);
    return clamp(.88+.12*Math.max(boundary,linear),.88,1);
  }
  const centerlinePenalty=boundary*(1-.55*matureSector);
  const sectorReward=(hazard==='tornado'?.34:.24)*matureSector;
  const penalty=(hazard==='tornado'?.28:.20)*centerlinePenalty;
  return clamp(.92+sectorReward-penalty,.62,1.22);
}


function localSolarHour(utcHour, longitudeOffsetHours = -6) {
  return mod24(utcHour + longitudeOffsetHours);
}

function diurnalHeating(localHour) {
  if (localHour < 6 || localHour > 20.5) return 0;
  if (localHour <= 15.5) return smoothstep(6, 15.5, localHour);
  return 1 - smoothstep(15.5, 20.5, localHour);
}

export function projectEnvironmentAtHour(cell, absoluteHour, context = {}) {
  const d = cell.derived ?? {};
  const fc = cell.forecast ?? {};
  const diag = d.diagnostics ?? {};
  const issuedHourUtc = Number.isFinite(Number(context.issuedHourUtc)) ? Number(context.issuedHourUtc) : 12;
  const lead = Math.max(0, absoluteHour - issuedHourUtc);
  const localHour = localSolarHour(absoluteHour, Number(cell.region?.utcOffsetHours ?? -6));
  const heating = diurnalHeating(localHour);
  const morningHeating = diurnalHeating(localSolarHour(issuedHourUtc, Number(cell.region?.utcOffsetHours ?? -6)));
  const heatingDelta = heating - morningHeating;
  const southerly850 = Math.max(0, Math.cos(((Number(cell.levels?.[850]?.windDirection) || 180) - 180) * Math.PI / 180));
  const moistureTransport = clamp(((Number(cell.levels?.[850]?.windSpeed) || 0) - 15) / 35, 0, 1) * southerly850;
  // The binary analyzed warm-sector flag can legitimately be absent at 12Z
  // while the system forecast already diagnoses an open prefrontal inflow
  // corridor. Use that continuous, atmosphere-derived support when estimating
  // what the air mass can realize later in the valid period.
  const warmSector = Math.max(
    cell.features?.warmSector ? 1 : 0,
    clamp(Number(fc.openWarmSectorSupport) || 0, 0, 1),
    clamp(Number(fc.prefrontalSupercellSupport) || 0, 0, 1) * 0.82
  );
  const cloudPenalty = clamp(Number(cell.features?.cloudCover ?? cell.features?.convectiveDebris ?? 0), 0, 1);
  const cap = Number(cell.thermodynamics?.cin?.mlMagnitude ?? d.mlcinMagnitude ?? d.cin) || 0;
  const baseBreakProbability=Number(fc.capBreakProbability ?? fc.capFailureProbability) || 0;
  const expectedBreak=Number(fc.expectedCapBreakHourUtc);
  const timingDistance=Number.isFinite(expectedBreak)?Math.abs(absoluteHour-expectedBreak):Infinity;
  const timingBoost=Number.isFinite(timingDistance)?clamp(1-timingDistance/6,0,1):0;
  const capErosion = clamp(0.45*heating + (Number(diag.forcing) || 0)*0.25 + baseBreakProbability*0.20 + timingBoost*0.10, 0, 1);
  const budget = diag.energyBudget ?? cell.environmentDiagnostics?.energyBudget ?? {};
  const budgetMoistureChange = (Number(budget.netDewpointTendencyFph) || 0) * Math.min(lead, 6) * 0.5;
  const moistureChange = 3.2 * moistureTransport * warmSector * heating - 2.0 * heating * (1 - moistureTransport) + budgetMoistureChange;
  const lifecycle = projectEventLifecycle(context.config?.scenarioEvolution, Number(context.elapsedHours) || 0, lead);
  const currentCape = Number(d.cape) || 0;
  const dewpoint = (Number(cell.surface?.dewpoint) || 0) + moistureChange;
  const lapseRate = Number(cell.thermodynamics?.lapseRates?.mb700_500 ?? d.lapseRate700500 ?? d.sounding?.lapseRate700500) || 6.5;
  const configuredPotential = Number(context.config?.capePotential) || currentCape;
  const moistureRealization = ramp(dewpoint, 49, 70);
  const lapseRealization = ramp(lapseRate, 5.6, 8.4);
  const sectorRealization = 0.42 + 0.58 * warmSector;
  const attainableCape = configuredPotential
    * (0.24 + 0.76 * heating)
    * (0.36 + 0.64 * moistureRealization)
    * (0.72 + 0.28 * lapseRealization)
    * sectorRealization;
  // Retain short-term continuity, but allow a cool/capped 12Z sounding to grow
  // toward the instability reservoir diagnosed from the underlying air mass.
  // This projection is consumed only by the outlook and never mutates the cell.
  const diurnalCape = currentCape + heatingDelta * 900 + moistureChange * 70 - cloudPenalty * 650;
  const cape = Math.max(0, Math.max(diurnalCape, attainableCape) * lifecycle.ratio);
  const cin = Math.max(0, cap - capErosion * 105 + cloudPenalty * 35 + Math.max(0, 1 - lifecycle.ratio) * 90);
  const srh = Math.max(0, (Number(d.srh) || 0) * (localHour >= 19 || localHour <= 6 ? 1.12 : 0.94));
  const shear = Math.max(0, Number(d.bulkShear) || 0);
  const lcl = Math.max(350, (Number(d.lclAgl ?? d.lcl) || 1900) - moistureChange * 55 + heating * 120);
  const capBreakProbability=clamp(Math.max(baseBreakProbability*(0.65+0.35*timingBoost),1-ramp(cin,15,190))* (1-cloudPenalty*0.35),0,1);
  const physicalInitiation = capBreakProbability * (0.20 + 0.80 * (Number(diag.forcing) || 0)) * (1 - cloudPenalty * 0.55);
  const initiationProbability = clamp(lerp(Number(fc.initiationProbability) || 0, physicalInitiation, clamp(lead / 6, 0, 1)), 0, 1);
  const severeEnvironment = clamp(0.34 * ramp(cape, 700, 2800) + 0.24 * ramp(shear, 28, 55) + 0.22 * ramp(srh, 80, 320) + 0.20 * (1 - ramp(cin, 60, 180)), 0, 1);
  const trendSignal = lifecycle.ratio - 1 + heatingDelta * 0.35;
  const convectivePotential = clamp(Number(fc.convectivePotential) || 0, 0, 1);
  const projectedStormCoverage = clamp(Math.max(
    Number(fc.stormCoverage) || 0,
    convectivePotential * initiationProbability * (0.38 + 0.62 * heating) * (0.72 + 0.28 * lifecycle.ratio)
  ), 0, 1);
  const projected = { absoluteHour, leadHours:lead, localHour, heating, moistureTransport, moistureChange, cape, attainableCape, cin, cinSigned:-cin, srh, shear, lcl, capErosion, capBreakProbability, expectedCapBreakHourUtc:Number.isFinite(expectedBreak)?expectedBreak:null, initiationProbability, projectedStormCoverage, severeEnvironment, lifecycleRatio:lifecycle.ratio, lifecycleStage:lifecycle.stage, trend: trendSignal > 0.08 ? 'strengthening' : trendSignal < -0.08 ? 'weakening' : 'steady' };
  const chain = diagnoseOutlookRealizationChain(cell, projected);
  chain.analyzedCoverage = chain.coverage;
  chain.coverage = projectedStormCoverage;
  // Mature linear systems generate their propagation and wind potential after
  // initiation; a 12Z analysis cannot observe that cold pool yet. Diagnose it
  // from forecast linear organization, downdraft thermodynamics, and realized
  // convective opportunity rather than requiring an already-existing storm.
  const linearSupport=clamp(Number(fc.linearFraction)||0,0,1);
  const dcape=Number(d.dcape??diag.dcape)||0;
  const projectedColdPoolSpeedMs=4+14*linearSupport*initiationProbability
    *(0.48*ramp(cape,700,3200)+0.32*ramp(dcape,250,1100)+0.20*projectedStormCoverage);
  chain.analyzedColdPoolSpeedMs=chain.coldPoolSpeedMs;
  chain.coldPoolSpeedMs=Math.max(Number(chain.coldPoolSpeedMs)||0,projectedColdPoolSpeedMs);
  projected.realizationChain = chain;
  projected.projectedColdPoolSpeedMs=projectedColdPoolSpeedMs;
  projected.qualifyingStormOpportunity = clamp(chain.environmentSuitability * chain.initiation * chain.organization * chain.atLeastOneOrganizedStorm, 0, 1);
  return projected;
}

export function coupleTrajectoryEnvironment(sourceEnvironment, targetEnvironment) {
  const source = sourceEnvironment.realizationChain ?? {};
  const target = targetEnvironment.realizationChain ?? {};
  const coverage = clamp(Number(source.coverage) || 0, 0, 1);
  const instantaneousInitiation = clamp(Number(source.initiation) || 0, 0, 1);
  const opportunityCount = clamp(1 + (Number(sourceEnvironment.leadHours) || 0) / 3, 1, 4);
  const initiation = clamp(1 - Math.pow(1 - instantaneousInitiation, opportunityCount), 0, 1);
  const environmentSuitability = clamp(Number(target.environmentSuitability) || 0, 0, 1);
  const organization = clamp(Number(target.organization) || 0, 0, 1);
  const supercell = clamp(Number(target.supercell) || 0, 0, 1);
  const linear = clamp(Number(target.linear) || 0, 0, 1);
  const convectiveLambda = clamp(coverage * initiation * (0.75 + environmentSuitability * 1.35), 0, 4);
  const organizedLambda = clamp(coverage * initiation * (0.35 + organization * 1.85), 0, 3.5);
  const hailLambda = clamp(convectiveLambda * (0.42 + 0.58 * Math.max(organization, ramp(target.realizedUpdraftMs ?? 0, 16, 45))), 0, 4);
  const windLambda = clamp(convectiveLambda * (0.40 + 0.36 * Math.max(linear, target.balanceSupport ?? 0) + 0.24 * ramp(target.coldPoolSpeedMs ?? 0, 5, 18)), 0, 4);
  const chain = {
    ...target,
    environmentSuitability, initiation, organization, supercell, linear, coverage,
    opportunityLambda: organizedLambda, convectiveLambda, organizedLambda, hailLambda, windLambda,
    atLeastOneConvectiveStorm: 1 - Math.exp(-convectiveLambda),
    atLeastOneOrganizedStorm: 1 - Math.exp(-organizedLambda),
    atLeastOneHailStorm: 1 - Math.exp(-hailLambda),
    atLeastOneWindStorm: 1 - Math.exp(-windLambda),
    trajectoryCoupling: 'source-initiation-target-environment',
    sourceInstantaneousInitiation: instantaneousInitiation,
    periodOpportunityCount: opportunityCount
  };
  return {
    ...targetEnvironment,
    initiationProbability: clamp(1 - Math.pow(1 - clamp(Number(sourceEnvironment.initiationProbability) || 0, 0, 1), opportunityCount), 0, 1),
    realizationChain: chain,
    qualifyingStormOpportunity: clamp(environmentSuitability * initiation * organization * chain.atLeastOneOrganizedStorm, 0, 1),
    sourceInitiationEnvironment: {
      initiationProbability: sourceEnvironment.initiationProbability,
      capBreakProbability: sourceEnvironment.capBreakProbability,
      lifecycleStage: sourceEnvironment.lifecycleStage
    }
  };
}

function projectEventLifecycle(profile = {}, elapsed = 0, lead = 0) {
  const peak = Number(profile?.peakHour ?? 18);
  const develop = Math.max(3, Number(profile?.developmentHours ?? 12));
  const decay = Math.max(6, Number(profile?.decayHours ?? 20));
  const initial = clamp(Number(profile?.initialMaturity ?? 0.35), 0.08, 0.75);
  const value = time => time <= peak
    ? initial + (1 - initial) * smoothstep(Math.max(0, peak - develop), peak, time)
    : 1 - smoothstep(peak, peak + decay, time) * 0.48;
  const current = Math.max(0.08, value(elapsed));
  const future = Math.max(0.08, value(elapsed + lead));
  const stage = elapsed + lead < peak ? 'developing' : elapsed + lead < peak + decay * 0.35 ? 'mature' : 'decaying';
  return { ratio: clamp(future / current, 0.45, 1.45), stage };
}

function diagnoseConditionalHazards(cell, env) {
  const chain = env.realizationChain ?? diagnoseOutlookRealizationChain(cell, env);
  const fc = cell.forecast ?? {};
  const discrete = clamp(Number(fc.discreteFraction) || 0.5, 0, 1);
  const linear = clamp(Number(fc.linearFraction) || 0.5, 0, 1);
  const surfaceBased = clamp(chain.inhibitionEfficiency * ramp(env.lcl, 2300, 650), 0, 1);
  const tornadoConditional = clamp(chain.supercell * surfaceBased * (0.46 * ramp(env.srh, 100, 350) + 0.28 * ramp(chain.lowlevelUH, 20, 180) + 0.16 * ramp(env.shear, 30, 58) + 0.10 * discrete), 0, 1);
  // Hail and damaging wind do not require classic supercell organization.
  // Elevated/multicell updrafts can produce hail, while pulse, multicell, and
  // linear storms can realize severe wind through downdrafts and cold pools.
  const hailOrganization = clamp(0.34 + 0.42 * chain.organization + 0.24 * ramp(chain.realizedUpdraftMs, 16, 44), 0, 1);
  const hailConditional = clamp(hailOrganization * (0.48 * ramp(chain.realizedUpdraftMs, 16, 50) + 0.30 * ramp(env.shear, 24, 55) + 0.22 * discrete), 0, 1);
  const windOrganization = clamp(0.30 + 0.30 * chain.organization + 0.24 * Math.max(chain.linear, linear) + 0.16 * chain.balanceSupport, 0, 1);
  const windConditional = clamp(windOrganization * (0.36 * ramp(chain.coldPoolSpeedMs, 4, 18) + 0.24 * Math.max(chain.linear, linear) + 0.24 * ramp(chain.realizedUpdraftMs, 12, 42) + 0.16 * ramp(cell.derived?.dcape ?? cell.derived?.diagnostics?.dcape ?? 0, 300, 1100)), 0, 1);
  return { tornado:tornadoConditional, hail:hailConditional, wind:windConditional, chain };
}

export function projectHazardsFromEnvironment(cell, env) {
  const conditional = diagnoseConditionalHazards(cell, env);
  const chain = conditional.chain;
  const tornadoOpportunity = chain.atLeastOneOrganizedStorm * chain.environmentSuitability * chain.initiation;
  const hailOpportunity = (chain.atLeastOneHailStorm ?? chain.atLeastOneConvectiveStorm ?? chain.atLeastOneOrganizedStorm) * chain.environmentSuitability * chain.initiation;
  const windOpportunity = (chain.atLeastOneWindStorm ?? chain.atLeastOneConvectiveStorm ?? chain.atLeastOneOrganizedStorm) * chain.environmentSuitability * chain.initiation;
  return {
    // Preserve continuous guidance through trajectory blending and valid-period
    // integration. Published SPC tiers are applied once, downstream; quantizing
    // each sampled instant here erased repeated sub-threshold opportunities.
    tornado: clamp(100 * tornadoOpportunity * conditional.tornado * 0.48,0,60),
    hail: clamp(100 * hailOpportunity * conditional.hail * 1.38,0,90),
    wind: clamp(100 * windOpportunity * conditional.wind * 1.24,0,90)
  };
}

export function tornadoGenesisCorridorSupport(world,cell){
  const fields=cell.mesoscaleFields??{};
  const features=cell.features??{};
  const boundaryIds=features.boundaryObjectIds??[];
  const intersection=boundaryIds.length>=2?1:0;
  const warmFront=clamp(Number(features.warmFrontInfluence)||0,0,1);
  const dryline=clamp(Number(features.drylineInfluence)||0,0,1);
  const boundary=clamp(Number(features.explicitBoundaryInfluence)||0,0,1);
  const triplePoint=world?.mesoscale?.topology?.triplePointKm;
  let tripleSupport=0;
  if(triplePoint&&Number.isFinite(cell.x)&&Number.isFinite(cell.y)){
    const x=(cell.x+.5)*world.cellSizeKm,y=(cell.y+.5)*world.cellSizeKm;
    tripleSupport=Math.exp(-.5*Math.pow(Math.hypot(x-triplePoint.x,y-triplePoint.y)/70,2));
  }
  const boundaryIntersection=Math.max(intersection,Math.sqrt(warmFront*dryline),tripleSupport);
  return clamp(
    .25*(Number(fields.effectiveInflow)||0)
    +.22*(Number(fields.stretchingPotential)||0)
    +.18*(Number(fields.convergenceCorridor)||0)
    +.15*boundary
    +.20*boundaryIntersection,
    0,1
  );
}

export function projectedTornadoGenesisSupport(world,targetCell,leadToInitiation){
  const setup=world?.setupForecast?.key??world?.config?.setupType;
  // Dryline convection repeatedly reforms along the diagnosed moisture
  // gradient; translating the entire genesis axis with the boundary degraded
  // track placement. Warm-front waves are the regime where boundary advection
  // provides a stable, useful displacement signal.
  if(setup==='dryline_cyclone'||setup==='lee_cyclogenesis')
    return projectedDrylineGenesisSupport(world,targetCell,leadToInitiation);
  if(setup!=='warm_front_wave')return tornadoGenesisCorridorSupport(world,targetCell);
  const preferredTypes=setup==='warm_front_wave'?['warm']
    : setup==='dryline_cyclone'||setup==='lee_cyclogenesis'?['dryline','warm']
    : ['dryline','warm','cold'];
  const boundaries=(world?.mesoscale?.boundaries??[]).filter(boundary=>preferredTypes.includes(boundary.type));
  if(!boundaries.length||leadToInitiation<=0)return tornadoGenesisCorridorSupport(world,targetCell);
  let east=0,north=0,weight=0;
  for(const boundary of boundaries){
    const w=Math.max(.05,Number(boundary.strength)||0);
    east+=(Number(boundary.velocityKph?.east)||0)*w;
    north+=(Number(boundary.velocityKph?.north)||0)*w;
    weight+=w;
  }
  east/=weight;north/=weight;
  // Boundary influence on storm-scale genesis is slower than the full frontal
  // translation because the favorable inflow corridor broadens and reforms.
  const propagationFraction=setup==='warm_front_wave'?.42:.34;
  const dxCells=east*leadToInitiation*propagationFraction/world.cellSizeKm;
  const dyCells=-north*leadToInitiation*propagationFraction/world.cellSizeKm;
  const source=world.getCell(
    clamp(Math.round(targetCell.x-dxCells),0,world.width-1),
    clamp(Math.round(targetCell.y-dyCells),0,world.height-1)
  );
  const projected=tornadoGenesisCorridorSupport(world,source);
  const local=tornadoGenesisCorridorSupport(world,targetCell);
  return clamp(Math.max(projected,local*.55),0,1);
}

export function projectedDrylineGenesisSupport(world,targetCell,leadToInitiation){
  const drylines=(world?.mesoscale?.boundaries??[]).filter(boundary=>boundary.type==='dryline');
  if(!drylines.length||leadToInitiation<=0)return drylineGradientSupport(targetCell);
  let boundaryEast=0,boundaryNorth=0,weight=0;
  for(const boundary of drylines){
    const w=Math.max(.05,Number(boundary.strength)||0);
    boundaryEast+=(Number(boundary.velocityKph?.east)||0)*w;
    boundaryNorth+=(Number(boundary.velocityKph?.north)||0)*w;
    weight+=w;
  }
  boundaryEast/=weight;boundaryNorth/=weight;
  const flow=targetCell.levels?.[700]??targetCell.levels?.[850]??{};
  const direction=(Number(flow.windDirection)||240)*Math.PI/180;
  const speedKph=(Number(flow.windSpeed)||0)*1.852;
  const flowEast=-Math.sin(direction)*speedKph;
  const flowNorth=-Math.cos(direction)*speedKph;
  // Dryline mixing advances the moisture gradient more slowly than either the
  // full boundary object or midlevel flow. Their weighted combination predicts
  // where convergence reforms near peak heating.
  const eastKph=Math.max(0,boundaryEast)*.28+Math.max(0,flowEast)*.12+2;
  const northKph=boundaryNorth*.20+flowNorth*.05;
  const source=world.getCell(
    clamp(Math.round(targetCell.x-eastKph*leadToInitiation/world.cellSizeKm),0,world.width-1),
    clamp(Math.round(targetCell.y+northKph*leadToInitiation/world.cellSizeKm),0,world.height-1)
  );
  return clamp(Math.max(drylineGradientSupport(source),drylineGradientSupport(targetCell)*.48),0,1);
}

function drylineGradientSupport(cell){
  const fields=cell?.mesoscaleFields??{},features=cell?.features??{};
  return clamp(
    .28*ramp(Number(fields.dewpointGradientFPer100Km??features.dewpointGradient)||0,5,18)
    +.24*(Number(fields.convergenceCorridor)||0)
    +.18*(Number(fields.effectiveInflow)||0)
    +.14*(Number(fields.stretchingPotential)||0)
    +.10*(Number(fields.moisturePooling)||0)
    +.06*(Number(features.drylineInfluence)||0),
    0,1
  );
}

export function diagnoseProjectedStormOccupancy(source = {}, local = {}, persistence = .5, environmentSupport = .5, activeSignal = 0) {
  const opportunity = input => {
    const initiation=clamp(Number(input.initiation)||0,0,1);
    const coverage=clamp(Number(input.coverage)||0,0,1);
    const track=clamp(Number(input.track)||coverage,0,1);
    const organization=clamp(Number(input.organization)||0,0,1);
    return clamp(1-Math.exp(-1.7*coverage*initiation*(.58+.42*track)*(.62+.38*organization)),0,.98);
  };
  const sourceOpportunity=opportunity(source);
  const survival=clamp(.46+.54*(Number(persistence)||0),.46,1);
  const active=clamp((Number(activeSignal)||0)/100,0,1);
  void local;
  return clamp(Math.max(sourceOpportunity*survival*(.72+.28*clamp(environmentSupport,0,1)),active),0,.98);
}

function smoothstep(a, b, value) {
  const t = clamp((value - a) / Math.max(1e-6, b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function ramp(value, low, high) { return clamp((value - low) / Math.max(1e-6, high - low), 0, 1); }

export function activeStormRealization(world, x, y, lead) {
  const storms = (world.storms ?? []).filter(storm => storm.active);
  if (!storms.length || lead > 12) return { tornado: 0, hail: 0, wind: 0, signal: 0 };
  const targetX = (x + 0.5) * world.cellSizeKm;
  const targetY = (y + 0.5) * world.cellSizeKm;
  let tornado = 0, hail = 0, wind = 0, signal = 0;
  const leadDecay = Math.exp(-Math.max(0, lead) / 7.5);
  for (const storm of storms) {
    const projectedX = storm.positionKm.x + (storm.velocityKph?.east ?? 0) * lead;
    const projectedY = storm.positionKm.y - (storm.velocityKph?.north ?? 0) * lead;
    const distanceKm = Math.hypot(projectedX - targetX, projectedY - targetY);
    const confidence = storm.confidence ?? {};
    const persistence = clamp(confidence.persistence ?? 0, 0, 1);
    const organization = clamp(confidence.organization ?? 0, 0, 1);
    const hazardConfidence = clamp(confidence.hazard ?? 0, 0, 1);
    const radiusKm = clamp(24 + (storm.radar?.radiusXKm ?? 12) * 0.9 + lead * 5 + persistence * 20, 24, 110);
    if (distanceKm > radiusKm * 1.6) continue;
    const spatial = Math.exp(-Math.pow(distanceKm / Math.max(10, radiusKm), 2));
    const realization = spatial * leadDecay * clamp(0.30 + persistence * 0.30 + organization * 0.22 + hazardConfidence * 0.18, 0, 1);
    signal = Math.max(signal, realization);
    const h = storm.hazards ?? {};
    tornado = Math.max(tornado, 30 * clamp(h.tornadoProbability ?? 0, 0, 1) * realization * (0.62 + (confidence.tornado ?? hazardConfidence) * 0.55));
    hail = Math.max(hail, 60 * clamp(h.hailProbability ?? 0, 0, 1) * realization * (0.68 + (confidence.hail ?? hazardConfidence) * 0.52));
    wind = Math.max(wind, 60 * clamp(h.windProbability ?? 0, 0, 1) * realization * (0.72 + (confidence.wind ?? hazardConfidence) * 0.58));
    if (storm.tornado?.onGround) tornado = Math.max(tornado, 15 * spatial * leadDecay);
    if ((storm.surfaceWind?.gustMph ?? 0) >= 58) wind = Math.max(wind, 15 * spatial * leadDecay);
  }
  return { tornado, hail, wind, signal: Math.round(signal * 100) };
}

export function forecastStormTrajectory(cell, lead, mode, cellSizeKm, world = null) {
  // Match the authoritative storm engine's 850–500 mb mean-wind and
  // shear-relative deviation calculation. The former 500-mb-only shortcut
  // could displace a 6-hour supercell corridor by several grid cells.
  const vector = wind => {
    const direction = (Number(wind?.direction ?? wind?.windDirection) || 270) * Math.PI / 180;
    const speed = Number(wind?.speed ?? wind?.windSpeed) || 0;
    return { east:-Math.sin(direction)*speed, north:-Math.cos(direction)*speed };
  };
  const surface = vector(cell.surface?.wind);
  const wind850 = vector(cell.levels?.[850]);
  const wind500 = vector(cell.levels?.[500]);
  const shearEast = wind500.east - surface.east;
  const shearNorth = wind500.north - surface.north;
  const shearMagnitude = Math.hypot(shearEast,shearNorth)||1;
  const bulkShear = Number(cell.derived?.bulkShear)||0;
  const deviationKt = mode === 'discrete' ? 7.5*clamp((bulkShear-22)/30,0,1) : 0;
  let eastKt = wind850.east*.42 + wind500.east*.58 + shearNorth/shearMagnitude*deviationKt;
  let northKt = wind850.north*.42 + wind500.north*.58 - shearEast/shearMagnitude*deviationKt;
  let coldPoolPropagationKph=0,boundaryPropagationKph=forecastBoundaryPropagation(world,cell);
  // The live storm engine applies nearby boundary propagation to supercells as
  // well as lines. Include it before mode-specific cold-pool acceleration.
  eastKt+=boundaryPropagationKph.east/1.852;
  northKt+=boundaryPropagationKph.north/1.852;
  if(mode === 'linear'){
    const coldPoolPush=3+7*clamp(Number(cell.forecast?.linearFraction)||0,0,1);
    eastKt+=shearEast/shearMagnitude*coldPoolPush;
    northKt+=shearNorth/shearMagnitude*coldPoolPush;
    const baseMagnitude=Math.hypot(eastKt,northKt)||1;
    const coldPoolStrength=clamp(
      0.42*(Number(cell.forecast?.conditionalWindIntensity)||0)
      +0.34*(Number(cell.forecast?.linearFraction)||0)
      +0.24*ramp(Number(cell.derived?.dcape)||0,300,1100),0,1
    );
    coldPoolPropagationKph=clamp(5+coldPoolStrength*28,4,34)*.55;
    eastKt+=(eastKt/baseMagnitude)*coldPoolPropagationKph/1.852;
    northKt+=(northKt/baseMagnitude)*coldPoolPropagationKph/1.852;
  }
  const speedKt=Math.max(8,Math.hypot(eastKt,northKt));
  const duration=Math.max(0,lead);
  const dxKm=clamp(eastKt*1.852*duration,-cellSizeKm*18,cellSizeKm*18);
  const dyKm=clamp(-northKt*1.852*duration,-cellSizeKm*18,cellSizeKm*18);
  const motionToward=(Math.atan2(eastKt,northKt)*180/Math.PI+360)%360;
  return {
    dxCells: dxKm/cellSizeKm,
    dyCells: dyKm/cellSizeKm,
    motionDirection: motionToward,
    motionSpeedKt: speedKt,
    distanceKm:Math.hypot(dxKm,dyKm),
    uncertaintyRadiusCells:clamp(0.7+Math.max(0,lead)*0.13+(mode==='linear'?0.65:0.35),1,4.5),
    coldPoolPropagationKph,
    boundaryPropagationKph,
    method:mode==='linear'?'storm-engine-linear-cold-pool-boundary':'storm-engine-850-500-mean-wind'
  };
}

function forecastBoundaryPropagation(world,cell){
  if(!world?.mesoscale?.boundaries?.length)return{east:0,north:0};
  const cx=(Number(cell.x)+.5)*world.cellSizeKm,cy=(Number(cell.y)+.5)*world.cellSizeKm;
  let best={influence:0,east:0,north:0};
  for(const boundary of world.mesoscale.boundaries)for(const point of boundary.pointsKm??[]){
    const distance=Math.hypot(point.x-cx,point.y-cy);
    const influence=Math.exp(-Math.pow(distance/Math.max(12,boundary.widthKm??25),2))*(boundary.strength??0);
    if(influence>best.influence)best={influence,east:(boundary.velocityKph?.east??0)*influence*.35,north:(boundary.velocityKph?.north??0)*influence*.35};
  }
  return{east:best.east,north:best.north};
}

function gaussianPhase(value, center, width) {
  return Math.exp(-0.5 * Math.pow((value - center) / Math.max(0.5, width), 2));
}

function expectedInitiationHour(setupKey, referenceHour) {
  const localTarget = setupKey === 'elevated_mcs' ? 3
    : setupKey === 'high_plains_upslope' ? 23
    : setupKey === 'warm_front_wave' ? 22.5
    : setupKey === 'progressive_cold_front' || setupKey === 'northwest_flow' ? 21
    : 21.5;
  const day = operationalDayStart(referenceHour);
  const candidates = [day - 24 + localTarget, day + localTarget, day + 24 + localTarget];
  return candidates.sort((a,b)=>Math.abs(a-referenceHour)-Math.abs(b-referenceHour))[0];
}

function diagnoseForecastCig(cell, context) {
  const d = cell.derived ?? {};
  const diag = d.diagnostics ?? {};
  const lcl = Number(d.lclAgl ?? d.lcl ?? 2200);
  const cape = Number(d.cape) || 0;
  const shear = Number(d.bulkShear) || 0;
  const srh = Number(d.srh) || 0;
  const cin = Number(d.cin) || 0;
  const forcing = clamp(Number(diag.forcing ?? cell.dynamics?.forcingScore) || 0, 0, 1);
  const discrete = clamp(Number(cell.forecast?.discreteFraction ?? diag.forecastDiscrete) || 0, 0, 1);
  const linear = clamp(Number(cell.forecast?.linearFraction ?? diag.forecastLinear) || 0, 0, 1);
  const lapse = Number(d.midLevelLapseRate ?? d.lapseRate700500 ?? 6.5);
  const dcape = Number(d.dcape) || 0;
  const llj = Number(d.lowLevelJetKt ?? d.lljSpeed ?? cell.levels?.[850]?.windSpeed ?? 0);
  const ramp = (v,a,b)=>clamp((v-a)/Math.max(1e-6,b-a),0,1);

  const torSupport = 0.18*ramp(cape,700,3000)+0.23*ramp(srh,90,350)+0.16*ramp(shear,28,55)+0.13*(1-ramp(lcl,900,2100))+0.12*discrete+0.08*(1-ramp(cin,70,190))+0.10*context.persistence;
  const torLimit = Math.min(ramp(cape,400,1000),ramp(shear,22,36),ramp(srh,55,130),1-ramp(lcl,1600,2400),1-ramp(cin,150,240));
  const torScore = clamp(torSupport*(0.55+0.45*torLimit),0,1);
  let torCig=torScore>=0.80?3:torScore>=0.62?2:torScore>=0.43?1:0;

  const hailScore=clamp(0.28*ramp(cape,800,3600)+0.22*ramp(shear,25,55)+0.20*ramp(lapse,6.2,8.0)+0.14*discrete+0.10*context.hailIntensity+0.06*(1-ramp(cin,130,230)),0,1);
  const hailCig=hailScore>=0.72?2:hailScore>=0.43?1:0;

  const windScore=clamp(0.22*ramp(cape,500,3000)+0.20*ramp(shear,22,52)+0.18*linear+0.16*forcing+0.12*ramp(dcape,350,1100)+0.07*ramp(llj,25,55)+0.05*context.persistence,0,1);
  const windCig=windScore>=0.82?3:windScore>=0.64?2:windScore>=0.43?1:0;

  return {
    tornado:{cig:torCig,score:torScore,supportingFactors:[srh>=170?'strong low-level shear':null,shear>=38?'organized deep shear':null,lcl<=1500?'favorable cloud bases':null,discrete>=0.55?'discrete-supercell signal':null].filter(Boolean),limitingFactors:[cin>150?'cap strength':null,lcl>1700?'high cloud bases':null,discrete<0.4?'uncertain discrete mode':null].filter(Boolean),blockedFromNextCigBy:torCig<3?[torScore<0.80?'conditional violent-tornado score':null].filter(Boolean):[]},
    hail:{cig:hailCig,score:hailScore,supportingFactors:[cape>=1800?'strong buoyancy':null,lapse>=7?'steep midlevel lapse rates':null,shear>=38?'organized updraft shear':null].filter(Boolean),limitingFactors:[lapse<6.5?'weak hail-growth lapse rates':null,discrete<0.4?'storm-mode uncertainty':null].filter(Boolean)},
    wind:{cig:windCig,score:windScore,supportingFactors:[linear>=0.55?'linear organization':null,forcing>=0.55?'strong forcing':null,dcape>=650?'downdraft potential':null,llj>=35?'strong low-level flow':null].filter(Boolean),limitingFactors:[linear<0.4?'limited linear-mode support':null,forcing<0.35?'weak forcing':null].filter(Boolean)}
  };
}

function projectedPeakEnvironment(cell, { lead, heating, persistence, discrete, linear, forcing }) {
  const d = cell.derived ?? {};
  const s = cell.surface ?? {};
  const moistureTransport = clamp(((cell.levels?.[850]?.windSpeed ?? 15) - 12) / 42, 0, 1);
  const recovery = clamp(persistence * 0.58 + heating * 0.30 + moistureTransport * 0.12, 0, 1.15);
  const cape = Math.max(Number(d.cape)||0, (Number(d.cape)||0) * (0.78 + recovery * 0.42) + heating * (650 + 1050 * recovery));
  const cin = Math.max(0, (Number(d.cin)||0) * (1 - 0.72 * heating * recovery) - forcing * 55);
  const srh = Math.max(Number(d.srh)||0, (Number(d.srh)||0) * (0.88 + persistence * 0.22) + (mod24(cell.validHourUtc ?? 0) < 8 ? moistureTransport * 45 : moistureTransport * 20));
  const shear = Math.max(Number(d.bulkShear)||0, (Number(d.bulkShear)||0) * (0.94 + persistence * 0.10));
  const lcl = Math.max(450, (Number(d.lclAgl ?? d.lcl)||1800) - recovery * Math.max(0, (Number(s.dewpoint)||55)-50) * 24);
  const lapse = Number(d.midLevelLapseRate ?? d.lapseRate700500 ?? 6.8);
  const freezing = Number(d.freezingLevelM ?? d.freezingLevel ?? 3400);
  const dcape = Math.max(Number(d.dcape)||0, heating * cape * 0.35 + linear * 420);
  const llj = Number(d.lowLevelJetKt ?? d.lljSpeed ?? cell.levels?.[850]?.windSpeed ?? 0);
  return { cape, cin, srh, shear, lcl, lapse, freezing, dcape, llj, discrete, linear, forcing, persistence, recovery, lead };
}

function projectedTornadoCig(intensity, e, probability) {
  if (intensity < 0.55 || e.discrete < 0.42 || e.cape < 750 || e.shear < 32 || e.srh < 105 || e.lcl > 1850 || e.cin > 170) return 0;
  let cig = 1;
  if (intensity >= 0.76 && e.discrete >= 0.56 && e.cape >= 1100 && e.shear >= 38 && e.srh >= 170 && e.lcl <= 1500 && e.cin <= 135 && e.persistence >= 0.46) cig = 2;
  if (probability >= 30 && intensity >= 0.93 && e.discrete >= 0.72 && e.cape >= 2100 && e.shear >= 45 && e.srh >= 275 && e.lcl <= 1150 && e.cin <= 90 && e.forcing >= 0.62 && e.persistence >= 0.68) cig = 3;
  return cig;
}

function projectedHailCig(intensity, e) {
  if (intensity < 0.53 || e.discrete < 0.38 || e.cape < 1000 || e.shear < 30 || e.lapse < 6.5) return 0;
  if (intensity >= 0.82 && e.discrete >= 0.56 && e.cape >= 2200 && e.shear >= 43 && e.lapse >= 7.1 && e.freezing <= 4100) return 2;
  return 1;
}

function projectedWindCig(intensity, e) {
  if (intensity < 0.52 || e.linear < 0.35 || e.cape < 650 || e.shear < 27) return 0;
  let cig = 1;
  if (intensity >= 0.74 && e.linear >= 0.58 && e.cape >= 1250 && e.shear >= 34 && e.forcing >= 0.42 && (e.dcape >= 600 || e.llj >= 32)) cig = 2;
  if (intensity >= 0.92 && e.linear >= 0.78 && e.cape >= 2000 && e.shear >= 44 && e.forcing >= 0.66 && e.persistence >= 0.68 && (e.dcape >= 950 || e.llj >= 48)) cig = 3;
  return cig;
}

function morningSignal(cell, hour, lead) {
  if (lead < 8 || hour < 10 || hour > 16) return { tornado:1, hail:1, wind:1, signal:'none' };
  const coverage = cell.forecast?.stormCoverage ?? 0.4;
  const recovery = cell.dynamics?.convectiveReadiness ?? 0.45;
  const forcing = cell.dynamics?.forcingScore ?? 0.4;
  if (coverage > 0.66 && recovery < 0.48) return { tornado:.72, hail:.76, wind:.94, signal:'disruptive' };
  if (coverage > 0.48 && forcing > 0.58) return { tornado:1.08, hail:1.02, wind:1.15, signal:'enhancing' };
  return { tornado:.92, hail:.94, wind:1.02, signal:'mixed' };
}



function operationalDayStart(hour) {
  return Math.floor((hour - CONVECTIVE_DAY_START_UTC) / 24) * 24 + CONVECTIVE_DAY_START_UTC;
}

function forecastSampleHours(validStart, validEnd) {
  const hours = new Set([validStart, validEnd]);
  const first = Math.ceil(validStart / 3) * 3;
  for (let h = first; h <= validEnd + 1e-6; h += 3) hours.add(h);
  // Explicitly include the usual late-afternoon peak and the nocturnal LLJ peak
  // in every 12Z-12Z convective day.
  const day0 = operationalDayStart(validStart);
  for (let d = day0 - 24; d <= validEnd + 24; d += 24) {
    for (const offset of [8, 9.5, 11, 15]) { // 20Z, 21:30Z, 23Z, 03Z next day
      const h = d + offset;
      if (h >= validStart && h <= validEnd) hours.add(h);
    }
  }
  return [...hours].sort((a,b)=>a-b);
}

function peakLeadForWindow(world, validStart, validEnd) {
  const setupKey = world.setupForecast?.key;
  const targetHour = setupKey === 'elevated_mcs' ? 4.5
    : setupKey === 'high_plains_upslope' ? 24
    : setupKey === 'warm_front_wave' ? 24.5
    : setupKey === 'progressive_cold_front' || setupKey === 'northwest_flow' ? 22.5
    : 23;
  let best = validStart;
  let bestDistance = Infinity;
  for (let hour = Math.ceil(validStart * 2) / 2; hour <= validEnd + 1e-6; hour += 0.5) {
    const distance = circularHourDistance(mod24(hour), targetHour);
    if (distance < bestDistance) { bestDistance = distance; best = hour; }
  }
  return Math.max(0, best - world.validHourUtc);
}

function surfaceBasedTiming(world, hour) {
  if (world.setupForecast?.key === 'elevated_mcs') {
    return clamp(0.34 + 0.66 * Math.exp(-0.5 * Math.pow(circularHourDistance(hour, 3) / 4.2, 2)), 0.28, 1);
  }
  return clamp(0.18 + 0.82 * Math.exp(-0.5 * Math.pow(circularHourDistance(hour, 21.5) / 3.4, 2)), 0.18, 1);
}

function forecastPersistence(cell, lead, heating) {
  const memory = cell.memory ?? {};
  const processed = clamp(memory.processedAir ?? cell.features?.stormProcessedAir ?? 0, 0, 1);
  const coldPool = clamp(memory.coldPoolMemory ?? 0, 0, 1);
  const currentRecovery = clamp(memory.recovery ?? cell.features?.recoveryFactor ?? 1, 0, 1);
  const ascent = clamp(cell.features?.synopticAscent ?? 0, 0, 1);
  const coherence = clamp(cell.features?.synopticCoherence ?? cell.dynamics?.forcingScore ?? 0, 0, 1);
  const moistureTransport = clamp(((cell.levels?.[850]?.windSpeed ?? 0) - 15) / 38, 0, 1);
  const warmSector = cell.features?.warmSector ? 1 : 0;
  const setupSupport = clamp((cell.forecast?.projectedStormTrackSupport ?? 0) * 0.45 + (cell.forecast?.stormCoverage ?? 0) * 0.25 + (cell.forecast?.openWarmSectorSupport ?? 0) * 0.30, 0, 1);
  const recoveryHours = Math.max(0, lead);
  const decay = Math.exp(-recoveryHours / Math.max(3.5, 8.5 - 3.5 * moistureTransport - 2.0 * ascent));
  const residualDamage = (processed * 0.72 + coldPool * 0.28) * decay;
  return clamp(0.18 + currentRecovery * 0.16 + ascent * 0.17 + coherence * 0.13 + moistureTransport * 0.15 + warmSector * 0.09 + setupSupport * 0.18 + heating * 0.10 - residualDamage * 0.62, 0.08, 1);
}

function recoverHazard(current, cell, persistence, lead, type) {
  const forecast = cell.forecast ?? {};
  const coverage = clamp(forecast.stormCoverage ?? 0, 0, 1.1);
  const track = clamp(forecast.projectedStormTrackSupport ?? 0, 0, 1);
  const intensity = type === 'tornado' ? forecast.conditionalTornadoIntensity : type === 'hail' ? forecast.conditionalHailIntensity : forecast.conditionalWindIntensity;
  const scale = type === 'tornado' ? 32 : type === 'hail' ? 82 : 86;
  const scenarioMaturity = Number(cell.features?.scenarioMaturity ?? 0.5);
  const opportunity = clamp((cell.dynamics?.initiationPotential ?? 0) * 0.42 + coverage * 0.22 + track * 0.18 + scenarioMaturity * 0.18, 0.05, 1);
  // Conditional hail/wind intensity is converted through the expected spatial
  // opportunity, not multiplied by the same small initiation term twice.
  const spatialOpportunity = Math.sqrt(clamp(coverage * track, 0, 1));
  const latent = scale * spatialOpportunity * clamp(intensity ?? 0, 0, 1.2) * persistence * (type === 'tornado' ? opportunity : (0.72 + 0.28 * opportunity));
  const leadConfidence = clamp(0.82 - Math.max(0, lead - 12) / 150, 0.52, 0.82);
  // Potential may remain visible at long range, but realized probabilities need
  // a credible storm opportunity in the same evolving narrative.
  return Math.max(current * (0.62 + opportunity * 0.28), latent * leadConfidence);
}

function continuityBlend(current, previous, weight, tornado) {
  if (!Number.isFinite(previous) || previous <= 0) return current;
  const blended = current * (1 - weight) + previous * weight;
  return quantize(blended, tornado);
}

function findPriorGuidance(world, key, validStart, validEnd) {
  const candidates = [];
  for (const product of Object.values(world.outlookCycle?.products ?? {})) if (product?.grid?.length) candidates.push(product);
  for (const products of Object.values(world.outlookCycle?.archive ?? {})) for (const product of products ?? []) if (product?.grid?.length) candidates.push(product);
  return candidates
    .filter(p => p.key !== key || p.issuedHourUtc < world.validHourUtc)
    .map(p => ({ p, overlap: Math.max(0, Math.min(validEnd, p.validEndHour) - Math.max(validStart, p.validStartHour)) }))
    .filter(x => x.overlap >= 8)
    .sort((a,b) => (b.overlap - a.overlap) || (b.p.issuedHourUtc - a.p.issuedHourUtc))[0]?.p ?? null;
}

function circularHourDistance(a, b) {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}

function upcomingCell(world, x, y) {
  const upcoming = world.upcomingSystemForecast;
  if (!upcoming?.cells?.length) return null;
  const cx = clamp(x, 0, upcoming.width - 1);
  const cy = clamp(y, 0, upcoming.height - 1);
  return upcoming.cells[cy]?.[cx] ?? null;
}
function upcomingNeighborhood(world, x, y, radius) {
  let tornado=0,hail=0,wind=0,count=0;
  for (let dy=-radius;dy<=radius;dy++) for (let dx=-radius;dx<=radius;dx++) {
    const c=upcomingCell(world,x+dx,y+dy); if(!c) continue;
    tornado+=c.derived.hazards.tornadoProbability; hail+=c.derived.hazards.hailProbability; wind+=c.derived.hazards.windProbability; count++;
  }
  return count ? { tornado:tornado/count, hail:hail/count, wind:wind/count } : { tornado:0,hail:0,wind:0 };
}

function neighborhood(world, x, y, radius) {
  let tornado=0,hail=0,wind=0,count=0;
  for (let dy=-radius;dy<=radius;dy++) for (let dx=-radius;dx<=radius;dx++) {
    const c=world.getCell(x+dx,y+dy); if(!c) continue;
    tornado+=c.derived.hazards.tornadoProbability; hail+=c.derived.hazards.hailProbability; wind+=c.derived.hazards.windProbability; count++;
  }
  return { tornado:tornado/count, hail:hail/count, wind:wind/count };
}
function highestRisk(values){return values.reduce((best,value)=>RISKS.indexOf(value)>RISKS.indexOf(best)?value:best,'TSTM');}
function quantize(v,tornado){const a=tornado?[0,2,5,10,15,30,45,60]:[0,5,15,30,45,60,75,90];let r=0;for(const n of a)if(v>=n)r=n;return r;}
function quantizeForecast(v,tornado){const a=tornado?[0,2,5,10,15,30,45,60]:[0,5,15,30,45,60,75,90];const value=Math.max(0,Number(v)||0);let best=a[0],distance=Infinity;for(const n of a){const d=Math.abs(value-n);if(d<distance){distance=d;best=n;}}return best;}
function down(v,t){const a=t?[0,2,5,10,15,30,45,60]:[0,5,15,30,45,60,75,90];return a[Math.max(0,a.indexOf(v)-1)];}
function up(v,t){const a=t?[0,2,5,10,15,30,45,60]:[0,5,15,30,45,60,75,90];return a[Math.min(a.length-1,a.indexOf(v)+1)];}

export function relocateHazardGuidanceCores(grid, width = null, height = null) {
  for(const hazard of ['tornado','hail','wind']){
    const pf=`${hazard}Probability`,cf=`${hazard}Cig`;
    const intensityField=`conditional${hazard[0].toUpperCase()}${hazard.slice(1)}Intensity`;
    const pairs=grid.map(cell=>({probability:Number(cell[pf])||0,cig:Number(cell[cf])||0}))
      .sort((a,b)=>(RISKS.indexOf(categoryFromHazard(hazard,b.probability,b.cig))-RISKS.indexOf(categoryFromHazard(hazard,a.probability,a.cig)))||(b.probability-a.probability)||(b.cig-a.cig));
    const signals=grid.map((cell,index)=>({
      index,
      overlap:clamp(
        Number(cell.hazardCorridors?.[hazard]?.score)
          || Number(cell.hazardCorridorScores?.[hazard])
          || clamp(Number(cell.projectedStormOccupancy)||0,0,1)*clamp(Number(cell[intensityField])||0,0,1.2),
        0,1.2
      ),
      originalRank:RISKS.indexOf(categoryFromHazard(hazard,Number(cell[pf])||0,Number(cell[cf])||0))
    }));
    if(Number.isInteger(width)&&Number.isInteger(height)&&width*height===grid.length){
      const raw=signals.map(row=>row.overlap);
      for(const row of signals){
        const x=row.index%width,y=Math.floor(row.index/width);
        const radius=Math.ceil(clamp(Number(grid[row.index].hazardCorridors?.[hazard]?.trajectory?.uncertaintyRadiusCells)||1,1,4.5));
        let envelope=row.overlap;
        for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
          const distance=Math.hypot(dx,dy);if(distance>radius)continue;
          const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=width||ny>=height)continue;
          envelope=Math.max(envelope,raw[ny*width+nx]*Math.exp(-.5*Math.pow(distance/Math.max(1,radius*.62),2)));
        }
        row.overlap=envelope;
      }
    }
    const maxOverlap=Math.max(1e-9,...signals.map(row=>row.overlap));
    // Preserve the broad native hazard corridor while moving its highest tiers
    // toward the hazard-specific initiation-to-maturity path. The old 1.5%
    // original-rank tie breaker effectively performed a global reshuffle.
    signals.sort((a,b)=>((0.72*b.overlap/maxOverlap+0.28*b.originalRank/5)-(0.72*a.overlap/maxOverlap+0.28*a.originalRank/5))||(a.index-b.index));
    for(let rank=0;rank<signals.length;rank++){
      const row=signals[rank],pair=pairs[rank],cell=grid[row.index];
      const originalProbability=Number(cell[pf])||0,originalCig=Number(cell[cf])||0;
      cell[pf]=pair.probability;cell[cf]=pair.cig;
      cell.corridorRelocation??={};
      cell.corridorRelocation[hazard]={method:'hazard-specific-initiation-to-maturity-ranking',originalProbability,originalCig,relocatedProbability:pair.probability,relocatedCig:pair.cig,overlapScore:row.overlap,peakHourUtc:cell.hazardCorridors?.[hazard]?.peakHourUtc??cell.peakHourUtc,rank};
    }
  }
  for(const forecast of grid)recomputeForecastRisk(forecast);
}

export function applyTrajectoryUncertaintyEnvelopes(grid,w,h,key='day1'){
  const levels={
    tornado:[0,2,5,10,15,30,45,60],
    hail:[0,5,15,30,45,60],
    wind:[0,5,15,30,45,60,75,90]
  };
  for(const hazard of ['tornado','hail','wind']){
    const field=`${hazard}Probability`;
    const source=grid.map(cell=>Number(cell[field])||0);
    for(let i=0;i<source.length;i++){
      if(source[i]<=0)continue;
      const x=i%w,y=Math.floor(i/w);
      const trajectory=grid[i].hazardCorridors?.[hazard]?.trajectory;
      const rawRadius=Number(trajectory?.uncertaintyRadiusCells)||1;
      const radius=clamp(Math.ceil(rawRadius*(key==='day1'?.62:.82)),1,key==='day1'?3:4);
      const tierIndex=levels[hazard].indexOf(source[i]);
      for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
        const distance=Math.hypot(dx,dy);if(distance>radius)continue;
        const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;
        // Retain the source tier in the inner ensemble spread and taper one
        // published threshold through the outer half. This broadens early
        // guidance without moving or manufacturing a stronger bullseye.
        const taper=distance<=Math.max(1,radius*.55)?0:1;
        const targetTier=levels[hazard][Math.max(0,tierIndex-taper)]??0;
        grid[ny*w+nx][field]=Math.max(Number(grid[ny*w+nx][field])||0,targetTier);
      }
    }
    for(const cell of grid){
      cell.regionalization??={};
      cell.regionalization[hazard]={...(cell.regionalization[hazard]??{}),trajectoryUncertainty:{method:'lead-dependent-ensemble-envelope'}};
    }
  }
  for(const cell of grid)recomputeForecastRisk(cell,key);
}

function applyTwentyFiveMileHazardRule(grid,w,h,cellSizeMiles=10){
  const radiusCells=25/Math.max(0.1,cellSizeMiles);
  const source=grid.map(v=>({...v}));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const target=grid[y*w+x];
    for(const hazard of ['tornado','hail','wind']){
      const probabilityField=`${hazard}Probability`, cigField=`${hazard}Cig`;
      let probability=0,cig=0;
      const span=Math.ceil(radiusCells);
      for(let dy=-span;dy<=span;dy++)for(let dx=-span;dx<=span;dx++){
        if(Math.hypot(dx,dy)>radiusCells+1e-9)continue;
        const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;
        const neighbor=source[ny*w+nx];
        probability=Math.max(probability,Number(neighbor[probabilityField])||0);
        cig=Math.max(cig,Number(neighbor[cigField])||0);
      }
      target[probabilityField]=probability;
      target[cigField]=cig;
    }
    target.provenance={...(target.provenance??{}),hazardProbabilityBasis:'within-25-miles',hazardRadiusMiles:25,hazardRadiusCells:radiusCells};
  }
  for(const forecast of grid)recomputeForecastRisk(forecast);
}

function smoothHazardProbabilities(grid,w,h,passes){
  const fields=[['tornadoProbability',true],['hailProbability',false],['windProbability',false]];
  for(let pass=0;pass<passes;pass++){
    const copy=grid.map(v=>({...v}));
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x;
      for(const [field,isTor] of fields){
        const values=[];
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;
          values.push(copy[ny*w+nx][field]);
        }
        values.sort((a,b)=>a-b);
        const median=values[Math.floor(values.length/2)];
        grid[i][field]=quantize(copy[i][field]*0.65+median*0.35,isTor);
      }
    }
  }
  for(const f of grid) recomputeForecastRisk(f);
}

// Convert cell-scale guidance into coherent regional outlook areas. The cells
// remain the storage format, but published probabilities are connected fields:
// isolated pixels are downgraded, narrow one-cell spikes are absorbed into the
// surrounding tier, small gaps are bridged, and higher tiers receive nested
// lower-probability envelopes.
function regionalizeHazardGuidance(grid,w,h,key='day1'){
  const configs={
    tornado:{levels:[0,2,5,10,15,30,45,60],min:{2:3,5:4,10:5,15:6,30:6,45:7,60:8}},
    hail:{levels:[0,5,15,30,45,60],min:{5:3,15:5,30:6,45:7,60:8}},
    wind:{levels:[0,5,15,30,45,60,75,90],min:{5:3,15:5,30:6,45:7,60:8,75:9,90:10}}
  };
  for(const [hazard,cfg] of Object.entries(configs)){
    const field=`${hazard}Probability`;
    const vals=grid.map(f=>Number(f[field])||0);
    // Bridge a single-cell gap only when opposite or multiple surrounding cells
    // support the same tier. This joins real corridors without creating blobs.
    for(let li=1;li<cfg.levels.length;li++){
      const level=cfg.levels[li],copy=vals.slice();
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const i=y*w+x;if(copy[i]>=level)continue;
        const n=[[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dy])=>{const nx=x+dx,ny=y+dy;return nx>=0&&ny>=0&&nx<w&&ny<h&&copy[ny*w+nx]>=level;}).length;
        if(n>=2)vals[i]=Math.max(vals[i],level);
      }
    }
    // Downgrade undersized connected components one tier at a time.
    for(let li=cfg.levels.length-1;li>=1;li--){
      const level=cfg.levels[li],lower=cfg.levels[li-1],seen=new Uint8Array(vals.length);
      for(let sy=0;sy<h;sy++)for(let sx=0;sx<w;sx++){
        const start=sy*w+sx;if(seen[start]||vals[start]<level)continue;
        const comp=[start],q=[start];seen[start]=1;
        for(let head=0;head<q.length;head++){const i=q[head],x=i%w,y=Math.floor(i/w);for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const ni=ny*w+nx;if(!seen[ni]&&vals[ni]>=level){seen[ni]=1;q.push(ni);comp.push(ni);}}}
        if(comp.length<(cfg.min[level]??4))for(const i of comp)vals[i]=Math.min(vals[i],lower);
      }
    }
    // Nested shells: every higher tier is surrounded by all lower published tiers.
    for(let hi=cfg.levels.length-1;hi>=2;hi--){
      const source=cfg.levels[hi];
      for(let lo=hi-1;lo>=1;lo--){
        const target=cfg.levels[lo],radius=hi-lo,sources=[];
        for(let i=0;i<vals.length;i++)if(vals[i]>=source)sources.push(i);
        for(const i of sources){const sx=i%w,sy=Math.floor(i/w);for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){if(dx*dx+dy*dy>radius*radius)continue;const x=sx+dx,y=sy+dy;if(x>=0&&y>=0&&x<w&&y<h){const ti=y*w+x;vals[ti]=Math.max(vals[ti],target);}}}
      }
    }
    for(let i=0;i<grid.length;i++){grid[i][field]=vals[i];grid[i].regionalization??={};grid[i].regionalization[hazard]={method:'connected-risk-regions',minimumCells:cfg.min[vals[i]]??0};}
  }
  for(const f of grid)recomputeForecastRisk(f,key);
}



// Ensure published probability contours are topologically nested. A cell at a
// higher probability tier may only touch the same tier or the immediately lower
// tier. Repeating the pass from high to low creates every required intermediate
// envelope (for example 30 -> 15 -> 10 -> 5 -> 2 for tornadoes). The map edge is
// intentionally left open because a risk region may continue beyond the domain.
function enforceHazardProbabilityNesting(grid,w,h){
  const configs={
    tornado:{levels:[0,2,5,10,15,30,45,60],radii:{60:1,45:1,30:1,15:2,10:2,5:3}},
    hail:{levels:[0,5,15,30,45,60],radii:{60:1,45:1,30:2,15:3}},
    wind:{levels:[0,5,15,30,45,60,75,90],radii:{90:1,75:1,60:1,45:2,30:2,15:3}}
  };
  for(const [hazard,cfg] of Object.entries(configs)){
    const field=`${hazard}Probability`,levels=cfg.levels;
    let inserted=0;
    // SPC/NWS-style regions are broad, nested envelopes: lower thresholds are
    // intentionally wider than compact high-probability cores. Each transition
    // gets a tier-dependent buffer rather than a one-cell categorical halo.
    for(let li=levels.length-1;li>=2;li--){
      const source=levels[li],target=levels[li-1],radius=cfg.radii[source]??1;
      const sources=[];
      for(let i=0;i<grid.length;i++)if((Number(grid[i][field])||0)>=source)sources.push(i);
      for(const i of sources){
        const sx=i%w,sy=Math.floor(i/w);
        for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
          if(dx*dx+dy*dy>radius*radius)continue;
          const x=sx+dx,y=sy+dy;if(x<0||y<0||x>=w||y>=h)continue;
          const ni=y*w+x;if((Number(grid[ni][field])||0)<target){grid[ni][field]=target;inserted++;}
        }
      }
    }
    for(const f of grid){f.regionalization??={};f.regionalization[hazard]={...(f.regionalization[hazard]??{}),nesting:{method:'spc-style-broad-nested-envelopes',insertedEnvelopeCells:inserted}};}
  }
  validateAndRepairHazardProducts(grid);
}

function drivingHazards(f){
  const target=RISKS.indexOf(f.risk);
  return ['tornado','hail','wind'].filter(h=>RISKS.indexOf(f.categories?.[h]??'TSTM')===target);
}

function minimumProbabilityForCategory(hazard,cig,targetRisk,current=0){
  const levels=hazard==='tornado'?[0,2,5,10,15,30,45,60]:hazard==='hail'?[0,5,15,30,45,60]:[0,5,15,30,45,60,75,90];
  const target=RISKS.indexOf(targetRisk);
  for(const p of levels){
    if(p<current)continue;
    if(RISKS.indexOf(categoryFromHazard(hazard,p,cig))>=target)return p;
  }
  return null;
}

// Cross-hazard maxima can still create a skipped categorical contour even when
// each individual probability field is nested. Repair those rare seams by
// extending the hazard that actually drives the higher category into an
// immediately lower categorical envelope. Every repaired cell is recomputed
// through the official SPC matrix; risk is never painted independently.
function enforceCategoricalContourNesting(grid,w,h,key='day1'){
  // 2.28.12: categories are never allowed to manufacture hazard probability.
  // Broad lower-probability envelopes are created upstream; this stage only
  // recomputes matrix-derived categories and reports any remaining skipped seam.
  for(const f of grid)recomputeForecastRisk(f,key);
  let skippedTransitions=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,sourceIndex=RISKS.indexOf(grid[i].risk);
    for(const[dx,dy]of[[1,0],[0,1]]){
      const nx=x+dx,ny=y+dy;if(nx>=w||ny>=h)continue;
      const other=RISKS.indexOf(grid[ny*w+nx].risk);
      if(Math.abs(sourceIndex-other)>1)skippedTransitions++;
    }
  }
  for(const f of grid){f.outlookSynthesis??={};f.outlookSynthesis.categoricalNesting={method:'probability-driven-no-category-painting',skippedTransitions};}
}

function enforceForecastCigSpatialCoherence(grid,w,h){
  for(const hazard of ['tornado','hail','wind']){
    const field=`${hazard}Cig`;
    const max=hazard==='hail'?2:3;
    for(let tier=max;tier>=2;tier--){
      const copy=grid.map(v=>v[field]??0);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const i=y*w+x;if(copy[i]<tier)continue;
        let support=0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;
          if(copy[ny*w+nx]>=tier)support++;
        }
        const required=tier===3?5:3;
        if(support<required)grid[i][field]=tier-1;
      }
    }
  }
  for(const f of grid) recomputeForecastRisk(f);
}


function validateAndRepairHazardProducts(grid,key='day1'){
  for(const f of grid){
    for(const hazard of ['tornado','hail','wind']){
      const pf=`${hazard}Probability`,cf=`${hazard}Cig`;
      f[pf]=Math.max(0,Number(f[pf])||0);
      f[cf]=publishedCigForHazard(hazard,f[pf],f[cf]);
      // Preserve coherent conditional-intensity areas after probability smoothing.
      // Tornado CIG2 is valid at 10/15%; CIG3 remains restricted to 30%+.
      if(hazard==='tornado' && f[pf]>=10 && (f.cigDiagnostics?.tornado?.cig??0)>=2) f[cf]=Math.max(f[cf],2);
      if(hazard==='tornado' && f[pf]>=30 && (f.cigDiagnostics?.tornado?.cig??0)>=3) f[cf]=3;
      if(f[pf]===0)f[cf]=0;
    }
    recomputeForecastRisk(f,key);
    // A tornado-driven Enhanced category requires at least a 10% tornado tier.
    if(f.categories?.tornado==='ENH' && f.tornadoProbability<10){
      f.tornadoCig=publishedCigForHazard('tornado',f.tornadoProbability,f.tornadoCig);
      recomputeForecastRisk(f,key);
    }
  }
}

function synthesizeCategoricalOutlook(grid,w,h,key='day1'){
  const rawCounts=Object.fromEntries(RISKS.map(r=>[r,0]));
  const finalCounts=Object.fromEntries(RISKS.map(r=>[r,0]));
  const violations={total:0,tornado:0,hail:0,wind:0};

  // 2.28.6: probability + CIG is authoritative. Spatial synthesis may smooth
  // the underlying probability/CIG fields before this point, but may not
  // independently downgrade the category produced by the official mapping.
  for(const f of grid){
    recomputeForecastRisk(f,key);
    f.rawRisk=f.risk;
    rawCounts[f.risk]++;
    for(const hazard of ['tornado','hail','wind']){
      const expected=categoryFromHazard(hazard,f[`${hazard}Probability`]??0,f[`${hazard}Cig`]??0);
      if(f.categories?.[hazard]!==expected){violations[hazard]++;violations.total++;}
    }
    const expectedOverall=key==='day3' ? categoryFromDay3TotalSevere(Math.max(f.tornadoProbability||0,f.hailProbability||0,f.windProbability||0),Math.min(2,Math.max(f.tornadoCig||0,f.hailCig||0,f.windCig||0))) : highestRisk(Object.values(f.categories));
    if(f.risk!==expectedOverall){violations.total++;f.risk=expectedOverall;}
    f.outlookSynthesis={method:'authoritative-spc-probability-cig',leadTimeConfidence:f.leadTimeConfidence??null};
    finalCounts[f.risk]++;
  }
  return {version:2,method:'authoritative-spc-probability-cig',rawCounts,gatedCounts:{...finalCounts},finalCounts,consistencyViolations:violations};
}

function forcingForTiming(cell){
  return clamp(Math.max(cell.dynamics?.forcingScore??0,cell.features?.synopticAscent??0,cell.forecast?.initiationCorridor??0),0,1);
}

function recomputeForecastRisk(f, key='day1'){
  f.categories={
    tornado:categoryFromHazard('tornado',f.tornadoProbability,f.tornadoCig??0),
    hail:categoryFromHazard('hail',f.hailProbability,f.hailCig??0),
    wind:categoryFromHazard('wind',f.windProbability,f.windCig??0)
  };
  f.risk=highestRisk(Object.values(f.categories));
  if (key === 'day3') {
    const totalProbability = Math.max(f.tornadoProbability||0, f.hailProbability||0, f.windProbability||0);
    const totalCig = Math.max(f.tornadoCig||0, f.hailCig||0, f.windCig||0);
    f.day3TotalSevere = { probability: totalProbability, cig: Math.min(2,totalCig), category: categoryFromDay3TotalSevere(totalProbability, Math.min(2,totalCig)) };
    f.risk = f.day3TotalSevere.category;
  }
}

function smoothRisk(grid,w,h,passes){for(let p=0;p<passes;p++){const copy=grid.map(x=>({...x}));for(let y=0;y<h;y++)for(let x=0;x<w;x++){const vals=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if(nx>=0&&ny>=0&&nx<w&&ny<h)vals.push(RISKS.indexOf(copy[ny*w+nx].risk));}vals.sort((a,b)=>a-b);const med=vals[Math.floor(vals.length/2)],cur=RISKS.indexOf(copy[y*w+x].risk);if(Math.abs(cur-med)>=2)grid[y*w+x].risk=RISKS[med];}}}
function fillEnclosedLowerRisk(grid,w,h){for(let threshold=RISKS.length-1;threshold>=1;threshold--){const seen=new Uint8Array(w*h),q=[];const add=(x,y)=>{const i=y*w+x;if(seen[i]||RISKS.indexOf(grid[i].risk)>=threshold)return;seen[i]=1;q.push(i)};for(let x=0;x<w;x++){add(x,0);add(x,h-1)}for(let y=0;y<h;y++){add(0,y);add(w-1,y)}for(let n=0;n<q.length;n++){const i=q[n],x=i%w,y=Math.floor(i/w);if(x)add(x-1,y);if(x<w-1)add(x+1,y);if(y)add(x,y-1);if(y<h-1)add(x,y+1)}for(let i=0;i<grid.length;i++)if(!seen[i]&&RISKS.indexOf(grid[i].risk)<threshold)grid[i].risk=RISKS[threshold];}}
function keyFor(spec){return Object.keys(SPECS).find(k=>SPECS[k]===spec)}
function nextIssue(hour,cadence){return Math.ceil((hour+1e-6)/cadence)*cadence}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function lerp(a,b,t){return a+(b-a)*t}
function mod24(v){return((v%24)+24)%24}

function seedTag(value) {
  if (!Number.isFinite(value)) return 'seed-na';
  return `seed-${Math.abs(Math.trunc(value)).toString(36)}`;
}

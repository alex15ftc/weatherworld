import { clamp, gaussian } from './math.js?v=2.20.1';

const SETUP_PROFILES = {
  dryline_cyclone: { name:'Classic dryline supercells', coverage:0.62, discrete:0.78, linear:0.24, capUncertainty:0.20, preferred:['dryline','triple'] },
  progressive_cold_front: { name:'Cold-front squall line', coverage:0.92, discrete:0.24, linear:0.88, capUncertainty:0.04, preferred:['coldFront'] },
  warm_front_wave: { name:'Warm-front supercells', coverage:0.48, discrete:0.72, linear:0.28, capUncertainty:0.12, preferred:['warmFront'] },
  lee_cyclogenesis: { name:'Lee cyclone / triple point', coverage:0.58, discrete:0.76, linear:0.30, capUncertainty:0.18, preferred:['dryline','triple'] },
  shortwave_ejection: { name:'Ejecting-wave outbreak', coverage:0.88, discrete:0.62, linear:0.52, capUncertainty:0.08, preferred:['warmFront','dryline','coldFront'] },
  northwest_flow: { name:'Northwest-flow clusters', coverage:0.66, discrete:0.38, linear:0.60, capUncertainty:0.08, preferred:['coldFront','residual'] },
  high_plains_upslope: { name:'High Plains upslope', coverage:0.46, discrete:0.74, linear:0.22, capUncertainty:0.16, preferred:['terrain','leeTrough'] },
  elevated_mcs: { name:'Nocturnal elevated MCS', coverage:0.84, discrete:0.20, linear:0.76, capUncertainty:0.07, preferred:['warmAdvection','coldFront'] }
};

export function initializeSetupForecast(world) {
  const key = world.scenarioMetadata?.setupType ?? world.evolution?.config?.setupType ?? 'dryline_cyclone';
  const profile = SETUP_PROFILES[key] ?? SETUP_PROFILES.dryline_cyclone;
  world.setupForecast = {
    key,
    label: profile.name,
    profile: { ...profile },
    initializedHourUtc: world.validHourUtc,
    forecastVsRealization: { expectedStorms: 0, realizedStorms: 0 }
  };
  projectSetupForecast(world);
}

export function updateSetupForecast(world) {
  if (!world.setupForecast) initializeSetupForecast(world);
  projectSetupForecast(world);
  const expected = estimateExpectedStormCount(world);
  world.setupForecast.forecastVsRealization = {
    expectedStorms: expected,
    realizedStorms: (world.storms ?? []).filter(storm => storm.active !== false).length
  };
}

function projectSetupForecast(world) {
  const profile = world.setupForecast.profile;
  const hour = ((world.validHourUtc % 24) + 24) % 24;
  // Surface-based convection should usually maximize during late-afternoon/early-evening
  // heating, not around 12Z. A broad 21.5Z peak preserves some earlier CI while
  // strongly favoring the 20-23Z window requested for Plains chase gameplay.
  const lateAfternoonPeak = Math.exp(-0.5 * Math.pow(circularHourDistance(hour, 22) / 2.8, 2));
  const heatingRamp = smoothstepHour(hour, 14, 21);
  const eveningDecay = hour >= 0 && hour < 7 ? clamp(1 - hour / 7, 0, 1) : 1;
  // Surface-based parcels should generally remain capped at 12Z and cook through
  // the afternoon. The resulting CI factor is intentionally small before 16Z,
  // rises quickly after 18Z, and peaks from roughly 20Z through 00Z.
  const diurnal = clamp((0.025 + heatingRamp * 0.62 + lateAfternoonPeak * 0.48) * eveningDecay, 0.02, 1);
  const elevatedSetup = world.setupForecast?.key === 'elevated_mcs';
  const nocturnalCenter = elevatedSetup ? 4 : 3;
  const nocturnalWidth = elevatedSetup ? 2.5 : 3.7;
  const nocturnal = clamp(Math.exp(-0.5 * Math.pow(circularHourDistance(hour, nocturnalCenter) / nocturnalWidth, 2)), elevatedSetup ? 0.01 : 0.08, 1);
  const nocturnalCooling = clamp(Math.exp(-0.5 * Math.pow(circularHourDistance(hour, 7) / 4.6, 2)), 0, 1);

  world.forEachCell((cell, x, y) => {
    const readiness = cell.dynamics?.convectiveReadiness ?? 0;
    const trigger = cell.dynamics?.triggerStrength ?? 0;
    const initiation = cell.dynamics?.initiationPotential ?? 0;
    const boundary = cell.features?.explicitBoundaryInfluence ?? 0;
    const bType = cell.features?.primaryBoundaryType ?? cell.features?.explicitBoundaryType ?? '';
    const nx = x / Math.max(1, world.width - 1);
    const ny = y / Math.max(1, world.height - 1);
    const terrain = clamp(((cell.terrain?.elevationM ?? 0) - 500) / 1000, 0, 1);
    const llj = clamp(((cell.levels?.[850]?.windSpeed ?? 0) - 20) / 35, 0, 1);
    const upper = cell.features?.synopticAscent ?? 0;
    const warmSector = cell.features?.warmSector ? 1 : 0;
    const lclAgl = cell.derived?.lclAgl ?? Math.max(0,(cell.derived?.lcl ?? 1800)-(cell.terrain?.elevationM ?? 0));
    const lowLcl = clamp((1700 - lclAgl) / 1050, 0, 1);
    const lowLevelRotation = clamp(((cell.derived?.srh ?? 0) - 70) / 280, 0, 1.15);
    const instability = clamp(((cell.derived?.cape ?? 0) - 400) / 2800, 0, 1.15);
    const shear = clamp((cell.derived?.bulkShear ?? 0) / 60, 0, 1.25);
    const openSector = clamp(warmSector * (0.34 + 0.28 * readiness + 0.20 * upper + 0.10 * lowLevelRotation + 0.08 * instability), 0, 1);
    const effectiveInflow = clamp(cell.mesoscaleFields?.effectiveInflow ?? 0, 0, 1);
    const moisturePooling = clamp(cell.mesoscaleFields?.moisturePooling ?? 0, 0, 1);

    let corridor = 0.10;
    if (profile.preferred.includes('dryline') && bType === 'dryline') corridor = Math.max(corridor, boundary);
    if (profile.preferred.includes('warmFront') && bType === 'warmFront') corridor = Math.max(corridor, boundary);
    if (profile.preferred.includes('coldFront') && bType === 'coldFront') corridor = Math.max(corridor, boundary);
    if (profile.preferred.includes('terrain')) corridor = Math.max(corridor, terrain * (0.55 + 0.45 * trigger));
    if (profile.preferred.includes('warmAdvection')) corridor = Math.max(corridor, llj * (0.45 + 0.55 * upper));
    if (profile.preferred.includes('triple')) corridor = Math.max(corridor, boundary * clamp((cell.derived?.srh ?? 0) / 250, 0, 1));
    if (profile.preferred.includes('residual')) corridor = Math.max(corridor, gaussian(nx - 0.55, ny - 0.52, 0.22) * trigger);
    if (profile.preferred.includes('leeTrough')) corridor = Math.max(corridor, terrain * gaussian(nx - 0.30, ny - 0.56, 0.25));
    // Broad warm-sector ascent can initiate storms away from the exact boundary axis.
    // This is intentionally important for gameplay: open-sector supercells should be
    // a regular realization in strongly unstable, uncapped outbreak environments.
    corridor = Math.max(corridor, openSector * (0.42 + 0.34 * effectiveInflow + 0.24 * moisturePooling));

    const mostUnstableCape = cell.derived?.sounding?.mucape ?? cell.derived?.cape ?? 0;
    const elevatedInstability = clamp((mostUnstableCape - 300) / 2200, 0, 1);
    const elevatedForcing = clamp(0.42 * llj + 0.33 * upper + 0.25 * corridor, 0, 1);
    const nocturnalElevatedSupport = clamp(nocturnal * elevatedInstability * elevatedForcing, 0, 1);
    const surfaceHeating = clamp(0.58 * heatingRamp + 0.42 * lateAfternoonPeak, 0, 1);
    const capErosion = clamp(
      surfaceHeating * (0.44 + 0.20 * trigger + 0.16 * upper + 0.12 * moisturePooling + 0.08 * corridor)
      + Math.max(0, trigger - 0.72) * 0.30
      + Math.max(0, upper - 0.78) * 0.18,
      0, 1
    );
    const nightStability = clamp(nocturnalCooling * (1 - 0.55 * nocturnalElevatedSupport), 0, 1);
    const surfaceBasedTiming = clamp(diurnal * (0.18 + 0.82 * capErosion), 0.01, 1);
    const timing = world.setupForecast.key === 'elevated_mcs'
      ? Math.max(nocturnalElevatedSupport, surfaceBasedTiming * 0.06)
      : Math.max(surfaceBasedTiming, nocturnalElevatedSupport * 0.62);
    // 2.28.0: distinguish a broad supportive environment from the much narrower
    // probability that a parcel will actually breach inhibition in this cell.
    // Convective potential may remain high on a cap-bust day; initiation
    // probability must not.
    const moistureDepth = clamp(0.48 * effectiveInflow + 0.34 * moisturePooling + 0.18 * clamp(((cell.surface?.dewpoint ?? 45) - 48) / 24, 0, 1), 0, 1);
    const instabilityReadiness = clamp(0.58 * readiness + 0.42 * instability, 0, 1);
    const convectivePotential = clamp(
      0.42 * instabilityReadiness + 0.22 * moistureDepth + 0.16 * shear +
      0.12 * openSector + 0.08 * upper,
      0, 1
    );
    const forcingConfidence = clamp(
      0.30 * trigger + 0.24 * upper + 0.20 * corridor +
      0.14 * (cell.mesoscaleFields?.initiationFocus ?? 0) +
      0.12 * (cell.mesoscaleFields?.convergenceCorridor ?? 0),
      0, 1
    );
    const cinMagnitude = Math.max(0, cell.thermodynamics?.cin?.mlMagnitude ?? cell.derived?.mlcinMagnitude ?? cell.derived?.cin ?? 0);
    const cinSigned = Math.min(0, cell.thermodynamics?.cin?.mlSigned ?? cell.derived?.mlcinSigned ?? -cinMagnitude);
    const observedTendency = Number(cell.cap?.tendencyJkgPerHour) || 0;
    const physicalErosionRate = Math.max(0,
      2.0 + 11.0 * surfaceHeating + 7.0 * trigger + 5.5 * upper +
      4.0 * moisturePooling + 3.0 * corridor - 6.0 * nightStability - Math.max(0, observedTendency)
    );
    const physicalRebuildingRate = Math.max(0,
      1.5 + 8.0 * nightStability + 4.0 * Math.max(0, 1 - moistureDepth) + Math.max(0, observedTendency)
      - 5.0 * surfaceHeating - 3.0 * upper
    );
    const netProjectedErosionRate = physicalErosionRate - physicalRebuildingRate;
    const hoursToBreak = cinMagnitude <= 5 ? 0 : netProjectedErosionRate > 0.5 ? cinMagnitude / netProjectedErosionRate : Infinity;
    const forecastHorizonHours = world.setupForecast.key === 'elevated_mcs' ? 12 : 10;
    const trendProbability = Number.isFinite(hoursToBreak) ? clamp(1 - hoursToBreak / forecastHorizonHours, 0, 1) : 0;
    const inhibitionRelease = clamp(1 - (cinMagnitude - 15) / 185, 0, 1);
    const capBreakProbability = clamp(
      0.38 * trendProbability + 0.18 * inhibitionRelease + 0.14 * forcingConfidence +
      0.10 * trigger + 0.08 * upper + 0.07 * moistureDepth + 0.05 * capErosion -
      profile.capUncertainty * (1 - Math.max(trigger, upper)),
      0, 1
    );
    const capFailureProbability = capBreakProbability;
    const expectedCapBreakHourUtc = capBreakProbability >= 0.20 && Number.isFinite(hoursToBreak)
      ? ((world.validHourUtc ?? hour) + Math.max(0, Math.min(forecastHorizonHours, hoursToBreak)))
      : null;
    const capBreakUncertaintyHours = expectedCapBreakHourUtc == null ? null : clamp(0.75 + profile.capUncertainty * 8 + (1 - forcingConfidence) * 2.5, 0.75, 5);
    const surfaceRelease = clamp(surfaceBasedTiming * capFailureProbability, 0, 1);
    const elevatedRelease = clamp(nocturnalElevatedSupport * (0.45 + 0.55 * forcingConfidence), 0, 1);
    const releaseProbability = world.setupForecast.key === 'elevated_mcs'
      ? Math.max(elevatedRelease, surfaceRelease * 0.35)
      : Math.max(surfaceRelease, elevatedRelease * 0.72);
    const forcedEarlyException = clamp(Math.max(0, trigger - 0.86) * Math.max(0, upper - 0.76) * 1.35, 0, 0.18);
    let initiationProbability = clamp(
      convectivePotential * releaseProbability * (0.18 + 0.82 * forcingConfidence) + forcedEarlyException,
      0, 1
    );
    const lifecycle = lifecycleState(world);
    initiationProbability = clamp(initiationProbability * lifecycle.releaseMultiplier, 0, 1);
    const narrativeKey = world.scenarioMetadata?.narrative ?? '';
    const outbreakIntensity = Number(world.scenarioMetadata?.intensity) || 0;
    const narrativeCoverage = narrativeKey === 'classic_tornado_outbreak' ? (outbreakIntensity >= 0.88 ? 1.42 : 1.28)
      : narrativeKey === 'derecho' ? 1.18
      : ['mixed_mode','qlcs','progressive_mcs'].includes(narrativeKey) ? 1.12
      : narrativeKey === 'hp_supercell' ? 1.08
      : narrativeKey === 'loaded_gun' ? 1.06
      : narrativeKey === 'isolated_supercells' || narrativeKey === 'giant_hail' ? 1.03
      : 1;
    // Coverage is a regional expectation, not a second boundary-proximity score.
    // The old 0.65 + 0.35*corridor term suppressed even outbreak setups away
    // from the exact boundary axis, making MDT/HIGH probabilities nearly vanish.
    const stormCoverage = clamp(profile.coverage * narrativeCoverage * lifecycle.coverageMultiplier
      * (0.20 + 0.80 * initiationProbability)
      * (0.68 + 0.32 * forcingConfidence)
      * (0.80 + 0.20 * corridor), 0.01, 1.08);

    const forcing = cell.dynamics?.forcingScore ?? 0;
    const tornadicBase = clamp(0.28 * lowLevelRotation + 0.20 * lowLcl + 0.18 * shear + 0.15 * instability + 0.11 * effectiveInflow + 0.08 * openSector, 0, 1.15);
    const tornadicEnvironment = clamp(tornadicBase * (0.58 + 0.42 * instability) * (0.58 + 0.42 * lowLcl), 0, 1.15);
    const prefrontalSupercellSupport = clamp(openSector * (0.28 + 0.24 * effectiveInflow + 0.18 * lowLevelRotation + 0.14 * shear + 0.10 * lowLcl + 0.06 * upper) * (1 - 0.28 * Math.max(0, forcing - 0.72)), 0, 1);
    const discreteFraction = clamp(profile.discrete * lifecycle.discreteMultiplier * (0.61 + 0.25 * shear + 0.14 * prefrontalSupercellSupport) * (1 - 0.20 * Math.max(0, forcing - 0.68)), 0.03, 0.97);
    const linearFraction = clamp(profile.linear * lifecycle.linearMultiplier * (0.60 + 0.34 * forcing) * (0.72 + 0.28 * stormCoverage) * (1 - 0.32 * prefrontalSupercellSupport), 0.03, 0.97);

    const torIntensity = clamp(0.31 * clamp((cell.derived?.srh ?? 0) / 300, 0, 1.2) + 0.24 * clamp((cell.derived?.stp ?? 0) / 6, 0, 1.2) + 0.18 * clamp((1800 - lclAgl) / 1100, 0, 1) + 0.17 * shear + 0.10 * discreteFraction, 0, 1.2);
    const hailIntensity = clamp(0.34 * clamp((cell.derived?.cape ?? 0) / 3500, 0, 1.2) + 0.27 * shear + 0.24 * clamp(((cell.thermodynamics?.lapseRates?.mb700_500 ?? cell.derived?.lapseRate700500 ?? 6.5) - 6) / 2.5, 0, 1.2) + 0.15 * discreteFraction, 0, 1.2);
    const windIntensity = clamp(0.29 * clamp((cell.derived?.cape ?? 0) / 3200, 0, 1.2) + 0.25 * shear + 0.24 * forcing + 0.22 * linearFraction, 0, 1.2);

    cell.forecast = {
      setupKey: world.setupForecast.key,
      setupLabel: world.setupForecast.label,
      convectivePotential,
      initiationProbability,
      capFailureProbability,
      capBreakProbability,
      expectedCapBreakHourUtc,
      capBreakWindowStartUtc: expectedCapBreakHourUtc == null ? null : expectedCapBreakHourUtc - capBreakUncertaintyHours,
      capBreakWindowEndUtc: expectedCapBreakHourUtc == null ? null : expectedCapBreakHourUtc + capBreakUncertaintyHours,
      capBreakConfidence: expectedCapBreakHourUtc == null ? clamp(1-capBreakProbability,0,1) : clamp(0.35+0.65*forcingConfidence,0,1),
      capBreakReason: expectedCapBreakHourUtc == null ? 'Cap expected to persist' : `Projected profile erosion near ${formatHour(expectedCapBreakHourUtc)}`,
      projectedCapErosionJkgPerHour: physicalErosionRate,
      projectedCapRebuildingJkgPerHour: physicalRebuildingRate,
      cinSigned, cinMagnitude,
      forcingConfidence,
      releaseProbability,
      moistureDepth,
      stormCoverage,
      discreteFraction,
      linearFraction,
      conditionalTornadoIntensity: torIntensity,
      conditionalHailIntensity: hailIntensity,
      conditionalWindIntensity: windIntensity,
      initiationCorridor: corridor,
      openWarmSectorSupport: openSector,
      prefrontalSupercellSupport,
      tornadicEnvironmentSupport: tornadicEnvironment,
      projectedStormTrackSupport: clamp(Math.max(corridor, initiationProbability * (0.54 + 0.30 * effectiveInflow + 0.16 * prefrontalSupercellSupport)), 0, 1),
      surfaceHeating,
      capErosion,
      surfaceBasedTiming,
      nocturnalElevatedSupport,
      nightStability
    };
    cell.forecast.lifecycleStage = lifecycle.stage;
    // Compatibility field now explicitly means coverage expectancy.
    cell.dynamics.initiationCoverage = stormCoverage;
  });
}

function lifecycleState(world) {
  const contract = world.evolution?.config?.patternLifecycle ?? world.scenarioMetadata?.patternLifecycle ?? {};
  const elapsed = Math.max(0, Number(world.evolution?.elapsedHours) || 0);
  const delay = Math.max(0, Number(contract.initiationDelayHours) || 0);
  const transition = Math.max(delay + 0.5, Number(contract.modeTransitionHours) || 6);
  const late = Math.max(transition + 1, Number(contract.lateTransitionHours) || transition + 5);
  const releaseMultiplier = delay <= 0 ? 1 : clamp(0.08 + 0.92 * smoothstep(elapsed, delay * 0.35, delay + 1.5), 0.05, 1);
  const matureBlend = smoothstep(elapsed, Math.max(delay, transition - 1.5), transition + 1.5);
  const lateBlend = smoothstep(elapsed, late - 1.5, late + 2);
  const coverage = Array.isArray(contract.coverageEvolution) ? contract.coverageEvolution : [1, 1, .8];
  const coverageMultiplier = lerp(lerp(coverage[0] ?? 1, coverage[1] ?? 1, matureBlend), coverage[2] ?? .8, lateBlend);
  const modes = [contract.initialMode, contract.preferredMatureMode, contract.lateMode];
  const mode = lateBlend > .5 ? modes[2] : matureBlend > .5 ? modes[1] : modes[0];
  const linearMode = ['linear','QLCS','MCS','mixed'].includes(mode);
  const discreteMode = ['discrete','mixed'].includes(mode);
  return {
    stage: lateBlend > .5 ? 'late' : matureBlend > .5 ? 'mature' : elapsed < delay ? 'waiting' : 'initiating',
    releaseMultiplier,
    coverageMultiplier,
    discreteMultiplier: discreteMode ? 1.14 : linearMode ? .70 : mode === 'capped' || mode === 'stable' ? .45 : .88,
    linearMultiplier: linearMode ? 1.20 : discreteMode ? .68 : mode === 'stable' ? .40 : .92
  };
}

function estimateExpectedStormCount(world) {
  let sum = 0;
  world.forEachCell(cell => { sum += (cell.forecast?.stormCoverage ?? 0) * (cell.forecast?.initiationProbability ?? 0); });
  return Math.max(0, Math.round(sum / 22));
}

function smoothstep(value, start, end) {
  const t = clamp((value - start) / Math.max(0.001, end - start), 0, 1);
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstepHour(hour, start, end) {
  const h = ((hour % 24) + 24) % 24;
  if (h <= start) return 0;
  if (h >= end) return 1;
  const t = (h - start) / Math.max(0.001, end - start);
  return t * t * (3 - 2 * t);
}

function circularHourDistance(a, b) {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}

function formatHour(hour){
  const h=((Math.round(hour)%24)+24)%24;
  return `${String(h).padStart(2,'0')}Z`;
}

import { RISK_LABELS, RISK_ORDER } from '../scenarios/config.js?v=2.20.1';
import { clamp } from '../scenarios/math.js?v=2.20.1';

const RISK_INDEX = Object.fromEntries(RISK_ORDER.map((risk, index) => [risk, index]));

export function diagnoseCellEnvironment(cell) {
  const d = cell.derived;
  const s = cell.surface;

  const instability = ramp(d.cape, 400, 3200);
  const deepShear = ramp(d.bulkShear, 18, 62);
  const lowLevelShear = ramp(d.srh, 50, 350);
  const moisture = ramp(s.dewpoint, 50, 72);
  const capRelease = 1 - ramp(d.cin, 35, 190);
  const lclAgl = d.lclAgl ?? Math.max(0,(d.lcl ?? 1800)-(cell.terrain?.elevationM ?? 0));
  const lowCloudBase = 1 - ramp(lclAgl, 700, 2100);
  const forcing = estimateForcing(cell);
  const readiness = cell.dynamics?.convectiveReadiness ?? 0;
  const triggerStrength = cell.dynamics?.triggerStrength ?? forcing;
  const initiationPotential = cell.dynamics?.initiationPotential ?? 0;
  const initiationCoverage = cell.forecast?.stormCoverage ?? cell.dynamics?.initiationCoverage ?? 0.42;
  const convectivePotential = cell.forecast?.convectivePotential ?? readiness;
  const initiationProbability = cell.forecast?.initiationProbability ?? initiationPotential;
  const capFailureProbability = cell.forecast?.capFailureProbability ?? initiationProbability;
  const forcingConfidence = cell.forecast?.forcingConfidence ?? triggerStrength;
  const forecastDiscrete = cell.forecast?.discreteFraction ?? 0.5;
  const forecastLinear = cell.forecast?.linearFraction ?? 0.5;
  const openWarmSectorSupport = cell.forecast?.openWarmSectorSupport ?? (cell.features?.warmSector ? readiness : 0);
  const projectedStormTrackSupport = cell.forecast?.projectedStormTrackSupport ?? initiationProbability;
  const stormRealizationSupport = clamp(Math.max(
    initiationProbability,
    projectedStormTrackSupport * (0.30 + 0.70 * initiationProbability),
    openWarmSectorSupport * initiationProbability * 0.88
  ), 0, 1);

  const severeSupport = weightedMean([
    [instability, 0.27],
    [deepShear, 0.25],
    [moisture, 0.17],
    [capRelease, 0.12],
    [readiness, 0.09],
    [triggerStrength, 0.06]
  ]);

  const tornadoScore = clamp(
    0.24 * instability +
    0.25 * lowLevelShear +
    0.16 * deepShear +
    0.14 * moisture +
    0.12 * lowCloudBase +
    0.09 * capRelease,
    0,
    1.25
  );

  const hailScore = clamp(
    0.42 * instability +
    0.31 * deepShear +
    0.17 * capRelease +
    0.10 * forcing,
    0,
    1.2
  );

  const windScore = clamp(
    0.26 * instability +
    0.28 * deepShear +
    0.25 * forcing +
    0.13 * moisture +
    0.08 * capRelease,
    0,
    1.2
  );

  const discretePotential = clamp(
    0.34 * deepShear +
    0.25 * lowLevelShear +
    0.20 * capRelease +
    0.13 * lowCloudBase +
    0.08 * forcing,
    0,
    1.2
  );

  const linearPotential = clamp(
    0.39 * forcing +
    0.27 * deepShear +
    0.18 * instability +
    0.16 * moisture,
    0,
    1.2
  );

  const stormMode = classifyStormMode({ instability, deepShear, lowLevelShear, forcing, discretePotential, linearPotential, capRelease });
  const dominantHazard = greatestHazard(tornadoScore, hailScore, windScore);

  // Hazard probabilities and conditional intensity are diagnosed first.
  // The categorical outlook is then derived from the official SPC
  // probability-to-category conversion tables.
  const limitingFactors = [];
  if (d.cin > 130) limitingFactors.push('strong cap');
  if (d.bulkShear < 30) limitingFactors.push('weak deep-layer shear');
  if (d.srh < 100) limitingFactors.push('limited low-level shear');
  if (s.dewpoint < 58) limitingFactors.push('limited moisture');
  if (lclAgl > 1600) limitingFactors.push('high cloud bases');
  if (readiness < 0.38) limitingFactors.push('low convective readiness');
  if (triggerStrength < 0.32) limitingFactors.push('weak trigger');
  if (convectivePotential >= 0.45 && initiationProbability < 0.12) limitingFactors.push('conditional cap-bust risk');
  if (capFailureProbability < 0.22) limitingFactors.push('low cap-failure probability');
  if (forcingConfidence < 0.22) limitingFactors.push('low forcing confidence');
  if (initiationProbability < 0.12) limitingFactors.push('low initiation probability');

  const alignedCoverage = clamp(initiationCoverage * (0.45 + 0.55 * stormRealizationSupport), 0.04, 1.08);
  const tornadoDiagnostics = d.lcl === lclAgl ? d : { ...d, lcl: lclAgl };
  const tornadoForecast = predictTornadoRealization({ cell, d: tornadoDiagnostics, tornadoScore, stormMode, discretePotential, alignedCoverage, forecastDiscrete, readiness, triggerStrength, openWarmSectorSupport, projectedStormTrackSupport });
  const rawTornadoProb = tornadoForecast.probability;
  const tornadoTier = tornadoEnvironmentTier(tornadoDiagnostics, stormMode, discretePotential, readiness, triggerStrength, tornadoForecast);
  const tornadoProb = capTornadoProbabilityToEnvironment(rawTornadoProb, tornadoTier);
  const hailProb = hailProbability(hailScore, d, stormMode, alignedCoverage, forecastDiscrete);
  const windProb = windProbability(windScore, d, stormMode, alignedCoverage, forecastLinear);
  // Setup guidance is one estimate of conditional intensity, not a ceiling on
  // the diagnosed sounding. Retain the stronger atmosphere-derived signal.
  const rawTornadoIntensity = tornadoCig(Math.max(Number(cell.forecast?.conditionalTornadoIntensity) || 0, tornadoScore), tornadoDiagnostics, stormMode, discretePotential, tornadoTier);
  const tornadoIntensity = publishedCigForHazard('tornado', tornadoProb, rawTornadoIntensity);
  const hailIntensity = hailCig(cell.forecast?.conditionalHailIntensity ?? hailScore, d, stormMode);
  const windIntensity = windCig(cell.forecast?.conditionalWindIntensity ?? windScore, d, stormMode, linearPotential, forcing);

  // Category conversion is a pure analysis of the finalized probability and
  // conditional-intensity products. Climatology is never enforced here.
  const hazardCategories = {
    tornado: categoryFromHazard('tornado', tornadoProb, tornadoIntensity),
    hail: categoryFromHazard('hail', hailProb, hailIntensity),
    wind: categoryFromHazard('wind', windProb, windIntensity)
  };
  const risk = highestCategory(Object.values(hazardCategories));
  cell.derived.risk = risk;

  cell.derived.hazards = {
    tornado: tornadoScore,
    hail: hailScore,
    wind: windScore,
    tornadoProbability: tornadoProb,
    hailProbability: hailProb,
    windProbability: windProb,
    tornadoCig: tornadoIntensity,
    hailCig: hailIntensity,
    windCig: windIntensity,
    categories: hazardCategories,
    dominant: dominantHazard
  };
  cell.derived.diagnostics = {
    severeSupport,
    forcing,
    convectiveReadiness: readiness,
    triggerStrength,
    initiationPotential,
    convectivePotential,
    initiationCoverage,
    initiationProbability,
    capFailureProbability,
    forcingConfidence,
    stormCoverage: initiationCoverage,
    forecastDiscrete,
    forecastLinear,
    stormMode,
    discretePotential,
    linearPotential,
    limitingFactors,
    tornadoEnvironmentTier: tornadoTier,
    rawTornadoCig: rawTornadoIntensity,
    rawTornadoProbability: rawTornadoProb,
    stormRealizationSupport,
    openWarmSectorSupport,
    projectedStormTrackSupport,
    expectedTornadicStorms: tornadoForecast.expectedTornadicStorms,
    tornadoRealizationConfidence: tornadoForecast.confidence,
    predictedTornadicModeFraction: tornadoForecast.tornadicModeFraction
  };

  return risk;
}

export function diagnoseEventRisk(world) {
  // Cell diagnostics provide continuous hazard guidance. This authoritative
  // builder is the only stage allowed to convert that guidance into the
  // categorical outlook displayed by the renderer.
  // Narrative climatology may expand probability guidance, but final categories
  // still pass ingredient calibration and spatial-coherence checks.
  applyGameplayHazardClimatology(world);
  buildHierarchicalHazardOutlooks(world);
  enforceCigCoherence(world);
  buildAuthoritativeOutlook(world);
  enforceRegionalRiskCoherence(world);

  const counts = Object.fromEntries(RISK_ORDER.map(risk => [risk, 0]));
  const total = world.width * world.height;
  const stats = {
    maxStp: 0,
    maxCape: 0,
    maxSrh: 0,
    maxShear: 0,
    maxTornado: 0,
    maxHail: 0,
    maxWind: 0,
    meanSevereSupport: 0
  };

  world.forEachCell(cell => {
    counts[cell.derived.risk]++;
    stats.maxStp = Math.max(stats.maxStp, cell.derived.stp);
    stats.maxCape = Math.max(stats.maxCape, cell.derived.cape);
    stats.maxSrh = Math.max(stats.maxSrh, cell.derived.srh);
    stats.maxShear = Math.max(stats.maxShear, cell.derived.bulkShear);
    stats.maxTornado = Math.max(stats.maxTornado, cell.derived.hazards.tornado);
    stats.maxHail = Math.max(stats.maxHail, cell.derived.hazards.hail);
    stats.maxWind = Math.max(stats.maxWind, cell.derived.hazards.wind);
    stats.meanSevereSupport += cell.derived.diagnostics.severeSupport / total;
  });

  const coverage = Object.fromEntries(RISK_ORDER.map(risk => [risk, cumulativeCoverage(counts, risk) / total]));
  const clusters = Object.fromEntries(['SLGT', 'ENH', 'MDT', 'HIGH'].map(risk => [risk, largestRiskCluster(world, risk)]));

  let overallRisk = 'TSTM';
  for (const risk of RISK_ORDER) {
    if (counts[risk] > 0 && RISK_INDEX[risk] > RISK_INDEX[overallRisk]) overallRisk = risk;
  }

  const primaryHazard = greatestHazard(stats.maxTornado, stats.maxHail, stats.maxWind);
  const reasons = buildReasons(world, overallRisk, primaryHazard, coverage, stats);
  const limitations = buildLimitations(world, overallRisk);
  const stormMode = diagnoseRegionalStormMode(world);
  const outlook = serializeOutlook(world, counts, coverage, clusters, overallRisk);
  world.outlook = outlook;
  if (world.analysis) world.analysis.outlook = outlook;

  return {
    overallRisk,
    riskLabel: RISK_LABELS[overallRisk],
    counts,
    coverage,
    clusters,
    primaryHazard,
    stormMode,
    reasons,
    limitations,
    outlook,
    ...stats
  };
}


const HAZARD_LEVELS = {
  tornado: [0, 2, 5, 10, 15, 30, 45, 60],
  hail: [0, 5, 15, 30, 45, 60],
  wind: [0, 5, 15, 30, 45, 60, 75, 90]
};

// Minimum connected areas are expressed in 10 mile × 10 mile cells. These
// thresholds suppress isolated pixels while allowing naturally shaped regional
// corridors; there is no fixed 5×5 or 25-cell footprint requirement.
const HAZARD_MINIMUM_CELLS = {
  tornado: { 2: 4, 5: 5, 10: 7, 15: 9, 30: 11, 45: 13, 60: 15 },
  hail: { 5: 4, 15: 6, 30: 8, 45: 10, 60: 12 },
  wind: { 5: 4, 15: 6, 30: 8, 45: 10, 60: 12, 75: 14, 90: 16 }
};


function applyGameplayHazardClimatology(world) {
  // Forecasts are predictive only. Scenario narrative labels never promote or
  // manufacture hazard probabilities or categorical risk areas.
  return world;
}

function hazardProbabilityCeiling(hazard, cell) {
  const d = cell.derived;
  const diagnostics = d.diagnostics ?? {};
  const mode = diagnostics.stormMode ?? '';
  const coverage = Number(diagnostics.initiationCoverage) || 0;

  if (hazard === 'tornado') {
    return capTornadoProbabilityToEnvironment(60, diagnostics.tornadoEnvironmentTier ?? 0);
  }
  if (hazard === 'hail') {
    if (d.cape < 500 || d.bulkShear < 22 || coverage < 0.12) return 5;
    if (d.cape < 1100 || d.bulkShear < 30 || !mode.includes('supercell')) return 15;
    if (d.cape < 1900 || d.bulkShear < 38) return 30;
    if (d.cape < 2700 || d.bulkShear < 46) return 45;
    return 60;
  }
  if (hazard === 'wind') {
    const forcing = Number(diagnostics.forcing) || 0;
    const linear = Number(diagnostics.linearPotential) || 0;
    if (d.cape < 350 || d.bulkShear < 18 || coverage < 0.12) return 5;
    if (d.cape < 850 || d.bulkShear < 27) return 15;
    if (d.cape < 1300 || d.bulkShear < 34 || linear < 0.42) return 30;
    if (d.cape < 1800 || d.bulkShear < 40 || forcing < 0.48) return 45;
    if (mode !== 'QLCS / linear' || linear < 0.64) return 60;
    if (d.cape < 2400 || d.bulkShear < 47 || forcing < 0.64) return 75;
    return 90;
  }
  return 0;
}

function buildHierarchicalHazardOutlooks(world) {
  for (const hazard of ['tornado', 'hail', 'wind']) {
    const levels = HAZARD_LEVELS[hazard];
    const values = new Uint8Array(world.width * world.height);
    const probabilityKey = `${hazard}Probability`;
    const ceilings = new Uint8Array(world.width * world.height);

    world.forEachCell((cell, x, y) => {
      const index = y * world.width + x;
      const ceiling = hazardProbabilityCeiling(hazard, cell);
      ceilings[index] = ceiling;
      values[index] = Math.min(nearestAllowedProbability(cell.derived.hazards?.[probabilityKey] ?? 0, levels), ceiling);
    });

    // Work from the highest tier downward. Undersized components are rounded
    // down one published probability step at a time instead of disappearing.
    for (let levelIndex = levels.length - 1; levelIndex >= 1; levelIndex--) {
      const level = levels[levelIndex];
      const lower = levels[levelIndex - 1];
      downgradeSmallProbabilityComponents(
        values,
        world.width,
        world.height,
        level,
        HAZARD_MINIMUM_CELLS[hazard][level] ?? 4,
        lower
      );
    }

    // Build complete nested probability shells. A 30% core must be surrounded
    // by 15%, then the next lower published probabilities, with no skipped tier.
    for (let levelIndex = levels.length - 1; levelIndex >= 2; levelIndex--) {
      const upper = levels[levelIndex];
      for (let lowerIndex = levelIndex - 1; lowerIndex >= 1; lowerIndex--) {
        const lower = levels[lowerIndex];
        const radius = levelIndex - lowerIndex;
        addProbabilityEnvelope(values, ceilings, world.width, world.height, upper, lower, radius);
      }
    }

    // Probability contours must be topologically nested. A closed higher-
    // probability contour cannot contain an island of lower probability.
    // Fill those enclosed depressions while preserving lower-probability areas
    // that remain connected to the outside of the contour.
    for (let levelIndex = 1; levelIndex < levels.length; levelIndex++) {
      fillEnclosedLowerAreas(values, world.width, world.height, levels[levelIndex], ceilings);
    }

    world.forEachCell((cell, x, y) => {
      const probability = values[y * world.width + x];
      const hazards = cell.derived.hazards;
      hazards[probabilityKey] = probability;
      hazards.categories[hazard] = categoryFromHazard(
        hazard,
        probability,
        hazards[`${hazard}Cig`] ?? 0
      );
      cell.derived.risk = highestCategory(Object.values(hazards.categories));
    });
  }

  world.hazardOutlooks = serializeHazardOutlooks(world);
  if (world.analysis) world.analysis.hazardOutlooks = world.hazardOutlooks;
}

function downgradeSmallProbabilityComponents(values, width, height, threshold, minimumSize, downgradeTo) {
  const visited = new Uint8Array(values.length);
  const neighbors = [[1,0],[-1,0],[0,1],[0,-1]];
  for (let sy = 0; sy < height; sy++) {
    for (let sx = 0; sx < width; sx++) {
      const start = sy * width + sx;
      if (visited[start] || values[start] < threshold) continue;
      const component = [start];
      const queue = [start];
      visited[start] = 1;
      for (let head = 0; head < queue.length; head++) {
        const index = queue[head];
        const x = index % width;
        const y = Math.floor(index / width);
        for (const [dx, dy] of neighbors) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (visited[ni] || values[ni] < threshold) continue;
          visited[ni] = 1;
          queue.push(ni);
          component.push(ni);
        }
      }
      if (component.length < minimumSize) {
        for (const index of component) values[index] = Math.min(values[index], downgradeTo);
      }
    }
  }
}

function addProbabilityEnvelope(values, ceilings, width, height, sourceThreshold, envelopeProbability, radius) {
  const source = [];
  for (let i = 0; i < values.length; i++) if (values[i] >= sourceThreshold) source.push(i);
  if (!source.length) return;
  const r2 = radius * radius;
  for (const index of source) {
    const sx = index % width;
    const sy = Math.floor(index / width);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const x = sx + dx, y = sy + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const target = y * width + x;
        values[target] = Math.min(ceilings[target], Math.max(values[target], envelopeProbability));
      }
    }
  }
}

function nearestAllowedProbability(value, levels) {
  let chosen = levels[0];
  for (const level of levels) if (value >= level) chosen = level;
  return chosen;
}

function serializeHazardOutlooks(world) {
  const result = { schemaVersion: '2.13.2', authoritative: true, validHourUtc: world.validHourUtc };
  for (const hazard of ['tornado', 'hail', 'wind']) {
    const probabilityKey = `${hazard}Probability`;
    const counts = Object.fromEntries(HAZARD_LEVELS[hazard].map(level => [level, 0]));
    const cells = [];
    world.forEachCell((cell, x, y) => {
      const probability = cell.derived.hazards[probabilityKey];
      counts[probability] = (counts[probability] ?? 0) + 1;
      cells.push({ x, y, probability, cig: cell.derived.hazards[`${hazard}Cig`] ?? 0 });
    });
    result[hazard] = { levels: [...HAZARD_LEVELS[hazard]], counts, cells };
  }
  return result;
}

function buildAuthoritativeOutlook(world) {
  const width = world.width;
  const height = world.height;
  const total = width * height;
  const ranks = new Uint8Array(total);

  // The probability × CIG matrix is authoritative. Spatial processing may
  // downgrade tiny artifacts, but it may never promote a cell above the local
  // category supported by its sounding, probability, and CIG combination.
  world.forEachCell((cell, x, y) => {
    ranks[y * width + x] = RISK_INDEX[cell.derived.risk] ?? 0;
  });

  removeSmallComponents(ranks, width, height, RISK_INDEX.HIGH, 5, RISK_INDEX.MDT);
  removeSmallComponents(ranks, width, height, RISK_INDEX.MDT, 5, RISK_INDEX.ENH);
  removeSmallComponents(ranks, width, height, RISK_INDEX.ENH, 10, RISK_INDEX.SLGT);
  removeSmallComponents(ranks, width, height, RISK_INDEX.SLGT, 8, RISK_INDEX.MRGN);

  world.forEachCell((cell, x, y) => {
    cell.derived.risk = RISK_ORDER[ranks[y * width + x]];
  });
}

function promoteGameplayClimatologyCore(world, ranks) {
  const meta = world.scenarioMetadata ?? {};
  const intensity = Number(meta.intensity) || 0;
  const seed = Number(meta.seed) || 1;
  const promoteRoll = seededUnit(seed ^ 0x85ebca6b);
  const highRoll = seededUnit(seed ^ 0xc2b2ae35);

  let requestedRank = RISK_INDEX.SLGT;
  switch (meta.narrative) {
    case 'classic_tornado_outbreak':
      if (intensity >= 0.66 && promoteRoll > 0.10) requestedRank = RISK_INDEX.MDT;
      if (intensity >= 0.80) requestedRank = RISK_INDEX.HIGH;
      break;
    case 'classic_tornado_outbreak_extreme':
      requestedRank = intensity >= 0.78 && highRoll > 0.00 ? RISK_INDEX.HIGH : RISK_INDEX.MDT;
      break;
    case 'isolated_supercells':
      if (intensity >= 0.48 && promoteRoll > 0.76) requestedRank = RISK_INDEX.ENH;
      break;
    case 'loaded_gun':
      if (intensity >= 0.50 && promoteRoll > 0.80) requestedRank = RISK_INDEX.ENH;
      break;
    case 'mixed_mode':
      if (intensity >= 0.66 && promoteRoll > 0.90) requestedRank = RISK_INDEX.MDT;
      else if (intensity >= 0.53 && promoteRoll > 0.70) requestedRank = RISK_INDEX.ENH;
      break;
    case 'giant_hail':
      if (intensity >= 0.65 && promoteRoll > 0.92) requestedRank = RISK_INDEX.MDT;
      break;
    case 'hp_supercell':
    case 'derecho':
      if (intensity >= 0.68 && promoteRoll > 0.90) requestedRank = RISK_INDEX.MDT;
      break;
  }

  if (requestedRank < RISK_INDEX.ENH) return;

  let anchorIndex = -1;
  let anchorScore = -Infinity;
  world.forEachCell((cell, x, y) => {
    const index = y * world.width + x;
    const sourceThreshold = requestedRank >= RISK_INDEX.MDT ? RISK_INDEX.ENH : RISK_INDEX.SLGT;
    if (ranks[index] < sourceThreshold) return;
    const d = cell.derived;
    const h = d.hazards ?? {};
    const score =
      (d.diagnostics?.severeSupport ?? 0) * 0.46 +
      Math.min(1.2, (d.scp ?? 0) / 20) * 0.16 +
      Math.max(h.tornado ?? 0, h.hail ?? 0, h.wind ?? 0) * 0.18 +
      Math.min(1.2, (d.bulkShear ?? 0) / 60) * 0.10;
    if (score > anchorScore) {
      anchorScore = score;
      anchorIndex = index;
    }
  });

  if (anchorIndex < 0) return;
  const ax = anchorIndex % world.width;
  const ay = Math.floor(anchorIndex / world.width);

  // Promote only cells already diagnosed in the immediately lower tier.
  // This reshapes a coherent, ingredient-supported corridor and never upgrades
  // general-thunder or marginal cells into an upper outlook category.
  const coreRadius = requestedRank === RISK_INDEX.HIGH ? 3 : 2;
  const sourceThreshold = requestedRank >= RISK_INDEX.MDT ? RISK_INDEX.ENH : RISK_INDEX.SLGT;
  for (let dy = -coreRadius; dy <= coreRadius; dy++) {
    for (let dx = -coreRadius; dx <= coreRadius; dx++) {
      if (dx * dx + dy * dy > coreRadius * coreRadius) continue;
      const x = ax + dx, y = ay + dy;
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
      const index = y * world.width + x;
      if (ranks[index] >= sourceThreshold) ranks[index] = Math.max(ranks[index], requestedRank === RISK_INDEX.ENH ? RISK_INDEX.ENH : RISK_INDEX.MDT);
    }
  }

  if (requestedRank === RISK_INDEX.HIGH) {
    const highRadius = 1;
    for (let dy = -highRadius; dy <= highRadius; dy++) {
      for (let dx = -highRadius; dx <= highRadius; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > 1) continue;
        const x = ax + dx, y = ay + dy;
        if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
        const index = y * world.width + x;
        if (ranks[index] >= RISK_INDEX.MDT) ranks[index] = RISK_INDEX.HIGH;
      }
    }
  }
}

function applyNarrativeCeiling(world, ranks) {
  const meta = world.scenarioMetadata ?? {};
  const intensity = Number(meta.intensity) || 0;
  const roll = seededUnit((Number(meta.seed) || 1) ^ 0x9e3779b9);
  const highRoll = seededUnit((Number(meta.seed) || 1) ^ 0xc2b2ae35);
  let ceiling = RISK_INDEX.ENH;

  switch (meta.narrative) {
    case 'isolated_supercells':
    case 'loaded_gun':
      ceiling = intensity >= 0.52 && roll > 0.64 ? RISK_INDEX.MDT : RISK_INDEX.ENH;
      break;
    case 'giant_hail':
      ceiling = intensity >= 0.53 && roll > 0.50 ? RISK_INDEX.MDT : RISK_INDEX.ENH;
      break;
    case 'mixed_mode':
      ceiling = intensity >= 0.55 && roll > 0.44 ? RISK_INDEX.MDT : RISK_INDEX.ENH;
      break;
    case 'hp_supercell':
    case 'derecho':
      ceiling = intensity >= 0.57 && roll > 0.36 ? RISK_INDEX.MDT : RISK_INDEX.ENH;
      break;
    case 'classic_tornado_outbreak':
      ceiling = intensity >= 0.80 ? RISK_INDEX.HIGH : RISK_INDEX.MDT;
      break;
    case 'classic_tornado_outbreak_extreme':
      ceiling = intensity >= 0.78 && highRoll > 0.00 ? RISK_INDEX.HIGH : RISK_INDEX.MDT;
      break;
    default:
      ceiling = RISK_INDEX.ENH;
  }

  for (let i = 0; i < ranks.length; i++) ranks[i] = Math.min(ranks[i], ceiling);
}

function removeSmallComponents(ranks, width, height, threshold, minimumSize, downgradeTo) {
  const visited = new Uint8Array(ranks.length);
  const neighbors = [[1,0],[-1,0],[0,1],[0,-1]];
  for (let sy = 0; sy < height; sy++) {
    for (let sx = 0; sx < width; sx++) {
      const start = sy * width + sx;
      if (visited[start] || ranks[start] < threshold) continue;
      const component = [start];
      const queue = [start];
      visited[start] = 1;
      for (let head = 0; head < queue.length; head++) {
        const index = queue[head];
        const x = index % width;
        const y = Math.floor(index / width);
        for (const [dx, dy] of neighbors) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (visited[ni] || ranks[ni] < threshold) continue;
          visited[ni] = 1;
          queue.push(ni);
          component.push(ni);
        }
      }
      if (component.length < minimumSize) {
        for (const index of component) ranks[index] = Math.min(ranks[index], downgradeTo);
      }
    }
  }
}

function addEnvelope(ranks, width, height, sourceThreshold, envelopeRank, radius) {
  const source = [];
  for (let i = 0; i < ranks.length; i++) if (ranks[i] >= sourceThreshold) source.push(i);
  if (!source.length) return;
  const r2 = radius * radius;
  for (const index of source) {
    const sx = index % width;
    const sy = Math.floor(index / width);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const x = sx + dx, y = sy + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const target = y * width + x;
        ranks[target] = Math.max(ranks[target], envelopeRank);
      }
    }
  }
}

export function fillEnclosedLowerAreas(values, width, height, threshold, ceilings = null) {
  if (!values || width <= 0 || height <= 0 || threshold <= 0) return values;

  const outside = new Uint8Array(values.length);
  const queue = [];

  const enqueueIfLower = (x, y) => {
    const index = y * width + x;
    if (outside[index] || values[index] >= threshold) return;
    outside[index] = 1;
    queue.push(index);
  };

  for (let x = 0; x < width; x++) {
    enqueueIfLower(x, 0);
    if (height > 1) enqueueIfLower(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueueIfLower(0, y);
    if (width > 1) enqueueIfLower(width - 1, y);
  }

  const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    const x = index % width;
    const y = Math.floor(index / width);
    for (const [dx, dy] of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      enqueueIfLower(nx, ny);
    }
  }

  for (let index = 0; index < values.length; index++) {
    if (values[index] < threshold && !outside[index]) {
      const ceiling = ceilings ? ceilings[index] : threshold;
      values[index] = Math.min(threshold, ceiling);
    }
  }
  return values;
}

function serializeOutlook(world, counts, coverage, clusters, overallRisk) {
  const cells = [];
  world.forEachCell((cell, x, y) => cells.push({ x, y, category: cell.derived.risk }));
  return {
    schemaVersion: '2.13.2',
    validHourUtc: world.validHourUtc,
    authoritative: true,
    overallRisk,
    counts: { ...counts },
    coverage: { ...coverage },
    clusters: { ...clusters },
    categories: [...RISK_ORDER],
    cells
  };
}

function seededUnit(seed) {
  let value = seed >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 4294967296;
}

function estimateForcing(cell) {
  if (Number.isFinite(cell.dynamics?.forcingScore)) return clamp(cell.dynamics.forcingScore, 0, 1);
  let forcing = 0.18;
  if (cell.features.front === 'cold') forcing += 0.32;
  if (cell.features.front === 'warm') forcing += 0.24;
  if (cell.features.dryline) forcing += 0.30;
  if (cell.features.shortwaveTrough) forcing += 0.20;
  if (cell.features.upperTrough) forcing += 0.10;
  if (cell.features.leeTrough) forcing += 0.12;
  if (cell.features.jetStreak) forcing += 0.08;
  if (cell.features.warmSector) forcing += 0.08;
  forcing += ramp(cell.levels[500].windSpeed, 35, 85) * 0.16;
  forcing += ramp(1015 - (cell.surface.seaLevelPressure ?? cell.surface.pressure), 4, 22) * 0.12;
  return clamp(forcing, 0, 1.15);
}

function classifyStormMode(v) {
  if (v.instability < 0.25 || v.capRelease < 0.18) return 'disorganized';
  if (v.deepShear < 0.30) return 'pulse';
  if (v.linearPotential >= 0.77 && v.linearPotential > v.discretePotential + 0.12) return 'QLCS / linear';
  if (v.discretePotential >= 0.78 && v.lowLevelShear >= 0.62) return 'tornadic supercells';
  if (v.discretePotential >= 0.62) return 'supercells';
  if (v.deepShear >= 0.48) return 'organized multicells';
  return 'multicells';
}

function diagnoseRegionalStormMode(world) {
  const weights = new Map();
  world.forEachCell(cell => {
    if (RISK_INDEX[cell.derived.risk] < RISK_INDEX.ENH) return;
    const mode = cell.derived.diagnostics.stormMode;
    const weight = 1 + RISK_INDEX[cell.derived.risk];
    weights.set(mode, (weights.get(mode) ?? 0) + weight);
  });
  if (!weights.size) return 'isolated thunderstorms';
  return [...weights.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function buildReasons(world, risk, primaryHazard, coverage, stats) {
  const cells = selectRepresentativeCells(world, risk);
  const max = key => Math.max(...cells.map(cell => cell.derived[key] ?? 0));
  const min = key => Math.min(...cells.map(cell => cell.derived[key] ?? Infinity));
  const reasons = [];

  if (max('cape') >= 2500) reasons.push(`strong instability peaking near ${Math.round(max('cape') / 100) * 100} J/kg`);
  else if (max('cape') >= 1000) reasons.push(`moderate instability peaking near ${Math.round(max('cape') / 100) * 100} J/kg`);

  if (max('bulkShear') >= 50) reasons.push(`${Math.round(max('bulkShear'))} kt deep-layer shear supporting organized storms`);
  if (max('srh') >= 200) reasons.push(`${Math.round(max('srh'))} m²/s² low-level SRH`);
  if (min('lcl') <= 1200 && primaryHazard === 'tornado') reasons.push('low cloud bases in the primary warm-sector corridor');
  if (coverage.ENH >= 0.05) reasons.push('a coherent corridor of enhanced-or-greater environments');
  if (stats.maxStp >= 4) reasons.push(`STP locally near ${stats.maxStp.toFixed(1)}`);
  return reasons.slice(0, 4);
}

function buildLimitations(world, risk) {
  const threshold = Math.max(1, RISK_INDEX[risk] - 1);
  const counts = new Map();
  world.forEachCell(cell => {
    if (RISK_INDEX[cell.derived.risk] < threshold) return;
    for (const limitation of cell.derived.diagnostics.limitingFactors) {
      counts.set(limitation, (counts.get(limitation) ?? 0) + 1);
    }
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);
}

function selectRepresentativeCells(world, risk) {
  const threshold = Math.max(0, RISK_INDEX[risk] - 1);
  const cells = [];
  world.forEachCell(cell => {
    if (RISK_INDEX[cell.derived.risk] >= threshold) cells.push(cell);
  });
  if (cells.length) return cells;
  world.forEachCell(cell => cells.push(cell));
  return cells;
}

function largestRiskCluster(world, minimumRisk) {
  const threshold = RISK_INDEX[minimumRisk];
  const visited = new Set();
  let largest = 0;

  world.forEachCell((cell, x, y) => {
    const key = `${x},${y}`;
    if (visited.has(key) || RISK_INDEX[cell.derived.risk] < threshold) return;
    let size = 0;
    const queue = [[x, y]];
    visited.add(key);
    while (queue.length) {
      const [cx, cy] = queue.shift();
      size++;
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
        const neighbor = world.getCell(nx, ny);
        const nkey = `${nx},${ny}`;
        if (!neighbor || visited.has(nkey) || RISK_INDEX[neighbor.derived.risk] < threshold) continue;
        visited.add(nkey);
        queue.push([nx, ny]);
      }
    }
    largest = Math.max(largest, size);
  });

  return largest;
}

function cumulativeCoverage(counts, minimumRisk) {
  const start = RISK_INDEX[minimumRisk];
  return RISK_ORDER.slice(start).reduce((sum, risk) => sum + counts[risk], 0);
}

function greatestHazard(tornado, hail, wind) {
  if (tornado >= hail && tornado >= wind) return 'tornado';
  if (hail >= wind) return 'hail';
  return 'wind';
}

function weightedMean(values) {
  const totalWeight = values.reduce((sum, [, weight]) => sum + weight, 0);
  return values.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight;
}

function ramp(value, low, high) {
  return clamp((value - low) / (high - low), 0, 1);
}


function coverageProbability(coverage, hazardFraction, environmentFloor = 0) {
  // Convert expected hazard-producing storm opportunities into the chance of
  // at least one occurrence. A simple product was systematically keeping hail
  // and wind below their first 5% contour even in strongly supportive
  // environments with sparse but nonzero storm coverage.
  const c = clamp(Number(coverage) || 0, 0, 1.2);
  const f = clamp(Number(hazardFraction) || 0, 0, 1.2);
  const lambda = clamp(c * (0.70 + 2.35 * f) + Math.max(0, Number(environmentFloor) || 0), 0, 4.5);
  return clamp(1 - Math.exp(-lambda), 0, 1.2);
}

function predictTornadoRealization({ cell, d, tornadoScore, stormMode, discretePotential, alignedCoverage, forecastDiscrete, readiness, triggerStrength, openWarmSectorSupport, projectedStormTrackSupport }) {
  const lcl = Number(d.lcl) || 9999;
  const ingredient = clamp(
    ramp(d.stp, 0.4, 6) * 0.24 + ramp(d.srh, 90, 350) * 0.18 +
    ramp(d.bulkShear, 30, 58) * 0.12 + ramp(d.cape, 650, 3000) * 0.10 +
    (1 - ramp(lcl, 850, 2000)) * 0.11 + tornadoScore * 0.10 +
    clamp(openWarmSectorSupport,0,1) * 0.07 + clamp(projectedStormTrackSupport,0,1) * 0.08, 0, 1.2);
  const modeFraction = clamp(forecastDiscrete * 0.52 + discretePotential * 0.30 +
    (stormMode.includes('supercell') ? 0.18 : stormMode === 'QLCS / linear' ? -0.12 : 0), 0.05, 1);
  const initiation = clamp(alignedCoverage * 0.55 + readiness * 0.20 + triggerStrength * 0.15 +
    clamp(projectedStormTrackSupport,0,1) * 0.10, 0, 1.15);
  const interactionSurvival = clamp(0.30 + modeFraction * 0.38 + clamp(openWarmSectorSupport,0,1) * 0.18 +
    (1 - ramp(triggerStrength, 0.72, 1.0)) * 0.14, 0.15, 1);
  const expectedTornadicStorms = clamp(initiation * modeFraction * interactionSurvival * ingredient * 7.6, 0, 7.5);
  const occurrence = 1 - Math.exp(-expectedTornadicStorms);
  const probability = discreteProbability(occurrence, [
    [0.04,0],[0.10,2],[0.22,5],[0.38,10],[0.55,15],[0.73,30],[0.88,45],[0.96,60]
  ]);
  return { probability, expectedTornadicStorms, confidence: clamp(initiation * 0.55 + ingredient * 0.45,0,1), tornadicModeFraction: modeFraction };
}

function hailProbability(score, d, stormMode, stormCoverage, discreteFraction) {
  let producingFraction = clamp((score - 0.20) / 0.68, 0, 1.05);
  producingFraction *= clamp(0.45 + 0.55 * discreteFraction, 0.3, 1);
  if (stormMode.includes('supercell')) producingFraction += 0.07;
  const occurrence = coverageProbability(stormCoverage, producingFraction);
  return discreteProbability(occurrence, [
    [0.06, 0], [0.13, 5], [0.26, 15], [0.46, 30],
    [0.68, 45], [0.90, 60]
  ]);
}

function windProbability(score, d, stormMode, stormCoverage, linearFraction) {
  let producingFraction = clamp((score - 0.18) / 0.66, 0, 1.1);
  producingFraction *= clamp(0.42 + 0.58 * linearFraction, 0.3, 1);
  if (stormMode === 'QLCS / linear') producingFraction += 0.10;
  const occurrence = coverageProbability(stormCoverage, producingFraction);
  return discreteProbability(occurrence, [
    [0.04, 0], [0.08, 5], [0.25, 15], [0.43, 30],
    [0.60, 45], [0.76, 60], [0.91, 75], [1.05, 90]
  ]);
}

function tornadoEnvironmentTier(d, stormMode, discretePotential, readiness, triggerStrength, forecast = {}) {
  const cin = Number(d.cin) || 0;
  const cape = Number(d.cape) || 0;
  const srh = Number(d.srh) || 0;
  const shear = Number(d.bulkShear) || 0;
  const lcl = Number(d.lcl) || 9999;
  const discrete = stormMode.includes('supercell') || stormMode === 'tornadic supercells';

  if (forecast.expectedTornadicStorms >= 1.8 && cape >= 1200 && srh >= 210 && shear >= 40 && lcl <= 1450 && cin <= 125 && discretePotential >= 0.60 && readiness >= 0.42 && triggerStrength >= 0.34) return 3;
  if (forecast.expectedTornadicStorms >= 0.75 && cape >= 850 && srh >= 140 && shear >= 35 && lcl <= 1650 && cin <= 150 && discrete && discretePotential >= 0.46 && readiness >= 0.34) return 2;
  if (srh >= 100 && shear >= 32 && cape >= 650 && lcl <= 1850 && cin <= 165 && discretePotential >= 0.38) return 1;
  return 0;
}

function capTornadoProbabilityToEnvironment(probability, tier) {
  // A local sounding is a hard plausibility check. Broad neighborhood smoothing
  // may expand a corridor, but it cannot manufacture a 15%+ tornado area over
  // cells that only support a marginal tornado environment.
  const maximum = tier >= 3 ? 60 : tier === 2 ? 30 : tier === 1 ? 10 : 2;
  return Math.min(probability, maximum);
}

function tornadoCig(intensity, d, stormMode, discretePotential, environmentTier) {
  // Conditional intensity is diagnosed independently from occurrence
  // probability. Probability and CIG are combined only by CATEGORY_TABLES.
  // A low-probability corridor may therefore still carry a conditional
  // intensity designation when the rare storm that forms could be strong.
  const discrete = stormMode.includes('supercell') || stormMode === 'tornadic supercells';
  if (environmentTier < 1 || intensity < 0.58 || !discrete || discretePotential < 0.42) return 0;

  let cig = 1;
  const synoptic = synopticHazardSupport(d);
  if (environmentTier >= 2 && intensity >= 0.76 && d.srh >= 165 && d.bulkShear >= 37 && d.lcl <= 1550 && d.cape >= 1000 && discretePotential >= 0.56 && (synoptic >= 0.34 || (d.stp ?? 0) >= 2.5)) cig = 2;
  if (environmentTier >= 3 && intensity >= 0.92 && d.srh >= 275 && d.bulkShear >= 45 && d.lcl <= 1200 && d.cape >= 2100 && discretePotential >= 0.72 && (synoptic >= 0.60 || (d.stp ?? 0) >= 5)) cig = 3;
  return cig;
}

function hailCig(intensity, d, stormMode) {
  const supercellular = stormMode.includes('supercell');
  const lapse = Number(d.midLevelLapseRate ?? d.lapseRate700500 ?? 0);
  const freezing = Number(d.freezingLevelM ?? d.freezingLevel ?? 3200);
  const synoptic = synopticHazardSupport(d);
  if (intensity < 0.56 || d.cape < 1200 || d.bulkShear < 32 || !supercellular || lapse < 6.7) return 0;
  let cig = 1;
  if (intensity >= 0.82 && d.cape >= 2200 && d.bulkShear >= 43 && lapse >= 7.1 && freezing <= 4100 && (synoptic >= 0.28 || (d.scp ?? 0) >= 4)) cig = 2;
  return cig;
}

function windCig(intensity, d, stormMode, linearPotential, forcing) {
  const dcape = Number(d.dcape) || 0;
  const lowLevelFlow = Number(d.lowLevelJetKt ?? d.lljSpeed ?? 0);
  const synoptic = synopticHazardSupport(d);
  const organized = stormMode === 'QLCS / linear' || stormMode.includes('multicell');
  if (intensity < 0.55 || d.bulkShear < 28 || d.cape < 650 || linearPotential < 0.40 || !organized) return 0;
  let cig = 1;
  if (intensity >= 0.76 && linearPotential >= 0.62 && d.cape >= 1300 && forcing >= 0.46 && (dcape >= 650 || lowLevelFlow >= 35)) cig = 2;
  if (intensity >= 0.94 && linearPotential >= 0.82 && forcing >= 0.68 && d.cape >= 2100 && d.bulkShear >= 45 && synoptic >= 0.70 && (dcape >= 1000 || lowLevelFlow >= 50)) cig = 3;
  return cig;
}

function synopticHazardSupport(d) {
  const diagnostics = d.diagnostics ?? {};
  return clamp(weightedMean([
    [Number(diagnostics.forcing) || 0, 0.30],
    [Number(diagnostics.triggerStrength) || 0, 0.20],
    [Number(diagnostics.convectiveReadiness) || 0, 0.16],
    [Number(d.synopticAscent ?? diagnostics.synopticAscent) || 0, 0.18],
    [Number(d.synopticCoherence ?? diagnostics.synopticCoherence) || 0, 0.16]
  ]), 0, 1);
}



function enforceCigCoherence(world) {
  // CIG is conditional intensity guidance, not a second occurrence forecast.
  // Keep it independent, but constrain combinations that the operational
  // probability × CIG matrices mark as unused and suppress tiny extreme cores.
  const probabilityKeys = { tornado: 'tornadoProbability', wind: 'windProbability', hail: 'hailProbability' };
  const minimumExtremeProbability = { tornado: 30, wind: 45, hail: Infinity };

  for (const hazard of ['tornado', 'hail', 'wind']) {
    const cigKey = `${hazard}Cig`;
    const probabilityKey = probabilityKeys[hazard];
    const maximum = hazard === 'hail' ? 2 : 3;
    const activeByTier = [new Set(), new Set(), new Set(), new Set()];

    world.forEachCell((cell, x, y) => {
      const h = cell.derived.hazards;
      const probability = Number(h[probabilityKey]) || 0;
      let cig = Math.max(0, Math.min(maximum, Math.round(h[cigKey] ?? 0)));

      // Published CIG must be a valid probability/CIG pairing. Raw conditional
      // intensity remains available in diagnostics, but the public product may
      // not show tornado CIG2 at 2/5 percent or any other unused matrix pair.
      cig = publishedCigForHazard(hazard, probability, cig);
      if (cig >= 3 && probability < minimumExtremeProbability[hazard]) cig = 2;

      // At 10%+ tornado probability, significant intensity guidance is common
      // when the ingredients actually support EF2+ potential. Do not force a
      // hatch from probability alone; require the underlying environment.
      if (hazard === 'tornado' && probability >= 10 && cig === 0) {
        const d = cell.derived;
        const diag = d.diagnostics ?? {};
        const discrete = String(diag.stormMode ?? '').includes('supercell');
        if (discrete && d.cape >= 900 && d.srh >= 150 && d.bulkShear >= 35 && (d.lclAgl ?? d.lcl) <= 1600 && (d.cin ?? 0) <= 150) cig = 1;
      }

      h[cigKey] = cig;
      if (cig > 0) activeByTier[cig].add(`${x},${y}`);
    });

    // Higher CIG levels require broader spatial confidence than CIG1.
    for (let tier = maximum; tier >= 1; tier--) {
      const active = activeByTier[tier];
      const minimumSize = tier === 3 ? 5 : tier === 2 ? 3 : 2;
      const visited = new Set();
      for (const key of active) {
        if (visited.has(key)) continue;
        const component = [];
        const queue = [key];
        visited.add(key);
        while (queue.length) {
          const current = queue.shift(); component.push(current);
          const [x, y] = current.split(',').map(Number);
          for (const [nx, ny] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]) {
            const next = `${nx},${ny}`;
            if (active.has(next) && !visited.has(next)) { visited.add(next); queue.push(next); }
          }
        }
        if (component.length < minimumSize) for (const item of component) {
          const [x,y] = item.split(',').map(Number);
          const h = world.getCell(x,y).derived.hazards;
          h[cigKey] = Math.min(h[cigKey], tier - 1);
        }
      }
    }
  }

  // CIG changes must immediately flow back into the hazard categories and the
  // day-level categorical outlook.
  world.forEachCell(cell => {
    const h = cell.derived.hazards;
    for (const hazard of ['tornado', 'hail', 'wind']) {
      h.categories[hazard] = categoryFromHazard(hazard, h[`${hazard}Probability`], h[`${hazard}Cig`]);
    }
    cell.derived.risk = highestCategory(Object.values(h.categories));
  });
}

function calibrateHazardCategory(hazard, category, probability, cig, d, stormMode, forcing) {
  if (category === 'HIGH') {
    const highSupported = hazard === 'tornado'
      ? probability >= 30 && cig >= 2 && (stormMode === 'tornadic supercells' || stormMode === 'supercells') && d.cape >= 1350 && d.srh >= 205 && d.bulkShear >= 41 && d.lcl <= 1450 && d.cin <= 130
      : hazard === 'wind'
        ? probability >= 60 && cig >= 2 && stormMode === 'QLCS / linear' && d.cape >= 1650 && d.bulkShear >= 43 && forcing >= 0.61 && d.cin <= 140
        : false;
    if (!highSupported) category = 'MDT';
  }

  if (category === 'MDT') {
    const moderateSupported = hazard === 'tornado'
      ? probability >= 15 && d.cape >= 1400 && d.srh >= 150 && d.bulkShear >= 38 && d.lcl <= 1500
      : hazard === 'wind'
        ? probability >= 45 && d.cape >= 1400 && d.bulkShear >= 42 && forcing >= 0.58
        : probability >= 45 && d.cape >= 2300 && d.bulkShear >= 45;
    if (!moderateSupported) category = 'ENH';
  }

  return category;
}


function promoteModerateCorridors(world) {
  const candidates = [];
  world.forEachCell((cell, x, y) => {
    if (cell.derived.risk !== 'ENH') return;
    const d = cell.derived;
    const h = d.hazards;
    const forcing = d.diagnostics?.forcing ?? 0;
    const tornadoSupported = h.tornadoProbability >= 10 && d.cape >= 900 && d.srh >= 150 && d.bulkShear >= 38 && d.lcl <= 1750 && d.cin <= 145;
    const windSupported = h.windProbability >= 30 && d.cape >= 1250 && d.bulkShear >= 40 && forcing >= 0.50 && d.cin <= 145;
    const hailSupported = h.hailProbability >= 30 && d.cape >= 1600 && d.bulkShear >= 42 && d.cin <= 140;
    if (tornadoSupported || windSupported || hailSupported) candidates.push([x, y]);
  });

  const candidateSet = new Set(candidates.map(([x, y]) => `${x},${y}`));
  const visited = new Set();
  const qualifying = new Set();
  for (const [sx, sy] of candidates) {
    const startKey = `${sx},${sy}`;
    if (visited.has(startKey)) continue;
    const component = [];
    const queue = [[sx, sy]];
    visited.add(startKey);
    while (queue.length) {
      const [x, y] = queue.shift();
      component.push([x, y]);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const key = `${nx},${ny}`;
        if (!candidateSet.has(key) || visited.has(key)) continue;
        visited.add(key);
        queue.push([nx, ny]);
      }
    }
    if (component.length >= 6) {
      for (const [x, y] of component) qualifying.add(`${x},${y}`);
    }
  }

  if (!qualifying.size) return;
  world.forEachCell((cell, x, y) => {
    if (!qualifying.has(`${x},${y}`)) return;
    cell.derived.risk = 'MDT';
    const categories = cell.derived.hazards?.categories;
    if (!categories) return;
    const h = cell.derived.hazards;
    if (h.tornadoProbability >= 10) categories.tornado = 'MDT';
    else if (h.windProbability >= 30) categories.wind = 'MDT';
    else if (h.hailProbability >= 30) categories.hail = 'MDT';
  });
}

function enforceRegionalRiskCoherence(world) {
  const total = world.width * world.height;
  const highCluster = largestRiskCluster(world, 'HIGH');
  let highCount = 0;
  let moderateCount = 0;
  world.forEachCell(cell => {
    if (cell.derived.risk === 'HIGH') highCount++;
    if (RISK_INDEX[cell.derived.risk] >= RISK_INDEX.MDT) moderateCount++;
  });

  // A High risk must represent a coherent corridor, not one or two extreme
  // grid cells. At 10-mile spacing, 12 cells represent roughly 1,200 km².
  const coherentHigh = highCluster >= 5 && highCount / total >= 0.0012 && moderateCount >= 13;
  if (!coherentHigh) {
    world.forEachCell(cell => {
      if (cell.derived.risk === 'HIGH') cell.derived.risk = 'MDT';
      const categories = cell.derived.hazards?.categories;
      if (categories) {
        for (const key of Object.keys(categories)) {
          if (categories[key] === 'HIGH') categories[key] = 'MDT';
        }
      }
    });
  }
}

const CATEGORY_TABLES = {
  tornado: {
    2:  ['MRGN', 'MRGN', null, null],
    5:  ['SLGT', 'SLGT', null, null],
    10: ['SLGT', 'ENH', 'ENH', 'ENH'],
    15: ['ENH', 'ENH', 'MDT', 'MDT'],
    30: ['ENH', 'MDT', 'HIGH', 'HIGH'],
    45: ['ENH', 'MDT', 'HIGH', 'HIGH'],
    60: ['ENH', 'HIGH', 'HIGH', 'HIGH']
  },
  wind: {
    5:  ['MRGN', 'MRGN', 'SLGT', null],
    15: ['SLGT', 'SLGT', 'ENH', null],
    30: ['SLGT', 'ENH', 'ENH', null],
    45: ['ENH', 'ENH', 'MDT', 'HIGH'],
    60: ['ENH', 'MDT', 'HIGH', 'HIGH'],
    75: ['ENH', 'MDT', 'HIGH', 'HIGH'],
    90: ['ENH', 'MDT', 'HIGH', 'HIGH']
  },
  hail: {
    5:  ['MRGN', 'MRGN', 'SLGT'],
    15: ['SLGT', 'SLGT', 'ENH'],
    30: ['SLGT', 'ENH', 'ENH'],
    45: ['ENH', 'ENH', 'MDT'],
    60: ['ENH', 'MDT', 'MDT']
  }
};


const DAY3_TOTAL_SEVERE_TABLE = {
  5:  ['MRGN', 'MRGN', 'SLGT'],
  15: ['SLGT', 'SLGT', 'ENH'],
  30: ['SLGT', 'ENH', 'ENH'],
  45: ['ENH', 'ENH', 'MDT'],
  60: ['ENH', 'MDT', 'MDT']
};

export function categoryFromDay3TotalSevere(probability, cig = 0) {
  if (probability <= 0) return 'TSTM';
  const levels = [5, 15, 30, 45, 60];
  let selected = 0;
  for (const level of levels) if (probability >= level) selected = level;
  if (!selected) return 'TSTM';
  const row = DAY3_TOTAL_SEVERE_TABLE[selected];
  const safeCig = Math.max(0, Math.min(2, Math.round(cig)));
  return row[safeCig] ?? row[0];
}

export function maximumPublishedCig(hazard, probability) {
  const p = Number(probability) || 0;
  if (p <= 0) return 0;
  if (hazard === 'tornado') {
    if (p <= 5) return 1;
    if (p <= 10) return 2;
    return 3;
  }
  if (hazard === 'hail') return 2;
  if (hazard === 'wind') {
    if (p < 45) return 2;
    return 3;
  }
  return 0;
}

export function publishedCigForHazard(hazard, probability, rawCig) {
  return Math.max(0, Math.min(Math.round(Number(rawCig) || 0), maximumPublishedCig(hazard, probability)));
}

export function categoryFromHazard(hazard, probability, cig) {
  if (probability <= 0) return 'TSTM';
  const table = CATEGORY_TABLES[hazard];
  const row = table[probability];
  if (!row) return 'TSTM';
  const safeCig = Math.max(0, Math.min(publishedCigForHazard(hazard, probability, cig), row.length - 1));
  // A few probability/CIG combinations are operationally "not used".
  // Fall back to the nearest valid lower-intensity column.
  for (let index = safeCig; index >= 0; index--) {
    if (row[index]) return row[index];
  }
  return 'TSTM';
}

function highestCategory(categories) {
  return categories.reduce((highest, category) =>
    RISK_INDEX[category] > RISK_INDEX[highest] ? category : highest,
  'TSTM');
}

function discreteProbability(value, thresholds) {
  let probability = 0;
  for (const [threshold, candidate] of thresholds) {
    if (value >= threshold) probability = candidate;
  }
  return probability;
}

const HAZARDS = ['tornado', 'hail', 'wind'];
const TIERS = {
  tornado: [0, 2, 5, 10, 15, 30, 45, 60],
  hail: [0, 5, 15, 30, 45, 60, 75, 90],
  wind: [0, 5, 15, 30, 45, 60, 75, 90]
};

export function applyForecastConfidence(grid, width, height, memberProducts, {
  key = 'day1', synoptic = null, calibration = null
} = {}) {
  const synopticConfidence = diagnoseSynopticConfidence(synoptic, grid);
  const mesoscaleConfidence = diagnoseMesoscaleConfidence(grid);
  const leadConfidence = key === 'day1' ? 1 : key === 'day2' ? 0.84 : 0.68;
  const analogConfidence = inferGridConfidence(grid, 'analogScenarioSupport.confidenceFactor', 1);
  const stormSummaries = buildStormConfidence(memberProducts, synopticConfidence, mesoscaleConfidence, leadConfidence);
  const diagnostics = {};

  for (const hazard of HAZARDS) {
    let sum = 0, issued = 0, highTierSuppressed = 0, coreCells = 0;
    for (let i = 0; i < grid.length; i++) {
      const ensemble = grid[i].ensembleForecast?.[hazard] ?? {};
      const assimilation = grid[i].outlookAssimilation?.[hazard] ?? {};
      const occurrence = clamp(Number(ensemble.occurrenceProbability) || 0, 0, 1);
      const conditional = clamp(Number(ensemble.conditionalHazardProbability) || 0, 0, 1);
      const concentration = clamp(Number(ensemble.spatialConcentration ?? assimilation.spatialConcentration) || 0, 0, 1);
      const clusterAgreement = clamp(Number(ensemble.dominantClusterSupport ?? assimilation.clusterSupport) || 0, 0, 1);
      const memberAgreement = clamp(Number(ensemble.weightedMemberFrequency ?? assimilation.supportingMemberFraction) || 0, 0, 1);
      const trackConfidence = trackAgreementAtCell(memberProducts, i, hazard, width);
      const timingConfidence = timingAgreement(memberProducts);
      const maintenanceConfidence = maintenanceAgreement(memberProducts, hazard);
      const hazardConfidence = hazardSpecificConfidence(hazard, conditional, trackConfidence, maintenanceConfidence, grid[i]);
      const corridorConfidence = weightedMean([
        [occurrence,0.22], [memberAgreement,0.20], [clusterAgreement,0.16],
        [concentration,0.18], [trackConfidence,0.16], [timingConfidence,0.08]
      ]);
      const reliabilityFactor = reliabilityAdjustment(calibration, hazard, Number(grid[i][`${hazard}Probability`]) || 0);
      const predictabilityGroup = weightedMean([[synopticConfidence.overall,0.38],[mesoscaleConfidence.overall,0.30],[leadConfidence,0.20],[analogConfidence,0.12]]);
      const stormGroup = weightedMean([[occurrence,0.34],[maintenanceConfidence,0.28],[trackConfidence,0.24],[timingConfidence,0.14]]);
      const hazardGroup = weightedMean([[hazardConfidence,0.46],[corridorConfidence,0.34],[memberAgreement,0.20]]);
      const overall = clamp(geometricMean([predictabilityGroup,stormGroup,hazardGroup]) * reliabilityFactor, 0, 1);

      const potential = Number(grid[i][`${hazard}Probability`]) || 0;
      let adjusted = tierAwareAdjustment(potential, overall, hazard, {memberAgreement,clusterAgreement,concentration,trackConfidence,occurrence});
      adjusted = confidenceQuantize(adjusted, hazard, {
        overall, memberAgreement, clusterAgreement, concentration, trackConfidence, occurrence
      });
      if (adjusted < potential && potential >= (hazard === 'tornado' ? 15 : 30)) highTierSuppressed++;
      grid[i][`${hazard}Probability`] = adjusted;
      grid[i].forecastConfidence ??= {};
      grid[i].forecastConfidence[hazard] = {
        potentialProbability: potential,
        initiationConfidence: occurrence,
        maintenanceConfidence,
        trackConfidence,
        timingConfidence,
        hazardConfidence,
        corridorConfidence,
        synopticConfidence: synopticConfidence.overall,
        mesoscaleConfidence: mesoscaleConfidence.overall,
        memberAgreement,
        clusterAgreement,
        spatialConcentration: concentration,
        reliabilityFactor,
        predictabilityGroup, stormGroup, hazardGroup,
        overallConfidence: overall,
        issuedProbability: adjusted
      };
      sum += overall;
      if (adjusted > 0) issued++;
      if (overall >= 0.68 && adjusted >= (hazard === 'tornado' ? 10 : 15)) coreCells++;
    }
    diagnostics[hazard] = {
      meanConfidence: sum / Math.max(1, grid.length),
      issuedCells: issued,
      confidenceCoreCells: coreCells,
      highTierSuppressedCells: highTierSuppressed
    };
  }

  return {
    version: '2.66.0',
    method: 'grouped-regional-tier-aware-confidence',
    leadConfidence,
    synopticConfidence,
    mesoscaleConfidence,
    storms: stormSummaries,
    diagnostics,
    analogConfidence,
    calibration: calibration ? 'reliability-adjusted' : 'uncalibrated-bootstrap'
  };
}

function buildStormConfidence(memberProducts, synoptic, mesoscale, lead) {
  const storms = [];
  for (const member of memberProducts) {
    for (const storm of member.projection?.candidates ?? []) {
      const states = storm.stateHistory ?? [];
      const final = storm.finalState ?? states.at(-1) ?? {};
      const initiation = clamp(Number(storm.confidence ?? final.confidence ?? 0.5), 0, 1);
      const maintenance = clamp((Number(final.organization) || 0.5) * 0.45 + (Number(final.inflowQuality) || 0.5) * 0.35 + Math.min(1, (Number(storm.lifetimeHours) || 1) / 5) * 0.2, 0, 1);
      const track = clamp(1 - ((Number(storm.corridor90RadiusCells) || 5) - 2) / 14, 0.15, 1);
      const timing = clamp(1 - Math.abs(Number(member.perturbation?.initiationFactor || 1) - 1), 0.2, 1);
      const overall = geometricMean([initiation, maintenance, track, timing, synoptic.overall, mesoscale.overall, lead]);
      storms.push({ id: `${member.index}:${storm.index}`, memberIndex: member.index, initiation, maintenance, track, timing, overall });
    }
  }
  return storms;
}

function diagnoseSynopticConfidence(synoptic, grid) {
  const rec = synoptic?.reconciliation ?? synoptic?.synopticObjects?.reconciliation ?? null;
  const improvement = clamp(Number(rec?.improvementFraction) || 0, 0, 1);
  const lowError = Number(rec?.surfaceLowFieldErrorKm ?? synoptic?.surfaceLowFieldErrorKm);
  const frontError = Number(rec?.meanFrontFieldErrorKm ?? synoptic?.meanFrontFieldErrorKm);
  const consistency = Number(synoptic?.atmosphericConsistency ?? rec?.atmosphericConsistency);
  const low = Number.isFinite(lowError) ? Math.exp(-lowError / 180) : 0.55;
  const fronts = Number.isFinite(frontError) ? Math.exp(-frontError / 150) : 0.55;
  const stateConsistency = Number.isFinite(consistency) ? clamp(consistency, 0, 1) : inferGridConfidence(grid, 'objectConfidence', 0.55);
  return { low, fronts, stateConsistency, reconciliationImprovement: improvement, overall: geometricMean([low, fronts, stateConsistency, 0.55 + 0.45 * improvement]) };
}

function diagnoseMesoscaleConfidence(grid) {
  const boundary = inferGridConfidence(grid, 'boundaryConfidence', 0.55);
  const initiation = inferGridConfidence(grid, 'peakInitiation', 0.5);
  const moisture = inferGridConfidence(grid, 'moistureQuality', inferGridConfidence(grid, 'projectedStormOccupancy', 0.5));
  const cap = 1 - inferGridConfidence(grid, 'capBreakUncertainty', 0.4);
  return { boundary, initiation, moisture, cap, overall: geometricMean([boundary, initiation, moisture, clamp(cap, 0.15, 1)]) };
}

function trackAgreementAtCell(members, index, hazard, width) {
  const centroids = [];
  for (const member of members) {
    const field = member.projection?.fields?.[hazard];
    if (!field || !field[index]) continue;
    let sx = 0, sy = 0, w = 0;
    for (let i = 0; i < field.length; i++) if (field[i] > 0) { sx += (i % width) * field[i]; sy += Math.floor(i / width) * field[i]; w += field[i]; }
    if (w) centroids.push({ x: sx / w, y: sy / w });
  }
  if (centroids.length < 2) return centroids.length ? 0.45 : 0.2;
  const mx = centroids.reduce((s, p) => s + p.x, 0) / centroids.length;
  const my = centroids.reduce((s, p) => s + p.y, 0) / centroids.length;
  const spread = centroids.reduce((s, p) => s + Math.hypot(p.x - mx, p.y - my), 0) / centroids.length;
  return clamp(Math.exp(-spread / 9), 0.1, 1);
}

function timingAgreement(members) {
  if (!members.length) return 0.3;
  const values = members.map(m => Number(m.perturbation?.initiationFactor) || 1);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return clamp(Math.exp(-Math.sqrt(variance) / 0.22), 0.15, 1);
}

function maintenanceAgreement(members, hazard) {
  const values = [];
  for (const m of members) for (const s of m.projection?.candidates ?? []) {
    const final = s.finalState ?? {};
    let v = (Number(final.organization) || 0.5) * 0.45 + (Number(final.inflowQuality) || 0.5) * 0.35 + Math.min(1, (Number(s.lifetimeHours) || 1) / 5) * 0.2;
    if (hazard === 'wind') v = (Number(final.coldPoolStrength) || 0.2) * 0.5 + v * 0.5;
    values.push(clamp(v, 0, 1));
  }
  if (!values.length) return 0.25;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function hazardSpecificConfidence(hazard, conditional, track, maintenance, cell) {
  if (hazard === 'tornado') return clamp(conditional * 0.42 + track * 0.25 + maintenance * 0.23 + (Number(cell.boundaryRelativePlacement) || 0.4) * 0.1, 0, 1);
  if (hazard === 'hail') return clamp(conditional * 0.5 + maintenance * 0.35 + track * 0.15, 0, 1);
  return clamp(conditional * 0.38 + maintenance * 0.27 + track * 0.15 + (Number(cell.activeStormSignal) || 0.3) * 0.2, 0, 1);
}

function tierAwareAdjustment(potential, confidence, hazard, c) {
  const levels = TIERS[hazard];
  const potentialTier = confidenceQuantize(potential, hazard, { ...c, overall: 1 });
  if (potentialTier <= 0) return 0;
  let downgrade = confidence >= 0.72 ? 0 : confidence >= 0.56 ? 1 : confidence >= 0.40 ? 2 : 3;
  if (c.memberAgreement >= 0.55 && c.clusterAgreement >= 0.45 && c.concentration >= 0.55) downgrade = Math.max(0, downgrade - 1);
  if (potentialTier >= (hazard === 'tornado' ? 30 : 45) && c.occurrence >= 0.58 && c.trackConfidence >= 0.50) downgrade = Math.min(downgrade, 1);
  const idx = Math.max(0, levels.indexOf(potentialTier) - downgrade);
  return levels[idx];
}

function confidenceQuantize(value, hazard, c) {
  let result = 0;
  for (const tier of TIERS[hazard]) {
    if (value < tier) continue;
    if (tier >= 15 && (c.overall < 0.55 || c.memberAgreement < 0.35 || c.trackConfidence < 0.42)) continue;
    if (tier >= 30 && (c.overall < 0.70 || c.clusterAgreement < 0.45 || c.concentration < 0.55 || c.occurrence < 0.48)) continue;
    result = tier;
  }
  return result;
}

function reliabilityAdjustment(calibration, hazard, tier) {
  const entry = calibration?.[hazard]?.[String(tier)] ?? calibration?.[hazard]?.default;
  if (!entry) return 1;
  const forecast = Number(entry.forecastFrequency);
  const observed = Number(entry.observedFrequency);
  if (!(forecast > 0) || !Number.isFinite(observed)) return 1;
  return clamp(observed / forecast, 0.55, 1.15);
}

function inferGridConfidence(grid, key, fallback) {
  let sum = 0, n = 0;
  for (const cell of grid) { const v = Number(String(key).split('.').reduce((value, part) => value?.[part], cell)); if (Number.isFinite(v)) { sum += clamp(v, 0, 1); n++; } }
  return n ? sum / n : fallback;
}
function weightedMean(entries){let s=0,w=0;for(const [v,wt] of entries){s+=clamp(Number(v)||0,0,1)*wt;w+=wt;}return w?s/w:0;}
function geometricMean(values) { const safe = values.map(v => clamp(Number(v) || 0.01, 0.01, 1)); return Math.exp(safe.reduce((s, v) => s + Math.log(v), 0) / safe.length); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

const RISK_RANK = Object.freeze({ NONE: 0, TSTM: 1, MRGN: 2, MRGL: 2, SLGT: 3, ENH: 4, MDT: 5, HIGH: 6 });

const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const mean = values => values.length ? values.reduce((a,b)=>a+b,0) / values.length : 0;
const clamp = (v,min=0,max=1)=>Math.min(max,Math.max(min,v));

function scoreRange(value, range) {
  if (!Array.isArray(range) || range.length !== 2) return { score: null, status: 'unscored', value };
  const [lo, hi] = range;
  if (value >= lo && value <= hi) {
    const midpoint = (lo + hi) / 2;
    const half = Math.max(1e-6, (hi - lo) / 2);
    const centrality = 1 - Math.min(1, Math.abs(value - midpoint) / half);
    return { score: 0.90 + 0.10 * centrality, status: 'within', value, range };
  }
  const scale = Math.max(1, Math.abs(hi-lo), Math.abs(lo)*0.25, Math.abs(hi)*0.25);
  const distance = value < lo ? lo-value : value-hi;
  return { score: clamp(1-distance/scale), status: value < lo ? 'low' : 'high', value, range };
}

function environmentSeries(report) {
  return (report.atmosphericEnvironmentSamples ?? []).map(sample => ({
    hourUtc: sample.hourUtc,
    cape: finite(sample.domainSummary?.percentile90?.cape),
    cin: finite(sample.warmSectorSummary?.mean?.cin ?? sample.domainSummary?.mean?.cin),
    shear: finite(sample.domainSummary?.percentile90?.bulkShear),
    srh: finite(sample.domainSummary?.percentile90?.srh),
    stp: finite(sample.domainSummary?.percentile90?.stp),
    forcing: finite(sample.domainSummary?.percentile90?.forcing),
    initiationProbability: finite(sample.domainSummary?.maximum?.initiationProbability),
    dewpointF: finite(sample.warmSectorSummary?.mean?.surfaceDewpointF),
    warmSectorFraction: finite(sample.warmSectorSummary?.fractionOfDomain)
  }));
}

export function critiqueVerification(report, targets = {}) {
  const series = environmentSeries(report);
  const peak = key => Math.max(0, ...series.map(x=>finite(x[key])));
  const avg = key => mean(series.map(x=>finite(x[key])));
  const first = series[0] ?? {};
  const last = series.at(-1) ?? {};
  const event = report.event ?? {};
  const scoredProducts = (report.products ?? []).filter(product => Number.isFinite(product?.spatialVerification?.summary?.spatialScore));
  const latestSpatialProduct = [...scoredProducts].sort((a,b) => Number(a.issuedHourUtc)-Number(b.issuedHourUtc)).at(-1) ?? null;
  const verifiedRisk = report.forecast?.byDay?.day1?.latest?.forecastOverallRisk;
  const issuedRisk = report.forecast?.latestIssuedByDay?.day1?.forecastOverallRisk;
  const riskLabel = verifiedRisk ?? issuedRisk ?? 'UNAVAILABLE';
  const riskVerificationStatus = verifiedRisk ? 'VERIFIED' : (issuedRisk ? 'INCOMPLETE_TRUTH_WINDOW' : 'UNAVAILABLE');
  const diagnostics = {
    peakCape: peak('cape'),
    minimumCin: Math.min(0, ...series.map(x=>finite(x.cin))),
    peakShear: peak('shear'), peakSrh: peak('srh'), peakStp: peak('stp'), peakForcing: peak('forcing'),
    peakInitiationProbability: peak('initiationProbability'),
    meanWarmSectorDewpointF: avg('dewpointF'),
    warmSectorCoverage: peak('warmSectorFraction'),
    capeChange: finite(last.cape)-finite(first.cape),
    cinChange: finite(last.cin)-finite(first.cin),
    initiations: finite(event.initiations), tornadoes: finite(event.totalTornadoes),
    riskRank: RISK_RANK[riskLabel] ?? 0, riskLabel, riskVerificationStatus,
    spatialScore: finite(latestSpatialProduct?.spatialVerification?.summary?.spatialScore, 1),
    spatialOverlapScore: finite(latestSpatialProduct?.spatialVerification?.summary?.overlapScore, 1),
    spatialDisplacementScore: finite(latestSpatialProduct?.spatialVerification?.summary?.displacementScore, 1),
    meanRiskCentroidErrorMiles: latestSpatialProduct?.spatialVerification?.summary?.meanCentroidErrorMiles ?? null,
    uniqueInitiationCorridors: finite(event.initiationCorridors?.uniqueCorridors),
    boundaryRootedInitiationFraction: finite(event.initiationCorridors?.boundaryRootedFraction),
    gridCellAreaKm2: finite(report.grid?.cellAreaKm2 ?? report.world?.cellAreaKm2, 100),
    activeInitiationCells: finite(latestSpatialProduct?.spatialVerification?.initiation?.contour?.observedCells ?? latestSpatialProduct?.initiation?.contour?.observedCells),
  };
  diagnostics.activeConvectiveAreaKm2 = diagnostics.activeInitiationCells * diagnostics.gridCellAreaKm2;
  diagnostics.stormBirthsPer10000Km2 = diagnostics.activeConvectiveAreaKm2 > 0
    ? diagnostics.initiations / diagnostics.activeConvectiveAreaKm2 * 10000
    : null;
  diagnostics.birthsPerCorridor = diagnostics.uniqueInitiationCorridors > 0
    ? diagnostics.initiations / diagnostics.uniqueInitiationCorridors
    : diagnostics.initiations;


  const warmTransitions = series.slice(1).map((row,index)=>({ from:series[index], to:row, delta:finite(row.warmSectorFraction)-finite(series[index].warmSectorFraction) }));
  const abruptWarmCollapse = warmTransitions.find(item=>item.from.warmSectorFraction > 0.35 && item.to.warmSectorFraction < 0.03 && item.to.cape > 1000);
  diagnostics.surfaceLowFieldErrorKm = event.synopticObjects?.alignment?.surfaceLowFieldErrorKm ?? null;
  const frontErrors = event.synopticObjects?.alignment?.frontsDiagnostics ?? [];
  diagnostics.meanFrontFieldErrorKm = frontErrors.length ? mean(frontErrors.map(row=>finite(row.displacementKm))) : null;
  diagnostics.meanFrontResidualErrorKm = frontErrors.length ? mean(frontErrors.map(row=>finite(row.displacementKm)-finite(row.correctionKm))) : null;
  diagnostics.atmosphericConsistency = event.synopticObjects?.atmosphericConsistency ?? null;
  diagnostics.objectConfidence = event.synopticObjects?.objectConfidence?.overall ?? null;
  diagnostics.meanConstraintCorrectionKm = mean((event.synopticObjects?.constraintCorrections ?? []).map(row=>finite(row.correctionKm)));
  diagnostics.atmosphericHealth = finite(event.synopticObjects?.kinematicDynamics?.atmosphericHealth);
  diagnostics.windBalanceError = finite(event.synopticObjects?.kinematicDynamics?.windBalanceError);
  diagnostics.massContinuityError = finite(event.synopticObjects?.kinematicDynamics?.massContinuityError);
  diagnostics.verticalMotionOverlap = finite(event.synopticObjects?.kinematicDynamics?.verticalMotionOverlap);

  const expected = targets.environment ?? {};
  const componentChecks = Object.fromEntries(Object.entries(expected).map(([key, range]) => [key, scoreRange(diagnostics[key], range)]));
  const scoredEnvironmentChecks = Object.values(componentChecks).map(x=>x.score).filter(Number.isFinite);
  const environmentScore = scoredEnvironmentChecks.length ? mean(scoredEnvironmentChecks) : null;

  const flags = [];
  if (abruptWarmCollapse) flags.push({ code:'WARM_SECTOR_DISCONTINUITY', severity:'error', details:{ fromHour:abruptWarmCollapse.from.hourUtc, toHour:abruptWarmCollapse.to.hourUtc, fromFraction:abruptWarmCollapse.from.warmSectorFraction, toFraction:abruptWarmCollapse.to.warmSectorFraction, cape:abruptWarmCollapse.to.cape } });
  if (Number.isFinite(diagnostics.meanFrontResidualErrorKm) && diagnostics.meanFrontResidualErrorKm > 140 && finite(diagnostics.atmosphericConsistency,0) < 0.72) flags.push({ code:'OBJECT_FIELD_DESYNCHRONIZATION', severity:'warning', details:{ meanFrontFieldErrorKm:diagnostics.meanFrontFieldErrorKm, meanFrontResidualErrorKm:diagnostics.meanFrontResidualErrorKm, atmosphericConsistency:diagnostics.atmosphericConsistency } });
  if (Number.isFinite(diagnostics.atmosphericConsistency) && diagnostics.atmosphericConsistency < 0.35) flags.push({ code:'LOW_ATMOSPHERIC_CONSISTENCY', severity:'error', details:{ atmosphericConsistency:diagnostics.atmosphericConsistency } });
  if (Number.isFinite(diagnostics.meanConstraintCorrectionKm) && diagnostics.meanConstraintCorrectionKm > 55) flags.push({ code:'EXCESSIVE_CONSTRAINT_CORRECTION', severity:'warning', details:{ meanConstraintCorrectionKm:diagnostics.meanConstraintCorrectionKm } });
    if (diagnostics.initiations > 0 && diagnostics.peakInitiationProbability < 0.10) flags.push({ code:'INITIATION_WITHOUT_SIGNAL', severity:'error' });
  if (diagnostics.tornadoes > 0 && diagnostics.peakStp < 0.35 && diagnostics.peakSrh < 100) flags.push({ code:'TORNADO_WITHOUT_ROTATION_SUPPORT', severity:'error' });
  if (diagnostics.riskRank >= 4 && diagnostics.peakCape < 500 && diagnostics.peakShear < 25) flags.push({ code:'HIGH_OUTLOOK_WITH_WEAK_ENVIRONMENT', severity:'error' });
  if (diagnostics.peakInitiationProbability > 0.65 && diagnostics.initiations === 0) flags.push({ code:'HIGH_CI_NO_INITIATION', severity:'warning' });
  if (diagnostics.peakStp >= 3 && diagnostics.riskRank <= 1) flags.push({ code:'HIGH_CONDITIONAL_LOW_OUTLOOK', severity:'review' });
  if (diagnostics.minimumCin <= -200 && diagnostics.initiations > 8 && diagnostics.peakForcing < 0.45) flags.push({ code:'CAP_BYPASSED_WITHOUT_FORCING', severity:'error' });
  // A 10 km × 10 km cell represents 100 km². Evaluate births against the
  // realized convective footprint and corridor reuse rather than assuming a
  // fixed low event total. Keep an absolute runaway ceiling as a safety gate.
  const densityExcess = Number.isFinite(diagnostics.stormBirthsPer10000Km2) && diagnostics.stormBirthsPer10000Km2 > 12;
  const corridorReuseExcess = diagnostics.initiations >= 12 && diagnostics.birthsPerCorridor > 4.5;
  const absoluteRunaway = diagnostics.initiations > 60;
  const legacyUnscaledExcess = !Number.isFinite(diagnostics.stormBirthsPer10000Km2) && diagnostics.initiations > 30 && corridorReuseExcess;
  if (absoluteRunaway || legacyUnscaledExcess || densityExcess && corridorReuseExcess) flags.push({ code:'EXCESSIVE_STORM_BIRTHS', severity:'error', details:{ initiations:diagnostics.initiations, stormBirthsPer10000Km2:diagnostics.stormBirthsPer10000Km2, birthsPerCorridor:diagnostics.birthsPerCorridor, activeConvectiveAreaKm2:diagnostics.activeConvectiveAreaKm2 } });
  if (diagnostics.initiations >= 6 && diagnostics.uniqueInitiationCorridors <= 1) flags.push({ code:'INITIATION_CORRIDOR_COLLAPSE', severity:'warning' });
  if (latestSpatialProduct && diagnostics.spatialOverlapScore < 0.25) flags.push({ code:'POOR_SPATIAL_OVERLAP', severity:'error' });
  if (latestSpatialProduct && Number.isFinite(diagnostics.meanRiskCentroidErrorMiles) && diagnostics.meanRiskCentroidErrorMiles > 100) flags.push({ code:'RISK_CORRIDOR_DISPLACED', severity:'warning' });

  const spatialBlame = [];
  const categorical = latestSpatialProduct?.spatialVerification?.categoricalContours ?? latestSpatialProduct?.categoricalContours ?? {};
  const contourRows = Object.entries(categorical).map(([name, metric]) => ({ name, ...metric })).filter(row => Number.isFinite(row.areaRatio));
  const broadest = contourRows.sort((a,b)=>(b.areaRatio??0)-(a.areaRatio??0))[0];
  if (broadest?.areaRatio > 3) spatialBlame.push({ code:'RISK_FOOTPRINT_TOO_BROAD', contour:broadest.name, areaRatio:broadest.areaRatio });
  const initiationMetric = latestSpatialProduct?.spatialVerification?.initiation?.contour ?? latestSpatialProduct?.initiation?.contour;
  if (initiationMetric?.centroidErrorMiles > 75) spatialBlame.push({ code:'INITIATION_CORRIDOR_DISPLACED', miles:initiationMetric.centroidErrorMiles });
  if (spatialBlame.length) flags.push(...spatialBlame.map(item => ({ code:item.code, severity:item.code==='RISK_FOOTPRINT_TOO_BROAD'?'error':'warning', details:item })));
  const consistencyScore = clamp(1 - flags.reduce((sum,f)=>sum+(f.severity==='error'?0.2:f.severity==='warning'?0.1:0.04),0));

  return { diagnostics, environmentScore, consistencyScore, spatialScore: diagnostics.spatialScore, componentChecks, flags, series, spatialProduct: latestSpatialProduct?.spatialVerification ?? null };
}

export function aggregateCritiques(items) {
  const risks = {};
  const flags = {};
  for (const item of items) {
    const label = item.risk?.label ?? 'NONE'; risks[label] = (risks[label] ?? 0)+1;
    for (const flag of item.critic?.flags ?? []) flags[flag.code]=(flags[flag.code]??0)+1;
  }
  const n=Math.max(1,items.length);
  return {
    members: items.length,
    meanScore: mean(items.map(x=>finite(x.score))),
    meanEnvironmentScore: (()=>{ const rows=items.map(x=>x.critic?.environmentScore).filter(Number.isFinite); return rows.length?mean(rows):null; })(),
    meanConsistencyScore: mean(items.map(x=>finite(x.critic?.consistencyScore,1))),
    meanSpatialScore: mean(items.map(x=>finite(x.critic?.spatialScore,1))),
    riskDistribution: Object.fromEntries(Object.entries(risks).map(([k,v])=>[k,{count:v,fraction:v/n}])),
    flagCounts: flags,
    biasSignals: Object.entries(flags).filter(([,count])=>count/n>=0.1).map(([code,count])=>({code,count,fraction:count/n}))
  };
}

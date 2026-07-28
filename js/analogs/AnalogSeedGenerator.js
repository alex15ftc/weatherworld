import { intensityBand } from './OutbreakIntensity.js';
import { clamp, mulberry32 } from '../scenarios/math.js';

const BAND_RANGES = Object.freeze({
  localized:[0,20], organized:[20,40], significant:[40,60], major:[60,80], exceptional:[80,101]
});

export function selectAnalogEnsemble(catalog, {
  seed = 1, targetBand = null, minScore = 0, maxScore = 100,
  family = null, season = null, count = 20, temperature = .18
} = {}) {
  const random = mulberry32(normalizeSeed(seed));
  const inferredBand = targetBand ?? intensityBand((minScore + maxScore) / 2);
  const [bandMin, bandMax] = BAND_RANGES[inferredBand] ?? [minScore, maxScore];
  const lower = Math.max(minScore, bandMin);
  const upper = Math.min(maxScore, bandMax);
  let candidates = catalog.filter(record =>
    Number(record.intensity?.score) >= lower && Number(record.intensity?.score) < upper &&
    (!family || record.pattern?.family === family) &&
    (!season || record.season === season)
  );
  if (candidates.length < Math.min(3, count)) {
    candidates = catalog.filter(record => Number(record.intensity?.score) >= minScore && Number(record.intensity?.score) <= maxScore);
  }
  const targetScore = (lower + upper) / 2;
  const ranked = candidates.map(record => {
    const scoreDistance = Math.abs(record.intensity.score - targetScore) / 100;
    const familyPenalty = family && record.pattern?.family !== family ? .28 : 0;
    const distance = scoreDistance + familyPenalty;
    return { record, distance, weight: Math.exp(-distance / Math.max(.02, temperature)) * (.92 + random() * .16) };
  }).sort((a,b)=>a.distance-b.distance).slice(0,Math.max(1,Math.min(30,count)));
  const total = ranked.reduce((sum,row)=>sum+row.weight,0) || 1;
  return Object.freeze(ranked.map(row => Object.freeze({
    analogId:row.record.analogId, eventDate:row.record.eventDate,
    intensity:row.record.intensity, pattern:row.record.pattern,
    distance:row.distance, weight:row.weight/total
  })));
}

export function generateSeedFromAnalogs(catalog, options = {}) {
  const analogs = selectAnalogEnsemble(catalog, options);
  if (!analogs.length) throw new Error('No historical analogs satisfy the requested intensity thresholds.');
  const seed = normalizeSeed(options.seed ?? 1);
  const random = mulberry32(seed);
  const mean = key => analogs.reduce((sum,row)=>sum+(Number(row.pattern?.[key])||0)*row.weight,0);
  const perturb = sigma => (random()+random()+random()-1.5)/1.5*sigma;
  const latentPattern = {
    troughAmplitude:clamp(mean('troughAmplitude')+perturb(.06),0,1),
    troughTilt:clamp(mean('troughTilt')+perturb(.07),-1,1),
    lowLevelJetStrength:clamp(mean('lowLevelJetStrength')+perturb(.06),0,1),
    moistureQuality:clamp(mean('moistureQuality')+perturb(.07),0,1),
    capStrength:clamp(mean('capStrength')+perturb(.08),0,1),
    forcingTiming:clamp(mean('forcingTiming')+perturb(.08),0,1)
  };
  return Object.freeze({
    seed, targetIntensityBand:options.targetBand ?? intensityBand(analogs.reduce((sum,row)=>sum+row.intensity.score*row.weight,0)),
    analogs, latentPattern:Object.freeze(latentPattern),
    forecastUncertainty:Object.freeze({ moistureSigma:.07, capSigma:.08, timingSigmaHours:1.4, boundarySigmaKm:35 }),
    analogDriven:true
  });
}

function normalizeSeed(value) {
  const number=Number(value);if(Number.isFinite(number))return number>>>0;
  let hash=2166136261;for(const char of String(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return hash>>>0;
}

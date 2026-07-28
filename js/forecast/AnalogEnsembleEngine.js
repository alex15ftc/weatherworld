import { clamp } from '../scenarios/math.js?v=2.25.1';
import { HISTORICAL_ANALOG_CATALOG } from '../analogs/generatedHistoricalAnalogCatalog.js';
import { calibrateIntensityScore, leaveOneOutCalibration } from '../analogs/AnalogCalibration.js';

const HISTORICAL_CALIBRATION=HISTORICAL_ANALOG_CATALOG.length>=3?leaveOneOutCalibration(HISTORICAL_ANALOG_CATALOG):null;

export function buildAnalogEnsemble(config, day='day1', memberCount=30) {
  const leadFactor = day === 'day3' ? 1 : day === 'day2' ? 0.72 : 0.46;
  const analog = config?.analogGuidance ?? {};
  const seed = Number(config?.seed ?? 1) + (day === 'day1' ? 101 : day === 'day2' ? 211 : 307);
  const random = mulberry32(seed >>> 0);
  const members = [];
  for (let i=0;i<memberCount;i++) {
    const perturb = () => (random()+random()+random()-1.5) / 1.5;
    const residual = weightedResidual(analog.historicalResiduals ?? [], random);
    const residualPattern = residual?.pattern ?? {};
    const historicalSpread = clamp(1 - (analog.historicalInfluence ?? 0) * .28, .72, 1);
    const moisture = clamp((analog.moistureReturn ?? .72) + (residualPattern.moistureQuality??0)*.55 + perturb()*.18*leadFactor*historicalSpread, 0, 1);
    const clearing = clamp((analog.clearing ?? .70) + perturb()*.22*leadFactor, 0, 1);
    const cap = clamp((analog.capPersistence ?? .50) + (residualPattern.capStrength??0)*.55 + perturb()*.20*leadFactor*historicalSpread, 0, 1);
    const forcing = clamp((config.intensity ?? .6)*.62 + (analog.frontalCoherence ?? .7)*.38 + (residualPattern.forcingTiming??0)*.45 + perturb()*.16*leadFactor, 0, 1);
    const discrete = clamp((analog.discreteBias ?? .55) + (residualPattern.discreteBias??0)*.55 + perturb()*.20*leadFactor*historicalSpread, 0, 1);
    const recovery = clamp(moisture*.44 + clearing*.42 + (1-cap)*.14, 0, 1);
    const rawHistoricalScore=(analog.historicalIntensityScore??50)+(residual?.intensityResidual??0);
    const historicalOutcome=clamp(calibrateIntensityScore(rawHistoricalScore,HISTORICAL_CALIBRATION)/100,0,1);
    const realization = clamp((forcing*.40 + recovery*.34 + discrete*.16 + (1-cap)*.10)*.86+historicalOutcome*.14, 0, 1);
    members.push({ moisture, clearing, cap, forcing, discrete, recovery, realization, historicalAnalogId:residual?.analogId??null });
  }
  const mean = key => members.reduce((sum,m)=>sum+m[key],0)/members.length;
  const spread = key => Math.sqrt(members.reduce((sum,m)=>sum+(m[key]-mean(key))**2,0)/members.length);
  const confidence = clamp(1 - (spread('realization')*2.8 + spread('recovery')*1.4), .18, .96);
  const failureModes = [
    ['Cap may not break', members.filter(m=>m.cap>.70 && m.forcing<.68).length/memberCount],
    ['Moisture return underperforms', members.filter(m=>m.moisture<.52).length/memberCount],
    ['Morning clouds limit recovery', members.filter(m=>m.clearing<.48).length/memberCount],
    ['Storms become linear early', members.filter(m=>m.discrete<.38 && m.forcing>.58).length/memberCount]
  ].filter(([,p])=>p>=.08).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([label,p])=>({label, probability:Math.round(p*100)}));
  return {
    day, memberCount, analogFamily: analog.family ?? config?.setupType ?? 'shortwave_ejection',
    analogMembers: analog.members ?? [], historicalAnalogs: analog.historicalAnalogs ?? [],
    analogSource: analog.analogSource ?? 'synthetic-archetype-fallback', confidence: Math.round(confidence*100),
    historicalInfluence: analog.historicalInfluence ?? 0,
    calibration: HISTORICAL_CALIBRATION?{method:'leave-one-event-out-linear',sampleCount:HISTORICAL_CALIBRATION.sampleCount,rmse:HISTORICAL_CALIBRATION.rmse,rmseByBand:HISTORICAL_CALIBRATION.rmseByBand,brierByThreshold:HISTORICAL_CALIBRATION.brierByThreshold,brierByHazard:HISTORICAL_CALIBRATION.brierByHazard}:null,
    agreement: confidence >= .75 ? 'High' : confidence >= .52 ? 'Moderate' : 'Low',
    means: { moistureReturn:mean('moisture'), clearing:mean('clearing'), capPersistence:mean('cap'), forcing:mean('forcing'), discreteBias:mean('discrete'), realization:mean('realization') },
    members,
    failureModes
  };
}

function weightedResidual(rows,random){if(!rows.length)return null;let roll=random()*rows.reduce((sum,row)=>sum+(Number(row.weight)||0),0);for(const row of rows){roll-=Number(row.weight)||0;if(roll<=0)return row;}return rows.at(-1);}

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

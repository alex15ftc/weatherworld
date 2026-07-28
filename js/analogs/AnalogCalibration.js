const PATTERN_KEYS=['troughAmplitude','troughTilt','lowLevelJetStrength','moistureQuality','capStrength','forcingTiming','discreteBias'];
export function patternDistance(a,b){
  const weights={troughAmplitude:2,troughTilt:1.5,lowLevelJetStrength:1.8,moistureQuality:1.6,capStrength:1.4,forcingTiming:1.7,discreteBias:1.2};
  return PATTERN_KEYS.reduce((sum,key)=>sum+weights[key]*((Number(a?.[key])||0)-(Number(b?.[key])||0))**2,0);
}
export function leaveOneOutCalibration(catalog,{neighbors=8,temperature=.22}={}){
  const samples=catalog.map(target=>{
    const matches=catalog.filter(row=>row!==target).map(row=>({row,distance:patternDistance(target.pattern,row.pattern)})).sort((a,b)=>a.distance-b.distance).slice(0,neighbors);
    const weighted=matches.map(match=>({...match,weight:Math.exp(-match.distance/temperature)})),total=weighted.reduce((sum,row)=>sum+row.weight,0)||1;
    const predicted=weighted.reduce((sum,row)=>sum+row.row.intensity.score*row.weight,0)/total;
    const hazardForecast=Object.fromEntries(['tornado','hail','wind'].map(hazard=>[hazard,weighted.reduce((sum,row)=>sum+hazardOutcome(row.row,hazard)*row.weight,0)/total]));
    const hazardObserved=Object.fromEntries(['tornado','hail','wind'].map(hazard=>[hazard,hazardOutcome(target,hazard)]));
    return{analogId:target.analogId,predicted,observed:target.intensity.score,error:predicted-target.intensity.score,hazardForecast,hazardObserved};
  }).filter(sample=>Number.isFinite(sample.predicted));
  const mean=key=>samples.reduce((sum,row)=>sum+row[key],0)/Math.max(1,samples.length);
  const xMean=mean('predicted'),yMean=mean('observed');
  const covariance=samples.reduce((sum,row)=>sum+(row.predicted-xMean)*(row.observed-yMean),0);
  const variance=samples.reduce((sum,row)=>sum+(row.predicted-xMean)**2,0);
  const slope=variance>1e-9?covariance/variance:1,intercept=yMean-slope*xMean;
  const rmse=Math.sqrt(meanSquared(samples.map(row=>row.error)));
  const rmseByBand=Object.fromEntries(['localized','organized','significant','major','exceptional'].map(band=>{
    const rows=samples.filter(row=>bandFor(row.observed)===band);
    return[band,rows.length?Math.sqrt(meanSquared(rows.map(row=>row.error))):null];
  }));
  const brierByThreshold=Object.fromEntries([20,40,60,80].map(threshold=>[
    threshold,meanSquared(samples.map(row=>logistic((row.predicted-threshold)/8)-(row.observed>=threshold?1:0)))
  ]));
  const brierByHazard=Object.fromEntries(['tornado','hail','wind'].map(hazard=>[hazard,meanSquared(samples.map(row=>row.hazardForecast[hazard]-row.hazardObserved[hazard]))]));
  return Object.freeze({sampleCount:samples.length,slope,intercept,rmse,rmseByBand:Object.freeze(rmseByBand),brierByThreshold:Object.freeze(brierByThreshold),brierByHazard:Object.freeze(brierByHazard),samples:Object.freeze(samples)});
}
export function calibrateIntensityScore(raw,calibration){
  return Math.max(0,Math.min(100,(calibration?.intercept??0)+(calibration?.slope??1)*(Number(raw)||0)));
}
function meanSquared(values){return values.reduce((sum,value)=>sum+value*value,0)/Math.max(1,values.length);}
function logistic(value){return 1/(1+Math.exp(-value));}
function bandFor(score){return score>=80?'exceptional':score>=60?'major':score>=40?'significant':score>=20?'organized':'localized';}
function hazardOutcome(record,hazard){const counts=record?.intensity?.counts??record?.outcomes??{};if(hazard==='tornado')return(Number(counts.significantTornado)||0)>=1?1:0;if(hazard==='hail')return(Number(counts.significantHail)||0)>=3?1:0;return(Number(counts.destructiveWind)||0)>=3?1:0;}

import fs from 'node:fs';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { runSeedVerification } from '../js/verification/ForecastVerificationEngine.js';

const SETUPS = [
  'dryline_cyclone','progressive_cold_front','warm_front_wave','lee_cyclogenesis',
  'shortwave_ejection','northwest_flow','high_plains_upslope','elevated_mcs'
];
const RISKS = ['TSTM','MRGN','SLGT','ENH','MDT','HIGH'];
const HAZARDS = ['tornado','hail','wind'];

export function selectStratifiedSeeds(perSetup=1,startSeed=1,maxScanned=200000){
  const selected=Object.fromEntries(SETUPS.map(setup=>[setup,[]]));
  for(let seed=startSeed;seed<startSeed+maxScanned;seed++){
    if(Object.values(selected).every(rows=>rows.length>=perSetup))break;
    const probe=new Atmosphere(1,1);
    const config=generateScenario(probe,seed);
    if(selected[config.setupType]?.length<perSetup)selected[config.setupType].push(seed);
  }
  return selected;
}

const mean=values=>{
  const finite=values.filter(Number.isFinite);
  return finite.length?finite.reduce((sum,value)=>sum+value,0)/finite.length:null;
};
const riskCounts=rows=>Object.fromEntries(RISKS.map(risk=>[risk,rows.filter(row=>row.forecastRisk===risk).length]));

export function aggregateCalibrationReports(reports){
  const rows=reports.map(report=>{
    const latest=report.forecast?.byDay?.day1?.latest;
    const track=latest?.spatialPlacement?.tornadoTracks;
    const observedPeak=report.event?.peakConvectiveHourByDay?.day1;
    return{
      seed:report.seed,setupType:report.scenario?.setupType??'unknown',
      narrative:report.scenario?.narrative??null,
      forecastRisk:latest?.forecastOverallRisk??null,observedRisk:latest?.observedOverallRisk??null,
      score:latest?.score??report.forecast?.byDay?.day1?.meanScore??null,
      timingErrorHours:Number.isFinite(observedPeak)&&Number.isFinite(latest?.peakForecastHourUtc)
        ? latest.peakForecastHourUtc-observedPeak:null,
      tornadoes:report.event?.totalTornadoes??0,
      tornadoTrackCapture2:track?.contourCapture?.['2pct']??null,
      tornadoTrackCapture5:track?.contourCapture?.['5pct']??null,
      tornadoCoreDisplacementMiles:track?.bullseye?.medianCoreDisplacementMiles??null,
      tornadoCoreSignedDisplacementMiles:track?.bullseye?.signedCoreDisplacementMiles??null,
      hazards:Object.fromEntries(HAZARDS.map(h=>[h,{
        bias:report.forecast?.calibration?.[h]?.forecastBias??null,
        pod:report.forecast?.calibration?.[h]?.meanPOD??null,
        far:report.forecast?.calibration?.[h]?.meanFAR??null,
        csi:report.forecast?.calibration?.[h]?.meanCSI??null,
        forecastAreaFraction:latest?.hazards?.[h]?.thresholdDiagnostics?.[h==='tornado'?'2pct':'5pct']?.forecastAreaFraction
          ??latest?.hazards?.[h]?.forecastAreaFraction??null
      }]))
    };
  });
  const summarize=group=>{
    const tornadoRows=group.filter(row=>row.tornadoes>0);
    return{
      seeds:group.length,
      forecastRiskFrequency:riskCounts(group),
      observedRiskFrequency:Object.fromEntries(RISKS.map(risk=>[risk,group.filter(row=>row.observedRisk===risk).length])),
      meanScore:mean(group.map(row=>row.score)),
      meanTimingErrorHours:mean(group.map(row=>row.timingErrorHours)),
      meanAbsoluteTimingErrorHours:mean(group.map(row=>Number.isFinite(row.timingErrorHours)?Math.abs(row.timingErrorHours):null)),
      tornadoCases:tornadoRows.length,
      tornadoTrackCapture:{pct2:mean(tornadoRows.map(row=>row.tornadoTrackCapture2)),pct5:mean(tornadoRows.map(row=>row.tornadoTrackCapture5))},
      tornadoCoreDisplacementMiles:mean(tornadoRows.map(row=>row.tornadoCoreDisplacementMiles)),
      tornadoCoreSignedDisplacementMiles:{
        east:mean(tornadoRows.map(row=>row.tornadoCoreSignedDisplacementMiles?.east)),
        south:mean(tornadoRows.map(row=>row.tornadoCoreSignedDisplacementMiles?.south))
      },
      hazards:Object.fromEntries(HAZARDS.map(h=>[h,{
        bias:mean(group.map(row=>row.hazards[h].bias)),
        pod:mean(group.map(row=>row.hazards[h].pod)),
        far:mean(group.map(row=>row.hazards[h].far)),
        csi:mean(group.map(row=>row.hazards[h].csi)),
        forecastAreaFraction:mean(group.map(row=>row.hazards[h].forecastAreaFraction))
      }]))
    };
  };
  return{
    schemaVersion:1,
    generatedAt:new Date().toISOString(),
    overall:summarize(rows),
    bySetup:Object.fromEntries([...new Set(rows.map(row=>row.setupType))].sort().map(setup=>[setup,summarize(rows.filter(row=>row.setupType===setup))])),
    rows
  };
}

async function main(){
  const perSetup=Math.max(1,Number(process.argv[2]??1));
  const hours=Math.max(1,Number(process.argv[3]??24));
  const output=process.argv[4]??'verification-runs/setup-calibration.json';
  const startSeed=Math.max(1,Number(process.argv[5]??1));
  const stepHours=Math.max(.25,Number(process.argv[6]??1));
  const requestedSetups=(process.argv[7]??'').split(',').map(value=>value.trim()).filter(value=>SETUPS.includes(value));
  const activeSetups=requestedSetups.length?requestedSetups:SETUPS;
  const selected=selectStratifiedSeeds(perSetup,startSeed);
  const seeds=activeSetups.flatMap(setup=>selected[setup]);
  const reports=[];
  for(let i=0;i<seeds.length;i++){
    const seed=seeds[i],setup=activeSetups.find(key=>selected[key].includes(seed));
    console.log(`[${i+1}/${seeds.length}] seed ${seed} · ${setup}`);
    reports.push(runSeedVerification(seed,{hours,stepHours}));
  }
  const summary=aggregateCalibrationReports(reports);
  summary.run={perSetup,hours,stepHours,startSeed,activeSetups,selected:Object.fromEntries(activeSetups.map(setup=>[setup,selected[setup]]))};
  fs.mkdirSync('verification-runs',{recursive:true});
  fs.writeFileSync(output,JSON.stringify(summary,null,2));
  console.log(JSON.stringify({output,overall:summary.overall,bySetup:summary.bySetup},null,2));
}

if(process.argv[1]&&import.meta.url===new URL(`file:///${process.argv[1].replaceAll('\\','/')}`).href)main();

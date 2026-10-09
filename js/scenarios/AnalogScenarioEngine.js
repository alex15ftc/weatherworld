const VERSION = '2.71.0';

const FAMILY_EXPECTATIONS = {
  dryline_cyclone:{drylineSpeed:[8,34],stormSpacing:[35,95],initiationHour:[18,24],upscaleProbability:.48,discreteFraction:[.38,.82],tornadoCorridorWidth:[60,220]},
  shortwave_ejection:{drylineSpeed:[10,38],stormSpacing:[25,85],initiationHour:[17,23],upscaleProbability:.67,discreteFraction:[.25,.68],tornadoCorridorWidth:[90,280]},
  warm_front_wave:{drylineSpeed:[0,24],stormSpacing:[20,75],initiationHour:[15,23],upscaleProbability:.61,discreteFraction:[.20,.65],tornadoCorridorWidth:[60,200]},
  progressive_cold_front:{drylineSpeed:[0,30],stormSpacing:[15,65],initiationHour:[16,22],upscaleProbability:.84,discreteFraction:[.05,.40],tornadoCorridorWidth:[80,260]},
  lee_cyclogenesis:{drylineSpeed:[8,32],stormSpacing:[35,100],initiationHour:[18,24],upscaleProbability:.50,discreteFraction:[.40,.86],tornadoCorridorWidth:[60,220]},
  high_plains_upslope:{drylineSpeed:[0,24],stormSpacing:[30,90],initiationHour:[19,25],upscaleProbability:.44,discreteFraction:[.45,.90],tornadoCorridorWidth:[40,180]},
  northwest_flow:{drylineSpeed:[0,24],stormSpacing:[15,70],initiationHour:[17,23],upscaleProbability:.79,discreteFraction:[.08,.45],tornadoCorridorWidth:[70,240]},
  elevated_mcs:{drylineSpeed:[0,18],stormSpacing:[10,55],initiationHour:[21,30],upscaleProbability:.91,discreteFraction:[0,.28],tornadoCorridorWidth:[30,140]}
};

export function initializeAnalogScenarioEngine(world){
  world.analogScenarioHistory=[];
  return runAnalogScenarioEngine(world,{initial:true});
}

export function runAnalogScenarioEngine(world,{initial=false}={}){
  const started=now();
  const config=world.evolution?.config??{};
  const family=config.setupType??config.synopticPattern?.setupName??config.synopticPattern?.analogGuidance?.family??'shortwave_ejection';
  const expected=FAMILY_EXPECTATIONS[family]??FAMILY_EXPECTATIONS.shortwave_ejection;
  const observed=diagnoseObserved(world);
  const checks={
    boundaryMotion:rangeScore(observed.drylineSpeedKph,expected.drylineSpeed),
    stormSpacing:observed.stormSpacingKm==null?.72:rangeScore(observed.stormSpacingKm,expected.stormSpacing),
    initiationTiming:observed.peakInitiationHourUtc==null?.72:circularRangeScore(observed.peakInitiationHourUtc,expected.initiationHour),
    convectiveMode:observed.discreteFraction==null?.72:rangeScore(observed.discreteFraction,expected.discreteFraction),
    boundaryPlacement:boundaryPlacementScore(world),
    parcelPlacement:parcelPlacementScore(world),
    integrity:clamp(Number(world.meteorologicalIntegrity?.overallScore) || .72,0,1)
  };
  const plausibility=weightedMean([[checks.boundaryMotion,.14],[checks.stormSpacing,.12],[checks.initiationTiming,.10],[checks.convectiveMode,.15],[checks.boundaryPlacement,.20],[checks.parcelPlacement,.17],[checks.integrity,.12]]);
  const confidenceFactor=clamp(.78+.22*plausibility,.78,1);
  const warnings=[];
  if(checks.boundaryMotion<.35)warnings.push({code:'ANALOG_BOUNDARY_MOTION_OUTLIER',value:observed.drylineSpeedKph,expected:expected.drylineSpeed});
  if(checks.convectiveMode<.35)warnings.push({code:'ANALOG_CONVECTIVE_MODE_OUTLIER',value:observed.discreteFraction,expected:expected.discreteFraction});
  if(checks.boundaryPlacement<.45)warnings.push({code:'ANALOG_BOUNDARY_PLACEMENT_OUTLIER'});
  if(checks.parcelPlacement<.45)warnings.push({code:'ANALOG_SEVERE_PARCEL_PLACEMENT_OUTLIER'});
  const report={version:VERSION,mode:'critic-not-driver',family,narrative:config.narrative??null,plausibility,confidenceFactor,checks,expected,observed,warnings,elapsedMs:now()-started,initial};
  world.analogScenario=report;
  world.analogScenarioHistory=[...(world.analogScenarioHistory??[]).slice(-47),compact(report)];
  world.forEachCell?.(cell=>{cell.analogScenarioSupport={version:VERSION,family,plausibility,confidenceFactor};});
  return report;
}

function diagnoseObserved(world){
  const fronts=world.synopticObjects?.fronts??[];
  const dry=fronts.find(f=>f.type==='dryline');
  const speed=dry?Math.hypot(Number(dry.velocityKph?.east)||0,Number(dry.velocityKph?.north)||0):0;
  const storms=world.stormEngine?.stormHistory??world.stormEngine?.storms??[];
  const positions=storms.map(s=>s.positionKm??s.position).filter(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y));
  let spacing=null;
  if(positions.length>1){let sum=0,n=0;for(let i=0;i<positions.length;i++){let best=Infinity;for(let j=0;j<positions.length;j++)if(i!==j)best=Math.min(best,Math.hypot(positions[i].x-positions[j].x,positions[i].y-positions[j].y));if(Number.isFinite(best)){sum+=best;n++;}}spacing=n?sum/n:null;}
  const modes=world.stormEngine?.dominantModes??world.stormEngine?.summary?.dominantModes??[];
  let discreteFraction=null;
  if(Array.isArray(modes)&&modes.length){const total=modes.reduce((s,m)=>s+(Number(m.count)||0),0);const d=modes.filter(m=>String(m.mode).includes('discrete')||String(m.mode).includes('supercell')).reduce((s,m)=>s+(Number(m.count)||0),0);discreteFraction=total?d/total:null;}
  return{drylineSpeedKph:speed,stormSpacingKm:spacing,peakInitiationHourUtc:world.stormEngine?.peakInitiationHourUtc??null,discreteFraction};
}
function boundaryPlacementScore(world){let good=0,total=0;world.forEachCell?.(c=>{const b=c.features?.boundaryRelative;if(!b)return;const stp=Number(c.derived?.stp)||0;if(stp<1)return;total++;if(!(b.type==='dryline'&&b.side==='behind')&&!(b.type==='cold'&&b.side==='behind'))good++;});return total?good/total:.75;}
function parcelPlacementScore(world){let good=0,total=0;world.forEachCell?.(c=>{const stp=Number(c.derived?.stp)||0;if(stp<1)return;total++;if((Number(c.surfaceParcelValidity?.score)||0)>=.45)good++;});return total?good/total:.75;}
function rangeScore(v,[lo,hi]){if(!Number.isFinite(v))return .7;if(v>=lo&&v<=hi)return 1;const span=Math.max(1,hi-lo);return Math.exp(-Math.min(Math.abs(v-lo),Math.abs(v-hi))/span);}
function circularRangeScore(v,range){let hour=((Number(v)%24)+24)%24;let [lo,hi]=range.map(x=>((x%24)+24)%24);if(range[1]>24&&hour<lo)hour+=24;return rangeScore(hour,[range[0],range[1]]);}
function weightedMean(pairs){const d=pairs.reduce((s,[,w])=>s+w,0)||1;return pairs.reduce((s,[v,w])=>s+clamp(v,0,1)*w,0)/d;}
function clamp(v,a,b){return Math.max(a,Math.min(b,Number(v)||0));}
function compact(r){return{version:r.version,validHourUtc:r.observed?.validHourUtc,plausibility:r.plausibility,confidenceFactor:r.confidenceFactor,family:r.family,warningCount:r.warnings.length,checks:r.checks,elapsedMs:r.elapsedMs};}
function now(){return globalThis.performance?.now?.()??Date.now();}

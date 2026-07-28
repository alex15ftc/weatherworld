import { buildAnalogEnsemble } from './AnalogEnsembleEngine.js?v=2.28.8';

const PATTERN_LABELS = {
  dryline_cyclone:'Classic Dryline Cyclone', progressive_cold_front:'Progressive Cold Front',
  warm_front_wave:'Warm-Front Wave', lee_cyclogenesis:'Lee Cyclogenesis',
  shortwave_ejection:'Trough / Shortwave Ejection', northwest_flow:'Northwest-Flow Wave',
  high_plains_upslope:'High Plains Upslope', elevated_mcs:'Elevated Nocturnal MCS'
};
const RISK_ORDER=['TSTM','MRGN','SLGT','ENH','MDT','HIGH'];

export function buildOutlookDiscussion(world, config, day='day1') {
  const ensemble = buildAnalogEnsemble(config, day);
  const patternKey = config?.setupType ?? config?.synopticPattern?.setupName ?? ensemble.analogFamily;
  const pattern = PATTERN_LABELS[patternKey] ?? title(patternKey);
  const analog = config?.analogGuidance ?? {};
  const lifecycle = representativeLifecycle(world);
  const product = world?.outlookCycle?.products?.[day] ?? null;
  const metrics = summarizeProduct(world, product);
  const diagnosed = diagnoseOutlookFactors(metrics, config, ensemble, analog);
  const reasons = [...(config?.reasons ?? []), ...diagnosed.supporting];
  const limitations = [...(config?.limitations ?? []), ...diagnosed.limiting];
  const stage = lifecycle.ejectionPhase > .72 ? 'Mature / peak forcing overlap' : lifecycle.moistureReturnPhase > .65 ? 'Destabilization and moisture return' : 'Developing pattern';
  const discussion = composeDiscussion({pattern,patternKey,stage,ensemble,metrics,product,config});
  return { pattern, patternKey, stage, confidence:ensemble.confidence, ensemble, metrics, supportingFactors:unique(reasons).slice(0,8), limitingFactors:unique(limitations).slice(0,7), discussion };
}

function diagnoseOutlookFactors(metrics, config, ensemble, analog) {
  const e = metrics.env ?? {};
  const supporting = [];
  const limiting = [];
  const coherence = Number(config?.synopticPattern?.coherence) || 0;

  if (coherence >= .76) supporting.push(`Coherent synoptic pattern and frontal geometry (${pct(coherence)})`);
  else if (coherence < .60) limiting.push(`Poor synoptic and frontal coherence (${pct(coherence)})`);

  if (e.dewpoint >= 65) supporting.push(`Rich boundary-layer moisture (${round(e.dewpoint)}°F representative dewpoint)`);
  else if (e.dewpoint < 58) limiting.push(`Limited boundary-layer moisture (${round(e.dewpoint)}°F representative dewpoint)`);
  else if (e.dewpoint < 62) limiting.push(`Marginal moisture depth in the primary corridor`);

  if (e.cape >= 2500) supporting.push(`Strong buoyancy (${round(e.cape)} J/kg CAPE)`);
  else if (e.cape >= 1500) supporting.push(`Adequate buoyancy (${round(e.cape)} J/kg CAPE)`);
  else if (e.cape < 750) limiting.push(`Weak instability (${round(e.cape)} J/kg CAPE)`);
  else if (e.cape < 1250) limiting.push(`Only modest instability (${round(e.cape)} J/kg CAPE)`);

  if (e.cin <= 55) supporting.push(`Weak inhibition (${round(e.cin)} J/kg CIN)`);
  else if (e.cin >= 140) limiting.push(`Strong cap (${round(e.cin)} J/kg CIN)`);
  else if (e.cin >= 95) limiting.push(`Persistent inhibition (${round(e.cin)} J/kg CIN)`);

  if (e.shear >= 45) supporting.push(`Strong deep-layer shear (${round(e.shear)} kt)`);
  else if (e.shear < 30) limiting.push(`Weak deep-layer shear (${round(e.shear)} kt)`);

  if (e.srh >= 200) supporting.push(`Strong low-level hodograph curvature (${round(e.srh)} m²/s² SRH)`);
  else if (e.srh < 100) limiting.push(`Limited low-level shear (${round(e.srh)} m²/s² SRH)`);

  if (e.lcl > 0 && e.lcl <= 1100) supporting.push(`Low cloud bases (${round(e.lcl)} m LCL)`);
  else if (e.lcl >= 1600) limiting.push(`High cloud bases (${round(e.lcl)} m LCL)`);

  if (e.forcing >= .62) supporting.push(`Strong mesoscale/synoptic forcing overlap (${pct(e.forcing)})`);
  else if (e.forcing > 0 && e.forcing < .32) limiting.push(`Weak forcing overlap (${pct(e.forcing)})`);

  if (metrics.meanInitiation >= .45) supporting.push(`High convective-initiation signal (${pct(metrics.meanInitiation)} corridor mean)`);
  else if (metrics.meanInitiation < .15) limiting.push(`Low or highly localized initiation signal (${pct(metrics.meanInitiation)} corridor mean)`);
  else if (metrics.meanInitiation < .30) limiting.push(`Conditional initiation (${pct(metrics.meanInitiation)} corridor mean)`);

  if (metrics.meanCoverage >= .45) supporting.push(`Broad expected storm coverage (${pct(metrics.meanCoverage)} corridor mean)`);
  else if (metrics.meanCoverage < .18) limiting.push(`Sparse expected storm coverage (${pct(metrics.meanCoverage)} corridor mean)`);

  if (metrics.meanTorIntensity >= .62 && metrics.maxTor >= 5) supporting.push('Storm mode and conditional intensity support tornado potential');
  if (metrics.meanHailIntensity >= .62 && metrics.maxHail >= 15) supporting.push('Updraft intensity and thermodynamics support large hail');
  if (metrics.meanWindIntensity >= .62 && metrics.maxWind >= 15) supporting.push('Cold-pool and momentum-transfer signals support damaging wind');

  if(metrics.maxTor>=10) supporting.push(`Forecast tornado probabilities reach ${metrics.maxTor}%`);
  if(metrics.maxHail>=15) supporting.push(`Forecast hail probabilities reach ${metrics.maxHail}%`);
  if(metrics.maxWind>=15) supporting.push(`Forecast wind probabilities reach ${metrics.maxWind}%`);
  if(metrics.maxTor<5 && metrics.maxHail<15 && metrics.maxWind<15) limiting.push('No hazard probability reaches a concentrated severe threshold');

  // Ensemble failures are explanatory uncertainty, not probability modifiers.
  for (const failure of ensemble.failureModes.slice(0, 3)) {
    if (failure.probability >= 25) limiting.push(`${failure.label} (${failure.probability}% analog-ensemble signal)`);
  }
  if ((analog?.generationOnly ?? false) && analog?.archetype) {
    supporting.unshift(`Generated analog archetype: ${title(analog.archetype)}`);
  }
  return { supporting: unique(supporting), limiting: unique(limiting) };
}

function summarizeProduct(world,product){
  const grid=product?.grid??[];
  if(!grid.length)return{overallRisk:product?.overallRisk??'TSTM',maxTor:0,maxHail:0,maxWind:0,maxTorCig:0,maxHailCig:0,maxWindCig:0,meanCoverage:0,meanInitiation:0,peakHour:product?.peakForecastHourUtc??world?.validHourUtc??12,corridorCells:0,riskCells:0,topRisk:'TSTM',env:null};
  const ranked=[...grid].sort((a,b)=>(b.hazardOverlapScore??0)-(a.hazardOverlapScore??0));
  const corridor=ranked.slice(0,Math.max(1,Math.ceil(grid.length*.08)));
  const avg=(arr,key)=>arr.reduce((s,v)=>s+(Number(v?.[key])||0),0)/Math.max(1,arr.length);
  const max=key=>Math.max(0,...grid.map(v=>Number(v?.[key])||0));
  const hours=corridor.map(v=>Number(v.peakHourUtc)).filter(Number.isFinite).sort((a,b)=>a-b);
  const peakHour=hours.length?hours[Math.floor(hours.length/2)]:(product?.peakForecastHourUtc??world?.validHourUtc??12);
  const topRisk=grid.reduce((best,v)=>RISK_ORDER.indexOf(v.risk)>RISK_ORDER.indexOf(best)?v.risk:best,'TSTM');
  const riskCells=grid.filter(v=>RISK_ORDER.indexOf(v.risk)>=RISK_ORDER.indexOf('SLGT')).length;
  return{overallRisk:product?.overallRisk??topRisk,maxTor:max('tornadoProbability'),maxHail:max('hailProbability'),maxWind:max('windProbability'),maxTorCig:max('tornadoCig'),maxHailCig:max('hailCig'),maxWindCig:max('windCig'),meanCoverage:avg(corridor,'peakCoverage'),meanInitiation:avg(corridor,'peakInitiation'),meanTorIntensity:avg(corridor,'conditionalTornadoIntensity'),meanHailIntensity:avg(corridor,'conditionalHailIntensity'),meanWindIntensity:avg(corridor,'conditionalWindIntensity'),peakHour,corridorCells:corridor.length,riskCells,topRisk,env:representativeEnvironment(world,corridor,grid)};
}
function representativeEnvironment(world,corridor,grid){
  if(!world?.getCell||!grid.length)return null;
  const target=corridor[0];const i=grid.indexOf(target);if(i<0)return null;
  const c=world.getCell(i%world.width,Math.floor(i/world.width));if(!c)return null;
  return{cape:n(c.derived?.cape),cin:n(c.derived?.cin),srh:n(c.derived?.srh),shear:n(c.derived?.bulkShear),lcl:n(c.derived?.lcl),stp:n(c.derived?.stp),vtp:n(c.derived?.vtp),dewpoint:n(c.surface?.dewpoint),wind850:n(c.levels?.[850]?.windSpeed),wind500:n(c.levels?.[500]?.windSpeed),wind250:n(c.levels?.[250]?.windSpeed),forcing:n(c.dynamics?.forcingScore),initiation:n(c.dynamics?.initiationPotential)};
}
function composeDiscussion({pattern,patternKey,stage,ensemble,metrics,product,config}){
  const e=metrics.env;
  const valid=product?`${formatHour(product.validStartHour)}–${formatHour(product.validEndHour)}`:'the forecast period';
  const issue=product?formatHour(product.issuedHourUtc):'the current cycle';
  const areaPct=product?.grid?.length?Math.round(metrics.riskCells/product.grid.length*100):0;
  const p1=`${pattern} governs the ${valid} period. The ${issue} issuance carries a ${metrics.overallRisk} maximum, with Slight-or-greater probabilities covering ${areaPct}% of the domain. The primary corridor peaks near ${formatHour(metrics.peakHour)}, when mean initiation reaches ${pct(metrics.meanInitiation)} and expected storm coverage reaches ${pct(metrics.meanCoverage)}.`;
  const p2=e?`${stageSentence(stage,patternKey)} A representative corridor sounding contains about ${round(e.cape)} J/kg CAPE, ${round(e.srh)} m²/s² SRH, ${round(e.shear)} kt deep-layer shear, ${round(e.lcl)} m LCLs, STP ${one(e.stp)}, and VTP ${one(e.vtp)}. Flow increases from roughly ${round(e.wind850)} kt at 850 mb to ${round(e.wind500)} kt at 500 mb and ${round(e.wind250)} kt at 250 mb.`:`${stageSentence(stage,patternKey)} ${moistureSentence(ensemble.means)}`;
  const hazard=dominantHazard(metrics);
  const p3=`Maximum probabilities are ${metrics.maxTor}% tornado, ${metrics.maxHail}% hail, and ${metrics.maxWind}% wind; ${hazard} is the leading hazard signal. The analog ensemble has ${ensemble.agreement.toLowerCase()} agreement (${ensemble.confidence}% confidence; ${ensemble.memberCount} members), with mean moisture return ${pct(ensemble.means.moistureReturn)}, clearing ${pct(ensemble.means.clearing)}, forcing ${pct(ensemble.means.forcing)}, and cap persistence ${pct(ensemble.means.capPersistence)}. ${failureSentence(ensemble.failureModes)}`;
  return `${p1}\n\n${p2}\n\n${p3}`;
}
function dominantHazard(m){const a=[['tornadoes',m.maxTor],['damaging wind',m.maxWind],['large hail',m.maxHail]].sort((x,y)=>y[1]-x[1]);return a[0][0];}
function representativeLifecycle(world){let best=null;world?.forEachCell?.(cell=>{const l=cell.features?.synopticLifecycle;if(l&&(!best||(cell.features?.synopticCoherence??0)>(best.weight??0)))best={...l,weight:cell.features?.synopticCoherence??0};});return best??{ejectionPhase:0,moistureReturnPhase:0,clearingPhase:0};}
function stageSentence(stage,key){if(key==='dryline_cyclone'||key==='lee_cyclogenesis')return 'A lee cyclone, sharpening dryline, and elevated mixed layer organize the warm sector while ascent approaches from the west.';if(key==='warm_front_wave')return 'A baroclinic warm front focuses moisture pooling, backed low-level flow, and repeated ascent.';if(key==='progressive_cold_front')return 'A progressive front supplies broad linear forcing while the prefrontal warm sector narrows with time.';if(key==='high_plains_upslope')return 'Upslope flow and terrain-relative moisture transport focus initiation along the High Plains corridor.';if(key==='elevated_mcs')return 'Warm advection above a stable surface layer and a strengthening nocturnal low-level jet support elevated convection.';return 'An ejecting upper wave and deepening surface response increase ascent and organize the frontal zones.';}
function moistureSentence(m){if(m.moistureReturn>.72&&m.clearing>.66)return 'Moisture return and clearing both support meaningful atmospheric recovery.';if(m.capPersistence>.68)return 'Instability may become substantial, but persistent inhibition remains a major timing uncertainty.';return 'Thermodynamic recovery is uneven, with mesoscale boundaries controlling the strongest corridor.';}
function failureSentence(f){return f.length?`Most likely failure modes are ${f.slice(0,3).map(x=>`${x.label.toLowerCase()} (${x.probability}%)`).join(', ')}.`:'No ensemble failure mode exceeds the reporting threshold.';}
function formatHour(h){if(!Number.isFinite(Number(h)))return'—';const day=Math.floor(Number(h)/24)+1,z=((Math.floor(Number(h))%24)+24)%24;return`${String(z).padStart(2,'0')}Z Day ${day}`;}
function unique(values){return [...new Set(values.filter(Boolean))];}
function title(v){return String(v??'').replace(/[_-]/g,' ').replace(/\b\w/g,m=>m.toUpperCase());}
function pct(v){return`${Math.round((Number(v)||0)*100)}%`;}
function round(v){return Math.round(Number(v)||0);}
function one(v){return (Number(v)||0).toFixed(1);}
function n(v){return Number.isFinite(Number(v))?Number(v):0;}

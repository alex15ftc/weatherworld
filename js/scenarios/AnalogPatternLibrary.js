import { HISTORICAL_ANALOG_CATALOG } from '../analogs/generatedHistoricalAnalogCatalog.js';

// 2.28.8: impactful severe-weather analog families used only during
// atmosphere generation. These are synthetic archetypes, not historical
// replays. They shape the generated thermodynamic/kinematic pattern but never
// directly multiply outlook probabilities or force storm hazards.
const ANALOGS = {
  dryline_cyclone: [
    { id:'classic-tornadic-dryline', archetype:'tornadic_supercells', weight:5.0, troughTilt:.72, moistureReturn:.90, capPersistence:.58, clearing:.84, frontalCoherence:.91, discreteBias:.88, thermodynamics:1.10, kinematics:1.12, forcingTiming:.86, moistureDepth:.91, lapseQuality:.90, failure:'cap_bust' },
    { id:'giant-hail-dryline', archetype:'giant_hail', weight:3.7, troughTilt:.55, moistureReturn:.79, capPersistence:.68, clearing:.91, frontalCoherence:.84, discreteBias:.92, thermodynamics:1.18, kinematics:1.04, forcingTiming:.74, moistureDepth:.77, lapseQuality:1.00, failure:'isolated_coverage' },
    { id:'conditional-loaded-gun', archetype:'conditional_tornado', weight:1.8, troughTilt:.48, moistureReturn:.75, capPersistence:.82, clearing:.92, frontalCoherence:.76, discreteBias:.93, thermodynamics:1.15, kinematics:1.08, forcingTiming:.58, moistureDepth:.72, lapseQuality:.96, failure:'cap_bust' }
  ],
  shortwave_ejection: [
    { id:'major-tornado-ejection', archetype:'regional_tornado_outbreak', weight:5.4, troughTilt:.95, moistureReturn:.97, capPersistence:.40, clearing:.83, frontalCoherence:.97, discreteBias:.78, thermodynamics:1.12, kinematics:1.18, forcingTiming:.96, moistureDepth:.98, lapseQuality:.89, failure:'morning_convection' },
    { id:'mixed-mode-outbreak', archetype:'mixed_mode_outbreak', weight:4.3, troughTilt:.81, moistureReturn:.91, capPersistence:.43, clearing:.76, frontalCoherence:.94, discreteBias:.62, thermodynamics:1.08, kinematics:1.15, forcingTiming:.92, moistureDepth:.94, lapseQuality:.86, failure:'rapid_upscale_growth' },
    { id:'progressive-supercell-ejection', archetype:'cyclic_supercells', weight:3.3, troughTilt:.72, moistureReturn:.86, capPersistence:.52, clearing:.80, frontalCoherence:.89, discreteBias:.82, thermodynamics:1.07, kinematics:1.10, forcingTiming:.84, moistureDepth:.87, lapseQuality:.90, failure:'early_storm_interference' }
  ],
  warm_front_wave: [
    { id:'warm-front-tornado-corridor', archetype:'boundary_tornadoes', weight:4.8, troughTilt:.70, moistureReturn:.95, capPersistence:.35, clearing:.72, frontalCoherence:.96, discreteBias:.76, thermodynamics:1.05, kinematics:1.18, forcingTiming:.93, moistureDepth:.97, lapseQuality:.80, failure:'boundary_displacement' },
    { id:'stalled-front-training', archetype:'training_supercells_mcs', weight:3.1, troughTilt:.52, moistureReturn:.92, capPersistence:.31, clearing:.60, frontalCoherence:.97, discreteBias:.55, thermodynamics:1.02, kinematics:1.10, forcingTiming:.89, moistureDepth:.96, lapseQuality:.78, failure:'persistent_clouds' }
  ],
  progressive_cold_front: [
    { id:'derecho-corridor', archetype:'derecho', weight:5.3, troughTilt:.64, moistureReturn:.88, capPersistence:.24, clearing:.80, frontalCoherence:.98, discreteBias:.18, thermodynamics:1.13, kinematics:1.13, forcingTiming:.97, moistureDepth:.91, lapseQuality:.91, failure:'narrow_warm_sector' },
    { id:'qlcs-tornado-line', archetype:'qlcs', weight:3.8, troughTilt:.72, moistureReturn:.91, capPersistence:.22, clearing:.70, frontalCoherence:.98, discreteBias:.28, thermodynamics:1.03, kinematics:1.20, forcingTiming:.96, moistureDepth:.95, lapseQuality:.78, failure:'rapid_linear_transition' }
  ],
  lee_cyclogenesis: [
    { id:'lee-low-tornado-dryline', archetype:'tornadic_supercells', weight:4.9, troughTilt:.68, moistureReturn:.88, capPersistence:.61, clearing:.90, frontalCoherence:.90, discreteBias:.89, thermodynamics:1.10, kinematics:1.13, forcingTiming:.84, moistureDepth:.88, lapseQuality:.92, failure:'cap_bust' },
    { id:'high-end-hail-lee-low', archetype:'giant_hail', weight:3.5, troughTilt:.54, moistureReturn:.76, capPersistence:.65, clearing:.94, frontalCoherence:.84, discreteBias:.94, thermodynamics:1.20, kinematics:1.05, forcingTiming:.72, moistureDepth:.74, lapseQuality:1.00, failure:'moisture_mixing' }
  ],
  high_plains_upslope: [
    { id:'upslope-tornadic-supercells', archetype:'high_plains_tornadoes', weight:4.6, troughTilt:.48, moistureReturn:.75, capPersistence:.44, clearing:.93, frontalCoherence:.83, discreteBias:.94, thermodynamics:1.08, kinematics:1.09, forcingTiming:.84, moistureDepth:.80, lapseQuality:.97, failure:'weak_moisture_depth' },
    { id:'upslope-giant-hail', archetype:'giant_hail', weight:4.0, troughTilt:.40, moistureReturn:.69, capPersistence:.50, clearing:.96, frontalCoherence:.79, discreteBias:.96, thermodynamics:1.19, kinematics:1.03, forcingTiming:.77, moistureDepth:.70, lapseQuality:1.00, failure:'high_cloud_bases' }
  ],
  northwest_flow: [
    { id:'northwest-flow-derecho', archetype:'derecho', weight:4.6, troughTilt:.34, moistureReturn:.72, capPersistence:.18, clearing:.84, frontalCoherence:.82, discreteBias:.24, thermodynamics:1.11, kinematics:1.13, forcingTiming:.91, moistureDepth:.78, lapseQuality:.95, failure:'boundary_uncertainty' },
    { id:'northwest-flow-mcs', archetype:'mcs', weight:3.5, troughTilt:.31, moistureReturn:.68, capPersistence:.22, clearing:.76, frontalCoherence:.78, discreteBias:.31, thermodynamics:1.06, kinematics:1.08, forcingTiming:.88, moistureDepth:.75, lapseQuality:.91, failure:'cold_pool_dominance' }
  ],
  elevated_mcs: [
    { id:'nocturnal-forward-propagating-mcs', archetype:'mcs', weight:5.0, troughTilt:.52, moistureReturn:.94, capPersistence:.70, clearing:.43, frontalCoherence:.88, discreteBias:.13, thermodynamics:1.09, kinematics:1.10, forcingTiming:.94, moistureDepth:.97, lapseQuality:.86, failure:'surface_stability' },
    { id:'elevated-hail-mcs', archetype:'elevated_hail', weight:3.2, troughTilt:.47, moistureReturn:.90, capPersistence:.77, clearing:.36, frontalCoherence:.83, discreteBias:.20, thermodynamics:1.14, kinematics:1.06, forcingTiming:.88, moistureDepth:.92, lapseQuality:.94, failure:'surface_stability' }
  ]
};

function weightedPick(pool, random, narrative) {
  const preferred = narrativePreference(narrative);
  const weighted = pool.map(item => ({
    item,
    weight: item.weight * (preferred.has(item.archetype) ? 1.55 : 1)
  }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * total;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll <= 0) return entry.item;
  }
  return weighted.at(-1).item;
}

function narrativePreference(narrative) {
  const map = {
    isolated_supercells:['tornadic_supercells','cyclic_supercells','conditional_tornado','giant_hail'],
    loaded_gun:['conditional_tornado','tornadic_supercells','cyclic_supercells'],
    mixed_mode:['mixed_mode_outbreak','cyclic_supercells','qlcs'],
    hp_supercell:['tornadic_supercells','giant_hail','training_supercells_mcs'],
    classic_tornado_outbreak:['regional_tornado_outbreak','tornadic_supercells','mixed_mode_outbreak'],
    giant_hail:['giant_hail','cyclic_supercells'],
    progressive_mcs:['mcs','derecho','training_supercells_mcs'],
    qlcs:['qlcs','derecho'],
    derecho:['derecho','mcs'],
    elevated_mcs:['elevated_hail','mcs'],
    pulse_convection:['mcs','giant_hail'],
    cap_bust:['conditional_tornado','tornadic_supercells'],
    stable_day:['training_supercells_mcs']
  };
  return new Set(map[narrative] ?? []);
}

export function chooseAnalogBlend(random, family, narrative = null, options = {}) {
  const pool = ANALOGS[family] ?? ANALOGS.shortwave_ejection;
  const a = weightedPick(pool, random, narrative);
  const b = weightedPick(pool, random, narrative);
  const blend = 0.62 + random() * 0.25;
  const mix = key => a[key] * blend + b[key] * (1 - blend);
  const historicalAnalogs = chooseHistoricalAnalogs(random, family, narrative, options);
  const historical = summarizeHistoricalGuidance(historicalAnalogs);
  const guided = (syntheticKey, historicalKey, transform = value => value) => {
    const base = mix(syntheticKey);
    if (!historical) return base;
    return base * (1 - historical.influence) + transform(historical.pattern[historicalKey]) * historical.influence;
  };
  return {
    family,
    archetype: a.archetype,
    members:[a.id,b.id],
    primary:a.id,
    troughTilt:guided('troughTilt','troughTilt',value=>clamp01(Math.abs(value))),
    moistureReturn:guided('moistureReturn','moistureQuality',clamp01),
    capPersistence:guided('capPersistence','capStrength',clamp01),
    clearing:mix('clearing'),
    frontalCoherence:guided('frontalCoherence','forcingTiming',clamp01),
    discreteBias:guided('discreteBias','discreteBias',clamp01),
    thermodynamics:mix('thermodynamics'),
    kinematics:historical?mix('kinematics')*(1-historical.influence)+(.82+historical.pattern.lowLevelJetStrength*.36)*historical.influence:mix('kinematics'),
    forcingTiming:guided('forcingTiming','forcingTiming',clamp01),
    moistureDepth:guided('moistureDepth','moistureQuality',clamp01),
    lapseQuality:mix('lapseQuality'),
    failureModes:[a.failure,b.failure].filter((v,i,s)=>s.indexOf(v)===i),
    historicalAnalogs,
    historicalInfluence:historical?.influence??0,
    historicalIntensityScore:historical?.intensityScore??null,
    historicalPattern:historical?.pattern??null,
    historicalResiduals:historical?.residuals??[],
    analogSource:historicalAnalogs.length?'NOAA Storm Events + ERA5':'synthetic-archetype-fallback',
    // This is metadata only. It must never be consumed by the outlook engine.
    generationOnly:true
  };
}

function chooseHistoricalAnalogs(random,family,narrative,options={}){
  if(!HISTORICAL_ANALOG_CATALOG.length)return[];
  const ranges={localized:[0,20],organized:[20,40],significant:[40,60],major:[60,80],exceptional:[80,101]};
  const constrained=Boolean(options.targetBand)||Number.isFinite(Number(options.minScore))||Number.isFinite(Number(options.maxScore));
  const range=ranges[options.targetBand]??[Number(options.minScore)||0,Number(options.maxScore)||101];
  let source=HISTORICAL_ANALOG_CATALOG.filter(record=>(Number(record.intensity?.score)||0)>=range[0]&&(Number(record.intensity?.score)||0)<range[1]);
  if(!source.length||(!constrained&&source.length<3))source=HISTORICAL_ANALOG_CATALOG;
  const target=options.targetScore??(constrained?(range[0]+range[1])/2:narrativeIntensity(narrative));
  const rows=source.map(record=>({record,distance:Math.abs((Number(record.intensity?.score)||0)-target)/100+(record.pattern?.family===family?0:.24)})).sort((a,b)=>a.distance-b.distance).slice(0,30);
  const weighted=rows.map(row=>({...row,weight:Math.exp(-row.distance/.18)*(.94+random()*.12)})),total=weighted.reduce((sum,row)=>sum+row.weight,0)||1;
  return weighted.map(row=>({analogId:row.record.analogId,eventDate:row.record.eventDate,intensityScore:row.record.intensity.score,intensityBand:row.record.intensity.band,weight:row.weight/total,distance:row.distance,pattern:row.record.pattern}));
}
function summarizeHistoricalGuidance(analogs){
  if(!analogs.length)return null;
  const keys=['troughAmplitude','troughTilt','lowLevelJetStrength','moistureQuality','capStrength','forcingTiming','discreteBias'];
  const pattern=Object.fromEntries(keys.map(key=>[key,analogs.reduce((sum,row)=>sum+(Number(row.pattern?.[key])||0)*row.weight,0)]));
  const intensityScore=analogs.reduce((sum,row)=>sum+(Number(row.intensityScore)||0)*row.weight,0);
  const meanDistance=analogs.reduce((sum,row)=>sum+row.distance*row.weight,0);
  const influence=clamp01((.16+.05*Math.log2(analogs.length+1))*Math.exp(-meanDistance/.42));
  const residuals=analogs.map(row=>({analogId:row.analogId,weight:row.weight,pattern:Object.fromEntries(keys.map(key=>[key,(Number(row.pattern?.[key])||0)-pattern[key]])),intensityResidual:(Number(row.intensityScore)||0)-intensityScore}));
  return{pattern,intensityScore,influence,residuals};
}
function clamp01(value){return Math.max(0,Math.min(1,Number(value)||0));}
function narrativeIntensity(narrative){
  if(['classic_tornado_outbreak','derecho'].includes(narrative))return 70;
  if(['mixed_mode','hp_supercell','giant_hail','qlcs'].includes(narrative))return 52;
  if(['isolated_supercells','loaded_gun','progressive_mcs'].includes(narrative))return 35;
  return 18;
}

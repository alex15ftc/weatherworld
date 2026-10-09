import { clamp } from '../scenarios/math.js';
import { sampleStormEnvironment, diagnoseStormMotion } from './environmentSampling.js';

export function initializeStormCoupling(world) {
  world.stormOutflows ??= [];
  world.stormEngine.outflowNextId ??= 1;
  world.stormEngine.totalOutflows ??= 0;
  world.stormEngine.totalBoundaryInteractions ??= 0;
}

// The air a storm ingests: sampled upstream of it along the storm-relative low-level inflow,
// beyond its own rain-cooled outflow (sampling at the storm itself measured its cold pool).
export function sampleEffectiveInflowEnvironment(world, storm) {
  const here = sampleStormEnvironment(world, storm.positionKm.x, storm.positionKm.y);
  const lowLevel = { e: 0.5 * (here.surfaceWind.eastKt + here.wind850.eastKt) * 1.852, n: 0.5 * (here.surfaceWind.northKt + here.wind850.northKt) * 1.852 };
  const relative = { e: lowLevel.e - storm.velocityKph.east, n: lowLevel.n - storm.velocityKph.north };
  const speed = Math.hypot(relative.e, relative.n);
  // Inflow arrives from where the storm-relative wind comes from (screen frame: y south).
  const ux = speed > 0.1 ? -relative.e / speed : 1;
  const uy = speed > 0.1 ? relative.n / speed : 0;
  const offsets = [10, 25, 40], weights = [0.3, 0.4, 0.3];
  const samples = offsets.map(d => sampleStormEnvironment(world, storm.positionKm.x + ux*d, storm.positionKm.y + uy*d));
  const blend = key => samples.reduce((sum, env, i) => sum + (env[key] ?? 0) * weights[i], 0);
  const vectorBlend = key => ({
    eastKt: samples.reduce((sum, env, i) => sum + (env[key]?.eastKt ?? 0) * weights[i], 0),
    northKt: samples.reduce((sum, env, i) => sum + (env[key]?.northKt ?? 0) * weights[i], 0)
  });
  const base = { ...samples[0] };
  for (const key of ['cape','cin','srh','stp','rawStp','vtp','synopticTornadoSupport','scp','bulkShear','lcl','readiness','trigger','initiation','forcing','stormCoverage','discreteFraction','linearFraction','warmSector','openWarmSectorSupport','projectedStormTrackSupport','prefrontalSupercellSupport','tornadicEnvironmentSupport','synopticAscent','synopticCoherence','moisturePooling','capErosion','boundaryInfluence','processedAir','outflowConvergence']) base[key] = blend(key);
  base.surfaceWind = vectorBlend('surfaceWind'); base.wind850 = vectorBlend('wind850'); base.wind500 = vectorBlend('wind500');
  base.effectiveInflowSamples = offsets.length; base.effectiveInflowDistanceKm = offsets.at(-1);
  return base;
}

export function updateCoupledStormMotion(world, storm, environment, dtHours) {
  const boundary = diagnoseBoundaryInteraction(world, storm);
  const target = diagnoseStormMotion({ ...environment, boundaryPropagation: boundary.propagation, coldPoolPropagation: storm.coldPoolPropagation ?? {east:0,north:0} }, storm.mode);
  const responseHours = ['MCS','QLCS'].includes(storm.mode) ? 0.35 : storm.mode?.includes('supercell') ? 0.50 : 0.70;
  const blend = clamp(dtHours / responseHours, 0, 1);
  storm.velocityKph.east += (target.east - storm.velocityKph.east) * blend;
  storm.velocityKph.north += (target.north - storm.velocityKph.north) * blend;
  storm.boundaryInteraction = boundary;
  if (boundary.strength > 0.28) { storm.boundaryInteractionCount = (storm.boundaryInteractionCount ?? 0) + 1; world.stormEngine.totalBoundaryInteractions++; }
}

export function updateStormColdPool(world, storm, environment, dtHours) {
  const linear = ['broken line','linear segment','QLCS with embedded supercells','QLCS','MCS'].includes(storm.mode);
  const dryness = clamp(((environment.lcl ?? 1000)-750)/1700,0,1);
  const targetDeficitF = clamp(1.2 + 8.5*storm.intensity*(0.65 + 0.35*dryness), 0.5, 12);
  storm.coldPoolTemperatureDeficitF ??= 0; storm.coldPoolPressureRiseHpa ??= 0;
  storm.coldPoolTemperatureDeficitF += (targetDeficitF-storm.coldPoolTemperatureDeficitF)*clamp(dtHours*0.9,0,1);
  storm.coldPoolPressureRiseHpa += ((0.35+storm.coldPoolTemperatureDeficitF*0.32)-storm.coldPoolPressureRiseHpa)*clamp(dtHours*0.8,0,1);
  const motion = Math.hypot(storm.velocityKph.east, storm.velocityKph.north)||1;
  const propagationSpeed = clamp(5+storm.coldPoolStrength*(linear?28:18),4,34);
  storm.coldPoolPropagation = { east: storm.velocityKph.east/motion*propagationSpeed, north: storm.velocityKph.north/motion*propagationSpeed };
  if (storm.ageHours>=0.65 && storm.intensity>=0.22 && storm.coldPoolStrength>=0.10) upsertOutflow(world,storm);
}

export function advanceStormOutflows(world, dtHours) {
  initializeStormCoupling(world);
  const activeIds = new Set((world.storms??[]).filter(s=>s.active).map(s=>s.id));
  for (const o of world.stormOutflows) {
    o.ageHours += dtHours; o.radiusKm += o.expansionKph*dtHours; o.centerKm.x += o.velocityKph.east*dtHours; o.centerKm.y -= o.velocityKph.north*dtHours;
    o.strength = activeIds.has(o.sourceStormId) ? clamp(o.strength+dtHours*0.02,0,1) : o.strength*Math.max(0,1-dtHours*0.11);
    o.active = o.strength>0.08 && o.ageHours<12 && o.centerKm.x>-100 && o.centerKm.y>-100 && o.centerKm.x<world.domainWidthKm+100 && o.centerKm.y<world.domainHeightKm+100;
  }
  world.stormOutflows = world.stormOutflows.filter(o=>o.active).slice(-160);
}

function upsertOutflow(world, storm) {
  initializeStormCoupling(world);
  let o = world.stormOutflows.find(x=>x.sourceStormId===storm.id && x.active);
  const expansionKph = clamp(7+storm.coldPoolStrength*25,6,32);
  if (!o) {
    o={id:`O${String(world.stormEngine.outflowNextId++).padStart(4,'0')}`,sourceStormId:storm.id,centerKm:{...storm.positionKm},radiusKm:Math.max(5,storm.coldPoolRadiusKm*0.55),strength:clamp(storm.coldPoolStrength*storm.intensity*1.8,0.08,1),expansionKph,velocityKph:{east:storm.velocityKph.east*0.25,north:storm.velocityKph.north*0.25},ageHours:0,active:true};
    world.stormOutflows.push(o); world.stormEngine.totalOutflows++;
  } else { o.strength=Math.max(o.strength,clamp(storm.coldPoolStrength*storm.intensity*1.8,0,1)); o.expansionKph=Math.max(o.expansionKph,expansionKph); }
  storm.outflowBoundaryId=o.id;
}

function diagnoseBoundaryInteraction(world, storm) {
  let best={strength:0,type:null,id:null,propagation:{east:0,north:0}};
  for (const b of world.mesoscale?.boundaries??[]) for (const p of b.pointsKm??[]) {
    const d=Math.hypot(p.x-storm.positionKm.x,p.y-storm.positionKm.y), influence=Math.exp(-Math.pow(d/Math.max(12,b.widthKm??25),2))*(b.strength??0);
    if (influence>best.strength) best={strength:influence,type:b.type,id:b.id,propagation:{east:(b.velocityKph?.east??0)*influence*0.35,north:(b.velocityKph?.north??0)*influence*0.35}};
  }
  for (const o of world.stormOutflows??[]) {
    if (!o.active||o.sourceStormId===storm.id) continue;
    const d=Math.hypot(o.centerKm.x-storm.positionKm.x,o.centerKm.y-storm.positionKm.y), influence=Math.exp(-Math.pow(Math.abs(d-o.radiusKm)/12,2))*o.strength;
    if (influence>best.strength) { const ux=d>0?(storm.positionKm.x-o.centerKm.x)/d:1, uy=d>0?-(storm.positionKm.y-o.centerKm.y)/d:0; best={strength:influence,type:'outflow',id:o.id,propagation:{east:ux*o.expansionKph*influence,north:uy*o.expansionKph*influence}}; }
  }
  return best;
}

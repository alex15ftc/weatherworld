import { reconcileSynopticState } from './DynamicSynopticReconciliation.js';
import { applyBoundaryAirMassDynamics } from './BoundaryAirMassEngine.js';
import { clamp } from '../scenarios/math.js';
import { sampleSynopticPattern } from '../scenarios/synopticPattern.js';
import { effectivePatternHours, effectivePatternRate, activeLifecycle, waveAt } from '../scenarios/ActivePattern.js';

export function initializeSynopticObjects(world, config = world.evolution?.config ?? world.scenarioMetadata) {
  world.synopticObjects = buildSynopticObjects(world, config, 0, null, 0);
  applyCoupledAtmosphericDynamics(world, 0);
  projectSynopticObjectSectors(world);
  // 2.69.1: establish boundary-relative air-mass sectors before the first
  // sounding/STP calculation. A zero-hour solve classifies and validates the
  // initial state without translating the boundaries.
  applyBoundaryAirMassDynamics(world, 0);
  return world.synopticObjects;
}

export function advanceSynopticObjects(world, dtHours = 1) {
  const config = world.evolution?.config ?? world.scenarioMetadata;
  const elapsed = Number(world.evolution?.elapsedHours) || 0;
  const previous = world.synopticObjects;
  world.synopticObjects = buildSynopticObjects(world, config, elapsed, previous, dtHours);
  applyCoupledAtmosphericDynamics(world, dtHours);
  applyKinematicAtmosphericSolver(world, dtHours);
  reconcileSynopticState(world, dtHours);
  applyBoundaryAirMassDynamics(world, dtHours);
  projectSynopticObjectSectors(world);
  return world.synopticObjects;
}

function buildSynopticObjects(world, config, elapsedHours, previous = null, dtHours = 0) {
  const pattern = config?.synopticPattern;
  if (!pattern) return null;

  const interaction = diagnoseObjectInteraction(world, pattern, elapsedHours, previous);
  const phase = lifecyclePhase(elapsedHours, pattern, interaction);
  const phaseFactor = lifecycleStrengthFactor(phase, elapsedHours, pattern);
  const adjustedElapsed = elapsedHours + interaction.timingOffsetHours;
  const lowSample = sampleSynopticPattern(pattern, pattern.lowX, pattern.lowY, adjustedElapsed);
  const motionScale = clamp(0.78 + interaction.shortwaveCoupling * 0.22 - interaction.occlusionDrag * 0.18, 0.62, 1.15);
  const patternHours = effectivePatternHours(pattern.activeSequence, adjustedElapsed);
  const motionRate = effectivePatternRate(pattern.activeSequence, adjustedElapsed);
  const lowPoint = toWorldKm(world, config,
    pattern.lowX + pattern.motionXPerHour * patternHours * 0.92 * motionScale,
    pattern.lowY + pattern.motionYPerHour * patternHours * 0.75 * motionScale);

  let fronts = [];
  const topology = Array.isArray(pattern.boundaryTopology) ? pattern.boundaryTopology : ['cold','warm'];
  if (topology.includes('warm')) fronts.push(makeFront(world, config, pattern, adjustedElapsed, 'warm', phase, interaction));
  if (topology.includes('cold')) fronts.push(makeFront(world, config, pattern, adjustedElapsed, 'cold', phase, interaction));
  if (topology.includes('dryline') && pattern.drylineFactor > 0.2) fronts.push(makeFront(world, config, pattern, adjustedElapsed, 'dryline', phase, interaction));
  const alignment = solveAtmosphericConstraints(world, fronts, lowPoint, previous, dtHours);
  fronts = alignment.fronts;

  const lowDepth = clamp((1018 - lowSample.seaLevelPressureHpa) / 32, 0, 1);
  const intensity = clamp(lowDepth * phaseFactor + interaction.shortwaveCoupling * 0.12, 0, 1);
  const previousBudget = previous?.convectiveBudget;
  const baseCapacity = clamp((9 + pattern.intensity * 14 + intensity * 7 + lowSample.shortwaveCore * 5) * (0.82 + 0.18 * phaseFactor), 7, 34);
  const rechargeContext = diagnoseRechargeContext(world, lowSample, interaction, phase);
  const recharge = dtHours > 0
    ? dtHours * clamp(rechargeContext.rechargeRate, 0, 0.62)
    : 0;
  let remaining = clamp((previousBudget?.remaining ?? baseCapacity) + recharge, 0, baseCapacity);
  // Each day's wave in an active sequence brings fresh moisture and forcing: refill the
  // budget when a new wave begins (otherwise Day 1 left ~1 storm per 8 h for Days 2-3).
  const waveIndex = pattern.activeSequence ? waveAt(pattern.activeSequence, elapsedHours).index : 0;
  if (pattern.activeSequence && previousBudget && previousBudget.waveIndex !== waveIndex) {
    const day = pattern.activeSequence.days[waveIndex];
    remaining = Math.max(remaining, baseCapacity * clamp(0.6 + 0.4 * day.strength, 0.6, 1));
  }

  const pressureAdjustment = -interaction.shortwaveCoupling * 2.2 + interaction.occlusionDrag * 1.4;
  const surfaceLow = {
    id: 'SFC-LOW-001', type: 'surface-low', positionKm: alignment.surfaceLowPositionKm ?? lowPoint,
    pressureHpa: lowSample.seaLevelPressureHpa + pressureAdjustment,
    intensity,
    velocityKph: scaleVelocity(velocityFromPattern(world, config, pattern, 0.92, 0.75), motionScale * motionRate),
    lifecyclePhase: phase,
    lifecycleProgress: lifecycleProgress(elapsedHours),
    ageHours: (previous?.surfaceLow?.ageHours ?? 0) + dtHours,
    interaction: { ...interaction }
  };

  return {
    version: 2,
    authoritative: true,
    elapsedHours,
    surfaceLow,
    fronts,
    triplePoint: diagnoseObjectTriplePoint(world, fronts, alignment.surfaceLowPositionKm ?? lowPoint, previous?.triplePoint),
    upperObjects: {
      shortwave: { id:'SW-001', type:'shortwave', intensity:clamp(lowSample.shortwaveCore,0,1), lifecyclePhase:phase },
      jetStreak: { id:'JET-001', type:'jet-streak', intensity:clamp(lowSample.jetCore,0,1), lifecyclePhase:phase }
    },
    interaction,
    environmentalTendencies: buildEnvironmentalTendencies(surfaceLow, fronts, lowSample, interaction, phase),
    convectiveMemory: diagnoseConvectiveMemory(world),
    alignment,
    objectConfidence: alignment.objectConfidence,
    atmosphericConsistency: alignment.atmosphericConsistency,
    constraintCorrections: alignment.constraintCorrections,
    convectiveBudget: {
      capacity: baseCapacity,
      remaining,
      consumed: previousBudget?.consumed ?? 0,
      recharged: (previousBudget?.recharged ?? 0) + recharge,
      rechargeRate: rechargeContext.rechargeRate,
      rechargeContext,
      // Per-segment initiation usage decays (6 h half-life). It used to persist for the whole
      // system, so Day 1 exhausted every boundary segment and later days got ~2 storms.
      segmentUsage: decaySegmentUsage(previousBudget?.segmentUsage, dtHours),
      lastUpdatedHour: elapsedHours,
      waveIndex
    }
  };
}

function makeFront(world, config, pattern, elapsedHours, type, phase, interaction) {
  const pointsKm = [];
  const n = 25;
  const phaseMotion = phase === 'developing' ? 0.82 : phase === 'mature' ? 1 : phase === 'occluding' ? 0.74 : 0.52;
  const interactionMotion = clamp(0.85 + interaction.shortwaveCoupling * 0.18 - interaction.occlusionDrag * 0.24, 0.55, 1.12);
  // Effective pattern time (daily ejection + overnight reload with an active sequence).
  const t = effectivePatternHours(pattern.activeSequence, elapsedHours) * phaseMotion * interactionMotion;
  const motionRate = effectivePatternRate(pattern.activeSequence, elapsedHours);
  for (let i=0;i<n;i++) {
    let nx, ny;
    if (type === 'warm') {
      nx = clamp((pattern.lowX + pattern.motionXPerHour * t * 0.92) + (i/(n-1))*0.65, 0, 1);
      ny = sampleSynopticPattern(pattern, nx, 0.5, t, true, elapsedHours).warmFrontY;
    } else {
      ny = clamp((pattern.lowY + pattern.motionYPerHour * t * 0.75) + (i/(n-1))*0.75, 0, 1);
      const sample = sampleSynopticPattern(pattern, 0.5, ny, t, true, elapsedHours);
      nx = type === 'cold' ? sample.coldFrontX : sample.drylineX;
    }
    pointsKm.push(toWorldKm(world, config, nx, ny));
  }
  const id = type === 'cold' ? 'OBJ-COLD-001' : type === 'warm' ? 'OBJ-WARM-001' : 'OBJ-DRYLINE-001';
  const phaseStrength = lifecycleStrengthFactor(phase, elapsedHours, pattern);
  return {
    id, type, pointsKm, authoritative:true,
    strength: clamp((0.44 + pattern.intensity * 0.38 + (type === 'dryline' ? pattern.drylineFactor * 0.12 : 0)) * phaseStrength, 0, 1),
    widthKm: type === 'dryline' ? 24 : 32,
    velocityKph: scaleVelocity(velocityFromPattern(world, config, pattern, type === 'warm' ? 0.72 : 1, type === 'warm' ? 0.45 : 1), phaseMotion * interactionMotion * motionRate),
    lifecyclePhase:phase,
    lifecycleProgress:lifecycleProgress(elapsedHours),
    segmentBudget: type === 'dryline' ? 4 : 3,
    parentId: 'SFC-LOW-001'
  };
}

function applyCoupledAtmosphericDynamics(world, dtHours = 1) {
  const objects=world.synopticObjects;
  if(!objects||dtHours<=0)return;
  const iterations=clamp(Math.ceil(2 + (1-(objects.atmosphericConsistency??.5))*2),2,4);
  const trend=[];
  for(let pass=0;pass<iterations;pass++){
    const before=diagnoseCoupledFieldState(world,objects);
    applyCoupledFieldPass(world,objects,dtHours/iterations,pass,iterations);
    const after=diagnoseCoupledFieldState(world,objects);
    trend.push({pass:pass+1,pressureErrorHpa:after.pressureErrorHpa,meanBoundaryMismatch:after.meanBoundaryMismatch,improvement:(before.pressureErrorHpa+before.meanBoundaryMismatch)-(after.pressureErrorHpa+after.meanBoundaryMismatch)});
    if(pass>0&&Math.abs(trend.at(-1).improvement)<0.002)break;
  }
  objects.coupledDynamics={iterations:trend.length,trend,converged:trend.length<iterations||Math.abs(trend.at(-1)?.improvement??1)<0.002,version:'2.56.0'};
}



function applyKinematicAtmosphericSolver(world, dtHours = 1) {
  const objects = world.synopticObjects;
  if (!objects || dtHours <= 0) return;
  const before = diagnoseKinematicBalance(world);
  const tendencies = new Map();
  world.forEachCell((cell, x, y) => {
    const pressureGradient = diagnosePressureGradient(world, x, y);
    const wind = solveKinematicWind(cell, pressureGradient, dtHours);
    const moisture = advectScalar(world, x, y, 'dewpoint', wind, dtHours, 0.12);
    const temperature = advectScalar(world, x, y, 'temperature', wind, dtHours, 0.10);
    const convergence = diagnoseMassConvergence(world, x, y, wind);
    const frontogenesis = diagnoseFrontogenesis(world, x, y);
    const jetDivergence = diagnoseJetDivergence(cell);
    const verticalVelocity = clamp(convergence * 0.48 + frontogenesis * 0.30 + jetDivergence * 0.22, -1, 1);
    tendencies.set(`${x},${y}`, { wind, moisture, temperature, convergence, frontogenesis, jetDivergence, verticalVelocity });
  });
  world.forEachCell((cell, x, y) => {
    const t = tendencies.get(`${x},${y}`); if (!t) return;
    cell.surface.wind.direction = vectorDirection(t.wind.eastKt, t.wind.northKt);
    cell.surface.wind.speed = clamp(Math.hypot(t.wind.eastKt, t.wind.northKt), 0, 80);
    cell.surface.dewpoint = clamp(t.moisture, -20, 80);
    cell.surface.temperature = clamp(t.temperature, -40, 130);
    cell.dynamics ??= {};
    cell.features ??= {};
    cell.dynamics.kinematicConvergence = clamp(t.convergence, -1, 1);
    cell.dynamics.verticalVelocity = t.verticalVelocity;
    cell.features.frontogenesis = t.frontogenesis;
    cell.features.jetDivergence = t.jetDivergence;
    cell.features.boundaryConvergence = clamp((Number(cell.features.boundaryConvergence)||0) * 0.72 + Math.max(0,t.convergence) * 0.28, 0, 1);
    if (cell.derived) {
      const thermalMoisture = clamp((cell.surface.temperature - cell.surface.dewpoint) / 35, 0, 1);
      cell.derived.cin = clamp((Number(cell.derived.cin)||0) * (0.94 + thermalMoisture * 0.08) - Math.max(0,t.verticalVelocity) * 7 * dtHours, 0, 700);
      cell.derived.cape = clamp((Number(cell.derived.cape)||0) + (cell.surface.dewpoint - t.moisture) * 18 - Math.max(0,-t.verticalVelocity) * 15, 0, 9000);
    }
  });
  const after = diagnoseKinematicBalance(world);
  objects.kinematicDynamics = {
    version: '2.56.0',
    pressureGradientRmse: after.pressureGradientRmse,
    windBalanceError: after.windBalanceError,
    moistureAdvectionError: after.moistureAdvectionError,
    thermalAdvectionError: after.thermalAdvectionError,
    massContinuityError: after.massContinuityError,
    verticalMotionOverlap: after.verticalMotionOverlap,
    atmosphericHealth: clamp(1 - (after.windBalanceError*0.24 + after.moistureAdvectionError*0.18 + after.thermalAdvectionError*0.16 + after.massContinuityError*0.24 + (1-after.verticalMotionOverlap)*0.18), 0, 1),
    improvement: (before.windBalanceError + before.massContinuityError) - (after.windBalanceError + after.massContinuityError)
  };
}

function diagnosePressureGradient(world, x, y) {
  const west=world.getCell(x-1,y), east=world.getCell(x+1,y), south=world.getCell(x,y-1), north=world.getCell(x,y+1), center=world.getCell(x,y);
  const p=c=>Number(c?.surface?.pressure ?? center?.surface?.pressure ?? 1013);
  return { eastHpaPerKm:(p(east)-p(west))/(2*world.cellSizeKm), northHpaPerKm:(p(north)-p(south))/(2*world.cellSizeKm) };
}
function solveKinematicWind(cell, gradient, dtHours) {
  const current=windVector(cell.surface?.wind);
  const pressureEast=-gradient.eastHpaPerKm*28, pressureNorth=-gradient.northHpaPerKm*28;
  const coriolis={east:-current.northKt*0.035,north:current.eastKt*0.035};
  const friction=0.08;
  return {eastKt:current.eastKt+(pressureEast+coriolis.east-current.eastKt*friction)*dtHours,northKt:current.northKt+(pressureNorth+coriolis.north-current.northKt*friction)*dtHours};
}
function advectScalar(world,x,y,key,wind,dtHours,mix){
  const cell=world.getCell(x,y); const current=Number(cell?.surface?.[key])||0;
  const backX=clamp(Math.round(x-wind.eastKt*1.852*dtHours/world.cellSizeKm),0,world.width-1);
  const backY=clamp(Math.round(y-wind.northKt*1.852*dtHours/world.cellSizeKm),0,world.height-1);
  const upstream=Number(world.getCell(backX,backY)?.surface?.[key]);
  return Number.isFinite(upstream)?current+(upstream-current)*clamp(mix*dtHours,0,0.45):current;
}
function diagnoseMassConvergence(world,x,y,wind){
  const east=windVector(world.getCell(x+1,y)?.surface?.wind), west=windVector(world.getCell(x-1,y)?.surface?.wind), north=windVector(world.getCell(x,y+1)?.surface?.wind), south=windVector(world.getCell(x,y-1)?.surface?.wind);
  return clamp(-(((east.eastKt-west.eastKt)+(north.northKt-south.northKt))/(2*world.cellSizeKm*8)), -1, 1);
}
function diagnoseFrontogenesis(world,x,y){
  const c=world.getCell(x,y),e=world.getCell(x+1,y),n=world.getCell(x,y+1); if(!c||!e||!n)return 0;
  const tg=Math.hypot((Number(e.surface?.temperature)||0)-(Number(c.surface?.temperature)||0),(Number(n.surface?.temperature)||0)-(Number(c.surface?.temperature)||0));
  const dg=Math.hypot((Number(e.surface?.dewpoint)||0)-(Number(c.surface?.dewpoint)||0),(Number(n.surface?.dewpoint)||0)-(Number(c.surface?.dewpoint)||0));
  return clamp(tg/12+dg/18,0,1);
}
function diagnoseJetDivergence(cell){const w250=cell.levels?.[250],w500=cell.levels?.[500];return clamp(((Number(w250?.windSpeed)||0)-(Number(w500?.windSpeed)||0))/120,0,1);}
function windVector(w={}){const speed=Number(w?.speed)||0,dir=(Number(w?.direction)||0)*Math.PI/180;return{eastKt:-Math.sin(dir)*speed,northKt:-Math.cos(dir)*speed};}
function vectorDirection(east,north){return(Math.atan2(-east,-north)*180/Math.PI+360)%360;}
function diagnoseKinematicBalance(world){let n=0,pg=0,wb=0,ma=0,ta=0,mc=0,vm=0;world.forEachCell((cell,x,y)=>{const g=diagnosePressureGradient(world,x,y),w=windVector(cell.surface?.wind);pg+=Math.hypot(g.eastHpaPerKm,g.northHpaPerKm);wb+=clamp(Math.abs(w.eastKt+g.eastHpaPerKm*28)+Math.abs(w.northKt+g.northHpaPerKm*28),0,80)/80;ma+=clamp(Math.abs(Number(cell.surface?.dewpoint)-Number(world.getCell(Math.max(0,x-1),y)?.surface?.dewpoint||cell.surface?.dewpoint))/30,0,1);ta+=clamp(Math.abs(Number(cell.surface?.temperature)-Number(world.getCell(x,Math.max(0,y-1))?.surface?.temperature||cell.surface?.temperature))/35,0,1);const conv=Math.abs(Number(cell.dynamics?.kinematicConvergence)||0);mc+=conv;vm+=Math.max(0,Number(cell.dynamics?.verticalVelocity)||0)*Math.max(0,Number(cell.features?.boundaryConvergence)||0);n++;});return{pressureGradientRmse:n?pg/n:0,windBalanceError:n?wb/n:0,moistureAdvectionError:n?ma/n:0,thermalAdvectionError:n?ta/n:0,massContinuityError:n?mc/n:0,verticalMotionOverlap:n?clamp(vm/n*6,0,1):0};}

// Compatibility alias for 2.54.0 tests and callers.
function applyAtmosphericConstraintTendencies(world, dtHours = 1){ return applyCoupledAtmosphericDynamics(world,dtHours); }

function applyCoupledFieldPass(world,objects,dtHours,pass,iterations){
  const low=objects.surfaceLow;
  const tendencies=objects.environmentalTendencies??{};
  const confidence=clamp(Number(objects.objectConfidence?.overall)||0.4,0.08,0.98);
  const consistency=clamp(Number(objects.atmosphericConsistency)||0.4,0.05,1);
  const gain=clamp(0.16+(1-consistency)*0.22,0.16,0.36)/iterations;
  world.forEachCell((cell,x,y)=>{
    const xKm=(x+.5)*world.cellSizeKm,yKm=(y+.5)*world.cellSizeKm;
    const lowDistance=low?Math.hypot(xKm-low.positionKm.x,yKm-low.positionKm.y):Infinity;
    const lowKernel=Math.exp(-.5*Math.pow(lowDistance/260,2));
    if(lowKernel>.005&&Number.isFinite(Number(cell.surface?.pressure))){
      const radialRise=Math.min(8,(lowDistance/260)*3.4);
      const target=Number(low.pressureHpa)+radialRise;
      const current=Number(cell.surface.pressure);
      const maxStep=(0.16+0.22*(1-consistency))*dtHours*confidence;
      cell.surface.pressure=current+clamp((target-current)*gain*lowKernel,-maxStep,maxStep);
    }
    if(low&&cell.surface?.wind){
      const dx=xKm-low.positionKm.x,dy=yKm-low.positionKm.y;
      const angle=(Math.atan2(dx,-dy)*180/Math.PI+360)%360;
      const targetSpeed=clamp(8+low.intensity*28+lowKernel*14,3,55);
      cell.surface.wind.direction=blendAngle(cell.surface.wind.direction,angle,clamp(gain*lowKernel*0.7,0,0.18));
      cell.surface.wind.speed=clamp(cell.surface.wind.speed+(targetSpeed-cell.surface.wind.speed)*gain*lowKernel*0.45,2,70);
      if(cell.levels?.[850]){
        cell.levels[850].windDirection=blendAngle(cell.levels[850].windDirection,(angle+18)%360,clamp(gain*lowKernel*0.45,0,0.12));
        cell.levels[850].windSpeed=clamp(cell.levels[850].windSpeed+(targetSpeed*1.25-cell.levels[850].windSpeed)*gain*lowKernel*0.30,5,85);
      }
    }
    const warm=clamp(Number(cell.features?.synopticWarmSectorFraction)||0,0,1);
    const moistureSupport=clamp(Number(tendencies.moistureTransportSupport)||0.5,0,1);
    if(warm>.08&&Number.isFinite(Number(cell.surface?.dewpoint))){
      const targetTd=clamp(49+moistureSupport*19+warm*4,40,72);
      const processed=clamp(Number(cell.features?.stormProcessedAir)||0,0,1);
      cell.surface.dewpoint+=clamp((targetTd-cell.surface.dewpoint)*gain*warm*(1-processed*.7),-0.18,0.24);
    }
    const boundary=clamp(Number(cell.features?.primaryBoundaryInfluence)||0,0,1);
    if(boundary>.03){
      cell.features.boundaryConvergence=clamp((Number(cell.features.boundaryConvergence)||0)+boundary*confidence*gain*0.22,0,1);
      cell.features.synopticAscent=clamp((Number(cell.features.synopticAscent)||0)+boundary*confidence*gain*0.16,0,1);
    }
  });
}

function diagnoseCoupledFieldState(world,objects){
  let pressureErrorHpa=0,pressureN=0,boundaryMismatch=0,boundaryN=0;
  const low=objects.surfaceLow;
  world.forEachCell((cell,x,y)=>{
    const xKm=(x+.5)*world.cellSizeKm,yKm=(y+.5)*world.cellSizeKm;
    if(low&&Number.isFinite(Number(cell.surface?.pressure))){
      const d=Math.hypot(xKm-low.positionKm.x,yKm-low.positionKm.y);
      if(d<180){const target=Number(low.pressureHpa)+Math.min(6,(d/180)*2.5);pressureErrorHpa+=Math.abs(Number(cell.surface.pressure)-target);pressureN++;}
    }
    const influence=clamp(Number(cell.features?.primaryBoundaryInfluence)||0,0,1);
    if(influence>.1){boundaryMismatch+=Math.abs(influence-clamp(Number(cell.features?.boundaryConvergence)||0,0,1));boundaryN++;}
  });
  return{pressureErrorHpa:pressureN?pressureErrorHpa/pressureN:0,meanBoundaryMismatch:boundaryN?boundaryMismatch/boundaryN:0};
}

function blendAngle(a,b,w){const ar=(Number(a)||0)*Math.PI/180,br=(Number(b)||0)*Math.PI/180;const x=(1-w)*Math.cos(ar)+w*Math.cos(br),y=(1-w)*Math.sin(ar)+w*Math.sin(br);return(Math.atan2(y,x)*180/Math.PI+360)%360;}

function projectSynopticObjectSectors(world) {
  if (!world.synopticObjects) return;
  const config = world.evolution?.config ?? world.scenarioMetadata;
  const pattern = config?.synopticPattern;
  const elapsed = Number(world.evolution?.elapsedHours) || 0;
  let warmCount = 0;
  let warmDewpointSum = 0;
  world.forEachCell((cell,x,y) => {
    const display = { x:(x+0.5)/world.width, y:(y+0.5)/world.height };
    const native = fromDisplay(display.x, display.y, config);
    const sample = sampleSynopticPattern(pattern, native.x, native.y, elapsed);
    const objectFraction = warmSectorFromObjects(world.synopticObjects, (x + 0.5) * world.cellSizeKm, (y + 0.5) * world.cellSizeKm);
    const sampledFraction = clamp(sample.warmSector, 0, 1);
    const prior = Number(cell.features?.synopticWarmSectorFraction);
    const broader = clamp(Number(cell.forecast?.openWarmSectorSupport) || 0, 0, 1);
    let target = clamp(Math.max(sampledFraction * 0.55 + objectFraction * 0.45, broader * 0.55), 0, 1);
    if (Number.isFinite(prior)) target = clamp(target, Math.max(0, prior - 0.24), Math.min(1, prior + 0.24));
    const fraction = target;
    cell.features.synopticWarmSectorFraction = fraction;
    cell.features.warmSector = fraction > 0.30;
    cell.features.synopticSector = fraction > 0.30 ? 'warm' : sample.hotDry > 0.45 ? 'dry' : sample.postFrontal > 0.45 ? 'post-frontal' : 'cool';
    projectBoundaryInfluences(world.synopticObjects, cell, (x + 0.5) * world.cellSizeKm, (y + 0.5) * world.cellSizeKm);
    if (cell.features.warmSector) {
      warmCount++;
      warmDewpointSum += Number(cell.surface?.dewpoint) || 0;
    }
  });
  world.synopticObjects.warmSectorCoverage = warmCount / Math.max(1, world.width * world.height);
  world.synopticObjects.meanWarmSectorDewpointF = warmCount ? warmDewpointSum / warmCount : null;
}


// Compatibility alias retained for the 2.53.0 staged migration regression.
function alignSynopticObjectsToGrid(world, fronts, lowPoint, previous) { return solveAtmosphericConstraints(world, fronts, lowPoint, previous, 1); }

function solveAtmosphericConstraints(world, fronts, lowPoint, previous, dtHours = 1) {
  const pressureMinimum = diagnosePressureMinimum(world);
  const previousLow = previous?.surfaceLow?.positionKm;
  const lowErrorKm = pressureMinimum ? Math.hypot(pressureMinimum.x - lowPoint.x, pressureMinimum.y - lowPoint.y) : null;
  const priorLowConfidence = clamp(Number(previous?.objectConfidence?.surfaceLow) || 0.58, 0.08, 0.98);
  const pressureAgreement = Number.isFinite(lowErrorKm) ? Math.exp(-lowErrorKm / 260) : 0.25;
  const lowConfidence = clamp(priorLowConfidence * 0.72 + pressureAgreement * 0.28, 0.08, 0.98);
  const lowTarget = pressureMinimum ?? lowPoint;
  const lowCorrection = boundedVectorCorrection(lowPoint, lowTarget, clamp((1-lowConfidence)*0.30 + 0.06, 0.06, 0.28), adaptiveCorrectionLimit(previous?.surfaceLow, lowConfidence, dtHours, 28, 96));
  let correctedLow = lowCorrection.point;
  if (previousLow) correctedLow = limitMotionFromPrevious(previousLow, correctedLow, 65 * Math.max(1, dtHours));

  const rows = [];
  const confidenceByType = {};
  const corrections = [];
  const correctedFronts = fronts.map(front => {
    const diagnosed = diagnoseFrontGradient(world, front.type);
    const prior = previous?.fronts?.find(item => item.id === front.id);
    if (!diagnosed) {
      const confidence = clamp((Number(prior?.confidence) || 0.45) * 0.86, 0.08, 0.95);
      confidenceByType[front.type] = confidence;
      rows.push({ id:front.id, type:front.type, displacementKm:null, confidence, appliedWeight:0, correctionKm:0 });
      return { ...front, confidence };
    }
    const center = polylineCentroid(front.pointsKm);
    const displacementKm = Math.hypot(diagnosed.x-center.x, diagnosed.y-center.y);
    const priorConfidence = clamp(Number(prior?.confidence ?? prior?.alignmentConfidence) || 0.52, 0.08, 0.98);
    const agreement = Math.exp(-displacementKm / 180) * diagnosed.confidence;
    const confidence = clamp(priorConfidence*0.68 + agreement*0.32, 0.08, 0.98);
    const weight = clamp(0.06 + (1-confidence)*0.22 + diagnosed.confidence*0.07, 0.06, 0.30);
    const vector = boundedVectorCorrection(center, diagnosed, weight, adaptiveCorrectionLimit(prior, confidence, dtHours, 24, 84));
    let dx=vector.point.x-center.x, dy=vector.point.y-center.y;
    if (prior?.pointsKm?.length) {
      const priorCenter=polylineCentroid(prior.pointsKm);
      const futureCenter={x:center.x+dx,y:center.y+dy};
      const limited=limitMotionFromPrevious(priorCenter,futureCenter,adaptiveCorrectionLimit(prior,confidence,dtHours,42,118));
      dx=limited.x-center.x; dy=limited.y-center.y;
    }
    const correctionKm=Math.hypot(dx,dy);
    confidenceByType[front.type]=confidence;
    rows.push({id:front.id,type:front.type,displacementKm,confidence,diagnosticConfidence:diagnosed.confidence,appliedWeight:weight,correctionKm});
    corrections.push({objectId:front.id,type:front.type,correctionKm,residualErrorKm:Math.max(0,displacementKm-correctionKm)});
    return {...front,pointsKm:front.pointsKm.map(pt=>({x:pt.x+dx,y:pt.y+dy})),alignmentConfidence:diagnosed.confidence,confidence,diagnosedDisplacementKm:displacementKm,constraintCorrectionKm:correctionKm};
  });

  const frontErrors=rows.map(r=>r.displacementKm).filter(Number.isFinite);
  const meanFrontError=frontErrors.length?frontErrors.reduce((a,b)=>a+b,0)/frontErrors.length:null;
  const lowResidual=Number.isFinite(lowErrorKm)?Math.max(0,lowErrorKm-lowCorrection.distanceKm):null;
  const residuals=corrections.map(c=>c.residualErrorKm).filter(Number.isFinite);
  const meanResidual=residuals.length?residuals.reduce((a,b)=>a+b,0)/residuals.length:null;
  const pressureScore=Number.isFinite(lowResidual)?Math.exp(-lowResidual/300):0.5;
  const frontScore=Number.isFinite(meanResidual)?Math.exp(-meanResidual/210):0.5;
  const correctionEfficiency=clamp(((Number.isFinite(lowErrorKm)?lowCorrection.distanceKm/Math.max(1,lowErrorKm):0)+(frontErrors.length?corrections.reduce((a,c)=>a+c.correctionKm/Math.max(1,c.correctionKm+c.residualErrorKm),0)/frontErrors.length:0))/2,0,1);
  const continuityScore=clamp(1-(lowCorrection.distanceKm/adaptiveCorrectionLimit(previous?.surfaceLow,lowConfidence,dtHours,28,96)),0,1);
  const atmosphericConsistency=clamp(pressureScore*0.34+frontScore*0.42+correctionEfficiency*0.16+continuityScore*0.08,0,1);
  return {
    fronts:correctedFronts,
    surfaceLowPositionKm:correctedLow,
    surfaceLowFieldErrorKm:lowErrorKm,
    frontsDiagnostics:rows,
    objectConfidence:{surfaceLow:lowConfidence,fronts:confidenceByType,overall:clamp((lowConfidence+(Object.values(confidenceByType).reduce((a,b)=>a+b,0)||lowConfidence))/(1+Math.max(1,Object.keys(confidenceByType).length)),0,1)},
    atmosphericConsistency,
    constraintCorrections:[{objectId:'SFC-LOW-001',type:'surface-low',correctionKm:lowCorrection.distanceKm,residualErrorKm:Number.isFinite(lowErrorKm)?Math.max(0,lowErrorKm-lowCorrection.distanceKm):null},...corrections],
    solverVersion:'2.55.0'
  };
}


function adaptiveCorrectionLimit(object,confidence,dtHours,minKm,maxKm){
  const velocity=object?.velocityKph?Math.hypot(Number(object.velocityKph.east)||0,Number(object.velocityKph.north)||0):18;
  const phase=object?.lifecyclePhase;
  const phaseFactor=phase==='developing'?1.18:phase==='mature'?1:phase==='occluding'?.82:.70;
  const confidenceFactor=1.45-clamp(confidence,0,1)*.55;
  return clamp((velocity*Math.max(1,dtHours)*1.35+minKm)*phaseFactor*confidenceFactor,minKm,maxKm*Math.max(1,dtHours));
}
function boundedVectorCorrection(origin,target,weight,maxDistanceKm){
  const dx=(target?.x??origin.x)-origin.x,dy=(target?.y??origin.y)-origin.y;
  const distance=Math.hypot(dx,dy); if(!distance)return{point:{...origin},distanceKm:0};
  const requested=distance*weight,applied=Math.min(requested,maxDistanceKm),scale=applied/distance;
  return{point:{x:origin.x+dx*scale,y:origin.y+dy*scale},distanceKm:applied};
}
function limitMotionFromPrevious(previous,next,maxDistanceKm){const dx=next.x-previous.x,dy=next.y-previous.y,d=Math.hypot(dx,dy);if(!d||d<=maxDistanceKm)return next;const s=maxDistanceKm/d;return{x:previous.x+dx*s,y:previous.y+dy*s};}

function diagnosePressureMinimum(world) {
  let best=null, p=Infinity;
  world.forEachCell((cell,x,y)=>{ const value=Number(cell.surface?.pressure ?? cell.surface?.pressureHpa); if(Number.isFinite(value)&&value<p){p=value;best={x:(x+.5)*world.cellSizeKm,y:(y+.5)*world.cellSizeKm,pressureHpa:value};}});
  return best;
}

function diagnoseFrontGradient(world,type) {
  let sx=0,sy=0,sw=0,max=0;
  world.forEachCell((cell,x,y)=>{
    const east=world.getCell(x+1,y), north=world.getCell(x,y+1); if(!east||!north)return;
    const td=Number(cell.surface?.dewpoint)||0, t=Number(cell.surface?.temperature)||0;
    const tdg=Math.hypot((Number(east.surface?.dewpoint)||td)-td,(Number(north.surface?.dewpoint)||td)-td);
    const tg=Math.hypot((Number(east.surface?.temperature)||t)-t,(Number(north.surface?.temperature)||t)-t);
    const windShift=clamp(Number(cell.features?.boundaryConvergence)||0,0,1);
    const score=type==='dryline'?tdg/12+windShift*.35:type==='warm'?tg/10+tdg/18+windShift*.3:tg/8+windShift*.45;
    if(score>.18){const w=Math.min(2,score);sx+=(x+.5)*world.cellSizeKm*w;sy+=(y+.5)*world.cellSizeKm*w;sw+=w;max=Math.max(max,score);}
  });
  return sw?{x:sx/sw,y:sy/sw,confidence:clamp(max/1.5,0,1)}:null;
}

function polylineCentroid(points=[]) { if(!points.length)return{x:0,y:0}; return {x:points.reduce((a,p)=>a+p.x,0)/points.length,y:points.reduce((a,p)=>a+p.y,0)/points.length}; }
function distanceToPolyline(x,y,points=[]) { let best=Infinity; for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;const t=l2?clamp(((x-a.x)*dx+(y-a.y)*dy)/l2,0,1):0;best=Math.min(best,Math.hypot(x-(a.x+t*dx),y-(a.y+t*dy)));} return best; }
function warmSectorFromObjects(objects,x,y) {
  if(!objects?.fronts?.length)return 0;
  const warm=objects.fronts.find(f=>f.type==='warm'), cold=objects.fronts.find(f=>f.type==='cold'), dry=objects.fronts.find(f=>f.type==='dryline');
  const warmD=warm?distanceToPolyline(x,y,warm.pointsKm):180, coldD=cold?distanceToPolyline(x,y,cold.pointsKm):180, dryD=dry?distanceToPolyline(x,y,dry.pointsKm):180;
  return clamp((warm?Math.exp(-warmD/180):.55)*(cold?(.45+.55*Math.exp(-coldD/260)):.8)*(dry?(.35+.65*Math.exp(-dryD/220)):.8),0,1);
}
function projectBoundaryInfluences(objects,cell,x,y) {
  const influences={}; let primary=null, best=0;
  for(const front of objects?.fronts??[]){const d=distanceToPolyline(x,y,front.pointsKm);const width=Math.max(18,Number(front.widthKm)||30);const value=clamp(Math.exp(-d/(width*1.8))*(.45+.55*(front.strength??.5)),0,1);influences[front.type]={id:front.id,distanceKm:d,influence:value};if(value>best){best=value;primary=front;}}
  cell.features.synopticBoundaryInfluences=influences;
  cell.features.primaryBoundaryInfluence=best;
  if(primary&&best>.12){cell.features.primaryBoundaryId=primary.id;cell.features.primaryBoundaryType=primary.type;cell.features.explicitBoundaryInfluence=Math.max(Number(cell.features.explicitBoundaryInfluence)||0,best);}
}

export function diagnoseSynopticInitiationBudget(world, corridorId, candidate = {}) {
  const objects = world.synopticObjects;
  const budget = objects?.convectiveBudget;
  if (!budget) return { allowed: true, cost: 1, remainingBefore: null, remainingAfter: null, parentId: null };
  const boundaryMatch = /^boundary:(OBJ-[^:]+):segment:(\d+)/.exec(String(corridorId ?? ''));
  const segmentKey = boundaryMatch ? `${boundaryMatch[1]}:segment:${boundaryMatch[2]}` : `generic:${corridorId ?? 'unknown'}`;
  const used = Number(budget.segmentUsage?.[segmentKey]) || 0;
  const front = boundaryMatch ? objects.fronts?.find(item => item.id === boundaryMatch[1]) : null;
  const segmentLimit = front?.segmentBudget ?? 2;
  const strength = clamp(Number(candidate.corridorStrength) || 0, 0, 1);
  const secondary = Boolean(candidate.secondaryOutflow);
  const processedPenalty = clamp(Number(candidate.processedAir ?? candidate.stormProcessedAir) || 0, 0, 1);
  const cost = secondary ? 0.9 : clamp(1.25 + strength * 0.95 + processedPenalty * 0.8, 1.25, 2.7);
  const allowed = budget.remaining >= cost && (secondary || used < segmentLimit) && processedPenalty < 0.72;
  return { allowed, cost, segmentKey, segmentUsed: used, segmentLimit, remainingBefore: budget.remaining, remainingAfter: Math.max(0, budget.remaining - cost), parentId: front?.parentId ?? objects.surfaceLow?.id ?? null };
}

export function consumeSynopticInitiationBudget(world, diagnosis) {
  const budget = world.synopticObjects?.convectiveBudget;
  if (!budget || !diagnosis?.allowed) return;
  budget.remaining = Math.max(0, budget.remaining - diagnosis.cost);
  budget.consumed = (budget.consumed ?? 0) + diagnosis.cost;
  budget.segmentUsage ??= {};
  budget.segmentUsage[diagnosis.segmentKey] = (budget.segmentUsage[diagnosis.segmentKey] ?? 0) + 1;
}

function diagnoseRechargeContext(world, lowSample, interaction, phase) {
  let cells = 0, fresh = 0, processed = 0, moisture = 0, heating = 0, capOpen = 0;
  world.forEachCell(cell => {
    const warm = clamp(Number(cell.features?.synopticWarmSectorFraction ?? (cell.features?.warmSector ? 1 : 0)) || 0, 0, 1);
    const corridor = clamp(Math.max(cell.features?.explicitBoundaryInfluence ?? 0, cell.mesoscaleFields?.convergenceCorridor ?? 0), 0, 1);
    const relevance = clamp(0.12 + warm * 0.58 + corridor * 0.30, 0.12, 1);
    cells += relevance;
    const worked = clamp(Number(cell.features?.stormProcessedAir) || 0, 0, 1);
    processed += worked * relevance;
    fresh += (1 - worked) * relevance;
    moisture += clamp(((Number(cell.surface?.dewpoint) || 35) - 45) / 25, 0, 1) * relevance;
    heating += clamp(((Number(cell.surface?.temperature) || 50) - 55) / 35, 0, 1) * relevance;
    capOpen += clamp(1 - (Number(cell.derived?.cinMagnitude ?? Math.abs(cell.derived?.cin ?? 0)) || 0) / 300, 0, 1) * relevance;
  });
  const denom = Math.max(1, cells);
  const freshAirFraction = fresh / denom;
  const processedAirFraction = processed / denom;
  const moistureSupport = moisture / denom;
  const heatingSupport = heating / denom;
  const capReleaseSupport = capOpen / denom;
  const lifecycleSupport = phase === 'developing' ? 0.72 : phase === 'mature' ? 1 : phase === 'occluding' ? 0.42 : 0.12;
  const forcingSupport = clamp(lowSample.shortwaveCore * 0.55 + lowSample.jetCore * 0.25 + interaction.shortwaveCoupling * 0.20, 0, 1);
  const rechargeRate = clamp(
    lifecycleSupport * (0.035 + 0.12 * freshAirFraction + 0.09 * moistureSupport + 0.07 * heatingSupport + 0.09 * capReleaseSupport + 0.13 * forcingSupport)
    - processedAirFraction * 0.52,
    0,
    0.42
  );
  return { freshAirFraction, processedAirFraction, moistureSupport, heatingSupport, capReleaseSupport, forcingSupport, lifecycleSupport, rechargeRate };
}

function diagnoseConvectiveMemory(world) {
  let n=0, processed=0, outflow=0, cloud=0;
  world.forEachCell(cell => {
    n++;
    processed += clamp(Number(cell.features?.stormProcessedAir) || 0,0,1);
    outflow += clamp(Number(cell.features?.stormOutflowConvergence) || 0,0,1);
    cloud += clamp(Number(cell.cloudCover ?? cell.features?.cloudCover) || 0,0,1);
  });
  n=Math.max(1,n);
  return { processedAirFraction:processed/n, outflowConvergenceMean:outflow/n, cloudFraction:cloud/n };
}

function diagnoseObjectInteraction(world, pattern, elapsedHours, previous) {
  const sample = sampleSynopticPattern(pattern, pattern.lowX, pattern.lowY, elapsedHours);
  const shortwaveCoupling = clamp(sample.shortwaveCore * (0.55 + sample.jetCore * 0.35), 0, 1);
  const priorPhase = previous?.surfaceLow?.lifecyclePhase;
  // With an active sequence each day's wave occludes on its own clock rather than the system's age.
  const occlusionClock = pattern.activeSequence ? waveAt(pattern.activeSequence, elapsedHours).hoursIntoDay : elapsedHours;
  const occlusionDrag = clamp((priorPhase === 'occluding' ? 0.55 : priorPhase === 'decaying' ? 0.9 : 0) + occlusionClock / 96, 0, 1);
  return {
    shortwaveCoupling,
    jetCoupling:clamp(sample.jetCore,0,1),
    occlusionDrag,
    timingOffsetHours:clamp((shortwaveCoupling - 0.5) * 1.5, -0.75, 0.75)
  };
}

function buildEnvironmentalTendencies(low, fronts, sample, interaction, phase) {
  return {
    pressureDeepeningHpaPerHour: clamp(interaction.shortwaveCoupling * 0.65 - interaction.occlusionDrag * 0.45, -0.35, 0.65),
    lowLevelWindResponse: clamp(low.intensity * 0.55 + interaction.shortwaveCoupling * 0.25, 0, 1),
    moistureTransportSupport: clamp(sample.lowLevelJetCore * 0.5 + interaction.jetCoupling * 0.2 + low.intensity * 0.2, 0, 1),
    frontalConvergenceSupport: clamp(fronts.reduce((s,f)=>s+f.strength,0) / Math.max(1,fronts.length), 0, 1),
    lifecyclePhase: phase
  };
}

function diagnoseObjectTriplePoint(world, fronts, lowPoint, previous = null) {
  const warm = fronts.find(f=>f.type==='warm');
  const trailing = fronts.find(f=>f.type==='dryline') ?? fronts.find(f=>f.type==='cold');
  if (!warm || !trailing) return null;
  let best = null;
  for (const a of warm.pointsKm) for (const b of trailing.pointsKm) {
    const d=Math.hypot(a.x-b.x,a.y-b.y);
    if(!best||d<best.d)best={d,x:(a.x+b.x)/2,y:(a.y+b.y)/2};
  }
  if(!best||best.d>160)return null;
  const fieldSupport=sampleTriplePointSupport(world,best.x,best.y);
  const geometryConfidence=clamp(1-best.d/160,0,1);
  const distanceFromLowKm=Math.hypot(best.x-lowPoint.x,best.y-lowPoint.y);
  const lowAttachment=Math.exp(-distanceFromLowKm/150);
  let confidence=clamp(geometryConfidence*.45+fieldSupport*.35+lowAttachment*.20,0,1);
  let x=best.x,y=best.y;
  if(previous&&Number.isFinite(previous.x)&&Number.isFinite(previous.y)){
    const continuity=Math.exp(-Math.hypot(x-previous.x,y-previous.y)/100);
    confidence=clamp(confidence*.82+continuity*.18,0,1);
    const limited=limitMotionFromPrevious(previous,{x,y},70);x=limited.x;y=limited.y;
  }
  if(confidence<0.22)return null;
  return{id:'TRIPLE-001',x,y,confidence,distanceFromLowKm,fieldSupport,geometryErrorKm:best.d};
}
function sampleTriplePointSupport(world,xKm,yKm){
  const cx=Math.floor(xKm/world.cellSizeKm),cy=Math.floor(yKm/world.cellSizeKm);let sum=0,n=0;
  for(let y=cy-2;y<=cy+2;y++)for(let x=cx-2;x<=cx+2;x++){const cell=world.getCell(x,y);if(!cell)continue;n++;sum+=clamp((Number(cell.features?.boundaryConvergence)||0)*.45+(Number(cell.features?.explicitBoundaryInfluence)||0)*.30+(Number(cell.derived?.srh01km)||Number(cell.derived?.srh)||0)/500*.25,0,1);}
  return n?sum/n:0;
}

function lifecyclePhase(h, pattern={}, interaction={}) {
  if (pattern.activeSequence) {
    // Daily waves: develop toward each evening peak, occlude overnight, never 'decaying' mid-sequence.
    const lc = activeLifecycle(pattern.activeSequence, h), wave = waveAt(pattern.activeSequence, h);
    if (wave.final && wave.hoursIntoDay > 30) return 'decaying';
    return lc.pulse > 0.6 * wave.day.strength ? 'mature' : wave.hoursIntoDay < wave.day.peakHour ? 'developing' : 'occluding';
  }
  const intensityShift = clamp((Number(pattern.intensity)||0.5)-0.5,-0.3,0.3)*8;
  const shortwaveShift = (interaction.shortwaveCoupling ?? 0.5) * 3;
  const developingEnd = 7 - shortwaveShift;
  const matureEnd = 26 + intensityShift;
  const occludingEnd = 47 + intensityShift;
  return h < developingEnd ? 'developing' : h < matureEnd ? 'mature' : h < occludingEnd ? 'occluding' : 'decaying';
}
function decaySegmentUsage(usage = {}, dtHours = 0) {
  const factor = Math.pow(0.5, Math.max(0, dtHours) / 6);
  const out = {};
  for (const [key, value] of Object.entries(usage)) { const v = (Number(value) || 0) * factor; if (v >= 0.05) out[key] = v; }
  return out;
}
function lifecycleProgress(h){ return clamp(h/60,0,1); }
function lifecycleStrengthFactor(phase,h,pattern=null){
  if(pattern?.activeSequence) return clamp(0.6+0.4*activeLifecycle(pattern.activeSequence,h).pulse,0.6,1);
  if(phase==='developing') return clamp(0.68+h/18,0.68,1);
  if(phase==='mature') return 1;
  if(phase==='occluding') return clamp(1-(h-26)/70,0.66,1);
  return clamp(0.62-(h-47)/80,0.28,0.62);
}
function scaleVelocity(v,s){ return {east:v.east*s,north:v.north*s}; }
function velocityFromPattern(world, config, pattern, sx=1, sy=1) {
  const a = toWorldKm(world, config, 0.5,0.5);
  const b = toWorldKm(world, config, 0.5 + pattern.motionXPerHour*sx, 0.5 + pattern.motionYPerHour*sy);
  return { east:b.x-a.x, north:b.y-a.y };
}
function toWorldKm(world, config, x, y) {
  const p = toDisplay(x,y,config);
  return { x:clamp(p.x,0,1)*world.domainWidthKm, y:clamp(p.y,0,1)*world.domainHeightKm };
}
function toDisplay(x,y,config={}) {
  let px=x, py=y;
  const r=-(Number(config.patternRotationDegrees)||0)*Math.PI/180;
  if(r){const dx=px-.5,dy=py-.5,c=Math.cos(r),s=Math.sin(r);px=.5+dx*c-dy*s;py=.5+dx*s+dy*c;}
  if(config.patternMirror) px=1-px;
  switch((Number(config.patternOrientation)||0)%4){case 1:return{x:1-py,y:px};case 2:return{x:1-px,y:1-py};case 3:return{x:py,y:1-px};default:return{x:px,y:py};}
}
function fromDisplay(x,y,config={}) {
  let px=x,py=y; const o=((Number(config.patternOrientation)||0)%4+4)%4;
  if(o===1){const tx=py,ty=1-px;px=tx;py=ty;} else if(o===2){px=1-px;py=1-py;} else if(o===3){const tx=1-py,ty=px;px=tx;py=ty;}
  if(config.patternMirror) px=1-px;
  const r=(Number(config.patternRotationDegrees)||0)*Math.PI/180;
  if(r){const dx=px-.5,dy=py-.5,c=Math.cos(r),s=Math.sin(r);px=.5+dx*c-dy*s;py=.5+dx*s+dy*c;}
  return{x:px,y:py};
}

import { clamp } from '../scenarios/math.js';

const VERSION='2.69.1';

export function applyBoundaryAirMassDynamics(world,dtHours=1){
  const objects=world.synopticObjects;
  if(!objects?.fronts?.length)return null;
  const elapsed=Number(objects.elapsedHours??world.evolution?.elapsedHours)||0;
  const before=objects.fronts.map(f=>({id:f.id,type:f.type,velocity:{...(f.velocityKph??{})}}));
  for(const front of objects.fronts){
    const solved=solveBoundaryMotion(world,front,objects,elapsed,dtHours);
    front.velocityKph=solved.velocityKph;
    front.segmentDynamics=solved.segmentDynamics;
    front.motionPhysics=solved.physics;
    if(dtHours>0&&front.pointsKm?.length){
      front.pointsKm=front.pointsKm.map((p,i)=>{
        const s=solved.segmentDynamics[Math.min(i,solved.segmentDynamics.length-1)]??solved.segmentDynamics[0];
        return {x:clamp(p.x+s.velocityKph.east*dtHours,0,world.domainWidthKm),y:clamp(p.y+s.velocityKph.north*dtHours,0,world.domainHeightKm)};
      });
    }
  }
  classifyAirMassSectors(world,objects);
  const enforcement=enforceBoundaryThermodynamics(world,objects);
  const validation=validateSynopticImpossibilities(world,objects,before);
  objects.boundaryAirMass={version:VERSION,elapsedHours:elapsed,enforcement,validation};
  objects.boundaryAirMassHistory=[...(objects.boundaryAirMassHistory??[]).slice(-71),objects.boundaryAirMass];
  return objects.boundaryAirMass;
}

function solveBoundaryMotion(world,front,objects,elapsed,dt){
  const pts=front.pointsKm??[]; const segmentDynamics=[];
  for(let i=0;i<pts.length;i++){
    const a=pts[Math.max(0,i-1)]??pts[i],b=pts[Math.min(pts.length-1,i+1)]??pts[i];
    const tangent=unit({x:b.x-a.x,y:b.y-a.y});
    let normal={x:-tangent.y,y:tangent.x};
    normal=orientNormal(world,front,pts[i],normal);
    const sample=sampleSides(world,pts[i],normal,30);
    const base=front.velocityKph??{east:0,north:0};
    let normalSpeed=0,tangentScale=.45;
    if(front.type==='cold'){
      const coldContrast=clamp((sample.ahead.temperature-sample.behind.temperature)/18,-1,1);
      const pressureRise=clamp((sample.behind.pressure-sample.ahead.pressure)/5,-1,1);
      const windNormal=dot(windVector(sample.behind.wind),normal);
      normalSpeed=clamp(4+10*coldContrast+4*pressureRise+0.30*windNormal,-4,24);
      tangentScale=.62;
    }else if(front.type==='warm'){
      const warmAdv=clamp((sample.ahead.temperature-sample.behind.temperature)/14,-1,1);
      const inflow=dot(windVector(sample.behind.wind),normal);
      normalSpeed=clamp(1+5*warmAdv+0.18*inflow,-5,12);
      tangentScale=.48;
    }else if(front.type==='dryline'){
      const hour=((Number(world.validHourUtc)||elapsed)%24+24)%24;
      const diurnal=Math.sin((hour-9)/12*Math.PI);
      const moistureContrast=clamp((sample.ahead.dewpoint-sample.behind.dewpoint)/24,-1,1);
      const mix=clamp((sample.behind.temperature-sample.behind.dewpoint)/35,0,1.3);
      const retreat=hour>=0&&hour<10?-5:hour>=20?-4:0;
      normalSpeed=clamp(retreat+diurnal*9+moistureContrast*6+mix*4,-10,18);
      tangentScale=.30;
    }else{
      normalSpeed=clamp(Number(front.strength||.5)*8,1,14);
    }
    const along={east:(base.east??0)*tangentScale,north:(base.north??0)*tangentScale};
    const velocityKph={east:along.east+normal.x*normalSpeed,north:along.north+normal.y*normalSpeed};
    segmentDynamics.push({index:i,normal,tangent,normalSpeedKph:normalSpeed,velocityKph,temperatureContrastF:sample.ahead.temperature-sample.behind.temperature,dewpointContrastF:sample.ahead.dewpoint-sample.behind.dewpoint});
  }
  const velocityKph={east:mean(segmentDynamics.map(s=>s.velocityKph.east)),north:mean(segmentDynamics.map(s=>s.velocityKph.north))};
  return {velocityKph,segmentDynamics,physics:{version:VERSION,type:front.type,independent:true,diurnalDryline:front.type==='dryline'}};
}

function classifyAirMassSectors(world,objects){
  world.forEachCell((cell,x,y)=>{
    const p={x:(x+.5)*world.cellSizeKm,y:(y+.5)*world.cellSizeKm};
    let sector='ambient',confidence=.25,nearest=null;
    for(const front of objects.fronts??[]){
      const q=nearestSegment(front.pointsKm,p); if(!q)continue;
      const signed=dot({x:p.x-q.point.x,y:p.y-q.point.y},q.normal);
      const d=Math.abs(signed);
      if(!nearest||d<nearest.distanceKm)nearest={front,signed,distanceKm:d,normal:q.normal};
    }
    if(nearest){
      const type=nearest.front.type; const side=nearest.signed>=0?'ahead':'behind';
      if(type==='dryline')sector=side==='ahead'?'warm-moist-sector':'dry-sector';
      else if(type==='cold')sector=side==='ahead'?'warm-sector':'post-cold-front';
      else if(type==='warm')sector=side==='ahead'?'cool-sector':'warm-sector';
      confidence=clamp(1-nearest.distanceKm/180,.2,.98);
      cell.features??={};
      cell.features.boundaryRelative={frontId:nearest.front.id,type,side,signedDistanceKm:nearest.signed,distanceKm:nearest.distanceKm};
    }
    cell.airMass={version:VERSION,sector,confidence,sourceBoundaryId:nearest?.front.id??null,ageHours:Number(cell.airMass?.ageHours||0)+1};
  });
}

function enforceBoundaryThermodynamics(world,objects){
  let corrected=0,segments=0,valid=0;
  for(const front of objects.fronts??[]){
    for(let i=0;i<(front.pointsKm?.length??0);i+=2){
      const p=front.pointsKm[i],dyn=front.segmentDynamics?.[i]; if(!p||!dyn)continue;
      segments++;
      const a=cellAt(world,{x:p.x+dyn.normal.x*20,y:p.y+dyn.normal.y*20});
      const b=cellAt(world,{x:p.x-dyn.normal.x*20,y:p.y-dyn.normal.y*20});
      if(!a||!b)continue;
      let ok=true;
      if(front.type==='cold'){
        if(b.surface.temperature>a.surface.temperature-2){b.surface.temperature=Math.min(b.surface.temperature,a.surface.temperature-2);corrected++;ok=false;}
        if(b.surface.dewpoint>a.surface.dewpoint+2){b.surface.dewpoint=Math.min(b.surface.dewpoint,a.surface.dewpoint+2);corrected++;}
      }else if(front.type==='dryline'){
        if(b.surface.dewpoint>a.surface.dewpoint-8){b.surface.dewpoint=Math.min(b.surface.dewpoint,a.surface.dewpoint-8);corrected++;ok=false;}
      }else if(front.type==='warm'){
        if(b.surface.temperature<a.surface.temperature+2){b.surface.temperature=Math.max(b.surface.temperature,a.surface.temperature+2);corrected++;ok=false;}
      }
      if(ok)valid++;
    }
  }
  return {segmentsChecked:segments,segmentsInitiallyValid:valid,cellsCorrected:corrected,validFraction:segments?valid/segments:1};
}

function validateSynopticImpossibilities(world,objects,before){
  const flags=[]; let highStpBehindDryline=0,warmBehindCold=0,moistBehindDryline=0;
  world.forEachCell(cell=>{
    const rel=cell.features?.boundaryRelative,stp=Number(cell.derived?.stp)||0;
    if(rel?.type==='dryline'&&rel.side==='behind'&&stp>=2){highStpBehindDryline++;flags.push({code:'HIGH_STP_BEHIND_DRYLINE',cellId:cell.id,stp});}
    if(rel?.type==='dryline'&&rel.side==='behind'&&Number(cell.surface?.dewpoint)>60){moistBehindDryline++;}
    if(rel?.type==='cold'&&rel.side==='behind'&&Number(cell.surface?.temperature)>85){warmBehindCold++;}
  });
  const pairs=[]; const fronts=objects.fronts??[];
  for(let i=0;i<fronts.length;i++)for(let j=i+1;j<fronts.length;j++){
    const a=fronts[i],b=fronts[j],dv=Math.hypot((a.velocityKph?.east||0)-(b.velocityKph?.east||0),(a.velocityKph?.north||0)-(b.velocityKph?.north||0));
    const dir=angleDiff(direction(a.velocityKph),direction(b.velocityKph));
    const coupled=dv<1.5&&dir<8;
    pairs.push({a:a.type,b:b.type,relativeSpeedKph:dv,directionDifferenceDegrees:dir,coupled});
    if(coupled)flags.push({code:'BOUNDARY_MOTION_COUPLING_UNJUSTIFIED',a:a.id,b:b.id,relativeSpeedKph:dv});
  }
  return {version:VERSION,flags,counts:{highStpBehindDryline,warmBehindCold,moistBehindDryline},boundaryPairs:pairs,passed:flags.length===0};
}

export function boundaryAwareStpFactor(cell){
  const fractions=cell.airMassFractions??{};
  const authority=cell.airMassAuthority??{};
  const hasFractionalAuthority=Boolean(cell.airMassAuthority||cell.airMassFractions);
  if(!hasFractionalAuthority){
    // Backward-compatible fallback for synthetic tests and legacy states. Live
    // 2.69+ worlds always provide fractional authority before soundings run.
    const sector=cell.airMass?.sector;
    if(sector==='post-cold-front')return .12;
    if(sector==='cool-sector')return .35;
    if(sector==='dry-sector'||(cell.features?.boundaryRelative?.type==='dryline'&&cell.features?.boundaryRelative?.side==='behind')){
      const depression=Math.max(0,Number(cell.surface?.temperature)-Number(cell.surface?.dewpoint));
      return clamp(1-depression/38,.08,.28);
    }
    return 1;
  }
  const warm=clamp(Number(authority.warmMoistFraction??fractions.maritimeTropical)||0,0,1);
  const dry=clamp(Number(authority.dryFraction??fractions.dryMixed)||0,0,1);
  const cold=clamp(Number(authority.coldFraction)||((Number(fractions.continentalPolar)||0)+(Number(fractions.coolStable)||0)),0,1);
  const outflow=clamp(Number(fractions.outflowModified)||0,0,1);
  const temperature=Number(cell.surface?.temperature)||60;
  const dewpoint=Number(cell.surface?.dewpoint)||45;
  const depression=Math.max(0,temperature-dewpoint);
  const moistureSupport=clamp((dewpoint-42)/25,0,1);
  const parcelMoistureDepth=clamp(1-depression/34,0,1);
  const rel=cell.features?.boundaryRelative;
  const distance=Math.abs(Number(rel?.signedDistanceKm??rel?.distanceKm)||999);
  const proximity=clamp(1-distance/80,0,1);

  // Continuous air-mass validity replaces categorical 1.00 -> 0.12 jumps.
  // Fractions and parcel properties carry most of the authority; boundary
  // position only adds a bounded local correction near the interface.
  let factor=.10 + .58*warm + .18*moistureSupport + .14*parcelMoistureDepth
    - .22*dry - .30*cold - .12*outflow;
  if(rel?.type==='dryline'&&rel.side==='behind')factor-=.16*proximity;
  if(rel?.type==='cold'&&rel.side==='behind')factor-=.20*proximity;
  if(rel?.type==='warm'&&rel.side==='ahead')factor-=.10*proximity;
  return clamp(factor,.06,1);
}

function orientNormal(world,front,p,n){
  const a=sampleCell(world,{x:p.x+n.x*25,y:p.y+n.y*25}),b=sampleCell(world,{x:p.x-n.x*25,y:p.y-n.y*25});
  if(front.type==='dryline'&&a.dewpoint<b.dewpoint)return{x:-n.x,y:-n.y};
  if(front.type==='cold'&&a.temperature<b.temperature)return{x:-n.x,y:-n.y};
  if(front.type==='warm'&&a.temperature>b.temperature)return{x:-n.x,y:-n.y};
  return n;
}
function sampleSides(world,p,n,d){return{ahead:sampleCell(world,{x:p.x+n.x*d,y:p.y+n.y*d}),behind:sampleCell(world,{x:p.x-n.x*d,y:p.y-n.y*d})};}
function sampleCell(world,p){const c=cellAt(world,p);return{temperature:Number(c?.surface?.temperature)||60,dewpoint:Number(c?.surface?.dewpoint)||45,pressure:Number(c?.surface?.seaLevelPressure??c?.surface?.pressure)||1012,wind:c?.surface?.wind??{direction:0,speed:0}};}
function cellAt(world,p){return world.getCell(Math.floor(p.x/world.cellSizeKm),Math.floor(p.y/world.cellSizeKm));}
function nearestSegment(points=[],p){let best=null;for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1],ab={x:b.x-a.x,y:b.y-a.y},len2=ab.x*ab.x+ab.y*ab.y||1,t=clamp(((p.x-a.x)*ab.x+(p.y-a.y)*ab.y)/len2,0,1),q={x:a.x+ab.x*t,y:a.y+ab.y*t},d=Math.hypot(p.x-q.x,p.y-q.y);if(!best||d<best.distance){const tangent=unit(ab);best={distance:d,point:q,normal:{x:-tangent.y,y:tangent.x}};}}return best;}
function windVector(w={}){const r=(270-(Number(w.direction)||0))*Math.PI/180,s=Number(w.speed)||0;return{x:Math.cos(r)*s,y:Math.sin(r)*s};}
function direction(v={}){return(Math.atan2(v.east||0,v.north||0)*180/Math.PI+360)%360;}
function angleDiff(a,b){return Math.abs(((a-b+540)%360)-180);}
function dot(a,b){return a.x*b.x+a.y*b.y;}
function unit(v){const m=Math.hypot(v.x,v.y)||1;return{x:v.x/m,y:v.y/m};}
function mean(a=[]){const v=a.filter(Number.isFinite);return v.length?v.reduce((s,x)=>s+x,0)/v.length:0;}

import { clamp } from '../scenarios/math.js';
const VERSION='2.70.0';

export function initializeMeteorologicalIntegrity(world){
  world.meteorologicalIntegrityHistory=[];
  return runMeteorologicalIntegrity(world,{initial:true});
}

export function runMeteorologicalIntegrity(world,{initial=false}={}){
  const started=performance?.now?.()??Date.now();
  const errors=[],warnings=[],corrected=[];
  const counts={parcel:[0,0],boundary:[0,0],cold:[0,0],dryline:[0,0],warm:[0,0],motion:[0,0],topology:[0,0],initiation:[0,0],freshness:[0,0],rejected:0};
  validateCells(world,counts,errors,warnings,corrected);
  validateBoundaries(world,counts,errors,warnings,corrected);
  validatePairs(world,counts,warnings);
  validateTopology(world,counts,warnings);
  const score=k=>counts[k][0]?counts[k][1]/counts[k][0]:1;
  const checks={parcelValidity:score('parcel'),boundaryFieldAgreement:score('boundary'),coldFrontContrast:score('cold'),drylineContrast:score('dryline'),warmFrontContrast:score('warm'),boundaryMotionIndependence:score('motion'),topologyValidity:score('topology'),initiationSupport:score('initiation'),diagnosticFreshness:score('freshness')};
  const overallScore=clamp(.24*checks.parcelValidity+.17*checks.boundaryFieldAgreement+.1*checks.coldFrontContrast+.1*checks.drylineContrast+.06*checks.warmFrontContrast+.09*checks.boundaryMotionIndependence+.08*checks.topologyValidity+.11*checks.initiationSupport+.05*checks.diagnosticFreshness-errors.length*.012-warnings.length*.002,0,1);
  const report={version:VERSION,validHourUtc:world.validHourUtc,initial,overallScore,errors:errors.slice(0,80),warnings:warnings.slice(0,100),corrected:corrected.slice(0,100),rejectedUpdates:counts.rejected,checks,elapsedMs:(performance?.now?.()??Date.now())-started};
  world.meteorologicalIntegrity=report;
  world.meteorologicalIntegrityHistory=[...(world.meteorologicalIntegrityHistory??[]).slice(-47),{version:VERSION,validHourUtc:world.validHourUtc,overallScore,errorCount:errors.length,warningCount:warnings.length,rejectedUpdates:counts.rejected,checks,elapsedMs:report.elapsedMs}];
  return report;
}

function validateCells(world,c,e,w,fix){
  world.forEachCell((cell,x,y)=>{
    const parcel=parcelValidity(cell); cell.surfaceParcelValidity=parcel;
    c.parcel[0]++; if(parcel.score>=.25||(cell.derived?.stp??0)<1)c.parcel[1]++;
    const stp=Math.max(0,Number(cell.derived?.stp)||0), raw=Math.max(stp,Number(cell.derived?.rawStp??cell.derived?.stpRaw)||stp);
    if(stp>=1&&parcel.score<.25){
      const code=boundaryStpCode(cell); e.push({code,cellId:cell.id,x,y,stp,parcelScore:parcel.score,limitingFactors:parcel.limitingFactors});
      const next=Math.min(stp,raw*parcel.score); if(next<stp){cell.derived.stp=next;fix.push({code:'EFFECTIVE_STP_CONSTRAINED',cellId:cell.id,before:stp,after:next});}
    }
    const fresh=freshness(cell); c.freshness[0]++; if(fresh.valid)c.freshness[1]++; else {cell.diagnosticCacheInvalidated=true;cell.diagnosticInvalidationReasons=fresh.reasons;w.push({code:'CACHED_THERMODYNAMICS_STALE',cellId:cell.id,reasons:fresh.reasons});}
    const init=initiationCompatibility(cell,parcel); cell.meteorologicalIntegrity={version:VERSION,parcelScore:parcel.score,initiationCompatible:init.compatible,initiationReasons:init.reasons,diagnosticsFresh:fresh.valid};
    const potential=Math.max(Number(cell.forecast?.initiationProbability)||0,Number(cell.dynamics?.initiationPotential)||0);
    if(potential>=.03){c.initiation[0]++;if(init.compatible)c.initiation[1]++;else{c.rejected++;w.push({code:'INITIATION_PHYSICALLY_UNSUPPORTED',cellId:cell.id,potential,reasons:init.reasons});}}
  });
}

function validateBoundaries(world,c,e,w,fix){
  for(const front of world.synopticObjects?.fronts??[]){
    let sampled=0,supported=0;
    for(let i=0;i<(front.pointsKm?.length??0);i+=4){
      const p=front.pointsKm[i],normal=front.segmentDynamics?.[i]?.normal??localNormal(front.pointsKm,i); if(!p||!normal)continue;
      const ahead=sample(world,p.x+normal.x*20,p.y+normal.y*20),behind=sample(world,p.x-normal.x*20,p.y-normal.y*20); if(!ahead||!behind)continue;
      sampled++; c.boundary[0]++; const result=support(front.type,ahead,behind); const key=front.type==='cold'?'cold':front.type==='dryline'?'dryline':'warm'; c[key][0]++;
      if(result.sign)c[key][1]++; else e.push({code:key==='cold'?'COLD_FRONT_THERMAL_SIGN_FAILURE':key==='dryline'?'DRYLINE_MOISTURE_SIGN_FAILURE':'WARM_FRONT_STABILITY_FAILURE',boundaryId:front.id,index:i,contrast:result.primary});
      if(result.n>=2){supported++;c.boundary[1]++;}else w.push({code:'BOUNDARY_SEGMENT_UNSUPPORTED',boundaryId:front.id,type:front.type,index:i,signals:result.signals});
    }
    front.integrity={version:VERSION,sampledSegments:sampled,supportedSegments:supported,supportFraction:sampled?supported/sampled:1};
    if(sampled&&supported/sampled<.45){front.confidence=clamp((Number(front.confidence)||.5)*.82,.05,1);fix.push({code:'BOUNDARY_CONFIDENCE_REDUCED',boundaryId:front.id,supportFraction:supported/sampled});}
  }
}

function validatePairs(world,c,w){
  const fronts=world.synopticObjects?.fronts??[], hist=world.synopticObjects?._integrityPairHistory??new Map(); if(world.synopticObjects)world.synopticObjects._integrityPairHistory=hist;
  for(let i=0;i<fronts.length;i++)for(let j=i+1;j<fronts.length;j++){
    const a=fronts[i],b=fronts[j],av=a.velocityKph??{},bv=b.velocityKph??{};
    const rel=Math.hypot((av.east||0)-(bv.east||0),(av.north||0)-(bv.north||0)),diff=angleDiff(direction(av),direction(bv)),key=[a.id,b.id].sort().join('|'),prior=hist.get(key)??{hours:0};
    const coupled=rel<4&&diff<10,hours=coupled?prior.hours+(Number(world.runtime?.profile?.atmosphereStepHours)||.5):0;hist.set(key,{hours,rel,diff});c.motion[0]++;
    const justified=coldDrylineMerger(a,b)||world.synopticObjects?.lifecycle?.phase==='occluding'; if(!coupled||hours<=3||justified)c.motion[1]++;else w.push({code:'BOUNDARY_MOTION_COUPLING_UNJUSTIFIED',a:a.id,b:b.id,coupledDurationHours:hours,relativeSpeedKph:rel,directionDifferenceDegrees:diff});
  }
}

function validateTopology(world,c,w){
  const o=world.synopticObjects??{},low=o.surfaceLows?.[0]??o.surfaceLow,lp=low?.positionKm??low;
  for(const f of o.fronts??[]){c.topology[0]++;if(!lp||!f.pointsKm?.length){c.topology[1]++;continue;}const d=Math.min(dist(f.pointsKm[0],lp),dist(f.pointsKm.at(-1),lp)),limit=f.type==='dryline'?180:140;if(d<=limit)c.topology[1]++;else w.push({code:f.type==='warm'?'WARM_FRONT_DETACHED_FROM_CYCLONE':'BOUNDARY_DETACHED_FROM_CYCLONE',boundaryId:f.id,distanceKm:d});}
}

function parcelValidity(cell){
  const d=cell.derived??{},s=cell.surface??{},f=cell.airMassFractions??{},a=cell.airMassAuthority??{};
  const sb=Math.max(0,Number(d.sbcape??d.cape)||0),ml=Math.max(0,Number(d.mlcape??d.cape)||0),mu=Math.max(0,Number(d.mucape??ml)||0),lcl=Math.max(0,Number(d.lcl??d.lclM)||1500),cin=Math.max(0,Number(d.cinMagnitude??d.cin)||0);
  const t=Number(s.temperature)||60,td=Number(s.dewpoint)||40,warm=clamp(Number(a.warmMoistFraction??f.maritimeTropical)||0,0,1),dry=clamp(Number(a.dryFraction??f.dryMixed)||0,0,1),cold=clamp(Number(a.coldFraction)||((Number(f.continentalPolar)||0)+(Number(f.coolStable)||0)),0,1);
  const moisture=clamp((td-42)/24,0,1)*clamp(1-(t-td)/34,0,1),inflow=clamp(Number(d.effectiveInflowDepthM)||(clamp(sb/1000,0,1)*1200*(1-cold)),0,2500);
  const score=clamp(.3*clamp(sb/1000,0,1)+.22*moisture+.22*warm+.16*clamp(inflow/750,0,1)+.1*clamp(1-cin/250,0,1)-.25*cold-.18*dry,0,1),lim=[];
  if(sb<250)lim.push('weak-sbcape');if(inflow<300)lim.push('shallow-effective-inflow');if(lcl>1800)lim.push('high-lcl');if(cold>.45)lim.push('cold-stable-air');if(dry>.5)lim.push('dry-sector');
  return{version:VERSION,surfaceBased:score>=.35&&sb>=200,effectiveInflowDepthM:inflow,sbcape:sb,mlcape:ml,mucape:mu,lclM:lcl,stableLayerDepthM:clamp(cin*4,0,2000),moistureDepthM:clamp(moisture*1800,0,2000),score,limitingFactors:lim};
}
function initiationCompatibility(cell,p){const reasons=[],elev=Math.max(Number(cell.forecast?.nocturnalElevatedSupport)||0,Number(cell.forecast?.elevatedSupport)||0),boundary=Math.max(Number(cell.features?.explicitBoundaryInfluence)||0,Number(cell.features?.boundaryConvergence)||0,Number(cell.mesoscaleFields?.convergenceCorridor)||0),forcing=Math.max(Number(cell.features?.synopticAscent)||0,Number(cell.dynamics?.forcing)||0),sector=cell.airMass?.sector;if(!p.surfaceBased&&elev<.42)reasons.push('no-valid-surface-or-elevated-parcel');if(boundary<.16&&forcing<.42)reasons.push('no-coherent-trigger');if(['dry-sector','post-cold-front','cool-sector','outflow'].includes(sector)&&elev<.42)reasons.push(`incompatible-air-mass:${sector}`);return{compatible:!reasons.length,reasons};}
function freshness(cell){const reasons=[],r=cell.features?.boundaryRelative,key=r?`${r.frontId}:${r.side}`:'none',oldKey=cell._integrityBoundaryKey;if(oldKey&&oldKey!==key)reasons.push('boundary-side-changed');cell._integrityBoundaryKey=key;const cur={t:Number(cell.surface?.temperature)||0,td:Number(cell.surface?.dewpoint)||0,wd:Number(cell.surface?.wind?.direction)||0},old=cell._integritySurface;if(old){if(Math.abs(cur.t-old.t)>5)reasons.push('temperature-change');if(Math.abs(cur.td-old.td)>4)reasons.push('dewpoint-change');if(angleDiff(cur.wd,old.wd)>35)reasons.push('wind-shift');}cell._integritySurface=cur;return{valid:!reasons.length,reasons};}
function support(type,a,b){const dt=a.t-b.t,dd=a.td-b.td,dp=b.p-a.p,signals={thermal:Math.abs(dt)>=2,moisture:Math.abs(dd)>=5,windShift:angleDiff(a.w.direction,b.w.direction)>=20,pressure:Math.abs(dp)>=1};let sign=true,primary=0;if(type==='cold'){primary=dt;sign=dt>=1.5;}else if(type==='dryline'){primary=dd;sign=dd>=5;}else if(type==='warm'){primary=dt;sign=dt<=-1.5;}return{n:Object.values(signals).filter(Boolean).length,signals,sign,primary};}
function sample(world,xKm,yKm){const cell=world.getCell(Math.floor(xKm/world.cellSizeKm),Math.floor(yKm/world.cellSizeKm));return cell?{cell,t:Number(cell.surface?.temperature)||0,td:Number(cell.surface?.dewpoint)||0,p:Number(cell.surface?.seaLevelPressure??cell.surface?.pressure)||1012,w:cell.surface?.wind??{direction:0,speed:0}}:null;}
function localNormal(points,i){const a=points[Math.max(0,i-1)]??points[i],b=points[Math.min(points.length-1,i+1)]??points[i],dx=b.x-a.x,dy=b.y-a.y,m=Math.hypot(dx,dy)||1;return{x:-dy/m,y:dx/m};}
function coldDrylineMerger(a,b){if(!new Set([a.type,b.type]).has('cold')||!new Set([a.type,b.type]).has('dryline'))return false;let best=Infinity;for(const x of a.pointsKm??[])for(const y of b.pointsKm??[])best=Math.min(best,dist(x,y));return best<35;}
function boundaryStpCode(cell){const r=cell.features?.boundaryRelative;if(r?.type==='dryline'&&r.side==='behind')return'HIGH_STP_BEHIND_DRYLINE';if(r?.type==='cold'&&r.side==='behind')return'HIGH_STP_POST_COLD_FRONT';return'SURFACE_TORNADO_PARAMETER_WITHOUT_EFFECTIVE_INFLOW';}
function direction(v){return(Math.atan2(Number(v.east)||0,Number(v.north)||0)*180/Math.PI+360)%360;}function angleDiff(a,b){return Math.abs(((a-b+540)%360)-180);}function dist(a,b){return Math.hypot((a?.x??0)-(b?.x??0),(a?.y??0)-(b?.y??0));}

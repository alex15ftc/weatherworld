import { clamp } from '../scenarios/math.js';

const VERSION='2.64.0';

export function reconcileSynopticState(world, dtHours=1){
  const objects=world.synopticObjects;
  if(!objects?.surfaceLow || dtHours<=0) return null;
  const before=diagnoseState(world,objects);
  const maxPasses=5, minPasses=2, trend=[];
  let best=before, bestSnapshot=snapshotObjects(objects);
  for(let pass=1;pass<=maxPasses;pass++){
    const authority=diagnoseAuthority(before,objects);
    reconcileLow(world,objects,authority,dtHours,maxPasses);
    reconcileFronts(world,objects,authority,dtHours,maxPasses);
    enforceTopology(objects);
    rebuildPressureAndWind(world,objects,authority,dtHours,maxPasses);
    rebuildWarmSector(world,objects,dtHours,maxPasses);
    const after=diagnoseState(world,objects);
    const improvement=before.totalError-after.totalError;
    trend.push({pass,totalError:after.totalError,lowErrorKm:after.lowErrorKm,frontErrorKm:after.frontErrorKm,pressureMismatch:after.pressureMismatch,windMismatch:after.windMismatch,attachmentErrorKm:after.attachmentErrorKm,upperSupportError:after.upperSupportError,improvement});
    if(after.totalError<best.totalError){best=after;bestSnapshot=snapshotObjects(objects);} else restoreObjects(objects,bestSnapshot);
    if(pass>=minPasses && Math.abs(improvement)<0.003) break;
  }
  restoreObjects(objects,bestSnapshot);
  const correctionKm=Math.hypot(objects.surfaceLow.positionKm.x-before.lowPosition.x,objects.surfaceLow.positionKm.y-before.lowPosition.y);
  const report={version:VERSION,hour:Number(world.evolution?.elapsedHours)||0,passes:trend.length,converged:best.totalError<=before.totalError*0.96,totalErrorBefore:before.totalError,totalErrorAfter:best.totalError,improvementFraction:clamp((before.totalError-best.totalError)/Math.max(.001,before.totalError),-1,1),surfaceLowCorrectionKm:correctionKm,meanFrontCorrectionKm:mean(objects.fronts?.map(f=>Number(f.reconciliationCorrectionKm)||0)),pressureError:best.pressureMismatch,windError:best.windMismatch,attachmentErrorKm:best.attachmentErrorKm,upperSupportError:best.upperSupportError,trustedSource:diagnoseAuthority(best,objects).trustedSource,trend};
  objects.reconciliation=report;
  objects.reconciliationHistory=[...(objects.reconciliationHistory??[]).slice(-71),report];
  // Make existing health diagnostics reflect the reconciled authoritative state.
  objects.alignment={...(objects.alignment??{}),surfaceLowFieldErrorKm:best.lowErrorKm,frontsDiagnostics:(objects.fronts??[]).map(f=>({id:f.id,type:f.type,displacementKm:Number(f.reconciliationResidualKm),residualErrorKm:Number(f.reconciliationResidualKm),confidence:f.confidence})),meanFrontResidualErrorKm:best.frontErrorKm,reconciliationVersion:VERSION};
  const pressureScore=Math.exp(-best.lowErrorKm/220),frontScore=Math.exp(-best.frontErrorKm/150),windScore=1-best.windMismatch;
  objects.atmosphericConsistency=clamp(pressureScore*.34+frontScore*.34+windScore*.18+(1-best.upperSupportError)*.14,0,1);
  objects.objectConfidence={...(objects.objectConfidence??{}),surfaceLow:clamp(pressureScore,0.08,.98),fronts:clamp(frontScore,0.08,.98),overall:clamp((pressureScore+frontScore+(1-best.upperSupportError))/3,0.08,.98)};
  return report;
}

function diagnoseState(world,objects){
  const pressureMin=findPressureMinimum(world),curvature=findCyclonicCenter(world),low=objects.surfaceLow.positionKm;
  const lowTarget=weightedPoint([{p:pressureMin,w:.55},{p:curvature,w:.25},{p:low,w:.20}])??low;
  const lowErrorKm=distance(low,lowTarget);
  const frontRows=(objects.fronts??[]).map(f=>{const target=findFrontCenter(world,f.type);const center=centroid(f.pointsKm);return {front:f,target,center,error:target?distance(center,target):0};});
  const frontErrorKm=mean(frontRows.map(r=>r.error));
  const attachmentErrorKm=mean((objects.fronts??[]).map(f=>distanceToPolyline(low,f.pointsKm)));
  const pressureMismatch=clamp(lowErrorKm/600,0,1);
  const windMismatch=diagnoseWindMismatch(world,low);
  const upperSupportError=diagnoseUpperSupport(objects,lowTarget);
  const totalError=pressureMismatch*.28+clamp(frontErrorKm/350,0,1)*.24+windMismatch*.18+clamp(attachmentErrorKm/350,0,1)*.16+upperSupportError*.14;
  return {totalError,lowErrorKm,frontErrorKm,attachmentErrorKm,pressureMismatch,windMismatch,upperSupportError,pressureMin,curvature,lowTarget,frontRows,lowPosition:{...low}};
}
function diagnoseAuthority(state,objects){const fieldQuality=clamp((1-state.windMismatch)*.35+(1-state.pressureMismatch)*.45+(1-state.upperSupportError)*.20,0,1);const objectQuality=clamp(Number(objects.objectConfidence?.overall)||.35,.08,.98);return{fieldWeight:clamp(.3+fieldQuality*.45-objectQuality*.18,.18,.72),objectWeight:1-clamp(.3+fieldQuality*.45-objectQuality*.18,.18,.72),trustedSource:fieldQuality>objectQuality+.08?'fields':objectQuality>fieldQuality+.08?'objects':'blended'};}
function reconcileLow(world,objects,a,dt,passes){const s=diagnoseState(world,objects),low=objects.surfaceLow.positionKm,target=s.lowTarget;const maxStep=clamp((18+90*(1-(objects.objectConfidence?.surfaceLow??.4)))*dt/passes,8,55);const w=clamp(a.fieldWeight/passes*.9,.05,.28);const dx=clamp((target.x-low.x)*w,-maxStep,maxStep),dy=clamp((target.y-low.y)*w,-maxStep,maxStep);objects.surfaceLow.positionKm={x:low.x+dx,y:low.y+dy};objects.surfaceLow.reconciliationCorrectionKm=(objects.surfaceLow.reconciliationCorrectionKm??0)+Math.hypot(dx,dy);}
function reconcileFronts(world,objects,a,dt,passes){for(const f of objects.fronts??[]){const target=findFrontCenter(world,f.type);if(!target)continue;const c=centroid(f.pointsKm),max=clamp((14+70*(1-(f.confidence??.4)))*dt/passes,6,42);const w=clamp((a.fieldWeight*.8)/passes,.04,.22);const dx=clamp((target.x-c.x)*w,-max,max),dy=clamp((target.y-c.y)*w,-max,max);f.pointsKm=f.pointsKm.map(p=>({x:p.x+dx,y:p.y+dy}));f.reconciliationCorrectionKm=(f.reconciliationCorrectionKm??0)+Math.hypot(dx,dy);f.reconciliationResidualKm=Math.max(0,distance(c,target)-Math.hypot(dx,dy));}}
function enforceTopology(objects){const low=objects.surfaceLow.positionKm;for(const f of objects.fronts??[]){if(!f.pointsKm?.length)continue;let nearest=0,best=Infinity;f.pointsKm.forEach((p,i)=>{const d=distance(p,low);if(d<best){best=d;nearest=i;}});if(best>120){const p=f.pointsKm[nearest],w=.18;f.pointsKm[nearest]={x:p.x+(low.x-p.x)*w,y:p.y+(low.y-p.y)*w};}f.parentId=objects.surfaceLow.id;}objects.triplePoint=deriveTriplePoint(objects.fronts,low,objects.triplePoint);}
function rebuildPressureAndWind(world,objects,a,dt,passes){const low=objects.surfaceLow;world.forEachCell((cell,x,y)=>{const p={x:(x+.5)*world.cellSizeKm,y:(y+.5)*world.cellSizeKm},d=distance(p,low.positionKm),k=Math.exp(-.5*(d/260)**2);if(k<.01)return;const sea=Number(cell.surface?.seaLevelPressure ?? cell.surface?.pressure);if(Number.isFinite(sea)){const target=Number(low.pressureHpa)+Math.min(10,d/55);const step=clamp((target-sea)*a.objectWeight*.18*k/passes,-.45,.45);if(Number.isFinite(cell.surface?.seaLevelPressure))cell.surface.seaLevelPressure+=step;else cell.surface.pressure+=step;}if(cell.surface?.wind){const dx=p.x-low.positionKm.x,dy=p.y-low.positionKm.y;const targetDir=(Math.atan2(dx,-dy)*180/Math.PI+360)%360;cell.surface.wind.direction=blendAngle(cell.surface.wind.direction,targetDir,clamp(k*.12/passes,0,.08));const targetSpeed=clamp(8+low.intensity*30+k*12,3,65);cell.surface.wind.speed=clamp(cell.surface.wind.speed+(targetSpeed-cell.surface.wind.speed)*k*.08/passes,0,80);}});}
function rebuildWarmSector(world,objects,dt,passes){let count=0,td=0;world.forEachCell((cell,x,y)=>{const p={x:(x+.5)*world.cellSizeKm,y:(y+.5)*world.cellSizeKm};const warm=warmSectorGeometry(objects,p);const prior=Number(cell.features?.synopticWarmSectorFraction)||0;const next=clamp(prior+(warm-prior)*.25/passes,0,1);cell.features.synopticWarmSectorFraction=next;cell.features.warmSector=next>.3;if(cell.features.warmSector){count++;td+=Number(cell.surface?.dewpoint)||0;}});objects.warmSectorCoverage=count/Math.max(1,world.width*world.height);objects.meanWarmSectorDewpointF=count?td/count:null;}
function findPressureMinimum(world){let best=null;world.forEachCell((c,x,y)=>{const v=Number(c.surface?.seaLevelPressure ?? c.surface?.pressure);if(Number.isFinite(v)&&(!best||v<best.v))best={x:(x+.5)*world.cellSizeKm,y:(y+.5)*world.cellSizeKm,v};});return best;}
function findCyclonicCenter(world){let sx=0,sy=0,sw=0;world.forEachCell((c,x,y)=>{const speed=Number(c.surface?.wind?.speed)||0;if(speed<8)return;const w=clamp(speed/45,0,1);sx+=(x+.5)*world.cellSizeKm*w;sy+=(y+.5)*world.cellSizeKm*w;sw+=w;});return sw?{x:sx/sw,y:sy/sw}:null;}
function findFrontCenter(world,type){let sx=0,sy=0,sw=0;world.forEachCell((c,x,y)=>{const l=world.getCell(Math.max(0,x-1),y),u=world.getCell(x,Math.max(0,y-1));const t=Number(c.surface?.temperature),td=Number(c.surface?.dewpoint);const tg=Math.abs(t-Number(l?.surface?.temperature??t))+Math.abs(t-Number(u?.surface?.temperature??t));const dg=Math.abs(td-Number(l?.surface?.dewpoint??td))+Math.abs(td-Number(u?.surface?.dewpoint??td));const conv=clamp(Number(c.features?.boundaryConvergence)||0,0,1);let w=type==='dryline'?dg/18+conv:type==='warm'?tg/16+dg/30+conv*.7:tg/14+conv;if(w<.18)return;w=clamp(w,0,1);sx+=(x+.5)*world.cellSizeKm*w;sy+=(y+.5)*world.cellSizeKm*w;sw+=w;});return sw?{x:sx/sw,y:sy/sw}:null;}
function diagnoseWindMismatch(world,low){let sum=0,n=0;world.forEachCell((c,x,y)=>{const p={x:(x+.5)*world.cellSizeKm,y:(y+.5)*world.cellSizeKm},d=distance(p,low);if(d>260||d<40)return;const dx=p.x-low.x,dy=p.y-low.y,target=(Math.atan2(dx,-dy)*180/Math.PI+360)%360;let diff=Math.abs(((Number(c.surface?.wind?.direction)||0)-target+540)%360-180);sum+=diff/180;n++;});return n?clamp(sum/n,0,1):.5;}
function diagnoseUpperSupport(objects,target){const sw=Number(objects.upperObjects?.shortwave?.intensity)||0,jet=Number(objects.upperObjects?.jetStreak?.intensity)||0;return clamp(1-(sw*.55+jet*.45),0,1);}
function warmSectorGeometry(objects,p){const low=objects.surfaceLow.positionKm;const east=p.x>=low.x-80,south=p.y>=low.y-120;let support=east&&south?.55:.08;for(const f of objects.fronts??[]){const d=distanceToPolyline(p,f.pointsKm);if(f.type==='warm')support+=clamp(1-d/180,0,.25);if(f.type==='dryline'&&p.x>=centroid(f.pointsKm).x)support+=clamp(1-d/160,0,.22);if(f.type==='cold'&&p.x<centroid(f.pointsKm).x)support-=clamp(1-d/140,0,.35);}return clamp(support,0,1);}
function deriveTriplePoint(fronts,low,prior){const cold=fronts?.find(f=>f.type==='cold'),warm=fronts?.find(f=>f.type==='warm'),dry=fronts?.find(f=>f.type==='dryline');const pts=[cold,warm,dry].filter(Boolean).map(f=>nearestPoint(f.pointsKm,low));if(pts.length<2)return prior??null;const p={x:mean(pts.map(x=>x.x)),y:mean(pts.map(x=>x.y))};return{id:'TRIPLE-001',type:'triple-point',positionKm:p,confidence:clamp(Math.exp(-mean(pts.map(x=>distance(x,p)))/100),.1,.98),version:VERSION};}
function nearestPoint(points,p){return points.reduce((a,b)=>distance(b,p)<distance(a,p)?b:a,points[0]);}
function distanceToPolyline(p,pts=[]){if(!pts.length)return 999;return Math.min(...pts.map(q=>distance(p,q)));}
function centroid(pts=[]){return{x:mean(pts.map(p=>p.x)),y:mean(pts.map(p=>p.y))};}
function weightedPoint(rows){let x=0,y=0,w=0;for(const r of rows)if(r.p){x+=r.p.x*r.w;y+=r.p.y*r.w;w+=r.w;}return w?{x:x/w,y:y/w}:null;}
function snapshotObjects(o){return structuredClone({surfaceLow:o.surfaceLow,fronts:o.fronts,triplePoint:o.triplePoint,warmSectorCoverage:o.warmSectorCoverage,meanWarmSectorDewpointF:o.meanWarmSectorDewpointF});}
function restoreObjects(o,s){Object.assign(o,structuredClone(s));}
function blendAngle(a,b,w){const ar=(Number(a)||0)*Math.PI/180,br=(Number(b)||0)*Math.PI/180;return(Math.atan2((1-w)*Math.sin(ar)+w*Math.sin(br),(1-w)*Math.cos(ar)+w*Math.cos(br))*180/Math.PI+360)%360;}
function distance(a,b){return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0;}
function mean(a=[]){const v=a.filter(Number.isFinite);return v.length?v.reduce((s,x)=>s+x,0)/v.length:0;}

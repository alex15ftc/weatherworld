import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';

const count=Math.max(1,Number(process.argv[2]??20));
const hours=Math.max(0,Number(process.argv[3]??12));
const startSeed=Number(process.argv[4]??1);
const snapshots=[];
for(let offset=0;offset<count;offset++){
  const seed=startSeed+offset,world=new Atmosphere(50,40),config=generateScenario(world,seed);
  initializeEvolution(world,config);
  snapshots.push(audit(world,config,seed,0));
  for(let elapsed=1;elapsed<=hours;elapsed++) {
    advanceAtmosphere(world,1);
    if(elapsed===6||elapsed===hours)snapshots.push(audit(world,config,seed,elapsed));
  }
}

const summarize=rows=>({
  samples:rows.length,
  boundaryCount:sum(rows,'boundaryCount'),
  drylineOrientationFailures:sum(rows,'drylineOrientationFailures'),
  warmFrontOrientationFailures:sum(rows,'warmFrontOrientationFailures'),
  extremeColdFrontOrientations:sum(rows,'extremeColdFrontOrientations'),
  selfIntersectingBoundaries:sum(rows,'selfIntersectingBoundaries'),
  excessiveSegmentJumps:sum(rows,'excessiveSegmentJumps'),
  multiCrossBoundaryPairs:sum(rows,'multiCrossBoundaryPairs'),
  longOverlapBoundaryPairs:sum(rows,'longOverlapBoundaryPairs'),
  frontsDetachedFromPrimaryLow:sum(rows,'frontsDetachedFromPrimaryLow'),
  frontsWithoutAirMassContrast:sum(rows,'frontsWithoutAirMassContrast'),
  meanWarmSectorEdgeDisplacementKm:mean(rows.map(row=>row.warmSectorEdgeDisplacementKm)),
  maximumWarmSectorEdgeDisplacementKm:Math.max(0,...rows.map(row=>row.warmSectorEdgeDisplacementKm))
});
const byHour=Object.fromEntries([...new Set(snapshots.map(row=>row.elapsedHours))].sort((a,b)=>a-b).map(hour=>[`${hour}h`,summarize(snapshots.filter(row=>row.elapsedHours===hour))]));
const worst=[...snapshots].sort((a,b)=>severity(b)-severity(a)).slice(0,12);
console.log(JSON.stringify({count,hours,startSeed,byHour,worst},null,2));

function audit(world,config,seed,elapsedHours){
  const boundaries=world.mesoscale?.boundaries??[];
  let drylineOrientationFailures=0,warmFrontOrientationFailures=0,extremeColdFrontOrientations=0,selfIntersectingBoundaries=0,excessiveSegmentJumps=0,multiCrossBoundaryPairs=0,longOverlapBoundaryPairs=0,frontsDetachedFromPrimaryLow=0,frontsWithoutAirMassContrast=0;
  const primaryLow=world.analysis?.pressureSystems?.primaryLow;
  const lowPoint=primaryLow?{x:(primaryLow.x+.5)*world.cellSizeKm,y:(primaryLow.y+.5)*world.cellSizeKm}:null;
  for(const boundary of boundaries){
    const axis=axisEast(boundary.pointsKm);
    if(boundary.type==='dryline'&&axis>.62)drylineOrientationFailures++;
    if(boundary.type==='warm'&&axis<.62)warmFrontOrientationFailures++;
    if(boundary.type==='cold'&&(axis<.12||axis>.94))extremeColdFrontOrientations++;
    if(selfIntersections(boundary.pointsKm)>0)selfIntersectingBoundaries++;
    if(maxSegment(boundary.pointsKm)>world.cellSizeKm*4.5)excessiveSegmentJumps++;
    if(lowPoint&&Math.min(distance(lowPoint,boundary.pointsKm[0]),distance(lowPoint,boundary.pointsKm.at(-1)))>200)frontsDetachedFromPrimaryLow++;
    if(!hasAirMassContrast(world,boundary))frontsWithoutAirMassContrast++;
  }
  for(let i=0;i<boundaries.length;i++)for(let j=i+1;j<boundaries.length;j++){
    const a=boundaries[i],b=boundaries[j],crossings=polylineIntersections(a.pointsKm,b.pointsKm);
    if(crossings>1)multiCrossBoundaryPairs++;
    const near=a.pointsKm.filter(point=>nearestPolylineDistance(point,b.pointsKm)<Math.min(a.widthKm,b.widthKm)*.55);
    if(near.length>=Math.max(3,Math.ceil(a.pointsKm.length*.35)))longOverlapBoundaryPairs++;
  }
  return {
    seed,elapsedHours,setupType:config.setupType,orientation:config.patternOrientation,mirror:config.patternMirror,
    boundaryTypes:boundaries.map(boundary=>boundary.type),boundaryCount:boundaries.length,
    drylineOrientationFailures,warmFrontOrientationFailures,extremeColdFrontOrientations,
    selfIntersectingBoundaries,excessiveSegmentJumps,multiCrossBoundaryPairs,longOverlapBoundaryPairs,
    frontsDetachedFromPrimaryLow,frontsWithoutAirMassContrast,
    warmSectorEdgeDisplacementKm:warmSectorEdgeDisplacement(world,boundaries)
  };
}
function warmSectorEdgeDisplacement(world,boundaries){
  if(!boundaries.length)return 0;const distances=[];
  world.forEachCell((cell,x,y)=>{
    const value=Boolean(cell.features?.warmSector);
    if([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>{const n=world.getCell(x+dx,y+dy);return n&&Boolean(n.features?.warmSector)!==value;})){
      const point={x:(x+.5)*world.cellSizeKm,y:(y+.5)*world.cellSizeKm};
      distances.push(Math.min(...boundaries.map(boundary=>nearestPolylineDistance(point,boundary.pointsKm))));
    }
  });
  return mean(distances);
}
function axisEast(points){if(points.length<2)return 0;const a=points[0],b=points.at(-1);return Math.abs(b.x-a.x)/Math.max(1,Math.hypot(b.x-a.x,b.y-a.y));}
function maxSegment(points){let max=0;for(let i=1;i<points.length;i++)max=Math.max(max,Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y));return max;}
function hasAirMassContrast(world,boundary){
  const contrasts=[];
  for(let i=1;i<boundary.pointsKm.length-1;i+=Math.max(1,Math.floor(boundary.pointsKm.length/7))){
    const before=boundary.pointsKm[i-1],point=boundary.pointsKm[i],after=boundary.pointsKm[i+1];
    const dx=after.x-before.x,dy=after.y-before.y,length=Math.max(1,Math.hypot(dx,dy));
    const offset=world.cellSizeKm*1.8,nx=-dy/length,ny=dx/length;
    const a=cellAtKm(world,point.x+nx*offset,point.y+ny*offset),b=cellAtKm(world,point.x-nx*offset,point.y-ny*offset);
    if(!a||!b)continue;
    contrasts.push(boundary.type==='dryline'?Math.abs(a.surface.dewpoint-b.surface.dewpoint):Math.abs(a.surface.temperature-b.surface.temperature));
  }
  if(!contrasts.length)return false;
  contrasts.sort((a,b)=>a-b);
  return contrasts[Math.floor(contrasts.length/2)]>=(boundary.type==='dryline'?5:3);
}
function cellAtKm(world,x,y){return world.getCell(Math.floor(x/world.cellSizeKm),Math.floor(y/world.cellSizeKm));}
function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
function selfIntersections(points){let count=0;for(let i=0;i<points.length-1;i++)for(let j=i+2;j<points.length-1;j++){if(i===0&&j===points.length-2)continue;if(intersects(points[i],points[i+1],points[j],points[j+1]))count++;}return count;}
function polylineIntersections(a,b){let count=0;for(let i=0;i<a.length-1;i++)for(let j=0;j<b.length-1;j++)if(intersects(a[i],a[i+1],b[j],b[j+1]))count++;return count;}
function intersects(a,b,c,d){const cross=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);const ab1=cross(a,b,c),ab2=cross(a,b,d),cd1=cross(c,d,a),cd2=cross(c,d,b);return ab1*ab2<0&&cd1*cd2<0;}
function nearestPolylineDistance(point,points){let best=Infinity;for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1],vx=b.x-a.x,vy=b.y-a.y,t=Math.max(0,Math.min(1,((point.x-a.x)*vx+(point.y-a.y)*vy)/Math.max(1,vx*vx+vy*vy))),x=a.x+vx*t,y=a.y+vy*t;best=Math.min(best,Math.hypot(point.x-x,point.y-y));}return best;}
function severity(row){return row.drylineOrientationFailures+row.warmFrontOrientationFailures+row.extremeColdFrontOrientations+row.selfIntersectingBoundaries*3+row.excessiveSegmentJumps*2+row.multiCrossBoundaryPairs*3+row.longOverlapBoundaryPairs*2+row.frontsDetachedFromPrimaryLow*2+row.frontsWithoutAirMassContrast*2+row.warmSectorEdgeDisplacementKm/20;}
function sum(rows,key){return rows.reduce((total,row)=>total+(Number(row[key])||0),0);}
function mean(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:0;}

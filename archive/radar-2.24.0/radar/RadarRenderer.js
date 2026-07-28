import { clamp } from '../scenarios/math.js?v=2.20.1';
import { getProductRangeKm } from './RadarNetwork.js?v=2.20.1';
import { getAggregatedStormTruth } from '../storms/StormObservationLayer.js?v=2.20.1';

// The radar grid is independent from the 10-km atmospheric grid. 1024 pixels
// across the standard domain keeps the product near sub-kilometre resolution
// while analytic storm geometry supplies detail below the environment-cell scale.
const RADAR_GRID_SIZE = 1024;
const coverageCache = new Map();
const frameCache = new Map();

export function createRadarSnapshot(world) {
  const terrainSize = 25;
  const terrain = new Uint16Array(terrainSize * terrainSize);
  for (let y=0;y<terrainSize;y++) for (let x=0;x<terrainSize;x++) {
    const cx=Math.min(world.width-1,Math.floor((x+.5)/terrainSize*world.width));
    const cy=Math.min(world.height-1,Math.floor((y+.5)/terrainSize*world.height));
    terrain[y*terrainSize+x]=Math.max(0,Math.round(world.getCell(cx,cy)?.terrain?.elevationM??0));
  }
  return {
    snapshotVersion: 3,
    validHourUtc: world.stormEngine?.validHourUtc ?? world.validHourUtc,
    atmosphereValidHourUtc: world.validHourUtc,
    stormRevision: world.stormEngine?.revision ?? 0,
    width: world.width,
    height: world.height,
    cellSizeKm: world.cellSizeKm,
    domainWidthKm: world.domainWidthKm,
    domainHeightKm: world.domainHeightKm,
    terrainSize,
    radarGrid: { width: RADAR_GRID_SIZE, height: RADAR_GRID_SIZE, cellSizeKmX: world.domainWidthKm / RADAR_GRID_SIZE, cellSizeKmY: world.domainHeightKm / RADAR_GRID_SIZE },
    terrain: Array.from(terrain),
    radarNetwork: structuredClone(world.radarNetwork ?? null),
    stormObservationMeta: world.stormObservationLayer ? { sequence: world.stormObservationLayer.sequence, lastReportHourUtc: world.stormObservationLayer.lastReportHourUtc, reportIntervalHours: world.stormObservationLayer.reportIntervalHours, aggregationIntervalHours: world.stormObservationLayer.aggregationIntervalHours } : null,
    storms: mergeStormTruth(world).map(s=>({
      id:s.stormId??s.id, active:s.active??true, positionKm:{...s.positionKm}, velocityKph:{...(s.velocityKph??{east:0,north:0})},
      lifecycleState:s.lifecycleState, intensity:s.intensity??0.4, organization:s.organization??0.35,
      updraftStrength:s.updraftStrength??0.4, rotationStrength:s.rotationStrength??0,
      mesocycloneStrength:s.mesocycloneStrength??s.rotationStrength??0,
      orientationDeg:s.orientationDeg??0, mode:s.mode??'cell', radar:{...(s.radar??{})},
      hazards:{...(s.hazards??{})}, motion:{...(s.motion??{})}, surfaceWind:{...(s.surfaceWind??{})},
      tornado:s.tornado?structuredClone(s.tornado):null, eventTags:[...(s.eventTags??[])],
      ageHours:s.ageHours??0, structure:s.structure?structuredClone(s.structure):null
    }))
  };
}

export function rasterizeRadarValues(snapshot, product='reflectivity', stationId='composite') {
  const scan=snapshot.radarNetwork?.scanNumber??0;
  const stormKey=(snapshot.storms??[]).map(s=>`${s.id}:${s.positionKm.x.toFixed(2)}:${s.positionKm.y.toFixed(2)}:${s.intensity.toFixed(2)}:${(s.rotationStrength??0).toFixed(2)}:${s.mode}`).join('|');
  const key=`v4|${scan}|${product}|${stationId}|${stormKey}`;
  const size=RADAR_GRID_SIZE, values=new Float32Array(size*size), quality=coverageRaster(snapshot,product,stationId,size);
  values.fill(Number.NaN);
  for(const storm of snapshot.storms??[]) paintStorm(values,quality,size,snapshot,storm,product,stationId);
  return { values, quality, size, key };
}

export function rasterizeRadar(snapshot, product='reflectivity', stationId='composite') {
  const base=rasterizeRadarValues(snapshot,product,stationId);
  const { size, values, quality, key }=base;
  if(frameCache.has(key)) return frameCache.get(key);
  const imageData=new ImageData(size,size), d=imageData.data;
  for(let i=0;i<values.length;i++){
    const q=quality[i];
    const c=q>.025 && Number.isFinite(values[i]) ? productColor(product,values[i],q) : coverageBackground(q);
    const p=i*4; d[p]=c[0];d[p+1]=c[1];d[p+2]=c[2];d[p+3]=255;
  }
  const image=createDrawableSurface(imageData,size);
  const result={image,imageData,values,quality,size,key}; frameCache.set(key,result);
  if(frameCache.size>10) frameCache.delete(frameCache.keys().next().value);
  return result;
}

function coverageRaster(s,p,stationId,size){
  const key=`${s.radarNetwork?.networkId}|${p}|${stationId}|${size}|${s.domainWidthKm}|${s.domainHeightKm}`;
  if(coverageCache.has(key))return coverageCache.get(key);
  const out=new Float32Array(size*size), stations=s.radarNetwork?.stations??[];
  const eligible=stationId==='composite'?stations:stations.filter(r=>r.id===stationId);
  for(let py=0;py<size;py++)for(let px=0;px<size;px++){
    const x=(px+.5)/size*s.domainWidthKm,y=(py+.5)/size*s.domainHeightKm; let best=0;
    for(const r of eligible) best=Math.max(best,coverage(s,r,x,y,p)); out[py*size+px]=best;
  }
  coverageCache.set(key,out);return out;
}
function coverage(s,r,x,y,p){
  if(r.status!=='online')return 0; const dist=Math.hypot(x-r.xKm,y-r.yKm),range=getProductRangeKm(r,p); if(dist>range)return 0;
  let q=clamp(1-(dist/range)**2,0,1); q*=1-clamp((dist-range*.58)/(range*.52),0,.42);
  const az=((Math.atan2(y-r.yKm,x-r.xKm)*180/Math.PI)+360)%360;
  for(const sector of r.blockedSectors??[]) if(angleWithin(az,sector.fromDeg,sector.toDeg)) q*=1-sector.strength;
  const n=holeNoise(r.id,Math.floor(x/18),Math.floor(y/18)); if(n>.95)q*=.08;else if(n>.90)q*=.48;
  return clamp(q,0,1);
}

function paintStorm(values,quality,size,s,storm,product,stationId){
  const mode=String(storm.mode??'cell').toLowerCase();
  const supercell=mode.includes('supercell')||mode.includes('discrete');
  const linear=mode.includes('qlcs')||mode.includes('line')||mode.includes('squall');
  const mcs=mode.includes('mcs');
  const intensity=clamp(storm.intensity??.4,0,1.25);
  const organization=clamp(storm.organization??.35,0,1.2);
  const rotation=clamp(Math.max(storm.rotationStrength??0,storm.mesocycloneStrength??0),0,1.35);
  const hailPotential=clamp(storm.hazards?.hailProbability??0,0,1);
  const tornadoActive=Boolean(storm.tornado?.active || storm.tornado?.isActive);
  const tornadoPotential=clamp(storm.hazards?.tornadoProbability??0,0,1);

  const rx=clamp(storm.radar?.radiusXKm ?? (supercell?28+24*organization:linear?42+35*organization:mcs?58+48*organization:22+20*organization),18,115);
  const ry=clamp(storm.radar?.radiusYKm ?? (supercell?22+18*organization:linear?58+45*organization:mcs?62+50*organization:19+16*organization),16,125);
  const extent=Math.hypot(rx*1.45,ry*1.45);
  const minX=Math.max(0,Math.floor((storm.positionKm.x-extent)/s.domainWidthKm*size)),maxX=Math.min(size-1,Math.ceil((storm.positionKm.x+extent)/s.domainWidthKm*size));
  const minY=Math.max(0,Math.floor((storm.positionKm.y-extent)/s.domainHeightKm*size)),maxY=Math.min(size-1,Math.ceil((storm.positionKm.y+extent)/s.domainHeightKm*size));
  const angle=(storm.orientationDeg??0)*Math.PI/180,c=Math.cos(angle),sn=Math.sin(angle);
  const radar=nearestRadar(s,storm,stationId,product);
  if(!radar)return;

  for(let py=minY;py<=maxY;py++)for(let px=minX;px<=maxX;px++){
    const i=py*size+px;if(quality[i]<=.025)continue;
    const x=(px+.5)/size*s.domainWidthKm,y=(py+.5)/size*s.domainHeightKm,dx=x-storm.positionKm.x,dy=y-storm.positionKm.y;
    const lx=dx*c+dy*sn,ly=-dx*sn+dy*c;
    const f=storm.structure ? sampleStormStructure(lx,ly,storm.structure,{supercell,linear,mcs,intensity,organization,rotation,hailPotential,tornadoPotential,tornadoActive,stormId:storm.id}) : stormFields(lx,ly,rx,ry,{supercell,linear,mcs,intensity,organization,rotation,hailPotential,tornadoPotential,tornadoActive,stormId:storm.id});
    if(f.echo<.015)continue;

    if(product==='reflectivity'){
      const existing=Number.isFinite(values[i])?values[i]:-10;
      values[i]=Math.max(existing,clamp(f.dbz,-10,82));
    }else if(product==='velocity'){
      const ux=x-radar.xKm,uy=y-radar.yKm,dist=Math.max(1,Math.hypot(ux,uy));
      const radialX=ux/dist, radialY=uy/dist;
      const translation=(storm.velocityKph?.east??0)*radialX+(-(storm.velocityKph?.north??0))*radialY;
      const inflowU=f.inflowU*c-f.inflowV*sn;
      const inflowV=f.inflowU*sn+f.inflowV*c;
      const stormRelative=inflowU*radialX+inflowV*radialY;
      const couplet=f.couplet*rotation*(supercell?105:linear?72:45);
      values[i]=clamp(translation+stormRelative+couplet,-165,165);
    }else{
      // CC is displayed only inside actual echo. Ordinary rain stays near 0.99;
      // mixed hail lowers it modestly and a real debris signature lowers it sharply.
      let cc=.997-f.mixedPhase*.075-f.hailCore*.105-f.debris*.42;
      if(f.dbz<18)cc=.995;
      const existing=Number.isFinite(values[i])?values[i]:1;
      values[i]=Math.min(existing,clamp(cc,.48,1));
    }
  }
}


function sampleStormStructure(x,y,structure,o){
  let rain=0, ice=0, graupel=0, hail=0, debris=0, vertical=0, subtractRain=0;
  let inflowU=0,inflowV=0,couplet=0,mixedPhase=0;
  for(const feature of structure.features??[]){
    let w=0;
    if(feature.type==='hookArc'){
      const dx=x-(feature.centerXKm??0),dy=y-(feature.centerYKm??0),r=Math.hypot(dx,dy),a=((Math.atan2(dy,dx)*180/Math.PI)+360)%360;
      const radial=Math.exp(-Math.pow((r-(feature.radiusKm??10))/Math.max(1,feature.thicknessKm??3),2));
      const start=feature.startDeg??0,end=feature.endDeg??360;
      const inside=start<=end?(a>=start&&a<=end):(a>=start||a<=end);
      w=inside?radial*(feature.intensity??0):0;
    } else if(feature.type==='convectiveLine'){
      const yy=y/Math.max(1,(feature.lengthKm??30)/2);
      const curve=x-(feature.centerXKm??0)-(feature.bowKm??0)*(1-yy*yy);
      w=Math.exp(-Math.pow(curve/Math.max(1,feature.widthKm??5),2))*Math.exp(-Math.pow(yy,6))*(feature.intensity??0);
    } else {
      const a=(feature.rotationDeg??0)*Math.PI/180,c=Math.cos(a),sn=Math.sin(a);
      const dx=x-(feature.centerXKm??0),dy=y-(feature.centerYKm??0);
      const lx=dx*c+dy*sn,ly=-dx*sn+dy*c;
      w=Math.exp(-.5*((lx/Math.max(.5,feature.radiusXKm??3))**2+(ly/Math.max(.5,feature.radiusYKm??3))**2))*(feature.intensity??0);
    }
    rain += w*(feature.rain??0); ice += w*(feature.ice??0); graupel += w*(feature.graupel??0); hail += w*(feature.hail??0); debris += w*(feature.debris??0);
    vertical += w*(feature.vertical??0); subtractRain += w*(feature.subtractRain??0);
    if(feature.inflow){ inflowU-=24*w*feature.inflow; inflowV+=14*w*feature.inflow; }
    if(feature.rearInflow){ inflowU+=32*w*feature.rearInflow; }
    if(feature.downdraft){ inflowV-=18*w*feature.downdraft; }
  }
  rain=Math.max(0,rain-subtractRain);
  const hydro=rain+ice*.72+graupel*1.05+hail*1.5+debris*.5;
  const texture=.82+.18*multiNoise(o.stormId,x,y);
  const echo=clamp(hydro*texture,0,1.9);
  const dbz=clamp(7+42*Math.pow(echo,.58)+18*clamp(hail,0,1.3)+6*clamp(debris,0,1),0,82);
  const meso=structure.mesocyclone??{};
  const mx=(x-(meso.offsetXKm??0))/Math.max(1,meso.radiusKm??5),my=(y-(meso.offsetYKm??0))/Math.max(1,meso.radiusKm??5);
  const env=Math.exp(-2.1*(mx*mx+my*my));
  couplet=Math.tanh(my/.30)*env*clamp(meso.strength??0,0,1.3);
  const wind=structure.wind??{};
  const inflowEnv=gauss2(x+(structure.widthKm??40)*.02,y-(structure.heightKm??35)*.10,Math.max(4,(structure.widthKm??40)*.34),Math.max(4,(structure.heightKm??35)*.34));
  inflowU += -25*(wind.inflowStrength??0)*inflowEnv + 28*(wind.rearInflowStrength??0)*gauss2(x-(structure.widthKm??40)*.10,y,Math.max(4,(structure.widthKm??40)*.30),Math.max(4,(structure.heightKm??35)*.20));
  inflowV += 16*(wind.inflowStrength??0)*inflowEnv;
  mixedPhase=clamp((ice+graupel+hail)/(hydro+.01),0,1);
  return {echo,dbz,hailCore:clamp(hail,0,1.4),mixedPhase,debris:clamp(debris,0,1.4),couplet,inflowU,inflowV};
}
function stormFields(x,y,rx,ry,o){
  const nx=x/rx, ny=y/ry;
  const base=Math.exp(-1.65*(nx*nx+ny*ny));
  const texture=0.84+0.16*multiNoise(o.stormId,x,y);
  let precip=base, core=0, hook=0, line=0, stratiform=0;

  if(o.supercell){
    // Right-moving supercell anatomy: forward-flank shield, compact updraft/hail
    // core, weak-echo notch and a wrapping hook southwest of the mesocyclone.
    const forwardFlank=gauss2(x-rx*.30,y+ry*.03,rx*.68,ry*.72);
    const rearFlank=gauss2(x+rx*.38,y-ry*.08,rx*.38,ry*.42);
    core=gauss2(x-rx*.12,y+ry*.04,rx*.23,ry*.28);
    hook=hookEcho(x,y,rx,ry)*clamp(.30+.58*o.organization+.35*o.rotation,0,1.2);
    const notch=gauss2(x+rx*.05,y-ry*.13,rx*.23,ry*.26);
    precip=clamp(.72*forwardFlank+.28*rearFlank+.72*hook+.72*base-.56*notch,0,1.5);
  } else if(o.linear){
    line=bowEcho(x,y,rx,ry);
    core=gauss2(x-rx*.10,y,rx*.19,ry*.76);
    stratiform=gauss2(x+rx*.62,y,rx*.74,ry*.88);
    precip=clamp(.85*line+.46*core+.43*stratiform,0,1.5);
  } else if(o.mcs){
    line=bowEcho(x+rx*.18,y,rx*.88,ry*.78);
    stratiform=gauss2(x+rx*.35,y,rx*.92,ry*.90);
    core=gauss2(x-rx*.32,y,rx*.26,ry*.66);
    precip=clamp(.55*line+.70*stratiform+.58*core,0,1.5);
  } else {
    core=gauss2(x-rx*.08,y,rx*.28,ry*.32);
    precip=clamp(base+.45*core,0,1.4);
  }

  const hailCore=core*clamp((o.hailPotential-.18)*1.6+.42*o.intensity+.25*o.organization,0,1.25);
  const debrisCenterX=-rx*.42,debrisCenterY=ry*.36;
  const debris=gauss2(x-debrisCenterX,y-debrisCenterY,rx*.105,ry*.12)*(o.tornadoActive?clamp(.55+.55*o.rotation,0,1.25):0);
  const echo=clamp(precip*texture+.55*core+.35*hook,0,1.6);
  const dbz=clamp(5+47*Math.pow(echo,.62)+17*hailCore+7*debris,0,82);
  const mixedPhase=clamp(.22*precip+.42*hailCore,0,1);

  const mesoX=-rx*.30,mesoY=ry*.25;
  const mx=(x-mesoX)/(rx*.22),my=(y-mesoY)/(ry*.24);
  const mesoEnvelope=Math.exp(-2.15*(mx*mx+my*my));
  const couplet=Math.tanh(my/.34)*mesoEnvelope;
  const inflowEnvelope=gauss2(x+rx*.08,y-ry*.18,rx*.55,ry*.58);
  const inflowU=-28*o.organization*inflowEnvelope;
  const inflowV=18*o.organization*inflowEnvelope;
  return {echo,dbz,hailCore,mixedPhase,debris,couplet,inflowU,inflowV};
}

function hookEcho(x,y,rx,ry){
  const cx=-rx*.28,cy=ry*.23;
  const dx=(x-cx)/(rx*.42),dy=(y-cy)/(ry*.48),r=Math.hypot(dx,dy),a=Math.atan2(dy,dx);
  const arc=Math.exp(-Math.pow((r-.72)/.16,2))*clamp((a+.35)/2.55,0,1)*clamp((2.75-a)/.65,0,1);
  const append=gauss2(x+rx*.56,y-ry*.44,rx*.20,ry*.18);
  return Math.max(arc,append);
}
function bowEcho(x,y,rx,ry){
  const yy=y/ry;
  const curve=x/rx-.25*(1-yy*yy);
  return Math.exp(-Math.pow(curve/.15,2))*Math.exp(-Math.pow(yy,4));
}
function gauss2(x,y,sx,sy){return Math.exp(-.5*((x/sx)**2+(y/sy)**2));}
function multiNoise(id,x,y){
  const a=hashNoise(id,Math.floor(x*1.7),Math.floor(y*1.7));
  const b=hashNoise(id,Math.floor(x*.65),Math.floor(y*.65));
  return .62*a+.38*b;
}
function hashNoise(id,x,y){let h=2166136261,t=`${id}|${x}|${y}`;for(let i=0;i<t.length;i++){h^=t.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0)/4294967296;}
function nearestRadar(s,storm,id,p){const all=s.radarNetwork?.stations??[],e=id==='composite'?all:all.filter(r=>r.id===id);return e.filter(r=>Math.hypot(storm.positionKm.x-r.xKm,storm.positionKm.y-r.yKm)<=getProductRangeKm(r,p)).sort((a,b)=>Math.hypot(storm.positionKm.x-a.xKm,storm.positionKm.y-a.yKm)-Math.hypot(storm.positionKm.x-b.xKm,storm.positionKm.y-b.yKm))[0]??null;}
function coverageBackground(q){const v=Math.round(5+10*clamp(q,0,1));return [v,Math.round(v*1.25),Math.round(v*1.65),255];}
function productColor(p,v,q){
  if(p==='reflectivity')return interp([[-5,[4,8,14]],[5,[15,55,115]],[15,[20,140,70]],[30,[85,210,45]],[40,[245,225,35]],[50,[250,125,25]],[60,[225,30,35]],[70,[205,45,215]],[80,[250,250,250]]],v,q);
  if(p==='velocity'){const t=clamp(v/125,-1,1);return t<0?interp([[-1,[30,30,30]],[-.65,[15,185,80]],[-.15,[110,235,150]],[0,[205,205,205]]],t,q):interp([[0,[205,205,205]],[.15,[245,160,160]],[.65,[220,35,55]],[1,[95,15,120]]],t,q);}
  return interp([[.48,[70,0,90]],[.60,[165,20,150]],[.72,[235,45,75]],[.82,[245,145,25]],[.90,[245,230,45]],[.96,[70,205,105]],[1,[80,210,235]]],v,q);
}
function interp(stops,v,q){let a=stops[0],b=stops.at(-1);for(let i=1;i<stops.length;i++)if(v<=stops[i][0]){a=stops[i-1];b=stops[i];break;}const t=clamp((v-a[0])/(b[0]-a[0]||1),0,1),fade=.42+.58*q;return[0,1,2].map(i=>Math.round((a[1][i]+(b[1][i]-a[1][i])*t)*fade)).concat(255);}
function angleWithin(a,f,t){return f<=t?a>=f&&a<=t:a>=f||a<=t;}
function holeNoise(id,x,y){return hashNoise(id,x,y);}
function createDrawableSurface(imageData,size){
  if(typeof document!=='undefined'&&document.createElement){const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;const c=canvas.getContext('2d',{alpha:false});c.putImageData(imageData,0,0);return canvas;}
  if(typeof OffscreenCanvas!=='undefined'){const canvas=new OffscreenCanvas(size,size);canvas.getContext('2d',{alpha:false}).putImageData(imageData,0,0);return canvas;}
  return imageData;
}
function mergeStormTruth(world){
  const observed=world.stormObservationLayer?getAggregatedStormTruth(world):[];
  const byId=new Map(observed.map(s=>[s.stormId??s.id,s]));
  for(const storm of world.storms??[])if(storm.active)byId.set(storm.id,storm);
  return [...byId.values()];
}

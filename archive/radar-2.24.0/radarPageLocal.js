import { Atmosphere } from './atmosphere.js?v=2.20.1';
import { generateScenario } from './scenarios/scenarioGenerator.js?v=2.20.1';
import { initializeEvolution, advanceAtmosphere } from './evolution.js?v=2.20.1';
import { SIMULATION_CONFIG } from './simulationConfig.js?v=2.20.1';
import { WorldStateStore } from './world/WorldStateStore.js?v=2.20.1';
import { getRadarScanStatus, getProductRangeKm } from './radar/RadarNetwork.js?v=2.20.1';
import { createRadarSnapshot, rasterizeRadar } from './radar/RadarRenderer.js?v=2.20.1';
import { WeatherProductClient } from './api/WeatherProductClient.js?v=2.20.1';

const canvas=document.querySelector('#radarCanvas'),ctx=canvas.getContext('2d',{alpha:false});
const product=document.querySelector('#radarProduct'),station=document.querySelector('#radarStation');
const status=document.querySelector('#radarStatus'),stormsEl=document.querySelector('#stormList'),loading=document.querySelector('#radarLoading');
const zoomLabel=document.querySelector('#zoomLabel'),store=new WorldStateStore(),productClient=new WeatherProductClient();
let snapshot=null, frame=null, view={zoom:1,cx:.5,cy:.5},drag=null,raf=0;
let rasterSurface=null,rasterSurfaceKey='';

async function boot(){
  // Prefer the precomputed Node authority product. This removes scenario replay
  // and detailed radar generation from the page-load critical path.
  if(await productClient.health()){
    try{snapshot=await productClient.getRadarSnapshot();loading.textContent='Loaded weather-authority radar scan';}
    catch(error){console.warn('[weather-sim] Radar API unavailable; using local fallback.',error);}
  }
  if(!snapshot){
    const saved=store.load();
    if(saved?.radarSnapshot&&snapshotHasUsableStormFields(saved.radarSnapshot)){snapshot=saved.radarSnapshot;loading.textContent='Loaded cached authority scan';}
    else {loading.textContent=saved?.radarSnapshot?'Repairing invalid storm fields…':'Building first radar snapshot…';snapshot=await rebuild(saved);}
  }
  populateStations(); resize(); scheduleRender(); loading.hidden=true;
}

function snapshotHasUsableStormFields(value){
  const storms=value?.storms??[];
  if(!storms.length)return true;
  return storms.some(storm=>{
    if(storm.structure?.features?.length)return true;
    const field=storm.internalField;
    if(!field)return false;
    const expected=(Number(field.width)||32)*(Number(field.height)||32);
    if(field.version===2&&field.encoding==='u8-base64'){
      const rain=field.fields?.rain;
      return typeof rain==='string'&&rain.length>=Math.ceil(expected/3);
    }
    const rain=field.rain;
    return Array.isArray(rain)?rain.length===expected:ArrayBuffer.isView(rain)?rain.length===expected:Boolean(rain&&typeof rain==='object'&&Object.keys(rain).length===expected);
  });
}

async function rebuild(saved){
  const seed=saved?.currentSeed??20270503,world=new Atmosphere(SIMULATION_CONFIG.fixedColumns,SIMULATION_CONFIG.fixedRows);
  const config=generateScenario(world,seed);initializeEvolution(world,config);
  const target=saved?.validHourUtc??SIMULATION_CONFIG.startHourUtc;let n=0;
  while(world.validHourUtc+1e-6<target){advanceAtmosphere(world,Math.min(.5,target-world.validHourUtc));if(++n%4===0){loading.textContent=`Replaying atmosphere ${Math.round((world.validHourUtc/target)*100)}%`;await new Promise(requestAnimationFrame);}}
  return createRadarSnapshot(world);
}
function populateStations(){for(const s of snapshot.radarNetwork?.stations??[]){const o=document.createElement('option');o.value=s.id;o.textContent=`${s.id} · ${s.name}`;station.append(o);}}
function resize(){const r=canvas.parentElement.getBoundingClientRect(),dpr=Math.min(1.5,devicePixelRatio||1),cssSize=Math.max(320,Math.min(r.width,r.height||r.width,720));canvas.width=Math.round(cssSize*dpr);canvas.height=Math.round(cssSize*dpr);canvas.style.width=`${cssSize}px`;canvas.style.height=`${cssSize}px`;}
function scheduleRender(){cancelAnimationFrame(raf);raf=requestAnimationFrame(render);}
function render(){if(!snapshot)return;frame=rasterizeRadar(snapshot,product.value,station.value);ctx.imageSmoothingEnabled=false;
  const source=getRasterSurface(frame),sw=frame.size/view.zoom,sh=frame.size/view.zoom,sx=clamp(view.cx*frame.size-sw/2,0,frame.size-sw),sy=clamp(view.cy*frame.size-sh/2,0,frame.size-sh);
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
  drawCoverage(sx,sy,sw,sh);drawStations(sx,sy,sw,sh);updateSidebar();zoomLabel.textContent=`${view.zoom.toFixed(1)}×`;
}
function getRasterSurface(currentFrame){
  if(!rasterSurface){rasterSurface=document.createElement('canvas');rasterSurface.width=currentFrame.size;rasterSurface.height=currentFrame.size;}
  if(rasterSurface.width!==currentFrame.size||rasterSurface.height!==currentFrame.size){rasterSurface.width=currentFrame.size;rasterSurface.height=currentFrame.size;rasterSurfaceKey='';}
  if(rasterSurfaceKey!==currentFrame.key){const surfaceContext=rasterSurface.getContext('2d',{alpha:false});surfaceContext.putImageData(currentFrame.imageData,0,0);rasterSurfaceKey=currentFrame.key;}
  return rasterSurface;
}
function project(xKm,yKm,sx,sy,sw,sh){return{x:(xKm/snapshot.domainWidthKm*frame.size-sx)/sw*canvas.width,y:(yKm/snapshot.domainHeightKm*frame.size-sy)/sh*canvas.height};}
function drawCoverage(sx,sy,sw,sh){ctx.save();ctx.strokeStyle='rgba(255,255,255,.35)';ctx.lineWidth=Math.max(1,devicePixelRatio||1);ctx.setLineDash([8,6]);for(const s of snapshot.radarNetwork.stations){if(station.value!=='composite'&&station.value!==s.id)continue;const p=project(s.xKm,s.yKm,sx,sy,sw,sh),range=getProductRangeKm(s,product.value);ctx.beginPath();ctx.arc(p.x,p.y,range/snapshot.domainWidthKm*frame.size/sw*canvas.width,0,Math.PI*2);ctx.stroke();}ctx.restore();}
function drawStations(sx,sy,sw,sh){ctx.save();for(const s of snapshot.radarNetwork.stations){const p=project(s.xKm,s.yKm,sx,sy,sw,sh),sel=station.value===s.id;if(p.x<-30||p.y<-30||p.x>canvas.width+30||p.y>canvas.height+30)continue;ctx.fillStyle=sel?'#fff':'#a9b6c8';ctx.strokeStyle='#07101c';ctx.lineWidth=sel?4:2;ctx.beginPath();ctx.arc(p.x,p.y,sel?10:7,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.font=`${sel?'700':'600'} ${Math.round(12*(devicePixelRatio||1))}px ui-monospace`;ctx.strokeStyle='#000';ctx.lineWidth=4;ctx.strokeText(s.id,p.x+12,p.y+5);ctx.fillStyle='#fff';ctx.fillText(s.id,p.x+12,p.y+5);}ctx.restore();}
function drawStormLabels(sx,sy,sw,sh){ctx.save();ctx.font=`700 ${Math.round(11*(devicePixelRatio||1))}px ui-monospace`;for(const s of snapshot.storms??[]){const p=project(s.positionKm.x,s.positionKm.y,sx,sy,sw,sh);if(p.x<0||p.y<0||p.x>canvas.width||p.y>canvas.height)continue;ctx.strokeStyle='#000';ctx.lineWidth=4;ctx.strokeText(s.id,p.x+7,p.y-7);ctx.fillStyle='#fff';ctx.fillText(s.id,p.x+7,p.y-7);}ctx.restore();}
function updateSidebar(){const selected=station.value,scan=getScan(selected),range=scan?.rangeKm?` · ${Math.round(scan.rangeKm)} km`:'';let detectedBins=0,maxValue=-Infinity;if(frame){for(let i=0;i<frame.values.length;i++){const v=frame.values[i];if(product.value==='reflectivity'&&v>=5)detectedBins++;if(v>maxValue)maxValue=v;}}const validFields=(snapshot.storms??[]).filter(s=>snapshotHasUsableStormFields({storms:[s]})).length,invalidFields=(snapshot.storms?.length??0)-validFields;const productDetail=product.value==='reflectivity'?` · ${validFields} valid fields${invalidFields?` · ${invalidFields} invalid`:''} · ${detectedBins.toLocaleString()} echo bins · max ${Number.isFinite(maxValue)?maxValue.toFixed(0):'—'} dBZ`:'';status.textContent=`${selected==='composite'?'Network mosaic':`${selected} ${scan?.stationName??''}`}${range} · scan #${scan?.scanNumber??0} · ${formatHour(scan?.lastScanHourUtc??snapshot.validHourUtc)}${productDetail}`;
  const active=(snapshot.storms??[]).filter(s=>isDetected(s,selected,product.value));stormsEl.innerHTML=active.length?active.sort((a,b)=>b.intensity-a.intensity).map(s=>`<button class="storm-card storm-focus" data-storm="${s.id}" type="button"><strong>${s.id} · ${s.mode}</strong><span>${s.lifecycleState} · ${(s.intensity*100).toFixed(0)}% · ${s.radar?.maxReflectivityDbz?.toFixed(0)??'—'} dBZ</span><small>${s.eventTags?.length?s.eventTags.join(' · '):'No diagnosed severe hazard'}</small></button>`).join(''):'<p class="muted">No active storms detected in this product range.</p>';document.querySelectorAll('.storm-focus').forEach(b=>b.addEventListener('click',()=>focusStorm(b.dataset.storm)));}
function getScan(id){if(id==='composite'){const n=snapshot.radarNetwork;return{scanNumber:n.scanNumber,lastScanHourUtc:n.lastScanHourUtc,nextScanHourUtc:n.nextScanHourUtc,scanStrategy:n.scanStrategy};}const r=snapshot.radarNetwork.stations.find(s=>s.id===id);return r?{...r,stationName:r.name,rangeKm:getProductRangeKm(r,product.value)}:null;}
function isDetected(s,id,p){const rs=id==='composite'?snapshot.radarNetwork.stations:snapshot.radarNetwork.stations.filter(r=>r.id===id);return rs.some(r=>Math.hypot(s.positionKm.x-r.xKm,s.positionKm.y-r.yKm)<=getProductRangeKm(r,p));}
function focusStorm(id){const s=snapshot.storms.find(x=>x.id===id);if(!s)return;view={zoom:Math.max(view.zoom,4),cx:s.positionKm.x/snapshot.domainWidthKm,cy:s.positionKm.y/snapshot.domainHeightKm};scheduleRender();}
function zoomAt(factor,px=canvas.width/2,py=canvas.height/2){const old=view.zoom,nz=clamp(old*factor,1,12),vx=(px/canvas.width-.5)/old,vy=(py/canvas.height-.5)/old;view.cx=clamp(view.cx+vx-vx*old/nz,0,1);view.cy=clamp(view.cy+vy-vy*old/nz,0,1);view.zoom=nz;scheduleRender();}
function selectRadarAt(e){const rect=canvas.getBoundingClientRect(),px=(e.clientX-rect.left)*(canvas.width/rect.width),py=(e.clientY-rect.top)*(canvas.height/rect.height),sw=frame.size/view.zoom,sh=frame.size/view.zoom,sx=clamp(view.cx*frame.size-sw/2,0,frame.size-sw),sy=clamp(view.cy*frame.size-sh/2,0,frame.size-sh);let best=null,dist=22*(devicePixelRatio||1);for(const s of snapshot.radarNetwork.stations){const p=project(s.xKm,s.yKm,sx,sy,sw,sh),d=Math.hypot(px-p.x,py-p.y);if(d<dist){dist=d;best=s;}}if(best){station.value=best.id;view={zoom:2,cx:best.xKm/snapshot.domainWidthKm,cy:best.yKm/snapshot.domainHeightKm};scheduleRender();return true;}return false;}
canvas.addEventListener('wheel',e=>{e.preventDefault();const r=canvas.getBoundingClientRect();zoomAt(e.deltaY<0?1.35:.74,(e.clientX-r.left)*canvas.width/r.width,(e.clientY-r.top)*canvas.height/r.height);},{passive:false});
canvas.addEventListener('pointerdown',e=>{if(selectRadarAt(e))return;canvas.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,cx:view.cx,cy:view.cy};});
canvas.addEventListener('pointermove',e=>{if(!drag)return;const r=canvas.getBoundingClientRect();view.cx=clamp(drag.cx-(e.clientX-drag.x)/r.width/view.zoom,0,1);view.cy=clamp(drag.cy-(e.clientY-drag.y)/r.height/view.zoom,0,1);scheduleRender();});
canvas.addEventListener('pointerup',()=>drag=null);canvas.addEventListener('pointercancel',()=>drag=null);
product.addEventListener('change',scheduleRender);station.addEventListener('change',scheduleRender);
document.querySelector('#zoomIn').addEventListener('click',()=>zoomAt(1.5));document.querySelector('#zoomOut').addEventListener('click',()=>zoomAt(.67));document.querySelector('#zoomReset').addEventListener('click',()=>{view={zoom:1,cx:.5,cy:.5};scheduleRender();});
window.addEventListener('resize',()=>{resize();scheduleRender();});window.addEventListener('storage',e=>{if(e.key?.includes('fake-plains-weather-world'))location.reload();});
function formatHour(h){const d=Math.floor(h/24)+1,z=((h%24)+24)%24,m=Math.round((z-Math.floor(z))*60);return`${String(Math.floor(z)).padStart(2,'0')}:${String(m).padStart(2,'0')}Z Day ${d}`;}function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
boot();

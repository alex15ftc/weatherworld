import { profiler } from './performance/PerformanceProfiler.js?v=2.20.14';
import { WeatherProductClient } from './api/WeatherProductClient.js?v=2.20.14';
import { TileViewport } from './map/TileViewport.js?v=2.20.14';

const badge=document.querySelector('#authorityModeBadge');
if(location.protocol==='file:'){
  if(badge)badge.textContent='Authority: redirecting to Node';
  location.replace(`http://localhost:3000/${location.pathname.split('/').pop()||'radar.html'}${location.search}${location.hash}`);
}else if(new URLSearchParams(location.search).get('local')==='1'){
  if(badge)badge.textContent='Authority: explicit local mode';
  import('./radarPageLocal.js?v=2.20.14').catch(showFatal);
}else{
  if(badge)badge.textContent='Authority: Node · radar tiles';
  queueMicrotask(()=>startRemote().catch(showFatal));
}

async function startRemote(){
 const client=new WeatherProductClient({timeoutMs:4000});
 const canvas=document.querySelector('#radarCanvas'),product=document.querySelector('#radarProduct'),station=document.querySelector('#radarStation'),status=document.querySelector('#radarStatus'),loading=document.querySelector('#radarLoading'),stormsEl=document.querySelector('#stormList'),zoomLabel=document.querySelector('#zoomLabel');
 let manifest=null,storms=[],stations=[];const map=new TileViewport(canvas,{onViewChange:()=>zoomLabel.textContent=`${2**map.zoom}×`});
 map.setOverlay((ctx,view)=>{if(!manifest)return;ctx.save();ctx.font='700 12px ui-monospace';for(const s of stations){const p=view.project(s.xKm/manifest.domainWidthKm,s.yKm/manifest.domainHeightKm);if(p.x<0||p.y<0||p.x>view.width||p.y>view.height)continue;ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fill();ctx.fillText(s.id,p.x+8,p.y+4);}ctx.restore();});
 // Manifest first: paint the map before secondary overlays arrive.
 await load();loading.hidden=true;profiler.interactive({mode:'remote-radar-tiles'});
 Promise.all([client.getRadarStations(),client.getLiveStorms()]).then(([a,b])=>{stations=a;storms=b;for(const s of stations){const o=document.createElement('option');o.value=s.id;o.textContent=`${s.id} · ${s.name}`;station.append(o);}renderStormList();map.schedule();}).catch(()=>{});
 async function load(){loading.hidden=false;loading.textContent='Loading visible radar tiles…';manifest=await client.getMapManifest({scope:'radar',product:product.value,station:station.value});map.setManifest(manifest,{preserveView:true});status.textContent=`${station.value==='composite'?'Network mosaic':station.value} · 1024² radar grid · revision ${manifest.revision} · viewport tiles`;loading.hidden=true;}
 function renderStormList(){stormsEl.innerHTML=storms.length?storms.map(s=>`<button class="storm-card storm-focus" data-id="${s.id}"><strong>${s.id} · ${s.mode}</strong><span>${s.lifecycleState} · ${Math.round((s.intensity??0)*100)}%</span></button>`).join(''):'<p class="muted">No active storms.</p>';stormsEl.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{const s=storms.find(v=>v.id===b.dataset.id);if(!s||!manifest)return;map.center={x:s.positionKm.x/manifest.domainWidthKm,y:s.positionKm.y/manifest.domainHeightKm};map.zoom=Math.min(3,manifest.maxZoom);map.schedule();zoomLabel.textContent=`${2**map.zoom}×`;}));}
 product.addEventListener('change',()=>load().catch(showFatal));station.addEventListener('change',()=>load().catch(showFatal));document.querySelector('#zoomIn').addEventListener('click',()=>map.zoomBy(1));document.querySelector('#zoomOut').addEventListener('click',()=>map.zoomBy(-1));document.querySelector('#zoomReset').addEventListener('click',()=>map.reset());
}
function showFatal(error){const el=document.querySelector('#radarStatus');if(el)el.textContent=`Node radar authority unavailable: ${error.message}. Start it with npm start.`;if(badge)badge.textContent='Authority: unavailable';}

import { profiler } from './performance/PerformanceProfiler.js?v=2.20.14';
import { WeatherProductClient } from './api/WeatherProductClient.js?v=2.20.14';
import { TileViewport } from './map/TileViewport.js?v=2.20.14';

const client=new WeatherProductClient();
const mode=document.body.dataset.page||'live';
const day=mode.startsWith('day')?mode:'day1';
const scope=mode.startsWith('day')?'outlook':'live';
const canvas=document.querySelector('#mapCanvas');
const layer=document.querySelector('#layer');
const summary=document.querySelector('#summary');
const subtitle=document.querySelector('#mapSubtitle');
const badge=document.querySelector('#authorityModeBadge');
const tooltip=document.querySelector('#tooltip');
const gridButton=document.querySelector('#toggleGrid');
const stormOverlayButton=document.querySelector('#toggleStormOverlay');
const boundaryButton=document.querySelector('#toggleFeatures');
const regionButton=document.querySelector('#toggleRegions');
const regionLabelButton=document.querySelector('#toggleRegionLabels');
if(badge)badge.textContent='Authority: Node · interactive controls';
const controls={
  generate:document.querySelector('#generate'),step:document.querySelector('#stepTime'),play:document.querySelector('#playTime'),
  live:document.querySelector('#liveMode'),random:document.querySelector('#randomSeed'),time:document.querySelector('#simulationTime'),
  timeLabel:document.querySelector('#timeLabel'),seed:document.querySelector('#seed'),status:document.querySelector('#liveStatus')
};
Object.values(controls).filter(el=>el instanceof HTMLButtonElement||el instanceof HTMLInputElement).forEach(el=>{el.disabled=false;el.removeAttribute('title');});

let manifest=null,storms=[],hoveredCell=null,selectedCell=loadSelection(),selectedStorm=null,gridVisible=true,boundaryVisible=true,regionVisible=true,regionLabelsVisible=true,stormOverlayVisible=false,soundingAbort=null,previewTimer=null,stormRefreshTimer=null,controlBusy=false,pendingControl=null,timeDebounce=null,loadSequence=0,lastRandomSeed=null;
const map=new TileViewport(canvas,{onClick:selectCell,onHover:hoverCell,classicGrid:true,sourceZoom:2});
map.setOverlay(drawOverlay);

function pointToCell(point){if(!point||!manifest||point.inside===false)return null;return{row:Math.max(0,Math.min(manifest.height-1,Math.floor(point.y*manifest.height))),column:Math.max(0,Math.min(manifest.width-1,Math.floor(point.x*manifest.width)))};}
function drawOverlay(ctx,view){
  if(!manifest)return;ctx.save();
  if(gridVisible)drawGrid(ctx,view);
  if(regionVisible||regionLabelsVisible)drawRegions(ctx,view);
  if(boundaryVisible)drawBoundaries(ctx,view);
  drawCellHighlight(ctx,view,hoveredCell,'rgba(255,255,255,.12)','rgba(255,255,255,.82)',1.25);
  if(!selectedStorm)drawCellHighlight(ctx,view,selectedCell,'rgba(255,205,64,.16)','#ffd24a',3);
  ctx.font=`700 ${Math.max(11,Math.round(11*(devicePixelRatio||1)))}px ui-monospace`;
  if(scope==='live' && stormOverlayVisible) for(const storm of storms)drawStorm(ctx,view,storm);
  ctx.restore();
}
function drawBoundaries(ctx,view){
  const boundaries=manifest.overlays?.boundaries??[];
  for(const boundary of boundaries){
    if((boundary.pointsKm?.length??0)<2)continue;
    ctx.save();ctx.beginPath();
    boundary.pointsKm.forEach((point,index)=>{const p=view.project(point.x/(manifest.domainWidthKm||1),point.y/(manifest.domainHeightKm||1));index?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);});
    ctx.strokeStyle=boundary.type==='cold'?'#4ca3ff':boundary.type==='warm'?'#ff5f6d':'#e09b4c';
    ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';ctx.setLineDash(boundary.type==='dryline'?[10,6]:[]);ctx.stroke();ctx.setLineDash([]);
    const middle=boundary.pointsKm[Math.floor(boundary.pointsKm.length/2)],p=view.project(middle.x/(manifest.domainWidthKm||1),middle.y/(manifest.domainHeightKm||1));
    ctx.font='800 11px ui-monospace';ctx.textAlign='center';ctx.lineWidth=3;ctx.strokeStyle='rgba(0,0,0,.8)';ctx.strokeText(boundary.id,p.x,p.y-4);ctx.fillStyle='#fff';ctx.fillText(boundary.id,p.x,p.y-4);ctx.restore();
  }
}
function drawRegions(ctx,view){
  const regions=manifest.overlays?.regions,cells=regions?.cells??[];
  if(regionVisible&&cells.length){
    ctx.save();ctx.beginPath();
    for(let row=0;row<cells.length;row++)for(let column=0;column<cells[row].length;column++){
      const id=cells[row][column];
      if(column+1<cells[row].length&&cells[row][column+1]!==id){const a=view.project((column+1)/manifest.width,row/manifest.height),b=view.project((column+1)/manifest.width,(row+1)/manifest.height);ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}
      if(row+1<cells.length&&cells[row+1][column]!==id){const a=view.project(column/manifest.width,(row+1)/manifest.height),b=view.project((column+1)/manifest.width,(row+1)/manifest.height);ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}
    }
    ctx.strokeStyle='rgba(0,0,0,.75)';ctx.lineWidth=4;ctx.stroke();ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=1.5;ctx.stroke();ctx.restore();
  }
  if(regionLabelsVisible)for(const region of regions?.labels??[]){
    const p=view.project(region.centroid.x/manifest.width,region.centroid.y/manifest.height);
    ctx.font='800 13px ui-sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=4;ctx.strokeStyle='rgba(0,0,0,.8)';ctx.strokeText(region.label,p.x,p.y);ctx.fillStyle='#fff';ctx.fillText(region.label,p.x,p.y);
  }
}
function drawStorm(ctx,view,storm){
  const p=view.project(storm.positionKm.x/(manifest.domainWidthKm||500),storm.positionKm.y/(manifest.domainHeightKm||500));
  if(p.x<view.contentLeft||p.y<view.contentTop||p.x>view.contentLeft+view.contentWidth||p.y>view.contentTop+view.contentHeight)return;
  if(storm.trackPoints?.length>1){ctx.save();ctx.strokeStyle='rgba(255,255,255,.66)';ctx.lineWidth=2;ctx.setLineDash([7,5]);ctx.beginPath();storm.trackPoints.forEach((pt,i)=>{const t=view.project(pt.x/(manifest.domainWidthKm||500),pt.y/(manifest.domainHeightKm||500));i?ctx.lineTo(t.x,t.y):ctx.moveTo(t.x,t.y)});ctx.stroke();ctx.restore();}
  const selected=selectedStorm?.id===storm.id, size=selected?9:7;
  ctx.save();ctx.translate(p.x,p.y);ctx.lineWidth=selected?4:2.5;ctx.strokeStyle=selected?'#ffd24a':'#05070a';
  ctx.fillStyle=storm.lifecycleState==='weakening'||storm.lifecycleState==='dissipating'?'#9ca3af':storm.mode?.includes('supercell')?'#f97316':storm.mode==='QLCS'||storm.mode==='MCS'||storm.mode==='linear segment'?'#38bdf8':'#f8fafc';
  ctx.beginPath();
  if(storm.mode?.includes('supercell')){ctx.moveTo(0,-size);ctx.lineTo(size,size);ctx.lineTo(-size,size);ctx.closePath();}
  else if(storm.mode==='QLCS'||storm.mode==='MCS'||storm.mode==='linear segment'){ctx.rect(-size,-size*.6,size*2,size*1.2);}
  else{ctx.arc(0,0,size,0,Math.PI*2);}
  ctx.fill();ctx.stroke();ctx.restore();
  const speed=storm.motion?.speedKph??Math.hypot(storm.velocityKph?.east??0,storm.velocityKph?.north??0);if(speed>0){const q=view.project((storm.positionKm.x+(storm.velocityKph?.east??0)*.25)/(manifest.domainWidthKm||500),(storm.positionKm.y-(storm.velocityKph?.north??0)*.25)/(manifest.domainHeightKm||500));ctx.strokeStyle='rgba(255,255,255,.75)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();}
  const tor=storm.tornado;if(tor?.trackPoints?.length>1){ctx.strokeStyle='rgba(255,80,80,.9)';ctx.lineWidth=3;ctx.beginPath();tor.trackPoints.forEach((pt,i)=>{const t=view.project(pt.x/(manifest.domainWidthKm||500),pt.y/(manifest.domainHeightKm||500));i?ctx.lineTo(t.x,t.y):ctx.moveTo(t.x,t.y)});ctx.stroke();}
  if(tor?.onGround&&tor.positionKm){const t=view.project(tor.positionKm.x/(manifest.domainWidthKm||500),tor.positionKm.y/(manifest.domainHeightKm||500));ctx.fillStyle='#ef4444';ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(t.x,t.y-7);ctx.lineTo(t.x+6,t.y+6);ctx.lineTo(t.x-6,t.y+6);ctx.closePath();ctx.fill();ctx.stroke();}
  ctx.strokeStyle='#000';ctx.fillStyle='#fff';ctx.lineWidth=3;ctx.strokeText(storm.id,p.x+10,p.y-8);ctx.fillText(storm.id,p.x+10,p.y-8);
}
function drawGrid(ctx,view){
  const cols=manifest.width,rows=manifest.height;ctx.beginPath();ctx.strokeStyle='rgba(225,238,250,.34)';ctx.lineWidth=Math.max(1,devicePixelRatio||1);
  for(let c=0;c<=cols;c++){const p=view.project(c/cols,0);ctx.moveTo(Math.round(p.x)+.5,view.contentTop);ctx.lineTo(Math.round(p.x)+.5,view.contentTop+view.contentHeight);}
  for(let r=0;r<=rows;r++){const p=view.project(0,r/rows);ctx.moveTo(view.contentLeft,Math.round(p.y)+.5);ctx.lineTo(view.contentLeft+view.contentWidth,Math.round(p.y)+.5);}
  ctx.stroke();
}
function drawCellHighlight(ctx,view,cell,fill,stroke,width){if(!cell)return;const a=view.project(cell.column/manifest.width,cell.row/manifest.height),b=view.project((cell.column+1)/manifest.width,(cell.row+1)/manifest.height);ctx.fillStyle=fill;ctx.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.strokeRect(a.x+.5,a.y+.5,b.x-a.x-1,b.y-a.y-1);}

async function load(){
  const sequence=++loadSequence;
  const product=layer.value,outlookProduct=['risk','tornadoRisk','hailRisk','windRisk'].includes(product),actualScope=scope==='outlook'&&outlookProduct?'outlook':'live';
  const span=profiler.begin('page:tile-manifest',{scope:actualScope,product});
  const nextManifest=await client.getMapManifest({scope:actualScope,product,day});
  if(sequence!==loadSequence||product!==layer.value){profiler.end(span,{stale:true});return;}
  const preparedTiles=await map.prepareManifest(nextManifest,{z:2});
  if(sequence!==loadSequence||product!==layer.value){profiler.end(span,{stale:true,stage:'tiles'});return;}
  manifest=nextManifest;map.setManifest(manifest,{preserveView:false,preparedTiles});updateText();profiler.end(span,{storms:storms.length,atomicSwap:true});profiler.interactive({mode:'remote-classic-grid-product'});profiler.publish();
  if(scope==='live'){refreshStorms(sequence);if(!stormRefreshTimer)stormRefreshTimer=setInterval(()=>refreshStorms(),5000);}else{storms=[];selectedStorm=null;}
}
async function refreshStorms(sequence=null){
  try{
    const value=await client.getLiveStorms();
    if(sequence!==null&&sequence!==loadSequence)return;
    storms=value;
    if(selectedStorm){selectedStorm=storms.find(s=>s.id===selectedStorm.id)??null;if(selectedStorm)renderStormInspector(selectedStorm);else restoreCellInspector();}
    map.schedule();
    if(manifest)updateText();
  }catch{}
}
function updateText(){syncControls();subtitle.textContent=`Valid ${formatHour(manifest.validHourUtc)} · ${manifest.cellSizeMiles ?? 10} mi clickable grid · full-domain view`;summary.innerHTML=[`${manifest.width} × ${manifest.height}`,scope==='live'?`${manifest.stormCount} storms`:'forecast-only','classic grid'].map(v=>`<span>${v}</span>`).join('');document.querySelector('#domainSize').textContent=`${manifest.domainWidthMiles ?? Math.round(manifest.domainWidthKm/1.609344)} × ${manifest.domainHeightMiles ?? Math.round(manifest.domainHeightKm/1.609344)} mi · ${(manifest.width*manifest.height).toLocaleString()} cells · high-resolution tiled field`;renderForecastDiagnosis();renderLegend();}

function renderForecastDiagnosis(){const d=manifest?.forecastDiagnosis;if(!d)return;const set=(id,value)=>{const el=document.querySelector('#'+id);if(el)el.textContent=value;};set('synopticPattern',d.pattern??'—');set('synopticStage',d.stage??'—');set('analogConfidence',`${d.ensemble?.agreement??'—'} · ${d.confidence??'—'}% · ${d.ensemble?.memberCount??0} members`);set('outlookDiscussion',d.discussion??'');const list=(id,values,fallback)=>{const el=document.querySelector('#'+id);if(el)el.innerHTML=(values?.length?values:[fallback]).map(v=>`<li>${escapeHtml(v)}</li>`).join('');};list('analysisReasons',d.supportingFactors,'No strong supporting signal diagnosed.');list('analysisLimitations',d.limitingFactors,'No dominant limiting factor.');}
function renderLegend(){const label=document.querySelector('#legendLabel'),gradient=document.querySelector('#legendGradient'),scale=document.querySelector('.legend-scale'),units=document.querySelector('#legendUnits');if(label)label.textContent=layer.options[layer.selectedIndex]?.textContent??layer.value;if(!manifest?.legend||!gradient)return;gradient.style.background=`linear-gradient(90deg,${manifest.legend.map(([,color])=>color).join(',')})`;if(units)units.textContent=layer.value==='risk'?'SPC category':'probability';if(scale)scale.innerHTML=manifest.legend.map(([name,color])=>`<span class="legend-chip"><i style="background:${color}"></i>${name}</span>`).join('')+(manifest.hatchLegend?`<span class="legend-hatch">//// significant</span>`:'');}
function hoverCell(point,event){hoveredCell=pointToCell(point);canvas.style.cursor=hoveredCell?'crosshair':'default';if(tooltip){if(!hoveredCell||!event)tooltip.classList.add('hidden');else{tooltip.textContent=`Cell (${hoveredCell.column}, ${hoveredCell.row}) · click for sounding`;tooltip.style.left=`${event.clientX+12}px`;tooltip.style.top=`${event.clientY+12}px`;tooltip.classList.remove('hidden');}}map.schedule();}
function selectCell(point){const storm=(scope==='live'&&stormOverlayVisible)?nearestStorm(point):null;if(storm){selectStorm(storm);return;}const cell=pointToCell(point);if(!cell)return;selectedStorm=null;selectedCell=cell;saveSelection(cell);restoreCellInspector();map.schedule();openDetailedSounding(cell);}
function nearestStorm(point){if(!point||!manifest)return null;let best=null,bestD=Infinity;for(const storm of storms){const sx=storm.positionKm.x/(manifest.domainWidthKm||500),sy=storm.positionKm.y/(manifest.domainHeightKm||500),d=Math.hypot(point.x-sx,point.y-sy);if(d<bestD){bestD=d;best=storm;}}return bestD<=0.025?best:null;}
function selectStorm(storm){selectedStorm=storm;map.schedule();renderStormInspector(storm);}
function restoreCellInspector(){const eyebrow=document.querySelector('#inspectorEyebrow'),title=document.querySelector('#cellTitle'),info=document.querySelector('#cellInfo');if(eyebrow)eyebrow.textContent='Grid-cell analysis';if(title&&!selectedCell)title.textContent='No cell selected';if(info&&!selectedCell){info.classList.add('muted');info.textContent='Click a cell to open its sounding and atmospheric profile.';}document.querySelector('#clearStormSelection')?.classList.add('hidden');document.querySelector('#openSounding')?.classList.remove('hidden');}
function renderStormInspector(storm){
  if(!storm)return;
  const eyebrow=document.querySelector('#inspectorEyebrow'),title=document.querySelector('#cellTitle'),info=document.querySelector('#cellInfo');
  if(!title||!info){console.warn('Storm inspector markup is unavailable on this page.');return;}
  const tor=storm.tornado??{};
  const extremes=storm.hazardExtremes??storm.extremes??{};
  const torMax=extremes.tornado??storm.tornadoMax??{};
  const windMax=extremes.wind??storm.windMax??{};
  const hailMax=extremes.hail??storm.hailMax??{};
  const numericMax=(...values)=>Math.max(0,...values.map(Number).filter(Number.isFinite));
  const maxSustained=numericMax(windMax.maxSustainedMph,storm.surfaceWind?.maxSustainedMph,storm.maxSustainedMph);
  const maxGust=numericMax(windMax.maxGustMph,storm.surfaceWind?.maxGustMph,storm.maxGustMph);
  const maxTorWind=numericMax(torMax.maxWindMph,torMax.peakWindSpeedMph,tor.peakWindSpeedMph,...(storm.tornadoHistory??[]).map(t=>t.maxWindMph??t.peakWindSpeedMph??t.windSpeedMph));
  const maxTorWidth=numericMax(torMax.maxWidthYards,torMax.peakWidthYards,tor.peakWidthYards,...(storm.tornadoHistory??[]).map(t=>t.maxWidthYards??t.peakWidthYards??t.widthYards));
  const maxTorPath=numericMax(torMax.maxPathLengthKm,torMax.pathLengthKm,tor.pathLengthKm,...(storm.tornadoHistory??[]).map(t=>t.maxPathLengthKm??t.pathLengthKm));
  const maxHail=numericMax(hailMax.maxSizeInches,storm.maxHailSizeInches,storm.hazards?.hailSizeInches);
  const ef=torMax.maxEfRating??torMax.estimatedEf??tor.estimatedEf??[...(storm.tornadoHistory??[])].reverse().find(t=>t.maxEfRating??t.efRating)?.maxEfRating??[...(storm.tornadoHistory??[])].reverse().find(t=>t.efRating)?.efRating??'None';
  if(eyebrow)eyebrow.textContent='Storm lifecycle inspector';
  title.textContent=`${storm.id??'Storm'} · ${storm.mode??'unknown mode'}`;
  info.classList.remove('muted');
  info.innerHTML=`<div class="storm-inspector-grid">${[['Lifecycle',storm.lifecycleState??'unknown'],['Age',`${(Number(storm.ageHours)||0).toFixed(1)} hr`],['Motion',`${Math.round(storm.motion?.directionDeg??0)}° at ${Math.round(storm.motion?.speedMph??0)} mph`],['Intensity',pct(storm.intensity)],['Organization',pct(storm.organization)],['Updraft',pct(storm.updraftStrength)],['Rotation',pct(storm.rotationStrength)],['Cold pool',pct(storm.coldPoolStrength)],['Current sustained wind',`${Math.round(storm.surfaceWind?.sustainedMph??0)} mph`],['Current gust',`${Math.round(storm.surfaceWind?.gustMph??0)} mph`],['Max sustained wind',`${Math.round(maxSustained)} mph`],['Peak gust',`${Math.round(maxGust)} mph`],['Max hail size',`${maxHail.toFixed(2)} in`],['Max tornado',`${ef} · ${Math.round(maxTorWind)} mph`],['Max TOR width',`${Math.round(maxTorWidth)} yd`],['Max TOR path',`${maxTorPath.toFixed(1)} km`],['TOR potential',pct(tor.genesisPotential)],['Analysis STP',(Number(storm.environmentSummary?.stp)||0).toFixed(1)],['Analysis VTP',(Number(tor.vtp??storm.environmentSummary?.vtp)||0).toFixed(1)],['Synoptic support',pct(tor.synopticSupport)],['TOR wind ceiling',`${Math.round(tor.environmentWindCeilingMph??0)} mph`],['Tornado',tor.onGround?`${tor.estimatedEf??'EF?'} on ground`:(tor.state??'none')],['TOR wind',`${Math.round(tor.windSpeedMph??0)} mph`],['TOR width',`${Math.round(tor.widthYards??0)} yd`],['TOR path',`${(Number(tor.pathLengthKm)||0).toFixed(1)} km`],['Parent',storm.parentId??'—'],['Children',(storm.children??[]).join(', ')||'—'],['Mergers',String(storm.mergeCount??0)]].map(([a,b])=>`<div><small>${a}</small><strong>${b}</strong></div>`).join('')}</div>`;
  document.querySelector('#openSounding')?.classList.add('hidden');
  document.querySelector('#clearStormSelection')?.classList.remove('hidden');
}
function pct(v){return `${Math.round((Number(v)||0)*100)}%`;}
async function openDetailedSounding(cell){
  if(soundingAbort)soundingAbort.abort();soundingAbort=new AbortController();
  const modal=document.querySelector('#soundingModal');document.querySelector('#soundingTitle').textContent=`Cell (${cell.column}, ${cell.row}) sounding`;document.querySelector('#soundingSubtitle').textContent='Loading atmospheric profile…';modal?.classList.remove('hidden');
  try{const sounding=await client.getSounding(cell.row,cell.column,{day,revision:manifest?.revision,authority:manifest?.authorityInstance});if(selectedCell?.row!==cell.row||selectedCell?.column!==cell.column)return;await renderSounding(sounding,cell);}catch(error){if(error.name!=='AbortError')document.querySelector('#soundingSubtitle').textContent=`Sounding unavailable: ${error.message}`;}
}
async function renderSounding(s,cell){
  const context=s.context??{},surface=context.surface??{},forcing=context.forcing??{},terrain=context.terrain??{},outlook=context.outlook??null,p=s.params??{};
  document.querySelector('#soundingTitle').textContent=`Cell (${cell.column}, ${cell.row}) sounding`;
  document.querySelector('#soundingSubtitle').textContent=`Valid ${formatHour(s.validHourUtc??manifest.validHourUtc)} · ${formatNumber(terrain.elevationM,0,'m MSL')} · ${(cell.column*(manifest.cellSizeMiles??10)).toFixed(0)}–${((cell.column+1)*(manifest.cellSizeMiles??10)).toFixed(0)} miles east`;
  document.querySelector('#soundingMetrics').innerHTML=metricDefinitions(p).map(([label,value])=>metricBox(label,value)).join('');
  renderEffectiveLayerStpPlot(p,outlook);
  document.querySelector('#forcingDetails').innerHTML=detailDefinitions(surface,forcing,terrain,context.features,outlook).map(([label,value])=>`<div><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`).join('');
  document.querySelector('#profileTableBody').innerHTML=(s.profile??[]).map(r=>`<tr><td>${formatNumber(r.p,0,'hPa')}</td><td>${formatNumber(r.heightM,0,'m MSL')}</td><td>${formatNumber(r.t,1,'°C')}</td><td>${formatNumber(r.td,1,'°C')}</td><td>${formatNumber(r.rh,0,'%')}</td><td>${formatWind(r.dir,r.spd)}</td></tr>`).join('');
  const drawings=await import('./sounding.js?v=2.20.14');drawings.drawSounding(document.querySelector('#skewTCanvas'),s);drawings.drawHodograph(document.querySelector('#hodoCanvas'),s);
}
function metricDefinitions(p){return[
  ['SBCAPE',formatNumber(p.sbcape,0,'J kg⁻¹')],['MLCAPE',formatNumber(p.mlcape,0,'J kg⁻¹')],['MUCAPE',formatNumber(p.mucape,0,'J kg⁻¹')],
  ['SBCIN',formatNumber(p.sbcin,0,'J kg⁻¹')],['MLCIN',formatNumber(p.mlcin,0,'J kg⁻¹')],['MUCIN',formatNumber(p.mucin,0,'J kg⁻¹')],
  ['LCL',formatNumber(p.lclM,0,'m MSL')],['LFC',formatNumber(p.lfcM,0,'m MSL')],['EL',formatNumber(p.elM,0,'m MSL')],
  ['Freezing level',formatNumber(p.freezingM,0,'m MSL')],['Wet-bulb zero',formatNumber(p.wetBulbZeroM,0,'m MSL')],['Lifted Index',formatNumber(p.liftedIndex,1,'°C')],
  ['PWAT',formatNumber(p.precipWater,2,'in')],['Convective temperature',formatNumber(p.convectiveTempC,1,'°C')],
  ['0–1 km shear',formatNumber(p.shear01,0,'kt')],['0–3 km shear',formatNumber(p.shear03,0,'kt')],['0–6 km shear',formatNumber(p.shear06,0,'kt')],
  ['0–1 km SRH',formatNumber(p.srh01,0,'m² s⁻²')],['0–3 km SRH',formatNumber(p.srh03,0,'m² s⁻²')],['Critical angle',formatNumber(p.criticalAngle,0,'°')],
  ['STP',formatNumber(p.stp,1,'')],['VTP',formatNumber(p.vtp,1,'')],['SCP',formatNumber(p.scp,1,'')]
];}
function detailDefinitions(surface,forcing,terrain,features,outlook){const rows=[
  ['Surface temperature',formatNumber(surface.temperatureF,1,'°F')],['Surface dewpoint',formatNumber(surface.dewpointF,1,'°F')],['Sea-level pressure',formatNumber(surface.pressureMb,1,'hPa')],['Surface wind',formatWind(surface.windDirectionDeg,surface.windSpeedKt)],
  ['Forcing score',formatNumber(forcing.forcingScore,2,'')],['Convective readiness',formatPercent(forcing.convectiveReadiness)],['Trigger strength',formatPercent(forcing.triggerStrength)],['Initiation potential',formatPercent(forcing.initiationPotential)],['Vertical motion',formatNumber(forcing.verticalVelocityMs,2,'m s⁻¹')],
  ['Terrain elevation',formatNumber(terrain.elevationM,0,'m MSL')],['Region',text(terrain.region)],['Air mass',text(features?.airMass)],['Boundary',features?.dryline?'Dryline':text(features?.front)]
];if(outlook){rows.push(['Forecast risk',text(outlook.risk)],['Tornado probability',formatNumber(outlook.tornadoProbability,0,'%')],['Significant tornado area',outlook.significantTornado?'Yes':'No'],['Hail probability',formatNumber(outlook.hailProbability,0,'%')],['Wind probability',formatNumber(outlook.windProbability,0,'%')]);}return rows;}
function renderEffectiveLayerStpPlot(p,outlook){
  const panel=document.querySelector('#effectiveLayerStpPanel');
  if(!panel)return;
  const stp=Math.max(0,Number(p.stp)||0);
  const probability=effectiveStpProbability(stp);
  const hazard=possibleHazardType(p,outlook);
  panel.innerHTML=`<div class="effective-stp-heading"><div><p class="eyebrow">Tornado environment</p><h3>Effective Layer STP (with CIN)</h3></div><div class="effective-stp-summary"><span>STP <strong>${formatNumber(stp,1,'')}</strong></span><span>VTP <strong>${formatNumber(p.vtp,1,'')}</strong></span><span>Estimated EF2+ TOR <strong>${formatNumber(probability*100,0,'%')}</strong></span>${outlook?`<span>Forecast TOR <strong>${formatNumber(outlook.tornadoProbability,0,'%')}</strong></span>`:''}</div></div><div class="stp-hazard-layout"><div class="stp-plot-wrap">${effectiveStpSvg(stp,hazard)}</div><aside class="possible-hazard-box ${hazard.className}"><small>Psbl. Haz. Type</small><strong>${hazard.label}</strong></aside></div><p class="effective-stp-note">Boxes compare the selected sounding's effective-layer STP with representative nontornadic and EF-scale supercell distributions. The horizontal marker is the current sounding value.</p>`;
}
function possibleHazardType(p,outlook){
  const stp=Number(p.stp)||0,scp=Number(p.scp)||0,srh=Number(p.srh01)||0,shear=Number(p.shear06)||0,cape=Number(p.mlcape)||0,lcl=Number(p.lclM)||9999,cin=Math.abs(Number(p.mlcin)||0),tor=Number(outlook?.tornadoProbability)||0;
  if(stp>=4&&srh>=250&&shear>=45&&cape>=1500&&lcl<=1200&&cin<=100)return{label:'PDS TOR',className:'hazard-pds',line:'#ff4fd8'};
  if(stp>=2&&srh>=175&&shear>=40&&cape>=1000&&lcl<=1500)return{label:'TOR',className:'hazard-tor',line:'#ff3b30'};
  if(stp>=1||tor>=5)return{label:'MRGL TOR',className:'hazard-mrgl-tor',line:'#ff9f0a'};
  if(scp>=1||shear>=35||cape>=1000)return{label:'MRGL SVR',className:'hazard-mrgl-svr',line:'#00d8ff'};
  return{label:'NONE',className:'hazard-none',line:'#ffd43b'};
}
function effectiveStpProbability(stp){
  if(stp<.1)return .02;if(stp<.5)return .05;if(stp<1)return .10;if(stp<2)return .19;if(stp<3)return .32;if(stp<5)return .45;if(stp<7)return .58;return .65;
}
function effectiveStpSvg(stp,hazard){
  const groups=[
    ['EF4+',[2.3,3.6,5.2,7.8,10.8]],['EF3',[1.0,1.8,2.8,4.5,7.4]],['EF2',[.55,1.05,1.75,3.0,5.5]],
    ['EF1',[.25,.55,1.05,1.85,3.9]],['EF0',[.08,.25,.55,1.15,2.7]],['NONTOR',[0,.03,.12,.35,1.15]]
  ];
  const width=590,height=260,left=46,right=14,top=10,bottom=38,max=12,plotH=height-top-bottom;
  const y=v=>top+plotH-(Math.max(0,Math.min(max,v))/max)*plotH;
  const slot=(width-left-right)/groups.length;
  let grid='';for(let v=0;v<=12;v+=2){const yy=y(v);grid+=`<line x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}" class="stp-grid"/><text x="${left-9}" y="${yy+4}" class="stp-axis" text-anchor="end">${v}</text>`;}
  const boxes=groups.map(([label,d],i)=>{const [lo,q1,med,q3,hi]=d,x=left+slot*(i+.5),bw=Math.min(54,slot*.54);return `<g><line x1="${x}" y1="${y(hi)}" x2="${x}" y2="${y(lo)}" class="stp-whisker"/><line x1="${x-11}" y1="${y(hi)}" x2="${x+11}" y2="${y(hi)}" class="stp-whisker"/><line x1="${x-11}" y1="${y(lo)}" x2="${x+11}" y2="${y(lo)}" class="stp-whisker"/><rect x="${x-bw/2}" y="${y(q3)}" width="${bw}" height="${Math.max(2,y(q1)-y(q3))}" class="stp-box"/><line x1="${x-bw/2}" y1="${y(med)}" x2="${x+bw/2}" y2="${y(med)}" class="stp-median"/><text x="${x}" y="${height-17}" class="stp-label" text-anchor="middle">${label}</text></g>`;}).join('');
  const currentY=y(stp);
  return `<svg class="effective-stp-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Effective Layer STP with CIN box plots. Current STP ${formatNumber(stp,1,'')}."><text x="16" y="${top+plotH/2}" class="stp-y-title" text-anchor="middle" transform="rotate(-90 16 ${top+plotH/2})">Effective-layer STP</text>${grid}${boxes}<line x1="${left}" y1="${currentY}" x2="${width-right}" y2="${currentY}" class="stp-current" style="stroke:${hazard?.line??'#ffd43b'}"/><rect x="${width-right-62}" y="${Math.max(top,currentY-20)}" width="62" height="18" rx="3" class="stp-current-tag"/><text x="${width-right-31}" y="${Math.max(top+13,currentY-7)}" class="stp-current-text" text-anchor="middle">STP ${formatNumber(stp,1,'')}</text></svg>`;
}
function metricBox(label,value){return`<div class="metric-box"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`;}
function formatNumber(value,digits,unit){const n=Number(value);if(!Number.isFinite(n))return'—';const number=n.toLocaleString(undefined,{minimumFractionDigits:digits,maximumFractionDigits:digits});return unit?`${number} ${unit}`:number;}
function formatPercent(value){const n=Number(value);if(!Number.isFinite(n))return'—';return`${Math.round(Math.abs(n)<=1?n*100:n)} %`;}
function formatWind(direction,speed){if(!Number.isFinite(Number(direction))&&!Number.isFinite(Number(speed)))return'—';return`${formatNumber(direction,0,'°')} at ${formatNumber(speed,0,'kt')}`;}
function text(value){return value===null||value===undefined||value===''?'—':String(value).replace(/[-_]/g,' ').replace(/\b\w/g,m=>m.toUpperCase());}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function saveSelection(cell){try{sessionStorage.setItem('wx-selected-cell',JSON.stringify(cell));}catch{}}
function loadSelection(){try{return JSON.parse(sessionStorage.getItem('wx-selected-cell')||'null');}catch{return null;}}
function formatHour(h){const d=Math.floor(h/24)+1,z=((h%24)+24)%24;return`${String(Math.floor(z)).padStart(2,'0')}Z Day ${d}`;}
layer.addEventListener('change',()=>load().catch(showError));
gridButton?.addEventListener('click',()=>{gridVisible=!gridVisible;gridButton.classList.toggle('active',gridVisible);gridButton.textContent=gridVisible?'Hide 10 mi grid':'Show 10 mi grid';map.schedule();});
boundaryButton?.addEventListener('click',()=>{boundaryVisible=!boundaryVisible;boundaryButton.classList.toggle('active',boundaryVisible);boundaryButton.textContent=boundaryVisible?'Hide boundaries':'Show boundaries';map.schedule();});
regionButton?.addEventListener('click',()=>{regionVisible=!regionVisible;regionButton.classList.toggle('active',regionVisible);regionButton.textContent=regionVisible?'Hide region borders':'Show region borders';map.schedule();});
regionLabelButton?.addEventListener('click',()=>{regionLabelsVisible=!regionLabelsVisible;regionLabelButton.classList.toggle('active',regionLabelsVisible);regionLabelButton.textContent=regionLabelsVisible?'Hide region labels':'Show region labels';map.schedule();});
stormOverlayButton?.addEventListener('click',()=>{stormOverlayVisible=!stormOverlayVisible;stormOverlayButton.classList.toggle('active',stormOverlayVisible);stormOverlayButton.textContent=stormOverlayVisible?'Hide storms and tracks':'Show storms and tracks';if(!stormOverlayVisible&&selectedStorm){selectedStorm=null;restoreCellInspector();}map.schedule();});
document.querySelector('#closeSounding')?.addEventListener('click',()=>document.querySelector('#soundingModal')?.classList.add('hidden'));
document.querySelector('#soundingModal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.classList.add('hidden');});
function showError(error){subtitle.textContent=`Weather authority update failed: ${error.message}`;if(controls.status)controls.status.textContent=`Update failed · ${error.message}`;}

function syncControls(){
  if(!manifest)return;
  if(controls.seed)controls.seed.value=String(manifest.seed);
  if(controls.time){controls.time.value=String(manifest.validHourUtc);controls.time.max='84';}
  if(controls.timeLabel)controls.timeLabel.textContent=formatHourPrecise(manifest.validHourUtc);
  if(controls.live){controls.live.textContent=manifest.autoAdvance?'Pause live world clock':'Start live world clock';controls.live.classList.toggle('active',Boolean(manifest.autoAdvance));}
  if(controls.status)controls.status.textContent=`${manifest.autoAdvance?'Running':'Paused'} · server authority · revision ${manifest.revision} · seed ${manifest.seed}`;
}
function setControlBusy(busy,message='Updating authoritative simulation…'){
  controlBusy=busy;
  [controls.generate,controls.step,controls.live,controls.time].filter(Boolean).forEach(el=>el.disabled=busy);
  if(controls.status&&busy)controls.status.textContent=message;
}
async function runControl(action,message,{expectedSeed=null}={}){
  if(controlBusy){pendingControl={action,message,expectedSeed};if(controls.status)controls.status.textContent=expectedSeed!==null?`Queued seed ${expectedSeed}…`:'Queued latest simulation update…';return;}
  setControlBusy(true,message);
  try{const result=await action();if(expectedSeed!==null&&Number(result?.seed)!==Number(expectedSeed))throw new Error(`Authority returned seed ${result?.seed??'unknown'} instead of ${expectedSeed}`);applyAuthorityMetadata(result);await load();}
  catch(error){showError(error);}
  finally{
    setControlBusy(false);if(manifest)syncControls();
    const next=pendingControl;pendingControl=null;
    if(next)queueMicrotask(()=>runControl(next.action,next.message,{expectedSeed:next.expectedSeed}));
  }
}
function applyAuthorityMetadata(value){if(!value)return;if(controls.seed&&Number.isFinite(Number(value.seed)))controls.seed.value=String(value.seed);if(controls.time&&Number.isFinite(Number(value.validHourUtc)))controls.time.value=String(value.validHourUtc);if(controls.timeLabel&&Number.isFinite(Number(value.validHourUtc)))controls.timeLabel.textContent=formatHourPrecise(Number(value.validHourUtc));if(controls.status)controls.status.textContent=`Authority updated · revision ${value.revision} · seed ${value.seed}`;}
function randomSeed(){const a=new Uint32Array(1);if(globalThis.crypto?.getRandomValues)crypto.getRandomValues(a);let seed=10000000+((a[0]||Math.floor(Math.random()*0xffffffff))%90000000);if(seed===lastRandomSeed||seed===Number(manifest?.seed))seed=(seed+7919)%90000000+10000000;lastRandomSeed=seed;return seed;}
const currentView=()=>({scope,day,product:layer?.value||'risk',z:2});
controls.generate?.addEventListener('click',()=>runControl(()=>client.resetAuthority(Number(controls.seed?.value),currentView()),'Generating seeded atmosphere…',{expectedSeed:Number(controls.seed?.value)}));
controls.random?.addEventListener('click',()=>{const seed=randomSeed();if(controls.seed)controls.seed.value=String(seed);if(controls.status)controls.status.textContent=`Queued random seed ${seed}…`;runControl(()=>client.resetAuthority(seed,currentView()),`Generating random atmosphere · seed ${seed}…`,{expectedSeed:seed});});
controls.step?.addEventListener('click',()=>runControl(()=>client.advanceAuthority(.5,currentView()),'Advancing atmosphere 30 simulated minutes…'));
controls.live?.addEventListener('click',()=>runControl(()=>client.setAuthorityClock(!manifest?.autoAdvance),manifest?.autoAdvance?'Pausing live clock…':'Starting live clock…'));
controls.time?.addEventListener('input',()=>{if(controls.timeLabel)controls.timeLabel.textContent=formatHourPrecise(Number(controls.time.value));clearTimeout(timeDebounce);timeDebounce=setTimeout(()=>runControl(()=>client.seekAuthority(Number(controls.time.value),currentView()),'Loading selected simulation time…'),220);});
controls.time?.addEventListener('change',()=>{clearTimeout(timeDebounce);runControl(()=>client.seekAuthority(Number(controls.time.value),currentView()),'Loading selected simulation time…');});
controls.play?.addEventListener('click',()=>{
  if(previewTimer){clearInterval(previewTimer);previewTimer=null;controls.play.textContent='Fast preview';controls.play.classList.remove('active');return;}
  controls.play.textContent='Pause preview';controls.play.classList.add('active');
  previewTimer=setInterval(()=>{if(!controlBusy)runControl(()=>client.advanceAuthority(.5,currentView()),'Fast preview advancing…');},650);
});
window.addEventListener('beforeunload',()=>{if(previewTimer)clearInterval(previewTimer);if(stormRefreshTimer)clearInterval(stormRefreshTimer);});
function formatHourPrecise(h){const day=Math.floor(h/24)+1,z=((h%24)+24)%24,whole=Math.floor(z),minutes=Math.round((z-whole)*60);return`${String(whole).padStart(2,'0')}${minutes?`:${String(minutes).padStart(2,'0')}`:''}Z Day ${day}`;}

load().catch(showError);

document.querySelector('#clearStormSelection')?.addEventListener('click',()=>{selectedStorm=null;restoreCellInspector();map.schedule();});

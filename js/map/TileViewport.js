import { profiler } from '../performance/PerformanceProfiler.js?v=2.20.14';

export class TileViewport {
  constructor(canvas,{onClick=null,onHover=null,onViewChange=null,classicGrid=false,sourceZoom=2}={}){
    this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});this.onClick=onClick;this.onHover=onHover;this.onViewChange=onViewChange;
    this.manifest=null;this.zoom=0;this.center={x:.5,y:.5};this.cache=new Map();this.pending=new Map();this.drag=null;this.frame=0;
    this.classicGrid=classicGrid;this.sourceZoom=sourceZoom;
    canvas.style.width='100%';canvas.style.height='100%';canvas.style.display='block';
    this.#bind();this.resize();
  }
  setManifest(manifest,{preserveView=true,preparedTiles=null}={}){this.generation=(this.generation??0)+1;for(const image of this.pending.values()){image.onload=null;image.onerror=null;image.src='';}this.pending.clear();this.manifest=manifest;if(preparedTiles){for(const [key,image] of preparedTiles)this.cache.set(key,image);}if(!preserveView||this.classicGrid){this.zoom=manifest.minZoom??0;this.center={x:.5,y:.5};}this.schedule();}
  async prepareManifest(manifest,{z=this.sourceZoom}={}){const zoom=Math.max(manifest.minZoom??0,Math.min(manifest.maxZoom??3,z));const count=2**zoom;const jobs=[];for(let y=0;y<count;y++)for(let x=0;x<count;x++){const key=this.#keyFor(manifest,zoom,x,y);jobs.push(this.#loadPreparedImage(manifest,x,y,zoom).then(image=>[key,image]));}return new Map(await Promise.all(jobs));}
  #loadPreparedImage(manifest,x,y,z){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error(`Tile failed: ${z}/${x}/${y}`));image.src=manifest.tileUrl.replace('{z}',z).replace('{x}',x).replace('{y}',y);});}
  setOverlay(draw){this.overlay=draw;this.schedule();}
  resize(){const rect=this.canvas.parentElement.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1);this.canvas.width=Math.max(320,Math.round(rect.width*dpr));this.canvas.height=Math.max(320,Math.round(rect.height*dpr));this.schedule();}
  schedule(){cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(()=>this.render());}
  render(){if(!this.manifest)return;const span=profiler.begin('render:tile-viewport',{zoom:this.zoom,classicGrid:this.classicGrid});
    if(this.classicGrid)this.#renderClassic(span);else this.#renderMap(span);
  }
  #renderClassic(span){
    const ctx=this.ctx,w=this.canvas.width,h=this.canvas.height,tileSize=this.manifest.tileSize??256;
    const z=Math.max(this.manifest.minZoom??0,Math.min(this.manifest.maxZoom??3,this.sourceZoom));
    const n=2**z,worldSize=n*tileSize;
    const scale=Math.min(w/worldSize,h/worldSize),drawW=worldSize*scale,drawH=worldSize*scale,left=(w-drawW)/2,top=(h-drawH)/2;
    ctx.fillStyle=this.manifest.scope==='outlook'?'#ffffff':'#07101b';ctx.fillRect(0,0,w,h);let visible=0,ready=0;
    ctx.imageSmoothingEnabled=false;
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){
      visible++;const key=this.#key(z,x,y);const image=this.cache.get(key);const dx=left+x*tileSize*scale,dy=top+y*tileSize*scale,dw=tileSize*scale+0.5,dh=tileSize*scale+0.5;
      if(image){ctx.drawImage(image,dx,dy,dw,dh);ready++;}else{ctx.fillStyle=this.manifest.scope==='outlook'?'#ffffff':'#0d1825';ctx.fillRect(dx,dy,dw,dh);this.#load(key,x,y,z);}
    }
    const view={left:0,top:0,scale,worldSize,width:w,height:h,classic:true,contentLeft:left,contentTop:top,contentWidth:drawW,contentHeight:drawH,project:(x,y)=>({x:left+x*drawW,y:top+y*drawH})};
    if(this.overlay)this.overlay(ctx,view);profiler.end(span,{visibleTiles:visible,readyTiles:ready});
  }
  #renderMap(span){const ctx=this.ctx,w=this.canvas.width,h=this.canvas.height,tileSize=this.manifest.tileSize??256,n=2**this.zoom,worldSize=n*tileSize;
    const scale=Math.max(w,h)/tileSize,viewWorldW=w/scale,viewWorldH=h/scale,cx=this.center.x*worldSize,cy=this.center.y*worldSize,left=cx-viewWorldW/2,top=cy-viewWorldH/2;
    ctx.fillStyle='#07101b';ctx.fillRect(0,0,w,h);const minX=Math.max(0,Math.floor(left/tileSize)),maxX=Math.min(n-1,Math.floor((left+viewWorldW)/tileSize)),minY=Math.max(0,Math.floor(top/tileSize)),maxY=Math.min(n-1,Math.floor((top+viewWorldH)/tileSize));let visible=0,ready=0;
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){visible++;const key=this.#key(this.zoom,x,y),image=this.cache.get(key),dx=(x*tileSize-left)*scale,dy=(y*tileSize-top)*scale,dw=tileSize*scale,dh=tileSize*scale;if(image){ctx.imageSmoothingEnabled=true;ctx.drawImage(image,dx,dy,dw,dh);ready++;}else{ctx.fillStyle='#0d1825';ctx.fillRect(dx,dy,dw,dh);this.#load(key,x,y,this.zoom);}}
    if(this.overlay)this.overlay(ctx,{left,top,scale,worldSize,width:w,height:h,project:(x,y)=>({x:(x*worldSize-left)*scale,y:(y*worldSize-top)*scale})});profiler.end(span,{visibleTiles:visible,readyTiles:ready});
  }
  #key(z,x,y){return this.#keyFor(this.manifest,z,x,y);}
  #keyFor(manifest,z,x,y){return `${manifest.authorityInstance??'legacy'}:${manifest.tileStyleRevision??'legacy'}:${manifest.revision}:${manifest.scope}:${manifest.product}:${manifest.day}:${manifest.station}:${z}:${x}:${y}`;}
  screenToWorld(clientX,clientY){const r=this.canvas.getBoundingClientRect(),px=(clientX-r.left)*this.canvas.width/r.width,py=(clientY-r.top)*this.canvas.height/r.height;
    if(this.classicGrid){const tileSize=this.manifest.tileSize??256,z=Math.max(this.manifest.minZoom??0,Math.min(this.manifest.maxZoom??3,this.sourceZoom)),worldSize=2**z*tileSize,scale=Math.min(this.canvas.width/worldSize,this.canvas.height/worldSize),left=(this.canvas.width-worldSize*scale)/2,top=(this.canvas.height-worldSize*scale)/2;return{x:Math.max(0,Math.min(1,(px-left)/(worldSize*scale))),y:Math.max(0,Math.min(1,(py-top)/(worldSize*scale))),inside:px>=left&&py>=top&&px<=left+worldSize*scale&&py<=top+worldSize*scale};}
    const n=2**this.zoom,tileSize=this.manifest.tileSize??256,worldSize=n*tileSize,scale=Math.max(this.canvas.width,this.canvas.height)/tileSize,viewWorldW=this.canvas.width/scale,viewWorldH=this.canvas.height/scale,left=this.center.x*worldSize-viewWorldW/2,top=this.center.y*worldSize-viewWorldH/2;return{x:Math.max(0,Math.min(1,(left+px/scale)/worldSize)),y:Math.max(0,Math.min(1,(top+py/scale)/worldSize)),inside:true};}
  reset(){if(!this.manifest)return;this.zoom=this.manifest.minZoom??0;this.center={x:.5,y:.5};this.onViewChange?.(this);this.schedule();}
  zoomBy(delta,anchor=null){if(this.classicGrid||!this.manifest)return;const before=anchor?this.screenToWorld(anchor.x,anchor.y):null;this.zoom=Math.max(this.manifest.minZoom??0,Math.min(this.manifest.maxZoom??3,this.zoom+delta));if(before&&anchor){const after=this.screenToWorld(anchor.x,anchor.y);this.center.x=Math.max(0,Math.min(1,this.center.x+before.x-after.x));this.center.y=Math.max(0,Math.min(1,this.center.y+before.y-after.y));}this.onViewChange?.(this);this.schedule();}
  #url(x,y,z){return this.manifest.tileUrl.replace('{z}',z).replace('{x}',x).replace('{y}',y);}
  #load(key,x,y,z){if(this.pending.has(key))return;const generation=this.generation??0;const manifest=this.manifest;const span=profiler.begin('tile:load',{z,x,y});const image=new Image();this.pending.set(key,image);image.onload=()=>{this.pending.delete(key);if(generation!==this.generation||manifest!==this.manifest){profiler.end(span,{ok:false,stale:true});return;}this.cache.set(key,image);profiler.end(span,{ok:true});this.schedule();};let retries=0;image.onerror=()=>{if(generation!==this.generation||manifest!==this.manifest){this.pending.delete(key);profiler.end(span,{ok:false,stale:true});return;}if(retries<1){retries++;image.src=manifest.tileUrl.replace('{z}',z).replace('{x}',x).replace('{y}',y)+`&retry=${Date.now()}`;return;}this.pending.delete(key);profiler.end(span,{ok:false});this.schedule();};image.src=manifest.tileUrl.replace('{z}',z).replace('{x}',x).replace('{y}',y);}
  #bind(){window.addEventListener('resize',()=>this.resize());this.canvas.addEventListener('wheel',e=>{if(this.classicGrid)return;e.preventDefault();this.zoomBy(e.deltaY<0?1:-1,{x:e.clientX,y:e.clientY});},{passive:false});this.canvas.addEventListener('pointerdown',e=>{if(this.classicGrid)return;this.canvas.setPointerCapture(e.pointerId);this.drag={x:e.clientX,y:e.clientY,center:{...this.center},moved:false};});this.canvas.addEventListener('pointermove',e=>{if(this.classicGrid){if(this.onHover&&this.manifest){const p=this.screenToWorld(e.clientX,e.clientY);this.onHover(p.inside?p:null,e);}return;}if(!this.drag){if(this.onHover&&this.manifest)this.onHover(this.screenToWorld(e.clientX,e.clientY),e);return;}const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;if(Math.abs(dx)+Math.abs(dy)>3)this.drag.moved=true;const n=2**this.zoom,tileSize=this.manifest.tileSize??256,worldSize=n*tileSize,scale=Math.max(this.canvas.width,this.canvas.height)/tileSize;this.center.x=Math.max(0,Math.min(1,this.drag.center.x-dx*this.canvas.width/this.canvas.getBoundingClientRect().width/scale/worldSize));this.center.y=Math.max(0,Math.min(1,this.drag.center.y-dy*this.canvas.height/this.canvas.getBoundingClientRect().height/scale/worldSize));this.schedule();});this.canvas.addEventListener('pointerleave',()=>{if(!this.drag)this.onHover?.(null,null);});this.canvas.addEventListener('pointerup',e=>{if(this.classicGrid)return;const moved=this.drag?.moved;this.drag=null;if(!moved&&this.onClick)this.onClick(this.screenToWorld(e.clientX,e.clientY),e);});this.canvas.addEventListener('click',e=>{if(!this.classicGrid||!this.onClick)return;const p=this.screenToWorld(e.clientX,e.clientY);if(p.inside)this.onClick(p,e);});}
}

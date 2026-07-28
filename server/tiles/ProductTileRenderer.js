import { encodeRgbaPng } from './PngEncoder.js';
const TILE_SIZE=256;
const NWS_PROBABILITY_COLORS={
  // Official NOAA/NWS SPC polygon fill colors. These are intentionally
  // lighter than the corresponding polygon outlines used by SPC.
  tornado:[
    [2,'#79ba7a'],[5,'#bd998a'],[10,'#ffe481'],[15,'#ff8080'],[30,'#ff80ff'],[45,'#c896f7'],[60,'#104e8b']
  ],
  wind:[
    [5,'#c5a392'],[15,'#ffeb7f'],[30,'#ff7f7f'],[45,'#ff7fff'],[60,'#c895f6'],[75,'#5c85d6'],[90,'#1affff']
  ],
  hail:[
    [5,'#c5a392'],[15,'#ffeb7f'],[30,'#ff7f7f'],[45,'#ff7fff'],[60,'#c895f6']
  ]
};
const PALETTES={
 risk:{min:0,max:5,cat:true,stops:['#c1e9c1','#66a366','#ffe066','#ffa366','#e06666','#ee99ee']},
 tornadoRisk:{discrete:NWS_PROBABILITY_COLORS.tornado},hailRisk:{discrete:NWS_PROBABILITY_COLORS.hail},windRisk:{discrete:NWS_PROBABILITY_COLORS.wind},
 temperature:{min:35,max:105,stops:['#3d5ba9','#6aa6d9','#d5e9ec','#f4d35e','#ee964b','#c53b32']},dewpoint:{min:15,max:80,stops:['#7a4c2a','#b88a56','#d7cf91','#77b255','#287a3d','#073b24']},pressure:{min:988,max:1024,stops:['#6f2dbd','#3155a4','#47a6c6','#cce5df','#f4d35e','#ef8354']},cape:{min:0,max:6000,stops:['#25282c','#5d8f35','#e5d84a','#f08a35','#d83232','#8736a5']},cin:{min:0,max:200,stops:['#f4f4f4','#8bd3dd','#4d96d7','#5342a8','#24124d']},srh:{min:0,max:750,stops:['#26272a','#457b9d','#a8dadc','#f4a261','#e63946','#761f86']},bulkShear:{min:0,max:90,stops:['#292b2f','#3b82a0','#55b98f','#d6d645','#f28c28','#bd2b38']},stp:{min:0,max:12,stops:['#27282c','#4d7f4b','#e4d84c','#f29e3d','#812091']},vtp:{min:0,max:5,stops:['#27282c','#355c7d','#5b6fb5','#9b59b6','#e74c3c','#ff9f43']},forcing:{min:0,max:1,stops:['#20242a','#325d7d','#49a6a1','#d7cf5c','#e57b36','#b72e4c']},readiness:{min:0,max:100,stops:['#20242a','#355f8d','#55aa82','#ded85c','#ee8736','#c22c45']},trigger:{min:0,max:100,stops:['#20242a','#355f8d','#55aa82','#ded85c','#ee8736','#c22c45']},initiation:{min:0,max:100,stops:['#20242a','#355f8d','#55aa82','#ded85c','#ee8736','#c22c45']},verticalMotion:{min:0,max:1.25,stops:['#20242a','#385c86','#49a5b8','#8bc66e','#e4d257','#ec704d']},emlInfluence:{min:0,max:100,stops:['#20242a','#65523d','#9d7045','#d49a4a','#e8c56a','#f4e3a1']},lapseRate:{min:5,max:9.5,stops:['#315b7d','#5c9ca8','#b7c979','#e4c55f','#df7e3f','#b73232']},windSurface:{min:0,max:45,stops:['#20242a','#365f8d','#50a4b8','#94c96d','#e6d65d','#eb6f4b']},wind800:{min:0,max:75,stops:['#20242a','#365f8d','#50a4b8','#94c96d','#e6d65d','#eb6f4b']},wind500:{min:0,max:100,stops:['#20242a','#365f8d','#50a4b8','#94c96d','#e6d65d','#eb6f4b']},wind250:{min:0,max:170,stops:['#20242a','#365f8d','#50a4b8','#94c96d','#e6d65d','#eb6f4b']},
 reflectivity:{min:-10,max:82,stops:['#050a12','#143b73','#149155','#50cd37','#f5df28','#f5781e','#e12328','#cd37dc','#ffffff']},velocity:{min:-160,max:160,stops:['#10d76c','#056d36','#111820','#7a2028','#ff3845']},correlationCoefficient:{min:.48,max:1,stops:['#781478','#e12d41','#f59b1e','#f5e637','#50cd78','#46d2eb']}
};
function rgb(hex){const n=parseInt(hex.slice(1),16);return[(n>>16)&255,(n>>8)&255,n&255];}
function color(p,v){
  if(p.cat)return rgb(p.stops[Math.max(0,Math.min(p.stops.length-1,Math.round(v)))]);
  if(p.discrete){let selected='#ffffff';for(const [threshold,hex] of p.discrete){if(v>=threshold)selected=hex;}return rgb(selected);}
  const t=Math.max(0,Math.min(.999999,(v-p.min)/(p.max-p.min||1))),q=t*(p.stops.length-1),i=Math.floor(q),f=q-i,a=rgb(p.stops[i]),b=rgb(p.stops[Math.min(i+1,p.stops.length-1)]);return a.map((x,j)=>Math.round(x+(b[j]-x)*f));
}
export function applyConditionalIntensityHatch(c,px,py,level){
  const cig=Math.max(0,Math.min(3,Math.round(Number(level)||0)));
  if(!cig)return c;

  // Keep all tiers black so the probability fill remains authoritative.
  // CIG1: broken / dashed diagonal lines.
  // CIG2: continuous solid diagonal lines.
  // CIG3: crossed continuous diagonal lines.
  const spacing=cig===1?16:cig===2?13:12;
  const lineWidth=cig===3?2:1;
  const forward=((px+py)%spacing+spacing)%spacing < lineWidth;
  let marked=false;

  if(cig===1){
    // Segment the diagonal into visible dash/gap runs along its axis.
    const dashPeriod=14;
    const dashLength=7;
    const along=((px-py)%dashPeriod+dashPeriod)%dashPeriod;
    marked=forward && along<dashLength;
  }else if(cig===2){
    marked=forward;
  }else{
    const reverse=((px-py)%spacing+spacing)%spacing < lineWidth;
    marked=forward||reverse;
  }

  if(!marked)return c;
  return [18,18,18];
}
export async function renderTile({values,width,height,product,z,x,y,valueMin=null,valueMax=null,hatchValues=null}){
  const count=2**z;if(x<0||y<0||x>=count||y>=count) return null;const palette=PALETTES[product]??PALETTES.temperature;const rgba=new Uint8Array(TILE_SIZE*TILE_SIZE*4);
  for(let py=0;py<TILE_SIZE;py++)for(let px=0;px<TILE_SIZE;px++){
    const u=(x+(px+.5)/TILE_SIZE)/count,v=(y+(py+.5)/TILE_SIZE)/count;
    const gx=Math.max(0,Math.min(width-1,Math.floor(u*width))),gy=Math.max(0,Math.min(height-1,Math.floor(v*height))),gi=gy*width+gx;
    let sample=values[gi]??0;
    const radarProduct=product==='reflectivity'||product==='velocity'||product==='correlationCoefficient';
    const noEcho=radarProduct&&valueMin!==null&&valueMax!==null&&sample===0;
    if(valueMin!==null&&valueMax!==null&&!noEcho)sample=valueMin+((sample-1)/254)*(valueMax-valueMin);
    let c=noEcho?[5,10,17]:color(palette,sample);
    if(hatchValues)c=applyConditionalIntensityHatch(c,px+x*TILE_SIZE,py+y*TILE_SIZE,hatchValues[gi]??0);
    const p=(py*TILE_SIZE+px)*4;rgba[p]=c[0];rgba[p+1]=c[1];rgba[p+2]=c[2];rgba[p+3]=255;
  }
  return await encodeRgbaPng(TILE_SIZE,TILE_SIZE,rgba);
}
export function decodeF32Base64(encoded){const b=Buffer.from(encoded,'base64');const copy=Uint8Array.from(b);return new Float32Array(copy.buffer);}
export function decodeU8Base64(encoded){return Buffer.from(encoded,'base64');}
export const TILE_PYRAMID={tileSize:TILE_SIZE,minZoom:0,maxZoom:3};
export const OUTLOOK_LEGENDS={
 risk:[['TSTM','#c1e9c1'],['MRGL','#66a366'],['SLGT','#ffe066'],['ENH','#ffa366'],['MDT','#e06666'],['HIGH','#ee99ee']],
 tornadoRisk:NWS_PROBABILITY_COLORS.tornado.map(([v,c])=>[`${v}%`,c]),
 windRisk:NWS_PROBABILITY_COLORS.wind.map(([v,c])=>[`${v}%`,c]),
 hailRisk:NWS_PROBABILITY_COLORS.hail.map(([v,c])=>[`${v}%`,c])
};

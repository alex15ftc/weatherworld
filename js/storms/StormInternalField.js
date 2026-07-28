import { clamp } from '../scenarios/math.js?v=2.20.1';

export const STORM_FIELD_SIZE = 32;
export const STORM_FIELD_RESOLUTION_KM = 2.5;
export const STORM_FIELD_NAMES = ['rain','graupel','hail','ice','updraft','downdraft','windU','windV','vorticity','temperature','moisture','debris'];

export function createStormInternalField(storm, environment = {}, seed = 1) {
  const length = STORM_FIELD_SIZE * STORM_FIELD_SIZE;
  const field = { version: 1, width: STORM_FIELD_SIZE, height: STORM_FIELD_SIZE, resolutionKm: STORM_FIELD_RESOLUTION_KM, ageMinutes: 0, seed: hash(`${seed}|${storm.id}`) };
  for (const name of STORM_FIELD_NAMES) field[name] = new Float32Array(length);
  storm.internalField = field;
  evolveStormInternalField(storm, environment, 1 / 60, true);
  return field;
}

export function evolveStormInternalField(storm, environment = {}, dtHours = 1 / 12, initialize = false) {
  const f = storm.internalField ?? createStormInternalField(storm, environment, environment.seed ?? 1);
  const w=f.width,h=f.height,n=w*h,res=f.resolutionKm;
  const next={}; for(const name of STORM_FIELD_NAMES) next[name]=new Float32Array(n);
  const cape=clamp((environment.cape??0)/3500,0,1.35), shear=clamp((environment.bulkShear??0)/55,0,1.25);
  const srh=clamp((environment.srh??0)/350,0,1.35), moisture=clamp(((environment.dewpoint??environment.surfaceDewpoint??58)-45)/28,0,1.2);
  const forcing=clamp(environment.forcing??environment.mesoscaleAscent??0,0,1), inflow=clamp(environment.effectiveInflow??environment.mesoscale?.effectiveInflow??environment.readiness??0,0,1);
  const elevated=clamp(((environment.lcl??1000)-1100)/1300,0,1);
  const dtMin=dtHours*60, angle=(storm.orientationDeg??0)*Math.PI/180, ca=Math.cos(angle),sa=Math.sin(angle);
  const mesoMemory=clamp(storm.mesocycloneStrength??0,0,1.35);
  const rotation=clamp(Math.max(srh*shear*inflow*storm.organization, mesoMemory*0.82),0,1.3), cold=clamp(storm.coldPoolStrength??0,0,1);
  const mature=clamp((storm.ageHours-.25)/1.1,0,1), weakening=storm.lifecycleState==='weakening'||storm.lifecycleState==='dissipating';
  const supercell=storm.mode?.includes('supercell'), linear=['linear segment','QLCS'].includes(storm.mode), mcs=storm.mode==='MCS';
  const lifecycleScale=storm.lifecycleState==='tower'?.32:storm.lifecycleState==='developing'?.58:storm.lifecycleState==='organizing'?.82:storm.lifecycleState==='mature'?1:storm.lifecycleState==='weakening'?.72:.38;
  const advectX=clamp((storm.velocityKph?.east??0)*dtHours/res,-2,2), advectY=clamp(-(storm.velocityKph?.north??0)*dtHours/res,-2,2);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x, sx=x-advectX, sy=y-advectY;
    for(const name of STORM_FIELD_NAMES) next[name][i]=sampleArray(f[name],w,h,sx,sy)*(weakening?.93:.985);
    const dx=(x-(w-1)/2)*res,dy=(y-(h-1)/2)*res;
    const lx=dx*ca+dy*sa,ly=-dx*sa+dy*ca;
    const upX=-8*rotation, upY=-2; // rotating updraft displaced toward inflow side
    const cellularUp=Math.exp(-(((lx-upX)/(supercell?7.2:9.2))**2+((ly-upY)/(supercell?8.8:8.2))**2));
    const lineUp=Math.exp(-((lx/(linear?5.2:12))**2))*Math.exp(-((ly/(linear?27:12))**4));
    const up=(linear?Math.max(cellularUp*.45,lineUp):cellularUp)*cape*inflow*(.45+.75*mature)*lifecycleScale;
    const ffd=Math.exp(-(((lx-(supercell?12:9))/(supercell?21:18))**2+((ly+(supercell?10:6))/(supercell?16:14))**2))*up*(.65+.45*moisture);
    const rearStrat=(linear||mcs)?Math.exp(-(((lx+24)/38)**2+((ly)/(linear?34:42))**2))*storm.organization*.62:0;
    const rfd=Math.exp(-(((lx+8)/11)**2+((ly-9)/10)**2))*cold*mature;
    const strat=Math.exp(-(((lx-22)/30)**2+((ly+12)/24)**2))*storm.organization*.35+rearStrat;
    const wrapAngle=Math.atan2(ly-upY,lx-upX), wrapRadius=Math.hypot(lx-upX,ly-upY);
    const wrapped=supercell?Math.exp(-(((wrapRadius-10)/3.3)**2))*clamp((wrapAngle+2.8)/3.0,0,1)*rotation*mature:0;
    const inflowNotch=supercell?Math.exp(-(((lx+2)/8)**2+((ly-10)/5)**2))*rotation*mature:0;
    const bowCore=linear?Math.exp(-((((lx/18)-.28*(1-(ly/28)**2))/.20)**2))*Math.exp(-((ly/30)**4)):0;
    const hailGrowth=up*shear*clamp(cape*.75+forcing*.35,0,1.2)*(1-elevated*.25);
    const graupel=up*clamp(moisture*.55+elevated*.45,0,1);
    const vortex=Math.exp(-(((lx-upX)/4.5)**2+((ly-upY)/5.5)**2))*rotation*up;
    const tornado=clamp((vortex-.42)*2.5,0,1)*clamp((1500-(environment.lcl??1500))/900,0,1)*mature;
    next.updraft[i]=clamp(next.updraft[i]+up*18*dtHours,0,1.5);
    next.downdraft[i]=clamp(next.downdraft[i]+(ffd*.25+rfd*.9+bowCore*.55)*dtHours*10,0,1.4);
    next.rain[i]=clamp(next.rain[i]+(ffd+wrapped*.9+strat+bowCore*.45)*dtHours*8-next.updraft[i]*.03-inflowNotch*dtHours*2.2,0,1.5);
    next.graupel[i]=clamp(next.graupel[i]+graupel*dtHours*5,0,1.2);
    next.hail[i]=clamp(next.hail[i]+hailGrowth*dtHours*4.5,0,1.3);
    next.ice[i]=clamp(next.ice[i]+(up*.45+strat*.3)*dtHours*4,0,1);
    next.vorticity[i]=clamp(next.vorticity[i]+vortex*dtHours*6,0,1.5);
    const tangential=next.vorticity[i]*55;
    const rr=Math.max(2,Math.hypot(lx-upX,ly-upY));
    const localU=(storm.velocityKph?.east??0)+( -(ly-upY)/rr*tangential*ca + (lx-upX)/rr*tangential*-sa );
    const localV=-(storm.velocityKph?.north??0)+( -(ly-upY)/rr*tangential*sa + (lx-upX)/rr*tangential*ca );
    next.windU[i]=localU; next.windV[i]=localV;
    next.temperature[i]=clamp(next.temperature[i]-rfd*dtHours*5+up*dtHours*1.2,-8,4);
    next.moisture[i]=clamp(next.moisture[i]+up*moisture*dtHours*2-rfd*dtHours, -1,1.5);
    next.debris[i]=clamp(next.debris[i]+tornado*dtHours*5-next.debris[i]*dtHours*.5,0,1);
  }
  for(const name of STORM_FIELD_NAMES) f[name]=next[name];
  f.ageMinutes += dtMin;
  f.maxUpdraft=max(f.updraft); f.maxVorticity=max(f.vorticity); f.maxHail=max(f.hail); f.maxDebris=max(f.debris);
  return f;
}

export function sampleStormField(field, localXKm, localYKm, name) {
  if(!field?.[name]) return 0;
  const x=localXKm/field.resolutionKm+(field.width-1)/2, y=localYKm/field.resolutionKm+(field.height-1)/2;
  return sampleArray(field[name],field.width,field.height,x,y);
}

const FIELD_RANGES = {
  rain:[0,1.5], graupel:[0,1.2], hail:[0,1.3], ice:[0,1], updraft:[0,1.5], downdraft:[0,1.4],
  windU:[-160,160], windV:[-160,160], vorticity:[0,1.5], temperature:[-8,4], moisture:[-1,1.5], debris:[0,1]
};

export function serializeStormInternalField(field) {
  if(!field) return null;
  const encoded={};
  for(const name of STORM_FIELD_NAMES){
    const [lo,hi]=FIELD_RANGES[name], source=field[name]??[];
    const bytes=new Uint8Array(source.length);
    for(let i=0;i<source.length;i++) bytes[i]=Math.round(clamp((source[i]-lo)/(hi-lo),0,1)*255);
    encoded[name]=bytesToBase64(bytes);
  }
  return {
    version:2,width:field.width,height:field.height,resolutionKm:field.resolutionKm,
    ageMinutes:Number(field.ageMinutes)||0,maxUpdraft:Number(field.maxUpdraft)||0,
    maxVorticity:Number(field.maxVorticity)||0,maxHail:Number(field.maxHail)||0,maxDebris:Number(field.maxDebris)||0,
    encoding:'u8-base64',fields:encoded
  };
}
export function hydrateStormInternalField(raw){
  if(!raw)return null;
  const width=Math.max(1,Number(raw.width)||STORM_FIELD_SIZE),height=Math.max(1,Number(raw.height)||STORM_FIELD_SIZE);
  const expected=width*height;
  if(raw.version===2&&raw.encoding==='u8-base64'&&raw.fields){
    const out={...raw,width,height}; delete out.fields; delete out.encoding;
    for(const name of STORM_FIELD_NAMES){
      const bytes=base64ToBytes(raw.fields[name]??''),[lo,hi]=FIELD_RANGES[name];
      if(bytes.length!==expected)return null;
      const values=new Float32Array(expected);
      for(let i=0;i<expected;i++) values[i]=lo+(bytes[i]/255)*(hi-lo);
      out[name]=values;
    }
    return isStormInternalFieldValid(out)?out:null;
  }
  const out={...raw,width,height};
  for(const name of STORM_FIELD_NAMES)out[name]=recoverNumericArray(raw[name],expected);
  return isStormInternalFieldValid(out)?out:null;
}

export function isStormInternalFieldValid(field){
  if(!field)return false;
  const width=Number(field.width),height=Number(field.height),expected=width*height;
  if(!Number.isInteger(width)||!Number.isInteger(height)||expected<=0)return false;
  return STORM_FIELD_NAMES.every(name=>field[name]&&Number(field[name].length)===expected);
}

function recoverNumericArray(value,expected){
  if(ArrayBuffer.isView(value)){
    const source=Float32Array.from(value);
    if(source.length===expected)return source;
  }
  if(Array.isArray(value)){
    const source=Float32Array.from(value,v=>Number(v)||0);
    if(source.length===expected)return source;
  }
  if(value&&typeof value==='object'){
    const out=new Float32Array(expected);
    let recovered=0;
    for(const [key,item] of Object.entries(value)){
      const index=Number(key);
      if(Number.isInteger(index)&&index>=0&&index<expected){out[index]=Number(item)||0;recovered++;}
    }
    if(recovered>0)return out;
  }
  return new Float32Array(expected);
}
function bytesToBase64(bytes){
  if(typeof Buffer!=='undefined') return Buffer.from(bytes).toString('base64');
  let binary=''; const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk) binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));
  return btoa(binary);
}
function base64ToBytes(text){
  if(!text)return new Uint8Array();
  if(typeof Buffer!=='undefined') return Uint8Array.from(Buffer.from(text,'base64'));
  const binary=atob(text),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}
function sampleArray(a,w,h,x,y){if(!a?.length)return 0;const x0=Math.floor(x),y0=Math.floor(y),tx=x-x0,ty=y-y0;let v=0;for(let oy=0;oy<2;oy++)for(let ox=0;ox<2;ox++){const xx=x0+ox,yy=y0+oy;if(xx<0||yy<0||xx>=w||yy>=h)continue;v+=a[yy*w+xx]*(ox?tx:1-tx)*(oy?ty:1-ty);}return v;}
function max(a){let m=0;for(const v of a)if(v>m)m=v;return m;}
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return h>>>0;}

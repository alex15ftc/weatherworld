const ENCODING='weatherworld-cell-delta-v1';
const PATHS=Object.freeze([
  ['surface','temperature'],['surface','dewpoint'],['surface','pressure'],['surface','seaLevelPressure'],
  ['surface','wind','speed'],['surface','wind','direction'],
  ['derived','cape'],['derived','cin'],['derived','stp'],['derived','rawStp'],
  ['derived','srh'],['derived','bulkShear'],['derived','lcl']
]);

export function encodeCellKeyframe(rows){
  const compact=compactRows(rows);
  return{encoding:ENCODING,type:'keyframe',width:compact.width,height:compact.height,fields:compact.fields,presence:compact.presence,skeletons:compact.skeletons};
}

export function encodeCellDelta(previousRows,rows){
  const previous=compactRows(previousRows),current=compactRows(rows);
  if(previous.width!==current.width||previous.height!==current.height)return encodeCellKeyframe(rows);
  const fields={};
  for(const key of Object.keys(current.fields)){
    const a=previous.fields[key],b=current.fields[key],delta=new Float32Array(b.length);
    for(let i=0;i<b.length;i++)delta[i]=b[i]-a[i];
    fields[key]=delta;
  }
  const skeletonPatches=[];
  for(let i=0;i<current.skeletons.length;i++){
    if(stableStringify(previous.skeletons[i])!==stableStringify(current.skeletons[i]))skeletonPatches.push([i,current.skeletons[i]]);
  }
  return{encoding:ENCODING,type:'delta',width:current.width,height:current.height,fields,presence:current.presence,skeletonPatches};
}

export function decodeCellRecord(record,previousRows=null){
  if(record?.encoding!==ENCODING)return structuredClone(record);
  if(record.type==='keyframe')return inflate(record.width,record.height,record.skeletons,record.fields,record.presence);
  if(!previousRows)throw new Error('Timeline cell delta requires a previous frame.');
  const previous=compactRows(previousRows),skeletons=previous.skeletons;
  for(const [index,value] of record.skeletonPatches??[])skeletons[index]=structuredClone(value);
  const fields={};
  for(const key of Object.keys(previous.fields)){
    const base=previous.fields[key],delta=record.fields[key],next=new Float32Array(base.length);
    for(let i=0;i<base.length;i++)next[i]=base[i]+delta[i];
    fields[key]=next;
  }
  return inflate(record.width,record.height,skeletons,fields,record.presence);
}

export function estimateCellRecordBytes(record){
  let bytes=0;
  for(const field of Object.values(record?.fields??{}))bytes+=field.byteLength??0;
  for(const mask of Object.values(record?.presence??{}))bytes+=mask.byteLength??0;
  bytes+=new TextEncoder().encode(JSON.stringify(record?.skeletons??record?.skeletonPatches??[])).byteLength;
  return bytes;
}

function compactRows(rows){
  const height=rows.length,width=rows[0]?.length??0,count=width*height;
  const fields=Object.fromEntries(PATHS.map(path=>[path.join('.'),new Float32Array(count)]));
  const presence=Object.fromEntries(PATHS.map(path=>[path.join('.'),new Uint8Array(count)]));
  const skeletons=new Array(count);
  let index=0;
  for(const row of rows)for(const cell of row){
    const skeleton=structuredClone(cell);
    for(const path of PATHS){
      const value=get(cell,path),key=path.join('.');
      fields[key][index]=finite(value);
      presence[key][index]=Number.isFinite(Number(value))?1:0;
      remove(skeleton,path);
    }
    skeletons[index++]=skeleton;
  }
  return{width,height,fields,presence,skeletons};
}

function inflate(width,height,skeletons,fields,presence){
  const rows=Array.from({length:height},()=>Array(width));
  for(let i=0;i<skeletons.length;i++){
    const cell=structuredClone(skeletons[i]);
    for(const path of PATHS){const key=path.join('.');if(presence?.[key]?.[i]??1)set(cell,path,fields[key][i]);}
    rows[Math.floor(i/width)][i%width]=cell;
  }
  return rows;
}
function get(value,path){for(const key of path)value=value?.[key];return value;}
function set(value,path,next){for(let i=0;i<path.length-1;i++)value=value[path[i]]??={};value[path.at(-1)]=next;}
function remove(value,path){for(let i=0;i<path.length-1;i++){value=value?.[path[i]];if(!value)return;}delete value[path.at(-1)];}
function finite(value){return Number.isFinite(Number(value))?Number(value):0;}
function stableStringify(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return`[${value.map(stableStringify).join(',')}]`;return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;}

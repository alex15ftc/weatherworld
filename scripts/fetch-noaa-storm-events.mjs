import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const BASE='https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/';
const start=Number(process.argv[2]),end=Number(process.argv[3]??process.argv[2]);
const output=process.argv[4]??'data/raw/noaa-storm-events';
if(!Number.isInteger(start)||!Number.isInteger(end)||start<1950||end<start){
  console.error('Usage: node scripts/fetch-noaa-storm-events.mjs <start-year> [end-year] [output-directory]');
  process.exit(2);
}
await mkdir(output,{recursive:true});
const listing=await fetchText(BASE);
const files=[...listing.matchAll(/href="(StormEvents_details-ftp_v1\.0_d(\d{4})_c\d+\.csv\.gz)"/g)]
  .map(match=>({name:match[1],year:Number(match[2])}));
for(let year=start;year<=end;year++){
  const matches=files.filter(file=>file.year===year).sort((a,b)=>b.name.localeCompare(a.name));
  if(!matches.length){console.warn(`No NOAA details file listed for ${year}`);continue;}
  const file=matches[0],target=path.join(output,file.name);
  if(await exists(target)){console.log(`Cached ${target}`);continue;}
  const response=await fetch(`${BASE}${file.name}`);
  if(!response.ok)throw new Error(`NOAA download failed (${response.status}) for ${file.name}`);
  const bytes=new Uint8Array(await response.arrayBuffer());
  await writeFile(target,bytes);
  console.log(`Downloaded ${file.name} (${(bytes.byteLength/1048576).toFixed(1)} MiB)`);
}

async function fetchText(url){const response=await fetch(url);if(!response.ok)throw new Error(`HTTP ${response.status}: ${url}`);return response.text();}
async function exists(target){try{await access(target);return true;}catch{return false;}}

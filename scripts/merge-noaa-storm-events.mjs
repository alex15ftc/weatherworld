import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
const input=process.argv[2]??'data/raw/noaa-storm-events',output=process.argv[3]??'data/analogs/merged-storm-events.csv';
const files=(await readdir(input)).filter(name=>/^StormEvents_details.*\.csv\.gz$/.test(name)).sort();
let header=null;const chunks=[];
for(const name of files){const text=gunzipSync(await readFile(path.join(input,name))).toString('utf8').replace(/^\uFEFF/,'');const newline=text.indexOf('\n'),candidate=text.slice(0,newline).replace(/\r$/,'');if(header===null)header=candidate;else if(candidate!==header)throw new Error(`Header mismatch: ${name}`);chunks.push(text.slice(newline+1).trimEnd());}
await mkdir(path.dirname(output),{recursive:true});await writeFile(output,`${header}\n${chunks.join('\n')}\n`);
console.log(`Merged ${files.length} NOAA yearly files.`);

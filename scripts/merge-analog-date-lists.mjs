import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const output=process.argv[2],inputs=process.argv.slice(3);
if(!output||!inputs.length){console.error('Usage: node scripts/merge-analog-date-lists.mjs <output.json> <input.json> [...]');process.exit(2);}
const lists=await Promise.all(inputs.map(file=>readFile(file,'utf8').then(JSON.parse)));
const dates=[...new Set(lists.flat())].sort();
await mkdir(path.dirname(output),{recursive:true});await writeFile(output,`${JSON.stringify(dates,null,2)}\n`);
console.log(`Merged ${dates.length} unique analog dates.`);

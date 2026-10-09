import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const input=process.argv[2]; if(!input) throw new Error('Usage: npm run calibrate:import -- <case.json>');
const source=JSON.parse(fs.readFileSync(path.resolve(input),'utf8'));
const errors=[];
if(source.schemaVersion!==2) errors.push('schemaVersion must equal 2');
if(!/^historical-[0-9]{4}-[0-9]{2}-[0-9]{2}(?:-[a-z0-9-]+)?$/.test(source.caseId??'')) errors.push('caseId must begin historical-YYYY-MM-DD');
if(!/^\d{4}-\d{2}-\d{2}$/.test(source.eventDate??'')) errors.push('eventDate is required');
if(!Array.isArray(source.sources)||!source.sources.length) errors.push('at least one authoritative source is required');
if(!Array.isArray(source.checkpoints)||source.checkpoints.length<2) errors.push('at least two atmospheric checkpoints are required');
if(errors.length){console.error(errors.map(x=>`- ${x}`).join('\n'));process.exit(1)}
const dir=path.join(ROOT,'calibration/cases/imported');fs.mkdirSync(dir,{recursive:true});
const out=path.join(dir,`${source.caseId}.json`);fs.writeFileSync(out,JSON.stringify({...source,importedAt:new Date().toISOString()},null,2)+'\n');
console.log(`[calibration] imported ${path.relative(ROOT,out)}`);

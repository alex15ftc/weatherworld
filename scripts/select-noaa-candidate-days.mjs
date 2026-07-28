import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { scoreOutbreak } from '../js/analogs/OutbreakIntensity.js';

const input=process.argv[2],output=process.argv[3]??'data/analogs/candidate-dates.json';
const minimum=Number(process.argv[4]??20);
const maximum=Number(process.argv[5]??Number.POSITIVE_INFINITY);
const maximumScore=Number(process.argv[6]??101);
const minimumReports=Number(process.argv[7]??0);
if(!input){console.error('Usage: node scripts/select-noaa-candidate-days.mjs <details.csv[.gz]> [dates.json] [minimum-score]');process.exit(2);}
const bytes=await readFile(input),text=(input.endsWith('.gz')?gunzipSync(bytes):bytes).toString('utf8');
const rows=parseCsv(text),byDate=new Map();
for(const row of rows){const date=parseRowDate(row);if(!date)continue;const events=byDate.get(date)??[];events.push({eventType:pick(row,'EVENT_TYPE'),magnitude:Number(pick(row,'MAGNITUDE')),torFScale:pick(row,'TOR_F_SCALE'),latitude:Number(pick(row,'BEGIN_LAT')),longitude:Number(pick(row,'BEGIN_LON')),beginHourUtc:parseHour(pick(row,'BEGIN_DATE_TIME'))});byDate.set(date,events);}
const candidates=[...byDate].map(([date,events])=>({date,...scoreOutbreak(events,{year:Number(date.slice(0,4))})})).filter(row=>row.score>=minimum&&row.score<maximumScore&&row.reportCount>=minimumReports).sort((a,b)=>b.score-a.score).slice(0,maximum);
await mkdir(path.dirname(output),{recursive:true});
await writeFile(output,`${JSON.stringify(candidates.map(row=>row.date),null,2)}\n`);
await writeFile(output.replace(/\.json$/,'-scores.json'),`${JSON.stringify(candidates,null,2)}\n`);
console.log(`Selected ${candidates.length} event days scoring at least ${minimum}${Number.isFinite(maximum)?` (top ${maximum})`:''}.`);
function pick(row,key){return row[key]??'';}
function parseRowDate(row){const ym=String(row.BEGIN_YEARMONTH??''),day=String(row.BEGIN_DAY??'').padStart(2,'0');if(/^\d{6}$/.test(ym)&&/^\d{2}$/.test(day))return`${ym.slice(0,4)}-${ym.slice(4)}-${day}`;const m=String(row.BEGIN_DATE_TIME??'').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);return m?`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`:null;}
function parseHour(value){const m=String(value).match(/\s(\d{1,2}):(\d{2})/);return m?Number(m[1])+Number(m[2])/60:0;}
function parseCsv(text){const records=[];let row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}else if(c==='"')quoted=true;else if(c===','){row.push(field);field='';}else if(c==='\n'){row.push(field.replace(/\r$/,''));records.push(row);row=[];field='';}else field+=c;}const headers=records.shift()??[];return records.map(values=>Object.fromEntries(headers.map((header,index)=>[header,values[index]??''])));}

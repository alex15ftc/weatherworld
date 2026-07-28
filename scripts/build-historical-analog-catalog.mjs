import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { scoreOutbreak } from '../js/analogs/OutbreakIntensity.js';

const eventPath=process.argv[2],environmentPath=process.argv[3];
const outputPath=process.argv[4]??'data/analogs/historical-analog-catalog.json';
const modulePath=process.argv[5]??'js/analogs/generatedHistoricalAnalogCatalog.js';
if(!eventPath||!environmentPath){console.error('Usage: node scripts/build-historical-analog-catalog.mjs <storm-events.csv> <era5-derived.json> [catalog.json] [catalog.js]');process.exit(2);}
const [eventBytes,environments]=await Promise.all([readFile(eventPath),readFile(environmentPath,'utf8').then(JSON.parse)]);
const csv=(eventPath.endsWith('.gz')?gunzipSync(eventBytes):eventBytes).toString('utf8');
const targetDates=new Set(Object.keys(environments)),byDate=new Map();let rowCount=0;
forEachCsvRow(csv,row=>{rowCount++;const event=normalizeEvent(row);if(!event.eventDate||!targetDates.has(event.eventDate))return;const list=byDate.get(event.eventDate)??[];list.push(event);byDate.set(event.eventDate,list);});
const records=[];
for(const [eventDate,rawPattern] of Object.entries(environments)){
  const events=byDate.get(eventDate)??[];if(!events.length)continue;
  const intensity=scoreOutbreak(events,{year:Number(eventDate.slice(0,4))});
  records.push({analogId:`us-${eventDate}`,eventDate,season:season(eventDate),intensity,pattern:normalizePattern(rawPattern),outcomes:intensity.counts,provenance:{reports:'NOAA NCEI Storm Events',environment:'ERA5-derived summary'}});
}
records.sort((a,b)=>a.eventDate.localeCompare(b.eventDate));
await Promise.all([writeJson(outputPath,{schemaVersion:1,records}),writeModule(modulePath,records)]);
console.log(`Built ${records.length} historical analogs from ${rowCount} Storm Events rows.`);

async function writeJson(target,value){await mkdir(path.dirname(target),{recursive:true});await writeFile(target,`${JSON.stringify(value,null,2)}\n`);}
async function writeModule(target,value){await mkdir(path.dirname(target),{recursive:true});await writeFile(target,`// Generated file. Do not edit manually.\nexport const HISTORICAL_ANALOG_CATALOG = Object.freeze(${JSON.stringify(value)});\n`);}
function normalizeEvent(row){const dateText=pick(row,'BEGIN_DATE_TIME','BEGIN_DATE','begin_date_time'),parsed=parseDate(dateText,row);return{eventDate:parsed?.date??null,beginDateTime:dateText,beginHourUtc:parsed?.hour??null,eventType:pick(row,'EVENT_TYPE','event_type'),magnitude:Number(pick(row,'MAGNITUDE','magnitude')),torFScale:pick(row,'TOR_F_SCALE','tor_f_scale'),latitude:Number(pick(row,'BEGIN_LAT','begin_lat')),longitude:Number(pick(row,'BEGIN_LON','begin_lon'))};}
function normalizePattern(value){const n=key=>Math.max(-1,Math.min(1,Number(value[key])||0));return{family:String(value.family??'shortwave_ejection'),troughAmplitude:n('troughAmplitude'),troughTilt:n('troughTilt'),lowLevelJetStrength:n('lowLevelJetStrength'),moistureQuality:n('moistureQuality'),capStrength:n('capStrength'),forcingTiming:n('forcingTiming'),discreteBias:Math.max(0,n('discreteBias')),environment:value.environment??{},diagnostics:value.diagnostics??{}};}
function season(date){const month=Number(date.slice(5,7));return month<=2||month===12?'winter':month<=5?'spring':month<=8?'summer':'fall';}
function pick(row,...keys){for(const key of keys)if(row[key]!==undefined)return row[key];return'';}
function parseDate(value,row){const ym=String(row.BEGIN_YEARMONTH??''),day=String(row.BEGIN_DAY??'').padStart(2,'0'),time=String(row.BEGIN_TIME??'0').padStart(4,'0');if(/^\d{6}$/.test(ym))return{date:`${ym.slice(0,4)}-${ym.slice(4)}-${day}`,hour:Number(time.slice(0,-2))+Number(time.slice(-2))/60};const match=String(value).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):?(\d{2})?)?/);return match?{date:`${match[3]}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`,hour:Number(match[4]??0)+Number(match[5]??0)/60}:null;}
function forEachCsvRow(text,callback){let headers=null,row=[],field='',quoted=false;const emit=()=>{row.push(field.replace(/\r$/,''));field='';if(headers===null)headers=row;else if(row.some(Boolean))callback(Object.fromEntries(headers.map((header,index)=>[header,row[index]??''])));row=[];};for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}else if(c==='"')quoted=true;else if(c===','){row.push(field);field='';}else if(c==='\n')emit();else field+=c;}if(field||row.length)emit();}

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const input=process.argv[2]??'data/analogs/merged-storm-events.csv';
const output=process.argv[3]??'data/analogs/era5-next-priority-dates.json';
const text=(await readFile(input)).toString('utf8');
const daily=new Map();
forEachCsvRow(text,row=>{
  const date=parseDate(row);if(!date)return;
  const type=String(row.EVENT_TYPE??'');
  if(!['Tornado','Hail','Thunderstorm Wind'].includes(type))return;
  const value=daily.get(date)??{reports:0,tornado:0,hail:0,wind:0,destructiveWind:0};
  value.reports++;
  if(type==='Tornado')value.tornado++;
  if(type==='Hail')value.hail++;
  if(type==='Thunderstorm Wind'){
    value.wind++;
    if(Number(row.MAGNITUDE)>=75)value.destructiveWind++;
  }
  daily.set(date,value);
});

// Confirmed high-end linear cases anchor the QLCS/derecho class. Low-report
// warm-season days are only screening candidates; ERA5 later determines which
// ones had favorable severe environments and therefore qualify as true busts.
const derecho=['1999-07-04','2012-06-29','2020-08-10','2021-12-15'];
const nullScreen=[];
for(const year of [1999,2011,2012,2013,2020,2021]){
  const candidates=[];
  for(let month=3;month<=6;month++)for(let day=1;day<=30;day++){
    const date=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const reports=daily.get(date)?.reports??0;
    if(reports<=2)candidates.push({date,reports});
  }
  // Spread samples through the season instead of selecting a run of adjacent days.
  for(const fraction of [.22,.68]){
    const row=candidates[Math.min(candidates.length-1,Math.floor(candidates.length*fraction))];
    if(row)nullScreen.push(row.date);
  }
}
const payload={schemaVersion:1,purpose:'derecho-qlcs anchors plus ERA5-screened favorable null/bust candidates',derecho, nullScreen,dates:[...new Set([...derecho,...nullScreen])]};
await mkdir(path.dirname(output),{recursive:true});
await writeFile(output,`${JSON.stringify(payload,null,2)}\n`);
console.log(`Selected ${derecho.length} derecho/QLCS anchors and ${nullScreen.length} low-report ERA5 screening days.`);

function parseDate(row){
  const ym=String(row.BEGIN_YEARMONTH??''),day=String(row.BEGIN_DAY??'').padStart(2,'0');
  return /^\d{6}$/.test(ym)&&/^\d{2}$/.test(day)?`${ym.slice(0,4)}-${ym.slice(4)}-${day}`:null;
}
function forEachCsvRow(csv,callback){
  let headers=null,row=[],field='',quoted=false;
  const emit=()=>{row.push(field.replace(/\r$/,''));field='';if(headers===null)headers=row;else if(row.some(Boolean))callback(Object.fromEntries(headers.map((h,i)=>[h,row[i]??''])));row=[];};
  for(let i=0;i<csv.length;i++){const c=csv[i];if(quoted){if(c==='"'&&csv[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}else if(c==='"')quoted=true;else if(c===','){row.push(field);field='';}else if(c==='\n')emit();else field+=c;}
  if(field||row.length)emit();
}

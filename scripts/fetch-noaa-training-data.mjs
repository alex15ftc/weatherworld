import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.env.WEATHERWORLD_TRAINING_CACHE || 'training-cache');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const force = args.has('--force');
const datesPath = valueAfter('--dates') || 'data/noaa-training/candidate-dates.json';
const stationPath = valueAfter('--stations') || 'data/noaa-training/stations.json';
const dates = await readDates(datesPath);
const stations = JSON.parse(await readFile(stationPath, 'utf8')).stations;
const manifest = { schemaVersion:'2.81.0', provider:'NOAA NCEI', createdAt:new Date().toISOString(), dates, files:[] };
const work = [];

for (const station of stations) {
  const url = `https://www.ncei.noaa.gov/pub/data/igra/data/data-por/${station.id}-data.txt.zip`;
  const target = path.join(root, 'igra', `${station.id}-data.txt.zip`);
  work.push(() => acquire(url, target, { kind:'igra', stationId:station.id }));
}
for (const date of dates) {
  for (const valid of analysisTimes(date)) {
    const compact = valid.replaceAll('-', '').replace('T', '').slice(0, 10);
    const yyyymm = compact.slice(0, 6), yyyymmdd = compact.slice(0, 8), hh = compact.slice(8, 10);
    const filename = `narr-a_221_${yyyymmdd}_${hh}00_000.grb`;
    const url = `https://www.ncei.noaa.gov/thredds/fileServer/model-narr-a-files/${yyyymm}/${yyyymmdd}/${filename}`;
    const target = path.join(root, 'narr', yyyymm, yyyymmdd, filename);
    work.push(() => acquire(url, target, { kind:'narr', eventDate:date, validTime:valid }));
  }
}
for (let index=0;index<work.length;index+=6) {
  manifest.files.push(...await Promise.all(work.slice(index,index+6).map(task=>task())));
  console.log(JSON.stringify({ completed:Math.min(index+6,work.length), total:work.length }));
}

const manifestPath = path.join(root, 'manifests', 'noaa-training-acquisition.json');
if (!dryRun) {
  await mkdir(path.dirname(manifestPath), { recursive:true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}
console.log(JSON.stringify({ dryRun, root, dates:dates.length, stations:stations.length, files:manifest.files.length, manifestPath }, null, 2));

async function acquire(url, target, metadata) {
  if (!force && await exists(target)) return { ...metadata, url, path:target, status:'cached', ...(dryRun ? {} : await fileIdentity(target)) };
  if (dryRun) return { ...metadata, url, path:target, status:'planned' };
  await mkdir(path.dirname(target), { recursive:true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`NOAA download failed ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 512) throw new Error(`NOAA response was unexpectedly small: ${url}`);
  await writeFile(target, bytes);
  return { ...metadata, url, path:target, status:'downloaded', bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex') };
}
async function fileIdentity(file) {
  const bytes = await readFile(file);
  return { bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex') };
}
async function exists(file) { try { await stat(file); return true; } catch { return false; } }
async function readDates(file) {
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  const values = Array.isArray(parsed) ? parsed
    : Array.isArray(parsed.dates) ? parsed.dates
      : Array.isArray(parsed.records) ? parsed.records : Object.keys(parsed);
  return [...new Set(values.map(value => value.eventDate ?? value.date ?? value).filter(value =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1979-01-01' && value <= '2014-10-01'
  ))].sort();
}
function analysisTimes(date) {
  const next = new Date(`${date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  const nextDate=next.toISOString().slice(0,10);
  return [`${date}T12`, `${date}T18`, `${nextDate}T00`, `${nextDate}T06`, `${nextDate}T12`];
}
function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

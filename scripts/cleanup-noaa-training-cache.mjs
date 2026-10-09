import { access, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const apply = process.argv.includes('--apply');
const root = path.resolve(process.env.WEATHERWORLD_TRAINING_CACHE || 'training-cache');
const processedPath = path.join(root, 'processed', 'noaa-cases.json');
const catalogPath = path.resolve('data/analogs/noaa-historical-analog-catalog.json');
const atmospherePath = path.join(root, 'processed', 'noaa-atmospheres.json');
const atmosphereModulePath = path.resolve('js/analogs/generatedNoaaAtmosphereCatalog.js');
const targets = [path.join(root, 'narr'), path.join(root, 'igra')];

const processed = JSON.parse(await readFile(processedPath, 'utf8'));
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const atmospheres = JSON.parse(await readFile(atmospherePath, 'utf8'));
if (!Array.isArray(processed) || processed.length < 25) {
  throw new Error('Refusing cleanup: processed NOAA corpus is missing or incomplete');
}
if (!Array.isArray(catalog) || catalog.length !== processed.length) {
  throw new Error('Refusing cleanup: active catalog does not match the processed corpus');
}
if (!Array.isArray(atmospheres) || atmospheres.length < 25
    || atmospheres.some(item=>item.sequence?.map(frame=>frame.hourUtc).join(',')!=='12,18,24,30,36')) {
  throw new Error('Refusing cleanup: full-domain atmosphere sequences are missing or incomplete');
}
const atmosphereModule = await readFile(atmosphereModulePath, 'utf8');
if (!atmosphereModule.includes('NOAA_ATMOSPHERE_CATALOG') || atmosphereModule.includes('Object.freeze([])')) {
  throw new Error('Refusing cleanup: generated full-atmosphere module is missing or empty');
}

const entries = [];
for (const target of targets) {
  if (!await exists(target)) continue;
  entries.push({ path:target, bytes:await directoryBytes(target) });
}
const bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
if (apply) {
  for (const entry of entries) await rm(entry.path, { recursive:true });
}
console.log(JSON.stringify({
  applied:apply,
  retainedRecords:catalog.length,
  retainedAtmosphereSequences:atmospheres.length,
  targets:entries,
  reclaimableBytes:bytes,
  reclaimableGiB:Number((bytes / 2**30).toFixed(3))
}, null, 2));

async function exists(target) {
  try { await access(target); return true; } catch { return false; }
}
async function directoryBytes(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes:true })) {
    const target = path.join(directory, entry.name);
    total += entry.isDirectory() ? await directoryBytes(target) : (await stat(target)).size;
  }
  return total;
}

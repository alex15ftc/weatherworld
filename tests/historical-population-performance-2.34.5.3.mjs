import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const temp = await mkdtemp(path.join(os.tmpdir(), 'ww-23453-'));
const root = path.join(temp, 'archive');
const normalized = path.join(root, 'normalized', 'spc');
await mkdir(normalized, { recursive: true });
const ring = [[-100,35],[-95,35],[-95,40],[-100,40],[-100,35]];
for (let index = 0; index < 3; index += 1) {
  const cycle = `${12 + index}00`;
  const normalizedProduct = { schemaVersion:'2.34.5.1', forecastDay:'day1', issuedAt:`2024-05-06T${12 + index}:00:00.000Z`, sourceFormat:'spc-shapefile', hazards:{ categorical:[{ id:'TSTM', hazardType:'categorical', value:'TSTM', polygons:[{ outer:ring, holes:[], validation:{valid:true}, bbox:{minLon:-100,maxLon:-95,minLat:35,maxLat:40} }] }], tornado:[], wind:[], hail:[], significantTornado:[], significantWind:[], significantHail:[] } };
  const originalProduct = { forecastDay:'day1', issueDate:'20240506', cycle, artifacts:[{ type:'shapefile', fileName:'day1otlk-shp.zip', localPath:`20240506/day1-${cycle}/day1otlk-shp.zip`, sha256:`hash-${index}` }] };
  await writeFile(path.join(normalized, `day1_20240506_${cycle}.json`), JSON.stringify({ originalProduct, normalizedProduct }));
}
function run(extra = []) {
  return spawnSync(process.execPath, [path.resolve('scripts/historical-pipeline.mjs'),'--stage','build','--root',root,'--input',normalized,'--concurrency','3','--progress',...extra], { encoding:'utf8' });
}
const first = run();
assert.equal(first.status, 0, first.stderr || first.stdout);
const manifest1 = JSON.parse(await readFile(path.join(root,'pipeline-manifest.json'),'utf8'));
assert.equal(manifest1.counters.rasterized, 3);
assert.equal(manifest1.counters.casesBuilt, 3);
const raster = path.join(root,'rasterized','spc','day1_20240506_1200.grid.json');
const before = (await stat(raster)).mtimeMs;
await new Promise(resolve => setTimeout(resolve, 30));
const second = run();
assert.equal(second.status, 0, second.stderr || second.stdout);
const manifest2 = JSON.parse(await readFile(path.join(root,'pipeline-manifest.json'),'utf8'));
assert.equal(manifest2.counters.rasterized, 0);
assert.equal(manifest2.counters.rasterSkipped, 3);
assert.equal(manifest2.counters.casesBuilt, 0);
assert.equal(manifest2.counters.casesSkipped, 3);
assert.equal((await stat(raster)).mtimeMs, before);
assert.match(second.stdout, /3\/3 \(100%\)/);
console.log('Historical population performance 2.34.5.3 checks passed');

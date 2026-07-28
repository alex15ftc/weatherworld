import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveNormalizedSpcInput, ensureHistoricalLayout } from '../js/historical/HistoricalArchivePipeline.js';
import { rasterizeSpcOutlook } from '../js/historical/spc/SPCOutlookRasterizer.js';

const temp = await mkdtemp(path.join(os.tmpdir(), 'ww-2345-'));
const legacy = path.join(temp, 'data', 'spc', 'normalized');
await mkdir(legacy, { recursive: true });
const normalizedProduct = {
  schemaVersion: '2.34.2.6', forecastDay: 'day1', issuedAt: '2024-05-06T20:00:00.000Z',
  hazards: {
    categorical: [
      { id: 'TSTM_OPEN', hazardType: 'categorical', value: 'TSTM', polygons: [{
        outer: [[-100, 49], [-92, 46], [-84, 43], [-75, 42], [-100, 49]],
        holes: [], validation: { valid: true }, bbox: { minLon: -100, maxLon: -75, minLat: 42, maxLat: 49 }
      }]},
      { id: 'MRGL_VALID', hazardType: 'categorical', value: 'MRGL', polygons: [{
        outer: [[-99, 36], [-94, 36], [-94, 40], [-99, 40], [-99, 36]], holes: [], validation: { valid: true },
        bbox: { minLon: -99, maxLon: -94, minLat: 36, maxLat: 40 }
      }]}
    ], tornado: [], wind: [], hail: [], significantTornado: [], significantWind: [], significantHail: []
  }
};
await writeFile(path.join(legacy, '20240506-day1-2000.json'), JSON.stringify({ normalizedProduct }));

const detected = await resolveNormalizedSpcInput({ cwd: temp, root: path.join(temp, 'data', 'historical') });
assert.equal(detected.inputRoot, legacy);
const layout = await ensureHistoricalLayout(path.join(temp, 'data', 'historical'));
assert.ok(layout.rasterizedSpc.endsWith(path.join('rasterized', 'spc')));

const raster = rasterizeSpcOutlook(normalizedProduct, { coverageSamples: 2 });
assert.equal(raster.diagnostics.skippedPolygonCount, 1);
assert.equal(raster.diagnostics.skippedPolygons[0].reason, 'ambiguous-open-tstm-contour');
assert.ok(raster.cells.some(cell => cell.hazards.categorical?.value === 'MRGL'));
assert.equal(raster.cells.some(cell => cell.hazards.categorical?.value === 'TSTM'), false, 'ambiguous chord-closed TSTM must not paint the inverted side');

const run = spawnSync(process.execPath, [path.resolve('scripts/historical-pipeline.mjs'), '--stage', 'build', '--root', path.join(temp, 'data', 'historical')], { cwd: temp, encoding: 'utf8' });
assert.equal(run.status, 0, run.stderr || run.stdout);
const catalog = JSON.parse(await readFile(path.join(temp, 'data', 'historical', 'catalog', 'cases.json'), 'utf8'));
assert.equal(catalog.summary.caseCount, 1);
const manifest = JSON.parse(await readFile(path.join(temp, 'data', 'historical', 'pipeline-manifest.json'), 'utf8'));
assert.equal(manifest.schemaVersion, '2.34.5');
assert.equal(manifest.counters.failures.length, 0);
console.log('Historical archive pipeline 2.34.5 checks passed');

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { historicalPaths, HISTORICAL_PIPELINE_VERSION } from '../js/historical/HistoricalArchivePipeline.js';

const temp = await mkdtemp(path.join(os.tmpdir(), 'ww-23452-'));
const root = path.join(temp, 'archive');
const normalized = path.join(root, 'normalized', 'spc');
await mkdir(normalized, { recursive: true });

const ring = [[-100, 35], [-95, 35], [-95, 40], [-100, 40], [-100, 35]];
const normalizedProduct = {
  schemaVersion: '2.34.5.1', forecastDay: 'day1', issuedAt: '2024-05-06T20:00:00.000Z', sourceFormat: 'spc-shapefile',
  hazards: { categorical: [{ id: 'TSTM', hazardType: 'categorical', value: 'TSTM', polygons: [{ outer: ring, holes: [], validation: { valid: true }, bbox: { minLon: -100, maxLon: -95, minLat: 35, maxLat: 40 } }] }], tornado: [], wind: [], hail: [], significantTornado: [], significantWind: [], significantHail: [] }
};
const originalProduct = { forecastDay: 'day1', issueDate: '20240506', cycle: '2000', artifacts: [{ type: 'shapefile', fileName: 'day1otlk-shp.zip', localPath: '20240506/day1-2000/day1otlk-shp.zip', sha256: 'abc' }] };
await writeFile(path.join(normalized, 'day1_20240506_2000.json'), JSON.stringify({ originalProduct, normalizedProduct }));

const run = spawnSync(process.execPath, [path.resolve('scripts/historical-pipeline.mjs'), '--stage', 'build', '--root', root, '--input', normalized], { encoding: 'utf8' });
assert.equal(run.status, 0, run.stderr || run.stdout);
const paths = historicalPaths(root);
assert.equal(HISTORICAL_PIPELINE_VERSION, '2.34.5.3');
const catalog = JSON.parse(await readFile(path.join(paths.catalog, 'cases.json'), 'utf8'));
assert.equal(catalog.summary.caseCount, 1);
const caseId = catalog.cases[0].caseId;
const historicalCase = JSON.parse(await readFile(path.join(paths.cases, `${caseId}.json`), 'utf8'));
assert.equal(historicalCase.archive.status.caseBuilt, true);
assert.equal(historicalCase.archive.sourceFormat, 'spc-shapefile');
assert.equal(historicalCase.archive.sourceArtifacts[0].type, 'shapefile');
assert.equal(historicalCase.archive.verification.passed, true);
await assert.rejects(access(path.join(root, 'spc-cases')), /ENOENT/);
console.log('Historical archive population 2.34.5.2 checks passed');

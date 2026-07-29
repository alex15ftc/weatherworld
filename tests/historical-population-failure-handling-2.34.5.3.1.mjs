import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const temp = await mkdtemp(path.join(os.tmpdir(), 'ww-234531-'));
const scripts = path.join(temp, 'scripts');
const archive = path.join(temp, 'archive');
await mkdir(scripts, { recursive: true });

await writeFile(path.join(temp, 'manifest.json'), JSON.stringify({ dates: ['2024-05-06', '2024-05-07'], days: ['day1'] }));

await writeFile(path.join(scripts, 'fetch-stub.mjs'), `
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const args = process.argv.slice(2);
const get = key => args[args.indexOf(key) + 1];
const date = get('--start');
if (date === '2024-05-06') {
  console.error('simulated acquisition error for 2024-05-06');
  process.exit(7);
}
const manifest = get('--manifest');
await mkdir(path.dirname(manifest), { recursive: true });
await writeFile(manifest, JSON.stringify({ products: [] }));
`);

await writeFile(path.join(scripts, 'parse-stub.mjs'), `process.exit(0);\n`);
await writeFile(path.join(scripts, 'pipeline-stub.mjs'), `process.exit(0);\n`);

const populationScript = path.resolve('scripts/populate-historical-archive.mjs');
const run = spawnSync(process.execPath, [
  populationScript,
  '--manifest', path.join(temp, 'manifest.json'),
  '--root', archive,
  '--fetch-script', 'scripts/fetch-stub.mjs',
  '--parse-script', 'scripts/parse-stub.mjs',
  '--pipeline-script', 'scripts/pipeline-stub.mjs',
  '--download-concurrency', '2'
], { cwd: temp, encoding: 'utf8' });

assert.equal(run.status, 1, run.stderr || run.stdout);
assert.doesNotMatch(run.stderr, /Cannot access 'StageError' before initialization/);
assert.match(run.stderr, /simulated acquisition error for 2024-05-06/);
assert.match(run.stderr, /Population completed with 1 failure/);
assert.match(run.stdout, /\[Acquire\] 1\/2/);
assert.match(run.stdout, /\[Acquire\] 2\/2/);
assert.match(run.stdout, /Acquisition summary: 1 succeeded, 1 failed, 0 skipped/);
assert.match(run.stdout, /Normalization summary: 1 succeeded, 0 failed, 1 skipped/);

const report = JSON.parse(await readFile(path.join(archive, 'population-report.json'), 'utf8'));
assert.equal(report.schemaVersion, '2.34.5.3.1');
assert.equal(report.success, false);
assert.equal(report.counts.acquisitionSucceeded, 1);
assert.equal(report.counts.acquisitionFailed, 1);
assert.equal(report.failures.length, 1);
assert.equal(report.failures[0].date, '2024-05-06');
assert.equal(report.failures[0].stage, 'acquisition');

console.log('Historical population failure handling 2.34.5.3.1 checks passed');

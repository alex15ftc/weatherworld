// A cloud model storm saved and restored in a fresh process carries on bit for bit
// (EngineRun.snapshot / restore, for engine restarts: js/game/StormWorkers.js). A SupercellB run
// to 35 model minutes (its nest started), saved; then the run here and the restored one in a
// child process each step 40 times, and their module memories must match, all but the call stack
// (STACK: Zig's default 16 MB stack sits first in memory and holds only what the last calls left
// behind, not model state). Under a minute.
//   node tests/cloudmodel-restore.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineRun, readScenarioText } from '../js/cloudmodel/EngineRun.js';
import { memorySnapshot } from '../js/cloudmodel/CloudModel.js';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();
const STEPS = 40;
const STACK = 16 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes.subarray(STACK)).digest('hex');

if (process.argv[2] === 'child') {
  const dir = process.argv[3];
  const run = EngineRun.restore({ memory: new Uint8Array(fs.readFileSync(path.join(dir, 'memory.bin'))), json: fs.readFileSync(path.join(dir, 'state.json'), 'utf8') });
  for (let k = 0; k < STEPS; k++) run.step();
  process.stdout.write(JSON.stringify({ hash: hash(memorySnapshot()), time: run.model.time, nest: run.nest != null }));
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = readScenarioText(fs.readFileSync(path.join(root, 'roblox/Shared/StormLab/Data/SupercellB.luau'), 'utf8'));
const run = EngineRun.fromScenario(data, { nest: true });
while (run.model.time < 35 * 60) run.replayStep();
assert.ok(run.nest, 'the nest has started');
const snap = run.snapshot();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-restore-'));
try {
  fs.writeFileSync(path.join(dir, 'memory.bin'), snap.memory);
  fs.writeFileSync(path.join(dir, 'state.json'), snap.json);
  for (let k = 0; k < STEPS; k++) run.step();
  const here = { hash: hash(memorySnapshot()), time: run.model.time };
  const child = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), 'child', dir], { encoding: 'utf8', maxBuffer: 1 << 20 }));
  assert.equal(child.nest, true, 'the restored run has its nest');
  assert.equal(child.time, here.time, 'the same model time');
  assert.equal(child.hash, here.hash, 'the same memory, bit for bit');
  console.log(`cloudmodel restore: ok (memory ${(snap.memory.length / 1e6).toFixed(0)} MB, model ${(here.time / 60).toFixed(1)} min after ${STEPS} steps each)`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

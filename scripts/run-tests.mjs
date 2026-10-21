// Runs every tests/*.mjs file (or those matching the arguments) and summarizes pass/fail.
//   node scripts/run-tests.mjs [filter ...]
// The files run side by side, a few at a time (WEATHER_TEST_JOBS; default: half the cores, at
// most 12): each is its own process and none shares files with another. The longest go
// first, so that one does not start last and hold up the end (TEST_ORDER).
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';
import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';

avoidBackgroundThrottling();

// The slowest files, slowest first (each took over a minute with 12 at a time, 2026-10-17).
const TEST_ORDER = ['atmosphere-world', 'day-one-outlook', 'world-map', 'region-steering', 'regional-atmosphere', 'storm-character', 'ensemble-perturbation', 'radar-simulator', 'atmosphere-authority-runtime', 'quasi-geostrophic-model', 'mesoscale-discussion'];
const filters = process.argv.slice(2);
const rank = file => { const i = TEST_ORDER.findIndex(name => file.startsWith(name)); return i < 0 ? TEST_ORDER.length : i; };
const files = readdirSync('tests').filter(f => f.endsWith('.mjs') && (!filters.length || filters.some(x => f.includes(x)))).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
const jobs = Math.max(1, Number(process.env.WEATHER_TEST_JOBS) || Math.min(12, Math.floor(os.availableParallelism() / 2)));
const started = Date.now(), failed = [];

function runFile(file) {
  return new Promise(resolve => {
    const begun = Date.now();
    const child = spawn(process.execPath, ['--import', new URL('./priority-register.mjs', import.meta.url).href, `tests/${file}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const timer = setTimeout(() => child.kill(), 600_000);
    child.on('close', status => {
      clearTimeout(timer);
      const seconds = ((Date.now() - begun) / 1000).toFixed(1);
      if (status === 0) console.log(`pass  ${file} (${seconds}s)`);
      else {
        failed.push(file);
        const reason = output.split('\n').find(l => /Error|assert/i.test(l)) ?? `exit ${status}`;
        console.log(`FAIL  ${file} (${seconds}s): ${reason.trim().slice(0, 200)}`);
      }
      resolve();
    });
  });
}

const queue = [...files];
await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, async () => { while (queue.length) await runFile(queue.shift()); }));
console.log(`\n${files.length - failed.length}/${files.length} passed in ${((Date.now() - started) / 1000).toFixed(0)} s${failed.length ? ` (failed: ${failed.sort().join(', ')})` : ''}`);
process.exitCode = failed.length ? 1 : 0;

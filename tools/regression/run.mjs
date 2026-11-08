// Regression suite (memory note regression-suite): REG_OUT=<scratch folder> node tools/regression/run.mjs <name> [baseline]
// Regression suite driver: node run.mjs <name> [baseline] [--seeds 1,...,8] [--days 10]
// Runs worker.mjs for each seed (at most 6 at once), merges the cold-pool rows into
// <name>-coldpool.csv, then runs agg.cjs <name> [baseline].
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { avoidBackgroundThrottling } = await import('file:///C:/Users/alex1/Documents/VSCodeProjects/weatherworld/js/runtime/processPriority.node.js');
avoidBackgroundThrottling();

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), flag = f => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const [name, baseline] = positional;
if (!name) { console.error('usage: node run.mjs <name> [baseline]'); process.exit(1); }
const seeds = (flag('--seeds') ?? '1,2,3,4,5,6,7,8').split(',').map(Number), days = Number(flag('--days') ?? 10), JOBS = 6;
// results go to REG_OUT (a scratch folder; default: beside this script)
const ROOT = process.env.REG_OUT || here;
const out = path.join(ROOT, name); fs.mkdirSync(out, { recursive: true });
const started = Date.now();
const queue = [...seeds];
async function lane() {
  while (queue.length) {
    const seed = queue.shift();
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(here, 'worker.mjs'), String(seed), String(days), out], { stdio: ['ignore', 'inherit', 'pipe'] });
      const log = fs.createWriteStream(path.join(out, `log-${seed}.txt`));
      child.stderr.on('data', d => { log.write(d); if (/finished/.test(d)) process.stdout.write(d); });
      child.on('exit', code => { log.end(); code ? reject(new Error(`seed ${seed} exited ${code}`)) : resolve(); });
    });
  }
}
await Promise.all(Array.from({ length: Math.min(JOBS, seeds.length) }, lane));
const merged = fs.createWriteStream(path.join(ROOT, `${name}-coldpool.csv`));
seeds.forEach((seed, i) => { const text = fs.readFileSync(path.join(out, `coldpool-${seed}.csv`), 'utf8'); merged.write(i ? text.slice(text.indexOf('\n') + 1) : text); });
merged.end(); await new Promise(r => merged.on('finish', r));
const minutes = ((Date.now() - started) / 60000).toFixed(1);
fs.writeFileSync(path.join(out, 'run-info.json'), JSON.stringify({ name, seeds, days, minutes, finished: new Date().toISOString() }));
console.log(`runs done in ${minutes} min`);
execFileSync(process.execPath, [path.join(here, 'agg.cjs'), name, ...(baseline ? [baseline] : [])], { stdio: 'inherit' });

// Runs every tests/*.mjs file (or those matching the arguments) and summarizes pass/fail.
//   node scripts/run-tests.mjs [filter ...]
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const filters = process.argv.slice(2);
const files = readdirSync('tests').filter(f => f.endsWith('.mjs') && (!filters.length || filters.some(x => f.includes(x)))).sort();
const failed = [];
for (const file of files) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [`tests/${file}`], { encoding: 'utf8', timeout: 600_000 });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (run.status === 0) console.log(`pass  ${file} (${seconds}s)`);
  else {
    failed.push(file);
    const reason = `${run.stderr ?? ''}${run.stdout ?? ''}`.split('\n').find(l => /Error|assert/i.test(l)) ?? (run.error?.message ?? `exit ${run.status}`);
    console.log(`FAIL  ${file} (${seconds}s): ${reason.trim().slice(0, 200)}`);
  }
}
console.log(`\n${files.length - failed.length}/${files.length} passed`);
process.exitCode = failed.length ? 1 : 0;

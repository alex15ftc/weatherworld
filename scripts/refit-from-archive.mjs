// Refits the outlooks' calibration from saved forecast runs, in a minute or two, without running the
// world (outlook-verify.mjs --save keeps them; data/outlook-archive). Re-scores the fitting mornings with
// --calibration-data and --cig-data, fits the tables (fit-outlook-calibration.mjs, fit-cig-calibration.mjs),
// and re-scores a check set if one is given.
//   node scripts/refit-from-archive.mjs <fit dir> [--days 5] [--seeds 1-20] [--check <dir> --check-days 3 --check-seeds 21-30] [--install]
// --install writes the tables into js/forecast/outlookCalibration.js: the chances' table as fitted (a Day 1
// update table, day1update, is kept from before when the fit has none), and the intensity groups as fitted
// except that, by the user's choice (2026-10-23), a tornado group the fit would never draw is drawn as
// readily as the group below it (CIG2 with CIG1; CIG3 needs at least 0.75 of the runs), and no group asks
// fewer runs than the one below it. Only run it with an archive made by the engine as it now is: runs saved
// by older storm or atmosphere code describe other weather.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2), flag = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const range = text => { const [a, b] = text.split('-').map(Number); return Array.from({ length: (b ?? a) - a + 1 }, (_, k) => a + k).join(','); };
const fitDir = args[0], node = process.execPath, here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (!fitDir || !fs.existsSync(fitDir)) { console.error('usage: node scripts/refit-from-archive.mjs <fit dir> [--check <dir>] [--install]'); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refit-'));
const run = (script, list) => execFileSync(node, [path.join(here, script), ...list], { encoding: 'utf8', maxBuffer: 1 << 28 });

// 1. The fitting mornings, scored again with the fitting data.
const scored = run('outlook-verify.mjs', [flag('--days', '5'), '--seeds', range(flag('--seeds', '1-20')), '--from', fitDir, '--calibration-data', '--cig-data']);
const dataFile = path.join(tmp, 'data.txt'); fs.writeFileSync(dataFile, scored);
console.log(scored.split('\n').filter(l => /^--- Day|forecast right/.test(l)).join('\n'));
// 2. The fits.
const cal = run('fit-outlook-calibration.mjs', [dataFile]), cig = run('fit-cig-calibration.mjs', [dataFile]);
const calLine = cal.match(/^export const CALIBRATION = .*$/m)?.[0], cigLine = cig.match(/^export const CIG_SHARE = .*$/m)?.[0];
console.log(cig.split('\n').filter(l => /^day[12] tornado|^day[12] hail|^day[12] wind/.test(l)).join('\n'));
if (args.includes('--install')) {
  if (!calLine || !cigLine) throw new Error('the fits gave no tables');
  const file = path.join(here, '..', 'js', 'forecast', 'outlookCalibration.js');
  let source = fs.readFileSync(file, 'utf8');
  const before = JSON.parse(source.match(/^export const CALIBRATION = Object\.freeze\((.*)\);$/m)[1]);
  const fitted = JSON.parse(calLine.match(/Object\.freeze\((.*)\);$/)[1]);
  if (!fitted.day1update && before.day1update) fitted.day1update = before.day1update;
  const shares = JSON.parse(cigLine.match(/Object\.freeze\((.*)\);$/)[1]);
  for (const day of Object.keys(shares)) {
    const t = shares[day].tornado;
    if (t && t[0] <= 1) { if (t[1] > 1) t[1] = t[0]; if (t[2] > 1) t[2] = Math.max(t[1], 0.75); }
    for (const list of Object.values(shares[day])) for (let k = 1; k < list.length; k++) list[k] = Math.max(list[k], list[k - 1]);
  }
  const stamp = new Date().toISOString().slice(0, 10);
  source = source.replace(/^export const CALIBRATION = .*$/m, `// (Refitted ${stamp} from ${fitDir} by scripts/refit-from-archive.mjs.)\nexport const CALIBRATION = Object.freeze(${JSON.stringify(fitted)});`);
  source = source.replace(/^export const CIG_SHARE = .*$/m, `// (Refitted ${stamp} from ${fitDir} by scripts/refit-from-archive.mjs, with the user's tornado-group rule.)\nexport const CIG_SHARE = Object.freeze(${JSON.stringify(shares)});`);
  fs.writeFileSync(file, source);
  console.log(`installed in ${file}`);
}
// 3. The check set, scored with whatever tables are installed now.
if (flag('--check')) {
  const check = run('outlook-verify.mjs', [flag('--check-days', '3'), '--seeds', range(flag('--check-seeds', '21-30')), '--from', flag('--check')]);
  console.log('check set:\n' + check.split('\n').filter(l => /^--- Day|forecast  |verified  |forecast right/.test(l)).join('\n'));
}
fs.rmSync(tmp, { recursive: true, force: true });

// Fits how the intensity groups of hail and wind weigh the runs' own reports against the environment's signal
// (outlookCalibration.js CIG_ENVIRONMENT; DayOneOutlook.js significantHailParameter, derechoCompositeParameter), from the
// contour areas that
//   node scripts/outlook-verify.mjs [days] --seeds ... --from <archive> --cig-data
// prints (its CIG_ROWS line, in a file). For each day, hazard and group, over the areas where at least one run reaches the
// group: a logistic fit of whether the area then verified the group or more, on the share of the runs reaching it and
// ln(1 + the area's composite), its mean over the area's ring ('env') or its highest there ('envMax'), whichever fits
// better (deviance). A group is left to CIG_SHARE when it has fewer than --least verified areas, or when the environment
// does not help (its coefficient not above zero, or the deviance not lower by at least 2 than the runs' share alone).
//   node scripts/fit-cig-environment.mjs rows.txt [--least 8] [--days day1,day2] [--hazards hail,wind] [--ridge 0.01]
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2), file = args.find(a => !a.startsWith('--'));
const opt = (name, value) => (args.includes(name) ? args[args.indexOf(name) + 1] : value);
const least = Number(opt('--least', 8)), ridge = Number(opt('--ridge', 0.01));
const days = opt('--days', 'day1,day2').split(','), hazards = opt('--hazards', 'hail,wind').split(',');
const line = readFileSync(file, 'utf8').split('\n').find(l => l.startsWith('CIG_ROWS '));
if (!line) throw new Error('no CIG_ROWS line in ' + file);
const rows = JSON.parse(line.slice('CIG_ROWS '.length));

// Logistic regression by Newton's method with a small ridge (not on the intercept). X: rows of features (1 first).
function logistic(X, y) {
  const k = X[0].length; let w = new Array(k).fill(0);
  for (let it = 0; it < 50; it++) {
    const g = new Array(k).fill(0), H = Array.from({ length: k }, () => new Array(k).fill(0));
    X.forEach((x, r) => { const p = 1 / (1 + Math.exp(-x.reduce((a, v, j) => a + v * w[j], 0))), q = p * (1 - p); for (let i = 0; i < k; i++) { g[i] += (y[r] - p) * x[i]; for (let j = 0; j < k; j++) H[i][j] -= q * x[i] * x[j]; } });
    for (let i = 1; i < k; i++) { g[i] -= ridge * w[i]; H[i][i] -= ridge; }
    const step = solve(H, g); w = w.map((v, i) => v - step[i]);   // (Newton: w - H^-1 g)
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  const deviance = -2 * X.reduce((a, x, r) => { const p = Math.min(1 - 1e-12, Math.max(1e-12, 1 / (1 + Math.exp(-x.reduce((s, v, j) => s + v * w[j], 0))))); return a + (y[r] ? Math.log(p) : Math.log(1 - p)); }, 0);
  return { w, deviance };
}
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]; } }
  return M.map((row, i) => row[n] / row[i]);
}

const table = {};
for (const day of days) for (const h of hazards) {
  const list = rows.filter(r => r.day === day && r.h === h && r.env !== null && r.env !== undefined);
  const groups = list[0]?.shares.length ?? 0;
  for (let g = 0; g < groups; g++) {
    const sample = list.filter(r => r.shares[g] > 0), y = sample.map(r => (r.verified >= g + 1 ? 1 : 0)), hits = y.reduce((a, v) => a + v, 0);
    const tag = `${day} ${h.padEnd(5)} CIG${g + 1}: ${sample.length} areas with a run there, ${hits} verified`;
    if (hits < least) { console.log(`${tag}: too few, CIG_SHARE as before`); continue; }
    const base = logistic(sample.map(r => [1, r.shares[g]]), y);
    const fits = ['env', 'envMax'].map(field => ({ field, ...logistic(sample.map(r => [1, r.shares[g], Math.log1p(Math.max(0, r[field]))]), y) }));
    const best = fits.sort((a, b) => a.deviance - b.deviance)[0];
    const drawn = sample.filter(r => 1 / (1 + Math.exp(-(best.w[0] + best.w[1] * r.shares[g] + best.w[2] * Math.log1p(Math.max(0, r[best.field]))))) >= 0.5), drawnHits = drawn.filter(r => r.verified >= g + 1).length;
    console.log(`${tag}: share alone deviance ${base.deviance.toFixed(1)}; with ${best.field} ${best.deviance.toFixed(1)} [${best.w.map(v => v.toFixed(3)).join(', ')}]; drawn on ${drawn.length} areas, ${drawnHits} verified`);
    if (!(best.w[2] > 0) || base.deviance - best.deviance < 2) { console.log('   the environment does not help: CIG_SHARE as before'); continue; }
    ((table[day] ??= {})[h] ??= [])[g] = [...best.w.map(v => Math.round(v * 1000) / 1000), best.field];
  }
}
// (a group without a fit keeps CIG_SHARE: null in the list)
for (const day of Object.keys(table)) for (const h of Object.keys(table[day])) table[day][h] = Array.from(table[day][h], v => v ?? null);
console.log('\nexport const CIG_ENVIRONMENT = Object.freeze(' + JSON.stringify(table) + ');');

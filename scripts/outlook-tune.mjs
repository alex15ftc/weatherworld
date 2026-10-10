// Rebuilds outlook products from saved ensemble members (outlook-audit with
// OUTLOOK_AUDIT_MEMBERS_DIR) and re-verifies them, so product settings can be tuned without
// re-running the simulation.
//   node scripts/outlook-tune.mjs <members dir> [--smooth day1,day2,day3 km] [--tornado-smooth factor] [--cig f1,f2,f3] [--quiet]
// OUTLOOK_CALIBRATION=off and OUTLOOK_AUDIT_JSON=path behave as in outlook-audit.
import fs from 'node:fs';
import path from 'node:path';
import { buildOutlookProducts, SMOOTHING_KM, CIG_CONDITIONAL_FRACTION, OUTLOOK_TUNING } from '../js/forecast/EnsembleOutlookEngine.js';
import { aggregateTruth, TRUTH_FIELDS } from '../js/verification/truth.js';
import { verifyProduct, summarizeVerification, mergeHistograms } from '../js/verification/outlookVerification.js';

const args = process.argv.slice(2);
const dir = args[0];
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
if (option('--smooth')) option('--smooth').split(',').map(Number).forEach((km, i) => { SMOOTHING_KM[['day1', 'day2', 'day3'][i]] = km; });
if (option('--tornado-smooth')) OUTLOOK_TUNING.tornadoSmoothing = Number(option('--tornado-smooth'));
if (option('--cig')) option('--cig').split(',').map(Number).forEach((f, i) => { CIG_CONDITIONAL_FRACTION[i] = f; });

const rows = [], histograms = {};
for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const n = data.width * data.height;
  const dims = { width: data.width, height: data.height, cellSizeKm: data.cellSizeKm, cellSizeMiles: data.cellSizeMiles, forEachCell() {} };
  const toMask = list => { const mask = new Uint8Array(n); for (const i of list) mask[i] = 1; return mask; };
  for (const run of data.runs) {
    const results = run.results.map(m => ({ ...m, windows: m.windows.map(w => ({ ...w, masks: Object.fromEntries(Object.entries(w.masks).map(([f, list]) => [f, toMask(list)])) })) }));
    for (const product of Object.values(buildOutlookProducts(dims, run.request, results))) {
      const exact = data.truth[`${product.validStartHour}-${product.validEndHour}`];
      if (!exact) continue;
      const frame = Object.fromEntries(TRUTH_FIELDS.map(f => [f, toMask(exact[f])]));
      const truth = aggregateTruth([frame], [], data.width, data.height, 25 / data.cellSizeMiles, data.cellSizeMiles);
      rows.push({ seed: data.seed, ...verifyProduct(product, truth, dims, histograms) });
    }
  }
}
console.log(`\n=== Re-verified ${rows.length} products: smoothing ${JSON.stringify(SMOOTHING_KM)} km (tornado x${OUTLOOK_TUNING.tornadoSmoothing}), CIG ${CIG_CONDITIONAL_FRACTION.join('/')}, calibration ${process.env.OUTLOOK_CALIBRATION ?? 'on'} ===`);
summarizeVerification(rows, { print: !args.includes('--quiet') });
if (args.includes('--quiet')) {
  const scores = summarizeVerification(rows, { print: false });
  console.log(Object.entries(scores).map(([day, s]) => `${day}: ` + Object.entries(s).filter(([k]) => k !== 'categorical').map(([h, v]) => `${h} BSS ${v.bss.toFixed(3)} bias ${v.bias?.toFixed(2) ?? '-'}`).join(' | ') + ` | cat exact ${s.categorical?.exact}/${s.categorical?.n} within1 ${s.categorical?.within1}`).join('\n'));
}
if (process.env.OUTLOOK_AUDIT_JSON) fs.writeFileSync(process.env.OUTLOOK_AUDIT_JSON, JSON.stringify({ calibration: process.env.OUTLOOK_CALIBRATION ?? 'on', histograms: mergeHistograms({}, histograms) }));

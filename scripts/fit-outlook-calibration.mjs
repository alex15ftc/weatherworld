// Fits the outlooks' calibration (js/forecast/outlookCalibration.js) from the data that
//   node scripts/outlook-verify.mjs [days] --seeds ... --calibration-data
// prints (its CALIBRATION_DATA line, in a file): for each outlook day and hazard, the raw chance's
// bins with how often the hazard then came within 25 miles. Bins with too few places are merged
// with the next, and the chance that verified is made never to fall as the raw chance rises
// (pooling adjacent bins that would). Prints the table to paste into outlookCalibration.js.
//   node scripts/fit-outlook-calibration.mjs data.txt [--least 400]
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2), file = args.find(a => !a.startsWith('--')), least = Number(args.includes('--least') ? args[args.indexOf('--least') + 1] : 400);
const line = readFileSync(file, 'utf8').split('\n').find(l => l.startsWith('CALIBRATION_DATA '));
if (!line) throw new Error('no CALIBRATION_DATA line in ' + file);
const data = JSON.parse(line.slice('CALIBRATION_DATA '.length)), table = {};
for (const [day, hazards] of Object.entries(data)) for (const [hazard, bins] of Object.entries(hazards)) {
  // Merge thin bins forward; the empty and near-empty bottom bin (no chance at all) is left out.
  const groups = [];
  let acc = { cells: 0, hits: 0, raw: 0 };
  for (const bin of bins) { acc = { cells: acc.cells + bin.cells, hits: acc.hits + bin.hits, raw: acc.raw + bin.raw }; if (acc.cells >= least) { groups.push(acc); acc = { cells: 0, hits: 0, raw: 0 }; } }
  if (acc.cells && groups.length) { const last = groups.at(-1); groups[groups.length - 1] = { cells: last.cells + acc.cells, hits: last.hits + acc.hits, raw: last.raw + acc.raw }; }
  // Pool adjacent violators: the verified chance never falls as the raw chance rises.
  const pooled = [];
  for (const g of groups) { pooled.push({ ...g }); while (pooled.length > 1 && pooled.at(-1).hits / pooled.at(-1).cells < pooled.at(-2).hits / pooled.at(-2).cells) { const b = pooled.pop(), a = pooled.pop(); pooled.push({ cells: a.cells + b.cells, hits: a.hits + b.hits, raw: a.raw + b.raw }); } }
  (table[day] ??= {})[hazard] = pooled.filter(g => g.raw / g.cells >= 0.5).map(g => [Math.round(10 * g.raw / g.cells) / 10, Math.round(1000 * g.hits / g.cells) / 10]);
  console.log(`${day} ${hazard.padEnd(8)} ${pooled.map(g => `${(g.raw / g.cells).toFixed(1)}->${(100 * g.hits / g.cells).toFixed(1)} (${g.cells})`).join('  ')}`);
}
console.log('\nexport const CALIBRATION = Object.freeze(' + JSON.stringify(table) + ');');

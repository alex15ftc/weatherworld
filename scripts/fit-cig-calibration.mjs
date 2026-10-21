// Fits the intensity groups' calibration (CIG_SHARE in js/forecast/outlookCalibration.js) from the
// data that
//   node scripts/outlook-verify.mjs [days] --seeds ... --cig-data
// prints (its CIG_DATA line, in a file): for each outlook day, hazard and group, contour areas
// binned by the share of the runs whose own reports there reach the group (eighths), with how many
// of them then verified the group or more (judged on the area's reports, where the hazard came).
// Thin bins are merged with the next; the verified share is made never to fall as the run share
// rises (pooling adjacent bins that would); and the group is drawn from the lowest run share at
// which it verified at least --target of the time (0.5: more often than not). A group that never
// does gets a share above 1: never drawn on the runs' word alone. A group with fewer than --thin
// areas in all keeps the agreement it needed before (OUTLOOK.groupAgreement, rising from the first
// group to the last): too few to say either way. A higher group never asks less of the runs than
// the one below it (a group is part of every lower one).
//   node scripts/fit-cig-calibration.mjs data.txt [--least 12] [--target 0.5] [--thin 40]
import { readFileSync } from 'node:fs';
import { OUTLOOK } from '../js/forecast/DayOneOutlook.js';

const args = process.argv.slice(2), file = args.find(a => !a.startsWith('--'));
const opt = (name, value) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : value);
const least = opt('--least', 12), target = opt('--target', 0.5), thin = opt('--thin', 40);
const line = readFileSync(file, 'utf8').split('\n').find(l => l.startsWith('CIG_DATA '));
if (!line) throw new Error('no CIG_DATA line in ' + file);
const data = JSON.parse(line.slice('CIG_DATA '.length)), table = {};
for (const [day, hazards] of Object.entries(data)) for (const [hazard, groups] of Object.entries(hazards)) {
  table[day] ??= {};
  table[day][hazard] = groups.map((bins, g) => {
    // Bins from share 1/8 up (share 0 never draws a group); thin ones merged into the next.
    const merged = [];
    let acc = { from: 1, areas: 0, hits: 0 };
    for (let k = 1; k < bins.length; k++) {
      acc = { from: acc.areas ? acc.from : k, areas: acc.areas + bins[k].areas, hits: acc.hits + bins[k].hits };
      if (acc.areas >= least) { merged.push(acc); acc = { from: k + 1, areas: 0, hits: 0 }; }
    }
    if (acc.areas && merged.length) { const last = merged.at(-1); merged[merged.length - 1] = { from: last.from, areas: last.areas + acc.areas, hits: last.hits + acc.hits }; }
    else if (acc.areas) merged.push(acc);
    const pooled = [];
    for (const m of merged) { pooled.push({ ...m }); while (pooled.length > 1 && pooled.at(-1).hits / pooled.at(-1).areas < pooled.at(-2).hits / pooled.at(-2).areas) { const b = pooled.pop(), a = pooled.pop(); pooled.push({ from: a.from, areas: a.areas + b.areas, hits: a.hits + b.hits }); } }
    const found = pooled.find(p => p.hits / p.areas >= target), total = pooled.reduce((a, p) => a + p.areas, 0);
    const [lo, hi] = OUTLOOK.groupAgreement, before = Math.round(1000 * (lo + (hi - lo) * g / Math.max(1, groups.length - 1))) / 1000;
    if (total < thin) { console.log(`${day} ${hazard.padEnd(7)} CIG${g + 1}: ${total} areas: too few, ${before} of the runs as before`); return before; }
    console.log(`${day} ${hazard.padEnd(7)} CIG${g + 1}: ${pooled.map(p => `${p.from}/8+ ${(100 * p.hits / p.areas).toFixed(0)}% (${p.areas})`).join('  ') || 'no areas'} -> ${found ? `draw from ${found.from}/8 of the runs` : 'never'}`);
    return found ? Math.round(1000 * found.from / 8) / 1000 : 1.01;
  });
  table[day][hazard] = table[day][hazard].map((share, g, all) => Math.max(share, ...all.slice(0, g)));
}
console.log('\nexport const CIG_SHARE = Object.freeze(' + JSON.stringify(table) + ');');

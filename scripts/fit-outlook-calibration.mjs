// Fits js/forecast/outlookCalibrationTable.js from an outlook audit run with calibration off:
//   OUTLOOK_CALIBRATION=off OUTLOOK_AUDIT_JSON=raw.json node scripts/outlook-audit.mjs 72 <seeds>
//   node scripts/fit-outlook-calibration.mjs raw.json
// For each day and hazard the observed frequency of the hazard within 25 mi is regressed on the
// raw smoothed member frequency (isotonic: pool-adjacent-violators over histogram bins), giving
// a monotone piecewise-linear map applied before the SPC levels are drawn.
import fs from 'node:fs';

const TABLE_PATH = 'js/forecast/outlookCalibrationTable.js';
const MIN_CELLS = 150;   // cells per pooled point
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (input.calibration !== 'off') console.warn('warning: fit from a run with OUTLOOK_CALIBRATION=off');

const table = {};
for (const [day, byHazard] of Object.entries(input.histograms)) {
  for (const [hazard, h] of Object.entries(byHazard)) {
    if (hazard === 'thunder') continue;
    // Bins (skipping empty), merged until each holds MIN_CELLS.
    let blocks = [];
    for (let b = 0; b < h.cells.length; b++) {
      if (!h.cells[b]) continue;
      const last = blocks.at(-1);
      if (last && last.cells < MIN_CELLS) { last.cells += h.cells[b]; last.hits += h.hits[b]; last.raw += h.sumRaw[b]; }
      else blocks.push({ cells: h.cells[b], hits: h.hits[b], raw: h.sumRaw[b] });
    }
    // Pool adjacent violators.
    for (let changed = true; changed;) {
      changed = false;
      for (let i = 1; i < blocks.length; i++) {
        if (blocks[i].hits / blocks[i].cells < blocks[i - 1].hits / blocks[i - 1].cells) {
          const a = blocks[i - 1], b = blocks[i];
          blocks.splice(i - 1, 2, { cells: a.cells + b.cells, hits: a.hits + b.hits, raw: a.raw + b.raw });
          changed = true; break;
        }
      }
    }
    const points = blocks.map(b => [round(b.raw / b.cells), round(b.hits / b.cells)]);
    // Anchor at zero; extend the last point to raw = 1 so the map is defined everywhere.
    if (points[0]?.[0] > 0) points.unshift([0, 0]);
    if (points.at(-1)?.[0] < 1) points.push([1, points.at(-1)[1]]);
    (table[day] ??= {})[hazard] = points;
    console.log(`${day} ${hazard.padEnd(7)} ${points.map(([x, y]) => `${(100 * x).toFixed(0)}→${(100 * y).toFixed(0)}`).join(' ')}`);
  }
}
fs.writeFileSync(TABLE_PATH, `// Fitted by scripts/fit-outlook-calibration.mjs from outlook audit runs (raw smoothed ensemble
// frequency -> observed frequency of the hazard within 25 mi). Do not hand-edit.
export const OUTLOOK_CALIBRATION = ${JSON.stringify(table)};
`);
console.log(`wrote ${TABLE_PATH}`);
function round(v) { return Math.round(v * 1000) / 1000; }

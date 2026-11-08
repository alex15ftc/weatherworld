// Fits the category cutoffs (OUTLOOK.categoryCutoffs, DayOneOutlook.js): for each day and hazard, the chance each contour
// level needs before it counts for the category, as the level times one factor per hazard, so that the forecast days'
// highest categories come as often as the verified ones did (2026-11-06, for the user's question on I3, method 'nmep').
// The chances and contours shown are not changed; only the category read from them.
//   node scripts/outlook-verify.mjs ... --from <archive> --category-data > data.txt   (with OUTLOOK_ENSEMBLE / OUTLOOK_CALIBRATION as wanted)
//   node scripts/fit-category-cutoffs.mjs data.txt [--days day1,day2]
// Prints, for each day, the factors chosen, the mix of categories before and after against the verified mix, and a
// CATEGORY_CUTOFFS line (JSON) for OUTLOOK_CUTOFFS or OUTLOOK.categoryCutoffs.
// The score minimised: the summed difference between the forecast and verified mix of the day's highest category, plus
// half the share of days forecast wrong (so that, of the factors that match the mix about as well, those that also put
// the right day at the right category win).
import fs from 'node:fs';
import { PROBABILITY_LEVELS, worldCategoryFromHazard } from '../js/forecast/worldRiskCategories.js';

const args = process.argv.slice(2), flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const ORDER = ['NONE', 'TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'];
const line = fs.readFileSync(args[0], 'utf8').split('\n').find(l => l.startsWith('CATEGORY_DATA '));
if (!line) { console.error('no CATEGORY_DATA line (outlook-verify.mjs --category-data)'); process.exit(1); }
const rows = JSON.parse(line.slice('CATEGORY_DATA '.length));
const days = (flag('--days') ?? 'day1,day2').split(',');
const FACTORS = Array.from({ length: 45 }, (_, k) => +(0.8 + 0.05 * k).toFixed(2));   // 0.8 to 3.0
const tableFor = (hazard, factor) => Object.fromEntries(PROBABILITY_LEVELS[hazard].map(level => [level, +(level * factor).toFixed(1)]));
const levelFor = (hazard, percent, factor) => { let at = 0; for (const level of PROBABILITY_LEVELS[hazard]) if (percent >= level * factor - 1e-9) at = level; return at; };
// A hazard's highest category on one outlook, with one factor.
const hazardTop = (row, hazard, factor) => row.max[hazard].reduce((best, percent, w) => Math.max(best, ORDER.indexOf(worldCategoryFromHazard(hazard, levelFor(hazard, percent, factor), w) ?? 'NONE')), 0);
const summary = (forecast, verified) => {
  const n = verified.length, mix = list => ORDER.map((_, k) => list.filter(v => v === k).length / n);
  const f = mix(forecast), v = mix(verified);
  return { right: forecast.filter((c, k) => c === verified[k]).length / n, within: forecast.filter((c, k) => Math.abs(c - verified[k]) <= 1).length / n, high: forecast.filter((c, k) => c > verified[k]).length / n, low: forecast.filter((c, k) => c < verified[k]).length / n, l1: f.reduce((a, s, k) => a + Math.abs(s - v[k]), 0), f, v };
};
const pc = v => `${Math.round(100 * v)}%`;
const show = (label, s) => console.log(`  ${label.padEnd(10)}${ORDER.slice(1).map((c, k) => `${c} ${pc(s.f[k + 1])}`).join(', ')} | right ${pc(s.right)}, within one ${pc(s.within)}, too high ${pc(s.high)}, too low ${pc(s.low)}`);
const out = {};
for (const day of days) {
  const lead = Number(day.slice(3)), list = rows.filter(r => r.lead === lead);
  if (!list.length) continue;
  const hazards = Object.keys(list[0].max), verified = list.map(r => r.verified);
  // Each outlook's highest category for each hazard and factor, then each set of factors.
  const tops = hazards.map(h => FACTORS.map(factor => list.map(r => hazardTop(r, h, factor))));
  const base = list.map(r => (r.thunder ? 1 : 0));
  const forecastWith = picks => list.map((_, k) => Math.max(base[k], ...picks.map((f, h) => tops[h][f][k])));
  let best = null;
  const visit = (picks) => {
    if (picks.length < hazards.length) { for (let f = 0; f < FACTORS.length; f++) visit([...picks, f]); return; }
    const s = summary(forecastWith(picks), verified), score = s.l1 + 0.5 * (1 - s.right);
    // (ties: the smaller change from the levels as they are)
    const change = picks.reduce((a, f) => a + Math.abs(FACTORS[f] - 1), 0);
    if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) < 1e-9 && change < best.change)) best = { score, change, picks, s };
  };
  visit([]);
  const ones = hazards.map(() => FACTORS.indexOf(1));
  console.log(`--- ${day}: ${list.length} outlooks ---`);
  show('verified', { ...summary(verified, verified), f: summary(verified, verified).v });
  show('as now', summary(forecastWith(ones), verified));
  // (the data's own forecast category, with the cutoffs it was scored with; with none, the line above should match it)
  const mismatched = forecastWith(ones).filter((c, k) => c !== list[k].forecast).length;
  if (mismatched) console.log(`  (${mismatched} of ${list.length} outlooks differ from the scored category: cutoffs were on when scoring, or thunder-only edge cases)`);
  show('fitted', best.s);
  console.log(`  factors: ${hazards.map((h, k) => `${h} ${FACTORS[best.picks[k]]}`).join(', ')}`);
  out[day] = Object.fromEntries(hazards.map((h, k) => [h, tableFor(h, FACTORS[best.picks[k]])]));
}
console.log('CATEGORY_CUTOFFS ' + JSON.stringify(out));

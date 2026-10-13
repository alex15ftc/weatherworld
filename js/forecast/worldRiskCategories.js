// Risk categories, as the Storm Prediction Center gives them (as changed in March 2026): the
// chance of each hazard within 25 miles of a point is only ever given at fixed contour
// levels, the expected intensity is given as a conditional intensity group (CIG1 to CIG3;
// hail has two), and the two together give the category through the centre's own tables
// (spcOutlookRules.js). Nothing in the tables is this world's own.
//
//   contour levels   tornado 2, 5, 10, 15, 30, 45, 60%; wind 5, 15, 30, 45, 60, 75, 90%;
//                    hail 5, 15, 30, 45, 60%; all severe weather (Day 3) 5, 15, 30, 45, 60%
//   intensity groups how large a share of the severe weather is significant (tornado EF2+,
//                    wind 75 mph, hail 2 in): the higher the group, the larger the share
//
// What is this world's own is where the bars between the groups stand (CIG_BOUNDS below).
// `node scripts/risk-climate.mjs` prints the mix of days these rules give.
import { PROBABILITY_LEVELS, CATEGORY_TABLES, RISK_ORDER, probabilityLevel } from './spcOutlookRules.js';

export const WORLD_RISK_ORDER = RISK_ORDER;
export const WORLD_HAZARDS = ['tornado', 'wind', 'hail'];
// Kept for the reports that follow each kind of report separately.
export const WORLD_RISK_HAZARDS = ['tornado', 'tornadoSig', 'hail', 'hailSig', 'wind', 'windSig'];
export const WORLD_MAX_CIG = { tornado: 3, wind: 3, hail: 2, severe: 2 };
// Rows: contour level (percent). Columns: no intensity group, CIG1, CIG2, CIG3. null: the
// combination is not used (a high intensity group is not drawn inside a very low chance).
export const WORLD_CATEGORY_TABLES = CATEGORY_TABLES;

// Conditional intensity, as the centre defines it: a group says how large a share of the
// severe weather is significant where it happens. In its 20 years of records about 7% of
// tornadoes are EF2+ where no group is drawn, 20% in CIG1, 30% in CIG2 and about 40% in CIG3
// (spc.noaa.gov/exper/conditional-intensity-information). The bars between groups implied by
// that (about 13%, 25%, 35%) cannot be used here as they are: strong tornadoes are a larger
// share of this world's, and a 30% tornado contour is reached on one day in four, so they
// make one day in five a High risk. These bars are set so that High stays near one day in
// ten (320 days with the wind bars at 0.3 / 0.6 / 0.8: below Slight 7%, Slight 11%, Enhanced
// 44%, Moderate 27%, High 11%; the upper wind bars were then raised a little). The centre gives no figures for wind and hail; theirs are set the same way. The
// upper bars are high because the centre's table makes a 30% tornado contour, or a 60%
// wind contour, with CIG2 a High risk.
// Each entry: the least share of an area's reports that must be significant for CIG1, CIG2, CIG3.
export const CIG_BOUNDS = Object.freeze({ tornado: [0.2, 0.5, 0.65], wind: [0.3, 0.65, 0.85], hail: [0.15, 0.3], severe: [0.3, 0.6] });
// The fields of the verification's chances behind each hazard's tiers; the first is the
// significant tier, which decides the group.
export const CIG_TIERS = Object.freeze({
  tornado: ['tornadoSig', 'tornadoExtreme', 'tornadoViolent'], wind: ['windSig', 'windExtreme', 'windViolent'],
  hail: ['hailSig', 'hailExtreme'], severe: ['severeSig', 'severeExtreme']
});
// The intensity group from an amount of a hazard and the amount of it that is significant.
export function conditionalCig(amount, significant, bounds) {
  if (!(amount > 0)) return 0;
  let group = 0;
  bounds.forEach((bar, k) => { if (significant / amount >= bar) group = k + 1; });
  return group;
}

// The intensity group at every cell of the map: for each contour level, each separate area
// inside it is judged as a whole, and a cell takes the group of the highest contour it is
// inside. `chance` is the hazard's chance (percent) on the cells and draws the contours;
// `amount` is how much of the hazard each cell has (1 where there was a report; for a
// forecast, the share of the runs with one) and `significant` how much of it is significant
// (an array of tiers may be given; the first is used).
export function contourCig(hazard, chance, amount, significant, width, height, bounds = CIG_BOUNDS[hazard]) {
  return contourCigAreas(hazard, chance, amount, significant, width, height, bounds).cig;
}

// The same, with the areas themselves: { cig, areas }. Each area is { level, cells, group,
// parent } (parent: the index of the area of the next contour down that it lies inside, or
// -1), so that whatever draws the groups can follow the contours exactly.
export function contourCigAreas(hazard, chance, amount, significant, width, height, bounds = CIG_BOUNDS[hazard]) {
  const strong = ArrayBuffer.isView(significant) ? significant : significant[0];
  const n = width * height, out = new Uint8Array(n), mark = new Int32Array(n), owner = new Int32Array(n).fill(-1), stack = [], areas = [];
  let pass = 0;
  for (const level of PROBABILITY_LEVELS[hazard]) {
    pass++;
    for (let start = 0; start < n; start++) {
      if (mark[start] === pass || !(chance[start] >= level - 1e-9)) continue;
      // One area: the cells joined edge to edge that are inside this contour.
      const cells = []; let total = 0, reaching = 0;
      stack.push(start); mark[start] = pass;
      while (stack.length) {
        const i = stack.pop(), x = i % width, y = (i - x) / width;
        cells.push(i); total += amount[i]; reaching += strong[i];
        for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) if (j >= 0 && mark[j] !== pass && chance[j] >= level - 1e-9) { mark[j] = pass; stack.push(j); }
      }
      const group = conditionalCig(total, reaching, bounds), parent = owner[start];
      for (const i of cells) { out[i] = group; owner[i] = areas.length; }
      areas.push({ level, cells: Int32Array.from(cells), group, parent });
    }
  }
  return { cig: out, areas };
}

// The highest intensity group that may be drawn inside a contour level.
export function highestCigAt(hazard, level) {
  const row = WORLD_CATEGORY_TABLES[hazard]?.[level];
  if (!row) return 0;
  let highest = 0;
  for (let k = 1; k < row.length; k++) if (row[k]) highest = k;
  return highest;
}

// The intensity group as drawn: the one forecast, held to what its contour level allows.
export function drawnCig(hazard, percent, cig) {
  return Math.max(0, Math.min(Math.round(Number(cig) || 0), highestCigAt(hazard, probabilityLevel(hazard, Number(percent) || 0))));
}

// The category one hazard gives at a point: its chance (percent; read at its contour level)
// and its intensity group. null below the lowest contour.
export function worldCategoryFromHazard(hazard, percent, cig = 0) {
  const level = probabilityLevel(hazard, Number(percent) || 0), row = WORLD_CATEGORY_TABLES[hazard]?.[level];
  if (!row) return null;
  for (let k = drawnCig(hazard, percent, cig); k >= 0; k--) if (row[k]) return row[k];
  return null;
}

// The category at a point from its hazards: { tornado: { percent, cig }, wind, hail }, or
// { severe: { percent, cig } } on Day 3. `thunder` says whether storms are forecast where
// nothing severe is.
export function worldCategory(hazards, { thunder = false } = {}) {
  let best = thunder ? 'TSTM' : 'NONE';
  for (const hazard of Object.keys(hazards)) {
    const category = worldCategoryFromHazard(hazard, hazards[hazard]?.percent, hazards[hazard]?.cig);
    if (category && WORLD_RISK_ORDER.indexOf(category) > WORLD_RISK_ORDER.indexOf(best)) best = category;
  }
  return best;
}

// The hazard that gives a point its category (the first of them that does).
export function leadingHazard(hazards, category) {
  return Object.keys(hazards).find(hazard => worldCategoryFromHazard(hazard, hazards[hazard]?.percent, hazards[hazard]?.cig) === category) ?? null;
}

export const WORLD_RISK_LABELS = Object.freeze({
  NONE: 'No thunderstorms', TSTM: 'Thunderstorms', MRGN: 'Marginal risk', SLGT: 'Slight risk', ENH: 'Enhanced risk', MDT: 'Moderate risk', HIGH: 'High risk'
});
// What each intensity group means, for the legends and the discussion.
export const CIG_MEANING = Object.freeze(Object.fromEntries(Object.entries({ tornado: 'of tornadoes EF2 or stronger', wind: 'of gusts 75 mph or more', hail: 'of hail 2 inches or larger', severe: 'of it significant' })
  .map(([hazard, what]) => [hazard, ['', ...CIG_BOUNDS[hazard].map(bar => `${Math.round(100 * bar)}% or more ${what}`)]])));
export { PROBABILITY_LEVELS, probabilityLevel };

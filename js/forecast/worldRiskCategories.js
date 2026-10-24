// Risk categories, as the Storm Prediction Center gives them (as changed in March 2026): the
// chance of each hazard within 25 miles of a point is only ever given at fixed contour
// levels, the expected intensity is given as a conditional intensity group (CIG1 to CIG3;
// hail has two), and the two together give the category through the centre's own tables
// (spcOutlookRules.js). Nothing in the tables is this world's own.
//
//   contour levels   tornado 2, 5, 10, 15, 30, 45, 60%; wind 5, 15, 30, 45, 60, 75, 90%;
//                    hail 5, 15, 30, 45, 60%; all severe weather (Day 3) 5, 15, 30, 45, 60%
//   intensity groups how strong the severe weather is where it happens, each group judged on
//                    its own tier: tornado EF2+ / EF3+ / EF4+, wind 75 / 85 / 96 mph (the
//                    centre's 65 / 74 / 83 kt), hail 2 / 3.5 in
//
// What is this world's own is where the bars between the groups stand (CIG_BOUNDS below).
// `node scripts/risk-climate.mjs` prints the mix of days these rules give.
import { PROBABILITY_LEVELS, CATEGORY_TABLES, RISK_ORDER, probabilityLevel } from './spcOutlookRules.js';

export const WORLD_RISK_ORDER = RISK_ORDER;
export const WORLD_HAZARDS = ['tornado', 'wind', 'hail'];
// Kept for the reports that follow each kind of report separately.
export const WORLD_RISK_HAZARDS = ['tornado', 'tornadoSig', 'hail', 'hailSig', 'wind', 'windSig'];
// Day 3 (any severe weather) is hatched CIG1 at most.
export const WORLD_MAX_CIG = { tornado: 3, wind: 3, hail: 2, severe: 1 };
// Rows: contour level (percent). Columns: no intensity group, CIG1, CIG2, CIG3. null: the
// combination is not used (a high intensity group is not drawn inside a very low chance).
export const WORLD_CATEGORY_TABLES = CATEGORY_TABLES;

// Conditional intensity, as the centre defines it: a group says how strong the severe weather
// is likely to be where it happens. In its 20 years of records the share of tornadoes EF2+ is
// 7% where no group is drawn, 20% in CIG1, 30% in CIG2 and about 40% in CIG3, and the share
// EF3+ about 1%, 6%, 12% and 19% (spc.noaa.gov/exper/conditional-intensity-information).
// Here each group is judged on its own tier, and needs the groups below it too: CIG1 on the
// share of an area's reports that reach the first tier (EF2+, 75 mph, 2 in), CIG2 on the share
// reaching the second (EF3+, 85 mph, 3.5 in), CIG3 on the third (EF4+, 96 mph).
// The bars were fitted on 120 days of this world (2026-10-14, scripts/cig-climate.mjs) to give
// tornado CIG1+ / CIG2+ / CIG3+ on about 35% / 12% / 4% of days and wind on 30% / 10% / 3%
// (got 35/11/3 and 32/11/3). Hail CIG1 on about 35% (got 37%); hail CIG2 comes on only 2% of
// days whatever its bar, because 3.5 in hail is that rare here. Day mix with them: below
// Slight 11%, Slight 16%, Enhanced 27%, Moderate 32%, High 15%.
// Each entry: the least share of an area's reports reaching the group's tier, for CIG1, CIG2, CIG3.
// Hail CIG1 0.08 to 0.2 on 2026-10-21 (user's decision): 8% was under this world's own share of 1 in
// hail that reaches 2 in (about 14%), so the intense-hail group meant ordinary hail and, with 60% hail,
// made a Moderate on most widespread-hail days. With hail melting the same day: Moderate 38% to 25%.
export const CIG_BOUNDS = Object.freeze({ tornado: [0.14, 0.24, 0.02], wind: [0.42, 0.32, 0.22], hail: [0.2, 0.02], severe: [0.3] });
// (Day 3's one hazard, any severe weather: CIG1 only, on the significant tier. Not fitted: Day 3
// outlooks have so far drawn no group at all.)
// The fields of the verification's chances behind each hazard's tiers, one for each group.
export const CIG_TIERS = Object.freeze({
  tornado: ['tornadoSig', 'tornadoExtreme', 'tornadoViolent'], wind: ['windSig', 'windExtreme', 'windViolent'],
  hail: ['hailSig', 'hailExtreme'], severe: ['severeSig', 'severeExtreme']
});
// The intensity group from an amount of a hazard and the amount of it reaching each tier (an
// array, one for each group; a single number is taken as the first tier only). Each group
// needs the ones below it.
export function conditionalCig(amount, reaching, bounds) {
  if (!(amount > 0)) return 0;
  const tiers = Array.isArray(reaching) ? reaching : [reaching];
  let group = 0;
  for (let k = 0; k < bounds.length && k < tiers.length; k++) { if (tiers[k] / amount >= bounds[k]) group = k + 1; else break; }
  return group;
}

// The intensity group at every cell of the map: for each contour level, each separate area
// inside it is judged as a whole, and a cell takes the group of the highest contour it is
// inside. `chance` is the hazard's chance (percent) on the cells and draws the contours;
// `amount` is how much of the hazard each cell has (1 where there was a report; for a
// forecast, the share of the runs with one) and `significant` how much of it is significant
// (an array of tiers, one for each group; a single grid is taken as the first tier only).
export function contourCig(hazard, chance, amount, significant, width, height, bounds = CIG_BOUNDS[hazard]) {
  return contourCigAreas(hazard, chance, amount, significant, width, height, bounds).cig;
}

// The same, with the areas themselves: { cig, areas }. Each area is { level, cells, group,
// parent } (parent: the index of the area of the next contour down that it lies inside, or
// -1), so that whatever draws the groups can follow the contours exactly.
// runs: for a forecast, each run's own amount and significant grids ([{ amount, significant }]).
// Given them, an area's group is the typical run's: each run that has the hazard in the area is
// judged on its own reports there, and the area takes the lower median of those groups. (Pooled,
// a run with an outbreak outweighs all the others, and the strongest runs set the group: drawn on
// 35% of days against 20% that verified, 2026-10-16.)
// runs: the forecast runs' own amounts and tiers; each area then records shares[g - 1], the share of
// the runs whose own reports there reach group g, and is given the group the median run reaches, or
// with cigShare (calibrated, outlookCalibration.js CIG_SHARE) the highest group whose share reaches
// cigShare[g - 1].
export function contourCigAreas(hazard, chance, amount, significant, width, height, bounds = CIG_BOUNDS[hazard], runs = null, cigShare = null) {
  const tiers = ArrayBuffer.isView(significant) ? [significant] : significant;
  const n = width * height, out = new Uint8Array(n), mark = new Int32Array(n), owner = new Int32Array(n).fill(-1), stack = [], areas = [];
  let pass = 0;
  // Each area is judged on its own ring: its cells that are not inside the next contour up (the
  // core is judged as an area of its own). (2026-10-23: judged on all its cells, an outer area took
  // the core's reports as its own and the hatching spread out to the 2-5% contour wherever the core
  // had it; forecasters hatch the core.)
  const levels = PROBABILITY_LEVELS[hazard];
  for (const [index, level] of levels.entries()) {
    pass++;
    const next = levels[index + 1] ?? Infinity, inRing = i => !(chance[i] >= next - 1e-9);
    for (let start = 0; start < n; start++) {
      if (mark[start] === pass || !(chance[start] >= level - 1e-9)) continue;
      // One area: the cells joined edge to edge that are inside this contour.
      const cells = [], reaching = tiers.map(() => 0); let total = 0;
      stack.push(start); mark[start] = pass;
      while (stack.length) {
        const i = stack.pop(), x = i % width, y = (i - x) / width;
        cells.push(i);
        if (inRing(i)) { total += amount[i]; for (let t = 0; t < tiers.length; t++) reaching[t] += tiers[t][i]; }
        for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) if (j >= 0 && mark[j] !== pass && chance[j] >= level - 1e-9) { mark[j] = pass; stack.push(j); }
      }
      // An area is never given a lower group than the area around it: that one was judged with
      // these cells in it, and the few reports inside a small core are too few to overrule it
      // (it would leave a hole in the hatching where the chance is highest).
      let judged = conditionalCig(total, reaching, bounds);
      if (runs?.length) {
        const groups = [];
        for (const run of runs) {
          const own = ArrayBuffer.isView(run.significant) ? [run.significant] : run.significant, reach = own.map(() => 0);
          let sum = 0;
          for (const i of cells) { if (!inRing(i)) continue; sum += run.amount[i]; for (let t = 0; t < own.length; t++) reach[t] += own[t][i]; }
          if (sum > 0) groups.push(conditionalCig(sum, reach, bounds));
        }
        groups.sort((a, b) => a - b);
        var shares = bounds.map((_, g) => groups.filter(v => v >= g + 1).length / runs.length);
        if (cigShare) { judged = 0; shares.forEach((s, g) => { if (s >= (cigShare[g] ?? Infinity) - 1e-9) judged = g + 1; }); }
        else judged = groups.length ? groups[Math.floor((groups.length - 1) / 2)] : 0;
      }
      const parent = owner[start], group = Math.max(judged, parent >= 0 ? areas[parent].group : 0);
      for (const i of cells) { out[i] = group; owner[i] = areas.length; }
      areas.push({ level, cells: Int32Array.from(cells), group, parent, shares: runs?.length ? shares : null });
      shares = undefined;
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
  return Math.min(highest, WORLD_MAX_CIG[hazard] ?? highest);
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
const TIER_WORDS = { tornado: ['EF2 or stronger tornadoes', 'EF3 or stronger tornadoes', 'EF4 or stronger tornadoes'], wind: ['gusts of 75 mph or more', 'gusts of 85 mph or more', 'gusts of 96 mph or more'], hail: ['hail of 2 inches or more', 'hail of 3.5 inches or more'], severe: ['significant severe weather'] };
export const CIG_MEANING = Object.freeze(Object.fromEntries(Object.entries(TIER_WORDS).map(([hazard, words]) => [hazard, ['', ...words.map(what => `${what} likely where it happens`)]])));
export { PROBABILITY_LEVELS, probabilityLevel };

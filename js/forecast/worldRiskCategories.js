// Risk categories, as the Storm Prediction Center gives them (as changed in March 2026): the
// chance of each hazard within 25 miles of a point is only ever given at fixed contour
// levels, the expected intensity is given as a conditional intensity group (CIG1 to CIG3;
// hail has two), and the two together give the category through the centre's own tables
// (spcOutlookRules.js). Nothing in the tables is this world's own.
//
//   contour levels   tornado 2, 5, 10, 15, 30, 45, 60%; wind 5, 15, 30, 45, 60, 75, 90%;
//                    hail 5, 15, 30, 45, 60%; all severe weather (Day 3) 5, 15, 30, 45, 60%
//   intensity groups tornado: EF2+, EF3+, EF4+; wind: 65 kt (75 mph), 74 kt (85 mph),
//                    83 kt (96 mph); hail: 2 in, 3.5 in
//
// What is this world's own is how an intensity group is decided (CIG_SHARE below): the
// centre's forecasters judge it; here it is read from the reports or the forecast runs.
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

// Conditional intensity: a group is given where at least this share of the severe weather of
// that kind is expected to reach the group's tier (for tornadoes: 30% of them EF2+ is CIG1,
// 30% EF3+ is CIG2, 30% EF4+ is CIG3). One strong report among many weak ones does not make
// a group.
export const CIG_SHARE = 0.3;
// The fields of the verification's chances behind each hazard's tiers.
export const CIG_TIERS = Object.freeze({
  tornado: ['tornadoSig', 'tornadoExtreme', 'tornadoViolent'], wind: ['windSig', 'windExtreme', 'windViolent'],
  hail: ['hailSig', 'hailExtreme'], severe: ['severeSig', 'severeExtreme']
});
// The intensity group at a point from the chance of the hazard there and the chances of its tiers.
export function conditionalCig(chance, tierChances, share = CIG_SHARE) {
  if (!(chance > 0)) return 0;
  let group = 0;
  tierChances.forEach((tier, k) => { if (tier / chance >= share) group = k + 1; });
  return group;
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
export const CIG_MEANING = Object.freeze({
  tornado: ['', 'EF2 or stronger', 'EF3 or stronger', 'EF4 or stronger'],
  wind: ['', '75 mph or more', '85 mph or more', '96 mph or more'],
  hail: ['', '2 inches or larger', '3.5 inches or larger'],
  severe: ['', 'EF2+, 75 mph or 2 inch hail', 'EF3+, 85 mph or 3.5 inch hail']
});
export { PROBABILITY_LEVELS, probabilityLevel };

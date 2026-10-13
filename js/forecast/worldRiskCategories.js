// Risk categories for this world, built the way the Storm Prediction Center builds its own
// (as changed in March 2026): the chance of each hazard within 25 miles of a point is only
// ever given at fixed contour levels, the expected intensity is given as a conditional
// intensity group (CIG1 to CIG3; hail has two), and the two together give the category.
//
//   contour levels   tornado 2, 5, 10, 15, 30, 45, 60%; wind 5, 15, 30, 45, 60, 75, 90%;
//                    hail 5, 15, 30, 45, 60%  (spcOutlookRules.js)
//   intensity groups tornado: EF2+, EF3+, EF4+; wind: 65 kt (75 mph), 74 kt (85 mph),
//                    83 kt (96 mph); hail: 2 in, 3.5 in
//
// The form is the real one; the entries of the tables are this world's own. The real tables
// are tied to the real climate, and this world is made more violent than the real one: by the
// real tables two days in three here would be Moderate or High. These are set so that about
// 5% of days stay below Slight, 30% are Slight, 40% Enhanced, 20% Moderate and 5% High
// (`node scripts/risk-climate.mjs` records what each day reaches and prints the mix the tables
// give; reset the tables when the climate changes).
import { PROBABILITY_LEVELS, probabilityLevel } from './spcOutlookRules.js';

export const WORLD_RISK_ORDER = ['NONE', 'TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'];
export const WORLD_HAZARDS = ['tornado', 'wind', 'hail'];
// Kept for the reports that follow each kind of report separately.
export const WORLD_RISK_HAZARDS = ['tornado', 'tornadoSig', 'hail', 'hailSig', 'wind', 'windSig'];
export const WORLD_MAX_CIG = { tornado: 3, wind: 3, hail: 2 };

// Rows: contour level (percent). Columns: no intensity group, CIG1, CIG2, CIG3. null: the
// combination is not used (a high intensity group is not drawn inside a very low chance).
export const WORLD_CATEGORY_TABLES = Object.freeze({
  tornado: {
    2: ['MRGN', 'MRGN', 'SLGT', null],
    5: ['SLGT', 'SLGT', 'SLGT', null],
    10: ['SLGT', 'SLGT', 'SLGT', 'ENH'],
    15: ['SLGT', 'SLGT', 'ENH', 'ENH'],
    30: ['SLGT', 'ENH', 'ENH', 'MDT'],
    45: ['ENH', 'ENH', 'MDT', 'MDT'],
    60: ['ENH', 'MDT', 'MDT', 'HIGH']
  },
  wind: {
    5: ['MRGN', 'MRGN', 'SLGT', null],
    15: ['SLGT', 'SLGT', 'SLGT', null],
    30: ['SLGT', 'SLGT', 'SLGT', null],
    45: ['SLGT', 'SLGT', 'SLGT', 'ENH'],
    60: ['SLGT', 'SLGT', 'ENH', 'ENH'],
    75: ['SLGT', 'ENH', 'ENH', 'MDT'],
    90: ['SLGT', 'ENH', 'ENH', 'MDT']
  },
  hail: {
    5: ['MRGN', 'MRGN', 'SLGT'],
    15: ['SLGT', 'SLGT', 'SLGT'],
    30: ['SLGT', 'SLGT', 'SLGT'],
    45: ['SLGT', 'SLGT', 'ENH'],
    60: ['SLGT', 'ENH', 'ENH']
  }
});
// Checked on 320 days of eight worlds (2026-10-13, `node scripts/risk-climate.mjs`): below
// Slight 8%, Slight 28%, Enhanced 40%, Moderate 20%, High 5%. A High day here is a 60% tornado
// area with violent (EF4+) tornadoes; wind and hail on their own stop at Moderate and Enhanced.

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

// The category at a point from all three hazards: { tornado: { percent, cig }, wind, hail }.
// `thunder` says whether storms are forecast where nothing severe is.
export function worldCategory(hazards, { thunder = false } = {}) {
  let best = thunder ? 'TSTM' : 'NONE';
  for (const hazard of WORLD_HAZARDS) {
    const category = worldCategoryFromHazard(hazard, hazards[hazard]?.percent, hazards[hazard]?.cig);
    if (category && WORLD_RISK_ORDER.indexOf(category) > WORLD_RISK_ORDER.indexOf(best)) best = category;
  }
  return best;
}

// The hazard that gives a point its category (the first of tornado, wind, hail that does).
export function leadingHazard(hazards, category) {
  return WORLD_HAZARDS.find(hazard => worldCategoryFromHazard(hazard, hazards[hazard]?.percent, hazards[hazard]?.cig) === category) ?? null;
}

export const WORLD_RISK_LABELS = Object.freeze({
  NONE: 'No thunderstorms', TSTM: 'Thunderstorms', MRGN: 'Marginal risk', SLGT: 'Slight risk', ENH: 'Enhanced risk', MDT: 'Moderate risk', HIGH: 'High risk'
});
// What each intensity group means, for the legends and the discussion.
export const CIG_MEANING = Object.freeze({
  tornado: ['', 'EF2 or stronger', 'EF3 or stronger', 'EF4 or stronger'],
  wind: ['', '75 mph or more', '85 mph or more', '96 mph or more'],
  hail: ['', '2 inches or larger', '3.5 inches or larger']
});
export { PROBABILITY_LEVELS, probabilityLevel };

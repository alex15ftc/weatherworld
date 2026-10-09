// Probability calibration for issued outlooks. Each published tier is remapped to the tier
// its observed frequency supports (event within 25 mi during the valid period), using the
// table fitted by scripts/fit-outlook-calibration.mjs from scripts/outlook-audit.mjs runs.
// Set OUTLOOK_CALIBRATION=off (Node) to measure the raw pipeline when refitting.
import { OUTLOOK_CALIBRATION_TABLE } from './outlookCalibrationTable.js';

const LEVELS = { tornado: [0, 2, 5, 10, 15, 30, 45, 60], hail: [0, 5, 15, 30, 45, 60, 75, 90], wind: [0, 5, 15, 30, 45, 60, 75, 90] };

export function outlookCalibrationEnabled() {
  return globalThis.process?.env?.OUTLOOK_CALIBRATION !== 'off';
}

export function calibrateTier(key, hazard, value) {
  const map = OUTLOOK_CALIBRATION_TABLE.tiers?.[key]?.[hazard];
  if (!map || !(value > 0)) return value;
  // Tiers absent from the table (too few samples when fitted) keep the nearest fitted lower tier's mapping.
  if (map[value] != null) return map[value];
  const fitted = Object.keys(map).map(Number).filter(t => t <= value).sort((a, b) => b - a)[0];
  return fitted == null ? value : Math.max(map[fitted], value);
}

// Overall-category calibration: remaps the issued category to the one it verifies at against
// practically-perfect observed risk (fitted separately, from a run with tier calibration on and
// OUTLOOK_CATEGORY_CALIBRATION=off). Monotonic, so category regions stay nested.
export function categoryCalibrationEnabled() {
  return outlookCalibrationEnabled() && globalThis.process?.env?.OUTLOOK_CATEGORY_CALIBRATION !== 'off';
}

export function calibrateCategory(key, risk) {
  return OUTLOOK_CALIBRATION_TABLE.categories?.[key]?.[risk] ?? risk;
}

export function applyOutlookCalibration(grid, key) {
  if (!outlookCalibrationEnabled()) return { applied: false };
  let changed = 0;
  for (const cell of grid) {
    for (const hazard of Object.keys(LEVELS)) {
      const field = `${hazard}Probability`, before = Number(cell[field]) || 0;
      const after = calibrateTier(key, hazard, before);
      if (after !== before) { cell[field] = after; changed++; }
    }
  }
  return { applied: true, version: OUTLOOK_CALIBRATION_TABLE.version, fittedFrom: OUTLOOK_CALIBRATION_TABLE.fittedFrom, cellsChanged: changed };
}

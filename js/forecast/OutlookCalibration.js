// Reliability calibration of the ensemble outlook: maps the smoothed member frequency to the
// observed frequency of the hazard within 25 mi, per day and hazard (piecewise linear,
// monotone; fitted by scripts/fit-outlook-calibration.mjs). OUTLOOK_CALIBRATION=off disables it.
import { OUTLOOK_CALIBRATION } from './outlookCalibrationTable.js';

export function calibrationEnabled() {
  return globalThis.process?.env?.OUTLOOK_CALIBRATION !== 'off';
}

export function calibrateProbability(day, hazard, probability) {
  const p = Math.max(0, Math.min(1, Number(probability) || 0));
  const table = OUTLOOK_CALIBRATION[day]?.[hazard];
  if (!table?.length || !calibrationEnabled()) return p;
  if (p <= table[0][0]) return table[0][1] * (table[0][0] > 0 ? p / table[0][0] : 1);
  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1], [x1, y1] = table[i];
    if (p <= x1) return y0 + (y1 - y0) * (p - x0) / Math.max(1e-9, x1 - x0);
  }
  return table.at(-1)[1];
}

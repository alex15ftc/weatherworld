// SPC convective outlook conventions: probability contour levels (chance of the hazard within
// 25 mi of a point during the valid period), conditional intensity groups (CIG hatching) and
// the matrix that turns probability + CIG into the categorical outlook.

export const RISK_ORDER = ['NONE', 'TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'];
export const HAZARDS = ['tornado', 'hail', 'wind'];
export const PROBABILITY_LEVELS = {
  tornado: [2, 5, 10, 15, 30, 45, 60],
  hail: [5, 15, 30, 45, 60],
  wind: [5, 15, 30, 45, 60, 75, 90],
  severe: [5, 15, 30, 45, 60]   // Day 3 total severe
};
export const GENERAL_THUNDER_LEVEL = 10;
// Highest CIG each hazard can carry.
export const MAX_CIG = { tornado: 3, hail: 2, wind: 3, severe: 2 };

// Rows: probability level; columns: CIG 0..3. null = combination not used operationally.
const CATEGORY_TABLES = {
  tornado: {
    2: ['MRGN', 'MRGN', null, null],
    5: ['SLGT', 'SLGT', null, null],
    10: ['SLGT', 'ENH', 'ENH', 'ENH'],
    15: ['ENH', 'ENH', 'MDT', 'MDT'],
    30: ['ENH', 'MDT', 'HIGH', 'HIGH'],
    45: ['ENH', 'MDT', 'HIGH', 'HIGH'],
    60: ['ENH', 'HIGH', 'HIGH', 'HIGH']
  },
  wind: {
    5: ['MRGN', 'MRGN', 'SLGT', null],
    15: ['SLGT', 'SLGT', 'ENH', null],
    30: ['SLGT', 'ENH', 'ENH', null],
    45: ['ENH', 'ENH', 'MDT', 'HIGH'],
    60: ['ENH', 'MDT', 'HIGH', 'HIGH'],
    75: ['ENH', 'MDT', 'HIGH', 'HIGH'],
    90: ['ENH', 'MDT', 'HIGH', 'HIGH']
  },
  hail: {
    5: ['MRGN', 'MRGN', 'SLGT'],
    15: ['SLGT', 'SLGT', 'ENH'],
    30: ['SLGT', 'ENH', 'ENH'],
    45: ['ENH', 'ENH', 'MDT'],
    60: ['ENH', 'MDT', 'MDT']
  },
  severe: {
    5: ['MRGN', 'MRGN', 'SLGT'],
    15: ['SLGT', 'SLGT', 'ENH'],
    30: ['SLGT', 'ENH', 'ENH'],
    45: ['ENH', 'ENH', 'MDT'],
    60: ['ENH', 'MDT', 'MDT']
  }
};

// Highest contour level a probability (percent) reaches, or 0.
export function probabilityLevel(hazard, percent) {
  let level = 0;
  for (const value of PROBABILITY_LEVELS[hazard]) if (percent >= value - 1e-9) level = value;
  return level;
}

// CIG hatching is only drawn inside sufficiently high probabilities.
export function maximumPublishedCig(hazard, probability) {
  const p = Number(probability) || 0;
  if (p <= 0) return 0;
  if (hazard === 'tornado') return p <= 5 ? 1 : p <= 10 ? 2 : 3;
  if (hazard === 'wind') return p < 45 ? 2 : 3;
  return MAX_CIG[hazard] ?? 0;
}

export function publishedCigForHazard(hazard, probability, rawCig) {
  return Math.max(0, Math.min(Math.round(Number(rawCig) || 0), maximumPublishedCig(hazard, probability)));
}

export function categoryFromHazard(hazard, probability, cig = 0) {
  const row = CATEGORY_TABLES[hazard]?.[probabilityLevel(hazard, Number(probability) || 0)];
  if (!row) return 'TSTM';
  for (let index = Math.min(publishedCigForHazard(hazard, probability, cig), row.length - 1); index >= 0; index--) {
    if (row[index]) return row[index];
  }
  return 'TSTM';
}

export function categoryFromDay3TotalSevere(probability, cig = 0) {
  return categoryFromHazard('severe', probability, cig);
}

export function highestRisk(risks) {
  return risks.reduce((best, risk) => (RISK_ORDER.indexOf(risk) > RISK_ORDER.indexOf(best) ? risk : best), 'NONE');
}

export const RISK_LABELS = {
  NONE: 'No Thunderstorms', TSTM: 'General Thunderstorms', MRGN: 'Marginal Risk', SLGT: 'Slight Risk',
  ENH: 'Enhanced Risk', MDT: 'Moderate Risk', HIGH: 'High Risk'
};

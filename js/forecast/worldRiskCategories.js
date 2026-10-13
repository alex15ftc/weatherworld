// Risk categories for this world. The real categories are tied to the real climate; this world
// is made more violent than the real one, so they are tied to its own: fitted so that about 5%
// of days stay below Slight, 30% are Slight, 40% Enhanced, 20% Moderate and 5% High.
//
// Each number is the chance (percent) of that hazard within 25 miles of a point during the
// day. A place reaches a category when any one hazard meets its threshold. `null` means the
// hazard cannot make that category on its own: hail does not make a High day (as in the real
// outlooks), and 58 mph wind, which is close to certain somewhere on most days here, counts
// beyond Enhanced only through the chance of 75 mph wind.
//
// Fitted by `node scripts/risk-climate.mjs` on 320 days of eight worlds (2026-10-12, with the
// map roaming along the geography). Refit
// whenever the climate changes: `npm run inspect:risk` prints the table to put here.
export const WORLD_RISK_ORDER = ['NONE', 'TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'];
// tornado: any tornado; tornadoSig: one rated EF2 or more; hail: 1 in; hailSig: 2 in;
// wind: 58 mph; windSig: 75 mph.
export const WORLD_RISK_HAZARDS = ['tornado', 'tornadoSig', 'hail', 'hailSig', 'wind', 'windSig'];
const ANY = 0.5;   // any report near enough to give a chance at all
export const WORLD_RISK_THRESHOLDS = Object.freeze({
  MRGN: { tornado: ANY, tornadoSig: ANY, hail: ANY, hailSig: ANY, wind: ANY, windSig: ANY },
  SLGT: { tornado: ANY, tornadoSig: ANY, hail: ANY, hailSig: ANY, wind: 7, windSig: ANY },
  ENH: { tornado: 36, tornadoSig: 7, hail: 70, hailSig: 15, wind: 92, windSig: 49 },
  MDT: { tornado: 66, tornadoSig: 29, hail: 91, hailSig: 43, wind: null, windSig: 90 },
  HIGH: { tornado: 84, tornadoSig: 51, hail: null, hailSig: null, wind: null, windSig: 97 }
});

// The category a set of chances reaches (percent, keyed by hazard). `thunder` says whether
// there are storms at all where nothing severe is expected.
export function worldCategory(chances, { thunder = false } = {}) {
  let best = thunder ? 'TSTM' : 'NONE';
  for (const category of ['MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH']) {
    const limits = WORLD_RISK_THRESHOLDS[category];
    if (WORLD_RISK_HAZARDS.some(hazard => limits[hazard] !== null && (Number(chances[hazard]) || 0) >= limits[hazard])) best = category;
  }
  return best;
}

// The hazard that carries a place to its category (the one furthest past its threshold).
export function leadingHazard(chances, category) {
  const limits = WORLD_RISK_THRESHOLDS[category];
  if (!limits) return null;
  let lead = null, margin = -Infinity;
  for (const hazard of WORLD_RISK_HAZARDS) {
    if (limits[hazard] === null) continue;
    const over = (Number(chances[hazard]) || 0) / limits[hazard];
    if (over >= 1 && over > margin) { margin = over; lead = hazard; }
  }
  return lead;
}

export const WORLD_RISK_LABELS = Object.freeze({
  NONE: 'No thunderstorms', TSTM: 'Thunderstorms', MRGN: 'Marginal risk', SLGT: 'Slight risk', ENH: 'Enhanced risk', MDT: 'Moderate risk', HIGH: 'High risk'
});

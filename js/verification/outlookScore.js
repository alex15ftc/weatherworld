// One issued outlook scored against what then happened, and many such scores pooled (2026-11-14, for the live
// server's own record of its outlooks: server/OutlookScoreboard.js). The scores are those of scripts/outlook-verify.mjs,
// in brief:
//   - the day's highest category, forecast against verified (right, too high, too low), and place by place;
//   - for each hazard, the Brier score of the contour level issued and of the calibrated chance, each as a chance of the
//     hazard within RISK_RADIUS_MILES, and a reliability table by contour level (the share of the places inside each
//     level that then had the hazard near);
//   - for each category from Marginal up, its area's hits, misses and false alarms against the verified area (CSI).
// The truth is truth.js aggregateTruth of the frames from the outlook's start; Day 3's one chance, of any severe
// weather, is verified as outlook-verify.mjs verifies it.
import { practicallyPerfectChance } from './truth.js';
import { WORLD_RISK_ORDER as ORDER, PROBABILITY_LEVELS, probabilityLevel, contourCig, worldCategory } from '../forecast/worldRiskCategories.js';

const LEVELS = Object.fromEntries(Object.entries(PROBABILITY_LEVELS).map(([h, levels]) => [h, [0, ...levels]]));
const CATEGORIES = ORDER.slice(2);   // MRGN .. HIGH

// The verified category at each place and whether each hazard came near, for one outlook's hazards.
export function verification(truth, hazards, { width, height, cellSizeKm }) {
  const n = width * height, any = (...fields) => Uint8Array.from({ length: n }, (_, i) => (fields.some(field => truth[field][i]) ? 1 : 0));
  if (!hazards.includes('severe')) return { verified: truth.worldRisk, near: Object.fromEntries(hazards.map(h => [h, truth[h]])) };
  const exact = any('tornadoExact', 'windExact', 'hailExact'), chance = practicallyPerfectChance(exact, width, height, cellSizeKm);
  const cig = contourCig('severe', chance, exact, [any('tornadoSigExact', 'windSigExact', 'hailSigExact'), any('tornadoExtremeExact', 'windExtremeExact', 'hailExtremeExact')], width, height);
  const verified = Array.from({ length: n }, (_, i) => worldCategory({ severe: { percent: probabilityLevel('severe', chance[i]), cig: cig[i] } }, { thunder: Boolean(truth.storm[i]) }));
  return { verified, near: { severe: any('tornado', 'wind', 'hail') } };
}

// outlook: { day, issuedHourUtc, validFromHourUtc, validToHourUtc, hazards, category (keys or ranks), level: {h}, chance: {h} }.
export function scoreOutlook(outlook, truth, map) {
  const n = map.width * map.height, { verified, near } = verification(truth, outlook.hazards, map);
  const rankOf = c => (typeof c === 'number' ? c : ORDER.indexOf(c));
  let forecast = 0, observed = 0, sameCell = 0, withinOne = 0;
  const categories = CATEGORIES.map(() => ({ hits: 0, misses: 0, falseAlarms: 0 }));
  const hazards = Object.fromEntries(outlook.hazards.map(h => [h, { cells: 0, events: 0, issued: 0, calibrated: 0, levels: LEVELS[h].map(() => ({ cells: 0, hits: 0 })) }]));
  for (let i = 0; i < n; i++) {
    const f = rankOf(outlook.category[i]), t = ORDER.indexOf(verified[i]);
    forecast = Math.max(forecast, f); observed = Math.max(observed, t);
    if (f === t) sameCell++; if (Math.abs(f - t) <= 1) withinOne++;
    CATEGORIES.forEach((_, k) => { const slot = categories[k], a = f >= k + 2, b = t >= k + 2; if (a && b) slot.hits++; else if (b) slot.misses++; else if (a) slot.falseAlarms++; });
    for (const h of outlook.hazards) {
      const s = hazards[h], o = near[h][i] ? 1 : 0, level = outlook.level[h][i];
      s.cells++; s.events += o; s.issued += (level / 100 - o) ** 2; s.calibrated += ((outlook.chance?.[h]?.[i] ?? level) / 100 - o) ** 2;
      const slot = s.levels[Math.max(0, LEVELS[h].indexOf(level))]; slot.cells++; slot.hits += o;
    }
  }
  return {
    day: outlook.day, issuedHourUtc: outlook.issuedHourUtc, validFromHourUtc: outlook.validFromHourUtc, validToHourUtc: outlook.validToHourUtc,
    forecast: ORDER[forecast], verified: ORDER[observed], sameCell: sameCell / n, withinOne: withinOne / n, categories, hazards
  };
}

// The issue an outlook is, for pooling: Day 1 by its hour of issue (06, 13, 1630, 20 and 01Z), Days 2 and 3 as one each.
export function issueOf(score) {
  if (score.day !== 'day1') return score.day;
  const h = ((score.issuedHourUtc % 24) + 24) % 24;
  return `day1 ${String(Math.floor(h)).padStart(2, '0')}${h % 1 ? String(Math.round((h % 1) * 60)).padStart(2, '0') : '00'}Z`;
}

// Many scores pooled by issue: how often the day's highest category was right, too high and too low; Brier skill of
// each hazard against the pooled base rate (the chance of the hazard near a place on any day of the sample); CSI of
// each category's area; and the reliability of each contour level.
export function summarizeScores(scores) {
  const groups = new Map();
  for (const score of scores) { const key = issueOf(score); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(score); }
  const order = key => (key.startsWith('day1') ? 0 : key === 'day2' ? 1 : 2);
  return [...groups.entries()].sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b)).map(([issue, list]) => {
    const share = test => list.filter(test).length / list.length;
    const hazards = {};
    for (const h of Object.keys(list[0].hazards)) {
      const pooled = { cells: 0, events: 0, issued: 0, calibrated: 0, levels: LEVELS[h].map(() => ({ cells: 0, hits: 0 })) };
      for (const s of list) { const x = s.hazards[h]; if (!x) continue; pooled.cells += x.cells; pooled.events += x.events; pooled.issued += x.issued; pooled.calibrated += x.calibrated; x.levels.forEach((slot, k) => { pooled.levels[k].cells += slot.cells; pooled.levels[k].hits += slot.hits; }); }
      const base = pooled.events / Math.max(1, pooled.cells), reference = base * (1 - base) * pooled.cells;
      hazards[h] = {
        baseRate: base, brierSkillIssued: reference > 0 ? 1 - pooled.issued / reference : null, brierSkillCalibrated: reference > 0 ? 1 - pooled.calibrated / reference : null,
        reliability: LEVELS[h].map((level, k) => ({ level, cells: pooled.levels[k].cells, verified: pooled.levels[k].cells ? pooled.levels[k].hits / pooled.levels[k].cells : null }))
      };
    }
    const csi = Object.fromEntries(CATEGORIES.map((c, k) => { let hits = 0, misses = 0, falseAlarms = 0; for (const s of list) { hits += s.categories[k].hits; misses += s.categories[k].misses; falseAlarms += s.categories[k].falseAlarms; } return [c, hits + misses + falseAlarms ? hits / (hits + misses + falseAlarms) : null]; }));
    return {
      issue, outlooks: list.length,
      right: share(s => s.forecast === s.verified), withinOne: share(s => Math.abs(ORDER.indexOf(s.forecast) - ORDER.indexOf(s.verified)) <= 1),
      tooHigh: share(s => ORDER.indexOf(s.forecast) > ORDER.indexOf(s.verified)), tooLow: share(s => ORDER.indexOf(s.forecast) < ORDER.indexOf(s.verified)),
      placesRight: list.reduce((a, s) => a + s.sameCell, 0) / list.length,
      forecastMix: Object.fromEntries(ORDER.map(c => [c, share(s => s.forecast === c)])), verifiedMix: Object.fromEntries(ORDER.map(c => [c, share(s => s.verified === c)])),
      csi, hazards
    };
  });
}

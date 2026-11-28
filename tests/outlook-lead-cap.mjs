// The lead cap (OUTLOOK.leadCaps and the one-step limit, combineOutlook maxCategory) takes a hazard down to the
// highest category within the cap, never below it, and the hatching drawn follows the groups it kept.
// (2026-11-28: a Day 2 with 60% tornado and CIG1 under a Moderate cap lost its group and showed Enhanced, under
// hatching that still showed CIG1.)
import assert from 'node:assert/strict';
import { combineOutlook, outlookShapes } from '../js/forecast/DayOneOutlook.js';
import { WORLD_RISK_ORDER, WORLD_HAZARDS, worldCategoryFromHazard } from '../js/forecast/worldRiskCategories.js';
import { CHANCE_FIELDS } from '../js/verification/truth.js';
import { insideRings } from '../js/forecast/contourShapes.js';

const rank = c => WORLD_RISK_ORDER.indexOf(c);
// The category the drawn contour levels and groups give at a cell (before the categories are tidied).
const drawnCategory = (o, i) => WORLD_HAZARDS.map(h => worldCategoryFromHazard(h, o.level[h][i], o.cig[h][i])).reduce((a, b) => (rank(b) > rank(a) ? b : a), 'NONE');
const width = 30, height = 30, n = width * height, spot = { x: 22, y: 8 };
function member(k) {
  const chance = Object.fromEntries([...CHANCE_FIELDS, 'severe', 'severeSig', 'severeExtreme'].map(f => [f, new Float32Array(n)])), thunder = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(i % width - spot.x, Math.floor(i / width) - spot.y), fall = Math.exp(-(d * d) / 60);
    chance.tornado[i] = 90 * fall; chance.tornadoSig[i] = 50 * fall; chance.tornadoExtreme[i] = 40 * fall; chance.tornadoViolent[i] = 6 * fall;
    chance.hail[i] = 20 * fall; chance.wind[i] = 20 * fall;
    if (d < 14) thunder[i] = 1;
  }
  return { member: k, width, height, cellMiles: 10, chance, thunder, storms: 30, tornadoes: 6, maxHailInches: 1.5, maxGustMph: 60, strongestTornadoMph: 150, byHour: { storms: new Array(24).fill(0), severe: new Array(24).fill(0), tornado: new Array(24).fill(0) },
    environment: { moistShare: 0.6, cape: 3200, capeMedian: 2200, cin: 30, shear: 48, helicity: 220, dewpoint: 66, cloudBaseM: 1000, aloftKt: 55, aloftFromDeg: 240 }, lines: [] };
}
const members = [0, 1, 2, 3].map(member), centre = spot.y * width + spot.x;
const options = { calibration: {}, cigCalibration: null, cigEnvironment: null, caution: {}, categoryCutoffs: null, issuedHourUtc: 36, validToHourUtc: 60, seed: 9 };
const free = combineOutlook(members, options);
assert.equal(free.highest, 'HIGH', 'uncapped, the core is High');

for (const cap of ['MDT', 'ENH', 'SLGT']) {
  const o = combineOutlook(members, { ...options, maxCategory: cap });
  assert.equal(o.highest, cap, `${cap} cap: the core comes down to the cap, not below it`);
  for (let i = 0; i < n; i++) {
    // Never above the cap; never lower than the cap where the uncapped outlook was at least the cap.
    assert.ok(rank(o.category[i]) <= rank(cap), `${cap} cap: cell ${i} above the cap`);
    if (rank(drawnCategory(free, i)) >= rank(cap)) assert.equal(o.category[i], cap, `${cap} cap: cell ${i} fell below the cap (${o.category[i]})`);
    // The category is what the drawn contour levels and groups give.
    const fromDrawn = drawnCategory(o, i);
    assert.ok(rank(o.category[i]) >= rank(fromDrawn) || (rank(fromDrawn) < rank('MRGN')), `${cap} cap: cell ${i} drawn ${fromDrawn} but given ${o.category[i]}`);
  }
}
// Under a Moderate cap the 60% core keeps its group at 45% (45% CIG1 is Moderate) rather than 60% with none (Enhanced).
const mdt = combineOutlook(members, { ...options, maxCategory: 'MDT' });
assert.equal(mdt.level.tornado[centre], 45); assert.equal(mdt.cig.tornado[centre], 1);
// The hatching drawn holds no group the cap took away: CIG2 and CIG3 hatching only where that group is still forecast
// (15% CIG2 is Moderate, so the 15-30% ring keeps its CIG2; the 30%+ core, now CIG1, is a hole in it).
const groups = outlookShapes(mdt).tornado.groups, at = i => [(i % width + 0.5) / width, (Math.floor(i / width) + 0.5) / height];
const hatched = (group, i) => insideRings(groups.find(g => g.group === group)?.rings ?? [], ...at(i));
assert.ok(hatched(1, centre), 'CIG1 hatching kept over the core');
assert.ok(!hatched(2, centre) && !hatched(3, centre), 'no CIG2 or CIG3 hatching over the capped core');
const ring = Array.from({ length: n }, (_, i) => i).find(i => mdt.level.tornado[i] === 15 && mdt.intensity.tornado[i] >= 2 && Math.hypot(i % width - spot.x, Math.floor(i / width) - spot.y) > 1);
if (ring !== undefined) assert.ok(hatched(2, ring), 'CIG2 hatching kept where 15% CIG2 (Moderate) is still forecast');
console.log('outlook lead cap: ok');

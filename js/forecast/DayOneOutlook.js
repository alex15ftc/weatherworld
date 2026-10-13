// The Day 1 convective outlook: where severe weather is expected over the coming day, as
// chances of each hazard, risk categories, hatched areas for significant severe weather, and
// a written discussion.
//
// It is a forecast, not a look at the answer. The world is copied at issue time and run ahead
// several times over (the members). Every member has the same atmosphere to start from, but
// its storms take their chances differently: where exactly each one starts, which of them put
// down a tornado and when. What the members agree on becomes a high chance; what only some of
// them do, a lower one. The day that then happens is one more such draw.
//
// Chances are "within 25 miles of a point", the practically perfect chance the outlook is
// verified against (js/verification/truth.js), averaged over the members. Categories are this
// world's own (worldRiskCategories.js).
import v8 from 'node:v8';
import { AtmosphereWorld } from '../world/AtmosphereWorld.js';
import { captureTruth, aggregateTruth } from '../verification/truth.js';
import { WORLD_RISK_ORDER, WORLD_RISK_HAZARDS, WORLD_RISK_LABELS, worldCategory, leadingHazard } from './worldRiskCategories.js';

export const OUTLOOK = Object.freeze({
  members: 8, stepHours: 0.5, dayStartUtc: 12,
  // Thunderstorms are outlooked where at least this share of the members have a storm within 25 miles.
  thunderShare: 0.1,
  // Hatching: the chance (percent) of the significant form of the hazard (an EF2+ tornado, 2 in
  // hail, 75 mph wind) within 25 miles. One level of hatching from the first, a denser one from the second.
  hatchChance: [10, 30],
  // Chance contours drawn on the hazard maps (percent), as the real outlooks use.
  levels: { tornado: [2, 5, 10, 15, 30, 45, 60], hail: [5, 15, 30, 45, 60], wind: [5, 15, 30, 45, 60] }
});
const SIGNIFICANT = { tornado: 'tornadoSig', hail: 'hailSig', wind: 'windSig' };
const rank = category => WORLD_RISK_ORDER.indexOf(category);
const quantile = (values, q) => { const v = values.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(q * (v.length - 1)))] : 0; };

// Hours from an hour (UTC, any day) to the end of its outlook day (the next 12Z).
export function hoursToDayEnd(hourUtc, dayStartUtc = OUTLOOK.dayStartUtc) {
  const into = (((hourUtc - dayStartUtc) % 24) + 24) % 24;
  return 24 - into;
}

// A saved world from its bytes, ready for one member. Each member needs its own: the arrays
// that come out of v8.deserialize can share memory with the bytes they were read from, and a
// member advances them in place, so a second member read from the same bytes would start
// from wherever the first one left off.
export function stateFromBytes(bytes) { return v8.deserialize(Buffer.from(bytes)); }

// One member: the saved world run ahead with its storms' chances drawn afresh. `state` must
// be this member's own copy (see stateFromBytes).
export function runOutlookMember(state, member, hours) {
  const atmosphere = AtmosphereWorld.restore(state);
  if (!atmosphere) throw new Error('the saved world is from another layout');
  const world = atmosphere.world;
  world.evolution = { ...(world.evolution ?? {}), config: { ...(world.evolution?.config ?? {}), seed: `${state.seed}|outlook|${member}` } };
  const frames = [], seen = new Set(), initiations = [], startHour = world.validHourUtc, before = world.stormEngine?.totalTornadoes ?? 0;
  const byHour = { storms: new Array(24).fill(0), severe: new Array(24).fill(0), tornado: new Array(24).fill(0) };
  const result = { member, maxHailInches: 0, maxGustMph: 0, strongestTornadoMph: 0, environment: null, lines: [] };
  for (let hour = 0; hour < hours - 1e-9; hour += OUTLOOK.stepHours) {
    atmosphere.advance(OUTLOOK.stepHours);
    const known = seen.size, frame = captureTruth(world, frames, seen, initiations), utc = Math.floor(((world.validHourUtc % 24) + 24) % 24);
    byHour.storms[utc] += seen.size - known;
    if (frame.tornadoes) byHour.tornado[utc] += 1;
    let severe = false;
    for (const storm of world.storms) {
      if (!storm.active) continue;
      const hail = storm.currentHailSizeInches ?? 0, gust = storm.surfaceWind?.gustMph ?? 0;
      result.maxHailInches = Math.max(result.maxHailInches, hail); result.maxGustMph = Math.max(result.maxGustMph, gust);
      if (storm.tornado?.onGround) result.strongestTornadoMph = Math.max(result.strongestTornadoMph, storm.tornado.windSpeedMph ?? 0);
      for (const t of storm.tornadoHistory ?? []) if (t.startedHourUtc >= startHour) result.strongestTornadoMph = Math.max(result.strongestTornadoMph, t.peakWindSpeedMph ?? 0);
      if (hail >= 1 || gust >= 58 || storm.tornado?.onGround) severe = true;
    }
    if (severe) byHour.severe[utc] += 1;
    // The air the storms will have: taken in the late afternoon, or at the last step of a short period.
    if ((utc === 22 && !result.environment) || (!result.environment && hour + OUTLOOK.stepHours >= hours - 1e-9)) { result.environment = describeEnvironment(world); result.lines = describeLines(atmosphere); }
  }
  const truth = aggregateTruth(frames, initiations, world.width, world.height, 25 / world.cellSizeMiles, world.cellSizeMiles);
  return {
    ...result, width: world.width, height: world.height, cellMiles: world.cellSizeMiles,
    chance: Object.fromEntries(WORLD_RISK_HAZARDS.map(hazard => [hazard, truth.chance[hazard]])), thunder: truth.storm,
    storms: seen.size, tornadoes: (world.stormEngine?.totalTornadoes ?? 0) - before, byHour
  };
}

function describeEnvironment(world) {
  const cape = [], cin = [], shear = [], helicity = [], dewpoint = [], base = [];
  let u = 0, v = 0, n = 0, moist = 0;
  world.forEachCell(cell => {
    const direction = (cell.levels[500].windDirection ?? 270) * Math.PI / 180, speed = cell.levels[500].windSpeed ?? 0;
    u += -Math.sin(direction) * speed; v += -Math.cos(direction) * speed; n++;
    if (cell.surface.dewpoint < 58) return;
    moist++; dewpoint.push(cell.surface.dewpoint); cape.push(cell.derived.sounding?.mlcape ?? 0); cin.push(Math.abs(cell.derived.sounding?.mlcin ?? 0));
    shear.push(cell.derived.bulkShear ?? 0); helicity.push(cell.derived.srh ?? 0); base.push(cell.derived.lclAgl ?? 0);
  });
  return {
    moistShare: moist / n, cape: quantile(cape, 0.9), capeMedian: quantile(cape, 0.5), cin: quantile(cin, 0.5), shear: quantile(shear, 0.5), helicity: quantile(helicity, 0.9),
    dewpoint: quantile(dewpoint, 0.5), cloudBaseM: quantile(base, 0.5), aloftKt: Math.hypot(u, v) / n, aloftFromDeg: (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360
  };
}

// The fronts, dryline and outflow boundaries on the map, each by where it lies (shares of the map).
function describeLines(atmosphere) {
  const world = atmosphere.world, wide = world.width * world.cellSizeKm, tall = world.height * world.cellSizeKm;
  return (atmosphere.boundaries ?? []).filter(line => line.type !== 'outflow' && (line.pointsKm?.length ?? 0) > 1).map(line => {
    const xs = line.pointsKm.map(p => p.x / wide), ys = line.pointsKm.map(p => p.y / tall);
    return { type: line.type, x: xs.reduce((a, b) => a + b, 0) / xs.length, y: ys.reduce((a, b) => a + b, 0) / ys.length, lengthKm: line.lengthKm ?? 0, northSouth: Math.max(...ys) - Math.min(...ys) > Math.max(...xs) - Math.min(...xs) };
  });
}

// The outlook from its members.
export function combineOutlook(members, { issuedHourUtc, validToHourUtc, seed = null } = {}) {
  if (!members.length) throw new Error('an outlook needs at least one member');
  const { width, height, cellMiles } = members[0], n = width * height, count = members.length;
  const chance = Object.fromEntries(WORLD_RISK_HAZARDS.map(hazard => [hazard, new Float32Array(n)])), thunder = new Float32Array(n);
  for (const m of members) { for (const hazard of WORLD_RISK_HAZARDS) for (let i = 0; i < n; i++) chance[hazard][i] += m.chance[hazard][i] / count; for (let i = 0; i < n; i++) thunder[i] += (m.thunder[i] ? 1 : 0) / count; }
  const category = new Array(n), hatch = { tornado: new Uint8Array(n), hail: new Uint8Array(n), wind: new Uint8Array(n) };
  for (let i = 0; i < n; i++) {
    category[i] = worldCategory(Object.fromEntries(WORLD_RISK_HAZARDS.map(hazard => [hazard, chance[hazard][i]])), { thunder: thunder[i] >= OUTLOOK.thunderShare });
    for (const hazard of Object.keys(hatch)) { const significant = chance[SIGNIFICANT[hazard]][i]; hatch[hazard][i] = significant >= OUTLOOK.hatchChance[1] ? 2 : significant >= OUTLOOK.hatchChance[0] ? 1 : 0; }
  }
  const peakAt = field => { let best = 0; for (let i = 1; i < n; i++) if (field[i] > field[best]) best = i; return { value: field[best], x: (best % width + 0.5) / width, y: (Math.floor(best / width) + 0.5) / height }; };
  const highest = category.reduce((best, c) => (rank(c) > rank(best) ? c : best), 'NONE');
  const areas = Object.fromEntries(WORLD_RISK_ORDER.map(c => [c, category.filter(v => rank(v) >= rank(c)).length / n]));
  const sum = (key) => members.map(m => m[key]);
  const hours = which => { const total = new Array(24).fill(0); for (const m of members) m.byHour[which].forEach((v, h) => { total[h] += v; }); return total; };
  const environment = averageEnvironment(members.map(m => m.environment).filter(Boolean));
  const outlook = {
    day: 'day1', issuedHourUtc, validToHourUtc, seed, members: count, width, height, cellMiles,
    chance, thunder, category, hatch, highest, areas,
    peak: Object.fromEntries(WORLD_RISK_HAZARDS.map(hazard => [hazard, peakAt(chance[hazard])])),
    expected: {
      tornadoes: { low: quantile(sum('tornadoes'), 0.1), middle: quantile(sum('tornadoes'), 0.5), high: quantile(sum('tornadoes'), 0.9) },
      storms: quantile(sum('storms'), 0.5), hailInches: quantile(sum('maxHailInches'), 0.5), gustMph: quantile(sum('maxGustMph'), 0.5), tornadoMph: quantile(sum('strongestTornadoMph'), 0.5),
      membersWithTornado: members.filter(m => m.tornadoes > 0).length
    },
    timing: { storms: hours('storms'), severe: hours('severe'), tornado: hours('tornado') },
    environment, lines: members[0].lines ?? []
  };
  outlook.leading = highest === 'NONE' || highest === 'TSTM' ? null : leadingHazard(Object.fromEntries(WORLD_RISK_HAZARDS.map(hazard => [hazard, outlook.peak[hazard].value])), highest);
  outlook.discussion = writeDiscussion(outlook);
  return outlook;
}

function averageEnvironment(list) {
  if (!list.length) return null;
  const out = {}; for (const key of Object.keys(list[0])) out[key] = list.reduce((a, e) => a + e[key], 0) / list.length;
  return out;
}

// --- The discussion: the outlook in words, from the same numbers the maps show. ---
const COMPASS = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast', 'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest'];
const compass = degrees => COMPASS[Math.round(((degrees % 360) + 360) % 360 / 22.5) % 16];
const PARTS = [['northwestern', 'north-central', 'northeastern'], ['western', 'central', 'eastern'], ['southwestern', 'south-central', 'southeastern']];
const partAt = (x, y) => PARTS[Math.min(2, Math.floor(y * 3))][Math.min(2, Math.floor(x * 3))];
const list = words => (words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);
const clock = hourUtc => `${String(((Math.round(hourUtc) % 24) + 24) % 24).padStart(2, '0')}Z`;
const localTime = hourUtc => { const h = (((Math.round(hourUtc) - 6) % 24) + 24) % 24; return `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`; };

// The parts of the map an area covers (a part counts when at least a third of it is inside).
export function describeArea(inside, width, height) {
  const share = PARTS.map(row => row.map(() => ({ in: 0, all: 0 })));
  for (let i = 0; i < inside.length; i++) { const cell = share[Math.min(2, Math.floor(Math.floor(i / width) * 3 / height))][Math.min(2, Math.floor((i % width) * 3 / width))]; cell.all++; if (inside[i]) cell.in++; }
  const total = inside.reduce((a, v) => a + (v ? 1 : 0), 0);
  if (!total) return null;
  if (total >= 0.8 * inside.length) return 'most of the region';
  const named = []; PARTS.forEach((row, y) => row.forEach((name, x) => { if (share[y][x].in >= share[y][x].all / 3) named.push(name); }));
  if (!named.length) { let cx = 0, cy = 0; for (let i = 0; i < inside.length; i++) if (inside[i]) { cx += (i % width + 0.5) / width; cy += (Math.floor(i / width) + 0.5) / height; } return `a small part of the ${partAt(cx / total, cy / total)} region`; }
  if (named.length >= 7) return 'much of the region';
  return `${list(named)} parts of the region`;
}

// The busiest run of hours in a count by hour, as [first, last] UTC hours, or null.
function busiestHours(byHour, startUtc) {
  const order = Array.from({ length: 24 }, (_, k) => (startUtc + k) % 24), total = byHour.reduce((a, b) => a + b, 0);
  if (!total) return null;
  // The run of hours around the busiest one that are at least a third as busy.
  const peak = Math.max(...byHour), centre = order.findIndex(h => byHour[h] === peak);
  let first = centre, last = centre;
  while (first > 0 && byHour[order[first - 1]] >= 0.35 * peak) first--;
  while (last < 23 && byHour[order[last + 1]] >= 0.35 * peak) last++;
  return { first: order[first], last: order[last], peak: order[centre] };
}

export function writeDiscussion(o) {
  const { width, height } = o, at = c => o.category.map(v => rank(v) >= rank(c)), label = c => WORLD_RISK_LABELS[c].toUpperCase();
  const lines = [], start = OUTLOOK.dayStartUtc;
  const valid = `Valid ${clock(o.issuedHourUtc)} to ${clock(o.validToHourUtc)}`;
  // Headline: the categories from the highest down, each with where it is.
  const headline = [];
  for (const c of ['HIGH', 'MDT', 'ENH', 'SLGT']) { if (rank(o.highest) >= rank(c) && o.areas[c] > 0) headline.push(`...THERE IS ${c === 'ENH' ? 'AN' : 'A'} ${label(c)} OF SEVERE THUNDERSTORMS OVER ${describeArea(at(c), width, height).toUpperCase()}...`); }
  if (!headline.length) headline.push(o.areas.TSTM > 0 ? '...NO SEVERE THUNDERSTORM AREAS FORECAST...' : '...NO THUNDERSTORM AREAS FORECAST...');
  lines.push(`Day 1 Convective Outlook`, valid, '', ...headline, '');

  // Summary.
  const p = hazard => Math.round(o.peak[hazard].value), where = hazard => partAt(o.peak[hazard].x, o.peak[hazard].y);
  const threats = [];
  if (p('tornado') >= 2) threats.push(p('tornadoSig') >= OUTLOOK.hatchChance[0] ? 'tornadoes, some of them strong' : p('tornado') >= 15 ? 'several tornadoes' : 'a few tornadoes');
  if (p('hail') >= 5) threats.push(p('hailSig') >= OUTLOOK.hatchChance[0] ? 'very large hail' : 'large hail');
  if (p('wind') >= 5) threats.push(p('windSig') >= OUTLOOK.hatchChance[0] ? 'destructive winds' : 'damaging winds');
  const severe = rank(o.highest) >= rank('MRGN');
  lines.push('...SUMMARY...');
  if (severe) lines.push(`Severe thunderstorms are expected today over ${describeArea(at('SLGT'), width, height) ?? describeArea(at('MRGN'), width, height)}, with ${list(threats) || 'isolated severe weather'}.${rank(o.highest) >= rank('MDT') ? ` The greatest risk is over ${describeArea(at(o.highest), width, height)}.` : ''}`);
  else lines.push(o.areas.TSTM > 0 ? 'Thunderstorms are expected over part of the region today, but severe weather is not.' : 'No thunderstorms are expected today.');
  lines.push('');

  // Synopsis: the air and the features the storms will work with.
  const e = o.environment;
  if (e) {
    lines.push('...SYNOPSIS...');
    const flow = e.aloftKt >= 55 ? 'A strong' : e.aloftKt >= 35 ? 'A moderate' : 'A weak';
    const moisture = e.moistShare >= 0.75 ? 'Moist air covers most of the region' : e.moistShare >= 0.4 ? `Moist air covers about ${Math.round(e.moistShare * 10) * 10}% of the region` : e.moistShare > 0.05 ? 'Moist air is confined to a small part of the region' : 'The air over the region is dry';
    lines.push(`${flow} ${compass(e.aloftFromDeg)}erly flow of about ${Math.round(e.aloftKt / 5) * 5} kt at 500 mb crosses the region. ${moisture}${e.moistShare > 0.05 ? `, with afternoon dewpoints in the ${Math.floor(e.dewpoint / 10) * 10 === Math.floor((e.dewpoint + 4) / 10) * 10 ? (e.dewpoint % 10 < 5 ? 'lower ' : 'upper ') : ''}${Math.floor(e.dewpoint / 10) * 10}s F` : ''}.`);
    const drawn = [];
    for (const type of ['dryline', 'cold', 'warm', 'stationary']) { const found = o.lines.filter(l => l.type === type).sort((a, b) => b.lengthKm - a.lengthKm)[0]; if (found) drawn.push(`${type === 'dryline' ? 'a dryline' : `a ${type} front`} over the ${partAt(found.x, found.y)} part of the region`); }
    if (drawn.length) lines.push(`By late afternoon the surface analysis is expected to show ${list(drawn)}.`);
    if (e.moistShare > 0.05) {
      const instability = e.cape >= 3500 ? 'extreme' : e.cape >= 2500 ? 'strong' : e.cape >= 1000 ? 'moderate' : 'weak';
      const shear = e.shear >= 50 ? 'strong' : e.shear >= 35 ? 'sufficient' : 'weak';
      const cap = e.cin >= 100 ? 'A strong cap will hold storms back away from the main sources of lift.' : e.cin >= 40 ? 'A cap will limit storms to where the lift is strongest.' : 'There is little cap, so storms should form readily.';
      lines.push(`In the moist air, ${instability} instability (CAPE to ${Math.round(e.cape / 100) * 100} J/kg) and ${shear} deep-layer shear (${Math.round(e.shear / 5) * 5} kt) will ${e.shear >= 35 ? 'support organized storms, including supercells' : 'favour short-lived storms and clusters'}. ${cap}`);
    }
    lines.push('');
  }

  // The threats, each with its numbers.
  if (severe) {
    lines.push(`...${(describeArea(at('SLGT'), width, height) ?? 'the region').toUpperCase()}...`);
    const begin = busiestHours(o.timing.storms, start), tornado = busiestHours(o.timing.tornado, start), worst = busiestHours(o.timing.severe, start);
    if (begin) lines.push(`Storms are expected to develop from about ${clock(begin.first)} (${localTime(begin.first)} local)${worst ? `, with severe weather most likely between ${clock(worst.first)} and ${clock(worst.last + 1)}` : ''}. About ${Math.round(o.expected.storms / 10) * 10 || o.expected.storms} storms are expected through the period.`);
    if (p('tornado') >= 2) {
      const count = o.expected.tornadoes, strength = o.expected.tornadoMph >= 166 ? 'violent (EF4+)' : o.expected.tornadoMph >= 136 ? 'intense (EF3)' : o.expected.tornadoMph >= 111 ? 'strong (EF2)' : null;
      const helicity = e && e.helicity >= 200 ? 'Strong low-level shear' : e && e.helicity >= 100 ? 'Adequate low-level shear' : 'Modest low-level shear';
      lines.push(`TORNADO: the chance of a tornado within 25 miles of a point reaches ${p('tornado')}% over the ${where('tornado')} part of the region${p('tornadoSig') >= OUTLOOK.hatchChance[0] ? `, where the chance of a strong (EF2+) tornado reaches ${p('tornadoSig')}% (hatched)` : ''}. ${e && e.helicity >= 100 && e.cloudBaseM <= 1500 ? `${helicity} and cloud bases near ${Math.round(e.cloudBaseM / 100) * 100} m favour tornadoes with storms that stay on their own.` : e && e.helicity >= 100 ? `${helicity} favours tornadoes, but cloud bases near ${Math.round(e.cloudBaseM / 100) * 100} m will limit them.` : `${helicity} will limit the tornado risk.`} ${count.high > 0 ? `${count.low === count.high ? `About ${count.middle}` : `Between ${count.low} and ${count.high}`} tornadoes are expected (${o.expected.membersWithTornado} of ${o.members} forecast runs have at least one)${strength ? `, the strongest of them ${strength}` : ''}.` : 'Most forecast runs have none.'}${tornado ? ` The tornado risk peaks near ${clock(tornado.peak)}.` : ''}`);
    }
    if (p('hail') >= 5) lines.push(`HAIL: the chance of 1 inch hail within 25 miles reaches ${p('hail')}% over the ${where('hail')} part of the region${p('hailSig') >= OUTLOOK.hatchChance[0] ? `, and of 2 inch hail ${p('hailSig')}% (hatched)` : ''}. The largest stones are expected to be near ${o.expected.hailInches.toFixed(o.expected.hailInches >= 2 ? 1 : 2).replace(/\.?0+$/, '')} inches.`);
    if (p('wind') >= 5) lines.push(`WIND: the chance of 58 mph gusts within 25 miles reaches ${p('wind')}% over the ${where('wind')} part of the region${p('windSig') >= OUTLOOK.hatchChance[0] ? `, and of 75 mph gusts ${p('windSig')}% (hatched)` : ''}. Peak gusts near ${Math.round(o.expected.gustMph / 5) * 5} mph are expected${p('windSig') >= 30 ? ', most likely where storms merge into lines during the evening' : ''}.`);
    const spread = o.expected.tornadoes.high - o.expected.tornadoes.low;
    lines.push('', '...UNCERTAINTY...', spread >= Math.max(6, 1.5 * o.expected.tornadoes.middle) ? `The forecast runs differ widely on the number of tornadoes (${o.expected.tornadoes.low} to ${o.expected.tornadoes.high}), so the higher end of this outlook depends on how many storms stay on their own before merging.` : `The forecast runs agree closely on the character of the day (${o.expected.tornadoes.low} to ${o.expected.tornadoes.high} tornadoes among ${o.members} runs).`);
  }
  return lines.join('\n');
}

// A compact, serializable copy for the pages (plain arrays; chances rounded to a tenth).
export function publicOutlook(o) {
  const round = field => Array.from(field, v => Math.round(v * 10) / 10);
  return {
    day: o.day, status: 'issued', issuedHourUtc: o.issuedHourUtc, validToHourUtc: o.validToHourUtc, seed: o.seed, members: o.members,
    width: o.width, height: o.height, cellMiles: o.cellMiles, highest: o.highest, leading: o.leading, areas: o.areas, peak: o.peak, expected: o.expected,
    category: o.category.map(rank), categories: WORLD_RISK_ORDER, labels: WORLD_RISK_LABELS,
    chance: { tornado: round(o.chance.tornado), hail: round(o.chance.hail), wind: round(o.chance.wind) },
    significant: { tornado: round(o.chance.tornadoSig), hail: round(o.chance.hailSig), wind: round(o.chance.windSig) },
    hatch: { tornado: Array.from(o.hatch.tornado), hail: Array.from(o.hatch.hail), wind: Array.from(o.hatch.wind) },
    thunder: Array.from(o.thunder, v => Math.round(v * 100)), levels: OUTLOOK.levels, hatchChance: OUTLOOK.hatchChance,
    timing: o.timing, environment: o.environment, discussion: o.discussion
  };
}

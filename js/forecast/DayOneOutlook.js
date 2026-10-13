// The convective outlooks for Days 1 to 3, laid out as the Storm Prediction Center lays out its
// own (as changed in March 2026):
//   - the chance of each hazard within 25 miles of a point, given only at fixed contour
//     levels (tornado 2, 5, 10, 15, 30, 45, 60%; wind 5 to 90%; hail 5 to 60%), never as an
//     exact figure; Day 3 gives one chance, of any severe weather (5 to 60%);
//   - conditional intensity groups (CIG1 to CIG3; two for hail), hatched over the chances:
//     how strong the severe weather is expected to be where it happens;
//   - the categorical outlook, from the chance and the intensity group together, through the
//     centre's own tables;
//   - a general thunderstorm area, where the chance of thunderstorms is 10% or more;
//   - a written discussion.
// Day 1 is the outlook day in progress (12Z to 12Z), Day 2 the next, Day 3 the one after.
// Day 1 is updated every 6 hours, Day 2 every 12 and Day 3 every 24 (OUTLOOK.updateHours).
//
// It is a forecast, not a look at the answer. The world is copied at issue time and run ahead
// several times over (the members). Every member has the same atmosphere to start from, but
// its storms take their chances differently: where exactly each one starts, which of them put
// down a tornado and when. What the members agree on becomes a high chance; what only some of
// them do, a lower one. The day that then happens is one more such draw. One run of the
// members serves every day it reaches: each member reports each outlook day separately.
import v8 from 'node:v8';
import { AtmosphereWorld } from '../world/AtmosphereWorld.js';
import { captureTruth, aggregateTruth, practicallyPerfectChance, CHANCE_FIELDS } from '../verification/truth.js';
import { contourRings, softenArea } from './contourShapes.js';
import { timingErrorMs, perturbUpstream } from './ensemblePerturbation.js';
import { WORLD_RISK_ORDER, WORLD_RISK_LABELS, WORLD_HAZARDS, WORLD_MAX_CIG, CIG_MEANING, PROBABILITY_LEVELS, probabilityLevel, worldCategory, worldCategoryFromHazard, drawnCig, contourCig, CIG_TIERS } from './worldRiskCategories.js';

export const OUTLOOK = Object.freeze({
  members: 8, stepHours: 0.5, dayStartUtc: 12,
  // The outlooks, how often each is issued afresh (hours, counted from 12Z), and what each
  // gives a chance of.
  days: ['day1', 'day2', 'day3'],
  updateHours: { day1: 6, day2: 12, day3: 24 },
  // The share of the members that run on as far as each day: all of them for Day 1, half for
  // Day 2, a quarter for Day 3 (8, 4 and 2). The later days are made from fewer runs, which
  // is most of what the outlooks cost.
  memberShare: { day1: 1, day2: 0.5, day3: 0.25 },
  // A day made from fewer runs has its chances spread out to make up for the runs it lacks:
  // each run's weather is taken to stand for what could happen this far around it (km, for a
  // day with half the runs; none with all of them, 1.7 times as far with a quarter).
  spreadKm: 40,
  hazards: { day1: WORLD_HAZARDS, day2: WORLD_HAZARDS, day3: ['severe'] },
  // The general thunderstorm area: this chance (0-1) of a thunderstorm within 25 miles.
  thunderShare: 0.1,
  levels: PROBABILITY_LEVELS
});
const rank = category => WORLD_RISK_ORDER.indexOf(category);
const quantile = (values, q) => { const v = values.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(q * (v.length - 1)))] : 0; };

// How many of `members` runs go into a day's outlook.
export function membersFor(day, members = OUTLOOK.members) { return Math.max(1, Math.round(members * OUTLOOK.memberShare[day])); }

// How far a day's chances are spread out (km): see OUTLOOK.spreadKm.
export function spreadFor(day) { return OUTLOOK.spreadKm * Math.sqrt(1 / OUTLOOK.memberShare[day] - 1); }

// A field on the map smoothed with a Gaussian of the given width (cells); the map edge is not
// treated as empty country.
function spreadOut(field, width, height, sigma) {
  if (!(sigma > 0)) return field;
  const reach = Math.ceil(3 * sigma), kernel = Array.from({ length: 2 * reach + 1 }, (_, k) => Math.exp(-((k - reach) ** 2) / (2 * sigma * sigma)));
  const pass = (from, along, count, lines) => {
    const out = new Float32Array(from.length);
    for (let line = 0; line < lines; line++) for (let k = 0; k < count; k++) {
      let sum = 0, weight = 0;
      for (let d = -reach; d <= reach; d++) { const j = k + d; if (j < 0 || j >= count) continue; sum += kernel[d + reach] * from[along ? line * width + j : j * width + line]; weight += kernel[d + reach]; }
      out[along ? line * width + k : k * width + line] = sum / weight;
    }
    return out;
  };
  return pass(pass(field, true, width, height), false, height, width);
}

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

// One member: the saved world run ahead with its storms' chances drawn afresh, reported one
// outlook day at a time (the first is what is left of the day in progress; a new one starts
// at each 12Z). `state` must be this member's own copy (see stateFromBytes).
export function runOutlookMemberDays(state, member, hours, { timingSpreadMs, upstreamShare } = {}) {
  const atmosphere = AtmosphereWorld.restore(state);
  if (!atmosphere) throw new Error('the saved world is from another layout');
  const world = atmosphere.world, n = world.width * world.height, total = () => world.stormEngine?.totalTornadoes ?? 0;
  world.evolution = { ...(world.evolution ?? {}), config: { ...(world.evolution?.config ?? {}), seed: `${state.seed}|outlook|${member}` } };
  // No radar is drawn from a forecast run, so its storms keep no picture of themselves; and it
  // is not held to the last digit, so its large-scale model may use the fast transforms.
  world.withoutStormPictures = true; atmosphere.model.fastTransforms = true;
  // What the run does not know about the atmosphere (ensemblePerturbation.js): how fast its
  // systems will really travel, and what the weather far upstream is really like.
  const own = `${state.seed}|${world.validHourUtc}|${member}`, regional = atmosphere.regional;
  regional.timingErrorMs = timingErrorMs(own, timingSpreadMs);
  perturbUpstream(atmosphere.model, own, regional.origin.x + regional.nx * regional.dx / 2, upstreamShare);
  const open = () => ({
    frames: [], seen: new Set(), initiations: [], startHour: world.validHourUtc, before: total(),
    byHour: { storms: new Array(24).fill(0), severe: new Array(24).fill(0), tornado: new Array(24).fill(0) },
    result: { member, maxHailInches: 0, maxGustMph: 0, strongestTornadoMph: 0, environment: null, lines: [] }
  });
  const close = day => {
    const truth = aggregateTruth(day.frames, day.initiations, world.width, world.height, 25 / world.cellSizeMiles, world.cellSizeMiles);
    const chance = Object.fromEntries(CHANCE_FIELDS.map(field => [field, truth.chance[field]]));
    // Any severe weather (Day 3's one chance), and its tiers: a report of any of the three kinds.
    // The reports themselves (1 where there was one) go with the chances: the intensity groups are judged from them.
    const reports = Object.fromEntries(CHANCE_FIELDS.map(field => [field, truth[`${field}Exact`]]));
    const any = (name, ...fields) => { reports[name] = Uint8Array.from({ length: n }, (_, i) => (fields.some(field => reports[field][i]) ? 1 : 0)); chance[name] = practicallyPerfectChance(reports[name], world.width, world.height, world.cellSizeKm); };
    any('severe', 'tornado', 'wind', 'hail'); any('severeSig', 'tornadoSig', 'windSig', 'hailSig'); any('severeExtreme', 'tornadoExtreme', 'windExtreme', 'hailExtreme');
    return {
      ...day.result, width: world.width, height: world.height, cellMiles: world.cellSizeMiles, fromHourUtc: day.startHour, toHourUtc: world.validHourUtc,
      chance, reports, thunder: truth.storm, storms: day.seen.size, tornadoes: total() - day.before, byHour: day.byHour
    };
  };
  const days = [];
  let day = null;
  for (let hour = 0; hour < hours - 1e-9; hour += OUTLOOK.stepHours) {
    day ??= open();
    atmosphere.advance(OUTLOOK.stepHours);
    const { result, byHour, seen } = day, known = seen.size, frame = captureTruth(world, day.frames, seen, day.initiations), utc = Math.floor(((world.validHourUtc % 24) + 24) % 24);
    byHour.storms[utc] += seen.size - known;
    if (frame.tornadoes) byHour.tornado[utc] += 1;
    let severe = false;
    for (const storm of world.storms) {
      if (!storm.active) continue;
      const hail = storm.currentHailSizeInches ?? 0, gust = storm.surfaceWind?.gustMph ?? 0;
      result.maxHailInches = Math.max(result.maxHailInches, hail); result.maxGustMph = Math.max(result.maxGustMph, gust);
      if (storm.tornado?.onGround) result.strongestTornadoMph = Math.max(result.strongestTornadoMph, storm.tornado.windSpeedMph ?? 0);
      for (const t of storm.tornadoHistory ?? []) if (t.startedHourUtc >= day.startHour) result.strongestTornadoMph = Math.max(result.strongestTornadoMph, t.peakWindSpeedMph ?? 0);
      if (hail >= 1 || gust >= 58 || storm.tornado?.onGround) severe = true;
    }
    if (severe) byHour.severe[utc] += 1;
    const last = hour + OUTLOOK.stepHours >= hours - 1e-9, dayEnds = hoursToDayEnd(world.validHourUtc) > 24 - 1e-6;
    // The air the storms will have: taken in the late afternoon, or at the last step of a short day.
    if (!result.environment && (utc === 22 || last || dayEnds)) { result.environment = describeEnvironment(world); result.lines = describeLines(atmosphere); }
    if (last || dayEnds) { days.push(close(day)); day = null; }
  }
  return days;
}

// One member for one outlook day (hours must not run past the next 12Z).
export function runOutlookMember(state, member, hours) { return runOutlookMemberDays(state, member, hours)[0]; }

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

// The outlook for one day from its members' reports of that day.
export function combineOutlook(members, { issuedHourUtc, validFromHourUtc = issuedHourUtc, validToHourUtc, seed = null, day = 'day1' } = {}) {
  if (!members.length) throw new Error('an outlook needs at least one member');
  const { width, height, cellMiles } = members[0], n = width * height, count = members.length, hazards = OUTLOOK.hazards[day];
  const fields = Object.keys(members[0].chance);
  // The members' average chance of each hazard and of each intensity tier (kept unrounded for
  // drawing smooth contours; never shown as a figure).
  const mean = Object.fromEntries(fields.map(field => [field, new Float32Array(n)])), thunder = new Float32Array(n);
  for (const m of members) { for (const field of fields) for (let i = 0; i < n; i++) mean[field][i] += m.chance[field][i] / count; for (let i = 0; i < n; i++) thunder[i] += (m.thunder[i] ? 1 : 0) / count; }
  // Fewer runs, wider chances.
  const sigma = spreadFor(day) / (cellMiles * 1.609344);
  if (sigma > 0) { for (const field of fields) mean[field] = spreadOut(mean[field], width, height, sigma); thunder.set(spreadOut(thunder, width, height, sigma)); }
  const chance = Object.fromEntries(hazards.map(hazard => [hazard, mean[hazard]]));
  // The intensity group wanted at each point (each area inside a contour judged as a whole: the
  // highest tier that a large enough share of its severe weather is expected to reach), before
  // it is held to what the contour level allows.
  // How much of each kind the runs had at each cell: the share of them with a report there
  // (members made without their reports are read from their chances).
  const amount = Object.fromEntries(fields.map(field => [field, new Float32Array(n)])), zero = new Float32Array(n);
  for (const m of members) for (const field of fields) { const from = m.reports?.[field] ?? m.chance[field]; for (let i = 0; i < n; i++) amount[field][i] += from[i] / count; }
  const intensity = Object.fromEntries(hazards.map(hazard => [hazard, contourCig(hazard, chance[hazard], amount[hazard], CIG_TIERS[hazard].map(field => amount[field] ?? zero), width, height)]));
  const level = Object.fromEntries(hazards.map(hazard => [hazard, new Uint8Array(n)])), cig = Object.fromEntries(hazards.map(hazard => [hazard, new Uint8Array(n)])), category = new Array(n);
  for (let i = 0; i < n; i++) {
    const here = {};
    for (const hazard of hazards) {
      const wanted = intensity[hazard][i];
      level[hazard][i] = probabilityLevel(hazard, chance[hazard][i]);
      cig[hazard][i] = drawnCig(hazard, chance[hazard][i], wanted);
      here[hazard] = { percent: chance[hazard][i], cig: wanted };
    }
    category[i] = worldCategory(here, { thunder: thunder[i] >= OUTLOOK.thunderShare });
  }
  const highest = category.reduce((best, c) => (rank(c) > rank(best) ? c : best), 'NONE');
  const areas = Object.fromEntries(WORLD_RISK_ORDER.map(c => [c, category.filter(v => rank(v) >= rank(c)).length / n]));
  const sum = key => members.map(m => m[key]);
  const hours = which => { const total = new Array(24).fill(0); for (const m of members) m.byHour[which].forEach((v, h) => { total[h] += v; }); return total; };
  // The highest contour level and intensity group of each hazard, and where the chance is greatest.
  const top = Object.fromEntries(hazards.map(hazard => {
    let best = 0; for (let i = 1; i < n; i++) if (chance[hazard][i] > chance[hazard][best]) best = i;
    return [hazard, { level: Math.max(...level[hazard]), cig: Math.max(...cig[hazard]), x: (best % width + 0.5) / width, y: (Math.floor(best / width) + 0.5) / height }];
  }));
  const outlook = {
    day, hazards, issuedHourUtc, validFromHourUtc, validToHourUtc, seed, members: count, width, height, cellMiles,
    chance, intensity, level, cig, thunder, category, highest, areas, top,
    expected: {
      // The range of the runs: with only a few of them, the least and the most.
      tornadoes: { low: count < 5 ? Math.min(...sum('tornadoes')) : quantile(sum('tornadoes'), 0.1), middle: quantile(sum('tornadoes'), 0.5), high: count < 5 ? Math.max(...sum('tornadoes')) : quantile(sum('tornadoes'), 0.9) },
      storms: quantile(sum('storms'), 0.5), hailInches: quantile(sum('maxHailInches'), 0.5), gustMph: quantile(sum('maxGustMph'), 0.5), tornadoMph: quantile(sum('strongestTornadoMph'), 0.5),
      membersWithTornado: members.filter(m => m.tornadoes > 0).length
    },
    timing: { storms: hours('storms'), severe: hours('severe'), tornado: hours('tornado') },
    environment: averageEnvironment(members.map(m => m.environment).filter(Boolean)), lines: members[0].lines ?? []
  };
  // The hazard behind the highest category.
  outlook.leading = rank(highest) < rank('MRGN') ? null : hazards.find(hazard => category.some((c, i) => c === highest && worldCategoryFromHazard(hazard, chance[hazard][i], intensity[hazard][i]) === highest)) ?? null;
  outlook.discussion = writeDiscussion(outlook);
  return outlook;
}

function averageEnvironment(list) {
  if (!list.length) return null;
  const out = {}; for (const key of Object.keys(list[0])) out[key] = list.reduce((a, e) => a + e[key], 0) / list.length;
  return out;
}

// --- The discussion: the outlook in words. As in the real ones, it speaks of areas, hazards,
// timing and reasoning; chances appear only as the contour levels on the maps. ---
const COMPASS = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast', 'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest'];
const compass = degrees => COMPASS[Math.round(((degrees % 360) + 360) % 360 / 22.5) % 16];
const PARTS = [['northwestern', 'north-central', 'northeastern'], ['western', 'central', 'eastern'], ['southwestern', 'south-central', 'southeastern']];
const partAt = (x, y) => PARTS[Math.min(2, Math.floor(y * 3))][Math.min(2, Math.floor(x * 3))];
const list = words => (words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);
const clock = hourUtc => `${String(((Math.round(hourUtc) % 24) + 24) % 24).padStart(2, '0')}Z`;
const localTime = hourUtc => { const h = (((Math.round(hourUtc) - 6) % 24) + 24) % 24; return `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`; };
const sentence = text => text[0].toUpperCase() + text.slice(1);

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

// The busiest run of hours in a count by hour, as first, last and peak UTC hours, or null.
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

// How a hazard's maps read, in words: its highest contour gives how much of it, its highest
// intensity group how strong. Each entry is [lowest contour level, words, verb].
const AMOUNT = {
  tornado: [[30, 'numerous tornadoes', 'are'], [15, 'several tornadoes', 'are'], [5, 'a few tornadoes', 'are'], [2, 'a tornado or two', 'is']],
  wind: [[60, 'widespread damaging winds', 'are'], [30, 'scattered damaging winds', 'are'], [5, 'isolated damaging winds', 'are']],
  hail: [[45, 'widespread large hail', 'is'], [15, 'scattered large hail', 'is'], [5, 'isolated large hail', 'is']],
  severe: [[45, 'widespread severe thunderstorms', 'are'], [15, 'scattered severe thunderstorms', 'are'], [5, 'isolated severe thunderstorms', 'are']]
};
const STRENGTH = {
  tornado: ['', ', some of them strong (EF2+)', ', some of them intense (EF3+)', ', including the potential for violent (EF4+) tornadoes'],
  wind: ['', ', some of them significant (75 mph or more)', ', with gusts of 85 mph or more possible', ', with gusts near 100 mph possible'],
  hail: ['', ', some of it very large (2 inches or more)', ', some of it giant (3.5 inches or more)'],
  severe: ['', ', some with significant severe weather (strong tornadoes, 75 mph gusts or 2 inch hail)', ', some with intense severe weather (EF3+ tornadoes, 85 mph gusts or giant hail)']
};
const DAY_NUMBER = { day1: 1, day2: 2, day3: 3 }, WHEN = { day1: 'today', day2: 'tomorrow', day3: 'on Day 3' };
function threat(hazard, top) {
  const found = AMOUNT[hazard].find(([level]) => top.level >= level);
  return found ? { words: `${found[1]}${STRENGTH[hazard][top.cig] ?? ''}`, verb: found[2] } : null;
}

export function writeDiscussion(o) {
  const { width, height } = o, at = c => o.category.map(v => rank(v) >= rank(c)), label = c => WORLD_RISK_LABELS[c].toUpperCase();
  const lines = [], start = OUTLOOK.dayStartUtc, when = WHEN[o.day] ?? 'today', hazards = o.hazards ?? WORLD_HAZARDS;
  // Headline: the categories from the highest down, each with where it is.
  const headline = [];
  for (const c of ['HIGH', 'MDT', 'ENH', 'SLGT']) { if (rank(o.highest) >= rank(c) && o.areas[c] > 0) headline.push(`...THERE IS ${c === 'ENH' ? 'AN' : 'A'} ${label(c)} OF SEVERE THUNDERSTORMS OVER ${describeArea(at(c), width, height).toUpperCase()}...`); }
  if (!headline.length) headline.push(rank(o.highest) >= rank('MRGN') ? `...THERE IS A MARGINAL RISK OF SEVERE THUNDERSTORMS OVER ${describeArea(at('MRGN'), width, height).toUpperCase()}...` : o.areas.TSTM > 0 ? '...NO SEVERE THUNDERSTORM AREAS FORECAST...' : '...NO THUNDERSTORM AREAS FORECAST...');
  lines.push(`Day ${DAY_NUMBER[o.day] ?? 1} Convective Outlook`, `Issued ${clock(o.issuedHourUtc)}. Valid ${clock(o.validFromHourUtc ?? o.issuedHourUtc)} to ${clock(o.validToHourUtc)}`, '', ...headline, '');

  const severe = rank(o.highest) >= rank('MRGN'), threats = hazards.map(hazard => threat(hazard, o.top[hazard])).filter(Boolean);
  const severeArea = describeArea(at('SLGT'), width, height) ?? describeArea(at('MRGN'), width, height);
  lines.push('...SUMMARY...');
  if (severe) lines.push(`Severe thunderstorms are expected ${when} over ${severeArea}. ${threats.length ? `The main hazards: ${threats.map(t => t.words).join('; ')}.` : 'Isolated severe weather is possible.'}${rank(o.highest) >= rank('MDT') ? ` The greatest risk is over ${describeArea(at(o.highest), width, height)}.` : ''}`);
  else lines.push(o.areas.TSTM > 0 ? `Thunderstorms are expected over part of the region ${when}, but severe weather is not.` : `No thunderstorms are expected ${when}.`);
  lines.push('');

  // Synopsis: the air and the features the storms will work with.
  const e = o.environment;
  if (e) {
    lines.push('...SYNOPSIS...');
    const flow = e.aloftKt >= 55 ? 'A strong' : e.aloftKt >= 35 ? 'A moderate' : 'A weak';
    const moisture = e.moistShare >= 0.75 ? 'Moist air covers most of the region' : e.moistShare >= 0.4 ? 'Moist air covers about half of the region' : e.moistShare > 0.05 ? 'Moist air is confined to a small part of the region' : 'The air over the region is dry';
    const tens = Math.floor(e.dewpoint / 10) * 10, dewpoints = `${e.dewpoint - tens < 3.5 ? 'lower ' : e.dewpoint - tens >= 6.5 ? 'upper ' : 'mid '}${tens}s F`;
    lines.push(`${flow} ${compass(e.aloftFromDeg)}erly flow aloft (${Math.round(e.aloftKt / 5) * 5} kt at 500 mb) crosses the region. ${moisture}${e.moistShare > 0.05 ? `, with afternoon dewpoints in the ${dewpoints}` : ''}.`);
    const drawn = [];
    for (const type of ['dryline', 'cold', 'warm', 'stationary']) { const found = o.lines.filter(l => l.type === type).sort((a, b) => b.lengthKm - a.lengthKm)[0]; if (found) drawn.push(`${type === 'dryline' ? 'a dryline' : `a ${type} front`} over the ${partAt(found.x, found.y)} part of the region`); }
    if (drawn.length) lines.push(`By late afternoon the surface analysis is expected to show ${list(drawn)}.`);
    if (e.moistShare > 0.05) {
      const instability = e.cape >= 3500 ? 'extreme' : e.cape >= 2500 ? 'strong' : e.cape >= 1000 ? 'moderate' : 'weak';
      const shear = e.shear >= 50 ? 'strong' : e.shear >= 35 ? 'sufficient' : 'weak';
      const cap = e.cin >= 100 ? 'A strong cap will hold storms back away from the main sources of lift.' : e.cin >= 40 ? 'A cap will limit storms to where the lift is strongest.' : 'There is little cap, so storms should form readily.';
      lines.push(`In the moist air, ${instability} instability (MLCAPE to ${Math.round(e.cape / 500) * 500} J/kg) and ${shear} deep-layer shear (${Math.round(e.shear / 5) * 5} kt) will ${e.shear >= 35 ? 'support organized storms, including supercells' : 'favour short-lived storms and clusters'}. ${cap}`);
    }
    lines.push('');
  }

  if (severe) {
    lines.push(`...${(severeArea ?? 'the region').toUpperCase()}...`);
    const begin = busiestHours(o.timing.storms, start), tornado = busiestHours(o.timing.tornado, start), worst = busiestHours(o.timing.severe, start);
    if (begin) lines.push(`Storms are expected to develop from about ${clock(begin.first)} (${localTime(begin.first)} local)${worst ? `, with severe weather most likely between ${clock(worst.first)} and ${clock(worst.last + 1)}` : ''}.`);
    const where = hazard => partAt(o.top[hazard].x, o.top[hazard].y);
    const area = (hazard, name) => `${o.top[hazard].level}% ${name} area${o.top[hazard].cig ? `, CIG${o.top[hazard].cig}` : ''}`;
    const of = hazard => (o.top[hazard] ? threat(hazard, o.top[hazard]) : null);
    const tor = of('tornado'), hail = of('hail'), wind = of('wind'), all = of('severe');
    if (all) lines.push(`SEVERE: ${sentence(all.words.split(',')[0])} ${all.verb} expected${all.words.includes(',') ? all.words.slice(all.words.indexOf(',')) + ',' : ','} most likely over the ${where('severe')} part of the region (${area('severe', 'severe')}). The hazards will be set out separately as the day comes nearer.`);
    if (tor) {
      const helicity = e && e.helicity >= 200 ? 'Strong low-level shear' : e && e.helicity >= 100 ? 'Adequate low-level shear' : 'Modest low-level shear';
      const reasoning = e && e.helicity >= 100 && e.cloudBaseM <= 1500 ? `${helicity} and low cloud bases favour tornadoes with storms that stay on their own.` : e && e.helicity >= 100 ? `${helicity} favours tornadoes, but high cloud bases will limit them.` : `${helicity} will limit the tornado risk.`;
      lines.push(`TORNADO: ${sentence(tor.words.split(',')[0])} ${tor.verb} expected${tor.words.includes(',') ? tor.words.slice(tor.words.indexOf(',')) + ',' : ','} most likely over the ${where('tornado')} part of the region (${area('tornado', 'tornado')}). ${reasoning}${tornado ? ` The tornado risk peaks near ${clock(tornado.peak)}.` : ''}`);
    }
    if (hail) lines.push(`HAIL: ${sentence(hail.words.split(',')[0])} ${hail.verb} expected${hail.words.includes(',') ? hail.words.slice(hail.words.indexOf(',')) + ',' : ','} most likely over the ${where('hail')} part of the region (${area('hail', 'hail')}).`);
    if (wind) lines.push(`WIND: ${sentence(wind.words.split(',')[0])} ${wind.verb} expected${wind.words.includes(',') ? wind.words.slice(wind.words.indexOf(',')) + ',' : ','} most likely over the ${where('wind')} part of the region (${area('wind', 'wind')})${o.top.wind.cig >= 2 ? ', especially where storms merge into lines during the evening' : ''}.`);
    const spread = o.expected.tornadoes.high - o.expected.tornadoes.low;
    lines.push('', '...UNCERTAINTY...', spread >= Math.max(6, 1.5 * o.expected.tornadoes.middle) ? 'The forecast runs differ widely on how many storms stay on their own before merging, so the higher end of this outlook is less certain than the lower.' : 'The forecast runs agree closely on the character of the day.');
  }
  return lines.join('\n');
}

// The outlook's areas as outlines (see contourShapes.js; points are shares of the map): each
// category, each hazard's contour levels and its intensity groups. An area is everything at or
// above its level, so the areas nest and are drawn from the lowest up.
export function outlookShapes(o) {
  const { width, height } = o, area = inside => contourRings(softenArea(inside, width, height), width, height, 0.5);
  const kept = list => list.filter(entry => entry.rings.length);
  const shapes = { category: kept(WORLD_RISK_ORDER.slice(1).map(key => ({ key, rings: area(o.category.map(c => rank(c) >= rank(key))) }))) };
  for (const hazard of o.hazards) shapes[hazard] = {
    levels: kept(OUTLOOK.levels[hazard].map(level => ({ level, rings: contourRings(o.chance[hazard], width, height, level) }))),
    groups: kept(Array.from({ length: WORLD_MAX_CIG[hazard] }, (_, k) => ({ group: k + 1, rings: area(Array.from(o.cig[hazard], v => v > k)) })))
  };
  return shapes;
}

// A compact, serializable copy for the pages: the areas as outlines, never the chances themselves.
export function publicOutlook(o) {
  return {
    shapes: outlookShapes(o),
    day: o.day, hazards: o.hazards, status: 'issued', issuedHourUtc: o.issuedHourUtc, validFromHourUtc: o.validFromHourUtc, validToHourUtc: o.validToHourUtc, updateHours: OUTLOOK.updateHours[o.day], seed: o.seed, members: o.members,
    width: o.width, height: o.height, cellMiles: o.cellMiles, highest: o.highest, leading: o.leading, areas: o.areas, top: o.top,
    category: o.category.map(rank), categories: WORLD_RISK_ORDER, labels: WORLD_RISK_LABELS,
    cig: Object.fromEntries(o.hazards.map(hazard => [hazard, Array.from(o.cig[hazard])])),
    thunder: Array.from(o.thunder, v => Math.round(v * 100)), thunderLevel: Math.round(100 * OUTLOOK.thunderShare),
    levels: OUTLOOK.levels, maxCig: WORLD_MAX_CIG, cigMeaning: CIG_MEANING,
    timing: o.timing, environment: o.environment, discussion: o.discussion
  };
}

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
// several times over (the members). Each member starts from the same atmosphere with its own
// errors in it (ensemblePerturbation.js): how fast its systems travel, the weather far
// upstream, and over the map the cap, the moisture coming back and the lift that starts storms;
// its storms also take their chances differently. What the members agree on becomes a high
// chance; what only some of them do, a lower one, and a level is drawn only where enough of them
// agree (OUTLOOK.agreement). The day that then happens is one more such draw. One run of the
// members serves every day it reaches: each member reports each outlook day separately.
import v8 from 'node:v8';
import { AtmosphereWorld } from '../world/AtmosphereWorld.js';
import { captureTruth, aggregateTruth, practicallyPerfectChance, CHANCE_FIELDS } from '../verification/truth.js';
import { contourRings, softenArea } from './contourShapes.js';
import { timingErrorMs, perturbUpstream, perturbMesoscale, mesoscaleShare } from './ensemblePerturbation.js';
import { CALIBRATION, CIG_SHARE, calibrateChance } from './outlookCalibration.js';
import { WORLD_RISK_ORDER, WORLD_RISK_LABELS, WORLD_HAZARDS, WORLD_MAX_CIG, CIG_MEANING, PROBABILITY_LEVELS, probabilityLevel, worldCategory, worldCategoryFromHazard, drawnCig, contourCigAreas, highestCigAt, CIG_TIERS } from './worldRiskCategories.js';

export const OUTLOOK = Object.freeze({
  members: 8, stepHours: 0.5, dayStartUtc: 12,
  // The outlooks, how often each is issued afresh (hours, counted from 12Z), and what each
  // gives a chance of.
  days: ['day1', 'day2', 'day3'],
  updateHours: { day1: 6, day2: 12, day3: 24 },
  // When each is issued (hours UTC), as the Storm Prediction Center issues them (2026-10-20; until
  // then every 6, 12 and 24 hours from 12Z): Day 1 at 06, 13, 1630, 20 and 01Z, Day 2 at 06 and
  // 1730Z, Day 3 at 0730 and 1930Z. An outlook issued less than leadHours before 12Z is for the
  // day that starts then (the 06Z Day 1 is for the coming 12Z-12Z day, as the centre's is).
  issueTimesUtc: { day1: [1, 6, 13, 16.5, 20], day2: [6, 17.5], day3: [7.5, 19.5] }, leadHours: 6.5,
  // The most a day this far ahead is given, as the centre keeps its Day 2 and Day 3 (a High on
  // Day 2 has been issued only a handful of times), and how far one issue may raise the category
  // from the last for the same day (one step), until the day is under way (issues from
  // nowcastAfterHours into the day are free: the weather is happening).
  leadCaps: { day2: 'MDT', day3: 'ENH' }, nowcastAfterHours: 4,
  // Continuity: the share of the last issue for the same day that each new one keeps, in the
  // runs' average chances, before the day is under way and after (forecasters weigh their last
  // outlook against new guidance and follow the weather once it is happening). (2026-10-20: each
  // issue stood on its own runs, and a Day 1 went ENH, SLGT, SLGT, ENH, SLGT through one day; the
  // one-step rule above holds only rises.)
  continuity: { before: 0.35, underWay: 0.2 },
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
  // A higher risk only where the runs agree (agenda step 11; the user's rule, 2026-10-16): a
  // contour level is drawn at a place only where this share of the runs had the hazard near it
  // (their own chance there at least the hazard's lowest level), from the lowest level's share
  // to the highest's, in even steps between. Where the runs disagree, the chances that one or
  // two strong runs would raise stay at the lower levels the others allow.
  agreement: [0.125, 0.75],
  // The same for the intensity groups, from the first group to the highest a hazard has: they
  // say how strong the weather will be where it happens, which needs most of the runs behind it.
  groupAgreement: [0.5, 0.75],
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
export function runOutlookMemberDays(state, member, hours, { timingSpreadMs, upstreamShare, mesoscale } = {}) {
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
  // ...and the air over the map: the cap, the moisture coming back, the lift that starts storms.
  // (in pairs: runs 2k and 2k+1 have opposite errors).
  perturbMesoscale(atmosphere, `${state.seed}|${world.validHourUtc}|pair${Math.floor(member / 2)}`, mesoscale ?? mesoscaleShare(world.validHourUtc), undefined, member % 2 ? -1 : 1);
  const open = () => ({
    frames: [], seen: new Set(), initiations: [], startHour: world.validHourUtc, before: total(),
    byHour: { storms: new Array(24).fill(0), severe: new Array(24).fill(0), tornado: new Array(24).fill(0) }, steps: 0, stormy: new Uint8Array(n),
    result: { member, maxHailInches: 0, maxGustMph: 0, strongestTornadoMph: 0, environment: null, lines: [], ongoing: 0 }
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
    // Each hour's counts (2026-10-20; until then whether there was any, which on a busy day put
    // every hour at the top and the outlook's window over the whole day): new storms, severe
    // storms and tornadoes on the ground at each step; and the storms going at the start.
    byHour.tornado[utc] += frame.tornadoes;
    for (let i = 0; i < n; i++) if (frame.storm[i]) day.stormy[i] = 1;
    let severe = 0;
    for (const storm of world.storms) {
      if (!storm.active) continue;
      const hail = storm.currentHailSizeInches ?? 0, gust = storm.surfaceWind?.gustMph ?? 0;
      result.maxHailInches = Math.max(result.maxHailInches, hail); result.maxGustMph = Math.max(result.maxGustMph, gust);
      if (storm.tornado?.onGround) result.strongestTornadoMph = Math.max(result.strongestTornadoMph, storm.tornado.windSpeedMph ?? 0);
      for (const t of storm.tornadoHistory ?? []) if (t.startedHourUtc >= day.startHour) result.strongestTornadoMph = Math.max(result.strongestTornadoMph, t.peakWindSpeedMph ?? 0);
      if (hail >= 1 || gust >= 58 || storm.tornado?.onGround) severe++;
    }
    byHour.severe[utc] += severe;
    if (day.steps++ === 0) result.ongoing = world.storms.filter(storm => storm.active && storm.intensity >= 0.3).length;
    const last = hour + OUTLOOK.stepHours >= hours - 1e-9, dayEnds = hoursToDayEnd(world.validHourUtc) > 24 - 1e-6;
    // The air the storms will have: taken in the late afternoon, or at the last step of a short day.
    if (!result.environment && (utc === 22 || last || dayEnds)) { result.environment = describeEnvironment(world, day.stormy); result.lines = describeLines(atmosphere); }
    if (last || dayEnds) { days.push(close(day)); day = null; }
  }
  return days;
}

// One member for one outlook day (hours must not run past the next 12Z).
export function runOutlookMember(state, member, hours) { return runOutlookMemberDays(state, member, hours)[0]; }

// The air the storms will have: in the late afternoon, in the moist air within reach (2 cells) of
// where this run's storms have been so far (2026-10-20; until then over all the moist air, whose
// median cap said "a strong cap will hold storms back" on days the storms broke it), or all the
// moist air before any storm has formed.
function describeEnvironment(world, stormy = null) {
  const cape = [], cin = [], shear = [], helicity = [], dewpoint = [], base = [];
  let u = 0, v = 0, n = 0, moist = 0;
  const { width, height } = world, near = new Uint8Array(width * height);
  let nearCount = 0;
  if (stormy) for (let i = 0; i < near.length; i++) if (stormy[i]) { const x = i % width, y = Math.floor(i / width); for (let yy = Math.max(0, y - 2); yy <= Math.min(height - 1, y + 2); yy++) for (let xx = Math.max(0, x - 2); xx <= Math.min(width - 1, x + 2); xx++) near[yy * width + xx] = 1; }
  world.forEachCell((cell, x, y) => { if (near[y * width + x] && cell.surface.dewpoint >= 58) nearCount++; });
  const useNear = nearCount >= 20;
  world.forEachCell((cell, x, y) => {
    const direction = (cell.levels[500].windDirection ?? 270) * Math.PI / 180, speed = cell.levels[500].windSpeed ?? 0;
    u += -Math.sin(direction) * speed; v += -Math.cos(direction) * speed; n++;
    if (cell.surface.dewpoint < 58) return;
    moist++;
    if (useNear && !near[y * width + x]) return; dewpoint.push(cell.surface.dewpoint); cape.push(cell.derived.sounding?.mlcape ?? 0); cin.push(Math.abs(cell.derived.sounding?.mlcin ?? 0));
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
// maxCategory: the highest category this issue may give (see OUTLOOK.leadCaps; the runtime adds
// the one-step limit from the last issue). regions: names the map's regions an area covers (the
// counties' place names), or null for compass parts.
export function combineOutlook(members, { issuedHourUtc, validFromHourUtc = issuedHourUtc, validToHourUtc, seed = null, day = 'day1', agreement = OUTLOOK.agreement, groupAgreement = OUTLOOK.groupAgreement, calibration = CALIBRATION, maxCategory = null, regions = null, previous = null, continuity = 0, cigCalibration = CIG_SHARE } = {}) {
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
  // Continuity with the last issue for this day (its blended chances, previous.blend): each field
  // both have keeps that share of the last one.
  if (previous?.blend && continuity > 0 && previous.width === width && previous.height === height) {
    for (const field of fields) { const was = previous.blend.mean[field]; if (was) for (let i = 0; i < n; i++) mean[field][i] = (1 - continuity) * mean[field][i] + continuity * was[i]; }
    if (previous.blend.thunder) for (let i = 0; i < n; i++) thunder[i] = (1 - continuity) * thunder[i] + continuity * previous.blend.thunder[i];
  }
  const blend = { mean: Object.fromEntries(fields.map(field => [field, Float32Array.from(mean[field])])), thunder: Float32Array.from(thunder) };
  // The runs' own chance, kept for calibrating (outlook-verify --calibration-data), and the
  // chance issued: calibrated to the chance that verified (outlookCalibration.js).
  const rawChance = Object.fromEntries(hazards.map(hazard => [hazard, Float32Array.from(mean[hazard])]));
  const chance = Object.fromEntries(hazards.map(hazard => [hazard, rawChance[hazard].map(raw => calibrateChance(day, hazard, raw, calibration))]));
  // A higher level only where enough runs agree (OUTLOOK.agreement): the share of runs with the
  // hazard nearby, spread out as the chances are.
  const agreed = Object.fromEntries(hazards.map(hazard => {
    const levels = PROBABILITY_LEVELS[hazard], [least, most] = agreement;
    let support = new Float32Array(n);
    for (const m of members) for (let i = 0; i < n; i++) if (m.chance[hazard][i] >= levels[0] - 1e-9) support[i] += 1 / count;
    if (sigma > 0) support = spreadOut(support, width, height, sigma);
    let held = 0;
    for (let i = 0; i < n; i++) {
      let allowed = -1;
      for (let r = 0; r < levels.length; r++) if (support[i] >= least + (most - least) * r / Math.max(1, levels.length - 1) - 1e-6) allowed = r;
      const ceiling = allowed + 1 < levels.length ? levels[allowed + 1] - 0.01 : Infinity;
      if (chance[hazard][i] > ceiling) { chance[hazard][i] = ceiling; held++; }
    }
    return [hazard, held / n];
  }));
  // The intensity group wanted at each point (each area inside a contour judged as a whole: the
  // highest tier that a large enough share of its severe weather is expected to reach), before
  // it is held to what the contour level allows.
  // How much of each kind the runs had at each cell: the share of them with a report there
  // (members made without their reports are read from their chances).
  const amount = Object.fromEntries(fields.map(field => [field, new Float32Array(n)])), zero = new Float32Array(n);
  for (const m of members) for (const field of fields) { const from = m.reports?.[field] ?? m.chance[field]; for (let i = 0; i < n; i++) amount[field][i] += from[i] / count; }
  // Each run's own reports, for judging the groups by the typical run (contourCigAreas).
  const own = (m, field) => m.reports?.[field] ?? m.chance[field] ?? zero;
  const judged = Object.fromEntries(hazards.map(hazard => [hazard, contourCigAreas(hazard, chance[hazard], amount[hazard], CIG_TIERS[hazard].map(field => amount[field] ?? zero), width, height, undefined, members.map(m => ({ amount: own(m, hazard), significant: CIG_TIERS[hazard].map(field => own(m, field)) })), cigCalibration?.[day]?.[hazard] ?? null)]));
  const intensity = Object.fromEntries(hazards.map(hazard => [hazard, judged[hazard].cig])), cigAreas = Object.fromEntries(hazards.map(hazard => [hazard, judged[hazard].areas]));
  // The intensity groups raise the category too, so they also need the runs to agree: a group
  // only where enough runs had its tier near (their own chance of it at least the hazard's
  // lowest level), from the first group's share to the highest's (OUTLOOK.groupAgreement).
  // (Without it, with the runs' errors over the map, one or two strong runs drew a group on twice
  // as many days as had one; with a third of the runs for the first group, still 1.75 times.)
  // (Not where the groups are calibrated (CIG_SHARE): the calibrated share is the agreement asked for.)
  for (const hazard of hazards) {
    if (cigCalibration?.[day]?.[hazard]) continue;
    const tiers = CIG_TIERS[hazard], [least, most] = groupAgreement, lowest = PROBABILITY_LEVELS[hazard][0];
    tiers.forEach((field, t) => {
      if (!members[0].chance[field]) return;
      const need = least + (most - least) * t / Math.max(1, tiers.length - 1);
      let support = new Float32Array(n);
      for (const m of members) for (let i = 0; i < n; i++) if (m.chance[field][i] >= lowest - 1e-9) support[i] += 1 / count;
      if (sigma > 0) support = spreadOut(support, width, height, sigma);
      for (let i = 0; i < n; i++) if (support[i] < need - 1e-6 && intensity[hazard][i] > t) intensity[hazard][i] = t;
    });
  }
  // The cap: where a hazard alone would give more than maxCategory, its intensity group and then
  // its chance come down a step at a time until it does not.
  let capped = 0;
  if (maxCategory) for (const hazard of hazards) for (let i = 0; i < n; i++) {
    let guard = 0;
    while (rank(worldCategoryFromHazard(hazard, chance[hazard][i], intensity[hazard][i])) > rank(maxCategory) && guard++ < 20) {
      if (intensity[hazard][i] > 0) intensity[hazard][i]--;
      else { const levels = PROBABILITY_LEVELS[hazard], at = probabilityLevel(hazard, chance[hazard][i]), below = levels.filter(l => l < at).at(-1); chance[hazard][i] = below ? below : 0; }
      capped++;
    }
  }
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
    day, hazards, issuedHourUtc, validFromHourUtc, validToHourUtc, seed, members: count, width, height, cellMiles, agreementHeld: agreed, rawChance, blend, capped: capped > 0, maxCategory,
    chance, intensity, cigAreas, level, cig, thunder, category, highest, areas, top,
    expected: {
      // The range of the runs: with only a few of them, the least and the most.
      tornadoes: { low: count < 5 ? Math.min(...sum('tornadoes')) : quantile(sum('tornadoes'), 0.1), middle: quantile(sum('tornadoes'), 0.5), high: count < 5 ? Math.max(...sum('tornadoes')) : quantile(sum('tornadoes'), 0.9) },
      storms: quantile(sum('storms'), 0.5), hailInches: quantile(sum('maxHailInches'), 0.5), gustMph: quantile(sum('maxGustMph'), 0.5), tornadoMph: quantile(sum('strongestTornadoMph'), 0.5),
      membersWithTornado: members.filter(m => m.tornadoes > 0).length,
      // How much ground each run had severe weather on (cells), for the uncertainty.
      severeCells: (() => { const cells = members.map(m => (m.reports?.severe ?? m.chance.severe ?? []).reduce((a, v) => a + (v > 0 ? 1 : 0), 0)); return { low: Math.min(...cells), middle: quantile(cells, 0.5), high: Math.max(...cells) }; })()
    },
    ongoing: members.reduce((a, m) => a + (m.ongoing ?? 0), 0) / count,
    timing: { storms: hours('storms'), severe: hours('severe'), tornado: hours('tornado') },
    environment: averageEnvironment(members.map(m => m.environment).filter(Boolean)), lines: members[0].lines ?? []
  };
  // The hazard behind the highest category.
  outlook.leading = rank(highest) < rank('MRGN') ? null : hazards.find(hazard => category.some((c, i) => c === highest && worldCategoryFromHazard(hazard, chance[hazard][i], intensity[hazard][i]) === highest)) ?? null;
  // The names of the areas each category covers (the map's own regions where it has them).
  outlook.areaNames = Object.fromEntries(['MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'].map(c => { const inside = category.map(v => rank(v) >= rank(c)); return [c, (regions && inside.some(Boolean) ? regions(inside) : null) ?? describeArea(inside, width, height)]; }));
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
// Local time is the Plains' daylight time in the season of storms, CDT (UTC-5; until 2026-10-20 UTC-6).
const localTime = hourUtc => { const h = (((Math.round(hourUtc) - 5) % 24) + 24) % 24; return `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'} CDT`; };
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

// The hours holding the middle share of a count by hour, from the start of the period: the first
// hour by which lowShare of it has happened and the hour by which highShare has, and the busiest
// hour; null when there is none. (2026-10-20, in place of the run of hours at least a third as busy
// as the busiest, which on a busy day reached across the whole day.)
function spanOf(byHour, startUtc, lowShare = 0.15, highShare = 0.85) {
  return lowShare === 0.15 && highShare === 0.85 ? densestSpan(byHour, startUtc) : spanThrough(byHour, startUtc, lowShare, highShare);
}
// The shortest run of hours in the period holding share of a count by hour (the earliest such run
// when several tie), with its busiest hour; null when there is none. (2026-10-20, for the hours
// severe weather and tornadoes are most likely: the middle 70% from the period's start spanned
// 16-19 hours on days with storms both in the afternoon and at night, "between 16Z and 11Z".)
function densestSpan(byHour, startUtc, share = 0.6) {
  const order = Array.from({ length: 24 }, (_, k) => (startUtc + k) % 24), total = byHour.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let best = null;
  for (let a = 0; a < 24; a++) { let sum = 0; for (let b = a; b < 24; b++) { sum += byHour[order[b]]; if (sum >= share * total - 1e-9) { if (!best || b - a < best.b - best.a) best = { a, b }; break; } } }
  let peak = order[best.a]; for (let k = best.a; k <= best.b; k++) if (byHour[order[k]] > byHour[peak]) peak = order[k];
  return { first: order[best.a], last: order[best.b], peak };
}
function spanThrough(byHour, startUtc, lowShare, highShare) {
  const order = Array.from({ length: 24 }, (_, k) => (startUtc + k) % 24), total = byHour.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let sum = 0, first = null, last = null, peak = order[0];
  for (const h of order) { sum += byHour[h]; if (first === null && sum > lowShare * total) first = h; if (last === null && sum >= highShare * total - 1e-9) last = h; if (byHour[h] > byHour[peak]) peak = h; }
  return { first, last, peak };
}


// How a hazard's maps read, in words: its highest contour gives how much of it, its highest
// intensity group how strong. Each entry is [lowest contour level, words, verb].
const AMOUNT = {
  // (The lowest of each is "possible", as the SPC words a 2% tornado or 5% hail or wind area;
// "expected" until 2026-10-21.)
  tornado: [[30, 'numerous tornadoes', 'are'], [15, 'several tornadoes', 'are'], [5, 'a few tornadoes', 'are'], [2, 'a tornado or two', 'is', 'possible']],
  wind: [[60, 'widespread damaging winds', 'are'], [30, 'scattered damaging winds', 'are'], [5, 'isolated damaging winds', 'are', 'possible']],
  hail: [[45, 'widespread large hail', 'is'], [15, 'scattered large hail', 'is'], [5, 'isolated large hail', 'is', 'possible']],
  severe: [[45, 'widespread severe thunderstorms', 'are'], [15, 'scattered severe thunderstorms', 'are'], [5, 'isolated severe thunderstorms', 'are', 'possible']]
};
const STRENGTH = {
  tornado: ['', ', some of them strong (EF2 or stronger)', ', some of them intense (EF3 or stronger)', ', with violent tornadoes (EF4 or stronger) possible'],
  wind: ['', ', some of them significant (75 mph or more)', ', some of 85 mph or more', ', with gusts near 100 mph possible'],
  hail: ['', ', some of it very large (2 inches or more)', ', some of it giant (3.5 inches or more)'],
  severe: ['', ', some of it significant (strong tornadoes, 75 mph gusts or 2 inch hail)', ', some of it intense (EF3 or stronger tornadoes, 85 mph gusts or 3.5 inch hail)']
};
const DAY_NUMBER = { day1: 1, day2: 2, day3: 3 }, WHEN = { day1: 'today', day2: 'tomorrow', day3: 'on Day 3' };
function threat(hazard, top) {
  const found = AMOUNT[hazard].find(([level]) => top.level >= level);
  return found ? { words: `${found[1]}${STRENGTH[hazard][top.cig] ?? ''}`, verb: `${found[2]} ${found[3] ?? 'expected'}` } : null;
}

// The part of the day an hour (UTC) falls in, in the region's clock time.
const partOfDay = hourUtc => { const h = (((Math.round(hourUtc) - 5) % 24) + 24) % 24; return h >= 6 && h < 12 ? 'during the morning' : h < 17 && h >= 12 ? 'during the afternoon' : h >= 17 && h < 22 ? 'during the evening' : 'overnight'; };

export function writeDiscussion(o) {
  const { width, height } = o, at = c => o.category.map(v => rank(v) >= rank(c)), label = c => WORLD_RISK_LABELS[c].toUpperCase();
  const lines = [], start = OUTLOOK.dayStartUtc, when = WHEN[o.day] ?? 'today', hazards = o.hazards ?? WORLD_HAZARDS;
  // Headline: the categories from the highest down, each with where it is.
  const headline = [];
  const named = c => o.areaNames?.[c] ?? describeArea(at(c), width, height);
  // A lower category is named only where its area reads differently from those above it (2026-10-21:
  // "much of the Big Blue Valley into much of the Smoky Hills" three times over).
  const said = new Set();
  for (const c of ['HIGH', 'MDT', 'ENH', 'SLGT']) { if (rank(o.highest) >= rank(c) && o.areas[c] > 0 && !said.has(named(c))) { said.add(named(c)); headline.push(`...THERE IS ${c === 'ENH' ? 'AN' : 'A'} ${label(c)} OF SEVERE THUNDERSTORMS OVER ${named(c).toUpperCase()}...`); } }
  if (!headline.length) headline.push(rank(o.highest) >= rank('MRGN') ? `...THERE IS A MARGINAL RISK OF SEVERE THUNDERSTORMS OVER ${named('MRGN').toUpperCase()}...` : o.areas.TSTM > 0 ? '...NO SEVERE THUNDERSTORM AREAS FORECAST...' : '...NO THUNDERSTORM AREAS FORECAST...');
  lines.push(`Day ${DAY_NUMBER[o.day] ?? 1} Convective Outlook`, `Issued ${clock(o.issuedHourUtc)}. Valid ${clock(o.validFromHourUtc ?? o.issuedHourUtc)} to ${clock(o.validToHourUtc)}`, '', ...headline, '');

  const severe = rank(o.highest) >= rank('MRGN'), threats = hazards.map(hazard => threat(hazard, o.top[hazard])).filter(Boolean);
  const severeArea = (o.areas.SLGT > 0 ? named('SLGT') : null) ?? named('MRGN');
  lines.push('...SUMMARY...');
  const marginal = o.highest === 'MRGN';
  if (severe) lines.push(`${marginal ? 'Isolated severe thunderstorms are possible' : 'Severe thunderstorms are expected'} ${when} over ${severeArea}. ${threats.length ? `The main hazards: ${threats.map(t => t.words).join('; ')}.` : 'Isolated severe weather is possible.'}${rank(o.highest) >= rank('ENH') ? ` The greatest risk is over ${named(o.highest)}.` : ''}`);
  else lines.push(o.areas.TSTM > 0 ? `Thunderstorms are expected over part of the region ${when}, but severe weather is not.` : `No thunderstorms are expected ${when}.`);
  lines.push('');

  // Synopsis: the air and the features the storms will work with.
  const e = o.environment;
  if (e) {
    lines.push('...SYNOPSIS...');
    const flow = e.aloftKt >= 55 ? 'A strong' : e.aloftKt >= 35 ? 'A moderate' : 'A weak';
    // (The share is of dewpoints of 58 F or more in the late afternoon, said as such.)
    const moisture = e.moistShare >= 0.75 ? 'By late afternoon dewpoints of 58 F or more cover most of the region' : e.moistShare >= 0.4 ? 'By late afternoon dewpoints of 58 F or more cover about half of the region' : e.moistShare > 0.05 ? 'By late afternoon dewpoints of 58 F or more are confined to a small part of the region' : 'The air over the region is dry';
    const tens = Math.floor(e.dewpoint / 10) * 10, dewpoints = `${e.dewpoint - tens < 3.5 ? 'lower ' : e.dewpoint - tens >= 6.5 ? 'upper ' : 'mid '}${tens}s F`;
    lines.push(`${flow} ${compass(e.aloftFromDeg)}erly flow aloft (${Math.round(e.aloftKt / 5) * 5} kt at 500 mb) crosses the region. ${moisture}${e.moistShare > 0.05 ? `, with afternoon dewpoints in the ${dewpoints}` : ''}.`);
    const drawn = [];
    for (const type of ['dryline', 'cold', 'warm', 'stationary']) { const found = o.lines.filter(l => l.type === type).sort((a, b) => b.lengthKm - a.lengthKm)[0]; if (found) drawn.push(`${type === 'dryline' ? 'a dryline' : `a ${type} front`} over the ${partAt(found.x, found.y)} part of the region`); }
    if (drawn.length) lines.push(`By late afternoon the surface analysis is expected to show ${list(drawn)}.`);
    if (e.moistShare > 0.05 && e.cape >= 250) {
      // ("Extreme" from 4,000 J/kg, as forecasters use it; 3,500 until 2026-10-20.)
      const instability = e.cape >= 4000 ? 'extreme' : e.cape >= 2500 ? 'strong' : e.cape >= 1000 ? 'moderate' : 'weak';
      const shear = e.shear >= 50 ? 'strong' : e.shear >= 35 ? 'sufficient' : 'weak';
      // (The cap where the runs' storms are: strong there means they form only where lift breaks it.)
      const cap = !severe ? '' : e.cin >= 100 ? 'A strong cap covers the warm air; storms will form only where fronts, the dryline or outflow lift the air through it.' : e.cin >= 40 ? 'A cap will limit storms to where the lift is strongest.' : 'There is little cap, so storms should form readily.';
      lines.push(`In the moist air, ${instability} instability (MLCAPE to ${Math.round(e.cape / 500) * 500} J/kg) and ${shear} deep-layer shear (${Math.round(e.shear / 5) * 5} kt) will ${e.shear >= 35 ? 'support organized storms, including supercells' : 'favour short-lived storms and clusters'}. ${cap}`);
    }
    lines.push('');
  }

  if (severe) {
    lines.push(`...${(severeArea ?? 'the region').toUpperCase()}...`);
    // Timing from the period's start: new storms (the first tenth of them), and the fewest hours
    // holding 60% of the severe storms, and of the tornadoes.
    const from = Math.round(((o.validFromHourUtc ?? start) % 24 + 24) % 24);
    const begin = spanOf(o.timing.storms, from, 0.1, 0.9), tornado = spanOf(o.timing.tornado, from), worst = densestSpan(o.timing.severe, from, 0.5);
    const going = (o.ongoing ?? 0) >= 2;
    if (begin || going) lines.push(`${going ? `Storms are ongoing at the start of the period${begin ? `, and more are expected to develop from about ${clock(begin.first)} (${localTime(begin.first)})` : ''}` : `Storms are expected to develop from about ${clock(begin.first)} (${localTime(begin.first)})`}${worst ? `, with severe weather most likely between ${clock(worst.first)} and ${clock(worst.last + 1)}` : ''}.`);
    const where = hazard => partAt(o.top[hazard].x, o.top[hazard].y);
    const area = (hazard, name) => `${o.top[hazard].level}% ${name} area${o.top[hazard].cig ? `, CIG${o.top[hazard].cig}` : ''}`;
    const of = hazard => (o.top[hazard] ? threat(hazard, o.top[hazard]) : null);
    const tor = of('tornado'), hail = of('hail'), wind = of('wind'), all = of('severe');
    if (all) lines.push(`SEVERE: ${sentence(all.words.split(',')[0])} ${all.verb}${all.words.includes(',') ? all.words.slice(all.words.indexOf(',')) + ',' : ','} most likely over the ${where('severe')} part of the region (${area('severe', 'severe')}). The hazards will be set out separately as the day comes nearer.`);
    if (tor) {
      const helicity = e && e.helicity >= 200 ? 'Strong low-level shear' : e && e.helicity >= 100 ? 'Adequate low-level shear' : 'Modest low-level shear';
      const reasoning = e && e.helicity >= 100 && e.cloudBaseM <= 1500 ? `${helicity} and low cloud bases favour tornadoes with storms that stay on their own.` : e && e.helicity >= 100 ? `${helicity} favours tornadoes, but high cloud bases will limit them.` : `${helicity} will limit the tornado risk.`;
      lines.push(`TORNADO: ${sentence(tor.words.split(',')[0])} ${tor.verb}${tor.words.includes(',') ? tor.words.slice(tor.words.indexOf(',')) + ',' : ','} most likely over the ${where('tornado')} part of the region (${area('tornado', 'tornado')}). ${reasoning}${tornado ? ` The tornado risk is greatest between ${clock(tornado.first)} and ${clock(tornado.last + 1)}${(tornado.last - tornado.first + 24) % 24 >= 3 ? `, peaking near ${clock(tornado.peak)}` : ''}.` : ''}`);
    }
    if (hail) lines.push(`HAIL: ${sentence(hail.words.split(',')[0])} ${hail.verb}${hail.words.includes(',') ? hail.words.slice(hail.words.indexOf(',')) + ',' : ','} most likely over the ${where('hail')} part of the region (${area('hail', 'hail')}).`);
    if (wind) lines.push(`WIND: ${sentence(wind.words.split(',')[0])} ${wind.verb}${wind.words.includes(',') ? wind.words.slice(wind.words.indexOf(',')) + ',' : ','} most likely over the ${where('wind')} part of the region (${area('wind', 'wind')})${o.top.wind.cig >= 2 ? `, especially where storms merge into lines${worst ? ` ${partOfDay(worst.peak)}` : ''}` : ''}.`);
    // From the runs themselves (2026-10-20; until then two runs could "agree closely").
    const spread = o.expected.tornadoes.high - o.expected.tornadoes.low, cells = o.expected.severeCells ?? { low: 0, middle: 0, high: 0 }, cellSpread = (cells.high - cells.low) / Math.max(1, cells.middle);
    const notes = [];
    if (o.members <= 2) notes.push(`Only ${o.members === 1 ? 'one forecast run reaches' : 'two forecast runs reach'} this far ahead, so the areas and the level of risk may still change considerably.`);
    else if (cellSpread >= 1) notes.push('The forecast runs differ widely on how widespread the severe weather will be.');
    else if (cellSpread >= 0.5) notes.push('The forecast runs differ somewhat on how widespread the severe weather will be.');
    else notes.push('The forecast runs agree closely on the extent of the severe weather.');
    if (o.members > 2 && spread >= Math.max(6, 1.5 * o.expected.tornadoes.middle)) notes.push('They differ most on how many storms stay on their own before merging, so the higher end of the tornado threat is less certain than the lower.');
    if (o.capped) notes.push(`Some runs support a higher risk than ${label(o.highest).toLowerCase()}; it will be raised in later outlooks if the runs come together on it.`);
    lines.push('', '...UNCERTAINTY...', notes.join(' '));
  }
  return lines.join('\n');
}

// The outlook's areas as outlines (see contourShapes.js; points are shares of the map): each
// category, each hazard's contour levels and its intensity groups. An area is everything at or
// above its level, so the areas nest and are drawn from the lowest up.
export function outlookShapes(o) {
  const { width, height } = o, area = inside => contourRings(softenArea(inside, width, height), width, height, 0.5);
  const kept = list => list.filter(entry => entry.rings.length);
  // An intensity group's outline follows the contours it was judged on: its area is made of
  // whole contour areas, so it is traced from the same chances as they are. An area's outline
  // is part of the group's wherever being in the group changes across it (inside against the
  // contour area around it); filled by the even-odd rule, those outlines give the group's area.
  const groupRings = (hazard, group) => {
    const all = o.cigAreas?.[hazard];
    if (!all) return area(Array.from(o.cig[hazard], v => v >= group));
    const inGroup = a => Math.min(a.group, highestCigAt(hazard, a.level)) >= group, rings = [];
    for (const a of all) {
      if (inGroup(a) === (a.parent >= 0 && inGroup(all[a.parent]))) continue;
      // This area's own outline: the other areas inside the same contour are put out of sight.
      const own = new Uint8Array(width * height); for (const i of a.cells) own[i] = 1;
      const field = Float32Array.from(o.chance[hazard], (v, i) => (v >= a.level - 1e-9 && !own[i] ? a.level - 1 : v));
      rings.push(...contourRings(field, width, height, a.level));
    }
    return rings;
  };
  const shapes = { category: kept(WORLD_RISK_ORDER.slice(1).map(key => ({ key, rings: area(o.category.map(c => rank(c) >= rank(key))) }))) };
  for (const hazard of o.hazards) shapes[hazard] = {
    levels: kept(OUTLOOK.levels[hazard].map(level => ({ level, rings: contourRings(o.chance[hazard], width, height, level) }))),
    groups: kept(Array.from({ length: WORLD_MAX_CIG[hazard] }, (_, k) => ({ group: k + 1, rings: groupRings(hazard, k + 1) })))
  };
  return shapes;
}

// A compact, serializable copy for the pages: the areas as outlines, never the chances themselves.
export function publicOutlook(o) {
  return {
    shapes: outlookShapes(o),
    day: o.day, hazards: o.hazards, status: 'issued', issuedHourUtc: o.issuedHourUtc, validFromHourUtc: o.validFromHourUtc, validToHourUtc: o.validToHourUtc, updateHours: OUTLOOK.updateHours[o.day], issueTimesUtc: OUTLOOK.issueTimesUtc[o.day], seed: o.seed, members: o.members,
    width: o.width, height: o.height, cellMiles: o.cellMiles, highest: o.highest, leading: o.leading, areas: o.areas, top: o.top,
    category: o.category.map(rank), categories: WORLD_RISK_ORDER, labels: WORLD_RISK_LABELS,
    cig: Object.fromEntries(o.hazards.map(hazard => [hazard, Array.from(o.cig[hazard])])),
    thunder: Array.from(o.thunder, v => Math.round(v * 100)), thunderLevel: Math.round(100 * OUTLOOK.thunderShare),
    levels: OUTLOOK.levels, maxCig: WORLD_MAX_CIG, cigMeaning: CIG_MEANING,
    timing: o.timing, environment: o.environment, discussion: o.discussion
  };
}

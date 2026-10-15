// Mesoscale discussions, after the Storm Prediction Center's: a short-range statement about
// one area where severe thunderstorms are developing or changing, issued an hour or two
// before a watch would be. Each has an outlined area, a "concerning" line, a valid time, the
// probability that a watch will be needed (only 5, 20, 40, 60, 80 or 95 percent), a summary,
// a technical discussion, and the most probable peak tornado intensity, wind gust and hail
// size. A discussion may instead concern a watch already in effect: how the threat inside it
// is going (it gives no probability; the watch is there).
//
// They are made the way the outlooks are: the world as it is now is run a few hours ahead
// several times (the members), each drawing its storms' chances afresh. Where most members
// put severe weather in the next few hours is an area of concern; how many of them have
// enough of it there to call for a watch gives the probability; what their strongest storms
// there do gives the peak intensities. The words are written from the air over the area as
// it is now. The watches come from the same runs (Watch.js).
//
// A discussion's outline is drawn freely, as the centre's are (only watches follow county
// lines); its "Areas affected" names the parts of the regions it covers, and it carries the
// counties at least half inside it for the pages (js/forecast/counties.js).
import { AtmosphereWorld } from '../world/AtmosphereWorld.js';
import { captureTruth, aggregateTruth } from '../verification/truth.js';
import { regionRings, solidRegion } from './contourShapes.js';
import { describeArea } from './DayOneOutlook.js';
import { cellCounties, countiesIn, countyNames, describeRegions } from './counties.js';

export const MESOSCALE = Object.freeze({
  members: 4, hoursAhead: 5, stepHours: 0.5,
  // How often the world is looked at (hours), and how long a discussion is valid. After a
  // look in which no run has severe weather on ground under no watch (nothing is coming, or
  // the watches in effect cover it all), the next is not for settledHours, unless a watch is
  // to expire by then. (Waiting whenever there was merely no area of concern yet cost lead:
  // on 16 world days the discussions out before the storms fell from 76% to 61%.)
  everyHours: 1, validHours: 2, settledHours: 2,
  // An area of concern: where at least this share of the members have severe weather within
  // 25 miles in the hours ahead, joined up, and at least this many cells (100 sq mi each).
  memberShare: 0.5, leastCells: 40,
  // What calls for a watch in an area, in one member: this many cells with severe hail or
  // wind, or this many tornadoes (one strong tornado is enough). The probability is the share
  // of the members that get there (members part of the way there do not: on 16 world days,
  // counting them in part gave 40% and 60% to areas that never had a watch's worth). Where
  // none gets there but the members average at least marginalShare of the way, a watch is
  // unlikely but there is something to say (20%).
  watchSevereCells: 10, watchTornadoes: 2, strongTornadoMph: 111, marginalShare: 0.5,
  // The watch in prospect goes by the watch's own table of tornado chances: Moderate or High
  // (above 20%) for 2 or more tornadoes makes it a tornado watch, and so does High (80% or
  // more) for a strong one; anything else is a severe thunderstorm watch. The wind plays no
  // part.
  tornadoChanceLow: 20, tornadoChanceHigh: 80,
  // How long before storms are expected in an area its discussion goes out (hours): a little
  // sooner where a tornado watch is in prospect. A watch goes out as storms fire, so a
  // discussion saying one is likely is saying it is about an hour away. The members look
  // hoursAhead ahead, so an area is seen well before that.
  leadHours: { severe: 1.5, tornado: 2 },
  // The only probabilities given, and the words that go with them.
  steps: [5, 20, 40, 60, 80, 95],
  // Nothing is issued below this probability. And no second discussion for the same ground: a
  // new one is not issued for an area mostly (this share) inside those issued in the last
  // repeatHours with as much concern or more, taken together (storms move, and the ground an
  // area covers shifts from hour to hour), unless the concern has stepped up since (watch unlikely to possible to
  // likely, or a severe thunderstorm watch to a tornado watch).
  leastPercent: 20, overlapShare: 0.4, repeatHours: 8,
  kept: 30
});

// The ranges the peak intensities are given in (as the real products give them): the first
// whose upper bound the value is under.
const PEAK = {
  tornado: [[95, 'UP TO 95 MPH'], [110, '85-115 MPH'], [125, '100-130 MPH'], [145, '120-150 MPH'], [165, '140-170 MPH'], [Infinity, '155+ MPH']],
  wind: [[58, 'UP TO 60 MPH'], [67, '55-70 MPH'], [77, '65-80 MPH'], [90, '75-90 MPH'], [Infinity, '85+ MPH']],
  hail: [[1, 'UP TO 1.25 IN'], [1.6, '1.00-1.75 IN'], [2.3, '1.50-2.50 IN'], [3, '2.00-3.50 IN'], [Infinity, '2.75+ IN']]
};
export const peakRange = (hazard, value) => PEAK[hazard].find(([limit]) => value < limit)[1];
// The nearest probability that may be given.
export const watchStep = share => MESOSCALE.steps.reduce((best, step) => (Math.abs(step - 100 * share) < Math.abs(best - 100 * share) ? step : best));
// The line for ground under no watch (a discussion about a watch names the watch instead).
export function concerningLine(percent, tornado) {
  if (percent <= 20) return 'SEVERE POTENTIAL...WATCH UNLIKELY';
  if (percent <= 60) return 'SEVERE POTENTIAL...WATCH POSSIBLE';
  return `SEVERE POTENTIAL...${tornado ? 'TORNADO' : 'SEVERE THUNDERSTORM'} WATCH LIKELY`;
}

const median = values => { const v = [...values].sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : 0; };
const quantile = (values, q) => { const v = values.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(q * (v.length - 1)))] : 0; };

// One member: the saved world run a few hours ahead with its storms' chances drawn afresh.
// `state` must be this member's own copy (see stateFromBytes in DayOneOutlook.js).
// asItHappens: leave the storms' chances as the live world has them (what will really happen;
// used to check discussions afterwards).
export function runMesoscaleMember(state, member, hours = MESOSCALE.hoursAhead, { asItHappens = false } = {}) {
  const atmosphere = AtmosphereWorld.restore(state);
  if (!atmosphere) throw new Error('the saved world is from another layout');
  const world = atmosphere.world, n = world.width * world.height, start = world.validHourUtc;
  if (!asItHappens) world.evolution = { ...(world.evolution ?? {}), config: { ...(world.evolution?.config ?? {}), seed: `${state.seed}|mesoscale|${start}|${member}` } };
  // As in an outlook's runs: no radar pictures, and the fast transforms.
  world.withoutStormPictures = true; atmosphere.model.fastTransforms = true;
  const frames = [], seen = new Set(), initiations = [];
  const hail = new Float32Array(n), gust = new Float32Array(n), tornadoMph = new Float32Array(n), firstHour = new Float32Array(n).fill(Infinity), stormHour = new Float32Array(n).fill(Infinity), tornadoes = new Map();
  const cellOf = at => Math.min(world.height - 1, Math.max(0, Math.floor(at.y / world.cellSizeKm))) * world.width + Math.min(world.width - 1, Math.max(0, Math.floor(at.x / world.cellSizeKm)));
  // Each tornado once, where it was first seen, with the strongest it got.
  const note = (key, mph, at) => { const cell = cellOf(at), known = tornadoes.get(key); tornadoMph[cell] = Math.max(tornadoMph[cell], mph); if (known) known.mph = Math.max(known.mph, mph); else tornadoes.set(key, { cell, mph }); };
  for (let hour = 0; hour < hours - 1e-9; hour += MESOSCALE.stepHours) {
    atmosphere.advance(MESOSCALE.stepHours);
    const frame = captureTruth(world, frames, seen, initiations), ahead = world.validHourUtc - start;
    for (let i = 0; i < n; i++) { if ((frame.tornado[i] || frame.wind[i] || frame.hail[i]) && firstHour[i] === Infinity) firstHour[i] = ahead; if (frame.storm[i] && stormHour[i] === Infinity) stormHour[i] = ahead; }
    for (const storm of world.storms) {
      if (!storm.active) continue;
      const i = cellOf(storm.positionKm);
      hail[i] = Math.max(hail[i], storm.currentHailSizeInches ?? 0); gust[i] = Math.max(gust[i], storm.surfaceWind?.gustMph ?? 0);
      if (storm.tornado?.onGround) note(`${storm.id}|${storm.tornado.cycleCount}`, storm.tornado.peakWindSpeedMph ?? storm.tornado.windSpeedMph ?? 0, storm.tornado.positionKm ?? storm.positionKm);
      for (const past of storm.tornadoHistory ?? []) if (past.startedHourUtc >= start) note(`${storm.id}|${past.cycle}`, past.peakWindSpeedMph ?? 0, storm.positionKm);
    }
  }
  const truth = aggregateTruth(frames, initiations, world.width, world.height, 25 / world.cellSizeMiles, world.cellSizeMiles);
  const any = (...fields) => Uint8Array.from({ length: n }, (_, i) => (fields.some(field => truth[field][i]) ? 1 : 0));
  return {
    member, width: world.width, height: world.height, cellMiles: world.cellSizeMiles, hours,
    near: any('tornado', 'wind', 'hail'), reports: any('windExact', 'hailExact'), windReports: truth.windExact, hailReports: truth.hailExact, windSignificant: truth.windSigExact,
    significant: any('tornadoSigExact', 'windSigExact', 'hailSigExact'),
    // tornadoes: the cell of each; tornadoPeaks: the strongest each got (mph), in the same order.
    hail, gust, tornadoMph, firstHour, stormHour, tornadoes: [...tornadoes.values()].map(t => t.cell), tornadoPeaks: [...tornadoes.values()].map(t => t.mph)
  };
}

// What one run does inside an area (a 0/1 grid): its severe weather there, its strongest
// storms, when its storms and its severe weather first come (hours ahead), and how far that
// goes toward calling for a watch (toward: 0 to 1).
export function areaOutcome(m, inside) {
  let reports = 0, wind = 0, hailCells = 0, windSignificant = 0, significant = 0, hail = 0, gust = 0, tornadoMph = 0, first = Infinity, storm = Infinity;
  for (let i = 0; i < inside.length; i++) {
    if (!inside[i]) continue;
    reports += m.reports[i]; wind += m.windReports[i]; hailCells += m.hailReports[i]; windSignificant += m.windSignificant[i]; significant += m.significant[i];
    hail = Math.max(hail, m.hail[i]); gust = Math.max(gust, m.gust[i]); tornadoMph = Math.max(tornadoMph, m.tornadoMph[i]); first = Math.min(first, m.firstHour[i]); storm = Math.min(storm, m.stormHour[i]);
  }
  let tornadoes = 0, strong = 0;
  m.tornadoes.forEach((cell, k) => { if (inside[cell]) { tornadoes++; if (m.tornadoPeaks[k] >= MESOSCALE.strongTornadoMph) strong++; } });
  const tornadoCase = Math.min(1, Math.max(tornadoes / MESOSCALE.watchTornadoes, strong ? 1 : 0)), severeCase = Math.min(1, reports / MESOSCALE.watchSevereCells);
  return { reports, wind, hailCells, windSignificant, significant, hail, gust, tornadoMph, tornadoes, strong, first, storm, tornadoCase, toward: Math.max(tornadoCase, severeCase) };
}

// What the air over the map is like now, cell by cell, and the storms on it: all a discussion
// needs from the live world (taken at issue time; plain data but for the county layer).
// counties: the map's county layer (countyLayer in counties.js) for the world's grid; without
// it each cell is a county of its own.
export function describeNow(atmosphere, { counties = null } = {}) {
  const world = atmosphere.world, n = world.width * world.height;
  const field = pick => { const out = new Float32Array(n); world.forEachCell((cell, x, y) => { out[y * world.width + x] = pick(cell) ?? 0; }); return out; };
  const cellOf = at => Math.min(world.height - 1, Math.max(0, Math.floor(at.y / world.cellSizeKm))) * world.width + Math.min(world.width - 1, Math.max(0, Math.floor(at.x / world.cellSizeKm)));
  return {
    hourUtc: world.validHourUtc, width: world.width, height: world.height, cellMiles: world.cellSizeMiles, counties: counties ?? cellCounties(world.width, world.height, world.cellSizeMiles),
    dewpoint: field(c => c.surface.dewpoint), temperature: field(c => c.surface.temperature), cape: field(c => c.derived.sounding?.mlcape ?? c.derived.cape), cin: field(c => Math.abs(c.derived.sounding?.mlcin ?? c.derived.cin ?? 0)),
    shear: field(c => c.derived.bulkShear), helicity: field(c => c.derived.srh), cloudBaseM: field(c => c.derived.lclAgl),
    storms: (world.storms ?? []).filter(s => s.active).map(s => ({ cell: cellOf(s.positionKm), hail: s.currentHailSizeInches ?? 0, gust: s.surfaceWind?.gustMph ?? 0, tornado: Boolean(s.tornado?.onGround), rotating: (s.mesocycloneStrength ?? 0) >= 0.35, line: (s.lineOrganization ?? 0) >= 0.5, intensity: s.intensity ?? 0 })),
    lines: (atmosphere.boundaries ?? []).filter(line => (line.pointsKm?.length ?? 0) > 1).map(line => ({ type: line.type, cells: line.pointsKm.map(cellOf) }))
  };
}

// The areas of concern: joined-up cells where enough of the members have severe weather
// nearby in the hours ahead, each a list of cells, the largest first.
export function concernAreas(members) {
  if (!members.length) return [];
  const { width, height } = members[0], n = width * height, share = new Float32Array(n);
  for (const m of members) for (let i = 0; i < n; i++) share[i] += m.near[i] / members.length;
  const mark = new Uint8Array(n), areas = [];
  for (let start = 0; start < n; start++) {
    if (mark[start] || share[start] < MESOSCALE.memberShare) continue;
    const cells = [], stack = [start]; mark[start] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % width, y = (i - x) / width; cells.push(i);
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) if (j >= 0 && !mark[j] && share[j] >= MESOSCALE.memberShare) { mark[j] = 1; stack.push(j); }
    }
    if (cells.length >= MESOSCALE.leastCells) areas.push(cells);
  }
  return areas.sort((a, b) => b.length - a.length);
}

// What the members make of a piece of ground (a list of cells), and what is there now: the
// probability of a watch, which watch, the most probable peaks, and when storms are expected.
export function assessArea(members, now, cells) {
  const { width, height } = members[0], count = members.length, inside = new Uint8Array(width * height);
  for (const i of cells) inside[i] = 1;
  // In each member: how far the area goes toward calling for a watch, and its strongest storms.
  const perMember = members.map(m => areaOutcome(m, inside));
  const mean = pick => perMember.reduce((a, m) => a + pick(m), 0) / count;
  const there = mean(m => (m.toward >= 1 ? 1 : 0)), part = mean(m => m.toward);
  const percent = there > 0 ? (there === 0.5 && part >= 0.75 ? 60 : watchStep(there)) : part >= MESOSCALE.marginalShare ? 20 : 5;
  // Most probable peaks: the middle of the members' strongest in the area; a tornado's, the
  // middle of the members that have one (given only when at least half of them do).
  const withTornado = perMember.filter(m => m.tornadoes > 0);
  const peak = { tornadoMph: median(withTornado.map(m => m.tornadoMph)), gustMph: median(perMember.map(m => m.gust)), hailInches: median(perMember.map(m => m.hail)), membersWithTornado: withTornado.length };
  const peakText = { tornado: withTornado.length * 2 >= count ? peakRange('tornado', peak.tornadoMph) : null, wind: peakRange('wind', peak.gustMph), hail: peakRange('hail', peak.hailInches) };
  // The chances the watch would give of 2 or more tornadoes and of a strong one.
  const several = watchStep(mean(m => (m.tornadoes >= 2 ? 1 : 0))), strong = watchStep(mean(m => (m.strong >= 1 ? 1 : 0)));
  const tornadoWatch = several > MESOSCALE.tornadoChanceLow || strong >= MESOSCALE.tornadoChanceHigh;
  const here = describeHere(now, inside), firstSevere = perMember.map(m => m.first).filter(Number.isFinite), firstStorm = perMember.map(m => m.storm).filter(Number.isFinite);
  return {
    cells, inside, perMember, members: count, percent, tornadoWatch, peak, peakText, here,
    stormsInHours: here.storms ? 0 : (firstStorm.length ? median(firstStorm) : null), startsInHours: here.severeNow ? 0 : (firstSevere.length ? median(firstSevere) : null)
  };
}

export const concernOf = (percent, tornado) => (percent <= 20 ? 0 : percent <= 60 ? 1 : tornado ? 3 : 2);

// Whether ground under no watch has been discussed lately with as much concern or more
// (earlier: discussions already issued, each with its `cells`).
export function discussedLately(assessed, issuedHourUtc, earlier) {
  const same = earlier.filter(other => other.cells && !other.watchNumber && issuedHourUtc - other.issuedHourUtc < MESOSCALE.repeatHours && concernOf(other.watchPercent, other.tornadoWatch) >= concernOf(assessed.percent, assessed.tornadoWatch));
  return assessed.cells.filter(i => same.some(other => other.cells[i])).length >= MESOSCALE.overlapShare * assessed.cells.length;
}

// Whether it is time to speak of an area: storms are there, or expected within the lead its
// concern is given.
export function withinLead(assessed) {
  return assessed.stormsInHours !== null && assessed.stormsInHours <= MESOSCALE.leadHours[assessed.tornadoWatch ? 'tornado' : 'severe'];
}

// A discussion of an assessed area. watch: the watch in effect that it concerns, if any;
// replacement: the watch that will follow that one when it expires ({ type, atHourUtc });
// updates: the numbers of the discussions this one replaces.
export function makeDiscussion(assessed, now, { number, seed = null, watch = null, replacement = null, updates = [] } = {}) {
  const { width, height } = now, issued = now.hourUtc;
  // Its ground: one region with no holes (ground in a gap it encloses is part of it).
  const inside = solidRegion(assessed.inside, width, height), cells = Array.from(inside.keys()).filter(i => inside[i]);
  const layer = now.counties ?? cellCounties(width, height, now.cellMiles), counties = countiesIn(layer, inside, { least: 0.5 }), regions = describeRegions(layer, counties);
  const md = {
    number, seed, issuedHourUtc: issued, validToHourUtc: issued + MESOSCALE.validHours, members: assessed.members,
    cells: inside, areaCells: cells.length, areaSquareMiles: cells.length * now.cellMiles * now.cellMiles,
    where: regions ? `portions of ${regions}` : describeArea(Array.from(inside, Boolean), width, height), countyIds: layer.named ? counties.map(index => index + 1) : [], countyNames: countyNames(layer, counties),
    // About a watch in effect: no probability (the watch is there), and the watch's own kind.
    watchNumber: watch?.number ?? null, watchType: watch?.type ?? null, replacement, updates, replacedBy: null, watchPercent: watch ? null : assessed.percent, threatPercent: assessed.percent, tornadoWatch: watch ? watch.type === 'tornado' : assessed.tornadoWatch,
    concerning: watch ? `${watch.type === 'tornado' ? 'TORNADO' : 'SEVERE THUNDERSTORM'} WATCH ${watch.number}` : concerningLine(assessed.percent, assessed.tornadoWatch),
    peak: assessed.peak, peakText: assessed.peakText, stormsInHours: assessed.stormsInHours, startsInHours: assessed.startsInHours, here: assessed.here,
    rings: regionRings(inside, width, height)
  };
  md.text = writeMesoscaleDiscussion(md);
  return md;
}

// The discussions to issue now for ground under no watch. members: runMesoscaleMember
// results; now: describeNow of the live world; active: discussions already issued (their
// `cells` are compared); next: the number the first new one takes. (The server uses lookAhead
// in Watch.js, which issues the watches too and the discussions about them.)
export function buildMesoscaleDiscussions(members, now, { active = [], next = 1, seed = null } = {}) {
  const out = [];
  for (const cells of concernAreas(members)) {
    const assessed = assessArea(members, now, cells);
    if (assessed.percent < MESOSCALE.leastPercent || !withinLead(assessed) || discussedLately(assessed, now.hourUtc, [...active, ...out])) continue;
    out.push(makeDiscussion(assessed, now, { number: next + out.length, seed }));
  }
  return out;
}

// The air and the storms over an area now.
function describeHere(now, inside) {
  const pick = field => { const out = []; for (let i = 0; i < inside.length; i++) if (inside[i]) out.push(field[i]); return out; };
  const forming = now.storms.filter(s => inside[s.cell]), storms = forming.filter(s => s.intensity >= 0.22), severe = storms.filter(s => s.hail >= 1 || s.gust >= 58 || s.tornado);
  const lines = now.lines.filter(line => line.cells.filter(i => inside[i]).length >= 2).map(line => line.type);
  return {
    dewpoint: quantile(pick(now.dewpoint), 0.5), temperature: quantile(pick(now.temperature), 0.5), cape: quantile(pick(now.cape), 0.75), cin: quantile(pick(now.cin), 0.5), shear: quantile(pick(now.shear), 0.5),
    helicity: quantile(pick(now.helicity), 0.75), cloudBaseM: quantile(pick(now.cloudBaseM), 0.5),
    // forming: every storm there, however young; storms: those that have grown into thunderstorms.
    forming: forming.length, storms: storms.length, severeNow: severe.length, tornadoNow: storms.filter(s => s.tornado).length, rotating: storms.filter(s => s.rotating).length, lines: storms.filter(s => s.line).length,
    features: [...new Set(lines)]
  };
}

export const stamp = hourUtc => { const day = Math.floor(hourUtc / 24) + 1, h = ((hourUtc % 24) + 24) % 24, hh = Math.floor(h + 1e-9), mm = Math.round((h - hh) * 60); return `${String(day).padStart(2, '0')}${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}Z`; };
export const list = words => (words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);
const FEATURE = { cold: 'a cold front', warm: 'a warm front', stationary: 'a stationary front', dryline: 'a dryline', outflow: 'an outflow boundary' };

// The technical paragraph, shared with the watches: what is there now, the air it is in, and
// what that favours. e: describeHere's account; tornado: whether tornadoes are expected.
export function describeSetting(e, tornado) {
  const present = e.storms ? `${e.storms === 1 ? 'One storm is' : `${e.storms} storms are`} in the area${e.severeNow ? `, ${e.severeNow} of them severe` : ''}${e.tornadoNow ? ` and ${e.tornadoNow === 1 ? 'one with a tornado on the ground' : `${e.tornadoNow} with tornadoes on the ground`}` : ''}.` : e.forming ? 'Storms are beginning to form in the area.' : 'No storms have formed in the area yet.';
  const features = e.features.length ? ` ${list(e.features.map(type => FEATURE[type] ?? `a ${type} boundary`))[0].toUpperCase()}${list(e.features.map(type => FEATURE[type] ?? `a ${type} boundary`)).slice(1)} ${e.features.length > 1 ? 'lie' : 'lies'} across the area and will focus development.` : '';
  const tens = Math.floor(e.dewpoint / 10) * 10, dewpoints = `${e.dewpoint - tens < 3.5 ? 'lower ' : e.dewpoint - tens >= 6.5 ? 'upper ' : 'mid '}${tens}s F`;
  const instability = e.cape >= 3500 ? 'extreme' : e.cape >= 2500 ? 'strong' : e.cape >= 1000 ? 'moderate' : 'weak';
  const air = `Surface dewpoints in the ${dewpoints} beneath steep lapse rates give ${instability} instability (MLCAPE near ${Math.max(250, Math.round(e.cape / 250) * 250)} J/kg), with ${Math.round(e.shear / 5) * 5} kt of deep-layer shear.`;
  const mode = e.shear >= 40 ? (e.lines > e.rotating ? 'The shear supports organized storms; those here have grown into lines, and damaging wind is the main concern.' : 'The shear supports supercells, with large hail and damaging wind') : e.shear >= 25 ? 'The shear supports multicells and brief supercell structures' : 'Weak shear will keep storms short-lived and poorly organized';
  const tornadoWords = tornado ? (e.helicity >= 150 && e.cloudBaseM <= 1300 ? ` Low-level shear (0-1 km helicity near ${Math.round(e.helicity / 25) * 25} m2/s2) and low cloud bases favour tornadoes with storms that stay on their own.` : ` A tornado is possible with the strongest rotating storms, though ${e.cloudBaseM > 1300 ? 'high cloud bases limit' : 'modest low-level shear limits'} the risk.`) : '';
  const cap = e.cin >= 75 && !e.storms && !e.forming ? ' A cap is holding storms back for now; how soon it breaks is the main doubt.' : '';
  return `${present}${features} ${air} ${mode}${mode.endsWith('.') ? '' : '.'}${tornadoWords}${cap}`;
}

// The discussion in words, laid out as the real ones are.
export function writeMesoscaleDiscussion(md) {
  const e = md.here, p = md.peak, hail = p.hailInches, gust = p.gustMph;
  const hazards = [];
  if (md.peakText.tornado) hazards.push(p.tornadoMph >= 136 ? 'tornadoes, some of them intense' : p.tornadoMph >= 111 ? 'tornadoes, some of them strong' : 'a tornado or two');
  if (gust >= 58) hazards.push(gust >= 75 ? 'severe wind gusts, some of 75 mph or more' : 'severe wind gusts');
  if (hail >= 1) hazards.push(hail >= 2 ? 'large hail, some of 2 inches or more' : 'large hail');
  const threat = hazards.length ? list(hazards) : 'marginally severe hail and wind';
  const soon = hours => (hours <= 1 ? 'within the hour' : hours <= 2 ? 'within the next hour or two' : 'over the next few hours');
  const when = md.startsInHours === 0 ? 'Severe thunderstorms are ongoing' : e.storms ? `The storms in the area are expected to become severe ${soon(md.startsInHours ?? 3)}` : md.startsInHours !== null && md.startsInHours <= 1 ? 'Severe thunderstorms are expected within the hour' : `Severe thunderstorms are expected to develop ${soon(md.startsInHours ?? 3)}`;
  const kind = md.tornadoWatch ? 'tornado' : 'severe thunderstorm', title = md.tornadoWatch ? 'Tornado Watch' : 'Severe Thunderstorm Watch', ongoing = md.startsInHours === 0 ? ' over the next few hours' : '';
  const lines = [
    `Mesoscale Discussion ${String(md.number).padStart(4, '0')}`, '',
    `Areas affected...${md.where ? md.where[0].toUpperCase() + md.where.slice(1) : 'Part of the region'}`, '',
    `Concerning...${md.concerning}`, '',
    `Valid ${stamp(md.issuedHourUtc)} - ${stamp(md.validToHourUtc)}`, ''
  ];
  if (md.watchNumber) {
    // About a watch in effect: how its threat is going in this part of it.
    const going = md.threatPercent >= 40;
    lines.push(`The severe weather threat for ${title} ${md.watchNumber} ${going ? 'continues' : 'is waning'}.`, '',
      `SUMMARY...${going ? `${when} over this part of the watch, with ${threat} possible${ongoing}.` : `Only isolated severe weather (${threat}) is expected over this part of the watch from here on.`}${md.replacement ? ` A new ${md.replacement.type === 'tornado' ? 'tornado' : 'severe thunderstorm'} watch will be needed when this one expires at ${stamp(md.replacement.atHourUtc)}.` : ''}`, '');
  } else {
    const action = md.watchPercent >= 80 ? `A ${kind} watch will likely be needed within the hour${e.storms ? '' : ', as storms form'}.` : md.watchPercent >= 40 ? `A ${kind} watch may be needed.` : 'The severe weather should stay too isolated or too brief for a watch.';
    lines.push(`Probability of Watch Issuance...${md.watchPercent} percent`, '', ...(md.updates?.length ? [`This discussion replaces ${list(md.updates.map(k => `Mesoscale Discussion ${String(k).padStart(4, '0')}`))}.`, ''] : []), `SUMMARY...${when} over the area, with ${threat} possible${ongoing}. ${action}`, '');
  }
  lines.push(`DISCUSSION...${describeSetting(e, Boolean(md.peakText.tornado))}`, '');
  if (md.peakText.tornado) lines.push(`MOST PROBABLE PEAK TORNADO INTENSITY...${md.peakText.tornado}`);
  lines.push(`MOST PROBABLE PEAK WIND GUST...${md.peakText.wind}`, `MOST PROBABLE PEAK HAIL SIZE...${md.peakText.hail}`);
  return lines.join('\n');
}

// What the pages get: the outline, not the cells.
export function publicMesoscaleDiscussion(md) {
  const { cells, here, ...rest } = md;
  return { ...rest, environment: here };
}

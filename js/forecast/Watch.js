// Watches, after the Storm Prediction Center's: a tornado watch or a severe thunderstorm
// watch for an area where the next several hours favour them, issued as storms begin to fire
// there. They come from the same look ahead as the mesoscale discussions
// (MesoscaleDiscussion.js): an area whose probability of a watch is 80% or more gets one.
//   - A tornado watch when the watch's chance of 2 or more tornadoes is Moderate or High
//     (above 20%), or its chance of a strong one is High (80%+); otherwise a severe
//     thunderstorm watch, which may still speak of a tornado or two. The wind plays no part.
//   - "Particularly dangerous situation" (PDS) wording is kept for the rare ones (the centre
//     gives it to about 3 watches in 100): a tornado watch with an 80% chance or more of
//     several strong (EF2+) tornadoes, the most probable peak an intense one (136 mph, EF3,
//     or more); a severe thunderstorm watch with an 80% chance or more of widespread
//     significant wind with gusts of 100 mph (a derecho). On 16 world days these gave it to
//     4 watches of 79; an 80% chance of one strong tornado, the centre's own least, to 13.
//   - Each carries the centre's table of probabilities (2 or more tornadoes, a strong tornado,
//     10 or more wind events, a 75 mph gust, 10 or more hail events, 2 inch hail, 6 or more
//     hail and wind events together), given at the steps a discussion's probability takes.
//   - A watch is a set of whole counties, as the centre's have been since its watch outline
//     updates (WOU) came to list them: the area of concern is drawn a little wide, and every
//     county with at least half its area inside is in the watch (countyShare). The map shades
//     the counties; the text gives the centre's approximate line ("along and 40 statute miles
//     either side of a line from ... to ...") and the WOU lists the counties. See counties.js.
//   - Every watch and every discussion covers one joined-up region with no holes, never two
//     apart. A gap a watch would enclose is filled in, unless it holds another watch; then the
//     new watch gives up the ground north of it, so it does not wrap around the other.
//   - Watches do not overlap: a new one covers only ground under no watch in effect. And a
//     watch stands as issued until it expires: it is not extended, upgraded, replaced or
//     cancelled. What changes inside it is said in a discussion that concerns it.
//   - Every watch has a discussion before it, as the centre's nearly always do (its aim: the
//     discussion one to two hours before the watch, the watch itself often set off by the
//     first deep convection). A watch is made ready only when storms are expected within a
//     discussion's lead, so the discussion that calls it likely is out about an hour before
//     it; for ground no discussion has yet called a watch likely on, the watch waits at least
//     afterDiscussionHours after the one that does. A watch that follows an expiring one is
//     announced in a discussion about that one.
//   - A discussion that steps up the concern over ground an earlier one still covers replaces
//     that one (which ends then) and says so, so there are never two in effect saying
//     different things about the same ground.
//   - An area of concern cut apart by watches in effect: a leftover piece gets a discussion or
//     a watch only if it calls for a watch itself (80% or more); pieces likely to come to
//     nothing are left alone.
//   - A watch over severe weather that is still going is followed without a gap: at the last
//     look before it expires, a new watch is made ready for the moment it does, and a
//     discussion about the old one says so.
import { MESOSCALE, watchStep, concernOf, concernAreas, assessArea, makeDiscussion, discussedLately, withinLead, describeSetting, stamp, list } from './MesoscaleDiscussion.js';
import { solidRegion, connectedPieces } from './contourShapes.js';
import { describeArea } from './DayOneOutlook.js';
import { cellCounties, countiesIn, countiesUnder, cellsOfCounties, countyRings, describeRegions, countyNames, nearestTown } from './counties.js';

export const WATCH = Object.freeze({
  // The probability of a watch (a discussion's) from which one is issued, how long it lasts
  // (hours), the least ground it covers (cells of 100 sq mi), and how far it is drawn beyond
  // the area of concern (cells).
  // (2026-10-20: margin 2 to 1 cell, and at most mostCells of ground, the part where the runs bring
  // severe weather first: watches had run 115-155 miles either side of their line and up to
  // 65,000 sq mi; the centre's are mostly 40-75 miles either side, 20,000-30,000 sq mi. A watch now
  // goes out once the runs bring severe weather within issueLeadHours, not only once storms fire:
  // the centre's go out an hour or two ahead of the first storms.)
  leastPercent: 80, hours: 6, leastCells: 120, marginCells: 1, mostCells: 220, issueLeadHours: 2, waningHoursLeft: 2,
  // A county is in the watch when at least this share of it is in the area drawn.
  countyShare: 0.5,
  // The towns the approximate line is given from (people), as the centre gives it from places
  // with an airport.
  lineTownPopulation: 2000,
  // The least time between the discussion that says a watch is likely and the watch (hours).
  afterDiscussionHours: 0.5,
  // A watch about to expire is followed by a new one when its ground still calls for a watch
  // with storms there, or has severe weather under way and at least this probability of one.
  followPercent: 40,
  // Particularly dangerous situations. Tornado: this chance of pdsStrongTornadoes strong
  // tornadoes, and a most probable peak of pdsTornadoMph or more. Severe thunderstorm: this
  // chance of a gust of pdsGustMph with pdsWindCells cells of 75 mph wind or more.
  pdsPercent: 80, pdsStrongTornadoes: 2, pdsTornadoMph: 136, pdsGustMph: 100, pdsWindCells: 25,
  kept: 20
});

const title = watch => `${watch.type === 'tornado' ? 'Tornado' : 'Severe Thunderstorm'} Watch`;

// The table of probabilities, from what each run does in the area (areaOutcome). An "event"
// is a cell with a report. A run's count of hail, wind or combined events is one draw of what
// that weather could give: it is taken as the mean of a Poisson count, and the chance is the runs'
// average chance of reaching the number. (Until 2026-10-20 the plain share of runs reaching it:
// with 4-8 runs, a watch could read 5% for 10 hail and for 10 wind events beside 95% for 6
// combined.) The tornado rows, where the counts are small and the runs themselves are the spread,
// and the peak gust and hail rows are the share of runs reaching them.
const atLeast = (mean, k) => { if (!(mean > 0)) return 0; let term = Math.exp(-mean), below = 0; for (let i = 0; i < k; i++) { below += term; term *= mean / (i + 1); } return Math.max(0, 1 - below); };
export function watchProbabilities(perMember) {
  const p = test => watchStep(perMember.filter(test).length / perMember.length);
  const count = (key, k) => watchStep(perMember.reduce((a, m) => a + atLeast(Number(m[key]) || 0, k), 0) / perMember.length);
  return {
    tornadoes2: p(m => m.tornadoes >= 2), strongTornado: p(m => m.strong >= 1),
    wind10: count('wind', 10), wind75: p(m => m.gust >= 75),
    hail10: count('hailCells', 10), hail2: p(m => m.hail >= 2), combined6: count('reports', 6)
  };
}

// peakTornadoMph: the most probable peak tornado intensity (assessArea's).
export function particularlyDangerous(type, perMember, peakTornadoMph = 0) {
  const chance = test => watchStep(perMember.filter(test).length / perMember.length);
  if (type === 'tornado') return chance(m => m.strong >= WATCH.pdsStrongTornadoes) >= WATCH.pdsPercent && peakTornadoMph >= WATCH.pdsTornadoMph;
  return chance(m => m.gust >= WATCH.pdsGustMph && m.windSignificant >= WATCH.pdsWindCells) >= WATCH.pdsPercent;
}

// The counties a weather grid's products use (describeNow's), or each cell a county of its own.
export const layerOf = now => now.counties ?? cellCounties(now.width, now.height, now.cellMiles ?? 10);

// A watch for an assessed area, not yet issued (no number or times). Its ground is the area
// drawn a little wide, made of the counties at least half inside it, less any county already
// under a watch (covered: a 0/1 grid of the cells under watches).
export function draftWatch(assessed, now, { seed = null, covered = null } = {}) {
  const { width, height } = now, n = width * height, type = assessed.tornadoWatch ? 'tornado' : 'severe', layer = layerOf(now);
  // Too big for one watch: the ground where severe weather comes first, cut again until the watch
  // drawn from it (with its margin, gaps filled and whole counties) is no bigger than mostCells.
  const inside = []; for (let i = 0; i < n; i++) if (assessed.inside[i]) inside.push(i);
  if (assessed.firstAt) inside.sort((a, b) => assessed.firstAt[a] - assessed.firstAt[b]);
  let keep = Math.min(inside.length, WATCH.mostCells), drawn = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    drawn = drawWatchGround(inside.slice(0, keep), now, covered, layer);
    if (drawn.areaCells <= WATCH.mostCells * 1.15 || keep <= WATCH.leastCells / 2) break;
    keep = Math.max(Math.round(WATCH.leastCells / 2), Math.floor(keep * WATCH.mostCells / drawn.areaCells));
  }
  const { cells, counties, areaCells } = drawn, regions = describeRegions(layer, counties);
  return {
    type, pds: particularlyDangerous(type, assessed.perMember, assessed.peak.tornadoMph), seed, members: assessed.members,
    cells, areaCells, counties, countyNames: countyNames(layer, counties),
    areaSquareMiles: layer.named ? counties.reduce((a, index) => a + layer.counties[index].areaMi2, 0) : areaCells * now.cellMiles * now.cellMiles,
    where: regions ? `portions of ${regions}` : describeArea(Array.from(cells, Boolean), width, height), line: watchLine(layer, counties),
    probabilities: watchProbabilities(assessed.perMember), peak: assessed.peak, peakText: assessed.peakText, here: assessed.here, runs: assessed.perMember,
    rings: countyRings(layer, counties)
  };
}

// A watch's ground from the cells it is drawn round: a margin, whole counties, one region with no holes.
function drawWatchGround(list, now, covered, layer) {
  const { width, height } = now, n = width * height;
  let cells = new Uint8Array(n); for (const i of list) cells[i] = 1;
  for (let pass = 0; pass < WATCH.marginCells; pass++) {
    const wider = Uint8Array.from(cells);
    for (let i = 0; i < n; i++) { if (!cells[i]) continue; const x = i % width; if (x > 0) wider[i - 1] = 1; if (x < width - 1) wider[i + 1] = 1; if (i >= width) wider[i - width] = 1; if (i < n - width) wider[i + width] = 1; }
    cells = wider;
  }
  if (covered) for (let i = 0; i < n; i++) if (covered[i]) cells[i] = 0;
  // Whole counties; then one region with no holes: where taking away ground under other
  // watches leaves pieces, the largest; gaps filled, or opened where they hold another watch.
  // The counties are those the region keeps most of.
  const blocked = covered ? countiesUnder(layer, covered) : null;
  const solid = solidRegion(cellsOfCounties(layer, countiesIn(layer, cells, { least: WATCH.countyShare, blocked })), width, height, covered);
  const counties = layer.counties.filter(county => !blocked?.has(county.index) && (() => { let held = 0, all = 0; county.cells.forEach(cell => { if (layer.dominant[cell] === county.index) { all++; if (solid[cell]) held++; } }); return all ? held * 2 >= all : Boolean(solid[county.home]); })()).map(county => county.index);
  cells = cellsOfCounties(layer, counties);
  return { cells, counties, areaCells: cells.reduce((a, v) => a + v, 0) };
}

// The centre's approximate description of a watch: a line along its length and how far its
// ground reaches either side of it ("along and 45 statute miles north and south of a line from
// 20 miles west of A to 15 miles east of B"), from its counties' outline. Null without names.
export function watchLine(layer, counties) {
  if (!layer.named || !counties.length) return null;
  const points = counties.flatMap(index => layer.counties[index].rings.flat());
  let area = 0, cx = 0, cy = 0;
  for (const index of counties) { const c = layer.counties[index]; area += c.areaMi2; cx += c.x * c.areaMi2; cy += c.y * c.areaMi2; }
  cx /= area; cy /= area;
  // The long axis: the principal direction of the counties' middles, weighted by area.
  let xx = 0, xy = 0, yy = 0;
  for (const index of counties) { const c = layer.counties[index], dx = c.x - cx, dy = c.y - cy; xx += c.areaMi2 * dx * dx; xy += c.areaMi2 * dx * dy; yy += c.areaMi2 * dy * dy; }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy), ax = Math.cos(angle), ay = Math.sin(angle);
  let lo = Infinity, hi = -Infinity, half = 0;
  for (const [x, y] of points) { const t = (x - cx) * ax + (y - cy) * ay, s = Math.abs(-(x - cx) * ay + (y - cy) * ax); lo = Math.min(lo, t); hi = Math.max(hi, t); half = Math.max(half, s); }
  // The line's ends are drawn in from the outline's by its half-width at most, and run west to
  // east (north to south for a line nearer north-south).
  const inset = Math.min(half, (hi - lo) / 4);
  let ends = [[cx + ax * (lo + inset), cy + ay * (lo + inset)], [cx + ax * (hi - inset), cy + ay * (hi - inset)]];
  const eastWest = Math.abs(ax) >= Math.abs(ay);
  if (eastWest ? ends[0][0] > ends[1][0] : ends[0][1] > ends[1][1]) ends = [ends[1], ends[0]];
  const from = ([x, y]) => {
    const near = nearestTown(layer, x, y, WATCH.lineTownPopulation) ?? nearestTown(layer, x, y);
    if (!near) return null;
    const miles = 5 * Math.round(near.miles / 5);
    return miles < 5 ? near.town.name : `${miles} miles ${COMPASS[Math.round((((Math.atan2(x - near.town.x, -(y - near.town.y)) * 180 / Math.PI) % 360) + 360) % 360 / 45) % 8]} of ${near.town.name}`;
  };
  return { widthMiles: Math.max(10, 5 * Math.round(half / 5)), sides: eastWest ? 'north and south' : 'east and west', from: from(ends[0]), to: from(ends[1]) };
}
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

// The watch as issued: its number, when it takes effect and when it expires, and its words.
// forming: the storms on its ground now, for a watch that has waited for them (stormsFiring).
export function issueWatch(draft, number, hourUtc, forming = draft.here.forming) {
  const watch = { ...draft, here: { ...draft.here, forming }, number, issuedHourUtc: hourUtc, validToHourUtc: hourUtc + WATCH.hours };
  watch.text = writeWatch(watch);
  return watch;
}

// How many storms have begun to fire on a piece of ground (a 0/1 grid) in the live world:
// every storm there, however young.
export function stormsFiring(world, cells) {
  let count = 0;
  for (const storm of world.storms ?? []) {
    if (!storm.active) continue;
    const x = Math.min(world.width - 1, Math.max(0, Math.floor(storm.positionKm.x / world.cellSizeKm))), y = Math.min(world.height - 1, Math.max(0, Math.floor(storm.positionKm.y / world.cellSizeKm)));
    if (cells[y * world.width + x]) count++;
  }
  return count;
}

// When a watch that is waiting can go out, or null if not yet: one following an expiring
// watch at the hour that one expires (notBeforeHourUtc); any other when storms fire on its
// ground, and not before its discussion has been out a while (afterHourUtc).
export function readyHourUtc(draft, world) {
  if (draft.notBeforeHourUtc != null) return world.validHourUtc >= draft.notBeforeHourUtc - 1e-6 ? draft.notBeforeHourUtc : null;
  if (draft.afterHourUtc != null && world.validHourUtc < draft.afterHourUtc - 1e-6) return null;
  if (draft.readyAtHourUtc != null && world.validHourUtc >= draft.readyAtHourUtc - 1e-6) return world.validHourUtc;
  return stormsFiring(world, draft.cells) ? world.validHourUtc : null;
}

// When the world is next to be looked at after a look at hourUtc that found `found`.
export function nextLookHourUtc(found, hourUtc, watches) {
  const expiring = watches.some(watch => watch.validToHourUtc > hourUtc + 1e-6 && watch.validToHourUtc <= hourUtc + MESOSCALE.settledHours + 1e-6);
  return hourUtc + (found.settled && !expiring ? MESOSCALE.settledHours : MESOSCALE.everyHours);
}

// One look ahead: the discussions and watches to issue now, and the watches to issue later
// (pending: drafts; see readyHourUtc): as soon as storms fire on their ground, or when the
// watch they follow expires. members:
// runMesoscaleMember results; now: describeNow of the live world; discussions, watches: those
// already issued (with their `cells`). settled: no run has severe weather on ground under no
// watch (see MESOSCALE.settledHours).
export function lookAhead(members, now, { discussions = [], watches = [], nextDiscussion = 1, nextWatch = 1, seed = null } = {}) {
  const out = { discussions: [], watches: [], pending: [], settled: false };
  if (!members.length) return out;
  const issued = now.hourUtc, n = now.width * now.height, covered = new Uint8Array(n);
  const inEffect = watches.filter(watch => watch.validToHourUtc > issued + 1e-6);
  // fresh: the ground of the watches made at this look.
  const fresh = new Uint8Array(n), cover = (watch, grid = covered) => { for (let i = 0; i < n; i++) if (watch.cells[i]) grid[i] = 1; };
  inEffect.forEach(watch => cover(watch));
  out.settled = members.every(m => m.near.every((near, i) => !near || covered[i]));
  const discuss = (assessed, watch = null, replacement = null) => {
    const number = nextDiscussion + out.discussions.length;
    // Ground under no watch: earlier discussions still in effect, of less concern, over much
    // of the same ground are replaced by this one.
    const replaces = watch ? [] : [...discussions, ...out.discussions].filter(other => !other.watchNumber && other.cells && other.validToHourUtc > issued + 1e-6 && concernOf(other.watchPercent, other.tornadoWatch) < concernOf(assessed.percent, assessed.tornadoWatch)
      && other.cells.reduce((a, v, i) => a + (v && assessed.inside[i] ? 1 : 0), 0) >= 0.3 * (other.areaCells || 1));
    for (const other of replaces) { other.validToHourUtc = issued; other.replacedBy = number; }
    out.discussions.push(makeDiscussion(assessed, now, { number, seed, watch, replacement, updates: replaces.map(other => other.number) }));
  };
  const pieces = cells => connectedPieces(cells, now.width, now.height).filter(piece => piece.length >= MESOSCALE.leastCells);
  // The ground under no watch, each joined-up piece of it on its own.
  const openGround = cells => {
    const open = cells.filter(i => !covered[i]), found = pieces(open);
    // Cut apart by watches in effect: what is left is a piece, held to more.
    const split = open.length < cells.length || found.length > 1;
    for (const piece of found) openPiece(piece, split);
  };
  const openPiece = (open, split) => {
    const assessed = assessArea(members, now, open);
    if (assessed.percent < (split ? WATCH.leastPercent : MESOSCALE.leastPercent)) return;
    if (assessed.percent >= WATCH.leastPercent) {
      // Not yet within a discussion's lead: the next look will see to it.
      if (!withinLead(assessed)) return;
      const draft = draftWatch(assessed, now, { seed, covered });
      if (draft.areaCells >= WATCH.leastCells) {
        cover(draft); cover(draft, fresh);
        // A discussion comes first. One has already said as much of this ground: the watch
        // goes out now if storms are firing there, or waits for them. None has: it is issued
        // now, and the watch waits for storms and at least afterDiscussionHours.
        const said = discussedLately(assessed, issued, [...discussions, ...out.discussions]);
        if (!said) discuss(assessed);
        const soon = assessed.here.forming || (assessed.startsInHours !== null && assessed.startsInHours <= WATCH.issueLeadHours);
        const readyAtHourUtc = assessed.startsInHours !== null ? issued + Math.max(0, assessed.startsInHours - WATCH.issueLeadHours) : null;
        if (said && soon) out.watches.push(issueWatch(draft, nextWatch + out.watches.length, issued));
        else out.pending.push(said ? { ...draft, readyAtHourUtc } : { ...draft, afterHourUtc: issued + WATCH.afterDiscussionHours, readyAtHourUtc });
        return;
      }
    }
    if (withinLead(assessed) && !discussedLately(assessed, issued, [...discussions, ...out.discussions])) discuss(assessed);
  };
  for (const cells of concernAreas(members)) {
    openGround(cells);
    // The part under each watch in effect: how its threat is going.
    for (const watch of inEffect) for (const part of pieces(cells.filter(i => watch.cells[i]))) {
      const last = Math.max(watch.issuedHourUtc, ...[...discussions, ...out.discussions].filter(md => md.watchNumber === watch.number).map(md => md.issuedHourUtc));
      const expiring = watch.validToHourUtc <= issued + MESOSCALE.everyHours + 1e-6;
      if (!expiring) {
        // Only when something changes: the threat turns to tornadoes in a severe thunderstorm
        // watch, or statusHours have passed while a watch's worth of severe weather goes on.
        if (issued - last < MESOSCALE.validHours - 1e-6) continue;
        const assessed = assessArea(members, now, part);
        const turned = watch.type !== 'tornado' && assessed.tornadoWatch && assessed.percent >= WATCH.leastPercent;
        // (Not in its last waningHoursLeft: the discussion at its expiry speaks for it then.)
        const ongoing = issued - last >= MESOSCALE.statusHours - 1e-6 && watch.validToHourUtc - issued > WATCH.waningHoursLeft + 1e-6 && assessed.percent >= WATCH.leastPercent && assessed.here.severeNow > 0;
        // ...or, once, that its threat is waning (a watch that may come down before it expires).
        // (Only with a couple of hours or more left: a watch about to run out is simply let go.)
        const waning = assessed.percent < WATCH.followPercent && watch.validToHourUtc - issued >= WATCH.waningHoursLeft - 1e-6 && ![...discussions, ...out.discussions].some(md => md.watchNumber === watch.number && md.threatPercent < WATCH.followPercent);
        if (turned || ongoing || waning) discuss(assessed, watch);
        continue;
      }
      // The last look before it expires. Severe weather still going: a new watch is made
      // ready for the moment this one expires, on this area's ground that no later watch
      // has, and a discussion about this one says it is coming.
      const assessed = assessArea(members, now, part);
      let follow = null;
      if ((assessed.percent >= WATCH.leastPercent && assessed.here.storms) || (assessed.percent >= WATCH.followPercent && assessed.here.severeNow)) {
        const later = Uint8Array.from(fresh);
        for (const other of inEffect) if (other.validToHourUtc > watch.validToHourUtc + 1e-6) cover(other, later);
        const ground = pieces(cells.filter(i => !later[i]))[0];
        const draft = ground ? draftWatch(assessArea(members, now, ground), now, { seed, covered: later }) : { areaCells: 0 };
        if (draft.areaCells >= WATCH.leastCells) { follow = { ...draft, notBeforeHourUtc: watch.validToHourUtc, follows: watch.number }; cover(follow, fresh); out.pending.push(follow); }
      }
      // About to expire: a word on what follows, or that the threat is ending.
      // (Only when a new watch must follow it: one that simply runs out is let go, as the centre's are.)
      if (follow) discuss(assessed, watch, { type: follow.type, atHourUtc: follow.notBeforeHourUtc });
    }
  }
  return out;
}

const LEVEL = percent => (percent >= 80 ? 'High' : percent >= 40 ? 'Mod' : 'Low');
const TABLE = [
  ['tornadoes2', '2 or more tornadoes'], ['strongTornado', '1 or more strong (EF2-EF5) tornadoes'],
  ['wind10', '10 or more severe wind events'], ['wind75', '1 or more wind events of 75 mph or more'],
  ['hail10', '10 or more severe hail events'], ['hail2', '1 or more hail events of 2 inches or more'],
  ['combined6', '6 or more combined severe hail/wind events']
];
export const probabilityText = percent => `${LEVEL(percent)} (${percent <= 5 ? '<5' : percent >= 95 ? '>95' : percent}%)`;
export const probabilityRows = watch => TABLE.map(([key, label]) => [label, probabilityText(watch.probabilities[key])]);

// The primary threats, worded as the real watches word them: how much of each, how strong, how likely.
function threats(watch) {
  const p = watch.probabilities, k = watch.peak, lines = [];
  if (watch.type === 'tornado') {
    const some = p.tornadoes2 >= 80 ? 'Several tornadoes' : 'A few tornadoes', someLikely = p.tornadoes2 >= 60 ? 'likely' : 'possible';
    const strong = k.tornadoMph >= 136 ? 'a few intense tornadoes' : 'a couple of strong tornadoes', strongLikely = p.strongTornado >= 80 ? 'likely' : 'possible';
    lines.push(p.strongTornado < 40 ? `${some} ${someLikely}` : someLikely === strongLikely ? `${some} and ${strong} ${someLikely}` : `${some} ${someLikely} with ${strong} ${strongLikely}`);
  } else if (watch.peakText.tornado) lines.push('A tornado or two possible');
  const gust = 5 * Math.round(k.gustMph / 5), sizeValue = Math.round(k.hailInches * 4) / 4, size = `${sizeValue} inch${sizeValue === 1 ? '' : 'es'}`;
  if (k.gustMph >= 58 || p.wind10 >= 40) lines.push(`${p.wind10 >= 80 ? 'Widespread damaging winds' : p.wind10 >= 40 ? 'Scattered damaging winds' : 'Isolated damaging wind gusts'}${p.wind75 >= 40 ? ` and isolated significant gusts to ${gust} mph` : ` to ${gust} mph`} ${p.wind10 >= 60 || p.wind75 >= 80 ? 'likely' : 'possible'}`);
  if (k.hailInches >= 1 || p.hail10 >= 40) lines.push(`${p.hail10 >= 80 ? 'Widespread large hail' : p.hail10 >= 40 ? 'Scattered large hail' : 'Isolated large hail events'}${p.hail2 >= 40 ? ` and isolated very large hail events to ${size} in diameter` : ` to ${size} in diameter`} ${p.hail10 >= 60 || p.hail2 >= 80 ? 'likely' : 'possible'}`);
  return lines;
}

// The watch in words, laid out as the real ones are (the centre's SEL text), followed by its
// watch outline update listing the counties.
export function writeWatch(watch) {
  const name = title(watch), kind = name.toLowerCase().replace(' watch', ''), e = watch.here, main = threats(watch);
  const hazards = [watch.type === 'tornado' ? (watch.peak.tornadoMph >= 136 ? 'tornadoes, some of them intense' : 'tornadoes, some of them strong') : null, watch.peak.gustMph >= 58 ? 'damaging winds' : null, watch.peak.hailInches >= 1 ? 'large hail' : null].filter(Boolean);
  const lines = [
    'URGENT - IMMEDIATE BROADCAST REQUESTED', `${name} Number ${watch.number}`, 'NWS Storm Prediction Center WeatherWorld', '',
    `A ${kind} watch is in effect for ${watch.where ?? 'part of the region'}`, `from ${stamp(watch.issuedHourUtc)} until ${stamp(watch.validToHourUtc)}.`, ''
  ];
  if (watch.pds) lines.push('...THIS IS A PARTICULARLY DANGEROUS SITUATION...', '');
  lines.push('Primary threats include...', ...main.map(line => `  ${line}`), '');
  lines.push(`SUMMARY...${e.storms ? 'The storms over the watch area are expected to strengthen and last' : e.forming ? 'The storms forming over the watch area are expected to strengthen and last' : 'Storms are expected to form over the watch area and strengthen'} through the next several hours${hazards.length ? `, with ${list(hazards)}` : ''}.`, '');
  const line = watch.line;
  if (line?.from && line?.to) lines.push(`The ${kind} watch area is approximately along and ${line.widthMiles} statute miles ${line.sides} of a line from ${line.from} to ${line.to}. For a complete depiction of the watch see the associated watch outline update (WOU${watch.number}).`, '');
  lines.push(`DISCUSSION...${describeSetting(e, watch.type === 'tornado' || Boolean(watch.peakText.tornado), watch.type === 'tornado')}`, '');
  lines.push(`REMEMBER...A ${kind} watch means conditions are favorable for ${watch.type === 'tornado' ? 'tornadoes and severe thunderstorms' : 'severe thunderstorms'} in and close to the watch area. People there should watch for threatening weather and listen for later statements and warnings.`, '');
  lines.push('WATCH PROBABILITIES...', ...probabilityRows(watch).map(([label, value]) => `  ${`${label} `.padEnd(48, '.')}${value}`));
  if (watch.countyNames?.length) lines.push('', '$$', '', ...watchOutline(watch));
  return lines.join('\n');
}

// The watch outline update: the counties in the watch, in the centre's layout (upper case, in
// columns, alphabetical).
export function watchOutline(watch) {
  const names = watch.countyNames.map(name => name.toUpperCase()), rows = [];
  for (let k = 0; k < names.length; k += 4) rows.push(names.slice(k, k + 4).map(name => name.padEnd(18)).join('').trimEnd());
  return [`WOU${watch.number}`, '', `${title(watch).toUpperCase()} ${watch.number} IS IN EFFECT UNTIL ${stamp(watch.validToHourUtc)} FOR THE FOLLOWING LOCATIONS`, '', `COUNTIES INCLUDED ARE (${names.length})`, '', ...rows];
}

// What the pages get: the outline, not the cells.
export function publicWatch(watch) {
  const { cells, here, runs, counties, ...rest } = watch;
  return { ...rest, countyIds: counties?.map(index => index + 1) ?? [], title: `${title(watch)} ${watch.number}`, environment: here, table: probabilityRows(watch) };
}

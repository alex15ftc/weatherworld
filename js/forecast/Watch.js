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
import { regionRings, solidRegion, connectedPieces } from './contourShapes.js';
import { describeArea } from './DayOneOutlook.js';

export const WATCH = Object.freeze({
  // The probability of a watch (a discussion's) from which one is issued, how long it lasts
  // (hours), the least ground it covers (cells of 100 sq mi), and how far it is drawn beyond
  // the area of concern (cells).
  leastPercent: 80, hours: 6, leastCells: 150, marginCells: 2,
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
// is a cell with a report.
export function watchProbabilities(perMember) {
  const p = test => watchStep(perMember.filter(test).length / perMember.length);
  return {
    tornadoes2: p(m => m.tornadoes >= 2), strongTornado: p(m => m.strong >= 1),
    wind10: p(m => m.wind >= 10), wind75: p(m => m.gust >= 75),
    hail10: p(m => m.hailCells >= 10), hail2: p(m => m.hail >= 2), combined6: p(m => m.reports >= 6)
  };
}

// peakTornadoMph: the most probable peak tornado intensity (assessArea's).
export function particularlyDangerous(type, perMember, peakTornadoMph = 0) {
  const chance = test => watchStep(perMember.filter(test).length / perMember.length);
  if (type === 'tornado') return chance(m => m.strong >= WATCH.pdsStrongTornadoes) >= WATCH.pdsPercent && peakTornadoMph >= WATCH.pdsTornadoMph;
  return chance(m => m.gust >= WATCH.pdsGustMph && m.windSignificant >= WATCH.pdsWindCells) >= WATCH.pdsPercent;
}

// A watch for an assessed area, not yet issued (no number or times). Its ground is the area
// drawn a little wide, less any ground already under a watch (covered: a 0/1 grid).
export function draftWatch(assessed, now, { seed = null, covered = null } = {}) {
  const { width, height } = now, n = width * height, type = assessed.tornadoWatch ? 'tornado' : 'severe';
  let cells = Uint8Array.from(assessed.inside);
  for (let pass = 0; pass < WATCH.marginCells; pass++) {
    const wider = Uint8Array.from(cells);
    for (let i = 0; i < n; i++) { if (!cells[i]) continue; const x = i % width; if (x > 0) wider[i - 1] = 1; if (x < width - 1) wider[i + 1] = 1; if (i >= width) wider[i - width] = 1; if (i < n - width) wider[i + width] = 1; }
    cells = wider;
  }
  if (covered) for (let i = 0; i < n; i++) if (covered[i]) cells[i] = 0;
  // One region with no holes: where taking away ground under other watches leaves pieces,
  // the largest; gaps filled, or opened where they hold another watch.
  cells = solidRegion(cells, width, height, covered);
  const areaCells = cells.reduce((a, v) => a + v, 0);
  return {
    type, pds: particularlyDangerous(type, assessed.perMember, assessed.peak.tornadoMph), seed, members: assessed.members,
    cells, areaCells, areaSquareMiles: areaCells * now.cellMiles * now.cellMiles, where: describeArea(Array.from(cells, Boolean), width, height),
    probabilities: watchProbabilities(assessed.perMember), peak: assessed.peak, peakText: assessed.peakText, here: assessed.here, runs: assessed.perMember,
    rings: regionRings(cells, width, height)
  };
}

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
        if (said && assessed.here.forming) out.watches.push(issueWatch(draft, nextWatch + out.watches.length, issued));
        else out.pending.push(said ? draft : { ...draft, afterHourUtc: issued + WATCH.afterDiscussionHours });
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
        // Once the last word on it has lapsed.
        if (issued - last < MESOSCALE.validHours - 1e-6) continue;
        const assessed = assessArea(members, now, part);
        if (assessed.percent >= MESOSCALE.leastPercent) discuss(assessed, watch);
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
      if (follow || (assessed.percent >= MESOSCALE.leastPercent && issued - last >= MESOSCALE.validHours - 1e-6)) discuss(assessed, watch, follow && { type: follow.type, atHourUtc: follow.notBeforeHourUtc });
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
  const gust = 5 * Math.round(k.gustMph / 5), size = String(Math.round(k.hailInches * 4) / 4);
  if (k.gustMph >= 58 || p.wind10 >= 40) lines.push(`${p.wind10 >= 80 ? 'Widespread damaging winds' : p.wind10 >= 40 ? 'Scattered damaging winds' : 'Isolated damaging wind gusts'}${p.wind75 >= 40 ? ` and isolated significant gusts to ${gust} mph` : ` to ${gust} mph`} ${p.wind10 >= 60 || p.wind75 >= 80 ? 'likely' : 'possible'}`);
  if (k.hailInches >= 1 || p.hail10 >= 40) lines.push(`${p.hail10 >= 80 ? 'Widespread large hail' : p.hail10 >= 40 ? 'Scattered large hail' : 'Isolated large hail events'}${p.hail2 >= 40 ? ` and isolated very large hail events to ${size} inches in diameter` : ` to ${size} inches in diameter`} ${p.hail10 >= 60 || p.hail2 >= 80 ? 'likely' : 'possible'}`);
  return lines;
}

// The watch in words, laid out as the real ones are.
export function writeWatch(watch) {
  const name = title(watch), kind = name.toLowerCase().replace(' watch', ''), e = watch.here, main = threats(watch);
  const hazards = [watch.type === 'tornado' ? (watch.peak.tornadoMph >= 136 ? 'tornadoes, some of them intense' : 'tornadoes, some of them strong') : null, watch.peak.gustMph >= 58 ? 'damaging winds' : null, watch.peak.hailInches >= 1 ? 'large hail' : null].filter(Boolean);
  const lines = [
    'URGENT - IMMEDIATE BROADCAST REQUESTED', `${name} Number ${watch.number}`, '',
    `A ${kind} watch is in effect for ${watch.where ?? 'part of the region'}`, `from ${stamp(watch.issuedHourUtc)} until ${stamp(watch.validToHourUtc)}.`, ''
  ];
  if (watch.pds) lines.push('...THIS IS A PARTICULARLY DANGEROUS SITUATION...', '');
  lines.push('Primary threats include...', ...main.map(line => `  ${line}`), '');
  lines.push(`SUMMARY...${e.storms ? 'The storms over the watch area are expected to strengthen and last' : e.forming ? 'The storms forming over the watch area are expected to strengthen and last' : 'Storms are expected to form over the watch area and strengthen'} through the next several hours${hazards.length ? `, with ${list(hazards)}` : ''}.`, '');
  lines.push(`DISCUSSION...${describeSetting(e, watch.type === 'tornado' || Boolean(watch.peakText.tornado))}`, '');
  lines.push(`REMEMBER...A ${kind} watch means conditions are favorable for ${watch.type === 'tornado' ? 'tornadoes and severe thunderstorms' : 'severe thunderstorms'} in and close to the watch area. People there should watch for threatening weather and listen for later statements and warnings.`, '');
  lines.push('WATCH PROBABILITIES...', ...probabilityRows(watch).map(([label, value]) => `  ${`${label} `.padEnd(48, '.')}${value}`));
  return lines.join('\n');
}

// What the pages get: the outline, not the cells.
export function publicWatch(watch) {
  const { cells, here, runs, ...rest } = watch;
  return { ...rest, title: `${title(watch)} ${watch.number}`, environment: here, table: probabilityRows(watch) };
}

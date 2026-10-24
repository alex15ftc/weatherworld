// The live world's daily storm log: each convective day's storm reports and its tornadoes'
// tracks, kept for the storm reports page and the damage survey page. A day runs 12Z to 12Z,
// as the Storm Prediction Center's storm reports do; when a new day starts, the storms that
// ended before it are let go (world.stormHistory is emptied), so the world carries one day's
// history at most, and the log keeps only what the pages show, for LOG.keepDays days.
//
// Reports come in where someone is there to see them. A tornado is reported once, where it is
// first seen within LOG.seenMiles of a town (less at night). Hail and wind are reported where
// they fall: each falls in a swath, largest in the middle and smaller toward its edges (hail from
// the core's size at its middle to nothing at the edge of the core, StormGeometry's hail radius;
// a gust from the storm's strongest at the middle of a downburst to nothing LOG.burstRadiusKm out), so a
// storm only just severe has a narrow swath of severe hail or wind and a strong one a wide swath.
// A town inside the swath reports what fell there, once for each storm and hazard, from where
// the storm passed closest; whether it sends a report in at all is a fixed draw that its people
// make likelier (1 - exp(-population / LOG.reportPopulation): about one in three towns of 500,
// four in five of 2,500). Out in the country, people along the way (farms, travellers, spotters)
// report too: a chance every LOG.spotterSpacingMiles of the path, likelier near towns and by day,
// from a place across the swath and the size or gust there. Hail is reported at the common sizes;
// wind as a measured gust where a town big enough for a weather station is close
// (LOG.stationPopulation), otherwise as damage of unknown speed. Each report names the office
// whose county it is in. Every tornado is logged, seen or not: the survey finds them all.
// (2026-10-22: until then a town within 5 miles of the storm's middle reported the core's own
// size or gust and nobody else reported: 1.2 hail reports per 100 km of severe hail path where
// real busy days give 5 to 15, every report the largest stone, and a wind report from nearly
// every town a storm with a 60 mph gust passed.)
export const LOG = Object.freeze({
  keepDays: 14, seenMiles: { day: 10, night: 4 }, reportPopulation: 1500,
  stationPopulation: 10000, stationMiles: 3, hailInches: 1, windMph: 58, lineSpacingMiles: 25, lineEndShare: 0.8,
  // A line's wind comes down in cores (bows, downbursts) a spot apart: each spot's gust is drawn
  // between coreFloorShare and all of the storm's strongest, afresh every coreMinutes, with one spot
  // at a time carrying the strongest. (2026-10-23: every spot along a line had nearly the storm's
  // strongest gust, and on one day of seed 2112 a line's whole length was severe all afternoon.)
  coreFloorShare: 0.6, coreMinutes: 20,
  // How far from the middle of a downburst (or a line's surge) its gust has fallen to nothing (km):
  // a storm's strongest gust is in a few small places, not across all of its outflow (with the
  // whole outflow, a storm with a 67 mph gust laid severe wind 8 miles wide along its path).
  // (6 until 2026-10-23, with damageMph [50, 80]: a 60-70 mph gust left severe wind under a mile
  // wide, and wind reports all but vanished, none from a squall line or from 219 storms in a day.)
  // A line's surge spreads wider where its rear-inflow jet comes down (its bows): up to lineBurstKm
  // more for a fully organized line with rear inflow of fullRearInflow or more. (2026-10-23: the
  // whole of every organized line laid the wide swath, and on one day of seed 2112 severe wind
  // covered most of the map: real line damage is patchy, wide only where the line bows out.)
  burstRadiusKm: 10, lineBurstKm: 20, fullRearInflow: 0.5,
  // Reports from the country: one chance every spotterSpacingMiles of path, as likely as
  // spotterChance for a severe swath spotterSwathMiles wide (less for a narrower one: fewer people
  // under it), by day next to a town; falling to spotterRemoteShare of that far from one (over
  // spotterTownMiles), and spotterNightShare of that by night.
  spotterSpacingMiles: 4, spotterChance: 0.9,
  // A place reports once: a patch of country placeMiles across (about what one rural reporter covers)
  // that has reported a hazard reports it again only placeMemoryHours later. (2026-10-23: each spot
  // along a line kept its own spotters, every spotterSpacingMiles, and the line's spots and the storms
  // beside it swept the same farms one after another: 1,984 wind reports on one day of seed 2112,
  // one for each 16 square miles of severe wind, where real derecho days give one for 50-60.)
  placeMiles: 8, placeMemoryHours: 2,
  // A wind report is a report of damage (or a station's measured gust): a gust of damageMph[0]
  // seldom brings anything down, one of damageMph[1] or more nearly always does; between, the
  // chance of damage to report rises evenly.
  damageMph: [45, 75], spotterSwathMiles: 3, spotterRemoteShare: 0.35, spotterTownMiles: 12, spotterNightShare: 0.4
});
const HAIL_SIZES = [[1, 'Quarter'], [1.25, 'Half dollar'], [1.5, 'Ping pong ball'], [1.75, 'Golf ball'], [2, 'Hen egg'], [2.5, 'Tennis ball'], [2.75, 'Baseball'], [3, 'Tea cup'], [4, 'Softball'], [4.5, 'Grapefruit']];

// The convective day an hour is in: day 1 runs from hour 12 to hour 36.
export const convectiveDay = hourUtc => Math.floor((hourUtc - 12) / 24) + 1;

// After each storm tick of the live world. places: { layer, milesPerKm } (the counties, as the
// warnings use them), or null.
export function logStormTick(world, places = null) {
  const log = world.reportLog ??= { day: null, days: {}, open: {}, last: {} };
  // Which world the log is of, for whatever keeps its days beyond it (the Roblox report archive):
  // a new world numbers its days from 1 again. It is saved with the world, so a restart keeps it.
  log.worldId ??= `${Number(world.seed ?? 0).toString(36)}${Date.now().toString(36)}`;
  const hourUtc = world.stormEngine?.validHourUtc ?? world.validHourUtc, day = convectiveDay(hourUtc);
  if (log.day !== day) {
    if (log.day !== null) world.stormHistory = [];
    log.day = day;
    for (const key of Object.keys(log.days)) if (Number(key) <= day - LOG.keepDays) delete log.days[key];
  }
  const today = dayOf(log, day);
  const k = places?.milesPerKm ?? 0.621371, layer = places?.layer ?? null;
  const solar = ((hourUtc - 6) % 24 + 24) % 24, daylight = solar >= 6 && solar <= 19.5;
  const seen = new Set(), touched = new Set(), moved = {};
  log.passes ??= {};
  for (const storm of world.storms ?? []) {
    if (!storm.active) continue;
    const t = storm.tornado;
    if (t?.onGround) {
      const key = `${storm.id}-${t.cycleCount}`;
      seen.add(key);
      let ref = log.open[key];
      if (!ref) {
        const startDay = convectiveDay(t.startedHourUtc ?? hourUtc), home = dayOf(log, startDay);
        const first = t.trackPoints?.[0];
        home.tornadoes.push({ id: `${storm.id}-T${t.cycleCount}`, stormId: storm.id, cycle: t.cycleCount, day: startDay, ended: false, endHourUtc: null, reported: false, points: first && first.hourUtc < hourUtc - 1e-6 ? [[r(first.x), r(first.y), r(first.hourUtc, 4), Math.round(t.windSpeedMph), Math.round(t.widthYards)]] : [] });
        ref = log.open[key] = { day: startDay, index: home.tornadoes.length - 1 };
      }
      const entry = log.days[ref.day]?.tornadoes[ref.index];
      if (entry) {
        entry.points.push([r(t.positionKm.x), r(t.positionKm.y), r(hourUtc, 4), Math.round(t.windSpeedMph), Math.round(t.widthYards)]);
        if (!entry.reported) {
          const where = spot(layer, t.positionKm.x * k, t.positionKm.y * k);
          if (!layer || where.miles <= (daylight ? LOG.seenMiles.day : LOG.seenMiles.night)) {
            entry.reported = true;
            today.reports.push(report('tornado', hourUtc, t.positionKm, k, where, storm.id, { tornadoId: entry.id, comment: daylight ? 'Tornado reported on the ground.' : 'Tornado reported after dark; confirmed by power flashes and law enforcement.' }));
          }
        }
      }
    }
    // Hail where the storm's core is, and wind along a line's length (a spot every
    // LOG.lineSpacingMiles): each pass of the storm by a town is followed, and reported (or
    // not, by the town's draw) from where the storm came closest to it. The storm moves 4-5 miles
    // between ticks, more than a town's reach at night, so a pass is judged along its path
    // since the last tick, not only where it is now.
    const was = log.prev?.[storm.id], move = was && hourUtc - was.hourUtc < 0.75 ? { x: storm.positionKm.x - was.x, y: storm.positionKm.y - was.y, hourUtc: was.hourUtc } : null;
    moved[storm.id] = { x: storm.positionKm.x, y: storm.positionKm.y, hourUtc };
    const pathMiles = move ? Math.hypot(move.x, move.y) * k : 0;
    // Hail: the size falls from the core's at its middle to nothing at the core's edge.
    const hail = Number(storm.currentHailSizeInches ?? storm.hazards?.hailSizeInches ?? 0);
    if (hail >= LOG.hailInches) {
      const core = storm.geometry?.hail, at = core && Number.isFinite(core.xKm) ? { x: core.xKm, y: core.yKm } : storm.positionKm;
      const swath = { peak: hail, radiusMiles: (1.5 + 1.6 * hail) * k, least: LOG.hailInches };
      follow(log, 'hail', storm.id, at, move, swath, layer, k, hourUtc, touched);
      spotters(log, 'hail', storm.id, 0, at, move, pathMiles, swath, layer, k, daylight, hourUtc);
    }
    // Wind: the gust falls from the strongest at a downburst's middle to nothing at its edge.
    const gust = Number(storm.surfaceWind?.gustMph ?? 0);
    if (gust >= LOG.windMph) {
      const bowing = Math.max(0, Math.min(1, (Number(storm.rearInflow) || 0) / LOG.fullRearInflow));
      const radiusMiles = (LOG.burstRadiusKm + LOG.lineBurstKm * Math.max(0, Math.min(1, Number(storm.lineOrganization) || 0)) * bowing) * k;
      for (const { x, y, share, slot } of windSpots(storm, k, hourUtc)) {
        if (gust * share < LOG.windMph) continue;
        const swath = { peak: gust * share, radiusMiles, least: LOG.windMph };
        follow(log, 'wind', storm.id, { x, y }, move, swath, layer, k, hourUtc, touched);
        spotters(log, 'wind', storm.id, slot, { x, y }, move, pathMiles, swath, layer, k, daylight, hourUtc);
      }
    }
  }
  log.prev = moved;
  // The country's odometers of storms that are gone.
  for (const key of Object.keys(log.odometer ?? {})) if (!(key.slice(0, key.indexOf('|')) in moved)) delete log.odometer[key];
  for (const [patch, when] of Object.entries(log.places ?? {})) if (hourUtc - when >= LOG.placeMemoryHours) delete log.places[patch];
  // Passes that came no closer this tick are over: reported from their closest point.
  for (const [key, pass] of Object.entries(log.passes)) {
    if (touched.has(key)) continue;
    delete log.passes[key];
    log.last[key] = pass.hourUtc;
    if (layer && unit(key) >= 1 - Math.exp(-pass.population / LOG.reportPopulation)) continue;
    const where = spot(layer, pass.x * k, pass.y * k), home = dayOf(log, convectiveDay(pass.hourUtc));
    const atStation = Boolean(where.town && where.town.population >= LOG.stationPopulation && where.miles <= LOG.stationMiles);
    if (pass.hazard === 'wind' && !atStation && unit(`${key}|damage`) >= damageShare(pass.value)) continue;
    home.reports.push(hazardReport(pass.hazard, pass.hourUtc, pass, k, where, pass.stormId, pass.value, pass.hazard === 'wind' && atStation));
  }
  // Tornadoes no longer on the ground. The engine moves a tornado through its last step before
  // ending it, so that last stretch (and why it ended, and the life it was drawn) is taken from
  // its own record of it (storm.tornadoHistory, on the storm or, once the storm is gone, its
  // archive).
  for (const key of Object.keys(log.open)) {
    if (seen.has(key)) continue;
    const ref = log.open[key], entry = log.days[ref.day]?.tornadoes[ref.index];
    if (entry) {
      const owner = (world.storms ?? []).find(s => s.id === entry.stormId) ?? (world.stormArchive ?? []).find(s => s.id === entry.stormId);
      const record = (owner?.tornadoHistory ?? []).find(h => h.cycle === entry.cycle);
      const last = entry.points.at(-1);
      for (const p of record?.trackPoints ?? []) if (last && p.hourUtc > last[2] + 1e-6) entry.points.push([r(p.x), r(p.y), r(p.hourUtc, 4), last[3], last[4]]);
      entry.ended = true; entry.endHourUtc = entry.points.at(-1)?.[2] ?? hourUtc;
      if (record) { entry.endedBy = record.endedBy ?? null; entry.lifeMinutes = record.lifeMinutes ?? null; }
    }
    delete log.open[key];
  }
  // Any tornado the engine recorded that the log never saw on the ground (one that came and went
  // within a long step) is taken from that record.
  const known = new Set(Object.values(log.days).flatMap(d => d.tornadoes.map(t => t.id)));
  for (const owner of [...(world.storms ?? []), ...(world.stormArchive ?? [])]) for (const h of owner.tornadoHistory ?? []) {
    const id = `${owner.id}-T${h.cycle}`;
    if (known.has(id) || !h.trackPoints?.length || convectiveDay(h.startedHourUtc ?? hourUtc) <= day - LOG.keepDays) continue;
    known.add(id);
    const startDay = convectiveDay(h.startedHourUtc ?? h.trackPoints[0].hourUtc), home = dayOf(log, startDay);
    const entry = { id, stormId: owner.id, cycle: h.cycle, day: startDay, ended: true, endHourUtc: h.trackPoints.at(-1).hourUtc, reported: false, endedBy: h.endedBy ?? null, lifeMinutes: h.lifeMinutes ?? null,
      points: h.trackPoints.map(p => [r(p.x), r(p.y), r(p.hourUtc, 4), Math.round(h.peakWindSpeedMph ?? 65), Math.round(h.peakWidthYards ?? 30)]) };
    home.tornadoes.push(entry);
    for (const p of h.trackPoints) {
      const where = spot(layer, p.x * k, p.y * k), sun = ((p.hourUtc - 6) % 24 + 24) % 24, lit = sun >= 6 && sun <= 19.5;
      if (layer && where.miles > (lit ? LOG.seenMiles.day : LOG.seenMiles.night)) continue;
      entry.reported = true;
      home.reports.push(report('tornado', p.hourUtc, p, k, where, owner.id, { tornadoId: id, comment: lit ? 'Tornado reported on the ground.' : 'Tornado reported after dark; confirmed by power flashes and law enforcement.' }));
      break;
    }
  }
  for (const key of Object.keys(log.last)) if (hourUtc - log.last[key] > 6) delete log.last[key];
  return log;
}

// What falls a distance (miles) from the middle of a swath { peak, radiusMiles, least }: from the
// peak at the middle to nothing at radiusMiles. And how far out it is still at least the least
// that is reported.
const swathValue = (swath, miles) => swath.peak * Math.max(0, 1 - miles / swath.radiusMiles);
const damageShare = mph => Math.max(0, Math.min(1, (mph - LOG.damageMph[0]) / (LOG.damageMph[1] - LOG.damageMph[0])));
const swathReach = swath => swath.radiusMiles * Math.max(0, 1 - swath.least / swath.peak);

// A storm's hazard passing towns: each town inside its swath along its path since the last tick
// (move: how far it came, km, and from when; null for a storm just seen) is followed while the
// storm comes closer to it (each storm, hazard and town once; log.last holds the passes that are
// over), and reports what fell where it came closest.
function follow(log, hazard, stormId, km, move, swath, layer, k, hourUtc, touched) {
  const reach = layer ? swathReach(swath) : Infinity;
  if (!(reach > 0)) return;
  const bx = km.x * k, by = km.y * k, dx = (move?.x ?? 0) * k, dy = (move?.y ?? 0) * k, ax = bx - dx, ay = by - dy, length = dx * dx + dy * dy;
  const x0 = Math.min(ax, bx) - reach, x1 = Math.max(ax, bx) + reach, y0 = Math.min(ay, by) - reach, y1 = Math.max(ay, by) + reach;
  for (const town of layer ? layer.towns : [null]) {
    let f = 1, miles = 0;
    if (town) {
      if (town.x < x0 || town.x > x1 || town.y < y0 || town.y > y1) continue;
      f = length > 0 ? Math.max(0, Math.min(1, ((town.x - ax) * dx + (town.y - ay) * dy) / length)) : 1;
      miles = Math.hypot(ax + dx * f - town.x, ay + dy * f - town.y);
      if (miles > reach) continue;
    }
    const value = town ? swathValue(swath, miles) : swath.peak;
    const key = `${stormId}|${hazard}|${town?.name ?? ''}`;
    if (key in log.last) continue;
    const pass = log.passes[key];
    if (pass && miles >= pass.miles) continue;
    const back = 1 - f;
    log.passes[key] = { hazard, stormId, x: km.x - (move?.x ?? 0) * back, y: km.y - (move?.y ?? 0) * back, hourUtc: hourUtc - (move ? (hourUtc - move.hourUtc) * back : 0), miles, population: town?.population ?? 0, value: Math.max(value, pass?.value ?? 0) };
    touched.add(key);
  }
}
// Reports from the country along a hazard's path: a chance every LOG.spotterSpacingMiles (an
// odometer for each storm, hazard and place along a line), from a place across the swath drawn
// for it, reporting what fell there.
function spotters(log, hazard, stormId, slot, km, move, pathMiles, swath, layer, k, daylight, hourUtc) {
  if (!layer || !move || !(pathMiles > 0)) return;
  const reach = swathReach(swath);
  if (!(reach > 0)) return;
  log.odometer ??= {};
  const key = `${stormId}|${hazard}|${slot}`, before = log.odometer[key] ?? 0, after = before + pathMiles;
  log.odometer[key] = after;
  const length = Math.hypot(move.x, move.y), across = { x: -move.y / length, y: move.x / length };
  for (let n = Math.floor(before / LOG.spotterSpacingMiles) + 1; n * LOG.spotterSpacingMiles <= after; n++) {
    const back = (after - n * LOG.spotterSpacingMiles) / pathMiles, draw = `${key}|${n}`;
    const offsetMiles = (2 * unit(`${draw}|across`) - 1) * reach, value = swathValue(swath, Math.abs(offsetMiles));
    if (value < swath.least) continue;
    const at = { x: km.x - move.x * back + across.x * offsetMiles / k, y: km.y - move.y * back + across.y * offsetMiles / k };
    const where = spot(layer, at.x * k, at.y * k);
    const chance = LOG.spotterChance * Math.min(1, 2 * reach / LOG.spotterSwathMiles) * (daylight ? 1 : LOG.spotterNightShare) * (LOG.spotterRemoteShare + (1 - LOG.spotterRemoteShare) * Math.exp(-where.miles / LOG.spotterTownMiles));
    if (unit(draw) >= chance * (hazard === 'wind' ? damageShare(value) : 1)) continue;
    const when = hourUtc - (hourUtc - move.hourUtc) * back;
    log.places ??= {};
    const patch = `${hazard}|${Math.floor(at.x * k / LOG.placeMiles)}|${Math.floor(at.y * k / LOG.placeMiles)}`;
    if (when - (log.places[patch] ?? -Infinity) < LOG.placeMemoryHours) continue;
    log.places[patch] = when;
    dayOf(log, convectiveDay(when)).reports.push(hazardReport(hazard, when, at, k, where, stormId, value, false));
  }
}

// A hail or wind report of what fell (inches or mph) where it was seen; atStation: a town's
// automated station is there to measure the gust.
function hazardReport(hazard, hourUtc, km, k, where, stormId, value, atStation) {
  if (hazard === 'hail') {
    const [size, name] = HAIL_SIZES.filter(([s]) => s <= value + 1e-9).at(-1);
    return report('hail', hourUtc, km, k, where, stormId, { size: Math.round(size * 100), comment: `${name}-sized hail.` });
  }
  const mph = Math.round(value);
  return report('wind', hourUtc, km, k, where, stormId, atStation
    ? { speed: mph, measured: true, comment: `Measured ${mph} mph gust at the ${where.town.name} automated station.` }
    : { speed: null, measured: false, estimatedMph: mph, comment: mph >= 90 ? 'Widespread wind damage; roofs and walls of buildings damaged, large trees down.' : mph >= 75 ? 'Large trees uprooted and power poles snapped; roof damage to homes.' : 'Trees and power lines down.' });
}

function unit(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function dayOf(log, day) { return log.days[day] ??= { day, startHourUtc: 12 + 24 * (day - 1), reports: [], tornadoes: [] }; }
const r = (v, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;

// The nearest town to a point (miles), and the point's county and office.
function spot(layer, x, y) {
  if (!layer) return { town: null, miles: 0, county: null, office: null, x, y };
  let town = null, miles = Infinity;
  for (const t of layer.towns) { const d = Math.hypot(t.x - x, t.y - y); if (d < miles) { miles = d; town = t; } }
  const index = layer.at?.(x, y) ?? -1, county = index >= 0 ? layer.counties[index] : null;
  return { town, miles, county: county?.name ?? null, office: county?.office ?? null, x, y, bearing: town ? compass(Math.atan2(x - town.x, -(y - town.y)) * 180 / Math.PI) : '' };
}
const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = deg => POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

function report(type, hourUtc, km, k, where, stormId, extra) {
  const miles = Math.round(where.miles);
  return {
    type, hourUtc: r(hourUtc, 4), stormId, x: r(km.x * k), y: r(km.y * k),
    location: where.town ? (miles < 1 ? where.town.name : `${miles} ${where.bearing} ${where.town.name}`) : 'Unknown',
    county: where.county, office: where.office, ...extra
  };
}

// Where a storm's wind is (km): its centre, or spots along a line's length.
function windSpots(storm, k, hourUtc = 0) {
  const lineLike = Number.isFinite(storm.lineOrganization) ? storm.lineOrganization >= 0.5 : /line|QLCS|MCS/.test(storm.mode ?? '');
  const half = lineLike ? Number(storm.lineHalfLengthKm ?? storm.radar?.radiusXKm) || 0 : 0;
  const speed = Math.hypot(storm.velocityKph?.east ?? 0, storm.velocityKph?.north ?? 0), spacing = LOG.lineSpacingMiles / k;
  if (half < spacing / 2 || !(speed > 1)) return [{ x: storm.positionKm.x, y: storm.positionKm.y, share: 1, slot: 0 }];
  const ax = storm.velocityKph.north / speed, ay = storm.velocityKph.east / speed, out = [];
  const first = -Math.floor(half / spacing), last = Math.floor((half + 1e-6) / spacing), window = Math.floor(hourUtc * 60 / LOG.coreMinutes + 1e-6);
  const strongest = first + Math.floor(unit(`${storm.id}|cores|${window}`) * (last - first + 1));
  for (let n = first; n <= last; n++) {
    const d = n * spacing, core = n === strongest ? 1 : LOG.coreFloorShare + (1 - LOG.coreFloorShare) * unit(`${storm.id}|core|${n}|${window}`);
    out.push({ x: storm.positionKm.x + ax * d, y: storm.positionKm.y + ay * d, share: core * (1 - (1 - LOG.lineEndShare) * Math.abs(d) / half), slot: n });
  }
  return out;
}

// The days the log holds, newest first, with their report and tornado counts.
export function logDays(log) {
  return Object.values(log?.days ?? {}).sort((a, b) => b.day - a.day).map(d => ({
    day: d.day, startHourUtc: d.startHourUtc, tornadoes: d.tornadoes.length,
    reports: { tornado: d.reports.filter(x => x.type === 'tornado').length, hail: d.reports.filter(x => x.type === 'hail').length, wind: d.reports.filter(x => x.type === 'wind').length }
  }));
}

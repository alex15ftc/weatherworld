// Warnings, after the National Weather Service's storm-based, impact-based warnings: a
// tornado warning or a severe thunderstorm warning for the path of a storm over the next half
// hour or so, drawn as a polygon from where the storm is along where it is going. They are
// worked out at every volume scan (every 5 minutes of storm time) from what a forecaster at the
// radar sees of each storm: its low-level rotation (as the chance of a tornado in the next half
// hour, TornadoEngine.js), a tornado on the ground, the size of its hail and the speed of its
// gusts (StormHazards.js). Nothing is written onto the storms; the warnings only read them.
//   - Severe thunderstorm warning: hail of 1 inch or more, or gusts of 58 mph or more. Its
//     damage threat follows the NWS tiers: CONSIDERABLE from 1.75 inch hail or 70 mph gusts,
//     DESTRUCTIVE from 2.75 inch hail or 80 mph gusts (the tier that sets off Wireless
//     Emergency Alerts). Under neither, no tag: the base warning. "TORNADO...POSSIBLE" is
//     added when the storm's rotation gives some chance of a tornado.
//   - Tornado warning: radar-indicated rotation strong enough for a good chance of a tornado
//     in the next half hour, or a tornado on the ground. It says OBSERVED once the tornado has
//     been down long enough to be confirmed (a debris signature or a spotter's report), and
//     becomes a particularly dangerous situation (TORNADO DAMAGE THREAT...CONSIDERABLE) when a
//     confirmed tornado is a strong one (EF2 winds, 111 mph, or more).
//   - Tornado emergency (TORNADO DAMAGE THREAT...CATASTROPHIC), after NWSI 10-511 3.3.4.1(c):
//     for the exceedingly rare tornado where all three hold at once: it is confirmed (seen, or
//     its debris on radar); catastrophic damage is ongoing or imminent (a violent tornado:
//     EF3 winds, 136 mph, or more, as WDTD's 70 kt rotational velocity and the record of real
//     emergencies, 70% EF3+, have it); and a severe threat to human life is ongoing or
//     imminent: a town on the tornado's track within the warning in the next quarter hour or
//     so ("approaching a population center", WDTD). The headline names those towns, as the
//     directive requires named locations. So a violent tornado over open country stays a PDS
//     warning, and one bearing down on a town becomes an emergency; it drops back to PDS when
//     the tornado weakens or the towns are behind it. Without towns (no county layer) there is
//     nothing to name and no emergency.
//   - A warning's polygon does not move: it covers the storm and where it is expected to go
//     in the time the warning runs, widening ahead for the uncertainty in its motion. A storm
//     about to leave its warning, or under one about to expire, gets a new one downstream.
//     Polygons may overlap, as real ones do.
//   - Statements (severe weather statements) follow a warning: when its tags change (a
//     tornado confirmed, a damage threat raised or lowered) and when it is cancelled because
//     no storm in it still warrants it. Otherwise it runs until it expires.
//   - A storm under a tornado warning gets no severe thunderstorm warning as well: the tornado
//     warning carries its hail. One already out stays in effect.
//   - With the map's counties (createWarningState(counties)), a warning names what its polygon
//     covers as the Weather Service's do: each county, or the part of it ("Northeastern Barton
//     County in the Smoky Hills"), and the towns inside ("Locations impacted include..."); the
//     storm is placed from the nearest town ("8 miles southwest of Hoisington"). Without them,
//     from the nearest radar.
//   - Where the counties carry the NWS offices' county warning areas (js/worldmap/warningAreas.js),
//     each office warns only inside its own, as WarnGen keeps a polygon to the office's CWA: the
//     storm's path is cut along the CWA lines, and each office it crosses issues its own warning
//     for its piece, numbered in that office's own series (the VTEC event tracking number) and
//     headed with the office ("National Weather Service Dodge City"). A piece downstream is kept
//     while its storm is on the way to it, and once the storm has passed through, its office
//     cancels it as the storm moves out. Pieces are drawn with 3 to 20 vertices (NWSI 10-511).
import { polygonCounties, nearestTown, countyRings } from './counties.js';

export const WARNING = Object.freeze({
  // How long each runs (minutes): NWS tornado warnings default to 30 minutes since 2012;
  // severe thunderstorm warnings are mostly 30-60.
  // (Severe 45 to 60 on 2026-10-20: re-issued every 25-35 minutes along a 40 mph storm, one office's
  // severe thunderstorm warnings reached number 140 in two days.)
  minutes: { tornado: 30, severe: 60 },
  // Tornado: the chance of one in the next half hour from which a radar-indicated warning is
  // issued, below which a warning is no longer warranted, and from which a severe
  // thunderstorm warning says a tornado is possible.
  tornadoChance: 0.3, keepTornadoChance: 0.12, possibleTornadoChance: 0.12,
  // ...and earlier, as forecasters warn on a mesocyclone tightening toward the ground before a
  // tornado is likely: from earlyTornadoChance where the low-level rotation is strengthening by
  // earlyTrendPerHour or more, or the mesocyclone is at least earlyMesocyclone (2026-10-20; until
  // then warnings went out with the tornado, a median lead of 0 minutes, where the NWS's is 8-10,
  // with a false-alarm ratio of 0.5 against the NWS's 0.7). Such a warning is kept while the chance
  // stays at earlyKeepChance with the mesocyclone still that strong.
  earlyTornadoChance: 0.08, earlyTrendPerHour: 0.25, earlyMesocyclone: 0.5, earlyKeepChance: 0.05,
  // (Tried 2026-10-20: also warning on a strong mesocyclone in inflow STP of 1 or more. With the
  // tornado lifetimes of the same day the median lead was already 10 minutes on seed 8181 (false
  // alarms 0.63); the extra path added no lead and took false alarms to 0.68-0.87. Not kept.)
  // Minutes on the ground before a tornado counts as confirmed, and the wind (mph) from which
  // a confirmed one makes it a particularly dangerous situation (EF2).
  confirmMinutes: 10, considerableTornadoMph: 111,
  // Tornado emergency: the wind (mph) of a confirmed tornado from which the damage it does is
  // catastrophic (EF3), and how many minutes ahead along its track a town counts as threatened.
  // A town is on the track within the tornado's half-width plus trackMarginKm of its line,
  // widening ahead by spreadDeg for the uncertainty in its motion.
  // emergencyMinPopulation: the fewest people a town on the track needs to count as a
  // population center (0: any town).
  catastrophicTornadoMph: 136, emergencyMinutes: 15, trackMarginKm: 1, emergencyMinPopulation: 1000,
  // Severe limits, the lower ones that keep a warning going, and the damage tiers.
  severeHailInches: 1, severeGustMph: 58, keepHailInches: 0.75, keepGustMph: 50,
  considerable: { hailInches: 1.75, gustMph: 70 }, destructive: { hailInches: 2.75, gustMph: 80 },
  // ...and earlier, as forecasters warn on a core still growing toward the limits: hail of at
  // least soonFloor.hailInches (or gusts of soonFloor.gustMph) rising fast enough over the last
  // scan to reach severe within soonMinutes (2026-10-20; until then a warning went out with the
  // first severe hail, a median lead of 0 minutes where the NWS's is 15-20).
  soonMinutes: 15, soonFloor: { hailInches: 0.75, gustMph: 50 },
  // Minutes of severe hail or wind under a warning before reports have come in (OBSERVED).
  observedMinutes: 15,
  // The tags give the most seen over the last tagMinutes (a scan or two of noise is not news);
  // a warning is cancelled after quietScans scans in a row with no storm in it warranting it.
  // (quietScans 2 to 4 on 2026-10-20: a storm whose hail sat near an inch was warned, cancelled and warned again.)
  tagMinutes: 15, quietScans: 4,
  // The polygon: how far the motion may turn either way (degrees), how much faster the storm
  // may go, how far behind the storm it starts, how far beyond the hazard its sides lie, the
  // most its half-width may be, and the most a gust front's lead adds ahead of a storm (km).
  // Set 2026-10-14 so a single storm's warning is a few hundred square miles for a tornado and
  // under a thousand for hail and wind, as the NWS's are; a line's runs along the line.
  spreadDeg: 15, speedMargin: 1.15, behindKm: 5, edgeKm: { tornado: 6, severe: 6 }, widestKm: 50, gustLeadKm: 10,
  // A storm within this many minutes of leaving its warning, or of its warning expiring, gets a new one.
  leadMinutes: 10,
  // How soon (minutes) a storm must be due in a neighbouring office's area for that office's piece to go out with the first.
  downstreamMinutes: 15,
  // Most vertices in a polygon (NWSI 10-511).
  vertices: 20,
  // Where the map lies on the earth, for the LAT...LON and TIME...MOT...LOC lines: its north-west
  // corner (degrees north and east), with x east and y south from it in km.
  mapNorthwest: [40.9, -101.6],
  kept: 60
});

const MILES_PER_KM = 0.621371, KT_PER_KPH = 0.539957;
const HAIL_SIZES = [[4.5, 'Softball'], [4, 'Grapefruit'], [3, 'Teacup'], [2.75, 'Baseball'], [2.5, 'Tennis ball'], [2, 'Hen egg'], [1.75, 'Golf ball'], [1.5, 'Ping pong ball'], [1.25, 'Half dollar'], [1, 'Quarter'], [0.75, 'Penny']];
const POINTS = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast', 'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest'];
const compass = deg => POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
export const clock = hourUtc => { const h = ((hourUtc % 24) + 24) % 24, total = Math.round(h * 60) % 1440; return `${String(Math.floor(total / 60)).padStart(2, '0')}${String(total % 60).padStart(2, '0')}Z`; };

// The tags: the hail size named at or below the stone (the standard sizes), and the gust in
// steps of 5 mph, 60 at the least once it is severe.
export const hailTag = inches => HAIL_SIZES.find(([size]) => inches >= size - 1e-6)?.[0] ?? 0;
export const windTag = mph => (mph >= WARNING.severeGustMph ? Math.max(60, 5 * Math.floor(mph / 5)) : 5 * Math.floor(Math.max(0, mph) / 5));
const hailName = inches => HAIL_SIZES.find(([size]) => Math.abs(size - inches) < 1e-6)?.[1] ?? '';
export function thunderstormDamage(hailInches, gustMph) {
  const at = tier => hailInches >= tier.hailInches - 1e-6 || gustMph >= tier.gustMph;
  return at(WARNING.destructive) ? 'DESTRUCTIVE' : at(WARNING.considerable) ? 'CONSIDERABLE' : null;
}

// What the radar shows of a storm at this scan.
export function observeStorm(storm) {
  const tornado = storm.tornado ?? {};
  const onGround = Boolean(tornado.onGround);
  return {
    id: storm.id, x: storm.positionKm.x, y: storm.positionKm.y,
    east: storm.velocityKph?.east ?? 0, north: storm.velocityKph?.north ?? 0,
    hail: Number(storm.currentHailSizeInches) || 0, gust: Number(storm.surfaceWind?.gustMph) || 0,
    chance: Number(tornado.probability) || 0, onGround, trend: Number(storm.lowRotationTrend) || 0, mesocyclone: Number(storm.mesocycloneStrength) || 0,
    confirmed: onGround && (tornado.groundTimeMinutes ?? 0) >= WARNING.confirmMinutes - 1e-6,
    tornadoMph: onGround ? Number(tornado.windSpeedMph) || 0 : 0,
    // Where the tornado is (km) and how wide it is (yards), while it is on the ground.
    tornadoX: onGround ? tornado.positionKm?.x ?? storm.positionKm.x : null, tornadoY: onGround ? tornado.positionKm?.y ?? storm.positionKm.y : null,
    tornadoWidthYards: onGround ? Number(tornado.widthYards) || 0 : 0,
    // How far each hazard reaches across the storm's path (km): a tornado from under the wall
    // cloud; hail and wind across the hail core or along a line. And how far the gust front
    // runs ahead of it.
    tornadoReachKm: storm.geometry?.wallCloud?.radiusKm ?? 1,
    severeReachKm: Math.max(storm.geometry?.hail?.radiusKm ?? 0, storm.geometry?.line?.halfLengthKm ?? 0, 4),
    gustLeadKm: storm.geometry?.gustFront?.leadKm ?? 0
  };
}
// The storm's hail and gust trends (per hour) from the last scan it was seen at.
function withTrend(look, seen, hour) {
  const dt = seen ? hour - seen.hourUtc : 0;
  const ok = dt > 1e-6 && dt <= 0.2;
  return { ...look, hailTrend: ok ? (look.hail - seen.hail) / dt : 0, gustTrend: ok ? (look.gust - seen.gust) / dt : 0 };
}
// (Tried 2026-10-20: dropping the strong-mesocyclone path, or asking 0.65 of it. False alarms fell
// from about 0.75 to 0.62-0.72 but the median lead from 5-10 minutes to 0-5; kept as it is.)
const early = look => look.chance >= WARNING.earlyTornadoChance && (look.trend >= WARNING.earlyTrendPerHour || look.mesocyclone >= WARNING.earlyMesocyclone);
const soon = look => {
  const ahead = WARNING.soonMinutes / 60, f = WARNING.soonFloor;
  return (look.hail >= f.hailInches && look.hail + (look.hailTrend ?? 0) * ahead >= WARNING.severeHailInches) || (look.gust >= f.gustMph && look.gust + (look.gustTrend ?? 0) * ahead >= WARNING.severeGustMph);
};
const warrants = (type, look) => (type === 'tornado' ? look.onGround || look.chance >= WARNING.tornadoChance || early(look) : look.hail >= WARNING.severeHailInches || look.gust >= WARNING.severeGustMph || soon(look));
const keeps = (type, look) => (type === 'tornado' ? look.onGround || look.chance >= WARNING.keepTornadoChance || (look.chance >= WARNING.earlyKeepChance && look.mesocyclone >= WARNING.earlyMesocyclone) : look.hail >= WARNING.severeHailInches * 0.75 || look.gust >= WARNING.keepGustMph);
const threat = look => (look.onGround ? 10 : 0) + look.chance * 5 + look.hail + look.gust / 60;

// The polygon (km, y southward): from just behind the storm along its motion for the time the
// warning runs, widening ahead by the spread in its direction.
export function warningPolygon(type, look) {
  const speed = Math.hypot(look.east, look.north), minutes = WARNING.minutes[type];
  const along = speed > 3 ? { x: look.east / speed, y: -look.north / speed } : { x: 1, y: 0 }, across = { x: -along.y, y: along.x };
  const reach = type === 'tornado' ? look.tornadoReachKm : look.severeReachKm;
  const half = Math.min(WARNING.widestKm, reach + WARNING.edgeKm[type]);
  const back = WARNING.behindKm + Math.min(reach, WARNING.edgeKm[type]), ahead = speed * WARNING.speedMargin * minutes / 60 + (type === 'tornado' ? reach : Math.min(WARNING.gustLeadKm, look.gustLeadKm ?? 0)) + WARNING.edgeKm[type];
  const far = half + ahead * Math.tan(WARNING.spreadDeg * Math.PI / 180);
  const at = (a, c) => [+(look.x + along.x * a + across.x * c).toFixed(2), +(look.y + along.y * a + across.y * c).toFixed(2)];
  return [at(-back, -half), at(-back, half), at(ahead, far), at(ahead, -far)];
}
export function insidePolygon(polygon, x, y) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const polygonArea = polygon => Math.abs(polygon.reduce((a, [x, y], i) => { const [u, v] = polygon[(i + 1) % polygon.length]; return a + x * v - u * y; }, 0)) / 2;

// Where a point is (km): from the nearest town where there are counties (places: the
// warnings' context, see placesFor), otherwise from the nearest radar (places: the radar sites).
export function placeOf(x, y, places) {
  if (places?.layer) {
    const near = nearestTown(places.layer, x * places.milesPerKm, y * places.milesPerKm);
    if (near) {
      const miles = Math.round(near.miles), t = near.town;
      return miles < 1 ? `over ${t.name}` : miles < 3 ? `near ${t.name}` : `${miles} miles ${compass(Math.atan2(x * places.milesPerKm - t.x, -(y * places.milesPerKm - t.y)) * 180 / Math.PI)} of ${t.name}`;
    }
  }
  const sites = Array.isArray(places) ? places : places?.sites;
  if (!sites?.length) return `${Math.round(x)} km east and ${Math.round(y)} km south of the region's northwest corner`;
  const site = sites.reduce((a, b) => (Math.hypot(b.xKm - x, b.yKm - y) < Math.hypot(a.xKm - x, a.yKm - y) ? b : a));
  const miles = Math.round(Math.hypot(x - site.xKm, y - site.yKm) * MILES_PER_KM);
  const name = `the ${site.name} radar (${site.id})`;
  return miles < 3 ? `near ${name}` : `${miles} miles ${compass(Math.atan2(x - site.xKm, -(y - site.yKm)) * 180 / Math.PI)} of ${name}`;
}
const motionOf = look => { const kph = Math.hypot(look.east, look.north); return { toDeg: (Math.atan2(look.east, look.north) * 180 / Math.PI + 360) % 360, mph: Math.round(kph * MILES_PER_KM), kt: Math.round(kph * KT_PER_KPH) }; };

// counties: the map's county layer for the world's grid (countyLayer in counties.js), or null.
// next: each office's next number for each kind ('' without offices).
export const createWarningState = (counties = null) => ({ warnings: [], next: {}, lastHourUtc: null, counties });
export const inEffect = (state, hourUtc) => state.warnings.filter(w => w.status === 'in effect' && w.validToHourUtc > hourUtc + 1e-6);

// One volume scan: warnings expire, are updated or cancelled, and new ones go out. sites: the
// radars (createRadarSites), for the words. Returns what was issued, updated and ended.
export function updateWarnings(state, world, radarSites = []) {
  const sites = placesFor(state, world, radarSites);
  const hour = world.stormEngine?.validHourUtc ?? world.validHourUtc;
  const out = { issued: [], updated: [], ended: [] };
  if (state.lastHourUtc !== null && hour <= state.lastHourUtc + 1e-6) return out;
  const stepMinutes = state.lastHourUtc === null ? 5 : Math.min(5, (hour - state.lastHourUtc) * 60);
  state.lastHourUtc = hour;
  const looks = (world.storms ?? []).filter(storm => storm.active && storm.positionKm).map(storm => withTrend(observeStorm(storm), state.seen?.[storm.id], hour)).sort((a, b) => threat(b) - threat(a));

  for (const warning of state.warnings) {
    if (warning.status !== 'in effect') continue;
    if (hour >= warning.validToHourUtc - 1e-6) { warning.status = 'expired'; warning.endedHourUtc = warning.validToHourUtc; out.ended.push(warning); continue; }
    // The storm it was issued for if it is still in it and still warrants it; otherwise the
    // strongest storm in it that does.
    // A piece downstream (in a neighbouring office's area) also holds its own storm while the
    // storm is still on the way to it.
    const holds = l => insidePolygon(warning.polygon, l.x, l.y) || (!warning.reached && l.id === warning.stormId && insidePolygon(warning.path, l.x, l.y));
    const inside = looks.filter(l => holds(l) && keeps(warning.type, l));
    const look = inside.find(l => l.id === warning.stormId) ?? inside[0];
    if (!look) {
      if (++warning.quiet < WARNING.quietScans) continue;
      const left = looks.find(l => l.id === warning.stormId);
      const reason = left && keeps(warning.type, left) ? 'moved' : 'weakened';
      warning.status = 'cancelled'; warning.endedHourUtc = hour;
      warning.statements.push({ hourUtc: hour, kind: 'cancelled', text: writeCancellation(warning, hour, reason) });
      out.ended.push(warning);
      continue;
    }
    warning.quiet = 0;
    if (look.id === warning.stormId && insidePolygon(warning.polygon, look.x, look.y)) warning.reached = true;
    const before = warning.tags;
    record(warning, look, hour, stepMinutes, sites);
    warning.tags = tagsOf(warning, hour);
    if (newsIn(before, warning.tags)) {
      warning.statements.push({ hourUtc: hour, kind: 'update', text: writeWarning(warning, look, hour, sites, true) });
      out.updated.push(warning);
    }
  }

  for (const look of looks) for (const type of ['tornado', 'severe']) {
    if (!warrants(type, look)) continue;
    const current = inEffect(state, hour);
    if (covered(current, type, look, hour) || (type === 'severe' && covered(current, 'tornado', look, hour))) continue;
    const issued = issueWarnings(state, type, look, hour, sites);
    out.issued.push(...issued);
    // The office's earlier warnings for this storm that it has left (and that hold no other
    // storm still warranting them) are cancelled as it re-warns: until 2026-10-20 they ran on
    // beside the new one, up to three at once from one office for one storm. One the storm is
    // still in runs out on its own, as real ones overlap for their last minutes.
    for (const old of current) {
      if (old.type !== type || old.stormId !== look.id || issued.includes(old) || !issued.some(w => w.office?.id === old.office?.id)) continue;
      if (looks.some(l => insidePolygon(old.polygon, l.x, l.y) && keeps(type, l))) continue;
      old.status = 'cancelled'; old.endedHourUtc = hour;
      old.statements.push({ hourUtc: hour, kind: 'cancelled', text: writeCancellation(old, hour, 'moved') });
      out.ended.push(old);
    }
  }
  // What each storm looked like at this scan, for the trends at the next one.
  state.seen = Object.fromEntries(looks.map(l => [l.id, { hourUtc: hour, hail: l.hail, gust: l.gust }]));
  if (state.warnings.length > WARNING.kept) {
    // Ended ones go first, oldest first.
    const ended = state.warnings.filter(w => w.status !== 'in effect');
    const drop = new Set(ended.slice(0, state.warnings.length - WARNING.kept));
    state.warnings = state.warnings.filter(w => !drop.has(w));
  }
  return out;
}

// A storm is covered by warnings of the type in effect that hold it now and where it will be in
// leadMinutes (the same warning, or the next office's downstream) and run at least that long yet.
function covered(warnings, type, look, hour) {
  const lead = WARNING.leadMinutes / 60, x = look.x + look.east * lead, y = look.y - look.north * lead;
  const running = warnings.filter(w => w.type === type && w.validToHourUtc - hour >= lead - 1e-6);
  // Ahead, its own warning's whole path counts too: where the path runs on past the counties of
  // any office (the map's edge) there is no piece to hold it, and until 2026-10-20 the office
  // issued a new, smaller warning for it at every scan.
  return running.some(w => insidePolygon(w.polygon, look.x, look.y)) && running.some(w => insidePolygon(w.polygon, x, y) || (w.stormId === look.id && w.path && insidePolygon(w.path, x, y)));
}

// What the words are worked out from: the radars, and the counties (with the miles in a km of
// the world's grid) when there are any.
export function placesFor(state, world, sites = []) {
  const layer = state.counties ?? null;
  return { sites, layer, milesPerKm: layer ? layer.miles / (world.width * world.cellSizeKm) : null };
}

// The counties (or parts) and towns a polygon (km) covers, or null without counties; with an
// office, only those in its county warning area.
function coveredPlaces(polygon, places, office = null) {
  if (!places?.layer) return null;
  const layer = places.layer, found = polygonCounties(layer, polygon.map(([x, y]) => [x * places.milesPerKm, y * places.milesPerKm]));
  const ours = index => !office || layer.counties[index]?.office === office.id;
  const counties = found?.counties.filter(c => ours(c.index)) ?? [];
  if (!counties.length) return null;
  const regionName = key => layer.placeNames[key] ?? key;
  return { counties: counties.map(c => ({ name: c.name, part: c.part, region: regionName(c.region) })), towns: found.towns.filter(t => !t.county || ours(t.county - 1)).slice(0, 10).map(t => t.name) };
}

// --- Offices ----------------------------------------------------------------------------

// A storm's path (km) cut along the county warning areas it crosses: one piece per office, the
// office whose area holds the storm first; pieces wholly behind the storm left out. Null where
// there are no offices (the path is then warned whole).
export function officePieces(path, look, places) {
  const layer = places?.layer;
  if (!layer?.offices?.length) return null;
  const found = polygonCounties(layer, path.map(([x, y]) => [x * places.milesPerKm, y * places.milesPerKm]));
  const ids = [...new Set((found?.counties ?? []).map(c => layer.counties[c.index].office).filter(Boolean))];
  const speed = Math.hypot(look.east, look.north), along = speed > 3 ? [look.east / speed, -look.north / speed] : [1, 0];
  const pieces = ids.map(id => {
    const office = layer.offices.find(o => o.id === id), polygon = office && clipToArea(path, areaRingsKm(office, places));
    if (!polygon) return null;
    const holds = insidePolygon(polygon, look.x, look.y), [cx, cy] = centroid(polygon);
    return holds || (cx - look.x) * along[0] + (cy - look.y) * along[1] > 0 ? { office, polygon, holds } : null;
  }).filter(Boolean).sort((a, b) => b.holds - a.holds);
  return pieces.length ? pieces : null;
}

// The office of the county nearest a storm, or null without offices.
function nearestOffice(look, places) {
  const layer = places?.layer;
  if (!layer?.offices?.length) return null;
  const x = look.x * places.milesPerKm, y = look.y * places.milesPerKm;
  let best = null, far = Infinity;
  for (const county of layer.counties) { if (!county.office) continue; const d = Math.hypot(county.x - x, county.y - y); if (d < far) { far = d; best = county; } }
  return best ? layer.offices.find(o => o.id === best.office) ?? null : null;
}

// Degrees for a point on the map (km east and south of its north-west corner), as the
// products write them: hundredths of a degree, latitude then west longitude.
export function latLonOf(x, y) {
  const [north, east] = WARNING.mapNorthwest, lat = north - y / 111.1, lon = east + x / (111.1 * Math.cos(lat * Math.PI / 180));
  return `${Math.round(lat * 100)} ${Math.round(-lon * 100)}`;
}

// An office's county warning area as rings in km on the world's grid (kept on the office).
function areaRingsKm(office, places) {
  const scale = places.layer.miles / places.milesPerKm;
  if (office.ringsKm?.scale !== scale) office.ringsKm = { scale, rings: countyRings(places.layer, office.countyIndices).map(ring => ring.map(([x, y]) => [x * scale, y * scale])) };
  return office.ringsKm.rings;
}

// A convex polygon (the path) clipped to an area (rings): the largest piece, cut down to the most
// vertices a warning may have. Null if nothing worth warning is left.
function clipToArea(path, rings) {
  const turn = Math.sign(signedArea(path)) || 1;
  let best = null, most = 1;
  for (const ring of rings) {
    let piece = ring;
    for (let i = 0; i < path.length && piece.length; i++) {
      const a = path[i], b = path[(i + 1) % path.length], side = p => turn * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= 0;
      const cut = (p, q) => { const dp = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]), dq = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]), t = dp / (dp - dq); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; };
      const next = [];
      piece.forEach((p, k) => {
        const q = piece[(k + 1) % piece.length], pin = side(p), qin = side(q);
        if (pin) next.push(p);
        if (pin !== qin) next.push(cut(p, q));
      });
      piece = next;
    }
    const area = Math.abs(signedArea(piece));
    if (piece.length >= 3 && area > most) { most = area; best = piece; }
  }
  return best && fewerVertices(best, WARNING.vertices).map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]);
}

// A ring cut down to at most `most` vertices, dropping each time the vertex whose triangle with
// its neighbours is smallest (Visvalingam), so the outline keeps its shape.
function fewerVertices(ring, most) {
  const pts = ring.filter((p, k) => { const q = ring[(k + 1) % ring.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6; });
  const size = k => { const a = pts[(k - 1 + pts.length) % pts.length], b = pts[k], c = pts[(k + 1) % pts.length]; return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])); };
  while (pts.length > most) {
    let drop = 0, least = Infinity;
    for (let k = 0; k < pts.length; k++) { const s = size(k); if (s < least) { least = s; drop = k; } }
    pts.splice(drop, 1);
  }
  return pts;
}
const signedArea = polygon => polygon.reduce((a, [x, y], i) => { const [u, v] = polygon[(i + 1) % polygon.length]; return a + x * v - u * y; }, 0) / 2;
const centroid = polygon => [polygon.reduce((a, p) => a + p[0], 0) / polygon.length, polygon.reduce((a, p) => a + p[1], 0) / polygon.length];

// The counties as a headline names them: "northeastern Barton and southwestern Rice Counties".
export function countyPhrase(counties) {
  const named = counties.map(c => `${c.part ? `${c.part} ` : ''}${c.name}`);
  return `${named.length <= 1 ? named.join('') : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`} ${named.length === 1 ? 'County' : 'Counties'}`;
}

// The warnings for a storm's path: one from each office whose area it crosses (the office
// holding the storm first), or one for the whole path without offices.
export function issueWarnings(state, type, look, hour, sites = []) {
  const path = warningPolygon(type, look);
  // (A path that crosses no county warning area, near the map's edge, is the office of the
  // county nearest the storm; until 2026-10-20 it went out with no office.)
  // A piece in a neighbouring office's area goes out only once the storm is due there within
  // downstreamMinutes; until then the office warns it on its own when the storm comes (the usual
  // new warning downstream). (2026-10-20: every piece the path touched was warned at once, and
  // those pieces were all false alarms, 14 of 80 tornado warnings on two seeds.)
  const ahead = WARNING.downstreamMinutes / 60, soonX = look.x + look.east * ahead, soonY = look.y - look.north * ahead;
  const all = officePieces(path, look, sites), pieces = all ? all.filter(p => p.holds || insidePolygon(p.polygon, soonX, soonY)) : [{ office: nearestOffice(look, sites), polygon: path }];
  if (!pieces.length) pieces.push(all[0]);
  return pieces.map(({ office, polygon }) => issuePiece(state, type, look, hour, sites, office, polygon, path));
}
// The first of them: the warning from the office holding the storm.
export const issueWarning = (state, type, look, hour, sites = []) => issueWarnings(state, type, look, hour, sites)[0];

function issuePiece(state, type, look, hour, sites, office, polygon, path) {
  const series = state.next[office?.id ?? ''] ??= { tornado: 1, severe: 1 }, number = series[type]++;
  const warning = {
    id: `${office ? `${office.id}-` : ''}${type === 'tornado' ? 'TOR' : 'SVR'}-${number}`, type, number, stormId: look.id,
    office: office ? { id: office.id, name: office.name, city: office.city } : null,
    issuedHourUtc: hour, validToHourUtc: hour + WARNING.minutes[type] / 60, endedHourUtc: null, status: 'in effect',
    polygon, path, reached: insidePolygon(polygon, look.x, look.y), areaSquareMiles: Math.round(polygonArea(polygon) * MILES_PER_KM * MILES_PER_KM),
    where: `the area from ${placeOf((path[0][0] + path[1][0]) / 2, (path[0][1] + path[1][1]) / 2, sites)} to ${placeOf((path[2][0] + path[3][0]) / 2, (path[2][1] + path[3][1]) / 2, sites)}`, places: coveredPlaces(polygon, sites, office),
    history: [], severeMinutes: { hail: 0, wind: 0 }, quiet: 0, statements: []
  };
  if (warning.places) warning.where = countyPhrase(warning.places.counties);
  record(warning, look, hour, 0, sites);
  warning.tags = tagsOf(warning, hour);
  warning.text = writeWarning(warning, look, hour, sites, false);
  warning.statements.push({ hourUtc: hour, kind: 'issued', text: warning.text });
  state.warnings.push(warning);
  return warning;
}

function record(warning, look, hour, stepMinutes, places = null) {
  const violent = warning.type === 'tornado' && look.confirmed && look.tornadoMph >= WARNING.catastrophicTornadoMph;
  warning.history.push({ hourUtc: hour, hail: look.hail, gust: look.gust, chance: look.chance, confirmed: look.confirmed, tornadoMph: look.tornadoMph, threatened: violent ? townsOnTrack(warning, look, places) : [] });
  warning.history = warning.history.filter(h => hour - h.hourUtc <= WARNING.tagMinutes / 60 + 1e-6);
  if (look.hail >= WARNING.severeHailInches) warning.severeMinutes.hail += stepMinutes;
  if (look.gust >= WARNING.severeGustMph) warning.severeMinutes.wind += stepMinutes;
  warning.motion = motionOf(look); warning.at = { x: look.x, y: look.y };
}

// The towns ({ name, population }, largest first) a tornado's track crosses inside this warning
// in the next emergencyMinutes, the one it is over now among them, whatever their size (the
// population floor is applied in tagsOf). None without the county layer's towns.
function townsOnTrack(warning, look, places) {
  if (!places?.layer?.towns?.length || look.tornadoX === null) return [];
  const speed = Math.hypot(look.east, look.north), along = speed > 3 ? [look.east / speed, -look.north / speed] : [1, 0];
  const reach = speed * WARNING.speedMargin * WARNING.emergencyMinutes / 60, half = look.tornadoWidthYards * 0.0009144 / 2 + WARNING.trackMarginKm;
  const spread = Math.tan(WARNING.spreadDeg * Math.PI / 180);
  return places.layer.towns.filter(t => {
    const x = t.x / places.milesPerKm, y = t.y / places.milesPerKm, dx = x - look.tornadoX, dy = y - look.tornadoY;
    const ahead = dx * along[0] + dy * along[1], aside = Math.abs(dx * -along[1] + dy * along[0]);
    return ahead >= -half && ahead <= reach + half && aside <= half + Math.max(0, ahead) * spread && insidePolygon(warning.polygon, x, y);
  }).sort((a, b) => b.population - a.population).map(t => ({ name: t.name, population: t.population ?? 0 }));
}

// The tags, from what was seen over the last tagMinutes. A tag goes up only on what two scans
// have shown (one scan of noise is not news; until 2026-10-20 a single scan raised it, and 36% of
// severe thunderstorm warnings carried a damage threat and 30% of tornado warnings were PDS),
// and once up it holds while any scan in the window still reaches it. A new warning starts
// from its one scan.
function tagsOf(warning, hour) {
  const recent = warning.history, was = warning.tags ?? {}, most = key => Math.max(0, ...recent.map(h => Number(h[key]) || 0));
  const held = (key, tag, before) => {
    const v = recent.map(h => Number(h[key]) || 0).sort((a, b) => b - a), twice = v.length > 1 ? v[1] : v[0] ?? 0;
    return Math.max(tag(twice), Math.min(tag(v[0] ?? 0), before ?? 0));
  };
  const hail = held('hail', hailTag, was.hailInches), gust = held('gust', windTag, was.gustMph), confirmed = recent.some(h => h.confirmed);
  if (warning.type === 'tornado') {
    const strong = recent.filter(h => h.confirmed && h.tornadoMph >= WARNING.considerableTornadoMph).length;
    const considerable = strong >= Math.min(2, recent.length) || (strong >= 1 && (was.damage === 'CONSIDERABLE' || was.damage === 'CATASTROPHIC'));
    // An emergency for the population centers a violent tornado threatened over the last tagMinutes.
    const emergencyFor = [...new Set(recent.flatMap(h => h.threatened ?? []).filter(t => t.population >= WARNING.emergencyMinPopulation).map(t => t.name))];
    return { tornado: confirmed ? 'OBSERVED' : 'RADAR INDICATED', damage: emergencyFor.length ? 'CATASTROPHIC' : considerable ? 'CONSIDERABLE' : null, hailInches: hail, gustMph: null, emergencyFor };
  }
  const observed = minutes => minutes >= WARNING.observedMinutes - 1e-6 ? 'OBSERVED' : 'RADAR INDICATED';
  return {
    tornado: most('chance') >= WARNING.possibleTornadoChance ? 'POSSIBLE' : null, damage: thunderstormDamage(hail, gust), hailInches: hail, gustMph: gust,
    hailSource: observed(warning.severeMinutes.hail), windSource: observed(warning.severeMinutes.wind)
  };
}
// What makes a statement: the tornado tag or the damage threat changes, a source becomes
// OBSERVED, or the hail or wind tag goes up. Smaller hail or gusts alone wait for the next one.
// A tornado emergency that comes to threaten another town is news too.
const newsIn = (was, now) => was.tornado !== now.tornado || was.damage !== now.damage || was.hailSource !== now.hailSource || was.windSource !== now.windSource
  || now.hailInches > was.hailInches + 1e-6 || (now.gustMph ?? 0) > (was.gustMph ?? 0) || (now.emergencyFor ?? []).some(t => !(was.emergencyFor ?? []).includes(t));
export const isTornadoEmergency = warning => warning.type === 'tornado' && warning.tags?.damage === 'CATASTROPHIC';
export const isParticularlyDangerous = warning => warning.type === 'tornado' && (warning.tags?.damage === 'CONSIDERABLE' || isTornadoEmergency(warning));
// The towns as an emergency names them: "Hoisington", "Hoisington and Ellinwood", "A, B and C".
const emergencyPlaces = warning => { const n = warning.tags.emergencyFor; return n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} and ${n.at(-1)}`; };

// --- Words ------------------------------------------------------------------------------

const title = warning => (warning.type === 'tornado' ? 'Tornado Warning' : 'Severe Thunderstorm Warning');
// The issuing office as the products name it.
const wfo = warning => `National Weather Service ${warning.office?.city ?? 'WeatherWorld'}`;
const fmtHail = inches => (inches >= 0.75 ? `${inches.toFixed(2)} IN` : '<.75 IN');
const fmtGust = mph => (mph >= 50 ? `${mph} MPH` : '<50 MPH');

function hazardText(warning) {
  const t = warning.tags, hail = t.hailInches >= 1 ? `${hailName(t.hailInches).toLowerCase()} size hail` : null;
  if (warning.type === 'tornado') return `${t.damage === 'CATASTROPHIC' ? 'Deadly tornado' : t.damage ? 'Damaging tornado' : 'Tornado'}${hail ? ` and ${hail}` : ''}.`;
  const wind = t.gustMph >= WARNING.severeGustMph ? `${t.gustMph} mph wind gusts` : null;
  const words = [wind, hail].filter(Boolean).join(' and ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}.`;
}

function impactText(warning) {
  const t = warning.tags;
  if (warning.type === 'tornado') return t.damage
    ? 'You are in a life-threatening situation. Flying debris may be deadly to those caught without shelter. Mobile homes will be destroyed. Considerable damage to homes, businesses, and vehicles is likely and complete destruction is possible.'
    : 'Flying debris will be dangerous to those caught without shelter. Mobile homes will be damaged or destroyed. Damage to roofs, windows, and vehicles will occur. Tree damage is likely.';
  const parts = [];
  if (t.hailInches >= WARNING.destructive.hailInches) parts.push('People and animals outdoors will be severely injured. Expect extensive damage to roofs, siding, windows, and vehicles.');
  else if (t.hailInches >= WARNING.considerable.hailInches) parts.push('People and animals outdoors will be injured. Expect hail damage to roofs, siding, windows, and vehicles.');
  else if (t.hailInches >= 1) parts.push('Hail damage to vehicles is expected.');
  if (t.gustMph >= WARNING.destructive.gustMph) parts.push('Flying debris will be dangerous to those caught without shelter. Mobile homes will be heavily damaged. Expect considerable damage to roofs, windows, and vehicles. Extensive tree damage and power outages are likely.');
  else if (t.gustMph >= WARNING.considerable.gustMph) parts.push('Expect considerable tree damage. Damage is likely to mobile homes, roofs, and outbuildings.');
  else if (t.gustMph >= WARNING.severeGustMph) parts.push(t.hailInches >= 1 ? 'Expect wind damage to roofs, siding, and trees.' : 'Expect damage to roofs, siding, and trees.');
  return parts.join(' ');
}

function sourceText(warning) {
  const t = warning.tags;
  if (warning.type === 'tornado') return t.tornado === 'OBSERVED' ? 'Radar confirmed tornado.' : 'Radar indicated rotation.';
  return t.hailSource === 'OBSERVED' || t.windSource === 'OBSERVED' ? 'Trained weather spotters.' : 'Radar indicated.';
}

function stormSentence(warning, look, hour, sites) {
  const m = warning.motion, moving = m.mph < 5 ? 'nearly stationary' : `moving ${compass(m.toDeg)} at ${m.mph} mph`, place = placeOf(look.x, look.y, sites);
  if (warning.type === 'severe') return `At ${clock(hour)}, a severe thunderstorm was located ${place}, ${moving}.`;
  if (warning.tags.damage) return `At ${clock(hour)}, a confirmed large and destructive tornado was observed ${place}, ${moving}.`;
  if (warning.tags.tornado === 'OBSERVED') return `At ${clock(hour)}, a confirmed tornado was located ${place}, ${moving}.`;
  return `At ${clock(hour)}, a severe thunderstorm capable of producing a tornado was located ${place}, ${moving}.`;
}

function precautions(warning) {
  const t = warning.tags;
  if (warning.type === 'tornado') return t.damage
    ? 'To repeat, a large, extremely dangerous and potentially deadly tornado is on the ground. To protect your life, TAKE COVER NOW! Move to a basement or an interior room on the lowest floor of a sturdy building. Avoid windows. If in a mobile home, a vehicle or outdoors, move to the closest substantial shelter and protect yourself from flying debris.'
    : 'TAKE COVER NOW! Move to a basement or an interior room on the lowest floor of a sturdy building. Avoid windows. If you are outdoors, in a mobile home, or in a vehicle, move to the closest substantial shelter and protect yourself from flying debris.';
  const lines = [t.damage === 'DESTRUCTIVE' ? 'This is a dangerous storm. If you are outside, move to a safe shelter now! Do not stay in a mobile home.' : 'For your protection move to an interior room on the lowest floor of a building.'];
  if (t.tornado === 'POSSIBLE') lines.push('Tornadoes can develop quickly from severe thunderstorms. Although a tornado is not immediately likely, if one is spotted, act quickly and move to a place of safety in a sturdy structure, such as a basement or small interior room.');
  return lines.join('\n\n');
}

function tagLines(warning) {
  const t = warning.tags;
  if (warning.type === 'tornado') return [`TORNADO...${t.tornado}`, ...(t.damage ? [`TORNADO DAMAGE THREAT...${t.damage}`] : []), `MAX HAIL SIZE...${fmtHail(t.hailInches)}`];
  return [...(t.tornado ? [`TORNADO...${t.tornado}`] : []), ...(t.damage ? [`THUNDERSTORM DAMAGE THREAT...${t.damage}`] : []), `HAIL THREAT...${t.hailSource}`, `MAX HAIL SIZE...${fmtHail(t.hailInches)}`, `WIND THREAT...${t.windSource}`, `MAX WIND GUST...${fmtGust(t.gustMph)}`];
}

// The warning, or (statement) a severe weather statement continuing it, laid out as the real ones are.
export function writeWarning(warning, look, hour, sites, statement) {
  const name = title(warning), t = warning.tags, eas = warning.type === 'tornado' || t.damage === 'DESTRUCTIVE';
  const m = warning.motion, motDeg = Math.round((m.toDeg + 180) % 360);
  const lines = [...(statement ? [] : [eas ? 'BULLETIN - EAS ACTIVATION REQUESTED' : 'BULLETIN - IMMEDIATE BROADCAST REQUESTED']), statement ? 'Severe Weather Statement' : name, wfo(warning), clock(hour), ''];
  // A tornado emergency's headline goes straight after the date/time line (NWSI 10-511 3.3.4.1(c)).
  const emergency = isTornadoEmergency(warning);
  if (emergency) lines.push(`...TORNADO EMERGENCY FOR ${emergencyPlaces(warning).toUpperCase()}...`, '');
  if (statement) lines.push(`...A ${name.toUpperCase()} REMAINS IN EFFECT UNTIL ${clock(warning.validToHourUtc)} FOR ${warning.where.toUpperCase()}...`, '');
  else lines.push(`The National Weather Service${warning.office ? ` in ${warning.office.city}` : ''} has issued a`, '', `* ${name} for...`, ...(warning.places ? warning.places.counties.map((c, k, all) => `  ${c.part ? `${c.part[0].toUpperCase()}${c.part.slice(1)} ` : ''}${c.name} County in the ${c.region}${k === all.length - 1 ? '.' : '...'}`) : [`  ${warning.where}.`]), '', `* Until ${clock(warning.validToHourUtc)}.`, '');
  if (isParticularlyDangerous(warning) && !emergency) lines.push('...THIS IS A PARTICULARLY DANGEROUS SITUATION. TAKE COVER NOW!...', '');
  if (t.damage === 'DESTRUCTIVE') lines.push(`...THIS IS A DESTRUCTIVE STORM FOR ${warning.where.toUpperCase()}...`, '');
  lines.push(`${statement ? '' : '* '}${stormSentence(warning, look, hour, sites)}`, '');
  // And is repeated, without the dots, at the end of the basis.
  if (emergency) lines.push(`  TORNADO EMERGENCY for ${emergencyPlaces(warning)}. This is a PARTICULARLY DANGEROUS SITUATION. TAKE COVER NOW!`, '');
  lines.push(`  HAZARD...${hazardText(warning)}`, '', `  SOURCE...${sourceText(warning)}`, '', `  IMPACT...${impactText(warning)}`, '');
  if (warning.places?.towns.length) lines.push(`${statement ? '' : '* '}Locations impacted include...`, `  ${warning.places.towns.length === 1 ? warning.places.towns[0] : `${warning.places.towns.slice(0, -1).join(', ')} and ${warning.places.towns.at(-1)}`}.`, '');
  lines.push('PRECAUTIONARY/PREPAREDNESS ACTIONS...', '', precautions(warning), '', '&&', '');
  // In degrees, as the products give them (until 2026-10-20 in km on the map).
  const latLon = warning.polygon.map(([x, y]) => latLonOf(x, y)), rows = [];
  for (let k = 0; k < latLon.length; k += 4) rows.push(`${k ? '      ' : 'LAT...LON '}${latLon.slice(k, k + 4).join(' ')}`);
  lines.push(...rows, `TIME...MOT...LOC ${clock(hour)} ${String(motDeg).padStart(3, '0')}DEG ${m.kt}KT ${latLonOf(look.x, look.y)}`, '', ...tagLines(warning), '', '$');
  return lines.join('\n');
}

function writeCancellation(warning, hour, reason) {
  const name = title(warning);
  const why = reason === 'moved'
    ? 'The storm which prompted the warning has moved out of the warned area.'
    : warning.type === 'tornado'
      ? 'The storm which prompted the warning has weakened, and no longer appears capable of producing a tornado. However, gusty winds and heavy rain are still possible with this thunderstorm.'
      : 'The storm which prompted the warning has weakened below severe limits, and no longer poses an immediate threat to life or property.';
  return ['Severe Weather Statement', wfo(warning), clock(hour), '', `...THE ${name.toUpperCase()} FOR ${warning.where.toUpperCase()} IS CANCELLED...`, '', why, '', '$$'].join('\n');
}

// What the radar page gets: everything but the scan history.
export function publicWarning(warning, hourUtc) {
  const { history, severeMinutes, quiet, path, reached, ...rest } = warning;
  const t = warning.tags;
  return {
    ...rest, title: `${title(warning)} ${warning.number}${warning.office ? ` · ${warning.office.id}` : ''}`, pds: isParticularlyDangerous(warning), emergency: isTornadoEmergency(warning),
    label: warning.type === 'tornado' ? (isTornadoEmergency(warning) ? `Tornado Emergency for ${emergencyPlaces(warning)}` : t.damage ? 'PDS Tornado' : t.tornado === 'OBSERVED' ? 'Tornado (observed)' : 'Tornado') : t.damage ? `Severe T-storm (${t.damage.toLowerCase()})` : 'Severe T-storm',
    valid: warning.status === 'in effect' && warning.validToHourUtc > hourUtc + 1e-6,
    latestText: warning.statements.at(-1)?.text ?? warning.text
  };
}

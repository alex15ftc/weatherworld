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
import { polygonCounties, nearestTown } from './counties.js';

export const WARNING = Object.freeze({
  // How long each runs (minutes): NWS tornado warnings default to 30 minutes since 2012;
  // severe thunderstorm warnings are mostly 30-60.
  minutes: { tornado: 30, severe: 45 },
  // Tornado: the chance of one in the next half hour from which a radar-indicated warning is
  // issued, below which a warning is no longer warranted, and from which a severe
  // thunderstorm warning says a tornado is possible.
  tornadoChance: 0.3, keepTornadoChance: 0.12, possibleTornadoChance: 0.12,
  // Minutes on the ground before a tornado counts as confirmed, and the wind (mph) from which
  // a confirmed one makes it a particularly dangerous situation (EF2).
  confirmMinutes: 10, considerableTornadoMph: 111,
  // Severe limits, the lower ones that keep a warning going, and the damage tiers.
  severeHailInches: 1, severeGustMph: 58, keepHailInches: 0.75, keepGustMph: 50,
  considerable: { hailInches: 1.75, gustMph: 70 }, destructive: { hailInches: 2.75, gustMph: 80 },
  // Minutes of severe hail or wind under a warning before reports have come in (OBSERVED).
  observedMinutes: 15,
  // The tags give the most seen over the last tagMinutes (a scan or two of noise is not news);
  // a warning is cancelled after quietScans scans in a row with no storm in it warranting it.
  tagMinutes: 15, quietScans: 2,
  // The polygon: how far the motion may turn either way (degrees), how much faster the storm
  // may go, how far behind the storm it starts, how far beyond the hazard its sides lie, the
  // most its half-width may be, and the most a gust front's lead adds ahead of a storm (km).
  // Set 2026-10-14 so a single storm's warning is a few hundred square miles for a tornado and
  // under a thousand for hail and wind, as the NWS's are; a line's runs along the line.
  spreadDeg: 15, speedMargin: 1.15, behindKm: 5, edgeKm: { tornado: 6, severe: 6 }, widestKm: 50, gustLeadKm: 10,
  // A storm within this many minutes of leaving its warning, or of its warning expiring, gets a new one.
  leadMinutes: 10,
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
    chance: Number(tornado.probability) || 0, onGround,
    confirmed: onGround && (tornado.groundTimeMinutes ?? 0) >= WARNING.confirmMinutes - 1e-6,
    tornadoMph: onGround ? Number(tornado.windSpeedMph) || 0 : 0,
    // How far each hazard reaches across the storm's path (km): a tornado from under the wall
    // cloud; hail and wind across the hail core or along a line. And how far the gust front
    // runs ahead of it.
    tornadoReachKm: storm.geometry?.wallCloud?.radiusKm ?? 1,
    severeReachKm: Math.max(storm.geometry?.hail?.radiusKm ?? 0, storm.geometry?.line?.halfLengthKm ?? 0, 4),
    gustLeadKm: storm.geometry?.gustFront?.leadKm ?? 0
  };
}
const warrants = (type, look) => (type === 'tornado' ? look.onGround || look.chance >= WARNING.tornadoChance : look.hail >= WARNING.severeHailInches || look.gust >= WARNING.severeGustMph);
const keeps = (type, look) => (type === 'tornado' ? look.onGround || look.chance >= WARNING.keepTornadoChance : look.hail >= WARNING.keepHailInches || look.gust >= WARNING.keepGustMph);
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
export const createWarningState = (counties = null) => ({ warnings: [], next: { tornado: 1, severe: 1 }, lastHourUtc: null, counties });
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
  const looks = (world.storms ?? []).filter(storm => storm.active && storm.positionKm).map(observeStorm).sort((a, b) => threat(b) - threat(a));

  for (const warning of state.warnings) {
    if (warning.status !== 'in effect') continue;
    if (hour >= warning.validToHourUtc - 1e-6) { warning.status = 'expired'; warning.endedHourUtc = warning.validToHourUtc; out.ended.push(warning); continue; }
    // The storm it was issued for if it is still in it and still warrants it; otherwise the
    // strongest storm in it that does.
    const inside = looks.filter(look => insidePolygon(warning.polygon, look.x, look.y) && keeps(warning.type, look));
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
    const before = warning.tags;
    record(warning, look, hour, stepMinutes);
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
    const warning = issueWarning(state, type, look, hour, sites);
    out.issued.push(warning);
  }
  if (state.warnings.length > WARNING.kept) {
    // Ended ones go first, oldest first.
    const ended = state.warnings.filter(w => w.status !== 'in effect');
    const drop = new Set(ended.slice(0, state.warnings.length - WARNING.kept));
    state.warnings = state.warnings.filter(w => !drop.has(w));
  }
  return out;
}

// A storm is covered by a warning of the type in effect that holds it now and where it will be
// in leadMinutes, and runs at least that long yet.
function covered(warnings, type, look, hour) {
  const lead = WARNING.leadMinutes / 60, x = look.x + look.east * lead, y = look.y - look.north * lead;
  return warnings.some(w => w.type === type && w.validToHourUtc - hour >= lead - 1e-6 && insidePolygon(w.polygon, look.x, look.y) && insidePolygon(w.polygon, x, y));
}

// What the words are worked out from: the radars, and the counties (with the miles in a km of
// the world's grid) when there are any.
export function placesFor(state, world, sites = []) {
  const layer = state.counties ?? null;
  return { sites, layer, milesPerKm: layer ? layer.miles / (world.width * world.cellSizeKm) : null };
}

// The counties (or parts) and towns a polygon (km) covers, or null without counties.
function coveredPlaces(polygon, places) {
  if (!places?.layer) return null;
  const found = polygonCounties(places.layer, polygon.map(([x, y]) => [x * places.milesPerKm, y * places.milesPerKm]));
  if (!found?.counties.length) return null;
  const regionName = key => places.layer.placeNames[key] ?? key;
  return { counties: found.counties.map(c => ({ name: c.name, part: c.part, region: regionName(c.region) })), towns: found.towns.slice(0, 10).map(t => t.name) };
}

// The counties as a headline names them: "northeastern Barton and southwestern Rice Counties".
export function countyPhrase(counties) {
  const named = counties.map(c => `${c.part ? `${c.part} ` : ''}${c.name}`);
  return `${named.length <= 1 ? named.join('') : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`} ${named.length === 1 ? 'County' : 'Counties'}`;
}

export function issueWarning(state, type, look, hour, sites = []) {
  const polygon = warningPolygon(type, look), number = state.next[type]++;
  const warning = {
    id: `${type === 'tornado' ? 'TOR' : 'SVR'}-${number}`, type, number, stormId: look.id,
    issuedHourUtc: hour, validToHourUtc: hour + WARNING.minutes[type] / 60, endedHourUtc: null, status: 'in effect',
    polygon, areaSquareMiles: Math.round(polygonArea(polygon) * MILES_PER_KM * MILES_PER_KM),
    where: `the area from ${placeOf((polygon[0][0] + polygon[1][0]) / 2, (polygon[0][1] + polygon[1][1]) / 2, sites)} to ${placeOf((polygon[2][0] + polygon[3][0]) / 2, (polygon[2][1] + polygon[3][1]) / 2, sites)}`, places: coveredPlaces(polygon, sites),
    history: [], severeMinutes: { hail: 0, wind: 0 }, quiet: 0, statements: []
  };
  if (warning.places) warning.where = countyPhrase(warning.places.counties);
  record(warning, look, hour, 0);
  warning.tags = tagsOf(warning, hour);
  warning.text = writeWarning(warning, look, hour, sites, false);
  warning.statements.push({ hourUtc: hour, kind: 'issued', text: warning.text });
  state.warnings.push(warning);
  return warning;
}

function record(warning, look, hour, stepMinutes) {
  warning.history.push({ hourUtc: hour, hail: look.hail, gust: look.gust, chance: look.chance, confirmed: look.confirmed, tornadoMph: look.tornadoMph });
  warning.history = warning.history.filter(h => hour - h.hourUtc <= WARNING.tagMinutes / 60 + 1e-6);
  if (look.hail >= WARNING.severeHailInches) warning.severeMinutes.hail += stepMinutes;
  if (look.gust >= WARNING.severeGustMph) warning.severeMinutes.wind += stepMinutes;
  warning.motion = motionOf(look); warning.at = { x: look.x, y: look.y };
}

// The tags, from the most seen over the last tagMinutes.
function tagsOf(warning, hour) {
  const recent = warning.history, most = key => Math.max(0, ...recent.map(h => Number(h[key]) || 0));
  const hail = hailTag(most('hail')), gust = windTag(most('gust')), confirmed = recent.some(h => h.confirmed);
  if (warning.type === 'tornado') {
    const considerable = recent.some(h => h.confirmed && h.tornadoMph >= WARNING.considerableTornadoMph);
    return { tornado: confirmed ? 'OBSERVED' : 'RADAR INDICATED', damage: considerable ? 'CONSIDERABLE' : null, hailInches: hail, gustMph: null };
  }
  const observed = minutes => minutes >= WARNING.observedMinutes - 1e-6 ? 'OBSERVED' : 'RADAR INDICATED';
  return {
    tornado: most('chance') >= WARNING.possibleTornadoChance ? 'POSSIBLE' : null, damage: thunderstormDamage(hail, gust), hailInches: hail, gustMph: gust,
    hailSource: observed(warning.severeMinutes.hail), windSource: observed(warning.severeMinutes.wind)
  };
}
// What makes a statement: the tornado tag or the damage threat changes, a source becomes
// OBSERVED, or the hail or wind tag goes up. Smaller hail or gusts alone wait for the next one.
const newsIn = (was, now) => was.tornado !== now.tornado || was.damage !== now.damage || was.hailSource !== now.hailSource || was.windSource !== now.windSource
  || now.hailInches > was.hailInches + 1e-6 || (now.gustMph ?? 0) > (was.gustMph ?? 0);
export const isParticularlyDangerous = warning => warning.type === 'tornado' && warning.tags?.damage === 'CONSIDERABLE';

// --- Words ------------------------------------------------------------------------------

const title = warning => (warning.type === 'tornado' ? 'Tornado Warning' : 'Severe Thunderstorm Warning');
const fmtHail = inches => (inches >= 0.75 ? `${inches.toFixed(2)} IN` : '<.75 IN');
const fmtGust = mph => (mph >= 50 ? `${mph} MPH` : '<50 MPH');

function hazardText(warning) {
  const t = warning.tags, hail = t.hailInches >= 1 ? `${hailName(t.hailInches).toLowerCase()} size hail` : null;
  if (warning.type === 'tornado') return `${t.damage ? 'Damaging tornado' : 'Tornado'}${hail ? ` and ${hail}` : ''}.`;
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
  const lines = [...(statement ? [] : [eas ? 'BULLETIN - EAS ACTIVATION REQUESTED' : 'BULLETIN - IMMEDIATE BROADCAST REQUESTED']), statement ? 'Severe Weather Statement' : name, 'National Weather Service WeatherWorld', clock(hour), ''];
  if (statement) lines.push(`...A ${name.toUpperCase()} REMAINS IN EFFECT UNTIL ${clock(warning.validToHourUtc)} FOR ${warning.where.toUpperCase()}...`, '');
  else lines.push('The National Weather Service has issued a', '', `* ${name} for...`, ...(warning.places ? warning.places.counties.map((c, k, all) => `  ${c.part ? `${c.part[0].toUpperCase()}${c.part.slice(1)} ` : ''}${c.name} County in the ${c.region}${k === all.length - 1 ? '.' : '...'}`) : [`  ${warning.where}.`]), '', `* Until ${clock(warning.validToHourUtc)}.`, '');
  if (isParticularlyDangerous(warning)) lines.push('...THIS IS A PARTICULARLY DANGEROUS SITUATION. TAKE COVER NOW!...', '');
  if (t.damage === 'DESTRUCTIVE') lines.push(`...THIS IS A DESTRUCTIVE STORM FOR ${warning.where.toUpperCase()}...`, '');
  lines.push(`${statement ? '' : '* '}${stormSentence(warning, look, hour, sites)}`, '', `  HAZARD...${hazardText(warning)}`, '', `  SOURCE...${sourceText(warning)}`, '', `  IMPACT...${impactText(warning)}`, '');
  if (warning.places?.towns.length) lines.push(`${statement ? '' : '* '}Locations impacted include...`, `  ${warning.places.towns.length === 1 ? warning.places.towns[0] : `${warning.places.towns.slice(0, -1).join(', ')} and ${warning.places.towns.at(-1)}`}.`, '');
  lines.push('PRECAUTIONARY/PREPAREDNESS ACTIONS...', '', precautions(warning), '', '&&', '');
  lines.push(`TIME...MOT...LOC ${clock(hour)} ${String(motDeg).padStart(3, '0')}DEG ${m.kt}KT ${Math.round(look.x)}KM ${Math.round(look.y)}KM`, '', ...tagLines(warning), '', '$$');
  return lines.join('\n');
}

function writeCancellation(warning, hour, reason) {
  const name = title(warning);
  const why = reason === 'moved'
    ? 'The storm which prompted the warning has moved out of the warned area.'
    : warning.type === 'tornado'
      ? 'The storm which prompted the warning has weakened, and no longer appears capable of producing a tornado. However, gusty winds and heavy rain are still possible with this thunderstorm.'
      : 'The storm which prompted the warning has weakened below severe limits, and no longer poses an immediate threat to life or property.';
  return ['Severe Weather Statement', 'National Weather Service WeatherWorld', clock(hour), '', `...THE ${name.toUpperCase()} FOR ${warning.where.toUpperCase()} IS CANCELLED...`, '', why, '', '$$'].join('\n');
}

// What the radar page gets: everything but the scan history.
export function publicWarning(warning, hourUtc) {
  const { history, severeMinutes, quiet, ...rest } = warning;
  const t = warning.tags;
  return {
    ...rest, title: `${title(warning)} ${warning.number}`, pds: isParticularlyDangerous(warning),
    label: warning.type === 'tornado' ? (t.damage ? 'PDS Tornado' : t.tornado === 'OBSERVED' ? 'Tornado (observed)' : 'Tornado') : t.damage ? `Severe T-storm (${t.damage.toLowerCase()})` : 'Severe T-storm',
    valid: warning.status === 'in effect' && warning.validToHourUtc > hourUtc + 1e-6,
    latestText: warning.statements.at(-1)?.text ?? warning.text
  };
}

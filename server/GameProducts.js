// The issued products as the Roblox place draws them (docs/ROBLOX-UI-PLAN.md). The engine
// decides everything here (shapes, levels, colour keys, text); the game only projects and
// draws. Each product is built when its source changes and kept as JSON text, versioned by a
// hash of that text, so any number of game servers polling the manifest costs nothing extra,
// and a recorded snapshot (scripts/export-product-snapshot.mjs) carries the same versions.
//
// GET /api/game/v1/manifest      { v, epoch, simHourUtc, products: { <id>: { version, bytes } } }
// GET /api/game/v1/product/<id>  the product's text (header x-product-version: its version)
//
// Coordinates are map miles (0-500 east and south from the north-west corner), the same miles
// the Roblox map uses (Config.MAP_MILES), rounded to 0.1 mi. A ring is a flat list x1, y1, x2, y2...
//
//   outlook.day1 .. day3            the convective outlooks
//   mesoscale                       the watches and mesoscale discussions in effect
//   warnings                        the tornado and severe thunderstorm warnings in effect
//   radar.sites                     the radars: id, name, place in map miles, range
//   radar.site.<ID>.<product>.<T>   one radar's tilt T (an index into radar.sites `tilts`; left out:
//                                   the lowest) of a product (radar.sites `siteProducts`), one byte
//                                   a gate as js/radar/RadarFormat.js encodes it, zstd then base64 in
//                                   `data`, with the beam's height over each gate; made when asked
//                                   for, and listed in the manifest while asked for in the last
//                                   SITE_WANTED_MS
//   radar.mosaic.<kind>             every radar together on a 1 km grid (radar.sites `mosaics`:
//                                   composite, base, echo tops, VIL, hail size), asked for the same way
//   satellite.<kind>                the satellite's image of the whole map (js/satellite/Satellite.js):
//                                   ir (clean IR, 10.3 um) or visible, one byte a pixel as
//                                   js/satellite/SatelliteFormat.js encodes it on a 2 km grid, zstd then
//                                   base64 in `data`, with the sun it was taken under; asked for and
//                                   looped like the radar's mosaics
//   <radar id>.h<seconds>           an earlier scan of a radar product still asked for, as it was
//                                   (never changes); the product's `loop` lists the ones held, oldest
//                                   first, for an animation
//   lightning                       the last half hour's lightning (js/storms/Lightning.js): each
//                                   strike as 6 bytes (u16 x, u16 y in hundredths of a map mile,
//                                   u8 age in quarter minutes, u8 kind: 0 in the cloud, 1 negative
//                                   and 2 positive to the ground), little-endian, zstd then base64
//                                   in `data`; the colours of its ages in `ages`
//   reports.days                    the days of storm reports the weather server still holds
//   reports.day.<N>                 one convective day's storm reports, and its tornadoes that have
//                                   lifted, each with its rating and track (12Z to 12Z)
//   survey.<tornado id>             one lifted tornado's damage survey (DAT): its EF contours and
//                                   damage points; survey.indicators: the damage indicators' tables
// The manifest lists the report days and surveys of today and yesterday (yesterday's last
// changes come in after 12Z); older ones are given when asked for while the log holds them.
// Every report product carries `world` (the storm log's worldId): the game keeps the days it is
// sent beyond what the weather server holds (roblox/Server/Modules/ReportArchive.luau), and a new
// world numbers its days from 1 again.
import crypto from 'node:crypto';
import { RISK_RADIUS_MILES } from '../js/forecast/spcOutlookRules.js';
import zlib from 'node:zlib';
import { RADAR_RADIALS, RADAR_GATES, RADAR_GATE_KM, RADAR_FINE_GATE_KM, RADAR_RANGE_KM, RADAR_TILTS_DEG, groundRangeKm, beamHeightKm } from '../js/radar/RadarFormat.js';
import { MOSAIC_KINDS, MOSAIC_PRODUCT } from '../js/radar/RadarSimulator.js';
import { TDA, SMITH_2015_VROT_KT } from '../js/radar/RotationDetection.js';
import { SATELLITE_PRODUCTS, SATELLITE_KINDS } from '../js/satellite/SatelliteFormat.js';
import { discussionColourKey, warningColourKey, warningRank } from '../js/forecast/productColours.js';
import { cutCorners } from '../js/forecast/contourShapes.js';
import { DAMAGE_INDICATORS } from '../js/reports/damageIndicators.js';
import { logDays } from '../js/reports/stormLog.js';
import { LIGHTNING, STRIKE_KIND } from '../js/storms/Lightning.js';
import { reportTitle, reportText, significantReport, surveyTitle, surveySummary } from '../js/reports/reportText.js';
import { calendarFor } from '../js/forecast/calendar.js';

const KM_PER_MILE = 1.609344;

// toleranceMiles: rings are simplified to within this (the whole map on a screen is about 0.5 mi a pixel).
// A survey is drawn close in (a damage swath is yards wide), so its shapes keep 0.01 mi; a
// day's tracks are drawn zoomed out and keep 0.05 mi.
export const GAME_PRODUCTS = Object.freeze({
  version: 1, outlookDays: ['day1', 'day2', 'day3'], ringDecimals: 1, toleranceMiles: 0.3,
  radarSiteProducts: ['reflectivity', 'velocity', 'rawVelocity', 'stormRelativeVelocity', 'correlationCoefficient', 'differentialReflectivity', 'spectrumWidth'],
  siteWantedMs: 120_000, radarLoopFrames: 10,
  survey: { decimals: 2, toleranceMiles: 0.01 }, trackToleranceMiles: 0.05,
  // Contours (outlooks and mesoscale discussions, traced on the 10-mile grid, their corners
  // already cut twice) get this many more cuts, so they stay curves when the map is zoomed in to
  // a few studs a pixel, and keep their points to within toleranceMiles.
  contourShape: { cuts: Number(process.env.GAME_OUTLOOK_CUTS ?? 3), toleranceMiles: Number(process.env.GAME_OUTLOOK_TOLERANCE ?? 0.02), decimals: 2 },
  // Polygons drawn as they are (watches' county outlines, warnings): rounded to 0.01 mi.
  polygonShape: { toleranceMiles: 0.02, decimals: 2 }
});

const pack = bytes => zlib.zstdCompressSync(bytes).toString('base64');
const hashOf = text => crypto.createHash('sha1').update(text).digest('base64url').slice(0, 12);
const round = (value, decimals) => { const f = 10 ** decimals; return Math.round(value * f) / f; };

// Douglas-Peucker on a closed ring of [x, y] points: the points kept, in order.
function simplifyRing(points, tolerance) {
  const n = points.length;
  if (n < 4 || tolerance <= 0) return points;
  // Split the ring at its first point and the point farthest from it, then simplify each half.
  let far = 0, farD = -1;
  for (let k = 1; k < n; k++) { const d = Math.hypot(points[k][0] - points[0][0], points[k][1] - points[0][1]); if (d > farD) { farD = d; far = k; } }
  const keep = new Uint8Array(n); keep[0] = keep[far] = 1;
  const stack = [[0, far], [far, n]];
  while (stack.length) {
    const [a, b] = stack.pop(), [ax, ay] = points[a], [bx, by] = points[b % n], dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy) || 1e-12;
    let worst = -1, worstD = tolerance;
    for (let k = a + 1; k < b; k++) { const d = Math.abs((points[k][0] - ax) * dy - (points[k][1] - ay) * dx) / length; if (d > worstD) { worstD = d; worst = k; } }
    if (worst >= 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return points.filter((_, k) => keep[k]);
}

// Rings of [x, y] points (times `scale` gives map miles), as flat lists in map miles, simplified
// (repeats left by rounding dropped).
function flatRings(rings, scale, { decimals = GAME_PRODUCTS.ringDecimals, toleranceMiles = GAME_PRODUCTS.toleranceMiles } = {}) {
  const out = [];
  for (const ring of rings) {
    const flat = [];
    for (const [x, y] of simplifyRing(ring.map(([x, y]) => [x * scale, y * scale]), toleranceMiles)) {
      const mx = round(x, decimals), my = round(y, decimals), n = flat.length;
      if (n && flat[n - 2] === mx && flat[n - 1] === my) continue;
      flat.push(mx, my);
    }
    if (flat.length >= 6) out.push(flat);
  }
  return out;
}

// Douglas-Peucker on an open line of [x, y] points, as a flat list rounded to `decimals`.
function flatLine(points, toleranceMiles, decimals) {
  const n = points.length;
  if (!n) return [];
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = n > 2 ? [[0, n - 1]] : [];
  while (stack.length) {
    const [a, b] = stack.pop(), [ax, ay] = points[a], [bx, by] = points[b], dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
    let worst = -1, worstD = toleranceMiles;
    for (let k = a + 1; k < b; k++) {
      const d = length > 1e-12 ? Math.abs((points[k][0] - ax) * dy - (points[k][1] - ay) * dx) / length : Math.hypot(points[k][0] - ax, points[k][1] - ay);
      if (d > worstD) { worstD = d; worst = k; }
    }
    if (worst >= 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return points.filter((_, k) => keep[k]).flatMap(([x, y]) => [round(x, decimals), round(y, decimals)]);
}

// Rings given as shares of the map, as flat lists in map miles.
export const ringsToMiles = (rings, mapMiles, options) => flatRings(rings, mapMiles, options);

// Contour rings (shares of the map) as smooth flat lists in map miles (GAME_PRODUCTS.contourShape).
function contourMiles(rings, mapMiles) {
  const { cuts, toleranceMiles, decimals } = GAME_PRODUCTS.contourShape;
  const smooth = ring => { let points = ring; for (let k = 0; k < cuts; k++) points = cutCorners(points); return points; };
  return flatRings((rings ?? []).map(smooth), mapMiles, { toleranceMiles, decimals });
}

// One outlook day as the game draws it, from what OutlookRuntime.day() gives the web page.
export function gameOutlook(day, published, { nextUpdateHourUtc = null } = {}) {
  const head = { v: GAME_PRODUCTS.version, id: `outlook.${day}`, kind: 'outlook', day: Number(day.slice(3)) };
  if (!published || published.status !== 'issued') return { ...head, status: published?.status ?? 'off', error: published?.error ?? null };
  const o = published, mapMiles = o.width * o.cellMiles, miles = rings => contourMiles(rings, mapMiles);
  // Day 3 is categorical only, and its key has no High risk (none is ever issued that far out).
  const day3 = head.day === 3, hazardOrder = day3 ? [] : o.hazards, categories = day3 ? o.categories.filter(key => key !== "HIGH") : o.categories;
  const hazards = {};
  for (const hazard of hazardOrder) {
    const shapes = o.shapes[hazard];
    hazards[hazard] = {
      levels: shapes.levels.map(entry => ({ level: entry.level, rings: miles(entry.rings) })),
      groups: shapes.groups.map(entry => ({ group: entry.group, rings: miles(entry.rings) })),
      top: o.top[hazard], contourLevels: o.levels[hazard], maxCig: o.maxCig[hazard], cigMeaning: o.cigMeaning[hazard]
    };
  }
  return {
    ...head, status: 'issued', seed: o.seed, mapMiles,
    issuedHourUtc: o.issuedHourUtc, validFromHourUtc: o.validFromHourUtc, validToHourUtc: o.validToHourUtc, nextUpdateHourUtc,
    updating: Boolean(o.running), // an update to this day is being prepared now
    highest: o.highest, headline: o.labels[o.highest], categories, labels: o.labels,
    thunderLevel: o.thunderLevel, radiusMiles: o.radiusMiles ?? RISK_RADIUS_MILES,
    category: o.shapes.category.map(entry => ({ key: entry.key, rings: miles(entry.rings) })),
    hazardOrder, hazards, discussion: o.discussion
  };
}

// The watches and mesoscale discussions in effect, from what MesoscaleRuntime.list() gives the web page.
export function gameMesoscale(list) {
  const head = { v: GAME_PRODUCTS.version, id: 'mesoscale', kind: 'mesoscale' };
  if (!list || list.enabled === false) return { ...head, status: 'off', watches: [], discussions: [] };
  const mapMiles = (list.width ?? 50) * (list.cellMiles ?? 10), miles = rings => ringsToMiles(rings ?? [], mapMiles, GAME_PRODUCTS.polygonShape);
  return {
    ...head, status: 'on', nowHourUtc: list.nowHourUtc,
    watches: list.watches.filter(watch => watch.valid).map(watch => ({
      number: watch.number, type: watch.type, pds: Boolean(watch.pds), title: watch.title, where: watch.where ?? '',
      colourKey: watch.type === 'tornado' ? 'tornado' : 'severe', issuedHourUtc: watch.issuedHourUtc, validToHourUtc: watch.validToHourUtc,
      rings: miles(watch.rings), text: watch.text ?? ''
    })),
    discussions: list.discussions.filter(md => md.valid).map(md => ({
      number: md.number, concerning: md.concerning ?? '', where: md.where ?? '', watchPercent: md.watchPercent ?? null, watchNumber: md.watchNumber ?? null,
      colourKey: discussionColourKey(md), issuedHourUtc: md.issuedHourUtc, validToHourUtc: md.validToHourUtc,
      rings: contourMiles(md.rings, mapMiles), text: md.text ?? ''
    }))
  };
}

// The warnings in effect, the most urgent first, from what WarningRuntime.list() gives the web page.
export function gameWarnings(list) {
  const head = { v: GAME_PRODUCTS.version, id: 'warnings', kind: 'warnings' };
  if (!list || list.enabled === false) return { ...head, status: 'off', warnings: [] };
  return {
    ...head, status: 'on', nowHourUtc: list.nowHourUtc,
    warnings: list.warnings.filter(w => w.valid).sort((a, b) => warningRank(b) - warningRank(a)).map(w => ({
      id: w.id, type: w.type, number: w.number, title: w.title, label: w.label, pds: Boolean(w.pds), emergency: Boolean(w.emergency),
      colourKey: warningColourKey(w), rank: warningRank(w), where: w.where ?? '', issuedHourUtc: w.issuedHourUtc, validToHourUtc: w.validToHourUtc,
      // The polygon is in km from the map's north-west corner.
      rings: flatRings([w.polygon], 1 / KM_PER_MILE, { toleranceMiles: 0, decimals: GAME_PRODUCTS.polygonShape.decimals }), text: w.latestText ?? w.text ?? ''
    }))
  };
}

const FEET_PER_KM = 3280.84;
const MOSAIC_LABELS = { composite: 'Composite reflectivity', base: 'Base reflectivity', echoTops: 'Echo tops', vil: 'VIL', mesh: 'Hail size (MESH)', rotationTrack: 'Rotation tracks (60 min)' };

// The height of the beam's centre above the radar over each gate of a tilt, in thousands of feet
// (what radar viewers show beside a gate's value).
const beamKft = new Map();
function beamHeightsKft(tiltDeg, gateKm = RADAR_GATE_KM) {
  const key = `${tiltDeg}|${gateKm}`, gates = Math.round(RADAR_RANGE_KM / gateKm);
  if (!beamKft.has(key)) beamKft.set(key, Array.from({ length: gates }, (_, g) => round(beamHeightKm((g + 0.5) * gateKm, tiltDeg) * FEET_PER_KM / 1000, 2)));
  return beamKft.get(key);
}

// One radar's tilt as the game draws it: radials clockwise from north, gates outward. A point
// at ground distance d miles is in gate floor(d / gateGroundMiles).
// (a fine scan, of the 250 m gates of a close look, is radar.site.<ID>.<product>.<T>.fine)
export function gameScan(site, scan, product, tiltIndex = 0) {
  const cosTilt = Math.cos(scan.tiltDeg * Math.PI / 180), gateKm = scan.gateKm ?? RADAR_GATE_KM, fine = gateKm < RADAR_GATE_KM;
  return {
    v: GAME_PRODUCTS.version, id: `radar.site.${site.id}.${product}.${tiltIndex}${fine ? '.fine' : ''}`, kind: 'radar-polar', site: site.id, siteName: site.name, product,
    tiltIndex, tiltDeg: scan.tiltDeg, validHourUtc: scan.validHourUtc, xMiles: site.xKm / KM_PER_MILE, yMiles: site.yKm / KM_PER_MILE, fine,
    radials: RADAR_RADIALS, gates: scan.gates ?? RADAR_GATES, gateGroundMiles: gateKm * cosTilt / KM_PER_MILE, gateKm,
    beamKft: beamHeightsKft(scan.tiltDeg, gateKm), stormMotion: scan.stormMotion ?? null, data: pack(scan.products[product])
  };
}

// Every radar together (RadarSimulator buildRadarMosaic): a grid of cellMiles squares from the
// map's north-west corner, row by row, its bytes coloured as `product` (a radar colour table).
export function gameMosaic(mosaic) {
  return {
    v: GAME_PRODUCTS.version, id: `radar.mosaic.${mosaic.kind}`, kind: 'radar-grid', mosaic: mosaic.kind, label: MOSAIC_LABELS[mosaic.kind] ?? mosaic.kind,
    product: MOSAIC_PRODUCT[mosaic.kind], validHourUtc: mosaic.validHourUtc, width: mosaic.width, height: mosaic.height,
    cellMiles: mosaic.resKm / KM_PER_MILE, data: pack(mosaic.bytes),
    // (rotation tracks: the scans taken into it, from fromHourUtc, while it has been asked for)
    ...(mosaic.scans ? { scans: mosaic.scans, fromHourUtc: mosaic.fromHourUtc } : {})
  };
}

// The satellite's image of one kind (ir, visible): a grid of cellMiles squares from the map's
// north-west corner, row by row; sun: its height and bearing (degrees) and the local hour.
export function gameSatellite(sat, kind) {
  return {
    v: GAME_PRODUCTS.version, id: 'satellite.' + kind, kind: 'satellite-grid', product: kind, label: SATELLITE_PRODUCTS[kind].label,
    validHourUtc: sat.validHourUtc, width: sat.width, height: sat.height, cellMiles: sat.resKm / KM_PER_MILE,
    sun: { elevationDeg: +sat.sun.elevationDeg.toFixed(2), azimuthDeg: +sat.sun.azimuthDeg.toFixed(1), localHour: +sat.sun.localHour.toFixed(3) },
    data: pack(sat[kind])
  };
}

// One radar's rotation detections (RotationDetection.js), places in map miles: tvs (kind TVS or
// ETVS, elevated: its base above the lowest tilt and 600 m) with the gate-to-gate delta-V on its
// lowest tilt and at most (kt), meso with its rotational velocity (kt) and diameter (miles); both
// with their base and top (kft above the radar). vrotByEf: the mean 0.5 deg Vrot of tornadoes of
// each rating (Smith et al. 2015), to read a couplet's strength against.
export function gameRotation(site, found) {
  const at = d => ({ xMiles: +(d.xKm / KM_PER_MILE).toFixed(3), yMiles: +(d.yKm / KM_PER_MILE).toFixed(3), tiltDeg: d.tiltDeg, baseKft: d.baseKft, topKft: d.topKft });
  return {
    v: GAME_PRODUCTS.version, id: `radar.rotation.${site.id}`, kind: 'radar-rotation', site: site.id, validHourUtc: found.validHourUtc, tilts: found.tilts,
    tdaRangeMiles: +(TDA.rangeKm / KM_PER_MILE).toFixed(1), vrotByEf: SMITH_2015_VROT_KT,
    tvs: found.tvs.map(d => ({ kind: d.kind, ...at(d), lowDvKt: d.lowDvKt, maxDvKt: d.maxDvKt })),
    meso: found.meso.map(d => ({ ...at(d), lowVrotKt: d.lowVrotKt, maxVrotKt: d.maxVrotKt, diameterMiles: +(d.diameterKm / KM_PER_MILE).toFixed(2) }))
  };
}

// The radars, in map miles, and what can be asked of them.
export function gameRadarSites(catalog) {
  return {
    v: GAME_PRODUCTS.version, id: 'radar.sites', kind: 'radar-sites', tiltDeg: RADAR_TILTS_DEG[0], tilts: RADAR_TILTS_DEG,
    rangeMiles: groundRangeKm(RADAR_RANGE_KM, RADAR_TILTS_DEG[0]) / KM_PER_MILE, siteProducts: GAME_PRODUCTS.radarSiteProducts,
    gateKm: RADAR_GATE_KM, fineGateKm: RADAR_FINE_GATE_KM,
    mosaics: MOSAIC_KINDS.map(kind => ({ kind, label: MOSAIC_LABELS[kind] ?? kind, product: MOSAIC_PRODUCT[kind] })),
    loopFrames: GAME_PRODUCTS.radarLoopFrames,
    sites: catalog.sites.map(site => ({ id: site.id, name: site.name, xMiles: site.xKm / KM_PER_MILE, yMiles: site.yKm / KM_PER_MILE }))
  };
}

// How lightning is coloured by its age, as lightning maps do: the newest white, then yellow,
// orange and red, the oldest dark red. toMinutes: the age each colour lasts to.
export const LIGHTNING_AGES = Object.freeze([
  { toMinutes: 5, colour: [255, 255, 255] }, { toMinutes: 10, colour: [255, 236, 60] }, { toMinutes: 15, colour: [255, 160, 30] },
  { toMinutes: 20, colour: [240, 60, 30] }, { toMinutes: 30, colour: [150, 20, 30] }
]);
const STRIKE_BYTES = 6;

// The lightning of the last half hour, newest last: strikes off the map dropped.
export function gameLightning(log, mapMiles = 500) {
  const head = { v: GAME_PRODUCTS.version, id: 'lightning', kind: 'lightning', keepMinutes: LIGHTNING.keepMinutes, ages: LIGHTNING_AGES, strikeBytes: STRIKE_BYTES };
  if (!log || log.hourUtc === null) return { ...head, nowHourUtc: null, count: 0, ground: 0, data: '' };
  const now = log.hourUtc, kept = [];
  for (const s of log.strikes) {
    const x = s.xKm / KM_PER_MILE, y = s.yKm / KM_PER_MILE, age = (now - s.hourUtc) * 60;
    if (x >= 0 && y >= 0 && x <= mapMiles && y <= mapMiles && age >= 0 && age <= LIGHTNING.keepMinutes) kept.push({ x, y, age, kind: s.kind });
  }
  kept.sort((a, b) => b.age - a.age);
  const bytes = Buffer.alloc(kept.length * STRIKE_BYTES);
  kept.forEach((s, k) => {
    const o = k * STRIKE_BYTES;
    bytes.writeUInt16LE(Math.round(s.x * 100), o); bytes.writeUInt16LE(Math.round(s.y * 100), o + 2);
    bytes.writeUInt8(Math.min(255, Math.round(s.age * 4)), o + 4); bytes.writeUInt8(s.kind, o + 5);
  });
  const ground = kept.filter(s => s.kind !== STRIKE_KIND.cloud).length;
  return { ...head, nowHourUtc: +now.toFixed(4), count: kept.length, ground, data: kept.length ? pack(bytes) : '' };
}

// The days of storm reports the log holds, newest first, from ReportsRuntime.days(). calendar: the locked
// clock's offset, so the game names each day by its start hour, "11/11/26 Day 3" (js/forecast/calendar.js).
export function gameReportDays(log) {
  return { v: GAME_PRODUCTS.version, id: 'reports.days', kind: 'report-days', world: log?.worldId ?? null, currentDay: log?.day ?? null, calendar: calendarFor(), days: logDays(log) };
}

const efOf = rating => (rating === 'EFU' ? -1 : Number(rating.slice(2)));

// One day's storm reports (12Z to 12Z) and its lifted tornadoes as surveyed, as the map draws
// them: each report at its spot with its wording; each tornado's track. `final`: the day is over
// and every tornado of it has lifted, so it will not change again.
export function gameReportDay(entry, surveys, { world = null, final = false } = {}) {
  const r2 = v => round(v, 2);
  return {
    v: GAME_PRODUCTS.version, id: `reports.day.${entry.day}`, kind: 'report-day', world, day: entry.day, startHourUtc: entry.startHourUtc, final,
    // Tornadoes still on the ground: surveyed when they lift.
    ongoing: entry.tornadoes.filter(t => !t.ended).length,
    reports: [...entry.reports].sort((a, b) => a.hourUtc - b.hourUtc).map(r => ({
      type: r.type, hourUtc: r.hourUtc, x: r2(r.x), y: r2(r.y), size: r.size ?? null, speed: r.speed ?? null, measured: Boolean(r.measured),
      significant: significantReport(r), tornadoId: r.tornadoId ?? null, location: r.location, title: reportTitle(r), text: reportText(r)
    })),
    tornadoes: surveys.map(s => ({
      id: s.id, rating: s.rating, ef: efOf(s.rating), startHourUtc: s.startHourUtc, endHourUtc: s.endHourUtc,
      lengthMi: s.lengthMi, maxWidthYards: s.maxWidthYards, peakWindMph: s.peakWindMph, startPlace: s.startPlace, towns: s.towns,
      title: surveyTitle(s), track: flatLine(s.centreline, GAME_PRODUCTS.trackToleranceMiles, 2)
    })).sort((a, b) => a.startHourUtc - b.startHourUtc)
  };
}

// One tornado's damage survey: the EF contours of its swath (rings in map miles), its damage
// points [x, y, indicator, degree of damage, estimated mph, EF, hour] (survey.indicators words
// them), and its summary.
export function gameSurvey(s, { world = null } = {}) {
  const { decimals, toleranceMiles } = GAME_PRODUCTS.survey;
  return {
    v: GAME_PRODUCTS.version, id: `survey.${s.id}`, kind: 'survey', world, day: s.day, tornadoId: s.id, stormId: s.stormId,
    rating: s.rating, ef: efOf(s.rating), peakWindMph: s.peakWindMph, lengthMi: s.lengthMi, maxWidthYards: s.maxWidthYards,
    startHourUtc: s.startHourUtc, endHourUtc: s.endHourUtc,
    track: flatLine(s.centreline, toleranceMiles, decimals),
    contours: s.contours.map(c => ({ ef: c.ef, rings: flatRings(c.polygons, 1, { decimals, toleranceMiles }) })).filter(c => c.rings.length),
    points: s.points.map(p => [round(p.x, decimals), round(p.y, decimals), p.di, p.dod, p.estimatedMph, p.ef, round(p.hourUtc, 3)]),
    title: surveyTitle(s), text: surveySummary(s)
  };
}

// The damage indicators a survey point names: number, name, and each degree of damage
// [description, expected mph, lower bound, upper bound] (the point's dod counts from 1).
export function gameSurveyIndicators() {
  return { v: GAME_PRODUCTS.version, id: 'survey.indicators', kind: 'survey-indicators', indicators: DAMAGE_INDICATORS };
}

const SITE_ID = /^radar\.site\.([A-Z0-9]+)\.([A-Za-z]+)(?:\.(\d{1,2}))?(\.fine)?(?:\.h(\d+))?$/;
const MOSAIC_ID = /^radar\.mosaic\.([A-Za-z]+)(?:\.h(\d+))?$/;
const ROTATION_ID = /^radar\.rotation\.([A-Z0-9]+)$/;
const SATELLITE_ID = /^satellite\.([a-z]+)(?:\.h(\d+))?$/;
const isRadarId = id => SITE_ID.test(id) || MOSAIC_ID.test(id) || ROTATION_ID.test(id) || SATELLITE_ID.test(id);
// The loop a product id belongs to (the same for a radar's lowest tilt with or without ".0").
function radarBase(id) {
  const site = SITE_ID.exec(id);
  if (site) return `radar.site.${site[1]}.${site[2]}.${Number(site[3] ?? 0)}${site[4] ?? ''}`;
  const mosaic = MOSAIC_ID.exec(id);
  if (mosaic) return `radar.mosaic.${mosaic[1]}`;
  const satellite = SATELLITE_ID.exec(id);
  return satellite ? 'satellite.' + satellite[1] : null;
}
const REPORT_DAY_ID = /^reports\.day\.(\d+)$/, SURVEY_ID = /^survey\.(.+)$/;

export class GameProducts {
  // runtime: the weather authority; outlooks, mesoscale, warnings: their runtimes (or null when
  // off); reports: the storm reports and surveys (ReportsRuntime), or null.
  constructor({ runtime, outlooks = null, mesoscale = null, warnings = null, reports = null }) {
    this.runtime = runtime;
    this.reports = reports;
    this.producers = new Map();
    this.kept = new Map();       // id -> { source, ref, version, text }
    this.siteWanted = new Map(); // radar product id (a site's tilt or a mosaic) -> when it was last asked for
    this.history = new Map();    // radar loop (radarBase) -> its last scans [{ key, id, validHourUtc, entry }], oldest first
    for (const day of GAME_PRODUCTS.outlookDays) {
      this.producers.set(`outlook.${day}`, {
        // The issued product object changes only at an issue; the running flag shows "being prepared".
        source: () => (outlooks ? `${outlooks.running?.due.includes(day) ? 'r' : ''}|${outlooks.lastError ?? ''}` : 'off'),
        sourceRef: () => outlooks?.current(day) ?? null,
        build: () => {
          if (!outlooks) return gameOutlook(day, { status: 'off' });
          const product = outlooks.current(day);
          return gameOutlook(day, outlooks.day(day), { nextUpdateHourUtc: product ? outlooks.nextUpdateHourUtc(day, product.outlook.issuedHourUtc) : null });
        }
      });
    }
    // The watches, discussions and warnings change a few times an hour; their lists are cheap to
    // look at, so the signature is worked out from them and the product rebuilt when it differs.
    let mesoList = null, warningList = null;
    this.producers.set('mesoscale', {
      source: () => {
        mesoList = mesoscale ? mesoscale.list() : null;
        if (!mesoList) return 'off';
        const sign = item => `${item.number}:${item.validToHourUtc}:${item.valid ? 1 : 0}:${item.text?.length ?? 0}`;
        return `${mesoList.watches.map(sign).join(',')}|${mesoList.discussions.map(sign).join(',')}`;
      },
      sourceRef: () => runtime.engine ?? null,
      build: () => gameMesoscale(mesoList ?? { enabled: false })
    });
    this.producers.set('warnings', {
      source: () => {
        warningList = warnings ? warnings.list() : null;
        if (!warningList) return 'off';
        return warningList.warnings.map(w => `${w.id}:${w.valid ? 1 : 0}:${w.validToHourUtc}:${w.statements?.length ?? 0}:${w.colourKey ?? warningColourKey(w)}`).join(',');
      },
      sourceRef: () => runtime.engine ?? null,
      build: () => gameWarnings(warningList ?? { enabled: false })
    });
    this.producers.set('lightning', { source: () => String(runtime.lightning?.hourUtc ?? ''), sourceRef: () => runtime.lightning ?? null, build: () => gameLightning(runtime.lightning) });
    this.producers.set('radar.sites', { source: () => '', sourceRef: () => runtime.engine ?? null, build: () => gameRadarSites(runtime.radarCatalog()) });
    if (reports) {
      this.producers.set('reports.days', {
        source: () => logDays(reports.log).map(d => `${d.day}:${d.tornadoes}:${d.reports.tornado}:${d.reports.hail}:${d.reports.wind}`).join(','),
        sourceRef: () => reports.log,
        build: () => gameReportDays(reports.log)
      });
      this.producers.set('survey.indicators', { source: () => '', sourceRef: () => null, build: gameSurveyIndicators });
    }
  }

  // A day's reports or a lifted tornado's survey, while the log holds it (null: none).
  reportProducer(id) {
    const reports = this.reports, log = reports?.log;
    if (!log) return null;
    const dayMatch = REPORT_DAY_ID.exec(id);
    if (dayMatch) {
      const entry = log.days[dayMatch[1]];
      if (!entry) return null;
      const ended = reports.ended(entry.day), final = entry.day < log.day && ended.length === entry.tornadoes.filter(t => t.points.length).length;
      return {
        source: () => `${entry.reports.length}|${ended.map(t => `${t.id}:${t.points.length}`).join(',')}|${entry.tornadoes.length}|${final}`,
        sourceRef: () => log,
        build: () => gameReportDay(entry, ended.map(t => reports.survey(t)), { world: log.worldId, final })
      };
    }
    const surveyMatch = SURVEY_ID.exec(id);
    if (!surveyMatch || surveyMatch[1] === 'indicators') return null;
    for (const entry of Object.values(log.days)) {
      const tornado = entry.tornadoes.find(t => t.id === surveyMatch[1]);
      if (tornado) return tornado.ended && tornado.points.length
        ? { source: () => String(tornado.points.length), sourceRef: () => log, build: () => gameSurvey(reports.survey(tornado), { world: log.worldId }) }
        : null;
    }
    return null;
  }

  // The report products the manifest lists: today's and yesterday's.
  reportIds() {
    const log = this.reports?.log;
    if (!log || log.day == null) return [];
    const ids = [];
    for (const day of [log.day, log.day - 1]) {
      if (!log.days[day]) continue;
      ids.push(`reports.day.${day}`, ...this.reports.ended(day).map(t => `survey.${t.id}`));
    }
    return ids;
  }

  keep(id, producer) {
    const source = producer.source(), ref = producer.sourceRef();
    const kept = this.kept.get(id);
    if (kept && kept.source === source && kept.ref === ref) return kept;
    const text = JSON.stringify(producer.build());
    const entry = { source, ref, version: hashOf(text), text };
    this.kept.set(id, entry);
    return entry;
  }

  // The kept text of a product, rebuilt if its source has changed (null: no such product).
  product(id) {
    const producer = this.producers.get(id) ?? this.reportProducer(id);
    if (!producer) { if (REPORT_DAY_ID.test(id) || SURVEY_ID.test(id)) this.kept.delete(id); return null; }
    return this.keep(id, producer);
  }

  // A single radar's tilt: worked out when asked for (the radar pool's threads), then kept for
  // the scan time. Asking keeps it in the manifest for SITE_WANTED_MS.
  async siteProduct(id, { ask = true } = {}) {
    const match = SITE_ID.exec(id);
    if (!match || !GAME_PRODUCTS.radarSiteProducts.includes(match[2])) return null;
    const tiltIndex = Number(match[3] ?? 0);
    if (!(tiltIndex < RADAR_TILTS_DEG.length)) return null;
    const site = this.runtime.radarCatalog().sites.find(s => s.id === match[1]);
    if (!site) return null;
    if (match[5]) return this.frame(radarBase(id), match[5]);
    if (ask) this.siteWanted.set(id, Date.now());
    const scan = await this.runtime.radarScan(site.id, RADAR_TILTS_DEG[tiltIndex], { fine: Boolean(match[4]) });
    return scan ? this.keepLoop(id, scan, () => gameScan(site, scan, match[2], tiltIndex)) : null;
  }

  // Every radar together, asked for and kept like a radar's scan.
  async mosaicProduct(id, { ask = true } = {}) {
    const match = MOSAIC_ID.exec(id);
    if (!match || !MOSAIC_KINDS.includes(match[1]) || !this.runtime.radarMosaic) return null;
    if (match[2]) return this.frame(radarBase(id), match[2]);
    if (ask) this.siteWanted.set(id, Date.now());
    const mosaic = await this.runtime.radarMosaic(match[1]);
    return mosaic ? this.keepLoop(id, mosaic, () => gameMosaic(mosaic)) : null;
  }

  // A radar's rotation detections (radar.rotation.<site>), asked for and kept like its scans.
  async rotationProduct(id, { ask = true } = {}) {
    const match = ROTATION_ID.exec(id);
    if (!match || !this.runtime.radarRotation) return null;
    const site = this.runtime.radarCatalog().sites.find(s => s.id === match[1]);
    if (!site) return null;
    if (ask) this.siteWanted.set(id, Date.now());
    const found = await this.runtime.radarRotation(site.id);
    if (!found) return null;
    const kept = this.kept.get(id);
    if (kept && kept.ref === found) return kept;
    const text = JSON.stringify(gameRotation(site, found));
    const entry = { source: '', ref: found, version: hashOf(text), text };
    this.kept.set(id, entry);
    return entry;
  }

  // The satellite's image, asked for and kept like the radar's mosaics.
  async satelliteProduct(id, { ask = true } = {}) {
    const match = SATELLITE_ID.exec(id);
    if (!match || !SATELLITE_KINDS.includes(match[1]) || !this.runtime.satellite) return null;
    if (match[2]) return this.frame(radarBase(id), match[2]);
    if (ask) this.siteWanted.set(id, Date.now());
    const sat = await this.runtime.satellite();
    return sat ? this.keepLoop(id, sat, () => gameSatellite(sat, match[1])) : null;
  }

  radarProduct(id, options) {
    if (SITE_ID.test(id)) return this.siteProduct(id, options);
    if (ROTATION_ID.test(id)) return this.rotationProduct(id, options);
    if (SATELLITE_ID.test(id)) return this.satelliteProduct(id, options);
    return this.mosaicProduct(id, options);
  }

  // A radar product kept while its scan (ref) is the newest; each new scan is also remembered,
  // as it is, under its own id (radarBase.h<seconds>), and the product lists those (`loop`).
  keepLoop(id, ref, build) {
    const kept = this.kept.get(id);
    if (kept && kept.ref === ref) return kept;
    const body = build(), base = radarBase(id), key = Math.round(body.validHourUtc * 3600);
    const frameId = `${base}.h${key}`, frameText = JSON.stringify({ ...body, id: frameId });
    const frames = (this.history.get(base) ?? []).filter(f => f.key !== key);
    frames.push({ key, id: frameId, validHourUtc: body.validHourUtc, entry: { source: '', ref: null, version: hashOf(frameText), text: frameText } });
    frames.sort((a, b) => a.key - b.key);
    const held = frames.slice(-GAME_PRODUCTS.radarLoopFrames);
    this.history.set(base, held);
    const text = JSON.stringify({ ...body, id, loop: held.map(f => ({ id: f.id, validHourUtc: f.validHourUtc })) });
    const entry = { source: '', ref, version: hashOf(text), text };
    this.kept.set(id, entry);
    return entry;
  }

  // An earlier scan of a radar loop, while it is held (null: let go).
  frame(base, keyText) { return this.history.get(base)?.find(f => f.key === Number(keyText))?.entry ?? null; }

  // Any product, the radar's included (they may take a moment to work out).
  async productAsync(id) { return isRadarId(id) ? this.radarProduct(id) : this.product(id); }

  manifest(now = Date.now()) {
    const products = {};
    for (const [id, producer] of this.producers) { const entry = this.keep(id, producer); products[id] = { version: entry.version, bytes: entry.text.length }; }
    for (const id of this.reportIds()) { const entry = this.product(id); if (entry) products[id] = { version: entry.version, bytes: entry.text.length }; }
    // The radar products still asked for: the one held, while the next scan's is worked out. A
    // loop is let go with the last of its products.
    for (const [id, at] of this.siteWanted) {
      if (now - at > GAME_PRODUCTS.siteWantedMs) {
        this.siteWanted.delete(id); this.kept.delete(id);
        const base = radarBase(id);
        if (![...this.siteWanted.keys()].some(other => radarBase(other) === base)) this.history.delete(base);
        continue;
      }
      this.radarProduct(id, { ask: false }).catch(() => {});
      const entry = this.kept.get(id);
      if (entry) products[id] = { version: entry.version, bytes: entry.text.length };
    }
    return { v: GAME_PRODUCTS.version, epoch: this.runtime.gameFeed?.epoch ?? 0, simHourUtc: this.runtime.engine?.world?.validHourUtc ?? null, products };
  }
}

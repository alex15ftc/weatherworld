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
//   radar.site.<ID>.<product>       one radar's lowest tilt (reflectivity, velocity or
//                                   stormRelativeVelocity), one byte a gate as js/radar/RadarFormat.js
//                                   encodes it, zstd then base64 in `data`; made when asked for, and
//                                   listed in the manifest while asked for in the last SITE_WANTED_MS
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { RADAR_RADIALS, RADAR_GATES, RADAR_GATE_KM, RADAR_RANGE_KM, RADAR_TILTS_DEG, groundRangeKm } from '../js/radar/RadarFormat.js';
import { discussionColourKey, warningColourKey, warningRank } from '../js/forecast/productColours.js';

const KM_PER_MILE = 1.609344;

// toleranceMiles: rings are simplified to within this (the whole map on a screen is about 0.5 mi a pixel).
export const GAME_PRODUCTS = Object.freeze({
  version: 1, outlookDays: ['day1', 'day2', 'day3'], ringDecimals: 1, toleranceMiles: 0.3,
  radarSiteProducts: ['reflectivity', 'velocity', 'stormRelativeVelocity'], siteWantedMs: 120_000
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

// Rings given as shares of the map, as flat lists in map miles.
export const ringsToMiles = (rings, mapMiles, options) => flatRings(rings, mapMiles, options);

// One outlook day as the game draws it, from what OutlookRuntime.day() gives the web page.
export function gameOutlook(day, published, { nextUpdateHourUtc = null } = {}) {
  const head = { v: GAME_PRODUCTS.version, id: `outlook.${day}`, kind: 'outlook', day: Number(day.slice(3)) };
  if (!published || published.status !== 'issued') return { ...head, status: published?.status ?? 'off', error: published?.error ?? null };
  const o = published, mapMiles = o.width * o.cellMiles, miles = rings => ringsToMiles(rings, mapMiles);
  const hazards = {};
  for (const hazard of o.hazards) {
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
    highest: o.highest, headline: o.labels[o.highest], categories: o.categories, labels: o.labels,
    thunderLevel: o.thunderLevel, radiusMiles: o.radiusMiles ?? 25,
    category: o.shapes.category.map(entry => ({ key: entry.key, rings: miles(entry.rings) })),
    hazardOrder: o.hazards, hazards, discussion: o.discussion
  };
}

// The watches and mesoscale discussions in effect, from what MesoscaleRuntime.list() gives the web page.
export function gameMesoscale(list) {
  const head = { v: GAME_PRODUCTS.version, id: 'mesoscale', kind: 'mesoscale' };
  if (!list || list.enabled === false) return { ...head, status: 'off', watches: [], discussions: [] };
  const mapMiles = (list.width ?? 50) * (list.cellMiles ?? 10), miles = rings => ringsToMiles(rings ?? [], mapMiles);
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
      rings: miles(md.rings), text: md.text ?? ''
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
      rings: flatRings([w.polygon], 1 / KM_PER_MILE, { toleranceMiles: 0 }), text: w.latestText ?? w.text ?? ''
    }))
  };
}

// One radar's tilt as the game draws it: radials clockwise from north, gates outward. A point
// at ground distance d miles is in gate floor(d / gateGroundMiles).
export function gameScan(site, scan, product) {
  const cosTilt = Math.cos(scan.tiltDeg * Math.PI / 180);
  return {
    v: GAME_PRODUCTS.version, id: `radar.site.${site.id}.${product}`, kind: 'radar-polar', site: site.id, siteName: site.name, product,
    tiltDeg: scan.tiltDeg, validHourUtc: scan.validHourUtc, xMiles: site.xKm / KM_PER_MILE, yMiles: site.yKm / KM_PER_MILE,
    radials: RADAR_RADIALS, gates: RADAR_GATES, gateGroundMiles: RADAR_GATE_KM * cosTilt / KM_PER_MILE,
    stormMotion: scan.stormMotion ?? null, data: pack(scan.products[product])
  };
}

// The radars, in map miles.
export function gameRadarSites(catalog) {
  return {
    v: GAME_PRODUCTS.version, id: 'radar.sites', kind: 'radar-sites', tiltDeg: RADAR_TILTS_DEG[0],
    rangeMiles: groundRangeKm(RADAR_RANGE_KM, RADAR_TILTS_DEG[0]) / KM_PER_MILE, siteProducts: GAME_PRODUCTS.radarSiteProducts,
    sites: catalog.sites.map(site => ({ id: site.id, name: site.name, xMiles: site.xKm / KM_PER_MILE, yMiles: site.yKm / KM_PER_MILE }))
  };
}

const SITE_ID = /^radar\.site\.([A-Z0-9]+)\.([A-Za-z]+)$/;

export class GameProducts {
  // runtime: the weather authority; outlooks, mesoscale, warnings: their runtimes (or null when off).
  constructor({ runtime, outlooks = null, mesoscale = null, warnings = null }) {
    this.runtime = runtime;
    this.producers = new Map();
    this.kept = new Map();       // id -> { source, ref, version, text }
    this.siteWanted = new Map(); // site product id -> when it was last asked for
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
    this.producers.set('radar.sites', { source: () => '', sourceRef: () => runtime.engine ?? null, build: () => gameRadarSites(runtime.radarCatalog()) });
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
    const producer = this.producers.get(id);
    return producer ? this.keep(id, producer) : null;
  }

  // A single radar's tilt: worked out when asked for (the radar pool's threads), then kept for
  // the scan time. Asking keeps it in the manifest for SITE_WANTED_MS.
  async siteProduct(id, { ask = true } = {}) {
    const match = SITE_ID.exec(id);
    if (!match || !GAME_PRODUCTS.radarSiteProducts.includes(match[2])) return null;
    const site = this.runtime.radarCatalog().sites.find(s => s.id === match[1]);
    if (!site) return null;
    if (ask) this.siteWanted.set(id, Date.now());
    const scan = await this.runtime.radarScan(site.id, RADAR_TILTS_DEG[0]);
    return scan ? this.keep(id, { source: () => '', sourceRef: () => scan, build: () => gameScan(site, scan, match[2]) }) : null;
  }

  // Any product, the site scans included (they may take a moment to work out).
  async productAsync(id) { return SITE_ID.test(id) ? this.siteProduct(id) : this.product(id); }

  manifest(now = Date.now()) {
    const products = {};
    for (const [id, producer] of this.producers) { const entry = this.keep(id, producer); products[id] = { version: entry.version, bytes: entry.text.length }; }
    // The site scans still asked for: the one held, while the next scan's is worked out.
    for (const [id, at] of this.siteWanted) {
      if (now - at > GAME_PRODUCTS.siteWantedMs) { this.siteWanted.delete(id); this.kept.delete(id); continue; }
      this.siteProduct(id, { ask: false }).catch(() => {});
      const entry = this.kept.get(id);
      if (entry) products[id] = { version: entry.version, bytes: entry.text.length };
    }
    return { v: GAME_PRODUCTS.version, epoch: this.runtime.gameFeed?.epoch ?? 0, simHourUtc: this.runtime.engine?.world?.validHourUtc ?? null, products };
  }
}

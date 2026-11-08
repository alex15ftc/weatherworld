// Rotation found in one radar's volume scan, as the WSR-88D's algorithms find it: from the scanned
// (dealiased) velocity alone, never from the storms themselves, so a couplet far from the radar,
// spread across a wide beam, reads weaker and higher up, as it does on a real radar.
//
// Tornadic vortex signatures (TVS), the Tornado Detection Algorithm (Mitchell et al. 1998, WAF 13,
// 352-366) with its defaults:
//   pattern vectors   gate-to-gate shear: the velocity difference between adjacent radials at the
//                     same range, cyclonic (rising clockwise in azimuth), at least 11 m/s, within
//                     100 km of the radar, where the echo is at least 0 dBZ
//   2-D features      at least 3 pattern vectors touching, on one tilt
//   3-D detections    2-D features on successive tilts within 2.5 km of each other; a TVS has at least
//                     3 of them, a depth of 1.5 km or more (to half a beamwidth beyond each end, as the MDA's), a delta-V of 25 m/s or more on its lowest
//                     tilt and 36 m/s or more on its strongest, and its base on the lowest tilt or
//                     below 600 m; one that meets all but the base is elevated (ETVS)
// Mesocyclones, in the outline of the NSSL Mesocyclone Detection Algorithm (Stumpf et al. 1998,
// WAF 13, 304-326): shear segments - runs of radials at one range over which the velocity rises
// cyclonically, 2-10 km long (the mesocyclone's scale), by 11 m/s or more (the TDA's least) -
// grouped into 2-D features of at least 3 segments touching, and those into 3-D features on
// successive tilts within their own radius; a mesocyclone is one of at least 3 (as the TDA asks) and 3 km deep. Its strength
// is given as rotational velocity, Vrot = (most outbound - most inbound) / 2, on its lowest tilt and
// at most, beside the mean Vrot of tornadoes of each EF rating (Smith et al. 2015, WAF 30, 914-932:
// 0.5 deg peak Vrot, EF0 35, EF1 41, EF2 51, EF3 65, EF4+ 76 kt).
//
// detectRotation(site, scans) -> { tvs: [...], meso: [...] }; scans: scanRadarTilt results of one
// site, any tilts. Places are on the map (km, x east, y south) with their range (km) and bearing (deg).
import { RADAR_RADIALS, RADAR_GATES, RADAR_GATE_KM, RADAR_BEAMWIDTH_DEG, beamHeightKm, groundRangeKm, decodeRadarValue } from './RadarFormat.js';

export const TDA = { vectorMs: 11, rangeKm: 100, leastDbz: 0, vectors: 3, linkKm: 2.5, features: 3, depthKm: 1.5, lowMs: 25, maxMs: 36, baseKm: 0.6 };
// (slackMs: a run goes on through a dip this far below its highest yet, twice the velocity
// estimate's own noise of about 1 m/s, RadarSimulator.js NOISE)
export const MDA = { segmentMs: 11, shortestKm: 2, longestKm: 10, segments: 3, features: 3, depthKm: 3, slackMs: 2 };
export const SMITH_2015_VROT_KT = { EF0: 35, EF1: 41, EF2: 51, EF3: 65, 'EF4+': 76 };
// Byte to value, once: velocity (NaN for none or range folded); whether a reflectivity byte is echo enough.
const VELOCITY = Float32Array.from({ length: 256 }, (_, b) => decodeRadarValue('velocity', b) ?? NaN);
const ECHOES = Uint8Array.from({ length: 256 }, (_, b) => { const dbz = decodeRadarValue('reflectivity', b); return dbz != null && dbz >= TDA.leastDbz ? 1 : 0; });
const MS_TO_KT = 1 / 0.514444, DEG = Math.PI / 180, AZ_STEP = 360 / RADAR_RADIALS;

export function detectRotation(site, scans) {
  const tilts = [...scans].sort((a, b) => a.tiltDeg - b.tiltDeg).map(scan => tiltFeatures(site, scan));
  return { tvs: tvsDetections(tilts), meso: mesoDetections(tilts) };
}

// One tilt's 2-D features of both kinds.
export function tiltFeatures(site, scan) {
  const tilt = scan.tiltDeg, vel = scan.products.velocity, ref = scan.products.reflectivity;
  const v = new Float32Array(RADAR_RADIALS * RADAR_GATES);
  for (let i = 0; i < v.length; i++) v[i] = ECHOES[ref[i]] ? VELOCITY[vel[i]] : NaN;
  const at = (r, g) => v[((r + RADAR_RADIALS) % RADAR_RADIALS) * RADAR_GATES + g];
  const place = (r, g) => {
    const range = (g + 0.5) * RADAR_GATE_KM, ground = groundRangeKm(range, tilt), az = (r + 0.5) * AZ_STEP * DEG;
    return { x: site.xKm + ground * Math.sin(az), y: site.yKm - ground * Math.cos(az), heightKm: beamHeightKm(range, tilt), halfBeamKm: range * Math.sin(RADAR_BEAMWIDTH_DEG / 2 * DEG) };
  };

  // TDA pattern vectors (between radial r and r + 1), grouped.
  const tdaGates = Math.min(RADAR_GATES, Math.floor(TDA.rangeKm / RADAR_GATE_KM)), vectors = new Map();
  for (let r = 0; r < RADAR_RADIALS; r++) for (let g = 0; g < tdaGates; g++) {
    const dv = at(r + 1, g) - at(r, g);
    if (dv >= TDA.vectorMs) vectors.set(r * RADAR_GATES + g, dv);
  }
  const tda = groups(vectors, key => { const r = Math.floor(key / RADAR_GATES), g = key % RADAR_GATES; return [[r - 1, g], [r + 1, g], [r, g - 1], [r, g + 1], [r - 1, g - 1], [r + 1, g + 1], [r - 1, g + 1], [r + 1, g - 1]]; })
    .filter(members => members.length >= TDA.vectors)
    .map(members => {
      let best = members[0];
      for (const m of members) if (vectors.get(m) > vectors.get(best)) best = m;
      const r = Math.floor(best / RADAR_GATES), g = best % RADAR_GATES, p = place(r + 0.5, g);
      return { ...p, dvMs: vectors.get(best), tiltDeg: tilt };
    });

  // MDA shear segments: on each range ring, runs of radials over which the velocity keeps rising.
  const segments = new Map();
  for (let g = 0; g < RADAR_GATES; g++) {
    const range = (g + 0.5) * RADAR_GATE_KM, perRadialKm = range * AZ_STEP * DEG;
    const most = Math.max(1, Math.floor(MDA.longestKm / perRadialKm)), least = Math.max(1, Math.ceil(MDA.shortestKm / perRadialKm));
    for (let r = 0; r < RADAR_RADIALS; r++) {
      if (Number.isNaN(at(r, g)) || !(at(r, g) <= at(r - 1, g)) && !Number.isNaN(at(r - 1, g))) continue; // (a run starts where it stops falling)
      let end = r, low = at(r, g), high = low;
      for (let k = 1; k <= most; k++) {
        const next = at(r + k, g);
        if (Number.isNaN(next) || next < high - MDA.slackMs) break;
        if (next > high) { end = r + k; high = next; }
      }
      const n = end - r;
      if (n >= least && high - low >= MDA.segmentMs) segments.set(g * RADAR_RADIALS + r, { r, n, g, dv: high - low, low, high });
      // (segments do not overlap: the next starts no sooner than where this one reached its highest)
      if (end > r) r = end - 1;
    }
  }
  // (segments touch when they are on neighbouring rings and overlap in azimuth)
  const byRing = new Map();
  for (const [key, s] of segments) { if (!byRing.has(s.g)) byRing.set(s.g, []); byRing.get(s.g).push(key); }
  const mda = groups(segments, key => {
    const s = segments.get(key), out = [];
    for (const g of [s.g - 1, s.g + 1]) for (const k of byRing.get(g) ?? []) { const t = segments.get(k); if (t.r <= s.r + s.n && s.r <= t.r + t.n) out.push(k); }
    return out;
  }, true).filter(members => members.length >= MDA.segments).map(members => {
    let best = segments.get(members[0]);
    for (const m of members) if (segments.get(m).dv > best.dv) best = segments.get(m);
    const p = place(best.r + best.n / 2, best.g), range = (best.g + 0.5) * RADAR_GATE_KM;
    return { ...p, vrotMs: best.dv / 2, diameterKm: range * best.n * AZ_STEP * DEG, tiltDeg: tilt };
  });
  return { tilt, tda, mda };
}

// Connected groups of keys; near(key) gives [r, g] pairs (or keys, with direct).
function groups(items, near, direct = false) {
  const seen = new Set(), out = [];
  for (const start of items.keys()) {
    if (seen.has(start)) continue;
    const members = [], stack = [start];
    seen.add(start);
    while (stack.length) {
      const key = stack.pop();
      members.push(key);
      for (const n of near(key)) {
        const k = direct ? n : ((n[0] + RADAR_RADIALS) % RADAR_RADIALS) * RADAR_GATES + n[1];
        if (!direct && (n[1] < 0 || n[1] >= RADAR_GATES)) continue;
        if (items.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
      }
    }
    out.push(members);
  }
  return out;
}

// Features on successive tilts stacked into columns: each feature joins the column whose top
// (on the tilt below) is nearest within reach(feature, top) km.
function columns(tilts, pick, reach) {
  const done = [];
  let open = [];
  for (const t of tilts) {
    const next = [];
    for (const f of pick(t)) {
      let best = null, bestD = Infinity;
      for (const c of open) { const top = c[c.length - 1], d = Math.hypot(f.x - top.x, f.y - top.y); if (d < reach(f, top) && d < bestD && !next.includes(c)) { best = c; bestD = d; } }
      if (best) { best.push(f); next.push(best); } else next.push([f]);
    }
    for (const c of open) if (!next.includes(c)) done.push(c);
    open = next;
  }
  return done.concat(open);
}

function tvsDetections(tilts) {
  const lowest = tilts[0]?.tilt;
  return columns(tilts, t => t.tda, () => TDA.linkKm)
    .filter(c => c.length >= TDA.features)
    .map(c => {
      const base = c[0], max = Math.max(...c.map(f => f.dvMs)), depthKm = depthOf(c);
      return { base, depthKm, lowMs: base.dvMs, maxMs: max, elevated: !(base.tiltDeg === lowest || base.heightKm <= TDA.baseKm), c };
    })
    .filter(d => d.depthKm >= TDA.depthKm && d.lowMs >= TDA.lowMs && d.maxMs >= TDA.maxMs)
    .map(d => ({ kind: d.elevated ? 'ETVS' : 'TVS', ...where(d.base), lowDvKt: kt(d.lowMs), maxDvKt: kt(d.maxMs), baseKft: kft(d.base.heightKm), topKft: kft(d.c[d.c.length - 1].heightKm), features: d.c.length }));
}

function mesoDetections(tilts) {
  return columns(tilts, t => t.mda, (f, top) => Math.max(1.5, Math.max(f.diameterKm, top.diameterKm) / 2))
    .filter(c => c.length >= MDA.features && depthOf(c) >= MDA.depthKm)
    .map(c => {
      const base = c[0], strongest = c.reduce((a, b) => (b.vrotMs > a.vrotMs ? b : a));
      return { kind: 'meso', ...where(base), lowVrotKt: kt(base.vrotMs), maxVrotKt: kt(strongest.vrotMs), diameterKm: +base.diameterKm.toFixed(1), baseKft: kft(base.heightKm), topKft: kft(c[c.length - 1].heightKm), features: c.length };
    });
}

// A column's depth, as the MDA measures it: from half a beamwidth below its lowest feature's beam
// centre to half a beamwidth above its highest's.
const depthOf = c => (c[c.length - 1].heightKm + c[c.length - 1].halfBeamKm) - (c[0].heightKm - c[0].halfBeamKm);
const kt = ms => Math.round(ms * MS_TO_KT), kft = km => +(km * 3.28084).toFixed(1);
const where = f => ({ xKm: +f.x.toFixed(2), yKm: +f.y.toFixed(2), tiltDeg: f.tiltDeg });

// Azimuthal shear (s^-1) by the linear least squares derivative (LLSD; Smith and Elmore 2004,
// Mahalik et al. 2019, WAF 34, 415-434): the slope, across azimuth, of a plane fitted with equal
// weights to the velocity in a kernel 2500 m wide by 750 m deep (the operational AzShear kernel).
// Here the gates are 500 m, so the kernel is one gate deep; across, it holds the radials that span
// 2500 m at that range, never fewer than 3, so it widens past ~95 km as the real one does past
// ~72 km, and the shear it finds there is weaker. Cyclonic shear is positive (velocity rising
// clockwise). NaN where the centre gate has no velocity or fewer than 3 gates in the kernel have.
export const AZ_SHEAR = { widthKm: 2.5, leastGates: 3 };
// (gates: work out only the first this many. Along each ring the kernel's sums are carried from
// one radial to the next, adding the radial entering it and taking off the one leaving.)
export function azimuthalShear(scan, gates = RADAR_GATES) {
  const vel = scan.products.velocity, ref = scan.products.reflectivity, out = new Float32Array(RADAR_RADIALS * RADAR_GATES).fill(NaN);
  const ring = new Float64Array(RADAR_RADIALS);
  for (let g = 0; g < Math.min(gates, RADAR_GATES); g++) {
    let any = false;
    for (let r = 0; r < RADAR_RADIALS; r++) { const i = r * RADAR_GATES + g; ring[r] = ECHOES[ref[i]] ? VELOCITY[vel[i]] : NaN; if (!any && ring[r] === ring[r]) any = true; }
    if (!any) continue;
    const range = (g + 0.5) * RADAR_GATE_KM, perRadialM = range * AZ_STEP * DEG * 1000;
    const half = Math.min((RADAR_RADIALS >> 1) - 1, Math.max(1, Math.round(AZ_SHEAR.widthKm * 500 / perRadialM)));
    // x: the radial's place along the ring (unwrapped index), in radials; the slope is per radial, then per metre.
    let n = 0, sx = 0, sv = 0, sxx = 0, sxv = 0;
    const add = (k, sign) => { const v = ring[(k + RADAR_RADIALS) % RADAR_RADIALS]; if (v === v) { n += sign; sx += sign * k; sv += sign * v; sxx += sign * k * k; sxv += sign * k * v; } };
    for (let k = -half; k <= half; k++) add(k, 1);
    for (let r = 0; r < RADAR_RADIALS; r++) {
      if (r > 0) { add(r - half - 1, -1); add(r + half, 1); }
      if (ring[r] !== ring[r] || n < AZ_SHEAR.leastGates) continue;
      const spread = sxx - sx * sx / n;
      if (spread > 1e-9) out[r * RADAR_GATES + g] = (sxv - sx * sv / n) / spread / perRadialM;
    }
  }
  return out;
}

// The low-level azimuthal shear of radars' lowest scans laid on a grid (cells resKm square, x east,
// y south): at each cell, the greatest (cyclonic) shear any radar's beam finds there while its centre
// is at most topKm above the radar (the 0-2 km layer of the rotation tracks). into: a Float32Array
// of width * height to take the greatest into (it is not cleared).
export function lowLevelShearGrid(into, width, height, resKm, site, scan, topKm = 2) {
  const tilt = scan.tiltDeg;
  let reachKm = 0;
  while (reachKm < RADAR_GATES * RADAR_GATE_KM && beamHeightKm(reachKm + RADAR_GATE_KM, tilt) <= topKm) reachKm += RADAR_GATE_KM;
  const shear = azimuthalShear(scan, Math.ceil(reachKm / RADAR_GATE_KM));
  const i0 = Math.max(0, Math.floor((site.xKm - reachKm) / resKm)), i1 = Math.min(width - 1, Math.ceil((site.xKm + reachKm) / resKm));
  const j0 = Math.max(0, Math.floor((site.yKm - reachKm) / resKm)), j1 = Math.min(height - 1, Math.ceil((site.yKm + reachKm) / resKm));
  const cosTilt = Math.cos(tilt * DEG);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const dx = (i + 0.5) * resKm - site.xKm, dy = (j + 0.5) * resKm - site.yKm, ground = Math.hypot(dx, dy), range = ground / cosTilt;
    if (range >= reachKm) continue;
    const az = (Math.atan2(dx, -dy) / DEG + 360) % 360;
    const value = shear[(Math.floor(az / AZ_STEP) % RADAR_RADIALS) * RADAR_GATES + Math.floor(range / RADAR_GATE_KM)];
    const cell = j * width + i;
    if (value > 0 && !(into[cell] >= value)) into[cell] = value;
  }
  return into;
}

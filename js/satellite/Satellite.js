// Simulated geostationary satellite images of the whole map (docs/research/RADAR-AND-SATELLITE.md,
// S1 and S2): clean IR (ABI band 13) and visible (band 2), one value a pixel, from the engine's
// own clouds - nothing here is drawn by hand.
//
// Each pixel's column holds up to six clouds, highest first:
//   - the storms' own: their anvils and the plumes above them (AnvilField: what each updraught has
//     detrained, spreading and drifting), and each updraught's top, a dome from the parcel's
//     equilibrium level up to where it stops rising (its overshoot), its water the lifted parcel's
//     condensate;
//   - the large-scale layers of the 16 km cells (RegionalAtmosphere: low, mid and high shares of
//     the sky), each covering that share of the pixels it lies over (a seeded texture moving with
//     the layer's wind decides which), with water from the layer's depth.
// Cloud tops are as warm as the air at their height (the cell's or the storm's sounding), except
// above a storm's equilibrium level, where the overshooting air has cooled dry-adiabatically and is
// colder than its surroundings: the cold anvils and colder overshooting tops of the IR.
// IR: radiance at 10.3 um summed top down, each cloud emitting B(T) by its emissivity
// 1 - exp(-k W) and passing (1 - emissivity) of what is under it, the ground last (Planck, mixed as
// radiance, so thin edges read warm), then back to a temperature.
// Visible: each cloud's reflectance for the sun's height (two-stream, Eddington) as a share of the
// pixel it covers, the layers added (non-absorbing), the ground under them; lit by the sun at the
// slope of the storms' tops (Lambert), and shaded where a storm top between it and the sun stands
// above the sunbeam (passing what that top's cloud lets through).
import { AnvilField } from './AnvilField.js';
import { REGIONAL_DEFAULTS } from '../atmosphere/RegionalAtmosphere.js';
import { WARNING } from '../forecast/Warning.js';
import { makeNoise, fbm } from '../worldmap/noise.js';
import { encodeSatelliteValue } from './SatelliteFormat.js';

export const SATELLITE = Object.freeze({
  resKm: 2,                     // the ABI's IR pixel at the sub-point
  lambdaM: 10.3e-6,             // band 13
  // Mass absorption in the IR (m2/g): liquid ~0.13 (published 0.11-0.16), ice ~0.08 (0.06-0.10;
  // Stephens, AT622 notes, table 16.1).
  kLiquid: 0.13, kIce: 0.08,
  // Visible optical depth: liquid 1.5 LWP / r_e (r_e 10 um); ice IWP (-6.656e-3 + 3.686 / D_ge)
  // (Fu 1996, D_ge 50 um), so about 0.067 a g/m2.
  reUm: 10, dgeUm: 50,
  g: 0.85,                      // asymmetry of cloud scattering
  groundAlbedo: 0.08,           // green spring grassland and crops in the red band, 0.05-0.10
  // Cloud water: a low cloud holds what an adiabatic ascent condenses, 2 g/m3 more each km above
  // its base (so LWP = 0.5 x 2e-3 g/m4 x depth^2); a mid-level layer about 0.02 g/m3 (altostratus
  // of optical depth 2-10 over its 1-3 km); cirrus about 0.01 g/m3 (mid-latitude cirrus 0.001-0.1,
  // Heymsfield & Platt 1984).
  adiabaticLwcPerM: 2e-3, midWaterGm3: 0.02, cirrusIceGm3: 0.01,
  lowDepthM: [150, 2500],
  dryLapseKPerM: 9.8e-3,
  // Heights of the pressure levels the cells keep (m above sea level; 500 hPa is the cell's own).
  levelZ: { 850: 1457, 700: 3012, 250: 10363 }, top: { z: 16180, t: -56 }, // (100 hPa, the soundings' top anchor)
  texture: { low: 14, mid: 30, high: 45 }, // km across a cloud of each layer's texture
  edge: 0.6,                    // how soft a layer's edge is, as a share of its cover (a 2 km pixel
                                // holds part cloud, part clear: mottled grey, not cloud or none)
  // A storm's cloud as the satellite sees it is the frame's, its edges stirred by the turbulence of
  // the spreading outflow (the place it is looked up at moved up to stirKm, over stirScaleKm),
  // smoothed over smoothKm (the pixel's footprint and the anvil's own spread), and its top heaving
  // by up to heaveM over heaveScaleKm (the anvil top's gravity waves and bubbling overshoots).
  stirKm: 5, stirScaleKm: 18, heaveM: 250, heaveScaleKm: 7,
  leastIceGm2: 0.05,            // (a ring thinner than this is not drawn)
  mixKm: 5, shadeIceGm2: 5
});

const C1 = 1.191042e-16, C2 = 1.4387769e-2; // 2hc^2 (W m2 / sr), hc/k (m K)
const planck = (tK, lambda) => C1 / lambda ** 5 / Math.expm1(C2 / (lambda * tK));
const planckInverse = (L, lambda) => C2 / (lambda * Math.log1p(C1 / (lambda ** 5 * L)));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// The sun's height and bearing at a place and time (degrees; bearing clockwise from north). Its
// declination is the one that gives the engine's own day: sunrise and sunset at the local hours
// RegionalAtmosphere keeps, at the map's middle (cos H0 = -tan(lat) tan(dec)).
export function sunAt(latDeg, localHour, { sunriseLocal = REGIONAL_DEFAULTS.sunriseLocal, sunsetLocal = REGIONAL_DEFAULTS.sunsetLocal, middleLatDeg = latDeg } = {}) {
  const rad = Math.PI / 180, h0 = (sunsetLocal - sunriseLocal) / 2 * 15 * rad;
  const dec = Math.atan(-Math.cos(h0) / Math.tan(middleLatDeg * rad)), lat = latDeg * rad, h = (localHour - 12) * 15 * rad;
  const sinE = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h);
  const e = Math.asin(clamp(sinE, -1, 1));
  const az = Math.atan2(-Math.sin(h), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(h));
  return { elevationDeg: e / rad, azimuthDeg: ((az / rad) % 360 + 360) % 360 };
}

// A cloud's reflectance at optical depth tau, the sun at cos mu0 (two-stream, Eddington, black
// ground: [(1-g) tau + (2/3 - mu0)(1 - exp(-tau / mu0))] / [4/3 + (1-g) tau]).
function reflectance(tau, mu0, g = SATELLITE.g) {
  if (!(tau > 0)) return 0;
  const m = Math.max(0.05, mu0);
  return clamp(((1 - g) * tau + (2 / 3 - m) * (1 - Math.exp(-tau / m))) / (4 / 3 + (1 - g) * tau), 0, 1);
}

// Each 16 km cell's clouds and temperatures, once.
function cellClouds(world, regional = null) {
  const S = SATELLITE, nx = world.width, ny = world.height, n = nx * ny;
  const out = {
    nx, ny, cs: world.cellSizeKm, ground: new Float32Array(n), tSurf: new Float32Array(n),
    low: new Float32Array(n), lowTop: new Float32Array(n), lowT: new Float32Array(n), lowW: new Float32Array(n),
    mid: new Float32Array(n), midTop: new Float32Array(n), midT: new Float32Array(n), midW: new Float32Array(n),
    high: new Float32Array(n), highTop: new Float32Array(n), highT: new Float32Array(n), highW: new Float32Array(n)
  };
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const c = world.getCell(x, y), k = y * nx + x, f = c.features ?? {}, L = c.levels;
    const ground = c.terrain?.elevationM ?? 0, tSurf = ((c.surface?.temperature ?? 70) - 32) / 1.8;
    // The cell's temperature at a height (m above sea level), between its levels.
    const anchors = [[ground, tSurf], [S.levelZ[850], L[850].temperature], [S.levelZ[700], L[700].temperature],
      [10 * (L[500].heightDm ?? 570), L[500].temperature], [S.levelZ[250], L[250].temperature], [S.top.z, S.top.t]].filter(([z], i) => i === 0 || z > ground);
    const tAt = z => {
      if (z <= anchors[0][0]) return anchors[0][1];
      for (let i = 1; i < anchors.length; i++) if (anchors[i][0] >= z) { const a = anchors[i - 1], b = anchors[i]; return a[1] + (b[1] - a[1]) * (z - a[0]) / (b[0] - a[0]); }
      return anchors[anchors.length - 1][1];
    };
    out.ground[k] = ground; out.tSurf[k] = tSurf + 273.15;
    // Low: from the LCL to the moist layer's top (the cumulus and stratus of the share).
    const base = Math.max(ground, c.derived?.lcl ?? ground + 1000);
    const depth = clamp((f.moistLayerTopM ?? base + 500) - base, S.lowDepthM[0], S.lowDepthM[1]);
    out.low[k] = clamp(f.cloudLow ?? 0, 0, 1); out.lowTop[k] = base + depth; out.lowT[k] = tAt(base + depth) + 273.15;
    out.lowW[k] = 0.5 * S.adiabaticLwcPerM * depth * depth;
    // Mid: the ascent's layer from 700 hPa up, deeper the more of the sky it covers.
    const z700 = S.levelZ[700], z500 = 10 * (L[500].heightDm ?? 570), mid = clamp(f.cloudMid ?? 0, 0, 1), midDepth = Math.max(200, mid * (z500 - z700));
    out.mid[k] = mid; out.midTop[k] = z700 + midDepth; out.midT[k] = tAt(z700 + midDepth) + 273.15; out.midW[k] = S.midWaterGm3 * midDepth;
    // High: cirrus topped at the jet's level, hanging lower the more of it there is.
    // (where the cell's high share is the storms' anvil, its own cirrus is not known, and the anvil is AnvilField's)
    const high = regional?.anvil && regional.anvil[k] >= (f.cloudHigh ?? 0) - 1e-9 ? 0 : clamp(f.cloudHigh ?? 0, 0, 1), highDepth = Math.max(300, high * 0.5 * (S.levelZ[250] - z500));
    out.high[k] = high; out.highTop[k] = S.levelZ[250]; out.highT[k] = tAt(S.levelZ[250]) + 273.15; out.highW[k] = S.cirrusIceGm3 * highDepth;
  }
  return out;
}

// A cell field at a map place (km), bilinear between cell centres.
function cellAt(cc, field, xKm, yKm) {
  const gx = clamp(xKm / cc.cs - 0.5, 0, cc.nx - 1), gy = clamp(yKm / cc.cs - 0.5, 0, cc.ny - 1);
  const i = Math.min(cc.nx - 2, Math.floor(gx)), j = Math.min(cc.ny - 2, Math.floor(gy)), tx = gx - i, ty = gy - j, a = field, k = j * cc.nx + i;
  return (a[k] * (1 - tx) + a[k + 1] * tx) * (1 - ty) + (a[k + cc.nx] * (1 - tx) + a[k + cc.nx + 1] * tx) * ty;
}

// The domain's mean wind at a level (km/h east, south), to move a layer's texture.
function meanWind(world, level) {
  let u = 0, v = 0, n = 0;
  world.forEachCell(c => { const l = c.levels[level], d = (l.windDirection ?? 0) * Math.PI / 180, s = (l.windSpeed ?? 0) * 1.852; u -= s * Math.sin(d); v += s * Math.cos(d); n++; });
  return { u: u / n, v: v / n };
}

// What the storms' clouds are made from, read from the world: each puff's ring now (RING_FIELDS
// numbers a puff) and the updraughts' domes on the pixel grid.
const RING_FIELDS = 8; // x, y (km), inner, outer (km), iwp (g/m2), z (m above sea level), tK, plume (1/0)
function puffRings(anvils) {
  const S = SATELLITE, out = [];
  for (const p of anvils.puffs) {
    const r = anvils.ring(p, anvils.hourUtc);
    if (!r || !(r.outer > r.inner)) continue;
    const iwp = 1000 * r.iceKg / (Math.PI * (r.outer * r.outer - r.inner * r.inner) * 1e6);
    if (!(iwp > S.leastIceGm2)) continue;
    out.push(r.x, r.y, r.inner, r.outer, iwp, p.z, p.tK, p.plume ? 1 : 0);
  }
  return Float64Array.from(out);
}

// The domes: from the equilibrium level up to the parcel's top over the core, as cold as air
// lifted dry-adiabatically that high, holding the lifted parcel's condensate down its middle.
function domeClouds(world, anvils, width, height, res) {
  const S = SATELLITE, N = width * height, dome = { ice: new Float32Array(N), top: new Float32Array(N), temp: new Float32Array(N) };
  const cellKm = world.cellSizeKm;
  for (const { ct, storm } of anvils.tops.values()) {
    const pos = storm.positionKm, cell = world.getCell(clamp(Math.floor(pos.x / cellKm), 0, world.width - 1), clamp(Math.floor(pos.y / cellKm), 0, world.height - 1));
    const ground = cell?.terrain?.elevationM ?? 0, tEl = ct.sd.at(ct.el).t;
    let coreW = 0;
    for (const l of ct.pr.levels) { if (l.z > ct.top) break; const e = ct.sd.at(l.z); coreW += 1000 * l.qc * (e.p * 100 / (287 * (e.t + 273.15))) * 100; }
    const cx = pos.x + ct.U[0] / 1000, cy = pos.y - ct.U[1] / 1000, R = ct.coreM / 1000;
    const i0 = Math.max(0, Math.floor((cx - R) / res)), i1 = Math.min(width - 1, Math.floor((cx + R) / res));
    const j0 = Math.max(0, Math.floor((cy - R) / res)), j1 = Math.min(height - 1, Math.floor((cy + R) / res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const r2 = (((i + 0.5) * res - cx) ** 2 + ((j + 0.5) * res - cy) ** 2) / (R * R);
      if (r2 >= 1) continue;
      const k = j * width + i, zAgl = ct.el + (ct.top - ct.el) * (1 - r2);
      if (zAgl + ground <= dome.top[k]) continue;
      dome.top[k] = zAgl + ground; dome.temp[k] = Math.min(ct.sd.at(zAgl).t, tEl - S.dryLapseKPerM * (zAgl - ct.el)) + 273.15;
      dome.ice[k] = Math.max(dome.ice[k], coreW * Math.exp(-r2));
    }
  }
  return dome;
}

// The storms' clouds on the pixel grid, as three layers - each storm's updraught dome, the
// anvils (every puff's ring) and the plumes above them - each with its water (g/m2: ice), top
// (m above sea level) and temperature there (K, the ice's mean where layers' clouds overlap);
// and all together (ice summed, the highest top) for lighting and shadows.
function stormClouds(rings, dome, width, height, res, seed) {
  const S = SATELLITE, N = width * height;
  const layer = () => ({ ice: new Float32Array(N), top: new Float32Array(N), temp: new Float32Array(N) });
  const anvil = layer(), plume = layer();
  const stirX = makeNoise(seed, 'sat-stir-x'), stirY = makeNoise(seed, 'sat-stir-y'), heave = makeNoise(seed, 'sat-heave');
  // Each pixel's stirring (the ragged edges of the spreading outflow) and heave (the top's waves).
  const wx = new Float32Array(N), wy = new Float32Array(N), heaveAt = new Float32Array(N);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const X = (i + 0.5) * res, Y = (j + 0.5) * res, p = j * width + i;
    wx[p] = S.stirKm * fbm(stirX, X / S.stirScaleKm, Y / S.stirScaleKm, 2); wy[p] = S.stirKm * fbm(stirY, X / S.stirScaleKm, Y / S.stirScaleKm, 2);
    heaveAt[p] = S.heaveM * fbm(heave, X / S.heaveScaleKm, Y / S.heaveScaleKm, 3);
  }
  let stirMax = 0;
  for (let p = 0; p < N; p++) stirMax = Math.max(stirMax, Math.abs(wx[p]), Math.abs(wy[p]));
  const slack = Math.SQRT2 * stirMax + res; // (how far the stirring and a pixel's width can move a pixel)
  // The anvils and plumes: each puff's ring, the share of each pixel it covers (along the radius,
  // the pixel's width) holding its ice spread over the ring.
  for (let q = 0; q < rings.length; q += RING_FIELDS) {
    const r = { x: rings[q], y: rings[q + 1], inner: rings[q + 2], outer: rings[q + 3] }, iwp = rings[q + 4], p = { z: rings[q + 5], tK: rings[q + 6] };
    // (each row only across the ring, its hole left out: the pixels the stirring could bring in)
    const L = rings[q + 7] ? plume : anvil, Ro = r.outer + slack, Ri = Math.max(0, r.inner - slack);
    const j0 = Math.max(0, Math.floor((r.y - Ro) / res)), j1 = Math.min(height - 1, Math.floor((r.y + Ro) / res));
    for (let j = j0; j <= j1; j++) {
      const dy = Math.abs((j + 0.5) * res - r.y), near = Math.max(0, dy - res), far = dy + res;
      if (near >= Ro) continue;
      const xo = Math.sqrt(Ro * Ro - near * near), xh = far < Ri ? Math.sqrt(Ri * Ri - far * far) : 0;
      const a0 = Math.max(0, Math.floor((r.x - xo) / res)), a1 = Math.min(width - 1, Math.floor((r.x + xo) / res));
      const h0 = Math.ceil((r.x - xh) / res), h1 = Math.floor((r.x + xh) / res) - 1;
      for (let i = a0; i <= a1; i++) {
      if (xh > 0 && i > h0 && i < h1) { i = h1 - 1; continue; }
      const k = j * width + i, d = Math.hypot((i + 0.5) * res + wx[k] - r.x, (j + 0.5) * res + wy[k] - r.y);
      const share = Math.max(0, Math.min(d + res / 2, r.outer) - Math.max(d - res / 2, r.inner)) / res;
      if (!(share > 0)) continue;
      const w = iwp * share;
      L.ice[k] += w; L.top[k] += w * p.z; L.temp[k] += w * p.tK;
      }
    }
  }
  // Mixed by the outflow's turbulence over mixKm (the rings a moving storm leaves blend into one
  // sheet): ice spread, its top and temperature the mixed ice's mean.
  for (const L of [anvil, plume]) {
    const ice = gaussian(L.ice, width, height, S.mixKm / res), top = gaussian(L.top, width, height, S.mixKm / res), temp = gaussian(L.temp, width, height, S.mixKm / res);
    for (let k = 0; k < N; k++) {
      L.ice[k] = ice[k] > S.leastIceGm2 ? ice[k] : 0;
      if (L.ice[k] > 0) { L.top[k] = top[k] / ice[k] + heaveAt[k]; L.temp[k] = temp[k] / ice[k]; } else { L.top[k] = 0; L.temp[k] = 0; }
    }
  }
  // (lit and shading by the highest cloud thick enough to (shadeIceGm2: optical depth ~0.3); a
  // wisp of plume over the anvil neither tilts the light nor casts a shadow)
  const ice = new Float32Array(N), top = new Float32Array(N);
  for (let k = 0; k < N; k++) for (const L of [dome, anvil, plume]) if (L.ice[k] > S.shadeIceGm2) { ice[k] += L.ice[k]; top[k] = Math.max(top[k], L.top[k]); }
  return { layers: [dome, anvil, plume], ice, top };
}

// A separable Gaussian blur (sigma in pixels), edges held.
function gaussian(a, w, h, sigma) {
  const r = Math.ceil(4 * sigma), ker = Array.from({ length: 2 * r + 1 }, (_, q) => Math.exp(-0.5 * ((q - r) / sigma) ** 2)), sum = ker.reduce((p, q) => p + q, 0);
  const tmp = new Float32Array(a.length), out = new Float32Array(a.length);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { let v = 0; for (let q = -r; q <= r; q++) v += a[j * w + clamp(i + q, 0, w - 1)] * ker[q + r]; tmp[j * w + i] = v / sum; }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { let v = 0; for (let q = -r; q <= r; q++) v += tmp[clamp(j + q, 0, h - 1) * w + i] * ker[q + r]; out[j * w + i] = v / sum; }
  return out;
}

// Both images at once (bytes as SatelliteFormat encodes them, row by row from the map's north-west
// corner), and the sun they were taken under: satelliteInputs, then renderSatellite.
export function buildSatellite(world, options = {}) {
  return renderSatellite(satelliteInputs(world, options));
}

// What the images are made from, read from the world (the quick part): plain numbers and typed
// arrays, so renderSatellite (the slow part) can run on another thread (server/satelliteWorker.js).
// regional: the RegionalAtmosphere, so the cells' high cloud is their own cirrus and not the coarse
// anvil it keeps from storms (the anvils here are AnvilField's); anvils: the AnvilField kept up to
// date each storm tick (without one, a new one, its puffs from the storms' tracks).
export function satelliteInputs(world, { seed = world.seed ?? 1, kinds = ['ir', 'visible'], regional = null, anvils = null } = {}) {
  const S = SATELLITE, res = S.resKm, domainKm = world.width * world.cellSizeKm;
  const width = Math.ceil(domainKm / res), height = Math.ceil(world.height * world.cellSizeKm / res);
  const hourUtc = Number(world.stormEngine?.validHourUtc ?? world.validHourUtc) || 0;
  const localHour = ((hourUtc + REGIONAL_DEFAULTS.utcOffsetHours) % 24 + 24) % 24;
  const field = anvils ?? new AnvilField().update(world);
  if (field.hourUtc == null || Math.abs(field.hourUtc - hourUtc) > 1e-6) field.update(world);
  const [north] = WARNING.mapNorthwest, middleLatDeg = north - domainKm / 2 / 111.1;
  return {
    seed, kinds, width, height, res, hourUtc, localHour, sun: sunAt(middleLatDeg, localHour, { middleLatDeg }),
    cc: cellClouds(world, regional), winds: { low: meanWind(world, 850), mid: meanWind(world, 500), high: meanWind(world, 250) },
    rings: puffRings(field), dome: domeClouds(world, field, width, height, res)
  };
}

// The images from satelliteInputs (no world needed).
export function renderSatellite({ seed, kinds, width, height, res, hourUtc, localHour, sun, cc, winds, rings, dome }) {
  const S = SATELLITE, N = width * height;
  const storms = stormClouds(rings, dome, width, height, res, seed);
  const noise = { low: makeNoise(seed, 'sat-low'), mid: makeNoise(seed, 'sat-mid'), high: makeNoise(seed, 'sat-high') };
  const mu0 = Math.sin(Math.max(0, sun.elevationDeg) * Math.PI / 180), lit = sun.elevationDeg > 0;
  const lambda = S.lambdaM, tauIce = 3.686 / S.dgeUm - 6.656e-3, tauLiquid = 1.5 / S.reUm;

  const ir = new Uint8Array(N), visible = new Uint8Array(N), surfaceTop = new Float32Array(N), stormTau = new Float32Array(N), refl = new Float32Array(N);
  const layer = { z: new Float64Array(8), t: new Float64Array(8), eps: new Float64Array(8), r: new Float64Array(8) };
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const x = (i + 0.5) * res, y = (j + 0.5) * res, k = j * width + i;
    let n = 0;
    const add = (z, tK, eps, r) => { // (kept highest first)
      let p = n++;
      while (p > 0 && layer.z[p - 1] < z) { layer.z[p] = layer.z[p - 1]; layer.t[p] = layer.t[p - 1]; layer.eps[p] = layer.eps[p - 1]; layer.r[p] = layer.r[p - 1]; p--; }
      layer.z[p] = z; layer.t[p] = tK; layer.eps[p] = eps; layer.r[p] = r;
    };
    // The storms' cloud covers its pixels.
    for (const L of storms.layers) if (L.ice[k] > 0) {
      const tau = tauIce * L.ice[k];
      stormTau[k] += tau;
      add(L.top[k], L.temp[k], 1 - Math.exp(-S.kIce * L.ice[k]), reflectance(tau, mu0));
    }
    // Each large-scale layer covers its share of the pixels (texture moved by its wind).
    for (const [name, ice] of [['high', true], ['mid', false], ['low', false]]) {
      const share = cellAt(cc, cc[name], x, y);
      if (!(share > 0.005)) continue;
      const wind = winds[name], scale = S.texture[name];
      const tex = 0.5 + 0.5 * fbm(noise[name], (x - wind.u * hourUtc) / scale, (y + wind.v * hourUtc) / scale, name === 'low' ? 1 : 2);
      const cover = clamp((share - tex) / S.edge + 0.5, 0, 1) * Math.min(1, share / S.edge);
      if (!(cover > 0)) continue;
      // (thicker deeper inside the texture's cloud, thinner at its edges: the layer's water as a mean)
      const w = cellAt(cc, cc[name + 'W'], x, y) * 2 * clamp((share - tex) / Math.max(S.edge, share) + 0.5, 0.1, 1), tK = cellAt(cc, cc[name + 'T'], x, y), z = cellAt(cc, cc[name + 'Top'], x, y);
      // (a mid layer is ice where colder than -20 C, water where warmer than 0, mixed between)
      const iceShare = ice ? 1 : name === 'mid' ? clamp((273.15 - tK) / 20, 0, 1) : 0;
      const kAbs = iceShare * S.kIce + (1 - iceShare) * S.kLiquid, tau = (iceShare * tauIce + (1 - iceShare) * tauLiquid) * w;
      add(z, tK, cover * (1 - Math.exp(-kAbs * w)), cover * reflectance(tau, mu0));
    }
    // IR: top down.
    let L = 0, pass = 1;
    for (let q = 0; q < n; q++) { L += pass * layer.eps[q] * planck(layer.t[q], lambda); pass *= 1 - layer.eps[q]; }
    L += pass * planck(cellAt(cc, cc.tSurf, x, y), lambda);
    ir[k] = encodeSatelliteValue('ir', planckInverse(L, lambda) - 273.15);
    // Visible: the layers added (R12 = R1 + T1^2 R2 / (1 - R1 R2), T = 1 - R), the ground last.
    let R = 0;
    for (let q = 0; q < n; q++) { const r = layer.r[q], t = 1 - R; R = R + t * t * r / Math.max(1e-6, 1 - R * r); }
    { const A = S.groundAlbedo, t = 1 - R; R = R + t * t * A / Math.max(1e-6, 1 - R * A); }
    refl[k] = R;
    surfaceTop[k] = storms.ice[k] > 0 ? storms.top[k] : cellAt(cc, cc.ground, x, y);
  }

  if (kinds.includes('visible')) {
    const rad = Math.PI / 180, sx = Math.sin(sun.azimuthDeg * rad), sy = -Math.cos(sun.azimuthDeg * rad); // (toward the sun; y south)
    const tanE = Math.tan(Math.max(0.5, sun.elevationDeg) * rad), cosE = Math.cos(Math.max(0, sun.elevationDeg) * rad);
    let highest = 0;
    for (let k = 0; k < N; k++) if (storms.ice[k] > 0 && storms.top[k] > highest) highest = storms.top[k];
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
      const k = j * width + i;
      if (!lit) { visible[k] = encodeSatelliteValue('visible', 0); continue; }
      // Lit at the slope of the storm's top (flat elsewhere): cos of the sun's angle to its normal.
      let light = mu0;
      if (storms.ice[k] > 0) {
        const at = (a, b) => { const kk = clamp(b, 0, height - 1) * width + clamp(a, 0, width - 1); return storms.ice[kk] > 0 ? storms.top[kk] : storms.top[k]; };
        const gx = (at(i + 1, j) - at(i - 1, j)) / (2000 * res), gy = (at(i, j + 1) - at(i, j - 1)) / (2000 * res);
        const nz = 1 / Math.hypot(gx, gy, 1);
        light = Math.max(0, (-gx * nz) * sx * cosE + (-gy * nz) * sy * cosE + nz * mu0);
      }
      // Shaded where a storm top toward the sun stands above the sunbeam.
      let through = 1;
      const z0 = surfaceTop[k], reach = (highest - z0) / 1000 / tanE;
      for (let d = res; d <= Math.min(reach, 300); d += res) {
        const a = Math.round(i + sx * d / res), b = Math.round(j + sy * d / res);
        if (a < 0 || b < 0 || a >= width || b >= height) break;
        const q = b * width + a;
        if (storms.ice[q] > 0 && storms.top[q] > z0 + d * 1000 * tanE) through = Math.min(through, 1 - reflectance(stormTau[q], mu0));
      }
      visible[k] = encodeSatelliteValue('visible', refl[k] * light * through);
    }
  }
  return { width, height, resKm: res, validHourUtc: hourUtc, sun: { ...sun, localHour }, ir, visible };
}

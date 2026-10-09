// Converts a storm's structural description (StormStructureEngine features: forward flank,
// updraft, hail core, hook, inflow notch, rear flank, convective line, rear-inflow jet,
// debris, mesocyclone) into a storm-aligned hydrometeor raster plus analytic vortices that
// the radar simulator samples. Frame: +a downstream along motion, +b right of motion.

export const ECHO_RES_KM = 1;
const ECHO_FIELDS = ['rain', 'graupel', 'hail', 'ice', 'updraft', 'downdraft', 'debris', 'rearInflow'];
const DEG = Math.PI / 180;

export function buildStormEchoModel(storm) {
  const structure = storm.structure;
  if (!structure?.features?.length) return null;
  const theta = (Number(structure.orientationDeg ?? storm.orientationDeg) || 0) * DEG;
  // Screen frame: x east, y south. Motion unit vector m and right-of-motion vector r.
  const mx = Math.sin(theta), my = Math.cos(theta), rx = -my, ry = mx;
  const echoScale = clamp(Math.sqrt(lifecycleFactor(storm.lifecycleState)) * (0.55 + 0.45 * clamp(Number(storm.intensity) || 0, 0, 1)), 0.08, 0.95);

  const extent = Math.max(Number(structure.widthKm) || 40, Number(structure.heightKm) || 40);
  const half = clamp(extent * 0.8 + 10, 20, 120);
  const size = Math.ceil(2 * half / ECHO_RES_KM) + 1;
  const fields = Object.fromEntries(ECHO_FIELDS.map(name => [name, new Float32Array(size * size)]));
  const notch = new Float32Array(size * size).fill(1);

  const character = stormCharacter(storm, structure);
  for (const feature of structure.features.map(f => varyFeature(f, character, structure))) {
    if (feature.type === 'hookArc') stampHook(feature, fields, size, half);
    else if (feature.type === 'convectiveLine') { stampLine(feature, fields, size, half); carveTransitionZone(feature, notch, size, half); }
    else stampLobe(feature, fields, notch, size, half);
  }
  const texture = convectiveTexture(character, size, half, Number(storm.ageHours) || 0);
  const debris = fields.debris;
  for (const name of ECHO_FIELDS) {
    if (name !== 'debris') fields[name] = warpField(fields[name], texture.warp, size);
    const f = fields[name];
    const scale = name === 'debris' || name === 'rearInflow' ? 1 : echoScale;
    const textured = name === 'rain' || name === 'graupel' || name === 'hail';
    // No texture where debris is lofted: the debris signature must not be diluted by a random core.
    for (let i = 0; i < f.length; i++) {
      const gain = textured ? 1 + (texture.gain[i] - 1) * (1 - clamp(debris[i] / 0.15, 0, 1)) : 1;
      f[i] = Math.max(0, f[i] * (name === 'rain' ? notch[i] : 1) * gain) * scale;
    }
  }

  const meso = structure.mesocyclone ?? {};
  const toScreen = (a, b) => ({ x: a * mx + b * rx, y: a * my + b * ry });
  const mesoOffset = toScreen(Number(meso.offsetXKm) || 0, Number(meso.offsetYKm) || 0);
  const debrisLobe = structure.features.find(f => f.type === 'debris');
  const tornado = storm.tornado;
  const tornadoOnGround = Boolean(tornado?.onGround);
  const tornadoOffset = debrisLobe ? toScreen(debrisLobe.centerXKm, debrisLobe.centerYKm) : mesoOffset;
  const tornadoWidthKm = clamp((Number(tornado?.widthYards) || 300) / 1094, 0.1, 2.5);
  const tornadoWindMs = (Number(tornado?.windSpeedMph) || 90) * 0.447;

  return {
    half, size, fields, mx, my, rx, ry, regime: character.regime,
    mesocyclone: {
      x: mesoOffset.x, y: mesoOffset.y,
      radiusKm: clamp(Number(meso.radiusKm) || 4, 1.5, 8),
      vmaxMs: (6 + 30 * clamp(Number(meso.strength) || 0, 0, 1.25)) * Math.sqrt(lifecycleFactor(storm.lifecycleState))
    },
    tornado: tornadoOnGround ? { x: tornadoOffset.x, y: tornadoOffset.y, radiusKm: tornadoWidthKm / 2, vmaxMs: clamp(tornadoWindMs * 0.85, 25, 135) } : null
  };
}

// Bilinear sample of an echo field at a screen-frame offset (km) from the storm centre.
export function sampleEcho(model, name, dx, dy) {
  const a = dx * model.mx + dy * model.my, b = dx * model.rx + dy * model.ry;
  const fx = (a + model.half) / ECHO_RES_KM, fy = (b + model.half) / ECHO_RES_KM, n = model.size;
  if (fx < 0 || fy < 0 || fx > n - 1 || fy > n - 1) return 0;
  const x0 = Math.min(n - 2, Math.floor(fx)), y0 = Math.min(n - 2, Math.floor(fy)), tx = fx - x0, ty = fy - y0;
  const f = model.fields[name], i = y0 * n + x0;
  return (f[i] * (1 - tx) + f[i + 1] * tx) * (1 - ty) + (f[i + n] * (1 - tx) + f[i + n + 1] * tx) * ty;
}

// Sample several fields at once; returns false when outside the raster.
export function sampleEchoInto(model, dx, dy, out) {
  const a = dx * model.mx + dy * model.my, b = dx * model.rx + dy * model.ry;
  const fx = (a + model.half) / ECHO_RES_KM, fy = (b + model.half) / ECHO_RES_KM, n = model.size;
  if (fx < 0 || fy < 0 || fx > n - 1 || fy > n - 1) return false;
  const x0 = Math.min(n - 2, Math.floor(fx)), y0 = Math.min(n - 2, Math.floor(fy)), tx = fx - x0, ty = fy - y0;
  const i = y0 * n + x0, w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
  for (const name of ECHO_FIELDS) {
    const f = model.fields[name];
    out[name] = f[i] * w00 + f[i + 1] * w10 + f[i + n] * w01 + f[i + n + 1] * w11;
  }
  return true;
}

// Gradient (per km, screen frame) of an echo field; used for outflow and divergence.
export function echoGradient(model, name, dx, dy, out) {
  const h = ECHO_RES_KM;
  out.x = (sampleEcho(model, name, dx + h, dy) - sampleEcho(model, name, dx - h, dy)) / (2 * h);
  out.y = (sampleEcho(model, name, dx, dy + h) - sampleEcho(model, name, dx, dy - h)) / (2 * h);
  return out;
}

// --- Per-storm variety -----------------------------------------------------------------
// regime: -1 low-precipitation .. 0 classic .. +1 high-precipitation supercell, from cloud-base
// height (a low LCL means moist boundary-layer air), moisture pooling and the structure's
// precipitation efficiency (relative to its typical 0.2-0.5 range), plus a per-storm draw.
function stormCharacter(storm, structure) {
  const random = mulberry32(hashString(String(storm.id ?? storm.name ?? 'storm')));
  const env = storm.environment ?? {};
  const precipEff = Number(structure.precipitationEfficiency) || 0.35;
  const lcl = Number(env.lcl) || 1250, pooling = Number(env.moisturePooling);
  const regime = clamp(0.9 * (1250 - lcl) / 450 + 1.2 * (precipEff - 0.33) + (Number.isFinite(pooling) ? 0.4 * (pooling - 0.5) : 0) + (random() - 0.5) * 0.8, -1, 1);
  // Trailing stratiform rain takes hours to build behind a new line.
  const lineMaturity = clamp(0.3 + 0.7 * (Number(storm.modeAgeHours) || 0) / 3, 0.3, 1);
  return { random, regime, lineMaturity, seed: hashString(`${storm.id ?? 'storm'}|texture`) };
}

// Clone a structural feature with the storm's regime and a deterministic per-feature jitter
// (storm.structure is shared simulation state and must not be mutated).
function varyFeature(feature, character, structure) {
  const f = { ...feature }, r = character.random, hp = Math.max(0, character.regime), lp = Math.max(0, -character.regime);
  const j = () => r() - 0.5;
  if (f.type === 'hookArc') {
    f.thicknessKm *= 1 + 1.1 * hp - 0.35 * lp + 0.3 * j();
    f.intensity *= 1 + 0.45 * hp - 0.55 * lp;
    f.endDeg = Math.min(360, f.endDeg + 25 * hp + 20 * j());
    f.radiusKm *= 1 + 0.25 * j();
    return f;
  }
  if (f.type === 'convectiveLine') {
    f.bowKm *= 0.6 + 0.9 * r();
    f.widthKm *= 0.8 + 0.4 * r();
    f.lengthKm *= 0.85 + 0.3 * r();
    f.rain = (f.rain ?? 0.8) * 1.3; f.graupel = (f.graupel ?? 0.2) * 1.2; // intense, narrow leading line
    return f;
  }
  if (f.type === 'debris') {
    // Stays on the vortex (the velocity couplet uses the unjittered position); rain-wrapped
    // tornadoes still loft enough debris to dominate the sample at the vortex.
    f.debris = (f.debris ?? 0) * (1 + 0.8 * hp);
    return f;
  }
  f.radiusXKm *= 0.82 + 0.36 * r(); f.radiusYKm *= 0.82 + 0.36 * r();
  f.rotationDeg = (Number(f.rotationDeg) || 0) + 30 * j();
  f.centerXKm = (Number(f.centerXKm) || 0) + 0.15 * f.radiusXKm * j();
  f.centerYKm = (Number(f.centerYKm) || 0) + 0.15 * f.radiusYKm * j();
  f.intensity *= 0.86 + 0.28 * r();
  switch (f.type) {
    case 'forwardFlank': // LP: thin anvil precipitation; HP: broad, heavy forward flank
      f.rain *= 1 + 0.45 * hp - 0.7 * lp; f.radiusXKm *= 1 + 0.25 * hp - 0.3 * lp; f.radiusYKm *= 1 + 0.2 * hp - 0.25 * lp; break;
    case 'inflowNotch': f.subtractRain = (f.subtractRain ?? 0) * (1 - 0.65 * hp); break;
    case 'rearFlank': // HP: precipitation wraps the mesocyclone (kidney bean)
      f.rain = (f.rain ?? 0) * (1 + 1.1 * hp - 0.75 * lp); f.radiusXKm *= 1 + 0.3 * hp; break;
    case 'hailCore': // LP storms show a compact, exposed hail core
      f.hail = (f.hail ?? 0) * (1 + 0.3 * lp - 0.15 * hp); f.rain = (f.rain ?? 0) * (1 - 0.4 * lp); break;
    case 'rearStratiform': case 'rearInflowJet': {
      // The structure engine places these downstream (+a) of the line; stratiform rain and
      // the rear-inflow jet trail the leading convective line, so mirror them behind it.
      const line = structure.features.find(x => x.type === 'convectiveLine');
      if (line) { const offset = Math.abs(feature.centerXKm - line.centerXKm); f.centerXKm = line.centerXKm - offset - 0.15 * f.radiusXKm * Math.abs(j()); }
      if (f.type === 'rearStratiform') { f.radiusXKm *= character.lineMaturity; f.radiusYKm *= 0.6 + 0.4 * character.lineMaturity; f.intensity *= 0.6 + 0.4 * character.lineMaturity; }
      break;
    }
  }
  return f;
}

// Reflectivity gap between the convective line and the trailing stratiform region.
function carveTransitionZone(f, notch, size, half) {
  const cx = f.centerXKm, cy = f.centerYKm, L = f.lengthKm / 2, w = f.widthKm / 2, bow = f.bowKm;
  forEachCell(size, half, cx - bow - 6 * w, cx + bow, cy - L * 1.2, cy + L * 1.2, (i, a, b) => {
    const along = (b - cy) / L, across = a - cx - bow * (1 - along * along);
    const gap = Math.exp(-(((across + 3 * w) / (1.2 * w)) ** 2)) * Math.exp(-(along ** 4));
    notch[i] *= 1 - 0.5 * gap;
  });
}

// Storm-fixed multiplicative texture (cores within the echo), evolving slowly with age.
// Cached per storm and 15-minute age step: every scan and tilt rebuilds the echo model.
const TEXTURE_CACHE = new Map();
function convectiveTexture(character, size, half, ageHours) {
  const step = Math.round(ageHours * 4);
  const key = `${character.seed}|${size}|${step}`;
  const cached = TEXTURE_CACHE.get(key);
  if (cached) return cached;
  const gain = new Float32Array(size * size), warp = new Float32Array(size * size * 2);
  const drift = step / 4 * 1.6; // km/h of internal cell evolution
  const s = character.seed;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const a = i * ECHO_RES_KM - half, b = j * ECHO_RES_KM - half;
    const n = 0.6 * valueNoise(s, (a + drift) / 6, b / 6) + 0.4 * valueNoise(s ^ 0x9e3779b9, (a - drift) / 2.8, (b + drift) / 2.8);
    // Radar is logarithmic: exp(2.4 (n - 0.5)) is roughly +/-5 dB, enough for visible cores.
    gain[j * size + i] = Math.exp(2.4 * (n - 0.5));
    // Domain warp (up to ~3 km, 9 km scale) roughens echo edges.
    warp[2 * (j * size + i)] = 6 * (valueNoise(s ^ 0x51ed27, a / 9, b / 9) - 0.5);
    warp[2 * (j * size + i) + 1] = 6 * (valueNoise(s ^ 0x2545f491, a / 9, b / 9) - 0.5);
  }
  const out = { gain, warp };
  if (TEXTURE_CACHE.size > 400) TEXTURE_CACHE.delete(TEXTURE_CACHE.keys().next().value);
  TEXTURE_CACHE.set(key, out);
  return out;
}

// Resample a raster at warped positions (bilinear, in cells).
function warpField(field, warp, size) {
  const out = new Float32Array(field.length);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const k = j * size + i;
    const fx = clamp(i + warp[2 * k] / ECHO_RES_KM, 0, size - 1.001), fy = clamp(j + warp[2 * k + 1] / ECHO_RES_KM, 0, size - 1.001);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, m = y0 * size + x0;
    out[k] = (field[m] * (1 - tx) + field[m + 1] * tx) * (1 - ty) + (field[m + size] * (1 - tx) + field[m + size + 1] * tx) * ty;
  }
  return out;
}

function valueNoise(seed, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const h = (ix, iy) => (hash2(seed, ix, iy) >>> 0) / 4294967296;
  return (h(x0, y0) * (1 - sx) + h(x0 + 1, y0) * sx) * (1 - sy) + (h(x0, y0 + 1) * (1 - sx) + h(x0 + 1, y0 + 1) * sx) * sy;
}
function hash2(seed, x, y) {
  let h = Math.imul(seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263), 1274126177);
  h ^= h >>> 13; h = Math.imul(h, 1103515245); return h ^ (h >>> 16);
}
function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
function mulberry32(a) {
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function forEachCell(size, half, x0, x1, y0, y1, fn) {
  const i0 = clampInt(Math.floor((x0 + half) / ECHO_RES_KM), 0, size - 1), i1 = clampInt(Math.ceil((x1 + half) / ECHO_RES_KM), 0, size - 1);
  const j0 = clampInt(Math.floor((y0 + half) / ECHO_RES_KM), 0, size - 1), j1 = clampInt(Math.ceil((y1 + half) / ECHO_RES_KM), 0, size - 1);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * size + i, i * ECHO_RES_KM - half, j * ECHO_RES_KM - half);
}

function stampLobe(f, fields, notch, size, half) {
  const cx = Number(f.centerXKm) || 0, cy = Number(f.centerYKm) || 0, rx = f.radiusXKm, ry = f.radiusYKm;
  const rot = (Number(f.rotationDeg) || 0) * DEG, c = Math.cos(rot), s = Math.sin(rot), reach = 2.6 * Math.max(rx, ry);
  const intensity = Number(f.intensity) || 0;
  forEachCell(size, half, cx - reach, cx + reach, cy - reach, cy + reach, (i, a, b) => {
    const da = a - cx, db = b - cy, u = da * c + db * s, v = -da * s + db * c;
    // Super-Gaussian falloff: precipitation edges are sharper than a Gaussian tail.
    const g = Math.exp(-(((u / rx) ** 2 + (v / ry) ** 2) ** 1.35)) * intensity;
    if (g < 1e-4) return;
    if (f.subtractRain) notch[i] *= 1 - clamp(g * f.subtractRain, 0, 0.95);
    if (f.rain) fields.rain[i] += g * f.rain;
    if (f.graupel) fields.graupel[i] += g * f.graupel;
    if (f.hail) fields.hail[i] += g * f.hail;
    if (f.ice) fields.ice[i] += g * f.ice;
    if (f.vertical) fields.updraft[i] += g * f.vertical;
    if (f.downdraft) fields.downdraft[i] += g * f.downdraft;
    if (f.debris) fields.debris[i] += g * f.debris;
    if (f.rearInflow) fields.rearInflow[i] += g * f.rearInflow;
  });
}

function stampHook(f, fields, size, half) {
  const cx = f.centerXKm, cy = f.centerYKm, R = f.radiusKm, t = f.thicknessKm, intensity = Number(f.intensity) || 0;
  if (intensity <= 0) return;
  const start = f.startDeg, end = f.endDeg, taper = 28;
  forEachCell(size, half, cx - R - 3 * t, cx + R + 3 * t, cy - R - 3 * t, cy + R + 3 * t, (i, a, b) => {
    const da = a - cx, db = b - cy, rho = Math.hypot(da, db);
    let ang = Math.atan2(db, da) / DEG; if (ang < 0) ang += 360;
    if (ang < start || ang > end) return;
    const edge = Math.min(ang - start, end - ang);
    // The hook thins toward its tip (the start of the arc) as precipitation wraps the mesocyclone.
    const tip = 0.45 + 0.55 * clamp((ang - start) / (end - start), 0, 1);
    const g = Math.exp(-(((rho - R) / (t * tip)) ** 2)) * clamp(edge / taper, 0, 1) * intensity;
    fields.rain[i] += g * (f.rain ?? 0.6);
    fields.graupel[i] += g * (f.graupel ?? 0.2);
  });
}

function stampLine(f, fields, size, half) {
  const cx = f.centerXKm, cy = f.centerYKm, L = f.lengthKm / 2, w = f.widthKm / 2, bow = f.bowKm, intensity = Number(f.intensity) || 0;
  forEachCell(size, half, cx - bow - 3 * w, cx + bow + 3 * w, cy - L * 1.3, cy + L * 1.3, (i, a, b) => {
    const along = (b - cy) / L, across = a - cx - bow * (1 - along * along);
    const g = Math.exp(-((across / w) ** 2)) * Math.exp(-(along ** 4)) * intensity;
    if (g < 1e-4) return;
    fields.rain[i] += g * (f.rain ?? 0.8);
    fields.graupel[i] += g * (f.graupel ?? 0.2);
    fields.hail[i] += g * (f.hail ?? 0);
    // Leading-edge updraft sits just ahead of the precipitation core.
    const lead = Math.exp(-(((across - w * 0.6) / (w * 0.7)) ** 2)) * Math.exp(-(along ** 4)) * intensity;
    fields.updraft[i] += lead * 0.55;
  });
}

function lifecycleFactor(state) {
  return state === 'tower' ? 0.3 : state === 'developing' ? 0.6 : state === 'organizing' ? 0.85 : state === 'weakening' ? 0.6 : state === 'dissipating' ? 0.28 : 1;
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function clampInt(v, a, b) { return Math.max(a, Math.min(b, v)); }

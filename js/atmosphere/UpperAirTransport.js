// 850 mb temperature transport. The generator assigns 850 mb temperatures once (every
// warm-sector cell 19.00 C) and nothing moved them, so fronts existed only at the surface.
// Each step now:
//   1. advects 850 mb temperature semi-Lagrangianly with the 850 mb wind, at a
//      system-relative fraction (thermal features aloft move slower than the wind because
//      advection is partly offset by vertical motion), and
//   2. relaxes it toward the air mass beneath it (the pattern's moving surface air-mass
//      target, reduced to 850 mb with a standard lapse rate).

const DEG = Math.PI / 180;
const SYSTEM_RELATIVE_FRACTION = 0.55;
const RELAX_HOURS = 10;
const STANDARD_LAPSE_C_PER_KM = 6.5;
const MEAN_DIURNAL_OFFSET_C = 4; // the air-mass target is near the afternoon surface maximum
const DIFFUSION = 0.15;            // fraction toward the 3x3 mean per step
const FRONTAL_DIFFUSION = 0.5;     // extra mixing where gradients exceed realistic fronts

export function advanceUpperAirTemperature(world, dtHours = 0.5) {
  const w = world.width, h = world.height, cs = world.cellSizeKm;
  const previous = new Float32Array(w * h);
  world.forEachCell((cell, x, y) => { previous[y * w + x] = cell.levels[850].temperature; });
  const relax = clamp(dtHours / RELAX_HOURS, 0, 1);
  let advectionSum = 0;

  // Air-mass targets switch abruptly between categories (Gulf vs continental air); smooth
  // them so fronts aloft keep a realistic 50-100 km width instead of 8 C cell-to-cell jumps.
  const rawTarget = new Float32Array(w * h).fill(NaN);
  world.forEachCell((cell, x, y) => {
    const airMass850 = Number(cell.features?.airMass850C);
    if (Number.isFinite(airMass850)) { rawTarget[y * w + x] = airMass850; return; }
    const airMassF = Number(cell.features?.airMassTemperatureF);
    if (!Number.isFinite(airMassF)) return;
    const elevKm = (Number(cell.terrain?.elevationM) || 0) / 1000;
    rawTarget[y * w + x] = (airMassF - 32) * 5 / 9 - STANDARD_LAPSE_C_PER_KM * Math.max(0, 1.5 - elevKm) - MEAN_DIURNAL_OFFSET_C;
  });
  const target = boxSmooth(boxSmooth(rawTarget, w, h), w, h);
  const next = new Float32Array(w * h);

  world.forEachCell((cell, x, y) => {
    const level = cell.levels[850];
    const speedKmH = (Number(level.windSpeed) || 0) * 1.852 * SYSTEM_RELATIVE_FRACTION;
    const dir = (Number(level.windDirection) || 0) * DEG;
    // Grid x is east; grid y is south. Meteorological direction is where the wind is from.
    const moveX = -Math.sin(dir) * speedKmH * dtHours / cs;
    const moveY = Math.cos(dir) * speedKmH * dtHours / cs;
    let t = sample(previous, w, h, x - moveX, y - moveY);
    advectionSum += t - previous[y * w + x];
    const goal = target[y * w + x];
    if (Number.isFinite(goal)) t += (goal - t) * relax;
    next[y * w + x] = t;
  });
  // Horizontal mixing: light everywhere, stronger where convergent flow has sharpened a
  // front beyond ~12 C/100 km (real 850 mb fronts rarely exceed 10-15 C/100 km).
  const mixed = boxSmooth(next, w, h);
  world.forEachCell((cell, x, y) => {
    const i = y * w + x;
    const gx = (next[y * w + Math.min(w - 1, x + 1)] - next[y * w + Math.max(0, x - 1)]) / 2;
    const gy = (next[Math.min(h - 1, y + 1) * w + x] - next[Math.max(0, y - 1) * w + x]) / 2;
    const gradientPer100Km = Math.hypot(gx, gy) / cs * 100;
    const k = DIFFUSION + FRONTAL_DIFFUSION * clamp((gradientPer100Km - 12) / 20, 0, 1);
    cell.levels[850].temperature = next[i] + (mixed[i] - next[i]) * k;
  });
  world.upperAirTransport = { version: '2.73.0', meanAdvectionC: advectionSum / (w * h), systemRelativeFraction: SYSTEM_RELATIVE_FRACTION };
}

function sample(field, w, h, x, y) {
  const cx = Math.max(0, Math.min(w - 1, x)), cy = Math.max(0, Math.min(h - 1, y));
  const x0 = Math.min(w - 2, Math.floor(cx)), y0 = Math.min(h - 2, Math.floor(cy)), tx = cx - x0, ty = cy - y0;
  const i = y0 * w + x0;
  return (field[i] * (1 - tx) + field[i + 1] * tx) * (1 - ty) + (field[i + w] * (1 - tx) + field[i + w + 1] * tx) * ty;
}
// 3x3 mean ignoring NaN (cells without a target keep NaN only if all neighbours lack one).
function boxSmooth(field, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const v = field[yy * w + xx];
      if (Number.isFinite(v)) { sum += v; n++; }
    }
    out[y * w + x] = n ? sum / n : NaN;
  }
  return out;
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

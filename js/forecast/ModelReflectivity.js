// The short range model's simulated reflectivity (2026-11-27, the owner's choice): what a 3 km model such as
// the HRRR shows, made from the run's own storms' precipitation rather than drawn. Each storm's fall-out is
// worked out as the radar's (PrecipitationField.js, through RadarSimulator buildStormEcho), coarsely: one
// particle in 16 followed and cells no finer than 3 km, which a 3 km grid cannot tell from the full field
// (storm peaks 58 against 60 dBZ median on seed 2, at a quarter of the work: ~3 ms a storm). The column's
// strongest echo at a few heights (composite reflectivity) is taken on the model's 3 km grid and smoothed
// 1-2-1 each way, as a 3 km model resolves only features several cells wide: hooks blur, cores and forward
// flanks stay. Until 2026-11-27 the model page drew each storm in the browser from a reflectivity formula
// (StormEngine maxReflectivityDbz: 5 dB high for ordinary storms, up to 16) and a drawn ellipse, core, hook and line.
//
// Each storm's echo is kept as its own patch, so the model page can carry it with its storm between the hours
// it is worked out: { id, i0, j0, w, h, peak, data } - the patch's first column and row on the grid (cells
// CELL_KM from the map's north-west corner), its size, its strongest echo (dBZ) and its cells as text (base64,
// one byte a cell: 0 below LEAST_DBZ, else 2 x dBZ).
import { radarSceneInputs, buildStormEcho, precipitationEcho } from '../radar/RadarSimulator.js';

export const MODEL_REFLECTIVITY = Object.freeze({
  cellKm: 3, leastDbz: 15,
  heightsM: [1000, 2500, 4000, 6000, 8000],
  echo: Object.freeze({ stride: 16, leastResKm: 3, fine: false, debris: false })
});

const SAMPLE = { zh: 0, zv: 0, cc: 0, hail: 0 };
const toBase64 = bytes => (typeof Buffer !== 'undefined' ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString('base64') : btoa(String.fromCharCode(...bytes)));

// The patches of every active storm in the world now ([] with none).
export function modelReflectivity(world, settings = MODEL_REFLECTIVITY) {
  const { cellKm, leastDbz, heightsM, echo: echoOptions } = settings;
  const cols = Math.ceil(world.width * world.cellSizeKm / cellKm), rows = Math.ceil(world.height * world.cellSizeKm / cellKm);
  const least = 10 ** (leastDbz / 10), patches = [];
  if (!(world.storms ?? []).some(s => s.active !== false && s.structure)) return patches;
  for (const input of radarSceneInputs(world).storms) {
    const echo = buildStormEcho(input, echoOptions);
    if (!echo?.grid) continue;
    // The patch: the echo's reach, a cell more each way for the smoothing.
    const i0 = Math.max(0, Math.floor((input.x + echo.minX) / cellKm) - 1), i1 = Math.min(cols - 1, Math.ceil((input.x + echo.maxX) / cellKm) + 1);
    const j0 = Math.max(0, Math.floor((input.y + echo.minY) / cellKm) - 1), j1 = Math.min(rows - 1, Math.ceil((input.y + echo.maxY) / cellKm) + 1);
    const w = i1 - i0 + 1, h = j1 - j0 + 1;
    if (w <= 0 || h <= 0) continue;
    const z = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      // (2 x 2 points across the cell, the strongest of the column's heights)
      let sum = 0;
      for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
        const lx = (i0 + i + 0.25 + 0.5 * a) * cellKm - input.x, ly = (j0 + j + 0.25 + 0.5 * b) * cellKm - input.y;
        let most = 0;
        for (const zM of heightsM) { SAMPLE.zh = 0; precipitationEcho(echo, input.freezing, lx, ly, zM, SAMPLE); if (SAMPLE.zh > most) most = SAMPLE.zh; }
        sum += most;
      }
      z[j * w + i] = sum / 4;
    }
    const smooth = smooth121(z, w, h), data = new Uint8Array(w * h);
    let peak = 0, any = false;
    for (let k = 0; k < data.length; k++) {
      const v = smooth[k];
      if (v < least) continue;
      const dbz = 10 * Math.log10(v);
      data[k] = Math.min(255, Math.round(2 * dbz)); any = true;
      if (dbz > peak) peak = dbz;
    }
    if (!any) continue;
    // (cut down to the cells with echo: the field's reach takes in the faintest fall-out)
    let a0 = w, a1 = -1, b0 = h, b1 = -1;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (data[j * w + i]) { if (i < a0) a0 = i; if (i > a1) a1 = i; if (j < b0) b0 = j; if (j > b1) b1 = j; }
    const cw = a1 - a0 + 1, ch = b1 - b0 + 1, cut = new Uint8Array(cw * ch);
    for (let j = 0; j < ch; j++) cut.set(data.subarray((b0 + j) * w + a0, (b0 + j) * w + a0 + cw), j * cw);
    patches.push({ id: input.storm.id, i0: i0 + a0, j0: j0 + b0, w: cw, h: ch, peak: Math.round(peak), data: toBase64(cut) });
  }
  return patches;
}

// A 1-2-1 smoothing each way, in linear reflectivity (cells past the edge left out).
function smooth121(z, w, h) {
  const across = new Float32Array(z.length), out = new Float32Array(z.length);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let s = 2 * z[j * w + i], n = 2;
    if (i > 0) { s += z[j * w + i - 1]; n++; }
    if (i < w - 1) { s += z[j * w + i + 1]; n++; }
    across[j * w + i] = s / n;
  }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let s = 2 * across[j * w + i], n = 2;
    if (j > 0) { s += across[(j - 1) * w + i]; n++; }
    if (j < h - 1) { s += across[(j + 1) * w + i]; n++; }
    out[j * w + i] = s / n;
  }
  return out;
}

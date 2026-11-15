// The radar under a mesoscale discussion's map, as the centre's graphics carry the reflectivity mosaic of the
// moment it was issued (MRMS, "Fields plotted"): the composite mosaic (WeatherAuthorityRuntime.radarMosaic, 1 km)
// cut to a square round the discussion's area, a little wider than its map shows (AreaMap.js viewOf), and
// coloured as the radar pages colour reflectivity. It is made by MesoscaleRuntime when a discussion is
// issued and kept with it in ProductArchive.js (never in the game's products: one is 5-40 KB).
import { radarColorTable, decodeRadarValue } from '../js/radar/RadarFormat.js';
import { encodeRgbaPng } from './tiles/PngEncoder.js';
import { decodeSatelliteValue, satelliteColorTable } from '../js/satellite/SatelliteFormat.js';
import { contourRings } from '../js/forecast/contourShapes.js';

// pad, minMiles: as the discussion map's view (ProductArchive.discussionSvg), and margin more on each side, so
// the picture covers the map however its smoothed outline sits in its cells.
// ringMiles: the smallest field contour drawn (across). visibleSunDeg: the sun's height above which the satellite under the radar is the visible image, not the IR.
export const DISCUSSION_RADAR = { pad: 0.35, minMiles: 120, margin: 0.1, visibleSunDeg: 8, ringMiles: 25 };
const LUT = radarColorTable('reflectivity');

// The square of map miles a discussion's picture covers: md.cells (0/1 over the weather grid), grid: describeNow's
// width, height, cellMiles.
export function pictureView(cells, { width, height, cellMiles }) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < cells.length; i++) if (cells[i]) { const x = i % width, y = (i - x) / width; x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
  if (!Number.isFinite(x0)) return null;
  const mapMiles = width * cellMiles, { pad, minMiles, margin } = DISCUSSION_RADAR;
  const size = Math.min(mapMiles, Math.max(minMiles, (x1 - x0) * cellMiles * (1 + 2 * pad), (y1 - y0) * cellMiles * (1 + 2 * pad)) * (1 + 2 * margin));
  const inside = v => Math.min(Math.max(v, 0), Math.max(0, Math.min(mapMiles, height * cellMiles) - size));
  return { x: inside((x0 + x1) / 2 * cellMiles - size / 2), y: inside((y0 + y1) / 2 * cellMiles - size / 2), size };
}

// The picture: { png (Buffer), x, y, size (map miles), validHourUtc }, or null without a mosaic or an area.
// mosaic: a composite mosaic ({ width, height, resKm, bytes, validHourUtc }); grid: describeNow's width, height,
// cellMiles, cellKm.
export async function discussionRadar(mosaic, cells, grid) {
  if (!mosaic?.bytes || !grid.cellKm) return null;
  const view = pictureView(cells, grid);
  return view ? { ...await cropImage(mosaic, mosaic.bytes, LUT, view, grid), validHourUtc: mosaic.validHourUtc ?? null } : null;
}

// A whole-map image ({ width, height, resKm }, its bytes coloured by lut) cut to a view (map miles): { png, x, y, size }
// (placed by the pixels it was cut on, which may start a little before the view).
async function cropImage(image, bytes, lut, view, grid) {
  const kmPerMile = grid.cellKm / grid.cellMiles, res = image.resKm ?? 1;
  const i0 = Math.floor(view.x * kmPerMile / res), j0 = Math.floor(view.y * kmPerMile / res), side = Math.max(1, Math.round(view.size * kmPerMile / res));
  const rgba = new Uint8Array(side * side * 4);
  for (let j = 0; j < side; j++) {
    const J = j0 + j; if (J < 0 || J >= image.height) continue;
    for (let i = 0; i < side; i++) {
      const I = i0 + i; if (I < 0 || I >= image.width) continue;
      const b = bytes[J * image.width + I]; if (!b) continue;
      rgba.set(lut.subarray(b * 4, b * 4 + 4), (j * side + i) * 4);
    }
  }
  const milesPerPixel = res / kmPerMile;
  return { png: await encodeRgbaPng(side, side, rgba), x: i0 * milesPerPixel, y: j0 * milesPerPixel, size: side * milesPerPixel };
}

// The satellite under the radar (2026-11-15), as the centre lays the mosaic over GOES ("MRMS RALA/GOES VIS
// sandwich"): the visible image while the sun is up enough to light the clouds, else the clean IR in greys (colder
// tops whiter), cut to the same view. { png, x, y, size, kind ('visible' or 'ir'), validHourUtc } or null.
const IR_GREYS = (() => { const lut = new Uint8Array(256 * 4); for (let b = 1; b < 256; b++) { const t = decodeSatelliteValue('ir', b), g = Math.round(40 + 200 * Math.max(0, Math.min(1, (20 - t) / 90))); lut.set([g, g, g, 255], b * 4); } return lut; })();
export async function discussionSatellite(satellite, cells, grid) {
  if (!satellite?.ir || !grid.cellKm) return null;
  const view = pictureView(cells, grid);
  if (!view) return null;
  const visible = (satellite.sun?.elevationDeg ?? -90) >= DISCUSSION_RADAR.visibleSunDeg && satellite.visible;
  const picture = await cropImage(satellite, visible ? satellite.visible : satellite.ir, visible ? satelliteColorTable('visible') : IR_GREYS, view, grid);
  return { ...picture, kind: visible ? 'visible' : 'ir', validHourUtc: satellite.validHourUtc ?? null };
}

// The environment over the picture (2026-11-15), as the centre lays a mesoanalysis field and the surface analysis on
// its discussions: one field's contours, chosen by what the discussion is about (the significant tornado parameter
// where it gives a tornado peak or concerns a tornado watch, else mixed-layer CAPE), and the fronts, drylines and
// outflow boundaries, all clipped to the picture's view. field: buildParameterField's ({ key, label, unit, values }
// over the weather grid); boundaries: the atmosphere's ({ type, pointsKm }); grid: describeNow's. { field: { key,
// label, unit, lines: [{ value, rings }] }, boundaries: [{ type, side, points }] } in map miles (points flat: x, y, ...; side: the side the symbols face).
// A field averaged over the cells within two of each (a square five cells across, cut at the map edge).
function smoothField(values, width, height) {
  const out = new Float32Array(values.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0, count = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < width && Y < height) { sum += values[Y * width + X]; count++; } }
    out[y * width + x] = sum / count;
  }
  return out;
}

export const DISCUSSION_FIELDS = { stp: [1, 2, 4, 8], mlcape: [1000, 2000, 3000, 4000] };
export const fieldFor = md => (md.peakText?.tornado || md.tornadoWatch || md.watchType === 'tornado' ? 'stp' : 'mlcape');
export function discussionEnvironment(field, boundaries, cells, grid) {
  const view = pictureView(cells, grid);
  if (!view) return null;
  const mapMiles = grid.width * grid.cellMiles, milesPerKm = grid.cellMiles / grid.cellKm, r = v => Math.round(v * 10) / 10;
  const near = (x, y) => x >= view.x - 5 && y >= view.y - 5 && x <= view.x + view.size + 5 && y <= view.y + view.size + 5;
  let lines = [];
  if (field?.values) {
    // Smoothed over the cells round each (twice, two cells each way), as analysed fields are drawn, and only the
    // lines at least ringMiles across: the cell-to-cell detail of the raw field drew a clutter of small rings.
    const values = smoothField(smoothField(Float32Array.from(field.values), grid.width, grid.height), grid.width, grid.height);
    const across = flat => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (let k = 0; k + 1 < flat.length; k += 2) { x0 = Math.min(x0, flat[k]); x1 = Math.max(x1, flat[k]); y0 = Math.min(y0, flat[k + 1]); y1 = Math.max(y1, flat[k + 1]); } return Math.max(x1 - x0, y1 - y0); };
    lines = (DISCUSSION_FIELDS[field.key] ?? []).map(value => ({
      value,
      rings: contourRings(values, grid.width, grid.height, value).map(ring => ring.flatMap(([x, y]) => [r(x * mapMiles), r(y * grid.height * grid.cellMiles)])).filter(flat => across(flat) >= DISCUSSION_RADAR.ringMiles && flat.some((v, k) => k % 2 === 0 && near(v, flat[k + 1])))
    })).filter(line => line.rings.length);
  }
  const lanes = (boundaries ?? []).map(b => ({ type: b.type, side: b.symbolSide ?? 1, points: (b.pointsKm ?? []).flatMap(p => [r(p.x * milesPerKm), r(p.y * milesPerKm)]) })).filter(b => b.points.length >= 4 && b.points.some((v, k) => k % 2 === 0 && near(v, b.points[k + 1])));
  return { field: field ? { key: field.key, label: field.label, unit: field.unit ?? '', lines } : null, boundaries: lanes };
}

// The colour key of reflectivity: [dBZ, '#rrggbb'] every 5 dBZ from 5 to 75.
export function reflectivityKey() {
  const stops = [];
  for (let dbz = 5; dbz <= 75; dbz += 5) {
    let best = 1, gap = Infinity;
    for (let b = 1; b < 256; b++) { const v = decodeRadarValue('reflectivity', b), d = v == null ? Infinity : Math.abs(v - dbz); if (d < gap) { gap = d; best = b; } }
    stops.push([dbz, `#${[0, 1, 2].map(k => LUT[best * 4 + k].toString(16).padStart(2, '0')).join('')}`]);
  }
  return stops;
}

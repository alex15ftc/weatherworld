// The radar under a mesoscale discussion's map, as the centre's graphics carry the reflectivity mosaic of the
// moment it was issued (MRMS, "Fields plotted"): the composite mosaic (WeatherAuthorityRuntime.radarMosaic, 1 km)
// cut to a square round the discussion's area, a little wider than its map shows (AreaMap.js viewOf), and
// coloured as the radar pages colour reflectivity. It is made by MesoscaleRuntime when a discussion is
// issued and kept with it in ProductArchive.js (never in the game's products: one is 5-40 KB).
import { radarColorTable, decodeRadarValue } from '../js/radar/RadarFormat.js';
import { encodeRgbaPng } from './tiles/PngEncoder.js';

// pad, minMiles: as the discussion map's view (ProductArchive.discussionSvg), and margin more on each side, so
// the picture covers the map however its smoothed outline sits in its cells.
export const DISCUSSION_RADAR = { pad: 0.35, minMiles: 120, margin: 0.1 };
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
  if (!view) return null;
  const kmPerMile = grid.cellKm / grid.cellMiles, res = mosaic.resKm ?? 1;
  const i0 = Math.floor(view.x * kmPerMile / res), j0 = Math.floor(view.y * kmPerMile / res), side = Math.max(1, Math.round(view.size * kmPerMile / res));
  const rgba = new Uint8Array(side * side * 4);
  for (let j = 0; j < side; j++) {
    const J = j0 + j; if (J < 0 || J >= mosaic.height) continue;
    for (let i = 0; i < side; i++) {
      const I = i0 + i; if (I < 0 || I >= mosaic.width) continue;
      const b = mosaic.bytes[J * mosaic.width + I]; if (!b) continue;
      rgba.set(LUT.subarray(b * 4, b * 4 + 4), (j * side + i) * 4);
    }
  }
  // (placed by the cells it was cut on, which may start a little before the view)
  const milesPerPixel = res / kmPerMile;
  return { png: await encodeRgbaPng(side, side, rgba), x: i0 * milesPerPixel, y: j0 * milesPerPixel, size: side * milesPerPixel, validHourUtc: mosaic.validHourUtc ?? null };
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

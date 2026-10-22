// The sky as the game lights it: a coarse grid of what the air holds over the map (the regional
// layer's cloud shares, the air at the ground, the wind, the soil), and where the
// map lies and how its day runs, so the game puts the sun where the engine has it. Sent with each
// game frame (server/GameFeed.js); the game turns it into light, haze and cloud
// (roblox/src/client/SkyLight.luau). Nothing here decides how anything looks.
//
// The grid averages blocks of `block` x `block` regional cells (10 miles each), row by row from
// the north-west corner; values are whole numbers (temperatures to 0.1 F) to keep the frame small:
//   low, mid, high   share of the sky in each cloud layer, per cent
//   tF, tdF          temperature and dewpoint at the ground, F (tenths: the haze turns on the spread)
//   windKt           wind at the ground, kt
//   soil             soil moisture, per cent (dry ground gives up dust in a strong wind)
import { REGIONAL_DEFAULTS } from '../atmosphere/RegionalAtmosphere.js';
import { WARNING } from '../forecast/Warning.js';

export const SKY = Object.freeze({ block: 2 });

const FIELDS = ['low', 'mid', 'high', 'tF', 'tdF', 'windKt', 'soil'];

// regional: the regional layer's settings (its day: utcOffsetHours, sunriseLocal, sunsetLocal).
export function buildSkyAppearance(world, regional = {}) {
  const cells = world?.cells;
  if (!cells?.length) return null;
  const p = { ...REGIONAL_DEFAULTS, ...regional };
  const height = world.height ?? cells.length, width = world.width ?? cells[0].length;
  const b = SKY.block, cols = Math.ceil(width / b), rows = Math.ceil(height / b);
  const out = {};
  for (const f of FIELDS) out[f] = new Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const sum = Object.fromEntries(FIELDS.map(f => [f, 0]));
      let n = 0;
      for (let y = j * b; y < Math.min(height, (j + 1) * b); y++) {
        for (let x = i * b; x < Math.min(width, (i + 1) * b); x++) {
          const c = cells[y][x], ft = c.features ?? {};
          sum.low += ft.cloudLow ?? 0; sum.mid += ft.cloudMid ?? 0; sum.high += ft.cloudHigh ?? 0;
          sum.tF += c.surface.temperature; sum.tdF += c.surface.dewpoint;
          sum.windKt += c.surface.wind?.speed ?? 0;
          sum.soil += c.terrain?.soilMoisture ?? 0;
          n++;
        }
      }
      const k = j * cols + i;
      out.low[k] = Math.round(100 * sum.low / n); out.mid[k] = Math.round(100 * sum.mid / n); out.high[k] = Math.round(100 * sum.high / n);
      out.tF[k] = Math.round(10 * sum.tF / n) / 10; out.tdF[k] = Math.round(10 * sum.tdF / n) / 10;
      out.windKt[k] = Math.round(sum.windKt / n);
      out.soil[k] = Math.round(100 * sum.soil / n);
    }
  }
  const cellKm = (p.cellKm ?? REGIONAL_DEFAULTS.cellKm) * b;
  // The map's middle on the earth, for the sun's path.
  const [north] = WARNING.mapNorthwest, latDeg = north - (rows * cellKm / 2) / 111.1;
  return {
    cols, rows, cellKm: +cellKm.toFixed(4),
    sun: { latDeg: +latDeg.toFixed(2), utcOffsetHours: p.utcOffsetHours, sunriseLocal: p.sunriseLocal, sunsetLocal: p.sunsetLocal },
    ...out
  };
}

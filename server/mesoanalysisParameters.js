// The fields the mesoanalysis page can lay over the surface map. Each is read straight from
// the cells (soundings, winds, the storm engine's diagnoses); nothing is computed specially
// for display. `levels` are the contour values, `shade` the colours ([value, r, g, b, alpha];
// values below the first stop are left clear), `decimals` the precision sent to the page.
const FT_PER_M = 3.28084;
const windAt = (cell, level) => ({ speed: cell.levels[level].windSpeed, direction: cell.levels[level].windDirection });

const WARM = [[0, 255, 235, 150, 0.0], [0.15, 255, 225, 120, 0.45], [0.4, 255, 160, 60, 0.6], [0.7, 235, 60, 50, 0.68], [1, 200, 40, 200, 0.75]];
const COOL = [[0, 150, 200, 255, 0.0], [0.15, 130, 190, 255, 0.4], [0.5, 80, 120, 240, 0.6], [1, 130, 60, 200, 0.72]];
const GREEN = [[0, 150, 230, 150, 0.0], [0.15, 120, 220, 130, 0.4], [0.6, 40, 170, 110, 0.6], [1, 20, 120, 140, 0.72]];
// Spreads a ramp (positions 0-1) over a value range.
const ramp = (stops, from, to) => stops.map(([t, r, g, b, a]) => [from + (to - from) * t, r, g, b, a]);

const upperAir = (level, label, levels, from, to, second) => ({
  key: `wind${level}`, group: 'Upper air', label: `${label} wind`, unit: 'kt', decimals: 0, levels, shade: ramp(COOL, from, to),
  read: cell => cell.levels[level].windSpeed, barbs: cell => windAt(cell, level), second
});

export const MESOANALYSIS_PARAMETERS = [
  { key: 'temperature', group: 'Surface', label: 'Temperature', unit: '°F', decimals: 0, levels: [40, 50, 60, 70, 80, 90, 100], read: c => c.surface.temperature,
    shade: [[30, 60, 90, 200, 0.55], [55, 80, 170, 200, 0.5], [70, 120, 190, 120, 0.5], [82, 230, 205, 90, 0.55], [93, 225, 120, 60, 0.6], [105, 170, 40, 60, 0.65]] },
  { key: 'dewpoint', group: 'Surface', label: 'Dewpoint', unit: '°F', decimals: 0, levels: [40, 45, 50, 55, 60, 65, 70, 75], read: c => c.surface.dewpoint,
    shade: [[20, 150, 110, 70, 0.5], [45, 170, 150, 100, 0.35], [55, 120, 190, 120, 0.45], [65, 40, 160, 100, 0.6], [75, 20, 110, 150, 0.7]] },
  { key: 'cloudTotal', group: 'Surface', label: 'Cloud cover, total', unit: '%', decimals: 0, levels: [10, 25, 50, 75, 90], shade: [[5, 200, 200, 200, 0.0], [25, 190, 190, 195, 0.35], [60, 150, 150, 160, 0.55], [90, 110, 110, 120, 0.72]], read: c => 100 * (c.features.cloudTotal ?? 0) },
  { key: 'cloudLow', group: 'Surface', label: 'Cloud cover, low (stratus, cumulus)', unit: '%', decimals: 0, levels: [10, 25, 50, 75, 90], shade: [[5, 200, 200, 200, 0.0], [25, 190, 190, 195, 0.35], [60, 150, 150, 160, 0.55], [90, 110, 110, 120, 0.72]], read: c => 100 * (c.features.cloudLow ?? 0) },
  { key: 'cloudMid', group: 'Surface', label: 'Cloud cover, middle', unit: '%', decimals: 0, levels: [10, 25, 50, 75, 90], shade: [[5, 200, 200, 200, 0.0], [25, 190, 190, 195, 0.35], [60, 150, 150, 160, 0.55], [90, 110, 110, 120, 0.72]], read: c => 100 * (c.features.cloudMid ?? 0) },
  { key: 'cloudHigh', group: 'Surface', label: 'Cloud cover, high (cirrus, anvils)', unit: '%', decimals: 0, levels: [10, 25, 50, 75, 90], shade: [[5, 200, 200, 200, 0.0], [25, 190, 190, 195, 0.35], [60, 150, 150, 160, 0.55], [90, 110, 110, 120, 0.72]], read: c => 100 * (c.features.cloudHigh ?? 0) },
  { key: 'coldPool', group: 'Surface', label: 'Rain-cooled air (cold pools)', unit: '°F colder', decimals: 1, levels: [2, 4, 6, 8, 10, 14], shade: ramp(COOL, 1, 14), read: c => (c.features.coldPoolK ?? 0) * 1.8 },
  { key: 'terrain', group: 'Surface', label: 'Terrain', unit: 'ft', decimals: 0, levels: [1500, 2000, 2500, 3000, 3500, 4000, 4500], read: c => c.terrain.elevationM * FT_PER_M,
    shade: [[900, 60, 100, 75, 0.5], [2500, 120, 130, 85, 0.5], [4000, 165, 140, 105, 0.55], [5000, 190, 170, 140, 0.6]] },

  { key: 'mlcape', group: 'Instability', label: 'CAPE, mixed layer', unit: 'J/kg', decimals: 0, levels: [250, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000], shade: ramp(WARM, 250, 5000), read: c => c.derived.sounding.mlcape },
  { key: 'sbcape', group: 'Instability', label: 'CAPE, surface based', unit: 'J/kg', decimals: 0, levels: [250, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000], shade: ramp(WARM, 250, 5000), read: c => c.derived.sounding.sbcape },
  { key: 'mucape', group: 'Instability', label: 'CAPE, most unstable', unit: 'J/kg', decimals: 0, levels: [250, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000], shade: ramp(WARM, 250, 5000), read: c => c.derived.sounding.mucape },
  { key: 'mlcin', group: 'Instability', label: 'Inhibition, mixed layer', unit: 'J/kg', decimals: 0, levels: [25, 50, 100, 200, 300], shade: ramp(COOL, 10, 300), read: c => Math.min(500, Math.abs(c.derived.sounding.mlcin)) },
  { key: 'lcl', group: 'Instability', label: 'Cloud base above ground', unit: 'm', decimals: 0, levels: [500, 750, 1000, 1250, 1500, 2000, 3000], read: c => c.derived.lclAgl,
    shade: [[0, 30, 150, 110, 0.7], [750, 60, 180, 120, 0.55], [1250, 150, 210, 140, 0.35], [1750, 200, 220, 170, 0.0]], shadeBelowFirst: true },
  { key: 'lapse700500', group: 'Instability', label: 'Lapse rate, 700-500 mb', unit: '°C/km', decimals: 1, levels: [6, 6.5, 7, 7.5, 8, 8.5, 9], shade: ramp(WARM, 6.5, 9.2), read: c => c.derived.sounding.lapseRate700500 },
  { key: 'lapse03', group: 'Instability', label: 'Lapse rate, lowest 3 km', unit: '°C/km', decimals: 1, levels: [6, 7, 8, 9, 10], shade: ramp(WARM, 6.5, 10), read: c => c.derived.sounding.lapseRate03km },
  { key: 'cap', group: 'Instability', label: '700 mb temperature (cap)', unit: '°C', decimals: 1, levels: [4, 6, 8, 10, 12, 14, 16], shade: ramp(WARM, 8, 17), read: c => c.levels[700].temperature },

  { key: 'shear06', group: 'Wind shear', label: 'Shear, surface to 6 km', unit: 'kt', decimals: 0, levels: [20, 30, 40, 50, 60, 70, 80], shade: ramp(COOL, 25, 85), read: c => c.derived.sounding.shear06 },
  { key: 'shear01', group: 'Wind shear', label: 'Shear, surface to 1 km', unit: 'kt', decimals: 0, levels: [10, 15, 20, 25, 30, 40], shade: ramp(COOL, 8, 40), read: c => c.derived.sounding.shear01 },
  { key: 'srh01', group: 'Wind shear', label: 'Helicity, lowest 1 km', unit: 'm²/s²', decimals: 0, levels: [50, 100, 150, 200, 300, 400, 500], shade: ramp(GREEN, 50, 500), read: c => c.derived.sounding.srh01 },
  { key: 'srh03', group: 'Wind shear', label: 'Helicity, lowest 3 km', unit: 'm²/s²', decimals: 0, levels: [100, 150, 200, 300, 400, 500, 600], shade: ramp(GREEN, 100, 600), read: c => c.derived.sounding.srh03 },

  { key: 'stp', group: 'Composites', label: 'Significant tornado parameter', unit: '', decimals: 1, levels: [0.5, 1, 2, 3, 4, 6, 8, 10], shade: ramp(WARM, 0.25, 9), read: c => c.derived.stp ?? 0 },
  { key: 'scp', group: 'Composites', label: 'Supercell composite', unit: '', decimals: 1, levels: [1, 2, 4, 8, 12, 16, 20, 30], shade: ramp(WARM, 0.5, 28), read: c => c.derived.scp ?? 0 },

  { key: 'convergence', group: 'Forcing', label: 'Surface wind convergence', unit: '×10⁻⁵ /s', decimals: 1, levels: [2, 5, 10, 15, 20], shade: ramp(WARM, 1.5, 20), read: c => (c.dynamics.surfaceConvergenceS1 ?? 0) * 1e5 },
  { key: 'moistureConvergence', group: 'Forcing', label: 'Moisture convergence', unit: '×10⁻⁶ /s', decimals: 2, levels: [0.2, 0.4, 0.8, 1.2, 1.6], shade: ramp(GREEN, 0.15, 1.6), read: c => (c.dynamics.moistureFluxConvergence ?? 0) * 1e6 },
  { key: 'heightChange', group: 'Forcing', label: '500 mb height change', unit: 'dam/12 h', decimals: 1, levels: [-12, -9, -6, -3, -1.5, 1.5, 3, 6, 9, 12], read: c => c.levels[500].heightTendencyDm12h ?? 0,
    shade: [[-12, 60, 60, 220, 0.7], [-6, 90, 140, 240, 0.55], [-1.5, 150, 200, 255, 0.3], [0, 200, 200, 200, 0.0], [1.5, 255, 200, 170, 0.3], [6, 240, 130, 90, 0.55], [12, 200, 50, 50, 0.7]], shadeBelowFirst: true },
  { key: 'upslope', group: 'Forcing', label: 'Upslope flow', unit: 'cm/s', decimals: 1, levels: [0.5, 1, 2, 3, 5], shade: ramp(GREEN, 0.4, 5), read: c => (c.dynamics.terrainLiftMs ?? 0) * 100 },
  { key: 'readiness', group: 'Forcing', label: 'Where storms can start (lift against the cap)', unit: '0-1', decimals: 2, levels: [0.1, 0.2, 0.3, 0.4, 0.6, 0.8], shade: ramp(WARM, 0.08, 0.8), read: c => c.dynamics.initiationPotential ?? 0 },

  upperAir(850, '850 mb', [15, 20, 30, 40, 50, 60], 15, 60, { label: 'temperature', unit: '°C', levels: [8, 12, 16, 20, 24, 28, 32], colour: '#ff8a80', read: c => c.levels[850].temperature }),
  upperAir(700, '700 mb', [20, 30, 40, 50, 60], 20, 65, { label: 'temperature', unit: '°C', levels: [2, 4, 6, 8, 10, 12, 14, 16], colour: '#ff8a80', read: c => c.levels[700].temperature }),
  upperAir(500, '500 mb', [30, 40, 50, 60, 70, 80, 100], 30, 100, { label: 'height', unit: 'dam', levels: Array.from({ length: 30 }, (_, i) => 522 + 6 * i), colour: '#e2e8f0', read: c => c.levels[500].heightDm }),
  upperAir(250, '250 mb', [50, 70, 90, 110, 130, 150], 50, 150, null)
];

const BARB_SPACING_CELLS = 4;

// One parameter over the whole map (row by row from the north-west), with what the page needs
// to draw it.
export function buildParameterField(world, parameter) {
  const scale = 10 ** parameter.decimals, values = new Array(world.width * world.height);
  world.forEachCell((cell, x, y) => { const v = Number(parameter.read(cell)); values[y * world.width + x] = Number.isFinite(v) ? Math.round(v * scale) / scale : 0; });
  const field = { key: parameter.key, group: parameter.group, label: parameter.label, unit: parameter.unit, decimals: parameter.decimals, levels: parameter.levels, shade: parameter.shade, shadeBelowFirst: Boolean(parameter.shadeBelowFirst), values };
  if (parameter.barbs) {
    field.barbs = [];
    for (let y = 2; y < world.height; y += BARB_SPACING_CELLS) for (let x = 2; x < world.width; x += BARB_SPACING_CELLS) {
      const wind = parameter.barbs(world.cells[y][x]);
      field.barbs.push({ xKm: (x + 0.5) * world.cellSizeKm, yKm: (y + 0.5) * world.cellSizeKm, windKt: Math.round(wind.speed), windFromDeg: Math.round(wind.direction) });
    }
  }
  if (parameter.second) {
    const second = new Array(values.length);
    world.forEachCell((cell, x, y) => { second[y * world.width + x] = Math.round((Number(parameter.second.read(cell)) || 0) * 10) / 10; });
    field.second = { label: parameter.second.label, unit: parameter.second.unit, levels: parameter.second.levels, colour: parameter.second.colour, values: second };
  }
  return field;
}

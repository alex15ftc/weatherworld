// How the world map is coloured, shared by the build script's preview PNG and the map page:
// land cover tinted by a hillshade (light from the north-west), with the rivers drawn over it.

export const COVER_COLOURS = Object.freeze({
  water: [70, 120, 190], cropland: [196, 178, 112], irrigated: [118, 160, 70], grassland: [168, 172, 112],
  sandhillGrass: [190, 180, 128], forest: [62, 102, 58], riparian: [86, 124, 70], breaks: [160, 132, 104],
  redRange: [176, 120, 88], tallgrass: [130, 150, 90]
});
export const RIVER_COLOUR = [58, 104, 170];

// RGBA pixels (one per map cell) for the land cover with hillshading.
export function shadeMap(map, coverKeys, { exaggeration = 8 } = {}) {
  const { size: n, elevation, cover } = map, cellM = map.cellMiles * 1609.344, rgba = new Uint8ClampedArray(n * n * 4);
  const lx = -0.6, ly = -0.6, lz = 0.53;   // light from the north-west, fairly low
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, at = (a, b) => elevation[Math.min(n - 1, Math.max(0, b)) * n + Math.min(n - 1, Math.max(0, a))];
    const dzdx = (at(i + 1, j) - at(i - 1, j)) * exaggeration / (2 * cellM), dzdy = (at(i, j + 1) - at(i, j - 1)) * exaggeration / (2 * cellM);
    const len = Math.hypot(dzdx, dzdy, 1), shade = Math.max(0, (-dzdx * lx - dzdy * ly + lz) / len) / lz;
    const colour = COVER_COLOURS[coverKeys[cover[k]]] ?? [255, 0, 255], f = 0.55 + 0.45 * Math.min(1.4, shade);
    rgba[k * 4] = colour[0] * f; rgba[k * 4 + 1] = colour[1] * f; rgba[k * 4 + 2] = colour[2] * f; rgba[k * 4 + 3] = 255;
  }
  return rgba;
}

// Rivers drawn into an RGBA raster of the map (1 pixel per cell), wider rivers thicker.
export function drawRivers(rgba, n, rivers, cellMiles) {
  const cellM = cellMiles * 1609.344;
  const plot = (x, y, r) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const i = Math.round(x) + dx, j = Math.round(y) + dy;
      if (i < 0 || j < 0 || i >= n || j >= n || dx * dx + dy * dy > r * r + 0.5) continue;
      const k = (j * n + i) * 4;
      rgba[k] = RIVER_COLOUR[0]; rgba[k + 1] = RIVER_COLOUR[1]; rgba[k + 2] = RIVER_COLOUR[2];
    }
  };
  for (const river of rivers) {
    for (let s = 2; s < river.points.length; s += 2) {
      const x0 = river.points[s - 2] / cellMiles - 0.5, y0 = river.points[s - 1] / cellMiles - 0.5;
      const x1 = river.points[s] / cellMiles - 0.5, y1 = river.points[s + 1] / cellMiles - 0.5;
      const r = Math.max(0, Math.round(river.widthsM[s / 2] / cellM * 1.5));
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
      for (let t = 0; t <= steps; t++) plot(x0 + (x1 - x0) * t / steps, y0 + (y1 - y0) * t / steps, r);
    }
  }
}

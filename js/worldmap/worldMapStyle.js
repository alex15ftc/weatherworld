// How the world map is coloured, shared by the build script's preview PNG and the map page:
// land cover tinted by a hillshade (light from the north-west), with the rivers drawn over it.

export const COVER_COLOURS = Object.freeze({
  water: [70, 120, 190], cropland: [196, 178, 112], irrigated: [118, 160, 70], grassland: [168, 172, 112],
  sandhillGrass: [190, 180, 128], forest: [62, 102, 58], riparian: [86, 124, 70], breaks: [160, 132, 104],
  redRange: [176, 120, 88], tallgrass: [130, 150, 90], urban: [120, 118, 124], suburban: [170, 166, 160]
});
export const ROAD_STYLE = Object.freeze({ interstate: { colour: [200, 40, 50], widthPx: 2.6 }, highway: { colour: [250, 196, 60], widthPx: 1.4 }, expressway: { colour: [235, 120, 40], widthPx: 2 } });
// Section-line roads by class (SECTION_CLASSES order: none, dirt, gravel, paved).
export const SECTION_STYLE = Object.freeze([null, { colour: [150, 118, 84], alpha: 0.5 }, { colour: [215, 208, 192], alpha: 0.45 }, { colour: [240, 240, 240], alpha: 0.85 }]);
export const RIVER_COLOUR = [58, 104, 170];

// RGBA pixels (one per map cell) for the land cover with hillshading.
export function shadeMap(map, coverKeys, { exaggeration = 25 } = {}) {
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

// Roads (highways first, interstates over them) and settlement dots drawn into the raster.
export function drawRoads(rgba, n, roads, settlements, cellMiles) {
  const line = (points, colour, r) => {
    for (let s = 1; s < points.length; s++) {
      const [x0, y0] = points[s - 1], [x1, y1] = points[s], steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / cellMiles * 2));
      for (let t = 0; t <= steps; t++) dot((x0 + (x1 - x0) * t / steps) / cellMiles - 0.5, (y0 + (y1 - y0) * t / steps) / cellMiles - 0.5, r, colour);
    }
  };
  const dot = (x, y, r, colour) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const i = Math.round(x) + dx, j = Math.round(y) + dy;
      if (i < 0 || j < 0 || i >= n || j >= n || dx * dx + dy * dy > r * r + 0.5) continue;
      const k = (j * n + i) * 4;
      rgba[k] = colour[0]; rgba[k + 1] = colour[1]; rgba[k + 2] = colour[2];
    }
  };
  for (const kind of ['highway', 'expressway', 'interstate']) for (const road of roads) if (road.kind === kind) line(road.points, ROAD_STYLE[kind].colour, kind === 'highway' ? 0 : 1);
  for (const s of settlements) dot(s.x / cellMiles - 0.5, s.y / cellMiles - 0.5, s.kind === 'town' ? 1 : 3, [20, 20, 24]);
}

// Section-line roads of the given classes drawn into the raster (blended, one pixel wide, on the
// cells just east of and just south of each mile line).
export function drawSectionRoads(rgba, n, sections, cellMiles, classes = [3]) {
  const per = Math.round(1 / cellMiles), { size, roads } = sections;
  const blend = (i, j, style) => {
    if (i < 0 || j < 0 || i >= n || j >= n) return;
    const k = (j * n + i) * 4, a = style.alpha;
    for (let c = 0; c < 3; c++) rgba[k + c] = rgba[k + c] * (1 - a) + style.colour[c] * a;
  };
  for (let J = 0; J < size; J++) for (let I = 0; I < size; I++) {
    const v = roads[J * size + I], east = v & 3, south = (v >> 2) & 3;
    if (classes.includes(east)) for (let t = 0; t < per; t++) blend(I * per + t, J * per, SECTION_STYLE[east]);
    if (classes.includes(south)) for (let t = 0; t < per; t++) blend(I * per, J * per + t, SECTION_STYLE[south]);
  }
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

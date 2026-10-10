// Surface-analysis overlays for the live map, derived from the current fields: isobars,
// pressure centres, which side of each front its symbols face, and wind barbs.
const ISOBAR_INTERVAL_HPA = 2;
const CENTRE_RADIUS_CELLS = 5;
const CENTRE_PROMINENCE_HPA = 1.2;
const BARB_SPACING_CELLS = 3;

export function buildAnalysisOverlays(world, boundaries = []) {
  const { width, height, cellSizeKm } = world;
  const pressure = smooth(Float64Array.from({ length: width * height }, (_, i) => Number(world.cells[Math.floor(i / width)][i % width].surface.seaLevelPressure) || 1013), width, height, 2);
  return {
    isobars: contours(pressure, width, height, cellSizeKm),
    pressureCentres: centres(pressure, width, height, cellSizeKm),
    boundaries: boundaries.map(boundary => ({ ...boundary, symbolSide: symbolSide(world, boundary) })),
    windBarbs: barbs(world)
  };
}

function smooth(values, width, height, passes) {
  let src = values;
  for (let pass = 0; pass < passes; pass++) {
    const out = new Float64Array(src.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0, count = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        sum += src[yy * width + xx]; count++;
      }
      out[y * width + x] = sum / count;
    }
    src = out;
  }
  return src;
}

// Marching squares on the cell-centre grid. Returns [{ hPa, segments: [x1, y1, x2, y2, ...] }] in km.
function contours(field, width, height, cellSizeKm) {
  let min = Infinity, max = -Infinity;
  for (const v of field) { if (v < min) min = v; if (v > max) max = v; }
  const out = [];
  const km = v => Math.round((v + 0.5) * cellSizeKm * 10) / 10;
  for (let level = Math.ceil(min / ISOBAR_INTERVAL_HPA) * ISOBAR_INTERVAL_HPA; level <= max; level += ISOBAR_INTERVAL_HPA) {
    const segments = [];
    for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) {
      const a = field[y * width + x], b = field[y * width + x + 1], c = field[(y + 1) * width + x + 1], d = field[(y + 1) * width + x];
      const crossings = [];
      const edge = (v1, v2, x1, y1, x2, y2) => { if ((v1 < level) !== (v2 < level)) { const t = (level - v1) / (v2 - v1); crossings.push(km(x1 + (x2 - x1) * t), km(y1 + (y2 - y1) * t)); } };
      edge(a, b, x, y, x + 1, y); edge(b, c, x + 1, y, x + 1, y + 1); edge(d, c, x, y + 1, x + 1, y + 1); edge(a, d, x, y, x, y + 1);
      if (crossings.length === 4) segments.push(...crossings);
      else if (crossings.length === 8) segments.push(crossings[0], crossings[1], crossings[2], crossings[3], crossings[4], crossings[5], crossings[6], crossings[7]);
    }
    if (segments.length) out.push({ hPa: level, segments });
  }
  return out;
}

// Local extrema of the smoothed pressure that stand out from their surroundings.
function centres(field, width, height, cellSizeKm) {
  const out = [];
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const value = field[y * width + x];
    let low = true, high = true, ringSum = 0, ringCount = 0;
    for (let dy = -CENTRE_RADIUS_CELLS; dy <= CENTRE_RADIUS_CELLS && (low || high); dy++) for (let dx = -CENTRE_RADIUS_CELLS; dx <= CENTRE_RADIUS_CELLS; dx++) {
      const xx = x + dx, yy = y + dy;
      if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const other = field[yy * width + xx];
      if (other <= value) low = false;
      if (other >= value) high = false;
      if (Math.max(Math.abs(dx), Math.abs(dy)) === CENTRE_RADIUS_CELLS) { ringSum += other; ringCount++; }
    }
    if ((!low && !high) || !ringCount) continue;
    const prominence = ringSum / ringCount - value;
    if (low && prominence >= CENTRE_PROMINENCE_HPA) out.push({ type: 'L', xKm: (x + 0.5) * cellSizeKm, yKm: (y + 0.5) * cellSizeKm, hPa: Math.round(value) });
    if (high && -prominence >= CENTRE_PROMINENCE_HPA) out.push({ type: 'H', xKm: (x + 0.5) * cellSizeKm, yKm: (y + 0.5) * cellSizeKm, hPa: Math.round(value) });
  }
  return out;
}

// +1 when the symbols belong on the left of the line's drawing direction, -1 on the right.
// Cold-front triangles and dryline scallops point into the warm, moist air; warm-front
// semicircles point into the cool air the front is advancing on.
function symbolSide(world, boundary) {
  const points = boundary.pointsKm ?? [];
  if (points.length < 2) return 1;
  let score = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
    // Left normal in screen coordinates (y down).
    const nx = dy / length, ny = -dx / length, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, reach = 3 * world.cellSizeKm;
    const left = sample(world, mx + nx * reach, my + ny * reach), right = sample(world, mx - nx * reach, my - ny * reach);
    if (!left || !right) continue;
    score += boundary.type === 'dryline' ? left.dewpoint - right.dewpoint : boundary.type === 'warm' ? right.temperature - left.temperature : left.temperature - right.temperature;
  }
  return score >= 0 ? 1 : -1;
}

function sample(world, xKm, yKm) {
  const x = Math.floor(xKm / world.cellSizeKm), y = Math.floor(yKm / world.cellSizeKm);
  return x < 0 || y < 0 || x >= world.width || y >= world.height ? null : world.cells[y][x].surface;
}

function barbs(world) {
  const out = [];
  const offset = Math.floor(BARB_SPACING_CELLS / 2);
  for (let y = offset; y < world.height; y += BARB_SPACING_CELLS) for (let x = offset; x < world.width; x += BARB_SPACING_CELLS) {
    const wind = world.cells[y][x].surface.wind;
    out.push({ xKm: (x + 0.5) * world.cellSizeKm, yKm: (y + 0.5) * world.cellSizeKm, speedKt: Math.round(Number(wind?.speed) || 0), fromDeg: Math.round(Number(wind?.direction) || 0) });
  }
  return out;
}

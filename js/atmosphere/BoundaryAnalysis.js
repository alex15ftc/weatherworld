// Fronts and drylines found from the fields (stage 3 of docs/ATMOSPHERE-REDESIGN.md). Nothing
// here knows what the weather pattern is supposed to be: a front is where the air-mass
// temperature changes fastest, a dryline where the moisture does, and the kind of front
// follows from which way the cold air is moving.
//
// Method (the standard objective one): smooth the field, take the size of its gradient, keep
// the crest lines of that gradient (points where it is larger than on either side along the
// gradient's own direction), join them into lines, and place a front on the warm edge of its
// zone of contrast, which is where analysts draw it.
import { clamp } from '../scenarios/math.js';

export const BOUNDARY_DEFAULTS = Object.freeze({
  smoothingPasses: 2,
  // Smallest contrast that counts, per 100 km: air-mass temperature (K) and moisture (g/kg).
  frontGradient: 4, drylineGradient: 5,
  minLengthKm: 200,
  // An outflow boundary is the edge of storm-cooled air at least this much colder (K) than
  // its air mass; such lines are shorter than fronts.
  outflowDeficitK: 1.5, outflowMinLengthKm: 60,
  // Cold air advancing or retreating slower than this (m/s) makes the front stationary.
  stationarySpeedMs: 2,
  // How far into the cold air its wind is read (cells), and how far a moisture line must be
  // from a front, and how much colder its dry side may be, to count as a dryline.
  coldSideReachCells: 2, drylineFrontClearanceCells: 3, drylineColdSideLimitK: 2
});

const MS_PER_KT = 0.514444;

// Reads the fields the analysis needs from the cells. Rows count southward, so "y" grows to
// the south here and in the returned points, like every other map product.
function readFields(world) {
  const { width, height } = world, n = width * height;
  const temperature = new Float64Array(n), moisture = new Float64Array(n), u = new Float64Array(n), v = new Float64Array(n), coldPool = new Float64Array(n);
  world.forEachCell((cell, x, y) => {
    const k = y * width + x, surface = cell.surface;
    // Potential temperature of the air mass where the state carries it (no day-night swing, no
    // terrain in it), else of the air at the ground.
    const airMassK = Number(cell.features?.airMassThetaK);
    coldPool[k] = Number(cell.features?.coldPoolK) || 0;
    temperature[k] = Number.isFinite(airMassK) && airMassK > 0 ? airMassK : ((surface.temperature - 32) * 5 / 9 + 273.15) * (1000 / (surface.pressure || 1000)) ** 0.2857;
    const dewpointC = (surface.dewpoint - 32) * 5 / 9, vapour = 6.112 * Math.exp(17.67 * dewpointC / (dewpointC + 243.5));
    moisture[k] = 622 * vapour / Math.max(100, (surface.pressure || 1000) - vapour);
    const speed = (Number(surface.wind?.speed) || 0) * MS_PER_KT, direction = (Number(surface.wind?.direction) || 0) * Math.PI / 180;
    u[k] = -Math.sin(direction) * speed; v[k] = Math.cos(direction) * speed;   // v positive toward the south (down the rows)
  });
  return { temperature, moisture, u, v, coldPool };
}

function smooth(values, width, height, passes) {
  let source = values;
  for (let pass = 0; pass < passes; pass++) {
    const out = new Float64Array(source.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0, count = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) { sum += source[yy * width + xx]; count++; }
      out[y * width + x] = sum / count;
    }
    source = out;
  }
  return source;
}

function bilinear(field, width, height, x, y) {
  const cx = clamp(x, 0, width - 1), cy = clamp(y, 0, height - 1), x0 = Math.min(width - 2, Math.floor(cx)), y0 = Math.min(height - 2, Math.floor(cy)), tx = cx - x0, ty = cy - y0;
  return (field[y0 * width + x0] * (1 - tx) + field[y0 * width + x0 + 1] * tx) * (1 - ty) + (field[(y0 + 1) * width + x0] * (1 - tx) + field[(y0 + 1) * width + x0 + 1] * tx) * ty;
}

// Gradient of a field per 100 km: components and size.
function gradient(field, width, height, cellKm) {
  const gx = new Float64Array(field.length), gy = new Float64Array(field.length), size = new Float64Array(field.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const e = Math.min(width - 1, x + 1), w = Math.max(0, x - 1), s = Math.min(height - 1, y + 1), nn = Math.max(0, y - 1), k = y * width + x;
    gx[k] = (field[y * width + e] - field[y * width + w]) / ((e - w) * cellKm) * 100;
    gy[k] = (field[s * width + x] - field[nn * width + x]) / ((s - nn) * cellKm) * 100;
    size[k] = Math.hypot(gx[k], gy[k]);
  }
  return { gx, gy, size };
}

// Cells on a crest of the gradient: at least the threshold, and no smaller than the gradient
// one cell either way along its own direction.
function crestCells(grad, width, height, threshold, edge) {
  const crest = new Uint8Array(grad.size.length);
  // The outermost cells are left out: air entering the map there has not met the map's own air
  // yet. That is every cell the smoothing and the gradient carry the edge cells' values into.
  for (let y = edge; y < height - edge; y++) for (let x = edge; x < width - edge; x++) {
    const k = y * width + x, g = grad.size[k];
    if (g < threshold) continue;
    const nx = grad.gx[k] / g, ny = grad.gy[k] / g;
    if (g >= bilinear(grad.size, width, height, x + nx, y + ny) && g >= bilinear(grad.size, width, height, x - nx, y - ny)) crest[k] = 1;
  }
  return crest;
}

// Joins crest cells into lines: the longest path through each connected group, repeated on
// what is left so branches become their own lines when they are long enough.
function linkLines(crest, width, height, minCells) {
  const remaining = Uint8Array.from(crest), lines = [];
  const neighbours = k => { const x = k % width, y = (k - x) / width, out = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if ((dx || dy) && xx >= 0 && yy >= 0 && xx < width && yy < height && remaining[yy * width + xx]) out.push(yy * width + xx); } return out; };
  const farthest = start => { const parent = new Map([[start, -1]]); let queue = [start], last = start; while (queue.length) { const next = []; for (const k of queue) { last = k; for (const m of neighbours(k)) if (!parent.has(m)) { parent.set(m, k); next.push(m); } } queue = next; } return { last, parent }; };
  for (let k = 0; k < remaining.length; k++) {
    while (remaining[k]) {
      const end = farthest(k).last, { last, parent } = farthest(end), path = [];
      for (let at = last; at !== -1; at = parent.get(at)) path.push(at);
      if (path.length >= minCells) lines.push(path);
      // Take the path and the crest cells touching it out, so a thick crest gives one line.
      for (const cell of path) { for (const m of neighbours(cell)) remaining[m] = 0; remaining[cell] = 0; }
      if (path.length < minCells) for (const cell of parent.keys()) remaining[cell] = 0;
    }
  }
  return lines;
}

const smoothLine = points => points.map((p, i) => { const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)]; return i === 0 || i === points.length - 1 ? p : { ...p, x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 }; });
const lengthKm = (points, cellKm) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0) * cellKm;

// Returns { boundaries, fields } for the world's current state. Each boundary:
//   { id, type: 'cold' | 'warm' | 'stationary' | 'dryline' | 'outflow', symbolSide, pointsKm: [{ x, y }], lengthKm,
//     contrast (K or g/kg per 100 km), advanceMs (cold or dry air moving toward the warm, moist side) }
export function analyseBoundaries(world, options = {}) {
  const p = { ...BOUNDARY_DEFAULTS, ...options }, { width, height } = world, cellKm = world.cellSizeKm;
  const raw = readFields(world);
  const temperature = smooth(raw.temperature, width, height, p.smoothingPasses), moisture = smooth(raw.moisture, width, height, p.smoothingPasses);
  const u = smooth(raw.u, width, height, 1), v = smooth(raw.v, width, height, 1);
  const thermal = gradient(temperature, width, height, cellKm), moist = gradient(moisture, width, height, cellKm);
  const minCells = Math.max(3, Math.round(p.minLengthKm / cellKm / 1.2)), edge = p.smoothingPasses + 2;
  const boundaries = [];
  const toKm = point => ({ x: Math.round((point.x + 0.5) * cellKm * 10) / 10, y: Math.round((point.y + 0.5) * cellKm * 10) / 10 });

  // --- Fronts.
  const frontCrest = crestCells(thermal, width, height, p.frontGradient, edge);
  // Moist air is usually the cooler air mass, so a dryline has a temperature contrast too. A
  // contrast whose cool side is the moist side of a sharp moisture change is the dryline, not
  // a front: behind a front the air is colder and drier.
  for (let k = 0; k < frontCrest.length; k++) {
    if (!frontCrest[k]) continue;
    const x = k % width, y = (k - x) / width;
    search: for (let yy = Math.max(0, y - 2); yy <= Math.min(height - 1, y + 2); yy++) for (let xx = Math.max(0, x - 2); xx <= Math.min(width - 1, x + 2); xx++) {
      const m = yy * width + xx;
      if (moist.size[m] >= p.drylineGradient && moist.gx[m] * thermal.gx[k] + moist.gy[m] * thermal.gy[k] < 0) { frontCrest[k] = 0; break search; }
    }
  }
  const outflowCells = Math.max(3, Math.round(p.outflowMinLengthKm / cellKm / 1.2));
  for (const line of linkLines(frontCrest, width, height, Math.min(minCells, outflowCells))) {
    const points = line.map(k => {
      const x = k % width, y = (k - x) / width, g = thermal.size[k], nx = thermal.gx[k] / g, ny = thermal.gy[k] / g;   // (nx, ny) points at the warm air
      // The front lies on the warm edge of the zone: walk toward the warm air until the
      // contrast has fallen to half its crest value.
      let reach = 0; while (reach < 6 && bilinear(thermal.size, width, height, x + nx * (reach + 0.5), y + ny * (reach + 0.5)) > 0.5 * g) reach += 0.5;
      const coldX = x - nx * p.coldSideReachCells, coldY = y - ny * p.coldSideReachCells;
      return { x: x + nx * reach, y: y + ny * reach, nx, ny, contrast: g, outflow: bilinear(raw.coldPool, width, height, coldX, coldY) >= p.outflowDeficitK, advance: bilinear(u, width, height, coldX, coldY) * nx + bilinear(v, width, height, coldX, coldY) * ny };
    });
    // The kind of front can change along it (cold on one flank of a low, warm on the other).
    const advance = points.map((_, i) => { let sum = 0, count = 0; for (let j = Math.max(0, i - 2); j <= Math.min(points.length - 1, i + 2); j++) { sum += points[j].advance; count++; } return sum / count; });
    // The edge of storm-cooled air is an outflow boundary whichever way it is moving.
    const kind = advance.map((a, i) => (points[i].outflow ? 'outflow' : a > p.stationarySpeedMs ? 'cold' : a < -p.stationarySpeedMs ? 'warm' : 'stationary'));
    const half = Math.max(2, Math.floor(Math.min(minCells, outflowCells) / 2));
    for (let i = 0; i < kind.length;) {   // short runs take the kind of the run before them
      let j = i; while (j < kind.length && kind[j] === kind[i]) j++;
      if (j - i < half && i > 0) for (let m = i; m < j; m++) kind[m] = kind[i - 1];
      i = j;
    }
    for (let i = 0; i < kind.length;) {
      let j = i; while (j < kind.length && kind[j] === kind[i]) j++;
      const part = smoothLine(points.slice(Math.max(0, i - 1), j));
      if (part.length >= (kind[i] === 'outflow' ? half : Math.max(half, Math.floor(minCells / 2))) && (kind[i] === 'outflow' || line.length >= minCells)) boundaries.push({ type: kind[i], points: part });
      i = j;
    }
  }

  // --- Drylines: sharp moisture lines that are not the moisture change of a front. Its dry
  // side is as warm as the moist side or warmer, and no front runs along it.
  const nearFront = new Uint8Array(frontCrest.length), clearance = p.drylineFrontClearanceCells;
  for (let k = 0; k < frontCrest.length; k++) if (frontCrest[k]) { const x = k % width, y = (k - x) / width; for (let yy = Math.max(0, y - clearance); yy <= Math.min(height - 1, y + clearance); yy++) for (let xx = Math.max(0, x - clearance); xx <= Math.min(width - 1, x + clearance); xx++) nearFront[yy * width + xx] = 1; }
  const dryCrest = crestCells(moist, width, height, p.drylineGradient, edge);
  for (let k = 0; k < dryCrest.length; k++) {
    if (!dryCrest[k]) continue;
    const x = k % width, y = (k - x) / width, g = moist.size[k], nx = moist.gx[k] / g, ny = moist.gy[k] / g;   // points at the moist air
    const drySideColder = bilinear(temperature, width, height, x + 2 * nx, y + 2 * ny) - bilinear(temperature, width, height, x - 2 * nx, y - 2 * ny);
    if (nearFront[k] || drySideColder > p.drylineColdSideLimitK) dryCrest[k] = 0;
  }
  for (const line of linkLines(dryCrest, width, height, minCells)) {
    const points = smoothLine(line.map(k => {
      const x = k % width, y = (k - x) / width, g = moist.size[k], nx = moist.gx[k] / g, ny = moist.gy[k] / g, dryX = x - nx * p.coldSideReachCells, dryY = y - ny * p.coldSideReachCells;
      return { x, y, nx, ny, contrast: g, advance: bilinear(u, width, height, dryX, dryY) * nx + bilinear(v, width, height, dryX, dryY) * ny };
    }));
    boundaries.push({ type: 'dryline', points });
  }

  const counts = {};
  return {
    boundaries: boundaries.map(({ type, points }) => {
      counts[type] = (counts[type] ?? 0) + 1;
      const mean = key => points.reduce((sum, q) => sum + q[key], 0) / points.length;
      // Which side of the line (left of its drawing direction = +1) its symbols go on: the side
      // a cold front or the dry air is heading for, the cold side of a warm front.
      let left = 0;
      for (let i = 1; i < points.length; i++) { const a = points[i - 1], b = points[i]; left += (b.y - a.y) * (a.nx + b.nx) - (b.x - a.x) * (a.ny + b.ny); }
      const symbolSide = (left >= 0 ? 1 : -1) * (type === 'warm' ? -1 : 1);
      return { id: `${type}-${counts[type]}`, type, symbolSide, pointsKm: points.map(toKm), lengthKm: Math.round(lengthKm(points, cellKm)), contrast: Math.round(mean('contrast') * 10) / 10, advanceMs: Math.round(mean('advance') * 10) / 10, widthKm: 30, active: true, diagnosed: true };
    }),
    fields: { temperature, moisture, thermalGradient: thermal.size, moistureGradient: moist.size }
  };
}

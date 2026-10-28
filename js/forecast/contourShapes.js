// Contours as shapes. Given a field on the map's cell centres, traces the outline of the area
// where it is at or above a level: closed rings of points (holes come out as rings of their
// own, to be filled with the even-odd rule), following the map edge where the area runs off
// the map. Coordinates are shares of the map (0-1 across from the west, 0-1 down from the
// north), so whatever draws them (a page, a game) scales them as it likes.

// The rings of { field >= level }. `smoothing` rounds the corners (Chaikin's corner cutting).
export function contourRings(field, width, height, level, { smoothing = 2, decimals = 4 } = {}) {
  // Nodes: the cell centres, a ring of nodes on the map edge holding the nearest centre's
  // value, and a ring just outside holding a value below any level, so every outline closes.
  const xs = [-1e-3, 0, ...Array.from({ length: width }, (_, x) => (x + 0.5) / width), 1, 1 + 1e-3];
  const ys = [-1e-3, 0, ...Array.from({ length: height }, (_, y) => (y + 0.5) / height), 1, 1 + 1e-3];
  const nx = xs.length, ny = ys.length, below = level - 1e6;
  const value = (i, j) => (i === 0 || j === 0 || i === nx - 1 || j === ny - 1 ? below : field[Math.min(height - 1, Math.max(0, j - 2)) * width + Math.min(width - 1, Math.max(0, i - 2))]);
  // Marching squares: one or two segments per square of nodes, each from edge to edge.
  const segments = [];
  const cross = (i1, j1, v1, i2, j2, v2) => { const t = (level - v1) / (v2 - v1); return [xs[i1] + (xs[i2] - xs[i1]) * t, ys[j1] + (ys[j2] - ys[j1]) * t]; };
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = value(i, j), b = value(i + 1, j), c = value(i + 1, j + 1), d = value(i, j + 1);
    const code = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (d >= level ? 1 : 0);
    if (code === 0 || code === 15) continue;
    const top = () => cross(i, j, a, i + 1, j, b), right = () => cross(i + 1, j, b, i + 1, j + 1, c), bottom = () => cross(i, j + 1, d, i + 1, j + 1, c), left = () => cross(i, j, a, i, j + 1, d);
    const add = (p, q) => segments.push([p, q]);
    switch (code) {
      case 1: case 14: add(left(), bottom()); break;
      case 2: case 13: add(bottom(), right()); break;
      case 3: case 12: add(left(), right()); break;
      case 4: case 11: add(top(), right()); break;
      case 6: case 9: add(top(), bottom()); break;
      case 7: case 8: add(left(), top()); break;
      // Saddles: joined through the middle or not by the value there.
      case 5: if ((a + b + c + d) / 4 >= level) { add(left(), top()); add(bottom(), right()); } else { add(left(), bottom()); add(top(), right()); } break;
      case 10: if ((a + b + c + d) / 4 >= level) { add(left(), bottom()); add(top(), right()); } else { add(left(), top()); add(bottom(), right()); } break;
    }
  }
  // Join the segments end to end into closed rings.
  const key = p => `${Math.round(p[0] * 1e7)},${Math.round(p[1] * 1e7)}`, ends = new Map();
  segments.forEach((segment, index) => { for (const end of [0, 1]) { const k = key(segment[end]); if (!ends.has(k)) ends.set(k, []); ends.get(k).push({ index, end }); } });
  const used = new Uint8Array(segments.length), rings = [];
  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    const ring = [segments[start][0]]; let index = start, end = 1;
    used[start] = 1;
    for (let guard = 0; guard <= segments.length; guard++) {
      const point = segments[index][end]; ring.push(point);
      const next = (ends.get(key(point)) ?? []).find(other => !used[other.index]);
      if (!next) break;
      used[next.index] = 1; index = next.index; end = 1 - next.end;
    }
    if (ring.length >= 4) rings.push(ring);
  }
  const clamp = v => Math.min(1, Math.max(0, v)), round = v => Number(v.toFixed(decimals));
  return rings.map(ring => {
    let points = ring.slice(0, -1).map(([x, y]) => [clamp(x), clamp(y)]);
    for (let pass = 0; pass < smoothing; pass++) points = cutCorners(points);
    return points.map(([x, y]) => [round(x), round(y)]);
  }).filter(ring => ring.length >= 3 && Math.abs(ringArea(ring)) > 1e-6);
}

// Chaikin's corner cutting on a closed ring, leaving points on the map edge where they are
// (so areas that run off the map keep a straight edge along it).
export function cutCorners(points) {
  const onEdge = p => p[0] <= 0 || p[0] >= 1 || p[1] <= 0 || p[1] >= 1, out = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    if (onEdge(p) && onEdge(q)) { out.push(p); continue; }
    out.push(onEdge(p) ? p : [0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]]);
    if (!onEdge(q)) out.push([0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
  }
  return out;
}

// Signed area of a ring (shares of the map squared).
export function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; sum += p[0] * q[1] - q[0] * p[1]; }
  return sum / 2;
}

// The share of the map inside a set of rings (even-odd: holes are taken out).
export function ringsArea(rings) {
  // A ring inside an odd number of the others is a hole (rings here wind either way).
  return rings.reduce((sum, ring, k) => {
    const depth = rings.filter((other, j) => j !== k && insideRings([other], ring[0][0], ring[0][1])).length;
    return sum + (depth % 2 ? -1 : 1) * Math.abs(ringArea(ring));
  }, 0);
}

// Whether a point is inside a set of rings by the even-odd rule.
export function insideRings(rings, x, y) {
  let inside = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// The joined-up pieces of a set of cells (a list of cell indices; neighbours share a side),
// each a list, the largest first.
export function connectedPieces(cells, width, height) {
  const inside = new Uint8Array(width * height), mark = new Uint8Array(width * height), pieces = [];
  for (const i of cells) inside[i] = 1;
  for (const start of cells) {
    if (mark[start]) continue;
    const piece = [], stack = [start]; mark[start] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % width, y = (i - x) / width; piece.push(i);
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) if (j >= 0 && inside[j] && !mark[j]) { mark[j] = 1; stack.push(j); }
    }
    pieces.push(piece);
  }
  return pieces.sort((a, b) => b.length - a.length);
}

// The parts of a 0/1 grid's background that are cut off from the map edge (holes in the
// area), each a list of cells. Background cells join through shared sides only.
export function enclosedHoles(grid, width, height) {
  const n = width * height, reached = new Uint8Array(n), stack = [];
  for (let i = 0; i < n; i++) { const x = i % width, y = (i - x) / width; if (!grid[i] && (x === 0 || y === 0 || x === width - 1 || y === height - 1)) { reached[i] = 1; stack.push(i); } }
  const spread = (from, mark) => { while (from.length) { const i = from.pop(), x = i % width, y = (i - x) / width; for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) if (j >= 0 && !grid[j] && !mark[j]) { mark[j] = 1; from.push(j); } } };
  spread(stack, reached);
  const holes = [], seen = Uint8Array.from(reached);
  for (let i = 0; i < n; i++) {
    if (grid[i] || seen[i]) continue;
    const hole = [], from = [i]; seen[i] = 1;
    while (from.length) { const k = from.pop(), x = k % width, y = (k - x) / width; hole.push(k); for (const j of [x > 0 ? k - 1 : -1, x < width - 1 ? k + 1 : -1, y > 0 ? k - width : -1, y < height - 1 ? k + width : -1]) if (j >= 0 && !grid[j] && !seen[j]) { seen[j] = 1; from.push(j); } }
    holes.push(hole);
  }
  return holes;
}

// One joined-up area with no holes, from a 0/1 grid: its largest piece, with every hole
// filled in. A hole holding ground the area may not take (blocked: a 0/1 grid, such as other
// watches) is opened to the map edge instead, by giving up the area's cells due north of it.
export function solidRegion(grid, width, height, blocked = null) {
  const n = width * height;
  let cells = new Uint8Array(n);
  for (const i of connectedPieces(Array.from(grid.keys()).filter(i => grid[i]), width, height)[0] ?? []) cells[i] = 1;
  for (let round = 0; round < 50; round++) {
    const holes = enclosedHoles(cells, width, height), stuck = blocked ? holes.filter(hole => hole.some(i => blocked[i])) : [];
    for (const hole of holes) if (!stuck.includes(hole)) for (const i of hole) cells[i] = 1;
    if (!stuck.length) return cells;
    for (const hole of stuck) { const top = new Map(); for (const i of hole) { const x = i % width, y = (i - x) / width; top.set(x, Math.min(top.get(x) ?? y, y)); } for (const [x, y] of top) for (let k = 0; k < y; k++) cells[k * width + x] = 0; }
    const kept = connectedPieces(Array.from(cells.keys()).filter(i => cells[i]), width, height)[0] ?? [];
    cells = new Uint8Array(n); for (const i of kept) cells[i] = 1;
  }
  return cells;
}

// The outline of one joined-up area with no holes (a 0/1 grid), softened as softenArea
// softens it. Where softening would part a narrow neck into two, only the larger part is
// outlined, and where it would close an inlet into a pocket the pocket is filled, so the
// outline is always a single ring.
export function regionRings(inside, width, height) {
  const field = softenArea(inside, width, height), within = [];
  for (let i = 0; i < field.length; i++) if (field[i] >= 0.5) within.push(i);
  // Joined across corners as well as sides: the outline joins what touches at a corner.
  const mark = new Uint8Array(field.length); let largest = [];
  for (const start of within) {
    if (mark[start]) continue;
    const part = [], stack = [start]; mark[start] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % width, y = (i - x) / width; part.push(i);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy, j = Y * width + X; if (X >= 0 && Y >= 0 && X < width && Y < height && !mark[j] && field[j] >= 0.5) { mark[j] = 1; stack.push(j); } }
    }
    if (part.length > largest.length) largest = part;
  }
  const keep = new Uint8Array(field.length); for (const i of largest) keep[i] = 1;
  for (let i = 0; i < field.length; i++) if (field[i] >= 0.5 && !keep[i]) field[i] = 0.49;
  for (const hole of enclosedHoles(keep, width, height)) for (const i of hole) field[i] = 0.51;
  return contourRings(field, width, height, 0.5);
}

// A 0/1 area softened so that its outline is a curve and not the grid's steps (0.5 is the edge).
// Beyond the map each edge cell is taken to carry on outward (as contourRings' edge nodes do):
// averaging only the cells on the map would pull an area lying a cell or two in from the edge
// out to it in a narrow neck.
export function softenArea(inside, width, height, passes = 2) {
  let field = Float32Array.from(inside, v => (v ? 1 : 0));
  const clampX = X => Math.min(width - 1, Math.max(0, X)), clampY = Y => Math.min(height - 1, Math.max(0, Y));
  for (let pass = 0; pass < passes; pass++) {
    const out = new Float32Array(field.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += field[clampY(y + dy) * width + clampX(x + dx)];
      out[y * width + x] = sum / 9;
    }
    field = out;
  }
  return field;
}

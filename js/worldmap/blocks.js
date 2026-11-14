// The street blocks: the rectangles of ground between the roads of the towns' grids, read off the
// road graph (streets.js) so the Roblox world can lay its lots out on the same blocks the roads
// enclose. Each block is { x0, y0, x1, y1, sides: [north, south, west, east] } in map miles, a side
// being the kind of the road along it or null where no road runs.
// Rules:
//   - the work is done a mile square at a time, for the squares a street or collector lies in or
//     along, so a block never crosses a mile line;
//   - only the roads that run north-south or east-west count (within alignMi; each on the line of
//     its mean coordinate): their lines, with the square's own sides, cut the square into cells
//     (lines closer than mergeMi are one line);
//   - a cell side has a wall where such a road covers its midpoint, of the highest road there
//     (BLOCK_RANK);
//   - cells are joined into rectangles row by row from the north-west: east while no wall stands
//     between, then south a whole row at a time while no wall stands under the run or between the
//     cells of the next row;
//   - a side has a road when walls cover at least half of it, of the kind covering most of it;
//   - kept are the blocks on urban or suburban land (at their centre) that are at least minSideMi
//     both ways and have a road on at least one side.
// Roads that run at a slant or curve are not walls: a block may lie across one.
export const BLOCK_RANK = Object.freeze(['interstate', 'expressway', 'highway', 'ramp', 'arterial', 'collector', 'county', 'frontage', 'local', 'street', 'gravel', 'dirt']);
const RANK = Object.fromEntries(BLOCK_RANK.map((k, i) => [k, i]));

export const BLOCK_DEFAULTS = Object.freeze({
  alignMi: 0.002,    // a road whose ends differ by less than this across its line runs along the grid (about a stud)
  mergeMi: 0.01,     // grid lines closer than this are one line
  minSideMi: 0.05    // blocks narrower than this are left out
});

export function planBlocks(map, options = {}) {
  const p = { ...BLOCK_DEFAULTS, ...options };
  const { size: n, cellMiles, cover, coverKeys } = map;
  const URBAN = coverKeys.indexOf('urban'), SUBURBAN = coverKeys.indexOf('suburban');
  const squares = Math.ceil(n * cellMiles), tol = p.alignMi;
  const key = (I, J) => I * 4096 + J;
  const inMap = v => v >= 0 && v < squares;

  // The grid roads by mile square, and the squares to work on.
  const index = new Map(), wanted = new Set();
  for (const e of map.streets.graph.edges) {
    if (!e.alive || RANK[e.kind] === undefined) continue;
    const ax = e.a.x, ay = e.a.y, bx = e.b.x, by = e.b.y;
    if (e.kind === 'street' || e.kind === 'collector') {
      for (let I = Math.floor(Math.min(ax, bx) - tol); I <= Math.floor(Math.max(ax, bx) + tol); I++) for (let J = Math.floor(Math.min(ay, by) - tol); J <= Math.floor(Math.max(ay, by) + tol); J++) if (inMap(I) && inMap(J)) wanted.add(key(I, J));
    }
    const vertical = Math.abs(ax - bx) < tol, horizontal = Math.abs(ay - by) < tol;
    if (vertical === horizontal) continue;
    const c = vertical ? (ax + bx) / 2 : (ay + by) / 2, s0 = vertical ? Math.min(ay, by) : Math.min(ax, bx), s1 = vertical ? Math.max(ay, by) : Math.max(ax, bx);
    const item = { vertical, c, s0, s1, rank: RANK[e.kind] };
    for (let C = Math.floor(c - tol); C <= Math.floor(c + tol); C++) for (let Q = Math.floor(s0); Q <= Math.floor(s1); Q++) {
      if (!inMap(C) || !inMap(Q)) continue;
      const k = vertical ? key(C, Q) : key(Q, C);
      let list = index.get(k); if (!list) index.set(k, list = []); list.push(item);
    }
  }

  // The lines of a square one way, from lo to lo + 1: the roads' lines with near ones merged (at
  // their mean; the square's sides stay where they are). Sets each road's line.
  const lines = (list, lo) => {
    list.sort((a, b) => a.c - b.c);
    const out = [lo];
    let first = lo, sum = 0, count = 0;
    const close = () => { if (out.length > 1 && count) out[out.length - 1] = sum / count; };
    for (const it of list) {
      if (it.c - first >= p.mergeMi) { close(); out.push(it.c); first = it.c; sum = 0; count = 0; }
      sum += it.c; count++; it.line = out.length - 1;
    }
    if (out.length > 1 && lo + 1 - first < p.mergeMi) out[out.length - 1] = lo + 1; else { close(); out.push(lo + 1); }
    return out;
  };

  const blocks = [];
  for (let J = 0; J < squares; J++) for (let I = 0; I < squares; I++) {
    if (!wanted.has(key(I, J))) continue;
    const vs = [], hs = [];
    for (const it of index.get(key(I, J)) ?? []) {
      const lo = it.vertical ? I : J, from = it.vertical ? J : I;
      if (it.c < lo - tol || it.c > lo + 1 + tol) continue;
      const s0 = Math.max(it.s0, from), s1 = Math.min(it.s1, from + 1);
      if (s1 - s0 < 1e-6) continue;
      (it.vertical ? vs : hs).push({ c: Math.min(lo + 1, Math.max(lo, it.c)), s0, s1, rank: it.rank, line: 0 });
    }
    const xs = lines(vs, I), ys = lines(hs, J), cols = xs.length - 1, rows = ys.length - 1;
    // Walls: vWall[line * rows + row] on the north-south lines, hWall[line * cols + col] on the
    // east-west ones, each the rank of the road there or -1.
    const vWall = new Int8Array(xs.length * rows).fill(-1), hWall = new Int8Array(ys.length * cols).fill(-1);
    const raise = (wall, list, across, per) => {
      for (const it of list) for (let q = 0; q < per; q++) {
        const mid = (across[q] + across[q + 1]) / 2, k = it.line * per + q;
        if (it.s0 <= mid && mid <= it.s1 && (wall[k] < 0 || it.rank < wall[k])) wall[k] = it.rank;
      }
    };
    raise(vWall, vs, ys, rows); raise(hWall, hs, xs, cols);
    // A block side's road: the cells from..to along the line whose walls are at wall[at(i)].
    const side = (wall, at, along, from, to) => {
      const len = new Float64Array(BLOCK_RANK.length);
      let walled = 0;
      for (let i = from; i <= to; i++) { const k = wall[at(i)]; if (k >= 0) { len[k] += along[i + 1] - along[i]; walled += along[i + 1] - along[i]; } }
      if (walled <= 0 || walled < (along[to + 1] - along[from]) / 2 - 1e-9) return null;
      let best = 0;
      for (let k = 1; k < len.length; k++) if (len[k] > len[best]) best = k;
      return BLOCK_RANK[best];
    };
    const taken = new Uint8Array(cols * rows);
    for (let r0 = 0; r0 < rows; r0++) for (let c0 = 0; c0 < cols; c0++) {
      if (taken[r0 * cols + c0]) continue;
      let c1 = c0, r1 = r0;
      while (c1 + 1 < cols && !taken[r0 * cols + c1 + 1] && vWall[(c1 + 1) * rows + r0] < 0) c1++;
      for (let next = r1 + 1; next < rows; next++) {
        let open = true;
        for (let c = c0; c <= c1 && open; c++) open = !taken[next * cols + c] && hWall[next * cols + c] < 0 && (c === c0 || vWall[c * rows + next] < 0);
        if (!open) break;
        r1 = next;
      }
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) taken[r * cols + c] = 1;
      const x0 = xs[c0], y0 = ys[r0], x1 = xs[c1 + 1], y1 = ys[r1 + 1];
      if (x1 - x0 < p.minSideMi || y1 - y0 < p.minSideMi) continue;
      const land = cover[Math.min(n - 1, Math.floor((y0 + y1) / 2 / cellMiles)) * n + Math.min(n - 1, Math.floor((x0 + x1) / 2 / cellMiles))];
      if (land !== URBAN && land !== SUBURBAN) continue;
      const sides = [side(hWall, c => r0 * cols + c, xs, c0, c1), side(hWall, c => (r1 + 1) * cols + c, xs, c0, c1), side(vWall, r => c0 * rows + r, ys, r0, r1), side(vWall, r => (c1 + 1) * rows + r, ys, r0, r1)];
      if (sides.every(s => s === null)) continue;
      blocks.push({ x0, y0, x1, y1, sides });
    }
  }
  return blocks;
}

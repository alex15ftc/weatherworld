// The road graph: every road on the map, from the interstates down to the town streets, as one
// network of nodes and straight edges (map miles), the single source of where roads run and where
// they meet. Roads go in by rank, each only meeting or stopping at what is already there:
//   1. the map's interstates, expressways and highways (US and state routes) (settlements.js),
//      and the interchange ramps (crossings.js, interchanges.js);
//   2. the section roads as the road rules leave them (roadNetwork.js): paved (arterials in
//      town, county roads outside), gravel and dirt;
//   3. local roads: airfield entrance and loop roads and access roads, campus loops (paved); oil
//      and gas lease roads and wind farm roads (gravel);
//   4. the neighbourhood collectors on the half-mile lines in the cities (landUse.js), and
//      frontage roads beside the interstates through towns (both sides, stopping short of the
//      interchanges), which the streets, arterials and collectors meeting an interstate end on;
//   5. town streets in each mile square of a place (between the arterials): a grid of near-square
//      blocks in the old town and city cores; in the suburbs long blocks, the square split again
//      and again along its longer side on its own street lines, so streets carry on from block
//      to block but blocks come in different lengths. Lines are moved to miss the planned lots;
//      streets keep out of campuses, malls, industrial parks, larger parks and airfields, keep to
//      built-up land, off water and wide rivers, and stop short of the highways.
// Each road inserted snaps its ends to a node (or onto an edge) within snapMi, and is split, with
// the road it crosses, at every crossing, which becomes a shared node, unless the rules keep them
// apart there:
//   - interstates meet nothing at grade: highways and ramps pass over or under them; a paved
//     road passes over where crossings.js plans an overpass; anything else stops short of them
//     (a barrier across a paved road);
//   - ramps pass over or under the roads they cross away from their ends;
//   - highways and expressways meet each other, and paved roads (arterials, county roads,
//     collectors, local roads), at grade; gravel and dirt roads meet a two-lane highway at grade
//     (stop signs on the gravel road) but stop short of an expressway; town streets stop far
//     enough short for a cul-de-sac, except that in town a two-lane highway is the main street,
//     which streets cross at grade where they meet it nearly square;
//   - everything else meets at grade.
// A road running along a higher one (on the same line) is left out where it does, as is a highway
// along another (two routes sharing one road). Roads that would end just short of a highway (out
// of town, or where nothing else takes them) are cut back to their last junction instead. Street ends
// short enough to be scraps are pruned; the street ends left become cul-de-sacs.
//
// Each node gets its control from what meets there: signals where a highway meets another road
// at grade, at ramp ends, and where arterials and collectors cross in town; stop signs on the
// lesser approaches elsewhere on paved roads; none where only gravel and dirt roads meet.
import { makeRandom, hashText } from './noise.js';
import { interchangeRamps } from './interchanges.js';
import { pointInPoly, distToSeg } from './airfields.js';

export const STREET_DEFAULTS = Object.freeze({
  snapMi: 0.01,
  routeSnapMi: 0.05,        // a highway's end joins the highway it meets within this
  // Block sizes (miles): the shorter side and the longer side, by built-up land.
  blocks: { urban: { short: [0.12, 0.18], long: [0.18, 0.3] }, suburban: { short: [0.13, 0.22], long: [0.28, 0.5] } },
  splitRatio: [0.35, 0.65],
  tries: 8,                 // cut positions tried to miss the planned lots
  sampleMi: 0.01,           // streets are tested this often along their line
  bulbMi: 0.035,            // a cul-de-sac's radius with its sidewalk
  clearMi: 0.01,            // between a cul-de-sac and a highway's edge
  gravelGapMi: 0.04,        // gravel and dirt roads stop this far short of an expressway's, ramp's or interstate's edge
  cutGapMi: 0.03,           // paved roads stop this far short of an interstate's edge
  creekHalfMi: 0.03,        // streets bridge rivers narrower than this (half-width)
  pruneMi: 0.09,            // dead-end street scraps shorter than this go
  extendMi: 0.06,           // a street end this near a road it may meet is carried on to it
  joinMi: 0.15,             // two street ends facing each other this near are joined
  pullStepMi: 0.01,         // a cul-de-sac that does not fit is pulled back by this much at a time
  frontageMi: 0.09,         // a frontage road's centre line from its interstate's (an arterial ending on it stays off the interstate)
  frontageClearMi: 0.35,    // frontage roads stop this far from an interchange
  systemClearMi: 0.8,       // and this far from where two interstates meet
  stubNearMi: 0.12,         // a dead end this near a highway is cut back to its last junction
  stubLongestMi: 3,         // (a chain no longer than this; a longer one is pulled back clear of the highway instead)
  townCrossSin: 0.7,        // in town, streets cross a two-lane highway at grade this near square
  // Streets keep their own half-width and a little from lots, areas and airfield fences.
  lotPadMi: 0.022, areaPadMi: 0.025, fencePadMi: 0.06,
  bankMi: 0.018,            // a river's banks beyond its water (Roblox Bridges.BANK_EXTRA)
  riverCrossSin: 0.5,       // streets cross a river only this near square
});

export const ROAD_KINDS = Object.freeze(['interstate', 'expressway', 'highway', 'ramp', 'arterial', 'county', 'collector', 'local', 'street', 'gravel', 'dirt', 'frontage']);
// Half-widths (miles) of each road's footprint in the Roblox world (RoadNet's cross-sections at
// 1000 studs a mile).
export const HALF_MI = Object.freeze({ interstate: 0.051, expressway: 0.039, highway: 0.018, ramp: 0.011, arterial: 0.029, county: 0.013, collector: 0.022, local: 0.013, street: 0.018, gravel: 0.01, dirt: 0.0065, frontage: 0.013 });
const RANK = { interstate: 0, expressway: 1, highway: 1, ramp: 1, arterial: 2, county: 2, collector: 3, frontage: 3, local: 4, gravel: 4, dirt: 4, street: 5 };
const HIGHWAYS = new Set(['interstate', 'expressway', 'highway', 'ramp']);
const MAP_ROADS = new Set(['interstate', 'expressway', 'highway']);
const PAVED_MINOR = new Set(['arterial', 'county', 'collector', 'local', 'frontage']);
export const CONTROLS = Object.freeze(['none', 'stop', 'signal']);
export const ENDS = Object.freeze(['none', 'culDeSac', 'deadEnd', 'barrier']);

// The graph: nodes and edges with a spatial hash of half-mile cells.
function makeGraph() {
  const CELL = 0.5, nodes = [], edges = [], nodeCells = new Map(), edgeCells = new Map();
  const key = (X, Y) => X * 4096 + Y;
  const cells = (x0, y0, x1, y1) => {
    const out = [];
    for (let X = Math.floor(x0 / CELL); X <= Math.floor(x1 / CELL); X++) for (let Y = Math.floor(y0 / CELL); Y <= Math.floor(y1 / CELL); Y++) out.push(key(X, Y));
    return out;
  };
  const push = (map, k, v) => { let list = map.get(k); if (!list) map.set(k, list = []); list.push(v); };
  const addNode = (x, y) => { const n = { id: nodes.length, x, y, edges: [], end: 0 }; nodes.push(n); push(nodeCells, key(Math.floor(x / CELL), Math.floor(y / CELL)), n); return n; };
  const nodeNear = (x, y, r) => {
    let best = null, bd = r;
    for (const k of cells(x - r, y - r, x + r, y + r)) for (const n of nodeCells.get(k) ?? []) { const d = Math.hypot(n.x - x, n.y - y); if (d <= bd) { best = n; bd = d; } }
    return best;
  };
  const addEdge = (a, b, kind, extra = {}) => {
    if (a === b) return null;
    const e = { id: edges.length, a, b, kind, alive: true, ...extra };
    edges.push(e); a.edges.push(e); b.edges.push(e);
    for (const k of cells(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y))) push(edgeCells, k, e);
    return e;
  };
  const removeEdge = e => { e.alive = false; e.a.edges = e.a.edges.filter(x => x !== e); e.b.edges = e.b.edges.filter(x => x !== e); };
  const edgesNear = (x0, y0, x1, y1) => {
    const found = new Set();
    for (const k of cells(x0, y0, x1, y1)) for (const e of edgeCells.get(k) ?? []) if (e.alive) found.add(e);
    return found;
  };
  const seg = e => ({ ax: e.a.x, ay: e.a.y, bx: e.b.x, by: e.b.y });
  // A node at a point of an edge (splitting it there).
  const split = (e, x, y, at = null) => {
    const { a, b, kind, alive, id, ...extra } = e;
    void alive; void id;
    const n = at ?? addNode(x, y);
    removeEdge(e);
    addEdge(a, n, kind, extra); addEdge(n, b, kind, extra);
    return n;
  };
  // The node for a point: one within snap, else a point on an edge within snap (split there),
  // else a new node.
  const attach = (x, y, snap, onEdges = () => true) => {
    const n = nodeNear(x, y, snap);
    if (n) return n;
    for (const e of edgesNear(x - snap, y - snap, x + snap, y + snap)) {
      if (!onEdges(e) || distToSeg(x, y, seg(e)) >= snap) continue;
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, t = ((x - e.a.x) * dx + (y - e.a.y) * dy) / (dx * dx + dy * dy);
      if (t <= 0) return e.a;
      if (t >= 1) return e.b;
      return split(e, e.a.x + dx * t, e.a.y + dy * t);
    }
    return addNode(x, y);
  };
  return { nodes, edges, addNode, addEdge, removeEdge, edgesNear, nodeNear, attach, split, seg };
}

export function planStreets(map, options = {}) {
  const p = { ...STREET_DEFAULTS, ...options, blocks: { ...STREET_DEFAULTS.blocks, ...options.blocks } };
  const { size: n, cellMiles, cover, coverKeys, settlements, roads, rivers, crossings = [], airfields = [], facilities } = map;
  const seed = map.params.seed;
  const g = makeGraph();
  const cellAt = (x, y) => Math.min(n - 1, Math.max(0, Math.floor(y / cellMiles))) * n + Math.min(n - 1, Math.max(0, Math.floor(x / cellMiles)));
  const URBAN = coverKeys.indexOf('urban'), SUBURBAN = coverKeys.indexOf('suburban'), WATER = coverKeys.indexOf('water');
  const coverAt = (x, y) => cover[cellAt(x, y)];
  const town = (x, y) => { const c = coverAt(x, y); return c === URBAN || c === SUBURBAN; };
  const planned = (x, y) => crossings.some(c => Math.abs(c.x - x) < 0.08 && Math.abs(c.y - y) < 0.08 && Math.hypot(c.x - x, c.y - y) < 0.08);
  const stats = { dropped: 0, pruned: 0, cuts: 0, culDeSacs: 0 };

  // Where an interstate in town has frontage roads beside it (not near its interchanges).
  const interchanges = crossings.filter(c => c.type === 'interchange');
  const nearInterchange = (x, y) => interchanges.some(c => { const r = c.kind === 'interstate' ? p.systemClearMi : p.frontageClearMi; return Math.abs(c.x - x) < r && Math.abs(c.y - y) < r && Math.hypot(c.x - x, c.y - y) < r; });
  const frontAt = (x, y) => town(x, y) && !nearInterchange(x, y);

  // Whether a road of kind k may meet edge e at a crossing (sin: of the angle between them):
  // 'node' (at grade), 'over' (grade separated, no node), or a gap (miles) to stop short by,
  // with the end it leaves.
  const rule = (k, e, x, y, sin) => {
    const o = e.kind;
    const gap = extra => ({ gap: (HALF_MI[o] + extra) / Math.max(sin, 0.3) });
    if (o === 'interstate' || k === 'interstate') {
      if ((MAP_ROADS.has(k) && MAP_ROADS.has(o)) || k === 'ramp' || o === 'ramp') return 'over';
      if (PAVED_MINOR.has(k) && planned(x, y)) return 'over';
      // In town the frontage road takes them: they stop on its line.
      if ((k === 'street' || PAVED_MINOR.has(k)) && o === 'interstate' && frontAt(x, y)) return { ...gap(p.frontageMi - HALF_MI.interstate - 0.002), end: 0 };
      if (k === 'street') return { ...gap(p.bulbMi + p.clearMi), end: 1 };
      if (k === 'gravel' || k === 'dirt') return { ...gap(p.gravelGapMi), end: 2 };
      return { ...gap(p.cutGapMi), end: 3 };
    }
    if (o === 'ramp' || k === 'ramp') {
      if (MAP_ROADS.has(k) || MAP_ROADS.has(o) || PAVED_MINOR.has(k)) return 'over';
      if (k === 'street') return { ...gap(p.bulbMi + p.clearMi), end: 1 };
      return { ...gap(p.gravelGapMi), end: 2 };
    }
    if (o === 'expressway' || o === 'highway') {
      // In town a two-lane highway is the main street: streets meet it where they cross it
      // nearly square.
      if (k === 'street' && o === 'highway' && sin >= p.townCrossSin && town(x, y)) return 'node';
      if (k === 'street') return { ...gap(p.bulbMi + p.clearMi), end: 1 };
      if ((k === 'gravel' || k === 'dirt') && o === 'expressway') return { ...gap(p.gravelGapMi), end: 2 };
    }
    return 'node';
  };

  // A road along a higher-ranked one on (nearly) the same line is left out there.
  // A highway along another (a concurrency: two routes on one road) is left out too. Only a
  // point alongside the other road counts, not one beyond its end (where a road carries on
  // along the same line as another kind).
  // The roads that could leave a road of kind k going (ux, uy) out somewhere in a box: those
  // higher ranked and on (nearly) its line. Looked up once for a whole stretch, then tested at
  // each point of it (shadowed); any road alongside a point is within 0.1 mile of it, so in the
  // box widened by that.
  const shadowers = (k, x0, y0, x1, y1, ux, uy) => {
    const found = [];
    for (const e of g.edgesNear(x0 - 0.1, y0 - 0.1, x1 + 0.1, y1 + 0.1)) {
      if (e.kind === 'ramp') continue;
      if (MAP_ROADS.has(k) ? !MAP_ROADS.has(e.kind) || RANK[e.kind] > RANK[k] : RANK[e.kind] >= RANK[k]) continue;
      const ex = e.b.x - e.a.x, ey = e.b.y - e.a.y, el = Math.hypot(ex, ey);
      if (Math.abs((ex * ux + ey * uy) / el) <= 0.9) continue;
      found.push({ e, ex, ey, el, reach: HALF_MI[e.kind] + (MAP_ROADS.has(k) ? 0 : HALF_MI[k] + 0.004) });
    }
    return found;
  };
  const shadowed = (near, x, y) => {
    for (const { e, ex, ey, el, reach } of near) {
      const along = ((x - e.a.x) * ex + (y - e.a.y) * ey) / el, across = Math.abs((x - e.a.x) * ey - (y - e.a.y) * ex) / el;
      // Alongside where their widths touch (a road leaving another's line on a curve drops
      // out until it is clear of it).
      if (along > 0.002 && along < el - 0.002 && across < reach) return true;
    }
    return false;
  };

  // Inserts the straight road a-b of kind k. blocked(x, y), if given, takes out the stretches
  // of it where it holds (sampled every sampleMi); minRun drops pieces shorter than that.
  const insert = (ax, ay, bx, by, k, extra = {}, blocked = null, minRun = 0.004) => {
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) return;
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    const cuts = [];   // [from, to, end at from side, end at to side] (miles along)
    // Stretches along a higher road, and blocked stretches.
    if (k !== 'ramp' || blocked) {
      const steps = Math.max(1, Math.ceil(len / p.sampleMi));
      const near = k !== 'ramp' ? shadowers(k, Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by), ux, uy) : [];
      let start = null;
      for (let i = 0; i <= steps; i++) {
        const t = len * i / steps, x = ax + ux * t, y = ay + uy * t;
        const off = (near.length > 0 && shadowed(near, x, y)) || (blocked && blocked(x, y, ux, uy));
        if (off && start === null) start = t;
        if (!off && start !== null) { cuts.push([Math.max(0, start - len / steps / 2), t - len / steps / 2, 0, 0]); start = null; }
      }
      if (start !== null) cuts.push([Math.max(0, start - len / steps / 2), len, 0, 0]);
    }
    // Crossings with what is there.
    const hits = [];
    for (const e of g.edgesNear(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by))) {
      const rx = bx - ax, ry = by - ay, sx = e.b.x - e.a.x, sy = e.b.y - e.a.y, den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((e.a.x - ax) * sy - (e.a.y - ay) * sx) / den, u = ((e.a.x - ax) * ry - (e.a.y - ay) * rx) / den;
      if (t <= 1e-4 || t >= 1 - 1e-4 || u < -1e-4 || u > 1 + 1e-4) continue;
      const x = ax + rx * t, y = ay + ry * t, sin = Math.abs(den) / (len * Math.hypot(sx, sy));
      const r = rule(k, e, x, y, sin);
      if (r === 'over') continue;
      if (r === 'node') hits.push({ t: t * len, x, y, e });
      else cuts.push([t * len - r.gap, t * len + r.gap, r.end, r.end]);
    }
    // Each end that lands on or beside a road it may not meet stops short of it, as at a crossing.
    for (const [ex, ey, sign] of [[ax, ay, 1], [bx, by, -1]]) {
      for (const e of g.edgesNear(ex - 0.15, ey - 0.15, ex + 0.15, ey + 0.15)) {
        const sx = e.b.x - e.a.x, sy = e.b.y - e.a.y, sin = Math.abs(ux * sy - uy * sx) / Math.hypot(sx, sy);
        if (distToSeg(ex, ey, g.seg(e)) > HALF_MI[e.kind] + 0.1) continue;
        const r = rule(k, e, ex, ey, Math.max(sin, 0.05));
        if (typeof r !== 'object') continue;
        const clear = r.gap * Math.max(sin, 0.3);   // the distance square to the road to keep
        let s0 = 0;
        while (s0 < len && distToSeg(ex + ux * sign * s0, ey + uy * sign * s0, g.seg(e)) < clear) s0 += 0.005;
        if (s0 > 0) cuts.push(sign > 0 ? [0, s0, 0, r.end] : [len - s0, len, r.end, 0]);
      }
    }
    // The pieces left, with their nodes.
    cuts.sort((q, w) => q[0] - w[0]);
    const runs = [];
    let from = 0, endFrom = 0;
    for (const [c0, c1, e0, e1] of cuts) {
      if (c0 > from) runs.push([from, c0, endFrom, e0]);
      if (c1 > from) { from = c1; endFrom = e1; }
    }
    if (from < len) runs.push([from, len, endFrom, 0]);
    // Whether a new edge p-q would cross a road away from its ends (a snap gone too far).
    const crosses = (p0, q) => {
      for (const e of g.edgesNear(Math.min(p0.x, q.x), Math.min(p0.y, q.y), Math.max(p0.x, q.x), Math.max(p0.y, q.y))) {
        if (e.a === p0 || e.b === p0 || e.a === q || e.b === q) continue;
        const rx = q.x - p0.x, ry = q.y - p0.y, sx = e.b.x - e.a.x, sy = e.b.y - e.a.y, den = rx * sy - ry * sx;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((e.a.x - p0.x) * sy - (e.a.y - p0.y) * sx) / den, u = ((e.a.x - p0.x) * ry - (e.a.y - p0.y) * rx) / den;
        if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) return true;
      }
      return false;
    };
    for (const [r0, r1, end0, end1] of runs) {
      if (r1 - r0 < minRun) { stats.dropped++; continue; }
      const at = t => [ax + ux * t, ay + uy * t];
      const inRun = hits.filter(h => h.t > r0 + 1e-6 && h.t < r1 - 1e-6).sort((q, w) => q.t - w.t);
      // A highway's run joins the highway it meets or leaves (a route's end, or where it leaves
      // another it shared a road with) within routeSnapMi.
      const snap = MAP_ROADS.has(k) ? p.routeSnapMi : p.snapMi, onRoutes = MAP_ROADS.has(k) ? e => MAP_ROADS.has(e.kind) : undefined;
      let cur = g.attach(...at(r0), snap, onRoutes);
      const first = inRun.length ? { x: inRun[0].x, y: inRun[0].y } : { x: at(r1)[0], y: at(r1)[1] };
      if (crosses(cur, first)) cur = g.addNode(...at(r0));
      if (end0 && cur.edges.length === 0) cur.end = end0;
      for (const h of inRun) {
        // The edge crossed may have been split since: find the piece under the crossing.
        let e = h.e;
        if (!e.alive) e = [...g.edgesNear(h.x - 0.001, h.y - 0.001, h.x + 0.001, h.y + 0.001)].find(o => o.kind === h.e.kind && distToSeg(h.x, h.y, g.seg(o)) < 1e-6);
        if (!e) continue;
        // An end of the edge there, or a node already at the crossing (the edge is split at it,
        // so the two roads share it), or a new node.
        // (Only a node right at the crossing: snapping further would bend the road across another.)
        const near = [e.a, e.b].find(q => Math.hypot(q.x - h.x, q.y - h.y) < 0.002);
        const there = near ? null : g.nodeNear(h.x, h.y, 0.002);
        const node = near ?? (there ? g.split(e, there.x, there.y, there) : g.split(e, h.x, h.y));
        if (node !== cur) { g.addEdge(cur, node, k, extra); cur = node; }
      }
      let last = g.attach(...at(r1), snap, onRoutes);
      if (last !== cur && crosses(cur, last)) last = g.addNode(...at(r1));
      if (end1 && last.edges.length === 0) last.end = end1;
      if (last !== cur) g.addEdge(cur, last, k, extra);
    }
  };
  const insertLine = (points, k, extra) => { for (let i = 1; i < points.length; i++) insert(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], k, extra); };

  const RCELL = 1, riverCells = new Map();
  for (const river of rivers) for (let k = 2; k < river.points.length; k += 2) {
    const half = Math.min(220, Math.max(12, river.widthsM[k / 2] * 0.18)) / 2000;
    const s = { ax: river.points[k - 2], ay: river.points[k - 1], bx: river.points[k], by: river.points[k + 1], half };
    for (let X = Math.floor(Math.min(s.ax, s.bx) / RCELL) - 1; X <= Math.floor(Math.max(s.ax, s.bx) / RCELL) + 1; X++) for (let Y = Math.floor(Math.min(s.ay, s.by) / RCELL) - 1; Y <= Math.floor(Math.max(s.ay, s.by) / RCELL) + 1; Y++) {
      const kk = X * 4096 + Y; if (!riverCells.has(kk)) riverCells.set(kk, []); riverCells.get(kk).push(s);
    }
  }
  // Streets keep off rivers: a wide river (one streets do not bridge) with its banks, far enough
  // for a cul-de-sac; any river they would run along or cross at a slant, with its banks and the
  // street's own width. Creeks they cross nearly square are bridged.
  const nearRiver = (x, y, ux, uy) => {
    for (const s of riverCells.get(Math.floor(x / RCELL) * 4096 + Math.floor(y / RCELL)) ?? []) {
      const d = distToSeg(x, y, s);
      if (s.half >= p.creekHalfMi) { if (d < s.half + p.bankMi + p.bulbMi) return true; continue; }
      const sx = s.bx - s.ax, sy = s.by - s.ay, sin = Math.abs(ux * sy - uy * sx) / (Math.hypot(sx, sy) || 1);
      if (sin < p.riverCrossSin && d < s.half + p.bankMi + HALF_MI.street) return true;
    }
    return false;
  };

  // 1. The map's roads and the interchange ramps.
  for (const kind of ['interstate', 'expressway', 'highway']) roads.forEach((road, index) => { if (road.kind === kind) insertLine(road.points, kind, { road: index }); });
  for (const c of crossings) for (const ramp of interchangeRamps(c)) insertLine(ramp, 'ramp');

  // Frontage roads beside the interstates through towns, both sides.
  const wideRiverAt = (x, y) => (riverCells.get(Math.floor(x / RCELL) * 4096 + Math.floor(y / RCELL)) ?? []).some(sg => distToSeg(x, y, sg) < sg.half + p.bankMi + HALF_MI.frontage);
  const frontageBlocked = (x, y) => !frontAt(x, y) || coverAt(x, y) === WATER || wideRiverAt(x, y);
  for (const road of roads) {
    if (road.kind !== 'interstate') continue;
    const pts = road.points;
    for (const side of [1, -1]) {
      const offset = pts.map(([x, y], i) => {
        const [ax, ay] = pts[Math.max(0, i - 1)], [bx, by] = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(bx - ax, by - ay);
        return [x - (by - ay) / l * side * p.frontageMi, y + (bx - ax) / l * side * p.frontageMi];
      });
      for (let i = 1; i < offset.length; i++) {
        const [x0, y0] = offset[i - 1], [x1, y1] = offset[i], len = Math.hypot(x1 - x0, y1 - y0);
        // Long straights in pieces, so the blocked stretches are found along them.
        const n = Math.max(1, Math.ceil(len / 0.25));
        for (let k = 0; k < n; k++) insert(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, x0 + (x1 - x0) * (k + 1) / n, y0 + (y1 - y0) * (k + 1) / n, 'frontage', {}, frontageBlocked, 0.03);
      }
    }
  }

  // 2. Section roads, paved first, each mile of each line as the section grid has it (the rules
  // here cut them where they meet highways).
  const { size: secSize, roads: secRoads } = map.sections;
  for (const [cls, kindOf] of [[3, (x, y) => (town(x, y) ? 'arterial' : 'county')], [2, () => 'gravel'], [1, () => 'dirt']]) {
    for (let J = 0; J < secSize; J++) for (let I = 0; I < secSize; I++) {
      const v = secRoads[J * secSize + I];
      if ((v & 3) === cls && I + 1 < secSize) insert(I, J, I + 1, J, kindOf(I + 0.5, J));
      if (((v >> 2) & 3) === cls && J + 1 < secSize) insert(I, J, I, J + 1, kindOf(I, J + 0.5));
    }
  }

  // 3. Local roads.
  for (const a of airfields) {
    for (const road of a.roads) insertLine(road.points, 'local');
    if (!a.access.freeway) insertLine(a.access.points, 'local');
    if (a.nws?.drive) insertLine(a.nws.drive, 'local');
  }
  for (const c of facilities.campuses) insertLine(c.loop, 'local');
  for (const road of facilities.energy.leaseRoads) insertLine(road, 'gravel');
  for (const farm of facilities.energy.windFarms) for (const road of farm.roads) insertLine(road, 'gravel');

  // 4. Collectors.
  // Collectors keep their width outside airfield fences.
  const inAirfield = (x, y) => airfields.some(a => pointInPoly(x, y, a.fence) || a.fence.some(([fx, fy], i) => { const [gx, gy] = a.fence[(i + 1) % a.fence.length]; return distToSeg(x, y, { ax: fx, ay: fy, bx: gx, by: gy }) < HALF_MI.collector + 0.004; }));
  // Collectors, like streets, cross rivers only nearly square, and never run along one.
  const alongRiver = (x, y, ux, uy, half) => (riverCells.get(Math.floor(x / RCELL) * 4096 + Math.floor(y / RCELL)) ?? []).some(sg => {
    const sx = sg.bx - sg.ax, sy = sg.by - sg.ay, sin = Math.abs(ux * sy - uy * sx) / (Math.hypot(sx, sy) || 1);
    return sin < p.riverCrossSin && distToSeg(x, y, sg) < sg.half + p.bankMi + half;
  });
  for (const nb of facilities.landUse.neighborhoods) for (const c of nb.collectors) insert(c[0][0], c[0][1], c[1][0], c[1][1], 'collector', {}, (x, y, ux, uy) => inAirfield(x, y) || alongRiver(x, y, ux, uy, HALF_MI.collector), 0.03);

  // 5. Town streets. What a street keeps clear of: lots, superblocks, airfields, wide rivers,
  // water, the highways (far enough for a cul-de-sac), and land that is not built up.
  const obstacles = [], OCELL = 0.25, obstacleCells = new Map();
  const box = poly => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [x0, y0, x1, y1]; };
  const addObstacle = (poly, pad) => {
    const b = box(poly), o = { poly, pad, box: b };
    obstacles.push(o);
    for (let X = Math.floor((b[0] - pad) / OCELL); X <= Math.floor((b[2] + pad) / OCELL); X++) for (let Y = Math.floor((b[1] - pad) / OCELL); Y <= Math.floor((b[3] + pad) / OCELL); Y++) {
      const k = X * 4096 + Y; if (!obstacleCells.has(k)) obstacleCells.set(k, []); obstacleCells.get(k).push(o);
    }
  };
  const inObstacle = (x, y) => {
    for (const o of obstacleCells.get(Math.floor(x / OCELL) * 4096 + Math.floor(y / OCELL)) ?? []) {
      const b = o.box;
      if (x < b[0] - o.pad || x > b[2] + o.pad || y < b[1] - o.pad || y > b[3] + o.pad) continue;
      if (pointInPoly(x, y, o.poly)) return true;
      for (let i = 0; i < o.poly.length; i++) {
        const [px, py] = o.poly[i], [qx, qy] = o.poly[(i + 1) % o.poly.length];
        if (distToSeg(x, y, { ax: px, ay: py, bx: qx, by: qy }) < o.pad) return true;
      }
    }
    return false;
  };
  for (const z of facilities.landUse.areas) {
    const b = box(z.poly), small = Math.min(b[2] - b[0], b[3] - b[1]);
    if (z.kind === 'mall' || z.kind === 'travel' || z.tier === 'community' || z.kind === 'industrial' || (z.kind === 'park' && small > 0.15)) addObstacle(z.poly, p.areaPadMi);
  }
  for (const c of facilities.campuses) addObstacle(c.area, p.areaPadMi);
  for (const s of facilities.schools) addObstacle(s.lot, p.lotPadMi);
  for (const s of facilities.gasStations) addObstacle(s.lot, p.lotPadMi);
  for (const a of airfields) {
    addObstacle(a.fence, p.fencePadMi);
    for (const poly of [a.nws?.building, a.nws?.parking, a.radar?.compound]) if (poly) addObstacle(poly, p.lotPadMi);
  }
  const reach = 0.051 + p.bulbMi + p.clearMi;
  // Near a highway (far enough for a cul-de-sac). In town, a two-lane highway only keeps away
  // streets running alongside it; those crossing it are left to the crossing rules.
  const nearHighway = (x, y, ux, uy) => {
    for (const e of g.edgesNear(x - reach, y - reach, x + reach, y + reach)) {
      if (!HIGHWAYS.has(e.kind)) continue;
      const d = distToSeg(x, y, g.seg(e));
      if (e.kind === 'highway' && town(x, y)) {
        const ex = e.b.x - e.a.x, ey = e.b.y - e.a.y, sin = Math.abs(ux * ey - uy * ex) / Math.hypot(ex, ey);
        if (sin >= p.townCrossSin) { if (d < HALF_MI.highway + 0.004) return false; continue; }
      }
      if (e.kind === 'interstate' && frontAt(x, y)) { if (d < p.frontageMi - 0.002) return true; continue; }
      if (d < HALF_MI[e.kind] + p.bulbMi + p.clearMi) return true;
    }
    return false;
  };
  const streetBlocked = (x, y, ux, uy) => !town(x, y) || coverAt(x, y) === WATER || inObstacle(x, y) || nearRiver(x, y, ux, uy) || nearHighway(x, y, ux, uy);

  // The mile squares of the places. Each square has its own street lines each way: in an urban
  // core spaced at block sizes the same way both ways (a grid of near-square blocks), in a
  // suburb long one way and short the other (long blocks), the way turned at random by square.
  // Urban squares take every line right across (the grid); suburban squares are split again and
  // again along the longer side, each cut on the line nearest an uneven point, so neighbouring
  // blocks share their streets but the blocks come in different lengths. A line is moved a
  // little to miss a planned lot. The cities' squares are first quartered by their half-mile
  // collectors.
  const hoodCells = new Set(facilities.landUse.neighborhoods.map(nb => `${Math.floor(nb.poly[0][0])},${Math.floor(nb.poly[0][1])}`));
  const squares = new Set();
  for (const st of settlements) {
    const R = st.extentMi;
    for (let I = Math.floor(st.x - R); I <= Math.floor(st.x + R); I++) for (let J = Math.floor(st.y - R); J <= Math.floor(st.y + R); J++) squares.add(`${I},${J}`);
  }
  const lines = [];   // [x0, y0, x1, y1, depth]
  const blockedShare = (x0, y0, x1, y1) => {
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.02));
    let hit = 0;
    for (let i = 0; i <= steps; i++) if (inObstacle(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)) hit++;
    return hit / (steps + 1);
  };
  const townShare = (x0, y0, x1, y1) => {
    let urban = 0, any = 0;
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) { const c = coverAt(x0 + (x1 - x0) * i / 4, y0 + (y1 - y0) * j / 4); if (c === URBAN) urban++; if (c === URBAN || c === SUBURBAN) any++; }
    return { any: any / 25, urban: urban / 25 };
  };
  // Positions (offsets from lo) of the street lines across a span, spaced within [min, max], the
  // last gap no shorter than min; collectors (at a half-mile line inside the span) are kept clear.
  const spacing = (span, [min, max], rng, avoid = []) => {
    const out = [];
    let at = min + (max - min) * rng();
    while (span - at >= min) {
      if (!avoid.some(a => Math.abs(a - at) < min * 0.6)) out.push(at);
      at += min + (max - min) * rng();
    }
    return out;
  };
  // Moves a line (at offset c across [lo, hi]) by up to 0.03 mi to miss the planned lots.
  const nudge = (vertical, c, x0, y0, x1, y1) => {
    let best = null;
    for (const d of [0, 0.012, -0.012, 0.024, -0.024, 0.03, -0.03]) {
      const line = vertical ? [x0 + c + d, y0, x0 + c + d, y1] : [x0, y0 + c + d, x1, y0 + c + d];
      const share = blockedShare(...line);
      if (!best || share < best.share) best = { line, share, c: c + d };
      if (share === 0) break;
    }
    return best;
  };
  // Splits a piece until it fits the square's block shape (at most xMax east-west, yMax
  // north-south): across whichever way is still too long, on the square's line nearest an uneven
  // point (or at that point, if no line falls inside the piece).
  const subdivide = (x0, y0, x1, y1, xs, ys, xMax, yMax, depth, rng) => {
    const w = x1 - x0, h = y1 - y0;
    if (townShare(x0, y0, x1, y1).any === 0) return;
    const overX = w / xMax, overY = h / yMax;
    if (overX <= 1 && overY <= 1) return;
    const vertical = overX >= overY, lo = vertical ? x0 : y0, span = vertical ? w : h;
    const target = lo + span * (p.splitRatio[0] + (p.splitRatio[1] - p.splitRatio[0]) * rng());
    const list = (vertical ? xs : ys).filter(v => v > lo + 0.06 && v < lo + span - 0.06);
    const at = list.length ? list.reduce((q, r) => (Math.abs(r - target) < Math.abs(q - target) ? r : q)) : target;
    lines.push([...(vertical ? [at, y0, at, y1] : [x0, at, x1, at]), depth]);
    if (vertical) { subdivide(x0, y0, at, y1, xs, ys, xMax, yMax, depth + 1, rng); subdivide(at, y0, x1, y1, xs, ys, xMax, yMax, depth + 1, rng); }
    else { subdivide(x0, y0, x1, at, xs, ys, xMax, yMax, depth + 1, rng); subdivide(x0, at, x1, y1, xs, ys, xMax, yMax, depth + 1, rng); }
  };
  for (const sq of squares) {
    const [I, J] = sq.split(',').map(Number);
    const share = townShare(I, J, I + 1, J + 1);
    if (share.any === 0) continue;
    const rng = makeRandom(hashText(`${seed}|streets|${I},${J}`));
    const hood = hoodCells.has(sq), avoid = hood ? [0.5] : [];
    const urban = share.urban >= share.any / 2, sizes = urban ? p.blocks.urban : p.blocks.suburban;
    const longX = rng() < 0.5;   // suburban blocks run long east-west (else north-south)
    const xSpan = urban ? sizes.short : longX ? sizes.long : sizes.short, ySpan = urban ? sizes.short : longX ? sizes.short : sizes.long;
    // Street lines, each moved to miss lots along the whole square.
    const xs = spacing(1, xSpan, rng, avoid).map(c => nudge(true, c, I, J, I + 1, J + 1).c + I);
    const ys = spacing(1, ySpan, rng, avoid).map(c => nudge(false, c, I, J, I + 1, J + 1).c + J);
    if (urban) {
      for (const x of xs) lines.push([x, J, x, J + 1, 0]);
      for (const y of ys) lines.push([I, y, I + 1, y, 0]);
    } else {
      // Blocks up to the long size one way and the short size the other.
      const xMax = xSpan[1], yMax = ySpan[1];
      if (hood) for (const [qx, qy] of [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]]) subdivide(I + qx, J + qy, I + qx + 0.5, J + qy + 0.5, xs, ys, xMax, yMax, 1, rng);
      else subdivide(I, J, I + 1, J + 1, xs, ys, xMax, yMax, 0, rng);
    }
  }
  lines.sort((a, b) => a[4] - b[4]);
  for (const [x0, y0, x1, y1] of lines) insert(x0, y0, x1, y1, 'street', {}, streetBlocked, 0.02);
  stats.cuts = lines.length;

  // Tidying: nodes at the same spot are merged, and an edge running through a node is split at
  // it, so every meeting of roads is one shared node.
  {
    const live = g.nodes.filter(n => n.edges.length);
    const cellsOfNodes = new Map();
    for (const n of live) { const k = `${Math.round(n.x * 2000)},${Math.round(n.y * 2000)}`; if (!cellsOfNodes.has(k)) cellsOfNodes.set(k, []); cellsOfNodes.get(k).push(n); }
    for (const group of cellsOfNodes.values()) {
      const keep = group[0];
      for (const dup of group.slice(1)) {
        for (const e of [...dup.edges]) {
          const other = e.a === dup ? e.b : e.a, { a, b, kind, alive, id, ...extra } = e;
          void a; void b; void alive; void id;
          g.removeEdge(e);
          if (other !== keep && !keep.edges.some(f => (f.a === other || f.b === other) && f.kind === kind)) g.addEdge(keep, other, kind, extra);
        }
        keep.end = keep.end || dup.end;
        stats.merged = (stats.merged ?? 0) + 1;
      }
    }
    // A junction of lesser roads lying inside a highway's width (a corner the highway used to
    // turn at, before its curve) goes onto the highway, where all its roads may meet it.
    for (const n of g.nodes) {
      if (!n.edges.length || n.edges.some(e => HIGHWAYS.has(e.kind) || e.kind === 'street' || e.kind === 'frontage')) continue;
      for (const e of g.edgesNear(n.x - 0.06, n.y - 0.06, n.x + 0.06, n.y + 0.06)) {
        if (e.kind !== 'highway' && e.kind !== 'expressway') continue;
        const d = distToSeg(n.x, n.y, g.seg(e));
        if (d < 1e-6 || d >= HALF_MI[e.kind]) continue;
        const ex = e.b.x - e.a.x, ey = e.b.y - e.a.y, t = ((n.x - e.a.x) * ex + (n.y - e.a.y) * ey) / (ex * ex + ey * ey);
        if (!n.edges.every(f => rule(f.kind, e, n.x, n.y, 1) === 'node')) continue;
        // Not if a road would then cross another.
        const px = t <= 0 ? e.a.x : t >= 1 ? e.b.x : e.a.x + ex * t, py = t <= 0 ? e.a.y : t >= 1 ? e.b.y : e.a.y + ey * t;
        const wouldCross = n.edges.some(f => {
          const o = f.a === n ? f.b : f.a;
          for (const c of g.edgesNear(Math.min(o.x, px), Math.min(o.y, py), Math.max(o.x, px), Math.max(o.y, py))) {
            if (c === f || c === e || c.a === o || c.b === o || c.a === n || c.b === n) continue;
            const rx = px - o.x, ry = py - o.y, sx = c.b.x - c.a.x, sy = c.b.y - c.a.y, den = rx * sy - ry * sx;
            if (Math.abs(den) < 1e-12) continue;
            const tt = ((c.a.x - o.x) * sy - (c.a.y - o.y) * sx) / den, uu = ((c.a.x - o.x) * ry - (c.a.y - o.y) * rx) / den;
            if (tt > 1e-6 && tt < 1 - 1e-6 && uu > 1e-6 && uu < 1 - 1e-6) return true;
          }
          return false;
        });
        if (wouldCross) continue;
        if (t <= 0 || t >= 1) {
          // Nearest a point of the highway: the roads move onto that node.
          const target = t <= 0 ? e.a : e.b;
          for (const f of [...n.edges]) {
            const other = f.a === n ? f.b : f.a, { a, b, kind, alive, id, ...extra } = f;
            void a; void b; void alive; void id;
            g.removeEdge(f);
            if (other !== target) g.addEdge(target, other, kind, extra);
          }
        } else {
          n.x = e.a.x + ex * t; n.y = e.a.y + ey * t;
          g.split(e, n.x, n.y, n);
        }
        stats.ontoHighway = (stats.ontoHighway ?? 0) + 1;
        break;
      }
    }
    for (const n of g.nodes) {
      if (!n.edges.length) continue;
      for (const e of g.edgesNear(n.x - 1e-4, n.y - 1e-4, n.x + 1e-4, n.y + 1e-4)) {
        if (e.a === n || e.b === n || distToSeg(n.x, n.y, g.seg(e)) > 1e-4) continue;
        if (HIGHWAYS.has(e.kind) && !n.edges.some(f => HIGHWAYS.has(f.kind))) continue;   // passing over or under
        g.split(e, n.x, n.y, n);
        stats.throughSplit = (stats.throughSplit ?? 0) + 1;
      }
    }
  }

  // Dead ends just short of a highway (out of town, or where nothing took them) are cut back to
  // their last junction.
  {
    const nearHighwayEdge = node => {
      for (const e of g.edgesNear(node.x - p.stubNearMi - 0.06, node.y - p.stubNearMi - 0.06, node.x + p.stubNearMi + 0.06, node.y + p.stubNearMi + 0.06)) {
        if (HIGHWAYS.has(e.kind) && !node.edges.includes(e) && distToSeg(node.x, node.y, g.seg(e)) < HALF_MI[e.kind] + p.stubNearMi) return true;
      }
      return false;
    };
    const STUBS = new Set(['gravel', 'dirt', 'county', 'arterial', 'collector', 'frontage']);
    let cut = true;
    while (cut) {
      cut = false;
      for (const node of g.nodes) {
        if (node.pulled || node.edges.length !== 1 || !STUBS.has(node.edges[0].kind) || !nearHighwayEdge(node)) continue;
        // The chain back to the last junction.
        const chain = [];
        let at = node, e = node.edges[0], length = 0;
        while (e && length <= p.stubLongestMi) {
          chain.push(e); length += Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
          const next = e.a === at ? e.b : e.a;
          if (next.edges.length !== 2) break;
          at = next; e = next.edges.find(f => f !== e);
        }
        if (length > p.stubLongestMi) {
          // Too long to lose: its end is pulled back until the road is clear of the highway.
          const own = node.edges[0], o = own.a === node ? own.b : own.a, l = Math.hypot(node.x - o.x, node.y - o.y), ux = (node.x - o.x) / l, uy = (node.y - o.y) / l;
          const clearOf = () => ![...g.edgesNear(node.x - 0.2, node.y - 0.2, node.x + 0.2, node.y + 0.2)].some(e => HIGHWAYS.has(e.kind) && distToSeg(node.x, node.y, g.seg(e)) < HALF_MI[e.kind] + HALF_MI[own.kind] + (own.kind === 'gravel' || own.kind === 'dirt' ? p.gravelGapMi : p.clearMi));
          let left = l;
          while (!clearOf() && left > 0.05) { node.x -= ux * 0.005; node.y -= uy * 0.005; left -= 0.005; }
          node.pulled = true;
          continue;
        }
        for (const f of chain) g.removeEdge(f);
        stats.stubs = (stats.stubs ?? 0) + 1;
        cut = true;
      }
    }
  }

  // Street ends. Scraps (dead-end pieces shorter than pruneMi) go first. Then each end, in turn:
  // carried on to a road just ahead that it may meet, or joined to a street end facing it; or
  // else it ends in a cul-de-sac, which must fit clear of other roads, cul-de-sacs, lots and
  // rivers, the street pulled back until it does (and removed if too little is left).
  let pruned = true;
  while (pruned) {
    pruned = false;
    for (const e of g.edges) {
      if (!e.alive || e.kind !== 'street') continue;
      const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
      if ((e.a.edges.length === 1 || e.b.edges.length === 1) && len < p.pruneMi) { g.removeEdge(e); stats.pruned++; pruned = true; }
    }
  }
  const isEnd = node => node.edges.length === 1 && (node.edges[0].kind === 'street' || node.edges[0].kind === 'frontage');
  const outward = node => { const e = node.edges[0], o = e.a === node ? e.b : e.a, l = Math.hypot(node.x - o.x, node.y - o.y); return { e, o, ux: (node.x - o.x) / l, uy: (node.y - o.y) / l, len: l }; };
  const clearPath = (x0, y0, x1, y1, ux, uy) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.005));
    for (let i = 1; i < steps; i++) { const t = i / steps; if (streetBlocked(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, ux, uy)) return false; }
    return true;
  };
  const carryOn = node => {
    const { e: own, ux, uy } = outward(node);
    let best = null;
    // A road just ahead.
    for (const e of g.edgesNear(node.x - p.joinMi, node.y - p.joinMi, node.x + p.joinMi, node.y + p.joinMi)) {
      if (e === own || e.a === node || e.b === node) continue;
      const sx = e.b.x - e.a.x, sy = e.b.y - e.a.y, den = ux * sy - uy * sx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((e.a.x - node.x) * sy - (e.a.y - node.y) * sx) / den, u = ((e.a.x - node.x) * uy - (e.a.y - node.y) * ux) / den;
      if (t <= 1e-4 || t > p.extendMi || u < 0 || u > 1) continue;
      const x = node.x + ux * t, y = node.y + uy * t, sin = Math.abs(den) / Math.hypot(sx, sy);
      if (rule('street', e, x, y, sin) !== 'node' || sin < 0.5) continue;
      if (!best || t < best.t) best = { t, e, x, y };
    }
    // A street end facing this one.
    for (const e of g.edgesNear(node.x - p.joinMi, node.y - p.joinMi, node.x + p.joinMi, node.y + p.joinMi)) {
      for (const q of [e.a, e.b]) {
        if (q === node || !isEnd(q)) continue;
        const dx = q.x - node.x, dy = q.y - node.y, t = dx * ux + dy * uy, off = Math.abs(dx * uy - dy * ux);
        const qo = outward(q);
        if (t <= 0 || t > p.joinMi || off > 0.01 || qo.ux * ux + qo.uy * uy > -0.95) continue;
        if (!best || t < best.t) best = { t, node: q, x: q.x, y: q.y };
      }
    }
    if (!best || !clearPath(node.x, node.y, best.x, best.y, ux, uy)) return false;
    // Nor across another road on the way.
    for (const e of g.edgesNear(Math.min(node.x, best.x), Math.min(node.y, best.y), Math.max(node.x, best.x), Math.max(node.y, best.y))) {
      if (e === best.e || e.a === node || e.b === node || (best.node && (e.a === best.node || e.b === best.node))) continue;
      const rx = best.x - node.x, ry = best.y - node.y, sx = e.b.x - e.a.x, sy = e.b.y - e.a.y, den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((e.a.x - node.x) * sy - (e.a.y - node.y) * sx) / den, u = ((e.a.x - node.x) * ry - (e.a.y - node.y) * rx) / den;
      if (t > 1e-6 && t < 1 - 1e-6 && u > -1e-6 && u < 1 + 1e-6) return false;
    }
    const target = best.node ?? ([best.e.a, best.e.b].find(q => Math.hypot(q.x - best.x, q.y - best.y) < p.snapMi) ?? g.split(best.e, best.x, best.y));
    g.addEdge(node, target, 'street');
    return true;
  };
  const bulbs = [];
  const fits = node => {
    const r = p.bulbMi, own = node.edges[0];
    for (const e of g.edgesNear(node.x - r - 0.06, node.y - r - 0.06, node.x + r + 0.06, node.y + r + 0.06)) {
      if (e === own) continue;
      if (distToSeg(node.x, node.y, g.seg(e)) < r + HALF_MI[e.kind]) return false;
    }
    if (bulbs.some(b => Math.hypot(b.x - node.x, b.y - node.y) < 2 * r)) return false;
    for (let k = 0; k < 8; k++) if (inObstacle(node.x + r * Math.cos(k * Math.PI / 4), node.y + r * Math.sin(k * Math.PI / 4))) return false;
    if (inObstacle(node.x, node.y)) return false;
    for (const sg of riverCells.get(Math.floor(node.x / RCELL) * 4096 + Math.floor(node.y / RCELL)) ?? []) if (distToSeg(node.x, node.y, sg) < sg.half + p.bankMi + r) return false;
    return true;
  };
  const queue = g.nodes.filter(isEnd).sort((a, b) => a.id - b.id);
  const seen = new Set();
  while (queue.length) {
    const node = queue.shift();
    if (!isEnd(node) || seen.has(node)) continue;
    if (carryOn(node)) { stats.joined = (stats.joined ?? 0) + 1; continue; }
    let { e, o, ux, uy, len } = outward(node);
    while (!fits(node) && len > p.pruneMi) {
      node.x -= ux * p.pullStepMi; node.y -= uy * p.pullStepMi; len -= p.pullStepMi;
      stats.pulled = (stats.pulled ?? 0) + 1;
    }
    if (len <= p.pruneMi || !fits(node)) {
      g.removeEdge(e); stats.pruned++;
      if (isEnd(o)) { seen.delete(o); queue.push(o); }
      continue;
    }
    seen.add(node);
    bulbs.push({ x: node.x, y: node.y });
  }

  // Ends and controls.
  for (const node of g.nodes) {
    const list = node.edges;
    node.control = 0;
    if (list.length === 1) {
      const k = list[0].kind;
      node.end = k === 'street' || k === 'frontage' ? 1 : node.end || (k === 'gravel' || k === 'dirt' ? 2 : 0);
      if (node.end === 1) stats.culDeSacs++;
      continue;
    }
    if (list.length < 2) continue;
    node.end = 0;
    const kinds = list.map(e => e.kind);
    const dirs = list.map(e => { const o = e.a === node ? e.b : e.a, l = Math.hypot(o.x - node.x, o.y - node.y); return [(o.x - node.x) / l, (o.y - node.y) / l]; });
    if (list.length === 2 && kinds[0] === kinds[1] && dirs[0][0] * dirs[1][0] + dirs[0][1] * dirs[1][1] < -0.95) continue;   // straight on
    const count = k => kinds.filter(x => x === k).length;
    const highways = count('highway') + count('expressway');
    const kindsSet = new Set(kinds);
    if (kindsSet.size === 1 && list.length === 2) continue;   // a bend in one road
    if (count('ramp') && kindsSet.has('interstate')) continue;   // a ramp merging
    if (count('ramp') && kindsSet.size > 1) node.control = 2;
    else if (highways && [...kindsSet].some(k => !['street', 'gravel', 'dirt', 'highway', 'expressway'].includes(k))) node.control = 2;
    else if (highways && [...kindsSet].some(k => k === 'street' || k === 'gravel' || k === 'dirt')) node.control = 1;   // a side street or gravel road onto the highway
    else if (highways >= 3) node.control = 2;
    else if (town(node.x, node.y) && (count('arterial') >= 3 || (count('arterial') && count('collector')) || count('collector') >= 3)) node.control = 2;
    else if ([...kindsSet].some(k => k !== 'gravel' && k !== 'dirt')) node.control = 1;
  }
  return { graph: g, stats };
}

// The graph as flat arrays (for files and the Roblox export): node x, y (Float32), node control
// and end (Uint8 each), edge node pairs (Uint32), edge kinds (indices into ROAD_KINDS, Uint8) and
// the map road each edge belongs to (Int32, -1 for none).
export function packStreets({ graph }) {
  const ids = new Map(), nodes = [];
  for (const node of graph.nodes) if (node.edges.length) { ids.set(node, nodes.length); nodes.push(node); }
  const edges = graph.edges.filter(e => e.alive);
  const xy = new Float32Array(nodes.length * 2), control = new Uint8Array(nodes.length), end = new Uint8Array(nodes.length);
  nodes.forEach((node, i) => { xy[2 * i] = node.x; xy[2 * i + 1] = node.y; control[i] = node.control ?? 0; end[i] = node.end ?? 0; });
  const pairs = new Uint32Array(edges.length * 2), kinds = new Uint8Array(edges.length), road = new Int32Array(edges.length);
  edges.forEach((e, i) => { pairs[2 * i] = ids.get(e.a); pairs[2 * i + 1] = ids.get(e.b); kinds[i] = ROAD_KINDS.indexOf(e.kind); road[i] = e.road ?? -1; });
  return { xy, control, end, pairs, kinds, road };
}

// Counts by kind and control, for reports.
export function describeStreets(packed) {
  const byKind = {}, miles = {};
  for (let i = 0; i < packed.kinds.length; i++) {
    const k = ROAD_KINDS[packed.kinds[i]], a = packed.pairs[2 * i], b = packed.pairs[2 * i + 1];
    byKind[k] = (byKind[k] ?? 0) + 1;
    miles[k] = (miles[k] ?? 0) + Math.hypot(packed.xy[2 * b] - packed.xy[2 * a], packed.xy[2 * b + 1] - packed.xy[2 * a + 1]);
  }
  const controls = {}, ends = {};
  for (const c of packed.control) controls[CONTROLS[c]] = (controls[CONTROLS[c]] ?? 0) + 1;
  for (const e of packed.end) ends[ENDS[e]] = (ends[ENDS[e]] ?? 0) + 1;
  return { nodes: packed.control.length, edges: packed.kinds.length, byKind, miles: Object.fromEntries(Object.entries(miles).map(([k, v]) => [k, Math.round(v)])), controls, ends };
}

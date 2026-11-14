// Exports the world map for a seed to the Roblox place (roblox/Server/WorldData, synced by Rojo to
// ServerStorage.WorldData), which builds its terrain chunk by chunk from it.
//   node scripts/export-world-roblox.mjs [--seed 1] [key=value ...]
//
// Meta.luau: scale (studsPerMile, js/worldmap/scale.js: must equal Roblox's Config.STUDS_PER_MILE),
// cover and region keys, lakes, settlements, start points, and
//   graph   { tileMiles = 25, tiles = 20, unit = 0.5 (studs a step), kinds (the road kinds, in the
//           order of their numbers), parts (how many Graph modules each graph tile has, row by
//           row: tile ti, tj is at tj * tiles + ti, counted from 0) }.
// Tiles/T<i>_<j>.luau, one per 50 x 50 miles (i east, j south): returns
//   data    base64 of the zstd-compressed: elevation u16 LE (decimetres above baseM), cover u8, cover region u8,
//           lake id u8, each (100 + 2 * border)^2 cells of 0.5 mi with a border of cells from the
//           neighbouring tiles (clamped at the map's edge), row by row from the north-west; then
//           the section-road corners u8, 51 x 51 (see js/worldmap/sectionRoads.js).
//   rivers  flat list, 8 numbers per segment: x0, y0, x1, y1 (miles from the NW corner),
//           width0, width1 (m, as drawn on the map), level0, level1 (water surface, m).
//           (Roads are not in the tiles: Roblox lays them from the road graph, below.)
//   crossings  flat list, 11 numbers per interstate crossing (js/worldmap/crossings.js): type
//           (1 interchange, 2 overpass), crossing road (1 interstate, 2 expressway, 3 highway,
//           4 paved, 5 gravel), x, y, the interstate's direction ux, uy, the crossing road's vx,
//           vy, exit number, uEnd, vEnd (where a road ends at the crossing).
//   sites   what stands on the land (js/worldmap/landUse.js, facilities.js, airfields.js), each
//           with an id (unique over the map) and polygons as flat lists of map miles:
//             areas      land use in the places: { id, k = downtown | mall | shopping | corridor |
//                        travel | industrial | park, t = tier, town, p = polygon };
//             gas        { id, s = size, x, y (lot centre), fx, fy (towards the road), w, d (lot
//                        miles along and back from the road) };
//             schools    { id, l = level, n = name, x, y, fx, fy, w, d };
//             campuses   { id, t = tier, n = name, p = area, q = quad, b = buildings, pk = parking,
//                        st = stadium, f = fields };
//             airfields  { id, k = kind, code, n = name, e = field elevation (m), fence, runways
//                        { { a = ends x0, y0, x1, y1, w = width (ft) } }, taxiways (lines), aprons,
//                        b { { k = kind, p } }, pk = parking, radar { x, y, p = compound } (absent
//                        when shared), nws { b = building, pk = parking } };
//             turbines   flat x, y; substations polygons; windmills flat x, y; wells flat x, y,
//                        type (0 oil, 1 gas); tanks flat x, y.
// Segments and sites are listed in every tile they come within a mile of.
// Graph/G<ti>_<tj>_<k>.luau: the road graph (js/worldmap/streets.js) and the street blocks
// (js/worldmap/blocks.js), in graph tiles of 25 x 25 miles (ti east, tj south), each in parts
// k = 1, 2, ... so a module's source stays under 150,000 characters (every tile has part 1; a
// tile's records are those of all its parts together). Returns
//   edges   base64 of the zstd-compressed edge records ("" when there are none), 11 bytes each:
//           kind u8 (from 0, into Meta's graph.kinds), flags of the node at end a u8, at end b u8,
//           ax, az, bx, bz i16 LE. Flags: the node's end (bits 0-1: 0 none, 1 cul-de-sac, 2 dead
//           end, 3 barrier), its control (bits 2-3: 0 none, 1 stop, 2 signal) and how many roads
//           meet there (bits 4-7, at most 15). Edges longer than 1200 studs are cut into equal
//           pieces no longer than that (the points between: flags 0x20).
//   blocks  base64 of the zstd-compressed block records ("" when none), 12 bytes each: x0, z0,
//           x1, z1 i16 LE (north-west and south-east corners), then the roads along the north,
//           south, west and east sides u8 (0 none, else the kind's number + 1).
// Coordinates are steps of 0.5 stud from the graph tile's centre: studs = (miles from the NW
// corner - miles / 2) * studsPerMile, east and south; the tile's centre is at
// ((ti + 0.5) * 25 - miles / 2) * studsPerMile. Points are rounded to the step over the whole map,
// so the tiles agree. An edge or block is in every graph tile its box touches.
//
// Also roblox/Shared/MapData/MapVector.luau (replicated, for the players' map; see below).
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { zstdCompressSync } from 'node:zlib';
import path from 'node:path';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';
import { generateWorldMap, REGIONS, COVER } from '../js/worldmap/WorldMapGenerator.js';
import { STUDS_PER_MILE } from '../js/worldmap/scale.js';
import { ROAD_KINDS } from '../js/worldmap/streets.js';
import { planBlocks } from '../js/worldmap/blocks.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const seed = Number(flag('--seed') ?? 1);
const overrides = Object.fromEntries(args.filter(a => a.includes('=')).map(a => { const [k, v] = a.split('='); return [k, Number(v)]; }));
const out = path.join('roblox', 'Server', 'WorldData');

const TILE_MI = 50, BORDER = 2, BASE_M = 150;
const map = generateWorldMap({ seed, ...overrides });
const n = map.size, per = Math.round(1 / map.cellMiles), tileCells = TILE_MI * per, tiles = Math.round(n / tileCells), S = tileCells + 2 * BORDER;
const secSize = map.sections.size, CORNERS = TILE_MI + 1;
const clampCell = v => Math.min(n - 1, Math.max(0, v));
const r = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

// Files are rewritten in place (not deleted first): Rojo's live sync can lose instances when a
// synced folder is removed and recreated under it.
mkdirSync(path.join(out, 'Tiles'), { recursive: true });

// Water level along each river: the ground at each point (rivers run down the map's drainage, so
// it never rises downstream).
const levelAt = (x, y) => map.elevation[clampCell(Math.floor(y / map.cellMiles)) * n + clampCell(Math.floor(x / map.cellMiles))];
const riverSegments = [];
for (const river of map.rivers) {
  let last = Infinity;
  const levels = [];
  for (let s = 0; s < river.points.length; s += 2) { last = Math.min(last, levelAt(river.points[s], river.points[s + 1])); levels.push(last); }
  for (let s = 2; s < river.points.length; s += 2) {
    riverSegments.push([river.points[s - 2], river.points[s - 1], river.points[s], river.points[s + 1], river.widthsM[s / 2 - 1], river.widthsM[s / 2], levels[s / 2 - 1], levels[s / 2]]);
  }
}
const CROSS_TYPE = { interchange: 1, overpass: 2 };
const CROSS_ROAD = { interstate: 1, expressway: 2, us: 3, state: 3, highway: 3, paved: 4, gravel: 5 };
const fac = map.facilities;

// Sites, each with its box (miles) for sharing out to the tiles.
const flat = poly => poly.flatMap(([x, y]) => [r(x, 4), r(y, 4)]);
const boxOf = pts => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [x0, y0, x1, y1]; };
// A lot laid out along a road (facilities.js frontage: the corners on the road side first): its
// centre, the way to the road, and its size along and back from the road.
const lotFrame = lot => {
  const [c0, c1, c2] = lot, cx = lot.reduce((a, q) => a + q[0], 0) / lot.length, cy = lot.reduce((a, q) => a + q[1], 0) / lot.length;
  const fx = (c0[0] + c1[0]) / 2 - cx, fy = (c0[1] + c1[1]) / 2 - cy, l = Math.hypot(fx, fy) || 1;
  return { x: r(cx, 4), y: r(cy, 4), fx: r(fx / l, 4), fy: r(fy / l, 4), w: r(Math.hypot(c1[0] - c0[0], c1[1] - c0[1]), 4), d: r(Math.hypot(c2[0] - c1[0], c2[1] - c1[1]), 4) };
};
const POINT_SITES = new Set(['turbines', 'windmills', 'wells', 'tanks']);
const sites = { areas: [], gas: [], schools: [], campuses: [], airfields: [], turbines: [], substations: [], windmills: [], wells: [], tanks: [] };
let siteId = 0;
const site = (list, box, value) => sites[list].push({ box, value: POINT_SITES.has(list) || Array.isArray(value) ? value : { id: ++siteId, ...value } });
for (const z of fac.landUse.areas) site('areas', boxOf(z.poly), { k: z.kind, ...(z.tier ? { t: z.tier } : {}), town: z.town, p: flat(z.poly) });
for (const g of fac.gasStations) site('gas', boxOf(g.lot), { s: g.size, ...lotFrame(g.lot) });
for (const s of fac.schools) site('schools', boxOf(s.lot), { l: s.level, n: s.name, ...lotFrame(s.lot) });
for (const c of fac.campuses) site('campuses', boxOf(c.area), { t: c.tier, n: c.name, p: flat(c.area), q: flat(c.quad), b: c.buildings.map(flat), pk: c.parking.map(flat), ...(c.stadium ? { st: flat(c.stadium) } : {}), f: c.fields.map(flat) });
for (const a of map.airfields) {
  const radar = a.sharedRadar ? null : a.radar;
  site('airfields', boxOf([...a.fence, ...(radar ? radar.compound : []), ...(a.nws ? a.nws.building : [])]), {
    k: a.kind, code: a.code, n: a.name, e: r(a.elevationM, 1), fence: flat(a.fence),
    runways: a.runways.map(w => ({ a: flat(w.ends), w: w.widthFt })), taxiways: a.taxiways.map(flat), aprons: a.aprons.map(flat),
    b: a.buildings.map(b => ({ k: b.kind, p: flat(b.poly) })), pk: a.parking.map(q => flat(q.poly)),
    ...(radar ? { radar: { x: r(radar.x, 4), y: r(radar.y, 4), p: flat(radar.compound) } } : {}),
    ...(a.nws ? { nws: { b: flat(a.nws.building), pk: flat(a.nws.parking) } } : {})
  });
}
const energy = fac.energy;
for (const farm of energy.windFarms) {
  for (const [x, y] of farm.turbines) site('turbines', [x, y, x, y], [x, y]);
  site('substations', boxOf(farm.substation), flat(farm.substation));
}
for (const w of energy.windmills) site('windmills', [w[0], w[1], w[0], w[1]], [w[0], w[1]]);
for (const w of energy.wells) site('wells', [w[0], w[1], w[0], w[1]], [w[0], w[1], w[2]]);
for (const t of energy.tanks) site('tanks', [t[0], t[1], t[0], t[1]], [t[0], t[1]]);

// A value as a Luau literal.
function lua(v) {
  return Array.isArray(v) ? `{ ${v.map(lua).join(', ')} }` : typeof v === 'object' && v !== null ? `{ ${Object.entries(v).map(([k, x]) => `${/^[A-Za-z_]\w*$/.test(k) ? k : `["${k}"]`} = ${lua(x)}`).join(', ')} }` : typeof v === 'string' ? JSON.stringify(v) : String(v);
}

let bytes = 0;
for (let tj = 0; tj < tiles; tj++) for (let ti = 0; ti < tiles; ti++) {
  const buf = Buffer.alloc(S * S * 5 + CORNERS * CORNERS);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const gi = clampCell(ti * tileCells + i - BORDER), gj = clampCell(tj * tileCells + j - BORDER), k = gj * n + gi, o = j * S + i;
    buf.writeUInt16LE(Math.max(0, Math.min(65535, Math.round((map.elevation[k] - BASE_M) * 10))), o * 2);
    buf[S * S * 2 + o] = map.cover[k];
    buf[S * S * 3 + o] = map.coverRegion[k];
    buf[S * S * 4 + o] = map.lake[k];
  }
  for (let b = 0; b < CORNERS; b++) for (let a = 0; a < CORNERS; a++) {
    const I = Math.min(secSize - 1, ti * TILE_MI + a), J = Math.min(secSize - 1, tj * TILE_MI + b);
    buf[S * S * 5 + b * CORNERS + a] = map.sections.roads[J * secSize + I];
  }
  const x0 = ti * TILE_MI - 1, x1 = (ti + 1) * TILE_MI + 1, y0 = tj * TILE_MI - 1, y1 = (tj + 1) * TILE_MI + 1;
  const near = (ax, ay, bx, by) => Math.max(ax, bx) >= x0 && Math.min(ax, bx) <= x1 && Math.max(ay, by) >= y0 && Math.min(ay, by) <= y1;
  const rivers = riverSegments.filter(s => near(s[0], s[1], s[2], s[3])).flatMap(s => [r(s[0]), r(s[1]), r(s[2]), r(s[3]), Math.round(s[4]), Math.round(s[5]), r(s[6], 1), r(s[7], 1)]);
  const crossings = map.crossings.filter(c => c.x >= x0 - 0.5 && c.x <= x1 + 0.5 && c.y >= y0 - 0.5 && c.y <= y1 + 0.5)
    .flatMap(c => [CROSS_TYPE[c.type], CROSS_ROAD[c.kind], r(c.x, 4), r(c.y, 4), r(c.ux, 5), r(c.uy, 5), r(c.vx, 5), r(c.vy, 5), c.exit, c.uEnd, c.vEnd]);
  const boxNear = b => b[2] >= x0 && b[0] <= x1 && b[3] >= y0 && b[1] <= y1;
  const tileSites = Object.entries(sites).map(([key, list]) => {
    const here = list.filter(s => boxNear(s.box)).map(s => s.value);
    return `${key} = ${POINT_SITES.has(key) ? `{ ${here.flat().join(', ')} }` : lua(here)}`;
  });
  const text = `-- Generated by scripts/export-world-roblox.mjs (seed ${seed}); do not edit.\nreturn {\n\tdata = "${zstdCompressSync(buf).toString('base64')}",\n\trivers = { ${rivers.join(', ')} },\n\tcrossings = { ${crossings.join(', ')} },\n\tsites = {\n\t\t${tileSites.join(',\n\t\t')},\n\t},\n}\n`;
  writeFileSync(path.join(out, 'Tiles', `T${ti}_${tj}.luau`), text);
  bytes += text.length;
}

// The players' map (MapData/MapVector.luau): the land as cover and hill-shade rasters at the
// map's own resolution (zstd, base64), the paved and gravel section roads (zstd, base64), and the
// rivers, main roads, lakes and every settlement as lines and points, so the client can draw any
// part of the map sharply at any zoom.
{
  const cells = n * n, land = Buffer.alloc(cells * 2), cellM = map.cellMiles * 1609.344;
  // The map shades the hills as steep as the game draws them: a mile is squeezed into STUDS_PER_MILE studs, a stud of height is 0.28 m.
  const HILL_EXAGGERATION = 1609.344 / STUDS_PER_MILE / 0.28;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, at = (a, b) => map.elevation[Math.min(n - 1, Math.max(0, b)) * n + Math.min(n - 1, Math.max(0, a))];
    const dx = (at(i + 1, j) - at(i - 1, j)) * HILL_EXAGGERATION / (2 * cellM), dy = (at(i, j + 1) - at(i, j - 1)) * HILL_EXAGGERATION / (2 * cellM);
    const shade = Math.max(0, (0.6 * dx + 0.6 * dy + 0.53) / Math.hypot(dx, dy, 1)) / 0.53;
    land[k] = map.cover[k];
    land[cells + k] = Math.round(200 * (0.55 + 0.45 * Math.min(1.4, shade)));
  }
  const pack = buf => zstdCompressSync(buf).toString('base64');
  // Names for the larger rivers (each traced stretch), the biggest first.
  const rivers = [...map.rivers].sort((a, b) => b.mouthDrainageMi2 - a.mouthDrainageMi2);
  const riverLines = rivers.map(rv => {
    const width = Math.round(Math.max(...rv.widthsM));
    const name = rv.name ?? '';
    return `{ name = ${JSON.stringify(name)}, width = ${width}, points = { ${simplify(rv.points, 0.12).join(', ')} } }`;
  });
  const roadLines = map.roads.map(rd => `{ kind = "${rd.kind}", name = ${JSON.stringify(rd.name.replace(/ .*–.*/, '').replace(/ bypass$/, ''))}, points = { ${rd.points.flatMap(([x, y]) => [r(x, 2), r(y, 2)]).join(', ')} } }`);
  const towns = map.settlements.map(st => `{ name = ${JSON.stringify(st.name)}, kind = "${st.kind}", x = ${r(st.x)}, y = ${r(st.y)}, population = ${st.population} }`);
  const lakes = map.lakes.map(l => `{ x = ${r(l.damX)}, y = ${r(l.damY)}, areaMi2 = ${Math.round(l.areaMi2)} }`);
  const dir = path.join('roblox', 'Shared', 'MapData');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'MapVector.luau'), `-- Generated by scripts/export-world-roblox.mjs (seed ${seed}); do not edit.
return {
\tmiles = ${map.params.miles},
\tcells = ${n},
\tcover = { ${COVER.map(c => JSON.stringify(c)).join(', ')} },
\tland = "${pack(land)}",
\tsectionSize = ${map.sections.size},
\tsections = "${pack(Buffer.from(graphSections()))}",
\trivers = { ${riverLines.join(',\n\t\t')} },
\troads = { ${roadLines.join(',\n\t\t')} },
\tsettlements = { ${towns.join(',\n\t\t')} },
\tlakes = { ${lakes.join(', ')} },
\tcrossings = { ${map.crossings.map(c => `{ type = "${c.type}", interstate = "${c.interstate}", x = ${r(c.x, 4)}, y = ${r(c.y, 4)}, ux = ${r(c.ux, 5)}, uy = ${r(c.uy, 5)}, vx = ${r(c.vx, 5)}, vy = ${r(c.vy, 5)}, exit = ${c.exit}, uEnd = ${c.uEnd}, vEnd = ${c.vEnd} }`).join(',\n\t\t')} },
}
`);
}

// The road graph and the street blocks (Graph/G<ti>_<tj>_<k>.luau; see the top of the file).
// (kinds: the graph's road kinds, then "avenue": a street the graph marks wide, in a town or city centre.)
const GRAPH_KINDS = [...ROAD_KINDS, 'avenue'], kindOfEdge = e => (e.kind === 'street' && e.wide ? 'avenue' : e.kind);
const graphMeta = { tileMiles: 25, tiles: Math.round(map.params.miles / 25), unit: 0.5, kinds: GRAPH_KINDS, parts: [] };
const graphTotals = { edges: 0, blocks: 0, modules: 0, largest: 0, bytes: 0 };
{
  const GT = graphMeta.tiles, UNIT = graphMeta.unit, MAX_STUDS = 1200, MAX_SOURCE = 150000, EDGE = 11, BLOCK = 12;
  const half = map.params.miles / 2;
  const q = mi => Math.round((mi - half) * STUDS_PER_MILE / UNIT);   // map miles to steps from the map's centre
  const tileSteps = graphMeta.tileMiles * STUDS_PER_MILE / UNIT, west = -half * STUDS_PER_MILE / UNIT;   // a tile's side; the map's west (and north) edge
  const centre = t => Math.round(((t + 0.5) * graphMeta.tileMiles - half) * STUDS_PER_MILE / UNIT);
  const tileEdges = Array.from({ length: GT * GT }, () => []), tileBlocks = Array.from({ length: GT * GT }, () => []);
  // Into every tile whose box the box x0..x1, z0..z1 (steps) touches.
  const share = (lists, item, x0, z0, x1, z1) => {
    const lo = v => Math.max(0, Math.ceil((v - west) / tileSteps) - 1), hi = v => Math.min(GT - 1, Math.floor((v - west) / tileSteps));
    for (let tj = lo(z0); tj <= hi(z1); tj++) for (let ti = lo(x0); ti <= hi(x1); ti++) lists[tj * GT + ti].push(item);
  };
  const i16 = v => { if (v < -32768 || v > 32767) throw new Error(`graph export: ${v} does not fit an int16`); return v; };
  const flags = node => (node.end ?? 0) | ((node.control ?? 0) << 2) | (Math.min(node.edges.length, 15) << 4);
  for (const e of map.streets.graph.edges) {
    if (!e.alive) continue;
    const kind = GRAPH_KINDS.indexOf(kindOfEdge(e)), ax = q(e.a.x), az = q(e.a.y), bx = q(e.b.x), bz = q(e.b.y);
    if (kind < 0) throw new Error(`graph export: unknown road kind ${e.kind}`);
    // Equal pieces, a stud under the limit so that rounding the points between cannot take a piece over it.
    const studs = Math.hypot(bx - ax, bz - az) * UNIT, pieces = studs > MAX_STUDS ? Math.ceil(studs / (MAX_STUDS - 1)) : 1;
    let px = ax, pz = az, pf = flags(e.a);
    for (let s = 1; s <= pieces; s++) {
      const last = s === pieces, x = last ? bx : Math.round(ax + (bx - ax) * s / pieces), z = last ? bz : Math.round(az + (bz - az) * s / pieces), f = last ? flags(e.b) : 2 << 4;
      if (x !== px || z !== pz) { share(tileEdges, [kind, pf, f, px, pz, x, z], Math.min(px, x), Math.min(pz, z), Math.max(px, x), Math.max(pz, z)); graphTotals.edges++; }
      px = x; pz = z; pf = f;
    }
  }
  for (const b of planBlocks(map)) {
    const x0 = q(b.x0), z0 = q(b.y0), x1 = q(b.x1), z1 = q(b.y1);
    if (x0 >= x1 || z0 >= z1) continue;
    share(tileBlocks, [x0, z0, x1, z1, ...b.sides.map(k => (k === null ? 0 : GRAPH_KINDS.indexOf(k) + 1))], x0, z0, x1, z1);
    graphTotals.blocks++;
  }
  const pack = buf => (buf.length ? zstdCompressSync(buf).toString('base64') : '');
  // The most whole records from the front of buf whose packed text fits in room characters.
  const fit = (buf, size, room) => {
    let count = buf.length / size, text = pack(buf);
    while (count > 0 && text.length > room) { count = Math.max(0, Math.min(count - 1, Math.floor(count * 0.98 * room / text.length))); text = pack(buf.subarray(0, count * size)); }
    return { count, text };
  };
  const dir = path.join(out, 'Graph'), written = new Set();
  mkdirSync(dir, { recursive: true });
  for (let tj = 0; tj < GT; tj++) for (let ti = 0; ti < GT; ti++) {
    const cx = centre(ti), cz = centre(tj), edges = tileEdges[tj * GT + ti], blocks = tileBlocks[tj * GT + ti];
    // In a fixed order (kind, then place), which also packs well.
    edges.sort((a, b) => a[0] - b[0] || a[3] - b[3] || a[4] - b[4] || a[5] - b[5] || a[6] - b[6]);
    blocks.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let eb = Buffer.alloc(edges.length * EDGE), bb = Buffer.alloc(blocks.length * BLOCK);
    edges.forEach((e, i) => { const o = i * EDGE; eb[o] = e[0]; eb[o + 1] = e[1]; eb[o + 2] = e[2]; eb.writeInt16LE(i16(e[3] - cx), o + 3); eb.writeInt16LE(i16(e[4] - cz), o + 5); eb.writeInt16LE(i16(e[5] - cx), o + 7); eb.writeInt16LE(i16(e[6] - cz), o + 9); });
    blocks.forEach((b, i) => { const o = i * BLOCK; bb.writeInt16LE(i16(b[0] - cx), o); bb.writeInt16LE(i16(b[1] - cz), o + 2); bb.writeInt16LE(i16(b[2] - cx), o + 4); bb.writeInt16LE(i16(b[3] - cz), o + 6); for (let s = 0; s < 4; s++) bb[o + 8 + s] = b[4 + s]; });
    // Parts: the blocks first, then as many edges as the module has room left for.
    const head = `-- Generated by scripts/export-world-roblox.mjs (seed ${seed}); do not edit.\nreturn { edges = "`, mid = '", blocks = "', tail = '" }\n';
    const room = MAX_SOURCE - 1 - head.length - mid.length - tail.length;
    let part = 0;
    do {
      part++;
      const b = fit(bb, BLOCK, room), e = fit(eb, EDGE, room - b.text.length);
      if (b.count + e.count === 0 && bb.length + eb.length > 0) throw new Error('graph export: a record does not fit a module');
      const text = head + e.text + mid + b.text + tail, name = `G${ti}_${tj}_${part}.luau`;
      writeFileSync(path.join(dir, name), text);
      written.add(name); graphTotals.modules++; graphTotals.bytes += text.length; graphTotals.largest = Math.max(graphTotals.largest, text.length);
      bb = bb.subarray(b.count * BLOCK); eb = eb.subarray(e.count * EDGE);
    } while (bb.length + eb.length > 0);
    graphMeta.parts.push(part);
  }
  // Graph modules of an earlier run that this one did not write.
  for (const name of readdirSync(dir)) if (/^G.*\.luau$/.test(name) && !written.has(name)) unlinkSync(path.join(dir, name));
}

const city = map.settlements.find(s => s.kind === 'city') ?? map.settlements[0];
const meta = {
  // studsPerMile: the Roblox scale the map was made for (WorldMap.luau warns if Config.STUDS_PER_MILE differs)
  seed, studsPerMile: STUDS_PER_MILE, miles: map.params.miles, cellMiles: map.cellMiles, tileMiles: TILE_MI, tiles, border: BORDER, tileCells: S, corners: CORNERS, baseM: BASE_M,
  cover: COVER, regions: REGIONS.map(x => x.key), sectionClasses: ['none', 'dirt', 'gravel', 'paved'],
  lakes: map.lakes.map(l => ({ id: l.id, surfaceM: r(l.surfaceM, 1), x: r(l.damX), y: r(l.damY) })),
  settlements: map.settlements.map(s => ({ name: s.name, kind: s.kind, x: s.x, y: s.y, population: s.population, coreMi: r(s.coreMi), extentMi: r(s.extentMi), streetBlockMi: r(s.streetBlockMi, 4) })),
  // Edge of the mid-size city's suburbs, looking in.
  start: { x: r(city.x + city.extentMi + 1), y: r(city.y), name: city.name },
  graph: graphMeta
};
writeFileSync(path.join(out, 'Meta.luau'), `-- Generated by scripts/export-world-roblox.mjs (seed ${seed}); do not edit.\nreturn ${lua(meta)}\n`);
console.log(`seed ${seed}: ${tiles * tiles} tiles (${(bytes / 1e6).toFixed(1)} MB) and Meta.luau -> ${out}; start at ${meta.start.name} (${meta.start.x}, ${meta.start.y} mi); graph: ${graphTotals.edges} edges, ${graphTotals.blocks} blocks in ${graphTotals.modules} modules (largest ${graphTotals.largest} characters, ${(graphTotals.bytes / 1e6).toFixed(1)} MB)`);

// A river's flat point list (x0, y0, x1, y1, ...) with the points that lie within tolerance
// (miles) of the line through their neighbours dropped (Douglas–Peucker), rounded to 0.01 mi.
function simplify(flatPoints, tolerance) {
  const points = [];
  for (let i = 0; i < flatPoints.length; i += 2) points.push([flatPoints[i], flatPoints[i + 1]]);
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = points.length > 2 ? [[0, points.length - 1]] : [];
  while (stack.length) {
    const [a, b] = stack.pop(), [ax, ay] = points[a], [bx, by] = points[b], len = Math.hypot(bx - ax, by - ay) || 1;
    let worst = 0, at = -1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((bx - ax) * (ay - points[i][1]) - (ax - points[i][0]) * (by - ay)) / len; if (d > worst) { worst = d; at = i; } }
    if (worst > tolerance) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return points.filter((_, i) => keep[i]).flatMap(([x, y]) => [r(x, 2), r(y, 2)]);
}

// The section-line roads as the road graph has them, for the players' map: the grid of
// sectionRoads.js (per corner, the class of the mile east of it in bits 0-1 and of the mile south
// in bits 2-3: 1 dirt, 2 gravel, 3 paved), filled from the graph's edges along the mile lines, so
// the map shows the miles the road rules left and the game lays (a mile cut at an expressway, an
// airfield or a ramp is not drawn; highways along a line are drawn as highways).
function graphSections() {
  const size = map.sections.size, grid = new Uint8Array(size * size), CLASS = { dirt: 1, gravel: 2, county: 3, arterial: 3 }, ON = 0.002;
  for (const e of map.streets.graph.edges) {
    const cls = e.alive ? CLASS[e.kind] : 0;
    if (!cls) continue;
    const vertical = Math.abs(e.a.x - e.b.x) < ON, level = Math.abs(e.a.y - e.b.y) < ON;
    if (vertical === level) continue;
    const line = Math.round(vertical ? e.a.x : e.a.y);
    if (Math.abs((vertical ? e.a.x : e.a.y) - line) > ON || line < 0 || line >= size) continue;
    // Each mile of the line the edge covers the middle of.
    const lo = Math.min(vertical ? e.a.y : e.a.x, vertical ? e.b.y : e.b.x), hi = Math.max(vertical ? e.a.y : e.a.x, vertical ? e.b.y : e.b.x);
    for (let m = Math.max(0, Math.floor(lo)); m < Math.min(size, Math.ceil(hi)); m++) {
      if (lo > m + 0.5 || hi < m + 0.5) continue;
      const k = vertical ? m * size + line : line * size + m, shift = vertical ? 2 : 0;
      if (((grid[k] >> shift) & 3) < cls) grid[k] = (grid[k] & ~(3 << shift)) | (cls << shift);
    }
  }
  return grid;
}

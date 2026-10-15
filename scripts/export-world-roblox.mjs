// Exports the world map for a seed to the Roblox place (roblox/src/worlddata, synced by Rojo to
// ServerStorage.WorldData), which builds its terrain chunk by chunk from it.
//   node scripts/export-world-roblox.mjs [--seed 1] [key=value ...]
//
// Meta.luau: scale, cover and region keys, lakes, settlements, start points.
// Tiles/T<i>_<j>.luau, one per 50 x 50 miles (i east, j south): returns
//   data    base64 of: elevation u16 LE (decimetres above baseM), cover u8, cover region u8,
//           lake id u8, each (100 + 2 * border)^2 cells of 0.5 mi with a border of cells from the
//           neighbouring tiles (clamped at the map's edge), row by row from the north-west; then
//           the section-road corners u8, 51 x 51 (see js/worldmap/sectionRoads.js).
//   rivers  flat list, 8 numbers per segment: x0, y0, x1, y1 (miles from the NW corner),
//           width0, width1 (m, as drawn on the map), level0, level1 (water surface, m).
//   roads   flat list, 5 numbers per segment: kind (1 interstate, 2 expressway, 3 highway),
//           x0, y0, x1, y1.
//   crossings  flat list, 11 numbers per interstate crossing (js/worldmap/crossings.js): type
//           (1 interchange, 2 overpass), crossing road (1 interstate, 2 expressway, 3 highway,
//           4 paved, 5 gravel), x, y, the interstate's direction ux, uy, the crossing road's vx,
//           vy, exit number, uEnd, vEnd (where a road ends at the crossing).
// Segments are listed in every tile they come within a mile of.
//
// Also roblox/src/shared/MapData/MapVector.luau (replicated, for the players' map; see below).
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { zstdCompressSync } from 'node:zlib';
import path from 'node:path';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';
import { generateWorldMap, REGIONS, COVER } from '../js/worldmap/WorldMapGenerator.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const seed = Number(flag('--seed') ?? 1);
const overrides = Object.fromEntries(args.filter(a => a.includes('=')).map(a => { const [k, v] = a.split('='); return [k, Number(v)]; }));
const out = path.join('roblox', 'src', 'worlddata');

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
const KIND = { interstate: 1, expressway: 2, highway: 3 };
const CROSS_TYPE = { interchange: 1, overpass: 2 };
const CROSS_ROAD = { interstate: 1, expressway: 2, us: 3, state: 3, highway: 3, paved: 4, gravel: 5 };
const roadSegments = [];
for (const road of map.roads) for (let i = 1; i < road.points.length; i++) roadSegments.push([KIND[road.kind], ...road.points[i - 1], ...road.points[i]]);

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
  const roads = roadSegments.filter(s => near(s[1], s[2], s[3], s[4])).flatMap(s => [s[0], r(s[1]), r(s[2]), r(s[3]), r(s[4])]);
  const crossings = map.crossings.filter(c => c.x >= x0 - 0.5 && c.x <= x1 + 0.5 && c.y >= y0 - 0.5 && c.y <= y1 + 0.5)
    .flatMap(c => [CROSS_TYPE[c.type], CROSS_ROAD[c.kind], r(c.x, 4), r(c.y, 4), r(c.ux, 5), r(c.uy, 5), r(c.vx, 5), r(c.vy, 5), c.exit, c.uEnd, c.vEnd]);
  const text = `-- Generated by scripts/export-world-roblox.mjs (seed ${seed}); do not edit.\nreturn {\n\tdata = "${buf.toString('base64')}",\n\trivers = { ${rivers.join(', ')} },\n\troads = { ${roads.join(', ')} },\n\tcrossings = { ${crossings.join(', ')} },\n}\n`;
  writeFileSync(path.join(out, 'Tiles', `T${ti}_${tj}.luau`), text);
  bytes += text.length;
}

// The players' map (MapData/MapVector.luau): the land as cover and hill-shade rasters at the
// map's own resolution (zstd, base64), the paved and gravel section roads (zstd, base64), and the
// rivers, main roads, lakes and every settlement as lines and points, so the client can draw any
// part of the map sharply at any zoom.
{
  const cells = n * n, land = Buffer.alloc(cells * 2), cellM = map.cellMiles * 1609.344;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, at = (a, b) => map.elevation[Math.min(n - 1, Math.max(0, b)) * n + Math.min(n - 1, Math.max(0, a))];
    const dx = (at(i + 1, j) - at(i - 1, j)) * 25 / (2 * cellM), dy = (at(i, j + 1) - at(i, j - 1)) * 25 / (2 * cellM);
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
  const roadLines = map.roads.map(rd => `{ kind = "${rd.kind}", name = ${JSON.stringify(rd.kind === 'highway' ? '' : rd.name.replace(/ .*–.*/, '').replace(/ bypass$/, ''))}, points = { ${rd.points.flatMap(([x, y]) => [r(x, 2), r(y, 2)]).join(', ')} } }`);
  const towns = map.settlements.map(st => `{ name = ${JSON.stringify(st.name)}, kind = "${st.kind}", x = ${r(st.x)}, y = ${r(st.y)}, population = ${st.population} }`);
  const lakes = map.lakes.map(l => `{ x = ${r(l.damX)}, y = ${r(l.damY)}, areaMi2 = ${Math.round(l.areaMi2)} }`);
  const dir = path.join('roblox', 'src', 'shared', 'MapData');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'MapVector.luau'), `-- Generated by scripts/export-world-roblox.mjs (seed ${seed}); do not edit.
return {
\tmiles = ${map.params.miles},
\tcells = ${n},
\tcover = { ${COVER.map(c => JSON.stringify(c)).join(', ')} },
\tland = "${pack(land)}",
\tsectionSize = ${map.sections.size},
\tsections = "${pack(Buffer.from(map.sections.roads))}",
\trivers = { ${riverLines.join(',\n\t\t')} },
\troads = { ${roadLines.join(',\n\t\t')} },
\tsettlements = { ${towns.join(',\n\t\t')} },
\tlakes = { ${lakes.join(', ')} },
\tcrossings = { ${map.crossings.map(c => `{ type = "${c.type}", interstate = "${c.interstate}", x = ${r(c.x, 4)}, y = ${r(c.y, 4)}, ux = ${r(c.ux, 5)}, uy = ${r(c.uy, 5)}, vx = ${r(c.vx, 5)}, vy = ${r(c.vy, 5)}, exit = ${c.exit}, uEnd = ${c.uEnd}, vEnd = ${c.vEnd} }`).join(',\n\t\t')} },
}
`);
}

const city = map.settlements.find(s => s.kind === 'city') ?? map.settlements[0];
const lua = v => (Array.isArray(v) ? `{ ${v.map(lua).join(', ')} }` : typeof v === 'object' && v !== null ? `{ ${Object.entries(v).map(([k, x]) => `${/^[A-Za-z_]\w*$/.test(k) ? k : `["${k}"]`} = ${lua(x)}`).join(', ')} }` : typeof v === 'string' ? JSON.stringify(v) : String(v));
const meta = {
  seed, miles: map.params.miles, cellMiles: map.cellMiles, tileMiles: TILE_MI, tiles, border: BORDER, tileCells: S, corners: CORNERS, baseM: BASE_M,
  cover: COVER, regions: REGIONS.map(x => x.key), sectionClasses: ['none', 'dirt', 'gravel', 'paved'],
  lakes: map.lakes.map(l => ({ id: l.id, surfaceM: r(l.surfaceM, 1), x: r(l.damX), y: r(l.damY) })),
  settlements: map.settlements.map(s => ({ name: s.name, kind: s.kind, x: s.x, y: s.y, population: s.population, coreMi: r(s.coreMi), extentMi: r(s.extentMi), streetBlockMi: r(s.streetBlockMi, 4) })),
  // Edge of the mid-size city's suburbs, looking in.
  start: { x: r(city.x + city.extentMi + 1), y: r(city.y), name: city.name }
};
writeFileSync(path.join(out, 'Meta.luau'), `-- Generated by scripts/export-world-roblox.mjs (seed ${seed}); do not edit.\nreturn ${lua(meta)}\n`);
console.log(`seed ${seed}: ${tiles * tiles} tiles (${(bytes / 1e6).toFixed(1)} MB) and Meta.luau -> ${out}; start at ${meta.start.name} (${meta.start.x}, ${meta.start.y} mi)`);

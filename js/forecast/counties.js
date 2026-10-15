// The counties as the forecast products use them. Watches are made of whole counties, as the
// Storm Prediction Center's are: the watch outline update (WOU) lists the counties, and the map
// shades them. Mesoscale discussions keep a free-drawn outline, as the centre's do, and name
// the parts of the regions they cover; warnings keep their storm-based polygons, as the National
// Weather Service's do, and name the counties (or parts of counties) and towns inside.
//
// A layer ties the map's counties (js/worldmap/counties.js, written by
// scripts/build-world-map.mjs to counties.json and counties.u16) to the weather's grid of
// cells: how much of each county lies in each cell, and which county holds most of each cell.
// Without the map (a test's small grid) each cell is a county of its own, with no names.
import { cellOutline } from '../worldmap/counties.js';

// Region names as places: the land itself, as the centre names states.
const PLACE = { highPlains: 'High Plains', smokyHills: 'Smoky Hills', sandhills: 'Sandhills', redHills: 'Red Hills', flintHills: 'Flint Hills', midwest: 'Lower Valley', ozarkEdge: 'Ozark Border' };
const PARTS = [['northwestern', 'northern', 'northeastern'], ['western', 'central', 'eastern'], ['southwestern', 'southern', 'southeastern']];
const list = words => (words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);

// data: counties.json with `ids` (the county number of each map cell, a Uint16Array); width,
// height: the weather's grid, which spans the same ground.
export function countyLayer(data, width, height) {
  const size = data.size, miles = data.miles ?? size * data.cellMiles, fine = miles / size, scale = size / width;
  const counties = data.counties.map(c => ({ ...c, index: c.id - 1, cells: [], shares: [] }));
  // The share of each county in each weather cell.
  const counts = new Map();
  for (let k = 0; k < size * size; k++) {
    const id = data.ids[k]; if (!id) continue;
    const i = k % size, j = (k - i) / size, cell = Math.min(height - 1, Math.floor(j / scale)) * width + Math.min(width - 1, Math.floor(i / scale));
    const key = (id - 1) * width * height + cell; counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const dominant = new Int32Array(width * height).fill(-1), most = new Float32Array(width * height);
  for (const [key, count] of counts) {
    const index = Math.floor(key / (width * height)), cell = key % (width * height), county = counties[index];
    const share = count * fine * fine / county.areaMi2;
    county.cells.push(cell); county.shares.push(share);
    if (count > most[cell]) { most[cell] = count; dominant[cell] = index; }
  }
  for (const county of counties) county.home = county.cells[county.shares.indexOf(Math.max(...county.shares))];
  const placeNames = Object.fromEntries((data.regions ?? []).map(r => [r.key, r.label ?? PLACE[r.key] ?? r.name]));
  return {
    named: true, width, height, miles, size, ids: data.ids, counties, dominant, towns: data.towns ?? [], placeNames,
    // The county index at a point (miles east and south of the northwest corner), or -1.
    at(x, y) { const i = Math.floor(x / fine), j = Math.floor(y / fine); return i < 0 || j < 0 || i >= size || j >= size ? -1 : data.ids[j * size + i] - 1; }
  };
}

// Each weather cell a county of its own, unnamed: what the products do without the map.
const plain = new Map();
export function cellCounties(width, height, cellMiles = 10) {
  const key = `${width}x${height}x${cellMiles}`;
  if (plain.has(key)) return plain.get(key);
  const counties = Array.from({ length: width * height }, (_, i) => ({ id: i + 1, index: i, name: null, areaMi2: cellMiles * cellMiles, cells: [i], shares: [1], home: i, x: (i % width + 0.5) * cellMiles, y: (Math.floor(i / width) + 0.5) * cellMiles }));
  const layer = { named: false, width, height, miles: width * cellMiles, size: width, counties, dominant: Int32Array.from({ length: width * height }, (_, i) => i), towns: [], placeNames: {}, at: (x, y) => { const i = Math.floor(x / cellMiles), j = Math.floor(y / cellMiles); return i < 0 || j < 0 || i >= width || j >= height ? -1 : j * width + i; } };
  layer.ids = Uint16Array.from({ length: width * height }, (_, i) => i + 1);
  plain.set(key, layer);
  return layer;
}

// The counties at least `least` of whose area lies in an area (a 0/1 grid of weather cells),
// leaving out those in `blocked` (a Set of county indices).
export function countiesIn(layer, inside, { least = 0.5, blocked = null } = {}) {
  const out = [];
  for (const county of layer.counties) {
    if (blocked?.has(county.index)) continue;
    let share = 0; county.cells.forEach((cell, k) => { if (inside[cell]) share += county.shares[k]; });
    if (share >= least - 1e-9) out.push(county.index);
  }
  return out;
}

// The weather cells that a set of counties (indices) holds most of, as a 0/1 grid.
export function cellsOfCounties(layer, indices) {
  const set = new Set(indices), out = new Uint8Array(layer.width * layer.height);
  for (let i = 0; i < out.length; i++) if (set.has(layer.dominant[i])) out[i] = 1;
  return out;
}

// The counties holding ground under a 0/1 grid of weather cells (each county whose home cell,
// the one with most of it, is in it).
export function countiesUnder(layer, grid) {
  return new Set(layer.counties.filter(county => grid[county.home] || county.cells.some(cell => grid[cell] && layer.dominant[cell] === county.index)).map(county => county.index));
}

// The outline of a set of counties, along their borders, in shares of the map (as contour
// rings are): one ring per joined-up piece, and any holes.
export function countyRings(layer, indices) {
  const set = new Set(indices);
  if (!set.size) return [];
  const size = layer.size, grid = new Uint8Array(size * size), box = [size, size, 0, 0];
  for (let k = 0; k < grid.length; k++) {
    if (!set.has(layer.ids[k] - 1)) continue;
    grid[k] = 1; const i = k % size, j = (k - i) / size;
    box[0] = Math.min(box[0], i); box[1] = Math.min(box[1], j); box[2] = Math.max(box[2], i + 1); box[3] = Math.max(box[3], j + 1);
  }
  return cellOutline(grid, size, 1, box).map(ring => ring.map(([x, y]) => [+(x / size).toFixed(5), +(y / size).toFixed(5)]));
}

// Where a set of counties (indices) lies, in words: the parts of the regions it covers, the
// largest share first, as the centre names the parts of states ("the eastern Smoky Hills and
// the western Flint Hills"). Null without names (see describeArea for that).
export function describeRegions(layer, indices) {
  if (!layer.named || !indices.length) return null;
  const all = new Map(), mine = new Map();
  for (const county of layer.counties) {
    const r = all.get(county.region) ?? { area: 0, box: [Infinity, Infinity, -Infinity, -Infinity] };
    r.area += county.areaMi2; r.box = [Math.min(r.box[0], county.box[0]), Math.min(r.box[1], county.box[1]), Math.max(r.box[2], county.box[2]), Math.max(r.box[3], county.box[3])];
    all.set(county.region, r);
  }
  let total = 0;
  for (const index of indices) {
    const county = layer.counties[index], m = mine.get(county.region) ?? { area: 0, sx: 0, sy: 0 };
    m.area += county.areaMi2; m.sx += county.x * county.areaMi2; m.sy += county.y * county.areaMi2; total += county.areaMi2;
    mine.set(county.region, m);
  }
  const parts = [...mine].filter(([, m]) => m.area >= 0.15 * total).sort((a, b) => b[1].area - a[1].area).slice(0, 3).map(([key, m]) => {
    const r = all.get(key), name = layer.placeNames[key] ?? PLACE[key] ?? key;
    if (m.area >= 0.6 * r.area) return `much of the ${name}`;
    const u = (m.sx / m.area - r.box[0]) / Math.max(1, r.box[2] - r.box[0]), v = (m.sy / m.area - r.box[1]) / Math.max(1, r.box[3] - r.box[1]);
    return `the ${PARTS[Math.min(2, Math.max(0, Math.floor(v * 3)))][Math.min(2, Math.max(0, Math.floor(u * 3)))]} ${name}`;
  });
  return parts.length === 2 ? `${parts[0]} into ${parts[1]}` : list(parts);
}

// The names of a set of counties, in alphabetical order.
export const countyNames = (layer, indices) => indices.map(index => layer.counties[index].name).filter(Boolean).sort((a, b) => a.localeCompare(b));

// The counties a polygon (points in miles) covers part of, each with the share of it inside and
// which part of it that is, the most covered first; and the towns inside, the largest first.
// Counties with only a sliver inside (under leastMi2, or under leastShare of the polygon) are
// left out, as forecasters draw their polygons to leave out slivers.
export function polygonCounties(layer, polygon, { leastMi2 = 6, leastShare = 0.03 } = {}) {
  if (!layer.named) return null;
  const size = layer.size, fine = layer.miles / size, xs = polygon.map(p => p[0]), ys = polygon.map(p => p[1]);
  const i0 = Math.max(0, Math.floor(Math.min(...xs) / fine)), i1 = Math.min(size - 1, Math.ceil(Math.max(...xs) / fine)), j0 = Math.max(0, Math.floor(Math.min(...ys) / fine)), j1 = Math.min(size - 1, Math.ceil(Math.max(...ys) / fine));
  const found = new Map(); let total = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = (i + 0.5) * fine, y = (j + 0.5) * fine;
    if (!inside(polygon, x, y)) continue;
    const index = layer.ids[j * size + i] - 1, f = found.get(index) ?? { cells: 0, sx: 0, sy: 0 };
    f.cells++; f.sx += x; f.sy += y; found.set(index, f); total++;
  }
  const counties = [...found].map(([index, f]) => {
    const county = layer.counties[index], area = f.cells * fine * fine, share = Math.min(1, area / county.areaMi2);
    return { index, name: county.name, region: county.region, areaMi2: area, share, part: share >= 0.85 ? null : partOf(county, f.sx / f.cells, f.sy / f.cells) };
  }).filter(c => c.areaMi2 >= leastMi2 && c.areaMi2 >= leastShare * total * fine * fine).sort((a, b) => b.areaMi2 - a.areaMi2);
  const towns = layer.towns.filter(t => inside(polygon, t.x, t.y)).sort((a, b) => b.population - a.population);
  return { counties, towns };
}

// Which part of a county a point is in, as the Weather Service words it ("northwestern",
// "north central", "central").
function partOf(county, x, y) {
  const u = (x - county.box[0]) / Math.max(1e-6, county.box[2] - county.box[0]) - 0.5, v = (y - county.box[1]) / Math.max(1e-6, county.box[3] - county.box[1]) - 0.5;
  const ns = v < -1 / 6 ? 'north' : v > 1 / 6 ? 'south' : '', ew = u < -1 / 6 ? 'west' : u > 1 / 6 ? 'east' : '';
  return ns && ew ? `${ns}${ew}ern` : ns ? `${ns} central` : ew ? `${ew} central` : 'central';
}

function inside(polygon, x, y) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// The nearest town to a point (miles) of at least `least` people, with its distance (miles).
export function nearestTown(layer, x, y, least = 0) {
  let best = null, distance = Infinity;
  for (const t of layer.towns) { if (t.population < least) continue; const d = Math.hypot(t.x - x, t.y - y); if (d < distance) { distance = d; best = t; } }
  return best ? { town: best, miles: distance } : null;
}

// What the pages get to draw the counties: each one's outline in shares of the map, name and
// seat. (Null without the map.)
export function publicCounties(layer) {
  if (!layer?.named) return null;
  return {
    miles: layer.miles, regions: layer.placeNames,
    counties: layer.counties.map(c => ({ id: c.id, name: c.name, seat: c.seat, region: c.region, areaMi2: c.areaMi2, x: +(c.x / layer.miles).toFixed(4), y: +(c.y / layer.miles).toFixed(4), rings: c.rings.map(ring => ring.map(([x, y]) => [+(x / layer.miles).toFixed(5), +(y / layer.miles).toFixed(5)])) }))
  };
}

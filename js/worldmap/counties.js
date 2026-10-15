// Counties for the world map, laid out the way the counties of the central Plains were: on the
// Public Land Survey's township lines (6 miles apart), in east-west rows whose north and south
// lines run on for hundreds of miles while the lines between counties jog from one row to the
// next (as across Kansas and Nebraska); widest on the dry High Plains and in the Sandhills,
// smallest in the wetter farm country to the east (as Iowa's and Missouri's are); and in the
// east, where the big rivers were boundaries before the survey came, cut by the rivers (as the
// Missouri and the lower Kansas divide counties).
//
// Sizes are the counties' land areas in the Census Bureau's 2010 gazetteer for the real regions
// each world region stands for (median, square miles): western Kansas and the Nebraska
// panhandle about 900 (Sherman 1056, Logan 1073, Wallace 914, Greeley 778); the Smoky Hills
// about 760 (Ellis 900, Russell 899, Lincoln 719, Saline 720); the Nebraska Sandhills about 1500
// (Cherry 5960, Custer 2576, Holt 2413, Thomas 713); the Red Hills about 850 (Barber 1134, Comanche
// 788, Kiowa 722); the Flint Hills about 800 (Chase 773, Morris 697, Wabaunsee 794, Greenwood
// 1140); northern Missouri and southern Iowa about 560 (Iowa's 99 average 564); the Ozark border
// about 620 (Missouri's 114 average 603). Kansas's 105 average 779 (81,759 mi2 of land).
//
// Each county gets a seat (its largest town; a few rural counties have none on the map) and a
// name from the stock the real ones were named from: presidents, generals, pioneers, and the
// land itself.
import { makeRandom, hashText } from './noise.js';

export const COUNTY_DEFAULTS = Object.freeze({
  areaMi2: { highPlains: 900, smokyHills: 760, sandhills: 1500, redHills: 850, flintHills: 800, midwest: 560, ozarkEdge: 620 },
  townshipMi: 6,
  // Heights of the east-west rows (miles; the survey's standard parallels came every 24 to 30).
  tierMi: [24, 30, 30, 36],
  // How much a county's width strays from what its region's usual area gives, and the narrowest made.
  widthJitter: 0.25, leastMi: 12,
  // A county line within this many miles of one in the row above is put on it this often, so
  // some lines run straight on through several rows and others jog.
  alignMi: 6, alignChance: 0.55,
  // Rivers that are county lines: any river at least majorRiverM wide, and in the eastern
  // regions (riverRegions) any at least riverM wide.
  majorRiverM: 450, riverM: 220, riverRegions: ['midwest', 'ozarkEdge', 'flintHills'],
  // A piece a river cuts off a county is a county of its own when it has at least this share of
  // its region's usual area; a smaller one joins the neighbour on its own side of the river.
  ownPieceShare: 0.45
});

// The names. Plains counties were mostly named for presidents, Civil War officers, governors and
// pioneers, and for rivers, trees and animals; the same names come up state after state.
const NAMES = ['Adams', 'Allen', 'Anderson', 'Antelope', 'Arthur', 'Atchison', 'Barber', 'Barton', 'Bates', 'Benton', 'Blaine', 'Boone', 'Bourbon', 'Boyd', 'Brown', 'Buchanan', 'Buffalo', 'Burt', 'Butler', 'Caldwell', 'Calhoun', 'Carroll', 'Cass', 'Cedar', 'Chase', 'Chautauqua', 'Cherokee', 'Cheyenne', 'Clark', 'Clay', 'Clinton', 'Cloud', 'Coffey', 'Cole', 'Colfax', 'Comanche', 'Cooper', 'Cowley', 'Crawford', 'Cuming', 'Custer', 'Dade', 'Dallas', 'Daviess', 'Dawes', 'Dawson', 'Decatur', 'DeKalb', 'Dent', 'Deuel', 'Dickinson', 'Dixon', 'Dodge', 'Doniphan', 'Douglas', 'Dundy', 'Edwards', 'Elk', 'Ellis', 'Ellsworth', 'Fillmore', 'Finney', 'Ford', 'Franklin', 'Frontier', 'Furnas', 'Gage', 'Garden', 'Garfield', 'Gentry', 'Geary', 'Gosper', 'Gove', 'Graham', 'Grant', 'Gray', 'Greeley', 'Greene', 'Greenwood', 'Grundy', 'Hall', 'Hamilton', 'Harlan', 'Harper', 'Harrison', 'Harvey', 'Haskell', 'Hayes', 'Henry', 'Hickory', 'Hitchcock', 'Hodgeman', 'Holt', 'Hooker', 'Howard', 'Howell', 'Jackson', 'Jasper', 'Jefferson', 'Jewell', 'Johnson', 'Kearney', 'Kearny', 'Keith', 'Kingman', 'Kiowa', 'Knox', 'Labette', 'Laclede', 'Lafayette', 'Lancaster', 'Lane', 'Lawrence', 'Leavenworth', 'Lewis', 'Lincoln', 'Linn', 'Livingston', 'Logan', 'Loup', 'Lyon', 'Macon', 'Madison', 'Marion', 'Marshall', 'McPherson', 'Meade', 'Mercer', 'Merrick', 'Miami', 'Miller', 'Mitchell', 'Monroe', 'Montgomery', 'Morgan', 'Morrill', 'Morris', 'Morton', 'Nance', 'Nemaha', 'Neosho', 'Ness', 'Newton', 'Nodaway', 'Norton', 'Nuckolls', 'Osage', 'Osborne', 'Otoe', 'Ottawa', 'Ozark', 'Pawnee', 'Perkins', 'Pettis', 'Phelps', 'Phillips', 'Pierce', 'Pike', 'Platte', 'Polk', 'Pottawatomie', 'Pratt', 'Pulaski', 'Putnam', 'Ralls', 'Randolph', 'Rawlins', 'Ray', 'Red Willow', 'Reno', 'Republic', 'Rice', 'Richardson', 'Riley', 'Rock', 'Rooks', 'Rush', 'Russell', 'Saline', 'Saunders', 'Scotts Bluff', 'Scott', 'Sedgwick', 'Seward', 'Shannon', 'Shawnee', 'Shelby', 'Sheridan', 'Sherman', 'Sioux', 'Smith', 'Stafford', 'Stanton', 'Stevens', 'Stoddard', 'Stone', 'Sullivan', 'Sumner', 'Taney', 'Texas', 'Thayer', 'Thomas', 'Trego', 'Valley', 'Vernon', 'Wabaunsee', 'Wallace', 'Warren', 'Washington', 'Wayne', 'Webster', 'Wheeler', 'Wichita', 'Wilson', 'Woodson', 'Worth', 'Wright', 'Wyandotte', 'York',
  'Alder', 'Aspen', 'Badger', 'Bear Creek', 'Beaver', 'Big Sandy', 'Bison', 'Bluestem', 'Box Elder', 'Briar', 'Buckeye', 'Burr Oak', 'Catalpa', 'Chalk', 'Clearwater', 'Coyote', 'Crane', 'Cypress', 'Deer Creek', 'Eagle', 'Elkhorn', 'Elm', 'Falcon', 'Flint', 'Fox', 'Gypsum', 'Hackberry', 'Hawk', 'Hazel', 'Hickory Grove', 'Indian Creek', 'Ironwood', 'Juniper', 'Lone Tree', 'Maple', 'Medicine', 'Mulberry', 'Otter', 'Pecan', 'Pine', 'Plum', 'Prairie', 'Quail', 'Rattlesnake', 'Redbud', 'Rush Creek', 'Sage', 'Salt Fork', 'Sandstone', 'Spring', 'Sumac', 'Sycamore', 'Thistle', 'Timber', 'Turkey', 'Walnut', 'White Rock', 'Wildcat', 'Willow', 'Wolf',
  'Ames', 'Bancroft', 'Baxter', 'Beecher', 'Bingham', 'Bolton', 'Bowman', 'Bradford', 'Burnett', 'Carson', 'Chandler', 'Cody', 'Colby', 'Crockett', 'Curtis', 'Dalton', 'Dunbar', 'Emmett', 'Ewing', 'Fairbanks', 'Fletcher', 'Fremont', 'Gaines', 'Garrison', 'Hale', 'Hardin', 'Hartley', 'Hughes', 'Irwin', 'Kendall', 'Lamar', 'Larkin', 'Lyman', 'Mason', 'Merritt', 'Nash', 'Noble', 'Oakes', 'Parker', 'Payne', 'Pruitt', 'Quinn', 'Reed', 'Sawyer', 'Selby', 'Sims', 'Talbot', 'Thatcher', 'Tilden', 'Tyler', 'Upton', 'Vance', 'Wade', 'Walker', 'Watts', 'Whitman', 'Wilder', 'Yates'];

// Plans the counties. Returns { size, cellMiles, ids, list }: ids is the county number (1 up) of
// every map cell; list[k] describes county k + 1 (see describeCounty).
export function planCounties(map, options = {}) {
  const p = { ...COUNTY_DEFAULTS, ...options };
  const n = map.size, c = map.cellMiles, miles = n * c, random = makeRandom(hashText(`${map.params?.seed ?? 1}|counties`));
  const regionAt = (x, y) => map.regionKeys[map.region[Math.min(n - 1, Math.floor(y / c)) * n + Math.min(n - 1, Math.floor(x / c))]];
  const usual = (x, y) => p.areaMi2[regionAt(x, y)] ?? 750;
  const snap = v => Math.max(p.townshipMi, Math.round(v / p.townshipMi) * p.townshipMi);

  // Rows, then the counties along each, west to east.
  const rects = [];
  let lines = [], top = 0;
  while (top < miles - 1e-9) {
    let h = p.tierMi[Math.floor(random() * p.tierMi.length)];
    if (miles - top - h < 18) h = miles - top;
    const above = lines, here = [], mid = Math.min(miles - 1, top + h / 2);
    for (let x = 0; x < miles - 1e-9;) {
      // The width that gives the region's usual area, judged at the county's middle.
      const guess = usual(Math.min(miles - 1, x + 12), mid) / h;
      let w = snap(usual(Math.min(miles - 1, x + guess / 2), mid) / h * (1 + p.widthJitter * (2 * random() - 1)));
      w = Math.max(p.leastMi, w);
      const near = above.filter(line => line > x + p.leastMi - 1e-9 && Math.abs(line - (x + w)) <= p.alignMi + 1e-9);
      if (near.length && random() < p.alignChance) w = near.reduce((a, b) => (Math.abs(b - x - w) < Math.abs(a - x - w) ? b : a)) - x;
      if (miles - (x + w) < p.leastMi) w = miles - x;
      rects.push([x, top, x + w, top + h]);
      x += w; if (x < miles - 1e-9) here.push(x);
    }
    lines = here; top += h;
  }
  let ids = new Uint16Array(n * n);
  rects.forEach(([x0, y0, x1, y1], k) => {
    for (let j = Math.round(y0 / c); j < Math.round(y1 / c); j++) for (let i = Math.round(x0 / c); i < Math.round(x1 / c); i++) ids[j * n + i] = k + 1;
  });

  // Rivers that are county lines, as a 0/1 grid of the cells they run through.
  const river = new Uint8Array(n * n);
  for (const r of map.rivers ?? []) {
    const pts = r.points;
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const width = Math.min(r.widthsM[k / 2] ?? 0, r.widthsM[k / 2 + 1] ?? 0), x = pts[k], y = pts[k + 1];
      if (width < p.riverM || (width < p.majorRiverM && !p.riverRegions.includes(regionAt(x, y)))) continue;
      const steps = Math.ceil(Math.hypot(pts[k + 2] - x, pts[k + 3] - y) / (c / 4));
      for (let s = 0; s <= steps; s++) {
        const X = x + (pts[k + 2] - x) * s / steps, Y = y + (pts[k + 3] - y) * s / steps;
        river[Math.min(n - 1, Math.floor(Y / c)) * n + Math.min(n - 1, Math.floor(X / c))] = 1;
      }
    }
  }
  ids = cutByRivers(ids, river, n, c, (x, y) => p.ownPieceShare * usual(x, y));
  return describeCounties(map, ids, n, c, random);
}

// Splits each county into the pieces the rivers leave of it (cells joined through their sides,
// not across a river cell). The largest piece keeps the county; another is a county of its own
// if it is at least `least(x, y)` square miles, and otherwise joins the neighbour it shares the
// most border with on its own side of the river. River cells go to the county beside them.
function cutByRivers(ids, river, n, c, least) {
  const piece = new Int32Array(n * n).fill(-1), pieces = [];
  for (let start = 0; start < n * n; start++) {
    if (river[start] || piece[start] >= 0) continue;
    const id = ids[start], cells = [start], index = pieces.length; piece[start] = index;
    for (let q = 0; q < cells.length; q++) {
      const k = cells[q], i = k % n;
      for (const m of [i > 0 ? k - 1 : -1, i < n - 1 ? k + 1 : -1, k - n, k + n]) if (m >= 0 && m < n * n && !river[m] && piece[m] < 0 && ids[m] === id) { piece[m] = index; cells.push(m); }
    }
    pieces.push({ id, cells });
  }
  const byCounty = new Map();
  for (const pc of pieces) { if (!byCounty.has(pc.id)) byCounty.set(pc.id, []); byCounty.get(pc.id).push(pc); }
  let next = Math.max(...byCounty.keys()) + 1;
  const out = Uint16Array.from(ids), small = [];
  for (const list of byCounty.values()) {
    list.sort((a, b) => b.cells.length - a.cells.length);
    for (const pc of list.slice(1)) {
      const mid = pc.cells[pc.cells.length >> 1], x = (mid % n + 0.5) * c, y = (Math.floor(mid / n) + 0.5) * c;
      if (pc.cells.length * c * c >= least(x, y)) { pc.id = next++; for (const k of pc.cells) out[k] = pc.id; } else small.push(pc);
    }
  }
  // Small pieces, smallest first, to their neighbour on the same side. Each is first numbered on
  // its own, and a piece joining another takes along any that joined it before.
  const members = new Map();
  for (const pc of small) { pc.id = next++; for (const k of pc.cells) out[k] = pc.id; members.set(pc.id, [...pc.cells]); }
  small.sort((a, b) => a.cells.length - b.cells.length);
  for (const pc of small) {
    const own = members.get(pc.id), border = new Map();
    for (const k of own) { const i = k % n; for (const m of [i > 0 ? k - 1 : -1, i < n - 1 ? k + 1 : -1, k - n, k + n]) if (m >= 0 && m < n * n && !river[m] && out[m] !== pc.id) border.set(out[m], (border.get(out[m]) ?? 0) + 1); }
    const best = [...border].sort((a, b) => b[1] - a[1])[0];
    if (!best) continue;
    for (const k of own) out[k] = best[0];
    if (members.has(best[0])) members.get(best[0]).push(...own);
    members.delete(pc.id);
  }
  // River cells: the county most common among their neighbours, repeated until all are given.
  let left = []; for (let k = 0; k < n * n; k++) if (river[k]) { left.push(k); out[k] = 0; }
  for (let round = 0; left.length && round < 50; round++) {
    const still = [], give = [];
    for (const k of left) {
      const i = k % n, count = new Map();
      for (const m of [i > 0 ? k - 1 : -1, i < n - 1 ? k + 1 : -1, k - n, k + n]) if (m >= 0 && m < n * n && out[m]) count.set(out[m], (count.get(out[m]) ?? 0) + 1);
      const best = [...count].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      if (best) give.push([k, best[0]]); else still.push(k);
    }
    for (const [k, id] of give) out[k] = id;
    left = still;
  }
  return out;
}

// Numbers the counties 1 up from the northwest and describes each: { id, name, seat, x, y (the
// middle, miles east and south of the map's northwest corner), areaMi2, region (the region most
// of it lies in), box [x0, y0, x1, y1], neighbours (ids), rings (its outline, miles) }.
function describeCounties(map, raw, n, c, random) {
  // Renumber in reading order of each county's first cell.
  const renumber = new Map(), ids = new Uint16Array(n * n);
  for (let k = 0; k < n * n; k++) { if (!renumber.has(raw[k])) renumber.set(raw[k], renumber.size + 1); ids[k] = renumber.get(raw[k]); }
  const count = renumber.size, stats = Array.from({ length: count }, () => ({ cells: 0, sx: 0, sy: 0, box: [Infinity, Infinity, -Infinity, -Infinity], regions: new Map(), neighbours: new Set() }));
  for (let k = 0; k < n * n; k++) {
    const s = stats[ids[k] - 1], i = k % n, j = (k - i) / n;
    s.cells++; s.sx += i + 0.5; s.sy += j + 0.5;
    s.box[0] = Math.min(s.box[0], i); s.box[1] = Math.min(s.box[1], j); s.box[2] = Math.max(s.box[2], i + 1); s.box[3] = Math.max(s.box[3], j + 1);
    const r = map.regionKeys[map.region[k]]; s.regions.set(r, (s.regions.get(r) ?? 0) + 1);
    if (i < n - 1 && ids[k + 1] !== ids[k]) { s.neighbours.add(ids[k + 1]); stats[ids[k + 1] - 1].neighbours.add(ids[k]); }
    if (j < n - 1 && ids[k + n] !== ids[k]) { s.neighbours.add(ids[k + n]); stats[ids[k + n] - 1].neighbours.add(ids[k]); }
  }
  // Seats: the largest town in each.
  const seats = new Map();
  for (const t of map.settlements ?? []) {
    const id = ids[Math.min(n - 1, Math.floor(t.y / c)) * n + Math.min(n - 1, Math.floor(t.x / c))], best = seats.get(id);
    if (!best || t.population > best.population) seats.set(id, t);
  }
  const pool = [...NAMES];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const taken = new Set((map.settlements ?? []).map(t => t.name));
  const names = pool.filter(name => !taken.has(name)).concat(pool.filter(name => taken.has(name)));
  const list = stats.map((s, k) => {
    const id = k + 1, seat = seats.get(id) ?? null;
    return {
      id, name: names[k % names.length] + (k >= names.length ? ` ${Math.floor(k / names.length) + 1}` : ''),
      seat: seat?.name ?? null, seatX: seat?.x ?? null, seatY: seat?.y ?? null,
      x: +(s.sx / s.cells * c).toFixed(2), y: +(s.sy / s.cells * c).toFixed(2), areaMi2: Math.round(s.cells * c * c),
      region: [...s.regions].sort((a, b) => b[1] - a[1])[0][0], box: s.box.map(v => v * c),
      neighbours: [...s.neighbours].sort((a, b) => a - b),
      rings: cellOutline(ids, n, id, s.box).map(ring => ring.map(([x, y]) => [x * c, y * c]))
    };
  });
  return { size: n, cellMiles: c, ids, list };
}

// The outline of the cells of a grid holding `value`, along the cells' edges: closed rings of
// corner points (grid units), the outer ones clockwise on screen (y down) and holes the other
// way, with points only where the outline turns. box: [i0, j0, i1, j1] bounds the cells.
export function cellOutline(grid, width, value, box = [0, 0, width, grid.length / width]) {
  const height = grid.length / width, at = (i, j) => i >= 0 && j >= 0 && i < width && j < height && grid[j * width + i] === value;
  // Directed edges with the area on their right (screen y down): from each start corner, the end.
  const next = new Map(), key = (i, j) => j * (width + 1) + i;
  const edge = (from, to) => { if (!next.has(from)) next.set(from, []); next.get(from).push(to); };
  for (let j = box[1]; j < box[3]; j++) for (let i = box[0]; i < box[2]; i++) {
    if (!at(i, j)) continue;
    if (!at(i, j - 1)) edge(key(i, j), key(i + 1, j));
    if (!at(i + 1, j)) edge(key(i + 1, j), key(i + 1, j + 1));
    if (!at(i, j + 1)) edge(key(i + 1, j + 1), key(i, j + 1));
    if (!at(i - 1, j)) edge(key(i, j + 1), key(i, j));
  }
  // Every corner has as many edges in as out, so a walk from a corner comes back to it. (Where
  // two pieces touch only at a corner, their outlines may join there into one ring; harmless
  // for drawing and filling.)
  const rings = [], corner = k => [k % (width + 1), Math.floor(k / (width + 1))];
  while (next.size) {
    const [start] = next.keys(), ring = [];
    let k = start;
    do {
      ring.push(corner(k));
      const out = next.get(k), to = out.pop();
      if (!out.length) next.delete(k);
      k = to;
    } while (k !== start && next.has(k));
    // Only the turns.
    const turns = ring.filter((pt, i) => { const a = ring[(i - 1 + ring.length) % ring.length], b = ring[(i + 1) % ring.length]; return (pt[0] - a[0]) * (b[1] - pt[1]) - (pt[1] - a[1]) * (b[0] - pt[0]) !== 0; });
    if (turns.length >= 3) rings.push(turns);
  }
  return rings;
}

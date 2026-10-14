// Where people live on the world map and the main roads between them, worked out from the land:
// a metro where a big river meets the trunk river (as Kansas City sits where the Kansas meets the
// Missouri), a mid-size city on a large river near the middle, small cities and towns on good
// ground near water, spaced more widely where the land is drier or rougher. Interstates join the
// cities, laid out like I-70 (east-west through the metro), I-35 (metro to the mid city and on
// south) and I-29 (north along the trunk river); highways join each town to its neighbours.
// Section-line county and gravel roads are not planned here: Roblox lays them per chunk.
import { makeRandom, hashText, clamp } from './noise.js';

export const SETTLEMENT_DEFAULTS = Object.freeze({
  // Least distance (miles) between towns, by region.
  townSpacingMi: { highPlains: 24, smokyHills: 18, sandhills: 40, redHills: 22, flintHills: 34, midwest: 12, ozarkEdge: 15 },
  // How much each region draws settlement.
  appeal: { highPlains: 0.5, smokyHills: 0.65, sandhills: 0.15, redHills: 0.45, flintHills: 0.2, midwest: 1, ozarkEdge: 0.4 },
  smallCities: 6, smallCitySpacingMi: 55, metroMinMi: 150,
  edgeMarginMi: 6,
  // Road routing cost on a 1-mile grid: per mile, plus slope (per m/m), plus river crossings.
  slopeCost: 40, smallRiverCost: 1.5, bigRiverCost: 6, bigRiverMi2: 2000, roughCost: { flintHills: 0.6, ozarkEdge: 1.2, redHills: 0.4, sandhills: 0.6 },
  reuseDiscount: 0.35
});

const KINDS = Object.freeze({
  metro: { population: 1500000, coreMi: 6, extentMi: 18 },
  city: { population: 380000, coreMi: 4, extentMi: 11 },
  smallCity: { population: 40000, coreMi: 1.6, extentMi: 3.5 }
});

const NAME_FIRST = ['Cedar', 'Prairie', 'Elm', 'Willow', 'Red', 'Stone', 'Bluff', 'Sand', 'Iron', 'Mill', 'Clear', 'Spring', 'Oak', 'Ash', 'Walnut', 'Buffalo', 'Antelope', 'Hickory', 'Maple', 'Cotton', 'Salt', 'Plum', 'Grand', 'Union', 'Liberty', 'Pleasant', 'Fair', 'Green', 'White', 'Black', 'Kiowa', 'Osage', 'Pawnee', 'Comanche', 'Shawnee', 'Arapaho', 'Wichita', 'Marion', 'Clay', 'Lincoln', 'Douglas', 'Morris', 'Ellis', 'Russell', 'Harper', 'Barton', 'Rush', 'Ness', 'Logan', 'Sherman', 'Rawlins', 'Decatur', 'Norton', 'Phillips', 'Smith', 'Jewell', 'Republic', 'Cloud', 'Mitchell', 'Osborne', 'Rooks', 'Graham', 'Trego', 'Gove', 'Wallace', 'Greeley', 'Hamilton', 'Kearny', 'Finney', 'Lane', 'Scott', 'Wichita', 'Stanton', 'Grant', 'Haskell', 'Gray', 'Ford', 'Hodgeman', 'Pawnee', 'Edwards', 'Kiowa', 'Pratt', 'Barber', 'Sumner', 'Cowley', 'Butler', 'Chase', 'Lyon', 'Coffey', 'Anderson', 'Franklin', 'Miami', 'Linn', 'Bourbon', 'Allen', 'Neosho', 'Wilson', 'Elk', 'Chautauqua'];
const NAME_LAST = ['ton', 'ville', ' City', ' Springs', ' Center', 'burg', 'field', 'wood', ' Falls', ' Junction', ' Grove', ' Hill', ' Bend', ' Creek', 'dale', ' Valley', ' Ridge', 'port', ' Plains', 'ford'];

export function planSettlements(map, options = {}) {
  const p = { ...SETTLEMENT_DEFAULTS, ...options };
  const { size: n, cellMiles, elevation, region, drainageMi2, rivers } = map, regions = map.regionKeys;
  const random = makeRandom(hashText(`${map.params.seed}|settlements`));
  const per = Math.round(1 / cellMiles), m = Math.floor(n / per);   // 1-mile grid
  const fine = (I, J) => (J * per + (per >> 1)) * n + I * per + (per >> 1);

  // Largest drainage and steepest slope in and next to each mile, and its region.
  const drain = new Float64Array(m * m), slope = new Float64Array(m * m), regionKey = new Array(m * m);
  for (let J = 0; J < m; J++) for (let I = 0; I < m; I++) {
    let most = 0;
    for (let j = Math.max(0, J * per - per); j < Math.min(n, (J + 2) * per); j++) for (let i = Math.max(0, I * per - per); i < Math.min(n, (I + 2) * per); i++) most = Math.max(most, drainageMi2[j * n + i]);
    const k = fine(I, J), cellM = cellMiles * 1609.344, i = k % n, j = (k / n) | 0;
    const dx = elevation[j * n + Math.min(n - 1, i + 1)] - elevation[j * n + Math.max(0, i - 1)], dy = elevation[Math.min(n - 1, j + 1) * n + i] - elevation[Math.max(0, j - 1) * n + i];
    drain[J * m + I] = most; slope[J * m + I] = Math.hypot(dx, dy) / (2 * cellM); regionKey[J * m + I] = regions[region[k]];
  }
  const margin = p.edgeMarginMi;
  const appeal = K => {
    const I = K % m, J = (K / m) | 0;
    if (I < margin || J < margin || I >= m - margin || J >= m - margin) return 0;
    return p.appeal[regionKey[K]] * (1 + 0.6 * Math.log10(1 + Math.min(drain[K], 8000) / 500)) * Math.exp(-slope[K] / 0.02);   // a big river helps, the biggest no more
  };

  const settlements = [], usedNames = new Set();
  const name = () => {
    for (let tries = 0; tries < 200; tries++) {
      const text = NAME_FIRST[Math.floor(random() * NAME_FIRST.length)] + NAME_LAST[Math.floor(random() * NAME_LAST.length)];
      if (!usedNames.has(text)) { usedNames.add(text); return text; }
    }
    return `Town ${settlements.length + 1}`;
  };
  const add = (kind, x, y, extra = {}) => {
    const def = KINDS[kind];
    const s = { name: name(), kind, x, y, population: def?.population ?? 0, coreMi: def?.coreMi ?? 0, extentMi: def?.extentMi ?? 0, ...extra };
    settlements.push(s);
    return s;
  };
  const nearest = (x, y) => settlements.reduce((best, s) => Math.min(best, Math.hypot(s.x - x, s.y - y)), Infinity);

  // Metro: the trunk-river junction with the largest tributary, away from the north and south edges.
  const trunkMi2 = Math.max(...rivers.map(r => r.mouthDrainageMi2));
  let metroAt = null;
  for (const river of rivers) {
    const last = river.points.length - 2, y = river.points[last + 1];
    if (river.mouthDrainageMi2 < 0.5 * trunkMi2 || y < 0.25 * m || y > 0.75 * m || river.widthsM.length < 2) continue;
    const tributaryMi2 = (river.widthsM[river.widthsM.length - 2] / map.params.riverWidthPerRootMi2) ** 2;
    if (tributaryMi2 < 0.5 * trunkMi2 && (!metroAt || tributaryMi2 > metroAt.tributaryMi2)) metroAt = { x: river.points[last], y, tributaryMi2 };
  }
  if (!metroAt) metroAt = { x: map.trunkU(0.5) * m, y: 0.5 * m };
  add('metro', metroAt.x, metroAt.y);

  // Mid-size city: the most appealing mile on a large river near the middle, well away from the metro.
  let bestCity = null;
  for (let K = 0; K < m * m; K++) {
    const I = K % m, J = (K / m) | 0;
    if (I < 0.38 * m || I > 0.62 * m || J < 0.3 * m || J > 0.75 * m || drain[K] < 5000) continue;
    if (Math.hypot(I + 0.5 - metroAt.x, J + 0.5 - metroAt.y) < p.metroMinMi) continue;
    const score = appeal(K);
    if (!bestCity || score > bestCity.score) bestCity = { K, score };
  }
  if (bestCity) add('city', bestCity.K % m + 0.5, ((bestCity.K / m) | 0) + 0.5);

  // Candidate miles in order of appeal (with a little chance mixed in), for small cities and towns.
  const candidates = [];
  for (let K = 0; K < m * m; K++) { const a = appeal(K); if (a > 0) candidates.push({ K, score: a * (0.75 + 0.5 * random()) }); }
  candidates.sort((a, b) => b.score - a.score);
  // Small cities: half of them in the western half, as the High Plains have their own regional centres.
  for (const [quota, west] of [[Math.ceil(p.smallCities / 2), true], [p.smallCities, false]]) {
    for (const c of candidates) {
      if (settlements.filter(s => s.kind === 'smallCity').length >= quota) break;
      const x = c.K % m + 0.5, y = ((c.K / m) | 0) + 0.5;
      if ((!west || x < 0.55 * m) && drain[c.K] >= 1500 && nearest(x, y) >= p.smallCitySpacingMi) add('smallCity', x, y);
    }
  }
  for (const c of candidates) {
    const x = c.K % m + 0.5, y = ((c.K / m) | 0) + 0.5;
    const spacing = p.townSpacingMi[regionKey[c.K]];
    const clear = settlements.every(s => Math.hypot(s.x - x, s.y - y) >= Math.max(spacing, s.extentMi + 3));
    if (!clear) continue;
    const size = clamp(c.score, 0, 2) / 2, population = Math.round(150 + 7000 * size ** 3 * random());
    add('town', x, y, { population, coreMi: 0.25 + 0.9 * Math.sqrt(population / 8000), extentMi: 0.4 + 1.3 * Math.sqrt(population / 8000) });
  }

  const roads = planRoads(map, p, settlements, { m, per, drain, slope, regionKey });
  return { settlements, roads };
}

// Least-cost routes on the 1-mile grid (8 neighbours). Cost per mile: 1 + slope + rough ground,
// plus a toll for crossing rivers (bridges are dear), less where a road already runs.
function planRoads(map, p, settlements, grid) {
  const { m, drain, slope, regionKey } = grid;
  const base = new Float64Array(m * m), onRoad = new Uint8Array(m * m);
  for (let K = 0; K < m * m; K++) {
    base[K] = 1 + p.slopeCost * slope[K] + (p.roughCost[regionKey[K]] ?? 0)
      + (drain[K] >= p.bigRiverMi2 ? p.bigRiverCost : drain[K] >= map.params.riverAreaMi2 ? p.smallRiverCost : 0);
  }
  const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
  const cost = new Float64Array(m * m), from = new Int32Array(m * m), closed = new Uint8Array(m * m);
  const heapK = new Int32Array(m * m * 4), heapF = new Float64Array(m * m * 4);

  function route(ax, ay, bx, by) {
    const start = clampCell(ay) * m + clampCell(ax), goal = clampCell(by) * m + clampCell(bx), gx = goal % m, gy = (goal / m) | 0;
    cost.fill(Infinity); closed.fill(0); from.fill(-1);
    let size = 0;
    const push = (K, f) => { let i = size++; while (i > 0) { const up = (i - 1) >> 1; if (heapF[up] <= f) break; heapF[i] = heapF[up]; heapK[i] = heapK[up]; i = up; } heapF[i] = f; heapK[i] = K; };
    const pop = () => { const top = heapK[0], f = heapF[--size], K = heapK[size]; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= size) break; if (c + 1 < size && heapF[c + 1] < heapF[c]) c++; if (heapF[c] >= f) break; heapF[i] = heapF[c]; heapK[i] = heapK[c]; i = c; } heapF[i] = f; heapK[i] = K; return top; };
    const h = K => 0.9 * Math.hypot(K % m - gx, ((K / m) | 0) - gy);
    cost[start] = 0; push(start, h(start));
    while (size) {
      const K = pop();
      if (K === goal) break;
      if (closed[K]) continue;
      closed[K] = 1;
      const x = K % m, y = (K / m) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= m || ny >= m) continue;
        const N = ny * m + nx, step = (d & 1 ? Math.SQRT2 : 1) * (base[N] + base[K]) / 2 * (onRoad[N] && onRoad[K] ? p.reuseDiscount : 1);
        if (cost[K] + step < cost[N]) { cost[N] = cost[K] + step; from[N] = K; push(N, cost[N] + h(N)); }
      }
    }
    const path = [];
    for (let K = goal; K >= 0; K = from[K]) { path.push(K); if (K === start) break; }
    path.reverse();
    for (const K of path) onRoad[K] = 1;
    return simplify(path.map(K => [K % m + 0.5, ((K / m) | 0) + 0.5]), 0.45);
  }
  const clampCell = v => clamp(Math.floor(v), 0, m - 1);

  const roads = [], metro = settlements.find(s => s.kind === 'metro'), city = settlements.find(s => s.kind === 'city');
  const smallCities = settlements.filter(s => s.kind === 'smallCity');
  const chain = (kind, name, points) => { const line = []; for (let i = 1; i < points.length; i++) { const leg = route(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]); line.push(...(i > 1 ? leg.slice(1) : leg)); } roads.push({ kind, name, points: line }); };

  // I-70: across the map east to west through the metro and the small cities near its latitude.
  const band = smallCities.filter(s => Math.abs(s.y - metro.y) < 70 && s.x < metro.x).sort((a, b) => b.x - a.x);
  chain('interstate', 'I-70', [[m - 0.5, metro.y], [metro.x, metro.y], ...band.map(s => [s.x, s.y]), [0.5, (band.at(-1) ?? metro).y]]);
  if (city) {
    // I-35: the metro to the mid city and on to the south edge.
    chain('interstate', 'I-35', [[metro.x, metro.y], [city.x, city.y], [city.x - 10, m - 0.5]]);
    // I-135: the mid city north to the nearest small city.
    const north = smallCities.filter(s => s.y < city.y - 30).sort((a, b) => Math.hypot(a.x - city.x, a.y - city.y) - Math.hypot(b.x - city.x, b.y - city.y))[0];
    if (north) chain('interstate', 'I-135', [[city.x, city.y], [north.x, north.y]]);
  }
  // I-29: north from the metro along the trunk river.
  chain('interstate', 'I-29', [[metro.x, metro.y], [map.trunkU(0) * m, 0.5]]);

  // Highways: each pair of settlements with no third one closer to both (a relative
  // neighbourhood graph), so every town is joined to its natural neighbours and no further.
  const near = settlements.map((s, i) => ({ s, i }));
  for (let a = 0; a < settlements.length; a++) {
    for (let b = a + 1; b < settlements.length; b++) {
      const A = settlements[a], B = settlements[b], d = Math.hypot(A.x - B.x, A.y - B.y);
      if (d > 70) continue;
      const blocked = near.some(({ s, i }) => i !== a && i !== b && Math.max(Math.hypot(s.x - A.x, s.y - A.y), Math.hypot(s.x - B.x, s.y - B.y)) < d);
      if (!blocked) roads.push({ kind: 'highway', name: `${A.name} – ${B.name}`, points: route(A.x, A.y, B.x, B.y) });
    }
  }
  return roads;
}

// Douglas–Peucker: drop points that sit within tolerance (miles) of the line through their neighbours.
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(), [ax, ay] = points[a], [bx, by] = points[b], len = Math.hypot(bx - ax, by - ay) || 1;
    let worst = 0, at = -1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((bx - ax) * (ay - points[i][1]) - (ax - points[i][0]) * (by - ay)) / len; if (d > worst) { worst = d; at = i; } }
    if (worst > tolerance) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

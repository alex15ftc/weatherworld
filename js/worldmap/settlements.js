// Where people live on the world map and the main roads between them, worked out from the land:
// a metro where a big river meets the trunk river (as Kansas City sits where the Kansas meets the
// Missouri), a mid-size city on a large river near the middle, small cities and towns on good
// ground near water, spaced more widely where the land is drier or rougher. Interstates join the
// cities, laid out like I-70 (east-west through the metro), I-35 (metro to the mid city and on
// south) and I-29 (north along the trunk river); highways join each town to its neighbours.
// Towns sit on section corners and roads follow the mile lines north-south and east-west over
// flat ground, jogging at corners as Plains highways do; they cut across only in rough country.
// Around the metro and the mid city: a beltway (like I-435 round Kansas City and I-235 round
// Wichita) and expressways (divided four-lane routes) out to the larger towns around them; small
// cities get an expressway bypass. The section-line county roads are planned in sectionRoads.js.
//
// Local streets are not planned here: Roblox lays them per chunk inside each settlement's
// extentMi. Each settlement carries what it needs for that: streetBlockMi (block size of the
// street grid in its core), and suburbanMi (from coreMi out to extentMi the streets are
// suburban: curving residential streets, collectors every half mile, arterials on every mile
// line, which sectionRoads.js marks paved).
import { makeRandom, hashText, clamp } from './noise.js';

export const SETTLEMENT_DEFAULTS = Object.freeze({
  // Least distance (miles) between towns, by region.
  townSpacingMi: { highPlains: 24, smokyHills: 18, sandhills: 30, redHills: 22, flintHills: 22, midwest: 12, ozarkEdge: 15 },
  // How much each region draws settlement.
  appeal: { highPlains: 0.5, smokyHills: 0.65, sandhills: 0.2, redHills: 0.45, flintHills: 0.45, midwest: 1, ozarkEdge: 0.4 },
  smallCities: 6, smallCitySpacingMi: 55, metroMinMi: 150,
  edgeMarginMi: 6,
  // Road routing cost on a 1-mile grid: per mile, plus slope (per m/m), plus river crossings;
  // lakes are not crossed.
  slopeCost: 40, smallRiverCost: 1.5, bigRiverCost: 6, bigRiverMi2: 2000, roughCost: { flintHills: 0.3, ozarkEdge: 1.2, redHills: 0.4, sandhills: 0.6 }, lakeCost: 200,
  reuseDiscount: 0.35,
  // Keeping to the mile lines: a diagonal mile costs up to diagonalCost times more on flat ground
  // (less on slopes and in rough regions, where roads follow the land), and each 45-degree turn
  // costs turnCost miles, so roads make a few long straight runs and square jogs.
  diagonalCost: 0.8, flatSlope: 0.015, turnCost: 1.2,
  // Interstates were laid out for speed: diagonals freely, long straight legs, gentle bends.
  interstate: { diagonalScale: 0.1, turnCost: 4 },
  // Expressways keep apart from the interstates outside the city they leave (a parallel
  // interstate costs this many times a fresh road).
  expressway: { diagonalScale: 0.4, turnCost: 2.5, interstateCost: 3 },
  // Beltways at this share of the way out through the suburbs; expressways from the metro and
  // the mid city to up to this many larger towns (at least expresswayPopulation people, within
  // expresswayMi), each leaving at least expresswayAngle degrees from the other roads out.
  beltwayShare: { metro: 0.6, city: 0.65 }, expressways: { metro: 4, city: 3 }, expresswayPopulation: 1000, expresswayMi: 60, expresswayAngle: 30,
  // Block size (mi) of the street grid in each kind of place's core.
  streetBlockMi: { metro: 1 / 10, city: 1 / 10, smallCity: 1 / 12, town: 1 / 14 }
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
  const { size: n, cellMiles, elevation, coverRegion, cover, drainageMi2, rivers } = map, regions = map.regionKeys, water = map.coverKeys.indexOf('water');
  const random = makeRandom(hashText(`${map.params.seed}|settlements`));
  const per = Math.round(1 / cellMiles), m = Math.floor(n / per);   // 1-mile grid
  const fine = (I, J) => (J * per + (per >> 1)) * n + I * per + (per >> 1);

  // Largest drainage and steepest slope in and next to each mile, and its region.
  const drain = new Float64Array(m * m), slope = new Float64Array(m * m), regionKey = new Array(m * m), wet = new Uint8Array(m * m);
  for (let J = 0; J < m; J++) for (let I = 0; I < m; I++) {
    let most = 0;
    for (let j = Math.max(0, J * per - per); j < Math.min(n, (J + 2) * per); j++) for (let i = Math.max(0, I * per - per); i < Math.min(n, (I + 2) * per); i++) most = Math.max(most, drainageMi2[j * n + i]);
    for (let j = J * per; j < (J + 1) * per; j++) for (let i = I * per; i < (I + 1) * per; i++) if (cover[j * n + i] === water) wet[J * m + I] = 1;
    const k = fine(I, J), cellM = cellMiles * 1609.344, i = k % n, j = (k / n) | 0;
    const dx = elevation[j * n + Math.min(n - 1, i + 1)] - elevation[j * n + Math.max(0, i - 1)], dy = elevation[Math.min(n - 1, j + 1) * n + i] - elevation[Math.max(0, j - 1) * n + i];
    drain[J * m + I] = most; slope[J * m + I] = Math.hypot(dx, dy) / (2 * cellM); regionKey[J * m + I] = regions[coverRegion[k]];
  }
  const margin = p.edgeMarginMi;
  const appeal = K => {
    const I = K % m, J = (K / m) | 0;
    if (I < margin || J < margin || I >= m - margin || J >= m - margin || wet[K]) return 0;
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
    const s = { name: name(), kind, x, y, population: def?.population ?? 0, coreMi: def?.coreMi ?? 0, extentMi: def?.extentMi ?? 0, streetBlockMi: p.streetBlockMi[kind], ...extra };
    s.suburbanMi = Math.max(0, s.extentMi - s.coreMi);
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
  metroAt.x = Math.round(metroAt.x); metroAt.y = Math.round(metroAt.y);   // on a section corner
  add('metro', metroAt.x, metroAt.y);

  // Mid-size city: the most appealing mile on a large river near the middle, well away from the metro.
  let bestCity = null;
  for (let K = 0; K < m * m; K++) {
    const I = K % m, J = (K / m) | 0;
    if (I < 0.38 * m || I > 0.62 * m || J < 0.3 * m || J > 0.75 * m || drain[K] < 5000) continue;
    if (Math.hypot(I - metroAt.x, J - metroAt.y) < p.metroMinMi) continue;
    const score = appeal(K);
    if (!bestCity || score > bestCity.score) bestCity = { K, score };
  }
  if (bestCity) add('city', bestCity.K % m, (bestCity.K / m) | 0);

  // Candidate miles in order of appeal (with a little chance mixed in), for small cities and towns.
  const candidates = [];
  for (let K = 0; K < m * m; K++) { const a = appeal(K); if (a > 0) candidates.push({ K, score: a * (0.75 + 0.5 * random()) }); }
  candidates.sort((a, b) => b.score - a.score);
  // Small cities: half of them in the western half, as the High Plains have their own regional centres.
  for (const [quota, west] of [[Math.ceil(p.smallCities / 2), true], [p.smallCities, false]]) {
    for (const c of candidates) {
      if (settlements.filter(s => s.kind === 'smallCity').length >= quota) break;
      const x = c.K % m, y = (c.K / m) | 0;
      if ((!west || x < 0.55 * m) && drain[c.K] >= 1500 && nearest(x, y) >= p.smallCitySpacingMi) add('smallCity', x, y);
    }
  }
  for (const c of candidates) {
    const x = c.K % m, y = (c.K / m) | 0;
    const spacing = p.townSpacingMi[regionKey[c.K]];
    const clear = settlements.every(s => Math.hypot(s.x - x, s.y - y) >= Math.max(spacing, s.extentMi + 3));
    if (!clear) continue;
    const size = clamp(c.score, 0, 2) / 2, population = Math.round(150 + 7000 * size ** 3 * random());
    add('town', x, y, { population, coreMi: 0.25 + 0.9 * Math.sqrt(population / 8000), extentMi: 0.4 + 1.3 * Math.sqrt(population / 8000) });
  }

  const roads = planRoads(map, p, settlements, { m, per, drain, slope, regionKey, wet });
  return { settlements, roads };
}

// Least-cost routes over the corners of the 1-mile grid (8 neighbours). Cost per mile: 1 + slope +
// rough ground, plus a toll for crossing rivers (bridges are dear), less where a road already
// runs; more for a diagonal on flat ground and for each turn. The search state is the corner and
// the way the road arrived there, so turns can be charged; no turn sharper than a right angle.
function planRoads(map, p, settlements, grid) {
  const { m, drain, slope, regionKey, wet } = grid;
  const base = new Float64Array(m * m), diagonal = new Float64Array(m * m), onRoad = new Uint8Array(m * m), onInterstate = new Uint8Array(m * m);
  for (let K = 0; K < m * m; K++) {
    base[K] = 1 + p.slopeCost * slope[K] + (p.roughCost[regionKey[K]] ?? 0) + (wet[K] ? p.lakeCost : 0)
      + (drain[K] >= p.bigRiverMi2 ? p.bigRiverCost : drain[K] >= map.params.riverAreaMi2 ? p.smallRiverCost : 0);
    diagonal[K] = 1 + p.diagonalCost * Math.exp(-slope[K] / p.flatSlope) * (p.roughCost[regionKey[K]] ? 0.25 : 1);
  }
  const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
  const states = m * m * 8, cost = new Float64Array(states), from = new Int32Array(states), seen = new Int32Array(states), closed = new Int32Array(states);
  let heapK = new Int32Array(1 << 16), heapF = new Float64Array(1 << 16), generation = 0;

  function route(ax, ay, bx, by, style = { diagonalScale: 1, turnCost: p.turnCost }) {
    const start = clampCell(ay) * m + clampCell(ax), goal = clampCell(by) * m + clampCell(bx), gx = goal % m, gy = (goal / m) | 0;
    generation++;
    let size = 0;
    const push = (S, f) => {
      if (size === heapK.length) { const k = new Int32Array(size * 2), f2 = new Float64Array(size * 2); k.set(heapK); f2.set(heapF); heapK = k; heapF = f2; }
      let i = size++;
      while (i > 0) { const up = (i - 1) >> 1; if (heapF[up] <= f) break; heapF[i] = heapF[up]; heapK[i] = heapK[up]; i = up; }
      heapF[i] = f; heapK[i] = S;
    };
    const pop = () => { const top = heapK[0], f = heapF[--size], S = heapK[size]; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= size) break; if (c + 1 < size && heapF[c + 1] < heapF[c]) c++; if (heapF[c] >= f) break; heapF[i] = heapF[c]; heapK[i] = heapK[c]; i = c; } heapF[i] = f; heapK[i] = S; return top; };
    const h = K => { const dx = Math.abs(K % m - gx), dy = Math.abs(((K / m) | 0) - gy); return 0.9 * (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)); };
    for (let d = 0; d < 8; d++) { const S = start * 8 + d; cost[S] = 0; from[S] = -1; seen[S] = generation; push(S, h(start)); }
    let end = -1;
    while (size) {
      const S = pop(), K = S >> 3, din = S & 7;
      if (K === goal) { end = S; break; }
      if (closed[S] === generation) continue;
      closed[S] = generation;
      const x = K % m, y = (K / m) | 0, first = from[S] < 0;
      for (let d = 0; d < 8; d++) {
        const bend = Math.min(Math.abs(d - din), 8 - Math.abs(d - din));
        if (bend > 2 && !first) continue;
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= m || ny >= m) continue;
        const N = ny * m + nx, T = N * 8 + d;
        const shared = onRoad[N] && onRoad[K], parallel = style.interstateCost && onInterstate[N] && Math.hypot(nx - ax, ny - ay) > (style.clearMi ?? 0);
        const step = (d & 1 ? Math.SQRT2 * (1 + style.diagonalScale * ((diagonal[N] + diagonal[K]) / 2 - 1)) : 1) * (base[N] + base[K]) / 2 * (parallel ? style.interstateCost : shared && style.reuse !== false ? p.reuseDiscount : 1)
          + (first ? 0 : style.turnCost * bend);
        const total = cost[S] + step;
        if (seen[T] !== generation || total < cost[T]) { seen[T] = generation; cost[T] = total; from[T] = S; push(T, total + h(N)); }
      }
    }
    const path = [];
    for (let S = end; S >= 0; S = from[S]) path.push(S >> 3);
    path.reverse();
    for (const K of path) { onRoad[K] = 1; if (style === p.interstate) onInterstate[K] = 1; }
    const points = simplify(path.map(K => [K % m, (K / m) | 0]), 0.45);
    // Ends off the grid (at the map's edges) are joined straight on.
    if (points.length && (points[0][0] !== ax || points[0][1] !== ay)) points.unshift([ax, ay]);
    if (points.length && (points.at(-1)[0] !== bx || points.at(-1)[1] !== by)) points.push([bx, by]);
    return points;
  }
  const clampCell = v => clamp(Math.floor(v), 0, m - 1);

  const roads = [], metro = settlements.find(s => s.kind === 'metro'), city = settlements.find(s => s.kind === 'city');
  const smallCities = settlements.filter(s => s.kind === 'smallCity');
  const chain = (kind, name, points, style = p[kind]) => { const line = []; for (let i = 1; i < points.length; i++) { const leg = route(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], style); line.push(...(i > 1 ? leg.slice(1) : leg)); } roads.push({ kind, name, points: line }); };

  // I-70: across the map east to west through the metro and the small cities near its latitude.
  const band = smallCities.filter(s => Math.abs(s.y - metro.y) < 70 && s.x < metro.x).sort((a, b) => b.x - a.x);
  chain('interstate', 'I-70', [[m, metro.y], [metro.x, metro.y], ...band.map(s => [s.x, s.y]), [0, (band.at(-1) ?? metro).y]]);
  if (city) {
    // I-35: the metro to the mid city and on to the south edge.
    chain('interstate', 'I-35', [[metro.x, metro.y], [city.x, city.y], [city.x - 10, m]]);
    // I-135: the mid city north to the nearest small city.
    const north = smallCities.filter(s => s.y < city.y - 30).sort((a, b) => Math.hypot(a.x - city.x, a.y - city.y) - Math.hypot(b.x - city.x, b.y - city.y))[0];
    if (north) chain('interstate', 'I-135', [[city.x, city.y], [north.x, north.y]]);
  }
  // I-29: north from the metro along the trunk river.
  chain('interstate', 'I-29', [[metro.x, metro.y], [Math.round(map.trunkU(0) * m), 0]]);
  // Where a later interstate's route runs along an earlier one at its start or end (the router
  // reuses roads already laid), it is cut back to where it leaves: the two join there instead of
  // running side by side.
  const interstates = roads.filter(r => r.kind === 'interstate');
  for (let k = 1; k < interstates.length; k++) {
    const road = interstates[k], earlier = interstates.slice(0, k);
    const onEarlier = ([x, y]) => earlier.some(e => e.points.some((q, i) => i > 0 && distToSegment(x, y, e.points[i - 1], q) < 0.6));
    while (road.points.length > 2 && onEarlier(road.points[0]) && onEarlier(road.points[1])) road.points.shift();
    while (road.points.length > 2 && onEarlier(road.points.at(-1)) && onEarlier(road.points.at(-2))) road.points.pop();
  }

  // Beltways and bypasses: built as smooth rings round the centre, bridging whatever rivers they
  // meet (as real ones are), stepped outward where the ring would run into a lake.
  const ring = (s, kind, name, radius, from = 0, to = 2 * Math.PI) => {
    const steps = Math.max(6, Math.round(28 * (to - from) / (2 * Math.PI))), points = [];
    for (let a = 0; a <= steps; a++) {
      const t = from + (to - from) * a / steps;
      let r = radius, x, y;
      do { x = clamp(s.x + r * Math.cos(t), 1, m - 2); y = clamp(s.y + r * Math.sin(t), 1, m - 2); r += 0.5; } while (wet[Math.floor(y) * m + Math.floor(x)] && r < 3 * radius);
      points.push([Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
    }
    roads.push({ kind, name, points });
  };
  ring(metro, 'interstate', 'I-435', Math.round(metro.extentMi * p.beltwayShare.metro));
  if (city) ring(city, 'interstate', 'I-235', Math.round(city.extentMi * p.beltwayShare.city));

  // Expressways out from the metro and the mid city: to the biggest nearby towns that lie in a
  // direction no interstate or expressway already leaves in.
  // Directions (radians) in which the interstates and expressways cross a circle round a place.
  const leaving = s => {
    const radius = 1.2 * s.extentMi, angles = [];
    for (const r of roads) {
      if (r.kind === 'highway') continue;
      for (let i = 1; i < r.points.length; i++) {
        const [x0, y0] = r.points[i - 1], [x1, y1] = r.points[i], d0 = Math.hypot(x0 - s.x, y0 - s.y), d1 = Math.hypot(x1 - s.x, y1 - s.y);
        if ((d0 - radius) * (d1 - radius) > 0) continue;
        const t = d1 === d0 ? 0 : (radius - d0) / (d1 - d0);
        angles.push(Math.atan2(y0 + (y1 - y0) * t - s.y, x0 + (x1 - x0) * t - s.x));
      }
    }
    return angles;
  };
  const apart = (a, b) => Math.abs(((a - b + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 180 / Math.PI;
  for (const [s, count, prefix] of [[metro, p.expressways.metro, 'US-'], [city, p.expressways.city, 'US-']]) {
    if (!s) continue;
    const taken = leaving(s);
    const options = settlements.filter(t => t !== s && t.population >= p.expresswayPopulation && Math.hypot(t.x - s.x, t.y - s.y) > s.extentMi + 5 && Math.hypot(t.x - s.x, t.y - s.y) < p.expresswayMi)
      .sort((a, b) => b.population / Math.hypot(b.x - s.x, b.y - s.y) - a.population / Math.hypot(a.x - s.x, a.y - s.y));
    let made = 0;
    for (const t of options) {
      if (made >= count) break;
      const angle = Math.atan2(t.y - s.y, t.x - s.x);
      if (taken.some(a => apart(a, angle) < p.expresswayAngle)) continue;
      taken.push(angle); made++;
      chain('expressway', `${prefix}${50 + ((4 * roads.length) % 300)} ${s.name} – ${t.name}`, [[s.x, s.y], [t.x, t.y]], { ...p.expressway, clearMi: s.extentMi });
    }
  }
  // Small cities: a bypass round the half of town away from the main road's approach.
  for (const s of smallCities) {
    const out = leaving(s)[0] ?? 0;
    ring(s, 'expressway', `${s.name} bypass`, Math.round(s.extentMi + 2), out + Math.PI / 2, out + 3 * Math.PI / 2);
  }

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

function distToSegment(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
  return Math.hypot(ax + dx * t - x, ay + dy * t - y);
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

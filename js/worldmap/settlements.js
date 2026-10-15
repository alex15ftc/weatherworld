// Where people live on the world map and the main roads between them, worked out from the land:
// a metro where a big river meets the trunk river (as Kansas City sits where the Kansas meets the
// Missouri), a mid-size city on a large river near the middle, small cities and towns on good
// ground near water, spaced more widely where the land is drier or rougher. Interstates join the
// cities, laid out like I-70 (east-west through the metro), I-35 (metro to the mid city and on
// to the map edge beyond it) and I-29 (north along the trunk river). US routes run through on a
// grid of lines and state highways join the larger towns. Interstates are limited access: other
// roads cross them straight, never run along them nor cross by an interstate junction; no road
// turns or meets another in a river.
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
import { riverCorners } from './sectionRoads.js';

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
  interstate: { diagonalScale: 0.1, turnCost: 4, interstateCost: 3, clearMi: 2, crossCost: 40 },
  // Expressways keep apart from the interstates outside the city they leave (a parallel
  // interstate costs this many times a fresh road).
  expressway: { diagonalScale: 0.4, turnCost: 2.5, interstateCost: 3 },
  // Beltways at this share of the way out through the suburbs; expressways from the metro and
  // the mid city to up to this many larger towns (at least expresswayPopulation people, within
  // expresswayMi), each leaving at least expresswayAngle degrees from the other roads out.
  beltwayShare: { metro: 0.6, city: 0.65 }, expressways: { metro: 4, city: 3 }, expresswayPopulation: 1000, expresswayMi: 60, expresswayAngle: 30,
  // US routes: long through routes, east-west about every usSpacingMi of latitude and north-south
  // about every usSpacingMi of longitude, each through the largest town in every usWindowMi
  // stretch within usBandMi of its line; a line an interstate already follows is left to it.
  // They keep off the interstates (a parallel interstate costs usInterstateCost times a fresh road).
  interstateCrossCost: 4,   // added to a highway's cost to cross an interstate
  usSpacingMi: 45, usWindowMi: 40, usBandMi: 14, usInterstateCost: 2,
  // State highways join every town of at least statePopulation (and the cities) to the network:
  // the shortest links that connect them all, and stateExtraShare more for loops.
  statePopulation: 500, stateExtraShare: 0.12,
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
  // Corners in a river: no town is centred on one (its roads would meet on a bridge).
  const inRiver = riverCorners(rivers, m);
  const margin = p.edgeMarginMi;
  const appeal = K => {
    const I = K % m, J = (K / m) | 0;
    if (I < margin || J < margin || I >= m - margin || J >= m - margin || wet[K] || inRiver[K]) return 0;
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
  metroAt.x = Math.round(metroAt.x); metroAt.y = Math.round(metroAt.y);   // on a section corner, the nearest dry one
  for (let r = 1; inRiver[metroAt.y * m + metroAt.x] && r < 4; r++) {
    const dry = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!inRiver[(metroAt.y + dy) * m + metroAt.x + dx]) dry.push([Math.hypot(dx, dy), dx, dy]);
    if (dry.length) { const [, dx, dy] = dry.sort((a, b) => a[0] - b[0])[0]; metroAt.x += dx; metroAt.y += dy; }
  }
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

  const roads = planRoads(map, p, settlements, { m, per, drain, slope, regionKey, wet, inRiver });
  return { settlements, roads };
}

// Least-cost routes over the corners of the 1-mile grid (8 neighbours). Cost per mile: 1 + slope +
// rough ground, plus a toll for crossing rivers (bridges are dear), less where a road already
// runs; more for a diagonal on flat ground and for each turn. The search state is the corner and
// the way the road arrived there, so turns can be charged; no turn sharper than a right angle.
function planRoads(map, p, settlements, grid) {
  const { m, drain, slope, regionKey, wet, inRiver } = grid;
  // At a corner in a river a road goes straight across (a bridge), and only roads along one line
  // share it: the directions (bits of d % 4) roads already cross each such corner in.
  const riverAxis = new Uint8Array(m * m);
  const base = new Float64Array(m * m), diagonal = new Float64Array(m * m), onRoad = new Uint8Array(m * m), onInterstate = new Uint8Array(m * m);
  // Corners within a mile of where interstates meet: their ramps are there, so no other road
  // crosses an interstate on them. (onInterstate holds which interstate, 1 up.)
  const nearJunction = new Uint8Array(m * m);
  const markInterstate = (K, id) => {
    if (onInterstate[K] && onInterstate[K] !== id) {
      const x = K % m, y = (K / m) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) nearJunction[clampCell(y + dy) * m + clampCell(x + dx)] = 1;
    }
    onInterstate[K] = id;
  };
  let interstateId = 0, reusedShare = 0;
  for (let K = 0; K < m * m; K++) {
    base[K] = 1 + p.slopeCost * slope[K] + (p.roughCost[regionKey[K]] ?? 0) + (wet[K] ? p.lakeCost : 0)
      + (drain[K] >= p.bigRiverMi2 ? p.bigRiverCost : drain[K] >= map.params.riverAreaMi2 ? p.smallRiverCost : 0);
    diagonal[K] = 1 + p.diagonalCost * Math.exp(-slope[K] / p.flatSlope) * (p.roughCost[regionKey[K]] ? 0.25 : 1);
  }
  const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
  const states = m * m * 8, cost = new Float64Array(states), from = new Int32Array(states), seen = new Int32Array(states), closed = new Int32Array(states);
  let heapK = new Int32Array(1 << 16), heapF = new Float64Array(1 << 16), generation = 0;

  // startDir: the way the road was already heading at the start (a route through several
  // places goes on from each without doubling back); -1 for a fresh start.
  let endDir = -1;
  function route(ax, ay, bx, by, style = { diagonalScale: 1, turnCost: p.turnCost }, startDir = -1) {
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
    for (let d = 0; d < 8; d++) { if (startDir >= 0 && d !== startDir) continue; const S = start * 8 + d; cost[S] = 0; from[S] = -1; seen[S] = generation; push(S, h(start)); }
    let end = -1;
    while (size) {
      const S = pop(), K = S >> 3, din = S & 7;
      if (K === goal) { end = S; break; }
      if (closed[S] === generation) continue;
      closed[S] = generation;
      const x = K % m, y = (K / m) | 0, first = from[S] < 0;
      for (let d = 0; d < 8; d++) {
        const bend = Math.min(Math.abs(d - din), 8 - Math.abs(d - din));
        const fresh = first && startDir < 0;
        if (bend > 2 && !fresh) continue;   // no sharper than a right angle, at a waypoint too
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= m || ny >= m) continue;
        const N = ny * m + nx, T = N * 8 + d;
        // Interstates are limited access: other roads may cross one but never run along it.
        if (onInterstate[N] && onInterstate[K]) continue;
        // and cross it straight (the interchange's ramps meet the road on either side).
        if (onInterstate[K] && bend && !first && style !== p.interstate) continue;
        if (nearJunction[N] && onInterstate[N] && N !== goal && style !== p.interstate) continue;
        // A diagonal step across a diagonal interstate (between its corners) crosses it too.
        const sideA = y * m + nx, sideB = ny * m + x;
        const across = (d & 1) && onInterstate[sideA] && onInterstate[sideB] && !onInterstate[N] && !onInterstate[K];
        if (across && (nearJunction[sideA] || nearJunction[sideB]) && style !== p.interstate) continue;
        if (inRiver[K] && bend && !first) continue;
        if (inRiver[N] && riverAxis[N] && !(riverAxis[N] & (1 << (d & 3)))) continue;
        const shared = onRoad[N] && onRoad[K], parallel = style.interstateCost && onInterstate[N] && Math.hypot(nx - ax, ny - ay) > (style.clearMi ?? 0);
        const step = (d & 1 ? Math.SQRT2 * (1 + style.diagonalScale * ((diagonal[N] + diagonal[K]) / 2 - 1)) : 1) * (base[N] + base[K]) / 2 * (parallel ? style.interstateCost : shared && style.reuse !== false ? p.reuseDiscount : 1)
          + (fresh ? 0 : style.turnCost * bend * (bend > 2 ? 3 : 1))
          // Each crossing of an interstate is a bridge and ramps (a system interchange for another
          // interstate): dear, so routes cross once rather than weaving.
          + ((onInterstate[N] && !onInterstate[K] && N !== goal) || across ? style.crossCost ?? p.interstateCrossCost : 0);
        const total = cost[S] + step;
        if (seen[T] !== generation || total < cost[T]) { seen[T] = generation; cost[T] = total; from[T] = S; push(T, total + h(N)); }
      }
    }
    const path = [];
    endDir = end >= 0 && from[end] >= 0 ? end & 7 : startDir;
    for (let S = end; S >= 0; S = from[S]) path.push(S >> 3);
    path.reverse();
    reusedShare = path.length ? path.filter(K => onRoad[K]).length / path.length : 0;
    for (const K of path) { onRoad[K] = 1; if (style === p.interstate) markInterstate(K, interstateId); }
    for (let i = 1; i < path.length; i++) {
      const dx = path[i] % m - path[i - 1] % m, dy = ((path[i] / m) | 0) - ((path[i - 1] / m) | 0), axis = 1 << (DX.findIndex((v, d) => v === dx && DY[d] === dy) & 3);
      if (inRiver[path[i]]) riverAxis[path[i]] |= axis;
      if (inRiver[path[i - 1]]) riverAxis[path[i - 1]] |= axis;
    }
    const points = simplify(path.map(K => [K % m, (K / m) | 0]), 0.45);
    // Ends off the grid (at the map's edges) are joined straight on.
    if (points.length && (points[0][0] !== ax || points[0][1] !== ay)) points.unshift([ax, ay]);
    if (points.length && (points.at(-1)[0] !== bx || points.at(-1)[1] !== by)) points.push([bx, by]);
    return points;
  }
  const clampCell = v => clamp(Math.floor(v), 0, m - 1);

  const roads = [], metro = settlements.find(s => s.kind === 'metro'), city = settlements.find(s => s.kind === 'city');
  const smallCities = settlements.filter(s => s.kind === 'smallCity');
  const chain = (kind, name, points, style = p[kind]) => {
    if (kind === 'interstate') interstateId = roads.length + 1;
    roads.push({ kind, name, points: chainLine(points, style) });
  };
  // Points through the given places in turn, heading on from each without doubling back.
  const chainLine = (points, style) => {
    const line = [];
    for (let i = 1; i < points.length; i++) {
      if (points[i][0] === points[i - 1][0] && points[i][1] === points[i - 1][1]) continue;
      const leg = route(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], style, i > 1 ? endDir : -1);
      line.push(...(line.length ? leg.slice(1) : leg));
    }
    // A hook where a leg overshoots a place by a few miles and doubles back: straightened.
    for (let i = 2; i < line.length; i++) {
      const [a, q, c] = [line[i - 2], line[i - 1], line[i]], u = [q[0] - a[0], q[1] - a[1]], v = [c[0] - q[0], c[1] - q[1]];
      if (Math.hypot(...u) <= 4.5 && (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v)) < -0.2) { line.splice(i - 1, 1); i = Math.max(1, i - 2); }
    }
    return line;
  };
  // Where a line turns back on itself (cos of the turn below -0.2).
  const reversals = line => line.filter((q, i) => {
    if (i < 1 || i >= line.length - 1) return false;
    const a = line[i - 1], c = line[i + 1], u = [q[0] - a[0], q[1] - a[1]], v = [c[0] - q[0], c[1] - q[1]];
    return (u[0] * v[0] + u[1] * v[1]) / ((Math.hypot(...u) * Math.hypot(...v)) || 1) < -0.2;
  });

  // I-70: across the map east to west through the metro and the small cities near its latitude.
  const band = smallCities.filter(s => Math.abs(s.y - metro.y) < 70 && s.x < metro.x).sort((a, b) => b.x - a.x);
  chain('interstate', 'I-70', [[m, metro.y], [metro.x, metro.y], ...band.map(s => [s.x, s.y]), [0, (band.at(-1) ?? metro).y]]);
  if (city) {
    // I-35: the metro to the mid city and on to the map edge beyond it (south, or north where the
    // city lies north of the metro), so it never doubles back.
    const southward = city.y >= metro.y;
    chain('interstate', 'I-35', [[metro.x, metro.y], [city.x, city.y], [city.x - 10, southward ? m : 0]]);
    // I-135: the mid city the other way, to the nearest small city.
    const branch = smallCities.filter(s => (southward ? s.y < city.y - 30 : s.y > city.y + 30)).sort((a, b) => Math.hypot(a.x - city.x, a.y - city.y) - Math.hypot(b.x - city.x, b.y - city.y))[0];
    if (branch) chain('interstate', 'I-135', [[city.x, city.y], [branch.x, branch.y]]);
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
    // Walk in from each end (a quarter mile at a time) to where it leaves the earlier ones, and
    // join it to the earlier one exactly there.
    const sharing = ([x, y]) => earlier.some(e => e.points.some((q, i) => i > 0 && distToSegment(x, y, e.points[i - 1], q) < 0.15));
    const snap = ([x, y], toward) => {
      let best = [x, y], bestD = Infinity;
      for (const e of earlier) for (let i = 1; i < e.points.length; i++) {
        const [ax, ay] = e.points[i - 1], [bx, by] = e.points[i], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t = l2 ? clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1) : 0, px = ax + dx * t, py = ay + dy * t, d = Math.hypot(px - x, py - y);
        if (d < bestD) { bestD = d; best = [Math.round(px * 100) / 100, Math.round(py * 100) / 100]; }
      }
      if (bestD >= 0.6) return [x, y];
      // Not on a bend of the earlier road (a T's ramps run straight along it): slide along it to
      // where it runs straight for 0.7 mi either side.
      for (const e of earlier) for (let i = 1; i < e.points.length - 1; i++) {
        const [vx, vy] = e.points[i];
        if (Math.hypot(vx - best[0], vy - best[1]) >= 0.7) continue;
        const [ax, ay] = e.points[i - 1], [bx, by] = e.points[i + 1];
        const la = Math.hypot(ax - vx, ay - vy), lb = Math.hypot(bx - vx, by - vy);
        if (((ax - vx) * (bx - vx) + (ay - vy) * (by - vy)) / (la * lb) < -0.99) continue;   // straight through
        // Onto the leg on the side the road comes from.
        const facing = ([qx, qy]) => (qx - vx) * (toward[0] - vx) + (qy - vy) * (toward[1] - vy);
        const [tx, ty, l] = facing([ax, ay]) / la >= facing([bx, by]) / lb ? [ax, ay, la] : [bx, by, lb];
        if (l < 1.5) continue;
        best = [Math.round((vx + (tx - vx) * 0.75 / l) * 100) / 100, Math.round((vy + (ty - vy) * 0.75 / l) * 100) / 100];
      }
      return best;
    };
    const trimStart = points => {
      if (!sharing(points[0])) return points;
      for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1], [bx, by] = points[i], len = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(len * 4));
        for (let k = 1; k <= steps; k++) {
          if (sharing([ax + (bx - ax) * k / steps, ay + (by - ay) * k / steps])) continue;
          const t = (k - 1) / steps;
          return [snap([ax + (bx - ax) * t, ay + (by - ay) * t], points[t >= 1 ? i + 1 : i] ?? [bx, by]), ...points.slice(t >= 1 ? i + 1 : i)].filter((q, j, all) => j === 0 || q[0] !== all[j - 1][0] || q[1] !== all[j - 1][1]);
        }
      }
      return points;
    };
    road.points = trimStart(road.points);
    road.points = trimStart(road.points.reverse()).reverse();
    // Nothing left of its own: it is the earlier one.
    if (road.points.every(onEarlier)) roads.splice(roads.indexOf(road), 1);
  }

  // Beltways and bypasses: built as smooth rings round the centre, bridging whatever rivers they
  // meet (as real ones are), stepped outward where the ring would run into a lake.
  const ring = (s, kind, name, radius, from = 0, to = 2 * Math.PI) => {
    const steps = Math.max(12, Math.round(72 * (to - from) / (2 * Math.PI))), points = [];
    for (let a = 0; a <= steps; a++) {
      const t = from + (to - from) * a / steps;
      let r = radius, x, y;
      do { x = clamp(s.x + r * Math.cos(t), 1, m - 2); y = clamp(s.y + r * Math.sin(t), 1, m - 2); r += 0.5; } while (wet[Math.floor(y) * m + Math.floor(x)] && r < 3 * radius);
      points.push([Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
    }
    roads.push({ kind, name, points });
    // A ring interstate's corners are limited access too.
    if (kind === 'interstate') for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1], [x1, y1] = points[i], steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 4);
      for (let k = 0; k <= steps; k++) markInterstate(clampCell(Math.round(y0 + (y1 - y0) * k / steps)) * m + clampCell(Math.round(x0 + (x1 - x0) * k / steps)), roads.length);
    }
  };
  ring(metro, 'interstate', 'I-435', Math.round(metro.extentMi * p.beltwayShare.metro));
  if (city) ring(city, 'interstate', 'I-235', Math.round(city.extentMi * p.beltwayShare.city));

  // Where the other roads meet in a place: its centre, or, where an interstate runs through the
  // centre, the nearest dry corner beside it (roads reach it across the interstate by interchange
  // or overpass, never meeting the interstate at grade).
  const hub = st => {
    const at = (x, y) => clampCell(y) * m + clampCell(x);
    if (!onInterstate[at(st.x, st.y)]) return [st.x, st.y];
    for (let r = 1; r <= 3; r++) {
      const options = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const K = at(st.x + dx, st.y + dy);
        if (!onInterstate[K] && !inRiver[K] && !wet[K]) options.push([Math.hypot(dx, dy), st.x + dx, st.y + dy]);
      }
      if (options.length) { const [, x, y] = options.sort((a, b) => a[0] - b[0])[0]; return [x, y]; }
    }
    return [st.x, st.y];
  };

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
      chain('expressway', `${prefix}${50 + ((4 * roads.length) % 300)} ${s.name} – ${t.name}`, [hub(s), hub(t)], { ...p.expressway, clearMi: s.extentMi });
    }
  }
  // Small cities: a bypass round the half of town away from the main road's approach.
  for (const s of smallCities) {
    const out = leaving(s)[0] ?? 0;
    ring(s, 'expressway', `${s.name} bypass`, Math.round(s.extentMi + 2), out + Math.PI / 2, out + 3 * Math.PI / 2);
  }

  // US routes. Numbered as the US system is: even numbers east-west, rising from north to south;
  // odd numbers north-south, rising from east to west.
  const EAST_WEST = ['US-36', 'US-24', 'US-40', 'US-50', 'US-56', 'US-54', 'US-160', 'US-166', 'US-400', 'US-412', 'US-60'];
  const NORTH_SOUTH = ['US-59', 'US-69', 'US-73', 'US-75', 'US-77', 'US-81', 'US-83', 'US-183', 'US-283', 'US-383', 'US-385'];
  const interstateLines = roads.filter(r => r.kind === 'interstate');
  const interstateNear = (x, y, eastWest) => interstateLines.some(r => r.points.some((q, i) => {
    if (i === 0) return false;
    const pr = r.points[i - 1], dx = q[0] - pr[0], dy = q[1] - pr[1];
    const along = eastWest ? Math.abs(dx) > Math.abs(dy) : Math.abs(dy) > Math.abs(dx);
    return along && distToSegment(x, y, pr, q) < 8;
  }));
  const usRoutes = [];
  for (const eastWest of [true, false]) {
    const lines = [];
    for (let at = p.usSpacingMi * 0.6; at < m - 10; at += p.usSpacingMi) {
      // Left to an interstate already running this way along the line for most of it.
      let followed = 0, samples = 0;
      for (let t = 10; t < m - 10; t += 10) { samples++; if (interstateNear(eastWest ? t : at, eastWest ? at : t, eastWest)) followed++; }
      if (followed > samples * 0.4) continue;
      const stops = [];
      for (let w = 0; w < m; w += p.usWindowMi) {
        const inWindow = settlements.filter(st => (eastWest ? st.x : st.y) >= w && (eastWest ? st.x : st.y) < w + p.usWindowMi && Math.abs((eastWest ? st.y : st.x) - at) < p.usBandMi);
        const best = inWindow.sort((a, b) => b.population - a.population)[0];
        if (best) stops.push(hub(best));
      }
      if (stops.length < 3) continue;
      lines.push({ at, stops });
    }
    // Names in order across the map.
    lines.sort((a, b) => (eastWest ? a.at - b.at : b.at - a.at));
    lines.forEach((line, i) => {
      const names = eastWest ? EAST_WEST : NORTH_SOUTH;
      const name = names[Math.min(i, names.length - 1)];
      // A stop the route would have to turn back from (a spur out and back) is left to the state
      // highways.
      const stops = line.stops;
      for (let i = 1; i < stops.length - 1; i++) {
        const [a, q, c] = [stops[i - 1], stops[i], stops[i + 1]], u = [q[0] - a[0], q[1] - a[1]], v = [c[0] - q[0], c[1] - q[1]];
        if ((u[0] * v[0] + u[1] * v[1]) / ((Math.hypot(...u) * Math.hypot(...v)) || 1) < -0.17) { stops.splice(i, 1); i = 0; }
      }
      const first = line.stops[0], last = line.stops.at(-1);
      const ends = eastWest ? [[0, first[1]], ...line.stops, [m, last[1]]] : [[first[0], 0], ...line.stops, [last[0], m]];
      // A town the route would have to turn back from (a spur out and back) is left to the state
      // highways: the route is laid again without it.
      const style = { diagonalScale: 1, turnCost: p.turnCost, interstateCost: p.usInterstateCost, clearMi: 3 };
      let points = chainLine(ends, style);
      for (let tries = 0; tries < 10; tries++) {
        const back = reversals(points);
        // The town nearest a turn back (within 3 mi).
        let drop = -1, best = 3;
        ends.forEach((e, i) => { if (i > 0 && i < ends.length - 1) for (const q of back) { const d = Math.hypot(q[0] - e[0], q[1] - e[1]); if (d < best) { best = d; drop = i; } } });
        if (drop < 0) break;
        ends.splice(drop, 1);
        points = chainLine(ends, style);
      }
      roads.push({ kind: 'highway', name, points });
      usRoutes.push(roads.at(-1));
    });
  }

  // State highways: the towns large enough, joined into one network by the shortest links between
  // natural neighbours (a relative neighbourhood graph), towns on the same US route counting as
  // joined already; a few more links make loops.
  const served = settlements.filter(st => st.kind !== 'town' || st.population >= p.statePopulation);
  const parent = served.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a, b) => { parent[find(a)] = find(b); };
  const onRoute = st => usRoutes.find(r => r.points.some((q, i) => i > 0 && distToSegment(st.x, st.y, r.points[i - 1], q) < 1.5));
  const routeOf = served.map(onRoute);
  for (let a = 0; a < served.length; a++) for (let b = a + 1; b < served.length; b++) if (routeOf[a] && routeOf[a] === routeOf[b]) join(a, b);
  const edges = [];
  for (let a = 0; a < served.length; a++) {
    for (let b = a + 1; b < served.length; b++) {
      const A = served[a], B = served[b], d = Math.hypot(A.x - B.x, A.y - B.y);
      if (d > 70) continue;
      const blocked = served.some((o, i) => i !== a && i !== b && Math.max(Math.hypot(o.x - A.x, o.y - A.y), Math.hypot(o.x - B.x, o.y - B.y)) < d);
      if (!blocked) edges.push({ a, b, d });
    }
  }
  edges.sort((e, f) => e.d - f.d);
  const chosen = [], spare = [];
  for (const e of edges) {
    if (find(e.a) !== find(e.b)) { join(e.a, e.b); chosen.push(e); } else if (!(routeOf[e.a] && routeOf[e.a] === routeOf[e.b])) spare.push(e);
  }
  chosen.push(...spare.slice(0, Math.round(chosen.length * p.stateExtraShare)));
  // Numbered across the map from the north-west.
  chosen.sort((e, f) => (served[e.a].y + served[e.b].y) - (served[f.a].y + served[f.b].y) || (served[e.a].x - served[f.a].x));
  chosen.forEach((e, i) => {
    const A = served[e.a], B = served[e.b];
    const [ax, ay] = hub(A), [bx, by] = hub(B);
    const points = route(ax, ay, bx, by);
    // Already served: the way there runs almost all on highways laid before.
    if (reusedShare <= 0.8) roads.push({ kind: 'highway', name: `K-${(i + 1) * 2 + 2}`, points });
  });
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

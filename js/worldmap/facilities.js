// What stands on the land besides the towns' streets and houses: energy (wind farms, farm
// windmills, oil and gas wells), schools and colleges, and gas stations. Planned last, once the
// roads, section roads, interchanges and airfields are down, and kept clear of all of them.
//
// Energy, by region (as across Kansas):
//   - Wind farms on high, open farm and range land where the wind is steadiest: most in the High
//     Plains and Smoky Hills, some in the Red Hills (as Flat Ridge in Barber County) and on the
//     Flint Hills' edge, few in the wetter east. Turbines stand in strings across the prevailing
//     south and north winds (east-west), half a mile off the section lines, about 0.28 mi apart
//     along a string and a mile between strings (about 4 and 10 rotor diameters), each reached by
//     a gravel road. The farms are shared out between those regions (wind.quota). Farms keep well away from towns, airports and the weather radars (turbines
//     clutter a radar's view; the NWS asks for space round them). Each farm has a substation.
//   - Farm windmills (water pumps over stock tanks) on pasture: grassland, Sandhills range, the
//     Flint Hills' tallgrass and the Red Hills' range.
//   - Oil and gas fields in patches: oil pumpjacks thickest over the Smoky Hills (as the Central
//     Kansas Uplift round Russell and Ellis), the Red Hills and the Flint Hills' edge (as El
//     Dorado), fewer in the east; gas wells in the High Plains (as the Hugoton field). Wells
//     stand on a 40-acre (quarter-mile) spacing, not every spot drilled, each on a lease road to
//     the nearest section line, with a tank battery for every few oil wells.
// Schools (every place of schoolMinPopulation or more): a small town has an elementary school and
// a junior-senior high; larger places an elementary school for about every 4,500 people, a middle
// school for every 14,000 and a high school for every 25,000, spread over the town and its
// suburbs as people are. Colleges: a community college in each small city and city, a state
// university in the city and a large university and community colleges in the metro, each on its
// own campus between the arterials. Every school and campus has parking lots.
// Gas stations: about one for every 2,200 people in a place of gasMinPopulation or more (at least
// one), a one-in-gasSmallChance chance of one in a smaller place; small (two pumps) in the
// smallest places up to large (eight to twelve) in cities; truck stops (car and diesel islands,
// truck parking) at some interstate exits. All on the main roads and arterials.
//
// Lots face a road: laid out in feet along the road (al) and back from it (ac), and stored in map
// miles.
import { makeNoise, makeRandom, hashText, fbm, clamp } from './noise.js';
import { interchangeRamps } from './interchanges.js';
import { pointInPoly, nearestOnSegment, distToSeg, segmentIntersection } from './airfields.js';

const FT = 1 / 5280;

export const FACILITY_DEFAULTS = Object.freeze({
  wind: { weight: { highPlains: 1, smokyHills: 0.9, redHills: 0.6, flintHills: 0.35, midwest: 0.1, sandhills: 0.15, ozarkEdge: 0 }, farms: 9, quota: { highPlains: 4, smokyHills: 3, redHills: 1, flintHills: 1 }, spacingMi: 35, alongMi: 0.28, widthMi: [7, 14], depthMi: [4, 8], townClearMi: 2.5, airfieldClearMi: 5, radarClearMi: 6 },
  oil: { weight: { highPlains: 0.55, smokyHills: 1, redHills: 0.7, flintHills: 0.6, midwest: 0.2, sandhills: 0.05, ozarkEdge: 0 }, fieldMi: 14, threshold: 0.76, drilled: 0.22, gasRegions: ['highPlains'], tankEvery: 8 },
  windmills: { covers: ['grassland', 'sandhillGrass', 'tallgrass', 'redRange'], perMi2: 0.08 },
  schoolMinPopulation: 1000, smallTownPopulation: 3000, peoplePer: { elementary: 4500, middle: 14000, high: 25000 },
  gasMinPopulation: 1000, gasPeoplePer: 2200, gasSmallChance: 0.25, truckStopChance: { rural: 0.35, town: 0.15 }
});

const ELEMENTARY_NAMES = ['Lincoln', 'Washington', 'Jefferson', 'Roosevelt', 'Eisenhower', 'Garfield', 'Prairie View', 'Sunflower', 'Meadowlark', 'Cottonwood', 'Westridge', 'Sunset Hills', 'Lakeview', 'Oak Park', 'Riverside', 'Highland', 'Pleasant Valley', 'Hillcrest', 'Wheatland', 'Bluestem', 'Indian Hills', 'Fairview', 'Park Hill', 'Mill Creek', 'Stone Creek', 'Woodland', 'Prairie Ridge', 'Cedar Hills', 'Heritage', 'Pioneer', 'Santa Fe Trail', 'Chisholm Trail', 'Kenwood', 'Brookside', 'Windsor', 'Clearwater', 'Briarwood', 'Countryside', 'Lone Elm', 'Shawnee Mission'];
const SIDES = ['North', 'South', 'East', 'West', 'Central', 'Northwest', 'Southeast', 'Northeast', 'Southwest'];
// The j-th name of a list, with a side added once the list runs out (Lincoln, ..., Lincoln North).
const named = (list, j) => list[j % list.length] + (j >= list.length ? ` ${SIDES[(Math.floor(j / list.length) - 1) % SIDES.length]}` : '') + (j >= list.length * (SIDES.length + 1) ? ` ${Math.floor(j / (list.length * (SIDES.length + 1))) + 1}` : '');
const SCHOOL_NAMES = ['Lincoln', 'Truman', 'Eisenhower', 'Kennedy', 'Roosevelt', 'Jefferson', 'Madison', 'Monroe', 'Marshall', 'Wilson', 'Hoover', 'Coolidge', 'Grant', 'Adams', 'Jackson', 'Franklin', 'Earhart', 'Carver', 'Douglass', 'Sequoyah', 'Pawnee Trail', 'Heritage', 'Liberty', 'Prairie Hills', 'Blue Valley', 'Mill Valley', 'Olathe Trail', 'Shawnee Heights', 'Indian Trail', 'Oregon Trail', 'Mission Valley', 'Sunflower', 'Cottonwood', 'Wheatland', 'Meadowbrook', 'Southwind', 'Northridge', 'Westview', 'Eastside', 'Lakewood'];

// ---------------------------------------------------------------------------
// Lot layouts (feet; al along the road, ac back from its edge; the lot spans al -W/2..W/2 and ac
// 0..D). Each returns its parts as rectangles [al0, ac0, al1, ac1], and points.

function gasLayout(size) {
  if (size === 'truck stop') {
    const pumps = [], diesel = [];
    for (let k = 0; k < 4; k++) for (const ac of [65, 95]) pumps.push([-230 + 55 * k, ac]);
    for (let k = 0; k < 6; k++) diesel.push([70 + 38 * k, 115]);
    return { W: 620, D: 460, canopy: [[-250, 40, -50, 120], [50, 60, 290, 170]], pumps, diesel, store: [-260, 170, -40, 280], parking: [[-280, 300, -30, 400], [20, 220, 300, 440]], truckParking: true, drives: [-200, 0, 200] };
  }
  const tiers = {
    small: { W: 150, D: 150, canopy: [-50, 30, 50, 70], rows: [50], per: 1, store: [-40, 100, 40, 140], parking: [45, 95, 72, 145] },
    medium: { W: 220, D: 185, canopy: [-75, 30, 75, 82], rows: [56], per: 2, store: [-60, 115, 60, 170], parking: [65, 110, 105, 178] },
    large: { W: 300, D: 235, canopy: [-110, 30, 110, 100], rows: [52, 80], per: 3, store: [-85, 140, 85, 215], parking: [92, 130, 145, 222] },
    xl: { W: 360, D: 260, canopy: [-140, 30, 140, 105], rows: [52, 82], per: 4, store: [-100, 150, 100, 235], parking: [108, 130, 172, 245] }
  };
  const t = tiers[size], pumps = [];
  // Islands of two dispensers (one each side), per row.
  for (const ac of t.rows) for (let k = 0; k < t.per; k++) { const al = t.canopy[0] + (t.canopy[2] - t.canopy[0]) * (k + 0.5) / t.per; pumps.push([al - 9, ac], [al + 9, ac]); }
  return { W: t.W, D: t.D, canopy: [t.canopy], pumps, diesel: [], store: t.store, parking: [t.parking], drives: [-t.W / 2 + 25, t.W / 2 - 25] };
}

// Schools: the building, its parking and bus loop, and its playground or fields.
function schoolLayout(level) {
  if (level === 'elementary') return { W: 620, D: 520, building: [[-150, 130, 150, 270], [-150, 270, -60, 340]], parking: [[-290, 40, -170, 220]], loop: [[-150, 40], [150, 40], [150, 110], [-150, 110], [-150, 40]], fields: [{ kind: 'playground', r: [180, 150, 290, 300] }, { kind: 'field', r: [-220, 360, 220, 500] }] };
  if (level === 'middle') return { W: 820, D: 680, building: [[-200, 130, 200, 310], [-200, 310, -80, 400]], parking: [[-390, 40, -220, 290], [220, 40, 390, 160]], loop: [[-200, 40], [200, 40], [200, 110], [-200, 110], [-200, 40]], fields: [{ kind: 'track', r: [-280, 420, 280, 660] }, { kind: 'baseball', r: [230, 200, 400, 380] }] };
  if (level === 'juniorSenior') return { W: 920, D: 740, building: [[-220, 130, 220, 330], [-220, 330, -100, 420]], parking: [[-440, 40, -240, 320]], loop: [[-220, 40], [220, 40], [220, 110], [-220, 110], [-220, 40]], fields: [{ kind: 'track', r: [-300, 440, 300, 720] }, { kind: 'baseball', r: [260, 150, 440, 340] }] };
  return { W: 1320, D: 1020, building: [[-300, 150, 300, 420], [-300, 420, -150, 520], [150, 420, 300, 520]], parking: [[-640, 40, -330, 460], [330, 40, 640, 300]], loop: [[-300, 40], [300, 40], [300, 120], [-300, 120], [-300, 40]], fields: [{ kind: 'track', r: [-300, 580, 300, 960] }, { kind: 'baseball', r: [360, 560, 640, 840] }, { kind: 'field', r: [-640, 560, -360, 960] }] };
}

// ---------------------------------------------------------------------------

export function planFacilities(map, options = {}) {
  const p = { ...FACILITY_DEFAULTS, ...options };
  const { size: n, cellMiles, elevation, cover, coverKeys, coverRegion, regionKeys, rivers, settlements, roads, sections, crossings = [], airfields = [] } = map;
  const miles = n * cellMiles, seed = map.params.seed;
  const random = makeRandom(hashText(`${seed}|facilities`));
  const water = coverKeys.indexOf('water'), townCover = new Set([coverKeys.indexOf('urban'), coverKeys.indexOf('suburban')]);
  const cellAt = (x, y) => clamp(Math.floor(y / cellMiles), 0, n - 1) * n + clamp(Math.floor(x / cellMiles), 0, n - 1);
  const regionAt = (x, y) => regionKeys[coverRegion[cellAt(x, y)]];
  const r4 = v => Math.round(v * 1e4) / 1e4;
  const slopeAt = (x, y) => {
    const d = cellMiles, h = (a, b) => elevation[cellAt(a, b)];
    return Math.hypot(h(x + d, y) - h(x - d, y), h(x, y + d) - h(x, y - d)) / (2 * d * 1609.344);
  };

  // Everything a lot must keep clear of: roads, ramps, rivers (segments with half-widths), the
  // section-line roads, airfield fences and what has been placed already.
  const index = new Map();
  const cellsOf = (x0, y0, x1, y1, step) => {
    const out = [];
    for (let X = Math.floor(x0 / step); X <= Math.floor(x1 / step); X++) for (let Y = Math.floor(y0 / step); Y <= Math.floor(y1 / step); Y++) out.push(X * 65536 + Y);
    return out;
  };
  const addSeg = seg => { for (const key of cellsOf(Math.min(seg.ax, seg.bx) - seg.half, Math.min(seg.ay, seg.by) - seg.half, Math.max(seg.ax, seg.bx) + seg.half, Math.max(seg.ay, seg.by) + seg.half, 1)) { if (!index.has(key)) index.set(key, []); index.get(key).push(seg); } };
  const HALF = { interstate: 0.051, expressway: 0.039, highway: 0.018 };
  for (const road of roads) for (let i = 1; i < road.points.length; i++) addSeg({ type: 'road', road, kind: road.kind, ax: road.points[i - 1][0], ay: road.points[i - 1][1], bx: road.points[i][0], by: road.points[i][1], half: HALF[road.kind] ?? 0.018 });
  for (const c of crossings) for (const ramp of interchangeRamps(c)) for (let i = 1; i < ramp.length; i++) addSeg({ type: 'ramp', ax: ramp[i - 1][0], ay: ramp[i - 1][1], bx: ramp[i][0], by: ramp[i][1], half: 0.011 });
  for (const river of rivers) for (let k = 2; k < river.points.length; k += 2) addSeg({ type: 'river', ax: river.points[k - 2], ay: river.points[k - 1], bx: river.points[k], by: river.points[k + 1], half: Math.min(220, Math.max(12, river.widthsM[k / 2] * 0.18)) / 2000 + 0.01 });
  const segsNear = (x0, y0, x1, y1) => { const found = new Set(); for (const key of cellsOf(x0 - 0.1, y0 - 0.1, x1 + 0.1, y1 + 0.1, 1)) for (const s of index.get(key) ?? []) found.add(s); return found; };
  const SECTION_HALF = [0, 0.008, 0.01, 0.013];
  const sectionClass = (I, J, east) => { if (I < 0 || J < 0 || I >= sections.size || J >= sections.size) return 0; const v = sections.roads[J * sections.size + I]; return east ? v & 3 : (v >> 2) & 3; };
  const fences = airfields.map(a => ({ poly: a.fence, box: bboxOf(a.fence) }));
  const taken = new Map();   // 0.25-mile cells -> boxes of what is placed
  const take = box => { for (const key of cellsOf(box[0], box[1], box[2], box[3], 0.25)) { if (!taken.has(key)) taken.set(key, []); taken.get(key).push(box); } };
  const isTaken = (box, pad) => cellsOf(box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad, 0.25).some(key => (taken.get(key) ?? []).some(o => box[0] - pad < o[2] && box[2] + pad > o[0] && box[1] - pad < o[3] && box[3] + pad > o[1]));

  // Whether a polygon (map miles) stands clear, pad miles beyond every road's edge.
  const clear = (poly, pad = 0.004) => {
    const box = bboxOf(poly);
    if (box[0] < 1 || box[1] < 1 || box[2] > miles - 1 || box[3] > miles - 1) return false;
    for (const q of [...poly, [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]]) if (cover[cellAt(q[0], q[1])] === water) return false;
    for (const s of segsNear(...box)) if (segPolyDist(s, poly) < s.half + pad) return false;
    // Section roads on the mile lines near the lot.
    for (let I = Math.ceil(box[0] - 0.05); I <= Math.floor(box[2] + 0.05); I++) for (let J = Math.floor(box[1] - 0.05); J <= Math.floor(box[3] + 0.05); J++) {
      const cls = sectionClass(I, J, false);
      if (cls && segPolyDist({ ax: I, ay: J, bx: I, by: J + 1 }, poly) < SECTION_HALF[cls] + pad) return false;
    }
    for (let J = Math.ceil(box[1] - 0.05); J <= Math.floor(box[3] + 0.05); J++) for (let I = Math.floor(box[0] - 0.05); I <= Math.floor(box[2] + 0.05); I++) {
      const cls = sectionClass(I, J, true);
      if (cls && segPolyDist({ ax: I, ay: J, bx: I + 1, by: J }, poly) < SECTION_HALF[cls] + pad) return false;
    }
    for (const f of fences) if (box[0] < f.box[2] + 0.05 && box[2] > f.box[0] - 0.05 && box[1] < f.box[3] + 0.05 && box[3] > f.box[1] - 0.05 && (poly.some(([x, y]) => pointInPoly(x, y, f.poly)) || f.poly.some(([x, y]) => pointInPoly(x, y, poly)))) return false;
    return !isTaken(box, 0.006);
  };
  const pointClear = (x, y, roadGap, lineGap) => {
    if (x < 1 || y < 1 || x > miles - 1 || y > miles - 1 || cover[cellAt(x, y)] === water) return false;
    if (Math.abs(x - Math.round(x)) < lineGap || Math.abs(y - Math.round(y)) < lineGap) return false;
    for (const s of segsNear(x, y, x, y)) if (distToSeg(x, y, s) < s.half + roadGap) return false;
    for (const f of fences) if (x > f.box[0] - 0.3 && x < f.box[2] + 0.3 && y > f.box[1] - 0.3 && y < f.box[3] + 0.3) return false;
    return !isTaken([x - 0.01, y - 0.01, x + 0.01, y + 0.01], 0.01);
  };

  // A lot facing a road: line {ax, ay, bx, by, half}, centred at `at` miles along it, on `side`
  // (+1 to the right of a to b, -1 left). L(al, ac) maps lot feet to map miles.
  const frontage = (line, at, side, W, D) => {
    const len = Math.hypot(line.bx - line.ax, line.by - line.ay), ux = (line.bx - line.ax) / len, uy = (line.by - line.ay) / len;
    const nx = -uy * side, ny = ux * side, ox = line.ax + ux * at, oy = line.ay + uy * at, set = line.half + 0.006;
    const L = (al, ac) => [r4(ox + ux * al * FT + nx * (set + ac * FT)), r4(oy + uy * al * FT + ny * (set + ac * FT))];
    const R = ([a0, c0, a1, c1]) => [L(a0, c0), L(a1, c0), L(a1, c1), L(a0, c1)];
    return { L, R, lot: R([-W / 2, 0, W / 2, D]), edge: [r4(ox + nx * line.half), r4(oy + ny * line.half)], front: [r4(ox + nx * set), r4(oy + ny * set)] };
  };

  // The lines lots in a place may face: the highways through it and the paved mile lines in it.
  const linesIn = (st, reach) => {
    const out = [];
    for (const s of segsNear(st.x - reach, st.y - reach, st.x + reach, st.y + reach)) {
      if (s.type !== 'road' || s.kind === 'interstate') continue;
      const clip = clipToCircle(s, st.x, st.y, reach);
      if (clip && Math.hypot(clip.bx - clip.ax, clip.by - clip.ay) > 0.05) out.push({ ...clip, half: s.half, kind: 'road', name: s.road.name });
    }
    for (let I = Math.ceil(st.x - reach); I <= Math.floor(st.x + reach); I++) for (let J = Math.floor(st.y - reach); J <= Math.ceil(st.y + reach); J++) {
      for (const east of [true, false]) {
        const cls = sectionClass(I, J, east), [mx, my] = east ? [I + 0.5, J] : [I, J + 0.5];
        if (cls !== 3 || Math.hypot(mx - st.x, my - st.y) > reach) continue;
        out.push(east ? { ax: I, ay: J, bx: I + 1, by: J, half: 0.013, kind: 'section' } : { ax: I, ay: J, bx: I, by: J + 1, half: 0.013, kind: 'section' });
      }
    }
    return out;
  };

  // Places a lot near a point of a place: on the line nearest the point, at the point's place
  // along it and on its side, nudged along if that spot is taken.
  const placeLot = (lines, target, W, D, prefer = () => 1) => {
    const scored = lines.map(line => {
      const [px, py] = nearestOnSegment(target[0], target[1], line);
      return { line, d: Math.hypot(px - target[0], py - target[1]) / prefer(line), px, py };
    }).sort((a, b) => a.d - b.d).slice(0, 3);
    for (const { line, px, py } of scored) {
      const len = Math.hypot(line.bx - line.ax, line.by - line.ay), at0 = Math.hypot(px - line.ax, py - line.ay);
      const cross = (line.bx - line.ax) * (target[1] - line.ay) - (line.by - line.ay) * (target[0] - line.ax);
      const side0 = cross >= 0 ? 1 : -1;
      for (const nudge of [0, 0.05, -0.05, 0.1, -0.1, 0.18, -0.18, 0.28, -0.28]) for (const side of [side0, -side0]) {
        const at = at0 + nudge;
        if (at < W * FT / 2 + 0.01 || at > len - W * FT / 2 - 0.01) continue;
        const f = frontage(line, at, side, W, D);
        if (clear(f.lot)) return f;
      }
    }
    return null;
  };
  const nearestTown = (x, y) => settlements.reduce((best, s) => (Math.hypot(s.x - x, s.y - y) < Math.hypot(best.x - x, best.y - y) ? s : best));
  const pointInPlace = (st, rng, spread = 1) => { const r = st.extentMi * spread * Math.sqrt(rng()), t = 2 * Math.PI * rng(); return [st.x + r * Math.cos(t), st.y + r * Math.sin(t)]; };

  // --- Gas stations. -------------------------------------------------------------------------
  const gasStations = [], gasMissing = [];
  const buildGas = (f, size, town, extra = {}) => {
    const g = gasLayout(size);
    const station = {
      size, town, lot: f.lot, canopies: g.canopy.map(f.R), store: f.R(g.store), parking: g.parking.map(f.R),
      pumps: g.pumps.map(([al, ac]) => f.L(al, ac)), diesel: g.diesel.map(([al, ac]) => f.L(al, ac)), dispensers: g.pumps.length + g.diesel.length,
      // Drives: from the road's edge into the lot.
      drives: g.drives.map(al => { const a = f.L(al, 0); return [[r4(a[0] - (f.front[0] - f.edge[0])), r4(a[1] - (f.front[1] - f.edge[1]))], a]; }),
      ...extra
    };
    gasStations.push(station); take(bboxOf(f.lot));
    return station;
  };
  const gasSize = (st, rng) => {
    const u = rng();
    if (st.kind === 'metro' || st.kind === 'city') return u < 0.15 ? 'xl' : u < 0.6 ? 'large' : 'medium';
    if (st.kind === 'smallCity') return u < 0.35 ? 'large' : 'medium';
    if (st.population >= 3000) return u < 0.2 ? 'large' : 'medium';
    if (st.population >= p.gasMinPopulation) return u < 0.65 ? 'medium' : 'small';
    return 'small';
  };

  // --- Schools and colleges. -------------------------------------------------------------------
  const schools = [], campuses = [], schoolMissing = [];
  const buildSchool = (f, level, name, town) => {
    const s = schoolLayout(level);
    const school = {
      level, name, town, lot: f.lot, buildings: s.building.map(f.R), parking: s.parking.map(f.R),
      loop: s.loop.map(([al, ac]) => f.L(al, ac)), fields: s.fields.map(x => ({ kind: x.kind, poly: f.R(x.r) })),
      drive: [[r4(f.L(s.loop[0][0], 0)[0] - (f.front[0] - f.edge[0])), r4(f.L(s.loop[0][0], 0)[1] - (f.front[1] - f.edge[1]))], f.L(s.loop[0][0], s.loop[0][1])]
    };
    schools.push(school); take(bboxOf(f.lot));
    return school;
  };

  // A campus inside one square mile between arterials: buildings round a quad, parking lots on
  // its edges, a stadium for a university, a campus loop road.
  const buildCampus = (st, tier, name, rng) => {
    const dims = { university: [0.8, 0.7], stateUniversity: [0.55, 0.46], college: [0.3, 0.24] }[tier];
    const cells = [];
    const r = Math.ceil(st.extentMi);
    for (let J = Math.floor(st.y - r); J <= st.y + r; J++) for (let I = Math.floor(st.x - r); I <= st.x + r; I++) {
      const d = Math.hypot(I + 0.5 - st.x, J + 0.5 - st.y);
      if (d < st.extentMi * 0.85) cells.push({ I, J, d: d + rng() * st.extentMi * 0.5 });
    }
    cells.sort((a, b) => a.d - b.d);
    for (const { I, J } of cells) {
      const [w, h] = dims, slackX = 1 - w - 0.06, slackY = 1 - h - 0.06;
      const x0 = r4(I + 0.03 + slackX * rng()), y0 = r4(J + 0.03 + slackY * rng()), x1 = r4(x0 + w), y1 = r4(y0 + h);
      const area = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      if (!clear(area, 0.01)) continue;
      const box = (a, b, c, d) => [[r4(x0 + a * w), r4(y0 + b * h)], [r4(x0 + c * w), r4(y0 + b * h)], [r4(x0 + c * w), r4(y0 + d * h)], [r4(x0 + a * w), r4(y0 + d * h)]];
      const buildings = [], parking = [];
      // Buildings in two rings round the quad (the middle 30% by 30%).
      const count = tier === 'university' ? 34 : tier === 'stateUniversity' ? 22 : 7;
      for (let k = 0; k < count; k++) {
        const ring = k < count / 2 ? 0.2 : 0.08, t = (k / Math.ceil(count / 2)) % 1, side = Math.floor(t * 4), s = (t * 4) % 1;
        const cx = side === 0 ? 0.35 + 0.3 * s : side === 1 ? 0.65 + ring : side === 2 ? 0.65 - 0.3 * s : 0.35 - ring;
        const cy = side === 0 ? 0.35 - ring : side === 1 ? 0.35 + 0.3 * s : side === 2 ? 0.65 + ring : 0.65 - 0.3 * s;
        const bw = (0.05 + 0.04 * rng()) * (tier === 'college' ? 1.6 : 1), bh = (0.035 + 0.03 * rng()) * (tier === 'college' ? 1.6 : 1);
        buildings.push(box(cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2));
      }
      // Parking on the campus edges.
      parking.push(box(0.02, 0.84, 0.3, 0.97), box(0.7, 0.84, 0.98, 0.97), box(0.84, 0.03, 0.97, 0.3));
      if (tier !== 'college') parking.push(box(0.02, 0.03, 0.15, 0.3), box(0.36, 0.86, 0.64, 0.97));
      const stadium = tier === 'college' ? null : box(0.03, 0.4, 0.2, 0.62);
      const loop = [[0.02, 0.8], [0.98, 0.8], [0.98, 0.02], [0.02, 0.02], [0.02, 0.8]].map(([a, b]) => [r4(x0 + a * w), r4(y0 + b * h)]);
      const campus = { tier, name, town: st.name, area, quad: box(0.38, 0.38, 0.62, 0.62), buildings, parking, stadium, loop, fields: tier === 'college' ? [box(0.03, 0.4, 0.2, 0.62)] : [] };
      campuses.push(campus); take([x0, y0, x1, y1]);
      return campus;
    }
    return null;
  };

  // The places, the largest first (they have the most to fit).
  const places = [...settlements].sort((a, b) => b.population - a.population);
  for (const st of places) {
    const rng = makeRandom(hashText(`${seed}|place|${st.name}`)), reach = Math.max(st.extentMi, 0.6);
    const lines = linesIn(st, reach + 0.2);
    if (!lines.length) { if (st.population >= p.gasMinPopulation) gasMissing.push(st.name); continue; }
    // Colleges first (they need whole blocks).
    if (st.kind === 'metro') { buildCampus(st, 'university', `University of ${st.name}`, rng); for (let k = 0; k < Math.round(st.population / 600000); k++) buildCampus(st, 'college', `${st.name} ${['Metropolitan', 'Community', 'Technical'][k % 3]} College`, rng); }
    if (st.kind === 'city') { buildCampus(st, 'stateUniversity', `${st.name} State University`, rng); buildCampus(st, 'college', `${st.name} Community College`, rng); }
    if (st.kind === 'smallCity') buildCampus(st, 'college', `${st.name} Community College`, rng);
    // Schools.
    if (st.population >= p.schoolMinPopulation) {
      const wanted = st.population < p.smallTownPopulation
        ? [['elementary', 1], ['juniorSenior', 1]]
        : [['elementary', Math.max(1, Math.round(st.population / p.peoplePer.elementary))], ['middle', Math.max(1, Math.round(st.population / p.peoplePer.middle))], ['high', Math.max(1, Math.round(st.population / p.peoplePer.high))]];
      for (const [level, count] of wanted) {
        for (let k = 0; k < count; k++) {
          const name = level === 'elementary' ? `${count === 1 ? st.name : named(ELEMENTARY_NAMES, k)} Elementary`
            : level === 'juniorSenior' ? `${st.name} Junior-Senior High`
            // The first takes the town's name, the next few its sides, the rest names of their own.
            : `${k === 0 ? st.name : k <= SIDES.length ? `${st.name} ${SIDES[k - 1]}` : named(SCHOOL_NAMES, k - SIDES.length - 1 + (level === 'middle' ? 7 : 0))} ${level === 'middle' ? 'Middle School' : 'High School'}`;
          const lay = schoolLayout(level);
          let f = null;
          for (let tries = 0; tries < 6 && !f; tries++) f = placeLot(lines, pointInPlace(st, rng, tries < 3 ? 0.9 : 1.1), lay.W, lay.D);
          if (f) buildSchool(f, level, name, st.name); else if (k === 0) schoolMissing.push(`${st.name} ${level}`);
        }
      }
    }
    // Gas stations: on the highways and arterials, mostly where the traffic is.
    const want = st.population >= p.gasMinPopulation ? Math.max(1, Math.round(st.population / p.gasPeoplePer)) : hashText(`${seed}|gas-chance|${st.name}`) / 4294967296 < p.gasSmallChance ? 1 : 0;
    let made = 0;
    for (let k = 0; k < want; k++) {
      const size = gasSize(st, rng), lay = gasLayout(size);
      let f = null;
      for (let tries = 0; tries < (st.population >= p.gasMinPopulation && made === 0 ? 14 : 5) && !f; tries++) {
        const target = made === 0 && tries < 4 ? [st.x + (rng() - 0.5) * 0.4, st.y + (rng() - 0.5) * 0.4] : pointInPlace(st, rng);
        f = placeLot(lines, target, lay.W, lay.D, line => (line.kind === 'road' ? 2.5 : 1));
      }
      if (f) { buildGas(f, size, st.name); made++; }
    }
    if (st.population >= p.gasMinPopulation && !made) gasMissing.push(st.name);
  }

  // Truck stops at some interstate exits: on the crossing road beyond the ramp ends.
  for (const c of crossings) {
    if (c.type !== 'interchange' || c.kind === 'interstate' || c.uEnd || c.vEnd) continue;
    // (The hash itself is the draw: a fresh stream's first number is not evenly spread.)
    const key = `${seed}|truck|${c.interstate}|${c.exit}`, rng = makeRandom(hashText(key));
    if (hashText(`${key}|chance`) / 4294967296 > (c.town ? p.truckStopChance.town : p.truckStopChance.rural)) continue;
    const lay = gasLayout('truck stop');
    let done = false;
    for (const reach of [0.8, 0.95, 1.1, 1.3]) for (const dir of rng() < 0.5 ? [1, -1] : [-1, 1]) {
      if (done) break;
      const q = [c.x + c.vx * dir * reach, c.y + c.vy * dir * reach];
      let best = null;
      for (const s of segsNear(q[0], q[1], q[0], q[1])) if (s.type === 'road' && s.kind !== 'interstate' && distToSeg(q[0], q[1], s) < 0.05) best = s;
      if (!best) continue;
      const line = { ax: best.ax, ay: best.ay, bx: best.bx, by: best.by, half: best.half }, [px, py] = nearestOnSegment(q[0], q[1], line);
      const len = Math.hypot(line.bx - line.ax, line.by - line.ay), at = Math.hypot(px - line.ax, py - line.ay);
      let f = null;
      for (const side of [1, -1]) {
        if (at < lay.W * FT / 2 + 0.01 || at > len - lay.W * FT / 2 - 0.01) break;
        const g = frontage(line, at, side, lay.W, lay.D);
        if (clear(g.lot)) { f = g; break; }
      }
      if (f) { buildGas(f, 'truck stop', nearestTown(c.x, c.y).name, { exit: `${c.interstate} exit ${c.exit}` }); done = true; }
    }
  }

  // --- Energy. -------------------------------------------------------------------------------
  // Wind farms: sites scored by the region's wind, open land and standing a little above the
  // country round about.
  const radars = airfields.map(a => a.radar).filter(Boolean);
  const windFarms = [], openCover = new Set(['cropland', 'irrigated', 'grassland', 'sandhillGrass', 'tallgrass', 'redRange'].map(k => coverKeys.indexOf(k)));
  const wp = p.wind, sites = [];
  for (let y = 15; y < miles - 15; y += 3) for (let x = 15; x < miles - 15; x += 3) {
    const w = wp.weight[regionAt(x, y)] ?? 0;
    if (w <= 0 || !openCover.has(cover[cellAt(x, y)]) || slopeAt(x, y) > 0.02) continue;
    if (settlements.some(s => Math.hypot(s.x - x, s.y - y) < s.extentMi + wp.townClearMi + 3)) continue;
    if (airfields.some(a => Math.hypot(a.x - x, a.y - y) < wp.airfieldClearMi + 6) || radars.some(r => Math.hypot(r.x - x, r.y - y) < wp.radarClearMi + 5)) continue;
    let around = 0;
    for (let k = 0; k < 8; k++) around += elevation[cellAt(x + 6 * Math.cos(k * Math.PI / 4), y + 6 * Math.sin(k * Math.PI / 4))];
    sites.push({ x, y, score: w + clamp((elevation[cellAt(x, y)] - around / 8) / 30, -0.3, 0.5) + 0.6 * random() });
  }
  sites.sort((a, b) => b.score - a.score);
  for (const site of sites) {
    if (windFarms.length >= wp.farms) break;
    if (windFarms.some(f => Math.hypot(f.x - site.x, f.y - site.y) < wp.spacingMi)) continue;
    // Shared out between the windy regions (Kansas's farms are spread from the High Plains to the Flint Hills).
    if (windFarms.filter(f => f.region === regionAt(site.x, site.y)).length >= (wp.quota[regionAt(site.x, site.y)] ?? 0)) continue;
    const width = wp.widthMi[0] + (wp.widthMi[1] - wp.widthMi[0]) * random(), depth = wp.depthMi[0] + (wp.depthMi[1] - wp.depthMi[0]) * random();
    const turbines = [], roadsOut = [];
    for (let J = Math.floor(site.y - depth / 2); J <= site.y + depth / 2; J++) {
      const y = J + 0.5, row = [];
      for (let x = Math.floor(site.x - width / 2) + 0.14; x <= site.x + width / 2; x += wp.alongMi) {
        const edge = ((x - site.x) / (width / 2)) ** 2 + ((y - site.y) / (depth / 2)) ** 2;
        if (edge > 1 || random() > 0.88) continue;
        if (!openCover.has(cover[cellAt(x, y)]) || slopeAt(x, y) > 0.04 || !pointClear(x, y, 0.08, 0.07)) continue;
        if (settlements.some(s => Math.hypot(s.x - x, s.y - y) < s.extentMi + wp.townClearMi)) continue;
        if (airfields.some(a => Math.hypot(a.x - x, a.y - y) < wp.airfieldClearMi) || radars.some(r => Math.hypot(r.x - x, r.y - y) < wp.radarClearMi)) continue;
        row.push([r4(x), r4(y)]);
      }
      // A gravel string road along the row, joined to the nearest section line at its west end.
      let run = [];
      const flush = () => {
        if (run.length) {
          const [x0] = run[0], line = Math.round(x0) <= x0 ? Math.floor(x0) : Math.ceil(x0);
          const path = [[line, run[0][1]], ...run];
          if (pathClearOfRoads(path)) roadsOut.push(path);
        }
        run = [];
      };
      for (const t of row) { if (run.length && t[0] - run.at(-1)[0] > wp.alongMi * 2.2) flush(); run.push(t); }
      flush();
      for (const t of row) { turbines.push(t); take([t[0] - 0.02, t[1] - 0.02, t[0] + 0.02, t[1] + 0.02]); }
    }
    if (turbines.length < 20) continue;
    let substation = null;
    for (let k = 0; k < 40 && !substation; k++) {
      const x = Math.round(site.x) + 0.08 + random() * 0.84, y = Math.round(site.y) + 0.08 + random() * 0.84;
      if (pointClear(x, y, 0.05, 0.06)) { substation = [[r4(x - 0.02), r4(y - 0.015)], [r4(x + 0.02), r4(y - 0.015)], [r4(x + 0.02), r4(y + 0.015)], [r4(x - 0.02), r4(y + 0.015)]]; take([x - 0.02, y - 0.015, x + 0.02, y + 0.015]); }
    }
    windFarms.push({ name: `${nearestTown(site.x, site.y).name} Wind Farm`, x: site.x, y: site.y, region: regionAt(site.x, site.y), turbines, roads: roadsOut, substation });
  }
  function pathClearOfRoads(path) {
    for (let i = 1; i < path.length; i++) for (const s of segsNear(Math.min(path[i - 1][0], path[i][0]), Math.min(path[i - 1][1], path[i][1]), Math.max(path[i - 1][0], path[i][0]), Math.max(path[i - 1][1], path[i][1]))) {
      if (segmentIntersection(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1], s.ax, s.ay, s.bx, s.by)) return false;
    }
    return true;
  }

  // Oil and gas wells on a 40-acre spacing in patchy fields.
  const op = p.oil, oilNoise = makeNoise(seed, 'oil-fields'), wells = [], tanks = [], leaseRoads = [];
  let oilCount = 0;
  for (let y = 2.125; y < miles - 2; y += 0.25) for (let x = 2.125; x < miles - 2; x += 0.25) {
    const region = regionAt(x, y), w = op.weight[region] ?? 0;
    if (w <= 0) continue;
    const v = clamp(0.5 + 0.9 * fbm(oilNoise, x / op.fieldMi, y / op.fieldMi, 4), 0, 1), threshold = 1 - (1 - op.threshold) * w;
    if (v < threshold || random() > op.drilled * clamp((v - threshold) / 0.08, 0, 1)) continue;
    if (townCover.has(cover[cellAt(x, y)]) || !pointClear(x, y, 0.05, 0.06)) continue;
    const gas = op.gasRegions.includes(region), well = [r4(x), r4(y), gas ? 1 : 0];
    wells.push(well); take([x - 0.01, y - 0.01, x + 0.01, y + 0.01]);
    // The lease road: straight to the nearest mile line.
    const dx = x - Math.round(x), dy = y - Math.round(y), to = Math.abs(dx) < Math.abs(dy) ? [Math.round(x), y] : [x, Math.round(y)];
    if (pathClearOfRoads([[x, y], to])) leaseRoads.push([[r4(x), r4(y)], [r4(to[0]), r4(to[1])]]);
    if (!gas && ++oilCount % op.tankEvery === 0) {
      const tx = x + (Math.abs(dx) < Math.abs(dy) ? 0 : 0.035), ty = y + (Math.abs(dx) < Math.abs(dy) ? 0.035 : 0);
      if (pointClear(tx, ty, 0.04, 0.03)) { tanks.push([r4(tx), r4(ty)]); take([tx - 0.01, ty - 0.01, tx + 0.01, ty + 0.01]); }
    }
  }
  // Farm windmills over stock tanks on pasture.
  const pasture = new Set(p.windmills.covers.map(k => coverKeys.indexOf(k))), windmills = [];
  for (let J = 1; J < miles - 1; J++) for (let I = 1; I < miles - 1; I++) {
    if (random() > p.windmills.perMi2) continue;
    const x = I + 0.12 + 0.76 * random(), y = J + 0.12 + 0.76 * random();
    if (!pasture.has(cover[cellAt(x, y)]) || !pointClear(x, y, 0.05, 0.08)) continue;
    windmills.push([r4(x), r4(y)]); take([x - 0.01, y - 0.01, x + 0.01, y + 0.01]);
  }

  return {
    gasStations, schools, campuses,
    energy: { windFarms, windmills, wells, tanks, leaseRoads },
    missing: { gas: gasMissing, schools: schoolMissing }
  };
}

function bboxOf(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}

// Least distance from a segment to a polygon (0 where it crosses or lies inside).
function segPolyDist(s, poly) {
  if (pointInPoly(s.ax, s.ay, poly) || pointInPoly(s.bx, s.by, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    if (segmentIntersection(s.ax, s.ay, s.bx, s.by, ax, ay, bx, by)) return 0;
    best = Math.min(best, distToSeg(ax, ay, s), distToSeg(bx, by, s), distToSeg(s.ax, s.ay, { ax, ay, bx, by }), distToSeg(s.bx, s.by, { ax, ay, bx, by }));
  }
  return best;
}

// The part of a segment within reach of (x, y), or null.
function clipToCircle(s, x, y, reach) {
  const dx = s.bx - s.ax, dy = s.by - s.ay, fx = s.ax - x, fy = s.ay - y;
  const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - reach * reach, disc = b * b - 4 * a * c;
  if (a === 0 || disc <= 0) return null;
  const t0 = Math.max(0, (-b - Math.sqrt(disc)) / (2 * a)), t1 = Math.min(1, (-b + Math.sqrt(disc)) / (2 * a));
  if (t1 <= t0) return null;
  return { ax: s.ax + dx * t0, ay: s.ay + dy * t0, bx: s.ax + dx * t1, by: s.ay + dy * t1 };
}

// What each part of a place is for, so that shops, gas stations, schools and houses stand where
// they would in a Plains town or suburb (facilities.js places the lots inside these areas).
//   - Downtown: the old centre, laid by the place's form (townShapes.js): in a railroad town the
//     business street running from the reserve up past the middle; round the square in a
//     courthouse town; along the road in a Main Street town; up from the landing in a river town.
//   - Shopping at the arterial corners, by tier, as suburban retail is planned: a regional mall
//     near an interstate exit for about every 250,000 people (Wichita has two); a community
//     centre (big-box stores) for about every 35,000; a neighbourhood centre (a grocery-anchored
//     strip) for about every 9,000; and convenience corners (gas, fast food). Each tier keeps its
//     own spacing, takes one or two corners of its intersection, and the busiest corners (most
//     paved approaches and highways, near an exit, nearer the middle) go first.
//   - Highway strips: where a highway enters a town or small city, frontage on both sides from
//     a little outside downtown to just past the edge (motels, gas, fast food, farm supply).
//   - Industry: a co-op and grain elevator (a warehouse district in a city) in the band along the
//     far edge of the place's reserve, across from town; industrial parks beside a highway or
//     arterial towards the edge of the cities.
//   - Parks: a town park in each place of 1,000, more in the cities: first on the ground the
//     town left open (a gap or notch in its footprint), then inside the residential blocks.
//   - Neighbourhoods (the cities and small cities): each square mile between the arterials,
//     as Perry's neighbourhood unit: houses on its streets, a collector across it on the half-mile
//     lines, an elementary school inside it named for it, shopping only at its corners.
// Everything else in a place is houses. Areas are convex polygons in map miles.
// Scale (scale.js): the areas' own sizes (shopping centres, strips' depth, industrial parks,
// parks, the gaps between areas) are built at character scale and keep their size in studs
// (AT_1000); where they stand (spacing by people, the town's extent, the mile grid) is the map's.
import { makeRandom, hashText } from './noise.js';
import { AT_1000 } from './scale.js';
import { HALF_MI } from './streets.js';

export const LAND_USE_DEFAULTS = Object.freeze({
  peoplePer: { mall: 250000, community: 35000, neighborhood: 9000, corner: 12000 },
  communityMinPopulation: 15000,
  spacingMi: { mall: 4, community: 1.8, neighborhood: 0.9, corner: 0.6 },
  sizeMi: { mall: [AT_1000(0.4), AT_1000(0.3)], community: [AT_1000(0.22), AT_1000(0.18)], neighborhood: [AT_1000(0.13), AT_1000(0.1)], corner: [AT_1000(0.075), AT_1000(0.075)] },
  corners: { mall: 1, community: 2, neighborhood: 1, corner: 1 },
  roadSetMi: HALF_MI.arterial + AT_1000(0.003),   // from a road's centre line to where an area starts (an arterial's half-width and a little)
  corridor: { maxPopulation: 100000, from: 0.4, to: 1.05, depthMi: AT_1000(0.07), minMi: AT_1000(0.1) },
  industrial: { minPopulation: 1000, peoplePer: 60000, sizeMi: { town: [AT_1000(0.12), AT_1000(0.1)], smallCity: [AT_1000(0.3), AT_1000(0.22)], city: [AT_1000(0.5), AT_1000(0.4)] }, from: 0.55, to: 1.1 },
  // Park sides: a town park sizeMi.town[0] + up to [1]; a city park in a quarter section [0] + up to [1].
  parks: { minPopulation: 1000, peoplePer: 12000, sizeMi: { town: [AT_1000(0.05), AT_1000(0.04)], city: [AT_1000(0.08), AT_1000(0.14)] } },
  downtownMinMi: AT_1000(0.12),           // a small town's main street
  gapMi: AT_1000(0.03)                    // between areas of different uses
});

const AREA_NAMES = ['Prairie Ridge', 'Westridge', 'Sunset Hills', 'Lakeview', 'Oak Park', 'Riverside', 'Highland', 'Pleasant Valley', 'Hillcrest', 'Wheatland', 'Bluestem', 'Indian Hills', 'Fairview', 'Park Hill', 'Mill Creek', 'Stone Creek', 'Woodland', 'Cedar Hills', 'Heritage', 'Pioneer', 'Kenwood', 'Brookside', 'Windsor', 'Clearwater', 'Briarwood', 'Countryside', 'Lone Elm', 'Meadowlark', 'Cottonwood', 'Sunflower', 'Quail Creek', 'Deer Run', 'Fox Run', 'Willow Bend', 'Rolling Hills', 'Prairie Village', 'Timber Ridge', 'Copper Creek', 'Shadow Lake', 'Autumn Ridge', 'Spring Hill', 'Maple Grove', 'Ashford', 'Hawthorne', 'Northbrook', 'Southwind', 'Eastborough', 'Crestview', 'Fairway', 'Country Club'];
const SIDES = ['North', 'South', 'East', 'West', 'Old', 'New', 'Upper', 'Lower'];
const nameOf = j => AREA_NAMES[j % AREA_NAMES.length] + (j >= AREA_NAMES.length ? ` ${SIDES[Math.floor(j / AREA_NAMES.length - 1) % SIDES.length]}` : '') + (j >= AREA_NAMES.length * (SIDES.length + 1) ? ` ${Math.floor(j / (AREA_NAMES.length * (SIDES.length + 1))) + 1}` : '');
const CENTRE_KIND = { mall: ['Mall', 'Square', 'Town Center'], community: ['Marketplace', 'Crossing', 'Commons', 'Plaza'], neighborhood: ['Shopping Center', 'Village', 'Plaza', 'Corners'] };

export const COMMERCIAL = new Set(['downtown', 'mall', 'shopping', 'corridor', 'travel']);

const rect = (x0, y0, x1, y1) => [[Math.min(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.max(y0, y1)], [Math.min(x0, x1), Math.max(y0, y1)]];
export function bboxOf(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}

// Whether two convex polygons come within gap miles of each other (separating axes, each
// interval widened by the gap). Either may be an area ({ poly, box }) or a list of points.
export function polysNear(za, zb, gap = 0) {
  const a = za.poly ?? za, b = zb.poly ?? zb, A = za.box ?? bboxOf(a), B = zb.box ?? bboxOf(b);
  if (A[0] - gap > B[2] || B[0] - gap > A[2] || A[1] - gap > B[3] || B[1] - gap > A[3]) return false;
  for (const p of [a, b]) for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length], len = Math.hypot(x1 - x0, y1 - y0);
    if (!len) continue;
    const ax = (y0 - y1) / len, ay = (x1 - x0) / len;
    let la = Infinity, ha = -Infinity, lb = Infinity, hb = -Infinity;
    for (const [x, y] of a) { const v = x * ax + y * ay; la = Math.min(la, v); ha = Math.max(ha, v); }
    for (const [x, y] of b) { const v = x * ax + y * ay; lb = Math.min(lb, v); hb = Math.max(hb, v); }
    if (ha + gap <= lb || hb + gap <= la) return false;
  }
  return true;
}

// The areas of one place. h: the planner's helpers from facilities.js (clear, sectionClass,
// segsNear, distToSeg, crossings, placeLot, linesIn, isWater) and `areas`, every area placed so
// far on the map (this place's are added to it).
export function planPlaceLandUse(st, h, options = {}) {
  const p = { ...LAND_USE_DEFAULTS, ...options };
  const rng = makeRandom(hashText(`${h.seed}|land-use|${st.name}`)), R = Math.max(st.extentMi, 0.6), far = h.reachOf(st);
  const zones = [], r4 = v => Math.round(v * 1e4) / 1e4;
  const add = zone => { zone.town = st.name; zone.poly = zone.poly.map(([x, y]) => [r4(x), r4(y)]); zone.box = bboxOf(zone.poly); zones.push(zone); h.areas.push(zone); return zone; };
  const free = (poly, gap = p.gapMi, except = () => false) => !h.areas.some(z => z.kind !== 'corridor' && !except(z) && polysNear(poly, z, gap));

  // Downtown, from main street in a small town to two miles across in the metro: as long again
  // as it is wide where the form has a business street (across the axis in the railroad and
  // river forms, stopping short of the reserve; along it in a Main Street town), a square
  // round the middle in a courthouse town or a city.
  const side = Math.min(2, p.downtownMinMi + 0.35 * Math.sqrt(st.population / 40000)), half = side / 2;
  const along = st.axis && st.form === 'linear' ? [st.axis.ux, st.axis.uy] : st.axis && st.form !== 'courthouse' && st.form !== 'regional' ? [st.reserve.nx, st.reserve.ny] : null;
  const vertical = along && Math.abs(along[1]) > Math.abs(along[0]), hx = along ? (vertical ? 0.75 : 1.3) * half : half, hy = along ? (vertical ? 1.3 : 0.75) * half : half;
  // (towards the reserve, as far as leaves the middle inside and the reserve outside)
  let dcx = st.x, dcy = st.y;
  if (along && st.form !== 'linear') { const gap = (st.axis.x - st.x) * st.reserve.nx + (st.axis.y - st.y) * st.reserve.ny, slide = Math.max(0, Math.min(0.3 * half, gap - 1.3 * half - 0.02)) * Math.sign(vertical ? along[1] : along[0]); if (vertical) dcy += slide; else dcx += slide; }
  // (Off the reserve: moved back from it, the middle still inside, then made smaller.)
  let hx2 = hx, hy2 = hy;
  if (st.axis) for (let k = 0; k < 40 && h.onReserve(rect(dcx - hx2, dcy - hy2, dcx + hx2, dcy + hy2)); k++) {
    const mx = dcx - Math.sign(st.reserve.nx) * 0.02 * (Math.abs(st.reserve.nx) > 0.3), my = dcy - Math.sign(st.reserve.ny) * 0.02 * (Math.abs(st.reserve.ny) > 0.3);
    if (Math.abs(mx - st.x) < hx2 - 0.02 && Math.abs(my - st.y) < hy2 - 0.02) { dcx = mx; dcy = my; } else { hx2 *= 0.9; hy2 *= 0.9; dcx += (st.x - dcx) * 0.1; dcy += (st.y - dcy) * 0.1; }
  }
  const inDowntownAt = (x, y, pad = 0) => Math.abs(x - dcx) < hx2 + pad && Math.abs(y - dcy) < hy2 + pad;
  const downtown = add({ kind: 'downtown', name: st.kind === 'town' ? `${st.name} Main Street` : `Downtown ${st.name}`, poly: rect(dcx - hx2, dcy - hy2, dcx + hx2, dcy + hy2) });

  // Highway strips: along the roads through the built ground outside downtown (the fingers).
  if (st.population < p.corridor.maxPopulation) {
    const seen = new Set();
    for (const s of h.segsNear(st.x - far, st.y - far, st.x + far, st.y + far)) {
      if (s.type !== 'road' || s.kind === 'interstate' || seen.has(s)) continue;
      seen.add(s);
      const len = Math.hypot(s.bx - s.ax, s.by - s.ay), steps = Math.max(2, Math.ceil(len / 0.02));
      let run = null;
      const flush = () => {
        if (run && Math.hypot(run[2] - run[0], run[3] - run[1]) >= p.corridor.minMi) {
          const ux = (run[2] - run[0]), uy = (run[3] - run[1]), l = Math.hypot(ux, uy), w = s.half + p.corridor.depthMi, nx = -uy / l * w, ny = ux / l * w;
          add({ kind: 'corridor', name: `${s.road.name ?? 'Highway'} strip`, road: s.road.name, line: { ax: run[0], ay: run[1], bx: run[2], by: run[3], half: s.half }, poly: [[run[0] + nx, run[1] + ny], [run[2] + nx, run[3] + ny], [run[2] - nx, run[3] - ny], [run[0] - nx, run[1] - ny]] });
        }
        run = null;
      };
      for (let k = 0; k <= steps; k++) {
        const t = k / steps, x = s.ax + (s.bx - s.ax) * t, y = s.ay + (s.by - s.ay) * t, d = Math.hypot(x - st.x, y - st.y);
        const inDowntown = inDowntownAt(x, y, 0.03), w = s.half + p.corridor.depthMi, ox = -(s.by - s.ay) / len, oy = (s.bx - s.ax) / len, onTown = h.own(st, x + ox * 0.07, y + oy * 0.07) || h.own(st, x - ox * 0.07, y - oy * 0.07);
        const kept = [-1, -0.5, 0, 0.5, 1].some(a => h.reserved(x + ox * w * a, y + oy * w * a));
        if (d >= p.corridor.from * R && onTown && !kept && !inDowntown && !h.isWater(x, y)) { if (run) { run[2] = x; run[3] = y; } else run = [x, y, x, y]; } else flush();
      }
      flush();
    }
  }

  // Shopping at the arterial corners.
  const corners = [];
  for (let I = Math.floor(st.x - far); I <= Math.ceil(st.x + far); I++) for (let J = Math.floor(st.y - far); J <= Math.ceil(st.y + far); J++) {
    const d = Math.hypot(I - st.x, J - st.y);
    if (!h.town(st, I, J) || inDowntownAt(I, J)) continue;
    const paved = [h.sectionClass(I, J, true), h.sectionClass(I - 1, J, true), h.sectionClass(I, J, false), h.sectionClass(I, J - 1, false)].filter(c => c === 3).length;
    const highways = new Set([...h.segsNear(I, J, I, J)].filter(s => s.type === 'road' && s.kind !== 'interstate' && h.distToSeg(I, J, s) < AT_1000(0.06)).map(s => s.road)).size;
    if (paved + 2 * highways < 3) continue;
    const exit = h.crossings.some(c => c.type === 'interchange' && Math.hypot(c.x - I, c.y - J) < 1.2);
    corners.push({ I, J, d, exit, score: paved + 2 * highways + 2 * Math.max(0, 1 - d / R) + 1.5 * rng() });
  }
  const nodes = [];
  const count = {
    mall: Math.round(st.population / p.peoplePer.mall),
    community: st.population >= p.communityMinPopulation ? Math.max(1, Math.round(st.population / p.peoplePer.community)) : 0,
    neighborhood: Math.round(st.population / p.peoplePer.neighborhood),
    corner: Math.round(st.population / p.peoplePer.corner)
  };
  const used = new Set();
  let named = 0;
  for (const tier of ['mall', 'community', 'neighborhood', 'corner']) {
    if (!count[tier]) continue;
    const ranked = corners.map(c => ({ c, s: c.score + (tier === 'mall' ? (c.exit ? 6 : 0) - (c.d < st.coreMi * 0.5 ? 10 : 0) : tier === 'community' && c.exit ? 2 : 0) })).sort((a, b) => b.s - a.s);
    let made = 0;
    for (const { c } of ranked) {
      if (made >= count[tier]) break;
      if (used.has(c) || nodes.some(n => Math.hypot(n.I - c.I, n.J - c.J) < p.spacingMi[tier])) continue;
      const [w, l] = p.sizeMi[tier], quads = [[1, 1], [-1, 1], [1, -1], [-1, -1]].sort(() => rng() - 0.5), set = p.roadSetMi;
      const name = tier === 'corner' ? null : `${nameOf(hashText(`${st.name}|${named++}`) % AREA_NAMES.length)} ${CENTRE_KIND[tier][Math.floor(rng() * CENTRE_KIND[tier].length)]}`;
      let taken = 0;
      for (const [a, b] of quads) {
        if (taken >= p.corners[tier]) break;
        const [qw, ql] = rng() < 0.5 ? [w, l] : [l, w], poly = rect(c.I + a * set, c.J + b * set, c.I + a * (set + qw), c.J + b * (set + ql));
        if (!h.town(st, (poly[0][0] + poly[2][0]) / 2, (poly[0][1] + poly[2][1]) / 2) || !h.clear(poly) || !free(poly)) continue;
        add({ kind: tier === 'mall' ? 'mall' : 'shopping', tier, name, corner: [c.I, c.J], poly });
        taken++;
      }
      if (taken) { nodes.push({ I: c.I, J: c.J, tier }); used.add(c); made++; }
    }
  }

  // Industry. First the co-op and elevator (a city's warehouse district) across the reserve from
  // town: a lot along the reserve's far edge, as near the middle as there is room.
  const ind = p.industrial;
  let coop = false;
  if (st.axis) {
    const { ux, uy } = st.axis, { nx, ny, widthMi, industryMi } = st.reserve, [w0] = ind.sizeMi[st.kind === 'town' ? 'town' : st.kind === 'smallCity' ? 'smallCity' : 'city'];
    const len = st.kind === 'town' ? w0 : w0 * 1.6, at0 = (st.x - st.axis.x) * ux + (st.y - st.axis.y) * uy, near = widthMi + p.gapMi, deep = widthMi + industryMi - 0.005;
    for (let k = 0; k < 30 && !coop; k++) {
      const t = at0 + (k >> 1) * (k & 1 ? -1 : 1) * 0.6 * len, q = (a, b) => [st.axis.x + ux * a + nx * b, st.axis.y + uy * a + ny * b];
      const poly = [q(t - len / 2, near), q(t + len / 2, near), q(t + len / 2, deep), q(t - len / 2, deep)];
      if (!h.clear(poly) || !free(poly)) continue;
      add({ kind: 'industrial', name: st.kind === 'town' ? `${st.name} Co-op` : `${st.name} Warehouse District`, reserve: true, poly });
      coop = true;
    }
  }
  // Then industrial parks towards the edge, on a highway or arterial.
  if (st.population >= ind.minPopulation) {
    const want = (coop && st.kind === 'town' ? 0 : 1) + Math.floor(st.population / ind.peoplePer), [w, d] = ind.sizeMi[st.kind === 'town' ? 'town' : st.kind === 'smallCity' ? 'smallCity' : 'city'];
    const lines = h.linesIn(st, far + 0.15), sites = [];
    for (let tries = 0; tries < want * 8 && sites.length < want; tries++) {
      const target = h.pointIn(st, rng, ind.to, ind.from);
      if (sites.some(q => Math.hypot(q[0] - target[0], q[1] - target[1]) < Math.max(1, R / 3))) continue;
      const f = h.placeLot(lines, target, h.lotFt(w), h.lotFt(d), () => 1, lot => free(lot, 0.12, z => z.kind === 'industrial'));
      if (!f) continue;
      add({ kind: 'industrial', name: st.kind === 'town' ? `${st.name} Co-op` : `${st.name} ${['Industrial Park', 'Business Park', 'Commerce Center'][sites.length % 3]}${sites.length >= 3 ? ` ${Math.floor(sites.length / 3) + 1}` : ''}`, poly: f.lot });
      sites.push(target);
    }
  }

  // Parks: on ground the town left open (a cell not built with built ground on two sides or
  // more: a gap or a notch), then inside the residential blocks (a quarter section's middle in
  // the cities).
  if (st.population >= p.parks.minPopulation) {
    const want = Math.max(1, Math.round(st.population / p.parks.peoplePer));
    let made = 0;
    for (let tries = 0; tries < want * 10 && made < want; tries++) {
      let cx, cy, size;
      const open = tries < want * 5 ? h.openIn(st, rng) : null;
      if (open) { [cx, cy] = open; size = Math.min(0.11, st.kind === 'town' ? p.parks.sizeMi.town[0] + p.parks.sizeMi.town[1] * rng() : p.parks.sizeMi.city[0] + p.parks.sizeMi.city[1] * rng() ** 2); }
      else if (st.kind === 'town') {
        [cx, cy] = h.pointIn(st, rng, 0.6); size = p.parks.sizeMi.town[0] + p.parks.sizeMi.town[1] * rng();
      } else {
        const [qx, qy] = h.pointIn(st, rng);
        cx = Math.floor(qx) + (rng() < 0.5 ? 0.25 : 0.75); cy = Math.floor(qy) + (rng() < 0.5 ? 0.25 : 0.75); size = p.parks.sizeMi.city[0] + p.parks.sizeMi.city[1] * rng() ** 2;
      }
      const poly = rect(cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2);
      if (!h.clear(poly) || !free(poly)) continue;
      add({ kind: 'park', name: `${nameOf(hashText(`${st.name}|park|${made}`) % AREA_NAMES.length)} Park`, poly });
      made++;
    }
  }
  return zones;
}

// The neighbourhoods of a city or small city: each square mile between the arterials at least
// two fifths built by the place, outside downtown and any campus, with its collectors on the half-mile
// lines. Named once each in the place.
export function planNeighborhoods(st, h) {
  if (st.kind === 'town') return [];
  const R = h.reachOf(st), out = [], names = new Set(), downtown = h.areas.find(z => z.kind === 'downtown' && z.town === st.name);
  let j = hashText(`${h.seed}|neighborhoods|${st.name}`) % AREA_NAMES.length;
  for (let J = Math.floor(st.y - R); J <= Math.ceil(st.y + R); J++) for (let I = Math.floor(st.x - R); I <= Math.ceil(st.x + R); I++) {
    const cx = I + 0.5, cy = J + 0.5;
    if (h.builtShare(st, I, J) < 0.4 || h.isWater(cx, cy)) continue;
    if (downtown && cx > downtown.box[0] && cx < downtown.box[2] && cy > downtown.box[1] && cy < downtown.box[3]) continue;
    const inset = AT_1000(0.02), poly = rect(I + inset, J + inset, I + 1 - inset, J + 1 - inset);
    if (h.campuses.some(c => polysNear(poly, c.area, 0) && (bboxOf(c.area)[2] - bboxOf(c.area)[0]) * (bboxOf(c.area)[3] - bboxOf(c.area)[1]) > 0.25)) continue;
    let name;
    do name = nameOf(j++); while (names.has(name));
    names.add(name);
    const collectors = [{ ax: I + 0.5, ay: J, bx: I + 0.5, by: J + 1, half: HALF_MI.collector, kind: 'collector' }, { ax: I, ay: J + 0.5, bx: I + 1, by: J + 0.5, half: HALF_MI.collector, kind: 'collector' }];
    out.push({ kind: 'neighborhood', name, town: st.name, I, J, poly, box: bboxOf(poly), collectors, centre: [cx, cy] });
  }
  return out;
}


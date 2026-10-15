// Where roads cross the interstates, and how. Interstates are limited-access: they connect only to
// other interstates and to highways (US routes, the expressways, state highways), and only by
// interchange (US practice; spacing after AASHTO and state DOT rules: interchanges at least 1 mile
// apart in towns and 3 miles apart in the country). Along each interstate, every crossing road is
// considered in order of importance:
//   another interstate: a system interchange (the one with the later name passes over; a ramp
//     links the two in each quadrant);
//   a US route or expressway: a diamond interchange (an off and an on ramp each side, the
//     highway passing over), or, where another exit is too near, an overpass;
//   a state highway: a diamond interchange where the exit spacing allows, else an overpass;
//   a paved county road or town arterial: an overpass (no ramps), kept a good way from the next
//     crossing and from any exit;
//   anything else, or a road with no room: nothing; the road stops short of the interstate either
//     side. Gravel and dirt roads never reach any highway at all.
// Where one of the two roads ends at the crossing (a T), it is recorded (uEnd for the interstate,
// vEnd for the crossing road: the direction, +1 or -1 along u or v, in which the road goes on from
// the crossing; 0 where it runs on both ways): the junction is then a T, the ending road splitting
// into two ramps that merge onto the other, with no bridge.
//
// Every crossing is then checked on the ground (interchanges.js): an interchange whose ramps or
// bridge approaches would run into a river or across another highway becomes an overpass, and an
// overpass whose approaches would run into a river is dropped (a US route or expressway keeps its
// overpass). Section-line roads a ramp would cross are removed there.
// Exits are numbered by milepost, from the west end of an east-west interstate or the south end
// of a north-south one.
import { interchangeRamps, overpassLine, INTERCHANGE } from './interchanges.js';

export const CROSSING_DEFAULTS = Object.freeze({
  minSinAngle: 0.25,          // shallower crossings are the same corridor, not a crossing
  spacingMi: 0.75,            // no two crossings of one interstate closer than this
  exitSpacingTownMi: 1,       // no two exits closer than this in a town (AASHTO urban)
  exitSpacingRuralMi: 3,      // or in the country (rural interstates)
  pavedOverpassMi: 1.5,       // a paved road gets an overpass if no crossing is this near
  exitClearMi: 1,             // and no exit
  apartMi: 0.9,               // crossings of different interstates at least this far apart
  riverClearMi: 0.35,         // none this near where the interstate itself crosses a river
  riverMarginMi: 0.02,        // ramps and approaches keep this far from a river's banks
  highwayMarginMi: 0.03       // and ramps this far from other highways
});

// Crossing kinds, most important first.
const RANK = { interstate: 0, expressway: 1, us: 1, state: 2, paved: 3, gravel: 4, dirt: 5 };
export const CROSSING_CODES = Object.freeze({ interchange: 1, overpass: 2 });
export const CROSS_ROAD_CODES = Object.freeze({ interstate: 1, expressway: 2, us: 3, state: 3, paved: 4, gravel: 5 });

// Where segments ab and cd cross (t along ab, u along cd), allowing slackMi past either end (a
// road ending on another, its end rounded to the hundredth of a mile).
function intersect(ax, ay, bx, by, cx, cy, dx, dy, slackMi = 0) {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy, den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den, u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  const et = slackMi / (Math.hypot(rx, ry) || 1), eu = slackMi / (Math.hypot(sx, sy) || 1);
  return t >= -et && t <= 1 + et && u >= -eu && u <= 1 + eu ? { t: Math.min(1, Math.max(0, t)), u: Math.min(1, Math.max(0, u)) } : null;
}

function pointSeg(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + dx * t - x, ay + dy * t - y);
}

// Least distance between two segments.
function segSeg(a, b, c, d) {
  if (intersect(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1])) return 0;
  return Math.min(pointSeg(a[0], a[1], c[0], c[1], d[0], d[1]), pointSeg(b[0], b[1], c[0], c[1], d[0], d[1]),
    pointSeg(c[0], c[1], a[0], a[1], b[0], b[1]), pointSeg(d[0], d[1], a[0], a[1], b[0], b[1]));
}

// A road's heading at (x, y): from the point reach miles back along it to the point reach miles
// on, so ramps that far out stay on a curving road.
function headingAt(points, x, y, reach) {
  let bestD = Infinity, at = 0, run = 0;
  const along = [0];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i], len = Math.hypot(bx - ax, by - ay);
    const t = len ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (len * len))) : 0;
    const d = Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y);
    if (d < bestD) { bestD = d; at = run + len * t; }
    run += len; along.push(run);
  }
  const pointAt = s => {
    s = Math.max(0, Math.min(run, s));
    let i = 1;
    while (i < points.length - 1 && along[i] < s) i++;
    const [ax, ay] = points[i - 1], [bx, by] = points[i], len = along[i] - along[i - 1] || 1, t = (s - along[i - 1]) / len;
    return [ax + (bx - ax) * t, ay + (by - ay) * t];
  };
  const a = pointAt(at - reach), b = pointAt(at + reach), l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
}

// The kind of crossing a map road makes.
export function roadClass(road) {
  if (road.kind !== 'highway') return road.kind;
  return road.name.startsWith('US') ? 'us' : 'state';
}

export function planCrossings(map, options = {}) {
  const p = { ...CROSSING_DEFAULTS, ...options };
  const { sections, cover, coverKeys, size: n, cellMiles } = map;
  const townCover = new Set([coverKeys.indexOf('urban'), coverKeys.indexOf('suburban')]);
  const inTown = (x, y) => townCover.has(cover[Math.min(n - 1, Math.max(0, Math.floor(y / cellMiles))) * n + Math.min(n - 1, Math.max(0, Math.floor(x / cellMiles)))]);
  const interstates = map.roads.filter(r => r.kind === 'interstate');
  const others = map.roads.filter(r => r.kind !== 'interstate');
  const secSize = sections.size;
  const sectionClass = (I, J, east) => {
    if (I < 0 || J < 0 || I >= secSize || J >= secSize) return 0;
    const v = sections.roads[J * secSize + I];
    return east ? v & 3 : (v >> 2) & 3;
  };
  let crossings = [];

  for (const road of interstates) {
    // Milepost direction: from the west end (east-west) or the south end (north-south).
    const pts = road.points, first = pts[0], last = pts.at(-1);
    const eastWest = Math.abs(last[0] - first[0]) >= Math.abs(last[1] - first[1]);
    const reversed = eastWest ? first[0] > last[0] : first[1] < last[1];
    let total = 0;
    const along = [0];
    for (let i = 1; i < pts.length; i++) { total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); along.push(total); }

    // Where this interstate crosses rivers (distance along it): crossings keep clear of its bridges.
    const riverAt = [];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      for (const river of map.rivers) {
        const rp = river.points;
        for (let k = 2; k < rp.length; k += 2) {
          const hit = intersect(ax, ay, bx, by, rp[k - 2], rp[k - 1], rp[k], rp[k + 1]);
          if (hit) riverAt.push(along[i - 1] + Math.hypot(bx - ax, by - ay) * hit.t);
        }
      }
    }
    const candidates = [];
    const endMi = 0.3;
    const consider = (i, t, kind, vx, vy, name, vEnd = 0, other = null) => {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const len = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / len, uy = (by - ay) / len;
      const vl = Math.hypot(vx, vy) || 1;
      const sin = Math.abs(ux * vy / vl - uy * vx / vl);
      if (sin < p.minSinAngle) return;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      const s = along[i - 1] + len * t;
      const uEnd = s < endMi ? 1 : total - s < endMi ? -1 : 0;
      candidates.push({ x, y, ux, uy, vx: vx / vl, vy: vy / vl, kind, sin, along: s, milepost: reversed ? total - s : s, town: inTown(x, y), crossName: name, uEnd, vEnd, other });
    };
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      // The other map roads.
      for (const o of [...others, ...interstates.filter(r => r !== road)]) {
        for (let k = 1; k < o.points.length; k++) {
          const [cx, cy] = o.points[k - 1], [dx, dy] = o.points[k];
          if (Math.max(cx, dx) < Math.min(ax, bx) || Math.min(cx, dx) > Math.max(ax, bx) || Math.max(cy, dy) < Math.min(ay, by) || Math.min(cy, dy) > Math.max(ay, by)) continue;
          const hit = intersect(ax, ay, bx, by, cx, cy, dx, dy, 0.03);
          if (hit) {
            // Whether the other road ends here: near its first point it goes on along +v, near
            // its last along -v.
            const segLen = Math.hypot(dx - cx, dy - cy);
            const vEnd = k === 1 && hit.u * segLen < endMi ? 1 : k === o.points.length - 1 && (1 - hit.u) * segLen < endMi ? -1 : 0;
            consider(i, hit.t, roadClass(o), dx - cx, dy - cy, o.name, vEnd, o);
          }
        }
      }
      // The section lines (one mile of each at a time).
      for (let I = Math.ceil(Math.min(ax, bx)); I <= Math.floor(Math.max(ax, bx)); I++) {
        if (bx === ax) continue;
        const t = (I - ax) / (bx - ax), y = ay + (by - ay) * t, cls = sectionClass(I, Math.floor(y), false);
        if (cls > 0) consider(i, t, ['', 'dirt', 'gravel', 'paved'][cls], 0, 1, '');
      }
      for (let J = Math.ceil(Math.min(ay, by)); J <= Math.floor(Math.max(ay, by)); J++) {
        if (by === ay) continue;
        const t = (J - ay) / (by - ay), x = ax + (bx - ax) * t, cls = sectionClass(Math.floor(x), J, true);
        if (cls > 0) consider(i, t, ['', 'dirt', 'gravel', 'paved'][cls], 1, 0, '');
      }
    }

    // Choose, most important first.
    candidates.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.along - b.along);
    const chosen = [];
    const near = (c, miles, pred = () => true) => chosen.some(o => pred(o) && Math.abs(o.along - c.along) < miles);
    const exits = o => o.type === 'interchange';
    for (const c of candidates) {
      if (c.kind === 'dirt' || c.kind === 'gravel') continue;
      if (riverAt.some(a => Math.abs(a - c.along) < p.riverClearMi)) continue;
      const exitSpacing = c.town ? p.exitSpacingTownMi : p.exitSpacingRuralMi;
      let type = null;
      if (c.kind === 'interstate') {
        // One record per pair of interstates: kept on the one that goes under (the earlier name).
        if (road.name > c.crossName) continue;
        type = 'interchange';
      } else if (c.kind === 'us' || c.kind === 'expressway') {
        // A second crossing right by another is the same corridor (roads sharing a route); nor
        // may it fall among an exit's ramps (they reach 0.4 mi each way).
        if (near(c, 0.35) || near(c, 0.7, exits)) continue;
        type = near(c, exitSpacing, exits) ? 'overpass' : 'interchange';
      } else if (c.kind === 'state') {
        if (near(c, p.spacingMi) || near(c, 0.7, exits)) continue;
        type = near(c, exitSpacing, exits) ? 'overpass' : 'interchange';
      } else if (c.kind === 'paved' && !near(c, p.pavedOverpassMi) && !near(c, p.exitClearMi, exits)) {
        type = 'overpass';
      }
      if (type === 'overpass' && (c.vEnd || c.uEnd)) type = null; // a road ending here is not carried over
      if (type) chosen.push({ ...c, type, interstate: road.name });
    }
    for (const c of chosen) {
      // Headings over the reach of the ramps (a curving beltway), keeping each road's sense.
      if (c.type === 'interchange') {
        const reach = 0.46, u = headingAt(pts, c.x, c.y, reach);
        if (u[0] * c.ux + u[1] * c.uy > 0.9) { c.ux = u[0]; c.uy = u[1]; }
        if (c.other) {
          const v = headingAt(c.other.points, c.x, c.y, reach), sense = v[0] * c.vx + v[1] * c.vy;
          if (Math.abs(sense) > 0.9) { c.vx = v[0] * Math.sign(sense); c.vy = v[1] * Math.sign(sense); }
        }
      }
      // The same crossing found twice (a ring's two ends, or a road's joint on the line).
      if (crossings.some(o => o.interstate === c.interstate && Math.hypot(o.x - c.x, o.y - c.y) < 0.3)) continue;
      crossings.push({
        interstate: c.interstate, type: c.type, kind: c.kind, x: c.x, y: c.y, ux: c.ux, uy: c.uy, vx: c.vx, vy: c.vy,
        milepost: c.milepost, town: c.town, uEnd: c.uEnd, vEnd: c.vEnd
      });
    }
  }

  // On the ground: rivers (with their widths in the Roblox world) and the other highways.
  const riverLines = map.rivers.map(r => {
    const pts = [];
    for (let k = 0; k < r.points.length; k += 2) pts.push([r.points[k], r.points[k + 1], Math.min(220, Math.max(12, r.widthsM[k / 2] * 0.18)) / 2000]);
    return pts;
  });
  const highwayLines = map.roads.filter(r => r.kind !== 'interstate').map(r => r.points);
  const bbox = pts => pts.reduce((b, q) => [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[0]), Math.max(b[3], q[1])], [Infinity, Infinity, -Infinity, -Infinity]);
  const lineHitsRiver = (line, pad) => {
    const b = bbox(line);
    return riverLines.some(river => river.some((q, k) => {
      if (k === 0 || q[0] < b[0] - 0.2 || q[0] > b[2] + 0.2 || q[1] < b[1] - 0.2 || q[1] > b[3] + 0.2) return false;
      for (let i = 1; i < line.length; i++) if (segSeg(line[i - 1], line[i], river[k - 1], q) < q[2] + pad) return true;
      return false;
    }));
  };
  // Ramps crossing a highway other than the two roads of the crossing itself.
  const rampHitsHighway = (c, ramp) => {
    const b = bbox(ramp);
    return highwayLines.some(line => {
      // Not a road through the crossing.
      if (line.some((q, i) => i > 0 && pointSeg(c.x, c.y, line[i - 1][0], line[i - 1][1], q[0], q[1]) < 0.05)) return false;
      return line.some((q, i) => {
        if (i === 0 || Math.max(q[0], line[i - 1][0]) < b[0] - 0.1 || Math.min(q[0], line[i - 1][0]) > b[2] + 0.1 || Math.max(q[1], line[i - 1][1]) < b[1] - 0.1 || Math.min(q[1], line[i - 1][1]) > b[3] + 0.1) return false;
        for (let k = 1; k < ramp.length; k++) if (segSeg(ramp[k - 1], ramp[k], line[i - 1], q) < p.highwayMarginMi) return true;
        return false;
      });
    });
  };
  const weight = c => (c.kind === 'interstate' ? 0 : c.type === 'interchange' ? (RANK[c.kind] <= 2 ? 1 : 2) : 3);
  crossings.sort((a, b) => weight(a) - weight(b));
  const kept = [];
  let downgraded = 0, dropped = 0;
  for (const c of crossings) {
    // Clear of crossings already kept on other interstates (the crossing of two interstates
    // always stays).
    if (c.kind !== 'interstate' && kept.some(o => o.interstate !== c.interstate && o.kind !== 'interstate' && Math.hypot(o.x - c.x, o.y - c.y) < p.apartMi)) { dropped++; continue; }
    if (c.type === 'interchange' && c.kind !== 'interstate' && !c.uEnd && !c.vEnd) {
      const pad = INTERCHANGE.rampHalf + p.riverMarginMi;
      const ramps = interchangeRamps(c);
      if (ramps.some(r => lineHitsRiver(r, pad) || rampHitsHighway(c, r)) || lineHitsRiver(overpassLine(c), pad)) { c.type = 'overpass'; downgraded++; }
    }
    if (c.type === 'overpass' && lineHitsRiver(overpassLine(c), INTERCHANGE.rampHalf + p.riverMarginMi) && c.kind !== 'us' && c.kind !== 'expressway') { dropped++; continue; }
    kept.push(c);
  }

  // Number the exits along each interstate by milepost.
  for (const c of kept) c.exit = c.type === 'interchange' ? Math.max(1, Math.round(c.milepost)) : 0;

  // Section-line roads a ramp would cross are removed (each mile of them that the ramp meets),
  // except the road the interchange serves.
  for (const c of kept) {
    for (const ramp of interchangeRamps(c)) {
      const b = bbox(ramp);
      for (let J = Math.floor(b[1]) - 1; J <= Math.ceil(b[3]) + 1; J++) {
        for (let I = Math.floor(b[0]) - 1; I <= Math.ceil(b[2]) + 1; I++) {
          if (I < 0 || J < 0 || I >= secSize || J >= secSize) continue;
          for (const east of [true, false]) {
            const a = [I, J], e = east ? [I + 1, J] : [I, J + 1];
            const along = east ? [1, 0] : [0, 1];
            const serves = Math.abs(along[0] * c.vy - along[1] * c.vx) < 0.05 && pointSeg(c.x, c.y, a[0] - along[0] * 2, a[1] - along[1] * 2, e[0] + along[0] * 2, e[1] + along[1] * 2) < 0.05;
            if (serves || !sectionClass(I, J, east)) continue;
            let hit = false;
            for (let k = 1; k < ramp.length && !hit; k++) hit = segSeg(ramp[k - 1], ramp[k], a, e) < INTERCHANGE.rampHalf + 0.012;
            if (hit) sections.roads[J * secSize + I] &= east ? ~3 : ~12;
          }
        }
      }
    }
  }
  kept.stats = { downgraded, dropped };
  return kept;
}

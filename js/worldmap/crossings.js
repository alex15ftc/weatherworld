// Where roads cross the interstates, and how. Interstates are limited-access: they connect only
// to other interstates and to US highways (the map's expressways and highways), and only by
// interchange. Along each interstate, every crossing road is considered in order of importance:
//   another interstate: a system interchange (the one with the later name passes over; ramps
//     link the two in each quadrant);
//   an expressway or highway: a diamond interchange (an off and an on ramp each side, the
//     highway passing over), or an overpass where another exit is too near;
//   a paved county road or town arterial: an overpass (no ramps), kept a good way from the next
//     crossing;
//   anything else, or a paved road too near another crossing: nothing; the road stops short of
//     the interstate either side. Gravel and dirt roads never reach any highway at all.
// Where one of the two roads ends at the crossing (a T), it is recorded (uEnd for the interstate,
// vEnd for the crossing road: the direction, +1 or -1 along u or v, in which the road goes on from
// the crossing; 0 where it runs on both ways): the junction is then a T, the ending road splitting
// into two ramps that merge onto the other, with no bridge.
// Exits are numbered by milepost, from the west end of an east-west interstate or the south end
// of a north-south one.

export const CROSSING_DEFAULTS = Object.freeze({
  minSinAngle: 0.25,          // shallower crossings are the same corridor, not a crossing
  spacingMi: 0.75,            // no two crossings of one interstate closer than this
  exitSpacingTownMi: 3,       // nor two exits closer than this in a town
  exitSpacingRuralMi: 4,      // or in the country
  pavedOverpassMi: 1.5,       // a paved road gets an overpass if no crossing is this near
  gravelOverpassMi: 5,        // a gravel road only if none is this near
  apartMi: 0.9,               // crossings of different interstates at least this far apart
  riverClearMi: 0.35,         // and none this near where the interstate crosses a river
  ruralExitChance: 0.12       // a paved road in the country gets an exit with this chance
});

// Crossing kinds, most important first.
const RANK = { interstate: 0, expressway: 1, highway: 2, paved: 3, gravel: 4, dirt: 5 };
export const CROSSING_CODES = Object.freeze({ interchange: 1, overpass: 2 });
export const CROSS_ROAD_CODES = Object.freeze({ interstate: 1, expressway: 2, highway: 3, paved: 4, gravel: 5 });

function intersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy, den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den, u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
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
  const crossings = [];

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
    const consider = (i, t, kind, vx, vy, name, vEnd = 0) => {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const len = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / len, uy = (by - ay) / len;
      const vl = Math.hypot(vx, vy) || 1;
      const sin = Math.abs(ux * vy / vl - uy * vx / vl);
      if (sin < p.minSinAngle) return;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      const s = along[i - 1] + len * t;
      const uEnd = s < endMi ? 1 : total - s < endMi ? -1 : 0;
      candidates.push({ x, y, ux, uy, vx: vx / vl, vy: vy / vl, kind, sin, along: s, milepost: reversed ? total - s : s, town: inTown(x, y), crossName: name, uEnd, vEnd });
    };
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      // The other map roads.
      for (const o of [...others, ...interstates.filter(r => r !== road)]) {
        for (let k = 1; k < o.points.length; k++) {
          const [cx, cy] = o.points[k - 1], [dx, dy] = o.points[k];
          if (Math.max(cx, dx) < Math.min(ax, bx) || Math.min(cx, dx) > Math.max(ax, bx) || Math.max(cy, dy) < Math.min(ay, by) || Math.min(cy, dy) > Math.max(ay, by)) continue;
          const hit = intersect(ax, ay, bx, by, cx, cy, dx, dy);
          if (hit) {
            // Whether the other road ends here: near its first point it goes on along +v, near
            // its last along -v.
            const segLen = Math.hypot(dx - cx, dy - cy);
            const vEnd = k === 1 && hit.u * segLen < endMi ? 1 : k === o.points.length - 1 && (1 - hit.u) * segLen < endMi ? -1 : 0;
            consider(i, hit.t, o.kind, dx - cx, dy - cy, o.name, vEnd);
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
    for (const c of candidates) {
      if (c.kind === 'dirt') continue;
      if (riverAt.some(a => Math.abs(a - c.along) < p.riverClearMi)) continue;
      const main = c.kind === 'interstate' || c.kind === 'expressway' || c.kind === 'highway';
      if (!main && (near(c, p.spacingMi) || near(c, 1.0, o => o.type === 'interchange'))) continue;
      const exits = o => o.type === 'interchange';
      let type = null;
      if (c.kind === 'interstate') {
        // One record per pair of interstates: kept on the one that goes under (the earlier name).
        if (road.name > c.crossName) continue;
        type = 'interchange';
      } else if (main) {
        // A second crossing right by another is the same corridor (roads sharing a route).
        // Nor may it fall among an exit's ramps (they reach 0.4 mi each way).
        if (near(c, 0.35) || near(c, 0.7, exits)) continue;
        type = near(c, 1, exits) ? 'overpass' : 'interchange';
      } else if (c.kind === 'paved' && !near(c, p.pavedOverpassMi)) {
        type = 'overpass';
      }
      if (type === 'overpass' && (c.vEnd || c.uEnd)) type = null; // a road ending here is not carried over
      if (type) chosen.push({ ...c, type, interstate: road.name });
    }
    for (const c of chosen) {
      // The same crossing found twice (a ring's two ends, or a road's joint on the line).
      if (crossings.some(o => o.interstate === c.interstate && Math.hypot(o.x - c.x, o.y - c.y) < 0.3)) continue;
      crossings.push({
        interstate: c.interstate, type: c.type, kind: c.kind, x: c.x, y: c.y, ux: c.ux, uy: c.uy, vx: c.vx, vy: c.vy,
        exit: c.type === 'interchange' ? Math.max(1, Math.round(c.milepost)) : 0, town: c.town, uEnd: c.uEnd, vEnd: c.vEnd
      });
    }
  }
  // Across interstates: where crossings of two different interstates come close (their ramps would
  // meet), the more important one stays. The crossing of two interstates themselves always stays.
  const weight = c => (c.kind === 'interstate' ? 0 : c.type === 'interchange' ? (RANK[c.kind] <= 2 ? 1 : 2) : 3);
  crossings.sort((a, b) => weight(a) - weight(b));
  const kept = [];
  for (const c of crossings) {
    const clash = kept.some(o => o.interstate !== c.interstate && Math.hypot(o.x - c.x, o.y - c.y) < p.apartMi
      && !(o.kind === 'interstate' && c.kind === 'interstate'));
    if (!clash || c.kind === 'interstate') kept.push(c);
  }
  return kept;
}

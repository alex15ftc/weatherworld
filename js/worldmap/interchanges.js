// The shape of an interstate crossing, in map miles: the ramps of an interchange and the bridge
// carrying the crossing road over the interstate. The same geometry as the Roblox world's
// roblox/src/shared/World/Interchanges.luau, which is in studs: every size here is written in
// studs (STUDS, scale.js) so it matches at any map scale; keep the two in step.
//
//   diamond (a US or state highway): the highway passes over the interstate; on each side an
//     off-ramp leaves 400 studs before the crossing and an on-ramp joins 400 studs after it,
//     curving from the interstate's shoulder to the highway where it is back on the ground;
//   system (two interstates): one passes over the other; a connector in each quadrant between
//     the two interstates' shoulders, 460 studs from the crossing;
//   T (one road ends at the crossing): no bridge; the ending road splits into two ramps merging
//     onto the other road either way.
import { STUDS } from './scale.js';

export const INTERCHANGE = Object.freeze({
  interstateHalf: STUDS(51),   // RoadNet's interstate half-width (pavement): INTERSTATE_HALF
  rampAlong: STUDS(400),       // RAMP_ALONG
  terminalExtra: STUDS(300),   // TERMINAL_EXTRA
  systemAlong: STUDS(460),     // SYSTEM_ALONG
  rampHalf: STUDS(11),         // a ramp's half-width
  approach: STUDS(262)         // a bridge's deck end and ramp beyond the interstate's edge
});
const HALF = { interstate: STUDS(51), expressway: STUDS(39), us: STUDS(18), state: STUDS(18), highway: STUDS(18), paved: STUDS(13), gravel: STUDS(10) };
const SHOULDER = STUDS(8);      // ramps meet a road this far in from its pavement's edge

function bezier(a, c, b, steps) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push([(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]]);
  }
  return out;
}

export function crossingSin(c) {
  return Math.max(0.25, Math.abs(c.ux * c.vy - c.uy * c.vx));
}

// A T: the ending road's direction away from the junction, the through road's direction, its
// half-width and how far out the ending road splits.
export function tee(c) {
  const sin = crossingSin(c);
  if (c.vEnd) return { stem: [c.vx * c.vEnd, c.vy * c.vEnd], through: [c.ux, c.uy], throughHalf: HALF.interstate, split: HALF.interstate / sin + STUDS(140) };
  if (c.uEnd) {
    const throughHalf = HALF[c.kind] ?? HALF.highway;
    return { stem: [c.ux * c.uEnd, c.uy * c.uEnd], through: [c.vx, c.vy], throughHalf, split: throughHalf / sin + STUDS(140) };
  }
  return null;
}

// The ramps of an interchange (polylines of [x, y] miles).
export function interchangeRamps(c) {
  if (c.type !== 'interchange') return [];
  const sin = crossingSin(c), half = INTERCHANGE.interstateHalf, p = [c.x, c.y];
  const add = (a, ...vs) => vs.reduce((acc, [v, k]) => [acc[0] + v[0] * k, acc[1] + v[1] * k], a);
  const T = tee(c);
  if (T) {
    const wt = [-T.through[1], T.through[0]];
    const side = T.stem[0] * wt[0] + T.stem[1] * wt[1] >= 0 ? 1 : -1;
    const s = add(p, [T.stem, T.split]);
    return [-1, 1].map(sa => bezier(s, add(p, [T.through, sa * STUDS(90)], [T.stem, T.split * 0.55]), add(p, [T.through, sa * INTERCHANGE.systemAlong], [wt, side * (T.throughHalf - SHOULDER)]), 12));
  }
  const u = [c.ux, c.uy], v = [c.vx, c.vy], wu = [-c.uy, c.ux], wv = [-c.vy, c.vx];
  const ramps = [];
  if (c.kind === 'interstate') {
    for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
      const sideU = v[0] * sb * wu[0] + v[1] * sb * wu[1] >= 0 ? 1 : -1;
      const sideV = u[0] * sa * wv[0] + u[1] * sa * wv[1] >= 0 ? 1 : -1;
      ramps.push(bezier(add(p, [u, sa * INTERCHANGE.systemAlong], [wu, sideU * (half - SHOULDER)]), add(p, [u, sa * (half / sin + STUDS(120))], [v, sb * (half / sin + STUDS(120))]), add(p, [v, sb * INTERCHANGE.systemAlong], [wv, sideV * (half - SHOULDER)]), 12));
    }
    return ramps;
  }
  const terminal = half / sin + INTERCHANGE.terminalExtra;
  for (const side of [-1, 1]) {
    const toward = (v[0] * wu[0] + v[1] * wu[1]) * side >= 0 ? 1 : -1;
    const t = add(p, [v, toward * terminal]);
    for (const a of [-1, 1]) {
      const along = a * INTERCHANGE.rampAlong;
      ramps.push(bezier(add(p, [u, along], [wu, side * (half - SHOULDER)]), add(p, [u, along * 0.3], [wu, side * (half + STUDS(40))]), t, 10));
    }
  }
  return ramps;
}

// The bridge carrying the crossing road over the interstate, with its approach ramps, as a line
// along the crossing road (none for a T).
export function overpassLine(c) {
  if (tee(c)) return null;
  const reach = INTERCHANGE.interstateHalf / crossingSin(c) + INTERCHANGE.approach;
  return [[c.x - c.vx * reach, c.y - c.vy * reach], [c.x + c.vx * reach, c.y + c.vy * reach]];
}

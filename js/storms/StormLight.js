// The light under a storm, round a point (its tornado, or its wall cloud): what the engine knows of how
// much sunlight reaches there, for the views to light it (the frames' info.light, the scene's light;
// js/game/TornadoScene.js). From the frame's own cloud (StormStructure buildStormFrame: each column's
// cloud runs, each with its visible optical depth, and the ground rain) - the cloud the views draw.
//
// Under a thick storm base the light is the sky's through the cloud (two-stream diffuse transmittance:
// optical depth 50-200 passes 15-4%, 2-10 klux under a midday sun of ~100 klux), plus the light coming
// in sideways from beyond the base's edge - the sunlit ground and sky past the storm, and its clear slot
// - which on a vertical surface (a funnel) falls off only as 1/distance (the view factor of the edge,
// 0.5 H / sqrt(H^2 + x^2) under a base H high), so a gap still lights a funnel 3-5 km in; plus the sun
// itself, which reaches under a base only H / tan(elevation) in from a sunlit edge (0.5 km at 50 deg, 7
// km at 5): the bright late-afternoon tornado. Rain between a gap and the point cuts the light from it.
// (Light-under-supercell research, 2026-11-19: no measured illuminance under supercells or clear-slot
// widths were found; the transmittance and view-factor relations are standard radiative transfer.)
//
// Returns, round the point (box m, x east, y north; bearings clockwise from north):
//   overhead   the column's optical depth (its cloud's water and ice and the rain under it) and its
//              diffuse transmittance
//   bearings   on each of LIGHT.bearings: how far the low cloud (base under 3 km) goes before a gap
//              (edgeKm; null if not within the box, and boxKm how far was looked), the optical depth over
//              the gap (an anvil above it, say) and its transmittance, the rain's optical depth between
//              the point and the gap, and the gap's side-light weight on a vertical surface facing it
//              (the view factor x the gap's transmittance x the rain's): the clear slot, the inflow gap
//              and the storm's edge are where it is high
//   slot       the strongest of those gaps: its bearing, width (the bearings lit at least halfway from the
//              median bearing's light to its; degrees, and km along its edge), distance, place (m east,
//              north of the point), openness (its transmittance), and its light over the median's
//   sun        the direct sunlight at the point, at its mid-height and at the base (the optical depth along
//              the ray to the sun through the box's cloud and rain, and exp(-tau)); null with the sun down
//              or none given. The box is 64 km: cloud beyond it (a long anvil, other storms) is not counted.
import { diffuseTransmittance, rainExtinctionPerKm } from './CloudOptics.js';

export const LIGHT = Object.freeze({ bearings: 16, stepM: 250, sunStepM: 100, topM: 16000 });
const r2 = v => Math.round(v * 100) / 100, r1 = v => Math.round(v * 10) / 10, r3 = v => Math.round(v * 1000) / 1000;

// cols: { nx, ny, dx, anchorX, anchorY, runs (per column: [base m, top m, optical depth][]), low (per
// column: 1 where the cloud's base is under 3 km), rain (per column, mm/h at the ground) }.
// at: { x, y } box m; baseM: the cloud base over it (m); sun: { elevationDeg, azimuthDeg } or null.
export function stormLight(cols, at, { baseM, sun = null } = {}) {
  const { nx, ny, dx, anchorX, anchorY, runs, low, rain } = cols;
  const colAt = (x, y) => { const i = Math.floor((x + anchorX) / dx) + 1, j = Math.floor((y + anchorY) / dx) + 1; return i < 1 || j < 1 || i > nx || j > ny ? -1 : (j - 1) * nx + (i - 1); };
  const tauOf = k => (k < 0 ? 0 : runs[k].reduce((s, r) => s + (r[2] || 0), 0));
  const H = Math.max(50, Number(baseM) || 1000);
  const k0 = colAt(at.x, at.y), overheadTau = tauOf(k0);
  const bearings = [];
  for (let b = 0; b < LIGHT.bearings; b++) {
    const deg = b * 360 / LIGHT.bearings, e = Math.sin(deg * Math.PI / 180), n = Math.cos(deg * Math.PI / 180);
    let rainTau = 0, edge = null, s = 0;
    for (s = LIGHT.stepM; ; s += LIGHT.stepM) {
      const k = colAt(at.x + e * s, at.y + n * s);
      if (k < 0) break;
      if (!low[k]) { edge = { s, k }; break; }
      rainTau += rainExtinctionPerKm(rain[k]) * LIGHT.stepM / 1000;
    }
    const beyondTau = edge ? tauOf(edge.k) : null, beyondT = edge ? diffuseTransmittance(beyondTau) : null;
    const view = edge ? 0.5 * H / Math.hypot(H, edge.s) : 0;
    bearings.push({ deg, edgeKm: edge ? r2(edge.s / 1000) : null, boxKm: edge ? null : r2(s / 1000), beyondTau: edge ? r1(beyondTau) : null,
      beyondTransmittance: edge ? r3(beyondT) : null, rainTau: r2(rainTau), sideWeight: r3(edge ? view * beyondT * Math.exp(-rainTau) : 0) });
  }
  // The clear slot: the strongest gap, and the bearings next to it lit at least halfway from the
  // median of all the bearings (the base's far edge all round) to it; its centre weighted by their light.
  let slot = null;
  const peak = bearings.reduce((best, x, i) => (x.sideWeight > (bearings[best]?.sideWeight ?? 0) ? i : best), -1);
  if (peak >= 0) {
    const nb = bearings.length, step = 360 / nb, w = bearings.map(x => x.sideWeight), med = [...w].sort((p, q) => p - q)[Math.floor(nb / 2)];
    const cut = med + (w[peak] - med) / 2, inside = i => w[(i + nb) % nb] >= cut;
    let lo = 0, hi = 0;
    while (lo > -nb / 2 && inside(peak + lo - 1)) lo--;
    while (hi < nb / 2 && inside(peak + hi + 1)) hi++;
    let se = 0, sn = 0;
    for (let i = lo; i <= hi; i++) { const d = (peak + i) * step * Math.PI / 180, v = w[(peak + i + nb) % nb] - med; se += v * Math.sin(d); sn += v * Math.cos(d); }
    const p = bearings[peak], widthDeg = (hi - lo + 1) * step, centre = se || sn ? (Math.atan2(se, sn) * 180 / Math.PI + 360) % 360 : p.deg;
    slot = { bearingDeg: r1(centre), widthDeg, widthKm: r2(2 * Math.PI * p.edgeKm * widthDeg / 360), distanceKm: p.edgeKm,
      at: [Math.round(Math.sin(p.deg * Math.PI / 180) * p.edgeKm * 1000), Math.round(Math.cos(p.deg * Math.PI / 180) * p.edgeKm * 1000)],
      openness: p.beyondTransmittance, weight: p.sideWeight, overMedian: r3(w[peak] - med) };
  }
  // The sun: along the ray from the point toward it, each cloud run crossed adds its extinction
  // (optical depth / depth) times the slant path.
  let sunOut = null;
  if (sun && sun.elevationDeg > 0) {
    const el = sun.elevationDeg * Math.PI / 180, az = sun.azimuthDeg * Math.PI / 180, e = Math.sin(az), n = Math.cos(az), tanE = Math.tan(el), slant = LIGHT.sunStepM / Math.cos(el);
    sunOut = [0, 0.5, 1].map(share => {
      const z0 = share * H;
      let tau = 0, leftBox = false;
      for (let s = 0; ; s += LIGHT.sunStepM) {
        const z = z0 + s * tanE;
        if (z > LIGHT.topM) break;
        const k = colAt(at.x + e * s, at.y + n * s);
        if (k < 0) { leftBox = true; break; }
        for (const r of runs[k]) if (z >= r[0] && z <= r[1] && r[1] > r[0]) tau += (r[2] || 0) / (r[1] - r[0]) * slant;
      }
      return { zM: Math.round(z0), tau: r1(tau), direct: r3(Math.exp(-tau)), leftBox };
    });
  }
  return { overhead: { tau: r1(overheadTau), transmittance: r3(diffuseTransmittance(overheadTau)) }, baseM: Math.round(H), bearings, slot, sun: sunOut };
}

// The engine's maintenance assumption (M2, docs/research/ENGINE-MODEL-COUPLING.md): the lift a
// running storm needs to keep lifting its inflow through the cap, and does not get from anything
// the engine's grid shows. The engine keeps its storms alive under a cap almost regardless
// (StormRealizationPhysics' inhibitionEfficiency, StormHazards' stormFuel); this names the lift
// that assumes. It changes nothing in the engine: it goes to the cloud model as large-scale rising
// air (js/game/LabWindow.js labStorm -> StormWorkers workerRecord -> EngineRun liftRows), so the
// model's storm survives the cap for the engine's reason, not by the push alone.
//   deficit D = max(0, CIN - L), J/kg, with the storm's own lift L:
//     gust front  1/2 (a c)^2: c the cold pool's speed as StormRealizationPhysics has it
//                 (the storm's one cold pool, ColdPool.js: 38 m/s x sqrt(coldPoolStrength)), a its balance with
//                 the low-level shear as there (RKW: 1 at c = 0.58 x 0-6 km shear)
//     rotation    (zeta r)^2 / 2, the dynamic low under the low-level mesocyclone: zeta 0.01 /s x
//                 lowRotation over r 2 km (about 200 J/kg at full rotation)
//   as rising air at cloud base: the inverse of InitiationEngine kainFritschLift (the lift the
//   engine credits mesoscale ascent w with over the cap's depth), and as a convergence, w / the LCL
//   height (1e-5 /s), the unit the model's convergence lift takes.
// Sounding: the storm's own cell (tools/cloudlab/synccheck.mjs tested it so, 2026-11-05: seed 2 and
// 5150, 3 storms x 3 h each - with the push ceiling at 0.25 the model's storms lived as they did at
// 0.35 without it and followed the engine's strength, updraft and rotation more closely).
import { buildSounding } from '../sounding.js';
import { coldPoolSpeedMs } from './ColdPool.js';

const KF_COEFFICIENT = 4.64, KF_THRESHOLD_MS = 0.02; // as InitiationEngine.js
const CAP_DEPTH_M = [200, 2000], DEFAULT_CAP_DEPTH_M = 800;
const DYNAMIC_ZETA = 0.01, DYNAMIC_R_M = 2000;
const KT = 0.514444;

export function maintenanceLift(world, storm) {
  const cellKm = world.cellSizeKm;
  const cx = Math.min(world.width - 1, Math.max(0, Math.floor(storm.positionKm.x / cellKm)));
  const cy = Math.min(world.height - 1, Math.max(0, Math.floor(storm.positionKm.y / cellKm)));
  const cell = world.getCell(cx, cy), p = buildSounding(cell).params, terrain = Number(cell.terrain?.elevationM) || 0;
  const cin = Math.abs(p.mlcinMagnitude ?? p.mlcin ?? 0);
  const lcl = Math.max(100, p.lclAglM ?? 1000), lfc = (p.lfcM ?? NaN) - terrain;
  const capDepth = Number.isFinite(lfc) && lfc > lcl ? Math.min(CAP_DEPTH_M[1], Math.max(CAP_DEPTH_M[0], lfc - lcl)) : DEFAULT_CAP_DEPTH_M;
  const c = coldPoolSpeedMs(storm.coldPoolStrength ?? 0.15); // its one cold pool (ColdPool.js)
  const shear = Math.max(2, (p.shear06 ?? 30) * KT * 0.58);
  const a = Math.exp(-((((c / shear) - 1) / 0.65) ** 2));
  const liftJkg = 0.5 * (a * c) ** 2 + 0.5 * (DYNAMIC_ZETA * (storm.lowRotation ?? 0) * DYNAMIC_R_M) ** 2;
  const deficitJkg = Math.max(0, cin - liftJkg);
  const w = deficitJkg > 0 ? KF_THRESHOLD_MS * Math.max(0.25, Math.min(1, lcl / 2000)) + (deficitJkg * 293 / (9.81 * KF_COEFFICIENT * capDepth)) ** 3 : 0;
  return { cinJkg: cin, liftJkg, deficitJkg, convergence: w / lcl * 1e5 };
}

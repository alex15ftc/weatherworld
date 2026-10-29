// The storm lab's view of the engine's world (roblox/src/stormlab): a window of cells round a point
// with each cell's full sounding, the analysed boundaries and the storms inside it, in the lab's
// frame (x east, y NORTH, metres from the window centre; the engine's map has y south). The game
// server rebuilds its atmosphere (Sim/World) from this and keeps its storms in step with the
// engine's (docs/stormlab/SYNC-PLAN.md). scripts/export-lab-scenario.mjs writes the same thing to a
// file for the lab.
//
//   buildLabWindow(world, { centreKm: {x, y}, half, boundaries, feed, meta })
//     centreKm    map km (y south) of the point the window is round (snapped to a cell centre)
//     half        cells each way from the centre cell (7: a 15 x 15 window)
//     boundaries  the engine's analysed boundaries (atmosphere.boundaries or mesoscale)
//     feed        the game feed's appearance list (buildStormFeedList), matched to storms by id
//   -> { meta, cells, boundaries, storms }  (meta also says where the window sits on the map)
import { buildSounding } from '../sounding.js';
import { lineShare, rotatingShare } from '../storms/StormModeEngine.js';

const KT = 0.514444;
const r1 = x => Math.round(x * 10) / 10;
const r2 = x => Math.round(x * 100) / 100;
const windUv = (dirFrom, speedKt) => {
  const r = dirFrom * Math.PI / 180;
  return [-Math.sin(r) * speedKt * KT, -Math.cos(r) * speedKt * KT];
};

// The storms inside a window, in the lab's frame (also used alone for the game server's nudging).
export function labStorms(world, centre, half, feed = []) {
  const lab = (xKm, yKm) => [Math.round((xKm - centre.x) * 1000), Math.round(-(yKm - centre.y) * 1000)];
  const inside = p => Math.abs(p.x - centre.x) <= half && Math.abs(p.y - centre.y) <= half;
  return (world.storms ?? []).filter(s => s.active && inside(s.positionKm)).map(s => ({
    id: s.id,
    pos: lab(s.positionKm.x, s.positionKm.y),
    motion: [r1(s.velocityKph.east / 3.6), r1(s.velocityKph.north / 3.6)],
    ageMin: Math.round((s.ageHours ?? 0) * 60), mode: s.mode,
    intensity: r2(s.intensity ?? 0), updraftMs: r1(s.updraughtMs ?? 0),
    meso: r2(s.mesocycloneStrength ?? 0), lowRotation: r2(s.lowRotation ?? 0), occlusion: r2(s.occlusion ?? 0),
    rotating: r2(rotatingShare(s)), line: r2(lineShare(s)), lineHalfKm: r1(s.lineHalfLengthKm ?? 0), rearInflow: r2(s.rearInflow ?? 0),
    coldPool: r2(s.coldPoolStrength ?? 0), coldPoolKm: r1(s.coldPoolRadiusKm ?? 0), leftMover: !!s.leftMover,
    maxDbz: Math.round(s.radar?.maxReflectivityDbz ?? 0), hailIn: r2(s.currentHailSizeInches ?? 0),
    // (orbit: rad/s, counterclockwise seen from above, while an occluding tornado revolves round
    // its mesocyclone - the storm's position; TornadoEngine occlusionStep)
    tornado: s.tornado?.onGround ? { mph: Math.round(s.tornado.windSpeedMph), yards: Math.round(s.tornado.widthYards ?? 0), ef: s.tornado.estimatedEf ?? null, pos: lab(s.tornado.positionKm.x, s.tornado.positionKm.y), orbit: +((s.tornado.orbitRadPerS ?? 0).toFixed(5)) } : null,
    feed: feed.find(f => f.id === s.id) ?? null,
  }));
}

export function buildLabWindow(world, { centreKm, half: HALF = 7, boundaries = [], feed = [], meta = {} }) {
  const cellKm = world.cellSizeKm;
  const cx = Math.min(world.width - 1 - HALF, Math.max(HALF, Math.floor(centreKm.x / cellKm)));
  const cy = Math.min(world.height - 1 - HALF, Math.max(HALF, Math.floor(centreKm.y / cellKm)));
  const centre = { x: (cx + 0.5) * cellKm, y: (cy + 0.5) * cellKm };
  const lab = (xKm, yKm) => [Math.round((xKm - centre.x) * 1000), Math.round(-(yKm - centre.y) * 1000)];
  const cells = [];
  for (let j = -HALF; j <= HALF; j++) for (let i = -HALF; i <= HALF; i++) {
    const cell = world.getCell(cx + i, cy + j);
    const s = buildSounding(cell);
    const elev = cell.terrain.elevationM ?? 0;
    const [us, vs] = windUv(cell.surface.wind.direction, cell.surface.wind.speed);
    cells.push({
      i, j: -j, // j: rows NORTH of the centre
      pos: lab((cx + i + 0.5) * cellKm, (cy + j + 0.5) * cellKm),
      elevM: Math.round(elev),
      tC: r1((cell.surface.temperature - 32) * 5 / 9),
      tdC: r1((cell.surface.dewpoint - 32) * 5 / 9),
      u: r1(us), v: r1(vs),
      mslp: r1(cell.surface.seaLevelPressure ?? 1013),
      coldPoolK: r1(cell.features?.coldPoolK ?? 0),
      convergence: Number(((cell.dynamics?.surfaceConvergenceS1 ?? 0) * 1e5).toFixed(2)), // 1e-5 /s
      engine: { sbcape: Math.round(s.params.sbcape), mlcape: Math.round(s.params.mlcape), mlcin: Math.round(s.params.mlcin), lclAgl: Math.round(s.params.lclAglM), srh01: Math.round(s.params.srh01), srh03: Math.round(s.params.srh03), shear06: r1(s.params.shear06 * KT), stp: r2(s.params.stp), pwMm: r1((s.params.precipWater ?? 0) * 25.4) },
      sounding: s.profile.map(row => [r1(row.p), r1(row.t), r1(row.td), r1(row.u * KT), r1(row.v * KT)]),
    });
  }
  const halfKm = (HALF + 0.5) * cellKm;
  const inside = p => Math.abs(p.x - centre.x) <= halfKm && Math.abs(p.y - centre.y) <= halfKm;
  const bnd = (Array.isArray(boundaries) ? boundaries : []).filter(b => b.pointsKm?.some(inside)).map(b => ({
    id: b.id, type: b.type, strength: r2(b.strength ?? 0), contrast: r2(b.contrast ?? 0), advanceMs: r2(b.advanceMs ?? 0), symbolSide: b.symbolSide,
    points: b.pointsKm.map(p => lab(p.x, p.y)),
  }));
  return {
    // (simHourUtc to 4 places: the game server places the engine's storms by it; 0.01 h is 36 s, ~0.5 km of motion)
    meta: { ...meta, simHourUtc: +(world.stormEngine?.validHourUtc ?? world.validHourUtc).toFixed(4), cellKm: r2(cellKm), half: HALF, centreMapKm: { x: r1(centre.x), y: r1(centre.y) } },
    cells, boundaries: bnd, storms: labStorms(world, centre, halfKm, feed),
  };
}

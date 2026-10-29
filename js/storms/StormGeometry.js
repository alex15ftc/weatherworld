// Where the parts of a storm are, from its own state and the winds through it. One description
// for everything that draws a storm: the radar picture and the 3D object in the game.
//
// Frame: x east and y south in km on the map (as storm positions are); heights in metres above
// the ground. Bearings are degrees clockwise from north, the way the thing extends.
//
// A rotating storm grows from its MESOCYCLONE (2026-10-29): the storm's position is its low-level
// mesocyclone, where its wall cloud hangs and its tornado forms, and the rest is placed from it
// (docs/stormlab/RESEARCH-SUPERCELL-LAYOUT.md: Lemon & Doswell 1979, Markowski 2002). The updraught
// column leans downshear from it: the BWER, the mid-level mesocyclone and the highest echo tops are
// 1-5 km ahead, the distance the storm-relative wind carries air rising to mid-levels. The
// forward-flank rain falls downwind of the updraught, and the rear-flank downdraught and hook wrap
// round the mesocyclone from behind (StormStructureEngine). A storm that doesn't rotate (a cell, a
// line) is centred on its updraught as before.
//   updraught   the rising column: where, how wide, how fast, cloud base and top
//   wallCloud   the lowering under the updraught that low-level rotation makes: the cue
//               that comes before a tornado
//   rain, hail  the cores the rain and hail fall in, carried downwind of the updraught by the
//               wind through the storm's depth
//   rearFlank   the outflow wrapping around the rotation (0 open, 1 wrapped: occluded)
//   gustFront   the leading edge of the rain-cooled air
//   anvil       the spread of cloud downwind at the top
//   line        how far the storm is part of a line, and the line's length, axis and bow
//   tornado     where it is and how wide, while one is down
import { clamp } from '../scenarios/math.js';
import { rotatingShare, lineShare, outflowDominance } from './StormModeEngine.js';

const KPH_PER_KT = 1.852;
const GEOMETRY = {
  fallHours: 0.3,                  // time the rain takes to fall, which sets how far downwind it lands
  rainOffsetKm: [3, 45], anvilHours: 3, anvilKm: [15, 300], anvilSpeedShare: 1.4,
  topM: [7000, 17500], topPerMs: 160
};
// How far the updraught leans from the mesocyclone: the storm-relative mid-level wind over the time
// air takes to rise riseM at the updraught's speed (km, kept within the observed 1-5 km).
const TILT = Object.freeze({ riseM: 5000, minMs: 10, km: [1, 5] });
const ramp = (value, low, high) => clamp(((Number(value) || 0) - low) / (high - low), 0, 1);
const bearing = (east, north) => (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;

export function buildStormGeometry(storm, environment = storm.environment ?? {}) {
  const G = GEOMETRY, at = storm.positionKm, v = storm.velocityKph ?? { east: 0, north: 0 }, speed = Math.hypot(v.east, v.north) || 1;
  const along = { east: v.east / speed, north: v.north / speed }, right = { east: along.north, north: -along.east };
  const updraughtMs = storm.updraughtMs ?? 0, rain = clamp(storm.precipitation ?? 0, 0, 1), rotating = rotatingShare(storm), linear = lineShare(storm);
  const low = clamp(storm.lowRotation ?? 0, 0, 1.2), lowFree = clamp(storm.lowRotationFree ?? low, 0, 1.2);
  // Wind through the storm's depth relative to the storm: where its rain and its anvil go.
  const aloft = environment.wind500 ?? { eastKt: 0, northKt: 0 };
  const relative = { east: (aloft.eastKt ?? 0) * KPH_PER_KT - v.east, north: (aloft.northKt ?? 0) * KPH_PER_KT - v.north }, relativeSpeed = Math.hypot(relative.east, relative.north);
  const downwind = relativeSpeed > 1 ? { east: relative.east / relativeSpeed, north: relative.north / relativeSpeed } : along;
  const place = (east, north) => ({ xKm: at.x + east, yKm: at.y - north });
  const radiusKm = 2.5 + 0.1 * updraughtMs + 1.5 * rotating;
  // The updraught's lean from the mesocyclone (the origin), as far as the storm is a rotating one.
  const asRotating = ramp(rotating * (1 - linear), 0.15, 0.6);
  const tiltKm = clamp(relativeSpeed * TILT.riseM / Math.max(updraughtMs, TILT.minMs) / 3600, TILT.km[0], TILT.km[1]) * asRotating;
  const lean = { east: downwind.east * tiltKm, north: downwind.north * tiltKm };
  const rainOffset = clamp(relativeSpeed * G.fallHours, G.rainOffsetKm[0], G.rainOffsetKm[1]) * (0.3 + 0.7 * clamp(storm.organization ?? 0, 0, 1));
  // (the rain falls downwind of the updraught, so its core is measured from there)
  const rainCentre = { east: lean.east + downwind.east * rainOffset, north: lean.north + downwind.north * rainOffset };
  const hailInches = storm.currentHailSizeInches ?? 0;
  const wallStrength = ramp(low, 0.04, 0.4);
  storm.geometry = {
    updraught: { ...place(lean.east, lean.north), leanKm: tiltKm, radiusKm, speedMs: updraughtMs, baseM: Number(environment.lcl) || 1200, topM: clamp(G.topM[0] + G.topPerMs * updraughtMs, G.topM[0], G.topM[1]), rotation: clamp(storm.mesocycloneStrength ?? 0, 0, 1.2) },
    // At the mesocyclone, the origin: on the updraught's rear (upshear) edge, where the inflow meets
    // the wrapping rear-flank outflow. A tornado forms here (TornadoEngine), and the radar's hook
    // and couplet curl round it.
    wallCloud: { ...place(0, 0), strength: wallStrength, radiusKm: 1 + 3 * lowFree, loweringM: wallStrength > 0 ? 150 + 450 * wallStrength : 0, rotation: low },
    rain: { ...place(rainCentre.east, rainCentre.north), alongKm: 8 + 26 * rain + 10 * linear, acrossKm: 6 + 16 * rain, bearingDeg: bearing(downwind.east, downwind.north), intensity: rain },
    // (the hail falls close to the updraught, on its forward edge)
    hail: { ...place(lean.east + (rainCentre.east - lean.east) * 0.3, lean.north + (rainCentre.north - lean.north) * 0.3), radiusKm: hailInches > 0.25 ? 1.5 + 1.6 * hailInches : 0, sizeInches: hailInches },
    rearFlank: { wrap: clamp(storm.occlusion ?? 0, 0, 1), strength: clamp((storm.coldPoolStrength ?? 0) * (0.4 + 0.6 * rotating), 0, 1) },
    gustFront: { radiusKm: storm.coldPoolRadiusKm ?? 0, strength: clamp(storm.coldPoolStrength ?? 0, 0, 1), leadKm: (storm.coldPoolRadiusKm ?? 0) * (0.3 + 0.7 * outflowDominance(storm, environment)), gustMph: storm.surfaceWind?.gustMph ?? 0 },
    anvil: { lengthKm: clamp(relativeSpeed * G.anvilSpeedShare * Math.min(storm.ageHours ?? 0, G.anvilHours), G.anvilKm[0], G.anvilKm[1]), widthKm: 20 + 60 * clamp(storm.intensity ?? 0, 0, 1), bearingDeg: bearing(downwind.east, downwind.north), topM: clamp(G.topM[0] + G.topPerMs * updraughtMs, G.topM[0], G.topM[1]) - 1500 },
    line: { share: linear, halfLengthKm: linear > 0.2 ? (storm.lineHalfLengthKm ?? storm.radar?.radiusXKm ?? 20) : 0, axisBearingDeg: bearing(right.east, right.north), bow: clamp(storm.rearInflow ?? 0, 0, 1) },
    tornado: null
  };
  // After the rest, so a tornado without a position of its own falls back to this wall cloud.
  storm.geometry.tornado = tornadoGeometry(storm);
  return storm.geometry;
}

// Where the tornado is (TornadoEngine's position, the one place everything reads it from) and
// how wide, while one is down. The storm engine sets it again once the tornado has moved. A
// tornado with no position yet is under the wall cloud, as TornadoEngine puts one at touchdown.
export function tornadoGeometry(storm) {
  const t = storm.tornado, wall = storm.geometry?.wallCloud;
  const at = t?.positionKm ?? (wall ? { x: wall.xKm, y: wall.yKm } : storm.positionKm);
  return t?.onGround ? { xKm: at.x, yKm: at.y, widthYards: t.widthYards ?? 0, windMph: t.windSpeedMph ?? 0 } : null;
}

// The rain core's place in the storm's own frame (x along its motion, y to the right of it), in km.
export function rainOffsetInStormFrame(storm) {
  return offsetInStormFrame(storm, storm.geometry?.rain);
}

// A part's place (anything with xKm, yKm) in the storm's own frame, in km from the storm's
// position (its mesocyclone): x along its motion, y to the right of it.
export function offsetInStormFrame(storm, part) {
  const v = storm.velocityKph ?? { east: 0, north: 0 }, speed = Math.hypot(v.east, v.north) || 1;
  if (!part) return { x: 0, y: 0 };
  const east = part.xKm - storm.positionKm.x, north = -(part.yKm - storm.positionKm.y);
  return { x: (east * v.east + north * v.north) / speed, y: (east * v.north - north * v.east) / speed };
}

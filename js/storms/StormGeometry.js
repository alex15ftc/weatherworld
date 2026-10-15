// Where the parts of a storm are, from its own state and the winds through it. One description
// for everything that draws a storm: the radar picture and the 3D object in the game.
//
// Frame: x east and y south in km on the map (as storm positions are); heights in metres above
// the ground. Bearings are degrees clockwise from north, the way the thing extends.
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
// Where the wall cloud is, in updraught radii: behind the updraught's centre and to its right.
export const WALL_CLOUD = Object.freeze({ back: 0.3, right: 0.4 });
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
  // The rotation is on the right of the updraught, or on the left of a left-moving storm.
  const side = storm.leftMover ? -1 : 1;
  const rainOffset = clamp(relativeSpeed * G.fallHours, G.rainOffsetKm[0], G.rainOffsetKm[1]) * (0.3 + 0.7 * clamp(storm.organization ?? 0, 0, 1));
  const rainCentre = { east: downwind.east * rainOffset, north: downwind.north * rainOffset };
  const hailInches = storm.currentHailSizeInches ?? 0;
  const wallStrength = ramp(low, 0.04, 0.4);
  storm.geometry = {
    updraught: { ...place(0, 0), radiusKm, speedMs: updraughtMs, baseM: Number(environment.lcl) || 1200, topM: clamp(G.topM[0] + G.topPerMs * updraughtMs, G.topM[0], G.topM[1]), rotation: clamp(storm.mesocycloneStrength ?? 0, 0, 1.2) },
    // Under the rear right of the updraught, where the inflow meets the wrapping outflow. A
    // tornado forms here (TornadoEngine), and the radar's hook and couplet are drawn here.
    wallCloud: { ...place(side * right.east * WALL_CLOUD.right * radiusKm - along.east * WALL_CLOUD.back * radiusKm, side * right.north * WALL_CLOUD.right * radiusKm - along.north * WALL_CLOUD.back * radiusKm), strength: wallStrength, radiusKm: 1 + 3 * lowFree, loweringM: wallStrength > 0 ? 150 + 450 * wallStrength : 0, rotation: low },
    rain: { ...place(rainCentre.east, rainCentre.north), alongKm: 8 + 26 * rain + 10 * linear, acrossKm: 6 + 16 * rain, bearingDeg: bearing(downwind.east, downwind.north), intensity: rain },
    hail: { ...place(rainCentre.east * 0.3, rainCentre.north * 0.3), radiusKm: hailInches > 0.25 ? 1.5 + 1.6 * hailInches : 0, sizeInches: hailInches },
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
  const g = storm.geometry, v = storm.velocityKph ?? { east: 0, north: 0 }, speed = Math.hypot(v.east, v.north) || 1;
  if (!g) return { x: 0, y: 0 };
  const east = g.rain.xKm - storm.positionKm.x, north = -(g.rain.yKm - storm.positionKm.y);
  return { x: (east * v.east + north * v.north) / speed, y: (east * v.north - north * v.east) / speed };
}

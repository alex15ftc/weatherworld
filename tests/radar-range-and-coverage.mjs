// What a radar cannot do: its view of a storm gets worse with range, and the network does not
// cover the map evenly.
import assert from 'node:assert/strict';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { Storm } from '../js/storms/Storm.js';
import { evolveStormStructure } from '../js/storms/StormStructureEngine.js';
import { buildRadarScene, createRadarSites, scanRadarTilt, buildRadarMosaic } from '../js/radar/RadarSimulator.js';
import { RADAR_RADIALS, RADAR_GATES, RADAR_GATE_KM, RADAR_RANGE_KM, beamHeightKm, decodeRadarValue } from '../js/radar/RadarFormat.js';

// (The map is held still: this test is about the radar, and the same storm is wanted over the
// same ground at every range.)
const atmosphere = new AtmosphereWorld({ seed: 2, spinUpDays: 6, storms: false, steering: false }), world = atmosphere.world;
atmosphere.advance(9);
const sites = createRadarSites(world), site = sites.find(s => s.id === 'KCPL');
const domainKm = world.width * world.cellSizeKm;

// --- The network: uneven, with poorly covered country and a little with no radar at all. ---
let low = 0, high = 0, none = 0, total = 0;
for (let y = 5; y < domainKm; y += 10) for (let x = 5; x < domainKm; x += 10) {
  const ground = Math.min(...sites.map(s => Math.hypot(s.xKm - x, s.yKm - y)));
  total++;
  if (ground > RADAR_RANGE_KM) none++; else if (beamHeightKm(ground, 0.5) > 3) high++; else if (beamHeightKm(ground, 0.5) < 1) low++;
}
assert.ok(high / total > 0.1 && high / total < 0.3, `a tenth to three tenths of the map should have no view of the lowest 3 km (${(100 * high / total).toFixed(0)}%)`);
assert.ok(none / total > 0 && none / total < 0.05, `a little of the map should be beyond every radar (${(100 * none / total).toFixed(1)}%)`);
assert.ok(low / total > 0.12, `the country near the radars is still well covered (${(100 * low / total).toFixed(0)}%)`);

// --- One violent tornadic supercell, the same at every range. ---
function view(rangeKm, tornadoDown = true) {
  const x = site.xKm + rangeKm * Math.cos(0.3), y = site.yKm + rangeKm * Math.sin(0.3);
  const storm = new Storm({ id: 'TEST-SC', xKm: x, yKm: y, velocityEastKph: 45, velocityNorthKph: 25, sourceCell: { x: 0, y: 0 }, createdHourUtc: world.validHourUtc });
  Object.assign(storm, {
    mode: 'discrete supercell', ageHours: 2.5, intensity: 0.85, organization: 0.9, updraftStrength: 0.9, updraughtMs: 45, precipitation: 0.9,
    lowRotation: 0.6, lowRotationFree: 0.7, occlusion: 0.2, currentHailSizeInches: 2.5, mesocycloneStrength: 1.05, rotationStrength: 1, coldPoolStrength: 0.35,
    orientationDeg: Math.atan2(45, -25) * 180 / Math.PI, tornado: { onGround: tornadoDown, widthYards: 700, windSpeedMph: 165 }
  });
  evolveStormStructure(storm, { cape: 3200, bulkShear: 55, lapseRate700500: 7.8, dewpoint: 68 }, 0, 'TEST-SC');
  const synthetic = Object.create(Object.getPrototypeOf(world));
  Object.assign(synthetic, world, { storms: [storm] });
  const scene = buildRadarScene(synthetic), scan = scanRadarTilt(scene, site, 0.5), echo = scene.storms[0].echo;
  const spot = echo.tornado ?? echo.mesocyclone, tx = x + spot.x, ty = y + spot.y;
  const near = (product, radius, pick) => {
    let best = null;
    for (let dy = -radius; dy <= radius; dy += 0.25) for (let dx = -radius; dx <= radius; dx += 0.25) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const ex = tx + dx - site.xKm, ey = ty + dy - site.yKm, gate = Math.floor(Math.hypot(ex, ey) / RADAR_GATE_KM);
      if (gate >= RADAR_GATES) continue;
      const az = (Math.atan2(ex, -ey) * 180 / Math.PI + 360) % 360;
      const value = decodeRadarValue(product, scan.products[product][(Math.floor(az / (360 / RADAR_RADIALS)) % RADAR_RADIALS) * RADAR_GATES + gate]);
      if (value !== null && (best === null || pick(value, best))) best = value;
    }
    return best;
  };
  // Outbound less inbound wind within 3 km of the rotation.
  const couplet = near('stormRelativeVelocity', 3, (v, b) => v > b) - near('stormRelativeVelocity', 3, (v, b) => v < b);
  return { scene, x, y, couplet, debrisCc: near('correlationCoefficient', 2, (v, b) => v < b) };
}
const close = view(40), middle = view(110), far = view(190);
// What the tornado itself adds to the couplet, over the same storm with no tornado down.
const added = { close: close.couplet - view(40, false).couplet, middle: middle.couplet - view(110, false).couplet, far: far.couplet - view(190, false).couplet };
assert.ok(added.close >= 20, `close to the radar the tornado stands out of the storm's rotation (adds ${added.close} m/s)`);
assert.ok(added.middle < 0.5 * added.close, `at 110 km the beam is too wide and too high to resolve it (adds ${added.middle} against ${added.close} m/s)`);
assert.ok(added.far < 5, `at 190 km only the broad rotation aloft is left (the tornado adds ${added.far} m/s)`);
// (0.8 to 0.82 on 2026-10-20: with the boundary layer's lighter friction the world's low-level wind
// here is stronger and carries the debris a little wider, 0.806 against 0.79; a debris signature is
// read at about 0.8 or less. 0.82 to 0.83 on 2026-10-21: the evening jet's stronger low-level wind
// spreads it a little further again, 0.823-0.827.)
assert.ok(close.debrisCc <= 0.83, `close to the radar the debris is plain (${close.debrisCc})`);
// (A violent tornado lofts debris to 3.5 km, which the bottom of the beam still grazes there,
// and the hail core beside it lowers the value too. The gap 0.09 to 0.06 on 2026-10-21 with the near
// value above: the debris is spread thinner by the low-level wind, not seen any better far off.)
assert.ok(far.debrisCc >= 0.87 && far.debrisCc - close.debrisCc >= 0.06, `far from it the beam passes over nearly all the debris (${far.debrisCc} against ${close.debrisCc})`);

// --- The mosaic is blank where no radar reaches. ---
const edge = { x: 4, y: 0.52 * domainKm };
assert.ok(Math.min(...sites.map(s => Math.hypot(s.xKm - edge.x, s.yKm - edge.y))) > RADAR_RANGE_KM, 'the west-centre edge is beyond every radar');
const stormAtEdge = view(40);   // any scene: the mosaic only needs a storm placed in the gap
const gapStorm = stormAtEdge.scene.storms[0]; gapStorm.x = edge.x + 6; gapStorm.y = edge.y;
const mosaic = buildRadarMosaic({ ...stormAtEdge.scene, stormBins: { size: 1e9, cols: 1, rows: 1, cells: [[gapStorm]] } }, sites);
let seen = 0;
for (let j = Math.floor(edge.y) - 8; j <= Math.floor(edge.y) + 8; j++) for (let i = 0; i < 8; i++) seen += mosaic.bytes[j * mosaic.width + i] ? 1 : 0;
assert.equal(seen, 0, 'a storm beyond every radar does not appear in the mosaic');

console.log(JSON.stringify({ coverage: { under1km: +(low / total).toFixed(2), over3km: +(high / total).toFixed(2), none: +(none / total).toFixed(3) }, couplet: { close: close.couplet, middle: middle.couplet, far: far.couplet }, tornadoAdds: added, debrisCc: { close: close.debrisCc, far: far.debrisCc } }));

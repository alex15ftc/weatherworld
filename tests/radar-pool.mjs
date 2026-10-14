// The radar worked out on the radar pool's threads is the same, byte for byte, as worked out on
// one thread: the scene's storms, the mosaic (built in strips) and the scans.
import assert from 'node:assert/strict';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { Storm } from '../js/storms/Storm.js';
import { evolveStormStructure } from '../js/storms/StormStructureEngine.js';
import { buildRadarScene, createRadarSites, scanRadarTilt, buildRadarMosaic } from '../js/radar/RadarSimulator.js';
import { RadarPool } from '../server/RadarPool.js';

const atmosphere = new AtmosphereWorld({ seed: 2, spinUpDays: 6, storms: false, steering: false }), world = atmosphere.world;
atmosphere.advance(9);
const sites = createRadarSites(world), site = sites.find(s => s.id === 'KCPL');
// A tornadic supercell and a weaker storm beside it, near the radar.
world.storms = [[40, 0.3, true, 0.85], [90, 1.4, false, 0.5]].map(([rangeKm, bearing, tornado, intensity], k) => {
  const storm = new Storm({ id: `POOL-${k}`, xKm: site.xKm + rangeKm * Math.cos(bearing), yKm: site.yKm + rangeKm * Math.sin(bearing), velocityEastKph: 45, velocityNorthKph: 25, sourceCell: { x: 0, y: 0 }, createdHourUtc: world.validHourUtc });
  Object.assign(storm, {
    mode: 'discrete supercell', ageHours: 2.5, intensity, organization: 0.9, updraftStrength: intensity, updraughtMs: 50 * intensity, precipitation: 0.9,
    lowRotation: 0.6, lowRotationFree: 0.7, occlusion: 0.2, currentHailSizeInches: 2.5 * intensity, mesocycloneStrength: 1.05, rotationStrength: 1, coldPoolStrength: 0.35,
    orientationDeg: Math.atan2(45, -25) * 180 / Math.PI, tornado: { onGround: tornado, widthYards: 700, windSpeedMph: 165 }
  });
  evolveStormStructure(storm, { cape: 3200, bulkShear: 55, lapseRate700500: 7.8, dewpoint: 68 }, 0, storm.id);
  return storm;
});

const scene = buildRadarScene(world);
const pool = new RadarPool({ size: 3 });
try {
  const pooled = await pool.buildScene(world);
  assert.equal(pooled.storms.length, scene.storms.length, 'every storm is in the pooled scene');
  const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;
  pooled.storms.forEach((s, k) => assert.ok(same(s.echo.grid.rain, scene.storms[k].echo.grid.rain), `storm ${k}'s precipitation`));
  assert.ok(same((await pool.mosaic(pooled, sites)).bytes, buildRadarMosaic(scene, sites).bytes), 'the mosaic built in strips');
  for (const tilt of [0.5, 3.1]) {
    const [a, b] = [await pool.scan(pooled, site, tilt), scanRadarTilt(scene, site, tilt)];
    for (const key of Object.keys(b.products)) assert.ok(same(a.products[key], b.products[key]), `${key} at ${tilt}°`);
  }
} finally { await pool.stop(); }
console.log(`radar pool passed (${scene.storms.length} storms, ${pool.size} threads)`);

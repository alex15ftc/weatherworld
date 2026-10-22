// Lightning (js/storms/Lightning.js) and its game product (server/GameProducts.js "lightning"):
// a storm's flashes come at its rate, fall near its core, reach the ground less as its updraught
// strengthens, and are the same for the same storm and tick; the product packs them and drops old ones.
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { stormFlashes, chargeOf, LightningLog, LIGHTNING, STRIKE_KIND } from '../js/storms/Lightning.js';
import { flashRatePerMin } from '../js/storms/StormAppearance.js';
import { buildStormGeometry } from '../js/storms/StormGeometry.js';
import { gameLightning } from '../server/GameProducts.js';

const storm = (id, updraughtMs, lcl = 1000) => {
  const s = { id, active: true, positionKm: { x: 400, y: 400 }, velocityKph: { east: 40, north: 20 }, updraughtMs, precipitation: 0.7, organization: 0.8, intensity: 0.8, ageHours: 2,
    mesocycloneStrength: 0.8, environment: { lcl, wind500: { eastKt: 45, northKt: 15 } } };
  buildStormGeometry(s);
  return s;
};

const strong = storm('S1', 45), weak = storm('S2', 15);
const hour = stormFlashes(strong, 20, 21);
const expected = flashRatePerMin(45) * 60;
assert.ok(Math.abs(hour.length - expected) < 4 * Math.sqrt(expected), `${hour.length} flashes in an hour, expected about ${expected.toFixed(0)}`);
assert.deepEqual(stormFlashes(strong, 20, 21), hour, 'the same storm and tick give the same flashes');
assert.ok(hour.every(f => f.hourUtc >= 20 && f.hourUtc <= 21));
// Ground strikes cluster about the core: most within 25 km of the storm (at the hour's end).
const ground = hour.filter(f => f.kind !== STRIKE_KIND.cloud);
const near = ground.filter(f => Math.hypot(f.xKm + 40 * (21 - f.hourUtc) - 400, f.yKm - 20 * (21 - f.hourUtc) - 400) < 25).length;
assert.ok(near / ground.length > 0.6, `${near} of ${ground.length} ground strikes near the core`);
// A stronger, higher-based updraught sends a smaller share to the ground, and more of it positive.
assert.ok(chargeOf(strong).groundShare < chargeOf(weak).groundShare);
assert.ok(chargeOf(storm('S3', 50, 2400)).positiveShare > 3 * chargeOf(strong).positiveShare);
assert.equal(stormFlashes(storm('S4', 5), 20, 21).length, 0, 'no updraught, no lightning');

// The log keeps the last half hour; the product packs each strike into 6 bytes.
const world = { validHourUtc: 20, stormEngine: { validHourUtc: 20 }, storms: [strong] };
const log = new LightningLog({ seed: 7 });
log.record(world);
assert.equal(log.strikes.length, 0, 'nothing before the first tick has an interval');
for (let k = 1; k <= 12; k++) { world.stormEngine.validHourUtc = 20 + k / 12; log.record(world); }
assert.ok(log.strikes.every(s => s.hourUtc >= 21 - LIGHTNING.keepMinutes / 60 - 1e-9));
const product = gameLightning(log);
assert.equal(product.kind, 'lightning');
assert.ok(product.count > 0 && product.ground > 0 && product.ground < product.count);
const bytes = zlib.zstdDecompressSync(Buffer.from(product.data, 'base64'));
assert.equal(bytes.length, product.count * product.strikeBytes);
for (let k = 0; k < product.count; k++) {
  const x = bytes.readUInt16LE(k * 6) / 100, y = bytes.readUInt16LE(k * 6 + 2) / 100, age = bytes.readUInt8(k * 6 + 4) / 4;
  // The storm is at 249 mi; its anvil reaches about 125 km (78 mi) downwind.
  assert.ok(x > 180 && x < 340 && y > 180 && y < 320, `strike at ${x}, ${y}: in map miles about the storm`);
  assert.ok(age <= LIGHTNING.keepMinutes);
  if (k) assert.ok(age <= bytes.readUInt8((k - 1) * 6 + 4) / 4, 'oldest first');
}
assert.equal(product.ages.at(-1).toMinutes, LIGHTNING.keepMinutes);
assert.equal(gameLightning(new LightningLog()).count, 0);
console.log(`lightning passed (${hour.length} flashes an hour from a 45 m/s updraught, ${ground.length} to the ground)`);

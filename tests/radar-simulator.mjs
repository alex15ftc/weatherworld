// Radar simulator: echoes must come from storms, signatures must follow storm structure,
// and scans must be deterministic. Pass --preview <dir> to write PNG previews.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';
import { SIMULATION_CONFIG } from '../js/simulationConfig.js';
import { Storm } from '../js/storms/Storm.js';
import { evolveStormStructure } from '../js/storms/StormStructureEngine.js';
import { buildRadarScene, createRadarSites, scanRadarTilt, buildRadarMosaic } from '../js/radar/RadarSimulator.js';
import { RADAR_RADIALS, RADAR_GATES, RADAR_GATE_KM, RADAR_PRODUCT_KEYS, decodeRadarValue, radarColorTable } from '../js/radar/RadarFormat.js';

const previewIndex = process.argv.indexOf('--preview');
const previewDir = previewIndex > 0 ? process.argv[previewIndex + 1] : null;
// Seed 23 has warm-sector supercells developing by +9 h.
const seed = Number(process.env.RADAR_TEST_SEED ?? 23);
const hours = Number(process.env.RADAR_TEST_HOURS ?? 9);

const world = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
initializeEvolution(world, generateScenario(world, seed));
advanceAtmosphere(world, hours);
const sites = createRadarSites(world);
const nearestSite = (x, y) => sites.reduce((a, b) => (Math.hypot(b.xKm - x, b.yKm - y) < Math.hypot(a.xKm - x, a.yKm - y) ? b : a));

// --- 1. Simulated storms produce precipitation echoes; scans are deterministic. ---
// Echo strength depends on each storm's environment (some simulated storms are shallow,
// low-topped cells), so this only requires a precipitation echo; part 2 checks signatures.
const domainKm = world.width * world.cellSizeKm;
const storms = (world.storms ?? []).filter(s => s.active !== false && s.structure && s.positionKm.x >= 0 && s.positionKm.y >= 0 && s.positionKm.x < domainKm && s.positionKm.y < domainKm);
assert.ok(storms.length > 0, `seed ${seed} has no in-domain storms after ${hours} h; pick another RADAR_TEST_SEED`);
const lead = storms.reduce((a, b) => (b.intensity > a.intensity ? b : a));
const leadSite = nearestSite(lead.positionKm.x, lead.positionKm.y);
const scene = buildRadarScene(world);
const scan = scanRadarTilt(scene, leadSite, 0.5);
for (const key of RADAR_PRODUCT_KEYS) assert.equal(scan.products[key].length, RADAR_RADIALS * RADAR_GATES, `${key} size`);
const leadDbz = maxNear(scan, leadSite, 'reflectivity', lead.positionKm.x, lead.positionKm.y, 25);
assert.ok(leadDbz >= 20, `the strongest in-domain storm should produce a precipitation echo (>=20 dBZ), got ${leadDbz}`);
const again = scanRadarTilt(buildRadarScene(world), leadSite, 0.5);
for (const key of RADAR_PRODUCT_KEYS) assert.ok(Buffer.compare(Buffer.from(scan.products[key]), Buffer.from(again.products[key])) === 0, `${key} not deterministic`);

// The network mosaic shows every in-domain storm without choosing a radar.
const mosaic = buildRadarMosaic(scene, sites);
for (const storm of storms) {
  let best = 0;
  for (let dy = -20; dy <= 20; dy++) for (let dx = -20; dx <= 20; dx++) {
    const i = Math.floor((storm.positionKm.x + dx) / mosaic.resKm), j = Math.floor((storm.positionKm.y + dy) / mosaic.resKm);
    if (i >= 0 && j >= 0 && i < mosaic.width && j < mosaic.height) best = Math.max(best, mosaic.bytes[j * mosaic.width + i]);
  }
  assert.ok(best > 0, `storm ${storm.id} should appear in the network mosaic`);
}

// --- 2. A synthetic mature tornadic supercell 60 km from a radar shows classic signatures. ---
const site = sites.find(s => s.id === 'KCPL');
// Within ~35-60 km, where the 0.5 deg beam samples the lowest 1 km (debris signatures are
// mostly detected well inside 60 mi of a radar).
const warm = warmestCellNear(world, site, 35, 60);
const supercell = new Storm({ id: 'TEST-SC', xKm: warm.x, yKm: warm.y, velocityEastKph: 45, velocityNorthKph: 25, sourceCell: { x: 0, y: 0 }, createdHourUtc: world.validHourUtc });
Object.assign(supercell, {
  mode: 'discrete supercell', lifecycleState: 'mature', ageHours: 2.5, intensity: 0.85, organization: 0.9, updraftStrength: 0.9,
  mesocycloneStrength: 1.05, rotationStrength: 1, coldPoolStrength: 0.35,
  orientationDeg: Math.atan2(45, -25) * 180 / Math.PI,
  tornado: { onGround: true, widthYards: 700, windSpeedMph: 165 }
});
evolveStormStructure(supercell, { cape: 3200, bulkShear: 55, lapseRate700500: 7.8, dewpoint: 68 }, 0, 'TEST-SC');
const synthetic = Object.create(Object.getPrototypeOf(world));
Object.assign(synthetic, world, { storms: [supercell] });
const scScene = buildRadarScene(synthetic);
const scScan = scanRadarTilt(scScene, site, 0.5);
const scMax = maxNear(scScan, site, 'reflectivity', warm.x, warm.y, 40);
assert.ok(scMax >= 55, `mature supercell should have a >=55 dBZ core, got ${scMax}`);
const echo = scScene.storms[0].echo;
const torX = warm.x + echo.tornado.x, torY = warm.y + echo.tornado.y;
const inbound = minNear(scScan, site, 'stormRelativeVelocity', torX, torY, 3), outbound = maxNear(scScan, site, 'stormRelativeVelocity', torX, torY, 3);
assert.ok(outbound - inbound >= 45, `tornadic couplet should show >=45 m/s gate-to-gate delta-V, got ${outbound - inbound}`);
const tdsCc = minNear(scScan, site, 'correlationCoefficient', torX, torY, 2);
assert.ok(tdsCc <= 0.8, `tornado debris signature should drop CC to <=0.8, got ${tdsCc}`);
const ffdCc = valueAt(scScan, site, 'correlationCoefficient', warm.x + echo.mx * 12, warm.y + echo.my * 12);
assert.ok(ffdCc === null || ffdCc >= 0.9, `forward-flank rain should have CC >=0.9, got ${ffdCc}`);

console.log(JSON.stringify({
  seed, hours, storms: storms.length, lead: { id: lead.id, mode: lead.mode, site: leadSite.id, dbz: leadDbz }, scanMs: Math.round(scan.buildMs),
  syntheticSupercell: { site: site.id, rangeKm: Math.round(Math.hypot(warm.x - site.xKm, warm.y - site.yKm)), maxDbz: scMax, deltaV: outbound - inbound, tdsCc: +tdsCc.toFixed(3) }
}, null, 2));

if (previewDir) {
  fs.mkdirSync(previewDir, { recursive: true });
  for (const key of RADAR_PRODUCT_KEYS) writePreview(path.join(previewDir, `supercell-0.5-${key}.png`), scScan, site, key, warm.x, warm.y, 80);
  writePreview(path.join(previewDir, 'supercell-3.1-reflectivity.png'), scanRadarTilt(scScene, site, 3.1), site, 'reflectivity', warm.x, warm.y, 110);
  writePreview(path.join(previewDir, `sim-0.5-reflectivity.png`), scan, leadSite, 'reflectivity', lead.positionKm.x, lead.positionKm.y, 240);
  writePreview(path.join(previewDir, `sim-0.5-velocity.png`), scan, leadSite, 'velocity', lead.positionKm.x, lead.positionKm.y, 240);
  console.log(`previews written to ${previewDir}`);
}

function warmestCellNear(w, radar, minKm, maxKm) {
  let best = null;
  w.forEachCell((cell, x, y) => {
    const cx = (x + 0.5) * w.cellSizeKm, cy = (y + 0.5) * w.cellSizeKm, d = Math.hypot(cx - radar.xKm, cy - radar.yKm);
    if (d < minKm || d > maxKm) return;
    const score = (cell.derived?.cape ?? 0) + (cell.surface?.dewpoint ?? 0) * 10;
    if (!best || score > best.score) best = { x: cx, y: cy, score };
  });
  return best;
}

function valueAt(scanResult, radar, product, x, y) {
  const dx = x - radar.xKm, dy = y - radar.yKm, gate = Math.floor(Math.hypot(dx, dy) / RADAR_GATE_KM);
  if (gate >= RADAR_GATES) return null;
  const az = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  return decodeRadarValue(product, scanResult.products[product][(Math.floor(az / (360 / RADAR_RADIALS)) % RADAR_RADIALS) * RADAR_GATES + gate]);
}
function scanNear(scanResult, radar, product, x, y, radiusKm, pick) {
  let best = null;
  for (let dy = -radiusKm; dy <= radiusKm; dy += 0.25) for (let dx = -radiusKm; dx <= radiusKm; dx += 0.25) {
    if (dx * dx + dy * dy > radiusKm * radiusKm) continue;
    const v = valueAt(scanResult, radar, product, x + dx, y + dy);
    if (v !== null && (best === null || pick(v, best))) best = v;
  }
  return best ?? NaN;
}
function maxNear(s, r, p, x, y, k) { return scanNear(s, r, p, x, y, k, (v, b) => v > b); }
function minNear(s, r, p, x, y, k) { return scanNear(s, r, p, x, y, k, (v, b) => v < b); }

// 600Ã—600 px preview of a square box centred on (cx, cy).
function writePreview(file, scanResult, radar, product, cx, cy, spanKm) {
  const size = 600, lut = radarColorTable(product);
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const x = cx + (px / size - 0.5) * spanKm, y = cy + (py / size - 0.5) * spanKm;
    const dx = x - radar.xKm, dy = y - radar.yKm, gate = Math.floor(Math.hypot(dx, dy) / RADAR_GATE_KM);
    const o = (py * size + px) * 4;
    let byte = 0;
    if (gate < RADAR_GATES) {
      const az = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
      byte = scanResult.products[product][(Math.floor(az * 2) % RADAR_RADIALS) * RADAR_GATES + gate];
    }
    const a = lut[byte * 4 + 3] / 255;
    for (let k = 0; k < 3; k++) rgba[o + k] = Math.round(lut[byte * 4 + k] * a + 14 * (1 - a));
    rgba[o + 3] = 255;
  }
  fs.writeFileSync(file, encodePng(size, size, rgba));
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function crc32(buf) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}

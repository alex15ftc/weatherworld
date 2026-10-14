// Builds the large-scale world map for a seed and writes it to data/worldmap/seed-<seed>/:
// meta.json (settings, regions, rivers, summary), elevation.f32, region.u8, cover.u8 and
// preview.png. The map page (worldmap.html) reads these.
//   node scripts/build-world-map.mjs [--seed 1] [--out dir] [key=value ...]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';
import { generateWorldMap, describeWorldMap, REGIONS, COVER } from '../js/worldmap/WorldMapGenerator.js';
import { shadeMap, drawRivers, drawRoads } from '../js/worldmap/worldMapStyle.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const seed = Number(flag('--seed') ?? 1);
const overrides = Object.fromEntries(args.filter(a => a.includes('=')).map(a => { const [k, v] = a.split('='); return [k, Number(v)]; }));
const out = flag('--out') ?? path.join('data', 'worldmap', `seed-${seed}`);

const started = Date.now();
const map = generateWorldMap({ seed, ...overrides });
const seconds = (Date.now() - started) / 1000;
const summary = describeWorldMap(map);

mkdirSync(out, { recursive: true });
const { trunkU, elevation, region, cover, drainageMi2, ...rest } = map;
void trunkU; void drainageMi2;
writeFileSync(path.join(out, 'meta.json'), JSON.stringify({
  seed, size: map.size, cellMiles: map.cellMiles, params: rest.params, regions: REGIONS, cover: COVER,
  inflows: rest.inflows, rivers: rest.rivers.map(r => ({ points: r.points.map(v => Math.round(v * 100) / 100), widthsM: r.widthsM.map(Math.round), mouthDrainageMi2: Math.round(r.mouthDrainageMi2) })),
  settlements: rest.settlements.map(s => ({ ...s, x: Math.round(s.x * 100) / 100, y: Math.round(s.y * 100) / 100 })),
  roads: rest.roads.map(r => ({ kind: r.kind, name: r.name, points: r.points.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]) })),
  summary, buildSeconds: seconds
}));
writeFileSync(path.join(out, 'elevation.f32'), Buffer.from(elevation.buffer));
writeFileSync(path.join(out, 'region.u8'), Buffer.from(region.buffer));
writeFileSync(path.join(out, 'cover.u8'), Buffer.from(cover.buffer));

const rgba = shadeMap(map, COVER);
drawRivers(rgba, map.size, map.rivers, map.cellMiles);
drawRoads(rgba, map.size, map.roads, map.settlements, map.cellMiles);
writeFileSync(path.join(out, 'preview.png'), encodePng(rgba, map.size, map.size));

console.log(`seed ${seed}: ${map.size}x${map.size} cells of ${map.cellMiles} mi in ${seconds.toFixed(1)}s -> ${out}`);
console.log(`engine match (10-mile columns): mean ${summary.engineMatch.meanAbsM.toFixed(1)} m, worst ${summary.engineMatch.worstM.toFixed(1)} m`);
const kinds = {}; for (const s of map.settlements) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
console.log(`settlements: ${Object.entries(kinds).map(([k, v]) => `${v} ${k}`).join(', ')}; roads: ${map.roads.filter(r => r.kind === 'interstate').length} interstates, ${map.roads.filter(r => r.kind === 'highway').length} highway links`);
console.log(`rivers: ${summary.rivers} (${Math.round(summary.riverMiles)} mi), ${summary.bigRivers} reaching 150 m wide`);
for (const r of summary.regions) console.log(`  ${r.name.padEnd(18)} ${(r.share * 100).toFixed(1).padStart(5)}%  mean ${r.meanM?.toFixed(0) ?? '-'} m, relief (5-95%) ${r.reliefM?.toFixed(0) ?? '-'} m`);

function encodePng(pixels, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; Buffer.from(pixels.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1); }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]), len = Buffer.alloc(4), crc = Buffer.alloc(4);
    len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function crc32(buffer) {
  let c = ~0;
  for (const byte of buffer) { c ^= byte; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}

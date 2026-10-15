// Builds the large-scale world map for a seed and writes it to data/worldmap/seed-<seed>/:
// meta.json (settings, regions, rivers, lakes, towns, roads, summary), elevation.f32, region.u8,
// cover.u8, lake.u8 (lake id per cell, 0 for none), sections.u8 (the section-line road grid; see
// sectionRoads.js), counties.u16 (county number per cell) with counties.json (the counties, and
// the towns with the county each is in, for the forecast products; see js/forecast/counties.js),
// airfields.json (airports, NWS offices, the air base and the weather radars at them; see
// airfields.js; the server places its radars from it; counties.json also carries the NWS offices'
// county warning areas), facilities.json (wind farms, windmills,
// oil and gas wells, schools, colleges and gas stations; see facilities.js), streets.json with
// streets.bin (the road graph, every road down to the town streets; see streets.js), conflicts.json
// (where planned footprints overlap; see footprints.js) and preview.png. The map page (worldmap.html) reads these.
//   node scripts/build-world-map.mjs [--seed 1] [--out dir] [key=value ...]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';
import { generateWorldMap, describeWorldMap, REGIONS, COVER } from '../js/worldmap/WorldMapGenerator.js';
import { shadeMap, drawRivers, drawRoads, drawSectionRoads } from '../js/worldmap/worldMapStyle.js';
import { SECTION_CLASSES, sectionRoadMiles } from '../js/worldmap/sectionRoads.js';
import { writeCountyFiles } from '../js/worldmap/countyFiles.node.js';
import { writeAirfieldFile } from '../js/worldmap/airfieldFiles.node.js';
import { packStreets, describeStreets, ROAD_KINDS, CONTROLS, ENDS } from '../js/worldmap/streets.js';
import { findConflicts, describeConflicts } from '../js/worldmap/footprints.js';

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
const { trunkU, elevation, region, coverRegion, cover, lake, sections, drainageMi2, counties, streets, ...rest } = map;
void trunkU; void drainageMi2; void coverRegion;
const sectionMiles = sectionRoadMiles(sections);
writeFileSync(path.join(out, 'meta.json'), JSON.stringify({
  seed, size: map.size, cellMiles: map.cellMiles, params: rest.params, regions: REGIONS, cover: COVER,
  inflows: rest.inflows, lakes: rest.lakes, sectionGrid: { size: sections.size, miles: sections.miles, classes: SECTION_CLASSES, roadMiles: sectionMiles }, rivers: rest.rivers.map(r => ({ name: r.name, points: r.points.map(v => Math.round(v * 100) / 100), widthsM: r.widthsM.map(Math.round), mouthDrainageMi2: Math.round(r.mouthDrainageMi2) })),
  settlements: rest.settlements.map(s => ({ ...s, x: Math.round(s.x * 100) / 100, y: Math.round(s.y * 100) / 100 })),
  roads: rest.roads.map(r => ({ kind: r.kind, name: r.name, points: r.points.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]) })),
  crossings: rest.crossings.map(c => ({ ...c, x: Math.round(c.x * 100) / 100, y: Math.round(c.y * 100) / 100 })),
  airfields: rest.airfields, radars: rest.radars,
  summary, buildSeconds: seconds
}));
writeAirfieldFile(map, out);
writeFileSync(path.join(out, 'facilities.json'), JSON.stringify(map.facilities));
// The road graph: streets.bin holds, in order, node x, y (Float32), node control and end (Uint8
// each), edge node pairs (Uint32), edge kinds (Uint8) and map road indices (Int32); streets.json
// the counts and names.
const packed = packStreets(streets), streetSummary = describeStreets(packed);
const parts = ['xy', 'control', 'end', 'pairs', 'kinds', 'road'].map(k => Buffer.from(packed[k].buffer, packed[k].byteOffset, packed[k].byteLength));
writeFileSync(path.join(out, 'streets.bin'), Buffer.concat(parts));
const conflicts = findConflicts(map);
writeFileSync(path.join(out, 'conflicts.json'), JSON.stringify(conflicts));
writeFileSync(path.join(out, 'streets.json'), JSON.stringify({ nodes: packed.control.length, edges: packed.kinds.length, kinds: ROAD_KINDS, controls: CONTROLS, ends: ENDS, summary: streetSummary, stats: streets.stats }));
writeFileSync(path.join(out, 'elevation.f32'), Buffer.from(elevation.buffer));
writeFileSync(path.join(out, 'region.u8'), Buffer.from(region.buffer));
writeFileSync(path.join(out, 'cover.u8'), Buffer.from(cover.buffer));
writeFileSync(path.join(out, 'lake.u8'), Buffer.from(lake.buffer));
writeFileSync(path.join(out, 'sections.u8'), Buffer.from(sections.roads.buffer));
writeCountyFiles(map, out);

const rgba = shadeMap(map, COVER);
drawSectionRoads(rgba, map.size, sections, map.cellMiles, [3]);
drawRivers(rgba, map.size, map.rivers, map.cellMiles);
drawRoads(rgba, map.size, map.roads, map.settlements, map.cellMiles);
drawCountyLines(rgba, map.size, counties.ids);
writeFileSync(path.join(out, 'preview.png'), encodePng(rgba, map.size, map.size));

console.log(`seed ${seed}: ${map.size}x${map.size} cells of ${map.cellMiles} mi in ${seconds.toFixed(1)}s -> ${out}`);
console.log(`engine match (10-mile columns): mean ${summary.engineMatch.meanAbsM.toFixed(1)} m, worst ${summary.engineMatch.worstM.toFixed(1)} m`);
const kinds = {}; for (const s of map.settlements) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
console.log(`settlements: ${Object.entries(kinds).map(([k, v]) => `${v} ${k}`).join(', ')}; roads: ${['interstate', 'expressway', 'highway'].map(kind => `${map.roads.filter(r => r.kind === kind).length} ${kind}`).join(', ')}`);
console.log(`interstate crossings: ${['interchange', 'overpass'].map(t => `${map.crossings.filter(c => c.type === t).length} ${t === "overpass" ? "overpasses" : "interchanges"}`).join(', ')} (${map.crossings.stats?.downgraded ?? 0} exits made overpasses and ${map.crossings.stats?.dropped ?? 0} crossings dropped for rivers, highways or other interchanges)`);
console.log(`highways: ${map.roads.filter(r => r.kind === 'highway' && r.name.startsWith('US')).length} US routes, ${map.roads.filter(r => r.name?.startsWith('K-')).length} state highways`);
const areas = counties.list.map(k => k.areaMi2).sort((a, b) => a - b);
console.log(`counties: ${areas.length}, median ${areas[areas.length >> 1]} mi2 (10-90%: ${areas[Math.floor(areas.length * 0.1)]}-${areas[Math.floor(areas.length * 0.9)]}), ${counties.list.filter(k => !k.seat).length} without a town for a seat`);
console.log(`rivers: ${summary.rivers} (${Math.round(summary.riverMiles)} mi), ${summary.bigRivers} reaching 150 m wide`);
for (const a of map.airfields) console.log(`${a.code} ${a.name}: ${a.distanceMi} mi from ${a.city}, ${a.runways.length ? `runways ${a.runways.map(r => `${r.name} (${r.lengthFt} ft)`).join(', ')}` : 'no airfield'}, radar ${a.radar.id}${a.sharedRadar ? ' (shared)' : ''}${a.nws ? `, NWS office ${a.nws.id}` : ''}, access road to ${a.access.joins}`);
for (const o of map.offices) console.log(`${o.name}: county warning area of ${o.counties.length} counties, ${o.areaMi2.toLocaleString('en-US')} mi2`);
const fac = map.facilities, e = fac.energy;
const uses = {}; for (const z of fac.landUse.areas) uses[z.kind] = (uses[z.kind] ?? 0) + 1;
console.log(`land use: ${Object.entries(uses).map(([k, v]) => `${v} ${k}`).join(', ')}, ${fac.landUse.neighborhoods.length} neighborhoods`);
console.log(`facilities: ${fac.gasStations.length} gas stations (${fac.gasStations.filter(g => g.size === 'truck stop').length} truck stops), ${fac.schools.length} schools, ${fac.campuses.length} campuses, ${e.windFarms.length} wind farms (${e.windFarms.reduce((a, f) => a + f.turbines.length, 0)} turbines), ${e.windmills.length} windmills, ${e.wells.length} wells, ${e.tanks.length} tank batteries`);
if (fac.missing.gas.length || fac.missing.schools.length) console.log(`  not placed: gas ${fac.missing.gas.join(', ') || '-'}; schools ${fac.missing.schools.join(', ') || '-'}`);
for (const l of map.lakes) console.log(`lake ${l.id}: ${l.areaMi2.toFixed(0)} mi2 at ${l.damX.toFixed(0)}, ${l.damY.toFixed(0)} mi, surface ${l.surfaceM.toFixed(0)} m, dam ${l.damHeightM.toFixed(0)} m, on a river draining ${l.inflowMi2.toFixed(0)} mi2`);
console.log(`road graph: ${streetSummary.nodes} nodes, ${streetSummary.edges} edges; street miles ${streetSummary.miles.street}, ${streetSummary.controls.signal} signals, ${streetSummary.ends.culDeSac} cul-de-sacs`);
console.log(`footprint conflicts: ${Object.entries(conflicts.counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}; most: ${Object.entries(describeConflicts(conflicts)).slice(0, 4).map(([k, v]) => `${k} ${v}`).join('; ')}`);
console.log(`section roads (mi): ${Object.entries(sectionMiles).map(([k, v]) => `${k} ${v}`).join(', ')}`);
for (const r of summary.regions) console.log(`  ${r.name.padEnd(18)} ${(r.share * 100).toFixed(1).padStart(5)}%  mean ${r.meanM?.toFixed(0) ?? '-'} m, relief (5-95%) ${r.reliefM?.toFixed(0) ?? '-'} m`);

// County lines: a dark line on the cells where the county changes to the east or south.
function drawCountyLines(rgba, size, ids) {
  for (let k = 0; k < size * size; k++) {
    const i = k % size;
    if ((i < size - 1 && ids[k + 1] !== ids[k]) || (k + size < size * size && ids[k + size] !== ids[k])) { rgba[4 * k] = 40; rgba[4 * k + 1] = 30; rgba[4 * k + 2] = 50; }
  }
}

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

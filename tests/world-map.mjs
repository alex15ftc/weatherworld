// The world map generator: the same seed gives the same map; water runs downhill along every
// river; the map's 10-mile averages stay on the weather engine's slope; every region, settlement
// kind and interstate turns up; a reservoir is dammed; roads keep to the section lines; and the
// counties cover the map in one piece each, sized as Plains counties are; and the road graph
// joins its roads only where the road rules let them meet, with footprints that do not overlap.
import assert from 'node:assert/strict';
import { interchangeRamps } from '../js/worldmap/interchanges.js';
import { riverCorners } from '../js/worldmap/sectionRoads.js';
import { polysNear, COMMERCIAL } from '../js/worldmap/landUse.js';
import { pointInPoly, distToSeg } from '../js/worldmap/airfields.js';
import { HALF_MI } from '../js/worldmap/streets.js';
import { findConflicts } from '../js/worldmap/footprints.js';
import { generateWorldMap, describeWorldMap, engineTerrainM, REGIONS, COVER } from '../js/worldmap/WorldMapGenerator.js';

const small = { miles: 500, cellMiles: 1, erosionSteps: 12 };
const map = generateWorldMap({ seed: 3, ...small });
const again = generateWorldMap({ seed: 3, ...small, streets: false });
assert.deepEqual(again.elevation, map.elevation, 'the same seed gives the same ground');
assert.deepEqual(again.settlements.map(s => s.name), map.settlements.map(s => s.name), 'and the same towns');
assert.notDeepEqual(generateWorldMap({ seed: 4, ...small, streets: false }).elevation, map.elevation, 'another seed gives other ground');

const n = map.size, at = (x, y) => map.elevation[Math.floor(y / map.cellMiles) * n + Math.floor(x / map.cellMiles)];
for (const river of map.rivers) {
  for (let s = 2; s < river.points.length; s += 2) assert.ok(at(river.points[s], river.points[s + 1]) <= at(river.points[s - 2], river.points[s - 1]) + 1e-3, 'rivers run downhill');
}

const summary = describeWorldMap(map);
assert.ok(summary.engineMatch.meanAbsM < 25 && summary.engineMatch.worstM < 80, `the map keeps to the engine's slope (mean ${summary.engineMatch.meanAbsM.toFixed(1)} m, worst ${summary.engineMatch.worstM.toFixed(1)} m)`);
assert.ok(engineTerrainM(0) > engineTerrainM(250) && engineTerrainM(250) >= engineTerrainM(499), 'the engine slope falls to the east');
assert.equal(new Set(map.region).size, REGIONS.length, 'every region is on the map');

const kinds = new Set(map.settlements.map(s => s.kind));
for (const kind of ['metro', 'city', 'smallCity', 'town']) assert.ok(kinds.has(kind), `a ${kind} is placed`);
assert.ok(map.roads.filter(r => r.kind === 'interstate').length >= 3 && map.roads.some(r => r.kind === 'highway'), 'interstates and highways are laid');
const metro = map.settlements.find(s => s.kind === 'metro');
// The interstates meet at the metro: each passes it, or (where it shared another's route out of
// the metro and was cut back) starts on another interstate.
const interstates = map.roads.filter(r => r.kind === 'interstate');
const onAnother = (road, [x, y]) => interstates.some(o => o !== road && o.points.some(([ox, oy]) => Math.hypot(ox - x, oy - y) < 1.5));
assert.ok(interstates.filter(r => ['I-70', 'I-35', 'I-29'].includes(r.name)).every(r => r.points.some(([x, y]) => Math.hypot(x - metro.x, y - metro.y) < 3) || onAnother(r, r.points[0]) || onAnother(r, r.points.at(-1))), 'the interstates meet at the metro');
// Interstate crossings: interchanges and overpasses only, never two of different interstates close together.
assert.ok(map.crossings.some(c => c.type === 'interchange') && map.crossings.every(c => c.type === 'interchange' || c.type === 'overpass'), 'interstate crossings are planned');
// US practice: highways are US or state routes; exits on one interstate at least a mile apart
// (3 in the country, save where interstates meet); ramps clear of rivers.
assert.ok(map.roads.filter(r => r.kind === 'highway').every(r => /^(US|K)-\d+$/.test(r.name)) && map.roads.some(r => r.name?.startsWith('US-')), 'highways are numbered US and state routes');
const exitsOn = {};
for (const c of map.crossings) if (c.type === 'interchange') (exitsOn[c.interstate] ??= []).push(c);
for (const list of Object.values(exitsOn)) for (const c of list) for (const o of list) {
  if (o === c || c.kind === 'interstate' || o.kind === 'interstate') continue;
  assert.ok(Math.abs(o.milepost - c.milepost) >= (c.town && o.town ? 1 : 3) - 0.3 || Math.abs(o.milepost - c.milepost) < 0.35, `exits on ${c.interstate} are spaced (${o.milepost.toFixed(1)}, ${c.milepost.toFixed(1)})`);
}
// Every ramp ends on a road (no interchange into a dead end), and no highway turns or meets
// another in a river (no junction on a bridge).
const near = (x, y, tol) => map.roads.some(r => r.points.some((q, i) => {
  if (!i) return false;
  const [ax, ay] = r.points[i - 1], dx = q[0] - ax, dy = q[1] - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + dx * t - x, ay + dy * t - y) < tol;
}));
for (const c of map.crossings) for (const ramp of interchangeRamps(c)) assert.ok(near(...ramp.at(-1), 0.08) && near(...ramp[0], 0.08), `the ramps at ${c.interstate} exit ${c.exit} meet roads`);
const wetCorners = riverCorners(map.rivers, map.sections.size);
for (const road of map.roads) road.points.slice(1, -1).forEach(([x, y]) => assert.ok(!Number.isInteger(x) || !Number.isInteger(y) || !wetCorners[y * map.sections.size + x], `${road.name} turns in a river at ${x}, ${y}`));
for (const c of map.crossings) for (const ramp of interchangeRamps(c)) for (const river of map.rivers) for (let k = 0; k < river.points.length; k += 2) {
  const half = Math.min(220, Math.max(12, river.widthsM[k / 2] * 0.18)) / 2000;
  for (const [x, y] of ramp) assert.ok(Math.hypot(x - river.points[k], y - river.points[k + 1]) > half, `ramps at ${c.x.toFixed(1)}, ${c.y.toFixed(1)} keep out of rivers`);
}
// A beltway round the metro, out in its suburbs, and expressways leaving it.
const beltway = map.roads.find(r => r.name === 'I-435');
assert.ok(beltway && beltway.points.every(([x, y]) => Math.hypot(x - metro.x, y - metro.y) < metro.extentMi + 3), 'the metro has a beltway');
assert.ok(map.roads.filter(r => r.kind === 'expressway' && Math.hypot(r.points[0][0] - metro.x, r.points[0][1] - metro.y) < 3).length >= 2, 'expressways leave the metro');
assert.ok(map.settlements.every(s => s.streetBlockMi > 0 && s.suburbanMi >= 0), 'every place says how its streets are laid');

// A reservoir: about the area asked for, behind a dam of a usual height, all of it water, and
// no river drawn across it.
const [lake] = map.lakes, water = COVER.indexOf('water');
assert.ok(lake && Math.abs(lake.areaMi2 - map.params.lakeAreaMi2) / map.params.lakeAreaMi2 < 0.15, `a lake of about ${map.params.lakeAreaMi2} mi2 (${lake?.areaMi2})`);
assert.ok(lake.damHeightM >= map.params.lakeDamM[0] && lake.damHeightM <= map.params.lakeDamM[2], `its dam is ${lake.damHeightM.toFixed(0)} m`);
for (let k = 0; k < n * n; k++) if (map.lake[k]) assert.equal(map.cover[k], water, 'the lake is water');
for (const river of map.rivers) for (let s = 2; s < river.points.length - 2; s += 2) assert.equal(map.lake[Math.floor(river.points[s + 1] / map.cellMiles) * n + Math.floor(river.points[s] / map.cellMiles)], 0, 'rivers stop at the lake shore');

// Towns on section corners; a share of the flat farm country's mile lines carry a road, more in
// some districts than others, every few of them paved; none runs into the lake.
assert.ok(map.settlements.every(s => Number.isInteger(s.x) && Number.isInteger(s.y)), 'towns sit on section corners');
const { size, roads: grid } = map.sections, per = Math.round(1 / map.cellMiles);
let flatLines = 0, flatRoads = 0, paved = 0;
const block = 25, blocks = new Map();
for (let J = 1; J < size - 1; J++) for (let I = 1; I < size - 1; I++) {
  const v = grid[J * size + I], k = J * per * n + I * per, key = REGIONS[map.coverRegion[k]].key;
  if ((v & 3) === 3 || ((v >> 2) & 3) === 3) paved++;
  if (key === 'midwest' || key === 'highPlains') {
    const roads = ((v & 3) > 0 && (v & 3) < 3) + ((((v >> 2) & 3) > 0) && (((v >> 2) & 3) < 3));
    flatLines += 2; flatRoads += roads;
    const b = `${Math.floor(I / block)},${Math.floor(J / block)}`, e = blocks.get(b) ?? [0, 0]; e[0] += roads; e[1] += 2; blocks.set(b, e);
  }
  if (map.lake[k] && map.lake[k - 1] && map.lake[k - n] && map.lake[k - n - 1]) assert.equal(v, 0, 'no section road in the lake');
}
const shares = [...blocks.values()].filter(([, lines]) => lines > block * block).map(([roads, lines]) => roads / lines), meanShare = shares.reduce((a, b) => a + b, 0) / shares.length;
const spread = Math.sqrt(shares.reduce((a, b) => a + (b - meanShare) ** 2, 0) / shares.length) / meanShare;
assert.ok(flatRoads / flatLines > 0.15 && flatRoads / flatLines < 0.6 && paved > 0.05 * size * size, `gravel and dirt roads on ${(100 * flatRoads / flatLines).toFixed(0)}% of flat mile lines, ${paved} paved corners`);
assert.ok(spread > 0.25, `and more in some districts than others (spread ${spread.toFixed(2)} between 25-mile blocks)`);
// Highways run north-south and east-west for most of their length.
let along = 0, total = 0;
for (const road of map.roads) if (road.kind === 'highway') for (let i = 1; i < road.points.length; i++) {
  const dx = Math.abs(road.points[i][0] - road.points[i - 1][0]), dy = Math.abs(road.points[i][1] - road.points[i - 1][1]);
  total += Math.hypot(dx, dy); if (dx === 0 || dy === 0) along += dx + dy;
}
assert.ok(along / total > 0.7, `highways keep to the mile lines (${(100 * along / total).toFixed(0)}% of their length)`);

// Counties: every cell in one, each joined up, sized as Plains counties are (larger in the dry
// west than in the east), named once each, with a seat where the county has a town.
const { counties } = map, list = counties.list, areas = list.map(c => c.areaMi2).sort((a, b) => a - b), median = areas[areas.length >> 1];
assert.ok(counties.ids.every(id => id >= 1 && id <= list.length), 'every cell is in a county');
assert.equal(new Set(list.map(c => c.name)).size, list.length, 'each county has its own name');
assert.ok(list.length >= 250 && list.length <= 420 && median >= 600 && median <= 850, `${list.length} counties, median ${median} mi2 (Kansas: 105, median about 720)`);
for (const c of list) {
  const cells = []; for (let k = 0; k < counties.ids.length; k++) if (counties.ids[k] === c.id) cells.push(k);
  const seen = new Set([cells[0]]), stack = [cells[0]], mine = new Set(cells);
  while (stack.length) { const k = stack.pop(), i = k % n; for (const m of [i > 0 ? k - 1 : -1, i < n - 1 ? k + 1 : -1, k - n, k + n]) if (mine.has(m) && !seen.has(m)) { seen.add(m); stack.push(m); } }
  assert.equal(seen.size, cells.length, `${c.name} County is in one piece`);
  assert.ok(c.rings.length >= 1 && c.neighbours.length >= 1, `${c.name} County has an outline and neighbours`);
}
const meanArea = region => { const own = list.filter(c => c.region === region); return own.reduce((a, c) => a + c.areaMi2, 0) / own.length; };
assert.ok(meanArea('highPlains') > meanArea('midwest') * 1.2, `High Plains counties (${meanArea('highPlains').toFixed(0)} mi2) are larger than the eastern farm country's (${meanArea('midwest').toFixed(0)} mi2)`);
assert.ok(list.filter(c => c.seat).length >= 0.85 * list.length, 'nearly every county has a seat');

// County warning areas: every county in one office's, each office's in one piece holding the
// county the office stands in.
assert.deepEqual(map.offices.map(o => o.id).sort(), map.airfields.filter(a => a.nws).map(a => a.nws.id).sort(), 'an area for every NWS office');
assert.equal(map.offices.reduce((n, o) => n + o.counties.length, 0), list.length, 'every county in exactly one office\'s area');
for (const o of map.offices) {
  const mine = new Set(o.counties), start = list.find(c => mine.has(c.id)), seen = new Set([start.id]), queue = [start];
  while (queue.length) for (const n of queue.pop().neighbours) if (mine.has(n) && !seen.has(n)) { seen.add(n); queue.push(list[n - 1]); }
  assert.equal(seen.size, mine.size, `${o.name}'s area is one piece`);
  assert.equal(list[counties.ids[Math.floor(o.y / counties.cellMiles) * counties.size + Math.floor(o.x / counties.cellMiles)] - 1].office, o.id, `${o.name} stands in its own area`);
}

// Airfields: an airport with an NWS office and a radar for every place of 40,000 or more, at a
// distance real ones of its size are; one air base alone in the High Plains with a 12,000 ft
// runway; fences clear of roads and rivers with no section road inside; access roads that end on
// a road or a town's mile line; the radar list is the airfields' radars.
const cities = map.settlements.filter(s => s.population >= 40000), airports = map.airfields.filter(a => a.kind === 'airport');
assert.equal(airports.length, cities.length, 'every city of 40,000 has an airport');
for (const city of cities) {
  const a = airports.find(f => f.city === city.name), want = { metro: [12, 17], city: [5, 9], smallCity: [3, 5.5] }[city.kind];
  assert.ok(a && a.distanceMi >= want[0] - 0.3 && a.distanceMi <= want[1] + 0.3, `${city.name}'s airport is ${a?.distanceMi} mi out`);
  assert.ok(a.nws && a.radar && a.runways.length >= 2 && a.buildings.some(b => b.kind === 'terminal') && a.curbs.length && a.parking.length, `${a.name} has runways, a terminal, curbs, parking, an NWS office and a radar`);
  assert.ok(a.runways.every(r => /^\d\d[LCR]?\/\d\d[LCR]?$/.test(r.name)) && a.runways[0].lengthFt >= 6500, `${a.name}'s runways are named and long enough`);
}
const bases = map.airfields.filter(a => a.kind === 'airBase');
assert.equal(bases.length, 1, 'one air force base');
const [base] = bases, baseRegion = REGIONS[map.region[Math.floor(base.y / map.cellMiles) * n + Math.floor(base.x / map.cellMiles)]].key;
assert.ok(baseRegion === 'highPlains' && base.runways[0].lengthFt === 12000 && base.radar && base.areas.length >= 3, `the air base is in the High Plains (${baseRegion}) with its runway, areas and radar`);
assert.ok(map.settlements.every(s => Math.hypot(s.x - base.x, s.y - base.y) - s.extentMi > 4), 'and away from every town');
const inPoly = (x, y, poly) => { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; } return inside; };
for (const a of map.airfields) {
  for (const road of map.roads) for (const [x, y] of road.points) assert.ok(!inPoly(x, y, a.fence), `${road.name} keeps out of ${a.name}`);
  for (const river of map.rivers) for (let k = 0; k < river.points.length; k += 2) assert.ok(!inPoly(river.points[k], river.points[k + 1], a.fence), `no river runs through ${a.name}`);
  for (let J = 0; J < size; J++) for (let I = 0; I < size; I++) {
    const v = grid[J * size + I];
    if ((v & 3) && inPoly(I + 0.5, J, a.fence)) assert.fail(`a section road runs through ${a.name}`);
    if (((v >> 2) & 3) && inPoly(I, J + 0.5, a.fence)) assert.fail(`a section road runs through ${a.name}`);
  }
  const [x, y] = a.access.points.at(-1);
  assert.ok(near(x, y, 0.02) || (Number.isInteger(x) && Number.isInteger(y)), `${a.access.name} at ${a.name} ends on a road`);
}
assert.deepEqual(map.radars.map(r => r.id), map.airfields.filter(a => !a.sharedRadar).map(a => a.radar.id), 'the radars are the airfields\' radars');
// Offices in towns fill the gaps the airports leave: every office's area at most about 30,000 mi2
// (real Plains CWAs are 20,000 to 30,000); an office near the air base uses its radar.
const townOffices = map.airfields.filter(a => a.kind === 'nwsOffice');
assert.ok(townOffices.length >= 1 && townOffices.every(a => a.nws && a.radar && map.settlements.some(s => s.name === a.city)), `offices in towns: ${townOffices.map(a => a.city).join(', ')}`);
assert.ok(map.offices.every(o => o.areaMi2 <= 32000), `office areas ${map.offices.map(o => o.areaMi2).join(', ')} mi2`);
for (const a of townOffices.filter(t => t.sharedRadar)) assert.equal(a.radar.id, base.radar.id, `${a.name} uses the air base's radar`);
assert.equal(new Set(map.radars.map(r => r.id)).size, map.radars.length, 'each radar has its own identifier');
// The metro's and the city's airports are international, reached by a spur from their own exit.
for (const a of airports.filter(f => ['metro', 'city'].includes(cities.find(c => c.name === f.city).kind))) {
  const [x, y] = a.access.points.at(-1), exit = map.crossings.find(c => c.type === 'interchange' && Math.hypot(c.x - x, c.y - y) < 0.1);
  assert.ok(a.name.includes('International') && a.access.freeway && exit && exit.vEnd, `${a.name} has its own interstate exit (${exit ? `${exit.interstate} exit ${exit.exit}` : 'none'})`);
}

// Interstates are built off the section grid: they cross the mile lines between corners, and
// where two meet no mile line is near.
const offLines = (x, y) => Math.min(Math.abs(x - Math.round(x)), Math.abs(y - Math.round(y)));
let lineCrossings = 0, atCorners = 0;
for (const road of interstates) for (let i = 1; i < road.points.length; i++) {
  const [ax, ay] = road.points[i - 1], [bx, by] = road.points[i];
  for (let I = Math.ceil(Math.min(ax, bx)); I <= Math.floor(Math.max(ax, bx)); I++) if (bx !== ax) { const yy = ay + (by - ay) * (I - ax) / (bx - ax); lineCrossings++; if (Math.abs(yy - Math.round(yy)) < 0.05) atCorners++; }
}
assert.ok(atCorners <= 0.03 * lineCrossings, `interstates cross mile lines away from their corners (${atCorners} of ${lineCrossings} within 0.05 mi of one)`);
for (const c of map.crossings) if (c.kind === 'interstate') assert.ok(offLines(c.x, c.y) >= 0.15, `${c.interstate} meets another interstate ${offLines(c.x, c.y).toFixed(2)} mi from a mile line`);

// Facilities: a gas station in every place of 1,000 people, in about a quarter of the smaller
// ones; schools in every place of 1,000 with parking; colleges in the cities; wind farms,
// windmills and wells in their regions; no lot on a road.
const fac = map.facilities, gasTowns = new Set(fac.gasStations.map(g => g.town)), schoolTowns = new Set(fac.schools.map(s => s.town));
const large = map.settlements.filter(s => s.population >= 1000), smaller = map.settlements.filter(s => s.population < 1000);
assert.ok(large.every(s => gasTowns.has(s.name)), `every place of 1,000 has a gas station (missing: ${large.filter(s => !gasTowns.has(s.name)).map(s => s.name).join(', ')})`);
const smallShare = smaller.filter(s => gasTowns.has(s.name)).length / smaller.length;
assert.ok(smallShare > 0.15 && smallShare < 0.35, `about a quarter of the smaller places have one (${(100 * smallShare).toFixed(0)}%)`);
assert.ok(fac.gasStations.every(g => g.pumps.length >= 2) && new Set(fac.gasStations.map(g => g.size)).size >= 3, 'gas stations have pumps and come in sizes');
const pumpsIn = kind => { const list = fac.gasStations.filter(g => map.settlements.find(s => s.name === g.town)?.kind === kind && g.size !== 'truck stop'); return list.reduce((t, g) => t + g.pumps.length, 0) / list.length; };
assert.ok(pumpsIn('metro') > pumpsIn('town'), `city stations are bigger (${pumpsIn('metro').toFixed(1)} pumps against ${pumpsIn('town').toFixed(1)} in towns)`);
assert.ok(large.every(s => schoolTowns.has(s.name)) && fac.schools.every(s => s.parking.length && s.buildings.length), 'every place of 1,000 has a school, each with parking');
assert.ok(fac.campuses.length >= cities.length && fac.campuses.every(c => c.parking.length >= 3), 'colleges in the cities, with parking');
const windRegions = new Set(fac.energy.windFarms.map(f => f.region)), regionOf = ([x, y]) => REGIONS[map.coverRegion[Math.floor(y / map.cellMiles) * n + Math.floor(x / map.cellMiles)]].key;
assert.ok(fac.energy.windFarms.length >= 5 && !windRegions.has('ozarkEdge') && windRegions.has('highPlains'), `wind farms in the windy west (${[...windRegions].join(', ')})`);
const wellRegions = {}; for (const w of fac.energy.wells) wellRegions[regionOf(w)] = (wellRegions[regionOf(w)] ?? 0) + 1;
assert.ok(!wellRegions.ozarkEdge && (wellRegions.smokyHills ?? 0) > (wellRegions.midwest ?? 0), `oil where Kansas's is (${JSON.stringify(wellRegions)})`);
assert.ok(fac.energy.wells.filter(w => w[2]).every(w => regionOf(w) === 'highPlains'), 'gas wells in the High Plains');
const crossesRoad = poly => map.roads.some(r => r.points.some((q, i) => i > 0 && poly.some((v, k) => { const w = poly[(k + 1) % poly.length]; const [ax, ay] = r.points[i - 1], [bx, by] = q; const d = (bx - ax) * (w[1] - v[1]) - (by - ay) * (w[0] - v[0]); if (!d) return false; const t = ((v[0] - ax) * (w[1] - v[1]) - (v[1] - ay) * (w[0] - v[0])) / d, u = ((v[0] - ax) * (by - ay) - (v[1] - ay) * (bx - ax)) / d; return t >= 0 && t <= 1 && u >= 0 && u <= 1; })));
assert.ok(![...fac.gasStations.map(g => g.lot), ...fac.schools.map(s => s.lot), ...fac.campuses.map(c => c.area)].some(crossesRoad), 'no lot or campus runs over a road');
// No two facilities on one spot: lots, campuses, NWS offices, radar compounds and airport fences
// (convex polygons; separating-axis test).
const overlaps = (a, b) => {
  for (const p of [a, b]) for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length], ax = y0 - y1, ay = x1 - x0, span = q => q.map(([x, y]) => x * ax + y * ay);
    if (Math.max(...span(a)) <= Math.min(...span(b)) || Math.max(...span(b)) <= Math.min(...span(a))) return false;
  }
  return true;
};
const lots = [...fac.gasStations.map(g => [`${g.town} gas station`, g.lot]), ...fac.schools.map(s => [s.name, s.lot]), ...fac.campuses.map(c => [c.name, c.area])];
const fixedSites = map.airfields.flatMap(a => [[`${a.code} fence`, a.fence], ...(a.nws ? [[a.nws.name, a.nws.building], [`${a.nws.name} parking`, a.nws.parking]] : []), ...(a.radar?.compound ? [[`${a.radar.id} radar`, a.radar.compound]] : [])]);
const clash = [];
for (let i = 0; i < lots.length; i++) for (const other of [...lots.slice(i + 1), ...fixedSites]) if (overlaps(lots[i][1], other[1])) clash.push(`${lots[i][0]} / ${other[0]}`);
assert.equal(clash.length, 0, `facilities overlap: ${clash.slice(0, 5).join('; ')}`);
const metroSchools = fac.schools.filter(s => s.town === metro.name).length;
assert.ok(metroSchools < metro.population / 5000, `city schools are larger, so fewer per person (${metroSchools} in ${metro.name})`);
// Land use: gas stations only in the commercial areas and never five to a square mile; schools
// apart from shopping and industry; shops, malls, industry and parks on ground of their own;
// elementary schools in the cities' neighbourhoods.
const lu = fac.landUse, shops = lu.areas.filter(z => COMMERCIAL.has(z.kind)), middle = poly => [poly.reduce((t, q) => t + q[0], 0) / poly.length, poly.reduce((t, q) => t + q[1], 0) / poly.length];
const stations = fac.gasStations.map(g => middle(g.lot));
assert.ok(stations.every(([x, y]) => shops.some(z => pointInPoly(x, y, z.poly))), 'every gas station stands in a commercial area');
let densest = 0;
for (const [x, y] of stations) for (const dx of [0, 0.5]) for (const dy of [0, 0.5]) densest = Math.max(densest, stations.filter(([a, b]) => a >= x - dx && a < x - dx + 1 && b >= y - dy && b < y - dy + 1).length);
assert.ok(densest <= 4, `at most four gas stations to a square mile (${densest})`);
const busy = lu.areas.filter(z => COMMERCIAL.has(z.kind) || z.kind === 'industrial');
assert.ok(!fac.schools.some(s => busy.some(z => polysNear(s.lot, z.poly, 0.09))), 'schools stand apart from shopping and industry');
const solid = lu.areas.filter(z => ['mall', 'shopping', 'industrial', 'park'].includes(z.kind));
assert.ok(!solid.some((a, i) => solid.slice(i + 1).some(b => polysNear(a.poly, b.poly, 0))), 'shopping, industry and parks do not overlap');
const hoodSchools = fac.schools.filter(s => s.town === metro.name && s.level === 'elementary' && lu.neighborhoods.some(nb => nb.town === metro.name && s.name === `${nb.name} Elementary`)).length;
assert.ok(lu.areas.some(z => z.kind === 'mall') && hoodSchools > 0.8 * fac.schools.filter(s => s.town === metro.name && s.level === 'elementary').length, `a mall, and the metro's elementary schools in its neighbourhoods (${hoodSchools})`);

// The road graph: roads cross only at shared nodes, except where one passes over an interstate
// or a ramp; no town street comes near a highway it does not meet at a node, nor ever touches an
// interstate, expressway or ramp; every street end is a cul-de-sac.
const graphEdges = map.streets.graph.edges.filter(e => e.alive), cellOf = (x, y) => `${Math.floor(x)},${Math.floor(y)}`, byCell = new Map();
for (const e of graphEdges) for (let X = Math.floor(Math.min(e.a.x, e.b.x)); X <= Math.floor(Math.max(e.a.x, e.b.x)); X++) for (let Y = Math.floor(Math.min(e.a.y, e.b.y)); Y <= Math.floor(Math.max(e.a.y, e.b.y)); Y++) { const k = `${X},${Y}`; if (!byCell.has(k)) byCell.set(k, []); byCell.get(k).push(e); }
const GRADE_SEPARATED = new Set(['interstate', 'ramp']);
let unjoined = 0, streetsNear = 0;
for (const e of graphEdges) {
  const others = new Set();
  for (let X = Math.floor(Math.min(e.a.x, e.b.x)); X <= Math.floor(Math.max(e.a.x, e.b.x)); X++) for (let Y = Math.floor(Math.min(e.a.y, e.b.y)); Y <= Math.floor(Math.max(e.a.y, e.b.y)); Y++) for (const o of byCell.get(`${X},${Y}`) ?? []) others.add(o);
  for (const o of others) {
    if (o.id <= e.id || o.a === e.a || o.a === e.b || o.b === e.a || o.b === e.b || GRADE_SEPARATED.has(e.kind) || GRADE_SEPARATED.has(o.kind)) continue;
    const rx = e.b.x - e.a.x, ry = e.b.y - e.a.y, sx = o.b.x - o.a.x, sy = o.b.y - o.a.y, den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((o.a.x - e.a.x) * sy - (o.a.y - e.a.y) * sx) / den, u = ((o.a.x - e.a.x) * ry - (o.a.y - e.a.y) * rx) / den;
    if (t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99) unjoined++;
  }
  if (e.kind === 'street') for (const node of [e.a, e.b]) for (const o of others) {
    if (!['interstate', 'expressway', 'ramp', 'highway'].includes(o.kind) || (o.kind === 'highway' && (o.a === node || o.b === node))) continue;
    if (o.kind !== 'highway' && (o.a === node || o.b === node)) streetsNear++;
    else if (o.kind !== 'highway' && distToSeg(node.x, node.y, { ax: o.a.x, ay: o.a.y, bx: o.b.x, by: o.b.y }) < HALF_MI[o.kind] + 0.03) streetsNear++;
  }
}
assert.equal(unjoined, 0, `roads cross only at nodes (${unjoined} crossings without one)`);
assert.equal(streetsNear, 0, `town streets keep clear of interstates, expressways and ramps (${streetsNear} too near)`);
const streetEnds = map.streets.graph.nodes.filter(nd => nd.edges.length === 1 && nd.edges[0].kind === 'street');
assert.ok(streetEnds.length && streetEnds.every(nd => nd.end === 1), 'every street end is a cul-de-sac');
assert.ok(graphEdges.some(e => e.kind === 'street') && graphEdges.some(e => e.kind === 'collector') && map.streets.graph.nodes.some(nd => nd.control === 2), 'the graph has streets, collectors and signals');

// Footprints: no cul-de-sac overlaps anything, and few other overlaps are left anywhere.
const conflicts = findConflicts(map), edgeCount = graphEdges.length;
assert.ok(!conflicts.counts.culDeSac, `cul-de-sacs fit clear of roads, lots and rivers (${conflicts.counts.culDeSac} overlap)`);
const overlapping = Object.values(conflicts.counts).reduce((a, b) => a + b, 0);
assert.ok(overlapping < edgeCount * 0.002, `few footprint overlaps (${JSON.stringify(conflicts.counts)} among ${edgeCount} road edges)`);

console.log(`world map passed (${map.rivers.length} rivers, ${map.settlements.length} settlements, ${list.length} counties, ${map.airfields.length} airfields, slope match ±${summary.engineMatch.meanAbsM.toFixed(1)} m, lake ${lake.areaMi2} mi2, highways ${(100 * along / total).toFixed(0)}% on mile lines)`);

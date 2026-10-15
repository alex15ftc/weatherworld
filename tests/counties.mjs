// Counties in the forecast products, on a small made-up map whose counties (25 x 30 miles) do
// not line up with the weather's 10-mile cells: a watch is whole counties and a new one takes
// none already under a watch; its text gives the centre's approximate line and the outline
// update lists its counties; its outline runs along county lines; a discussion names the parts
// of the regions it covers and carries its counties; a warning names the counties, or the parts
// of them, and the towns its polygon covers.
import assert from 'node:assert/strict';
import { countyLayer, polygonCounties, countyRings, publicCounties } from '../js/forecast/counties.js';
import { draftWatch, issueWatch, publicWatch } from '../js/forecast/Watch.js';
import { makeDiscussion } from '../js/forecast/MesoscaleDiscussion.js';
import { WARNING, createWarningState, issueWarning, issueWarnings, updateWarnings, placesFor, publicWarning } from '../js/forecast/Warning.js';
import { cellOutline } from '../js/worldmap/counties.js';

// The map: 300 x 300 miles on 5-mile cells; counties 5 cells across and 6 down; the western half
// High Plains, the eastern the farm country; a town in the middle of each.
const size = 60, fine = 5, width = 30, height = 30, ids = new Uint16Array(size * size), across = size / 5;
for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) ids[j * size + i] = Math.floor(j / 6) * across + Math.floor(i / 5) + 1;
const counties = Array.from({ length: across * size / 6 }, (_, k) => {
  const i0 = (k % across) * 5, j0 = Math.floor(k / across) * 6;
  return { id: k + 1, name: `Test${k + 1}`, seat: `Seat${k + 1}`, x: (i0 + 2.5) * fine, y: (j0 + 3) * fine, areaMi2: 750, region: i0 < size / 2 ? 'highPlains' : 'midwest', box: [i0 * fine, j0 * fine, (i0 + 5) * fine, (j0 + 6) * fine], rings: cellOutline(ids, size, k + 1).map(r => r.map(([x, y]) => [x * fine, y * fine])) };
});
const towns = counties.map(c => ({ name: c.seat, x: c.x, y: c.y, population: 3000, county: c.id }));
const layer = countyLayer({ size, cellMiles: fine, miles: 300, ids, counties, towns, regions: [{ key: 'highPlains', label: 'High Plains' }, { key: 'midwest', label: 'Big Blue Valley' }] }, width, height);
for (const c of layer.counties) assert.ok(Math.abs(c.shares.reduce((a, b) => a + b, 0) - 1) < 1e-6, 'each county is shared out among the cells');
assert.ok([...layer.dominant].every(index => index >= 0), 'every cell has a county holding most of it');

const m = { tornadoes: 3, strong: 1, wind: 12, gust: 70, hailCells: 12, hail: 2, reports: 14, windSignificant: 2 };
const here = { dewpoint: 66, temperature: 85, cape: 2800, cin: 20, shear: 50, helicity: 250, cloudBaseM: 900, forming: 3, storms: 2, severeNow: 1, tornadoNow: 0, rotating: 2, lines: 0, features: [] };
const blob = (cx, cy, rx, ry) => { const inside = new Uint8Array(width * height); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (Math.hypot((x - cx) / rx, (y - cy) / ry) < 1) inside[y * width + x] = 1; return inside; };
const assessed = inside => ({ tornadoWatch: true, inside, cells: Array.from(inside.keys()).filter(i => inside[i]), perMember: [m, m, m, m], members: 4, peak: { tornadoMph: 125, gustMph: 70, hailInches: 2 }, peakText: { tornado: '100-130 MPH', wind: '65-80 MPH', hail: '1.50-2.50 IN' }, here, percent: 80, stormsInHours: 0, startsInHours: 0 });
const now = { width, height, cellMiles: 10, hourUtc: 44, counties: layer };

// A watch: whole counties, its cells exactly those its counties hold most of.
const first = issueWatch(draftWatch(assessed(blob(14, 14, 6, 4)), now), 7, 44);
assert.ok(first.counties.length >= 8, `the watch has ${first.counties.length} counties`);
const mine = new Set(first.counties);
for (let i = 0; i < width * height; i++) assert.equal(Boolean(first.cells[i]), mine.has(layer.dominant[i]), 'the watch holds every cell of its counties and no other');
assert.equal(first.areaSquareMiles, 750 * first.counties.length, 'its area is its counties\'');
assert.match(first.text, /approximately along and \d+ statute miles (north and south|east and west) of a line from .+ to .+\. For a complete depiction/);
assert.match(first.text, new RegExp(`COUNTIES INCLUDED ARE \\(${first.counties.length}\\)`));
for (const name of first.countyNames) assert.ok(first.text.includes(name.toUpperCase()), `the outline update lists ${name}`);
assert.match(first.where, /^portions of the .*High Plains/);
// Its outline follows the county lines: only north-south and east-west edges.
for (const ring of first.rings) ring.forEach((p, k) => { const q = ring[(k + 1) % ring.length]; assert.ok(p[0] === q[0] || p[1] === q[1], 'the outline runs along county lines'); });
assert.deepEqual(first.rings, countyRings(layer, first.counties));
const page = publicWatch(first);
assert.deepEqual(page.countyIds, first.counties.map(index => index + 1)); assert.equal(page.counties, undefined);

// A second watch next to it takes no county the first has.
const second = draftWatch(assessed(blob(20, 14, 6, 4)), now, { covered: first.cells });
assert.ok(second.counties.length > 0 && second.counties.every(index => !mine.has(index)), 'no county is in two watches');

// A discussion: its counties and the parts of the regions.
const md = makeDiscussion(assessed(blob(15, 20, 5, 3)), now, { number: 3 });
assert.ok(md.countyNames.length > 0 && md.countyIds.length === md.countyNames.length, 'a discussion carries its counties');
assert.match(md.text, /Areas affected\.\.\.Portions of the .*(High Plains|Big Blue Valley)/);

// A warning: counties, parts of counties, and towns.
const centre = layer.counties[layer.at(137.5, 105)], polygon = centre.rings[0].map(([x, y]) => [x, y]);
const whole = polygonCounties(layer, polygon);
assert.equal(whole.counties[0].name, centre.name); assert.equal(whole.counties[0].part, null, 'a county wholly inside is named whole');
const corner = polygonCounties(layer, [[125, 90], [137, 90], [137, 102], [125, 102]]).counties.find(c => c.name === centre.name);
assert.equal(corner.part, 'northwestern', 'a corner of a county is named as that part of it');
const state = createWarningState(layer), world = { width, height, cellSizeKm: 16.09344 };
const kmPerMile = 1.609344, look = { id: 's1', x: 130 * kmPerMile, y: 104 * kmPerMile, east: 50, north: 5, hail: 2, gust: 70, chance: 0.5, onGround: true, confirmed: true, tornadoMph: 120, tornadoReachKm: 1, severeReachKm: 6, gustLeadKm: 0 };
const warning = issueWarning(state, 'tornado', look, 44.5, placesFor(state, world));
assert.match(warning.text, /\* Tornado Warning for\.\.\.\n {2}(\w+ (central )?)?Test\d+ County in the (High Plains|Big Blue Valley)/);
assert.match(warning.text, /\* Locations impacted include\.\.\.\n {2}Seat\d+/);
assert.match(warning.text, /(over|near|\d+ miles [a-z-]+ of) Seat\d+/, 'the storm is placed from a town');
assert.match(warning.where, /Test\d+ Count(y|ies)$/);

// A tornado emergency (NWSI 10-511 3.3.4.1(c)): a confirmed violent tornado (EF3+) with a town on
// its track within emergencyMinutes. Seat at (137.5, 105) mi; the tornado heads east at 50 km/h.
const seat = layer.towns.find(t => t.x === 137.5 && t.y === 105).name;
const violent = (id, mph) => { const st = createWarningState(layer); return (hour, xMi) => { updateWarnings(st, { width, height, cellSizeKm: world.cellSizeKm, validHourUtc: hour, storms: [{ id, active: true, positionKm: { x: xMi * kmPerMile, y: 105 * kmPerMile }, velocityKph: { east: 50, north: 0 }, currentHailSizeInches: 2, surfaceWind: { gustMph: 70 }, tornado: { probability: 0.9, onGround: true, groundTimeMinutes: 20, windSpeedMph: mph, widthYards: 600 }, geometry: { wallCloud: { radiusKm: 1 } } }] }, []); return st.warnings.find(w => w.type === 'tornado'); }; };
let scanV = violent('v', 170), tor = scanV(50, 118);
assert.equal(tor.tags.damage, 'CONSIDERABLE', 'a violent tornado over open country (town 30 minutes away) is a PDS warning, not an emergency');
assert.doesNotMatch(tor.text, /TORNADO EMERGENCY/);
tor = scanV(50 + 1 / 12, 129);
assert.equal(tor.tags.damage, 'CATASTROPHIC', 'the town is now within the quarter hour on its track: an emergency');
assert.deepEqual(tor.tags.emergencyFor, [seat]);
const emergencyText = tor.statements.at(-1).text;
assert.match(emergencyText, new RegExp(`^Severe Weather Statement\\n[^\\n]+\\n\\d{4}Z\\n\\n\\.\\.\\.TORNADO EMERGENCY FOR ${seat.toUpperCase()}\\.\\.\\.\\n`), 'the headline straight after the date/time line');
assert.match(emergencyText, new RegExp(`  TORNADO EMERGENCY for ${seat}\\. This is a PARTICULARLY DANGEROUS SITUATION\\. TAKE COVER NOW!\\n\\n  HAZARD\\.\\.\\.Deadly tornado`));
assert.match(emergencyText, /TORNADO DAMAGE THREAT\.\.\.CATASTROPHIC/); assert.match(emergencyText, /TORNADO\.\.\.OBSERVED/);
const shown = publicWarning(tor, 50.1);
assert.equal(shown.emergency, true); assert.equal(shown.pds, true); assert.equal(shown.label, `Tornado Emergency for ${seat}`);
// A strong but not violent tornado bearing down on the same town stays PDS.
scanV = violent('w', 125); scanV(50, 118); tor = scanV(50 + 1 / 12, 129);
assert.equal(tor.tags.damage, 'CONSIDERABLE'); assert.equal(publicWarning(tor, 50.1).emergency, false);

// Two NWS offices, the western half of the map Westport's and the eastern Eastville's (their
// county warning areas, warningAreas.js). A storm about to cross the line between them: each
// office warns its own piece of the path, in its own numbering, and no piece crosses the line.
const offices = [{ id: 'WST', name: 'NWS Westport', city: 'Westport', x: 75, y: 150 }, { id: 'EAV', name: 'NWS Eastville', city: 'Eastville', x: 225, y: 150 }];
const officeOf = c => (c.box[0] < 150 ? 'WST' : 'EAV');
const split = countyLayer({ size, cellMiles: fine, miles: 300, ids, counties: counties.map(c => ({ ...c, office: officeOf(c) })), towns, offices: offices.map(o => ({ ...o, counties: counties.filter(c => officeOf(c) === o.id).map(c => c.id) })), regions: [{ key: 'highPlains', label: 'High Plains' }, { key: 'midwest', label: 'Big Blue Valley' }] }, width, height);
const both = createWarningState(split), lineKm = 150 * kmPerMile;
const nearLine = { ...look, x: lineKm - 8 * kmPerMile, y: 150 * kmPerMile };
const issued = issueWarnings(both, 'tornado', nearLine, 44.5, placesFor(both, world));
assert.deepEqual(issued.map(w => w.id), ['WST-TOR-1', 'EAV-TOR-1'], 'the office holding the storm warns first, the next office downstream');
assert.ok(issued[0].polygon.every(([x]) => x <= lineKm + 0.05) && issued[1].polygon.every(([x]) => x >= lineKm - 0.05), 'no piece crosses the office line');
assert.ok(issued.every(w => w.polygon.length >= 3 && w.polygon.length <= WARNING.vertices), 'each piece has 3 to 20 vertices');
assert.match(issued[1].text, /^BULLETIN - EAS ACTIVATION REQUESTED\nTornado Warning\nNational Weather Service Eastville\n/);
assert.match(issued[1].text, /The National Weather Service in Eastville has issued a/);
assert.ok(issued[1].places.counties.every(c => Number(c.name.slice(4)) % across > 5), 'Eastville names only its own counties');
assert.ok(publicCounties(split).offices.every(o => o.rings.length === 1), 'each office\'s area is drawn as one outline');
// The downstream piece stays in effect while the storm is on its way to it.
const scanAt = (hour, x) => updateWarnings(both, { width, height, cellSizeKm: world.cellSizeKm, validHourUtc: hour, storms: [{ id: 's1', active: true, positionKm: { x, y: nearLine.y }, velocityKph: { east: 50, north: 5 }, currentHailSizeInches: 2, surfaceWind: { gustMph: 70 }, tornado: { probability: 0.5, onGround: false }, geometry: {} }] }, []);
scanAt(44.5 + 1 / 12, nearLine.x + 4); scanAt(44.5 + 2 / 12, nearLine.x + 8); scanAt(44.5 + 3 / 12, nearLine.x + 12);
assert.equal(issued[1].status, 'in effect', 'the next office\'s warning waits for the storm');

console.log(`counties passed (watch of ${first.counties.length} counties, ${first.areaSquareMiles} mi2; warning for ${warning.where}; offices ${issued.map(w => `${w.id} ${w.areaSquareMiles} mi2`).join(', ')})`);

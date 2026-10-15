// Counties in the forecast products, on a small made-up map whose counties (25 x 30 miles) do
// not line up with the weather's 10-mile cells: a watch is whole counties and a new one takes
// none already under a watch; its text gives the centre's approximate line and the outline
// update lists its counties; its outline runs along county lines; a discussion names the parts
// of the regions it covers and carries its counties; a warning names the counties, or the parts
// of them, and the towns its polygon covers.
import assert from 'node:assert/strict';
import { countyLayer, polygonCounties, countyRings } from '../js/forecast/counties.js';
import { draftWatch, issueWatch, publicWatch } from '../js/forecast/Watch.js';
import { makeDiscussion } from '../js/forecast/MesoscaleDiscussion.js';
import { createWarningState, issueWarning, placesFor } from '../js/forecast/Warning.js';
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

console.log(`counties passed (watch of ${first.counties.length} counties, ${first.areaSquareMiles} mi2; warning for ${warning.where})`);

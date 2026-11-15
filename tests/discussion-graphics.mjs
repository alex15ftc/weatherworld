// A mesoscale discussion's graphics (2026-11-14): the greatest short-term potential (shortTermFocus), the leading
// storm's arrow (leadArrow), the sentence in the summary, the game product's miles, the radar picture of the moment
// (DiscussionRadar.js), the map's layers (AreaMap.js) and the archive that keeps the picture (ProductArchive.js).
import assert from 'node:assert/strict';
import { MESOSCALE, buildMesoscaleDiscussions, publicMesoscaleDiscussion } from '../js/forecast/MesoscaleDiscussion.js';
import { insideRings } from '../js/forecast/contourShapes.js';
import { gameMesoscale } from '../server/GameProducts.js';
import { discussionRadar, pictureView, reflectivityKey } from '../server/DiscussionRadar.js';
import { areaSvg } from '../server/AreaMap.js';
import { ProductArchive } from '../server/ProductArchive.js';

// --- Made-up runs (as tests/mesoscale-discussion.mjs): severe weather over a 12-cell square, with what each run
// does in its first soonHours put on a 3 x 3 block (or spread evenly over the square).
const width = 50, height = 50, n = width * height, at = (x, y) => y * width + x;
const x0 = 20, y0 = 10, size = 12;
function run(k, { tornadoes = 2, tornadoMph = 125, soon = 'tornado', block = 0.3, spread = 0 } = {}) {
  const grid = () => new Uint8Array(n), far = () => new Float32Array(n).fill(Infinity), f32 = () => new Float32Array(n);
  const m = { member: k, width, height, cellMiles: 10, hours: 5, near: grid(), reports: grid(), windReports: grid(), hailReports: grid(), windSignificant: grid(), significant: grid(), hail: f32(), gust: f32(), tornadoMph: f32(), firstHour: far(), stormHour: far(), tornadoes: [], tornadoPeaks: [], soonTornado: f32(), soonWind: f32(), soonHail: f32() };
  for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) m.near[at(x, y)] = 1;
  for (let r = 0; r < 14; r++) { const i = at(x0 + 1 + r % 6, y0 + 1 + Math.floor(r / 6)); m.reports[i] = 1; (r % 2 ? m.hailReports : m.windReports)[i] = 1; m.firstHour[i] = 1; }
  m.stormHour[at(x0 + 3, y0 + 3)] = 0.5; m.hail[at(x0 + 3, y0 + 3)] = 1.8; m.gust[at(x0 + 4, y0 + 3)] = 70;
  for (let t = 0; t < tornadoes; t++) { m.tornadoes.push(at(x0 + 2 + t, y0 + 4)); m.tornadoPeaks.push(tornadoMph); m.tornadoMph[at(x0 + 2 + t, y0 + 4)] = tornadoMph; }
  const key = { tornado: 'soonTornado', wind: 'soonWind', hail: 'soonHail' }[soon];
  if (spread) for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) m[key][at(x, y)] = spread;
  else for (let y = y0 + 2; y <= y0 + 4; y++) for (let x = x0 + 8; x <= x0 + 10; x++) m[key][at(x, y)] = block;
  return m;
}
const four = settings => [0, 1, 2, 3].map(k => run(k, settings));
const now = (storms = []) => ({ hourUtc: 44, width, height, cellMiles: 10, cellKm: 16, dewpoint: new Float32Array(n).fill(67), temperature: new Float32Array(n).fill(84), cape: new Float32Array(n).fill(2600), cin: new Float32Array(n).fill(20), shear: new Float32Array(n).fill(45), helicity: new Float32Array(n).fill(210), cloudBaseM: new Float32Array(n).fill(900), storms, lines: [] });
const storm = (x, y, more = {}) => ({ cell: at(x, y), hail: 1.2, gust: 50, tornado: false, rotating: true, line: false, intensity: 0.6, mesocyclone: 0.6, xKm: (x + 0.5) * 16, yKm: (y + 0.5) * 16, eastKph: 40, northKph: 30, ...more });

// --- The greatest short-term potential: where the runs' first hours put the most, a part of the area.
const md = buildMesoscaleDiscussions(four(), now([storm(x0 + 5, y0 + 5)]), { next: 1 })[0];
assert.ok(md.focus, 'a focus where the early tornadoes are'); assert.equal(md.focus.hazard, 'tornado');
assert.ok(md.focus.cells >= 2 && md.focus.cells <= MESOSCALE.focusMaxShare * md.areaCells, `a part of the area (${md.focus.cells} of ${md.areaCells} cells)`);
assert.ok(insideRings(md.focus.rings, (x0 + 9.5) / width, (y0 + 3.5) / height), 'round the block'); assert.ok(!insideRings(md.focus.rings, (x0 + 2) / width, (y0 + 9) / height), 'not over the rest');
assert.equal(md.focus.near, null, 'no named towns here');
assert.match(md.text, /SUMMARY\.\.\.[^\n]* The greatest short-term tornado potential is within a smaller part of the area\. A tornado watch/);
// Spread over the whole area: no part stands out. Too little in those hours: none.
assert.equal(buildMesoscaleDiscussions(four({ spread: 0.02 }), now())[0].focus, null, 'spread evenly: the whole area is the focus');
assert.equal(buildMesoscaleDiscussions(four({ block: 0.02 }), now())[0].focus, null, 'too few early tornadoes');
assert.doesNotMatch(buildMesoscaleDiscussions(four({ block: 0.02 }), now())[0].text, /greatest short-term/);
// Without a tornado peak, the hazard the runs put more of: wind here.
const windy = buildMesoscaleDiscussions(four({ tornadoes: 0, soon: 'wind', block: 2 }), now())[0];
assert.equal(windy.focus.hazard, 'wind'); assert.match(windy.text, /The greatest short-term damaging wind potential is/);
// Runs without early grids (from before 2026-11-14): no focus, and nothing breaks.
assert.equal(buildMesoscaleDiscussions(four().map(m => ({ ...m, soonTornado: undefined })), now())[0].focus, null);

// --- The arrow: the strongest storm in the area, an hour on (shares of the map's width; y south, north is up).
const arrow = md.arrow;
assert.deepEqual([arrow.x0, arrow.y0], [Math.round((x0 + 5.5) * 16 / 800 * 1e4) / 1e4, Math.round((y0 + 5.5) * 16 / 800 * 1e4) / 1e4]);
assert.ok(Math.abs(arrow.x1 - arrow.x0 - 40 / 800) < 1e-3 && Math.abs(arrow.y1 - arrow.y0 + 30 / 800) < 1e-3, 'east 40 km and north 30 km in the hour'); assert.equal(arrow.hours, MESOSCALE.arrowHours);
assert.equal(buildMesoscaleDiscussions(four(), now([storm(x0 + 5, y0 + 5, { eastKph: 1, northKph: 2 })]))[0].arrow, null, 'a storm nearly still: no arrow');
assert.equal(buildMesoscaleDiscussions(four(), now([storm(5, 40)]))[0].arrow, null, 'a storm outside the area: no arrow');
// With a focus, the arrow is the storm's that runs into it, though a stronger one elsewhere leads the area; none when
// no storm's does (MD 341, 2026-11-14: the leading tornadic storm's arrow ran away from the hail focus).
const two = buildMesoscaleDiscussions(four(), now([storm(x0 + 2, y0 + 9, { mesocyclone: 0.9 }), storm(x0 + 5, y0 + 5)]))[0];
assert.equal(two.arrow.x0, arrow.x0, 'the storm heading into the focus, not the strongest'); assert.equal(two.focus.mask, undefined, 'the mask is not kept');
assert.equal(buildMesoscaleDiscussions(four(), now([storm(x0 + 5, y0 + 5, { eastKph: -40, northKph: -30 })]))[0].arrow, null, 'heading away from the focus: no arrow');

// --- The game product: the focus and the arrow in map miles.
const game = gameMesoscale({ enabled: true, width, cellMiles: 10, nowHourUtc: 44, watches: [], discussions: [{ ...publicMesoscaleDiscussion(md), valid: true }] }).discussions[0];
assert.equal(game.focus.hazard, 'tornado'); assert.ok(game.focus.rings.length && game.focus.rings[0].every(v => v >= 0 && v <= 500));
assert.equal(game.arrow.x0, +(arrow.x0 * 500).toFixed(2)); assert.equal(game.arrow.y1, +(arrow.y1 * 500).toFixed(2));
assert.equal(JSON.stringify(game).includes('png'), false, 'no picture in what the game servers fetch');

// --- The radar picture: the composite mosaic of the moment, cut round the area a little wider than its map.
const mosaic = { width: 800, height: 800, resKm: 1, validHourUtc: 43.95, bytes: new Uint8Array(800 * 800) };
const dbz50 = 1 + (50 + 32) / 0.5;   // RadarFormat: min -32 dBZ, 0.5 dBZ steps, byte 0 = nothing
for (let j = 230; j < 260; j++) for (let i = 420; i < 450; i++) mosaic.bytes[j * 800 + i] = dbz50;
const view = pictureView(md.cells, { width, height, cellMiles: 10 });
assert.ok(view.size >= 120 && view.x <= x0 * 10 && view.x + view.size >= (x0 + size) * 10, 'the area and room round it');
const picture = await discussionRadar(mosaic, md.cells, now());
assert.deepEqual([...picture.png.subarray(1, 4)], [80, 78, 71], 'a PNG'); assert.equal(picture.validHourUtc, 43.95);
assert.ok(picture.size >= view.size - 1 && picture.x <= view.x + 1e-6, 'covering the view');
assert.equal(await discussionRadar(null, md.cells, now()), null); assert.equal(reflectivityKey().length, 15); assert.match(reflectivityKey()[9][1], /^#[0-9a-f]{6}$/);

// --- The map's layers.
const svg = areaSvg({ layer: null, shapes: [{ rings: game.rings, fill: '#ef4444', stroke: '#ef4444' }, { rings: game.focus.rings, hatch: '#dc2626', stroke: '#dc2626', width: 6 }], focus: game.rings,
  underlay: picture, arrows: [{ ...game.arrow, label: '1 h' }], callout: { text: 'Greatest short-term tornado potential', colour: '#dc2626', rings: game.focus.rings }, colourBar: { title: 'Radar', stops: reflectivityKey() } });
for (const part of ['<image href="data:image/png;base64,', '<pattern id="hatch0"', 'fill="url(#hatch0)"', '<polygon', '>1 h</text>', '>Greatest short-term tornado potential</text>', '>75</text>']) assert.ok(svg.includes(part), `the map has ${part}`);
assert.ok(svg.indexOf('<image') < svg.indexOf('url(#hatch0)'), 'the radar under the hatching');
// The label points at its area: an arrow in its colour after the box, ending on the area's outline.
const afterBox = svg.slice(svg.lastIndexOf('<rect x=', svg.indexOf('>Greatest short-term tornado potential</text>')));
assert.ok(afterBox.includes('fill="#dc2626"/>') && afterBox.includes('<polygon'), 'an arrow in the label colour');
assert.ok(!areaSvg({ layer: null, shapes: [{ rings: game.rings, fill: '#ef4444' }] }).includes('<image'), 'other maps are as they were');

// --- The archive: the picture kept with the discussion from the first look it is there, never in its JSON.
const runtime = { worldId: 'w', engine: { world: { validHourUtc: 44 } } };
let version = 1, given = null;
const products = { product: id => (id === 'mesoscale' ? { version, text: JSON.stringify(gameMesoscale({ enabled: true, width, cellMiles: 10, nowHourUtc: 44, watches: [], discussions: [{ ...publicMesoscaleDiscussion(md), valid: true }] })) } : null) };
const archive = new ProductArchive({ runtime, products, layer: () => null, pictures: () => given });
assert.equal(archive.discussion(1).radar, undefined, 'none yet');
given = picture; version++;
assert.deepEqual(archive.discussion(1).radar, { validHourUtc: 43.95 }, 'taken in when it comes, and only its time in the JSON');
given = null; version++;
const map = archive.discussionSvg(1);
assert.ok(map.includes('fill="#dc2626"/><circle'), 'the storm arrow in the focus colour');
// A saved arrow that misses the focus (issued before the fix) is left off.
const stray = { ...publicMesoscaleDiscussion(md), number: 2, arrow: { x0: 0.1, y0: 0.9, x1: 0.12, y1: 0.85, hours: 1 }, valid: true };
const strayProducts = { product: id => (id === 'mesoscale' ? { version: 1, text: JSON.stringify(gameMesoscale({ enabled: true, width, cellMiles: 10, nowHourUtc: 44, watches: [], discussions: [stray] })) } : null) };
assert.ok(!new ProductArchive({ runtime, products: strayProducts, layer: () => null }).discussionSvg(2).includes('>1 h</text>'), 'no arrow away from the focus');
assert.ok(map.includes('data:image/png;base64,') && map.includes('Greatest short-term tornado potential') && map.includes('Radar: composite reflectivity'), 'its map draws it all');
assert.ok(JSON.stringify(archive.discussion(1)).length < 20000, 'the page gets no picture');
console.log(`discussion graphics passed (focus ${md.focus.cells} of ${md.areaCells} cells; picture ${picture.png.length} bytes; map ${(map.length / 1024).toFixed(0)} KB)`);

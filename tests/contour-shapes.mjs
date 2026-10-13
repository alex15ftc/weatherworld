// Contours as shapes: the outline of where a field is at or above a level.
import assert from 'node:assert/strict';
import { contourRings, ringsArea, insideRings, softenArea } from '../js/forecast/contourShapes.js';

const width = 50, height = 50, n = width * height;
const cells = (field, level) => field.reduce((count, v) => count + (v >= level ? 1 : 0), 0) / n;
const field = new Float32Array(n);
for (let i = 0; i < n; i++) { const x = (i % width + 0.5) / width, y = (Math.floor(i / width) + 0.5) / height; field[i] = 100 * Math.exp(-((x - 0.6) ** 2 + (y - 0.4) ** 2) / 0.03) + 60 * Math.exp(-((x - 0.05) ** 2 + (y - 0.9) ** 2) / 0.02); }

// --- One ring for each separate area; the outline encloses what the cells say it should.
const low = contourRings(field, width, height, 5), middle = contourRings(field, width, height, 30), high = contourRings(field, width, height, 60);
assert.equal(low.length, 2); assert.equal(middle.length, 2); assert.equal(high.length, 1, 'the corner area does not reach 60');
for (const [rings, level] of [[low, 5], [middle, 30], [high, 60]]) assert.ok(Math.abs(ringsArea(rings) - cells(field, level)) < 0.01, `the outline at ${level} encloses the area the cells give`);
assert.ok(insideRings(high, 0.6, 0.4) && !insideRings(high, 0.05, 0.9) && insideRings(middle, 0.05, 0.9) && !insideRings(low, 0.1, 0.1));
// The areas nest: every point of a higher outline lies inside the lower one.
for (const ring of high) for (const [x, y] of ring) assert.ok(insideRings(middle, x, y) || insideRings(middle, x + 1e-3, y) || insideRings(middle, x - 1e-3, y));
assert.deepEqual(contourRings(field, width, height, 500), [], 'nothing reaches the level: no outline');

// --- Every point is on the map, and an area that runs off the map is closed along the map edge.
for (const rings of [low, middle, high]) for (const ring of rings) for (const [x, y] of ring) assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1);
const corner = middle.find(ring => insideRings([ring], 0.03, 0.95));
assert.ok(corner.some(([x]) => x === 0) && corner.some(([, y]) => y === 1), 'the corner area follows the west and south edges');
const whole = contourRings(new Float32Array(n).fill(50), width, height, 30);
assert.equal(whole.length, 1); assert.ok(Math.abs(ringsArea(whole) - 1) < 1e-6, 'a field above the level everywhere is the whole map');

// --- A hole comes out as a ring of its own and is left out of the area.
const band = new Float32Array(n);
for (let i = 0; i < n; i++) { const d = Math.hypot((i % width) - 25, Math.floor(i / width) - 25); band[i] = d < 18 && d > 7 ? 1 : 0; }
const annulus = contourRings(softenArea(band, width, height), width, height, 0.5);
assert.equal(annulus.length, 2);
assert.ok(Math.abs(ringsArea(annulus) - Math.PI * (18 * 18 - 7 * 7) / n) < 0.02);
assert.ok(!insideRings(annulus, 0.5, 0.5) && insideRings(annulus, 0.5 + 12 / 50, 0.5) && !insideRings(annulus, 0.02, 0.02));

// --- Smoothing rounds the corners without moving the outline far; without it the points are the grid's crossings.
const square = new Float32Array(n); for (let y = 15; y < 35; y++) for (let x = 15; x < 35; x++) square[y * width + x] = 1;
const sharp = contourRings(square, width, height, 0.5, { smoothing: 0 }), round = contourRings(square, width, height, 0.5);
assert.ok(round[0].length > sharp[0].length);
assert.ok(Math.abs(ringsArea(round) - ringsArea(sharp)) < 0.005);
// A softened area keeps its size: its outline is where it is half covered.
assert.ok(Math.abs(ringsArea(contourRings(softenArea(square, width, height), width, height, 0.5)) - 0.16) < 0.01);

console.log('contour shapes: ok');

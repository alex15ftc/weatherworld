// Contours as shapes: the outline of where a field is at or above a level.
import assert from 'node:assert/strict';
import { contourRings, ringsArea, insideRings, softenArea, tidyRanks, piecesAcrossCorners } from '../js/forecast/contourShapes.js';

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


// --- Tidying ranked areas (2026-11-14): specks go, pinholes fill, and each rank is ringed by the one below.
{
  const w = 20, h = 20, at = (x, y) => y * w + x, rank = new Uint8Array(w * h);
  for (let y = 4; y < 14; y++) for (let x = 2; x < 12; x++) rank[at(x, y)] = 2;      // a Slight-like area, touching nothing below it
  for (let y = 6; y < 11; y++) for (let x = 4; x < 9; x++) rank[at(x, y)] = 3;       // a higher core inside it
  rank[at(6, 8)] = 2;                                                               // a pinhole in the core
  rank[at(18, 2)] = 2; rank[at(19, 2)] = 2;                                         // a speck at the map edge
  rank[at(10, 5)] = 4; rank[at(6, 7)] = 4;                                          // a speck outside the core, and a one-cell top inside it
  const tidied = tidyRanks(Uint8Array.from(rank), w, h, { top: 4, minCells: 4, gapCells: 1, ringFrom: 2 });
  assert.equal(tidied[at(18, 2)], 0, 'the speck at the edge goes'); assert.equal(tidied[at(19, 2)], 0);
  assert.equal(tidied[at(6, 8)], 3, 'the pinhole is filled'); assert.equal(tidied[at(10, 5)], 2, 'a speck outside the core goes'); assert.equal(tidied[at(6, 7)], 4, 'the largest piece of a rank stays, however small');
  // Nested with a gap: every cell of rank k >= 2 has only cells of rank k - 1 or more within one cell.
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && tidied[i] >= 2) assert.ok(tidied[Y * w + X] >= tidied[i] - 1, `rank ${tidied[i]} at ${x},${y} touches rank ${tidied[Y * w + X]}`); }
  }
  assert.equal(tidied[at(1, 8)], 1, 'the area is ringed by the rank below it'); assert.equal(tidied[at(0, 8)], 0, 'one cell of ring, no more');
  assert.equal(piecesAcrossCorners(Uint8Array.from(tidied, r => (r >= 2 ? 1 : 0)), w, h).length, 1, 'one area left');
}
console.log('contour shapes: ok');

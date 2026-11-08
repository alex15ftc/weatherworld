// The tornado block of the cloud model's frames (js/cloudmodel/FrameCodec.js TORNADO): a known
// tornado shape written into a frame, with and without a nest, reads back the same from the full
// frame and from the near and far client frames, and frames with no tornado carry none. With
// --luau <dir>, also writes the frames there (full.bin, near.bin, far.bin, nest-*.bin and
// expect.json) for the Luau readers' check. A few seconds.
//   node tests/tornado-frame.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineRun, readScenarioText } from '../js/cloudmodel/EngineRun.js';
import { encode, decodeHeader, clientFrame, decodeClientFrame } from '../js/cloudmodel/FrameCodec.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = EngineRun.fromScenario(readScenarioText(fs.readFileSync(path.join(root, 'roblox/src/stormlab/data/SupercellB.luau'), 'utf8')));
const m = run.model;

// no tornado: no block
let f = encode(run, 1);
assert.equal(decodeHeader(f).tornado, null, 'no tornado in a frame without one');
assert.equal(decodeClientFrame(clientFrame(f)).tornado, null, 'none in the near frame');

const shape = {
  found: true, x: 31234.5, y: 28765.25, ox: m.ox, oy: m.oy, mph: 185, yards: 705, ef: 4,
  R: 113, drop: 4300, base: 812, tip: 418, gust: 44, zeta: 0.455, dzeta: -0.06, modelDrop: 370,
  levels: [50, 250, 500, 750, 1000, 1500, 2000, 3000].map((z, q) => ({ z, dx: 63 * q - 100, dy: -40 * q + 0, found: q < 7, funnel: q < 2 ? 0 : 73 * q })),
};
const want = {
  found: true, cloud: true, ef: 4, mph: 185, yards: 705, x: 31234.5, y: 28765.25, R: 113, drop: 4300, base: 812, tip: 418,
  gust: 44, zeta: 0.455, dzeta: -0.06, modelDrop: 370, levels: shape.levels.map(l => ({ z: l.z, dx: l.dx, dy: l.dy, funnel: l.funnel, found: l.found })), length: 92,
};
const near = t => ({ ...t, zeta: +t.zeta.toFixed(3), dzeta: +t.dzeta.toFixed(3) });
run.torShape = shape;
const checks = {};
for (const withNest of [false, true]) {
  if (withNest) run.nest = m.addNest({ nx: 48, ny: 48, ratio: 4, steps: 2, i0: 20, j0: 20 });
  f = encode(run, 2);
  const nf = clientFrame(f), ff = clientFrame(f, { far: true });
  const label = withNest ? 'with a nest' : 'without a nest';
  assert.deepEqual(near(decodeHeader(f).tornado), want, `full frame ${label}`);
  assert.deepEqual(near(decodeClientFrame(nf).tornado), want, `near frame ${label}`);
  assert.deepEqual(near(decodeClientFrame(ff).tornado), want, `far frame ${label}`);
  assert.equal(decodeClientFrame(nf).nest != null, withNest, `near frame nest ${label}`);
  checks[withNest ? 'nest' : 'box'] = { full: f, near: nf, far: ff };
}
// the box shift since the shape was taken moves the point with the frame
shape.ox = m.ox - 2;
assert.equal(decodeHeader(encode(run, 3)).tornado.x, Math.fround(31234.5 - 2 * m.dx), 'moved on by the box shift');

const i = process.argv.indexOf('--luau');
if (i > 0) {
  const dir = process.argv[i + 1];
  for (const [k, c] of Object.entries(checks)) for (const [n, b] of Object.entries(c)) fs.writeFileSync(path.join(dir, `${k}-${n}.bin`), b);
  fs.writeFileSync(path.join(dir, 'expect.json'), JSON.stringify(want));
}
console.log('tornado frame: ok (92-byte block, full, near and far frames, with and without a nest)');

import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { renderTile } from '../server/tiles/ProductTileRenderer.js';

function readPngRgba(png) {
  const signature = png.subarray(0, 8);
  assert.equal(signature.toString('hex'), '89504e470d0a1a0a');
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < png.length) {
    const len = png.readUInt32BE(offset); offset += 4;
    const type = png.subarray(offset, offset + 4).toString('ascii'); offset += 4;
    const data = png.subarray(offset, offset + len); offset += len + 4;
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = Buffer.alloc(height * stride);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    assert.equal(filter, 0, 'test decoder expects PNG filter 0');
    raw.copy(rgba, y * stride, src, src + stride);
    src += stride;
  }
  return { width, height, rgba };
}

const width = 4, height = 2;
const values = new Float32Array([
  35, 50, 75, 105,
  35, 50, 75, 105
]);
const png = await renderTile({ values, width, height, product: 'temperature', z: 0, x: 0, y: 0 });
const decoded = readPngRgba(png);
const y = Math.floor(decoded.height / 4);
const colors = [0.125, 0.375, 0.625, 0.875].map(frac => {
  const x = Math.floor(decoded.width * frac);
  const i = (y * decoded.width + x) * 4;
  return decoded.rgba.subarray(i, i + 3).toString('hex');
});
assert.equal(new Set(colors).size, 4, `expected four horizontally distinct colors, got ${colors.join(', ')}`);
console.log('tile horizontal variation regression passed');

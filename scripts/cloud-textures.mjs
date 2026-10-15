// Writes the storm textures (js/meshes/cloudTextures.js) as PNG to data/cloud-textures/, for
// preview and, once approved, upload. Also writes preview.png: every texture on a sky-blue
// background, for looking at in one go.
//   node scripts/cloud-textures.mjs [--seed 1] [--frame 256]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';
import { cloudSprite, spriteSheet, funnelSurface, rainStreaks, SPRITES } from '../js/meshes/cloudTextures.js';

avoidBackgroundThrottling();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data/cloud-textures');
const args = process.argv.slice(2), flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const seed = Number(flag('--seed', 1)), frame = Number(flag('--frame', 256));

// --- PNG ----------------------------------------------------------------------------------------
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length), body = Buffer.concat([Buffer.from(type), data]);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}
export function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1); }
  const head = Buffer.alloc(13); head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(OUT, { recursive: true });
const started = Date.now(), made = [];
const save = (name, size, pixels) => { writeFileSync(path.join(OUT, `${name}.png`), png(size, size, pixels)); made.push({ name, size, pixels }); console.log(`  ${name}.png ${size}x${size} (${Math.round((Date.now() - started) / 1000)} s)`); };

for (const kind of Object.keys(SPRITES)) save(kind, frame, cloudSprite(kind, seed, frame));
for (const kind of ['puff', 'scud', 'wisp', 'smoke', 'dust']) { const sheet = spriteSheet(kind, seed, frame, 4); save(`${kind}-sheet4x4`, sheet.size, sheet.pixels); }
save('funnel-laminar', 512, funnelSurface('laminar', seed, 512));
save('funnel-turbulent', 512, funnelSurface('turbulent', seed, 512));
save('rain', 256, rainStreaks(seed, 256, 0.6));

// The contact sheet: each texture shrunk to a 256 tile over sky blue (funnel tiles as they are).
const tile = 256, cols = 4, rows = Math.ceil(made.length / cols), W = cols * tile, H = rows * tile, sheet = new Uint8ClampedArray(W * H * 4);
for (let p = 0; p < W * H; p++) { const y = Math.floor(p / W) % tile / tile; sheet[p * 4] = 120 + 40 * y; sheet[p * 4 + 1] = 150 + 35 * y; sheet[p * 4 + 2] = 190 + 25 * y; sheet[p * 4 + 3] = 255; }
made.forEach(({ size, pixels }, k) => {
  const ox = (k % cols) * tile, oy = Math.floor(k / cols) * tile;
  for (let j = 0; j < tile; j++) for (let i = 0; i < tile; i++) {
    const s = (Math.floor(j * size / tile) * size + Math.floor(i * size / tile)) * 4, d = ((oy + j) * W + ox + i) * 4, a = pixels[s + 3] / 255;
    for (let c = 0; c < 3; c++) sheet[d + c] = sheet[d + c] * (1 - a) + pixels[s + c] * a;
  }
});
writeFileSync(path.join(OUT, 'preview.png'), png(W, H, sheet));
console.log(`wrote ${made.length} textures and preview.png to ${path.relative(ROOT, OUT)} in ${Math.round((Date.now() - started) / 1000)} s`);

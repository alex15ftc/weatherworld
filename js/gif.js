// A loop of pictures as an animated GIF, made in the browser (no server has to draw anything): the map tools'
// "Save loop as GIF" and the day pages' replays use it.
//   encodeGif(frames, width, height, delayMs) -> Uint8Array   frames: RGBA pixel lists (ImageData.data)
//   saveLoop({ count, show, draw, width, height, delayMs, name, onProgress })   steps a page through its
//       frames (await show(k)), has each drawn (draw(context, k) onto a width x height canvas) and saves the GIF
// One palette of up to 255 colours serves the whole loop: the commonest colours of all the frames (at 5 bits a
// channel), every other colour taking the nearest of them. Charts are flat colours and lines, so this is close
// to exact; a photograph would need more.
import { mp4Recorder } from '/js/mp4.js';
import { roleNow } from '/js/site.js';

function paletteOf(frames) {
  const counts = new Uint32Array(32768);
  for (const data of frames) for (let i = 0; i < data.length; i += 4) counts[((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)]++;
  const used = [];
  for (let c = 0; c < 32768; c++) if (counts[c]) used.push(c);
  used.sort((a, b) => counts[b] - counts[a]);
  const chosen = used.slice(0, 255), rgb = c => [((c >> 10) & 31) * 8 + 4, ((c >> 5) & 31) * 8 + 4, (c & 31) * 8 + 4];
  const palette = chosen.map(rgb), index = new Int16Array(32768).fill(-1);
  chosen.forEach((c, k) => { index[c] = k; });
  // Every other colour seen: the nearest chosen one.
  for (const c of used.slice(255)) {
    const [r, g, b] = rgb(c);
    let best = 0, least = Infinity;
    for (let k = 0; k < palette.length; k++) { const p = palette[k], d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2; if (d < least) { least = d; best = k; } }
    index[c] = best;
  }
  return { palette, index };
}

// LZW as GIF wants it: codes of growing width, least significant bit first, in blocks of up to 255 bytes.
function lzw(pixels, out) {
  const minCode = 8, clear = 1 << minCode, end = clear + 1;
  let size = minCode + 1, next = end + 1, bits = 0, held = 0, block = [];
  const flush = () => { if (block.length) { out.push(block.length, ...block); block = []; } };
  const put = code => { held |= code << bits; bits += size; while (bits >= 8) { block.push(held & 255); if (block.length === 255) flush(); held >>>= 8; bits -= 8; } };
  let table = new Map(), prefix = pixels[0];
  out.push(minCode); put(clear);
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i], key = (prefix << 8) | k, found = table.get(key);
    if (found !== undefined) { prefix = found; continue; }
    put(prefix);
    if (next < 4096) { table.set(key, next++); if (next > (1 << size) && size < 12) size++; }
    else { put(clear); table = new Map(); size = minCode + 1; next = end + 1; }
    prefix = k;
  }
  put(prefix); put(end);
  if (bits > 0) { block.push(held & 255); }
  flush(); out.push(0);
}

export function encodeGif(frames, width, height, delayMs = 400, holdMs = 1500) {
  const { palette, index } = paletteOf(frames), out = [];
  const word = v => out.push(v & 255, (v >> 8) & 255);
  out.push(...[...'GIF89a'].map(c => c.charCodeAt(0)));
  word(width); word(height); out.push(0xf7, 0, 0);                       // a global palette of 256
  for (let k = 0; k < 256; k++) out.push(...(palette[k] ?? [0, 0, 0]));
  out.push(0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map(c => c.charCodeAt(0)), 3, 1, 0, 0, 0); // loop for ever
  frames.forEach((data, f) => {
    const delay = Math.round((f === frames.length - 1 ? holdMs : delayMs) / 10);
    out.push(0x21, 0xf9, 4, 0); word(delay); out.push(0, 0);                // this frame's delay
    out.push(0x2c); word(0); word(0); word(width); word(height); out.push(0);
    const pixels = new Uint8Array(width * height);
    for (let p = 0, i = 0; p < pixels.length; p++, i += 4) pixels[p] = index[((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)];
    lzw(pixels, out);
  });
  out.push(0x3b);
  return Uint8Array.from(out);
}

export function download(bytes, name, type = 'image/gif') {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([bytes], { type })); link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

// Steps through a loop and saves it. show(k): make the page show frame k (may be async). draw(g, k): draw the
// picture of what is shown onto the canvas context g (width x height).
// format 'mp4' saves the same loop as an MP4 video instead (js/mp4.js; the name's .gif becomes .mp4): the same
// frames and times, the last one held, in full colour. It is H.264; for an admin (for now) it is AV1 where the
// browser can encode it. It throws where the browser has no encoder for it.
export async function saveLoop({ count, show, draw, width, height, delayMs = 400, name = 'loop.gif', format = 'gif', holdMs = 1500, onProgress = () => {} }) {
  const mp4 = format === 'mp4';
  // (H.264 wants an even width and height, and the AV1 file keeps to the same)
  if (mp4) { width += width % 2; height += height % 2; }
  const video = mp4 ? await mp4Recorder(width, height, delayMs, { codec: await roleNow() === 'admin' ? 'av1' : 'h264' }) : null;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const g = canvas.getContext('2d', { willReadFrequently: true }), frames = [];
  for (let k = 0; k < count; k++) {
    onProgress(`Frame ${k + 1} of ${count}…`);
    await show(k);
    await new Promise(resolve => requestAnimationFrame(resolve));
    g.fillStyle = '#0a0f15'; g.fillRect(0, 0, width, height);
    draw(g, k);
    if (video) video.add(canvas, k === count - 1 ? holdMs : delayMs); else frames.push(g.getImageData(0, 0, width, height).data);
  }
  onProgress(`Putting the ${mp4 ? 'MP4' : 'GIF'} together…`);
  await new Promise(resolve => setTimeout(resolve, 30));
  const bytes = video ? await video.finish() : encodeGif(frames, width, height, delayMs, holdMs);
  download(bytes, mp4 ? name.replace(/\.gif$/, '.mp4') : name, mp4 ? 'video/mp4' : 'image/gif');
  onProgress('');
  return bytes;
}

// A chart's picture for a loop: a title strip (what it is, and its time), the chart itself fitted under it, and the
// site's name along the bottom. chart: the page's canvas; square: only the square in the middle of it (a square map
// drawn in a wide canvas).
export function drawChartFrame(g, chart, { title, time, square = false, note = 'High Risk · simulated weather, not a real forecast' }) {
  const width = g.canvas.width, height = g.canvas.height, top = 40, bottom = 26;
  g.fillStyle = '#0a0f15'; g.fillRect(0, 0, width, height);
  // (the chart keeps its shape, centred in the room between the strips)
  const side = Math.min(chart.width, chart.height), from = square ? { x: (chart.width - side) / 2, y: (chart.height - side) / 2, w: side, h: side } : { x: 0, y: 0, w: chart.width, h: chart.height };
  const room = { w: width, h: height - top - bottom }, k = Math.min(room.w / from.w, room.h / from.h), w = from.w * k, h = from.h * k;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(chart, from.x, from.y, from.w, from.h, (width - w) / 2, top + (room.h - h) / 2, w, h);
  g.fillStyle = '#0b3a57'; g.fillRect(0, 0, width, top); g.fillStyle = '#f2b632'; g.fillRect(0, top - 3, width, 3);
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = '700 19px "Public Sans", system-ui, sans-serif'; g.fillText(title, 14, (top - 3) / 2 + 1, width * 0.62);
  g.textAlign = 'right'; g.font = '600 15px "IBM Plex Mono", ui-monospace, monospace'; g.fillText(time, width - 14, (top - 3) / 2 + 1);
  g.fillStyle = '#10161d'; g.fillRect(0, height - bottom, width, bottom);
  g.fillStyle = '#cfd6dc'; g.font = '500 13px "Public Sans", system-ui, sans-serif'; g.fillText(note, width - 14, height - bottom / 2);
}

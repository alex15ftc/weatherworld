// A loop of pictures as an MP4 video, made in the browser: the browser's own H.264 encoder (WebCodecs) makes the
// frames and the few boxes an MP4 file needs are written here. js/gif.js's saveLoop uses it for "Save as MP4".
//   const video = await mp4Recorder(width, height, frameMs)   width and height even; throws where the browser
//                                                              has no H.264 encoder
//   video.add(canvas, ms)        the canvas as it is now, shown for ms milliseconds
//   await video.finish()         -> Uint8Array, the file
// The file is one video track, its index (moov) ahead of the frames (mdat) so that it starts playing at once.
// Times are in milliseconds, so a frame may stay up for any time: the last one is held, as in the GIF.

const u16 = v => [(v >> 8) & 255, v & 255];
const u32 = v => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const text = s => [...s].map(c => c.charCodeAt(0));
const zeros = n => new Array(n).fill(0);
function box(type, ...parts) {
  const out = new Uint8Array(8 + parts.reduce((n, p) => n + p.length, 0));
  out.set(u32(out.length), 0); out.set(text(type), 4);
  let at = 8;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const MATRIX = [...u32(0x10000), ...zeros(12), ...u32(0x10000), ...zeros(12), ...u32(0x40000000)];

// samples: [{ bytes, key, ms }] in the order shown; description: the encoder's avcC record.
function mp4Of(samples, { width, height, description }) {
  const total = samples.reduce((n, s) => n + s.ms, 0);
  // (frames shown for the same time in a row share one entry)
  const runs = [];
  for (const s of samples) { const last = runs[runs.length - 1]; if (last && last[1] === s.ms) last[0]++; else runs.push([1, s.ms]); }
  const keys = samples.map((s, k) => (s.key ? k + 1 : 0)).filter(Boolean);
  const moov = dataAt => box('moov',
    box('mvhd', zeros(4), zeros(8), u32(1000), u32(total), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(2)),
    box('trak',
      box('tkhd', [0, 0, 0, 3], zeros(8), u32(1), zeros(4), u32(total), zeros(8), zeros(8), MATRIX, u32(width << 16), u32(height << 16)),
      box('mdia',
        box('mdhd', zeros(4), zeros(8), u32(1000), u32(total), u16(0x55c4), zeros(2)),
        box('hdlr', zeros(4), zeros(4), text('vide'), zeros(12), text('VideoHandler'), [0]),
        box('minf',
          box('vmhd', [0, 0, 0, 1], zeros(8)),
          box('dinf', box('dref', zeros(4), u32(1), box('url ', [0, 0, 0, 1]))),
          box('stbl',
            box('stsd', zeros(4), u32(1),
              box('avc1', zeros(6), u16(1), zeros(16), u16(width), u16(height), u32(0x480000), u32(0x480000), zeros(4), u16(1), zeros(32), u16(24), u16(0xffff),
                box('avcC', description))),
            box('stts', zeros(4), u32(runs.length), runs.flatMap(([count, ms]) => [...u32(count), ...u32(ms)])),
            box('stss', zeros(4), u32(keys.length), keys.flatMap(u32)),
            box('stsc', zeros(4), u32(1), u32(1), u32(samples.length), u32(1)),
            box('stsz', zeros(4), u32(0), u32(samples.length), samples.flatMap(s => u32(s.bytes.length))),
            box('stco', zeros(4), u32(1), u32(dataAt)))))));
  const ftyp = box('ftyp', text('isom'), u32(0x200), text('isomiso2avc1mp41'));
  // (the index's size does not depend on where the frames start, so it is made once to be measured)
  const index = moov(ftyp.length + moov(0).length + 8);
  return new Blob([ftyp, index, box('mdat', ...samples.map(s => s.bytes))]).arrayBuffer().then(buffer => new Uint8Array(buffer));
}

export async function mp4Recorder(width, height, frameMs = 200) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') throw new Error('this browser cannot make MP4 video; use the GIF');
  if (width % 2 || height % 2) throw new Error('an MP4 needs an even width and height');
  // Charts are sharp lines and flat colours: a generous bit rate, since there are only a few frames a second.
  const wanted = { width, height, bitrate: Math.max(2.5e6, width * height * 10), framerate: Math.max(1, Math.round(1000 / frameMs)), latencyMode: 'quality', avc: { format: 'avc' } };
  let config = null;
  for (const codec of ['avc1.640028', 'avc1.640033', 'avc1.4d0028', 'avc1.42e028', 'avc1.42001f']) {
    try { if ((await VideoEncoder.isConfigSupported({ ...wanted, codec })).supported) { config = { ...wanted, codec }; break; } } catch { /* not this one */ }
  }
  if (!config) throw new Error('this browser has no H.264 encoder for MP4; use the GIF');
  const samples = [], times = [];
  let description = null, failed = null, at = 0;
  const encoder = new VideoEncoder({
    output(chunk, meta) {
      const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes);
      const d = meta?.decoderConfig?.description;
      if (d && !description) description = d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
      samples.push({ bytes, key: chunk.type === 'key' });
    },
    error(error) { failed = error; }
  });
  encoder.configure(config);
  return {
    add(canvas, ms) {
      if (failed) throw failed;
      const frame = new VideoFrame(canvas, { timestamp: at * 1000, duration: ms * 1000 });
      encoder.encode(frame, { keyFrame: times.length % 30 === 0 });
      frame.close(); times.push(ms); at += ms;
    },
    async finish() {
      await encoder.flush(); encoder.close();
      if (failed) throw failed;
      if (!description || samples.length !== times.length) throw new Error('the video encoder did not return every frame');
      samples.forEach((s, k) => { s.ms = times[k]; });
      return mp4Of(samples, { width, height, description });
    }
  };
}

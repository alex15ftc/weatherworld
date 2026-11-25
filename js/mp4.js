// A loop of pictures as an MP4 video, made in the browser: the browser's own encoder (WebCodecs) makes the frames
// and the few boxes an MP4 file needs are written here. js/gif.js's saveLoop uses it for "Save as MP4".
//   const video = await mp4Recorder(width, height, frameMs, { codec })   width and height even; throws where the
//                                                              browser has no encoder for MP4
//   video.add(canvas, ms)        the canvas as it is now, shown for ms milliseconds
//   await video.finish()         -> Uint8Array, the file
//   video.codec                  'av1' or 'h264': what the file holds
// codec 'h264' (the default) is H.264, which every site and player takes. codec 'av1' is AV1 where the browser can
// encode it, else H.264; saveLoop asks for it for an admin only, for now. The AV1 rates: a constant quantizer of 18 for a
// picture taller than 1080 lines, else a constant 8000 kbit/s.
// The file is one video track, its index (moov) ahead of the frames (mdat) so that it starts playing at once.
// Times are in milliseconds, so a frame may stay up for any time: the last one is held, as in the GIF.

const AV1_QUANTIZER = 18, AV1_BITRATE = 8e6;

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

// samples: [{ bytes, key, ms }] in the order shown; entry: the codec's sample entry name ('avc1', 'av01');
// record: its configuration box (avcC, av1C).
function mp4Of(samples, { width, height, entry, record }) {
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
              box(entry, zeros(6), u16(1), zeros(16), u16(width), u16(height), u32(0x480000), u32(0x480000), zeros(4), u16(1), zeros(32), u16(24), u16(0xffff),
                record)),
            box('stts', zeros(4), u32(runs.length), runs.flatMap(([count, ms]) => [...u32(count), ...u32(ms)])),
            box('stss', zeros(4), u32(keys.length), keys.flatMap(u32)),
            box('stsc', zeros(4), u32(1), u32(1), u32(samples.length), u32(1)),
            box('stsz', zeros(4), u32(0), u32(samples.length), samples.flatMap(s => u32(s.bytes.length))),
            box('stco', zeros(4), u32(1), u32(dataAt)))))));
  const ftyp = box('ftyp', text('isom'), u32(0x200), text(`isomiso2${entry}mp41`));
  // (the index's size does not depend on where the frames start, so it is made once to be measured)
  const index = moov(ftyp.length + moov(0).length + 8);
  return new Blob([ftyp, index, box('mdat', ...samples.map(s => s.bytes))]).arrayBuffer().then(buffer => new Uint8Array(buffer));
}

// AV1 comes from the encoder as a row of OBUs (each with its size): [{ type, start, body, end }].
function obusOf(bytes) {
  const out = [];
  for (let at = 0; at < bytes.length;) {
    const head = bytes[at], sized = (head >> 1) & 1;
    let body = at + 1 + ((head >> 2) & 1), size = 0;
    if (sized) for (let shift = 0; ; shift += 7) { const b = bytes[body++]; size += (b & 127) * 2 ** shift; if (!(b & 128)) break; }
    const end = sized ? body + size : bytes.length;
    out.push({ type: (head >> 3) & 15, start: at, body, end }); at = end;
  }
  return out;
}

// The av1C record of an AV1 key frame: what its sequence header says of the profile, level and pixel format, and
// the header itself (AV1 Bitstream spec 5.5; AV1 in ISOBMFF 2.3).
function av1Record(sample) {
  const header = obusOf(sample).find(o => o.type === 1);
  if (!header) throw new Error('the AV1 encoder gave no sequence header');
  let pos = header.body * 8;
  const f = n => { let v = 0; while (n-- > 0) { v = v * 2 + ((sample[pos >> 3] >> (7 - (pos & 7))) & 1); pos++; } return v; };
  const profile = f(3); f(1);
  const reduced = f(1);
  let level = 0, tier = 0;
  if (reduced) level = f(5);
  else {
    let model = 0, delayBits = 0;
    if (f(1)) {                                                  // timing info
      f(32); f(32);
      if (f(1)) { let n = 0; while (!f(1)) n++; f(n); }
      model = f(1);
      if (model) { delayBits = f(5) + 1; f(32); f(5); f(5); }
    }
    const display = f(1), points = f(5) + 1;
    for (let k = 0; k < points; k++) {
      f(12);
      const l = f(5), t = l > 7 ? f(1) : 0;
      if (k === 0) { level = l; tier = t; }
      if (model && f(1)) { f(delayBits); f(delayBits); f(1); }
      if (display && f(1)) f(4);
    }
  }
  const widthBits = f(4) + 1, heightBits = f(4) + 1; f(widthBits); f(heightBits);
  if (!reduced && f(1)) { f(4); f(3); }
  f(3);
  if (!reduced) {
    f(4);
    const hint = f(1); if (hint) f(2);
    const screenTools = f(1) ? 2 : f(1);
    if (screenTools > 0 && !f(1)) f(1);
    if (hint) f(3);
  }
  f(3);
  const high = f(1), twelve = profile === 2 && high ? f(1) : 0, mono = profile === 1 ? 0 : f(1);
  let primaries = 2, transfer = 2, matrix = 2, subX = 1, subY = 1, place = 0;
  if (f(1)) { primaries = f(8); transfer = f(8); matrix = f(8); }
  if (mono) f(1);
  else if (primaries === 1 && transfer === 13 && matrix === 0) subX = subY = 0;
  else {
    f(1);
    if (profile === 1) subX = subY = 0;
    else if (profile === 2) { if (twelve) { subX = f(1); subY = subX ? f(1) : 0; } else subY = 0; }
    if (subX && subY) place = f(2);
  }
  return [0x81, (profile << 5) | level, (tier << 7) | (high << 6) | (twelve << 5) | (mono << 4) | (subX << 3) | (subY << 2) | place, 0, ...sample.subarray(header.start, header.end)];
}

async function firstSupported(configs) {
  for (const config of configs) { try { if ((await VideoEncoder.isConfigSupported(config)).supported) return config; } catch { /* not this one */ } }
  return null;
}

export async function mp4Recorder(width, height, frameMs = 200, { codec = 'h264' } = {}) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') throw new Error('this browser cannot make MP4 video; use the GIF');
  if (width % 2 || height % 2) throw new Error('an MP4 needs an even width and height');
  const base = { width, height, framerate: Math.max(1, Math.round(1000 / frameMs)), latencyMode: 'quality' };
  let config = null, quantizer = false;
  if (codec === 'av1') {
    quantizer = height > 1080;
    const rate = quantizer ? { bitrateMode: 'quantizer' } : { bitrateMode: 'constant', bitrate: AV1_BITRATE };
    // (the level a picture of this size needs first: 4.0 to 2228224 pixels, then 5.0, then 6.0)
    const levels = width * height <= 2228224 ? ['08', '12'] : width * height <= 8912896 ? ['12', '16'] : ['16'];
    config = await firstSupported(levels.map(level => ({ ...base, ...rate, codec: `av01.0.${level}M.08` })));
  }
  const av1 = !!config;
  // H.264. Charts are sharp lines and flat colours: a generous bit rate, since there are only a few frames a second.
  config ??= await firstSupported(['avc1.640028', 'avc1.640033', 'avc1.4d0028', 'avc1.42e028', 'avc1.42001f']
    .map(name => ({ ...base, bitrate: Math.max(2.5e6, width * height * 10), avc: { format: 'avc' }, codec: name })));
  if (!config) throw new Error('this browser has no video encoder for MP4; use the GIF');
  const samples = [], times = [];
  let description = null, failed = null, at = 0;
  const encoder = new VideoEncoder({
    output(chunk, meta) {
      let bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes);
      // (an MP4 holds AV1 without the delimiter that starts each frame)
      if (av1) { const first = obusOf(bytes)[0]; if (first?.type === 2) bytes = bytes.subarray(first.end); }
      const d = meta?.decoderConfig?.description;
      if (d && !description) description = d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
      samples.push({ bytes, key: chunk.type === 'key' });
    },
    error(error) { failed = error; }
  });
  encoder.configure(config);
  return {
    codec: av1 ? 'av1' : 'h264',
    add(canvas, ms) {
      if (failed) throw failed;
      const frame = new VideoFrame(canvas, { timestamp: at * 1000, duration: ms * 1000 });
      encoder.encode(frame, { keyFrame: times.length % 30 === 0, ...(av1 && quantizer ? { av1: { quantizer: AV1_QUANTIZER } } : {}) });
      frame.close(); times.push(ms); at += ms;
    },
    async finish() {
      await encoder.flush(); encoder.close();
      if (failed) throw failed;
      if (samples.length !== times.length || !(av1 || description)) throw new Error('the video encoder did not return every frame');
      samples.forEach((s, k) => { s.ms = times[k]; });
      const record = av1 ? box('av1C', av1Record(samples[0].bytes)) : box('avcC', description);
      return mp4Of(samples, { width, height, entry: av1 ? 'av01' : 'avc1', record });
    }
  };
}

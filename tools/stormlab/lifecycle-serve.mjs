// A tornado's whole life for Studio: one engine storm recorded from before its tornado touches down
// to after it ends, every storm tick (5 sim min), and replayed to the game with the same three
// endpoints LiveFeed uses (storm/players, storm/frames, lab/window, lab/storms). The game draws
// whichever recorded moment is chosen, so every stage can be captured from the same camera poses.
//
//   SEED=9 START_H=17 MIN_MPH=100 PORT=3029 PASS=http://127.0.0.1:3000 node tools/stormlab/lifecycle-serve.mjs
//
// Control (GET):
//   /life            the recorded moments: index, hour, stage, tornado numbers (JSON)
//   /life/goto?i=N   serve moment N (also ?stage=pre|touchdown|mature|decay|rope|post: its first)
//   /life/next, /life/prev
//   /life/now        the moment being served
// Steps:
//   1 search: run the day until a tornado of at least MIN_MPH has touched down and ended; its storm
//     is the target (cached in OUT/target.json)
//   2 record: run the day again (the engine is deterministic for a seed) and build that storm's
//     frame each tick from PRE_MIN before touchdown to POST_MIN after the end (cached in OUT)
//   3 park: run the day a third time to touchdown, so /lab/window answers with that hour's air
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const R = 'file:///C:/Users/alex1/Documents/VSCodeProjects/weatherworld/';
const { WeatherAuthorityRuntime } = await import(R + 'server/WeatherAuthorityRuntime.js');
const { clientFrame } = await import(R + 'js/cloudmodel/FrameCodec.js');
const { avoidBackgroundThrottling } = await import(R + 'js/runtime/processPriority.node.js');
const { buildStormFrame } = await import(R + 'js/storms/StormStructure.js');
const { flashRatePerMin } = await import(R + 'js/storms/StormAppearance.js');
const { chargeOf } = await import(R + 'js/storms/Lightning.js');
const { lookOf } = await import(R + 'js/game/StormWorkers.js');
const { zstdCompressSync } = await import('node:zlib');
avoidBackgroundThrottling();

const SEED = String(process.env.SEED ?? '9');
const START_H = Number(process.env.START_H ?? 17);
const MIN_MPH = Number(process.env.MIN_MPH ?? 100);
const PRE_MIN = Number(process.env.PRE_MIN ?? 40);
const POST_MIN = Number(process.env.POST_MIN ?? 20);
const MAX_TICKS = Number(process.env.MAX_TICKS ?? 12 * 6);
const MIN_LIFE = Number(process.env.MIN_LIFE ?? 20); // (min on the ground)
const MAX_OCCL = Number(process.env.MAX_OCCL ?? 1); // (the least rain-wrap it reaches: below 1 to see its funnel)
const OUT = process.env.OUT ?? path.join('tools', 'stormlab', 'out', `life-${SEED}-${START_H}-${MIN_MPH}`);
fs.mkdirSync(OUT, { recursive: true });

// the same stepping every run: half-hour advances to START_H, then storm ticks
function startRun() {
  const rt = new WeatherAuthorityRuntime({ seed: SEED, statePath: null });
  const w = () => rt.atmosphere;
  const hour = () => w().stormEngine?.validHourUtc ?? w().validHourUtc;
  for (let i = 0; i < 60 && !(hour() >= START_H && hour() < START_H + 1); i++) rt.advance(0.5);
  return { rt, w, hour, tick: () => rt.engine.advanceStormLayer(1 / 12) };
}
const torOf = s => {
  const t = s?.tornado ?? {};
  return { state: t.state ?? 'none', onGround: !!t.onGround, mph: Math.round(t.windSpeedMph ?? 0), yards: Math.round(t.widthYards ?? 0),
    ageMin: Math.round(t.ageMinutes ?? 0), occlusion: +(s?.occlusion ?? 0).toFixed(2), peakMph: Math.round(t.peakWindSpeedMph ?? 0) };
};

// 1 search
const targetPath = path.join(OUT, 'target.json');
let target = fs.existsSync(targetPath) ? JSON.parse(fs.readFileSync(targetPath, 'utf8')) : null;
if (!target) {
  const run = startRun();
  const seen = new Map();
  for (let n = 0; n < MAX_TICKS && !target; n++) {
    run.tick();
    for (const s of run.w().storms ?? []) {
      const t = s.tornado ?? {};
      const id = String(s.id);
      let r = seen.get(id);
      // (only one that touches down after the recording can begin: its stage before touchdown is wanted)
      if (t.onGround && !r) seen.set(id, r = { id, touchH: run.hour(), peak: 0, early: n < PRE_MIN / 5 });
      if (r && !r.endH) {
        r.peak = Math.max(r.peak, t.windSpeedMph ?? 0);
        if (t.onGround) r.minOccl = Math.min(r.minOccl ?? 1, s.occlusion ?? 0);
        if (!t.onGround) {
          r.endH = run.hour();
          if (r.peak >= MIN_MPH && !r.early && (r.endH - r.touchH) * 60 >= MIN_LIFE - 1e-6 && (r.minOccl ?? 1) <= MAX_OCCL) target = r;
        }
      }
    }
    if (n % 12 === 0) console.log('search hour', run.hour().toFixed(2), [...seen.values()].map(r => `${r.id}:${Math.round(r.peak)}/${(r.minOccl ?? 1).toFixed(2)}${r.endH ? 'e' : ''}`).join(' '));
  }
  if (!target) { console.log('no tornado of', MIN_MPH, 'mph that ends within', MAX_TICKS, 'ticks'); process.exit(1); }
  fs.writeFileSync(targetPath, JSON.stringify(target, null, 1));
}
console.log('target', JSON.stringify(target));

// 2 record
const framesPath = path.join(OUT, 'frames.json');
let frames = fs.existsSync(framesPath) ? JSON.parse(fs.readFileSync(framesPath, 'utf8')) : null;
if (!frames) {
  frames = [];
  const run = startRun();
  const from = target.touchH - PRE_MIN / 60, to = target.endH + POST_MIN / 60;
  for (let n = 0; n < MAX_TICKS + 24 && run.hour() < to - 1e-6; n++) {
    run.tick();
    if (run.hour() < from - 1e-6) continue;
    const s = (run.w().storms ?? []).find(x => String(x.id) === target.id);
    if (!s || s.active === false) { console.log('storm gone at', run.hour().toFixed(2)); break; }
    const f = buildStormFrame(run.w(), s, { seq: 1 });
    const ch = chargeOf(s);
    const look = lookOf(s);
    frames.push({
      i: frames.length, hour: +run.hour().toFixed(4), tor: torOf(s),
      pos: [s.positionKm.x, s.positionKm.y], motion: [(s.velocityKph?.east ?? 0) / 3.6, (s.velocityKph?.north ?? 0) / 3.6],
      lightning: [flashRatePerMin(Number(s.geometry?.updraught?.speedMs ?? s.updraughtMs) || 0), ch.groundShare, ch.positiveShare],
      look: { values: Array.from(look.values), leftMover: !!look.leftMover }, info: f.info,
      near: zstdCompressSync(clientFrame(f.bytes)).toString('base64'), far: zstdCompressSync(clientFrame(f.bytes, { far: true })).toString('base64'),
    });
    const fr = frames.at(-1);
    console.log('rec', fr.i, fr.hour.toFixed(2), JSON.stringify(fr.tor));
  }
  // stages, from the engine's own tornado: before touchdown, its first 10 min, rising to its peak,
  // at its peak (within 10%), falling, its last 10 min, after it ends
  const peak = Math.max(...frames.map(f => f.tor.mph));
  const onIdx = frames.filter(f => f.tor.onGround).map(f => f.i);
  const last = onIdx.at(-1) ?? -1;
  const peakI = frames.findIndex(f => f.tor.mph === peak);
  for (const f of frames) {
    const t = f.tor;
    f.stage = !t.onGround ? (f.i < (onIdx[0] ?? 0) ? 'pre' : 'post')
      : t.ageMin <= 10 ? 'touchdown'
      : f.i >= last - 1 ? 'rope'
      : t.mph >= 0.9 * peak ? 'mature'
      : f.i < peakI ? 'intensifying' : 'decay';
  }
  fs.writeFileSync(framesPath, JSON.stringify(frames));
  fs.writeFileSync(path.join(OUT, 'life.json'), JSON.stringify(frames.map(({ near, far, ...rest }) => rest), null, 1));
}
console.log('frames', frames.length, frames.map(f => f.stage[0]).join(''));

// 3 park at touchdown, for the lab window's air
const park = startRun();
while (park.hour() < target.touchH - 1e-6) park.tick();
console.log('parked at', park.hour().toFixed(2));

// serving
const id = target.id, key = id + '~engine';
let cur = Number(process.env.START_I ?? Math.max(0, frames.findIndex(f => f.stage === 'mature')));
let seq = Math.floor(Date.now() / 1000);
let near, far;
// (the clock runs at the game's 8x from the moment's hour, as torserve4's: the storm stays as recorded)
let loadedAt = Date.now();
const simHour = () => frames[cur].hour + ((Date.now() - loadedAt) / 1000) * 8 / 3600;
function load(i) {
  cur = Math.max(0, Math.min(frames.length - 1, i));
  near = Buffer.from(frames[cur].near, 'base64');
  far = Buffer.from(frames[cur].far, 'base64');
  seq++;
  loadedAt = Date.now();
  console.log('serving', cur, frames[cur].stage, frames[cur].hour.toFixed(2), JSON.stringify(frames[cur].tor));
}
load(cur);
// held in one place, where the test camera looks (SHOW="x,y" map km; VTCam's fixed point by default),
// with the lab window asked for the same offset from the storm's real place: its own air around it
const [sx0, sy0] = String(process.env.SHOW ?? '234.1,118.3').split(',').map(Number);
const shown = { x: sx0, y: sy0 };
let lastPlayer = null;
const u8 = v => Uint8Array.of(v), u16 = v => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; }, u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
const f32s = (...v) => { const b = Buffer.alloc(4 * v.length); v.forEach((x, k) => b.writeFloatLE(x, 4 * k)); return b; };
const idB = t => { const b = Buffer.from(t); return [u8(b.length), b]; };
const summary = f => { const { near, far, ...rest } = f; return rest; };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (type, body) => { res.writeHead(200, { 'content-type': type }); res.end(body); };
  const json = v => send('application/json', JSON.stringify(v));
  if (url.pathname === '/life') return json(frames.map(f => ({ i: f.i, hour: f.hour, stage: f.stage, ...f.tor })));
  if (url.pathname === '/life/now') return json(summary(frames[cur]));
  // the storm at a bearing (deg from north, toward the storm) and distance (km) from the player, for the
  // capture camera standing at the player (the terrain is only built round the player)
  if (url.pathname === '/life/place') {
    if (!lastPlayer) return json({ error: 'no player yet' });
    const b = (Number(url.searchParams.get('bearing') ?? 0) * Math.PI) / 180, k = Number(url.searchParams.get('km') ?? 4);
    shown.x = lastPlayer[0] + k * Math.sin(b);
    shown.y = lastPlayer[1] - k * Math.cos(b); // (map y runs south)
    shown.atPlayer = true;
    seq++;
    console.log('storm placed at km', shown.x.toFixed(2), shown.y.toFixed(2));
    return json({ x: shown.x, y: shown.y });
  }
  if (url.pathname === '/life/next') { load(cur + 1); return json(summary(frames[cur])); }
  if (url.pathname === '/life/prev') { load(cur - 1); return json(summary(frames[cur])); }
  if (url.pathname === '/life/goto') {
    const st = url.searchParams.get('stage');
    load(st ? Math.max(0, frames.findIndex(f => f.stage === st)) : Number(url.searchParams.get('i') ?? cur));
    return json(summary(frames[cur]));
  }
  const fr = frames[cur];
  if (url.pathname === '/api/game/v1/storm/players') {
    let body = '';
    for await (const c of req) body += c;
    // AT_PLAYER=1: hold the storm AT_KM (4) north-north-west of the first player, as torserve4 (the game
    // draws storms only near a player)
    try {
      const p = JSON.parse(body).players?.[0];
      if (p && String(p) !== String(lastPlayer)) { lastPlayer = p; console.log('player at km', p.slice(0, 2).map(v => v.toFixed(1)).join(',')); }
      // (set once, from the first report: the capture camera moves the player round the storm)
      if (process.env.AT_PLAYER === '1' && p && !shown.atPlayer) { const k = Number(process.env.AT_KM ?? 4); shown.x = p[0] + 0.833 - k * 0.2; shown.y = p[1] - 0.416 - k; shown.atPlayer = true; console.log('storm held at km', shown.x.toFixed(2), shown.y.toFixed(2)); }
    } catch { /* (no body) */ }
    return json({ detailed: [{ id: key, nest: true, seq, warming: false }] });
  }
  if (url.pathname === '/api/game/v1/storm/frames') {
    const have = new Map(String(url.searchParams.get('have') ?? '').split(',').map(x => [x.slice(0, x.lastIndexOf(':')), Number(x.slice(x.lastIndexOf(':') + 1))]));
    const fresh = (have.get(key) ?? 0) < seq;
    const chunks = fresh ? [...idB(key), u32(seq), u8(2), u32(0), u32(near.length), near, u32(far.length), far] : [];
    const tail = Buffer.alloc(17); tail.writeDoubleLE(simHour()); tail[8] = 0; tail.writeDoubleLE(Date.now(), 9);
    const v = fr.look.values.slice(); v[0] += shown.x - fr.pos[0]; v[1] += shown.y - fr.pos[1];
    return send('application/octet-stream', Buffer.concat([u8(5), u16(fresh ? 1 : 0), ...chunks, u16(1), ...idB(key), u8(0), f32s(shown.x, shown.y, 0, 0, ...fr.lightning), u8(1 | (fr.look.leftMover ? 2 : 0)), f32s(...v), tail]));
  }
  if (url.pathname === '/api/game/v1/lab/window') {
    const x = Number(url.searchParams.get('x')) - shown.x + fr.pos[0], y = Number(url.searchParams.get('y')) - shown.y + fr.pos[1];
    return json({ ...park.rt.labWindow(x, y, url.searchParams.get('half') ?? undefined), paused: true });
  }
  if (url.pathname === '/api/game/v1/lab/storms') {
    // the runtime's own records round the storm's real place, moved back by the same offset; the target
    // itself at the held place, still
    const dx = fr.pos[0] - shown.x, dy = fr.pos[1] - shown.y;
    const r = park.rt.labStormsAt(Number(url.searchParams.get('x')) + dx, Number(url.searchParams.get('y')) + dy, url.searchParams.get('half') ?? undefined, url.searchParams.get('inflow') === '1');
    const c = { x: r.centreMapKm.x - dx, y: r.centreMapKm.y - dy };
    for (const st of r.storms ?? []) {
      if (String(st.id) !== id) continue;
      const to = [(shown.x - c.x) * 1000, -(shown.y - c.y) * 1000];
      if (st.tornado?.pos) st.tornado.pos = [st.tornado.pos[0] + to[0] - st.pos[0], st.tornado.pos[1] + to[1] - st.pos[1]];
      st.pos = to;
      st.motion = [0, 0];
    }
    return json({ ...r, centreMapKm: c, simHourUtc: simHour(), paused: true });
  }
  if (req.method === 'GET' && process.env.PASS) { try { const r = await fetch(process.env.PASS + req.url); res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/octet-stream' }); return res.end(Buffer.from(await r.arrayBuffer())); } catch (e) { res.writeHead(502); return res.end(String(e)); } }
  res.writeHead(404); res.end();
}).listen(Number(process.env.PORT ?? 3029), () => console.log('serving on ' + (process.env.PORT ?? 3029)));

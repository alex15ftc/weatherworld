// Day replays: what a day's pages showed, kept so the day can be played again from its summary (days.html).
// For each convective day (12Z to 12Z) of this world it gathers, as the day runs:
//   mesoanalysis   the surface analysis and every overlay field, each whole hour (SurfaceAnalysisRuntime.js)
//   synoptic       the whole large-scale model, each whole hour (SynopticRuntime.js)
//   warnings       every warning issued, with its polygon and bulletin (ProductArchive.js keeps only 3 hours)
//   radar map      the whole map's composite reflectivity (the radar page's 1 km mosaic) every 10 minutes, for
//                  the warnings replay: taken on the storm tick that begins each 10 minutes, kept deflated
//   tornado radar  for each tornado, the nearest radar's lowest scan at its finest gates, cut to a box around
//                  the storm, every storm tick from a few ticks before touchdown to a few after it lifts
// A day is a file (replays/<world>-<day>.bin.gz beside the world's state), written each world hour and when the
// day ends; the day under way is also held in memory. Replays are let go after REPLAY.keepDays world days
// (two real days): a saved day summary outlives its replay. The frames are the ones the live pages' runtimes
// have already worked out, so keeping them costs the engine nothing to speak of.
//
// The tornado radar is the one part with work of its own: about two seconds of a radar thread for each scan
// kept (measured 2026-11-12). It is kept off the live game's path in two steps:
//   recorded  on each storm tick, what a storm's radar picture is made from is copied (a few KB) for a storm that
//             has a tornado or may produce one; nothing is scanned then. When a tornado touches down the ticks
//             before it, each tick on the ground and a few after go on the day's waiting list (kept in its file,
//             so a restart carries on with it).
//   scanned   later, one at a time, as work that can wait on the radar's threads (RadarPool.js, low): only while
//             nothing live is waiting and another thread stays free. A tornado's loop is therefore ready some
//             minutes after it lifts, later on a busy day; the day's summary says how many scans are still to come.
// WEATHER_TORNADO_RADAR=off leaves the tornado radar out; so does running without radar threads.
//
// The radar map costs one composite mosaic every 10 world minutes (about 75 real seconds at the 8x clock): ~1-1.5 s
// on the radar threads, nothing when the radar page has already asked for that scan time. Each frame is the 648 KB
// grid deflated (4-70 KB); it is sent still deflated and the page inflates it. A frame missed (the engine catching
// up several ticks at once) is a gap; the page shows the last frame up to 15 minutes old.
// WEATHER_REPLAY_RADAR=off leaves it out; so does running without radar threads (a mosaic on this thread takes seconds).
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import zlib from 'node:zlib';
import { convectiveDay } from '../js/reports/stormLog.js';
import { RADAR_FINE_GATE_KM, RADAR_RADIALS, RADAR_RANGE_KM } from '../js/radar/RadarFormat.js';
import { assembleRadarScene } from '../js/radar/RadarSimulator.js';
import { rainFieldInputs } from '../js/storms/StormRainFields.js';
import { stormToSend } from './RadarPool.js';
import { radarSitesFor } from './RadarSites.js';
import { MESOANALYSIS_PARAMETERS } from './mesoanalysisParameters.js';

export const REPLAY = Object.freeze({
  keepDays: 16,
  // The tornado radar: a box boxKm across at cellKm, of these products of the 0.5 degree scan.
  boxKm: 40, cellKm: 0.25, tiltDeg: 0.5, products: ['reflectivity', 'stormRelativeVelocity', 'correlationCoefficient'],
  // Scans kept from before touchdown and after the tornado lifts (storm ticks, 5 minutes each).
  beforeTicks: 3, afterTicks: 2,
  // A storm without a tornado has its last ticks kept from this much tornado genesis potential (TornadoEngine.js).
  // On a High Risk day (2026-11-12) the tenth-lowest of 100 touchdowns had 0.2 in the ticks before it.
  candidatePotential: 0.1
});
const SIZE = Math.round(REPLAY.boxKm / REPLAY.cellKm);
const dayStart = day => 12 + 24 * (day - 1);
const deflateRaw = bytes => new Promise((resolve, reject) => zlib.deflateRaw(bytes, { level: 6 }, (error, out) => (error ? reject(error) : resolve(out))));
const gzip = bytes => new Promise((resolve, reject) => zlib.gzip(bytes, { level: 6 }, (error, out) => (error ? reject(error) : resolve(out))));
const round3 = v => Math.round(v * 1000) / 1000;

// A mesoanalysis field as it is kept (its number lists as Float32) and as it is sent (plain lists again).
const packField = field => ({ ...field, values: Float32Array.from(field.values), ...(field.second ? { second: { ...field.second, values: Float32Array.from(field.second.values) } } : {}) });
const unpackField = field => ({ ...field, values: Array.from(field.values, round3), ...(field.second ? { second: { ...field.second, values: Array.from(field.second.values, round3) } } : {}) });

export class ReplayArchive {
  // runtime: the weather authority (worldId, atmosphere, radarPool). surface, synoptic: the runtimes whose
  // frames are kept. archive: ProductArchive (the warnings). dir: where the days' files go (null: memory only).
  constructor({ runtime, surface, synoptic, archive, dir = null, tornadoRadar = process.env.WEATHER_TORNADO_RADAR !== 'off', radarMap = process.env.WEATHER_REPLAY_RADAR !== 'off' }) {
    // (named apart from the methods the pages' answers come from: surface(), tornadoRadar(), radarMap())
    Object.assign(this, { runtime, surfaceRuntime: surface, synopticRuntime: synoptic, archive, dir, radarOn: tornadoRadar, mapOn: radarMap });
    // The radar map: the 10-minute slot last asked for, and what it has cost (frames kept, failed, bytes kept).
    this.mapSlot = null; this.mapCost = { frames: 0, failed: 0, bytes: 0 };
    this.worldId = runtime.worldId; this.current = null; this.loaded = new Map(); this.writing = Promise.resolve(); this.lastFlushHour = null;
    // The tornado radar: the storm tick last read, each storm's last ticks (pending) and state (track), the days
    // that have ended with scans still waiting (finishing), whether the waiting list is being worked through, and
    // what it has cost (ms on this thread to record a tick and to put a scan together; ms from start to end of a scan).
    this.stormHour = null; this.track = new Map(); this.pending = new Map(); this.finishing = new Map(); this.draining = null;
    this.cost = { scans: 0, failed: 0, scanMs: 0, scanMaxMs: 0, mainMs: 0, ticks: 0, tickMs: 0, tickMaxMs: 0 };
  }

  fileOf(day) { return this.dir ? path.join(this.dir, `${String(this.worldId).slice(0, 12)}-${day}.bin.gz`) : null; }
  blank(day) { return { day, startHourUtc: dayStart(day), meso: [], synoptic: [], warnings: new Map(), tornadoes: {}, queue: [], radar: [] }; }

  // The day now being gathered (started, or read back after a restart, when the world enters it).
  today() {
    const hour = this.runtime.engine?.world?.validHourUtc;
    if (!Number.isFinite(hour)) return null;
    if (this.runtime.worldId !== this.worldId) { this.worldId = this.runtime.worldId; this.current = null; this.loaded.clear(); this.finishing.clear(); this.pending.clear(); this.track.clear(); }
    const day = convectiveDay(hour);
    if (this.current?.day !== day) {
      // (a day that ends with scans still waiting stays in hand until they are done; after a restart it is read back)
      const ended = this.current ?? this.read(day - 1);
      if (this.current) this.flush(this.current);
      if (ended?.queue.length) this.finishing.set(ended.day, ended);
      this.current = this.read(day) ?? this.blank(day);
      this.expire(day);
      this.drain();
    }
    return this.current;
  }

  // Call on each atmosphere step: keeps the hour's mesoanalysis and large-scale frames, and the warnings.
  capture() {
    const day = this.today();
    if (!day) return;
    const hour = this.runtime.engine.world.validHourUtc;
    if (Math.abs(hour - Math.round(hour)) < 1e-6) {
      const meso = this.surfaceRuntime?.frames?.find(f => f.hour === hour), large = this.synopticRuntime?.frames?.find(f => f.hour === hour);
      if (meso && !day.meso.some(f => f.hour === hour)) day.meso.push({ hour, analysis: meso.analysis, fields: [...meso.fields].map(([key, field]) => [key, packField(field)]) });
      if (large && !day.synoptic.some(f => f.hour === hour)) day.synoptic.push(large);
    }
    this.warnings();
    this.radarFrame(day);
    if (this.lastFlushHour !== Math.floor(hour)) { this.lastFlushHour = Math.floor(hour); this.flush(day); }
  }

  // Every warning the product archive holds goes to the day it was issued on (the latest word on each).
  warnings() {
    for (const w of this.archive?.warnings?.values() ?? []) {
      if (this.current?.day === convectiveDay(w.issuedHourUtc)) this.current.warnings.set(w.key, w);
    }
  }

  // The whole map's composite reflectivity, once each 10 minutes: on the first storm tick of the slot, after the world
  // has stepped (the radar's cache is then of this tick). It is asked for as the radar page asks, so a scan time the
  // page has already made costs nothing; it is not marked as looked at, so the radar is not made again each tick for it.
  radarFrame(day) {
    const runtime = this.runtime, hour = runtime.atmosphere?.stormEngine?.validHourUtc;
    if (!this.mapOn || !runtime.radarPool || typeof runtime.radarMosaic !== 'function' || !Number.isFinite(hour)) return;
    const slot = Math.floor(hour * 6 + 1e-6);
    if (slot === this.mapSlot || day.radar.some(frame => frame.slot === slot)) return;
    this.mapSlot = slot;
    const wanted = runtime.radarWanted, looked = wanted?.get('mosaic|composite');
    const asked = runtime.radarMosaic('composite');
    if (wanted) { if (looked === undefined) wanted.delete('mosaic|composite'); else wanted.set('mosaic|composite', looked); }
    Promise.resolve(asked)
      .then(async mosaic => {
        // (filed by its own scan time: a cache not yet moved on can hand back an earlier tick's mosaic)
        const at = Math.floor(mosaic?.validHourUtc * 6 + 1e-6);
        if (!mosaic?.bytes || !Number.isFinite(at) || day.radar.some(frame => frame.slot === at)) return;
        const deflated = await deflateRaw(mosaic.bytes);
        if (day.radar.some(frame => frame.slot === at)) return;
        day.radar.push({ slot: at, hourUtc: mosaic.validHourUtc, width: mosaic.width, height: mosaic.height, resKm: mosaic.resKm, deflated });
        day.radar.sort((a, b) => a.slot - b.slot);
        this.mapCost.frames++; this.mapCost.bytes += deflated.length;
        // (a frame that comes in after its day has ended goes into that day's file)
        if (day !== this.current) this.flush(day);
      })
      .catch(error => { this.mapCost.failed++; console.warn('[replays] radar map:', error.message); });
  }

  // Call on each storm tick. Nothing is scanned here: a storm that has a tornado, or may produce one, has what its
  // radar picture is made from copied (a few KB), and its last few ticks are held. When a tornado touches down those
  // ticks, then each tick on the ground and a few after it lifts, go on the day's waiting list.
  tick() {
    const day = this.today(), world = this.runtime.atmosphere, hour = world?.stormEngine?.validHourUtc;
    if (!day || !this.radarOn || !this.runtime.radarPool || !Number.isFinite(hour) || hour === this.stormHour) return;
    this.stormHour = hour;
    const started = performance.now();
    const inputs = rainFieldInputs(world), byId = new Map(inputs.storms.map(input => [input.storm.id, input]));
    const base = { validHourUtc: inputs.validHourUtc, localHour: inputs.localHour, domainWidthKm: inputs.domainWidthKm, domainHeightKm: inputs.domainHeightKm, env: inputs.env, boundaries: inputs.boundaries };
    const freeze = input => structuredClone({ ...input, storm: stormToSend(input.storm) });
    for (const id of this.track.keys()) if (!byId.has(id)) { this.track.delete(id); this.pending.delete(id); }
    let added = 0;
    for (const input of inputs.storms) {
      const storm = input.storm, state = this.track.get(storm.id) ?? { tornado: null, since: 0 };
      let phase = null;
      if (storm.tornado?.onGround) { state.tornado = `${storm.id}-T${storm.tornado.cycleCount ?? 0}`; state.since = 0; phase = 'on'; }
      else if (state.tornado && state.since < REPLAY.afterTicks) { state.since += 1; phase = 'after'; }
      else { state.tornado = null; if ((storm.tornado?.genesisPotential ?? 0) >= REPLAY.candidatePotential) phase = 'candidate'; }
      if (!phase) { this.track.delete(storm.id); this.pending.delete(storm.id); continue; }
      this.track.set(storm.id, state);
      const at = phase === 'on' ? { x: storm.tornado.positionKm.x, y: storm.tornado.positionKm.y } : { x: storm.positionKm.x, y: storm.positionKm.y };
      // (the storms near enough to show in its box are kept with it)
      const others = inputs.storms.filter(other => other !== input && Math.hypot(other.x - at.x, other.y - at.y) <= REPLAY.boxKm).map(freeze);
      const snap = { hour, base, input: freeze(input), others, at, onGround: phase === 'on', windMph: phase === 'on' ? Math.round(storm.tornado.windSpeedMph ?? 0) : 0 };
      const rolling = this.pending.get(storm.id) ?? [];
      this.pending.set(storm.id, rolling);
      const wait = one => { day.queue.push({ snap: one, tornado: state.tornado, stormId: storm.id }); added++; };
      if (phase === 'on') {
        // Touchdown: the ticks before it are wanted now, with this one.
        if (state.started !== state.tornado) { state.started = state.tornado; rolling.slice(-REPLAY.beforeTicks).forEach(wait); rolling.length = 0; }
        wait(snap);
        continue;
      }
      if (phase === 'after') wait(snap);
      rolling.push(snap);
      if (rolling.length > REPLAY.beforeTicks) rolling.splice(0, rolling.length - REPLAY.beforeTicks);
    }
    const ms = performance.now() - started;
    this.cost.ticks++; this.cost.tickMs += ms; this.cost.tickMaxMs = Math.max(this.cost.tickMaxMs, ms);
    if (added) this.drain();
  }

  // Works through the waiting lists, oldest day first, one scan at a time, as work the radar's threads do only
  // when nothing live is waiting. Returns when the lists are empty (the same Promise while it is at work).
  drain() {
    if (this.draining || !this.radarOn || !this.runtime.radarPool) return this.draining ?? Promise.resolve();
    const next = () => [...this.finishing.values(), this.current].find(day => day?.queue.length);
    if (!next()) return Promise.resolve();
    this.draining = (async () => {
      for (let day = next(); day; day = next()) {
        const job = day.queue[0], started = performance.now();
        try { await this.scan(day, job); this.cost.scans++; } catch (error) { this.cost.failed++; console.warn('[replays] tornado radar:', error.message); }
        const ms = performance.now() - started;
        this.cost.scanMs += ms; this.cost.scanMaxMs = Math.max(this.cost.scanMaxMs, ms);
        // (taken off the list only now: a restart in the middle of a scan does it again)
        if (day.queue[0] === job) day.queue.shift();
        // A day that has ended is written once its last scan is in (the day under way is written each hour).
        if (!day.queue.length && day !== this.current) { this.finishing.delete(day.day); this.loaded.delete(day.day); this.flush(day); }
      }
    })().finally(() => { this.draining = null; });
    return this.draining;
  }

  // One kept tick of one storm, scanned by the radar nearest it and its box added to its tornado's scans.
  async scan(day, job) {
    const { snap } = job, pool = this.runtime.radarPool, sites = radarSitesFor(this.runtime.atmosphere);
    const near = sites.map(site => ({ site, km: Math.hypot(site.xKm - snap.at.x, site.yKm - snap.at.y) })).sort((a, b) => a.km - b.km)[0];
    if (!near || near.km > RADAR_RANGE_KM) return;
    const storms = [snap.input, ...snap.others];
    const fields = await Promise.all(storms.map(input => pool.field(input, true)));
    let started = performance.now();
    const scene = assembleRadarScene({ ...snap.base, storms }, fields);
    Object.defineProperty(scene, 'poolId', { value: ++pool.sceneCount });
    this.cost.mainMs += performance.now() - started;
    // (only the radials the box takes, and a margin: a fifth of the work or less; the box is the same)
    const scan = await pool.scan(scene, near.site, REPLAY.tiltDeg, RADAR_FINE_GATE_KM, true, boxRadials(near.site, snap.at));
    started = performance.now();
    const tornado = day.tornadoes[job.tornado] ??= { stormId: job.stormId, site: near.site.id, siteName: near.site.name ?? near.site.id, frames: [] };
    tornado.frames.push({ hourUtc: snap.hour, onGround: snap.onGround, windMph: snap.windMph, xKm: Math.round(snap.at.x * 100) / 100, yKm: Math.round(snap.at.y * 100) / 100, site: near.site.id, packed: pack(boxOf(scan, near.site, snap.at)) });
    this.cost.mainMs += performance.now() - started;
  }

  // What the tornado radar has cost since the engine started, and what is still waiting.
  radarCost() {
    const c = this.cost, r = v => Math.round(v * 10) / 10;
    return { on: Boolean(this.radarOn && this.runtime.radarPool), scans: c.scans, failed: c.failed, waiting: [...this.finishing.values(), this.current].reduce((n, day) => n + (day?.queue.length ?? 0), 0),
      map: { on: Boolean(this.mapOn && this.runtime.radarPool), ...this.mapCost },
      meanScanMs: c.scans ? Math.round(c.scanMs / c.scans) : 0, maxScanMs: Math.round(c.scanMaxMs), mainThreadMsPerScan: c.scans ? r(c.mainMs / c.scans) : 0,
      ticks: c.ticks, meanTickMs: c.ticks ? r(c.tickMs / c.ticks) : 0, maxTickMs: r(c.tickMaxMs), stormsWatched: this.track.size };
  }

  // ---- Files.
  flush(day) {
    const file = this.fileOf(day.day);
    if (!file) return;
    const bytes = v8.serialize({ version: 1, worldId: this.worldId, ...day, warnings: [...day.warnings] });
    // (one write at a time, in order: two at once would share the temporary file, and the older could land last)
    this.writing = this.writing
      .then(() => fs.promises.mkdir(path.dirname(file), { recursive: true }))
      .then(() => gzip(bytes))
      .then(zipped => fs.promises.writeFile(`${file}.tmp`, zipped))
      .then(() => fs.promises.rename(`${file}.tmp`, file))
      .catch(error => console.warn('[replays] not saved:', error.message));
  }

  read(day) {
    const file = this.fileOf(day);
    if (!file || !fs.existsSync(file)) return null;
    try {
      const kept = v8.deserialize(zlib.gunzipSync(fs.readFileSync(file)));
      if (kept.version !== 1 || kept.worldId !== this.worldId) return null;
      return { ...kept, warnings: new Map(kept.warnings), tornadoes: kept.tornadoes ?? {}, queue: kept.queue ?? [], radar: kept.radar ?? [] };
    } catch (error) { console.warn(`[replays] day ${day} unreadable:`, error.message); return null; }
  }

  // Lets go the files of days past keeping, and of other worlds.
  expire(today) {
    for (const day of [...this.loaded.keys()]) if (day <= today - REPLAY.keepDays) this.loaded.delete(day);
    if (!this.dir || !fs.existsSync(this.dir)) return;
    const mine = `${String(this.worldId).slice(0, 12)}-`;
    for (const name of fs.readdirSync(this.dir)) {
      const day = name.startsWith(mine) ? Number(name.slice(mine.length).split('.')[0]) : NaN;
      if (!name.endsWith('.bin.gz') || (Number.isFinite(day) && day > today - REPLAY.keepDays)) continue;
      fs.promises.unlink(path.join(this.dir, name)).catch(() => {});
    }
  }

  // A day's replay: the one under way, or a past day's read from its file (the last two read are held).
  dayOf(day, worldId = this.worldId) {
    day = Number(day);
    this.today();
    if (worldId !== this.worldId || !Number.isFinite(day)) return null;
    if (this.current?.day === day) return this.current;
    if (this.finishing.has(day)) return this.finishing.get(day);
    if (day <= (this.current?.day ?? Infinity) - REPLAY.keepDays) return null;
    if (!this.loaded.has(day)) {
      const read = this.read(day);
      if (!read) return null;
      this.loaded.set(day, read);
      while (this.loaded.size > 2) this.loaded.delete(this.loaded.keys().next().value);
    }
    return this.loaded.get(day);
  }

  // ---- What the pages ask for.
  // What a day's replay holds, and the world hour it is let go at.
  contents(day, worldId) {
    const d = this.dayOf(day, worldId);
    if (!d) return { available: false };
    // (tornadoRadar: the scans ready for each tornado; radarWaiting: those still to be worked out)
    const waiting = {};
    for (const job of d.queue) waiting[job.tornado] = (waiting[job.tornado] ?? 0) + 1;
    return { available: true, day: d.day, expiresHourUtc: dayStart(d.day + REPLAY.keepDays), mesoHours: d.meso.map(f => f.hour), synopticHours: d.synoptic.map(f => f.hour), warnings: d.warnings.size, radarFrames: d.radar.length,
      tornadoRadar: Object.fromEntries(Object.entries(d.tornadoes).map(([id, t]) => [id, t.frames.length])), radarWaiting: waiting };
  }

  // The mesoanalysis page's two answers, from a kept hour (the day's first when none is named).
  surface(day, worldId, hour) {
    const d = this.dayOf(day, worldId), frame = d?.meso.find(f => f.hour === Number(hour)) ?? d?.meso[0];
    if (!frame) return null;
    return { ...frame.analysis, frameHour: frame.hour, latest: false, frames: d.meso.map(f => f.hour), parameters: MESOANALYSIS_PARAMETERS.map(({ key, group, label, unit }) => ({ key, group, label, unit })), replay: true, clockRunning: false };
  }
  parameter(day, worldId, key, hour) {
    const d = this.dayOf(day, worldId), frame = d?.meso.find(f => f.hour === Number(hour)) ?? d?.meso[0], field = frame && new Map(frame.fields).get(key);
    return field ? { ...unpackField(field), frameHour: frame.hour } : null;
  }

  // The large-scale page's two answers, through the live synoptic runtime (the same grid).
  synopticFrame(synoptic, day, worldId, hour) {
    const d = this.dayOf(day, worldId), frame = d?.synoptic.find(f => f.hour === Number(hour)) ?? d?.synoptic[0];
    return frame ? { ...synoptic.describe(frame, d.synoptic.map(f => f.hour), false), replay: true } : null;
  }
  synopticField(synoptic, day, worldId, hour, key) {
    const d = this.dayOf(day, worldId), frame = d?.synoptic.find(f => f.hour === Number(hour)) ?? d?.synoptic[0];
    return frame ? synoptic.fieldOf(frame, key ?? '') : null;
  }

  // The day's warnings, in the order they were issued.
  warningList(day, worldId) {
    const d = this.dayOf(day, worldId);
    if (!d) return null;
    return { startHourUtc: d.startHourUtc, endHourUtc: d.startHourUtc + 24, warnings: [...d.warnings.values()].sort((a, b) => a.issuedHourUtc - b.issuedHourUtc)
      .map(w => ({ key: w.key, id: w.id, type: w.type, title: w.title, label: w.label, pds: Boolean(w.pds), emergency: Boolean(w.emergency), colourKey: w.colourKey, where: w.where, issuedHourUtc: w.issuedHourUtc, validToHourUtc: w.validToHourUtc, rings: w.rings })) };
  }

  // The radar map: its scan times and grid, and (frame given) one frame's bytes, still deflated (raw), as base64.
  radarMap(day, worldId, frame = null) {
    const d = this.dayOf(day, worldId);
    if (!d?.radar.length) return null;
    if (frame === null || frame === undefined || frame === '') {
      const { width, height, resKm } = d.radar.at(-1);
      return { product: 'reflectivity', kind: 'composite', width, height, resKm, frames: d.radar.map(f => f.hourUtc) };
    }
    const one = d.radar[Number(frame)];
    return one ? { frame: Number(frame), hourUtc: one.hourUtc, width: one.width, height: one.height, resKm: one.resKm, deflated: Buffer.from(one.deflated).toString('base64') } : null;
  }

  // One tornado's radar scans: what each shows and where, and (frame given) one scan's products as base64 bytes.
  tornadoRadar(day, worldId, id, frame = null) {
    const d = this.dayOf(day, worldId), t = d?.tornadoes[id];
    if (!t) return null;
    if (frame === null || frame === undefined || frame === '') {
      return { id, site: t.site, siteName: t.siteName, boxKm: REPLAY.boxKm, cellKm: REPLAY.cellKm, size: SIZE, tiltDeg: REPLAY.tiltDeg, products: REPLAY.products,
        waiting: d.queue.filter(job => job.tornado === id).length,
        frames: t.frames.map(({ hourUtc, onGround, windMph, xKm, yKm }) => ({ hourUtc, onGround, windMph, xKm, yKm })) };
    }
    const one = t.frames[Number(frame)];
    return one ? { frame: Number(frame), hourUtc: one.hourUtc, products: Object.fromEntries(Object.entries(unpack(one.packed)).map(([key, bytes]) => [key, Buffer.from(bytes).toString('base64')])) } : null;
  }
}

// A scan's boxes are held deflated (mostly empty air: about a tenth the size), one after another in REPLAY.products' order.
const pack = products => zlib.deflateSync(Buffer.concat(REPLAY.products.map(key => products[key])));
function unpack(packed) { const all = zlib.inflateSync(packed), n = SIZE * SIZE; return Object.fromEntries(REPLAY.products.map((key, k) => [key, all.subarray(k * n, (k + 1) * n)])); }

// The box around a point (km, y south) cut from a scan: each cell takes the gate its centre falls in.
export function boxOf(scan, site, at) {
  const gates = scan.gates, half = REPLAY.boxKm / 2, out = Object.fromEntries(REPLAY.products.map(key => [key, new Uint8Array(SIZE * SIZE)]));
  boxCells(site, at, scan.gateKm, (cell, r, g) => { if (g < gates) for (const key of REPLAY.products) out[key][cell] = scan.products[key][r * gates + g]; });
  return out;
}
// The radials the box's cells fall in (the 0.5 degree scan's fine gates reach the whole range).
export function boxRadials(site, at) {
  const wanted = new Set();
  boxCells(site, at, RADAR_FINE_GATE_KM, (cell, r) => wanted.add(r));
  return [...wanted];
}
// Each cell of the box: its index, and the radial and gate (gateKm long) its centre falls in.
function boxCells(site, at, gateKm, each) {
  const half = REPLAY.boxKm / 2;
  for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
    const dx = at.x - half + (i + 0.5) * REPLAY.cellKm - site.xKm, dy = at.y - half + (j + 0.5) * REPLAY.cellKm - site.yKm;
    const g = Math.floor(Math.hypot(dx, dy) / gateKm);
    // (a gate is at x = site + range sin(az), y = site - range cos(az): north is up the map, y grows south)
    const az = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360, r = Math.min(RADAR_RADIALS - 1, Math.floor(az / (360 / RADAR_RADIALS)));
    each(j * SIZE + i, r, g);
  }
}

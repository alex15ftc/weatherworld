// Day replays: what a day's pages showed, kept so the day can be played again from its summary (days.html).
// For each convective day (12Z to 12Z) of this world it gathers, as the day runs:
//   mesoanalysis   the surface analysis and every overlay field, each whole hour (SurfaceAnalysisRuntime.js)
//   synoptic       the whole large-scale model, each whole hour (SynopticRuntime.js)
//   warnings       every warning issued, with its polygon and bulletin (ProductArchive.js keeps only 3 hours)
//   tornado radar  for each tornado, the nearest radar's lowest scan at its finest gates, cut to a box around
//                  the storm, every storm tick from a few ticks before touchdown to a few after it lifts
// A day is a file (replays/<world>-<day>.bin.gz beside the world's state), written each world hour and when the
// day ends; the day under way is also held in memory. Replays are let go after REPLAY.keepDays world days
// (two real days): a saved day summary outlives its replay.
//
// The tornado radar is the one part that costs the engine anything: about a second of a radar thread for each
// scan kept (measured 2026-11-12). Only tornadoes are scanned. A storm that may produce one (its tornado genesis
// potential at least REPLAY.candidatePotential) has what its radar picture is made from copied each tick, a few KB,
// and those ticks are scanned only if a tornado follows. Scanning every such storm every tick instead cost about
// 9 s of radar thread a tick on a 50-storm day. WEATHER_TORNADO_RADAR=off leaves the tornado radar out.
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import zlib from 'node:zlib';
import { convectiveDay } from '../js/reports/stormLog.js';
import { RADAR_FINE_GATE_KM, RADAR_RADIALS, RADAR_RANGE_KM } from '../js/radar/RadarFormat.js';
import { assembleRadarScene, buildStormEcho, scanRadarTilt } from '../js/radar/RadarSimulator.js';
import { rainFieldInputs } from '../js/storms/StormRainFields.js';
import { stormToSend } from './RadarPool.js';
import { MESOANALYSIS_PARAMETERS } from './mesoanalysisParameters.js';
import { radarSitesFor } from './RadarSites.js';

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
const gzip = bytes => new Promise((resolve, reject) => zlib.gzip(bytes, { level: 6 }, (error, out) => (error ? reject(error) : resolve(out))));
const round3 = v => Math.round(v * 1000) / 1000;

// A mesoanalysis field as it is kept (its number lists as Float32) and as it is sent (plain lists again).
const packField = field => ({ ...field, values: Float32Array.from(field.values), ...(field.second ? { second: { ...field.second, values: Float32Array.from(field.second.values) } } : {}) });
const unpackField = field => ({ ...field, values: Array.from(field.values, round3), ...(field.second ? { second: { ...field.second, values: Array.from(field.second.values, round3) } } : {}) });

export class ReplayArchive {
  // runtime: the weather authority (worldId, atmosphere, radarPool). surface, synoptic: the runtimes whose
  // frames are kept. archive: ProductArchive (the warnings). dir: where the days' files go (null: memory only).
  constructor({ runtime, surface, synoptic, archive, dir = null, tornadoRadar = process.env.WEATHER_TORNADO_RADAR !== 'off' }) {
    // (named apart from the methods the pages' answers come from: surface(), tornadoRadar())
    Object.assign(this, { runtime, surfaceRuntime: surface, synopticRuntime: synoptic, archive, dir, radarOn: tornadoRadar });
    this.worldId = runtime.worldId; this.current = null; this.loaded = new Map(); this.writing = Promise.resolve();
    this.stormHour = null; this.keeping = Promise.resolve(); this.track = new Map(); this.pending = new Map(); this.radarMs = []; this.radarScans = 0; this.lastFlushHour = null;
  }

  fileOf(day) { return this.dir ? path.join(this.dir, `${String(this.worldId).slice(0, 12)}-${day}.bin.gz`) : null; }
  blank(day) { return { day, startHourUtc: dayStart(day), meso: [], synoptic: [], warnings: new Map(), tornadoes: {} }; }

  // The day now being gathered (started, or read back after a restart, when the world enters it).
  today() {
    const hour = this.runtime.engine?.world?.validHourUtc;
    if (!Number.isFinite(hour)) return null;
    if (this.runtime.worldId !== this.worldId) { this.worldId = this.runtime.worldId; this.current = null; this.loaded.clear(); this.pending.clear(); this.track.clear(); }
    const day = convectiveDay(hour);
    if (this.current?.day !== day) {
      // (the day just ended stays in hand: scans of its last tornadoes may still be on their way to it)
      if (this.current) { this.flush(this.current); this.loaded.set(this.current.day, this.current); while (this.loaded.size > 2) this.loaded.delete(this.loaded.keys().next().value); }
      this.current = this.read(day) ?? this.blank(day);
      this.expire(day);
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
    if (this.lastFlushHour !== Math.floor(hour)) { this.lastFlushHour = Math.floor(hour); this.flush(day); }
  }

  // Every warning the product archive holds goes to the day it was issued on (the latest word on each).
  warnings() {
    for (const w of this.archive?.warnings?.values() ?? []) {
      const day = convectiveDay(w.issuedHourUtc), home = this.current?.day === day ? this.current : null;
      if (home) home.warnings.set(w.key, w);
    }
  }

  // Call on each storm tick. Nothing is scanned for a storm that has no tornado: a copy of what its radar picture
  // is made from (a few KB) is kept for its last few ticks instead. When a tornado touches down those ticks are
  // scanned after the fact, then each tick while it is on the ground and a few after it lifts. Everything is read
  // from the world before anything is waited for, and the scans are worked out and kept in tick order.
  tick() {
    const day = this.today(), world = this.runtime.atmosphere, hour = world?.stormEngine?.validHourUtc;
    if (!day || !this.radarOn || !Number.isFinite(hour) || hour === this.stormHour) return this.keeping;
    this.stormHour = hour;
    const inputs = rainFieldInputs(world), byId = new Map(inputs.storms.map(input => [input.storm.id, input]));
    const base = { validHourUtc: inputs.validHourUtc, localHour: inputs.localHour, domainWidthKm: inputs.domainWidthKm, domainHeightKm: inputs.domainHeightKm, env: inputs.env, boundaries: inputs.boundaries };
    const freeze = input => structuredClone({ ...input, storm: stormToSend(input.storm) });
    for (const id of this.track.keys()) if (!byId.has(id)) { this.track.delete(id); this.pending.delete(id); }
    const jobs = [];
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
      if (phase === 'on') {
        // Touchdown: the ticks before it are scanned now, with this one.
        if (state.started !== state.tornado) { state.started = state.tornado; for (const earlier of rolling.slice(-REPLAY.beforeTicks)) jobs.push({ snap: earlier, tornado: state.tornado, stormId: storm.id }); rolling.length = 0; }
        jobs.push({ snap, tornado: state.tornado, stormId: storm.id });
        continue;
      }
      if (phase === 'after') jobs.push({ snap, tornado: state.tornado, stormId: storm.id });
      rolling.push(snap);
      if (rolling.length > REPLAY.beforeTicks) rolling.splice(0, rolling.length - REPLAY.beforeTicks);
    }
    if (!jobs.length) return this.keeping;
    const sites = radarSitesFor(world);
    this.keeping = this.keeping.then(async () => {
      for (const job of jobs) {
        try { await this.scan(day, job, sites); } catch (error) { console.warn('[replays] tornado radar:', error.message); }
      }
      // (a day that has ended since is written again with these scans; the day under way is written each hour)
      if (day !== this.current) this.flush(day);
    });
    return this.keeping;
  }

  // One kept tick of one storm, scanned by the radar nearest it and its box added to its tornado's scans.
  async scan(day, job, sites) {
    const { snap } = job, started = performance.now(), pool = this.runtime.radarPool;
    const near = sites.map(site => ({ site, km: Math.hypot(site.xKm - snap.at.x, site.yKm - snap.at.y) })).sort((a, b) => a.km - b.km)[0];
    if (!near || near.km > RADAR_RANGE_KM) return;
    const storms = [snap.input, ...snap.others];
    const fields = await Promise.all(storms.map(input => (pool ? pool.field(input) : buildStormEcho(input))));
    const scene = assembleRadarScene({ ...snap.base, storms }, fields);
    if (pool) Object.defineProperty(scene, 'poolId', { value: ++pool.sceneCount });
    const scan = pool ? await pool.scan(scene, near.site, REPLAY.tiltDeg, RADAR_FINE_GATE_KM) : scanRadarTilt(scene, near.site, REPLAY.tiltDeg, { gateKm: RADAR_FINE_GATE_KM });
    const tornado = day.tornadoes[job.tornado] ??= { stormId: job.stormId, site: near.site.id, siteName: near.site.name ?? near.site.id, frames: [] };
    tornado.frames.push({ hourUtc: snap.hour, onGround: snap.onGround, windMph: snap.windMph, xKm: Math.round(snap.at.x * 100) / 100, yKm: Math.round(snap.at.y * 100) / 100, site: near.site.id, packed: pack(boxOf(scan, near.site, snap.at)) });
    this.radarMs.push(performance.now() - started); if (this.radarMs.length > 500) this.radarMs.shift();
    this.radarScans += 1;
  }

  // How long the tornado radar has been taking (the last ticks that scanned anything).
  radarCost() {
    const list = this.radarMs, mean = list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
    return { scans: this.radarScans, meanMs: Math.round(mean), maxMs: list.length ? Math.round(Math.max(...list)) : 0, stormsWatched: this.track.size };
  }

  // ---- Files.
  flush(day) {
    const file = this.fileOf(day.day);
    if (!file) return;
    const bytes = v8.serialize({ version: 1, worldId: this.worldId, ...day, warnings: [...day.warnings] });
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
      return { ...kept, warnings: new Map(kept.warnings) };
    } catch (error) { console.warn(`[replays] day ${day} unreadable:`, error.message); return null; }
  }

  // Lets go the files of days past keeping, and of other worlds.
  expire(today) {
    if (!this.dir || !fs.existsSync(this.dir)) return;
    const mine = `${String(this.worldId).slice(0, 12)}-`;
    for (const name of fs.readdirSync(this.dir)) {
      const day = name.startsWith(mine) ? Number(name.slice(mine.length).split('.')[0]) : NaN;
      if (!name.endsWith('.bin.gz') || (Number.isFinite(day) && day > today - REPLAY.keepDays)) continue;
      fs.promises.unlink(path.join(this.dir, name)).catch(() => {});
    }
    for (const day of [...this.loaded.keys()]) if (day <= today - REPLAY.keepDays) this.loaded.delete(day);
  }

  // A day's replay: the one under way, or a past day's read from its file (the last two read are held).
  dayOf(day, worldId = this.worldId) {
    day = Number(day);
    this.today();
    if (worldId !== this.worldId || !Number.isFinite(day)) return null;
    if (this.current?.day === day) return this.current;
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
    return {
      available: true, day: d.day, expiresHourUtc: dayStart(d.day + REPLAY.keepDays), mesoHours: d.meso.map(f => f.hour), synopticHours: d.synoptic.map(f => f.hour), warnings: d.warnings.size,
      tornadoRadar: Object.fromEntries(Object.entries(d.tornadoes).map(([id, t]) => [id, t.frames.length]))
    };
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

  // One tornado's radar scans: what each shows and where, and (frame given) one scan's products as base64 bytes.
  tornadoRadar(day, worldId, id, frame = null) {
    const t = this.dayOf(day, worldId)?.tornadoes[id];
    if (!t) return null;
    if (frame === null || frame === undefined || frame === '') {
      return { id, site: t.site, siteName: t.siteName, boxKm: REPLAY.boxKm, cellKm: REPLAY.cellKm, size: SIZE, tiltDeg: REPLAY.tiltDeg, products: REPLAY.products,
        frames: t.frames.map(({ hourUtc, onGround, windMph, xKm, yKm }) => ({ hourUtc, onGround, windMph, xKm, yKm })) };
    }
    const one = t.frames[Number(frame)];
    return one ? { frame: Number(frame), hourUtc: one.hourUtc, products: Object.fromEntries(Object.entries(one.packed ? unpack(one.packed) : one.products ?? {}).map(([key, bytes]) => [key, Buffer.from(bytes).toString('base64')])) } : null;
  }
}

// A scan's boxes are held deflated (mostly empty air: about a tenth the size), one after another in REPLAY.products' order.
const pack = products => zlib.deflateSync(Buffer.concat(REPLAY.products.map(key => products[key])));
function unpack(packed) { const all = zlib.inflateSync(packed), n = SIZE * SIZE; return Object.fromEntries(REPLAY.products.map((key, k) => [key, all.subarray(k * n, (k + 1) * n)])); }

// The box around a point (km, y south) cut from a scan: each cell takes the gate its centre falls in.
function boxOf(scan, site, at) {
  const gates = scan.gates, gateKm = scan.gateKm, half = REPLAY.boxKm / 2, out = Object.fromEntries(REPLAY.products.map(key => [key, new Uint8Array(SIZE * SIZE)]));
  for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
    const dx = at.x - half + (i + 0.5) * REPLAY.cellKm - site.xKm, dy = at.y - half + (j + 0.5) * REPLAY.cellKm - site.yKm;
    const g = Math.floor(Math.hypot(dx, dy) / gateKm);
    if (g >= gates) continue;
    // (a gate is at x = site + range sin(az), y = site - range cos(az): north is up the map, y grows south)
    const az = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360, r = Math.min(RADAR_RADIALS - 1, Math.floor(az / (360 / RADAR_RADIALS)));
    for (const key of REPLAY.products) out[key][j * SIZE + i] = scan.products[key][r * gates + g];
  }
  return out;
}

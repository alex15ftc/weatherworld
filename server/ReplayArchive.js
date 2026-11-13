// Day replays: what a day's pages showed, kept so the day can be played again from its summary (days.html).
// For each convective day (12Z to 12Z) of this world it gathers, as the day runs:
//   mesoanalysis   the surface analysis and every overlay field, each whole hour (SurfaceAnalysisRuntime.js)
//   synoptic       the whole large-scale model, each whole hour (SynopticRuntime.js)
//   warnings       every warning issued, with its polygon and bulletin (ProductArchive.js keeps only 3 hours)
// A day is a file (replays/<world>-<day>.bin.gz beside the world's state), written each world hour and when the
// day ends; the day under way is also held in memory. Replays are let go after REPLAY.keepDays world days
// (two real days): a saved day summary outlives its replay. Gathering costs the engine nothing to speak of:
// the frames are the ones the live pages' runtimes have already worked out.
//
// (A radar loop of each tornado was built with this and left out for now: branch web/tornado-radar.)
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import zlib from 'node:zlib';
import { convectiveDay } from '../js/reports/stormLog.js';
import { MESOANALYSIS_PARAMETERS } from './mesoanalysisParameters.js';

export const REPLAY = Object.freeze({ keepDays: 16 });
const dayStart = day => 12 + 24 * (day - 1);
const gzip = bytes => new Promise((resolve, reject) => zlib.gzip(bytes, { level: 6 }, (error, out) => (error ? reject(error) : resolve(out))));
const round3 = v => Math.round(v * 1000) / 1000;

// A mesoanalysis field as it is kept (its number lists as Float32) and as it is sent (plain lists again).
const packField = field => ({ ...field, values: Float32Array.from(field.values), ...(field.second ? { second: { ...field.second, values: Float32Array.from(field.second.values) } } : {}) });
const unpackField = field => ({ ...field, values: Array.from(field.values, round3), ...(field.second ? { second: { ...field.second, values: Array.from(field.second.values, round3) } } : {}) });

export class ReplayArchive {
  // runtime: the weather authority (its worldId and world). surface, synoptic: the runtimes whose frames are
  // kept. archive: ProductArchive (the warnings). dir: where the days' files go (null: memory only).
  constructor({ runtime, surface, synoptic, archive, dir = null }) {
    // (named apart from the method the mesoanalysis page's answer comes from: surface())
    Object.assign(this, { runtime, surfaceRuntime: surface, synopticRuntime: synoptic, archive, dir });
    this.worldId = runtime.worldId; this.current = null; this.loaded = new Map(); this.writing = Promise.resolve(); this.lastFlushHour = null;
  }

  fileOf(day) { return this.dir ? path.join(this.dir, `${String(this.worldId).slice(0, 12)}-${day}.bin.gz`) : null; }
  blank(day) { return { day, startHourUtc: dayStart(day), meso: [], synoptic: [], warnings: new Map() }; }

  // The day now being gathered (started, or read back after a restart, when the world enters it).
  today() {
    const hour = this.runtime.engine?.world?.validHourUtc;
    if (!Number.isFinite(hour)) return null;
    if (this.runtime.worldId !== this.worldId) { this.worldId = this.runtime.worldId; this.current = null; this.loaded.clear(); }
    const day = convectiveDay(hour);
    if (this.current?.day !== day) {
      if (this.current) this.flush(this.current);
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
      if (this.current?.day === convectiveDay(w.issuedHourUtc)) this.current.warnings.set(w.key, w);
    }
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
      return { ...kept, warnings: new Map(kept.warnings) };
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
    return { available: true, day: d.day, expiresHourUtc: dayStart(d.day + REPLAY.keepDays), mesoHours: d.meso.map(f => f.hour), synopticHours: d.synoptic.map(f => f.hour), warnings: d.warnings.size };
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
}

// The live server's own record of how its outlooks verify (2026-11-14). Every outlook the server issues (OutlookRuntime
// onIssued) is kept, in brief, until its day is over; through the day what happens is captured after each atmosphere step,
// as scripts/outlook-verify.mjs captures it (truth.js captureTruth, hail and wind as the towns report them); at 12Z each
// outlook for the day just ended is scored against what happened from its own start (js/verification/outlookScore.js).
// The scores of the last keepDays days are saved beside the world (file) and served pooled by issue (/api/outlook/scores,
// shown on the performance page). A day whose capture began after an outlook's start (the server was restarted, or the
// world was new) is not scored for that outlook. A new world starts a new record.
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { captureTruth, aggregateTruth } from '../js/verification/truth.js';
import { RISK_RADIUS_MILES } from '../js/forecast/spcOutlookRules.js';
import { WORLD_RISK_ORDER } from '../js/forecast/worldRiskCategories.js';
import { scoreOutlook, summarizeScores } from '../js/verification/outlookScore.js';

const DAY_START_UTC = 12;
const dayEndAfter = hour => { const into = ((((hour - DAY_START_UTC) % 24) + 24) % 24); return hour - into + 24; };

export class OutlookScoreboard {
  // runtime: the WeatherAuthorityRuntime (its engine, worldId and places); file: where the record is saved (null: not saved).
  constructor({ runtime, file = null, keepDays = 60 } = {}) {
    this.runtime = runtime; this.file = file; this.keepDays = keepDays;
    this.worldId = null; this.pending = []; this.scores = []; this.capture = null;
    this.restore();
  }

  // A brief copy of an issued outlook: what scoring needs, nothing else.
  issued(outlook) {
    if (!outlook || !this.sameWorld()) return;
    const brief = {
      day: outlook.day, issuedHourUtc: outlook.issuedHourUtc, validFromHourUtc: outlook.validFromHourUtc, validToHourUtc: outlook.validToHourUtc,
      hazards: outlook.hazards, highest: outlook.highest, width: outlook.width, height: outlook.height,
      category: Uint8Array.from(outlook.category, c => Math.max(0, WORLD_RISK_ORDER.indexOf(c))),
      level: Object.fromEntries(outlook.hazards.map(h => [h, Uint8Array.from(outlook.level[h])])),
      chance: Object.fromEntries(outlook.hazards.map(h => [h, Uint8Array.from(outlook.chance[h], v => Math.max(0, Math.min(100, Math.round(v))))]))
    };
    // A reissue at the same time for the same day replaces the one before.
    this.pending = this.pending.filter(p => !(p.validToHourUtc === brief.validToHourUtc && p.issuedHourUtc === brief.issuedHourUtc));
    this.pending.push(brief);
    this.save();
  }

  // After each atmosphere step of the live world.
  afterStep(world = this.runtime.engine?.world) {
    if (!world || !this.sameWorld()) return;
    const hour = world.validHourUtc;
    if (this.capture && hour >= this.capture.dayEnd - 1e-6) {
      // The step that ends the day belongs to it (as outlook-verify's 48th step does).
      captureTruth(world, this.capture.frames, this.capture.seen, this.capture.initiations, this.runtime.places ?? null);
      this.finishDay(world);
    }
    if (!this.capture) {
      // A day is captured from its start, or from now when the server came up in the middle of it.
      this.capture = { dayEnd: dayEndAfter(hour), from: hour, frames: [], seen: new Set(), initiations: [] };
      return;
    }
    captureTruth(world, this.capture.frames, this.capture.seen, this.capture.initiations, this.runtime.places ?? null);
  }

  finishDay(world) {
    const { dayEnd, from, frames, initiations } = this.capture;
    this.capture = null;
    const map = { width: world.width, height: world.height, cellSizeKm: world.cellSizeKm };
    const due = this.pending.filter(p => Math.abs(p.validToHourUtc - dayEnd) < 1e-6);
    this.pending = this.pending.filter(p => p.validToHourUtc > dayEnd + 1e-6);
    for (const outlook of due) {
      // Only a day captured from the outlook's own start (a step's slack allowed). An outlook issued before its day (the
      // 06Z Day 1, valid from its issue) starts with the day.
      const start = Math.max(outlook.validFromHourUtc, dayEnd - 24);
      if (from > start + 0.5 + 1e-6 || outlook.width !== world.width || outlook.height !== world.height) continue;
      const own = frames.filter(frame => frame.hourUtc > start + 1e-6);
      if (!own.length) continue;
      const truth = aggregateTruth(own, initiations, world.width, world.height, RISK_RADIUS_MILES / world.cellSizeMiles, world.cellSizeMiles);
      try { this.scores.push({ ...scoreOutlook(outlook, truth, map), scoredAtHourUtc: dayEnd }); } catch (error) { console.warn('[outlook scores]', error.message); }
    }
    const oldest = dayEnd - 24 * this.keepDays;
    this.scores = this.scores.filter(s => s.validToHourUtc > oldest);
    this.save();
  }

  // A new world (reset, or another one loaded) starts a new record.
  sameWorld() {
    const id = this.runtime.worldId ?? null;
    if (id === this.worldId) return true;
    this.worldId = id; this.pending = []; this.scores = []; this.capture = null;
    return true;
  }

  // The scores pooled by issue, and the last few days one by one.
  report({ recent = 10 } = {}) {
    this.sameWorld();
    const pending = this.pending.map(p => ({ day: p.day, issuedHourUtc: p.issuedHourUtc, validToHourUtc: p.validToHourUtc, highest: p.highest }));
    const latest = this.scores.slice(-recent * 9).reverse().map(({ day, issuedHourUtc, validToHourUtc, forecast, verified, sameCell }) => ({ day, issuedHourUtc, validToHourUtc, forecast, verified, placesRight: sameCell }));
    return { worldId: this.worldId, days: new Set(this.scores.map(s => s.validToHourUtc)).size, outlooks: this.scores.length, capturingFromHourUtc: this.capture?.from ?? null, summary: summarizeScores(this.scores), latest, pending };
  }

  // Written in the background, one save after another (they share the temporary file).
  save() {
    if (!this.file) return this.saving;
    const bytes = v8.serialize({ version: 1, worldId: this.worldId, pending: this.pending, scores: this.scores });
    this.saving = (this.saving ?? Promise.resolve())
      .then(() => fs.promises.mkdir(path.dirname(this.file), { recursive: true }))
      .then(() => fs.promises.writeFile(`${this.file}.tmp`, bytes))
      .then(() => fs.promises.rename(`${this.file}.tmp`, this.file))
      .catch(error => console.warn('[outlook scores] not saved:', error.message));
    return this.saving;
  }
  flush() { return this.saving ?? Promise.resolve(); }

  restore() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const saved = v8.deserialize(fs.readFileSync(this.file));
      if (saved.version !== 1 || saved.worldId !== (this.runtime.worldId ?? null)) return;
      this.worldId = saved.worldId; this.pending = saved.pending ?? []; this.scores = saved.scores ?? [];
    } catch (error) { console.warn('[outlook scores] not restored:', error.message); }
  }
}

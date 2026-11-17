// The game's real building damage, for the damage surveys (2026-11-17). Every Roblox server loads
// the buildings near a tornado with its wind (roblox BuildingDamageService) and says here what
// broke and which ground it looked at:
//   POST /api/game/v1/damage/report { server, events: [[chunk, n, di, xMi, yMi, dod, quality, hourUtc]],
//        covered: [[chunk, hourUtc]], job?: { id, done } }
// chunk "cx,cz" and n name a building of the world generator (chunk index from map miles: chunkOf);
// di its damage indicator as the game names it (js/reports/damageIndicators.js indicatorOf); dod
// the degree that failed; quality the building's build quality (0-1); positions in map miles (0-500
// east and south from the north-west corner), times in the world's UTC hour.
//
// A survey (js/reports/damageSurvey.js, through ReportsRuntime) takes the buildings a tornado
// damaged (those within its life, near its track) and the ground the game looked at while it was
// down: there its points are the game's own; elsewhere the survey's draws stand in.
//
// The ground nobody had loaded is filled in afterwards: a lifted tornado whose track crosses ground
// not yet looked at is a job (GET /api/game/v1/damage/jobs?server=), leased to one server at a time
// (leaseS); that server plans those chunks' buildings, runs the tornado's wind over them and reports
// them like the rest, with job.done when it is through.
//
// Saved beside the world (file, JSON); what is older than keepHours world hours is let go.
import fs from 'node:fs';
import path from 'node:path';
import { STUDS_PER_MILE } from '../js/worldmap/scale.js';
import { indicatorOf } from '../js/reports/damageIndicators.js';

export const BUILDING_DAMAGE = Object.freeze({
  keepHours: 60,      // world hours kept (the storm log keeps today and yesterday)
  padHours: 0.25,     // a tornado's damage and ground taken this long before and after its life
  reachMi: 1.5,       // buildings taken this far beyond its track's box
  leaseS: 240,        // a job is a server's for this long (real seconds)
  saveEveryS: 60,
  maxEvents: 400,     // in one report
  maxHoursPerChunk: 64
});

// The world generator's chunks (roblox Shared/World/Config: keep equal): design studs a side, and
// the map's half width in miles.
export const CHUNK_STUDS = 256;
export const MAP_HALF_MILES = 250;
export const chunkOf = (x, y) => `${Math.floor((x - MAP_HALF_MILES) * STUDS_PER_MILE / CHUNK_STUDS)},${Math.floor((y - MAP_HALF_MILES) * STUDS_PER_MILE / CHUNK_STUDS)}`;

const SAVE_VERSION = 1;
const finite = v => Number.isFinite(Number(v));

export class BuildingDamageArchive {
  // hourNow(): the world hour now; worldId(): the world's id (a new world starts afresh).
  constructor({ hourNow, worldId = () => null, file = null, params = {} }) {
    this.hourNow = hourNow; this.worldId = worldId; this.file = file;
    this.p = { ...BUILDING_DAMAGE, ...params };
    this.reset(); this.restore();
  }

  reset() {
    this.world = this.worldId();
    this.buildings = new Map();  // "chunk/n" -> { di, x, y, q, events: [[dod, hourUtc]] }
    this.covered = new Map();    // chunk -> [hourUtc, ...]
    this.done = new Set();       // tornado ids whose ground has all been looked at
    this.leases = new Map();     // tornado id -> { server, untilMs }
    this.version = 0; this.dirty = false; this.lastSaveMs = 0; this.saving = null;
  }

  restore() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved.version !== SAVE_VERSION || (saved.worldId ?? null) !== (this.world ?? null)) return;
      this.buildings = new Map(saved.buildings); this.covered = new Map(saved.covered); this.done = new Set(saved.done);
      console.log(`[building-damage] ${this.buildings.size} damaged buildings kept from before the restart`);
    } catch (error) { console.warn('[building-damage] saved damage unreadable:', error.message); }
  }

  save(force = false) {
    if (!this.file || !this.dirty) return this.saving;
    if (!force && Date.now() - this.lastSaveMs < this.p.saveEveryS * 1000) return this.saving;
    if (this.saving) return this.saving;
    this.dirty = false; this.lastSaveMs = Date.now();
    const text = JSON.stringify({ version: SAVE_VERSION, worldId: this.world, buildings: [...this.buildings], covered: [...this.covered], done: [...this.done] });
    this.saving = fs.promises.mkdir(path.dirname(this.file), { recursive: true })
      .then(() => fs.promises.writeFile(`${this.file}.tmp`, text))
      .then(() => fs.promises.rename(`${this.file}.tmp`, this.file))
      .catch(error => console.warn('[building-damage] not saved:', error.message))
      .finally(() => { this.saving = null; });
    return this.saving;
  }

  // What is older than keepHours goes.
  prune() {
    const now = Number(this.hourNow());
    if (!Number.isFinite(now)) return;
    const cut = now - this.p.keepHours;
    for (const [key, b] of this.buildings) { b.events = b.events.filter(e => e[1] >= cut); if (!b.events.length) this.buildings.delete(key); }
    for (const [chunk, hours] of this.covered) { const kept = hours.filter(h => h >= cut); if (kept.length) this.covered.set(chunk, kept); else this.covered.delete(chunk); }
  }

  // A server's report (see the head of the file). Returns what was taken.
  report(server, body = {}) {
    if (this.worldId() !== this.world) this.reset();
    let events = 0, chunks = 0;
    for (const e of (Array.isArray(body.events) ? body.events : []).slice(0, this.p.maxEvents)) {
      const [chunk, n, gameDi, x, y, dod, q, hourUtc] = Array.isArray(e) ? e : [];
      const di = indicatorOf(gameDi);
      if (typeof chunk !== 'string' || !di || ![n, x, y, dod, hourUtc].every(finite)) continue;
      const key = `${chunk}/${Number(n)}`;
      const b = this.buildings.get(key) ?? { di, x: Number(x), y: Number(y), q: Math.min(1, Math.max(0, finite(q) ? Number(q) : 0.5)), events: [] };
      if (!b.events.some(([d]) => d === Number(dod))) { b.events.push([Number(dod), Number(hourUtc)]); events++; }
      this.buildings.set(key, b);
    }
    for (const c of (Array.isArray(body.covered) ? body.covered : []).slice(0, this.p.maxEvents)) {
      const [chunk, hourUtc] = Array.isArray(c) ? c : [];
      if (typeof chunk !== 'string' || !finite(hourUtc)) continue;
      const hours = this.covered.get(chunk) ?? [];
      const h = Math.round(Number(hourUtc) * 20) / 20;
      if (!hours.includes(h)) { hours.push(h); if (hours.length > this.p.maxHoursPerChunk) hours.shift(); chunks++; }
      this.covered.set(chunk, hours);
    }
    const job = body.job;
    if (job && typeof job.id === 'string') {
      if (job.done) { this.done.add(job.id); this.leases.delete(job.id); this.dirty = true; } else this.leases.set(job.id, { server: String(server), untilMs: Date.now() + this.p.leaseS * 1000 });
    }
    if (events || chunks) { this.version++; this.dirty = true; this.prune(); }
    this.save();
    return { events, covered: chunks };
  }

  // A logged tornado's life (world hours) and its track in map miles.
  static life(entry, milesPerKm) {
    const pts = entry.points ?? [];
    const track = pts.map(([x, y, hourUtc, mph, yards]) => [x * milesPerKm, y * milesPerKm, hourUtc, mph, yards]);
    return { from: pts[0]?.[2] ?? 0, to: pts.at(-1)?.[2] ?? 0, track };
  }

  // The game's buildings and ground for a tornado's survey: { buildings, covered(x, y) }, or null
  // when the game reported nothing in its time.
  realFor(entry, milesPerKm) {
    const { from, to, track } = BuildingDamageArchive.life(entry, milesPerKm);
    if (!track.length) return null;
    const lo = from - this.p.padHours, hi = to + this.p.padHours, r = this.p.reachMi;
    const x0 = Math.min(...track.map(p => p[0])) - r, x1 = Math.max(...track.map(p => p[0])) + r;
    const y0 = Math.min(...track.map(p => p[1])) - r, y1 = Math.max(...track.map(p => p[1])) + r;
    const buildings = [];
    for (const b of this.buildings.values()) {
      if (b.x < x0 || b.x > x1 || b.y < y0 || b.y > y1) continue;
      const within = b.events.filter(([, h]) => h >= lo && h <= hi);
      if (within.length) buildings.push({ di: b.di, x: b.x, y: b.y, quality: b.q, dod: Math.max(...within.map(e => e[0])), hourUtc: within.find(e => e[0] === Math.max(...within.map(w => w[0])))[1] });
    }
    const seen = new Map();
    const covered = (x, y) => {
      const chunk = chunkOf(x, y);
      if (!seen.has(chunk)) seen.set(chunk, (this.covered.get(chunk) ?? []).some(h => h >= lo && h <= hi));
      return seen.get(chunk);
    };
    let any = buildings.length > 0;
    if (!any) for (const p of track) if (covered(p[0], p[1])) { any = true; break; }
    return any || this.done.has(entry.id) ? { buildings, covered } : null;
  }

  // A number that changes when what the game reported for a tornado may have (for the survey cache).
  versionFor() { return this.version; }

  // The next lifted tornado whose ground is not all looked at, for this server (or null):
  // candidates are logged entries, newest first.
  job(server, candidates, milesPerKm) {
    if (this.worldId() !== this.world) this.reset();
    const now = Date.now(), id = String(server ?? 'default').slice(0, 64);
    for (const entry of candidates) {
      if (!entry.ended || !entry.points?.length || this.done.has(entry.id)) continue;
      const lease = this.leases.get(entry.id);
      if (lease && lease.untilMs > now && lease.server !== id) continue;
      this.leases.set(entry.id, { server: id, untilMs: now + this.p.leaseS * 1000 });
      const { from, to, track } = BuildingDamageArchive.life(entry, milesPerKm);
      // (the ground already looked at in its time, near its track: the server skips it. The server
      // reports what it looks at as of the tornado's start, so it counts for this tornado alone.)
      const lo = from - this.p.padHours, hi = to + this.p.padHours, r = this.p.reachMi;
      const x0 = Math.min(...track.map(p => p[0])) - r, x1 = Math.max(...track.map(p => p[0])) + r;
      const y0 = Math.min(...track.map(p => p[1])) - r, y1 = Math.max(...track.map(p => p[1])) + r;
      const covered = [];
      for (const [chunk, hours] of this.covered) {
        const [cx, cz] = chunk.split(',').map(Number), mx = (cx + 0.5) * CHUNK_STUDS / STUDS_PER_MILE + MAP_HALF_MILES, my = (cz + 0.5) * CHUNK_STUDS / STUDS_PER_MILE + MAP_HALF_MILES;
        if (mx >= x0 && mx <= x1 && my >= y0 && my <= y1 && hours.some(h => h >= lo && h <= hi)) covered.push(chunk);
      }
      return { id: entry.id, day: entry.day, startHourUtc: from, endHourUtc: to, track: track.map(p => p.map(v => Math.round(v * 1000) / 1000)), covered };
    }
    return null;
  }

  status() { return { buildings: this.buildings.size, chunks: this.covered.size, done: this.done.size, leases: this.leases.size }; }
}

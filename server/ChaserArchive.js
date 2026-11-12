// The chaser network: where every player in every Roblox server is, now and through each world day.
// The game servers already say where their players are every few seconds (LiveStormsService ->
// POST /api/game/v1/storm/players, world km, y south); each player there is [xKm, yKm, userId,
// displayName, username]. This keeps the latest list of each server (live) and one point per player
// every sampleS of real time, kept by world day (00-24 UTC of the world's clock, "11/11/26 Day 3"),
// for the day loops. Saved beside the world (file); the newest keepDays world days are kept.
//
// One page, /chasers (chasers.html), and one set of endpoints (/api/chasers/role, live, days,
// day?day=N); every answer is the view of the asker's role (roleOf):
//   public   dots only: no names, ids or servers; a day's tracks under a number new every day
//   admin    names, user ids and servers, for exploit checks (WEATHER_ADMIN_KEY in x-admin-key)
//
// Points are in map miles (0-500 east and south from the north-west corner), as the products are.
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import crypto from 'node:crypto';
import { dateText } from '../js/forecast/calendar.js';

export const CHASERS = Object.freeze({
  sampleS: 15,          // one point per player this often (real seconds; 2 world minutes at 8x)
  liveTtlS: 30,         // a server not heard from this long has no live players
  keepDays: 24,         // world days kept (3 real days)
  maxPlayersPerServer: 200,
  maxPointsPerTrack: 2000,
  saveEveryS: 60
});

const SAVE_VERSION = 1;
const r2 = v => Math.round(v * 100) / 100;
const shortServer = id => (id === 'studio' ? 'studio' : String(id).slice(0, 8));

export class ChaserArchive {
  // runtime: the weather authority (worldId, the world's hour). milesPerKm(): map miles in a world km.
  // hourNow(): the world hour now (fractional). file: where the tracks are saved.
  constructor({ runtime, milesPerKm, hourNow, file = null, params = {} }) {
    this.runtime = runtime; this.milesPerKm = milesPerKm; this.hourNow = hourNow; this.file = file;
    this.p = { ...CHASERS, ...params };
    this.servers = new Map();     // server id -> { at, list: [{ x, y, userId, name, user }] }
    this.reset(); this.restore();
    this.lastSaveMs = Date.now();
  }

  reset() {
    this.worldId = this.runtime.worldId;
    this.days = new Map();        // world day index -> { day, servers: [ids], tracks: Map(userId -> track) }
    this.dirty = false;
  }

  restore() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const saved = v8.deserialize(fs.readFileSync(this.file));
      if (saved.version !== SAVE_VERSION || saved.worldId !== this.runtime.worldId) return;
      for (const d of saved.days) this.days.set(d.day, { day: d.day, salt: d.salt, servers: d.servers, tracks: new Map(d.tracks.map(t => [t.userId, t])) });
      console.log(`[chasers] ${this.days.size} days of chaser tracks kept from before the restart`);
    } catch (error) { console.warn('[chasers] saved tracks unreadable:', error.message); }
  }

  save(force = false) {
    if (!this.file || !this.dirty) return this.saving;
    if (!force && Date.now() - this.lastSaveMs < this.p.saveEveryS * 1000) return this.saving;
    // (one write at a time: a save asked for during one goes after it)
    if (this.saving) { this.saveQueued = true; return this.saving; }
    this.dirty = false; this.lastSaveMs = Date.now();
    const days = [...this.days.values()].map(d => ({ day: d.day, salt: d.salt, servers: d.servers, tracks: [...d.tracks.values()] }));
    const bytes = v8.serialize({ version: SAVE_VERSION, worldId: this.worldId, days });
    this.saving = fs.promises.mkdir(path.dirname(this.file), { recursive: true })
      .then(() => fs.promises.writeFile(`${this.file}.tmp`, bytes))
      .then(() => fs.promises.rename(`${this.file}.tmp`, this.file))
      .catch(error => console.warn('[chasers] not saved:', error.message))
      .finally(() => { this.saving = null; if (this.saveQueued) { this.saveQueued = false; this.dirty = true; return this.save(true); } });
    return this.saving;
  }

  // A server's report: players as the game sends them ([xKm, yKm, userId?, displayName?, username?]).
  report(server, players, nowMs = Date.now()) {
    if (this.runtime.worldId !== this.worldId) { this.reset(); this.dirty = true; }
    const id = String(server ?? 'default').slice(0, 64), k = this.milesPerKm();
    const list = (Array.isArray(players) ? players : []).slice(0, this.p.maxPlayersPerServer)
      .filter(q => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1]))
      .map(q => ({ x: r2(q[0] * k), y: r2(q[1] * k), userId: q[2] != null ? String(q[2]).slice(0, 20) : null, name: typeof q[3] === 'string' ? q[3].slice(0, 40) : null, user: typeof q[4] === 'string' ? q[4].slice(0, 40) : null }));
    this.servers.set(id, { at: nowMs, list });
    // (Studio test servers are live on the admin page only, and leave no tracks.)
    if (id !== 'studio') this.record(id, list, nowMs);
    this.save();
  }

  record(server, list, nowMs) {
    const hour = this.hourNow();
    if (!Number.isFinite(hour)) return;
    const dayIndex = Math.floor(hour / 24), t = r2((hour - dayIndex * 24) * 60);   // minutes into the world day
    let day = this.days.get(dayIndex);
    if (!day) {
      day = { day: dayIndex, salt: crypto.randomBytes(8).toString('hex'), servers: [], tracks: new Map() };
      this.days.set(dayIndex, day);
      const old = [...this.days.keys()].sort((a, b) => a - b);
      while (old.length > this.p.keepDays) this.days.delete(old.shift());
    }
    let s = day.servers.indexOf(server);
    if (s < 0) { s = day.servers.length; day.servers.push(server); }
    for (const q of list) {
      if (!q.userId) continue;
      let track = day.tracks.get(q.userId);
      if (!track) { track = { userId: q.userId, name: q.name, user: q.user, lastMs: 0, points: [] }; day.tracks.set(q.userId, track); }
      if (nowMs - track.lastMs < this.p.sampleS * 1000 - 500) continue;
      if (track.points.length >= this.p.maxPointsPerTrack * 4) continue;
      track.lastMs = nowMs; track.name = q.name ?? track.name; track.user = q.user ?? track.user;
      track.points.push(t, q.x, q.y, s);
      this.dirty = true;
    }
  }

  // Every player heard from in the last liveTtlS, with its server.
  livePlayers(nowMs = Date.now()) {
    const out = [];
    for (const [server, entry] of this.servers) {
      if (nowMs - entry.at > this.p.liveTtlS * 1000) { this.servers.delete(server); continue; }
      for (const q of entry.list) out.push({ ...q, server });
    }
    return out;
  }

  dayInfo(d) { return { day: d.day, label: dateText(d.day * 24), startHourUtc: d.day * 24, chasers: d.tracks.size }; }

  // The days held, newest first, and the current one.
  dayList() {
    const hour = this.hourNow();
    return { currentDay: Number.isFinite(hour) ? Math.floor(hour / 24) : null, days: [...this.days.values()].sort((a, b) => b.day - a.day).map(d => this.dayInfo(d)) };
  }

  // Public: dots only. Their order says nothing (sorted west to east).
  publicLive(nowMs = Date.now()) {
    const dots = this.livePlayers(nowMs).filter(q => q.server !== 'studio').map(q => [q.x, q.y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return { hourUtc: this.hourNow(), count: dots.length, dots };
  }

  adminLive(nowMs = Date.now()) {
    const list = this.livePlayers(nowMs);
    const servers = [...new Set(list.map(q => q.server))];
    return { hourUtc: this.hourNow(), count: list.length, servers: servers.map(shortServer),
      players: list.map(q => ({ x: q.x, y: q.y, userId: q.userId, name: q.name, user: q.user, server: servers.indexOf(q.server) })) };
  }

  // One day's tracks: points [minute, x, y, server, ...]. Public: no ids, names or servers; each
  // track numbered by a hash that is new every day, so a dot cannot be followed from day to day.
  dayTracks(dayIndex, { admin = false } = {}) {
    const d = this.days.get(Number(dayIndex));
    if (!d) return null;
    const tracks = [...d.tracks.values()].map(t => (admin
      ? { userId: t.userId, name: t.name, user: t.user, points: t.points }
      : { id: crypto.createHash('sha1').update(`${d.salt}:${t.userId}`).digest('hex').slice(0, 6), points: t.points.filter((_, k) => k % 4 !== 3) }));
    if (!admin) tracks.sort((a, b) => (a.id < b.id ? -1 : 1));
    return { ...this.dayInfo(d), stride: admin ? 4 : 3, servers: admin ? d.servers.map(shortServer) : undefined, tracks };
  }
}

// Whether a request may see the admin views: the WEATHER_ADMIN_KEY in x-admin-key, or, with no key
// set (a local engine), a request from this machine.
export function roleOf(req) { return isAdmin(req) ? 'admin' : 'public'; }
export function isAdmin(req) {
  const key = process.env.WEATHER_ADMIN_KEY;
  if (!key) return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
  const given = Buffer.from(String(req.headers['x-admin-key'] ?? '')), want = Buffer.from(key);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

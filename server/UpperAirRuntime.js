// Upper-air soundings for the public: a sparse network of the surface stations (SurfaceAnalysisRuntime.js) also
// sends up a weather balloon at each release hour (06Z), as a real upper-air network does twice a day. The
// sounding each site measured is kept until the next release and anyone can read it on the mesoanalysis page;
// a sounding at any point and at any time stays an admin's (/api/live/sounding).
//
// A release is taken on the first atmosphere step at or after its hour (the steps are half an hour), from the
// column of the cell the site stands in, and is never taken late: a world moved past a release by more than an
// hour (a restart, an admin's +1 day) skips it and the page keeps the one before. The newest and the one before
// it are kept, in a small file beside the world's state, so a deploy does not lose the morning's soundings.
import fs from 'node:fs';
import path from 'node:path';

export const UPPER_AIR = {
  releaseHoursUtc: [6],   // the hours balloons go up (UTC); [0, 12] would be the real network's
  siteSpacingKm: 200,     // the least distance between two sites: about a dozen on the 805 km map (real sites are
                          // 300-500 km apart, which would leave five)
  lateHours: 1,           // a release is taken this long after its hour at most
  kept: 2                 // releases kept: the newest and the one before it
};

export class UpperAirRuntime {
  // surface: the SurfaceAnalysisRuntime (its stations and world). soundingAt(row, column): the full sounding
  // the live sounding endpoint answers. worldId(): the world's identity. file: where releases are kept (null: memory).
  constructor({ surface, soundingAt, worldId = () => surface.seed, file = null }) {
    this.surface = surface; this.soundingAt = soundingAt; this.worldId = worldId; this.file = file;
    this.world = null; this.releases = [];
    this.load();
  }

  // The sites: stations far enough apart, taken in the network's own (seeded, scattered) order.
  sites() {
    if (this.siteKey !== this.surface.stations) {
      const sites = [];
      for (const station of this.surface.stations) if (sites.every(s => Math.hypot(s.xKm - station.xKm, s.yKm - station.yKm) >= UPPER_AIR.siteSpacingKm)) sites.push(station);
      this.siteList = sites; this.siteKey = this.surface.stations;
    }
    return this.siteList;
  }

  // The newest release hour at or before `hours` (absolute world hours).
  static releaseBefore(hours) {
    let best = -Infinity;
    for (const day of [Math.floor(hours / 24), Math.floor(hours / 24) - 1]) for (const h of UPPER_AIR.releaseHoursUtc) { const t = day * 24 + h; if (t <= hours + 1e-6 && t > best) best = t; }
    return best;
  }

  // Call on each atmosphere step (the server does, beside the surface analysis). Takes a release when one is due.
  capture() {
    const id = String(this.worldId());
    if (this.world !== id) { this.world = id; this.releases = []; }
    const hours = this.surface.regional.hourUtc, due = UpperAirRuntime.releaseBefore(hours);
    if (hours - due >= UPPER_AIR.lateHours || this.releases.some(r => r.hourUtc >= due)) return false;
    const { cellSizeKm, width, height } = this.surface.regional.world, soundings = {};
    for (const site of this.sites()) {
      const row = Math.max(0, Math.min(height - 1, Math.floor(site.yKm / cellSizeKm))), column = Math.max(0, Math.min(width - 1, Math.floor(site.xKm / cellSizeKm)));
      const sounding = this.soundingAt(row, column);
      if (!sounding) continue;
      // (the cell's outlook and forcing are left out: the public gets what a balloon measures)
      const { context, ...rest } = sounding;
      soundings[site.id] = { ...rest, site: site.id, context: { surface: context?.surface ?? null } };
    }
    this.releases = [...this.releases, { hourUtc: due, takenHourUtc: hours, soundings }].slice(-UPPER_AIR.kept);
    this.save();
    return true;
  }

  // What the page lists: the sites and the releases kept (newest first).
  summary() {
    return {
      releaseHoursUtc: UPPER_AIR.releaseHoursUtc, hourUtc: this.surface.regional.hourUtc,
      sites: this.sites().map(({ id, xKm, yKm }) => ({ id, xKm, yKm })),
      releases: this.releases.map(r => ({ hourUtc: r.hourUtc, sites: Object.keys(r.soundings) })).reverse(),
      nextReleaseHourUtc: UpperAirRuntime.releaseBefore(this.surface.regional.hourUtc) + nextGap(this.surface.regional.hourUtc)
    };
  }

  // One site's sounding of a release (the newest when none is named), or null.
  sounding(site, hourUtc) {
    const release = hourUtc === undefined || hourUtc === null || hourUtc === '' ? this.releases.at(-1) : this.releases.find(r => r.hourUtc === Number(hourUtc));
    return release?.soundings[site] ?? null;
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try { const saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); this.world = saved.world; this.releases = saved.releases ?? []; } catch (error) { console.warn('[upper-air]', error.message); }
  }

  save() {
    if (!this.file) return;
    const text = JSON.stringify({ world: this.world, releases: this.releases }), file = this.file;
    fs.promises.mkdir(path.dirname(file), { recursive: true }).then(() => fs.promises.writeFile(`${file}.tmp`, text)).then(() => fs.promises.rename(`${file}.tmp`, file)).catch(error => console.warn('[upper-air]', error.message));
  }
}

// Hours from the newest release before `hours` to the one after it.
function nextGap(hours) {
  const hoursOfDay = [...UPPER_AIR.releaseHoursUtc].sort((a, b) => a - b), now = UpperAirRuntime.releaseBefore(hours), h = ((now % 24) + 24) % 24;
  const next = hoursOfDay.find(x => x > h + 1e-6);
  return next === undefined ? 24 - h + hoursOfDay[0] : next - h;
}

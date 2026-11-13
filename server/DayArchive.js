// Day summaries: a convective day's forecast and what happened, for the day pages (days.html) and for posts.
// A day runs 12Z to 12Z (js/reports/stormLog.js). For each day this keeps the Day 1 outlook of that day with
// the highest risk (the earliest issue of it) as the issues come out, and counts the warnings issued; the
// tornado tracks and their ratings come from the world's storm log and its damage surveys (ReportsRuntime.js),
// the watches from the product archive (ProductArchive.js).
//
// The log and the outlook issues are let go after about two weeks, so a summary lasts only if an admin saves
// it: a saved summary is a copy of everything its page and maps need, kept for good (in days.bin, beside the
// world's state; a new world keeps the old world's saved days). The public sees only saved days; an admin
// also sees the recent days and can save or remove them.
//
// GET  /api/days                     the saved days; for an admin, the recent days as well
// GET  /api/day/<id>                 one summary: a saved day's id, or, for an admin, live-<day number>
// GET  /api/day/<id>/map.svg         its maps: ?kind=outlook (&hazard=categorical|tornado|wind|hail|severe) or tracks
// POST /api/day/<id>/save            admin: keep the live day <id> = live-<n>
// POST /api/day/<id>/remove          admin: let a saved day go
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { convectiveDay } from '../js/reports/stormLog.js';
import { dateText, utcStamp, worldDate } from '../js/forecast/calendar.js';
import { EF_COLOURS, EFU_COLOUR } from '../js/forecast/productColours.js';
import { outlookSvg, outlookHeadline, localStamp } from './OutlookPublic.js';

const RANK = ['NONE', 'TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'];
const RISK = { NONE: 'No severe risk', TSTM: 'Thunderstorms', MRGN: 'Marginal risk', SLGT: 'Slight risk', ENH: 'Enhanced risk', MDT: 'Moderate risk', HIGH: 'High risk' };
const KEPT_DAYS = 16, KEPT_SAVED = 200;
const dayStart = day => 12 + 24 * (day - 1);
const efOf = rating => { const n = Number(String(rating ?? '').replace(/\D/g, '')); return /\d/.test(String(rating ?? '')) ? n : -1; };

// A track's points (map miles) thinned to about one every least miles, its ends kept: a survey's centreline has
// a point every few hundred feet, far more than a map of the whole day shows.
function thin(points, least = 0.4) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (const p of points.slice(1, -1)) { const q = out.at(-1); if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= least) out.push(p); }
  out.push(points.at(-1));
  return out.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
}

// Whether a point (map miles) is inside rings given as flat lists, by the even-odd rule.
function inside(rings, x, y) {
  let hit = false;
  for (const flat of rings) for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) {
    const xi = flat[i], yi = flat[i + 1], xj = flat[j], yj = flat[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export class DayArchive {
  // runtime: the weather authority. products: GameProducts (the Day 1 outlook). reports: ReportsRuntime (the
  // storm log and surveys). archive: ProductArchive (watches, warnings). layer(): the county layer.
  constructor({ runtime, products, reports, archive, layer, replays = null, file = null }) {
    Object.assign(this, { runtime, products, reports, archive, layer, replays, file });
    this.worldId = runtime.worldId; this.days = new Map(); this.saved = new Map(); this.version = null; this.dirty = false;
    this.restore();
  }

  restore() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const kept = v8.deserialize(fs.readFileSync(this.file));
      if (kept.version !== 1) return;
      this.saved = new Map(kept.saved.map(s => [s.id, s]));
      // (the days being gathered belong to their world; the saved ones are kept whatever the world)
      if (kept.worldId === this.runtime.worldId) this.days = new Map(kept.days.map(d => [d.day, { ...d, warnings: new Map(d.warnings) }]));
      console.log(`[days] ${this.saved.size} saved day summaries and ${this.days.size} recent days kept from before the restart`);
    } catch (error) { console.warn('[days] saved days unreadable:', error.message); }
  }

  save() {
    if (!this.file || !this.dirty) return;
    this.dirty = false;
    const bytes = v8.serialize({ version: 1, worldId: this.worldId, days: [...this.days.values()].map(d => ({ ...d, warnings: [...d.warnings] })), saved: [...this.saved.values()] });
    // (one write at a time, in order: two at once would share the temporary file, and the older could land last)
    this.writing = (this.writing ?? Promise.resolve())
      .then(() => fs.promises.mkdir(path.dirname(this.file), { recursive: true }))
      .then(() => fs.promises.writeFile(`${this.file}.tmp`, bytes))
      .then(() => fs.promises.rename(`${this.file}.tmp`, this.file))
      .catch(error => console.warn('[days] not saved:', error.message));
  }

  record(day) {
    if (!this.days.has(day)) this.days.set(day, { day, startHourUtc: dayStart(day), best: null, issues: [], warnings: new Map() });
    return this.days.get(day);
  }

  // Call often (after the products are issued): takes in a new Day 1 outlook issue and the warnings in the
  // product archive, and lets the oldest days go.
  sync() {
    if (this.runtime.worldId !== this.worldId) { this.worldId = this.runtime.worldId; this.days = new Map(); this.version = null; this.dirty = true; }
    const entry = this.products.product('outlook.day1');
    if (entry && entry.version !== this.version) {
      this.version = entry.version;
      let outlook = null;
      try { outlook = JSON.parse(entry.text); } catch { outlook = null; }
      if (outlook?.status === 'issued') {
        // (the day an outlook is for: the one its valid period ends with)
        const record = this.record(convectiveDay(outlook.validToHourUtc - 1));
        if (!record.issues.some(issue => issue.issuedHourUtc === outlook.issuedHourUtc)) {
          record.issues.push({ issuedHourUtc: outlook.issuedHourUtc, highest: outlook.highest });
          if (!record.best || RANK.indexOf(outlook.highest) > RANK.indexOf(record.best.highest)) record.best = outlook;
          this.dirty = true;
        }
      }
    }
    for (const w of this.archive?.warnings?.values() ?? []) {
      const record = this.record(convectiveDay(w.issuedHourUtc));
      if (!record.warnings.has(w.id)) { record.warnings.set(w.id, w.type); this.dirty = true; }
    }
    const now = this.runtime.engine?.world?.validHourUtc;
    if (Number.isFinite(now)) for (const day of [...this.days.keys()]) if (day <= convectiveDay(now) - KEPT_DAYS) { this.days.delete(day); this.dirty = true; }
    this.save();
  }

  // A live day's summary, worked out now from what is held (null when nothing is known of the day).
  build(day) {
    const record = this.days.get(day), logged = this.reports?.log?.days?.[day];
    if (!record && !logged) return null;
    const start = dayStart(day), end = start + 24, now = this.runtime.engine?.world?.validHourUtc ?? end, product = record?.best ?? null;
    const areas = [...(product?.category ?? [])].sort((a, b) => RANK.indexOf(b.key) - RANK.indexOf(a.key));
    const tornadoes = (logged ? this.reports.damage(day).tornadoes : []).map(t => {
      const first = t.centreline[0] ?? [0, 0];
      return {
        id: t.id, rating: t.rating, ef: efOf(t.rating), peakWindMph: t.peakWindMph ?? null, lengthMi: t.lengthMi, minutes: t.durationMinutes, startHourUtc: t.startHourUtc,
        startPlace: t.startPlace ?? null, endPlace: t.endPlace ?? null, ongoing: Boolean(t.ongoing), track: thin(t.centreline),
        // The survey's damage, by indicator (js/reports/damageSurvey.js), for the tornado's own panel.
        widthYards: t.maxWidthYards ?? null, towns: t.towns ?? [], counties: t.counties ?? [], indicators: (t.indicators ?? []).map(({ di, name, count, maxEf }) => ({ di, name, count, maxEf })),
        category: areas.find(area => inside(area.rings, first[0], first[1]))?.key ?? 'NONE'
      };
    }).sort((a, b) => a.ef - b.ef);
    const highest = product?.highest ?? null, top = highest === 'HIGH' ? ['HIGH', 'MDT'] : highest ? [highest] : [];
    const strong = tornadoes.filter(t => t.ef >= 2), strongest = [...tornadoes].sort((a, b) => b.ef - a.ef || (b.peakWindMph ?? 0) - (a.peakWindMph ?? 0))[0] ?? null;
    const longest = [...tornadoes].sort((a, b) => b.lengthMi - a.lengthMi)[0] ?? null;
    const hail = Math.max(0, ...(logged?.reports ?? []).filter(r => r.type === 'hail').map(r => (r.size ?? 0) / 100));
    const watches = [...(this.archive?.watches?.values() ?? [])].filter(w => w.issuedHourUtc >= start - 1e-6 && w.issuedHourUtc < end)
      .map(w => ({ number: w.number, type: w.type, pds: Boolean(w.pds), where: w.where, issuedHourUtc: w.issuedHourUtc })).sort((a, b) => a.number - b.number);
    const warnings = [...(record?.warnings.values() ?? [])];
    const summaryLine = product?.discussion?.match(/\.\.\.SUMMARY\.\.\.\n([\s\S]*?)(?:\n\n|$)/)?.[1]?.replace(/\n/g, ' ') ?? '';
    return {
      day, label: dateText(start), startHourUtc: start, endHourUtc: end, ended: now >= end, worldId: this.worldId,
      outlook: product ? {
        highest, risk: RISK[highest] ?? highest, issuedHourUtc: product.issuedHourUtc, validFromHourUtc: product.validFromHourUtc, validToHourUtc: product.validToHourUtc,
        issued: `${utcStamp(product.issuedHourUtc)} (${localStamp(product.issuedHourUtc)})`, valid: `${utcStamp(product.validFromHourUtc)} to ${utcStamp(product.validToHourUtc)}`,
        headline: outlookHeadline(product), mainHazards: summaryLine.match(/The main hazards: (.*?)\.(?:\s|$)/)?.[1] ?? null, hazards: product.hazardOrder ?? [],
        issues: (record?.issues ?? []).map(issue => ({ ...issue, risk: RISK[issue.highest] ?? issue.highest, issued: utcStamp(issue.issuedHourUtc) }))
      } : null,
      tornadoes,
      numbers: {
        tornadoes: tornadoes.length, byEf: [0, 1, 2, 3, 4, 5].map(ef => tornadoes.filter(t => t.ef === ef).length), unrated: tornadoes.filter(t => t.ef < 0).length,
        strong: strong.length, violent: tornadoes.filter(t => t.ef >= 4).length,
        topAreas: top, topAreaName: top.length ? `${top.map(key => RISK[key].replace(' risk', '')).join(' or ')} risk area` : null,
        inTop: tornadoes.filter(t => top.includes(t.category)).length, strongInTop: strong.filter(t => top.includes(t.category)).length,
        strongest: strongest ? { rating: strongest.rating, peakWindMph: strongest.peakWindMph } : null,
        longest: longest ? { rating: longest.rating, lengthMi: longest.lengthMi, minutes: longest.minutes } : null,
        trackMiles: Math.round(tornadoes.reduce((sum, t) => sum + t.lengthMi, 0)), largestHailInches: hail || null,
        watches: watches.length, tornadoWatches: watches.filter(w => w.type === 'tornado').length, pdsWatches: watches.filter(w => w.pds).length,
        tornadoWarnings: warnings.filter(type => type === 'tornado').length, severeWarnings: warnings.filter(type => type !== 'tornado').length
      },
      watches,
      // (what the maps are drawn from; not sent with the summary)
      product
    };
  }

  // The id a saved day goes by: its real date and place in it ("2026-11-12-7"), or the world's own count
  // without the locked clock.
  idOf(day) {
    const w = worldDate(dayStart(day));
    if (!w) return `day-${day}`;
    const [month, date, year] = w.date.split('/');
    return `20${year}-${month}-${date}-${w.day}`;
  }

  // One summary as stored or built: id is a saved day's, or live-<n> for a live day.
  find(id) {
    const live = String(id).match(/^live-(\d+)$/);
    if (!live) return this.saved.get(String(id)) ?? null;
    const summary = this.build(Number(live[1]));
    return summary ? { ...summary, id: `live-${summary.day}`, saved: false, savedId: this.saved.has(this.idOf(summary.day)) ? this.idOf(summary.day) : null } : null;
  }

  // As sent to a page (the outlook product stays here).
  summary(id) {
    const found = this.find(id);
    if (!found) return null;
    const { product, ...rest } = found;
    return { ...rest, replay: this.replays?.contents(found.day, found.worldId) ?? { available: false } };
  }

  keep(day) {
    const summary = this.build(Number(day));
    if (!summary) return null;
    const id = this.idOf(summary.day);
    this.saved.set(id, { ...summary, id, saved: true, savedAtMs: Date.now() });
    while (this.saved.size > KEPT_SAVED) this.saved.delete(this.saved.keys().next().value);
    this.dirty = true; this.save();
    return this.summary(id);
  }

  remove(id) {
    const had = this.saved.delete(String(id));
    if (had) { this.dirty = true; this.save(); }
    return had;
  }

  // The list for the days page: the saved days, newest first; for an admin, the recent days as well.
  list(admin) {
    const line = s => ({ id: s.id, day: s.day, label: s.label, ended: s.ended, highest: s.outlook?.highest ?? null, risk: s.outlook?.risk ?? null, tornadoes: s.numbers.tornadoes, strong: s.numbers.strong, strongest: s.numbers.strongest?.rating ?? null });
    const saved = [...this.saved.values()].sort((a, b) => (b.savedAtMs ?? 0) - (a.savedAtMs ?? 0)).map(s => ({ ...line(s), savedAtMs: s.savedAtMs }));
    if (!admin) return { role: 'public', saved };
    const logged = Object.keys(this.reports?.log?.days ?? {}).map(Number), known = [...new Set([...this.days.keys(), ...logged])].sort((a, b) => b - a);
    // (a recent day's line is counted from the log, not surveyed: its ratings are worked out when it is opened)
    const recent = known.map(day => {
      const record = this.days.get(day), log = this.reports?.log?.days?.[day], now = this.runtime.engine?.world?.validHourUtc ?? 0, id = this.idOf(day);
      return { id: `live-${day}`, day, label: dateText(dayStart(day)), ended: now >= dayStart(day) + 24, highest: record?.best?.highest ?? null, risk: record?.best ? RISK[record.best.highest] : null,
        tornadoes: (log?.tornadoes ?? []).filter(t => t.points.length).length, issues: record?.issues.length ?? 0, savedId: this.saved.has(id) ? id : null };
    });
    return { role: 'admin', saved, recent };
  }

  // A summary's maps. kind "outlook": the day's outlook as issued (hazard: its map); "tracks": the outlook's
  // areas, paled, under the day's tornado tracks coloured by rating.
  mapSvg(id, kind, hazard = 'categorical') {
    const found = this.find(id);
    if (!found) return null;
    const layer = this.layer(), product = found.product ?? { status: 'issued', day: 1, mapMiles: layer?.miles ?? 500, category: [], categories: [], hazards: {}, hazardOrder: [] };
    if (kind !== 'tracks') return outlookSvg(product, layer, hazard, { key: true });
    const scale = 1000 / (product.mapMiles ?? layer?.miles ?? 500), px = v => (v * scale).toFixed(1), parts = ['<rect x="0" y="0" width="1000" height="1000" fill="#ffffff" opacity="0.5"/>'];
    for (const t of found.tornadoes) {
      if (!t.track.length) continue;
      const colour = t.ef < 0 ? EFU_COLOUR : EF_COLOURS[t.ef], width = 3.5 + Math.max(0, t.ef) * 1.6, d = t.track.map(([x, y], k) => `${k ? 'L' : 'M'}${px(x)} ${px(y)}`).join('');
      // (each track carries its tornado's id, under a wide unseen stroke that makes it easy to pick on the page)
      parts.push(`<g data-tornado="${t.id}"><path d="${d}" fill="none" stroke="#111" stroke-width="${width + 2.4}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`);
      if (t.track.length < 3 || t.lengthMi < 4) parts.push(`<circle cx="${px(t.track[0][0])}" cy="${px(t.track[0][1])}" r="${3 + Math.max(0, t.ef)}" fill="${colour}" stroke="#111" stroke-width="1.3"/>`);
      parts.push(`<path d="${d}" fill="none" stroke="#000" stroke-opacity="0" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/></g>`);
    }
    return outlookSvg(product, layer, 'categorical', { key: false, overlay: parts.join('') });
  }
}

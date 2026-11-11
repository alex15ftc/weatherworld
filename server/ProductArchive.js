// Every watch, mesoscale discussion and warning the live world issues, kept for the public pages
// (/watch/<n>, /md/<n>, product.html) and the Discord bot's posts (/api/products/feed). The
// runtimes keep only the latest few (MesoscaleRuntime, WarningRuntime); this keeps each one as the
// game got it (GameProducts.js gameMesoscale, gameWarnings: rings in map miles, the full text) from
// the first time it is seen. The watches and discussions are saved beside the world (file), so a
// post's link still works days later and after a restart; the warnings, which have no pages, are
// kept in memory. A new world (the runtime's worldId) starts empty.
//
// GET /api/products/feed           the recent watches, discussions and warnings, with the lines a post needs
// GET /api/watch/<n>[.svg]         a watch and its map;  /watch/<n> its page
// GET /api/md/<n>[.svg]            a discussion and its map;  /md/<n> its page
// GET /api/warning/<key>.svg       one warning's map, or several (?keys=a,b,c on /api/warnings.svg)
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { WATCH_COLOURS, DISCUSSION_COLOURS, WARNING_COLOURS } from '../js/forecast/productColours.js';
import { areaSvg } from './AreaMap.js';
import { utcStamp, localStamp } from './OutlookPublic.js';

const KEPT = { watches: 300, discussions: 300, warnings: 400 };
// What the feed carries: issued in the last this many hours of the world.
const FEED_HOURS = { watches: 24, discussions: 24, warnings: 3 };

export const warningKey = w => `${w.id}-${Math.round(w.issuedHourUtc * 60)}`;
// "Tornado Warning", "PDS Tornado Warning", "Tornado Emergency", "Severe Thunderstorm Warning (destructive)".
export function warningName(w) {
  if (w.type === 'tornado') return w.emergency ? 'Tornado Emergency' : `${w.pds ? 'PDS ' : ''}Tornado Warning`;
  const tag = w.label?.match(/\(([^)]+)\)/)?.[1];
  return `Severe Thunderstorm Warning${tag ? ` (${tag})` : ''}`;
}
const squash = text => (text ?? '').replace(/\s+/g, ' ').trim();

// The lines a post is made of, taken from the products' own text.
function watchLines(w) {
  const threats = (w.text.match(/Primary threats include\.\.\.\n((?: {2}.*\n?)+)/)?.[1] ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  return { threats, summary: squash(w.text.match(/SUMMARY\.\.\.([\s\S]*?)(?:\n\n|$)/)?.[1]) };
}
function discussionLines(md) {
  return { summary: squash(md.text.match(/SUMMARY\.\.\.([\s\S]*?)(?:\n\n|$)/)?.[1]) };
}
function warningLines(w) {
  const text = w.text ?? '';
  return {
    office: text.match(/National Weather Service (?:in )?([A-Z][^\n]*?)(?: has issued|\n|$)/)?.[1]?.trim() ?? null,
    banner: squash(text.match(/\.\.\.((?:THIS IS A PARTICULARLY DANGEROUS SITUATION|TORNADO EMERGENCY)[^\n]*?)\.\.\./)?.[1]) || null,
    // "* At 0100Z, ..." in a warning, "At 0055Z, ..." in a statement that updates it; told in local time, as the offices do.
    situation: squash(text.match(/(?:^|\n)(?:\* )?At \d{4}Z,[\s\S]*?(?=\n\n|$)/)?.[0]?.replace(/^\n?(?:\* )?/, '')
      .replace(/At (\d{2})(\d{2})Z/, (_, h, m) => `At ${localStamp(Number(h) + Number(m) / 60)}`)) || null,
    hazard: squash(text.match(/HAZARD\.\.\.([^\n]*)/)?.[1]) || null
  };
}

export class ProductArchive {
  // runtime: the weather authority (its worldId). products: GameProducts (the mesoscale and warnings
  // products). layer(): the county layer for the maps. file: where the watches and discussions are saved.
  constructor({ runtime, products, layer, file = null }) {
    this.runtime = runtime; this.products = products; this.layer = layer; this.file = file;
    this.reset(); this.restore();
  }

  reset() {
    this.worldId = this.runtime.worldId; this.watches = new Map(); this.discussions = new Map(); this.warnings = new Map();
    this.versions = {}; this.svgs = new Map(); this.dirty = false;
  }

  restore() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const saved = v8.deserialize(fs.readFileSync(this.file));
      if (saved.version !== 1 || saved.worldId !== this.runtime.worldId) return;
      this.watches = new Map(saved.watches.map(w => [w.number, w])); this.discussions = new Map(saved.discussions.map(md => [md.number, md]));
      console.log(`[products] ${this.watches.size} watches and ${this.discussions.size} discussions kept from before the restart`);
    } catch (error) { console.warn('[products] saved archive unreadable:', error.message); }
  }

  save() {
    if (!this.file || !this.dirty) return;
    this.dirty = false;
    const bytes = v8.serialize({ version: 1, worldId: this.worldId, watches: [...this.watches.values()], discussions: [...this.discussions.values()] });
    fs.promises.mkdir(path.dirname(this.file), { recursive: true })
      .then(() => fs.promises.writeFile(`${this.file}.tmp`, bytes))
      .then(() => fs.promises.rename(`${this.file}.tmp`, this.file))
      .catch(error => console.warn('[products] not saved:', error.message));
  }

  // Call often: takes in what is new since the products last changed.
  sync() {
    if (this.runtime.worldId !== this.worldId) { this.reset(); this.dirty = true; }
    const mesoscale = this.read('mesoscale'), warnings = this.read('warnings');
    if (mesoscale) {
      for (const w of mesoscale.watches ?? []) this.keep(this.watches, w.number, w, KEPT.watches);
      for (const md of mesoscale.discussions ?? []) this.keep(this.discussions, md.number, md, KEPT.discussions);
    }
    if (warnings) {
      for (const w of warnings.warnings ?? []) {
        const key = warningKey(w), was = this.warnings.get(key);
        // A warning's text and tags change as it is updated: keep the latest, and the highest rank it has had.
        this.warnings.set(key, { ...w, key, firstRank: was?.firstRank ?? w.rank, topRank: Math.max(was?.topRank ?? w.rank, w.rank) });
        if (was && was.text !== w.text) this.forget(key);
      }
      while (this.warnings.size > KEPT.warnings) this.warnings.delete(this.warnings.keys().next().value);
    }
    this.save();
  }

  // A product's JSON when its version has changed since the last look (null otherwise).
  read(id) {
    const entry = this.products.product(id);
    if (!entry || this.versions[id] === entry.version) return null;
    this.versions[id] = entry.version;
    try { const value = JSON.parse(entry.text); return value.status === 'off' ? null : value; } catch { return null; }
  }

  keep(map, number, item, limit) {
    const was = map.get(number);
    if (was && was.text === item.text && was.validToHourUtc === item.validToHourUtc) return;
    map.set(number, { ...item, issuedHourUtc: was?.issuedHourUtc ?? item.issuedHourUtc });
    this.forget(`${map === this.watches ? 'watch' : 'md'}:${number}:`);
    while (map.size > limit) map.delete(Math.min(...map.keys()));
    this.dirty = true;
  }

  // The recent products, newest first, with the lines a post is made of.
  feed() {
    this.sync();
    const now = this.runtime.engine?.world?.validHourUtc ?? 0, recent = (items, hours) => [...items].filter(x => x.issuedHourUtc >= now - hours).sort((a, b) => b.issuedHourUtc - a.issuedHourUtc);
    const times = x => ({ issued: `${utcStamp(x.issuedHourUtc)} (${localStamp(x.issuedHourUtc)})`, issuedLocal: localStamp(x.issuedHourUtc), untilLocal: localStamp(x.validToHourUtc) });
    return {
      worldId: this.worldId, nowHourUtc: now,
      watches: recent(this.watches.values(), FEED_HOURS.watches).map(w => ({ number: w.number, type: w.type, pds: w.pds, title: w.title, where: w.where, issuedHourUtc: w.issuedHourUtc, validToHourUtc: w.validToHourUtc, ...times(w), ...watchLines(w) })),
      discussions: recent(this.discussions.values(), FEED_HOURS.discussions).map(md => ({ number: md.number, concerning: md.concerning, where: md.where, watchPercent: md.watchPercent, watchNumber: md.watchNumber, colourKey: md.colourKey, issuedHourUtc: md.issuedHourUtc, validToHourUtc: md.validToHourUtc, ...times(md), ...discussionLines(md) })),
      warnings: recent(this.warnings.values(), FEED_HOURS.warnings).map(w => ({ key: w.key, id: w.id, name: warningName(w), type: w.type, number: w.number, title: w.title, label: w.label, pds: w.pds, emergency: w.emergency, colourKey: w.colourKey, rank: w.rank, firstRank: w.firstRank, topRank: w.topRank, where: w.where, issuedHourUtc: w.issuedHourUtc, validToHourUtc: w.validToHourUtc, ...times(w), ...warningLines(w) }))
    };
  }

  watch(number) { this.sync(); return this.watches.get(Number(number)) ?? null; }
  discussion(number) { this.sync(); return this.discussions.get(Number(number)) ?? null; }

  // The maps. times: the footer line with the issue and end times (the Discord posts).
  watchSvg(number, { times = false } = {}) {
    const w = this.watch(number); if (!w) return null;
    const colour = WATCH_COLOURS[w.type === 'tornado' ? 'tornado' : 'severe'];
    return this.cached(`watch:${number}:${times}`, () => areaSvg({
      layer: this.layer(), minMiles: 120,
      shapes: [{ rings: w.rings, fill: colour, fillOpacity: 0.3, stroke: colour, width: 4, label: `WW ${w.number}` }],
      key: [{ colour, text: `${w.pds ? 'PDS ' : ''}${w.type === 'tornado' ? 'Tornado' : 'Severe Thunderstorm'} Watch ${w.number}` }],
      footer: times ? [w.title, `Issued ${utcStamp(w.issuedHourUtc)} (${localStamp(w.issuedHourUtc)}) · Until ${utcStamp(w.validToHourUtc)} (${localStamp(w.validToHourUtc)})`] : null
    }));
  }

  discussionSvg(number, { times = false } = {}) {
    const md = this.discussion(number); if (!md) return null;
    const colour = DISCUSSION_COLOURS[md.colourKey] ?? DISCUSSION_COLOURS.unlikely, label = `MD ${String(md.number).padStart(4, '0')}`;
    // The watches in effect around it, as the real graphics show them.
    const watches = [...this.watches.values()].filter(w => w.issuedHourUtc <= md.issuedHourUtc + 1e-6 && w.validToHourUtc > md.issuedHourUtc)
      .map(w => ({ rings: w.rings, fill: WATCH_COLOURS[w.type === 'tornado' ? 'tornado' : 'severe'], fillOpacity: 0.12, stroke: WATCH_COLOURS[w.type === 'tornado' ? 'tornado' : 'severe'], width: 2, dash: '10 6', label: `WW ${w.number}` }));
    return this.cached(`md:${number}:${times}`, () => areaSvg({
      layer: this.layer(), minMiles: 120, focus: md.rings,
      shapes: [...watches, { rings: md.rings, fill: colour, fillOpacity: 0.2, stroke: colour, width: 5, label }],
      key: [{ colour, text: `Mesoscale Discussion ${String(md.number).padStart(4, '0')}` }, ...(watches.length ? [{ colour: watches[0].stroke, text: 'Watch in effect' }] : [])],
      footer: times ? [label, `Issued ${utcStamp(md.issuedHourUtc)} (${localStamp(md.issuedHourUtc)}) · Valid until ${utcStamp(md.validToHourUtc)}`] : null
    }));
  }

  warningsSvg(keys, { times = false } = {}) {
    this.sync();
    const list = keys.map(key => this.warnings.get(key)).filter(Boolean);
    if (!list.length) return null;
    const one = list.length === 1 ? list[0] : null;
    return this.cached(`warning:${keys.join(',')}:${times}`, () => areaSvg({
      layer: this.layer(), minMiles: 50,
      shapes: list.map(w => ({ rings: w.rings, fill: WARNING_COLOURS[w.colourKey], fillOpacity: 0.25, stroke: WARNING_COLOURS[w.colourKey], width: 4 })),
      key: [...new Map(list.map(w => [w.colourKey, { colour: WARNING_COLOURS[w.colourKey], text: warningName(w) }])).values()],
      footer: times ? (one ? [one.title, `Issued ${utcStamp(one.issuedHourUtc)} (${localStamp(one.issuedHourUtc)}) · Until ${localStamp(one.validToHourUtc)}`] : [`${list.length} warnings`, `Issued ${localStamp(Math.min(...list.map(w => w.issuedHourUtc)))} to ${localStamp(Math.max(...list.map(w => w.issuedHourUtc)))}`]) : null
    }));
  }

  // Drops the maps drawn from a product that has changed (any cache key that names it).
  forget(part) { for (const key of [...this.svgs.keys()]) if (key.includes(part)) this.svgs.delete(key); }

  cached(key, build) {
    if (!this.svgs.has(key)) { this.svgs.set(key, build()); if (this.svgs.size > 300) this.svgs.delete(this.svgs.keys().next().value); }
    return this.svgs.get(key);
  }
}

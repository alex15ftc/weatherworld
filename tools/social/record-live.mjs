// Records a live world day from the hosted engine's public routes, for social posts (tools/social/README.md).
// Saves the Day 1 outlook (text + maps) at each new issue, every storm tick of /api/live/storms, the
// watch / discussion / warning feed with each product's map, and the synoptic fields of each analysis.
//   node tools/social/record-live.mjs <out dir> [--until <world hour>] [--base <url>]
// Stops on its own once the world passes --until (default: the end of the current Day 1 outlook + 0.5 h).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = process.argv.slice(2), out = path.resolve(args[0] ?? 'data/social/live');
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const BASE = flag('base', 'https://highrisk.up.railway.app');
let until = flag('until', null) == null ? null : Number(flag('until'));
const SYNOPTIC_KEYS = ['wspd250', 'z250', 'wind:250', 'vort500', 'z500', 'wind:500', 'wspd850', 'wind:850', 'tair', 'td', 'mslp', 'wind:sfc'];
const HAZARDS = ['categorical', 'tornado', 'wind', 'hail'];

for (const dir of ['storms', 'outlook', 'products', 'synoptic']) fs.mkdirSync(path.join(out, dir), { recursive: true });
const save = (file, text) => fs.writeFileSync(path.join(out, file), text);
const saveGz = (file, text) => fs.writeFileSync(path.join(out, file), zlib.gzipSync(text));
const has = file => fs.existsSync(path.join(out, file));
const hourName = h => h.toFixed(3).padStart(9, '0');
async function get(url) {
  const response = await fetch(BASE + url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return { text: await response.text(), version: response.headers.get('x-product-version') };
}
const log = line => { console.log(`${new Date().toISOString().slice(11, 19)} ${line}`); };

let lastStormHour = null, seenOutlook = new Set(), seenFrames = new Set(), now = null;

async function outlook() {
  const { text, version } = await get('/api/outlook/day1');
  const product = JSON.parse(text);
  if (product.status !== 'issued' || seenOutlook.has(version)) return product;
  const tag = `day1-${hourName(product.issuedHourUtc)}`;
  save(`outlook/${tag}.json`, text);
  for (const hazard of HAZARDS) {
    save(`outlook/${tag}-${hazard}.svg`, (await get(`/api/outlook/day1.svg?hazard=${hazard}`)).text);
    save(`outlook/${tag}-${hazard}-times.svg`, (await get(`/api/outlook/day1.svg?hazard=${hazard}&times=1`)).text);
  }
  seenOutlook.add(version);
  log(`outlook ${product.highest} issued ${product.issuedHourUtc}, valid to ${product.validToHourUtc}`);
  if (until == null) until = product.validToHourUtc + 0.5;
  return product;
}

async function storms() {
  const { text } = await get('/api/live/storms');
  const hour = Number(text.match(/"stormValidHourUtc":([\d.]+)/)?.[1]);
  if (!Number.isFinite(hour) || hour === lastStormHour) return;
  lastStormHour = hour; now = hour;
  saveGz(`storms/${hourName(hour)}.json.gz`, text);
}

async function products() {
  const { text } = await get('/api/products/feed');
  const feed = JSON.parse(text);
  save('products/feed-latest.json', text);
  for (const [kind, list] of [['watch', feed.watches ?? []], ['md', feed.discussions ?? []]]) {
    for (const item of list) {
      const tag = `products/${kind}-${item.number}`;
      // A product's text can be updated while it is valid, so the copy is refreshed until it ends.
      if (has(`${tag}.json`) && item.validToHourUtc < feed.nowHourUtc - 0.5) continue;
      try {
        save(`${tag}.json`, (await get(`/api/${kind}/${item.number}`)).text);
        save(`${tag}.svg`, (await get(`/api/${kind}/${item.number}.svg?times=1`)).text);
      } catch (error) { log(`${tag}: ${error.message}`); }
    }
  }
  const warnings = feed.warnings ?? [];
  if (warnings.length) saveGz(`products/warnings-${hourName(feed.nowHourUtc)}.json.gz`, JSON.stringify(warnings));
}

async function synoptic() {
  const summary = JSON.parse((await get('/api/synoptic/frame')).text);
  if (summary.status !== 'ready') return;
  for (const frame of summary.frames) {
    if (seenFrames.has(frame) || has(`synoptic/${hourName(frame)}.json.gz`)) { seenFrames.add(frame); continue; }
    const bundle = { summary: JSON.parse((await get(`/api/synoptic/frame?frame=${frame}`)).text), fields: {} };
    for (const key of SYNOPTIC_KEYS) bundle.fields[key] = JSON.parse((await get(`/api/synoptic/field?key=${encodeURIComponent(key)}&frame=${frame}`)).text);
    saveGz(`synoptic/${hourName(frame)}.json.gz`, JSON.stringify(bundle));
    seenFrames.add(frame);
    log(`synoptic frame ${frame}`);
  }
}

save('calendar.json', (await get('/api/calendar')).text);
save('counties.json', (await get('/api/map/counties')).text);
let tick = 0;
for (;;) {
  for (const [name, step, every] of [['storms', storms, 1], ['outlook', outlook, 6], ['products', products, 3], ['synoptic', synoptic, 6]]) {
    if (tick % every) continue;
    try { await step(); } catch (error) { log(`${name}: ${error.message}`); }
  }
  if (until != null && now != null && now >= until) break;
  if (tick % 15 === 0) log(`world hour ${now}, recording until ${until}`);
  tick += 1;
  await new Promise(resolve => setTimeout(resolve, 15000));
}
log(`done at world hour ${now}`);

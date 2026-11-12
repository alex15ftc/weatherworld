// Makes the "forecast, then what happened" pair of pictures for a recorded day (tools/social/README.md):
//   <day>/post/1-outlook.png        the Day 1 outlook as issued: categorical map, headline, hazard maps
//   <day>/post/2-what-happened.png  the same outlook areas with the day's tornado tracks and its numbers
//   <day>/post/captions.md          draft post text for both, and for the loops of make-loop.mjs
//   node tools/social/make-post.mjs <day dir> [--issue <issued hour>]
// <day dir>/raw is a day recorded by record-live.mjs. The outlook used is the day's highest-risk issue
// (the earliest, when several share the category) unless --issue names one.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { outlookSvg, outlookHeadline, localStamp } from '../../server/OutlookPublic.js';
import { setCalendar, utcStamp } from '../../js/forecast/calendar.js';
import { EF_COLOURS } from '../../js/forecast/productColours.js';
import { screenshot } from './chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), DAY = path.resolve(args[0] ?? '.'), RAW = path.join(DAY, 'raw'), OUT = path.join(DAY, 'post');
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const readGz = file => JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
const esc = text => String(text ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const KM_PER_MILE = 1.609344, RANK = ['NONE', 'TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'];
const RISK = { TSTM: 'Thunderstorms', MRGN: 'Marginal risk', SLGT: 'Slight risk', ENH: 'Enhanced risk', MDT: 'Moderate risk', HIGH: 'High risk' };
const RISK_COLOUR = { TSTM: '#c1e9c1', MRGN: '#66a366', SLGT: '#ffe066', ENH: '#ffa366', MDT: '#e06666', HIGH: '#ee99ee' };

// The world's dates are the real ones (calendar.js), from the recorded clock.
const calendar = readJson(path.join(RAW, 'calendar.json'));
setCalendar({ offset: () => calendar.offset });
const layer = readJson(path.join(RAW, 'counties.json'));

// --- The outlook issue.
const issues = fs.readdirSync(path.join(RAW, 'outlook')).filter(f => /^day1-[\d.]+\.json$/.test(f)).map(f => readJson(path.join(RAW, 'outlook', f))).sort((a, b) => a.issuedHourUtc - b.issuedHourUtc);
if (!issues.length) throw new Error(`No recorded outlook in ${RAW}`);
const asked = flag('issue', null);
const outlook = asked != null ? issues.find(o => o.issuedHourUtc === Number(asked)) : issues.reduce((best, o) => (RANK.indexOf(o.highest) > RANK.indexOf(best.highest) ? o : best), issues[0]);
if (!outlook) throw new Error(`No issue at hour ${asked}`);
const dayEnd = Math.max(...issues.map(o => o.validToHourUtc)), dayStart = outlook.validFromHourUtc;

// --- The day's tornadoes: every storm's tornado history, from every recorded storm tick (the last word on
// each wins), plus those still on the ground at the last tick.
const stormFiles = fs.readdirSync(path.join(RAW, 'storms')).filter(f => f.endsWith('.json.gz')).sort();
const tornadoes = new Map(), storms = new Map();
let lastTick = null;
for (const file of stormFiles) {
  const tick = readGz(path.join(RAW, 'storms', file));
  lastTick = tick.stormValidHourUtc;
  for (const storm of [...(tick.recentEnded ?? []), ...(tick.storms ?? [])]) {
    storms.set(storm.id, storm);
    for (const t of storm.tornadoHistory ?? []) tornadoes.set(`${storm.id}:${t.cycle}:${t.trackPoints?.[0]?.hourUtc?.toFixed(2)}`, { ...t, storm: storm.id });
    const live = storm.tornado;
    if (live?.onGround && live.trackPoints?.length > 1) tornadoes.set(`${storm.id}:live`, { ...live, storm: storm.id, startedHourUtc: live.trackPoints[0].hourUtc, endedHourUtc: tick.stormValidHourUtc, peakWindSpeedMph: live.peakWindSpeedMph, live: true });
    else tornadoes.delete(`${storm.id}:live`);
  }
}
const efOf = t => Number(String(t.estimatedEf ?? '').replace(/\D/g, '')) || 0;
const day = [...tornadoes.values()].filter(t => t.trackPoints?.length && t.trackPoints[0].hourUtc >= dayStart - 1e-6 && t.trackPoints[0].hourUtc < dayEnd).sort((a, b) => efOf(a) - efOf(b));
const recordedFrom = Number(stormFiles[0]?.replace('.json.gz', '')), recordedTo = lastTick;

// Which outlook area a place is in (map miles): the highest category whose rings hold it (even-odd).
function inside(rings, x, y) {
  let hit = false;
  for (const flat of rings) for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) {
    const xi = flat[i], yi = flat[i + 1], xj = flat[j], yj = flat[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const categoryAt = (x, y) => [...(outlook.category ?? [])].sort((a, b) => RANK.indexOf(b.key) - RANK.indexOf(a.key)).find(c => inside(c.rings, x, y))?.key ?? 'NONE';
for (const t of day) t.category = categoryAt(t.trackPoints[0].x / KM_PER_MILE, t.trackPoints[0].y / KM_PER_MILE);

// --- The numbers.
const miles = km => km / KM_PER_MILE;
const count = n => (n === 1 ? '1 tornado' : `${n} tornadoes`);
const byEf = [0, 1, 2, 3, 4, 5].map(ef => day.filter(t => efOf(t) === ef).length);
const strongest = day.at(-1), longest = [...day].sort((a, b) => (b.pathLengthKm ?? 0) - (a.pathLengthKm ?? 0))[0];
const stormList = [...storms.values()].filter(s => (s.endedHourUtc ?? Infinity) > dayStart);
const maxHail = Math.max(0, ...stormList.map(s => s.hazardExtremes?.hail?.maxSizeInches ?? 0)), maxGust = Math.max(0, ...stormList.map(s => s.hazardExtremes?.wind?.maxGustMph ?? 0));
const feed = fs.existsSync(path.join(RAW, 'products/feed-latest.json')) ? readJson(path.join(RAW, 'products/feed-latest.json')) : {};
const watches = fs.readdirSync(path.join(RAW, 'products')).filter(f => /^watch-\d+\.json$/.test(f)).map(f => readJson(path.join(RAW, 'products', f))).filter(w => w.issuedHourUtc >= dayStart - 0.01 && w.issuedHourUtc < dayEnd);
const warningIds = new Map();
for (const f of fs.readdirSync(path.join(RAW, 'products')).filter(f => /^warnings-.*\.gz$/.test(f))) for (const w of readGz(path.join(RAW, 'products', f))) if (w.issuedHourUtc >= dayStart - 0.01 && w.issuedHourUtc < dayEnd) warningIds.set(w.id, w);
const tornadoWarnings = [...warningIds.values()].filter(w => w.type === 'tornado').length;
const top = outlook.highest, topAreas = top === 'HIGH' ? ['HIGH', 'MDT'] : [top];
const inTop = day.filter(t => topAreas.includes(t.category)).length, strong = day.filter(t => efOf(t) >= 2), strongInTop = strong.filter(t => topAreas.includes(t.category)).length;
const areaName = topAreas.map(k => RISK[k].replace(' risk', '')).join(' or ') + ' risk area';
const summary = outlook.discussion?.match(/\.\.\.SUMMARY\.\.\.\n([\s\S]*?)(?:\n\n|$)/)?.[1]?.replace(/\n/g, ' ') ?? '';
const hazards = summary.match(/The main hazards: (.*?)\.(?:\s|$)/)?.[1] ?? '';
const headline = outlookHeadline(outlook);

// --- The maps.
const cropped = svg => svg.replace(/(<svg[^>]*?) height="\d+" viewBox="0 0 1000 \d+"/, '$1 height="1000" viewBox="0 0 1000 1000"');
const categorical = outlookSvg(outlook, layer, 'categorical');
// The tracks go over the outlook areas, which are washed out so the tracks read; the widest ratings on top.
const px = km => (km / KM_PER_MILE * 2).toFixed(1);
const trackLayer = ['<rect x="0" y="0" width="1000" height="1000" fill="#ffffff" opacity="0.5"/>'];
for (const t of day) {
  const ef = efOf(t), d = t.trackPoints.map((p, k) => `${k ? 'L' : 'M'}${px(p.x)} ${px(p.y)}`).join(''), width = 3.5 + ef * 1.6;
  trackLayer.push(`<path d="${d}" fill="none" stroke="#111" stroke-width="${width + 2.4}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${EF_COLOURS[ef]}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`);
  if (t.trackPoints.length < 3 || (t.pathLengthKm ?? 0) < 6) trackLayer.push(`<circle cx="${px(t.trackPoints[0].x)}" cy="${px(t.trackPoints[0].y)}" r="${3 + ef}" fill="${EF_COLOURS[ef]}" stroke="#111" stroke-width="1.3"/>`);
}
const split = categorical.indexOf('<rect x="0.75"');
const happened = cropped(categorical.slice(0, split) + `<g clip-path="url(#map)">${trackLayer.join('')}</g>` + categorical.slice(split)).replace(/<text x="24" y="10\d\d[\s\S]*<\/svg>$/, '</svg>');

// --- The pages the pictures are taken of.
const font = name => pathToFileURL(path.join(ROOT, 'fonts', name)).href;
const css = `
@font-face { font-family: "Public Sans"; src: url("${font('public-sans.woff2')}") format("woff2"); font-weight: 100 900; }
@font-face { font-family: "IBM Plex Mono"; src: url("${font('plex-mono-400.woff2')}") format("woff2"); font-weight: 400; }
@font-face { font-family: "IBM Plex Mono"; src: url("${font('plex-mono-600.woff2')}") format("woff2"); font-weight: 600; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1600px; height: 900px; overflow: hidden; }
body { display: flex; flex-direction: column; background: #fff; color: #1b1b1b; font: 400 25px/1.4 "Public Sans", sans-serif; }
.top { display: flex; justify-content: space-between; align-items: center; gap: 30px; padding: 14px 30px; background: #0b3a57; color: #fff; border-bottom: 5px solid #f2b632; }
.top b { font-size: 35px; font-weight: 750; }
.top span { font: 600 25px "IBM Plex Mono", monospace; white-space: nowrap; }
.body { flex: 1; min-height: 0; display: flex; gap: 34px; padding: 22px 30px 16px; }
.map { flex: none; height: 100%; }
.map svg { display: block; height: 100%; width: auto; border: 1px solid #9aa0a6; }
.text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.kicker { font-size: 20px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: #5c5f62; }
.tag { align-self: flex-start; margin: 10px 0 12px; padding: 4px 16px; font-size: 27px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; border: 2px solid rgba(0, 0, 0, .4); }
h1 { font-size: 39px; line-height: 1.17; font-weight: 750; letter-spacing: -.01em; }
.hazards { margin-top: 14px; padding-top: 12px; border-top: 2px solid #1b1b1b; font-size: 24px; }
.hazards b { display: block; font-size: 18px; letter-spacing: .08em; text-transform: uppercase; color: #5c5f62; }
.minis { margin-top: auto; display: flex; gap: 16px; }
.minis figure { flex: 1; min-width: 0; }
.minis svg { display: block; width: 100%; height: auto; border: 1px solid #9aa0a6; }
.minis figcaption { font-size: 19px; font-weight: 700; padding-top: 5px; }
.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 0 28px; margin-top: 14px; border-top: 2px solid #1b1b1b; }
.stats div { padding: 10px 0 9px; border-bottom: 1px solid #c9cccf; font-size: 21px; color: #45484b; line-height: 1.25; }
.stats b { display: block; font: 600 38px/1.1 "IBM Plex Mono", monospace; color: #1b1b1b; }
.verify { margin-top: 14px; font-size: 25px; font-weight: 600; }
.key { margin-top: auto; display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 20px; align-items: center; }
.key i { display: inline-block; width: 34px; height: 9px; margin-right: 7px; border: 1.5px solid #111; vertical-align: middle; }
.key .area i { height: 20px; width: 26px; border: 1.5px solid rgba(0, 0, 0, .45); }
.foot { display: flex; justify-content: space-between; padding: 9px 30px 11px; background: #f3f4f2; border-top: 1px solid #c9cccf; font-size: 20px; color: #45484b; }
.foot b { color: #1b1b1b; }
`;
const page = (title, time, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div class="top"><b>${esc(title)}</b><span>${esc(time)}</span></div><div class="body">${body}</div>
<div class="foot"><span><b>WeatherWorld</b> Storm Prediction Center</span><span>Simulated weather for the game world. Not a real forecast.</span></div></body></html>`;
const sentence = text => (text ? text[0].toUpperCase() + text.slice(1) : '');
const validLine = `Valid ${utcStamp(outlook.validFromHourUtc)} to ${utcStamp(outlook.validToHourUtc)}`;

const mini = hazard => `<figure>${cropped(outlookSvg(outlook, layer, hazard)).replace(/<text x="24" y="10\d\d[\s\S]*<\/svg>$/, '</svg>')}<figcaption>${hazard[0].toUpperCase() + hazard.slice(1)} probability</figcaption></figure>`;
const outlookPage = page('Day 1 Convective Outlook', `Issued ${utcStamp(outlook.issuedHourUtc)} (${localStamp(outlook.issuedHourUtc)})`, `
<div class="map">${categorical}</div>
<div class="text">
  <p class="kicker">${esc(validLine)}</p>
  <span class="tag" style="background:${RISK_COLOUR[top]}">${esc(RISK[top])}</span>
  <h1>${esc(headline)}</h1>
  <p class="hazards"><b>Main hazards</b>${esc(sentence(hazards))}.</p>
  <div class="minis">${['tornado', 'wind', 'hail'].map(mini).join('')}</div>
</div>`);

const stat = (value, label) => `<div><b>${esc(value)}</b>${esc(label)}</div>`;
const shownAreas = (outlook.category ?? []).map(c => c.key).filter(k => RANK.indexOf(k) >= 3);
const happenedPage = page('What happened: Day 1 tornado tracks', validLine, `
<div class="map">${happened}</div>
<div class="text">
  <p class="kicker">Forecast: ${esc(RISK[top])} · issued ${esc(utcStamp(outlook.issuedHourUtc))}</p>
  <h1 style="margin-top:10px">${esc(count(day.length))}${strongest ? `, the strongest rated ${esc(strongest.estimatedEf)}` : ''}.</h1>
  <p class="verify">${inTop} of ${day.length} began inside the ${esc(areaName)}${strong.length ? `, including ${strongInTop} of the ${strong.length} rated EF2 or stronger` : ''}.</p>
  <div class="stats">
    ${stat(byEf.slice(2).reduce((a, b) => a + b, 0), 'strong tornadoes (EF2+)')}
    ${byEf[4] + byEf[5] ? stat(byEf[4] + byEf[5], 'violent tornadoes (EF4+)') : stat(`${Math.round(day.reduce((sum, t) => sum + miles(t.pathLengthKm ?? 0), 0))} mi`, 'of tornado track in all')}
    ${stat(longest ? `${Math.round(miles(longest.pathLengthKm))} mi` : '–', `longest track${longest ? ` (${longest.estimatedEf}, ${Math.round(longest.groundTimeMinutes ?? longest.lifeMinutes ?? 0)} min)` : ''}`)}
    ${stat(strongest ? `${Math.round(strongest.peakWindSpeedMph)} mph` : '–', 'highest tornado wind')}
    ${stat(`${maxHail.toFixed(1)} in`, 'largest hail')}
    ${stat(watches.filter(w => w.type === 'tornado').length, `tornado watches issued${watches.some(w => w.pds) ? ` (${watches.filter(w => w.pds).length} PDS)` : ''}`)}
  </div>
  <div class="key">
    ${[0, 1, 2, 3, 4, 5].filter(ef => byEf[ef]).map(ef => `<span><i style="background:${EF_COLOURS[ef]}"></i>EF${ef} (${byEf[ef]})</span>`).join('')}
    ${shownAreas.map(k => `<span class="area"><i style="background:${RISK_COLOUR[k]}"></i>${esc(RISK[k].replace(' risk', ''))}</span>`).join('')}
  </div>
</div>`);

fs.mkdirSync(OUT, { recursive: true });
for (const [name, html] of [['1-outlook', outlookPage], ['2-what-happened', happenedPage]]) {
  const file = path.join(OUT, `${name}.html`);
  fs.writeFileSync(file, html);
  screenshot(pathToFileURL(file).href, path.join(OUT, `${name}.png`), { width: 1600, height: 900, waitMs: 1500 });
  console.log(`${name}.png`);
}

// --- Draft post text.
const partial = recordedFrom > dayStart + 0.25 || recordedTo < dayEnd - 0.25;
const captions = `# Post text: ${RISK[top]} day, ${utcStamp(outlook.validFromHourUtc)}

Drafts to edit. Every number below is from the recorded day (\`raw/\`).
${partial ? `\nNote: storm ticks were recorded from world hour ${recordedFrom} to ${recordedTo}; the outlook period is ${dayStart} to ${dayEnd}. Tornadoes of storms that ended before the recording began are counted only where the engine still listed the storm.\n` : ''}
## 1. The forecast (\`1-outlook.png\`), posted first

${headline} ${sentence(hazards)}.

This is not a real forecast. It is the Day 1 outlook for WeatherWorld, a storm-chasing world where one weather engine runs the same sky for every server. The storms had not formed when this was issued.

## 2. What happened (\`2-what-happened.png\`), as a reply once the day ends

Same world, ${Math.round((dayEnd - dayStart) / 8 * 60)} real minutes later: ${count(day.length)}${strongest ? `, the strongest rated ${strongest.estimatedEf} with ${Math.round(strongest.peakWindSpeedMph)} mph winds` : ''}. ${inTop} of ${day.length} began inside the ${areaName}.${longest ? ` The longest track ran ${Math.round(miles(longest.pathLengthKm))} miles.` : ''}

Nothing here is scripted. The outlook is made from an ensemble of forecast runs, then the world plays out.

## 3. The loops (\`3-*.mp4\`, from make-loop.mjs)

The large-scale pattern behind the outbreak: the whole simulated atmosphere, with the game map as the white box.${watches.filter(w => w.pds).length ? ` ${watches.filter(w => w.pds).length} of the day's ${watches.length} watches were "particularly dangerous situation" tornado watches.` : ''}

## Numbers

| | |
|---|---|
| Tornadoes | ${day.length} (${[0, 1, 2, 3, 4, 5].map(ef => `EF${ef}: ${byEf[ef]}`).join(', ')}) |
| In the ${areaName} | ${inTop} of ${day.length}; EF2+: ${strongInTop} of ${strong.length} |
| Longest track | ${longest ? `${miles(longest.pathLengthKm).toFixed(1)} mi, ${longest.estimatedEf}` : 'none'} |
| Highest tornado wind | ${strongest ? `${Math.round(strongest.peakWindSpeedMph)} mph` : 'none'} |
| Largest hail / highest gust | ${maxHail.toFixed(1)} in / ${Math.round(maxGust)} mph |
| Watches issued | ${watches.length} (${watches.filter(w => w.type === 'tornado').length} tornado, ${watches.filter(w => w.pds).length} PDS) |
| Tornado warnings issued | ${tornadoWarnings} |
| Mesoscale discussions in the feed | ${(feed.discussions ?? []).length} |
`;
fs.writeFileSync(path.join(OUT, 'captions.md'), captions);
console.log(`captions.md · ${day.length} tornadoes, ${top} outlook issued ${outlook.issuedHourUtc}`);

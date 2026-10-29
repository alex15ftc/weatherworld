// The model page (2026-10-29), laid out like Pivotal Weather's model pages. Two models:
//   Short range  one run from the live world at each simulated hour (server/ShortRangeRuntime.js): a
//                simulated composite reflectivity drawn from its storms every 15 minutes, updraft
//                helicity (1 h max and run-total tracks), tornado tracks, and the mesoanalysis fields
//                each hour.
//   Ensemble     the runs behind the latest outlook (server/OutlookRuntime.js, full and cheap runs):
//                paintball, chances of a rotating-storm track or a tornado near each place, and every
//                run's tracks.
const $ = id => document.getElementById(id);
const canvas = $('modelCanvas'), ctx = canvas.getContext('2d'), tip = $('modelTip');
const REFRESH_MS = 20000, PLAY_MS = 450, MILE_KM = 1.609344;
const NEAR_KM = 25 * MILE_KM;          // "within 25 miles", as the outlooks' neighbourhood
const UH_TRACK = 75;                   // updraft helicity that marks a rotating storm's track (m²/s²)

// --- Colour tables.
const REFL = [[15, '#0300f4'], [20, '#02fd02'], [25, '#01c501'], [30, '#008e00'], [35, '#fdf802'], [40, '#e5bc00'], [45, '#fd9500'], [50, '#fd0000'], [55, '#d40000'], [60, '#bc0000'], [65, '#f800fd'], [70, '#9854c6'], [75, '#fdfdfd']];
const UH = [[25, '#9cc8a0'], [50, '#3f9a5a'], [75, '#f2d21b'], [100, '#f28c1b'], [150, '#e8261c'], [200, '#b4135e'], [300, '#8a2be2'], [400, '#e6e0ff']];
const PROB = [[5, '#a8d4f5'], [10, '#4a9ff0'], [20, '#2bb673'], [30, '#e8d21b'], [40, '#f29a1b'], [50, '#e8401c'], [60, '#b81414'], [70, '#d6337f'], [80, '#9440c9'], [90, '#f2f2f2']];
const EF = ['#9cc8ff', '#5fd35f', '#f2d21b', '#f28c1b', '#e8261c', '#d633d6'];
const stepColour = (table, v) => { let c = null; for (const [at, colour] of table) if (v >= at) c = colour; return c; };
const rgb = hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const runColour = (i, alpha = 1) => `hsla(${(i * 137.508) % 360}, 85%, 60%, ${alpha})`;

// --- Products.
const STORM_PRODUCTS = [
  { key: 'refl', group: 'Storms', label: 'Composite reflectivity (simulated)', step: 15, table: REFL, unit: 'dBZ' },
  { key: 'uh1', group: 'Storms', label: 'Updraft helicity, 1 h max (2-5 km)', step: 15, table: UH, unit: 'm²/s²' },
  { key: 'uhTotal', group: 'Storms', label: 'Updraft helicity tracks, run total', step: 15, table: UH, unit: 'm²/s²' },
  { key: 'torTracks', group: 'Storms', label: 'Tornado tracks, run total', step: 15, unit: 'EF' }
];
const ENSEMBLE_PRODUCTS = [
  { key: 'paint', group: 'Ensemble', label: 'Paintball: storms 40+ dBZ', step: 30 },
  { key: 'uhProb4', group: 'Ensemble', label: `Chance of a UH ${UH_TRACK}+ track within 25 mi, 4 h`, step: 30, table: PROB, unit: '%' },
  { key: 'uhProbTotal', group: 'Ensemble', label: `Chance of a UH ${UH_TRACK}+ track within 25 mi, run total`, step: 30, table: PROB, unit: '%' },
  { key: 'torProb', group: 'Ensemble', label: 'Chance of a tornado within 25 mi, run total', step: 30, table: PROB, unit: '%' },
  { key: 'spaghetti', group: 'Ensemble', label: `Every run's UH ${UH_TRACK}+ tracks, run total`, step: 30 }
];

// --- State.
let domain = null, localOffset = -6, base = null, view = null;
let modelKind = 'short', productKey = 'refl', t = 0, playing = null;
const S = { runs: [], init: null, meta: null, tracks: null, byStorm: null };
const E = { issues: [], issued: null, data: null, byRun: null };
const cache = new Map();               // url -> promise of JSON (a run's frames never change)
const rasters = new Map();             // drawn reflectivity and probability images
let shown = { field: null, storms: null };
let token = 0;

async function getJson(url, { keep = true } = {}) {
  if (keep && cache.has(url)) return cache.get(url);
  const promise = fetch(url, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (keep) { cache.set(url, promise); if (cache.size > 900) cache.delete(cache.keys().next().value); }
  return promise;
}

const product = () => (modelKind === 'short' ? [...STORM_PRODUCTS, ...(S.meta?.parameters ?? [])] : ENSEMBLE_PRODUCTS).find(p => p.key === productKey);
const isField = () => modelKind === 'short' && !STORM_PRODUCTS.some(p => p.key === productKey);
const stepMinutes = () => (isField() ? 60 : product()?.step ?? 15);
const maxMinutes = () => (modelKind === 'short' ? (S.meta?.hours ?? 0) * 60 : Math.round((E.data?.hours ?? 0) * 60));
const startHour = () => (modelKind === 'short' ? S.meta?.initHourUtc : E.data?.issuedHourUtc) ?? 0;

// --- Time words.
const pad = n => String(n).padStart(2, '0');
function clock(hourUtc) {
  const minutes = Math.round(hourUtc * 60), day = Math.floor(minutes / 1440) + 1, z = ((minutes % 1440) + 1440) % 1440;
  const local = (((z + localOffset * 60) % 1440) + 1440) % 1440, h12 = Math.floor(local / 60) % 12 || 12;
  return `Day ${day} ${pad(Math.floor(z / 60))}:${pad(z % 60)}Z (${h12}:${pad(local % 60)} ${local < 720 ? 'AM' : 'PM'} local)`;
}
const runName = hourUtc => { const z = ((Math.round(hourUtc) % 24) + 24) % 24; return `Day ${Math.floor(Math.round(hourUtc) / 24) + 1} ${pad(z)}Z`; };
const fLabel = minutes => `F${String(Math.floor(minutes / 60)).padStart(3, '0')}${minutes % 60 ? `:${pad(minutes % 60)}` : ''}`;

// --- Loading.
async function loadBase() {
  const [surface, counties] = await Promise.all([getJson('/api/atmosphere/surface', { keep: false }), getJson('/api/map/counties', { keep: false })]);
  if (surface?.domain) { domain = surface.domain; localOffset = surface.localOffsetHours ?? localOffset; }
  if (counties && domain) {
    const k = domain.widthKm / counties.miles;
    base = { counties: counties.counties.map(c => c.rings.map(ring => ring.map(([x, y]) => [x * k, y * k]))), towns: counties.towns.filter(tw => tw.kind !== 'town' || tw.population >= 20000).sort((a, b) => b.population - a.population).slice(0, 14).map(tw => ({ ...tw, x: tw.x * k, y: tw.y * k })) };
  }
}

async function loadRuns() {
  if (modelKind === 'short') {
    const list = await getJson('/api/models/short-range/runs', { keep: false });
    S.runs = (list?.runs ?? []).filter(r => !r.failed);
    const note = list?.running ? `Run ${runName(list.running.initHourUtc)} (${list.running.hours} h) is being worked out.` : S.runs.length ? '' : 'The first run is being worked out.';
    $('runNote').textContent = note || `${S.runs.length} runs kept. Hours shared with the live world are underlined green.`;
    fillRunSelect(S.runs.map(r => [r.initHourUtc, `${runName(r.initHourUtc)} · ${r.hours} h`]), S.init);
    const want = $('followLatest').checked || S.init === null ? S.runs.at(-1)?.initHourUtc ?? null : S.init;
    if (want !== null && want !== S.init) await openShortRun(want);
  } else {
    const list = await getJson('/api/models/ensemble/runs', { keep: false });
    E.issues = list?.issues ?? [];
    $('runNote').textContent = list?.running ? `The outlook issued ${runName(list.running.issuedHourUtc)} is being worked out.` : E.issues.length ? `${E.issues.at(-1).runs} runs (${E.issues.at(-1).full} full, the rest cheap) in the newest.` : 'No outlook has been issued on this world yet.';
    fillRunSelect(E.issues.map(i => [i.issuedHourUtc, `Outlook ${runName(i.issuedHourUtc)} · ${i.runs} runs`]), E.issued);
    const want = $('followLatest').checked || E.issued === null ? E.issues.at(-1)?.issuedHourUtc ?? null : E.issued;
    if (want !== null && want !== E.issued) await openEnsemble(want);
  }
}

function fillRunSelect(options, current) {
  const select = $('runSelect'), html = options.slice().reverse().map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  if (select.dataset.html !== html) { select.innerHTML = html || '<option value="">No runs yet</option>'; select.dataset.html = html; }
  if (current !== null) select.value = String(current);
}

async function openShortRun(init) {
  const meta = await getJson(`/api/models/short-range/run?init=${init}`, { keep: false });
  if (!meta) return;
  const tracks = await getJson(`/api/models/short-range/tracks?init=${init}`);
  S.init = init; S.meta = meta; S.tracks = tracks?.tracks ?? [];
  S.byStorm = new Map();
  for (const p of S.tracks) { if (!S.byStorm.has(p.id)) S.byStorm.set(p.id, []); S.byStorm.get(p.id).push(p); }
  for (const list of S.byStorm.values()) list.sort((a, b) => a.minute - b.minute);
  $('runSelect').value = String(init);
  fillProducts(); setTimeRange(); render();
}

async function openEnsemble(issued) {
  const data = await getJson(`/api/models/ensemble/tracks?issued=${issued}`);
  if (!data) return;
  E.issued = issued; E.data = data;
  // Each run's storms: storm number -> points in time order ({ h, x, y, dbz, uh, tor }).
  E.byRun = data.runs.map(run => {
    const storms = new Map();
    for (const [h, id, x, y, dbz, uh, tor] of run.track) { if (!storms.has(id)) storms.set(id, []); storms.get(id).push({ h, x, y, dbz, uh, tor }); }
    for (const list of storms.values()) list.sort((a, b) => a.h - b.h);
    return { full: run.cheap === null, storms };
  });
  $('runSelect').value = String(issued);
  fillProducts(); setTimeRange(); render();
}

// --- Controls.
function fillProducts() {
  const list = modelKind === 'short' ? [...STORM_PRODUCTS, ...(S.meta?.parameters ?? [])] : ENSEMBLE_PRODUCTS;
  if (!list.some(p => p.key === productKey)) productKey = list[0].key;
  let html = '', group = null;
  for (const p of list) {
    if (p.group !== group) { group = p.group; html += `<h4>${group}</h4>`; }
    html += `<button data-key="${p.key}" class="${p.key === productKey ? 'on' : ''}">${p.label}</button>`;
  }
  $('productList').innerHTML = html;
  $('aboutNote').textContent = modelKind === 'short'
    ? 'One run from the live world each simulated hour, 18 hours ahead (48 at 00, 06, 12 and 18Z). For its first 3 hours it takes the same chances as the live world, so those hours come out as they will happen; after that it is one possible outcome, good for where storms will be, not for which storm makes a tornado. Reflectivity is drawn from each storm\'s rain area; updraft helicity is the updraft times the mid-level rotation.'
    : 'Every run behind the latest outlook: the full runs and their cheap runs, which share a full run\'s air but take their own chances with the storms. Where many runs agree, the outlook is surer. Chances are the share of runs with the event within 25 miles, like the outlooks.';
}

function setTimeRange() {
  const slider = $('timeSlider'), step = stepMinutes(), max = maxMinutes();
  slider.max = String(max); slider.step = String(step);
  t = Math.min(max, Math.round(t / step) * step); slider.value = String(t);
  const strip = $('hourStrip'), hours = Math.floor(max / 60), shared = modelKind === 'short' ? (S.meta?.shareHours ?? 0) : 0;
  const every = hours > 24 ? 3 : 1, html = [];
  for (let h = 0; h <= hours; h += every) html.push(`<button data-hour="${h}" class="${h < shared ? 'shared' : ''}">${String(h).padStart(2, '0')}</button>`);
  strip.innerHTML = html.join('');
  markTime();
}

function markTime() {
  $('timeSlider').value = String(t); $('timeLabel').textContent = fLabel(t);
  for (const b of $('hourStrip').children) b.classList.toggle('on', Number(b.dataset.hour) === Math.floor(t / 60));
}

function setTime(minutes) { const step = stepMinutes(); t = Math.max(0, Math.min(maxMinutes(), Math.round(minutes / step) * step)); markTime(); render(); }

$('modelShort').onclick = () => switchModel('short');
$('modelEnsemble').onclick = () => switchModel('ensemble');
async function switchModel(kind) {
  if (kind === modelKind) return;
  stopPlay(); modelKind = kind; productKey = kind === 'short' ? 'refl' : 'paint'; t = 0;
  $('modelShort').classList.toggle('on', kind === 'short'); $('modelEnsemble').classList.toggle('on', kind === 'ensemble');
  $('runSelect').dataset.html = '';
  fillProducts(); setTimeRange(); render();
  await loadRuns();
}
$('runSelect').onchange = event => { const v = Number(event.target.value); $('followLatest').checked = false; stopPlay(); (modelKind === 'short' ? openShortRun : openEnsemble)(v); };
$('productList').onclick = event => { const key = event.target.dataset?.key; if (!key) return; productKey = key; for (const b of $('productList').querySelectorAll('button')) b.classList.toggle('on', b.dataset.key === key); setTimeRange(); render(); };
$('timeSlider').oninput = event => { stopPlay(); setTime(Number(event.target.value)); };
$('hourStrip').onclick = event => { const h = event.target.dataset?.hour; if (h !== undefined) { stopPlay(); setTime(Number(h) * 60); } };
$('stepBack').onclick = () => { stopPlay(); setTime(t - stepMinutes()); };
$('stepNext').onclick = () => { stopPlay(); setTime(t + stepMinutes()); };
$('play').onclick = () => (playing ? stopPlay() : startPlay());
for (const id of ['overlayRefl', 'showCounties', 'showContours']) $(id).onchange = () => render();
window.addEventListener('keydown', event => {
  if (event.target.tagName === 'SELECT' || event.target.tagName === 'INPUT' && event.target.type !== 'range' && event.target.type !== 'checkbox') return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); stopPlay(); setTime(t - stepMinutes()); }
  else if (event.key === 'ArrowRight') { event.preventDefault(); stopPlay(); setTime(t + stepMinutes()); }
  else if (event.key === ' ') { event.preventDefault(); playing ? stopPlay() : startPlay(); }
});
function startPlay() {
  $('play').classList.add('on'); $('play').textContent = 'Stop';
  let busy = false;
  playing = setInterval(async () => { if (busy) return; busy = true; const next = t + stepMinutes(); t = next > maxMinutes() ? 0 : next; markTime(); await render(); busy = false; }, PLAY_MS);
}
function stopPlay() { if (playing) { clearInterval(playing); playing = null; } $('play').classList.remove('on'); $('play').textContent = 'Play'; }

// --- What the current picture needs.
async function render() {
  const mine = ++token;
  shown = { field: null, storms: null };
  if (modelKind === 'short' && S.meta) {
    const hour = Math.floor(t / 60);
    const wantsStorms = productKey === 'refl' || (isField() && $('overlayRefl').checked);
    const [field, storms] = await Promise.all([
      isField() ? getJson(`/api/models/short-range/field?init=${S.init}&hour=${hour}&key=${productKey}`) : null,
      wantsStorms || !isField() ? getJson(`/api/models/short-range/storms?init=${S.init}&minute=${isField() ? hour * 60 : t}`) : null
    ]);
    if (mine !== token) return;
    shown = { field: field ? { ...field, meta: product() } : null, storms: storms?.storms ?? null };
    // Have the next frames ready for playing.
    const ahead = t + stepMinutes();
    if (ahead <= maxMinutes()) {
      if (isField()) getJson(`/api/models/short-range/field?init=${S.init}&hour=${Math.floor(ahead / 60)}&key=${productKey}`);
      if (wantsStorms) getJson(`/api/models/short-range/storms?init=${S.init}&minute=${isField() ? Math.floor(ahead / 60) * 60 : ahead}`);
    }
  }
  draw();
}

// --- Drawing.
function resize() {
  const ratio = window.devicePixelRatio || 1, box = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(box.width * ratio)); canvas.height = Math.max(1, Math.round(box.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  draw();
}

function draw() {
  const box = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, box.width, box.height);
  const ready = domain && (modelKind === 'short' ? S.meta : E.data);
  drawTitle();
  if (!ready) { ctx.fillStyle = '#96a5b7'; ctx.font = '15px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(modelKind === 'short' ? 'Waiting for the first run…' : 'Waiting for an outlook…', box.width / 2, box.height / 2); drawLegend(); return; }
  const size = Math.max(50, Math.min(box.width, box.height) - 4), left = (box.width - size) / 2, top = (box.height - size) / 2;
  view = { left, top, size, k: size / domain.widthKm };
  ctx.save();
  ctx.beginPath(); ctx.rect(left, top, size, size); ctx.clip();
  ctx.fillStyle = '#121a23'; ctx.fillRect(left, top, size, size);
  if (modelKind === 'short') drawShort(); else drawEnsemble();
  ctx.restore();
  ctx.strokeStyle = '#2c3948'; ctx.lineWidth = 1; ctx.strokeRect(left + 0.5, top + 0.5, size - 1, size - 1);
  const bar = 100 * MILE_KM * view.k;
  ctx.strokeStyle = ctx.fillStyle = '#cbd5e1'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(left + 14, top + size - 14); ctx.lineTo(left + 14 + bar, top + size - 14); ctx.stroke();
  ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; halo('100 miles', left + 14, top + size - 22);
  drawLegend();
}

const px = (x, y) => [view.left + x * view.k, view.top + y * view.k];
function halo(text, x, y, colour = '#e2e8f0') { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,12,18,.9)'; ctx.strokeText(text, x, y); ctx.fillStyle = colour; ctx.fillText(text, x, y); }

function drawTitle() {
  const p = product(), start = startHour();
  if (modelKind === 'short') $('mapTitle').textContent = S.meta ? `Short range model · ${runName(start)} · ${fLabel(isField() ? Math.floor(t / 60) * 60 : t)} · ${p?.label ?? ''}` : 'Short range model';
  else $('mapTitle').textContent = E.data ? `Outlook ensemble (${E.data.runs.length} runs) · ${runName(start)} · ${fLabel(t)} · ${p?.label ?? ''}` : 'Outlook ensemble';
  $('mapValid').textContent = (modelKind === 'short' ? S.meta : E.data) ? `Valid ${clock(start + (isField() ? Math.floor(t / 60) : t / 60))}${modelKind === 'short' && t < (S.meta.shareHours ?? 0) * 60 ? ' · same as the live world' : ''}` : '';
}

function drawBaseLines() {
  if (!base || !$('showCounties').checked) return;
  ctx.save(); ctx.strokeStyle = 'rgba(148,163,184,.32)'; ctx.lineWidth = 0.7; ctx.beginPath();
  for (const rings of base.counties) for (const ring of rings) ring.forEach(([x, y], i) => { const [a, b] = px(x, y); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); });
  ctx.stroke(); ctx.restore();
}
function drawTowns() {
  if (!base || !$('showCounties').checked) return;
  ctx.save(); ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (const tw of base.towns) { const [x, y] = px(tw.x, tw.y); ctx.fillStyle = '#f1f5f9'; ctx.beginPath(); ctx.arc(x, y, tw.kind === 'metro' ? 3.5 : 2.5, 0, Math.PI * 2); ctx.fill(); halo(tw.name, x + 5, y); }
  ctx.restore();
}

// Short range pictures.
function drawShort() {
  const field = shown.field;
  if (field) { drawFieldShading(field); }
  drawBaseLines();
  if (field && $('showContours').checked) { drawContours(field.values, field.meta.levels ?? [], 'rgba(255,255,255,.75)', field.meta.decimals ?? 0); if (field.second) drawContours(field.second, field.meta.second?.levels ?? [], field.meta.second?.colour ?? '#ffd166', 0, [6, 4]); }
  if (field?.barbs) for (const b of field.barbs) { const [x, y] = px(b.xKm, b.yKm); drawBarb(x, y, b.windKt, b.windFromDeg); }
  if (shown.storms && (productKey === 'refl' || (field && $('overlayRefl').checked))) drawRaster(reflRaster(shown.storms, `${S.init}:${isField() ? Math.floor(t / 60) * 60 : t}`), field ? 0.9 : 1);
  if (productKey === 'uh1') drawUhTracks(t - 60, t);
  if (productKey === 'uhTotal') drawUhTracks(-1, t);
  if (productKey === 'torTracks') { drawUhTracks(-1, t, 0.35); drawTornadoTracks(t); }
  drawTowns();
  if (!isField() && shown.storms) for (const s of shown.storms) if (s.tornado) { const [x, y] = px(s.tornado.x, s.tornado.y); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke(); }
}

function colourAt(meta, value) {
  const stops = meta.shade;
  if (!stops?.length) return [0, 0, 0, 0];
  if (value <= stops[0][0]) return meta.shadeBelowFirst ? stops[0].slice(1) : [stops[0][1], stops[0][2], stops[0][3], 0];
  for (let i = 1; i < stops.length; i++) if (value <= stops[i][0]) { const a = stops[i - 1], b = stops[i], f = (value - a[0]) / (b[0] - a[0]); return [1, 2, 3, 4].map(c => a[c] + (b[c] - a[c]) * f); }
  return stops.at(-1).slice(1);
}
function drawFieldShading(field) {
  const id = `field:${S.init}:${field.hour}:${field.key}`, { columns, rows } = domain;
  let image = rasters.get(id);
  if (!image) {
    image = document.createElement('canvas'); image.width = columns; image.height = rows;
    const g = image.getContext('2d'), data = g.createImageData(columns, rows);
    for (let i = 0; i < field.values.length; i++) { const [r, gr, b, a] = colourAt(field.meta, field.values[i]); data.data.set([r, gr, b, a * 255], i * 4); }
    g.putImageData(data, 0, 0); keepRaster(id, image);
  }
  const cell = view.size / columns;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, view.left - cell / 2, view.top - cell / 2, view.size + cell, view.size + cell);
}
function keepRaster(id, image) { rasters.set(id, image); if (rasters.size > 160) rasters.delete(rasters.keys().next().value); }
function drawRaster(image, alpha = 1) { ctx.save(); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(image, view.left, view.top, view.size, view.size); ctx.restore(); }

function drawContours(values, levels, colour, decimals, dash = []) {
  const { columns, rows, cellKm } = domain, km = v => (v + 0.5) * cellKm;
  ctx.save(); ctx.lineWidth = 1.2; ctx.strokeStyle = colour; ctx.setLineDash(dash);
  ctx.font = '700 10.5px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const labels = [];
  for (const level of levels) {
    ctx.beginPath();
    let best = Infinity, label = null, count = 0;
    for (let y = 0; y < rows - 1; y++) for (let x = 0; x < columns - 1; x++) {
      const a = values[y * columns + x], b = values[y * columns + x + 1], c = values[(y + 1) * columns + x + 1], d = values[(y + 1) * columns + x], cross = [];
      const edge = (v1, v2, x1, y1, x2, y2) => { if ((v1 < level) !== (v2 < level)) { const f = (level - v1) / (v2 - v1); cross.push(px(km(x1 + (x2 - x1) * f), km(y1 + (y2 - y1) * f))); } };
      edge(a, b, x, y, x + 1, y); edge(b, c, x + 1, y, x + 1, y + 1); edge(d, c, x, y + 1, x + 1, y + 1); edge(a, d, x, y, x, y + 1);
      for (let i = 0; i + 1 < cross.length; i += 2) {
        ctx.moveTo(cross[i][0], cross[i][1]); ctx.lineTo(cross[i + 1][0], cross[i + 1][1]); count++;
        const mx = (cross[i][0] + cross[i + 1][0]) / 2, my = (cross[i][1] + cross[i + 1][1]) / 2;
        const score = Math.abs((mx - view.left) / view.size - 0.5) + Math.abs((my - view.top) / view.size - 0.5) + (labels.some(l => Math.hypot(l[0] - mx, l[1] - my) < 44) ? 10 : 0);
        if (score < best) { best = score; label = [mx, my]; }
      }
    }
    ctx.stroke();
    if (label && count > 3 && best < 10) { labels.push(label); const text = Number(level.toFixed(decimals)).toLocaleString(), w = ctx.measureText(text).width + 6; ctx.setLineDash([]); ctx.fillStyle = 'rgba(16,24,34,.9)'; ctx.fillRect(label[0] - w / 2, label[1] - 7, w, 14); ctx.fillStyle = colour; ctx.fillText(text, label[0], label[1]); ctx.setLineDash(dash); }
  }
  ctx.restore();
}

function drawBarb(x, y, speed, fromDeg) {
  const r = fromDeg * Math.PI / 180, dx = Math.sin(r), dy = -Math.cos(r), len = 22;
  ctx.save(); ctx.strokeStyle = ctx.fillStyle = '#9fd3ff'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y); const ex = x + dx * len, ey = y + dy * len; ctx.lineTo(ex, ey); ctx.stroke();
  let left = Math.round(speed / 5) * 5, along = 0;
  const nx = -dy, ny = dx, tick = (at, long) => { const bx = ex - dx * at, by = ey - dy * at; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + nx * long + dx * 4, by + ny * long + dy * 4); ctx.stroke(); };
  while (left >= 50) { const bx = ex - dx * along, by = ey - dy * along; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + nx * 9, by + ny * 9); ctx.lineTo(bx - dx * 5, by - dy * 5); ctx.fill(); along += 7; left -= 50; }
  while (left >= 10) { tick(along, 9); along += 4; left -= 10; }
  if (left >= 5) tick(along || 4, 5);
  ctx.restore();
}

// Simulated composite reflectivity: each storm's rain area as the radar would see it from above, its
// core near the updraft, a hook where the rain wraps round a rotating storm, and a line's leading edge
// with rain trailing behind. A small grain that moves with each storm keeps the edges from looking drawn.
const REFL_KM = 2;
function hash(i, j, s) { let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 2246822519); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function noise(x, y, s) { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); const a = hash(i, j, s), b = hash(i + 1, j, s), c = hash(i, j + 1, s), d = hash(i + 1, j + 1, s); return (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * 2 - 1; }
function stormDbz(s, x, y, seed) {
  const peak = Math.max(20, s.dbz), grain = 0.6 * noise((x - s.x) / 5, (y - s.y) / 5, seed) + 0.4 * noise((x - s.x) / 2, (y - s.y) / 2, seed + 7);
  let dbz = 0;
  const rain = s.rain;
  if (rain) {
    const b = rain.bearingDeg * Math.PI / 180, ax = Math.sin(b), ay = -Math.cos(b), dx = x - rain.xKm, dy = y - rain.yKm;
    const along = (dx * ax + dy * ay) / (rain.alongKm / 2), across = (-dx * ay + dy * ax) / (rain.acrossKm / 2), r2 = (along * along + across * across) * (1 + 0.28 * grain);
    if (r2 < 1) dbz = 16 + (peak - 24) * Math.pow(1 - r2, 0.75);
    // Light rain round the edges, wider downwind.
    else if (r2 < 2.4 + 0.8 * Math.max(0, along)) dbz = 15 + 9 * (1 - (r2 - 1) / (1.4 + 0.8 * Math.max(0, along))) + 2.5 * grain;
    // The core: between the updraft and the middle of the rain.
    const cx = s.x + (rain.xKm - s.x) * 0.35, cy = s.y + (rain.yKm - s.y) * 0.35, sigma = Math.max(2.5, rain.acrossKm * 0.17), d2 = (x - cx) ** 2 + (y - cy) ** 2;
    if (r2 < 1.15) dbz = Math.max(dbz, 16 + (peak - 16) * Math.exp(-d2 / (2 * sigma * sigma)) * (1 + 0.06 * grain));
    // The hook, on the right rear of the updraft as the storm moves.
    if (s.hook > 0.12) {
      const m = Math.hypot(s.east, s.north) || 1, mx = s.east / m, my = -s.north / m, hx = x - s.x, hy = y - s.y, d = Math.hypot(hx, hy);
      const ahead = (hx * mx + hy * my) / (d || 1), right = (hx * -my + hy * mx) / (d || 1), R = 3 + 4 * s.hook;
      if (Math.abs(d - R) < 1.6 && right > -0.2 && ahead < 0.55) dbz = Math.max(dbz, (30 + 22 * s.hook) * (1 - Math.abs(d - R) / 1.6 * 0.4) + 3 * grain);
    }
  } else {
    const d = Math.hypot(x - s.x, y - s.y);
    if (d < 7) dbz = 16 + (peak - 16) * (1 - d / 7);
  }
  // A line: a narrow leading edge along its axis, rain trailing behind it.
  const line = s.line;
  if (line && line.share > 0.35 && line.halfLengthKm > 3) {
    const b = line.axisBearingDeg * Math.PI / 180, ux = Math.sin(b), uy = -Math.cos(b), ox = (rain?.xKm ?? s.x), oy = (rain?.yKm ?? s.y);
    const m = Math.hypot(s.east, s.north) || 1, mx = s.east / m, my = -s.north / m;
    const along = (x - ox) * ux + (y - oy) * uy, out = Math.abs(along) / line.halfLengthKm;
    if (out < 1.1) {
      const bow = (line.bow ?? 0) * 12 * (1 - (along / line.halfLengthKm) ** 2), front = (x - ox) * mx + (y - oy) * my - bow, width = 3 + 4 * line.share, taper = Math.max(0, 1 - out ** 4);
      if (Math.abs(front) < width) dbz = Math.max(dbz, 20 + (peak - 22) * taper * (1 - Math.abs(front) / width) ** 0.6 + 3 * grain);
      if (front < 0 && front > -width * 7) dbz = Math.max(dbz, (22 + 12 * line.share) * taper * (1 + front / (width * 9)) + 4 * grain);
    }
  }
  return dbz;
}
function reflRaster(storms, id) {
  const key = `refl:${id}`;
  if (rasters.has(key)) return rasters.get(key);
  const n = Math.ceil(domain.widthKm / REFL_KM), dbz = new Float32Array(n * n);
  for (const s of storms) {
    const seed = Number(String(s.id).replace(/\D/g, '')) || 1;
    const reach = Math.max(10, (s.rain ? Math.max(s.rain.alongKm, s.rain.acrossKm) * 1.1 + Math.hypot(s.rain.xKm - s.x, s.rain.yKm - s.y) : 8) + 8, s.line?.share > 0.35 ? s.line.halfLengthKm * 1.1 + 30 : 0);
    const x0 = Math.max(0, Math.floor((s.x - reach) / REFL_KM)), x1 = Math.min(n - 1, Math.ceil((s.x + reach) / REFL_KM)), y0 = Math.max(0, Math.floor((s.y - reach) / REFL_KM)), y1 = Math.min(n - 1, Math.ceil((s.y + reach) / REFL_KM));
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) { const v = stormDbz(s, (i + 0.5) * REFL_KM, (j + 0.5) * REFL_KM, seed); if (v > dbz[j * n + i]) dbz[j * n + i] = v; }
  }
  const image = document.createElement('canvas'); image.width = image.height = n;
  const g = image.getContext('2d'), data = g.createImageData(n, n), lut = REFL.map(([at, c]) => [at, rgb(c)]);
  for (let i = 0; i < dbz.length; i++) { const v = dbz[i]; if (v < 15) continue; let c = lut[0][1]; for (const [at, col] of lut) if (v >= at) c = col; data.data.set([c[0], c[1], c[2], 235], i * 4); }
  g.putImageData(data, 0, 0); image.dbz = dbz; image.n = n; image.cellKm = REFL_KM;
  keepRaster(key, image);
  return image;
}

// Updraft helicity swaths: each storm's 5-minute points joined, the strongest drawn last.
function drawUhTracks(from, to, alpha = 1) {
  const segments = [];
  for (const points of S.byStorm?.values() ?? []) for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (b.minute <= from || b.minute > to || b.minute - a.minute > 6) continue;
    const uh = Math.max(a.uh, b.uh);
    if (uh >= UH[0][0]) segments.push([a, b, uh]);
  }
  segments.sort((p, q) => p[2] - q[2]);
  ctx.save(); ctx.globalAlpha = alpha; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(3, 7 * view.k);
  for (const [a, b, uh] of segments) { ctx.strokeStyle = stepColour(UH, uh); ctx.beginPath(); ctx.moveTo(...px(a.x, a.y)); ctx.lineTo(...px(b.x, b.y)); ctx.stroke(); }
  ctx.restore();
}
function drawTornadoTracks(to) {
  ctx.save(); ctx.lineCap = 'round';
  for (const points of S.byStorm?.values() ?? []) {
    const path = points.filter(p => p.tornado && p.minute <= to);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      if (b.minute - a.minute > 6) continue;
      const ef = Math.max(a.tornado.ef ?? 0, b.tornado.ef ?? 0);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(...px(a.tornado.x, a.tornado.y)); ctx.lineTo(...px(b.tornado.x, b.tornado.y)); ctx.stroke();
      ctx.strokeStyle = EF[Math.min(5, ef)]; ctx.lineWidth = 3; ctx.stroke();
    }
  }
  ctx.restore();
}

// Ensemble pictures.
function drawEnsemble() {
  drawBaseLines();
  const hourNow = E.data.issuedHourUtc + t / 60;
  if (productKey === 'paint') {
    E.byRun.forEach((run, r) => {
      ctx.fillStyle = runColour(r, run.full ? 0.6 : 0.45);
      for (const points of run.storms.values()) for (const p of points) if (p.dbz >= 40 && p.h > hourNow - 0.25 && p.h <= hourNow + 0.25) { const [x, y] = px(p.x, p.y); ctx.beginPath(); ctx.arc(x, y, Math.max(3, (6 + (p.dbz - 40) * 0.3) * view.k), 0, Math.PI * 2); ctx.fill(); }
    });
  } else if (productKey === 'spaghetti') {
    ctx.save(); ctx.lineCap = 'round';
    E.byRun.forEach((run, r) => {
      ctx.strokeStyle = runColour(r, 0.85); ctx.lineWidth = run.full ? 2.6 : 1.6;
      for (const points of run.storms.values()) for (let i = 1; i < points.length; i++) { const a = points[i - 1], b = points[i]; if (b.h > hourNow || b.h - a.h > 0.51 || Math.min(a.uh, b.uh) < UH_TRACK) continue; ctx.beginPath(); ctx.moveTo(...px(a.x, a.y)); ctx.lineTo(...px(b.x, b.y)); ctx.stroke(); }
    });
    ctx.restore();
  } else {
    const span = productKey === 'uhProb4' ? [hourNow - 4, hourNow] : [E.data.issuedHourUtc - 1, hourNow];
    const test = productKey === 'torProb' ? p => p.tor : p => p.uh >= UH_TRACK;
    drawRaster(probRaster(`${E.issued}:${productKey}:${t}`, span, test), 0.85);
  }
  drawTowns();
}

// The share of runs with the event within 25 miles of each place, on a grid of about 8 km, softened a little.
const PROB_CELLS = 100;
function probRaster(id, [from, to], test) {
  const key = `prob:${id}`;
  if (rasters.has(key)) return rasters.get(key);
  const n = PROB_CELLS, cellKm = domain.widthKm / n, reach = Math.ceil(NEAR_KM / cellKm), sum = new Float32Array(n * n), hit = new Uint8Array(n * n);
  const mark = (x, y) => { const ci = Math.floor(x / cellKm), cj = Math.floor(y / cellKm); for (let j = Math.max(0, cj - reach); j <= Math.min(n - 1, cj + reach); j++) for (let i = Math.max(0, ci - reach); i <= Math.min(n - 1, ci + reach); i++) if (Math.hypot((i + 0.5) * cellKm - x, (j + 0.5) * cellKm - y) <= NEAR_KM) hit[j * n + i] = 1; };
  for (const run of E.byRun) {
    hit.fill(0);
    for (const points of run.storms.values()) for (let i = 0; i < points.length; i++) {
      const b = points[i];
      if (b.h <= from || b.h > to || !test(b)) continue;
      mark(b.x, b.y);
      const a = points[i - 1];
      if (a && b.h - a.h <= 0.51 && test(a)) { const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (cellKm * 0.8)); for (let s = 1; s < steps; s++) mark(a.x + (b.x - a.x) * s / steps, a.y + (b.y - a.y) * s / steps); }
    }
    for (let i = 0; i < hit.length; i++) sum[i] += hit[i];
  }
  const share = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { let s = 0, w = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const jj = j + dj, ii = i + di; if (jj < 0 || ii < 0 || jj >= n || ii >= n) continue; const k = di || dj ? 1 : 2; s += sum[jj * n + ii] * k; w += k; } share[j * n + i] = 100 * s / w / E.byRun.length; }
  // Drawn four times finer, each pixel read smoothly between the cell centres, so the bands have no steps.
  const up = 4, m = n * up, image = document.createElement('canvas'); image.width = image.height = m;
  const g = image.getContext('2d'), data = g.createImageData(m, m), lut = PROB.map(([at, c]) => [at, rgb(c)]);
  for (let py = 0; py < m; py++) for (let qx = 0; qx < m; qx++) {
    const fx = Math.max(0, Math.min(n - 1.001, (qx + 0.5) / up - 0.5)), fy = Math.max(0, Math.min(n - 1.001, (py + 0.5) / up - 0.5)), i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j;
    const v = share[j * n + i] * (1 - a) * (1 - b) + share[j * n + i + 1] * a * (1 - b) + share[(j + 1) * n + i] * (1 - a) * b + share[(j + 1) * n + i + 1] * a * b;
    let c = null; for (const [at, col] of lut) if (v >= at) c = col;
    if (c) data.data.set([c[0], c[1], c[2], 205], (py * m + qx) * 4);
  }
  g.putImageData(data, 0, 0); image.share = share; image.n = n; image.cellKm = cellKm;
  keepRaster(key, image);
  return image;
}

// --- Legend.
function drawLegend() {
  const bar = $('legendBar'), g = bar.getContext('2d'), ticks = $('legendTicks'), note = $('legendNote'), p = product();
  g.clearRect(0, 0, bar.width, bar.height); ticks.innerHTML = ''; note.textContent = '';
  const tick = (text, at) => { const s = document.createElement('span'); s.textContent = text; s.style.left = `${at * 100}%`; ticks.append(s); };
  if (!p) return;
  if (isField() && shown.field) {
    const meta = shown.field.meta, from = meta.shade[0][0], to = meta.shade.at(-1)[0];
    g.fillStyle = '#121a23'; g.fillRect(0, 0, bar.width, bar.height);
    for (let x = 0; x < bar.width; x++) { const [r, gr, b, a] = colourAt(meta, from + (to - from) * x / (bar.width - 1)); g.fillStyle = `rgba(${r | 0},${gr | 0},${b | 0},${Math.max(0.12, a)})`; g.fillRect(x, 0, 1, bar.height); }
    for (const f of [0, 0.25, 0.5, 0.75, 1]) tick(Number((from + (to - from) * f).toFixed(meta.decimals)).toLocaleString(), f);
    note.textContent = `${meta.label}${meta.unit ? ` (${meta.unit})` : ''}${meta.second ? ` · dashed: ${meta.second.label} (${meta.second.unit})` : ''}${$('overlayRefl').checked ? ' · with simulated reflectivity' : ''}`;
    return;
  }
  const table = p.table ?? (p.key === 'torTracks' ? EF.map((c, i) => [i, c]) : null);
  if (table) {
    const w = bar.width / table.length;
    table.forEach(([at, c], i) => { g.fillStyle = c; g.fillRect(i * w, 0, w + 1, bar.height); tick(p.key === 'torTracks' ? `EF${at}` : String(at), (i + 0.5) / table.length); });
    note.textContent = `${p.label}${p.unit && p.key !== 'torTracks' ? ` (${p.unit})` : ''}${p.key === 'torTracks' ? ' · faint: updraft helicity tracks' : ''}`;
  } else if (p.key === 'paint' || p.key === 'spaghetti') {
    const runs = E.byRun?.length ?? 0, w = bar.width / Math.max(1, runs);
    for (let r = 0; r < runs; r++) { g.fillStyle = runColour(r); g.fillRect(r * w, 0, w + 1, bar.height); }
    tick('each colour is one run', 0.5);
    note.textContent = `${p.label} · the full runs are drawn stronger`;
  }
}

// --- Readout under the cursor.
canvas.addEventListener('mousemove', event => {
  if (!view) return;
  const rect = canvas.getBoundingClientRect(), mx = event.clientX - rect.left, my = event.clientY - rect.top;
  const x = (mx - view.left) / view.k, y = (my - view.top) / view.k;
  if (x < 0 || y < 0 || x > domain.widthKm || y > domain.heightKm) { tip.style.display = 'none'; return; }
  const lines = [];
  if (modelKind === 'short') {
    if (shown.field) { const v = fieldAt(shown.field.values, x, y), m = shown.field.meta; lines.push(`${m.label}: <b>${Number(v.toFixed(m.decimals)).toLocaleString()}</b> ${m.unit ?? ''}`); }
    const image = rasters.get(`refl:${S.init}:${isField() ? Math.floor(t / 60) * 60 : t}`);
    if (image && (productKey === 'refl' || (isField() && $('overlayRefl').checked))) { const v = image.dbz[Math.floor(y / image.cellKm) * image.n + Math.floor(x / image.cellKm)] ?? 0; if (v >= 15) lines.push(`Reflectivity: <b>${Math.round(v)}</b> dBZ`); }
    const near = (shown.storms ?? []).map(s => [s, Math.hypot(s.x - x, s.y - y)]).filter(([, d]) => d < 15).sort((a, b) => a[1] - b[1])[0]?.[0];
    if (near) lines.push(`<b>${near.id}</b> · ${near.mode ?? 'storm'} · ${near.dbz} dBZ · UH ${near.uh}${near.hailIn >= 0.75 ? ` · hail ${near.hailIn.toFixed(2)} in` : ''}${near.tornado ? ` · <b style="color:#ff6b6b">tornado</b> ${near.tornado.mph} mph` : ''}`);
  } else if (!['paint', 'spaghetti'].includes(productKey)) {
    const image = rasters.get(`prob:${E.issued}:${productKey}:${t}`);
    if (image) lines.push(`Chance: <b>${Math.round(image.share[Math.floor(y / image.cellKm) * image.n + Math.floor(x / image.cellKm)] ?? 0)}%</b> of ${E.byRun.length} runs`);
  }
  lines.push(`<span class="muted">${Math.round(x / MILE_KM)} mi east, ${Math.round(y / MILE_KM)} mi south of the north-west corner</span>`);
  tip.innerHTML = lines.join('<br>'); tip.style.display = 'block';
  tip.style.left = `${Math.min(mx + 14, rect.width - tip.offsetWidth - 4)}px`; tip.style.top = `${Math.min(my + 14, rect.height - tip.offsetHeight - 4)}px`;
});
canvas.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
function fieldAt(values, x, y) {
  const { columns, rows, cellKm } = domain, fx = Math.max(0, Math.min(columns - 1.001, x / cellKm - 0.5)), fy = Math.max(0, Math.min(rows - 1.001, y / cellKm - 0.5));
  const i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j, v = (ii, jj) => values[jj * columns + ii];
  return v(i, j) * (1 - a) * (1 - b) + v(i + 1, j) * a * (1 - b) + v(i, j + 1) * (1 - a) * b + v(i + 1, j + 1) * a * b;
}

// --- Start.
new ResizeObserver(resize).observe(canvas);
fillProducts(); setTimeRange();
(async function start() {
  // ?model=ensemble&product=<key>&t=<minutes> opens the page there.
  const ask = new URLSearchParams(location.search);
  await loadBase();
  if (ask.get('model') === 'ensemble') await switchModel('ensemble'); else await loadRuns();
  if (ask.get('product')) { productKey = ask.get('product'); fillProducts(); setTimeRange(); }
  if (ask.get('t')) setTime(Number(ask.get('t'))); else render();
  draw();
  setInterval(async () => { await loadRuns(); if (!base || !domain) await loadBase(); }, REFRESH_MS);
})();

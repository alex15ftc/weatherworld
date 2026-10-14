// The mesoscale page: the watches and mesoscale discussions issued for the live world, newest
// first; the chosen one's area on the map with the others still valid; and its text.
// Everything shown is what the server issued (GET /api/mesoscale); nothing is worked out here
// but the drawing.
const $ = id => document.getElementById(id);
const canvas = $('mdCanvas'), ctx = canvas.getContext('2d');
// Watches: red for a tornado watch, blue for a severe thunderstorm watch. Discussions: grey,
// amber and orange as a watch goes from unlikely to likely; one about a watch takes its colour.
const WATCH_COLOUR = type => (type === 'tornado' ? '#ef4444' : '#3b82f6');
const COLOUR = md => (md.watchNumber ? WATCH_COLOUR(md.watchType) : md.watchPercent >= 80 ? '#f97316' : md.watchPercent >= 40 ? '#f59e0b' : '#94a3b8');

let data = null, chosen = null;   // chosen: 'watch:3' or 'md:12'

const clock = hour => { const h = ((hour % 24) + 24) % 24, hh = Math.floor(h + 1e-9), mm = Math.round((h - hh) * 60); return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}Z`; };
const number = md => `MD ${String(md.number).padStart(4, '0')}`;
const watchKey = watch => `watch:${watch.number}`, mdKey = md => `md:${md.number}`;
const short = watch => `${watch.pds ? 'PDS ' : ''}${watch.type === 'tornado' ? 'TOR' : 'SVR'} ${watch.number}`;

function pathOf(rings, side) {
  const path = new Path2D();
  for (const ring of rings) { ring.forEach(([x, y], k) => (k ? path.lineTo(x * side, y * side) : path.moveTo(x * side, y * side))); path.closePath(); }
  return path;
}

function label(text, rings, side, colour, bold) {
  const points = rings.flat();
  if (!points.length) return;
  const cx = points.reduce((a, p) => a + p[0], 0) / points.length * side, cy = points.reduce((a, p) => a + p[1], 0) / points.length * side;
  ctx.font = `700 ${bold ? 14 : 12}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = 'rgba(11,17,25,.9)'; ctx.fillRect(cx - w / 2, cy - 10, w, 20); ctx.fillStyle = colour; ctx.fillText(text, cx, cy + 0.5);
}

function draw() {
  const box = canvas.parentElement.getBoundingClientRect(), side = Math.max(240, Math.floor(Math.min(box.width - 24, box.height - 24))), scale = window.devicePixelRatio || 1;
  canvas.style.width = canvas.style.height = `${side}px`; canvas.width = canvas.height = Math.round(side * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#0b1119'; ctx.fillRect(0, 0, side, side);
  ctx.strokeStyle = 'rgba(148,163,184,.16)'; ctx.lineWidth = 1; for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.moveTo(k * side / 5, 0); ctx.lineTo(k * side / 5, side); ctx.moveTo(0, k * side / 5); ctx.lineTo(side, k * side / 5); ctx.stroke(); }
  const watches = (data?.watches ?? []).filter(watch => watch.valid || watchKey(watch) === chosen), waiting = data?.watchesPending ?? [];
  const discussions = (data?.discussions ?? []).filter(md => md.valid || mdKey(md) === chosen);
  if (!watches.length && !discussions.length && !waiting.length) {
    ctx.fillStyle = '#9ca3af'; ctx.font = '600 15px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(!data ? 'Loading…' : data.enabled === false ? 'Watches and mesoscale discussions are turned off on this server.' : 'No watches or mesoscale discussions are in effect.', side / 2, side / 2);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, side, side); ctx.clip(); ctx.lineJoin = 'round';
  // Watches underneath (filled, heavy outline; a PDS watch with a second outline inside it),
  // the chosen one last; a watch waiting for its storms as a faint broken outline.
  for (const draft of waiting) { ctx.globalAlpha = 0.55; ctx.strokeStyle = WATCH_COLOUR(draft.type); ctx.lineWidth = 2; ctx.setLineDash([3, 6]); ctx.stroke(pathOf(draft.rings, side)); }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  for (const watch of [...watches].sort((a, b) => (watchKey(a) === chosen) - (watchKey(b) === chosen))) {
    const path = pathOf(watch.rings, side), colour = WATCH_COLOUR(watch.type), mine = watchKey(watch) === chosen;
    ctx.globalAlpha = mine ? 0.26 : 0.13; ctx.fillStyle = colour; ctx.fill(path, 'evenodd');
    ctx.globalAlpha = watch.valid ? 1 : 0.5; ctx.strokeStyle = colour; ctx.lineWidth = mine ? 4.5 : 3; ctx.setLineDash(watch.valid ? [] : [8, 6]); ctx.stroke(path);
    if (watch.pds) { ctx.strokeStyle = '#f0abfc'; ctx.lineWidth = 1.2; ctx.stroke(path); }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  // Discussions on top: a thin outline, the chosen one filled.
  for (const md of [...discussions].sort((a, b) => (mdKey(a) === chosen) - (mdKey(b) === chosen))) {
    const path = pathOf(md.rings, side), colour = COLOUR(md), mine = mdKey(md) === chosen;
    if (mine) { ctx.globalAlpha = 0.22; ctx.fillStyle = colour; ctx.fill(path, 'evenodd'); }
    ctx.globalAlpha = md.valid ? 1 : 0.5; ctx.strokeStyle = colour; ctx.lineWidth = mine ? 2.5 : 1.5; ctx.setLineDash(md.valid ? [5, 3] : [2, 5]); ctx.stroke(path);
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  for (const watch of watches) label(short(watch), watch.rings, side, WATCH_COLOUR(watch.type), watchKey(watch) === chosen);
  // A discussion's number sits at the top of its outline, clear of a watch's name in the middle.
  for (const md of discussions) { const top = md.rings.flat().reduce((best, p) => (p[1] < best[1] ? p : best), [0.5, 1]); label(String(md.number).padStart(4, '0'), [[[top[0], top[1] + 14 / side]]], side, COLOUR(md), mdKey(md) === chosen); }
  ctx.restore(); ctx.textBaseline = 'alphabetic';
  ctx.strokeStyle = '#475569'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, side - 1, side - 1);
  ctx.fillStyle = '#cbd5e1'; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('N ↑', 8, 16);
  if (data?.width) { ctx.textAlign = 'right'; ctx.fillText(`grid lines every ${Math.round(data.width * data.cellMiles / 5)} miles`, side - 8, side - 8); }
}

function item(list, key, valid, html) {
  const button = document.createElement('button');
  button.className = `md-item${key === chosen ? ' on' : ''}${valid ? '' : ' lapsed'}`;
  button.innerHTML = html;
  button.addEventListener('click', () => { chosen = key; renderSide(); draw(); });
  list.append(button);
}

function renderSide() {
  const watches = data?.watches ?? [], discussions = data?.discussions ?? [], waiting = data?.watchesPending ?? [];
  const keys = [...watches.map(watchKey), ...discussions.map(mdKey)];
  if (chosen === null || !keys.includes(chosen)) { const first = watches.find(w => w.valid) ?? discussions.find(md => md.valid) ?? watches[0] ?? discussions[0]; chosen = first ? (first.type ? watchKey(first) : mdKey(first)) : null; }
  const inEffect = watches.filter(w => w.valid).length, valid = discussions.filter(md => md.valid).length;
  $('status').textContent = !data ? '—' : data.enabled === false ? 'Turned off' : `${inEffect} watch${inEffect === 1 ? '' : 'es'} · ${valid} discussion${valid === 1 ? '' : 's'} · ${clock(data.nowHourUtc)}${data.running ? ' · looking ahead…' : ''}`;
  const watchList = $('watchList'), list = $('mdList');
  watchList.innerHTML = ''; list.innerHTML = '';
  for (const draft of waiting) watchList.insertAdjacentHTML('beforeend', `<p class="muted waiting"><b style="color:${WATCH_COLOUR(draft.type)}">${draft.pds ? 'PDS ' : ''}${draft.type === 'tornado' ? 'Tornado' : 'Severe thunderstorm'} watch</b> to be issued when storms fire over ${draft.where ?? 'part of the region'}.</p>`);
  for (const watch of watches) item(watchList, watchKey(watch), watch.valid, `<b style="color:${WATCH_COLOUR(watch.type)}">${short(watch)}</b><span>${watch.pds ? 'particularly dangerous situation' : watch.type === 'tornado' ? 'tornado watch' : 'severe thunderstorm watch'}</span><small>${clock(watch.issuedHourUtc)}–${clock(watch.validToHourUtc)}${watch.valid ? '' : ' · expired'}</small>`);
  if (!watches.length && !waiting.length) watchList.innerHTML = '<p class="muted">None issued yet. A watch goes out when storms begin to fire in an area that calls for one.</p>';
  for (const md of discussions) item(list, mdKey(md), md.valid, `<b style="color:${COLOUR(md)}">${number(md)}</b><span>${md.watchNumber ? md.concerning.toLowerCase() : `${md.concerning.replace('SEVERE POTENTIAL...', '').toLowerCase()} · ${md.watchPercent}%`}</span><small>${clock(md.issuedHourUtc)}–${clock(md.validToHourUtc)}${md.valid ? '' : ' · lapsed'}</small>`);
  if (!discussions.length) list.innerHTML = '<p class="muted">None issued yet. The world is looked at once in each of its hours.</p>';
  const watch = watches.find(w => watchKey(w) === chosen), md = discussions.find(d => mdKey(d) === chosen), shown = watch ?? md;
  $('textTitle').textContent = watch ? 'Watch' : 'Discussion';
  $('mdText').textContent = shown ? shown.text : data?.error ?? '';
  $('peaksTitle').textContent = watch ? 'Watch probabilities' : 'Most probable peaks';
  const rows = watch ? [...watch.table, ['Area', `${Math.round(watch.areaSquareMiles / 100) * 100} sq mi`]]
    : md ? [[md.watchNumber ? 'Concerning' : 'Watch probability', md.watchNumber ? md.concerning.toLowerCase() : `${md.watchPercent}%`], ['Tornado', md.peakText.tornado ?? 'none expected'], ['Wind gust', md.peakText.wind], ['Hail', md.peakText.hail], ['Area', `${Math.round(md.areaSquareMiles / 100) * 100} sq mi`]] : [];
  $('peaks').innerHTML = rows.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');
}

async function load() {
  try { const response = await fetch('/api/mesoscale', { cache: 'no-store' }); data = await response.json(); }
  catch { data = { enabled: true, watches: [], discussions: [], error: 'The weather server did not answer.' }; }
  renderSide(); draw();
}

window.addEventListener('resize', draw);
load();
setInterval(load, 15000);

// The mesoscale discussions page: the discussions issued for the live world, newest first; the
// chosen one's area on the map with the others still valid; and its text. Everything shown is
// what the server issued (GET /api/mesoscale); nothing is worked out here but the drawing.
const $ = id => document.getElementById(id);
const canvas = $('mdCanvas'), ctx = canvas.getContext('2d');
const COLOUR = percent => (percent >= 80 ? '#ef4444' : percent >= 40 ? '#f59e0b' : '#38bdf8');

let data = null, chosen = null;

const clock = hour => { const h = ((hour % 24) + 24) % 24, hh = Math.floor(h + 1e-9), mm = Math.round((h - hh) * 60); return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}Z`; };
const number = md => `MD ${String(md.number).padStart(4, '0')}`;

function pathOf(rings, side) {
  const path = new Path2D();
  for (const ring of rings) { ring.forEach(([x, y], k) => (k ? path.lineTo(x * side, y * side) : path.moveTo(x * side, y * side))); path.closePath(); }
  return path;
}

function draw() {
  const box = canvas.parentElement.getBoundingClientRect(), side = Math.max(240, Math.floor(Math.min(box.width - 24, box.height - 24))), scale = window.devicePixelRatio || 1;
  canvas.style.width = canvas.style.height = `${side}px`; canvas.width = canvas.height = Math.round(side * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#0b1119'; ctx.fillRect(0, 0, side, side);
  ctx.strokeStyle = 'rgba(148,163,184,.16)'; ctx.lineWidth = 1; for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.moveTo(k * side / 5, 0); ctx.lineTo(k * side / 5, side); ctx.moveTo(0, k * side / 5); ctx.lineTo(side, k * side / 5); ctx.stroke(); }
  const all = data?.discussions ?? [], shown = all.filter(md => md.valid || md.number === chosen);
  if (!shown.length) {
    ctx.fillStyle = '#9ca3af'; ctx.font = '600 15px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(!data ? 'Loading…' : data.enabled === false ? 'Mesoscale discussions are turned off on this server.' : 'No mesoscale discussions are in effect.', side / 2, side / 2);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, side, side); ctx.clip(); ctx.lineJoin = 'round';
  // The chosen one last, so it lies on top.
  for (const md of [...shown].sort((a, b) => (a.number === chosen) - (b.number === chosen))) {
    const path = pathOf(md.rings, side), colour = COLOUR(md.watchPercent), mine = md.number === chosen;
    ctx.globalAlpha = mine ? 0.3 : 0.12; ctx.fillStyle = colour; ctx.fill(path, 'evenodd');
    ctx.globalAlpha = md.valid ? 1 : 0.5; ctx.strokeStyle = colour; ctx.lineWidth = mine ? 3 : 1.5; ctx.setLineDash(md.valid ? [] : [6, 5]); ctx.stroke(path);
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    // Its number at the middle of its outline.
    const points = md.rings.flat(), cx = points.reduce((a, p) => a + p[0], 0) / points.length * side, cy = points.reduce((a, p) => a + p[1], 0) / points.length * side;
    ctx.font = `700 ${mine ? 14 : 12}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const label = String(md.number).padStart(4, '0'), w = ctx.measureText(label).width + 10;
    ctx.fillStyle = 'rgba(11,17,25,.9)'; ctx.fillRect(cx - w / 2, cy - 10, w, 20); ctx.fillStyle = colour; ctx.fillText(label, cx, cy + 0.5);
  }
  ctx.restore(); ctx.textBaseline = 'alphabetic';
  ctx.strokeStyle = '#475569'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, side - 1, side - 1);
  ctx.fillStyle = '#cbd5e1'; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('N ↑', 8, 16);
  if (data?.width) { ctx.textAlign = 'right'; ctx.fillText(`grid lines every ${Math.round(data.width * data.cellMiles / 5)} miles`, side - 8, side - 8); }
}

function renderSide() {
  const all = data?.discussions ?? [], list = $('mdList');
  if (chosen === null || !all.some(md => md.number === chosen)) chosen = (all.find(md => md.valid) ?? all[0])?.number ?? null;
  $('status').textContent = !data ? '—' : data.enabled === false ? 'Turned off' : `${all.filter(md => md.valid).length} in effect · ${clock(data.nowHourUtc)} now${data.running ? ' · looking ahead…' : ''}`;
  list.innerHTML = '';
  for (const md of all) {
    const item = document.createElement('button');
    item.className = `md-item${md.number === chosen ? ' on' : ''}${md.valid ? '' : ' lapsed'}`;
    item.innerHTML = `<b style="color:${COLOUR(md.watchPercent)}">${number(md)}</b><span>${md.concerning.replace('SEVERE POTENTIAL...', '').toLowerCase()} · ${md.watchPercent}%</span><small>${clock(md.issuedHourUtc)}–${clock(md.validToHourUtc)}${md.valid ? '' : ' · lapsed'}</small>`;
    item.addEventListener('click', () => { chosen = md.number; renderSide(); draw(); });
    list.append(item);
  }
  if (!all.length) list.innerHTML = '<p class="muted">None issued yet. The world is looked at once in each of its hours.</p>';
  const md = all.find(d => d.number === chosen);
  $('mdText').textContent = md ? md.text : data?.error ?? '';
  $('peaks').innerHTML = md ? [['Watch probability', `${md.watchPercent}%`], ['Tornado', md.peakText.tornado ?? 'none expected'], ['Wind gust', md.peakText.wind], ['Hail', md.peakText.hail], ['Area', `${Math.round(md.areaSquareMiles / 100) * 100} sq mi`]].map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('') : '';
}

async function load() {
  try { const response = await fetch('/api/mesoscale', { cache: 'no-store' }); data = await response.json(); }
  catch { data = { enabled: true, discussions: [], error: 'The weather server did not answer.' }; }
  renderSide(); draw();
}

window.addEventListener('resize', draw);
load();
setInterval(load, 15000);

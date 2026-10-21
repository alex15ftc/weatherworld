// The storm reports page, laid out as the Storm Prediction Center's: one day (1200 to 1159 UTC)
// at a time, the reports on the map (red tornado, green hail, blue wind; significant ones as
// black squares) and in three tables with a CSV of each. Everything is what the server logged
// (GET /api/reports/days, GET /api/reports?day=N); nothing is worked out here but the drawing.
const $ = id => document.getElementById(id);
const canvas = $('rpCanvas'), ctx = canvas.getContext('2d'), tip = $('tip');
const COLOUR = { tornado: '#ef4444', hail: '#22c55e', wind: '#3b82f6' };
const TITLE = { tornado: 'Tornado reports', hail: 'Hail reports', wind: 'Wind reports' };
const shown = { tornado: true, hail: true, wind: true };
let days = [], day = null, data = null, counties = null, countyPaths = null, countySide = 0, chosen = null, dots = [];

const hhmm = hour => { const h = ((hour % 24) + 24) % 24, hh = Math.floor(h + 1e-9), mm = Math.min(59, Math.round((h - hh) * 60)); return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}`; };
const significant = r => (r.type === 'hail' && r.size >= 200) || (r.type === 'wind' && r.speed >= 75);
const dayLabel = d => `Day ${d.day} (${d.reports.tornado + d.reports.hail + d.reports.wind} reports)`;

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
  if (counties) {
    if (countySide !== side) { countyPaths = counties.counties.map(c => pathOf(c.rings, side)); countySide = side; }
    ctx.strokeStyle = 'rgba(148,163,184,.25)'; ctx.lineWidth = 0.7; for (const p of countyPaths) ctx.stroke(p);
  }
  const miles = data?.miles ?? counties?.miles ?? 500;
  dots = [];
  const reports = (data?.reports ?? []).filter(r => shown[r.type]);
  // Wind first, then hail, tornadoes on top, as the SPC's map stacks them.
  for (const type of ['wind', 'hail', 'tornado']) for (const r of reports.filter(x => x.type === type)) {
    const x = r.x / miles * side, y = r.y / miles * side, on = chosen === r;
    if (significant(r)) { ctx.fillStyle = '#0b1119'; ctx.strokeStyle = COLOUR[type]; ctx.lineWidth = 2; ctx.fillRect(x - 5, y - 5, 10, 10); ctx.strokeRect(x - 5, y - 5, 10, 10); }
    else { ctx.beginPath(); ctx.arc(x, y, type === 'tornado' ? 5.5 : 4.5, 0, Math.PI * 2); ctx.fillStyle = COLOUR[type]; ctx.fill(); ctx.strokeStyle = 'rgba(11,17,25,.9)'; ctx.lineWidth = 1; ctx.stroke(); }
    if (on) { ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
    dots.push({ x, y, r });
  }
  if (!reports.length) {
    ctx.fillStyle = '#9ca3af'; ctx.font = '600 15px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(!data ? 'Loading…' : 'No reports for this day yet.', side / 2, side / 2);
  }
}

function describe(r) {
  const what = r.type === 'tornado' ? 'Tornado' : r.type === 'hail' ? `Hail ${(r.size / 100).toFixed(2)} in` : `Wind ${r.speed ? `${r.speed} mph` : 'damage'}`;
  return `<b>${hhmm(r.hourUtc)} UTC · ${what}</b><br>${r.location}${r.county ? ` · ${r.county} County` : ''}<br><span class="muted">${r.comment} ${r.office ? `(${r.office})` : ''}</span>`;
}

function csv(type, rows) {
  const head = type === 'tornado' ? 'Time,F_Scale,Location,County,Office,X_mi,Y_mi,Comments' : type === 'hail' ? 'Time,Size,Location,County,Office,X_mi,Y_mi,Comments' : 'Time,Speed,Location,County,Office,X_mi,Y_mi,Comments';
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const body = rows.map(r => [hhmm(r.hourUtc), type === 'tornado' ? 'UNK' : type === 'hail' ? r.size : r.speed ?? 'UNK', q(r.location), q(r.county ?? ''), r.office ?? '', r.x.toFixed(1), r.y.toFixed(1), q(`${r.comment}${r.office ? ` (${r.office})` : ''}`)].join(','));
  return URL.createObjectURL(new Blob([[head, ...body].join('\n')], { type: 'text/csv' }));
}

function renderTables() {
  const host = $('tables'), note = host.querySelector('.note');
  host.replaceChildren(note);
  for (const type of ['tornado', 'hail', 'wind']) {
    const rows = (data?.reports ?? []).filter(r => r.type === type).sort((a, b) => a.hourUtc - b.hourUtc);
    const section = document.createElement('div');
    const size = type === 'tornado' ? 'F-Scale' : type === 'hail' ? 'Size' : 'Speed';
    section.innerHTML = `<h2 style="background:${COLOUR[type]}">${TITLE[type]} (${rows.length})${rows.length ? `<a download="day${data.day}_${type}.csv" href="${csv(type, rows)}">CSV</a>` : ''}</h2>`
      + (rows.length ? `<table><thead><tr><th>Time</th><th>${size}</th><th>Location</th><th>County</th><th>X</th><th>Y</th><th>Comments</th></tr></thead><tbody></tbody></table>` : '<p class="note">None.</p>');
    const body = section.querySelector('tbody');
    for (const r of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${hhmm(r.hourUtc)}</td><td>${type === 'tornado' ? 'UNK' : type === 'hail' ? r.size : r.speed ?? 'UNK'}</td><td>${r.location}</td><td>${r.county ?? ''}</td><td>${r.x.toFixed(0)}</td><td>${r.y.toFixed(0)}</td><td class="cmt">${r.comment}${r.office ? ` (${r.office})` : ''}${r.tornadoId ? ` <a href="./damage.html?day=${data.day}&tornado=${r.tornadoId}">Survey</a>` : ''}</td>`;
      tr.onclick = () => { chosen = r; highlight(); draw(); };
      r.row = tr; body?.append(tr);
    }
    host.append(section);
  }
}
const highlight = () => { for (const r of data?.reports ?? []) r.row?.classList.toggle('on', r === chosen); chosen?.row?.scrollIntoView({ block: 'nearest' }); };

function renderSide() {
  const select = $('daySelect'), keep = day;
  select.replaceChildren(...days.map(d => { const o = document.createElement('option'); o.value = d.day; o.textContent = dayLabel(d); return o; }));
  if (keep != null) select.value = keep;
  const r = data?.reports ?? [], n = type => r.filter(x => x.type === type).length;
  $('status').textContent = days.length ? (data?.day === days[0]?.day ? 'Today so far' : `Day ${data?.day}`) : 'No days logged yet';
  $('counts').innerHTML = ['tornado', 'hail', 'wind'].map(t => `<i class="dot" style="background:${COLOUR[t]}"></i><span>${TITLE[t].replace(' reports', '')}</span><b>${n(t)}</b>`).join('') + `<span></span><span>Total</span><b>${r.length}</b>`;
}

async function load() {
  const list = await fetch('/api/reports/days', { cache: 'no-store' }).then(r => r.json()).catch(() => null);
  days = list?.days ?? [];
  const fromUrl = Number(new URLSearchParams(location.search).get('day'));
  if (day == null) day = days.some(d => d.day === fromUrl) ? fromUrl : days[0]?.day ?? null;
  const next = await fetch(`/api/reports${day != null ? `?day=${day}` : ''}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null);
  const same = chosen && next?.reports?.find(r => r.hourUtc === chosen.hourUtc && r.type === chosen.type && r.x === chosen.x);
  data = next; chosen = same ?? null;
  renderSide(); renderTables(); highlight(); draw();
}

$('daySelect').onchange = event => { day = Number(event.target.value); chosen = null; history.replaceState(null, '', `?day=${day}`); load(); };
for (const box of document.querySelectorAll('.filters input')) box.onchange = () => { shown[box.dataset.type] = box.checked; draw(); };
canvas.onmousemove = event => {
  const b = canvas.getBoundingClientRect(), x = event.clientX - b.left, y = event.clientY - b.top;
  const near = dots.reduce((best, d) => { const dist = Math.hypot(d.x - x, d.y - y); return dist < 9 && dist < (best?.dist ?? Infinity) ? { ...d, dist } : best; }, null);
  if (!near) { tip.style.display = 'none'; canvas.style.cursor = ''; return; }
  canvas.style.cursor = 'pointer'; tip.innerHTML = describe(near.r); tip.style.display = 'block';
  const host = canvas.parentElement.getBoundingClientRect();
  tip.style.left = `${event.clientX - host.left + 14}px`; tip.style.top = `${event.clientY - host.top + 14}px`;
};
canvas.onclick = event => {
  const b = canvas.getBoundingClientRect(), x = event.clientX - b.left, y = event.clientY - b.top;
  const near = dots.find(d => Math.hypot(d.x - x, d.y - y) < 9);
  chosen = near?.r ?? null; highlight(); draw();
};
window.addEventListener('resize', draw);
fetch('/api/counties').then(r => (r.ok ? r.json() : null)).then(c => { counties = c; draw(); }).catch(() => {});
load();
setInterval(load, 30000);

// The damage survey page, after the National Weather Service's Damage Assessment Toolkit: one
// day's tornadoes as surveyed (GET /api/damage?day=N): each track's centreline, the EF
// contours of its damage swath, and its damage points, coloured by EF, on a map that pans and
// zooms (miles east and south of the northwest corner). The roads and towns come from the
// built world map (data/worldmap/seed-1), the counties from GET /api/counties. Nothing is
// worked out here but the drawing and the survey's wording.
const $ = id => document.getElementById(id);
const canvas = $('dtCanvas'), ctx = canvas.getContext('2d');
const EF_COLOUR = ['#60a5fa', '#4ade80', '#facc15', '#fb923c', '#ef4444', '#e879f9'], EFU = '#9ca3af';
const colourOf = rating => (rating === 'EFU' ? EFU : EF_COLOUR[Number(String(rating).slice(2))] ?? EFU);
const DI_NAME = { SBO: 'Small barns or farm outbuildings', FR12: 'One- or two-family residence', MHSW: 'Single-wide manufactured home', MHDW: 'Double-wide manufactured home', ES: 'Elementary school', MBS: 'Metal building system', TH: 'Hardwood tree', TS: 'Softwood tree' };
const DI_NUMBER = { SBO: 1, FR12: 2, MHSW: 3, MHDW: 4, ES: 15, MBS: 21, TH: 27, TS: 28 };
const layers = { contours: true, points: true, tracks: true, trees: true, roads: true };
let days = [], day = null, data = null, chosen = null, point = null, counties = null, map = null, towns = [];
let view = { x: 250, y: 250, ppm: 1.6 }, fitted = false;

const local = hour => { const h = (((hour - 5) % 24) + 24) % 24, hh = Math.floor(h + 1e-9), mm = Math.min(59, Math.round((h - hh) * 60)); return `${(hh % 12) || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'} CDT`; };
const utc = hour => { const h = ((hour % 24) + 24) % 24, hh = Math.floor(h + 1e-9), mm = Math.min(59, Math.round((h - hh) * 60)); return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}Z`; };
const dayOfHour = hour => Math.floor(hour / 24) + 1;
const minutes = m => (m == null ? '—' : m < 10 ? `${m.toFixed(1)} min` : `${Math.round(m)} min`);

function size() {
  const box = canvas.getBoundingClientRect(), scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(box.width * scale); canvas.height = Math.round(box.height * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return { w: box.width, h: box.height };
}
const sx = (x, w) => (x - view.x) * view.ppm + w / 2, sy = (y, h) => (y - view.y) * view.ppm + h / 2;

function fit(tornadoes, w, h) {
  const pts = tornadoes.flatMap(t => t.centreline);
  if (!pts.length) return;
  const x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
  view.x = (x0 + x1) / 2; view.y = (y0 + y1) / 2;
  view.ppm = Math.max(0.8, Math.min(400, 0.8 * Math.min(w / Math.max(2, x1 - x0), h / Math.max(2, y1 - y0))));
}

function polyPath(points, w, h) {
  const p = new Path2D();
  points.forEach(([x, y], k) => (k ? p.lineTo(sx(x, w), sy(y, h)) : p.moveTo(sx(x, w), sy(y, h))));
  return p;
}

function draw() {
  const { w, h } = size();
  ctx.fillStyle = '#0e151f'; ctx.fillRect(0, 0, w, h);
  const miles = counties?.miles ?? 500;
  // The map: county lines, roads, towns.
  if (counties) {
    ctx.strokeStyle = 'rgba(148,163,184,.28)'; ctx.lineWidth = 0.8;
    for (const c of counties.counties) for (const ring of c.rings) { ctx.beginPath(); ring.forEach(([x, y], k) => (k ? ctx.lineTo(sx(x * miles, w), sy(y * miles, h)) : ctx.moveTo(sx(x * miles, w), sy(y * miles, h)))); ctx.closePath(); ctx.stroke(); }
  }
  if (layers.roads && map) {
    for (const road of map.roads ?? []) {
      ctx.strokeStyle = road.kind === 'interstate' ? 'rgba(250,204,21,.45)' : road.kind === 'expressway' ? 'rgba(226,232,240,.4)' : 'rgba(226,232,240,.18)';
      ctx.lineWidth = road.kind === 'interstate' ? 2 : 1.2;
      ctx.stroke(polyPath(road.points, w, h));
    }
  }
  if (layers.roads) {
    ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const t of towns) {
      const x = sx(t.x, w), y = sy(t.y, h);
      if (x < -50 || y < -20 || x > w + 50 || y > h + 20) continue;
      const big = t.population >= 5000, show = big || view.ppm > 6 || (view.ppm > 3 && t.population >= 1000);
      if (!show) continue;
      if (view.ppm > 25 && t.extentMi) { ctx.beginPath(); ctx.arc(x, y, t.extentMi * view.ppm, 0, Math.PI * 2); ctx.fillStyle = 'rgba(148,163,184,.07)'; ctx.fill(); }
      ctx.fillStyle = '#e2e8f0'; ctx.beginPath(); ctx.arc(x, y, big ? 3 : 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(226,232,240,.85)'; ctx.fillText(t.name, x + 5, y);
    }
  }
  const tornadoes = data?.tornadoes ?? [];
  if (!tornadoes.length) {
    ctx.fillStyle = '#9ca3af'; ctx.font = '600 15px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(!data ? 'Loading…' : 'No tornadoes surveyed for this day.', w / 2, h / 2);
    return;
  }
  // The swaths: EF0 outermost, each higher contour inside it.
  const order = [...tornadoes].sort((a, b) => (a === chosen) - (b === chosen));
  if (layers.contours) for (const t of order) {
    ctx.globalAlpha = !chosen || t === chosen ? 1 : 0.45;
    for (const c of t.contours) for (const poly of c.polygons) {
      const p = polyPath(poly, w, h); p.closePath();
      ctx.fillStyle = EF_COLOUR[c.ef] + '55'; ctx.fill(p);
      ctx.strokeStyle = EF_COLOUR[c.ef]; ctx.lineWidth = 1.2; ctx.stroke(p);
    }
  }
  ctx.globalAlpha = 1;
  if (layers.tracks) for (const t of order) {
    // Zoomed out, a track is drawn in its rating's colour, as wide as its path or more for the
    // stronger ratings; zoomed in, as a thin centreline over its contours.
    const p = polyPath(t.centreline, w, h), ef = t.rating === 'EFU' ? 0 : Number(t.rating.slice(2)), far = view.ppm < 12;
    ctx.lineCap = 'round'; ctx.setLineDash(t.ongoing ? [5, 4] : []);
    if (far) { ctx.strokeStyle = colourOf(t.rating); ctx.lineWidth = Math.max(1.5 + ef * 0.9, t.maxWidthYards / 1760 * view.ppm); ctx.stroke(p); }
    if (!far || t === chosen) { ctx.strokeStyle = t === chosen ? '#ffffff' : 'rgba(255,255,255,.6)'; ctx.lineWidth = t === chosen ? (far ? 1.2 : 2) : 1.3; ctx.stroke(p); }
    ctx.setLineDash([]);
    if (view.ppm < 12 || t === chosen) {
      const [x, y] = t.centreline[0];
      ctx.font = '800 11px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillStyle = colourOf(t.rating); ctx.fillText(t.rating, sx(x, w) - 6, sy(y, h));
    }
  }
  // Damage points: big enough to click when zoomed in; the chosen tornado's on top.
  if (layers.points && view.ppm > 4) {
    const r = Math.max(2.5, Math.min(6, view.ppm / 10));
    for (const t of order) {
      if (chosen && t !== chosen && view.ppm < 20) continue;
      for (const p of t.points) {
        if (!layers.trees && (p.di === 'TH' || p.di === 'TS')) continue;
        const x = sx(p.x, w), y = sy(p.y, h);
        if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
        ctx.beginPath();
        if (p.di === 'TH' || p.di === 'TS') { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r * 0.8); ctx.lineTo(x - r, y + r * 0.8); ctx.closePath(); } else ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = EF_COLOUR[p.ef]; ctx.fill(); ctx.strokeStyle = p === point ? '#ffffff' : 'rgba(11,17,25,.9)'; ctx.lineWidth = p === point ? 2.5 : 1; ctx.stroke();
      }
    }
  }
  // Scale bar.
  const target = 120 / view.ppm, steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100], len = steps.find(s => s >= target / 2) ?? 100;
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(w - 20 - len * view.ppm, h - 18); ctx.lineTo(w - 20, h - 18); ctx.stroke();
  ctx.fillStyle = '#e2e8f0'; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(`${len} mi`, w - 20, h - 28);
}

// The survey's wording, as a public information statement gives it.
function summary(t) {
  if (!t) return 'Choose a tornado.';
  const peak = t.peakPoint;
  const lines = [
    `${t.stormId} tornado ${t.id.split('-T')[1] ?? ''}${t.ongoing ? '   (still on the ground: survey preliminary)' : ''}`, '',
    `Rating:                 ${t.rating}`,
    `Estimated peak wind:    ${t.peakWindMph ? `${t.peakWindMph} mph` : 'unknown'}`,
    `Path length:            ${t.lengthMi.toFixed(1)} miles`,
    `Path width:             ${t.maxWidthYards} yards`,
    `Duration:               ${minutes(t.durationMinutes)}`,
    `Start:                  ${local(t.startHourUtc)} Day ${dayOfHour(t.startHourUtc - 5)} (${utc(t.startHourUtc)})`,
    `                        ${t.startPlace ?? `${t.start[0].toFixed(1)}, ${t.start[1].toFixed(1)} mi`}`,
    `End:                    ${t.endHourUtc != null ? `${local(t.endHourUtc)} (${utc(t.endHourUtc)})` : '—'}`,
    `                        ${t.endPlace ?? `${t.end[0].toFixed(1)}, ${t.end[1].toFixed(1)} mi`}`,
    `Counties:               ${t.counties.join(', ') || '—'}`,
    `Offices:                ${t.offices.join(', ') || '—'}`,
    '', 'Summary:'
  ];
  const towns = t.towns.length ? ` It passed through or near ${t.towns.join(', ')}.` : '';
  if (peak) lines.push(`The tornado touched down ${t.startPlace ?? ''} at ${local(t.startHourUtc)} and ended ${t.endPlace ?? ''}${t.endHourUtc != null ? ` at ${local(t.endHourUtc)}` : ''}, a path of ${t.lengthMi.toFixed(1)} miles.${towns} The most intense damage was to a ${DI_NAME[peak.di].toLowerCase()} (DI ${DI_NUMBER[peak.di]}): ${peak.description.charAt(0).toLowerCase()}${peak.description.slice(1)} (degree of damage ${peak.dod}), rated ${t.rating} with an estimated wind of ${peak.estimatedMph} mph. ${t.points.length} damage points were surveyed.`);
  else lines.push(`The tornado touched down ${t.startPlace ?? ''} at ${local(t.startHourUtc)} and moved ${t.lengthMi.toFixed(1)} miles over open country. It struck nothing the Enhanced Fujita scale has a damage indicator for, so it is rated EF-Unknown (EFU).`);
  return lines.join('\n');
}

function renderText() {
  $('summary').textContent = summary(chosen);
  $('indicators').innerHTML = chosen?.indicators?.length
    ? `<table><thead><tr><th>DI</th><th>Indicator</th><th>Points</th><th>Worst</th></tr></thead><tbody>${chosen.indicators.map(i => `<tr><td>${i.di}</td><td>${i.name}</td><td>${i.count}</td><td style="color:${EF_COLOUR[i.maxEf]};font-weight:800">EF${i.maxEf}</td></tr>`).join('')}</tbody></table>`
    : '<p class="note">No damage points.</p>';
  $('point').innerHTML = point
    ? [['Indicator', `${DI_NAME[point.di]} (DI ${DI_NUMBER[point.di]}, ${point.di})`], ['Damage', `DOD ${point.dod}: ${point.description}`], ['Expected wind', `${point.expectedMph} mph (bounds ${point.lowerMph}-${point.upperMph})`], ['Estimated wind', `${point.estimatedMph} mph`], ['Rating', `<b style="color:${EF_COLOUR[point.ef]}">EF${point.ef}</b>`], ['Time', `${local(point.hourUtc)} (${utc(point.hourUtc)})`], ['Location', `${point.x.toFixed(2)} mi E, ${point.y.toFixed(2)} mi S`]].map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')
    : '<span>—</span><b>Click a damage point on the map.</b>';
}

function renderSide() {
  const select = $('daySelect');
  select.replaceChildren(...days.map(d => { const o = document.createElement('option'); o.value = d.day; o.textContent = `Day ${d.day}: ${d.tornadoes} tornado${d.tornadoes === 1 ? '' : 'es'}`; return o; }));
  if (day != null) select.value = day;
  const list = data?.tornadoes ?? [];
  const best = list.reduce((m, t) => Math.max(m, t.rating === 'EFU' ? -1 : Number(t.rating.slice(2))), -1);
  $('status').textContent = list.length ? `${list.length} tornado${list.length === 1 ? '' : 'es'}; strongest ${best >= 0 ? `EF${best}` : 'EFU'}` : days.length ? 'No tornadoes this day' : 'No days logged yet';
  $('torList').replaceChildren(...[...list].sort((a, b) => a.startHourUtc - b.startHourUtc).map(t => {
    const b = document.createElement('button'); b.className = `tor${t === chosen ? ' on' : ''}`;
    b.innerHTML = `<span class="ef" style="background:${colourOf(t.rating)}">${t.rating}</span><span>${local(t.startHourUtc)} · ${minutes(t.durationMinutes)} · ${t.lengthMi.toFixed(1)} mi · ${t.maxWidthYards} yd</span><small>${t.startPlace ?? ''}${t.towns.length ? ` · ${t.towns.join(', ')}` : ''}${t.ongoing ? ' · on the ground' : ''}</small>`;
    b.onclick = () => choose(t, true);
    return b;
  }));
  $('legend').innerHTML = [...EF_COLOUR.map((c, k) => `<span class="ef" style="background:${c}">EF${k}</span>`), `<span class="ef" style="background:${EFU}">EFU</span>`].join('') + '<p class="note">Circles: buildings. Triangles: trees.</p>';
}

function choose(t, zoom) {
  chosen = t; point = null; remember();
  if (zoom && t) { const { w, h } = size(); fit([t], w, h); }
  renderSide(); renderText(); draw();
}

async function load(first = false) {
  const list = await fetch('/api/reports/days', { cache: 'no-store' }).then(r => r.json()).catch(() => null);
  days = list?.days ?? [];
  const fromUrl = Number(new URLSearchParams(location.search).get('day'));
  if (day == null) day = days.some(d => d.day === fromUrl) ? fromUrl : days.find(d => d.tornadoes)?.day ?? days[0]?.day ?? null;
  const next = await fetch(`/api/damage${day != null ? `?day=${day}` : ''}`, { cache: 'no-store' }).then(r => r.json()).catch(() => null);
  const keep = chosen?.id, keepPoint = point;
  data = next;
  chosen = data?.tornadoes?.find(t => t.id === keep) ?? null;
  point = chosen && keepPoint ? chosen.points.find(p => p.x === keepPoint.x && p.y === keepPoint.y) ?? null : null;
  const wanted = first ? new URLSearchParams(location.search).get('tornado') : null, named = wanted && data?.tornadoes?.find(t => t.id === wanted);
  if (named) { chosen = named; const { w, h } = size(); fit([named], w, h); fitted = true; }
  else if (!fitted || first) { const { w, h } = size(); fit(data?.tornadoes ?? [], w, h); fitted = true; }
  // ?x=&y=&zoom= (miles, pixels per mile) opens on a spot.
  const q = new URLSearchParams(location.search);
  if (first && q.has('zoom')) { view.ppm = Number(q.get('zoom')) || view.ppm; view.x = Number(q.get('x') ?? view.x); view.y = Number(q.get('y') ?? view.y); }
  renderSide(); renderText(); draw();
}

// Pan, zoom, pick.
let drag = null;
canvas.onmousedown = e => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; canvas.classList.add('drag'); };
window.onmousemove = e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true; view.x = drag.vx - dx / view.ppm; view.y = drag.vy - dy / view.ppm; draw(); };
window.onmouseup = e => {
  if (!drag) return;
  canvas.classList.remove('drag');
  const moved = drag.moved; drag = null;
  if (moved) return;
  const b = canvas.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, { w, h } = { w: b.width, h: b.height };
  // A damage point under the cursor first, then the nearest track.
  let best = null;
  if (layers.points && view.ppm > 4) for (const t of data?.tornadoes ?? []) for (const p of t.points) {
    if (!layers.trees && (p.di === 'TH' || p.di === 'TS')) continue;
    const d = Math.hypot(sx(p.x, w) - x, sy(p.y, h) - y);
    if (d < 9 && d < (best?.d ?? Infinity)) best = { d, t, p };
  }
  if (best) { if (chosen !== best.t) { chosen = best.t; renderSide(); } point = best.p; renderText(); draw(); return; }
  let near = null;
  for (const t of data?.tornadoes ?? []) for (const [px, py] of t.centreline) { const d = Math.hypot(sx(px, w) - x, sy(py, h) - y); if (d < 12 && d < (near?.d ?? Infinity)) near = { d, t }; }
  if (near) choose(near.t, false);
};
canvas.onwheel = e => {
  e.preventDefault();
  const b = canvas.getBoundingClientRect(), mx = e.clientX - b.left - b.width / 2, my = e.clientY - b.top - b.height / 2;
  const before = { x: view.x + mx / view.ppm, y: view.y + my / view.ppm };
  view.ppm = Math.max(0.8, Math.min(1500, view.ppm * Math.exp(-e.deltaY * 0.0015)));
  view.x = before.x - mx / view.ppm; view.y = before.y - my / view.ppm;
  draw();
};
$('daySelect').onchange = e => { day = Number(e.target.value); chosen = null; point = null; history.replaceState(null, '', `?day=${day}`); load(true); };
// Keeps the chosen tornado in the address, so it can be linked to.
const remember = () => history.replaceState(null, '', `?day=${day}${chosen ? `&tornado=${chosen.id}` : ''}`);
for (const box of document.querySelectorAll('.layers input')) box.onchange = () => { layers[box.dataset.layer] = box.checked; draw(); };
window.addEventListener('resize', draw);

fetch('/api/counties').then(r => (r.ok ? r.json() : null)).then(c => { counties = c; draw(); }).catch(() => {});
fetch('./data/worldmap/seed-1/meta.json').then(r => (r.ok ? r.json() : null)).then(m => { map = m; towns = (m?.settlements ?? []).filter(s => s.name); draw(); }).catch(() => {});
load(true);
setInterval(load, 30000);

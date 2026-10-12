// Surface observations and mesoanalysis page. The base is a conventional surface map from the
// server's analysis: stations plotted where they stand, isobars, fronts, the dryline, outflow
// boundaries and storms. Over it goes one diagnosed field at a time, as shading, labelled
// contours or both. Nothing is drawn as grid cells. A click gives the sounding at that spot;
// the time controls step back through the analyses the server has kept.
import { drawSounding, drawHodograph } from '../sounding.js';

const canvas = document.getElementById('surfaceCanvas'), ctx = canvas.getContext('2d'), tip = document.getElementById('surfaceTip');
const $ = id => document.getElementById(id);
const controls = { stations: $('showStations'), isobars: $('showIsobars'), fronts: $('showFronts'), storms: $('showStorms'), parameter: $('parameter') };
const COLOURS = { cold: '#3d8bff', warm: '#ff4d5e', stationary: '#b06cff', dryline: '#d98a2b', outflow: '#e8d44d' };
const NAMES = { cold: 'Cold front', warm: 'Warm front', stationary: 'Stationary front', dryline: 'Dryline', outflow: 'Outflow boundary' };
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const REFRESH_MS = 10000, LOOP_MS = 450;

let data = null, field = null, view = null, style = 'both', selected = null;
let frameHour = null;          // null follows the current time
let looping = null;
const shade = { canvas: null, key: '' };
const fieldCache = new Map();  // `${key}:${frameHour}` -> field (a frame's fields never change)

// --- Loading.
async function getJson(url) { const response = await fetch(url, { cache: 'no-store' }); if (!response.ok) throw new Error(String(response.status)); return response.json(); }

async function load() {
  try {
    data = await getJson(`/api/atmosphere/surface${frameHour === null ? '' : `?frame=${frameHour}`}`);
    const key = controls.parameter.value;
    if (!key) field = null;
    else {
      const id = `${key}:${data.frameHour}`;
      if (!fieldCache.has(id)) { fieldCache.set(id, await getJson(`/api/atmosphere/parameter?key=${key}&frame=${data.frameHour}`)); if (fieldCache.size > 80) fieldCache.delete(fieldCache.keys().next().value); }
      field = fieldCache.get(id);
    }
  } catch { data = { status: 'offline' }; field = null; }
  describe();
  draw();
}
async function refresh() { if (!looping) await load(); setTimeout(refresh, data?.status === 'ready' ? REFRESH_MS : 2500); }

// --- Side panel.
const clock = hours => { const h = ((hours % 24) + 24) % 24; return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`; };

function describe() {
  const time = $('surfaceTime'), status = $('surfaceStatus');
  if (data.status !== 'ready') { time.textContent = '—'; status.textContent = 'Server not reachable. Start it with npm start (a first start takes about a minute).'; return; }
  if (!controls.parameter.dataset.filled) fillParameters();
  time.textContent = `Day ${data.day} · ${clock(data.hourUtc)} UTC`;
  const behind = data.frames.at(-1) - data.frameHour;
  status.textContent = `${clock(data.hourUtc + data.localOffsetHours)} local · ${data.latest ? 'current analysis' : `${behind} h ago`} · seed ${data.seed}`;
  const slider = $('frameSlider'); slider.max = data.frames.length - 1; slider.value = data.frames.indexOf(data.frameHour);
  $('frameLatest').classList.toggle('on', frameHour === null && !looping);
  $('worldClock').textContent = data.clockRunning ? 'Pause clock' : 'Resume clock';
  $('framePlay').classList.toggle('on', Boolean(looping)); $('framePlay').textContent = looping ? 'Stop' : 'Loop';

  const lines = $('surfaceLines');
  lines.innerHTML = data.boundaries.length ? '' : '<li class="muted">No fronts or dryline on the map.</li>';
  for (const line of data.boundaries) {
    const item = document.createElement('li'), miles = Math.round(line.lengthKm / 1.609);
    // A dryline moves by mixing and an outflow boundary with its cold pool, so no speed is given for them.
    const motion = line.type === 'stationary' ? ' · nearly still' : line.type === 'dryline' || line.type === 'outflow' ? '' : ` · ${Math.abs(line.advanceMph)} mph`;
    item.innerHTML = `<i style="background:${COLOURS[line.type]}"></i>${NAMES[line.type]} · ${miles} mi${motion}`;
    lines.append(item);
  }
  const severe = data.storms.filter(s => s.hailInches >= 1 || s.gustMph >= 58 || s.tornado), tornadoes = data.storms.filter(s => s.tornado);
  $('surfaceStorms').innerHTML = data.storms.length ? `${data.storms.length} on the map · ${severe.length} severe · ${tornadoes.length} with a tornado<br><span style="color:#7cd67c">●</span> weak <span style="color:#ffb300">●</span> strong <span style="color:#ff5252">●</span> severe <span style="color:#e040fb">●</span> significant <span style="color:#ff1744">▼</span> tornado` : 'None right now.';
  drawLegend();
}

function fillParameters() {
  const groups = new Map();
  for (const parameter of data.parameters) { if (!groups.has(parameter.group)) groups.set(parameter.group, []); groups.get(parameter.group).push(parameter); }
  for (const [name, list] of groups) {
    const group = document.createElement('optgroup'); group.label = name;
    for (const parameter of list) { const option = document.createElement('option'); option.value = parameter.key; option.textContent = parameter.label; group.append(option); }
    controls.parameter.append(group);
  }
  controls.parameter.dataset.filled = '1';
  // ?field=mlcape opens the page with that overlay on.
  const wanted = new URLSearchParams(location.search).get('field');
  if (wanted && data.parameters.some(p => p.key === wanted)) { controls.parameter.value = wanted; load(); }
}

function colourAt(value) {
  const stops = field.shade;
  if (value <= stops[0][0]) return field.shadeBelowFirst ? stops[0].slice(1) : [stops[0][1], stops[0][2], stops[0][3], 0];
  for (let i = 1; i < stops.length; i++) if (value <= stops[i][0]) { const a = stops[i - 1], b = stops[i], t = (value - a[0]) / (b[0] - a[0]); return [1, 2, 3, 4].map(c => a[c] + (b[c] - a[c]) * t); }
  return stops.at(-1).slice(1);
}

function drawLegend() {
  const bar = $('legendBar'), g = bar.getContext('2d'), ticks = $('legendTicks'), note = $('legendNote');
  g.clearRect(0, 0, bar.width, bar.height); ticks.innerHTML = '';
  if (!field) { note.textContent = 'Pick a field to lay over the map.'; return; }
  const from = field.shade[0][0], to = field.shade.at(-1)[0];
  g.fillStyle = '#101822'; g.fillRect(0, 0, bar.width, bar.height);
  for (let x = 0; x < bar.width; x++) { const [r, gr, b, a] = colourAt(from + (to - from) * x / (bar.width - 1)); g.fillStyle = `rgba(${r | 0},${gr | 0},${b | 0},${Math.max(0.12, a)})`; g.fillRect(x, 0, 1, bar.height); }
  for (const value of [from, (from + to) / 2, to]) { const tick = document.createElement('span'); tick.textContent = Number(value.toFixed(field.decimals)).toLocaleString(); ticks.append(tick); }
  note.textContent = `${field.label}${field.unit ? ` (${field.unit})` : ''}${field.second ? ` · dashed lines: ${field.second.label} (${field.second.unit})` : ''}${field.barbs ? ' · barbs: wind at that level' : ''}`;
}

// --- Map.
function resize() {
  const ratio = window.devicePixelRatio || 1, box = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(box.width * ratio)); canvas.height = Math.max(1, Math.round(box.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  draw();
}

function draw() {
  const box = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, box.width, box.height);
  if (!data || data.status !== 'ready') { ctx.fillStyle = '#96a5b7'; ctx.font = '15px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Waiting for the server…', box.width / 2, box.height / 2); return; }
  const margin = 18, size = Math.max(50, Math.min(box.width, box.height) - 2 * margin), left = (box.width - size) / 2, top = (box.height - size) / 2;
  view = { left, top, size, kmToPx: size / data.domain.widthKm };
  const px = (xKm, yKm) => [left + xKm * view.kmToPx, top + yKm * size / data.domain.heightKm];

  ctx.save();
  ctx.beginPath(); ctx.rect(left, top, size, size); ctx.clip();
  ctx.fillStyle = '#101822'; ctx.fillRect(left, top, size, size);
  if (field && style !== 'contours') drawShading(left, top, size);
  if (controls.isobars.checked) drawIsobars(px);
  if (field && style !== 'shade') drawContours(field.values, field.levels, 'rgba(255,255,255,.82)', px, field.decimals);
  if (field?.second) drawContours(field.second.values, field.second.levels, field.second.colour, px, 0, [6, 4]);
  if (field?.barbs) for (const barb of field.barbs) { const [x, y] = px(barb.xKm, barb.yKm); drawBarb(x, y, barb.windKt, barb.windFromDeg, '#9fd3ff', false); }
  if (controls.fronts.checked) drawBoundaries(px);
  if (controls.isobars.checked) drawCentres(px);
  if (controls.stations.checked) drawStations(px);
  if (controls.storms.checked) drawStorms(px);
  if (selected) { const [x, y] = px(selected.xKm, selected.yKm); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.moveTo(x, y - 9); ctx.lineTo(x, y + 9); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = '#2c3948'; ctx.lineWidth = 1; ctx.strokeRect(left + 0.5, top + 0.5, size - 1, size - 1);
  const bar = 100 * 1.609 * view.kmToPx;
  ctx.strokeStyle = ctx.fillStyle = '#cbd5e1'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(left + 14, top + size - 14); ctx.lineTo(left + 14 + bar, top + size - 14); ctx.stroke();
  ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,12,18,.85)'; ctx.strokeText('100 miles', left + 14, top + size - 22); ctx.fillText('100 miles', left + 14, top + size - 22);
  ctx.textAlign = 'right'; ctx.fillText('N ↑', left + size - 12, top + 18);
}

// Shading is painted from one value per cell and scaled up smoothly, so no cell edges show.
function drawShading(left, top, size) {
  const { columns, rows } = data.domain, id = `${field.key}:${field.frameHour}`;
  if (shade.key !== id) {
    shade.canvas ??= document.createElement('canvas'); shade.canvas.width = columns; shade.canvas.height = rows;
    const image = shade.canvas.getContext('2d').createImageData(columns, rows);
    for (let i = 0; i < field.values.length; i++) { const [r, g, b, a] = colourAt(field.values[i]); image.data[i * 4] = r; image.data[i * 4 + 1] = g; image.data[i * 4 + 2] = b; image.data[i * 4 + 3] = a * 255; }
    shade.canvas.getContext('2d').putImageData(image, 0, 0); shade.key = id;
  }
  const cell = size / columns;   // cell centres sit half a cell inside the map edge
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(shade.canvas, left - cell / 2, top - cell / 2, size + cell, size + cell);
}

// Contour lines of a field given on the cell centres, with one label per line.
function drawContours(values, levels, colour, px, decimals, dash = []) {
  const { columns, rows, cellKm } = data.domain, km = v => (v + 0.5) * cellKm;
  ctx.save(); ctx.lineWidth = 1.3; ctx.strokeStyle = colour; ctx.setLineDash(dash);
  ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const labels = [];
  for (const level of levels) {
    ctx.beginPath();
    let best = Infinity, label = null, count = 0;
    for (let y = 0; y < rows - 1; y++) for (let x = 0; x < columns - 1; x++) {
      const a = values[y * columns + x], b = values[y * columns + x + 1], c = values[(y + 1) * columns + x + 1], d = values[(y + 1) * columns + x], cross = [];
      const edge = (v1, v2, x1, y1, x2, y2) => { if ((v1 < level) !== (v2 < level)) { const t = (level - v1) / (v2 - v1); cross.push(px(km(x1 + (x2 - x1) * t), km(y1 + (y2 - y1) * t))); } };
      edge(a, b, x, y, x + 1, y); edge(b, c, x + 1, y, x + 1, y + 1); edge(d, c, x, y + 1, x + 1, y + 1); edge(a, d, x, y, x, y + 1);
      for (let i = 0; i + 1 < cross.length; i += 2) {
        ctx.moveTo(cross[i][0], cross[i][1]); ctx.lineTo(cross[i + 1][0], cross[i + 1][1]); count++;
        // The label goes where the line passes nearest the middle of the map, clear of other labels.
        const mx = (cross[i][0] + cross[i + 1][0]) / 2, my = (cross[i][1] + cross[i + 1][1]) / 2;
        const score = Math.abs((mx - view.left) / view.size - 0.5) + Math.abs((my - view.top) / view.size - 0.5) + (labels.some(l => Math.hypot(l[0] - mx, l[1] - my) < 44) ? 10 : 0);
        if (score < best) { best = score; label = [mx, my]; }
      }
    }
    ctx.stroke();
    if (label && count > 3 && best < 10) { labels.push(label); const text = Number(level.toFixed(decimals)).toLocaleString(), w = ctx.measureText(text).width + 6; ctx.setLineDash([]); ctx.fillStyle = 'rgba(16,24,34,.9)'; ctx.fillRect(label[0] - w / 2, label[1] - 7, w, 14); ctx.fillStyle = colour; ctx.fillText(text, label[0], label[1] + 0.5); ctx.setLineDash(dash); }
  }
  ctx.restore();
}

function drawIsobars(px) {
  ctx.lineWidth = 1; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // Fainter and unlabelled under an overlay, so the overlay's own contours stand out.
  const strong = field ? 0.38 : 0.6, weak = field ? 0.18 : 0.28;
  for (const isobar of data.isobars) {
    const bold = isobar.hPa % 4 === 0, s = isobar.segments;
    ctx.strokeStyle = `rgba(226,232,240,${bold ? strong : weak})`;
    ctx.beginPath();
    let label = null, best = Infinity;
    for (let i = 0; i + 3 < s.length; i += 4) {
      const [x1, y1] = px(s[i], s[i + 1]), [x2, y2] = px(s[i + 2], s[i + 3]);
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      const score = Math.abs((x1 - view.left) / view.size - 0.33) + 0.3 * Math.abs((y1 - view.top) / view.size - 0.5);
      if (bold && score < best) { best = score; label = [(x1 + x2) / 2, (y1 + y2) / 2]; }
    }
    ctx.stroke();
    if (label && !field) { ctx.fillStyle = '#101822'; ctx.fillRect(label[0] - 14, label[1] - 7, 28, 14); ctx.fillStyle = 'rgba(226,232,240,.85)'; ctx.fillText(String(isobar.hPa), label[0], label[1] + 0.5); }
  }
}

function drawCentres(px) {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const centre of data.pressureCentres) {
    const [x, y] = px(centre.xKm, centre.yKm), colour = centre.type === 'L' ? '#ff5964' : '#4da3ff';
    ctx.font = '800 26px system-ui, sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(centre.type, x, y); ctx.fillStyle = colour; ctx.fillText(centre.type, x, y);
    ctx.font = '700 11px system-ui, sans-serif'; ctx.lineWidth = 3; ctx.strokeText(String(centre.hPa), x, y + 19); ctx.fillText(String(centre.hPa), x, y + 19);
  }
}

// Standard symbols: triangles on a cold front and half-circles on a warm front, on the side
// the front is moving toward; both, on opposite sides, on a stationary front; open scallops on
// the moist side of a dryline; a plain dashed line for an outflow boundary.
function drawBoundaries(px) {
  for (const boundary of data.boundaries) {
    if (boundary.pointsKm.length < 2) continue;
    const points = boundary.pointsKm.map(p => px(p.x, p.y)), colour = COLOURS[boundary.type], side = boundary.symbolSide ?? 1, outflow = boundary.type === 'outflow';
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [stroke, width] of [['rgba(0,0,0,.7)', outflow ? 4 : 5.5], [colour, outflow ? 2 : 2.8]]) { ctx.beginPath(); points.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.setLineDash(outflow && stroke === colour ? [7, 5] : []); ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
    ctx.setLineDash([]);
    if (outflow) { ctx.restore(); continue; }
    const dry = boundary.type === 'dryline', spacing = dry ? 20 : 34, size = dry ? 5 : 7;
    let carried = spacing / 2, n = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]); if (length < 1e-6) continue;
      const tx = (b[0] - a[0]) / length, ty = (b[1] - a[1]) / length;
      for (let d = carried; d < length; d += spacing, n++) {
        const x = a[0] + tx * d, y = a[1] + ty * d;
        // On a stationary front the triangles face the warm air and the half-circles the cold air.
        const kind = boundary.type === 'stationary' ? (n % 2 ? 'warm' : 'cold') : boundary.type, flip = boundary.type === 'stationary' && n % 2 ? -side : side, nx = ty * flip, ny = -tx * flip;
        ctx.beginPath();
        if (kind === 'cold') { ctx.moveTo(x - tx * size, y - ty * size); ctx.lineTo(x + nx * size * 1.5, y + ny * size * 1.5); ctx.lineTo(x + tx * size, y + ty * size); ctx.closePath(); ctx.fillStyle = COLOURS.cold; ctx.fill(); }
        else { const start = Math.atan2(ty, tx); ctx.arc(x, y, size, start, start + Math.PI, flip > 0); if (kind === 'warm') { ctx.closePath(); ctx.fillStyle = COLOURS.warm; ctx.fill(); } else { ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.stroke(); } }
      }
      carried = (carried - length) % spacing; if (carried < 0) carried += spacing;
    }
    ctx.restore();
  }
}

function drawStations(px) {
  ctx.textBaseline = 'middle'; ctx.lineCap = 'round';
  // Fewer stations are plotted when the map is small, so the numbers never overlap.
  const minGap = 46, plotted = [];
  for (const station of data.stations) {
    const [x, y] = px(station.xKm, station.yKm);
    if (plotted.some(p => Math.abs(p[0] - x) < minGap && Math.abs(p[1] - y) < minGap * 0.7)) continue;
    plotted.push([x, y]);
    drawBarb(x, y, station.windKt, station.windFromDeg, '#e2e8f0', true);
    ctx.font = '700 12px system-ui, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,12,18,.85)';
    const text = (value, dx, dy, colour, align) => { ctx.textAlign = align; ctx.strokeText(value, x + dx, y + dy); ctx.fillStyle = colour; ctx.fillText(value, x + dx, y + dy); };
    text(String(station.temperatureF), -7, -9, '#ff8a80', 'right');
    text(String(station.dewpointF), -7, 9, '#69db7c', 'right');
    text(String(Math.round(station.pressureHpa * 10) % 1000).padStart(3, '0'), 7, -9, '#e2e8f0', 'left');
  }
}

// The staff points to where the wind comes from, feathers on its clockwise side.
function drawBarb(x, y, speed, fromDeg, colour, station) {
  ctx.strokeStyle = ctx.fillStyle = colour; ctx.lineWidth = station ? 1.6 : 1.3; ctx.setLineDash([]);
  if (station) { ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.stroke(); }
  let knots = Math.round(speed / 5) * 5;
  if (knots < 5) { if (station) { ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke(); } return; }
  const angle = fromDeg * Math.PI / 180, sx = Math.sin(angle), sy = -Math.cos(angle), fx = Math.sin(angle + Math.PI / 2 * 0.78), fy = -Math.cos(angle + Math.PI / 2 * 0.78), staff = station ? 26 : 22, start = station ? 3.2 : 0;
  ctx.beginPath(); ctx.moveTo(x + sx * start, y + sy * start); ctx.lineTo(x + sx * staff, y + sy * staff); ctx.stroke();
  let at = staff;
  for (; knots >= 50; knots -= 50, at -= 7) { ctx.beginPath(); ctx.moveTo(x + sx * at, y + sy * at); ctx.lineTo(x + sx * (at - 3) + fx * 10, y + sy * (at - 3) + fy * 10); ctx.lineTo(x + sx * (at - 6), y + sy * (at - 6)); ctx.closePath(); ctx.fill(); }
  for (; knots >= 10; knots -= 10, at -= 4) { ctx.beginPath(); ctx.moveTo(x + sx * at, y + sy * at); ctx.lineTo(x + sx * at + fx * 10, y + sy * at + fy * 10); ctx.stroke(); }
  if (knots >= 5) { if (at === staff) at -= 4; ctx.beginPath(); ctx.moveTo(x + sx * at, y + sy * at); ctx.lineTo(x + sx * at + fx * 5, y + sy * at + fy * 5); ctx.stroke(); }
}

// Storms: a disc that grows with strength and is coloured by what it is producing, a tick
// showing where it is heading, and a red inverted triangle while a tornado is on the ground.
function stormColour(storm) { return storm.hailInches >= 2 || storm.gustMph >= 75 ? '#e040fb' : storm.hailInches >= 1 || storm.gustMph >= 58 ? '#ff5252' : storm.strength >= 0.45 ? '#ffb300' : '#7cd67c'; }
function drawStorms(px) {
  for (const storm of data.storms) {
    const [x, y] = px(storm.xKm, storm.yKm), radius = 3 + 9 * storm.strength, heading = storm.towardDeg * Math.PI / 180, reach = radius + Math.min(22, storm.speedMph * 0.4);
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.75)';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(heading) * reach, y - Math.cos(heading) * reach); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = stormColour(storm); ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
    if (storm.tornado) { ctx.beginPath(); ctx.moveTo(x - 7, y - radius - 12); ctx.lineTo(x + 7, y - radius - 12); ctx.lineTo(x, y - radius); ctx.closePath(); ctx.fillStyle = '#ff1744'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
}

// --- Pointer: readout and sounding.
function pointer(event) {
  if (!data || data.status !== 'ready' || !view) return null;
  const box = canvas.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
  const xKm = (x - view.left) / view.kmToPx, yKm = (y - view.top) / view.size * data.domain.heightKm;
  if (xKm < 0 || yKm < 0 || xKm > data.domain.widthKm || yKm > data.domain.heightKm) return null;
  const { columns, rows, cellKm } = data.domain;
  return { xKm, yKm, column: Math.max(0, Math.min(columns - 1, Math.floor(xKm / cellKm))), row: Math.max(0, Math.min(rows - 1, Math.floor(yKm / cellKm))) };
}
// A field's value between the cell centres.
function valueAt(values, at) {
  const { columns, rows, cellKm } = data.domain, gx = Math.max(0, Math.min(columns - 1.001, at.xKm / cellKm - 0.5)), gy = Math.max(0, Math.min(rows - 1.001, at.yKm / cellKm - 0.5)), x0 = Math.floor(gx), y0 = Math.floor(gy), tx = gx - x0, ty = gy - y0;
  return (values[y0 * columns + x0] * (1 - tx) + values[y0 * columns + x0 + 1] * tx) * (1 - ty) + (values[(y0 + 1) * columns + x0] * (1 - tx) + values[(y0 + 1) * columns + x0 + 1] * tx) * ty;
}

canvas.addEventListener('mousemove', event => {
  const at = pointer(event);
  if (!at) { tip.style.display = 'none'; return; }
  const near = list => list.map(s => ({ s, d: Math.hypot(s.xKm - at.xKm, s.yKm - at.yKm) * view.kmToPx })).sort((a, b) => a.d - b.d)[0];
  const storm = controls.storms.checked ? near(data.storms) : null, station = controls.stations.checked ? near(data.stations) : null;
  let html;
  if (storm && storm.d < 14) {
    const s = storm.s;
    html = `<b>Storm ${s.id}</b> · ${s.character}<br>moving ${COMPASS[Math.round(s.towardDeg / 22.5) % 16]} at ${s.speedMph} mph<br>hail ${s.hailInches.toFixed(2)} in · gusts ${s.gustMph} mph${s.tornado ? `<br><b style="color:#ff5252">Tornado on the ground</b> · ${s.tornado.windMph} mph` : ''}`;
  } else if (station && station.d < 24) {
    const s = station.s;
    html = `<b>Station ${s.id}</b> · ${Math.round(s.elevationM * 3.281).toLocaleString()} ft<br>${s.temperatureF}°F / ${s.dewpointF}°F · ${s.windKt < 3 ? 'calm' : `${COMPASS[Math.round(s.windFromDeg / 22.5) % 16]} ${s.windKt} kt`}<br>${s.pressureHpa.toFixed(1)} hPa`;
  } else {
    const i = at.row * data.domain.columns + at.column;
    html = `${data.fields.temperatureF[i]}°F / ${data.fields.dewpointF[i]}°F · ${Math.round(data.fields.elevationM[i] * 3.281).toLocaleString()} ft`;
  }
  if (field) html += `<br><b>${field.label}:</b> ${Number(valueAt(field.values, at).toFixed(field.decimals)).toLocaleString()} ${field.unit}${field.second ? ` · ${field.second.label} ${valueAt(field.second.values, at).toFixed(0)} ${field.second.unit}` : ''}`;
  tip.innerHTML = html; tip.style.display = 'block';
  const main = canvas.parentElement.getBoundingClientRect();
  tip.style.left = `${Math.min(main.width - 250, event.clientX - main.left + 14)}px`; tip.style.top = `${event.clientY - main.top + 14}px`;
});
canvas.addEventListener('mouseleave', () => { tip.style.display = 'none'; });

async function showSounding(at) {
  selected = at;
  document.body.classList.add('with-sounding');
  $('soundingTitle').textContent = 'Loading…';
  resize();
  try {
    const sounding = await getJson(`/api/live/sounding?row=${at.row}&column=${at.column}`);
    if (selected !== at) return;
    drawSounding($('skewTCanvas'), sounding); drawHodograph($('hodoCanvas'), sounding);
    const p = sounding.params, surface = sounding.context?.surface ?? {}, round = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d) : '—');
    $('soundingTitle').textContent = `${Math.round(at.xKm / 1.609)} mi east, ${Math.round(at.yKm / 1.609)} mi south`;
    $('soundingNote').textContent = `${round(surface.temperatureF)}°F / ${round(surface.dewpointF)}°F at the ground · valid ${clock(sounding.validHourUtc)} UTC${data.latest ? '' : ' (soundings are always for the current time, not the frame shown)'}`;
    showSoundingTables(sounding);
  } catch { $('soundingTitle').textContent = 'Sounding not available'; }
}
// The tables beside a sounding, laid out as on a SHARPpy-style sounding: parcels, winds by
// layer, moisture and lapse rates, the composite indices and the possible hazard type.
const HAZARD_COLOURS = { 'PDS TOR': '#ff4dff', TOR: '#ff4d4d', 'MRGL TOR': '#ff8a8a', SVR: '#facc15', 'MRGL SVR': '#38bdf8', NONE: '#94a3b8' };
function showSoundingTables(sounding) {
  const p = sounding.params, d = sounding.display ?? {}, motion = sounding.engineMotion ?? { right: p.stormMotion.right, left: p.stormMotion.left, ordinary: p.meanWind };
  const n = (v, digits = 0) => (Number.isFinite(Number(v)) ? Number(v).toFixed(digits) : '—');
  const from = v => `${String(Math.round((Math.atan2(-v.u, -v.v) * 180 / Math.PI + 360) % 360) % 360).padStart(3, '0')}/${Math.round(Math.hypot(v.u, v.v))}`;
  const parcel = (name, row) => `<tr><td>${name}</td><td>${n(row.cape)}</td><td>${n(row.cin)}</td><td>${n(row.lclAglM)}</td><td>${n(row.liftedIndex)}</td><td>${n(row.lfcAglM)}</td><td>${n(row.elAglM)}</td></tr>`;
  const list = rows => `<dl>${rows.map(([name, value]) => `<dt>${name}</dt><dd>${value}</dd>`).join('')}</dl>`;
  const hazard = d.hazardType ?? 'NONE';
  $('soundingTables').innerHTML = `
    <section class="wide"><table><tr><th>PCL</th><th>CAPE</th><th>CINH</th><th>LCL m</th><th>LI</th><th>LFC m</th><th>EL m</th></tr>
      ${parcel('SFC', p.parcels.surface)}${parcel('ML', p.parcels.mixedLayer)}${parcel('MU', p.parcels.mostUnstable)}</table></section>
    <section><table><tr><th>Layer</th><th>SRH</th><th>Shear kt</th></tr>
      <tr><td>SFC-1 km</td><td>${n(p.srh01)}</td><td>${n(p.shear01)}</td></tr><tr><td>SFC-3 km</td><td>${n(p.srh03)}</td><td>${n(p.shear03)}</td></tr>
      <tr><td>SFC-6 km</td><td></td><td>${n(p.shear06)}</td></tr><tr><td>SFC-8 km</td><td></td><td>${n(d.shear08)}</td></tr></table>
      ${list([['Storm motion, right', `${from(motion.right)} kt`], ['Storm motion, left', `${from(motion.left)} kt`], ['Mean wind', `${from(motion.ordinary)} kt`], ['4-6 km storm-rel. wind', `${n(d.srw46)} kt`], ['Critical angle', `${n(p.criticalAngle)}°`]])}</section>
    <section>${list([['PW', `${n(p.precipWater, 2)} in`], ['3CAPE', `${n(d.cape03)} J/kg`], ['DCAPE', `${n(p.dcape)} J/kg`], ['Lapse 0-3 km', `${n(p.lapseRate03km, 1)} C/km`], ['Lapse 3-6 km', `${n(d.lapse36, 1)} C/km`], ['Lapse 850-500', `${n(p.lapseRate850500, 1)} C/km`], ['Lapse 700-500', `${n(p.lapseRate700500, 1)} C/km`], ['Freezing level', `${n(d.freezingAglM)} m`], ['Wet-bulb zero', `${n(d.wetBulbZeroAglM)} m`], ['Mean RH low / mid', `${n(d.lowRh)} / ${n(d.midRh)} %`]])}</section>
    <section class="wide">${list([['Supercell composite', n(p.scp, 1)], ['Sig. tornado', n(p.stp, 1)], ['Sig. hail', n(d.ship, 1)], ['Wind damage', n(d.windDamage, 1)]])}
      <div class="snd-hazard"><small>Psbl haz. type</small><b style="color:${HAZARD_COLOURS[hazard] ?? HAZARD_COLOURS.NONE}">${hazard}</b></div></section>`;
}

canvas.addEventListener('click', event => { const at = pointer(event); if (at) showSounding(at); });
$('soundingClose').addEventListener('click', () => { selected = null; document.body.classList.remove('with-sounding'); resize(); });

// --- The world: move it on, stop its clock, or start another one.
async function post(url, body) { const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(String(response.status)); return response.json(); }
const worldNote = text => { $('worldNote').textContent = text; };
$('worldAdvance').addEventListener('click', async () => { worldNote('Advancing…'); try { await post('/api/authority/advance', { hours: 0.5 }); frameHour = null; await load(); worldNote('Moved on half an hour.'); } catch { worldNote('Could not advance.'); } });
$('worldClock').addEventListener('click', async () => { try { await post('/api/authority/clock', { enabled: !data?.clockRunning }); await load(); } catch { worldNote('Could not change the clock.'); } });
$('worldNew').addEventListener('click', async () => {
  const answer = window.prompt('Starting number for the new world (any whole number). The current world is replaced.', String((data?.seed ?? 1) + 1));
  if (answer === null || !Number.isFinite(Number(answer))) return;
  worldNote('Building a new world. This takes about a minute…');
  try { await post('/api/authority/reset', { seed: Math.trunc(Number(answer)) }); frameHour = null; fieldCache.clear(); await load(); worldNote('New world started.'); } catch { worldNote('The new world could not be started.'); }
});

// --- Controls.
for (const control of [controls.stations, controls.isobars, controls.fronts, controls.storms]) control.addEventListener('change', draw);
controls.parameter.addEventListener('change', load);
for (const button of document.querySelectorAll('[data-style]')) button.addEventListener('click', () => { style = button.dataset.style; for (const other of document.querySelectorAll('[data-style]')) other.classList.toggle('on', other === button); draw(); });

function stopLoop() { if (looping) { clearInterval(looping); looping = null; } }
function showFrame(index) { if (!data?.frames) return null; const i = Math.max(0, Math.min(data.frames.length - 1, index)); frameHour = i === data.frames.length - 1 ? null : data.frames[i]; return load(); }
$('frameSlider').addEventListener('input', event => { stopLoop(); showFrame(Number(event.target.value)); });
$('framePrev').addEventListener('click', () => { stopLoop(); showFrame(data.frames.indexOf(data.frameHour) - 1); });
$('frameNext').addEventListener('click', () => { stopLoop(); showFrame(data.frames.indexOf(data.frameHour) + 1); });
$('frameLatest').addEventListener('click', () => { stopLoop(); frameHour = null; load(); });
$('framePlay').addEventListener('click', () => {
  if (looping) { stopLoop(); frameHour = null; load(); return; }
  let index = 0, busy = false;
  looping = setInterval(async () => { if (busy || !data?.frames) return; busy = true; frameHour = data.frames[index % data.frames.length]; index++; await load(); busy = false; }, LOOP_MS);
});

// ?sounding=row,column opens the page with that sounding shown (after the first load).
const wantedSounding = new URLSearchParams(location.search).get('sounding');
new ResizeObserver(resize).observe(canvas);
refresh().then(() => { if (wantedSounding && data?.status === 'ready') { const [row, column] = wantedSounding.split(',').map(Number), cellKm = data.domain.cellKm; showSounding({ row, column, xKm: (column + 0.5) * cellKm, yKm: (row + 0.5) * cellKm }); } });

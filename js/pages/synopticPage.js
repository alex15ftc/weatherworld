// Synoptic page: the whole large-scale model (a channel that wraps east-west) with the game
// map's place in it. One field is shaded, another contoured and one wind drawn as barbs; the
// presets are the usual upper-air and surface charts. The view starts centred on the map and
// follows it as it drifts; it can be zoomed (wheel, buttons) and dragged. The server keeps the
// last 18 hours of frames for a loop (server/SynopticRuntime.js).
const canvas = document.getElementById('synCanvas'), ctx = canvas.getContext('2d'), tip = document.getElementById('synTip');
const $ = id => document.getElementById(id);
const REFRESH_MS = 10000, LOOP_MS = 450, BACKGROUND = '#101822';
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

// Colour stops [value, r, g, b, alpha]; below: whether values under the first stop take its colour
// (else they are clear). Contours: every `interval` (from `from` up, zero left out with skipZero) or
// the listed `levels`; dashed for temperatures.
const SCALES = {
  wspd250: { stops: [[50, 50, 110, 220, 0], [60, 60, 120, 230, 0.5], [80, 40, 190, 240, 0.65], [100, 90, 230, 140, 0.75], [120, 250, 220, 70, 0.82], [140, 250, 130, 50, 0.88], [170, 230, 50, 140, 0.92]], interval: 20, from: 50 },
  wspd500: { stops: [[30, 50, 110, 220, 0], [40, 60, 120, 230, 0.45], [55, 40, 190, 240, 0.6], [70, 90, 230, 140, 0.72], [85, 250, 220, 70, 0.8], [100, 250, 130, 50, 0.88]], interval: 10, from: 40 },
  wspd850: { stops: [[20, 60, 120, 230, 0], [25, 60, 140, 230, 0.45], [35, 40, 200, 220, 0.62], [45, 120, 230, 120, 0.75], [55, 250, 210, 70, 0.85], [70, 250, 100, 60, 0.9]], interval: 10, from: 20 },
  z250: { stops: [[1000, 70, 90, 170, 0.55], [1040, 70, 150, 170, 0.45], [1070, 170, 160, 90, 0.45], [1090, 190, 110, 70, 0.55]], below: true, interval: 12, from: 0 },
  z500: { stops: [[550, 90, 80, 180, 0.55], [570, 60, 140, 190, 0.45], [585, 90, 170, 110, 0.4], [595, 190, 160, 80, 0.45], [605, 200, 100, 70, 0.55]], below: true, interval: 6, from: 0 },
  vort500: { stops: [[12, 255, 235, 120, 0], [14, 255, 235, 120, 0.4], [18, 255, 180, 60, 0.62], [22, 255, 100, 60, 0.78], [26, 220, 40, 120, 0.88], [32, 160, 40, 200, 0.95]], interval: 4, from: 14 },
  t500: { stops: [[-30, 150, 90, 220, 0.6], [-20, 70, 110, 230, 0.55], [-12, 60, 180, 220, 0.5], [-8, 90, 200, 120, 0.5], [-4, 240, 210, 80, 0.55], [2, 240, 110, 60, 0.6]], below: true, interval: 2, from: -40, dash: true },
  qtrans: { stops: [[100, 60, 160, 120, 0], [150, 60, 170, 120, 0.45], [250, 40, 200, 170, 0.62], [350, 60, 160, 240, 0.75], [500, 160, 90, 240, 0.85], [700, 230, 80, 200, 0.92]], interval: 100, from: 100 },
  qadv: { stops: [[-2, 170, 110, 50, 0.9], [-0.6, 170, 120, 60, 0.55], [-0.2, 170, 120, 60, 0], [0.2, 40, 170, 90, 0], [0.6, 40, 180, 100, 0.55], [2, 30, 200, 140, 0.9]], below: true, interval: 0.5, skipZero: true },
  tadv: { stops: [[-4, 70, 120, 255, 0.9], [-1.2, 80, 130, 240, 0.55], [-0.3, 80, 130, 240, 0], [0.3, 240, 90, 70, 0], [1.2, 240, 100, 70, 0.55], [4, 255, 60, 60, 0.9]], below: true, interval: 1, skipZero: true },
  mslp: { stops: [[990, 140, 80, 200, 0.55], [1004, 70, 120, 200, 0.45], [1013, 70, 150, 130, 0.35], [1020, 190, 160, 80, 0.45], [1032, 200, 100, 70, 0.55]], below: true, interval: 4, from: 0 },
  tair: { stops: [[10, 160, 100, 230, 0.6], [32, 70, 120, 230, 0.55], [50, 60, 190, 210, 0.5], [65, 100, 200, 110, 0.5], [78, 240, 210, 80, 0.55], [90, 240, 120, 60, 0.6], [105, 200, 40, 70, 0.65]], below: true, interval: 10, from: 0, dash: true },
  td: { stops: [[30, 140, 100, 60, 0.5], [40, 170, 140, 90, 0.45], [50, 150, 190, 110, 0.5], [55, 80, 190, 90, 0.6], [60, 40, 170, 80, 0.72], [65, 30, 150, 120, 0.82], [70, 40, 120, 200, 0.88], [75, 110, 70, 220, 0.92]], below: true, interval: 5, from: 45, dash: true },
  q: { stops: [[4, 150, 110, 60, 0.45], [8, 150, 180, 100, 0.45], [11, 60, 180, 90, 0.6], [14, 30, 150, 140, 0.78], [17, 60, 100, 220, 0.88]], below: true, interval: 2, from: 6 },
  ascent: { stops: [[-0.5, 170, 110, 60, 0.75], [-0.1, 170, 120, 60, 0], [0.05, 40, 180, 100, 0], [0.15, 40, 180, 100, 0.5], [0.3, 30, 170, 190, 0.72], [0.6, 80, 100, 240, 0.9]], below: true, interval: 0.1, from: 0.1 },
  rain: { stops: [[0.02, 40, 180, 80, 0], [0.05, 40, 180, 80, 0.5], [0.2, 30, 160, 60, 0.7], [0.5, 240, 220, 60, 0.82], [1, 240, 80, 50, 0.9]], levels: [0.05, 0.1, 0.25, 0.5, 1] },
  shear: { stops: [[20, 60, 140, 230, 0], [30, 60, 140, 230, 0.45], [40, 40, 190, 220, 0.6], [50, 110, 220, 120, 0.72], [60, 250, 210, 70, 0.82], [80, 240, 80, 80, 0.9]], interval: 10, from: 30 }
};
const PRESETS = [
  { key: 'jet', label: '250 mb jet', shade: 'wspd250', contour: 'z250', wind: '250' },
  { key: 'vort', label: '500 mb vorticity', shade: 'vort500', contour: 'z500', wind: '500' },
  { key: 'llj', label: '850 mb low-level jet', shade: 'wspd850', contour: 'td', wind: '850' },
  { key: 'surface', label: 'Surface', shade: 'tair', contour: 'mslp', wind: 'sfc' },
  { key: 'moisture', label: 'Dewpoint', shade: 'td', contour: 'mslp', wind: 'sfc' },
  { key: 'transport', label: 'Moisture transport', shade: 'qtrans', contour: 'q', wind: '850' },
  { key: 'surge', label: 'Moisture surge', shade: 'qadv', contour: 'td', wind: '850' },
  { key: 'tadv', label: 'Warm / cold advection', shade: 'tadv', contour: 'tair', wind: '850' },
  { key: 'lift', label: 'Large-scale lift', shade: 'ascent', contour: 'z500', wind: '500' },
  { key: 'rain', label: 'Large-scale rain', shade: 'rain', contour: 'mslp', wind: 'sfc' },
  { key: 'shear', label: 'Deep-layer shear', shade: 'shear', contour: 'z500', wind: 'shear' },
  { key: 't500', label: '500 mb temperature', shade: 't500', contour: 'z500', wind: '500' }
];

let data = null, layers = { shade: null, contour: null, wind: null };
let frameHour = null, looping = null;
const fieldCache = new Map();   // `${key}:${frameHour}` -> field
const contourCache = new Map(); // `${key}:${frameHour}` -> segments by level
const shadeImage = { canvas: null, key: '' };
// The view: centre (grid units, x east, y north), zoom over the fit-to-window scale; it follows the
// map until dragged.
const view = { cx: 0, cy: 0, zoom: 1, follow: true, scale: 1, width: 0, height: 0 };

// --- Loading.
async function getJson(url) { const response = await fetch(url, { cache: 'no-store' }); if (!response.ok) throw new Error(String(response.status)); return response.json(); }
async function getField(key) {
  if (!key) return null;
  const id = `${key}:${data.frameHour}`;
  if (!fieldCache.has(id)) { fieldCache.set(id, await getJson(`/api/synoptic/field?key=${encodeURIComponent(key)}&frame=${data.frameHour}`)); if (fieldCache.size > 160) fieldCache.delete(fieldCache.keys().next().value); }
  return fieldCache.get(id);
}
async function load() {
  try {
    data = await getJson(`/api/synoptic/frame${frameHour === null ? '' : `?frame=${frameHour}`}`);
    if (!$('shadeField').dataset.filled) fillSelects();
    const [shade, contour, wind] = await Promise.all([getField($('shadeField').value), getField($('contourField').value), getField($('windField').value ? `wind:${$('windField').value}` : '')]);
    layers = { shade, contour, wind };
  } catch { data = { status: 'offline' }; layers = { shade: null, contour: null, wind: null }; }
  describe();
  draw();
}
async function refresh() { if (!looping) await load(); setTimeout(refresh, data?.status === 'ready' ? REFRESH_MS : 2500); }

// --- Side panel.
const clock = hours => { const h = ((hours % 24) + 24) % 24; return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`; };
const words = text => String(text ?? '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
const compass = deg => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

function fillSelects() {
  const fill = (select, none) => {
    select.innerHTML = `<option value="">${none}</option>`;
    const groups = new Map();
    for (const f of data.fields) { if (!groups.has(f.group)) groups.set(f.group, []); groups.get(f.group).push(f); }
    for (const [name, list] of groups) { const group = document.createElement('optgroup'); group.label = name; for (const f of list) group.append(new Option(`${f.label} (${f.unit})`, f.key)); select.append(group); }
  };
  fill($('shadeField'), 'None'); fill($('contourField'), 'None');
  $('windField').innerHTML = '<option value="">None</option>' + data.winds.map(w => `<option value="${w.key}">${w.label}</option>`).join('');
  $('shadeField').dataset.filled = '1';
  const wanted = new URLSearchParams(location.search).get('chart');
  applyPreset(PRESETS.find(p => p.key === wanted) ?? PRESETS[0], false);
}

function describe() {
  const time = $('synTime'), status = $('synStatus');
  if (data.status !== 'ready') { time.textContent = '—'; status.textContent = 'Server not reachable. Start it with npm start (a first start takes about a minute).'; return; }
  time.textContent = data.date ? `${data.date} · ${clock(data.hourUtc)} UTC` : `${clock(data.hourUtc)} UTC`;
  const behind = data.frames.at(-1) - data.frameHour;
  status.textContent = `${clock(data.hourUtc + data.localOffsetHours)} local · ${data.latest ? 'current analysis' : `${behind} h ago`} · seed ${data.seed}`;
  const slider = $('frameSlider'); slider.max = data.frames.length - 1; slider.value = data.frames.indexOf(data.frameHour);
  $('frameLatest').classList.toggle('on', frameHour === null && !looping);
  $('framePlay').classList.toggle('on', Boolean(looping)); $('framePlay').textContent = looping ? 'Stop' : 'Loop';
  const s = data.slide, speed = Math.hypot(s.eastKmh, s.northKmh), mi = km => Math.round(km * 0.621371);
  const drift = speed < 1 ? 'holding still' : `${mi(speed)} mph toward the ${compass(Math.atan2(s.eastKmh, s.northKmh) * 180 / Math.PI)}`;
  const centre = mapCentre(), offNorth = (centre.y - (data.grid.ny - 1) / 2) * data.grid.km;
  const lows = data.centres.filter(c => c.type === 'L'), nearest = lows.map(c => ({ c, km: distanceKm(centre, c) })).sort((a, b) => a.km - b.km)[0];
  $('synFacts').innerHTML = [
    ['Map size', `${mi(data.map.km)} mi square`],
    ['Map drift', drift],
    ['Today\'s aim', s.plan ? words(s.plan.kind) : '—'],
    ['From the jet axis', `${mi(Math.abs(offNorth))} mi ${offNorth >= 0 ? 'north' : 'south'}`],
    ['Nearest low', nearest ? `${nearest.c.hpa} hPa, ${mi(nearest.km)} mi ${compass(bearing(centre, nearest.c))}` : 'none']
  ].map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');
  drawLegend();
  for (const button of document.querySelectorAll('#presets button')) { const p = PRESETS.find(x => x.key === button.dataset.preset); button.classList.toggle('on', p.shade === $('shadeField').value && p.contour === $('contourField').value && p.wind === $('windField').value); }
}

function applyPreset(preset, reload = true) {
  $('shadeField').value = preset.shade; $('contourField').value = preset.contour; $('windField').value = preset.wind;
  const url = new URL(location.href); url.searchParams.set('chart', preset.key); history.replaceState(null, '', url);
  if (reload) load();
}

// --- Colours and legend.
function colourAt(scale, value) {
  const stops = scale.stops;
  if (value <= stops[0][0]) return scale.below ? stops[0].slice(1) : [stops[0][1], stops[0][2], stops[0][3], 0];
  for (let i = 1; i < stops.length; i++) if (value <= stops[i][0]) { const a = stops[i - 1], b = stops[i], t = (value - a[0]) / (b[0] - a[0]); return [1, 2, 3, 4].map(c => a[c] + (b[c] - a[c]) * t); }
  return stops.at(-1).slice(1);
}
function drawLegend() {
  const bar = $('legendBar'), g = bar.getContext('2d'), ticks = $('legendTicks'), note = $('legendNote'), field = layers.shade, scale = field && SCALES[field.key];
  g.clearRect(0, 0, bar.width, bar.height); ticks.innerHTML = '';
  const parts = [];
  if (scale) {
    const from = scale.stops[0][0], to = scale.stops.at(-1)[0];
    g.fillStyle = BACKGROUND; g.fillRect(0, 0, bar.width, bar.height);
    for (let x = 0; x < bar.width; x++) { const [r, gr, b, a] = colourAt(scale, from + (to - from) * x / (bar.width - 1)); g.fillStyle = `rgba(${r | 0},${gr | 0},${b | 0},${Math.max(0.12, a)})`; g.fillRect(x, 0, 1, bar.height); }
    for (const value of [from, (from + to) / 2, to]) { const tick = document.createElement('span'); tick.textContent = Number(value.toFixed(2)).toLocaleString(); ticks.append(tick); }
    parts.push(`Shaded: ${field.label} (${field.unit})`);
  }
  if (layers.contour) parts.push(`Lines: ${layers.contour.label} (${layers.contour.unit})`);
  if (layers.wind) parts.push(`Barbs: ${data.winds.find(w => `wind:${w.key}` === layers.wind.key)?.label.toLowerCase() ?? 'wind'} (kt; half barb 5, full 10, flag 50)`);
  note.textContent = parts.join(' · ') || 'Pick a chart or a layer.';
}

// --- Geometry. Grid point (i, j) sits at x = i, y = j (north up); x wraps every nx.
const mapCentre = () => ({ x: data.map.x + data.map.width / 2, y: data.map.y + data.map.height / 2 });
const wrapDx = dx => { const nx = data.grid.nx; return ((dx % nx) + nx * 1.5) % nx - nx / 2; };
const distanceKm = (a, b) => Math.hypot(wrapDx(b.x - a.x), b.y - a.y) * data.grid.km;
const bearing = (a, b) => Math.atan2(wrapDx(b.x - a.x), b.y - a.y) * 180 / Math.PI;
const toScreen = (x, y) => [view.width / 2 + (x - view.cx) * view.scale, view.height / 2 - (y - view.cy) * view.scale];
const toGrid = (sx, sy) => ({ x: view.cx + (sx - view.width / 2) / view.scale, y: view.cy - (sy - view.height / 2) / view.scale });
// The copies of the wrapping domain (offsets in x) that can be seen.
function copies(margin = 0) {
  const nx = data.grid.nx, half = view.width / 2 / view.scale, out = [];
  for (let k = Math.floor((view.cx - half - margin) / nx) - 1; k <= Math.floor((view.cx + half + margin) / nx) + 1; k++) out.push(k * nx);
  return out;
}

function fitView() {
  const { nx, ny } = data.grid, fit = Math.min(view.width / nx, view.height / (ny + 1));
  view.scale = fit * view.zoom;
  if (view.follow) view.cx = mapCentre().x;
  const half = view.height / 2 / view.scale;
  view.cy = ny * view.scale + view.scale <= view.height ? (ny - 1) / 2 : Math.min(ny - 0.5 - half, Math.max(half - 0.5, view.follow ? mapCentre().y : view.cy));
}

// --- Drawing.
function resize() {
  const ratio = window.devicePixelRatio || 1, box = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(box.width * ratio)); canvas.height = Math.max(1, Math.round(box.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  // Narrow screens open zoomed in around the map (the whole channel is a thin strip there).
  if (!view.width && box.width < 700) view.zoom = 3;
  view.width = box.width; view.height = box.height;
  draw();
}

function draw() {
  ctx.clearRect(0, 0, view.width, view.height);
  ctx.fillStyle = '#0a0f15'; ctx.fillRect(0, 0, view.width, view.height);
  if (!data || data.status !== 'ready') { ctx.fillStyle = '#96a5b7'; ctx.font = '15px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Waiting for the server…', view.width / 2, view.height / 2); return; }
  fitView();
  const { ny } = data.grid, [, top] = toScreen(0, ny - 0.5), [, bottom] = toScreen(0, -0.5);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, top, view.width, bottom - top); ctx.clip();
  ctx.fillStyle = BACKGROUND; ctx.fillRect(0, top, view.width, bottom - top);
  if (layers.shade && SCALES[layers.shade.key]) drawShading(layers.shade);
  if ($('showGrid').checked) drawGrid();
  if (layers.contour) drawContours(layers.contour);
  if (layers.wind) drawBarbs(layers.wind);
  if ($('showCentres').checked) drawCentres();
  if ($('showMap').checked) drawMapBox();
  ctx.restore();
  // The channel's northern and southern edges (the weather wraps there; the mean state does not).
  ctx.strokeStyle = '#2c3948'; ctx.lineWidth = 1;
  for (const y of [top, bottom]) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(view.width, y + 0.5); ctx.stroke(); }
  drawScale(bottom);
}

// Shading from one value per grid point, scaled up smoothly; one column is repeated at each side
// so the smoothing carries across the wrap, and each copy is clipped to its own width.
function drawShading(field) {
  const { nx, ny } = data.grid, scale = SCALES[field.key], id = `${field.key}:${field.frameHour}`;
  if (shadeImage.key !== id) {
    const c = shadeImage.canvas ??= document.createElement('canvas'); c.width = nx + 2; c.height = ny;
    const g = c.getContext('2d'), image = g.createImageData(nx + 2, ny);
    for (let r = 0; r < ny; r++) for (let p = 0; p < nx + 2; p++) {
      const j = ny - 1 - r, i = (p - 1 + nx) % nx, [cr, cg, cb, ca] = colourAt(scale, field.values[j * nx + i]), o = (r * (nx + 2) + p) * 4;
      image.data[o] = cr; image.data[o + 1] = cg; image.data[o + 2] = cb; image.data[o + 3] = ca * 255;
    }
    g.putImageData(image, 0, 0); shadeImage.key = id;
  }
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  for (const offset of copies()) {
    const [left, topY] = toScreen(offset - 1.5, ny - 0.5), [x0] = toScreen(offset - 0.5, 0), [x1] = toScreen(offset + nx - 0.5, 0);
    if (x1 < 0 || x0 > view.width) continue;
    ctx.save(); ctx.beginPath(); ctx.rect(x0, topY, x1 - x0, ny * view.scale); ctx.clip();
    ctx.drawImage(shadeImage.canvas, left, topY, (nx + 2) * view.scale, ny * view.scale);
    ctx.restore();
  }
}

function contourLevels(field) {
  const scale = SCALES[field.key] ?? {};
  if (scale.levels) return scale.levels;
  const interval = scale.interval ?? (field.max - field.min) / 8, out = [];
  if (!(interval > 0)) return out;
  for (let v = Math.ceil(field.min / interval) * interval; v <= field.max; v += interval) {
    const level = Math.round(v / interval) * interval;
    if (scale.skipZero && Math.abs(level) < interval / 2) continue;
    if (scale.from !== undefined && level < scale.from - 1e-9) continue;
    out.push(Number(level.toFixed(4)));
  }
  return out;
}
// Marching squares on the grid (wrapping east-west), as segments in grid units, by level.
function contourSegments(field) {
  const id = `${field.key}:${field.frameHour}`;
  if (contourCache.has(id)) return contourCache.get(id);
  const { nx, ny } = data.grid, values = field.values, out = [];
  for (const level of contourLevels(field)) {
    const segments = [];
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx; i++) {
      const i1 = (i + 1) % nx, a = values[j * nx + i], b = values[j * nx + i1], c = values[(j + 1) * nx + i1], d = values[(j + 1) * nx + i], cross = [];
      const edge = (v1, v2, x1, y1, x2, y2) => { if ((v1 < level) !== (v2 < level)) { const t = (level - v1) / (v2 - v1); cross.push(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t); } };
      edge(a, b, i, j, i + 1, j); edge(b, c, i + 1, j, i + 1, j + 1); edge(d, c, i, j + 1, i + 1, j + 1); edge(a, d, i, j, i, j + 1);
      for (let k = 0; k + 3 < cross.length; k += 4) segments.push(cross[k], cross[k + 1], cross[k + 2], cross[k + 3]);
    }
    if (segments.length) out.push({ level, segments });
  }
  contourCache.set(id, out);
  if (contourCache.size > 120) contourCache.delete(contourCache.keys().next().value);
  return out;
}
function drawContours(field) {
  const scale = SCALES[field.key] ?? {}, colour = 'rgba(255,255,255,.85)', dash = scale.dash ? [6, 4] : [], lines = contourSegments(field);
  const decimals = (scale.interval ?? 1) < 1 || scale.levels ? 2 : 0;
  ctx.save(); ctx.lineWidth = 1.25; ctx.strokeStyle = colour; ctx.setLineDash(dash);
  ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const labels = [];
  for (const offset of copies(2)) for (const { level, segments } of lines) {
    ctx.beginPath();
    let count = 0, best = null;
    for (let s = 0; s < segments.length; s += 4) {
      const [x1, y1] = toScreen(segments[s] + offset, segments[s + 1]), [x2, y2] = toScreen(segments[s + 2] + offset, segments[s + 3]);
      if (Math.max(x1, x2) < -20 || Math.min(x1, x2) > view.width + 20) continue;
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); count++;
      // Labels every so often along the line, clear of each other and of the edges.
      if (count % 14 === 7) { const mx = (x1 + x2) / 2, my = (y1 + y2) / 2; if (mx > 24 && mx < view.width - 24 && my > 14 && my < view.height - 14 && !labels.some(l => Math.hypot(l[0] - mx, l[1] - my) < 70)) { labels.push([mx, my]); best = [...(best ?? []), [mx, my]]; } }
    }
    ctx.stroke();
    if (best) {
      const text = Number(level.toFixed(decimals)).toLocaleString(), w = ctx.measureText(text).width + 6;
      ctx.setLineDash([]);
      for (const [mx, my] of best) { ctx.fillStyle = 'rgba(16,24,34,.9)'; ctx.fillRect(mx - w / 2, my - 7, w, 14); ctx.fillStyle = colour; ctx.fillText(text, mx, my + 0.5); }
      ctx.setLineDash(dash);
    }
  }
  ctx.restore();
}

function drawBarbs(wind) {
  const { nx, ny } = data.grid, stride = Math.max(1, Math.ceil(38 / view.scale));
  for (const offset of copies(1)) for (let j = 0; j < ny; j += stride) for (let i = 0; i < nx; i += stride) {
    const [x, y] = toScreen(i + offset, j);
    if (x < -30 || x > view.width + 30 || y < -30 || y > view.height + 30) continue;
    const u = wind.u[j * nx + i], v = wind.v[j * nx + i];
    drawBarb(x, y, Math.hypot(u, v), Math.atan2(-u, -v) * 180 / Math.PI, 'rgba(215,236,255,.72)');
  }
}
// Points to where the wind comes from; half barb 5 kt, full 10, flag 50 (as on the mesoanalysis page).
function drawBarb(x, y, speed, fromDeg, colour) {
  ctx.strokeStyle = ctx.fillStyle = colour; ctx.lineWidth = 1.2; ctx.setLineDash([]);
  let knots = Math.round(speed / 5) * 5;
  if (knots < 5) { ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.stroke(); return; }
  const angle = fromDeg * Math.PI / 180, sx = Math.sin(angle), sy = -Math.cos(angle), fx = Math.sin(angle + Math.PI / 2 * 0.78), fy = -Math.cos(angle + Math.PI / 2 * 0.78), staff = 21;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sx * staff, y + sy * staff); ctx.stroke();
  let at = staff;
  for (; knots >= 50; knots -= 50, at -= 7) { ctx.beginPath(); ctx.moveTo(x + sx * at, y + sy * at); ctx.lineTo(x + sx * (at - 3) + fx * 9, y + sy * (at - 3) + fy * 9); ctx.lineTo(x + sx * (at - 6), y + sy * (at - 6)); ctx.closePath(); ctx.fill(); }
  for (; knots >= 10; knots -= 10, at -= 4) { ctx.beginPath(); ctx.moveTo(x + sx * at, y + sy * at); ctx.lineTo(x + sx * at + fx * 9, y + sy * at + fy * 9); ctx.stroke(); }
  if (knots >= 5) { if (at === staff) at -= 4; ctx.beginPath(); ctx.moveTo(x + sx * at, y + sy * at); ctx.lineTo(x + sx * at + fx * 4.5, y + sy * at + fy * 4.5); ctx.stroke(); }
}

function outlinedText(text, x, y, colour, font) {
  ctx.font = font; ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(8,12,18,.9)'; ctx.setLineDash([]); ctx.strokeText(text, x, y); ctx.fillStyle = colour; ctx.fillText(text, x, y);
}
function drawCentres() {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const offset of copies(1)) for (const c of data.centres) {
    const [x, y] = toScreen(c.x + offset, c.y);
    if (x < -20 || x > view.width + 20) continue;
    const colour = c.type === 'L' ? '#ff5d6c' : '#5ea8ff';
    outlinedText(c.type, x, y, colour, '800 22px system-ui, sans-serif');
    outlinedText(String(c.hpa), x, y + 17, colour, '700 11px system-ui, sans-serif');
  }
}
// Lines every 1,000 km, and the mean jet core along the channel's middle.
function drawGrid() {
  const { ny, km } = data.grid, step = 1000 / km;
  ctx.save(); ctx.strokeStyle = 'rgba(150,165,183,.14)'; ctx.lineWidth = 1;
  const left = toGrid(0, 0).x, right = toGrid(view.width, 0).x;
  for (let x = Math.ceil(left / step) * step; x <= right; x += step) { const [sx, sy0] = toScreen(x, ny - 0.5), [, sy1] = toScreen(x, -0.5); ctx.beginPath(); ctx.moveTo(sx, sy0); ctx.lineTo(sx, sy1); ctx.stroke(); }
  for (let y = -0.5 + step; y < ny - 0.5; y += step) { const [, sy] = toScreen(0, y); ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(view.width, sy); ctx.stroke(); }
  const [, jy] = toScreen(0, (ny - 1) / 2);
  ctx.strokeStyle = 'rgba(255,214,102,.35)'; ctx.setLineDash([10, 8]); ctx.beginPath(); ctx.moveTo(0, jy); ctx.lineTo(view.width, jy); ctx.stroke();
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; outlinedText('mean jet core', 8, jy - 3, 'rgba(255,214,102,.8)', '600 11px system-ui, sans-serif');
  ctx.restore();
}
// The game map's box, its name and an arrow for the next 6 hours of its drift.
function drawMapBox() {
  const m = data.map, s = data.slide, hours = 6, dx = s.eastKmh * hours / data.grid.km, dy = s.northKmh * hours / data.grid.km;
  for (const offset of copies(m.width)) {
    const [x0, y0] = toScreen(m.x + offset, m.y + m.height), [x1, y1] = toScreen(m.x + m.width + offset, m.y);
    if (x1 < -40 || x0 > view.width + 40) continue;
    ctx.save();
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(8,12,18,.85)'; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; outlinedText('Game map', x0 + 1, y0 - 4, '#ffffff', '800 12px system-ui, sans-serif');
    if (Math.hypot(dx, dy) > 0.15) {
      const [cx, cy] = toScreen(m.x + m.width / 2 + offset, m.y + m.height / 2), [ex, ey] = toScreen(m.x + m.width / 2 + dx + offset, m.y + m.height / 2 + dy), a = Math.atan2(ey - cy, ex - cx);
      ctx.strokeStyle = ctx.fillStyle = '#ffe066'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - 9 * Math.cos(a - 0.45), ey - 9 * Math.sin(a - 0.45)); ctx.lineTo(ex - 9 * Math.cos(a + 0.45), ey - 9 * Math.sin(a + 0.45)); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
}
function drawScale(bottom) {
  const miles = view.scale * (1000 / 1.609344) / data.grid.km < 60 ? 1000 : 500, length = miles * 1.609344 / data.grid.km * view.scale;
  const x = 14, y = Math.min(view.height - 14, bottom - 12);
  ctx.save(); ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + length, y); ctx.stroke();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; outlinedText(`${miles.toLocaleString()} miles`, x, y - 7, '#cbd5e1', '11px system-ui, sans-serif');
  ctx.textAlign = 'right'; ctx.textBaseline = 'top'; const [, topY] = toScreen(0, data.grid.ny - 0.5); outlinedText('N ↑', view.width - 12, Math.max(8, topY + 8), '#cbd5e1', '11px system-ui, sans-serif');
  ctx.restore();
}

// --- Pointer: values under it; drag pans, wheel zooms.
function sample(values, at) {
  const { nx, ny } = data.grid, y = Math.max(0, Math.min(ny - 1.0001, at.y)), x = ((at.x % nx) + nx) % nx;
  const i0 = Math.floor(x), j0 = Math.floor(y), tx = x - i0, ty = y - j0, i1 = (i0 + 1) % nx, v = (i, j) => values[j * nx + i];
  return (v(i0, j0) * (1 - tx) + v(i1, j0) * tx) * (1 - ty) + (v(i0, j0 + 1) * (1 - tx) + v(i1, j0 + 1) * tx) * ty;
}
function showTip(event) {
  if (!data || data.status !== 'ready') return;
  const box = canvas.getBoundingClientRect(), sx = event.clientX - box.left, sy = event.clientY - box.top, at = toGrid(sx, sy);
  if (at.y < -0.5 || at.y > data.grid.ny - 0.5) { tip.style.display = 'none'; return; }
  const lines = [], fmt = (f, v) => `${f.label}: <b>${Number(v.toFixed(Math.abs(v) < 10 ? 2 : 1)).toLocaleString()}</b> ${f.unit}`;
  if (layers.shade) lines.push(fmt(layers.shade, sample(layers.shade.values, at)));
  if (layers.contour && layers.contour.key !== layers.shade?.key) lines.push(fmt(layers.contour, sample(layers.contour.values, at)));
  if (layers.wind) { const u = sample(layers.wind.u, at), v = sample(layers.wind.v, at); lines.push(`Wind: <b>${Math.round((Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360)}° ${Math.round(Math.hypot(u, v))} kt</b>`); }
  const centre = mapCentre(), km = distanceKm(centre, at);
  lines.push(`<span class="muted">${Math.round(km * 0.621371).toLocaleString()} mi ${compass(bearing(centre, at))} of the map's centre</span>`);
  tip.innerHTML = lines.join('<br>');
  tip.style.display = 'block';
  const parent = canvas.parentElement.getBoundingClientRect(), left = event.clientX - parent.left + 14, w = tip.offsetWidth;
  tip.style.left = `${Math.min(left, parent.width - w - 8)}px`; tip.style.top = `${event.clientY - parent.top + 14}px`;
}
let drag = null;
canvas.addEventListener('pointerdown', event => { drag = { x: event.clientX, y: event.clientY, cx: view.cx, cy: view.cy, moved: false }; canvas.setPointerCapture(event.pointerId); });
canvas.addEventListener('pointermove', event => {
  if (!drag) return showTip(event);
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  drag.moved = true; view.follow = false; canvas.classList.add('dragging'); tip.style.display = 'none';
  view.cx = drag.cx - dx / view.scale; view.cy = drag.cy + dy / view.scale; draw();
});
canvas.addEventListener('pointerup', () => { drag = null; canvas.classList.remove('dragging'); });
canvas.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
function zoomAt(factor, sx = view.width / 2, sy = view.height / 2) {
  if (!data || data.status !== 'ready') return;
  const before = toGrid(sx, sy);
  view.zoom = Math.max(1, Math.min(10, view.zoom * factor));
  view.scale = Math.min(view.width / data.grid.nx, view.height / (data.grid.ny + 1)) * view.zoom;
  if (!view.follow || factor !== 1) { view.follow = false; view.cx = before.x - (sx - view.width / 2) / view.scale; view.cy = before.y + (sy - view.height / 2) / view.scale; }
  draw();
}
canvas.addEventListener('wheel', event => { event.preventDefault(); const box = canvas.getBoundingClientRect(); zoomAt(event.deltaY < 0 ? 1.2 : 1 / 1.2, event.clientX - box.left, event.clientY - box.top); }, { passive: false });
$('zoomIn').addEventListener('click', () => zoomAt(1.4));
$('zoomOut').addEventListener('click', () => zoomAt(1 / 1.4));
$('zoomMap').addEventListener('click', () => { view.follow = true; view.zoom = 4; draw(); });
$('zoomAll').addEventListener('click', () => { view.follow = true; view.zoom = 1; draw(); });

// --- Controls.
for (const preset of PRESETS) { const button = document.createElement('button'); button.textContent = preset.label; button.dataset.preset = preset.key; button.addEventListener('click', () => applyPreset(preset)); $('presets').append(button); }
for (const id of ['shadeField', 'contourField', 'windField']) $(id).addEventListener('change', load);
for (const id of ['showMap', 'showCentres', 'showGrid']) $(id).addEventListener('change', draw);
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

new ResizeObserver(resize).observe(canvas);
refresh();

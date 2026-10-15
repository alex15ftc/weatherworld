// The world map page: the built large-scale map for a seed (data/worldmap/seed-N, written by
// scripts/build-world-map.mjs), drawn as it will be built. Scroll to zoom about the cursor, drag to
// pan. Land cover with hillshading; rivers; interstates, US routes, expressways and state highways;
// interchange ramps, overpasses and signals once zoomed in; paved, gravel and dirt section roads
// as the road rules leave them (js/worldmap/roadNetwork.js); labels for places, rivers, routes
// and exits by zoom.
import { shadeMap, COVER_COLOURS, RIVER_COLOUR } from '../worldmap/worldMapStyle.js';
import { interchangeRamps, crossingSin, tee } from '../worldmap/interchanges.js';
import { sectionSegments, signalJunctions } from '../worldmap/roadNetwork.js';

const $ = id => document.getElementById(id);
const canvas = $('mapCanvas'), ctx = canvas.getContext('2d');
const STUDS_PER_MILE = 1000;   // roblox/src/shared/World/Config.luau

// Road styles: colour, width in pixels, and width in miles (the larger is drawn).
const ROADS = {
  interstate: { colour: '#c8303c', casing: '#ffffff', px: 3.4, mi: 0.102 },
  expressway: { colour: '#e5762b', casing: '#5a2a10', px: 2.8, mi: 0.078 },
  us: { colour: '#f0a030', casing: '#4a2d08', px: 2.2, mi: 0.036 },
  state: { colour: '#f4d35a', casing: '#4a3d10', px: 1.6, mi: 0.036 },
  ramp: { colour: '#e9a0a6', casing: null, px: 1.2, mi: 0.022 }
};
const SECTIONS = { 3: { colour: '#f4f4f0', px: 1, mi: 0.022, from: 4 }, 2: { colour: '#d8cdb4', px: 0.8, mi: 0.016, from: 14 }, 1: { colour: '#9a7854', px: 0.7, mi: 0.01, from: 14 } };
const roadClass = r => (r.kind === 'highway' ? (r.name?.startsWith('US') ? 'us' : 'state') : r.kind);

let map = null, base = null, regionBorders = null, sections = null, signals = [], ramps = [];
const view = { x: 250, y: 250, scale: 1 };   // centre (miles) and pixels per mile
let width = 0, height = 0, dpr = 1;

async function load(seed) {
  $('status').textContent = `Loading seed ${seed}…`;
  const dir = `./data/worldmap/seed-${seed}`;
  try {
    const meta = await (await fetch(`${dir}/meta.json`, { cache: 'no-cache' })).json();
    const bytes = async name => new Uint8Array(await (await fetch(`${dir}/${name}`, { cache: 'no-cache' })).arrayBuffer());
    const [elevation, region, cover, sectionBytes] = await Promise.all([bytes('elevation.f32'), bytes('region.u8'), bytes('cover.u8'), bytes('sections.u8')]);
    map = { ...meta, coverKeys: meta.cover, elevation: new Float32Array(elevation.buffer), region, cover, sections: { ...meta.sectionGrid, roads: sectionBytes } };
  } catch {
    map = null;
    $('status').textContent = `Seed ${seed} not built yet`;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const n = map.size;
  base = document.createElement('canvas');
  base.width = base.height = n;
  base.getContext('2d').putImageData(new ImageData(shadeMap(map, map.coverKeys), n, n), 0, 0);
  regionBorders = document.createElement('canvas');
  regionBorders.width = regionBorders.height = n;
  const rb = new ImageData(n, n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, r = map.region[k];
    if ((i + 1 < n && map.region[k + 1] !== r) || (j + 1 < n && map.region[k + n] !== r)) rb.data.set([245, 245, 245, 200], k * 4);
  }
  regionBorders.getContext('2d').putImageData(rb, 0, 0);
  sections = sectionSegments(map, map.sections);
  signals = signalJunctions(map, map.sections);
  ramps = (map.crossings ?? []).flatMap(c => interchangeRamps(c));
  $('status').textContent = `Seed ${seed} · ${n * map.cellMiles} × ${n * map.cellMiles} mi`;
  renderSummary();
  fit();
}

// Screen pixels (CSS) of a map point, and back.
const sx = x => (x - view.x) * view.scale + width / 2;
const sy = y => (y - view.y) * view.scale + height / 2;
const mx = px => (px - width / 2) / view.scale + view.x;
const my = py => (py - height / 2) / view.scale + view.y;

function fit() {
  const box = canvas.parentElement.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  width = Math.max(200, box.width - 24); height = Math.max(200, box.height - 76);
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  if (map) { view.scale = Math.max(view.scale, minScale()); clampView(); }
  draw();
}
const minScale = () => Math.min(width, height) / (map.size * map.cellMiles);
function clampView() {
  const miles = map.size * map.cellMiles, hw = width / 2 / view.scale, hh = height / 2 / view.scale;
  view.x = hw * 2 >= miles ? miles / 2 : Math.min(miles - hw, Math.max(hw, view.x));
  view.y = hh * 2 >= miles ? miles / 2 : Math.min(miles - hh, Math.max(hh, view.y));
}

function polyline(points, style, scale = view.scale) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
  const w = Math.max(style.px, style.mi * scale);
  if (style.casing) { ctx.strokeStyle = style.casing; ctx.lineWidth = w + 1.6; ctx.stroke(); }
  ctx.strokeStyle = style.colour; ctx.lineWidth = w; ctx.stroke();
}

function draw() {
  if (!map) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0c0f14'; ctx.fillRect(0, 0, width, height);
  const cell = map.cellMiles, miles = map.size * cell, s = view.scale;
  ctx.imageSmoothingEnabled = s / (1 / cell) < 3;
  ctx.drawImage(base, sx(0), sy(0), miles * s, miles * s);
  if ($('showRegions').checked) ctx.drawImage(regionBorders, sx(0), sy(0), miles * s, miles * s);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const left = mx(0) - 1, right = mx(width) + 1, top = my(0) - 1, bottom = my(height) + 1;
  const inView = (x0, y0, x1, y1) => Math.max(x0, x1) >= left && Math.min(x0, x1) <= right && Math.max(y0, y1) >= top && Math.min(y0, y1) <= bottom;

  if ($('showGrid').checked) {
    ctx.strokeStyle = 'rgba(15, 23, 42, .3)'; ctx.lineWidth = 1;
    for (let m = 10; m < miles; m += 10) { ctx.beginPath(); ctx.moveTo(sx(m), sy(0)); ctx.lineTo(sx(m), sy(miles)); ctx.moveTo(sx(0), sy(m)); ctx.lineTo(sx(miles), sy(m)); ctx.stroke(); }
  }
  // Section roads by zoom: paved from 4 px a mile, gravel and dirt from 14.
  if ($('showRoads').checked) {
    for (const cls of [1, 2, 3]) {
      const style = SECTIONS[cls];
      if (s < style.from || (cls < 3 && !$('showSections').checked)) continue;
      ctx.strokeStyle = style.colour; ctx.lineWidth = Math.max(style.px, style.mi * s);
      ctx.beginPath();
      for (const [x0, y0, x1, y1] of sections[cls]) if (inView(x0, y0, x1, y1)) { ctx.moveTo(sx(x0), sy(y0)); ctx.lineTo(sx(x1), sy(y1)); }
      ctx.stroke();
    }
  }
  if ($('showRivers').checked) {
    ctx.strokeStyle = `rgb(${RIVER_COLOUR.join(',')})`;
    for (const river of map.rivers) {
      for (let k = 2; k < river.points.length; k += 2) {
        const [x0, y0, x1, y1] = [river.points[k - 2], river.points[k - 1], river.points[k], river.points[k + 1]];
        if (!inView(x0, y0, x1, y1)) continue;
        // As wide as in the Roblox world (studs, 1000 to the mile), at least a pixel.
        ctx.lineWidth = Math.max(0.8, Math.min(220, Math.max(12, river.widthsM[k / 2] * 0.18)) / STUDS_PER_MILE * s);
        ctx.beginPath(); ctx.moveTo(sx(x0), sy(y0)); ctx.lineTo(sx(x1), sy(y1)); ctx.stroke();
      }
    }
  }
  if ($('showRoads').checked) {
    if (s >= 18) for (const ramp of ramps) polyline(ramp, ROADS.ramp);
    for (const kind of ['state', 'us', 'expressway', 'interstate']) {
      for (const road of map.roads) if (roadClass(road) === kind) polyline(road.points, ROADS[kind]);
    }
    // Overpasses: the crossing road drawn again over the interstate, with parapets.
    if (s >= 10) {
      for (const c of map.crossings ?? []) {
        if (tee(c) || !inView(c.x - 1, c.y - 1, c.x + 1, c.y + 1)) continue;
        const reach = 0.051 / crossingSin(c) + 0.02, style = ROADS[c.kind] ?? { colour: '#f4f4f0', casing: '#333', px: 1.6, mi: 0.026 };
        const a = [c.x - c.vx * reach, c.y - c.vy * reach], b = [c.x + c.vx * reach, c.y + c.vy * reach];
        const w = Math.max(style.px, (style.mi ?? 0.026) * s) + 3;
        ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = w + 2; ctx.beginPath(); ctx.moveTo(sx(a[0]), sy(a[1])); ctx.lineTo(sx(b[0]), sy(b[1])); ctx.stroke();
        polyline([a, b], { ...style, casing: null });
      }
    }
    // Signals at at-grade highway junctions.
    if (s >= 10) {
      for (const [x, y] of signals) {
        if (!inView(x, y, x, y)) continue;
        ctx.fillStyle = '#16a34a'; ctx.strokeStyle = '#052e16'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sx(x), sy(y), 2.6, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      }
    }
    for (const st of map.settlements) {
      if (!inView(st.x, st.y, st.x, st.y)) continue;
      if (st.kind !== 'town' && s < 6) { ctx.fillStyle = 'rgba(148, 163, 184, .3)'; ctx.beginPath(); ctx.arc(sx(st.x), sy(st.y), st.extentMi * s, 0, 2 * Math.PI); ctx.fill(); }
      ctx.fillStyle = '#111827'; ctx.beginPath(); ctx.arc(sx(st.x), sy(st.y), st.kind === 'town' ? 1.8 : 4, 0, 2 * Math.PI); ctx.fill();
    }
  }
  if ($('showLabels').checked) drawLabels(inView);
}

// Labels, the most important first, none overlapping.
function drawLabels(inView) {
  const s = view.scale, placed = [];
  const free = (x, y, w, h) => x >= 0 && y >= 0 && x + w <= width && y + h <= height && !placed.some(r => x < r[0] + r[2] && x + w > r[0] && y < r[1] + r[3] && y + h > r[1]);
  const text = (label, x, y, { size = 12, weight = 600, colour = '#f8fafc', halo = 'rgba(15,23,42,.85)', box = null, boxText = null, rotate = 0, centre = false } = {}) => {
    ctx.font = `${weight} ${size}px system-ui, sans-serif`;
    const w = ctx.measureText(label).width + (box ? 8 : 0), h = size + (box ? 6 : 2);
    const lx = centre ? x - w / 2 : x, ly = y - h / 2;
    if (!rotate && !free(lx, ly, w, h)) return false;
    placed.push([lx, ly, w, h]);
    ctx.save(); ctx.translate(x, y); ctx.rotate(rotate);
    const ox = centre || rotate ? -w / 2 : 0;
    if (box) { ctx.fillStyle = box; ctx.strokeStyle = boxText; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(ox, -h / 2, w, h, 3); ctx.fill(); ctx.stroke(); }
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    if (!box) { ctx.lineWidth = 3; ctx.strokeStyle = halo; ctx.strokeText(label, ox, 0); }
    ctx.fillStyle = box ? boxText : colour; ctx.fillText(label, ox + (box ? 4 : 0), 0);
    ctx.restore();
    return true;
  };
  // Places by size and zoom.
  const rank = st => ({ metro: 0, city: 1, smallCity: 2 }[st.kind] ?? 3);
  const places = map.settlements.filter(st => inView(st.x, st.y, st.x, st.y) && (rank(st) <= 1 || (rank(st) === 2 && s > 1.4) || (st.population > 3000 && s > 3) || (st.population > 800 && s > 7) || s > 16));
  places.sort((a, b) => rank(a) - rank(b) || b.population - a.population);
  for (const st of places) text(st.name, sx(st.x) + 6, sy(st.y) - 8, { size: [17, 15, 13, 11][rank(st)], weight: rank(st) < 3 ? 700 : 500, colour: '#fde68a' });
  // Route shields along each route, about every 260 px.
  const shield = { interstate: ['#1d4ed8', '#ffffff'], expressway: ['#ffffff', '#111111'], us: ['#ffffff', '#111111'], state: ['#fef9c3', '#111111'] };
  if (s > 1.2) {
    for (const road of map.roads) {
      const kind = roadClass(road);
      if (kind === 'state' && s < 4) continue;
      const name = kind === 'expressway' ? road.name.split(' ')[0] : road.name;
      if (!name || name.includes('bypass') || name.includes('–')) continue;
      let gap = 130;
      for (let i = 1; i < road.points.length; i++) {
        const [x0, y0] = road.points[i - 1], [x1, y1] = road.points[i];
        gap += Math.hypot(x1 - x0, y1 - y0) * s;
        if (gap > 260 && inView(x1, y1, x1, y1)) {
          if (text(name, sx(x1), sy(y1), { size: 10, weight: 700, box: shield[kind][0], boxText: shield[kind][1], centre: true })) gap = 0;
        }
      }
    }
  }
  // Exit numbers.
  if (s > 8) for (const c of map.crossings ?? []) if (c.type === 'interchange' && inView(c.x, c.y, c.x, c.y)) text(`Exit ${c.exit}`, sx(c.x) + 8, sy(c.y) + 12, { size: 10, weight: 700, box: '#166534', boxText: '#ffffff' });
  // Rivers: the name along the river near the middle of the view.
  if (s > 2.5 && $('showRivers').checked) {
    for (const river of map.rivers) {
      if (!river.name) continue;
      let best = null, bestD = Infinity;
      for (let k = 2; k < river.points.length; k += 2) {
        const x = (river.points[k - 2] + river.points[k]) / 2, y = (river.points[k - 1] + river.points[k + 1]) / 2;
        if (!inView(x, y, x, y)) continue;
        const d = (sx(x) - width / 2) ** 2 + (sy(y) - height / 2) ** 2;
        if (d < bestD) { bestD = d; best = k; }
      }
      if (best === null) continue;
      const [x0, y0, x1, y1] = [river.points[best - 2], river.points[best - 1], river.points[best], river.points[best + 1]];
      let angle = Math.atan2(sy(y1) - sy(y0), sx(x1) - sx(x0));
      if (angle > Math.PI / 2) angle -= Math.PI; else if (angle < -Math.PI / 2) angle += Math.PI;
      text(river.name, (sx(x0) + sx(x1)) / 2, (sy(y0) + sy(y1)) / 2 - 8, { size: 11, weight: 600, colour: '#bfdbfe', rotate: angle });
    }
  }
  // Region names when zoomed out.
  if ($('showRegions').checked && s < 3) {
    const n = map.size, sums = map.regions.map(() => ({ x: 0, y: 0, count: 0 }));
    for (let j = 0; j < n; j += 4) for (let i = 0; i < n; i += 4) { const r = sums[map.region[j * n + i]]; r.x += i; r.y += j; r.count++; }
    map.regions.forEach((def, r) => { const t = sums[r]; if (t.count) text(def.name, sx(t.x / t.count * map.cellMiles), sy(t.y / t.count * map.cellMiles), { size: 14, weight: 700, centre: true }); });
  }
}

function renderSummary() {
  const s = map.summary, cr = map.crossings ?? [];
  $('summary').textContent = [
    `engine slope match: ±${s.engineMatch.meanAbsM.toFixed(0)} m (worst ${s.engineMatch.worstM.toFixed(0)})`,
    `rivers: ${s.rivers}, ${Math.round(s.riverMiles)} mi`,
    ...(map.lakes ?? []).map(l => `lake: ${l.areaMi2.toFixed(0)} mi², dam ${l.damHeightM.toFixed(0)} m`),
    `US routes: ${map.roads.filter(r => roadClass(r) === 'us').length}, state highways: ${map.roads.filter(r => roadClass(r) === 'state').length}`,
    `interstate exits: ${cr.filter(c => c.type === 'interchange').length}, overpasses: ${cr.filter(c => c.type === 'overpass').length}`,
    `signals: ${signals.length}`,
    `section roads: ${Object.entries(map.sectionGrid.roadMiles).map(([k, v]) => `${k} ${v}`).join(', ')} mi`,
    '',
    ...s.regions.map(r => `${r.name.padEnd(17)} ${(r.share * 100).toFixed(0).padStart(3)}%  ${r.meanM?.toFixed(0) ?? '-'} m`)
  ].join('\n');
  const swatch = (colour, label, line = false) => `<i style="background: ${colour}; ${line ? 'height: 4px; margin: 5px 0;' : ''}"></i><span>${label}</span>`;
  $('legend').innerHTML = map.coverKeys.map(key => swatch(`rgb(${(COVER_COLOURS[key] ?? [255, 0, 255]).join(',')})`, key.replace(/([A-Z])/g, ' $1').toLowerCase())).join('')
    + swatch(`rgb(${RIVER_COLOUR.join(',')})`, 'river', true)
    + swatch(ROADS.interstate.colour, 'interstate', true) + swatch(ROADS.expressway.colour, 'expressway (US, divided)', true)
    + swatch(ROADS.us.colour, 'US route', true) + swatch(ROADS.state.colour, 'state highway', true) + swatch(ROADS.ramp.colour, 'interchange ramp', true)
    + swatch(SECTIONS[3].colour, 'paved county road', true) + swatch(SECTIONS[2].colour, 'gravel road', true) + swatch(SECTIONS[1].colour, 'dirt road', true)
    + swatch('#16a34a', 'traffic signals');
}

canvas.addEventListener('wheel', event => {
  if (!map) return;
  event.preventDefault();
  const rect = canvas.getBoundingClientRect(), px = event.clientX - rect.left, py = event.clientY - rect.top;
  const x = mx(px), y = my(py);
  view.scale = Math.min(400, Math.max(minScale(), view.scale * (event.deltaY < 0 ? 1.25 : 0.8)));
  view.x = x - (px - width / 2) / view.scale; view.y = y - (py - height / 2) / view.scale;
  clampView(); draw();
}, { passive: false });
let drag = null;
canvas.addEventListener('mousedown', event => { drag = { x: event.clientX, y: event.clientY }; });
window.addEventListener('mouseup', () => { drag = null; });
canvas.addEventListener('mousemove', event => {
  if (!map) return;
  if (drag) {
    view.x -= (event.clientX - drag.x) / view.scale; view.y -= (event.clientY - drag.y) / view.scale;
    drag = { x: event.clientX, y: event.clientY };
    clampView(); draw();
  }
  const rect = canvas.getBoundingClientRect(), east = mx(event.clientX - rect.left), south = my(event.clientY - rect.top);
  const n = map.size, i = Math.floor(east / map.cellMiles), j = Math.floor(south / map.cellMiles);
  if (i < 0 || j < 0 || i >= n || j >= n) return;
  const k = j * n + i, half = n * map.cellMiles / 2;
  const rows = [
    ['Miles east, south', `${east.toFixed(2)}, ${south.toFixed(2)}`],
    ['Weather cell', `${Math.floor(east / 10)}, ${Math.floor(south / 10)}`],
    ['Roblox studs (x, z)', `${Math.round((east - half) * STUDS_PER_MILE).toLocaleString()}, ${Math.round((south - half) * STUDS_PER_MILE).toLocaleString()}`],
    ['StartMiles', `${east.toFixed(2)},${south.toFixed(2)}`],
    ['Elevation', `${map.elevation[k].toFixed(0)} m`],
    ['Region', map.regions[map.region[k]].name],
    ['Land cover', map.coverKeys[map.cover[k]]],
    ['Nearest place', nearestPlace(east, south)]
  ];
  $('readout').innerHTML = rows.map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('');
});

function nearestPlace(x, y) {
  let best = null, distance = Infinity;
  for (const s of map.settlements) { const d = Math.hypot(s.x - x, s.y - y); if (d < distance) { best = s; distance = d; } }
  if (!best) return '';
  const kind = { metro: 'metro', city: 'city', smallCity: 'small city', town: 'town' }[best.kind];
  return `${best.name} (${kind}, pop. ${best.population.toLocaleString()}), ${distance.toFixed(1)} mi`;
}

for (const id of ['showRivers', 'showRoads', 'showSections', 'showRegions', 'showGrid', 'showLabels']) $(id).addEventListener('change', draw);
$('seed').addEventListener('change', () => load(Number($('seed').value) || 1));
window.addEventListener('resize', fit);
load(1);

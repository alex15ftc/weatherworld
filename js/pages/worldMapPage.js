// The world map page: the built large-scale map for a seed (data/worldmap/seed-N, written by
// scripts/build-world-map.mjs) drawn as land cover with hillshading, rivers, region borders and
// the weather engine's 10-mile cells; the cursor reads out the place under it.
import { shadeMap, drawSectionRoads, COVER_COLOURS, RIVER_COLOUR, ROAD_STYLE, SECTION_STYLE } from '../worldmap/worldMapStyle.js';

const $ = id => document.getElementById(id);
const canvas = $('mapCanvas'), ctx = canvas.getContext('2d');
const STUDS_PER_MILE = 1000;   // roblox/src/shared/World/Config.luau

let map = null, base = null, sectionLayers = {};

async function load(seed) {
  $('status').textContent = `Loading seed ${seed}…`;
  const dir = `./data/worldmap/seed-${seed}`;
  try {
    const meta = await (await fetch(`${dir}/meta.json`, { cache: 'no-cache' })).json();
    const bytes = async name => new Uint8Array(await (await fetch(`${dir}/${name}`, { cache: 'no-cache' })).arrayBuffer());
    const [elevation, region, cover, sections] = await Promise.all([bytes('elevation.f32'), bytes('region.u8'), bytes('cover.u8'), bytes('sections.u8')]);
    map = { ...meta, coverKeys: meta.cover, elevation: new Float32Array(elevation.buffer), region, cover, sections: { ...meta.sectionGrid, roads: sections } };
  } catch {
    map = null;
    $('status').textContent = `Seed ${seed} not built yet`;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  canvas.width = canvas.height = map.size;
  base = new ImageData(shadeMap(map, map.coverKeys), map.size, map.size);
  // The land with the paved county roads, and with all section roads, drawn once each.
  sectionLayers = {};
  for (const [key, classes] of [['paved', [3]], ['all', [1, 2, 3]]]) {
    const pixels = new Uint8ClampedArray(base.data);
    drawSectionRoads(pixels, map.size, map.sections, map.cellMiles, classes);
    sectionLayers[key] = new ImageData(pixels, map.size, map.size);
  }
  $('status').textContent = `Seed ${seed} · ${map.size * map.cellMiles} × ${map.size * map.cellMiles} mi`;
  renderSummary();
  draw();
}

function draw() {
  if (!map) return;
  const n = map.size, px = 1 / map.cellMiles;   // pixels per mile
  ctx.putImageData($('showSections').checked ? sectionLayers.all : $('showRoads').checked ? sectionLayers.paved : base, 0, 0);
  if ($('showRegions').checked) {
    const overlay = ctx.getImageData(0, 0, n, n), d = overlay.data;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, r = map.region[k];
      if ((i + 1 < n && map.region[k + 1] !== r) || (j + 1 < n && map.region[k + n] !== r)) { d[k * 4] = 245; d[k * 4 + 1] = 245; d[k * 4 + 2] = 245; }
    }
    ctx.putImageData(overlay, 0, 0);
  }
  if ($('showGrid').checked) {
    ctx.strokeStyle = 'rgba(15, 23, 42, .28)'; ctx.lineWidth = 1;
    for (let mi = 10; mi < n / px; mi += 10) {
      ctx.beginPath(); ctx.moveTo(mi * px, 0); ctx.lineTo(mi * px, n); ctx.moveTo(0, mi * px); ctx.lineTo(n, mi * px); ctx.stroke();
    }
  }
  if ($('showRivers').checked) {
    ctx.strokeStyle = `rgb(${RIVER_COLOUR.join(',')})`; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const river of map.rivers) {
      for (let s = 2; s < river.points.length; s += 2) {
        ctx.lineWidth = Math.max(0.7, river.widthsM[s / 2] / 1609.344 * px * 1.5);
        ctx.beginPath(); ctx.moveTo(river.points[s - 2] * px, river.points[s - 1] * px); ctx.lineTo(river.points[s] * px, river.points[s + 1] * px); ctx.stroke();
      }
    }
  }
  if ($('showRoads').checked) drawRoads(px);
  if ($('showRegions').checked) labelRegions(n);
  if ($('showRoads').checked) labelPlaces(px);
}

function drawRoads(px) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const kind of ['highway', 'expressway', 'interstate']) {
    const style = ROAD_STYLE[kind];
    ctx.strokeStyle = `rgb(${style.colour.join(',')})`; ctx.lineWidth = style.widthPx;
    for (const road of map.roads) {
      if (road.kind !== kind) continue;
      ctx.beginPath(); road.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * px, y * px) : ctx.moveTo(x * px, y * px))); ctx.stroke();
    }
  }
  // Interstate exits (white rings) and overpasses (short bars across the interstate).
  for (const c of map.crossings ?? []) {
    ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 1.5;
    if (c.type === 'interchange') { ctx.beginPath(); ctx.arc(c.x * px, c.y * px, 3, 0, 2 * Math.PI); ctx.stroke(); }
    else { ctx.beginPath(); ctx.moveTo((c.x - c.vx * 1.2) * px, (c.y - c.vy * 1.2) * px); ctx.lineTo((c.x + c.vx * 1.2) * px, (c.y + c.vy * 1.2) * px); ctx.stroke(); }
  }
  for (const s of map.settlements) {
    if (s.kind !== 'town') { ctx.fillStyle = 'rgba(148, 163, 184, .35)'; ctx.beginPath(); ctx.arc(s.x * px, s.y * px, s.extentMi * px, 0, 2 * Math.PI); ctx.fill(); }
    ctx.fillStyle = '#111827'; ctx.beginPath(); ctx.arc(s.x * px, s.y * px, s.kind === 'town' ? 1.6 : 4, 0, 2 * Math.PI); ctx.fill();
  }
}

function labelPlaces(px) {
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (const s of map.settlements) {
    if (s.kind === 'town') continue;
    ctx.font = `700 ${s.kind === 'metro' ? 16 : s.kind === 'city' ? 14 : 12}px system-ui, sans-serif`;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(15, 23, 42, .8)'; ctx.strokeText(s.name, s.x * px + 7, s.y * px - 8);
    ctx.fillStyle = '#fde68a'; ctx.fillText(s.name, s.x * px + 7, s.y * px - 8);
  }
}

function labelRegions(n) {
  const sums = map.regions.map(() => ({ x: 0, y: 0, count: 0 }));
  for (let j = 0; j < n; j += 4) for (let i = 0; i < n; i += 4) { const s = sums[map.region[j * n + i]]; s.x += i; s.y += j; s.count++; }
  ctx.font = '700 15px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  map.regions.forEach((def, r) => {
    const s = sums[r];
    if (!s.count) return;
    const x = s.x / s.count, y = s.y / s.count;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(15, 23, 42, .75)'; ctx.strokeText(def.name, x, y);
    ctx.fillStyle = '#f8fafc'; ctx.fillText(def.name, x, y);
  });
}

function renderSummary() {
  const s = map.summary;
  $('summary').textContent = [
    `engine slope match: ±${s.engineMatch.meanAbsM.toFixed(0)} m (worst ${s.engineMatch.worstM.toFixed(0)})`,
    `rivers: ${s.rivers}, ${Math.round(s.riverMiles)} mi`,
    ...(map.lakes ?? []).map(l => `lake: ${l.areaMi2.toFixed(0)} mi², dam ${l.damHeightM.toFixed(0)} m`),
    `section roads: ${Object.entries(map.sectionGrid.roadMiles).map(([k, v]) => `${k} ${v}`).join(', ')} mi`,
    '',
    ...s.regions.map(r => `${r.name.padEnd(17)} ${(r.share * 100).toFixed(0).padStart(3)}%  ${r.meanM?.toFixed(0) ?? '-'} m`)
  ].join('\n');
  $('legend').innerHTML = map.coverKeys.map(key => `<i style="background: rgb(${(COVER_COLOURS[key] ?? [255, 0, 255]).join(',')})"></i><span>${key.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>`).join('')
    + `<i style="background: rgb(${RIVER_COLOUR.join(',')})"></i><span>river</span>`
    + [['interstate', ROAD_STYLE.interstate.colour], ['expressway', ROAD_STYLE.expressway.colour], ['highway', ROAD_STYLE.highway.colour], ['paved county road', SECTION_STYLE[3].colour], ['gravel road', SECTION_STYLE[2].colour], ['dirt road', SECTION_STYLE[1].colour]]
      .map(([label, colour]) => `<i style="background: rgb(${colour.join(',')})"></i><span>${label}</span>`).join('');
}

canvas.addEventListener('mousemove', event => {
  if (!map) return;
  const rect = canvas.getBoundingClientRect(), n = map.size;
  const i = Math.floor((event.clientX - rect.left) / rect.width * n), j = Math.floor((event.clientY - rect.top) / rect.height * n);
  if (i < 0 || j < 0 || i >= n || j >= n) return;
  const k = j * n + i, east = (i + 0.5) * map.cellMiles, south = (j + 0.5) * map.cellMiles, half = n * map.cellMiles / 2;
  const rows = [
    ['Miles east, south', `${east.toFixed(1)}, ${south.toFixed(1)}`],
    ['Weather cell', `${Math.floor(east / 10)}, ${Math.floor(south / 10)}`],
    ['Roblox studs (x, z)', `${Math.round((east - half) * STUDS_PER_MILE).toLocaleString()}, ${Math.round((south - half) * STUDS_PER_MILE).toLocaleString()}`],
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

for (const id of ['showRivers', 'showRoads', 'showSections', 'showRegions', 'showGrid']) $(id).addEventListener('change', draw);
$('seed').addEventListener('change', () => load(Number($('seed').value) || 1));
load(1);

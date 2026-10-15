// The world map page: the built large-scale map for a seed (data/worldmap/seed-N, written by
// scripts/build-world-map.mjs), drawn as it will be built. Scroll to zoom about the cursor, drag to
// pan. Land cover with hillshading; rivers; interstates, US routes, expressways and state highways;
// interchange ramps, overpasses and signals once zoomed in; paved, gravel and dirt section roads
// as the road rules leave them (js/worldmap/roadNetwork.js); labels for places, rivers, routes
// and exits by zoom; airports, the air base, NWS offices and radars (js/worldmap/airfields.js),
// from a symbol when zoomed out to runways, taxiways, terminals, curbs and parking zoomed in;
// wind farms, windmills, oil and gas wells, schools, colleges and gas stations
// (js/worldmap/facilities.js), each on its own layer. The road graph (js/worldmap/streets.js):
// every road down to the town streets as one network, with the signals, stop signs and
// cul-de-sacs at its nodes, drawn in place of the section roads when its layer is on; and where
// planned footprints overlap (js/worldmap/footprints.js), as rings on their own layer.
import { shadeMap, COVER_COLOURS, RIVER_COLOUR } from '../worldmap/worldMapStyle.js';
import { interchangeRamps, crossingSin, tee } from '../worldmap/interchanges.js';
import { sectionSegments, signalJunctions } from '../worldmap/roadNetwork.js';

const $ = id => document.getElementById(id);
const canvas = $('mapCanvas'), ctx = canvas.getContext('2d');
const STUDS_PER_MILE = 1000;   // roblox/Shared/World/Config.luau

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

let facilities = null, graph = null, conflicts = null;
let map = null, base = null, regionBorders = null, sections = null, signals = [], ramps = [], counties = null, countyIds = null;
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
    // The counties (js/worldmap/counties.js), if this build has them.
    try { counties = await (await fetch(`${dir}/counties.json`, { cache: 'no-cache' })).json(); countyIds = new Uint16Array((await bytes('counties.u16')).buffer); } catch { counties = null; countyIds = null; }
    // Energy, schools and gas stations (facilities.js), if this build has them.
    try { facilities = await (await fetch(`${dir}/facilities.json`, { cache: 'no-cache' })).json(); } catch { facilities = null; }
    // The road graph (streets.js), if this build has it.
    try { graph = readGraph(await (await fetch(`${dir}/streets.json`, { cache: 'no-cache' })).json(), (await bytes('streets.bin')).buffer); } catch { graph = null; }
    // Where planned footprints overlap (footprints.js), if this build has them.
    try { conflicts = await (await fetch(`${dir}/conflicts.json`, { cache: 'no-cache' })).json(); } catch { conflicts = null; }
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
  // ?x=&y= (miles east and south) and ?zoom= (pixels a mile) open the map on a spot; ?airfield=CODE
  // centres it on that airfield.
  const params = new URLSearchParams(location.search), field = map.airfields?.find(a => a.code === params.get('airfield')?.toUpperCase());
  if (field || params.has('x')) { view.x = field?.x ?? Number(params.get('x')); view.y = field?.y ?? Number(params.get('y')); view.scale = Number(params.get('zoom') ?? 30); }
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
  // County lines: thin and broken, as road maps draw them.
  if (counties && $('showCounties').checked) {
    ctx.strokeStyle = 'rgba(88, 28, 135, .75)'; ctx.lineWidth = s > 6 ? 1.6 : 1; ctx.setLineDash(s > 3 ? [6, 3, 1.5, 3] : []);
    ctx.beginPath();
    for (const c of counties.counties) {
      if (!inView(c.box[0], c.box[1], c.box[2], c.box[3])) continue;
      for (const ring of c.rings) ring.forEach(([x, y], k) => (k ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y)))), ctx.closePath();
    }
    ctx.stroke(); ctx.setLineDash([]);
  }

  if ($('showGrid').checked) {
    ctx.strokeStyle = 'rgba(15, 23, 42, .3)'; ctx.lineWidth = 1;
    for (let m = 10; m < miles; m += 10) { ctx.beginPath(); ctx.moveTo(sx(m), sy(0)); ctx.lineTo(sx(m), sy(miles)); ctx.moveTo(sx(0), sy(m)); ctx.lineTo(sx(miles), sy(m)); ctx.stroke(); }
  }
  // Land use under the roads.
  if (facilities?.landUse && $('showLandUse').checked) drawLandUse(inView);
  // The road graph in place of the section roads.
  const showGraph = graph && $('showGraph').checked;
  if (showGraph && $('showRoads').checked) drawGraphEdges(inView);
  // Section roads by zoom: paved from 4 px a mile, gravel and dirt from 14.
  if ($('showRoads').checked && !showGraph) {
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
  if (showGraph && $('showRoads').checked) drawGraphNodes(inView);
  if (conflicts && $('showConflicts').checked) drawConflicts(inView);
  if (facilities) drawFacilities(inView);
  if ($('showAirports').checked || $('showNws').checked) drawAirfields(inView);
  if ($('showLabels').checked) drawLabels(inView);
}

// The road graph from streets.bin (see scripts/build-world-map.mjs).
function readGraph(info, buffer) {
  const N = info.nodes, E = info.edges;
  let at = 0;
  const take = (Type, count) => { const bytes = count * Type.BYTES_PER_ELEMENT, view = new Type(buffer.slice(at, at + bytes)); at += bytes; return view; };
  return { info, xy: take(Float32Array, 2 * N), control: take(Uint8Array, N), end: take(Uint8Array, N), pairs: take(Uint32Array, 2 * E), kinds: take(Uint8Array, E) };
}
// Graph roads by kind: colour, width in pixels and in miles, the zoom (pixels a mile) they show
// from. The map's own roads are drawn by the road layer above them.
const GRAPH = {
  arterial: { colour: '#fafaf9', px: 1.2, mi: 0.058, from: 3 }, county: { colour: '#f4f4f0', px: 1, mi: 0.026, from: 4 },
  collector: { colour: '#fde68a', px: 1, mi: 0.044, from: 8 }, local: { colour: '#e7e5e4', px: 0.9, mi: 0.026, from: 10 },
  frontage: { colour: '#d6d3d1', px: 0.9, mi: 0.026, from: 8 },
  street: { colour: '#e7e5e4', px: 0.8, mi: 0.036, from: 10 }, gravel: { colour: '#d8cdb4', px: 0.8, mi: 0.02, from: 14 }, dirt: { colour: '#9a7854', px: 0.7, mi: 0.013, from: 14 }
};
function drawGraphEdges(inView) {
  const s = view.scale, { xy, pairs, kinds, info } = graph;
  for (const kind of ['dirt', 'gravel', 'local', 'street', 'frontage', 'collector', 'county', 'arterial']) {
    const style = GRAPH[kind], code = info.kinds.indexOf(kind);
    if (s < style.from || ((kind === 'gravel' || kind === 'dirt') && !$('showSections').checked)) continue;
    ctx.strokeStyle = style.colour; ctx.lineWidth = Math.max(style.px, style.mi * s);
    ctx.beginPath();
    for (let i = 0; i < kinds.length; i++) {
      if (kinds[i] !== code) continue;
      const a = pairs[2 * i], b = pairs[2 * i + 1], x0 = xy[2 * a], y0 = xy[2 * a + 1], x1 = xy[2 * b], y1 = xy[2 * b + 1];
      if (inView(x0, y0, x1, y1)) { ctx.moveTo(sx(x0), sy(y0)); ctx.lineTo(sx(x1), sy(y1)); }
    }
    ctx.stroke();
  }
}
// Node controls from 24 px a mile: signals green, stop-controlled junctions red, cul-de-sacs as
// rings, roads that stop short of a highway or interstate as a bar or a dot.
function drawGraphNodes(inView) {
  const s = view.scale, { xy, control, end } = graph;
  if (s < 24) return;
  for (let i = 0; i < control.length; i++) {
    const x = xy[2 * i], y = xy[2 * i + 1];
    if ((!control[i] && !end[i]) || !inView(x, y, x, y)) continue;
    ctx.beginPath();
    if (end[i] === 1) { ctx.arc(sx(x), sy(y), Math.max(2.5, 0.035 * s), 0, 2 * Math.PI); ctx.strokeStyle = '#e7e5e4'; ctx.lineWidth = 1.5; ctx.stroke(); continue; }
    if (end[i] === 3) { ctx.arc(sx(x), sy(y), 2.5, 0, 2 * Math.PI); ctx.fillStyle = '#f97316'; ctx.fill(); continue; }
    if (end[i] === 2) continue;
    ctx.arc(sx(x), sy(y), control[i] === 2 ? 3 : 1.8, 0, 2 * Math.PI);
    ctx.fillStyle = control[i] === 2 ? '#16a34a' : '#dc2626'; ctx.fill();
  }
}

// Footprint conflicts (footprints.js): a ring at each, coloured by type, from 4 px a mile.
const CONFLICT = { road: '#ef4444', culDeSac: '#f97316', lot: '#a855f7', river: '#0ea5e9' };
function drawConflicts(inView) {
  if (view.scale < 4) return;
  ctx.lineWidth = 2;
  for (const c of conflicts.list) {
    if (!inView(c.x, c.y, c.x, c.y)) continue;
    ctx.strokeStyle = CONFLICT[c.type] ?? '#ef4444';
    ctx.beginPath(); ctx.arc(sx(c.x), sy(c.y), 6, 0, 2 * Math.PI); ctx.stroke();
  }
}

// Airfield colours.
const AIR = {
  runway: '#2b2d31', runwayMark: '#f8fafc', taxiway: '#6b7078', apron: '#9aa0a8', fence: 'rgba(226, 232, 240, .85)',
  terminal: '#c084fc', concourse: '#a855f7', tower: '#f43f5e', hangar: '#94a3b8', building: '#cbd5e1', igloo: '#65a30d',
  parking: '#52525b', garage: '#3f3f46', curb: '#38bdf8', road: '#f4f4f0',
  area: { cantonment: 'rgba(148, 163, 184, .35)', housing: 'rgba(250, 204, 21, .18)', munitions: 'rgba(101, 163, 13, .22)' },
  nws: '#2563eb', radar: '#ffffff', radarRing: '#1d4ed8', airBase: '#0f766e', airport: '#7c3aed'
};

function fillPoly(poly, fill, stroke = null, lineWidth = 1) {
  ctx.beginPath();
  poly.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}
function strokeLine(points, colour, widthMi, minPx) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
  ctx.strokeStyle = colour; ctx.lineWidth = Math.max(minPx, widthMi * view.scale); ctx.stroke();
}

// Land use (facilities.js / landUse.js) from 3 px a mile: downtowns, shopping, highway strips,
// industry and parks filled; neighbourhoods outlined with their collectors from 10, named from 24.
const USE = {
  downtown: ['rgba(244, 114, 182, .22)', '#f472b6'], mall: ['rgba(192, 132, 252, .55)', '#a855f7'], shopping: ['rgba(248, 113, 113, .45)', '#ef4444'],
  corridor: ['rgba(251, 146, 60, .28)', null], travel: ['rgba(251, 146, 60, .5)', '#f97316'], industrial: ['rgba(148, 163, 184, .5)', '#64748b'], park: ['rgba(74, 222, 128, .5)', '#16a34a']
};
function drawLandUse(inView) {
  const s = view.scale, lu = facilities.landUse, seen = poly => { const xs = poly.map(q => q[0]), ys = poly.map(q => q[1]); return inView(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)); };
  if (s < 3) return;
  if (s >= 10) for (const nb of lu.neighborhoods) {
    if (!seen(nb.poly)) continue;
    fillPoly(nb.poly, 'rgba(253, 224, 71, .06)', 'rgba(253, 224, 71, .35)', 1);
    if (s >= 14) for (const c of nb.collectors) strokeLine(c, 'rgba(244, 244, 240, .55)', 36 / 5280, 1);
  }
  for (const kind of ['downtown', 'corridor', 'industrial', 'park', 'shopping', 'mall', 'travel']) for (const z of lu.areas) {
    if (z.kind !== kind || !seen(z.poly)) continue;
    fillPoly(z.poly, USE[kind][0], s >= 10 ? USE[kind][1] : null, 1);
  }
}
function drawLandUseLabels(inView) {
  const s = view.scale, lu = facilities.landUse;
  if (s >= 24) for (const nb of lu.neighborhoods) { const [cx, cy] = centroid(nb.poly); if (inView(cx, cy, cx, cy)) text(nb.name, sx(cx), sy(cy) + 16, { size: 10, weight: 600, colour: 'rgba(254, 249, 195, .85)', centre: true }); }
  for (const z of lu.areas) {
    if (!z.name || z.kind === 'corridor' || z.kind === 'downtown') continue;
    const min = z.kind === 'mall' ? 5 : z.tier === 'community' || z.kind === 'industrial' ? 12 : 30;
    if (s < min) continue;
    const [cx, cy] = centroid(z.poly);
    if (inView(cx, cy, cx, cy)) text(z.name, sx(cx), sy(cy), { size: z.kind === 'mall' ? 11 : 10, weight: 700, colour: z.kind === 'park' ? '#bbf7d0' : z.kind === 'industrial' ? '#e2e8f0' : '#fecaca', centre: true });
  }
}

// Energy, schools and gas stations by zoom: symbols first, then lots, buildings, parking,
// pumps and fields as they become big enough to see.
const FAC = {
  turbine: '#f8fafc', turbineRing: '#334155', gravel: '#d8cdb4', dirt: '#9a7854', windmill: '#7c2d12', tank: '#38bdf8', oil: '#111827', gas: '#f97316', battery: '#a8a29e',
  substation: '#64748b', schoolLot: 'rgba(250, 204, 21, .14)', school: '#facc15', field: '#4d7c0f', track: '#b45309', playground: '#a3e635', campus: 'rgba(253, 230, 138, .25)', quad: '#65a30d',
  station: '#ef4444', canopy: '#e5e7eb', store: '#fca5a5', pump: '#111827', diesel: '#16a34a', lot: '#71717a'
};
function drawFacilities(inView) {
  const s = view.scale, at = q => inView(q[0], q[1], q[0], q[1]);
  const dot = (q, r, fill, stroke = null) => { ctx.beginPath(); ctx.arc(sx(q[0]), sy(q[1]), r, 0, 2 * Math.PI); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); } };
  const e = facilities.energy;
  if ($('showEnergy').checked) {
    if (s >= 14) for (const line of e.leaseRoads) if (at(line[0])) strokeLine(line, FAC.dirt, 12 / 5280, 0.6);
    for (const farm of e.windFarms) {
      if (s >= 10) for (const road of farm.roads) if (at(road[0]) || at(road.at(-1))) strokeLine(road, FAC.gravel, 16 / 5280, 0.8);
      if (s >= 10 && farm.substation && at(farm.substation[0])) fillPoly(farm.substation, FAC.substation, '#0f172a', 0.6);
      if (s < 2.5) continue;
      for (const t of farm.turbines) {
        if (!at(t)) continue;
        if (s < 12) { dot(t, 1.6, FAC.turbine, FAC.turbineRing); continue; }
        // Tower and three blades (the rotor is about 120 m, 0.075 mi, across).
        const r = Math.max(5, 0.037 * s), x = sx(t[0]), y = sy(t[1]);
        ctx.strokeStyle = FAC.turbineRing; ctx.lineWidth = 1.4; ctx.beginPath();
        for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + k * 2 * Math.PI / 3; ctx.moveTo(x, y); ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); }
        ctx.stroke(); dot(t, 2, FAC.turbine, FAC.turbineRing);
      }
    }
    if (s >= 8) for (const w of e.wells) { if (at(w)) dot(w, s >= 30 ? 2.6 : 1.5, w[2] ? FAC.gas : FAC.oil, s >= 30 ? '#f8fafc' : null); }
    if (s >= 14) for (const t of e.tanks) if (at(t)) { ctx.fillStyle = FAC.battery; ctx.fillRect(sx(t[0]) - 2.5, sy(t[1]) - 2.5, 5, 5); }
    if (s >= 10) for (const w of e.windmills) {
      if (!at(w)) continue;
      const x = sx(w[0]), y = sy(w[1]);
      if (s >= 30) dot([w[0] + 0.008, w[1] + 0.004], Math.max(2, 0.006 * s), FAC.tank);
      ctx.strokeStyle = FAC.windmill; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y + 3); ctx.moveTo(x + 3, y - 3); ctx.lineTo(x - 3, y + 3); ctx.stroke();
    }
  }
  if ($('showSchools').checked) {
    for (const c of facilities.campuses) {
      if (!inView(c.area[0][0], c.area[0][1], c.area[2][0], c.area[2][1]) || s < 3) continue;
      fillPoly(c.area, FAC.campus, s >= 10 ? '#fde68a' : null, 0.8);
      if (s < 10) continue;
      fillPoly(c.quad, FAC.quad);
      for (const f of c.fields) fillPoly(f, FAC.field);
      if (c.stadium) fillPoly(c.stadium, FAC.field, FAC.track, 2);
      strokeLine(c.loop, AIR.road, 28 / 5280, 0.8);
      for (const lot of c.parking) fillPoly(lot, AIR.parking);
      for (const b of c.buildings) fillPoly(b, '#e7e5e4', s > 40 ? '#44403c' : null, 0.5);
    }
    for (const sc of facilities.schools) {
      if (!at(sc.lot[0])) continue;
      if (s < 4) continue;
      if (s < 14) { const q = sc.buildings[0][0]; ctx.fillStyle = FAC.school; ctx.strokeStyle = '#422006'; ctx.lineWidth = 1; ctx.fillRect(sx(q[0]) - 3, sy(q[1]) - 3, 6, 6); ctx.strokeRect(sx(q[0]) - 3, sy(q[1]) - 3, 6, 6); continue; }
      fillPoly(sc.lot, FAC.schoolLot, '#facc15', 0.6);
      for (const f of sc.fields) {
        if (f.kind === 'track') { fillPoly(f.poly, FAC.field, FAC.track, Math.max(1.5, 0.004 * s)); continue; }
        fillPoly(f.poly, f.kind === 'playground' ? FAC.playground : FAC.field);
      }
      strokeLine(sc.drive, AIR.road, 24 / 5280, 1); strokeLine(sc.loop, AIR.road, 24 / 5280, 1);
      for (const lot of sc.parking) fillPoly(lot, AIR.parking);
      for (const b of sc.buildings) fillPoly(b, FAC.school, s > 40 ? '#422006' : null, 0.6);
    }
  }
  if ($('showGas').checked) {
    for (const g of facilities.gasStations) {
      if (!at(g.lot[0]) || s < 6) continue;
      if (s < 30) { dot(g.store[0], g.size === 'truck stop' ? 4 : 2.6, FAC.station, '#ffffff'); continue; }
      fillPoly(g.lot, FAC.lot);
      for (const d of g.drives) strokeLine(d, FAC.lot, 30 / 5280, 1);
      for (const lot of g.parking) fillPoly(lot, AIR.parking, '#d4d4d8', 0.5);
      fillPoly(g.store, FAC.store, '#7f1d1d', 0.6);
      for (const c of g.canopies) fillPoly(c, FAC.canopy, '#9ca3af', 0.6);
      for (const q of g.pumps) dot(q, Math.max(1.4, 0.0012 * s), FAC.pump);
      for (const q of g.diesel) dot(q, Math.max(1.6, 0.0014 * s), FAC.diesel);
    }
  }
}

// Airports and the air base by zoom: a symbol when zoomed out; fence and runways from 4 px a
// mile; taxiways, aprons, buildings, parking, curbs and roads from 12; runway markings from 40.
// NWS offices and their radars on their own layer, with the offices in towns (kind nwsOffice).
function drawAirfields(inView) {
  const s = view.scale, FT = 1 / 5280, airports = $('showAirports').checked, nws = $('showNws').checked;
  for (const a of map.airfields ?? []) {
    const xs = a.fence.map(q => q[0]), ys = a.fence.map(q => q[1]);
    if (!inView(Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 1, Math.max(...ys) + 1)) continue;
    const town = a.kind === 'nwsOffice';
    if (airports && !town) {
      if (s >= 4) {
        if (!a.access.freeway) strokeLine(a.access.points, AIR.road, 0.022, 1);
        for (const area of a.areas ?? []) fillPoly(area.poly, AIR.area[area.kind] ?? 'rgba(148,163,184,.3)');
        ctx.setLineDash(s > 10 ? [4, 3] : []); fillPoly(a.fence, null, AIR.fence, 1); ctx.setLineDash([]);
      }
      if (s >= 12) {
        for (const apron of a.aprons) fillPoly(apron, AIR.apron);
        for (const t of a.taxiways) strokeLine(t, AIR.taxiway, 75 * FT, 1);
        for (const lot of a.parking) fillPoly(lot.poly, lot.kind === 'garage' ? AIR.garage : AIR.parking, s > 60 ? '#a1a1aa' : null, 0.5);
        for (const r of a.roads) strokeLine(r.points, AIR.road, (r.kind === 'street' ? 30 : 40) * FT, r.kind === 'street' ? 0.6 : 1);
        for (const c of a.curbs) strokeLine(c.points, AIR.curb, 30 * FT, 2);
        for (const b of a.buildings) fillPoly(b.poly, AIR[b.kind] ?? AIR.building, s > 60 ? '#1e293b' : null, 0.6);
      }
      if (s >= 4) {
        for (const r of a.runways) {
          strokeLine(r.ends, AIR.runway, r.widthFt * FT, s >= 12 ? 2 : 1.6);
          if (s >= 40) { ctx.setLineDash([6, 6]); strokeLine(r.ends, AIR.runwayMark, 3 * FT, 0.8); ctx.setLineDash([]); }
        }
      } else if (inView(a.x, a.y, a.x, a.y)) {
        // Zoomed out: a ring with the main runway across it.
        const r = a.kind === 'airBase' ? 5 : a.class === 'regional' ? 4 : 5.5, h = a.headingDeg * Math.PI / 180;
        ctx.fillStyle = a.kind === 'airBase' ? AIR.airBase : AIR.airport; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(sx(a.x), sy(a.y), r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sx(a.x) - Math.sin(h) * (r - 1), sy(a.y) + Math.cos(h) * (r - 1)); ctx.lineTo(sx(a.x) + Math.sin(h) * (r - 1), sy(a.y) - Math.cos(h) * (r - 1)); ctx.stroke();
      }
    }
    if (nws) {
      if (town && s >= 4) strokeLine(a.access.points, AIR.road, 0.022, 1);
      if (town && s >= 12) for (const r of a.roads) strokeLine(r.points, AIR.road, 24 * FT, 1);
      if (a.nws && s >= 12) {
        fillPoly(a.nws.parking, AIR.parking, null); strokeLine(a.nws.drive, AIR.road, 24 * FT, 1);
        fillPoly(a.nws.building, AIR.nws, s > 60 ? '#0b1f4d' : null, 0.6);
        if (a.radar.service && !a.sharedRadar) strokeLine(a.radar.service, AIR.road, 16 * FT, 0.8);
      }
      // An office using another's radar (the air base's) draws none of its own.
      if (a.sharedRadar) continue;
      if (s >= 12) fillPoly(a.radar.compound, 'rgba(203, 213, 225, .5)', '#e2e8f0', 0.8);
      // The radar: a white dome ringed blue (the radome is about 39 ft across).
      ctx.fillStyle = AIR.radar; ctx.strokeStyle = AIR.radarRing; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx(a.radar.x), sy(a.radar.y), Math.max(s >= 4 ? 3 : 2.4, 20 * FT * s), 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    }
  }
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
  // Airports, the air base and the NWS offices and radars.
  if (map.airfields) {
    const FT = 1 / 5280;
    for (const a of map.airfields) {
      if (!inView(a.x, a.y, a.x, a.y)) continue;
      if ($('showAirports').checked && a.kind !== 'nwsOffice') {
        const label = s > 8 ? `${a.name} (${a.code})` : a.kind === 'airBase' ? a.name.replace('Air Force Base', 'AFB') : a.code;
        text(label, sx(a.x) + 8, sy(a.y) + 10, { size: s > 8 ? 12 : 10, weight: 700, box: a.kind === 'airBase' ? AIR.airBase : AIR.airport, boxText: '#ffffff' });
        if (s >= 40) for (const r of a.runways) {
          // Runway numbers at each end: the number painted at an end is the heading flown from it.
          const [p, q] = r.ends, len = Math.hypot(q[0] - p[0], q[1] - p[1]), ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len, inset = 300 * FT;
          const fromP = ((Math.round(((Math.atan2(ux, -uy) * 180 / Math.PI + 360) % 360) / 10) + 35) % 36) + 1;
          const [n0, n1] = r.name.split('/'), [atP, atQ] = Number.parseInt(n0, 10) === fromP ? [n0, n1] : [n1, n0];
          text(atP, sx(p[0] + ux * inset), sy(p[1] + uy * inset), { size: 10, weight: 800, colour: '#ffffff', centre: true });
          text(atQ, sx(q[0] - ux * inset), sy(q[1] - uy * inset), { size: 10, weight: 800, colour: '#ffffff', centre: true });
        }
        if (s >= 40) {
          for (const c of a.curbs) { const m = c.points[0]; text(c.label, sx(m[0]), sy(m[1]) - 9, { size: 10, weight: 600, colour: '#bae6fd' }); }
          for (const b of a.buildings) if (['terminal', 'tower', 'base operations', 'visitor center'].includes(b.kind)) { const [cx, cy] = centroid(b.poly); text(b.kind, sx(cx), sy(cy), { size: 10, weight: 600, colour: '#f5f3ff', centre: true }); }
          for (const lot of a.parking) { const [cx, cy] = centroid(lot.poly); text(lot.kind === 'garage' ? 'parking garage' : lot.kind === 'economy' ? 'economy parking' : 'parking', sx(cx), sy(cy), { size: 9, weight: 600, colour: '#e4e4e7', centre: true }); }
        }
        if (s >= 12) for (const area of a.areas ?? []) { const [cx, cy] = centroid(area.poly); text(area.kind === 'munitions' ? 'weapons storage area' : area.kind === 'housing' ? 'base housing' : 'cantonment', sx(cx), sy(cy), { size: 11, weight: 700, colour: '#e2e8f0', centre: true }); }
        if (s >= 12) text(a.kind === 'airBase' ? 'main gate' : 'airport entrance', sx(a.gate[0]) + 6, sy(a.gate[1]) + 10, { size: 10, weight: 600, colour: '#fef3c7' });
        if (s >= 10) { const m = a.access.points[Math.min(2, a.access.points.length - 1)]; text(a.access.name, sx(m[0]) + 6, sy(m[1]) - 8, { size: 10, weight: 600, colour: '#f8fafc' }); }
      }
      if ($('showNws').checked) {
        if (s > 2.5 && !a.sharedRadar) text(a.radar.id, sx(a.radar.x) + 6, sy(a.radar.y) - 9, { size: 10, weight: 800, box: '#1d4ed8', boxText: '#ffffff' });
        if (s > 2.5 && s < 12 && a.sharedRadar) text(`WFO ${a.nws.id}`, sx(a.x) + 6, sy(a.y) - 9, { size: 10, weight: 800, box: '#1e3a8a', boxText: '#ffffff' });
        if (a.nws && s >= 12) { const [cx, cy] = centroid(a.nws.building); text(`${a.nws.name} (WFO ${a.nws.id})`, sx(cx) + 8, sy(cy) + 12, { size: 11, weight: 700, colour: '#bfdbfe' }); }
      }
    }
  }
  // Wind farms, colleges, schools and gas stations.
  if (facilities) {
    if (facilities.landUse && $('showLandUse').checked) drawLandUseLabels(inView);
    if ($('showEnergy').checked && s >= 2.5) for (const farm of facilities.energy.windFarms) if (inView(farm.x, farm.y, farm.x, farm.y)) text(farm.name, sx(farm.x), sy(farm.y) - 14, { size: 11, weight: 700, colour: '#e0f2fe', centre: true });
    if ($('showSchools').checked) {
      if (s >= 5) for (const c of facilities.campuses) { const [cx, cy] = centroid(c.area); if (inView(cx, cy, cx, cy)) text(c.name, sx(cx), sy(cy), { size: c.tier === 'college' ? 10 : 12, weight: 700, colour: '#fef3c7', centre: true }); }
      if (s >= 90) for (const sc of facilities.schools) { const [cx, cy] = centroid(sc.buildings[0]); if (inView(cx, cy, cx, cy)) text(sc.name, sx(cx), sy(cy) - 12, { size: 10, weight: 600, colour: '#fef08a', centre: true }); }
    }
    if ($('showGas').checked && s >= 120) for (const g of facilities.gasStations) { const [cx, cy] = centroid(g.store); if (inView(cx, cy, cx, cy)) text(g.size === 'truck stop' ? `truck stop · ${g.dispensers} pumps` : `gas · ${g.dispensers} pumps`, sx(cx), sy(cy) + 12, { size: 10, weight: 600, colour: '#fecaca', centre: true }); }
  }
  // Places by size and zoom.
  const rank = st => ({ metro: 0, city: 1, smallCity: 2 }[st.kind] ?? 3);
  const places = map.settlements.filter(st => inView(st.x, st.y, st.x, st.y) && (rank(st) <= 1 || (rank(st) === 2 && s > 1.4) || (st.population > 3000 && s > 3) || (st.population > 800 && s > 7) || s > 16));
  places.sort((a, b) => rank(a) - rank(b) || b.population - a.population);
  for (const st of places) text(st.name, sx(st.x) + 6, sy(st.y) - 8, { size: [17, 15, 13, 11][rank(st)], weight: rank(st) < 3 ? 700 : 500, colour: '#fde68a' });
  // County names, upper case, at each county's middle.
  if (counties && $('showCounties').checked && s > 1.2) for (const c of counties.counties) if (inView(c.x, c.y, c.x, c.y)) text(c.name.toUpperCase(), sx(c.x), sy(c.y) + (s > 4 ? 14 : 0), { size: s > 4 ? 12 : 9, weight: 700, colour: '#e9d5ff', halo: 'rgba(59, 7, 100, .8)', centre: true });
  // Route shields along each route, about every 260 px.
  const shield = { interstate: ['#1d4ed8', '#ffffff'], expressway: ['#ffffff', '#111111'], us: ['#ffffff', '#111111'], state: ['#fef9c3', '#111111'] };
  if (s > 1.2) {
    for (const road of map.roads) {
      const kind = roadClass(road);
      if (kind === 'state' && s < 4) continue;
      const name = kind === 'expressway' ? road.name.split(' ')[0] : road.name;
      if (!name || road.name.includes('bypass') || name.includes('–')) continue;
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
    map.regions.forEach((def, r) => { const t = sums[r]; if (t.count) text(counties?.regions?.[r]?.label ?? def.name, sx(t.x / t.count * map.cellMiles), sy(t.y / t.count * map.cellMiles), { size: 14, weight: 700, centre: true }); });
  }
}

const centroid = poly => [poly.reduce((t, q) => t + q[0], 0) / poly.length, poly.reduce((t, q) => t + q[1], 0) / poly.length];

function renderSummary() {
  const s = map.summary, cr = map.crossings ?? [];
  $('summary').textContent = [
    `engine slope match: ±${s.engineMatch.meanAbsM.toFixed(0)} m (worst ${s.engineMatch.worstM.toFixed(0)})`,
    `rivers: ${s.rivers}, ${Math.round(s.riverMiles)} mi`,
    ...(map.lakes ?? []).map(l => `lake: ${l.areaMi2.toFixed(0)} mi², dam ${l.damHeightM.toFixed(0)} m`),
    `US routes: ${map.roads.filter(r => roadClass(r) === 'us').length}, state highways: ${map.roads.filter(r => roadClass(r) === 'state').length}`,
    `interstate exits: ${cr.filter(c => c.type === 'interchange').length}, overpasses: ${cr.filter(c => c.type === 'overpass').length}`,
    `signals: ${signals.length}`,
    ...(facilities ? [`gas stations: ${facilities.gasStations.length}, schools: ${facilities.schools.length}, campuses: ${facilities.campuses.length}`, `wind farms: ${facilities.energy.windFarms.length} (${facilities.energy.windFarms.reduce((a, f) => a + f.turbines.length, 0)} turbines), windmills: ${facilities.energy.windmills.length}, wells: ${facilities.energy.wells.length}`] : []),
    ...(map.airfields ? [`airports: ${map.airfields.filter(a => a.kind === 'airport').length}, air bases: ${map.airfields.filter(a => a.kind === 'airBase').length}, NWS offices: ${map.airfields.filter(a => a.nws).length}`, `radars: ${map.airfields.filter(a => !a.sharedRadar).map(a => a.radar.id).join(' ')}`] : []),
    `section roads: ${Object.entries(map.sectionGrid.roadMiles).map(([k, v]) => `${k} ${v}`).join(', ')} mi`,
    ...(counties ? [`counties: ${counties.counties.length}, median ${[...counties.counties].map(c => c.areaMi2).sort((a, b) => a - b)[counties.counties.length >> 1]} mi²`] : []),
    '',
    ...s.regions.map(r => `${r.name.padEnd(17)} ${(r.share * 100).toFixed(0).padStart(3)}%  ${r.meanM?.toFixed(0) ?? '-'} m`)
  ].join('\n');
  const swatch = (colour, label, line = false) => `<i style="background: ${colour}; ${line ? 'height: 4px; margin: 5px 0;' : ''}"></i><span>${label}</span>`;
  $('legend').innerHTML = map.coverKeys.map(key => swatch(`rgb(${(COVER_COLOURS[key] ?? [255, 0, 255]).join(',')})`, key.replace(/([A-Z])/g, ' $1').toLowerCase())).join('')
    + swatch(`rgb(${RIVER_COLOUR.join(',')})`, 'river', true)
    + swatch(ROADS.interstate.colour, 'interstate', true) + swatch(ROADS.expressway.colour, 'expressway (US, divided)', true)
    + swatch(ROADS.us.colour, 'US route', true) + swatch(ROADS.state.colour, 'state highway', true) + swatch(ROADS.ramp.colour, 'interchange ramp', true)
    + swatch(SECTIONS[3].colour, 'paved county road', true) + swatch(SECTIONS[2].colour, 'gravel road', true) + swatch(SECTIONS[1].colour, 'dirt road', true)
    + swatch('#16a34a', 'traffic signals')
    + swatch(AIR.runway, 'runway', true) + swatch(AIR.taxiway, 'taxiway', true) + swatch(AIR.apron, 'apron / flightline') + swatch(AIR.terminal, 'terminal')
    + swatch(AIR.curb, 'drop-off / pick-up curb', true) + swatch(AIR.parking, 'parking lot') + swatch(AIR.garage, 'parking garage') + swatch(AIR.hangar, 'hangar')
    + swatch(FAC.turbine, 'wind turbine') + swatch(FAC.windmill, 'farm windmill') + swatch(FAC.oil, 'oil well (pumpjack)') + swatch(FAC.gas, 'gas well')
    + swatch(FAC.school, 'school') + swatch(FAC.campus, 'college campus') + swatch(FAC.field, 'athletic field') + swatch(FAC.station, 'gas station') + swatch(FAC.canopy, 'fuel canopy')
    + swatch(AIR.fence, 'airfield fence', true) + swatch(AIR.nws, 'NWS forecast office') + swatch(AIR.radarRing, 'weather radar (WSR-88D)');
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
    ...(countyIds ? [['County', countyText(countyIds[k])]] : []),
    ['Land cover', map.coverKeys[map.cover[k]]],
    ['Nearest place', nearestPlace(east, south)],
    ...(map.airfields?.length ? [['Nearest airfield', nearestAirfield(east, south)]] : [])
  ];
  $('readout').innerHTML = rows.map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('');
});

function nearestAirfield(x, y) {
  const a = map.airfields.filter(f => f.kind !== 'nwsOffice').reduce((best, f) => (Math.hypot(f.x - x, f.y - y) < Math.hypot(best.x - x, best.y - y) ? f : best));
  return `${a.code} (${a.kind === 'airBase' ? 'AFB' : a.class}), ${Math.hypot(a.x - x, a.y - y).toFixed(1)} mi`;
}

function countyText(id) {
  const c = counties.counties[id - 1];
  return c ? `${c.name} County, ${c.areaMi2.toLocaleString()} mi²${c.seat ? ` (seat ${c.seat})` : ''}` : '';
}

function nearestPlace(x, y) {
  let best = null, distance = Infinity;
  for (const s of map.settlements) { const d = Math.hypot(s.x - x, s.y - y); if (d < distance) { best = s; distance = d; } }
  if (!best) return '';
  const kind = { metro: 'metro', city: 'city', smallCity: 'small city', town: 'town' }[best.kind];
  return `${best.name} (${kind}, pop. ${best.population.toLocaleString()}), ${distance.toFixed(1)} mi`;
}

for (const id of ['showRivers', 'showRoads', 'showSections', 'showGraph', 'showConflicts', 'showAirports', 'showNws', 'showEnergy', 'showSchools', 'showGas', 'showLandUse', 'showRegions', 'showCounties', 'showGrid', 'showLabels']) $(id).addEventListener('change', draw);
$('seed').addEventListener('change', () => load(Number($('seed').value) || 1));
window.addEventListener('resize', fit);
load(1);

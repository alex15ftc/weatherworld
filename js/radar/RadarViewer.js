// Radar page: polls the authority for new volume scans, renders polar scan bytes (single
// site) or the Cartesian network mosaic with a WebGL fragment shader (→ screen + colour
// table), and draws map overlays in 2D.
import { WeatherProductClient } from '../api/WeatherProductClient.js?v=2.20.13';
import { RADAR_PRODUCTS, decodeRadarValue, radarColorTable, beamHeightKm } from './RadarFormat.js';

const POLL_MS = 4000;
const LOOP_FRAMES = 12;
const LOOP_FRAME_MS = 450;
const MS_TO_KT = 1.94384;
const DEBUG = new URLSearchParams(location.search).has('debug');
const MOSAIC = 'MOSAIC';
const PREFERENCES_KEY = 'weatherworld.radar.v2';
const ECHO_BYTE_20DBZ = 105; // reflectivity byte for 20 dBZ

const $ = id => document.getElementById(id);
const ui = {
  site: $('radarSite'), products: $('radarProducts'), tilt: $('radarTilt'), tiltHint: $('tiltHint'),
  loop: $('radarLoop'), latest: $('radarLatest'), smooth: $('radarSmooth'), rings: $('radarRings'), borders: $('radarBorders'),
  legend: $('radarLegend'), legendLabel: $('radarLegendLabel'), legendUnits: $('radarLegendUnits'), legendTicks: $('radarLegendTicks'),
  status: $('radarStatus'), title: $('radarTitle'), subtitle: $('radarSubtitle'), frameLabel: $('radarFrameLabel'),
  viewer: $('radarViewer'), gl: $('radarGl'), overlay: $('radarOverlay'), readout: $('radarReadout')
};

const client = new WeatherProductClient();
const state = {
  catalog: null, overlays: null, site: null, mosaic: true, tilt: 0.5, product: 'reflectivity',
  frames: new Map(), frameIndex: -1, looping: false, loopTimer: null,
  revision: null, smooth: false, rings: true, borders: true,
  view: { centerX: 0, centerY: 0, kmPerPx: 1 }, pointer: null, fetching: false
};

// WebGL2 by default; Canvas 2D when forced (?renderer=2d), when WebGL2 is unavailable, or
// when the first drawn frame shows WebGL painted nothing where the data has echoes.
let renderer = null;
let rendererVerified = false;
if (new URLSearchParams(location.search).get('renderer') !== '2d') {
  try { renderer = createRenderer(ui.gl); } catch (error) { console.error('Radar WebGL renderer failed', error); }
}
if (!renderer) useCanvas2DRenderer();
document.body.dataset.radarRenderer = renderer.kind;

start().catch(error => { ui.status.textContent = `Radar unavailable: ${error.message}. Start the authority with npm start.`; });

async function start() {
  const [catalog, manifest] = await Promise.all([client.getRadarCatalog(), client.getMapManifest({ scope: 'live' }).catch(() => null)]);
  state.catalog = catalog;
  state.overlays = manifest?.overlays ?? null;
  state.revision = catalog.revision;
  ui.site.innerHTML = `<option value="${MOSAIC}">Network mosaic · all radars</option>`
    + catalog.sites.map(s => `<option value="${s.id}">${s.id} · ${s.name}</option>`).join('');
  ui.tilt.innerHTML = catalog.tilts.map(t => `<option value="${t}">${t.toFixed(1)}°</option>`).join('');
  ui.products.innerHTML = catalog.products.map(p => `<button type="button" data-product="${p}" title="${RADAR_PRODUCTS[p].label}">${RADAR_PRODUCTS[p].short}</button>`).join('');
  // URL parameters (?site=KCPL&product=velocity&tilt=0.9) override remembered preferences.
  const params = new URLSearchParams(location.search);
  const remembered = readPreferences();
  const saved = {
    site: params.get('site') ?? remembered.site,
    product: params.get('product') ?? remembered.product,
    tilt: params.has('tilt') ? Number(params.get('tilt')) : remembered.tilt
  };
  // The mosaic is the default: a single radar only sees storms within ~230 km.
  state.site = catalog.sites.find(s => s.id === saved.site) ?? null;
  state.mosaic = !state.site;
  state.site ??= catalog.sites.find(s => s.id === 'KCPL') ?? catalog.sites[0];
  state.product = !state.mosaic && catalog.products.includes(saved.product) ? saved.product : 'reflectivity';
  state.tilt = catalog.tilts.includes(saved.tilt) ? saved.tilt : catalog.tilts[0];
  ui.site.value = state.mosaic ? MOSAIC : state.site.id; ui.tilt.value = String(state.tilt);
  bindControls();
  resize();
  centerOnSite();
  updateProductUi();
  await fetchLatest();
  setInterval(poll, POLL_MS);
}

// --- Data ------------------------------------------------------------------

const selectionKey = () => (state.mosaic ? MOSAIC : `${state.site.id}|${state.tilt}|${state.product}`);
const currentFrames = () => state.frames.get(selectionKey()) ?? [];

async function poll() {
  if (state.fetching || document.hidden) return;
  try {
    const meta = await client.getLiveMetadata();
    if (meta.revision !== state.revision) {
      state.revision = meta.revision;
      await fetchLatest();
    }
  } catch (error) { ui.status.textContent = `Lost contact with the authority: ${error.message}`; }
}

async function fetchLatest() {
  state.fetching = true;
  const key = selectionKey();
  try {
    const { meta, bytes } = state.mosaic ? await client.getRadarMosaic() : await client.getRadarScan(state.site.id, state.tilt, state.product);
    const frames = state.frames.get(key) ?? [];
    const existing = frames.findIndex(f => Math.abs(f.meta.validHourUtc - meta.validHourUtc) < 1e-6);
    if (existing >= 0) frames[existing] = { meta, bytes }; else frames.push({ meta, bytes });
    frames.sort((a, b) => a.meta.validHourUtc - b.meta.validHourUtc);
    while (frames.length > LOOP_FRAMES) frames.shift();
    state.frames.set(key, frames);
    if (key === selectionKey() && !state.looping) showFrame(frames.length - 1);
    const rendererName = renderer.kind === 'webgl2' ? 'WebGL' : 'Canvas 2D';
    ui.status.textContent = `${state.mosaic ? 'Mosaic' : 'Volume scan'} built in ${meta.buildMs} ms · ${rendererName} renderer · new scans every 5 simulated minutes`;
  } catch (error) {
    ui.status.textContent = `Scan request failed: ${error.message}`;
  } finally { state.fetching = false; }
}

function showFrame(index) {
  const frames = currentFrames();
  if (!frames.length) { state.frameIndex = -1; draw(); return; }
  state.frameIndex = Math.max(0, Math.min(frames.length - 1, index));
  const frame = frames[state.frameIndex];
  if (state.mosaic) renderer.setData(frame.bytes, frame.meta.width, frame.meta.height);
  else renderer.setData(frame.bytes, state.catalog.gates, state.catalog.radials);
  const latest = state.frameIndex === frames.length - 1;
  ui.title.textContent = state.mosaic
    ? 'Network mosaic · Base reflectivity · lowest tilt'
    : `${state.site.id} · ${RADAR_PRODUCTS[state.product].label} · ${state.tilt.toFixed(1)}°`;
  ui.subtitle.textContent = `${formatTime(frame.meta.validHourUtc)}${latest ? ' · latest volume' : ''}`;
  ui.frameLabel.textContent = frameHint(frame, frames);
  draw();
  updateReadout();
  if (DEBUG) captureForDebug();
}

function frameHint(frame, frames) {
  const loop = frames.length > 1 ? `Frame ${state.frameIndex + 1} / ${frames.length}` : 'Loop builds as new scans arrive';
  if (state.product !== 'reflectivity') return loop;
  let echoes = 0;
  for (let i = 0; i < frame.bytes.length && echoes < 20; i++) if (frame.bytes[i] >= ECHO_BYTE_20DBZ) echoes++;
  if (echoes >= 20) return loop;
  return state.mosaic
    ? 'No precipitation anywhere on the network right now'
    : `No precipitation in range of ${state.site.id} · switch to the network mosaic to see the whole domain`;
}

// ?debug=1: composite both layers into a data URL in the DOM so headless tools can inspect it.
function captureForDebug() {
  const canvas = document.createElement('canvas');
  canvas.width = ui.gl.width; canvas.height = ui.gl.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(ui.gl, 0, 0); ctx.drawImage(ui.overlay, 0, 0);
  document.body.dataset.radarCapture = canvas.toDataURL('image/png');
}

// --- Controls --------------------------------------------------------------

function bindControls() {
  ui.site.addEventListener('change', () => selectSite(ui.site.value));
  ui.tilt.addEventListener('change', () => { state.tilt = Number(ui.tilt.value); selectionChanged(); });
  ui.products.addEventListener('click', event => {
    const button = event.target.closest('button[data-product]');
    if (!button) return;
    if (button.disabled) return;
    state.product = button.dataset.product;
    updateProductUi();
    selectionChanged();
  });
  ui.loop.addEventListener('click', () => setLooping(!state.looping));
  ui.latest.addEventListener('click', () => { setLooping(false); showFrame(currentFrames().length - 1); });
  ui.smooth.addEventListener('click', () => { state.smooth = !state.smooth; toggleButton(ui.smooth, state.smooth, 'Smoothing'); draw(); });
  ui.rings.addEventListener('click', () => { state.rings = !state.rings; toggleButton(ui.rings, state.rings, 'Range rings'); draw(); });
  ui.borders.addEventListener('click', () => { state.borders = !state.borders; toggleButton(ui.borders, state.borders, 'Region borders'); draw(); });
  window.addEventListener('resize', () => { resize(); draw(); });
  document.addEventListener('keydown', event => {
    if (event.target.matches('input, select')) return;
    if (event.key === ' ') { event.preventDefault(); setLooping(!state.looping); }
    if (event.key === 'ArrowLeft') { setLooping(false); showFrame(state.frameIndex - 1); }
    if (event.key === 'ArrowRight') { setLooping(false); showFrame(state.frameIndex + 1); }
  });
  bindPanZoom();
}

function selectSite(id) {
  state.mosaic = id === MOSAIC;
  if (!state.mosaic) state.site = state.catalog.sites.find(s => s.id === id) ?? state.site;
  else state.product = 'reflectivity';
  ui.site.value = state.mosaic ? MOSAIC : state.site.id;
  updateProductUi();
  centerOnSite();
  selectionChanged();
}

function selectionChanged() {
  savePreferences();
  updateTiltHint();
  if (!currentFrames().length) { renderer.clear(); state.frameIndex = -1; draw(); }
  else showFrame(currentFrames().length - 1);
  fetchLatest();
}

function updateProductUi() {
  for (const button of ui.products.querySelectorAll('button')) {
    button.classList.toggle('active', button.dataset.product === state.product);
    // Velocity and dual-pol are measured relative to one radar, so the mosaic is reflectivity only.
    button.disabled = state.mosaic && button.dataset.product !== 'reflectivity';
    button.title = button.disabled ? 'Pick a single radar site for this product' : RADAR_PRODUCTS[button.dataset.product].label;
  }
  ui.tilt.disabled = state.mosaic;
  const spec = RADAR_PRODUCTS[state.product];
  renderer.setColorTable(radarColorTable(state.product));
  ui.legendLabel.textContent = spec.label;
  ui.legendUnits.textContent = state.product.includes('elocity') ? 'kt' : spec.units;
  drawLegend();
  updateTiltHint();
}

function setLooping(on) {
  state.looping = on;
  ui.loop.textContent = on ? 'Pause loop' : 'Play loop';
  ui.loop.classList.toggle('active', on);
  clearInterval(state.loopTimer);
  if (!on) return;
  state.loopTimer = setInterval(() => {
    const frames = currentFrames();
    if (frames.length < 2) return;
    showFrame((state.frameIndex + 1) % frames.length);
  }, LOOP_FRAME_MS);
}

function toggleButton(button, on, label) { button.classList.toggle('active', on); button.textContent = `${label} ${on ? 'on' : 'off'}`; }

function updateTiltHint() {
  if (state.mosaic) { ui.tiltHint.textContent = 'The mosaic shows each spot from its nearest radar at 0.5°. Double-click the map to open that radar.'; return; }
  const heights = [50, 100, 150].map(r => `${r} km: ${Math.round(beamHeightKm(r / Math.cos(state.tilt * Math.PI / 180), state.tilt) * 3281).toLocaleString()} ft`);
  ui.tiltHint.textContent = `Beam height above the radar · ${heights.join(' · ')}`;
}

function drawLegend() {
  const ctx = ui.legend.getContext('2d'), w = ui.legend.width, h = ui.legend.height, spec = RADAR_PRODUCTS[state.product];
  const lut = radarColorTable(state.product);
  const lo = spec.legend[0], hi = spec.legend.at(-1);
  ctx.clearRect(0, 0, w, h);
  for (let x = 0; x < w; x++) {
    const v = lo + (hi - lo) * x / (w - 1), b = Math.max(1, Math.min(255, 1 + Math.round((v - spec.min) / spec.step)));
    ctx.fillStyle = `rgba(${lut[b * 4]},${lut[b * 4 + 1]},${lut[b * 4 + 2]},${Math.max(0.25, lut[b * 4 + 3] / 255)})`;
    ctx.fillRect(x, 0, 1, h);
  }
  const velocity = state.product.includes('elocity');
  ui.legendTicks.innerHTML = spec.legend.map(v => `<span style="left:${((v - lo) / (hi - lo) * 100).toFixed(1)}%">${velocity ? Math.round(v * MS_TO_KT) : v}</span>`).join('');
}

// --- View ------------------------------------------------------------------

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1), rect = ui.viewer.getBoundingClientRect();
  for (const canvas of [ui.gl, ui.overlay]) { canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.max(1, Math.round(rect.height * dpr)); }
  state.dpr = dpr;
}

function centerOnSite() {
  if (state.mosaic) {
    state.view.centerX = state.catalog.domainWidthKm / 2; state.view.centerY = state.catalog.domainHeightKm / 2;
    state.view.kmPerPx = 1.04 * Math.max(state.catalog.domainWidthKm / ui.overlay.width, state.catalog.domainHeightKm / ui.overlay.height);
  } else {
    state.view.centerX = state.site.xKm; state.view.centerY = state.site.yKm;
    state.view.kmPerPx = (2 * 240) / Math.min(ui.overlay.width, ui.overlay.height);
  }
  draw();
}

function screenToKm(px, py) {
  const v = state.view;
  return { x: v.centerX + (px - ui.overlay.width / 2) * v.kmPerPx, y: v.centerY + (py - ui.overlay.height / 2) * v.kmPerPx };
}
function kmToScreen(x, y) {
  const v = state.view;
  return { x: (x - v.centerX) / v.kmPerPx + ui.overlay.width / 2, y: (y - v.centerY) / v.kmPerPx + ui.overlay.height / 2 };
}

function bindPanZoom() {
  let drag = null;
  ui.overlay.addEventListener('pointerdown', event => {
    drag = { x: event.clientX, y: event.clientY, cx: state.view.centerX, cy: state.view.centerY };
    ui.overlay.setPointerCapture(event.pointerId);
    ui.overlay.classList.add('dragging');
  });
  ui.overlay.addEventListener('pointermove', event => {
    const rect = ui.overlay.getBoundingClientRect();
    state.pointer = { x: (event.clientX - rect.left) * state.dpr, y: (event.clientY - rect.top) * state.dpr };
    if (drag) {
      state.view.centerX = drag.cx - (event.clientX - drag.x) * state.dpr * state.view.kmPerPx;
      state.view.centerY = drag.cy - (event.clientY - drag.y) * state.dpr * state.view.kmPerPx;
      draw();
    }
    updateReadout();
  });
  const endDrag = () => { drag = null; ui.overlay.classList.remove('dragging'); };
  ui.overlay.addEventListener('pointerup', endDrag);
  ui.overlay.addEventListener('pointercancel', endDrag);
  ui.overlay.addEventListener('pointerleave', () => { state.pointer = null; updateReadout(); });
  ui.overlay.addEventListener('dblclick', event => {
    if (!state.mosaic) return;
    const rect = ui.overlay.getBoundingClientRect();
    const km = screenToKm((event.clientX - rect.left) * state.dpr, (event.clientY - rect.top) * state.dpr);
    const nearest = state.catalog.sites.reduce((a, b) => (Math.hypot(b.xKm - km.x, b.yKm - km.y) < Math.hypot(a.xKm - km.x, a.yKm - km.y) ? b : a));
    selectSite(nearest.id);
  });
  ui.overlay.addEventListener('wheel', event => {
    event.preventDefault();
    const rect = ui.overlay.getBoundingClientRect();
    const px = (event.clientX - rect.left) * state.dpr, py = (event.clientY - rect.top) * state.dpr;
    const before = screenToKm(px, py);
    state.view.kmPerPx = Math.max(0.03, Math.min(3, state.view.kmPerPx * Math.exp(event.deltaY * 0.0015)));
    const after = screenToKm(px, py);
    state.view.centerX += before.x - after.x; state.view.centerY += before.y - after.y;
    draw();
    updateReadout();
  }, { passive: false });
}

// --- Drawing ---------------------------------------------------------------

function draw() {
  if (!state.catalog) return;
  const hasFrame = state.frameIndex >= 0;
  const frame = currentFrames()[state.frameIndex];
  const options = drawOptions(hasFrame, frame);
  renderer.draw(options);
  if (hasFrame && !rendererVerified && renderer.kind === 'webgl2') verifyWebGlOutput(options, frame);
  drawOverlay();
}

function drawOptions(visible, frame) {
  return {
    visible, view: state.view, width: ui.gl.width, height: ui.gl.height,
    mosaic: state.mosaic, gridResKm: frame?.meta?.resKm ?? 1, gridWidth: frame?.meta?.width ?? 1, gridHeight: frame?.meta?.height ?? 1,
    site: state.site, gateKm: state.catalog.gateKm, gates: state.catalog.gates, radials: state.catalog.radials,
    cosTilt: Math.cos(state.tilt * Math.PI / 180), smooth: state.smooth
  };
}

// Byte at a map position (km) for the current frame layout: Cartesian mosaic or polar scan.
function byteAtKm(o, bytes, x, y) {
  if (o.mosaic) {
    const i = Math.floor(x / o.gridResKm), j = Math.floor(y / o.gridResKm);
    return i >= 0 && j >= 0 && i < o.gridWidth && j < o.gridHeight ? bytes[j * o.gridWidth + i] : 0;
  }
  const dx = x - o.site.xKm, dy = y - o.site.yKm;
  const gate = Math.floor(Math.hypot(dx, dy) / o.cosTilt / o.gateKm);
  if (gate >= o.gates) return 0;
  let az = Math.atan2(dx, -dy); if (az < 0) az += Math.PI * 2;
  return bytes[(Math.floor(az / (Math.PI * 2) * o.radials) % o.radials) * o.gates + gate];
}

// Compare what WebGL painted with what the data says should be visible; if the GPU drew
// nothing, switch to the Canvas 2D renderer for the rest of the session.
function verifyWebGlOutput(o, frame) {
  const lut = radarColorTable(state.product);
  let expected = 0;
  for (let sy = 0; sy < 40; sy++) for (let sx = 0; sx < 60; sx++) {
    const px = (sx + 0.5) / 60 * o.width, py = (sy + 0.5) / 40 * o.height;
    const b = byteAtKm(o, frame.bytes, o.view.centerX + (px - o.width / 2) * o.view.kmPerPx, o.view.centerY + (py - o.height / 2) * o.view.kmPerPx);
    if (b && lut[b * 4 + 3] > 40) expected++;
  }
  if (expected < 3) return; // nothing to judge yet; check again on a later frame
  rendererVerified = true;
  const painted = renderer.countPainted(o);
  document.body.dataset.radarPainted = painted + '/' + (o.width * o.height) + ' expectedSamples=' + expected;
  if (painted > 0) return;
  console.warn('WebGL drew no radar echoes where the scan has data; switching to the Canvas 2D renderer.');
  useCanvas2DRenderer();
  renderer.setColorTable(lut);
  renderer.setData(frame.bytes);
  renderer.draw(o);
  ui.status.textContent = 'Using the Canvas 2D radar renderer (WebGL drew nothing on this GPU).';
}

function useCanvas2DRenderer() {
  // A canvas that already has a WebGL context cannot provide a 2D one; swap in a fresh element.
  const canvas = document.createElement('canvas');
  canvas.id = 'radarGl'; canvas.className = ui.gl.className; canvas.width = ui.gl.width; canvas.height = ui.gl.height;
  ui.gl.replaceWith(canvas);
  ui.gl = canvas;
  renderer = createCanvas2DRenderer(canvas);
  rendererVerified = true;
  document.body.dataset.radarRenderer = renderer.kind;
}

function drawOverlay() {
  const ctx = ui.overlay.getContext('2d'), w = ui.overlay.width, h = ui.overlay.height, dpr = state.dpr;
  ctx.clearRect(0, 0, w, h);
  const domain = state.catalog;
  const a = kmToScreen(0, 0), b = kmToScreen(domain.domainWidthKm, domain.domainHeightKm);
  ctx.strokeStyle = 'rgba(148,163,184,.45)'; ctx.lineWidth = 1 * dpr;
  ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);

  if (state.borders && state.overlays?.regions?.cells?.length) drawRegions(ctx);

  if (state.rings && !state.mosaic) {
    const c = kmToScreen(state.site.xKm, state.site.yKm);
    ctx.setLineDash([4 * dpr, 6 * dpr]); ctx.strokeStyle = 'rgba(203,213,225,.28)'; ctx.lineWidth = 1 * dpr;
    ctx.font = `${11 * dpr}px system-ui`; ctx.fillStyle = 'rgba(203,213,225,.55)';
    for (let r = 50; r <= 230; r += 50) {
      ctx.beginPath(); ctx.arc(c.x, c.y, r / state.view.kmPerPx, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText(`${r} km`, c.x + 4 * dpr, c.y - r / state.view.kmPerPx - 3 * dpr);
    }
    ctx.setLineDash([]);
  }

  for (const site of domain.sites) {
    const p = kmToScreen(site.xKm, site.yKm), selected = !state.mosaic && site.id === state.site.id, s = (selected ? 6 : 4) * dpr;
    ctx.fillStyle = selected ? '#5eb8ff' : 'rgba(226,232,240,.75)';
    ctx.beginPath(); ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x + s, p.y); ctx.lineTo(p.x, p.y + s); ctx.lineTo(p.x - s, p.y); ctx.closePath(); ctx.fill();
    ctx.font = `600 ${(selected ? 12 : 10) * dpr}px system-ui`;
    ctx.lineWidth = 3 * dpr; ctx.strokeStyle = 'rgba(7,11,17,.9)'; ctx.strokeText(site.id, p.x + 8 * dpr, p.y + 4 * dpr);
    ctx.fillText(site.id, p.x + 8 * dpr, p.y + 4 * dpr);
  }
}

function drawRegions(ctx) {
  const regions = state.overlays.regions, rows = regions.cells.length, cols = regions.cells[0].length;
  const cw = state.catalog.domainWidthKm / cols, ch = state.catalog.domainHeightKm / rows, dpr = state.dpr;
  ctx.strokeStyle = 'rgba(148,163,184,.5)'; ctx.lineWidth = 1 * dpr; ctx.setLineDash([3 * dpr, 3 * dpr]);
  ctx.beginPath();
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const id = regions.cells[y][x];
    if (x + 1 < cols && regions.cells[y][x + 1] !== id) { const p = kmToScreen((x + 1) * cw, y * ch), q = kmToScreen((x + 1) * cw, (y + 1) * ch); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); }
    if (y + 1 < rows && regions.cells[y + 1][x] !== id) { const p = kmToScreen(x * cw, (y + 1) * ch), q = kmToScreen((x + 1) * cw, (y + 1) * ch); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); }
  }
  ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(203,213,225,.5)'; ctx.font = `600 ${11 * dpr}px system-ui`; ctx.textAlign = 'center';
  for (const label of regions.labels ?? []) {
    const p = kmToScreen(label.centroid.x * cw, label.centroid.y * ch);
    ctx.fillText(label.label, p.x, p.y);
  }
  ctx.textAlign = 'start';
}

function updateReadout() {
  const frame = currentFrames()[state.frameIndex];
  if (!state.pointer || !frame) { ui.readout.classList.add('hidden'); return; }
  const km = screenToKm(state.pointer.x, state.pointer.y);
  if (state.mosaic) {
    const i = Math.floor(km.x / frame.meta.resKm), j = Math.floor(km.y / frame.meta.resKm);
    const inside = i >= 0 && j >= 0 && i < frame.meta.width && j < frame.meta.height;
    const value = inside ? decodeRadarValue('reflectivity', frame.bytes[j * frame.meta.width + i]) : null;
    const nearest = state.catalog.sites.reduce((a, b) => (Math.hypot(b.xKm - km.x, b.yKm - km.y) < Math.hypot(a.xKm - km.x, a.yKm - km.y) ? b : a));
    const ground = Math.hypot(nearest.xKm - km.x, nearest.yKm - km.y);
    ui.readout.innerHTML = `<strong>${!inside ? 'Outside the network' : value === null ? 'No echo' : `${value.toFixed(1)} dBZ`}</strong><span>Nearest radar ${nearest.id} · ${ground.toFixed(0)} km</span><br><span>Beam ${Math.round(beamHeightKm(ground, 0.5) * 3281).toLocaleString()} ft above radar · double-click to open`;
    ui.readout.classList.remove('hidden');
    return;
  }
  const dx = km.x - state.site.xKm, dy = km.y - state.site.yKm, ground = Math.hypot(dx, dy);
  const slant = ground / Math.cos(state.tilt * Math.PI / 180);
  const gate = Math.floor(slant / state.catalog.gateKm);
  const az = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  let valueText = 'Out of range';
  if (gate < state.catalog.gates) {
    const radial = Math.floor(az / (360 / state.catalog.radials)) % state.catalog.radials;
    const value = decodeRadarValue(state.product, frame.bytes[radial * state.catalog.gates + gate]);
    const spec = RADAR_PRODUCTS[state.product];
    valueText = value === null ? 'No echo'
      : state.product.includes('elocity') ? `${Math.round(value * MS_TO_KT)} kt ${value < 0 ? 'inbound' : value > 0 ? 'outbound' : ''}`
      : `${value.toFixed(spec.decimals)} ${spec.units}`;
  }
  const beamFt = Math.round(beamHeightKm(slant, state.tilt) * 3281);
  ui.readout.innerHTML = `<strong>${valueText}</strong><span>${Math.round(az)}° · ${ground.toFixed(1)} km (${(ground * 0.6214).toFixed(1)} mi)</span><br><span>Beam ${beamFt.toLocaleString()} ft above radar</span>`;
  ui.readout.classList.remove('hidden');
}

// --- WebGL -----------------------------------------------------------------

function createRenderer(canvas) {
  // preserveDrawingBuffer keeps the last scan visible to screenshots and page captures.
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const vs = `#version 300 es
  in vec2 aPos; out vec2 vPos;
  void main() { vPos = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const fs = `#version 300 es
  precision highp float;
  in vec2 vPos; out vec4 outColor;
  uniform sampler2D uData; uniform sampler2D uLut;
  uniform vec2 uCenter; uniform float uKmPerPx; uniform vec2 uViewport;
  uniform vec2 uSite; uniform float uGateKm; uniform float uGates; uniform float uRadials; uniform float uCosTilt; uniform bool uSmooth;
  uniform bool uMosaic; uniform float uGridResKm; uniform vec2 uGridSize;
  const float TAU = 6.28318530718;
  float byteAt(ivec2 p) { return floor(texelFetch(uData, p, 0).r * 255.0 + 0.5); }
  float fetchByte(int g, int r) { r = (r + int(uRadials)) % int(uRadials); return byteAt(ivec2(g, r)); }
  void main() {
    vec2 px = vec2(vPos.x * 0.5 + 0.5, 0.5 - vPos.y * 0.5) * uViewport;
    vec2 km = uCenter + (px - 0.5 * uViewport) * uKmPerPx;
    if (uMosaic) {
      vec2 cell = km / uGridResKm;
      if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= uGridSize.x || cell.y >= uGridSize.y) discard;
      float m;
      if (uSmooth) {
        vec2 c = max(cell - 0.5, vec2(0.0)); ivec2 i0 = ivec2(floor(c)); vec2 t = fract(c);
        ivec2 lim = ivec2(uGridSize) - 1;
        float a = byteAt(i0), b = byteAt(min(i0 + ivec2(1, 0), lim));
        float e = byteAt(min(i0 + ivec2(0, 1), lim)), f = byteAt(min(i0 + ivec2(1, 1), lim));
        float wa = (1.0 - t.x) * (1.0 - t.y) * step(0.5, a), wb = t.x * (1.0 - t.y) * step(0.5, b), we = (1.0 - t.x) * t.y * step(0.5, e), wf = t.x * t.y * step(0.5, f);
        float ws = wa + wb + we + wf;
        if (ws < 0.35) discard;
        m = (a * wa + b * wb + e * we + f * wf) / ws;
      } else {
        m = byteAt(ivec2(cell));
        if (m < 0.5) discard;
      }
      vec4 mc = texture(uLut, vec2((m + 0.5) / 256.0, 0.5));
      if (mc.a < 0.02) discard;
      outColor = mc;
      return;
    }
    vec2 d = km - uSite;
    float gate = length(d) / uCosTilt / uGateKm;
    if (gate >= uGates) discard;
    float az = atan(d.x, -d.y); if (az < 0.0) az += TAU;
    float radial = az / TAU * uRadials;
    float v;
    if (uSmooth) {
      // Bilinear between gates/radials, ignoring empty gates so echo edges stay clean.
      float g = max(gate - 0.5, 0.0), r = radial - 0.5;
      int g0 = int(floor(g)), r0 = int(floor(r)); float tg = fract(g), tr = fract(r);
      float a = fetchByte(g0, r0), b = fetchByte(min(g0 + 1, int(uGates) - 1), r0), c = fetchByte(g0, r0 + 1), e = fetchByte(min(g0 + 1, int(uGates) - 1), r0 + 1);
      float wa = (1.0 - tg) * (1.0 - tr) * step(0.5, a), wb = tg * (1.0 - tr) * step(0.5, b), wc = (1.0 - tg) * tr * step(0.5, c), we = tg * tr * step(0.5, e);
      float wsum = wa + wb + wc + we;
      if (wsum < 0.35) discard;
      v = (a * wa + b * wb + c * wc + e * we) / wsum;
    } else {
      v = fetchByte(int(gate), int(radial));
      if (v < 0.5) discard;
    }
    vec4 color = texture(uLut, vec2((v + 0.5) / 256.0, 0.5));
    if (color.a < 0.02) discard;
    outColor = color;
  }`;
  const program = link(gl, vs, fs);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const loc = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const dataTex = gl.createTexture(), lutTex = gl.createTexture();
  for (const tex of [dataTex, lutTex]) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const u = name => gl.getUniformLocation(program, name);
  const uniforms = Object.fromEntries(['uData', 'uLut', 'uCenter', 'uKmPerPx', 'uViewport', 'uSite', 'uGateKm', 'uGates', 'uRadials', 'uCosTilt', 'uSmooth', 'uMosaic', 'uGridResKm', 'uGridSize'].map(n => [n, u(n)]));
  let hasData = false;

  return {
    kind: 'webgl2',
    countPainted(o) {
      const pixels = new Uint8Array(o.width * o.height * 4);
      gl.readPixels(0, 0, o.width, o.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let painted = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 30 || pixels[i + 1] > 30 || pixels[i + 2] > 40) painted++;
      return painted;
    },
    setData(bytes, gates, radials) {
      gl.bindTexture(gl.TEXTURE_2D, dataTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gates, radials, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
      hasData = true;
    },
    clear() { hasData = false; },
    setColorTable(lut) {
      gl.bindTexture(gl.TEXTURE_2D, lutTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut);
    },
    draw(o) {
      gl.viewport(0, 0, o.width, o.height);
      gl.clearColor(0.027, 0.043, 0.067, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!o.visible || !hasData) return;
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dataTex); gl.uniform1i(uniforms.uData, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lutTex); gl.uniform1i(uniforms.uLut, 1);
      gl.uniform2f(uniforms.uCenter, o.view.centerX, o.view.centerY);
      gl.uniform1f(uniforms.uKmPerPx, o.view.kmPerPx);
      gl.uniform2f(uniforms.uViewport, o.width, o.height);
      gl.uniform2f(uniforms.uSite, o.site.xKm, o.site.yKm);
      gl.uniform1f(uniforms.uGateKm, o.gateKm);
      gl.uniform1f(uniforms.uGates, o.gates);
      gl.uniform1f(uniforms.uRadials, o.radials);
      gl.uniform1f(uniforms.uCosTilt, o.cosTilt);
      gl.uniform1i(uniforms.uSmooth, o.smooth ? 1 : 0);
      gl.uniform1i(uniforms.uMosaic, o.mosaic ? 1 : 0);
      gl.uniform1f(uniforms.uGridResKm, o.gridResKm);
      gl.uniform2f(uniforms.uGridSize, o.gridWidth, o.gridHeight);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  };
}

// CPU renderer: same lookup as the shader (nearest gate/cell), drawn at reduced
// resolution and scaled up. Slower to pan than WebGL but independent of the GPU.
function createCanvas2DRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const buffer = document.createElement('canvas'), bctx = buffer.getContext('2d');
  let bytes = null, lut = null;
  return {
    kind: 'canvas2d',
    setData(data) { bytes = data; },
    clear() { bytes = null; },
    setColorTable(table) { lut = table; },
    draw(o) {
      ctx.fillStyle = '#070b11';
      ctx.fillRect(0, 0, o.width, o.height);
      if (!o.visible || !bytes || !lut) return;
      const scale = o.width * o.height > 1.5e6 ? 3 : 2;
      const w = Math.ceil(o.width / scale), h = Math.ceil(o.height / scale);
      if (buffer.width !== w || buffer.height !== h) { buffer.width = w; buffer.height = h; }
      const image = bctx.createImageData(w, h), out = image.data;
      const kmPerPx = o.view.kmPerPx * scale, x0 = o.view.centerX - (o.width / 2) * o.view.kmPerPx, y0 = o.view.centerY - (o.height / 2) * o.view.kmPerPx;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const b = byteAtKm(o, bytes, x0 + (i + 0.5) * kmPerPx, y0 + (j + 0.5) * kmPerPx);
        if (!b) continue;
        const k = (j * w + i) * 4, c = b * 4;
        out[k] = lut[c]; out[k + 1] = lut[c + 1]; out[k + 2] = lut[c + 2]; out[k + 3] = lut[c + 3];
      }
      bctx.putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = o.smooth;
      ctx.drawImage(buffer, 0, 0, w * scale, h * scale);
    }
  };
}

function link(gl, vsSource, fsSource) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vsSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  return program;
}

// --- Misc ------------------------------------------------------------------

function formatTime(hourUtc) {
  const day = Math.floor(hourUtc / 24) + 1, h = ((hourUtc % 24) + 24) % 24;
  const hh = Math.floor(h + 1e-6), mm = Math.round((h - hh) * 60) % 60;
  return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}Z Day ${day}`;
}

function readPreferences() {
  try { return JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}'); } catch { return {}; }
}
function savePreferences() {
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ site: state.mosaic ? MOSAIC : state.site.id, tilt: state.tilt, product: state.product })); } catch { /* storage unavailable */ }
}

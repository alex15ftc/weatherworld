// Radar page: polls the authority for new volume scans, renders polar scan bytes (single
// site) or the Cartesian network mosaic of composite reflectivity with a WebGL fragment shader
// (→ screen + colour table), and draws map overlays in 2D, among them the tornado and severe
// thunderstorm warnings in effect at the time of the scan shown (GET /api/warnings).
import { WeatherProductClient } from '../api/WeatherProductClient.js';
import { RADAR_PRODUCTS, decodeRadarValue, radarColorTable, beamHeightKm, isRangeFolded } from './RadarFormat.js';

const POLL_MS = 4000;
const LOOP_FRAMES = 12;
const LOOP_FRAME_MS = 450;
const MS_TO_KT = 1.94384;
const DEBUG = new URLSearchParams(location.search).has('debug');
// The network mosaics, as the site list names them, and the product each shows.
const MOSAIC = 'MOSAIC';
const MOSAIC_OPTIONS = { MOSAIC: 'composite', 'MOSAIC-BASE': 'base', 'MOSAIC-ET': 'echoTops', 'MOSAIC-VIL': 'vil', 'MOSAIC-MESH': 'mesh' };
const MOSAIC_NAMES = { composite: 'Composite reflectivity', base: 'Base reflectivity', echoTops: 'Echo tops', vil: 'Vertically integrated liquid', mesh: 'Hail size (MESH)' };
const MOSAIC_LIST_NAMES = { composite: 'composite', base: 'base (lowest tilt)', echoTops: 'echo tops', vil: 'VIL', mesh: 'hail size (MESH)' };
const MOSAIC_PRODUCT = { composite: 'reflectivity', base: 'reflectivity', echoTops: 'echoTops', vil: 'vil', mesh: 'mesh' };
const MOSAIC_HINTS = {
  composite: 'The mosaic shows the strongest echo any tilt of the nearest radar finds above each spot. Far from a radar its lowest beam is high and wide, so only a storm\'s upper parts show. Double-click the map to open that radar.',
  base: 'The base mosaic shows what the lowest tilt of the nearest radar that clears the ground finds above each spot: the rain nearest the ground, not the anvil above it. Far from a radar even that beam is high, so a storm\'s low parts go unseen. Double-click the map to open that radar.',
  echoTops: 'Echo tops: how high (thousand feet above sea level) the echo stays at 18 dBZ or more, from the tilts of the nearest radar. Close to a radar its highest tilt can pass below a storm\'s top, so tops there read low.',
  vil: 'Vertically integrated liquid: the water the radar sees in the column above each spot (kg/m²). High VIL marks heavy cores and large hail.',
  mesh: 'Maximum expected hail size (inches), from how strong the echo is above the freezing level up to the -20 °C level.'
};
const PREFERENCES_KEY = 'weatherworld.radar.v3';
const ECHO_BYTE_20DBZ = 105; // reflectivity byte for 20 dBZ

const $ = id => document.getElementById(id);
const ui = {
  site: $('radarSite'), products: $('radarProducts'), tilt: $('radarTilt'), tiltHint: $('tiltHint'),
  loop: $('radarLoop'), latest: $('radarLatest'), smooth: $('radarSmooth'), stepped: $('radarStepped'), coverage: $('radarCoverage'), rings: $('radarRings'), borders: $('radarBorders'),
  legend: $('radarLegend'), legendLabel: $('radarLegendLabel'), legendUnits: $('radarLegendUnits'), legendTicks: $('radarLegendTicks'),
  status: $('radarStatus'), title: $('radarTitle'), subtitle: $('radarSubtitle'), frameLabel: $('radarFrameLabel'),
  viewer: $('radarViewer'), gl: $('radarGl'), overlay: $('radarOverlay'), readout: $('radarReadout'),
  warnings: $('radarWarnings'), warningList: $('warningList'), warningCount: $('warningCount'),
  warningText: $('warningText'), warningTextTitle: $('warningTextTitle'), warningTextTabs: $('warningTextTabs'), warningTextBody: $('warningTextBody'), warningTextClose: $('warningTextClose')
};

const client = new WeatherProductClient();
const state = {
  catalog: null, overlays: null, site: null, mosaic: true, mosaicKind: 'composite', tilt: 0.5, product: 'reflectivity',
  frames: new Map(), frameIndex: -1, looping: false, loopTimer: null,
  revision: null, smooth: false, stepped: false, coverage: false, rings: true, borders: true,
  view: { centerX: 0, centerY: 0, kmPerPx: 1 }, pointer: null, fetching: false,
  // Warnings as issued (newest first), the hour they were fetched at, whether they are drawn,
  // the one whose text is open and which of its statements is shown.
  counties: null, warnings: [], warningsHourUtc: null, showWarnings: true, chosenWarning: null, warningStatement: null
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
  // The map's counties (outlines in shares of the map), drawn under the warnings as radar
  // displays draw them; none if the server has no map.
  fetch('/api/counties').then(r => (r.ok ? r.json() : null)).then(counties => { state.counties = counties; draw(); }).catch(() => {});
  ui.site.innerHTML = Object.entries(MOSAIC_OPTIONS).map(([value, kind]) => `<option value="${value}">Network · ${MOSAIC_LIST_NAMES[kind]}</option>`).join('')
    + catalog.sites.map(s => `<option value="${s.id}">${s.id} · ${s.name}</option>`).join('');
  ui.tilt.innerHTML = catalog.tilts.map(t => `<option value="${t}">${t.toFixed(1)}°</option>`).join('');
  ui.products.innerHTML = catalog.products.map(p => `<button type="button" data-product="${p}" title="${RADAR_PRODUCTS[p].label}">${RADAR_PRODUCTS[p].short}</button>`).join('');
  // URL parameters (?site=KCPL&product=velocity&tilt=0.9&coverage=1) override remembered preferences.
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
  state.mosaicKind = MOSAIC_OPTIONS[saved.site] ?? 'composite';
  // Otherwise the radar nearest the middle of the domain.
  state.site ??= catalog.sites.reduce((best, s) => (Math.hypot(s.xKm - catalog.domainWidthKm / 2, s.yKm - catalog.domainHeightKm / 2) < Math.hypot(best.xKm - catalog.domainWidthKm / 2, best.yKm - catalog.domainHeightKm / 2) ? s : best));
  state.product = state.mosaic ? MOSAIC_PRODUCT[state.mosaicKind] : catalog.products.includes(saved.product) ? saved.product : 'reflectivity';
  state.tilt = catalog.tilts.includes(saved.tilt) ? saved.tilt : catalog.tilts[0];
  if (remembered.warnings === false) { state.showWarnings = false; toggleButton(ui.warnings, false, 'Warnings'); }
  if (remembered.stepped) { state.stepped = true; toggleButton(ui.stepped, true, 'Colour steps'); }
  ui.site.value = siteValue(); ui.tilt.value = String(state.tilt);
  // ?coverage=1 opens with the coverage shading on.
  if (params.get('coverage') === '1') { state.coverage = true; toggleButton(ui.coverage, true, 'Coverage'); }
  bindControls();
  resize();
  centerOnSite();
  updateProductUi();
  await Promise.all([fetchLatest(), fetchWarnings()]);
  setInterval(poll, POLL_MS);
}

// --- Data ------------------------------------------------------------------

const siteValue = () => (!state.mosaic ? state.site.id : Object.keys(MOSAIC_OPTIONS).find(value => MOSAIC_OPTIONS[value] === state.mosaicKind));
const selectionKey = () => (state.mosaic ? `${MOSAIC}|${state.mosaicKind}` : `${state.site.id}|${state.tilt}|${state.product}`);
const currentFrames = () => state.frames.get(selectionKey()) ?? [];

async function poll() {
  if (state.fetching || document.hidden) return;
  try {
    const meta = await client.getLiveMetadata();
    if (meta.revision !== state.revision) {
      state.revision = meta.revision;
      await Promise.all([fetchLatest(), fetchWarnings()]);
    }
  } catch (error) { ui.status.textContent = `Lost contact with the authority: ${error.message}`; }
}

async function fetchLatest() {
  state.fetching = true;
  const key = selectionKey();
  try {
    const { meta, bytes } = state.mosaic ? await client.getRadarMosaic(null, state.mosaicKind) : await client.getRadarScan(state.site.id, state.tilt, state.product);
    const frames = state.frames.get(key) ?? [];
    const existing = frames.findIndex(f => Math.abs(f.meta.validHourUtc - meta.validHourUtc) < 1e-6);
    if (existing >= 0) frames[existing] = { meta, bytes }; else frames.push({ meta, bytes });
    frames.sort((a, b) => a.meta.validHourUtc - b.meta.validHourUtc);
    while (frames.length > LOOP_FRAMES) frames.shift();
    state.frames.set(key, frames);
    if (key === selectionKey() && !state.looping) showFrame(frames.length - 1);
    if (state.mosaic && frames.length < LOOP_FRAMES) fillMosaicLoop();
    const rendererName = renderer.kind === 'webgl2' ? 'WebGL' : 'Canvas 2D';
    ui.status.textContent = `${state.mosaic ? 'Mosaic' : 'Volume scan'} built in ${meta.buildMs} ms · ${rendererName} renderer · new scans every 5 simulated minutes`;
  } catch (error) {
    ui.status.textContent = `Scan request failed: ${error.message}`;
  } finally { state.fetching = false; }
}

// The authority keeps the last hour of mosaics: the loop has them as soon as the page opens.
async function fillMosaicLoop() {
  const kind = state.mosaicKind, key = selectionKey();
  try {
    const { frames: kept = [] } = await client.getRadarMosaicFrames(kind);
    const frames = state.frames.get(key) ?? [];
    const missing = kept.filter(k => !frames.some(f => Math.abs(f.meta.validHourUtc - k.validHourUtc) < 1e-6)).slice(-LOOP_FRAMES);
    if (!missing.length) return;
    const loaded = await Promise.all(missing.map(k => client.getRadarMosaic(k.validHourUtc, kind).catch(() => null)));
    const now = state.frames.get(key) ?? [];
    for (const frame of loaded) if (frame && !now.some(f => Math.abs(f.meta.validHourUtc - frame.meta.validHourUtc) < 1e-6)) now.push(frame);
    now.sort((a, b) => a.meta.validHourUtc - b.meta.validHourUtc);
    while (now.length > LOOP_FRAMES) now.shift();
    state.frames.set(key, now);
    if (key === selectionKey() && !state.looping) showFrame(now.length - 1);
  } catch { /* the loop still builds as new scans arrive */ }
}

async function fetchWarnings() {
  try {
    const data = await client.getWarnings();
    state.warnings = data.warnings ?? []; state.warningsHourUtc = data.nowHourUtc ?? null;
  } catch { /* the radar still works without them */ }
  renderWarningList(); renderWarningText(); draw();
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
    ? `Network mosaic · ${MOSAIC_NAMES[state.mosaicKind]}`
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
  ui.stepped.addEventListener('click', () => { state.stepped = !state.stepped; toggleButton(ui.stepped, state.stepped, 'Colour steps'); savePreferences(); updateProductUi(); draw(); });
  ui.coverage.addEventListener('click', () => { state.coverage = !state.coverage; toggleButton(ui.coverage, state.coverage, 'Coverage'); draw(); });
  ui.rings.addEventListener('click', () => { state.rings = !state.rings; toggleButton(ui.rings, state.rings, 'Range rings'); draw(); });
  ui.borders.addEventListener('click', () => { state.borders = !state.borders; toggleButton(ui.borders, state.borders, 'Region borders'); draw(); });
  ui.warnings.addEventListener('click', () => { state.showWarnings = !state.showWarnings; toggleButton(ui.warnings, state.showWarnings, 'Warnings'); savePreferences(); draw(); });
  ui.warningTextClose.addEventListener('click', () => chooseWarning(null));
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
  const wasMosaic = state.mosaic;
  state.mosaic = id in MOSAIC_OPTIONS;
  if (!state.mosaic) { state.site = state.catalog.sites.find(s => s.id === id) ?? state.site; if (RADAR_PRODUCTS[state.product].mosaicOnly) state.product = 'reflectivity'; }
  else { state.mosaicKind = MOSAIC_OPTIONS[id]; state.product = MOSAIC_PRODUCT[state.mosaicKind]; }
  ui.site.value = siteValue();
  updateProductUi();
  // (Between the two mosaics the view stays where it is.)
  if (!(wasMosaic && state.mosaic)) centerOnSite();
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
  renderer.setColorTable(radarColorTable(state.product, state.stepped));
  ui.legendLabel.textContent = state.mosaic ? MOSAIC_NAMES[state.mosaicKind] : spec.label;
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
  if (state.mosaic) { ui.tiltHint.textContent = MOSAIC_HINTS[state.mosaicKind]; return; }
  const heights = [50, 100, 150].map(r => `${r} km: ${Math.round(beamHeightKm(r / Math.cos(state.tilt * Math.PI / 180), state.tilt) * 3281).toLocaleString()} ft`);
  ui.tiltHint.textContent = `Beam height above the radar · ${heights.join(' · ')}`;
}

function drawLegend() {
  const ctx = ui.legend.getContext('2d'), w = ui.legend.width, h = ui.legend.height, spec = RADAR_PRODUCTS[state.product];
  const lut = radarColorTable(state.product, state.stepped);
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
  ui.overlay.addEventListener('pointerup', event => {
    const moved = drag ? Math.hypot(event.clientX - drag.x, event.clientY - drag.y) : Infinity;
    endDrag();
    if (moved > 4 || !state.showWarnings) return;
    const rect = ui.overlay.getBoundingClientRect(), km = screenToKm((event.clientX - rect.left) * state.dpr, (event.clientY - rect.top) * state.dpr);
    // The most urgent warning there, then the smallest.
    const hit = warningsShown().filter(w => insidePolygon(w.polygon, km.x, km.y)).sort((a, b) => warningRank(b) - warningRank(a) || a.areaSquareMiles - b.areaSquareMiles)[0];
    if (hit) chooseWarning(hit.id);
  });
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
  const lut = radarColorTable(state.product, state.stepped);
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

  if (state.coverage) drawCoverage(ctx, a, b);
  if (state.borders && state.counties) drawCounties(ctx);
  if (state.borders && state.overlays?.regions?.cells?.length) drawRegions(ctx);
  if (state.showWarnings) drawWarnings(ctx);

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

  if (state.rings && state.mosaic) {
    // The mosaic has no one radar to ring: a 100 km grid gives the distances instead.
    ctx.setLineDash([2 * dpr, 7 * dpr]); ctx.strokeStyle = 'rgba(203,213,225,.2)'; ctx.lineWidth = 1 * dpr; ctx.beginPath();
    for (let x = 100; x < domain.domainWidthKm; x += 100) { const p = kmToScreen(x, 0), q = kmToScreen(x, domain.domainHeightKm); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); }
    for (let y = 100; y < domain.domainHeightKm; y += 100) { const p = kmToScreen(0, y), q = kmToScreen(domain.domainWidthKm, y); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  drawScaleBar(ctx);

  for (const site of domain.sites) {
    const p = kmToScreen(site.xKm, site.yKm), selected = !state.mosaic && site.id === state.site.id, s = (selected ? 6 : 4) * dpr;
    ctx.fillStyle = selected ? '#5eb8ff' : 'rgba(226,232,240,.75)';
    ctx.beginPath(); ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x + s, p.y); ctx.lineTo(p.x, p.y + s); ctx.lineTo(p.x - s, p.y); ctx.closePath(); ctx.fill();
    ctx.font = `600 ${(selected ? 12 : 10) * dpr}px system-ui`;
    ctx.lineWidth = 3 * dpr; ctx.strokeStyle = 'rgba(7,11,17,.9)'; ctx.strokeText(site.id, p.x + 8 * dpr, p.y + 4 * dpr);
    ctx.fillText(site.id, p.x + 8 * dpr, p.y + 4 * dpr);
  }
}

// --- Warnings ----------------------------------------------------------------

// NWS colours: red for a tornado warning, yellow for a severe thunderstorm warning; magenta for
// a particularly dangerous tornado, oranges for the damage tiers of a severe thunderstorm.
function warningColour(w) {
  if (w.type === 'tornado') return w.pds ? '#ff3df2' : '#ff2d2d';
  return w.tags?.damage === 'DESTRUCTIVE' ? '#ff5a1f' : w.tags?.damage === 'CONSIDERABLE' ? '#ff9f1a' : '#f5c518';
}
const warningRank = w => (w.type === 'tornado' ? (w.pds ? 5 : w.tags?.tornado === 'OBSERVED' ? 4 : 3) : w.tags?.damage === 'DESTRUCTIVE' ? 2 : w.tags?.damage === 'CONSIDERABLE' ? 1 : 0);
const warningEnd = w => w.endedHourUtc ?? w.validToHourUtc;
const shortName = w => `${w.pds ? 'PDS ' : ''}${w.type === 'tornado' ? 'TOR' : 'SVR'} ${w.number}`;
// The hour of the scan on screen, and the warnings in effect then.
function shownHourUtc() { return currentFrames()[state.frameIndex]?.meta?.validHourUtc ?? state.warningsHourUtc; }
function warningsShown() {
  const hour = shownHourUtc();
  if (hour == null) return [];
  return state.warnings.filter(w => w.issuedHourUtc <= hour + 1e-6 && hour < warningEnd(w) - 1e-6);
}
function insidePolygon(polygon, x, y) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function drawWarnings(ctx) {
  const dpr = state.dpr;
  // Severe thunderstorm warnings under tornado warnings, the chosen one on top.
  const shown = warningsShown().sort((a, b) => warningRank(a) - warningRank(b) || (a.id === state.chosenWarning) - (b.id === state.chosenWarning));
  for (const w of shown) {
    const points = w.polygon.map(([x, y]) => kmToScreen(x, y)), chosen = w.id === state.chosenWarning, colour = warningColour(w);
    ctx.beginPath(); points.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
    ctx.globalAlpha = chosen ? 0.22 : 0.07; ctx.fillStyle = colour; ctx.fill(); ctx.globalAlpha = 1;
    const width = (w.pds || w.tags?.damage === 'DESTRUCTIVE' ? 3.5 : w.tags?.damage || w.tags?.tornado === 'OBSERVED' ? 3 : 2) * dpr;
    ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.lineWidth = width + 2.5 * dpr; ctx.stroke();
    ctx.strokeStyle = colour; ctx.lineWidth = chosen ? width + 1.5 * dpr : width; ctx.stroke();
    // Its name where the polygon is big enough on screen to hold it.
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    if (Math.max(...xs) - Math.min(...xs) < 46 * dpr && Math.max(...ys) - Math.min(...ys) < 46 * dpr) continue;
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length, cy = ys.reduce((a, b) => a + b, 0) / ys.length, text = shortName(w);
    ctx.font = `700 ${11 * dpr}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width + 8 * dpr;
    ctx.fillStyle = 'rgba(7,11,17,.85)'; ctx.fillRect(cx - tw / 2, cy - 8 * dpr, tw, 16 * dpr);
    ctx.fillStyle = colour; ctx.fillText(text, cx, cy + 0.5 * dpr);
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }
}

function renderWarningList() {
  const hour = state.warningsHourUtc, list = ui.warningList;
  const active = state.warnings.filter(w => w.valid), recent = state.warnings.filter(w => !w.valid && hour != null && hour - warningEnd(w) <= 2);
  const tor = active.filter(w => w.type === 'tornado').length;
  ui.warningCount.textContent = hour == null ? '—' : `${tor} TOR · ${active.length - tor} SVR`;
  list.innerHTML = '';
  for (const w of [...active.sort((a, b) => warningRank(b) - warningRank(a) || b.issuedHourUtc - a.issuedHourUtc), ...recent]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `warning-item${w.id === state.chosenWarning ? ' on' : ''}${w.valid ? '' : ' ended'}`;
    button.style.setProperty('--c', warningColour(w));
    const tags = w.type === 'tornado' ? [w.tags.tornado === 'OBSERVED' ? 'observed' : 'radar indicated', w.tags.damage ? 'considerable damage' : null]
      : [w.tags.damage ? `${w.tags.damage.toLowerCase()} damage` : null, w.tags.gustMph >= 58 ? `${w.tags.gustMph} mph` : null, w.tags.hailInches >= 1 ? `${w.tags.hailInches.toFixed(2)} in hail` : null, w.tags.tornado === 'POSSIBLE' ? 'tornado possible' : null];
    button.innerHTML = `<b style="color:${warningColour(w)}">${w.title}</b><span>${formatClock(w.issuedHourUtc)}–${formatClock(warningEnd(w))}${w.valid ? '' : ` · ${w.status}`}</span><small>${tags.filter(Boolean).join(' · ')}</small>`;
    button.addEventListener('click', () => chooseWarning(w.id === state.chosenWarning ? null : w.id));
    list.append(button);
  }
  if (!list.children.length) list.innerHTML = '<p class="muted">None in effect. Warnings go out as storms reach severe limits or show rotation.</p>';
}

function chooseWarning(id) {
  state.chosenWarning = id; state.warningStatement = null;
  renderWarningList(); renderWarningText(); draw();
}

function renderWarningText() {
  const w = state.warnings.find(x => x.id === state.chosenWarning);
  ui.warningText.classList.toggle('hidden', !w);
  if (!w) return;
  const statements = w.statements ?? [], index = Math.min(state.warningStatement ?? statements.length - 1, statements.length - 1);
  ui.warningTextTitle.textContent = w.title; ui.warningTextTitle.style.color = warningColour(w);
  ui.warningTextTabs.innerHTML = '';
  statements.forEach((statement, k) => {
    const tab = document.createElement('button');
    tab.type = 'button'; tab.className = `secondary${k === index ? ' active' : ''}`;
    tab.textContent = `${statement.kind === 'issued' ? 'Issued' : statement.kind === 'cancelled' ? 'Cancelled' : 'Statement'} ${formatClock(statement.hourUtc)}`;
    tab.addEventListener('click', () => { state.warningStatement = k; renderWarningText(); });
    ui.warningTextTabs.append(tab);
  });
  ui.warningTextBody.textContent = statements[index]?.text ?? w.text;
}

// A bar of a round number of kilometres (and its miles), about a sixth of the view wide.
function drawScaleBar(ctx) {
  const dpr = state.dpr, wanted = ui.overlay.width / 6 * state.view.kmPerPx;
  const km = [1, 2, 5, 10, 20, 50, 100, 200].reduce((best, step) => (Math.abs(step - wanted) < Math.abs(best - wanted) ? step : best));
  const length = km / state.view.kmPerPx, x = ui.overlay.width - length - 16 * dpr, y = ui.overlay.height - 18 * dpr;
  ctx.strokeStyle = 'rgba(226,232,240,.8)'; ctx.lineWidth = 2 * dpr;
  ctx.beginPath(); ctx.moveTo(x, y - 4 * dpr); ctx.lineTo(x, y); ctx.lineTo(x + length, y); ctx.lineTo(x + length, y - 4 * dpr); ctx.stroke();
  ctx.font = `${11 * dpr}px system-ui`; ctx.fillStyle = 'rgba(226,232,240,.8)'; ctx.textAlign = 'center';
  ctx.fillText(`${km} km · ${(km * 0.6214).toFixed(km < 10 ? 1 : 0)} mi`, x + length / 2, y - 7 * dpr);
  ctx.textAlign = 'start';
}

// Coverage: how high above the ground the lowest beam of the nearest radar is. A radar sees a
// storm's base only where its beam is low; far from every radar it sees the upper parts only,
// and beyond their range nothing.
const COVERAGE_BANDS = [[1, null, 'under 1 km'], [2, 'rgba(250,204,21,.13)', '1-2 km'], [3, 'rgba(251,146,60,.2)', '2-3 km'], [Infinity, 'rgba(248,113,113,.26)', 'over 3 km']];
const NO_COVERAGE = 'rgba(100,116,139,.5)';
let coverageImage = null;
function coverageCanvas() {
  const catalog = state.catalog, key = catalog.sites.map(site => `${site.id}:${site.xKm}:${site.yKm}`).join('|');
  if (coverageImage?.key === key) return coverageImage.canvas;
  const size = 220, canvas = document.createElement('canvas'), rangeKm = catalog.gates * catalog.gateKm;
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = (i + 0.5) / size * catalog.domainWidthKm, y = (j + 0.5) / size * catalog.domainHeightKm;
    const ground = Math.min(...catalog.sites.map(site => Math.hypot(site.xKm - x, site.yKm - y)));
    const colour = ground > rangeKm ? NO_COVERAGE : COVERAGE_BANDS.find(([limit]) => beamHeightKm(ground, 0.5) < limit)[1];
    if (colour) { ctx.fillStyle = colour; ctx.fillRect(i, j, 1, 1); }
  }
  coverageImage = { key, canvas };
  return canvas;
}
function drawCoverage(ctx, a, b) {
  const dpr = state.dpr;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(coverageCanvas(), a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.font = `${11 * dpr}px system-ui`;
  const entries = [...COVERAGE_BANDS.filter(([, colour]) => colour).map(([, colour, label]) => [colour, label]), [NO_COVERAGE, 'no radar']];
  let x = 12 * dpr; const y = ui.overlay.height - 14 * dpr;
  ctx.fillStyle = 'rgba(203,213,225,.75)'; ctx.fillText('Lowest beam above ground:', x, y); x += ctx.measureText('Lowest beam above ground:').width + 10 * dpr;
  for (const [colour, label] of entries) {
    ctx.fillStyle = 'rgba(7,11,17,.9)'; ctx.fillRect(x, y - 10 * dpr, 12 * dpr, 12 * dpr); ctx.fillStyle = colour; ctx.fillRect(x, y - 10 * dpr, 12 * dpr, 12 * dpr);
    ctx.strokeStyle = 'rgba(148,163,184,.6)'; ctx.lineWidth = 1; ctx.strokeRect(x, y - 10 * dpr, 12 * dpr, 12 * dpr);
    ctx.fillStyle = 'rgba(203,213,225,.75)'; ctx.fillText(label, x + 16 * dpr, y); x += ctx.measureText(label).width + 30 * dpr;
  }
}

// County lines, and county names once zoomed in far enough for them to fit.
function drawCounties(ctx) {
  const w = state.catalog.domainWidthKm, h = state.catalog.domainHeightKm, dpr = state.dpr;
  ctx.strokeStyle = 'rgba(148,163,184,.28)'; ctx.lineWidth = 0.8 * dpr;
  ctx.beginPath();
  for (const county of state.counties.counties) for (const ring of county.rings) { ring.forEach(([x, y], k) => { const p = kmToScreen(x * w, y * h); if (k) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.closePath(); }
  ctx.stroke();
  if (state.view.kmPerPx > 0.5 * dpr) return;
  ctx.fillStyle = 'rgba(203,213,225,.45)'; ctx.font = `600 ${10 * dpr}px system-ui`; ctx.textAlign = 'center';
  for (const county of state.counties.counties) { const p = kmToScreen(county.x * w, county.y * h); ctx.fillText(county.name.toUpperCase(), p.x, p.y); }
  ctx.textAlign = 'start';
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
    const value = inside ? decodeRadarValue(state.product, frame.bytes[j * frame.meta.width + i]) : null, spec = RADAR_PRODUCTS[state.product];
    const nearest = state.catalog.sites.reduce((a, b) => (Math.hypot(b.xKm - km.x, b.yKm - km.y) < Math.hypot(a.xKm - km.x, a.yKm - km.y) ? b : a));
    const ground = Math.hypot(nearest.xKm - km.x, nearest.yKm - km.y);
    ui.readout.innerHTML = `<strong>${!inside ? 'Outside the network' : ground > state.catalog.gates * state.catalog.gateKm ? 'No radar reaches here' : value === null ? (state.product === 'reflectivity' ? 'No echo' : 'None') : `${value.toFixed(spec.decimals)} ${spec.units}`}</strong><span>Nearest radar ${nearest.id} · ${ground.toFixed(0)} km</span><br><span>Lowest beam ${Math.round(beamHeightKm(ground, 0.5) * 3281).toLocaleString()} ft above radar · double-click to open`;
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
    const byte = frame.bytes[radial * state.catalog.gates + gate], value = decodeRadarValue(state.product, byte);
    const spec = RADAR_PRODUCTS[state.product];
    valueText = isRangeFolded(state.product, byte) ? 'Range folded' : value === null ? 'No echo'
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

function formatClock(hourUtc) {
  const total = Math.round((((hourUtc % 24) + 24) % 24) * 60) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}${String(total % 60).padStart(2, '0')}Z`;
}

function formatTime(hourUtc) {
  const day = Math.floor(hourUtc / 24) + 1, h = ((hourUtc % 24) + 24) % 24;
  const hh = Math.floor(h + 1e-6), mm = Math.round((h - hh) * 60) % 60;
  return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}Z Day ${day}`;
}

function readPreferences() {
  try { return JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}'); } catch { return {}; }
}
function savePreferences() {
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ site: siteValue(), tilt: state.tilt, product: state.product, stepped: state.stepped, warnings: state.showWarnings })); } catch { /* storage unavailable */ }
}

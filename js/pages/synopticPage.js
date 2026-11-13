// The large-scale charts: the whole large-scale model (a channel that wraps east-west) with the game map's
// place in it, drawn as forecast-model charts are: one field in filled colour bands, another as labelled
// contours, a wind as barbs, on the dark ground the site's other charts have. The charts on offer are the usual ones, by level.
//
// Three sources (the page is served at three addresses, synoptic.html):
//   /synoptic              the analysis of the last 18 hours (server/SynopticRuntime.js)
//   /models/large-scale    a short range model run, every few forecast hours (?run=<init hour>)
//   /models/long-range     a long range model run: 7 days from 06Z, every 3 hours (js/forecast/LongRangeModel.js)
//   /day/<id>/synoptic     a past day's replay, hour by hour (server/ReplayArchive.js)
// "Save loop as GIF" and "Save loop as MP4" steps through the frames on show and saves them as one picture (js/gif.js).
// The view, for everyone, as it first was: it follows the game map east-west as the map drifts, so the map's box
// moves north and south in the chart; dragging or zooming with the wheel lets go of the map, and the box then
// moves freely through the frames ("Map" and "Whole model" take hold of it again). No page draws an arrow for
// the map's drift. An admin (the server sends the role with each frame) is also told the drift's speed and the
// day's aim, in the facts beside the chart.
// ?share=1: only the chart, with its title, time, key and the site's name in the frame (tools/social/make-loop.mjs).
// ?frame=<hour>, ?zoom=<n>, ?chart=<key>; ?follow=0&cx=<x>&cy=<y> holds the view on a place (grid units) so the
// map's box moves; ?view=public shows an admin what the public is told.
import { saveLoop, drawChartFrame } from '/js/gif.js';
import { openSounding } from '/js/pages/soundingPanel.js';

const canvas = document.getElementById('synCanvas'), ctx = canvas.getContext('2d'), tip = document.getElementById('synTip');
const $ = id => document.getElementById(id);
const REFRESH_MS = 10000, LOOP_MS = 450;
const GROUND = '#10161d', OUTSIDE = '#0a0f15', INK = 'rgba(255,255,255,.9)', LABEL = '#f2f4f5', HALO = 'rgba(8,12,18,.92)';
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

// --- How each field is drawn.
// Filled bands: a value from levels[k] up to levels[k + 1] takes colours[k]; under the first level nothing
// is drawn (or `under`). Contours: every `interval` (from `from` up; zero left out with skipZero), in `line`
// colour, dashed for temperatures and moisture as model charts draw them.
const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
// n colours along a list of colour stops.
function ramp(stops, n) {
  const list = stops.map(hex), out = [];
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 0 : k / (n - 1) * (list.length - 1), i = Math.min(list.length - 2, Math.floor(t)), f = t - i;
    out.push(list[i].map((v, c) => Math.round(v + (list[i + 1][c] - v) * f)));
  }
  return out;
}
const steps = (from, to, by) => { const out = []; for (let v = from; v <= to + 1e-9; v += by) out.push(Number(v.toFixed(4))); return out; };
const banded = (levels, stops, extra = {}) => ({ levels, colours: ramp(stops, levels.length), ...extra });
// Wind speed (isotachs): deep blue (the weakest band, so it sits back on the dark ground), blue, green, yellow,
// orange, red, magenta, as the jet charts run.
const ISOTACH = ['#234a73', '#2f6fb0', '#4a9fe0', '#2ea05a', '#9bcf3c', '#f4de3a', '#f6a827', '#ea5a24', '#cf2a2a', '#b0207a', '#e7a3d6'];
const TEMPERATURE = ['#7b3fa6', '#3b4cc0', '#4f9be0', '#57c7c2', '#62c36b', '#c9dc4a', '#f6d03a', '#f59a2a', '#e2532a', '#b81f2a', '#7a1436'];
const MOISTURE = ['#8a6a43', '#b89a66', '#dcc99a', '#e9efc9', '#b5e0a0', '#6ec574', '#2f9e58', '#1f8a87', '#2a6fc4', '#5a44b8', '#8b2fa0'];
const DIVERGING_DRY_MOIST = ['#7a4f1e', '#b98a4e', '#e3cf9f', '#cfe8c4', '#6fc27a', '#1f8a4c'];
const DIVERGING_COLD_WARM = ['#2a4fbf', '#5c8be0', '#a9c8f0', '#f6c2b0', '#e8704e', '#b8202a'];
const SCALES = {
  wspd250: banded(steps(50, 170, 10), ISOTACH, { contour: { interval: 20, from: 50 } }),
  wspd500: banded(steps(30, 120, 10), ISOTACH, { contour: { interval: 20, from: 40 } }),
  wspd850: banded([20, 25, 30, 35, 40, 45, 50, 60, 70], ISOTACH, { contour: { interval: 10, from: 20 } }),
  shear: banded([20, 30, 40, 50, 60, 70, 80, 100], ISOTACH, { contour: { interval: 10, from: 30 } }),
  vort500: banded([10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40], ['#fff3a6', '#fbd24a', '#f6a12b', '#e9602a', '#cf2b2b', '#a3207a', '#6a2a9c'], { contour: { interval: 4, from: 12 } }),
  z250: banded(steps(1000, 1100, 10), ['#5b4aa0', '#4f86c6', '#7fc3b0', '#e6d38a', '#d98850', '#b5482f'], { under: true, contour: { interval: 12 } }),
  z500: banded(steps(534, 606, 6), ['#5b4aa0', '#4f86c6', '#7fc3b0', '#e6d38a', '#d98850', '#b5482f'], { under: true, contour: { interval: 6 } }),
  t500: banded(steps(-40, 0, 2), TEMPERATURE, { under: true, contour: { interval: 2, line: '#ff9a8f', dash: true } }),
  tair: banded(steps(0, 110, 5), TEMPERATURE, { under: true, contour: { interval: 10, line: '#ff9a8f', dash: true } }),
  td: banded(steps(20, 80, 5), MOISTURE, { under: true, contour: { interval: 5, from: 45, line: '#7fe08f', dash: true } }),
  q: banded(steps(2, 20, 2), MOISTURE, { under: true, contour: { interval: 2, from: 6, line: '#7fe08f', dash: true } }),
  mslp: banded(steps(980, 1040, 4), ['#6a3fa0', '#4f7fd0', '#a9d3e8', '#f3f0dc', '#f2c078', '#d96a3a'], { under: true, contour: { interval: 4 } }),
  qtrans: banded([100, 150, 200, 250, 300, 400, 500, 600, 800], ['#d9f0c8', '#8fd18a', '#3fae8a', '#2f86c6', '#4a52b8', '#8a2fa0'], { contour: { interval: 100, from: 100 } }),
  qadv: banded([-3, -2, -1, -0.5, -0.2, 0.2, 0.5, 1, 2, 3], DIVERGING_DRY_MOIST, { under: true, blank: [-0.2, 0.2], contour: { interval: 0.5, skipZero: true } }),
  tadv: banded([-6, -4, -2, -1, -0.5, 0.5, 1, 2, 4, 6], DIVERGING_COLD_WARM, { under: true, blank: [-0.5, 0.5], contour: { interval: 1, skipZero: true } }),
  ascent: banded([-0.6, -0.4, -0.2, -0.1, 0.05, 0.1, 0.2, 0.3, 0.5, 0.8], ['#8a5a2a', '#c79a5e', '#ead9b0', '#cfe9d0', '#74c79a', '#2f9aa0', '#3a5fc0', '#6a2f9c'], { under: true, blank: [-0.1, 0.05], contour: { interval: 0.1, from: 0.1 } }),
  rain: banded([0.05, 0.1, 0.25, 0.5, 1, 2, 4], ['#bfe6b0', '#62c36b', '#1f8a4c', '#f4de3a', '#f59a2a', '#d9302b', '#a3207a'], { contour: { levels: [0.05, 0.1, 0.25, 0.5, 1] } }),
  // Severe weather: across the whole model (the wide window about the map, the large-scale columns beyond it),
  // with the game map's own readings laid in its box (the field's mapValues on mapGrid).
  mapcape: banded([250, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 5000], ['#f6efb0', '#f4de3a', '#f6a827', '#ea5a24', '#cf2a2a', '#b0207a', '#7a2a9c']),
  mapcin: banded([10, 25, 50, 75, 100, 150, 200, 300], ['#cfe6f5', '#8fc3ea', '#4f8fd6', '#3a5fc0', '#4a3aa8', '#2a1f6a']),
  mapscp: banded([1, 2, 4, 6, 8, 12, 16, 20, 30], ['#f6efb0', '#f4de3a', '#f6a827', '#ea5a24', '#cf2a2a', '#b0207a', '#7a2a9c']),
  mapstp: banded([0.5, 1, 2, 3, 4, 5, 6, 8, 10], ['#f6efb0', '#f4de3a', '#f6a827', '#ea5a24', '#cf2a2a', '#b0207a', '#7a2a9c'])
};

// The charts, as a model site lists them: by level. Each is a shaded field, a contoured one and a wind.
const PRESETS = [
  { key: 'jet', group: 'Upper air', label: '250 mb wind and heights', shade: 'wspd250', contour: 'z250', wind: '250' },
  { key: 'wind500', group: 'Upper air', label: '500 mb wind and heights', shade: 'wspd500', contour: 'z500', wind: '500' },
  { key: 'vort', group: 'Upper air', label: '500 mb vorticity and heights', shade: 'vort500', contour: 'z500', wind: '500' },
  { key: 't500', group: 'Upper air', label: '500 mb temperature and heights', shade: 't500', contour: 'z500', wind: '500' },
  { key: 'llj', group: 'Lower levels', label: '850 mb wind (low-level jet)', shade: 'wspd850', contour: 'mslp', wind: '850' },
  { key: 'transport', group: 'Lower levels', label: '850 mb moisture transport', shade: 'qtrans', contour: 'q', wind: '850' },
  { key: 'tadv', group: 'Lower levels', label: '850 mb temperature advection', shade: 'tadv', contour: 'tair', wind: '850' },
  { key: 'surge', group: 'Lower levels', label: '850 mb moisture advection', shade: 'qadv', contour: 'td', wind: '850' },
  { key: 'surface', group: 'Surface', label: 'Temperature, pressure and wind', shade: 'tair', contour: 'mslp', wind: 'sfc' },
  { key: 'moisture', group: 'Surface', label: 'Dewpoint, pressure and wind', shade: 'td', contour: 'mslp', wind: 'sfc' },
  { key: 'rain', group: 'Surface', label: 'Precipitation rate and pressure', shade: 'rain', contour: 'mslp', wind: 'sfc' },
  { key: 'lift', group: 'Forcing and shear', label: 'Large-scale lift and 500 mb heights', shade: 'ascent', contour: 'z500', wind: '500' },
  { key: 'shear', group: 'Forcing and shear', label: 'Deep-layer shear (surface to 500 mb)', shade: 'shear', contour: 'z500', wind: 'shear' },
  { key: 'cape', group: 'Severe weather', label: 'CAPE, pressure and wind', shade: 'mapcape', contour: 'mslp', wind: 'sfc' },
  { key: 'cin', group: 'Severe weather', label: 'Inhibition (CIN), pressure and wind', shade: 'mapcin', contour: 'mslp', wind: 'sfc' },
  { key: 'scp', group: 'Severe weather', label: 'Supercell composite and shear', shade: 'mapscp', contour: 'z500', wind: 'shear' },
  { key: 'stp', group: 'Severe weather', label: 'Significant tornado parameter', shade: 'mapstp', contour: 'mslp', wind: 'sfc' }
];

let data = null, layers = { shade: null, contour: null, wind: null };
let frameHour = null, looping = null;
const fieldCache = new Map();   // `${run}:${key}:${frameHour}` -> field
const contourCache = new Map(); // `${key}:${frameHour}` -> segments by level
const shadeImage = { canvas: null, key: '' }, mapImage = { canvas: null, key: '' };
// The view: centre (grid units, x east, y north), zoom over the fit-to-window scale; it follows the map
// east-west until it is dragged or zoomed with the wheel.
const view = { cx: 0, cy: 0, zoom: 1, follow: true, scale: 1, width: 0, height: 0 };
const query = new URLSearchParams(location.search), SHARE = query.get('share') === '1';
if (SHARE) document.body.classList.add('share');
if (query.get('frame') !== null && Number.isFinite(Number(query.get('frame')))) frameHour = Number(query.get('frame'));
const queryZoom = Number(query.get('zoom')) > 0;
if (queryZoom) view.zoom = Math.max(1, Math.min(10, Number(query.get('zoom'))));
if (query.get('follow') === '0') { view.follow = false; view.held = query.get('cx') !== null ? { cx: Number(query.get('cx')), cy: Number(query.get('cy') ?? 32) } : null; }

// Who is looking. The admin key is the one the site's top bar keeps for this tab (js/site.js); the server answers with the role it gives the request, and leaves the map's drift out for the public.
const ADMIN_KEY = 'wwAdminKey', FORCE_PUBLIC = SHARE || query.get('view') === 'public';
const adminKey = { get() { try { return sessionStorage.getItem(ADMIN_KEY); } catch { return null; } }, set(v) { try { v ? sessionStorage.setItem(ADMIN_KEY, v) : sessionStorage.removeItem(ADMIN_KEY); } catch { /* no storage: the key lasts until the page is left */ } } };
let admin = false;
function setRole(role) {
  admin = role === 'admin' && !FORCE_PUBLIC;
  document.body.dataset.role = admin ? 'admin' : 'public';
}

// Where the frames come from: the analysis of the last hours (/synoptic), or a short range model run
// every few forecast hours (/models/large-scale; ?run=<init hour> names the run, else the newest).
const MODEL = location.pathname.startsWith('/models'), LONG = location.pathname.startsWith('/models/long-range'), MODEL_API = `/api/models/${LONG ? 'long-range' : 'short-range'}`;
// (a past day's replay: its kept hours, named like a model run's frames)
const DAY = location.pathname.match(/^\/day\/([A-Za-z0-9-]+)\/synoptic/)?.[1] ?? null, REPLAY = Boolean(DAY), STEPPED = MODEL || REPLAY;
let runInit = MODEL && query.get('run') !== null && Number.isFinite(Number(query.get('run'))) ? Number(query.get('run')) : null;
document.body.dataset.source = REPLAY ? 'replay' : MODEL ? 'model' : 'analysis';
if (MODEL) { $('synHeading').textContent = LONG ? 'Long range model' : 'Large-scale view'; document.title = `${LONG ? 'Long range model' : 'Large-scale view'} · Models · High Risk`; }
if (LONG) { $('crumbModel').textContent = 'Long range'; $('tabLargeScale').removeAttribute('aria-current'); $('tabLongRange').setAttribute('aria-current', 'page'); $('runNote').textContent = 'Select a point inside the game map\'s box for the run\'s sounding there. The long range model: a 7-day run from each 0600 UTC, every 3 forecast hours, without storms. Like a real forecast it has a timing error: systems reach the map a little early or late, more so with each day ahead.'; }
if (REPLAY) { $('synHeading').textContent = 'Large-scale charts: replay'; document.title = 'Large-scale replay · Past days · High Risk'; for (const link of document.querySelectorAll('[data-day-link]')) link.href = `/day/${DAY}`; }
const api = REPLAY
  ? { frame: hour => `/api/day/${DAY}/replay/synoptic/frame${hour === null ? '' : `?frame=${hour}`}`, field: (key, hour) => `/api/day/${DAY}/replay/synoptic/field?frame=${hour}&key=${encodeURIComponent(key)}` }
  : MODEL
  ? { frame: hour => `${MODEL_API}/synoptic/frame?init=${runInit ?? ''}${hour === null ? '' : `&frame=${hour}`}`, field: (key, hour) => `${MODEL_API}/synoptic/field?init=${runInit ?? ''}&frame=${hour}&key=${encodeURIComponent(key)}` }
  : { frame: hour => `/api/synoptic/frame${hour === null ? '' : `?frame=${hour}`}`, field: (key, hour) => `/api/synoptic/field?key=${encodeURIComponent(key)}&frame=${hour}` };

// --- Loading.
async function getJson(url) {
  const key = adminKey.get(), response = await fetch(url, { cache: 'no-store', headers: key && !FORCE_PUBLIC ? { 'x-admin-key': key } : {} });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}
async function getField(key) {
  if (!key) return null;
  const id = `${data.run?.initHourUtc ?? ''}:${key}:${data.frameHour}`;
  // (a field this frame does not have, as a replay kept before the field existed, is no layer: the rest are drawn)
  if (!fieldCache.has(id)) { fieldCache.set(id, await getJson(api.field(key, data.frameHour)).catch(error => { if (error.message === '404') return null; throw error; })); if (fieldCache.size > 160) fieldCache.delete(fieldCache.keys().next().value); }
  return fieldCache.get(id);
}
async function load() {
  try {
    data = await getJson(api.frame(frameHour));
    setRole(data.role);
    if (!$('shadeField').dataset.filled) fillSelects();
    const [shade, contour, wind] = await Promise.all([getField($('shadeField').value), getField($('contourField').value), getField($('windField').value ? `wind:${$('windField').value}` : '')]);
    layers = { shade, contour, wind };
  } catch (error) { data = { status: 'offline', missing: error.message === '404' }; layers = { shade: null, contour: null, wind: null }; }
  describe();
  draw();
}
async function refresh() { if (!looping) await load(); setTimeout(refresh, data?.status === 'ready' ? REFRESH_MS : 2500); }

// --- Side panel.
const clock = hours => { const h = ((hours % 24) + 24) % 24; return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`; };
const words = text => String(text ?? '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
const compass = deg => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
const presetNow = () => PRESETS.find(p => p.shade === $('shadeField').value && p.contour === $('contourField').value && p.wind === $('windField').value);

function fillSelects() {
  const fill = (select, none) => {
    select.innerHTML = `<option value="">${none}</option>`;
    const groups = new Map();
    // (the severe-weather fields are shaded only)
    for (const f of data.fields) { if (f.map && select !== $('shadeField')) continue; if (!groups.has(f.group)) groups.set(f.group, []); groups.get(f.group).push(f); }
    for (const [name, list] of groups) { const group = document.createElement('optgroup'); group.label = name; for (const f of list) group.append(new Option(f.unit ? `${f.label} (${f.unit})` : f.label, f.key)); select.append(group); }
  };
  fill($('shadeField'), 'None'); fill($('contourField'), 'None');
  $('windField').innerHTML = '<option value="">None</option>' + data.winds.map(w => `<option value="${w.key}">${w.label}</option>`).join('');
  $('shadeField').dataset.filled = '1';
  const wanted = query.get('chart');
  applyPreset(PRESETS.find(p => p.key === wanted) ?? PRESETS[0], false);
}

function describe() {
  const time = $('synTime'), status = $('synStatus');
  if (data.status !== 'ready') {
    time.textContent = '—';
    status.textContent = REPLAY && data.missing ? 'This day has no replay (a replay is kept for 16 world days, about two real days).' : MODEL && data.missing ? (LONG ? 'No long range run yet. One is made at each 0600 UTC of the world (and soon after the engine starts); it takes a few minutes.' : 'No model run with a large-scale view yet. The short range model makes one at each whole hour of the world.') : 'Server not reachable. Start it with npm start (a first start takes about a minute).';
    return;
  }
  time.textContent = data.date ? `${data.date} · ${clock(data.hourUtc)} UTC` : `${clock(data.hourUtc)} UTC`;
  if (MODEL) describeRun();
  const behind = data.frames.at(-1) - data.frameHour;
  status.textContent = REPLAY ? `replay, hour ${data.frames.indexOf(data.frameHour) + 1} of ${data.frames.length}` : MODEL ? (LONG ? `day ${Math.floor(data.run.forecastHour / 24) + 1}, forecast hour ${data.run.forecastHour} of the 7-day run · less sure with each day` : `forecast hour ${data.run.forecastHour} of the ${clock(data.run.initHourUtc).slice(0, 2)}Z short range run`) : `${clock(data.hourUtc + data.localOffsetHours)} local · ${data.latest ? 'current analysis' : `${behind} h ago`}`;
  const slider = $('frameSlider'); slider.max = data.frames.length - 1; slider.value = data.frames.indexOf(data.frameHour);
  $('frameLatest').classList.toggle('on', frameHour === null && !looping);
  $('framePlay').classList.toggle('on', Boolean(looping)); $('framePlay').textContent = looping ? 'Stop' : 'Loop';
  const mi = km => Math.round(km * 0.621371);
  const centre = mapCentre(), offNorth = (centre.y - (data.grid.ny - 1) / 2) * data.grid.km;
  const lows = data.centres.filter(c => c.type === 'L'), nearest = lows.map(c => ({ c, km: distanceKm(centre, c) })).sort((a, b) => a.km - b.km)[0];
  const facts = [['Map size', `${mi(data.map.km)} mi square`], ['From the jet axis', `${mi(Math.abs(offNorth))} mi ${offNorth >= 0 ? 'north' : 'south'}`], ['Nearest low', nearest ? `${nearest.c.hpa} hPa, ${mi(nearest.km)} mi ${compass(bearing(centre, nearest.c))}` : 'none']];
  // (how fast the map moves and what it is aiming for are for an admin only: the server leaves them out of a public frame)
  if (admin && data.slide) {
    const s = data.slide, speed = Math.hypot(s.eastKmh, s.northKmh);
    facts.splice(1, 0, ['Map drift', speed < 1 ? 'holding still' : `${mi(speed)} mph toward the ${compass(Math.atan2(s.eastKmh, s.northKmh) * 180 / Math.PI)}`], ['Today\'s aim', s.plan ? words(s.plan.kind) : '—']);
  }
  $('synFacts').innerHTML = facts.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');
  drawLegend();
  if (SHARE) describeShare();
  const now = presetNow();
  for (const button of document.querySelectorAll('#presets button')) button.classList.toggle('on', button.dataset.preset === now?.key);
}

// The model run's list (large-scale view of the models): the runs the server holds, the newest first.
function describeRun() {
  const select = $('runSelect'), runs = [...data.run.runs].reverse(), key = runs.map(r => r.initHourUtc).join(',');
  if (select.dataset.key !== key) {
    select.dataset.key = key;
    // (the long range runs are a day apart, all from the same hour: each is named by how old it is)
    const age = r => { const days = Math.round((runs[0].initHourUtc - r.initHourUtc) / 24); return r === runs[0] ? ' (newest)' : LONG ? ` · ${days} day${days === 1 ? '' : 's'} older` : ''; };
    select.innerHTML = runs.map(r => `<option value="${r.initHourUtc}">${clock(r.initHourUtc).slice(0, 2)}Z run · ${LONG ? `${Math.round(r.hours / 24)} days` : `${r.hours} h`}${age(r)}</option>`).join('');
  }
  select.value = String(data.run.initHourUtc);
}

// The share view's title, time and key.
function describeShare() {
  const preset = presetNow(), parts = [layers.shade?.label, layers.contour?.label].filter(Boolean);
  $('shareTitle').textContent = (MODEL ? `Model F${String(data.run.forecastHour).padStart(3, '0')} · ` : '') + (preset ? preset.label : parts.join(' · '));
  $('shareTime').textContent = `${clock(data.hourUtc).replace(':', '')} UTC ${data.date ?? ''}`.trim();
  drawKey($('shareBar'), layers.shade, true);
  $('shareUnit').textContent = layers.shade ? `${layers.shade.label} (${layers.shade.unit})` : '';
}

function applyPreset(preset, reload = true) {
  $('shadeField').value = preset.shade; $('contourField').value = preset.contour; $('windField').value = preset.wind;
  const url = new URL(location.href); url.searchParams.set('chart', preset.key); history.replaceState(null, '', url);
  if (reload) load();
}

// --- Colours and the key.
// The band a value falls in: its colour [r, g, b], or null where nothing is drawn.
function colourOf(scale, value) {
  const levels = scale.levels;
  if (scale.blank && value >= scale.blank[0] && value < scale.blank[1]) return null;
  if (value < levels[0]) return scale.under ? scale.colours[0] : null;
  let k = levels.length - 1;
  while (k > 0 && value < levels[k]) k--;
  return scale.colours[k];
}
// The key: one block for each band with its lower bound under it (every other one when they are crowded).
function drawKey(bar, field, dark = false) {
  const g = bar.getContext('2d'), scale = field && SCALES[field.key], w = bar.width, h = bar.height;
  g.clearRect(0, 0, w, h);
  if (!scale) return;
  const n = scale.levels.length, block = w / n, barH = Math.round(h * 0.52), size = Math.round(h * 0.36);
  for (let k = 0; k < n; k++) {
    const blank = scale.blank && scale.levels[k] >= scale.blank[0] && scale.levels[k] < scale.blank[1], [r, gr, b] = scale.colours[k];
    g.fillStyle = blank ? GROUND : `rgb(${r},${gr},${b})`;
    g.fillRect(Math.round(k * block), 0, Math.ceil(block), barH);
  }
  g.strokeStyle = dark ? '#5a636d' : '#8a8f94'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, w - 1, barH - 1);
  g.fillStyle = dark ? '#dfe5ea' : '#6b7075'; g.font = `${size}px "IBM Plex Mono", ui-monospace, monospace`; g.textBaseline = 'alphabetic';
  const every = n > 9 ? 2 : 1;
  for (let k = 0; k < n; k += every) { g.textAlign = k === 0 ? 'left' : 'center'; g.fillText(String(scale.levels[k]), k === 0 ? 1 : k * block, h - 2); }
}
function drawLegend() {
  const note = $('legendNote'), parts = [];
  drawKey($('legendBar'), layers.shade);
  if (layers.shade) parts.push(`Shaded: ${layers.shade.label}${layers.shade.unit ? ` (${layers.shade.unit})` : ''}${data.fields.find(f => f.key === layers.shade.key)?.map ? (layers.shade.wide ? ': the game map\'s own values in its box, the map\'s kind of low-level weather worked out for 1,000 miles around it, the large-scale model alone beyond (its composites read low)' : ': the large-scale model alone outside the game map (its composites read low; the wider view around the map is not ready for this time)') : ''}`);
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
  // (a view asked for by address starts on its place; otherwise a view that stops following stays where it was)
  if (view.held) { view.cx = view.held.cx; view.cy = view.held.cy; view.held = null; }
  if (view.follow) view.cx = mapCentre().x;
  const half = view.height / 2 / view.scale;
  view.cy = ny * view.scale + view.scale <= view.height ? (ny - 1) / 2 : Math.min(ny - 0.5 - half, Math.max(half - 0.5, view.follow ? mapCentre().y : view.cy));
}

// --- Drawing.
function resize() {
  const ratio = window.devicePixelRatio || 1, box = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(box.width * ratio)); canvas.height = Math.max(1, Math.round(box.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  // Narrow screens open closer in around the map (the whole channel is a thin strip there).
  if (!view.width && box.width < 700 && !queryZoom) view.zoom = 3;
  view.width = box.width; view.height = box.height;
  draw();
}

function draw() {
  ctx.clearRect(0, 0, view.width, view.height);
  ctx.fillStyle = OUTSIDE; ctx.fillRect(0, 0, view.width, view.height);
  if (!data || data.status !== 'ready') { ctx.fillStyle = '#9ba1a6'; ctx.font = '15px "Public Sans", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(data?.missing ? 'No model run to show yet.' : 'Waiting for the server…', view.width / 2, view.height / 2); return; }
  fitView();
  const { ny } = data.grid, [, top] = toScreen(0, ny - 0.5), [, bottom] = toScreen(0, -0.5);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, top, view.width, bottom - top); ctx.clip();
  ctx.fillStyle = GROUND; ctx.fillRect(0, top, view.width, bottom - top);
  if (layers.shade && SCALES[layers.shade.key]) drawShading(layers.shade);
  if ($('showGrid').checked) drawGrid();
  if (layers.contour) drawContours(layers.contour);
  if (layers.wind) drawBarbs(layers.wind);
  if ($('showCentres').checked) drawCentres();
  if ($('showMap').checked) drawMapBox();
  ctx.restore();
  // The channel's northern and southern edges (the weather wraps east-west; it ends north and south).
  ctx.strokeStyle = '#3a424b'; ctx.lineWidth = 1;
  for (const y of [top, bottom]) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(view.width, y + 0.5); ctx.stroke(); }
  drawScale(bottom);
}

// The shaded field in filled bands: the grid's values are read at several points to each grid length (so the
// bands' edges are smooth curves, not grid squares), each given its band's colour, and the picture laid over
// each copy of the wrapping domain.
const FINE = 6;
function drawShading(field) {
  const { nx, ny } = data.grid, scale = SCALES[field.key], id = `${field.key}:${field.frameHour}:${data.run?.initHourUtc ?? ''}`;
  if (shadeImage.key !== id) {
    const c = shadeImage.canvas ??= document.createElement('canvas'); c.width = nx * FINE; c.height = ny * FINE;
    const g = c.getContext('2d'), image = g.createImageData(c.width, c.height), at = { x: 0, y: 0 };
    for (let py = 0; py < c.height; py++) for (let px = 0; px < c.width; px++) {
      at.x = (px + 0.5) / FINE - 0.5; at.y = ny - 0.5 - (py + 0.5) / FINE;
      const colour = colourOf(scale, sample(field.values, at)), o = (py * c.width + px) * 4;
      if (colour) { image.data[o] = colour[0]; image.data[o + 1] = colour[1]; image.data[o + 2] = colour[2]; image.data[o + 3] = 235; }
    }
    g.putImageData(image, 0, 0); shadeImage.key = id;
  }
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  for (const offset of copies()) {
    const [x0, topY] = toScreen(offset - 0.5, ny - 0.5), [x1] = toScreen(offset + nx - 0.5, 0);
    if (x1 < 0 || x0 > view.width) continue;
    ctx.drawImage(shadeImage.canvas, x0, topY, nx * view.scale, ny * view.scale);
  }
  if (field.mapGrid) drawMapShading(field);
}

// The game map's own values of a field (field.mapValues on field.mapGrid, row 0 at the map's northern edge), in the
// same filled bands, laid inside the map's box over the coarser picture around it.
function drawMapShading(field) {
  const { nx, ny } = field.mapGrid, scale = SCALES[field.key], id = `${field.key}:${field.frameHour}:${data.run?.initHourUtc ?? ''}`, fine = 4;
  if (mapImage.key !== id) {
    const c = mapImage.canvas ??= document.createElement('canvas'); c.width = nx * fine; c.height = ny * fine;
    const g = c.getContext('2d'), image = g.createImageData(c.width, c.height);
    // (opaque, on the chart's ground: what is under the box is the same field, coarser)
    for (let o = 0; o < image.data.length; o += 4) { image.data[o] = 16; image.data[o + 1] = 22; image.data[o + 2] = 29; image.data[o + 3] = 255; }
    for (let py = 0; py < c.height; py++) for (let px = 0; px < c.width; px++) {
      const colour = colourOf(scale, sampleMap(field, (px + 0.5) / c.width, (py + 0.5) / c.height)), o = (py * c.width + px) * 4;
      if (colour) { image.data[o] = Math.round(colour[0] * 0.92 + 16 * 0.08); image.data[o + 1] = Math.round(colour[1] * 0.92 + 22 * 0.08); image.data[o + 2] = Math.round(colour[2] * 0.92 + 29 * 0.08); }
    }
    g.putImageData(image, 0, 0); mapImage.key = id;
  }
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const m = data.map;
  for (const offset of copies(m.width)) {
    const [x0, y0] = toScreen(m.x + offset, m.y + m.height), [x1, y1] = toScreen(m.x + m.width + offset, m.y);
    if (x1 < 0 || x0 > view.width) continue;
    ctx.drawImage(mapImage.canvas, x0, y0, x1 - x0, y1 - y0);
  }
}
// A map field's value at a place in the box (fx east, fy south, each 0 to 1), between its cells' middles.
function sampleMap(field, fx, fy) {
  const { nx, ny } = field.mapGrid, x = Math.max(0, Math.min(nx - 1, fx * nx - 0.5)), y = Math.max(0, Math.min(ny - 1, fy * ny - 0.5));
  const i0 = Math.min(nx - 2, Math.floor(x)), j0 = Math.min(ny - 2, Math.floor(y)), tx = x - i0, ty = y - j0, v = (i, j) => field.mapValues[j * nx + i];
  return (v(i0, j0) * (1 - tx) + v(i0 + 1, j0) * tx) * (1 - ty) + (v(i0, j0 + 1) * (1 - tx) + v(i0 + 1, j0 + 1) * tx) * ty;
}
// Where a grid place is in the map's box (fx, fy as above), or null outside it.
function inMap(at) {
  const m = data.map, nx = data.grid.nx, dx = (((at.x - m.x) % nx) + nx) % nx, fy = (m.y + m.height - at.y) / m.height;
  return dx <= m.width && fy >= 0 && fy <= 1 ? { fx: dx / m.width, fy } : null;
}

function contourLevels(field) {
  const style = SCALES[field.key]?.contour ?? {};
  if (style.levels) return style.levels;
  const interval = style.interval ?? (field.max - field.min) / 8, out = [];
  if (!(interval > 0)) return out;
  for (let v = Math.ceil(field.min / interval) * interval; v <= field.max; v += interval) {
    const level = Math.round(v / interval) * interval;
    if (style.skipZero && Math.abs(level) < interval / 2) continue;
    if (style.from !== undefined && level < style.from - 1e-9) continue;
    out.push(Number(level.toFixed(4)));
  }
  return out;
}
// Marching squares on the grid (wrapping east-west), as segments in grid units, by level.
function contourSegments(field) {
  const id = `${field.key}:${field.frameHour}:${data.run?.initHourUtc ?? ''}`;
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
  // (over its own shading a field's lines would only trace the band edges: they are left out)
  if (field.key === layers.shade?.key) return;
  const style = SCALES[field.key]?.contour ?? {}, colour = style.line ?? INK, dash = style.dash ? [7, 4] : [], lines = contourSegments(field);
  const decimals = (style.interval ?? 1) < 1 || style.levels ? 2 : 0;
  ctx.save(); ctx.lineWidth = 1.35; ctx.strokeStyle = colour; ctx.setLineDash(dash);
  ctx.font = '700 11.5px "Public Sans", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
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
      const text = Number(level.toFixed(decimals)).toLocaleString('en-US', { useGrouping: false }), w = ctx.measureText(text).width + 6;
      ctx.setLineDash([]);
      for (const [mx, my] of best) { ctx.fillStyle = HALO; ctx.fillRect(mx - w / 2, my - 7.5, w, 15); ctx.fillStyle = colour; ctx.fillText(text, mx, my + 0.5); }
      ctx.setLineDash(dash);
    }
  }
  ctx.restore();
}

function drawBarbs(wind) {
  const { nx, ny } = data.grid, stride = Math.max(1, Math.ceil(40 / view.scale));
  for (const offset of copies(1)) for (let j = 0; j < ny; j += stride) for (let i = 0; i < nx; i += stride) {
    const [x, y] = toScreen(i + offset, j);
    if (x < -30 || x > view.width + 30 || y < -30 || y > view.height + 30) continue;
    const u = wind.u[j * nx + i], v = wind.v[j * nx + i];
    drawBarb(x, y, Math.hypot(u, v), Math.atan2(-u, -v) * 180 / Math.PI, 'rgba(225,238,250,.8)');
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
  ctx.font = font; ctx.lineWidth = 3.5; ctx.lineJoin = 'round'; ctx.strokeStyle = HALO; ctx.setLineDash([]); ctx.strokeText(text, x, y); ctx.fillStyle = colour; ctx.fillText(text, x, y);
}
function drawCentres() {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const offset of copies(1)) for (const c of data.centres) {
    const [x, y] = toScreen(c.x + offset, c.y);
    if (x < -20 || x > view.width + 20) continue;
    const colour = c.type === 'L' ? '#ff5d6c' : '#6fb2ff';
    outlinedText(c.type, x, y, colour, '800 24px "Public Sans", system-ui, sans-serif');
    outlinedText(String(c.hpa), x, y + 18, colour, '700 11.5px "Public Sans", system-ui, sans-serif');
  }
}
// Lines every 1,000 km.
function drawGrid() {
  const { ny, km } = data.grid, step = 1000 / km;
  ctx.save(); ctx.strokeStyle = 'rgba(150,165,183,.16)'; ctx.lineWidth = 1;
  const left = toGrid(0, 0).x, right = toGrid(view.width, 0).x;
  for (let x = Math.ceil(left / step) * step; x <= right; x += step) { const [sx, sy0] = toScreen(x, ny - 0.5), [, sy1] = toScreen(x, -0.5); ctx.beginPath(); ctx.moveTo(sx, sy0); ctx.lineTo(sx, sy1); ctx.stroke(); }
  for (let y = -0.5 + step; y < ny - 0.5; y += step) { const [, sy] = toScreen(0, y); ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(view.width, sy); ctx.stroke(); }
  ctx.restore();
}
// The game map's box and its name. (No arrow for its drift, on any page: owner, 2026-11-12.)
function drawMapBox() {
  const m = data.map;
  for (const offset of copies(m.width)) {
    const [x0, y0] = toScreen(m.x + offset, m.y + m.height), [x1, y1] = toScreen(m.x + m.width + offset, m.y);
    if (x1 < -40 || x0 > view.width + 40) continue;
    ctx.save();
    ctx.lineWidth = 5; ctx.strokeStyle = HALO; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.lineWidth = 2.2; ctx.strokeStyle = '#ffffff'; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; outlinedText('Game map', x0 + 1, y0 - 4, '#ffffff', '800 12.5px "Public Sans", system-ui, sans-serif');
    ctx.restore();
  }
}
function drawScale(bottom) {
  const miles = view.scale * (1000 / 1.609344) / data.grid.km < 60 ? 1000 : 500, length = miles * 1.609344 / data.grid.km * view.scale;
  const x = 14, y = Math.min(view.height - 14, bottom - 12);
  ctx.save(); ctx.strokeStyle = LABEL; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + length, y); ctx.stroke();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; outlinedText(`${miles.toLocaleString()} miles`, x, y - 7, LABEL, '600 11.5px "Public Sans", system-ui, sans-serif');
  ctx.textAlign = 'right'; ctx.textBaseline = 'top'; const [, topY] = toScreen(0, data.grid.ny - 0.5); outlinedText('N ↑', view.width - 12, Math.max(8, topY + 8), LABEL, '600 11.5px "Public Sans", system-ui, sans-serif');
  ctx.restore();
}

// --- Pointer: values under it; the wheel zooms; an admin can drag the view.
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
  const here = layers.shade?.mapGrid ? inMap(at) : null;
  if (layers.shade) lines.push(fmt(layers.shade, here ? sampleMap(layers.shade, here.fx, here.fy) : sample(layers.shade.values, at)));
  if (layers.contour && layers.contour.key !== layers.shade?.key) lines.push(fmt(layers.contour, sample(layers.contour.values, at)));
  if (layers.wind) { const u = sample(layers.wind.u, at), v = sample(layers.wind.v, at); lines.push(`Wind: <b>${Math.round((Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360)}° ${Math.round(Math.hypot(u, v))} kt</b>`); }
  const centre = mapCentre(), km = distanceKm(centre, at);
  lines.push(`<span style="color:#9ba1a6">${Math.round(km * 0.621371).toLocaleString()} mi ${compass(bearing(centre, at))} of the map's centre</span>`);
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
canvas.addEventListener('pointerup', event => {
  const pressed = drag; drag = null; canvas.classList.remove('dragging');
  // The long range model: a press on the game map that was not a drag opens the run's sounding at that place.
  if (!LONG || !pressed || pressed.moved || !data || data.status !== 'ready') return;
  const box = canvas.getBoundingClientRect(), here = inMap(toGrid(event.clientX - box.left, event.clientY - box.top));
  if (!here) return;
  const cells = 50, row = Math.min(cells - 1, Math.floor(here.fy * cells)), column = Math.min(cells - 1, Math.floor(here.fx * cells)), miles = data.map.km / 1.609344, round = v => (Number.isFinite(Number(v)) ? Math.round(v) : '—');
  if (looping) $('framePlay').click();
  openSounding({
    title: `${Math.round(here.fx * miles)} mi east, ${Math.round(here.fy * miles)} mi south on the game map`,
    load: () => getJson(`${MODEL_API}/sounding?init=${data.run.initHourUtc}&hour=${data.run.forecastHour}&row=${row}&column=${column}`),
    note: s => `${round(s.context?.surface?.temperatureF)}°F / ${round(s.context?.surface?.dewpointF)}°F at the ground · long range model, day ${Math.floor(s.forecastHour / 24) + 1}, forecast hour ${s.forecastHour} · no storms in the run, and less sure with each day`
  });
});
canvas.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
function zoomAt(factor, sx = view.width / 2, sy = view.height / 2) {
  if (!data || data.status !== 'ready') return;
  const before = toGrid(sx, sy);
  view.zoom = Math.max(1, Math.min(10, view.zoom * factor));
  view.scale = Math.min(view.width / data.grid.nx, view.height / (data.grid.ny + 1)) * view.zoom;
  // (the wheel and the buttons zoom about the pointer and let go of the map)
  if (!view.follow || factor !== 1) { view.follow = false; view.cx = before.x - (sx - view.width / 2) / view.scale; view.cy = before.y + (sy - view.height / 2) / view.scale; }
  draw();
}
canvas.addEventListener('wheel', event => { event.preventDefault(); const box = canvas.getBoundingClientRect(); zoomAt(event.deltaY < 0 ? 1.2 : 1 / 1.2, event.clientX - box.left, event.clientY - box.top); }, { passive: false });
$('zoomIn').addEventListener('click', () => zoomAt(1.4));
$('zoomOut').addEventListener('click', () => zoomAt(1 / 1.4));
$('zoomMap').addEventListener('click', () => { view.follow = true; view.zoom = 4; draw(); });
$('zoomAll').addEventListener('click', () => { view.follow = true; view.zoom = 1; draw(); });

// --- Controls.
{
  let group = null, box = null;
  for (const preset of PRESETS) {
    if (preset.group !== group) { group = preset.group; const title = document.createElement('h3'); title.textContent = group; $('presets').append(title); box = document.createElement('div'); box.className = 'syn-presets'; $('presets').append(box); }
    const button = document.createElement('button'); button.textContent = preset.label; button.dataset.preset = preset.key; button.addEventListener('click', () => applyPreset(preset)); box.append(button);
  }
}
for (const id of ['shadeField', 'contourField', 'windField']) $(id).addEventListener('change', load);
for (const id of ['showMap', 'showCentres', 'showGrid']) $(id).addEventListener('change', draw);
function stopLoop() { if (looping) { clearInterval(looping); looping = null; } }
// (the analysis follows the newest frame when the last one is chosen; a model run's frames are all named)
function showFrame(index) { if (!data?.frames) return null; const i = Math.max(0, Math.min(data.frames.length - 1, index)); frameHour = !STEPPED && i === data.frames.length - 1 ? null : data.frames[i]; return load(); }
$('frameSlider').addEventListener('input', event => { stopLoop(); showFrame(Number(event.target.value)); });
$('framePrev').addEventListener('click', () => { stopLoop(); showFrame(data.frames.indexOf(data.frameHour) - 1); });
$('frameNext').addEventListener('click', () => { stopLoop(); showFrame(data.frames.indexOf(data.frameHour) + 1); });
$('frameLatest').addEventListener('click', () => { stopLoop(); frameHour = null; load(); });
$('framePlay').addEventListener('click', () => {
  if (looping) { stopLoop(); if (!STEPPED) frameHour = null; load(); return; }
  let index = 0, busy = false;
  looping = setInterval(async () => { if (busy || !data?.frames) return; busy = true; frameHour = data.frames[index % data.frames.length]; index++; await load(); busy = false; }, LOOP_MS);
});
$('runSelect').addEventListener('change', event => { stopLoop(); runInit = Number(event.target.value); frameHour = null; const url = new URL(location.href); url.searchParams.set('run', runInit); history.replaceState(null, '', url); load(); });
// The loop on show as a GIF: every frame the time control steps through, each with its title and time.
for (const format of ['gif', 'mp4']) $(format === 'mp4' ? 'saveMp4' : 'saveGif').addEventListener('click', async event => {
  if (data?.status !== 'ready') return;
  stopLoop();
  const frames = data.frames, was = frameHour, button = event.currentTarget, chart = presetNow();
  const width = 960, height = Math.round(Math.min(640, width * canvas.height / canvas.width)) + 66;
  button.disabled = true;
  try {
    await saveLoop({
      count: frames.length, width, height, delayMs: 350, name: `highrisk-${chart?.key ?? 'chart'}${REPLAY ? `-${DAY}` : ''}.gif`, format,
      show: async k => { frameHour = frames[k]; await load(); },
      draw: g => drawChartFrame(g, canvas, { title: (MODEL ? `Model F${String(data.run.forecastHour).padStart(3, '0')} · ` : '') + (chart?.label ?? layers.shade?.label ?? 'Large-scale chart'), time: `${clock(data.hourUtc).replace(':', '')} UTC ${data.date ?? ''}`.trim() }),
      onProgress: text => { $('gifNote').textContent = text; }
    });
  } catch (error) { $('gifNote').textContent = `The ${format === 'mp4' ? 'MP4' : 'GIF'} could not be made (${error.message}).`; }
  button.disabled = false; frameHour = STEPPED ? was ?? frames[0] : was; load();
});
// The fonts the chart's labels use may arrive after the first drawing.
document.fonts?.ready.then(() => { if (data) { describe(); draw(); } });
new ResizeObserver(resize).observe(canvas);
setRole(null);
refresh();

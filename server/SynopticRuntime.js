// The synoptic view: the whole large-scale model (QuasiGeostrophicModel, a 10,240 x 5,120 km
// channel at 80 km) with the map's place in it, for the synoptic page (synoptic.html).
//
// Every grid point is read through the regional layer's own outer() and its conversions (the
// 500 mb height, the large-scale sea-level pressure, the low-level air mass and its moisture,
// the balanced winds by level), so where the domain and the map overlap these are the values the
// map is built from. What the regional layer adds on the map itself (daytime heating, lee
// trough, cold pools, storms) is not in it: this is the large-scale picture. It reads; it
// advances nothing. Like the surface analysis it keeps the frames of the last hours for a loop.
import { calendarOn, dateText } from '../js/forecast/calendar.js';
import { buildSounding, updateCellDiagnostics } from '../js/sounding.js';
import { wideReady } from '../js/world/WideRegion.js';
import { MESOANALYSIS_PARAMETERS } from './mesoanalysisParameters.js';

const HISTORY_FRAMES = 36;   // 18 simulated hours at one frame per atmosphere step
const GRAVITY = 9.81, RD = 287, KT = 1.943844;
// The base fields of a frame (Float32, one value per grid point).
const BASE = ['mslp', 'z500', 'z250', 't500', 'tair', 'q', 'ascent', 'rain', 'u1000', 'v1000', 'u850', 'v850', 'u500', 'v500', 'u250', 'v250'];
const LEVELS = { sfc: 1000, 850: 850, 500: 500, 250: 250 };

// The severe-weather fields (CAPE, CIN, supercell composite, significant tornado parameter), across the whole
// large-scale model. They come from three places, each true to what it is, joined at request (severe()):
//   on the map     the game map's own cells (the mesoanalysis page's readings), sent on the map's grid as well
//                  (mapValues) so the page can lay them in the map's box at full detail
//   around it      the wide window (js/world/WideRegion.js): the regional layer again on a coarser grid for
//                  1,600 km each way, with the lee trough, the cap, the heated boundary layer and the backed
//                  low-level winds the composites need. Kept with the frame once the window is ready.
//   beyond that    the large-scale model's own columns through the engine's sounding code. They have none of the
//                  above (low-level winds that do not turn with height, no cap), so CAPE there is sound but the
//                  composites read low. The window is faded into them over its outer WIDE_BLEND cells.
const MAP_FIELDS = [
  { key: 'mapcape', from: 'mlcape', label: 'CAPE, mixed layer', unit: 'J/kg', digits: 0 },
  { key: 'mapcin', from: 'mlcin', label: 'Inhibition (CIN), mixed layer', unit: 'J/kg', digits: 0 },
  { key: 'mapscp', from: 'scp', label: 'Supercell composite', unit: '', digits: 1 },
  { key: 'mapstp', from: 'stp', label: 'Significant tornado parameter', unit: '', digits: 1 }
].map(field => ({ ...field, group: 'Severe weather', map: true, read: MESOANALYSIS_PARAMETERS.find(p => p.key === field.from).read }));
const WIDE_BLEND = 6, KAPPA = 0.2857;
const smooth = t => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };

// The fields the page can ask for (digits: decimals sent).
export const SYNOPTIC_FIELDS = [
  { key: 'wspd250', group: 'Upper air', label: '250 mb wind speed (jet)', unit: 'kt', digits: 0 },
  { key: 'z250', group: 'Upper air', label: '250 mb height', unit: 'dam', digits: 1 },
  { key: 'z500', group: 'Upper air', label: '500 mb height', unit: 'dam', digits: 1 },
  { key: 'vort500', group: 'Upper air', label: '500 mb absolute vorticity', unit: '10⁻⁵ s⁻¹', digits: 1 },
  { key: 'wspd500', group: 'Upper air', label: '500 mb wind speed', unit: 'kt', digits: 0 },
  { key: 't500', group: 'Upper air', label: '500 mb temperature', unit: '°C', digits: 1 },
  { key: 'wspd850', group: 'Low levels', label: '850 mb wind speed (low-level jet)', unit: 'kt', digits: 0 },
  { key: 'qtrans', group: 'Low levels', label: 'Moisture transport (mixing ratio × 850 mb wind)', unit: 'g/kg·kt', digits: 0 },
  { key: 'qadv', group: 'Low levels', label: 'Moisture advection by the 850 mb wind', unit: 'g/kg per 3 h', digits: 2 },
  { key: 'tadv', group: 'Low levels', label: 'Temperature advection by the 850 mb wind', unit: '°C per 3 h', digits: 2 },
  { key: 'mslp', group: 'Surface', label: 'Sea-level pressure', unit: 'hPa', digits: 1 },
  { key: 'tair', group: 'Surface', label: 'Low-level air mass temperature', unit: '°F', digits: 1 },
  { key: 'td', group: 'Surface', label: 'Low-level dewpoint', unit: '°F', digits: 1 },
  { key: 'q', group: 'Surface', label: 'Low-level mixing ratio', unit: 'g/kg', digits: 1 },
  { key: 'ascent', group: 'Lift', label: 'Large-scale ascent (cooling of rising air)', unit: '°C/h', digits: 2 },
  { key: 'rain', group: 'Lift', label: 'Large-scale rain', unit: 'mm/h', digits: 2 },
  { key: 'shear', group: 'Kinematics', label: 'Deep-layer shear (surface to 500 mb)', unit: 'kt', digits: 0 },
  ...MAP_FIELDS
];
export const SYNOPTIC_WINDS = [
  { key: 'sfc', label: 'Surface wind' }, { key: '850', label: '850 mb wind' }, { key: '500', label: '500 mb wind' },
  { key: '250', label: '250 mb wind' }, { key: 'shear', label: 'Deep-layer shear vector' }
];

const fahrenheit = c => c * 9 / 5 + 32;
const saturationMixingRatio = (tempC, pressure) => { const e = 6.112 * Math.exp(17.67 * tempC / (tempC + 243.5)); return 622 * e / (pressure - e); };
const dewpointC = (q, pressure) => { const e = Math.max(1e-3, q * pressure / (622 + q)), l = Math.log(e / 6.112); return 243.5 * l / (17.67 - l); };

export class SynopticRuntime {
  constructor({ atmosphere }) { this.attach(atmosphere); }

  // Call again when the authority starts a new world.
  attach(atmosphere) {
    this.atmosphere = atmosphere; this.regional = atmosphere.regional; this.model = atmosphere.model ?? atmosphere.regional.model; this.seed = atmosphere.seed;
    // (the wide window is made, or taken up from a saved state, for whoever draws the large-scale charts)
    atmosphere.enableWide?.();
    this.frames = []; this.derived = new Map(); this.columns = new WeakMap();
    this.capture();
  }

  // Keeps a frame for every atmosphere step it is called on (the server calls it on its clock).
  capture() {
    const hour = this.regional.hourUtc;
    if (this.frames.at(-1)?.hour === hour) return;
    this.frames.push(this.build(hour));
    if (this.frames.length > HISTORY_FRAMES) this.frames.shift();
  }

  frame(hour) { return (hour === undefined || hour === null || hour === '' ? null : this.frames.find(f => f.hour === Number(hour))) ?? this.frames.at(-1); }

  build(hour) {
    const regional = this.regional, m = this.model, { nx, ny, d } = m, n = nx * ny, f0 = m.params.f0, p = regional.params;
    const refMid = regional.referenceMidPsi(), refLayer = regional.referenceLayerK, thicknessShare = RD * Math.log(3) / 2;
    const fields = Object.fromEntries(BASE.map(key => [key, new Float32Array(n)]));
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      // Grid point (i, j) exactly: outer() reads column floor(x / d) and row floor(y / d - 0.5).
      const k = j * nx + i, outer = regional.outer(i * d, (j + 0.5) * d);
      fields.mslp[k] = 1013 + regional.balancedPressureHpa(outer);
      const mid = f0 * (outer.midPsi - refMid), layer = outer.layerK - refLayer;
      fields.z500[k] = 5760 + mid / GRAVITY;
      fields.z250[k] = 10360 + (mid + layer * thicknessShare) / GRAVITY;
      fields.t500[k] = p.reference500C + p.temperatureShare[500] * layer;
      // The low-level air mass on open, low ground (no daytime heating), and the moisture the
      // regional layer brings in there: the Gulf's air or continental air, whichever is moister,
      // never past saturation.
      const tempC = regional.airMassTheta(outer, 0) - 273.15;
      fields.tair[k] = tempC;
      fields.q[k] = Math.min(Math.max(regional.continentalMoisture(outer, 0), regional.gulfAir(outer)), saturationMixingRatio(tempC, 1000));
      fields.ascent[k] = outer.ascentKh;
      // The lower layer's condensation (g/kg per hour) over the 1000-500 mb column (about 5.1 kg/m2 per g/kg).
      fields.rain[k] = m.rain[m.index(i, j)] * 500 * 100 / GRAVITY / 1000;
      for (const [name, pressure] of [['1000', 1000], ['850', 850], ['500', 500], ['250', 250]]) {
        const wind = regional.windAt(outer, pressure);
        fields[`u${name}`][k] = wind.u; fields[`v${name}`][k] = wind.v;
      }
    }
    // The map's own severe-weather readings, on its grid (row 0 is its northern edge).
    const world = this.atmosphere.world, mapFields = world?.forEachCell ? { nx: world.width, ny: world.height, ...Object.fromEntries(MAP_FIELDS.map(field => [field.key, new Float32Array(world.width * world.height)])) } : null;
    if (mapFields) world.forEachCell((cell, x, y) => { for (const field of MAP_FIELDS) { const v = Number(field.read(cell)); mapFields[field.key][y * world.width + x] = Number.isFinite(v) ? v : 0; } });
    // The wide window's readings on its own grid (row 0 its northern edge), once it is ready: where its western and
    // southern edges are in grid units, and its cells' size in them.
    const wide = this.atmosphere.wide;
    let wideFields = null;
    if (wideReady(wide)) {
      wideFields = { nx: wide.nx, ny: wide.ny, x: wide.origin.x / d, y: wide.origin.y / d - 0.5, cell: wide.dx / d, ...Object.fromEntries(MAP_FIELDS.map(field => [field.key, new Float32Array(wide.nx * wide.ny)])) };
      wide.world.forEachCell((cell, x, y) => { updateCellDiagnostics(cell); for (const field of MAP_FIELDS) { const v = Number(field.read(cell)); wideFields[field.key][y * wide.nx + x] = Number.isFinite(v) ? v : 0; } });
    }
    const box = this.box(), centres = this.centres(fields.mslp);
    const steering = this.atmosphere.steering?.plan ?? null;
    return {
      hour, fields, mapFields, wideFields, box, centres,
      slide: { eastKmh: (regional.slideMs ?? 0) * 3.6, northKmh: (regional.slideNorthMs ?? 0) * 3.6, plan: steering ? { kind: steering.kind, wanted: steering.wanted ?? null, missKm: steering.missKm ?? null } : null }
    };
  }

  // The map's footprint in grid units (x east from the domain's western edge, y north from its
  // southern edge; the domain wraps east-west).
  box() {
    const r = this.regional, m = this.model;
    return { x: ((r.origin.x / m.d) % m.nx + m.nx) % m.nx, y: ((r.origin.y / m.d - 0.5) % m.ny + m.ny) % m.ny, width: r.nx * r.dx / m.d, height: r.ny * r.dx / m.d };
  }

  // Highs and lows of the sea-level pressure: the extreme within radius cells, standing at
  // least 2 hPa out from the ring around it.
  centres(mslp, radius = 4) {
    const { nx, ny } = this.model, out = [];
    for (let j = radius; j < ny - radius; j++) for (let i = 0; i < nx; i++) {
      const v = mslp[j * nx + i];
      let low = true, high = true, ring = 0, count = 0;
      for (let dj = -radius; dj <= radius && (low || high); dj++) for (let di = -radius; di <= radius; di++) {
        if (!di && !dj) continue;
        const w = mslp[(j + dj) * nx + ((i + di) % nx + nx) % nx];
        if (w < v) low = false; if (w > v) high = false;
        if (Math.max(Math.abs(di), Math.abs(dj)) === radius) { ring += w; count++; }
      }
      if (!count) continue;
      const stand = v - ring / count;
      if (low && stand <= -2) out.push({ type: 'L', x: i, y: j, hpa: Math.round(v) });
      if (high && stand >= 2) out.push({ type: 'H', x: i, y: j, hpa: Math.round(v) });
    }
    return out;
  }

  // The frame's description for the page (the newest frame when none is named).
  summary(hour) {
    this.capture();
    const frame = this.frame(hour);
    return this.describe(frame, this.frames.map(f => f.hour), frame === this.frames.at(-1));
  }

  // A frame's description: one of this runtime's, or one kept elsewhere from the same model grid (a short
  // range run's, ShortRangeRuntime.js). frames: the hours the page can step through.
  describe(frame, frames, latest) {
    const m = this.model, regional = this.regional, hours = frame.hour;
    return {
      status: 'ready', seed: this.seed,
      date: calendarOn() ? dateText(hours) : null, hourUtc: ((hours % 24) + 24) % 24, localOffsetHours: regional.params.utcOffsetHours,
      frameHour: frame.hour, latest, frames,
      grid: { nx: m.nx, ny: m.ny, km: m.d / 1000, periodicX: true },
      map: { ...frame.box, km: regional.nx * regional.dx / 1000 },
      slide: frame.slide, centres: frame.centres,
      fields: SYNOPTIC_FIELDS.map(({ key, group, label, unit, map }) => ({ key, group, label, unit, ...(map ? { map: true } : {}) })), winds: SYNOPTIC_WINDS
    };
  }

  // One field of a frame kept elsewhere (not cached here).
  fieldOf(frame, key) {
    const value = this.compute(frame, key);
    return value ? { key, frameHour: frame.hour, nx: this.model.nx, ny: this.model.ny, ...value } : null;
  }

  // One scalar field ({ values }) or wind ({ u, v } in kt) of a frame, or null for an unknown name.
  field(key, hour) {
    this.capture();
    const frame = this.frame(hour), id = `${frame.hour}:${key}`;
    if (this.derived.has(id)) return this.derived.get(id);
    const value = this.compute(frame, key);
    if (!value) return null;
    const out = { key, frameHour: frame.hour, nx: this.model.nx, ny: this.model.ny, ...value };
    this.derived.set(id, out);
    if (this.derived.size > 80) this.derived.delete(this.derived.keys().next().value);
    return out;
  }

  // The large-scale model's own columns of a frame through the engine's sounding code: every second grid point
  // (the fields are smooth at 80 km; a quarter of the work), then filled in between. Worked out when first asked
  // for and kept with the frame while it lives (about 0.2 s).
  columnsOf(frame) {
    if (this.columns.has(frame)) return this.columns.get(frame);
    const f = frame.fields, { nx, ny } = this.model, p = this.regional.params, hx = nx / 2, hy = ny / 2;
    const dir = (u, v) => (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360, wind = (u, v) => ({ windDirection: dir(u, v), windSpeed: Math.hypot(u, v) * KT });
    const half = Object.fromEntries(MAP_FIELDS.map(field => [field.key, new Float32Array(hx * hy)]));
    for (let j = 0; j < hy; j++) for (let i = 0; i < hx; i++) {
      const k = (2 * j) * nx + 2 * i;
      // The ordinary troposphere over the low-level air mass: 700 and 250 mb from the layer's temperature as the
      // regional layer has them, 850 mb between the air mass and 700 mb along potential temperature.
      const anomaly = (f.t500[k] - p.reference500C) / p.temperatureShare[500], t700 = p.reference700C + p.temperatureShare[700] * anomaly;
      const theta0 = f.tair[k] + 273.15, theta700 = (t700 + 273.15) * (1000 / 700) ** KAPPA, share = Math.log(1000 / 850) / Math.log(1000 / 700);
      const cell = {
        surface: { pressure: 1000, temperature: fahrenheit(f.tair[k]), dewpoint: fahrenheit(dewpointC(f.q[k], 1000)), wind: { direction: dir(f.u1000[k], f.v1000[k]), speed: Math.hypot(f.u1000[k], f.v1000[k]) * KT } },
        levels: {
          850: { temperature: (theta0 + (theta700 - theta0) * share) * 0.85 ** KAPPA - 273.15, ...wind(f.u850[k], f.v850[k]) },
          700: { temperature: t700, ...wind((f.u850[k] + f.u500[k]) / 2, (f.v850[k] + f.v500[k]) / 2) },
          500: { temperature: f.t500[k], ...wind(f.u500[k], f.v500[k]) },
          250: { temperature: Math.max(p.tropopauseC, p.reference250C + p.temperatureShare[250] * anomaly), ...wind(f.u250[k], f.v250[k]) }
        },
        terrain: { elevationM: 0 }
      };
      const q = buildSounding(cell).params, at = j * hx + i;
      half.mapcape[at] = q.mlcape; half.mapcin[at] = Math.min(500, Math.abs(q.mlcin)); half.mapscp[at] = q.scp; half.mapstp[at] = q.stp;
    }
    const out = {};
    for (const { key } of MAP_FIELDS) {
      const from = half[key], full = out[key] = new Float32Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const x = i / 2, y = Math.min(hy - 1, j / 2), i0 = Math.floor(x), j0 = Math.min(hy - 1, Math.floor(y)), i1 = (i0 + 1) % hx, j1 = Math.min(hy - 1, j0 + 1), tx = x - i0, ty = y - j0;
        full[j * nx + i] = (from[j0 * hx + i0] * (1 - tx) + from[j0 * hx + i1] * tx) * (1 - ty) + (from[j1 * hx + i0] * (1 - tx) + from[j1 * hx + i1] * tx) * ty;
      }
    }
    this.columns.set(frame, out);
    return out;
  }

  // One severe-weather field across the whole grid: the large-scale columns, with the wide window faded in over them.
  severe(frame, key) {
    const { nx, ny } = this.model, base = this.columnsOf(frame)[key], w = frame.wideFields;
    if (!w) return base;
    const out = Float32Array.from(base), from = w[key];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      // Where the grid point is in the window, in its cells from its western and northern edges (the domain wraps east-west).
      const gx = ((((i - w.x) % nx) + nx) % nx) / w.cell, gy = (w.y + w.ny * w.cell - j) / w.cell;
      if (gx < 0 || gx > w.nx || gy < 0 || gy > w.ny) continue;
      const weight = smooth(Math.min(gx, w.nx - gx, gy, w.ny - gy) / WIDE_BLEND);
      if (!(weight > 0)) continue;
      const x = Math.max(0, Math.min(w.nx - 1, gx - 0.5)), y = Math.max(0, Math.min(w.ny - 1, gy - 0.5)), i0 = Math.min(w.nx - 2, Math.floor(x)), j0 = Math.min(w.ny - 2, Math.floor(y)), tx = x - i0, ty = y - j0;
      const value = (from[j0 * w.nx + i0] * (1 - tx) + from[j0 * w.nx + i0 + 1] * tx) * (1 - ty) + (from[(j0 + 1) * w.nx + i0] * (1 - tx) + from[(j0 + 1) * w.nx + i0 + 1] * tx) * ty;
      out[j * nx + i] = base[j * nx + i] * (1 - weight) + value * weight;
    }
    return out;
  }

  compute(frame, key) {
    const f = frame.fields, { nx, ny, d } = this.model, n = nx * ny, f0 = this.model.params.f0, beta = this.model.params.beta;
    const round = (array, digits) => { const s = 10 ** digits; return Array.from(array, v => Math.round(v * s) / s); };
    const map = fn => { const out = new Float32Array(n); for (let k = 0; k < n; k++) out[k] = fn(k); return out; };
    // Centred differences per metre (x wraps; y one-sided at the edges).
    const ddx = (a, i, j) => (a[j * nx + (i + 1) % nx] - a[j * nx + (i - 1 + nx) % nx]) / (2 * d);
    const ddy = (a, i, j) => { const n1 = Math.min(ny - 1, j + 1), s1 = Math.max(0, j - 1); return (a[n1 * nx + i] - a[s1 * nx + i]) / ((n1 - s1) * d); };
    const grid = fn => { const out = new Float32Array(n); for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out[j * nx + i] = fn(i, j); return out; };
    const advection = a => grid((i, j) => -(f.u850[j * nx + i] * ddx(a, i, j) + f.v850[j * nx + i] * ddy(a, i, j)) * 3 * 3600);
    const level = name => (name === 'sfc' ? '1000' : name);
    if (key.startsWith('wind:')) {
      const name = key.slice(5);
      if (name === 'shear') return { u: round(map(k => (f.u500[k] - f.u1000[k]) * KT), 1), v: round(map(k => (f.v500[k] - f.v1000[k]) * KT), 1) };
      if (!(name in LEVELS)) return null;
      return { u: round(map(k => f[`u${level(name)}`][k] * KT), 1), v: round(map(k => f[`v${level(name)}`][k] * KT), 1) };
    }
    const spec = SYNOPTIC_FIELDS.find(s => s.key === key);
    if (!spec) return null;
    if (spec.map) {
      const values = this.severe(frame, key), kept = frame.mapFields?.[key];
      let low = Infinity, high = -Infinity;
      for (const v of values) { if (v < low) low = v; if (v > high) high = v; }
      // (wide: whether the wide window is in it; without, the surroundings are the large-scale columns alone)
      return { label: spec.label, unit: spec.unit, min: low, max: high, values: round(values, spec.digits), wide: Boolean(frame.wideFields),
        ...(kept ? { mapValues: round(kept, spec.digits), mapGrid: { nx: frame.mapFields.nx, ny: frame.mapFields.ny } } : {}) };
    }
    const values = (() => {
      switch (key) {
        case 'z250': case 'z500': return map(k => f[key][k] / 10);
        case 'wspd250': case 'wspd500': case 'wspd850': { const l = key.slice(4); return map(k => Math.hypot(f[`u${l}`][k], f[`v${l}`][k]) * KT); }
        case 'vort500': return grid((i, j) => (ddx(f.v500, i, j) - ddy(f.u500, i, j) + f0 + beta * ((j + 0.5) * d - ny * d / 2)) * 1e5);
        case 't500': case 'mslp': case 'q': case 'ascent': case 'rain': return f[key];
        case 'tair': return map(k => fahrenheit(f.tair[k]));
        case 'td': return map(k => fahrenheit(dewpointC(f.q[k], 1000)));
        case 'qtrans': return map(k => f.q[k] * Math.hypot(f.u850[k], f.v850[k]) * KT);
        case 'qadv': return advection(f.q);
        case 'tadv': return advection(f.tair);
        case 'shear': return map(k => Math.hypot(f.u500[k] - f.u1000[k], f.v500[k] - f.v1000[k]) * KT);
        default: return null;
      }
    })();
    if (!values) return null;
    let min = Infinity, max = -Infinity;
    for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
    return { label: spec.label, unit: spec.unit, min, max, values: round(values, spec.digits) };
  }
}

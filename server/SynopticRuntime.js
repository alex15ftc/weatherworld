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

const HISTORY_FRAMES = 36;   // 18 simulated hours at one frame per atmosphere step
const GRAVITY = 9.81, RD = 287, KT = 1.943844;
// The base fields of a frame (Float32, one value per grid point).
const BASE = ['mslp', 'z500', 'z250', 't500', 'tair', 'q', 'ascent', 'rain', 'u1000', 'v1000', 'u850', 'v850', 'u500', 'v500', 'u250', 'v250'];
const LEVELS = { sfc: 1000, 850: 850, 500: 500, 250: 250 };

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
  { key: 'shear', group: 'Kinematics', label: 'Deep-layer shear (surface to 500 mb)', unit: 'kt', digits: 0 }
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
    this.frames = []; this.derived = new Map();
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
    const box = this.box(), centres = this.centres(fields.mslp);
    const steering = this.atmosphere.steering?.plan ?? null;
    return {
      hour, fields, box, centres,
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
      fields: SYNOPTIC_FIELDS.map(({ key, group, label, unit }) => ({ key, group, label, unit })), winds: SYNOPTIC_WINDS
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

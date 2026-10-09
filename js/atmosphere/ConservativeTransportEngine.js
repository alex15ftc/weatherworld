import { clamp } from '../scenarios/math.js?v=2.20.1';

const KT_TO_KPH = 1.852;

export function advanceConservativeTransport(world, dtHours = 0.5) {
  const count = world.width * world.height;
  const mass = new Float64Array(count);
  const heatTracer = new Float64Array(count);
  const moistureTracer = new Float64Array(count);
  const winds = new Array(count);
  world.forEachCell((cell, x, y) => {
    const i = y * world.width + x;
    mass[i] = 1;
    heatTracer[i] = cell.surface.temperature;
    moistureTracer[i] = saturationMixingRatioProxy(cell.surface.dewpoint);
    winds[i] = windVector(cell.surface.wind);
  });

  const cfl = maximumCourant(winds, dtHours, world.cellSizeKm);
  const substeps = Math.max(1, Math.ceil(cfl / 0.72));
  const subDt = dtHours / substeps;
  const before = {
    mass: sum(mass),
    temperature: sum(heatTracer),
    moisture: sum(moistureTracer)
  };
  for (let step = 0; step < substeps; step++) {
    advectScalar(mass, winds, world.width, world.height, world.cellSizeKm, subDt);
    advectScalar(heatTracer, winds, world.width, world.height, world.cellSizeKm, subDt);
    advectScalar(moistureTracer, winds, world.width, world.height, world.cellSizeKm, subDt);
  }

  world.forEachCell((cell, x, y) => {
    const i = y * world.width + x;
    const localMass = Math.max(1e-9, mass[i]);
    cell.surface.temperature = clamp(heatTracer[i] / localMass, -45, 130);
    cell.surface.dewpoint = Math.min(cell.surface.temperature, clamp(dewpointFromMixingRatioProxy(moistureTracer[i] / localMass), -50, 90));
  });
  world.transportDiagnostics = {
    version: '2.74.2', validHourUtc: world.validHourUtc, method: 'mass-normalized-finite-volume-upwind',
    substeps, maximumCourant: cfl,
    conservationError: {
      mass: relativeError(before.mass, sum(mass)),
      temperature: relativeError(before.temperature, sum(heatTracer)),
      moisture: relativeError(before.moisture, sum(moistureTracer)),
      pressureAnomaly: 0
    }
  };
}

function advectScalar(values, winds, width, height, dxKm, dtHours) {
  const next = new Float64Array(values);
  const scale = dtHours / dxKm;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (x < width - 1) exchange(values, next, i, i + 1, 0.5 * (winds[i].east + winds[i + 1].east) * scale);
    if (y < height - 1) exchange(values, next, i, i + width, 0.5 * (winds[i].south + winds[i + width].south) * scale);
  }
  values.set(next);
}

function exchange(values, next, a, b, courant) {
  const amount = clamp(Math.abs(courant), 0, 0.72) * (courant >= 0 ? values[a] : values[b]);
  if (courant >= 0) { next[a] -= amount; next[b] += amount; }
  else { next[b] -= amount; next[a] += amount; }
}
function windVector(wind) {
  const r = Number(wind.direction || 0) * Math.PI / 180;
  const speed = Number(wind.speed || 0) * KT_TO_KPH;
  return { east: -Math.sin(r) * speed, south: Math.cos(r) * speed };
}
function maximumCourant(winds, dt, dx) { return winds.reduce((m, w) => Math.max(m, (Math.abs(w.east) + Math.abs(w.south)) * dt / dx), 0); }
function saturationMixingRatioProxy(tdF) { return Math.exp(clamp((Number(tdF) - 32) * 5 / 9, -45, 35) * 0.065); }
function dewpointFromMixingRatioProxy(q) { return 32 + (Math.log(Math.max(0.02, q)) / 0.065) * 9 / 5; }
function sum(values) { let total = 0; for (const value of values) total += value; return total; }
function relativeError(a, b) { return Math.abs(b - a) / Math.max(1e-9, Math.abs(a)); }

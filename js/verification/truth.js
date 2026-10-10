// Severe-weather "reports" from the simulation, defined as SPC verifies outlooks: tornado
// tracks, hail >= 1 in, wind gusts >= 58 mph, with significant tiers (EF2+, 2 in, 75 mph) and
// the extreme/violent tiers used for conditional intensity groups. The same definitions serve
// the authoritative verification and the forecast ensemble members.
import { RISK_ORDER, HAZARDS, categoryFromHazard } from '../forecast/spcOutlookRules.js';

export const TRUTH_FIELDS = ['storm', 'tornado', 'tornadoSig', 'tornadoExtreme', 'tornadoViolent', 'hail', 'hailSig', 'hailExtreme', 'wind', 'windSig', 'windExtreme'];

// Appends one frame (cells where each hazard is occurring now) and records new storms.
export function captureTruth(world, frames, seenStormIds = new Set(), initiations = []) {
  const n = world.width * world.height;
  const previousHourUtc = frames.at(-1)?.hourUtc ?? Number.NEGATIVE_INFINITY;
  const frame = { hourUtc: world.validHourUtc, activeStorms: 0, tornadoes: 0, tornadoTrackPoints: [] };
  for (const field of TRUTH_FIELDS) frame[field] = new Uint8Array(n);
  const cellOf = (xKm, yKm) => clamp(Math.floor(yKm / world.cellSizeKm), 0, world.height - 1) * world.width + clamp(Math.floor(xKm / world.cellSizeKm), 0, world.width - 1);
  for (const storm of world.storms ?? []) {
    if (!storm.active) continue;
    const idx = cellOf(storm.positionKm.x, storm.positionKm.y);
    // What the storm produces now (lifetime maxima would mark its whole later track).
    const hailSize = Number(storm.currentHailSizeInches ?? storm.hazards?.hailSizeInches ?? 0);
    const gust = Number(storm.surfaceWind?.gustMph ?? 0);
    if ((Number(storm.intensity) || 0) >= 0.22) frame.storm[idx] = 1;
    const ef = maxTornadoEf(storm);
    for (const point of collectTornadoTruthPoints(storm, previousHourUtc, world.validHourUtc)) {
      const t = cellOf(point.x, point.y);
      frame.tornado[t] = 1;
      if (ef >= 2) frame.tornadoSig[t] = 1;
      if (ef >= 3) frame.tornadoExtreme[t] = 1;
      if (ef >= 4) frame.tornadoViolent[t] = 1;
      frame.tornadoTrackPoints.push({ stormId: storm.id, xKm: point.x, yKm: point.y, hourUtc: point.hourUtc, ef });
    }
    if (hailSize >= 1) frame.hail[idx] = 1;
    if (hailSize >= 2) frame.hailSig[idx] = 1;
    if (hailSize >= 3.5) frame.hailExtreme[idx] = 1;
    // A line produces its wind along its whole length (strongest near the middle, where it
    // bows); a single cell at its position.
    for (const { index, share } of windFootprint(world, storm, idx, cellOf)) {
      const local = gust * share;
      if (LINEAR_MODES.includes(storm.mode) && (Number(storm.intensity) || 0) >= 0.22) frame.storm[index] = 1;
      if (local >= 58) frame.wind[index] = 1;
      if (local >= 75) frame.windSig[index] = 1;
      if (local >= 100) frame.windExtreme[index] = 1;
    }
    frame.activeStorms++;
    if (storm.tornado?.onGround) frame.tornadoes++;
    if (!seenStormIds.has(storm.id)) {
      seenStormIds.add(storm.id);
      initiations.push({ stormId: storm.id, hourUtc: storm.createdHourUtc, x: idx % world.width, y: Math.floor(idx / world.width), mode: storm.mode });
    }
  }
  frames.push(frame);
  return frame;
}

const LINEAR_MODES = ['broken line', 'linear segment', 'QLCS with embedded supercells', 'QLCS', 'MCS'];
const LINE_END_GUST_SHARE = 0.8;

// Cells along a line's axis (perpendicular to its motion), with the share of the peak gust.
function windFootprint(world, storm, centreIndex, cellOf) {
  const half = LINEAR_MODES.includes(storm.mode) ? Number(storm.lineHalfLengthKm ?? storm.radar?.radiusXKm) || 0 : 0;
  const speed = Math.hypot(storm.velocityKph?.east ?? 0, storm.velocityKph?.north ?? 0);
  if (half < world.cellSizeKm || !(speed > 1)) return [{ index: centreIndex, share: 1 }];
  // Screen frame: y grows southward, so north motion is -y.
  const ax = (storm.velocityKph.north) / speed, ay = (storm.velocityKph.east) / speed;
  const out = new Map();
  for (let d = -half; d <= half + 1e-6; d += world.cellSizeKm / 2) {
    const index = cellOf(storm.positionKm.x + ax * d, storm.positionKm.y + ay * d);
    const share = 1 - (1 - LINE_END_GUST_SHARE) * Math.abs(d) / half;
    if (!(out.get(index) >= share)) out.set(index, share);
  }
  return [...out].map(([index, share]) => ({ index, share }));
}

export function maxTornadoEf(storm) {
  const ratings = [storm.hazardExtremes?.tornado?.maxEfRating, storm.tornado?.efRating, ...(storm.tornadoHistory ?? []).map(t => t.efRating ?? t.maxEfRating)];
  return ratings.reduce((best, value) => {
    const match = String(value ?? '').match(/EF([0-5])/i);
    return match ? Math.max(best, Number(match[1])) : best;
  }, -1);
}

// Tornado track points laid down in (previousHourUtc, currentHourUtc].
export function collectTornadoTruthPoints(storm, previousHourUtc, currentHourUtc) {
  const epsilon = 1e-6, points = [], seen = new Set();
  const addPoint = point => {
    const x = Number(point?.x), y = Number(point?.y), hourUtc = Number(point?.hourUtc);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (Number.isFinite(hourUtc) && (hourUtc <= previousHourUtc + epsilon || hourUtc > currentHourUtc + epsilon)) return;
    const key = `${x.toFixed(4)}|${y.toFixed(4)}|${Number.isFinite(hourUtc) ? hourUtc.toFixed(4) : 'current'}`;
    if (seen.has(key)) return;
    seen.add(key);
    points.push({ x, y, hourUtc: Number.isFinite(hourUtc) ? hourUtc : currentHourUtc });
  };
  for (const point of storm.tornado?.trackPoints ?? []) addPoint(point);
  for (const tornado of storm.tornadoHistory ?? []) for (const point of tornado.trackPoints ?? []) addPoint(point);
  // An on-ground tornado can exist before its first stored track point.
  if (storm.tornado?.onGround && !points.length) addPoint({ ...storm.tornado.positionKm, hourUtc: currentHourUtc });
  return points;
}

// Combines frames over a valid period: exact report cells, the 25-mi neighbourhoods, SPC
// "practically perfect" observed probabilities and the observed category.
export function aggregateTruth(frames, initiations, width, height, radius, cellMiles) {
  const n = width * height;
  const result = { width, height, cellMiles, initiation: new Uint8Array(n), risk: Array(n).fill('NONE'), observedProbability: {}, observedCig: {} };
  for (const field of TRUTH_FIELDS) { result[field] = new Uint8Array(n); result[`${field}Exact`] = new Uint8Array(n); }
  const offsets = diskOffsets(radius);
  for (const frame of frames) for (const field of TRUTH_FIELDS) {
    const src = frame[field], exact = result[`${field}Exact`], near = result[field];
    for (let i = 0; i < n; i++) if (src[i]) { exact[i] = 1; spread(near, i, width, height, offsets); }
  }
  for (const r of initiations) spread(result.initiation, clamp(Number(r.y) || 0, 0, height - 1) * width + clamp(Number(r.x) || 0, 0, width - 1), width, height, offsets);
  const cellKm = cellMiles * 1.609344;
  result.observedProbability = {
    tornado: practicallyPerfectProbability(result.tornadoExact, width, height, cellKm, [2, 5, 10, 15, 30, 45, 60]),
    hail: practicallyPerfectProbability(result.hailExact, width, height, cellKm, [5, 15, 30, 45, 60]),
    wind: practicallyPerfectProbability(result.windExact, width, height, cellKm, [5, 15, 30, 45, 60, 75, 90])
  };
  result.observedCig = {
    tornado: observedCig(result.tornadoSig, result.tornadoExtreme, result.tornadoViolent, 3),
    hail: observedCig(result.hailSig, result.hailExtreme, null, 2),
    wind: observedCig(result.windSig, result.windExtreme, null, 3)
  };
  for (let i = 0; i < n; i++) {
    const severe = HAZARDS.filter(h => result.observedProbability[h][i] > 0).map(h => categoryFromHazard(h, result.observedProbability[h][i], result.observedCig[h][i]));
    result.risk[i] = severe.length ? severe.reduce((a, b) => (RISK_ORDER.indexOf(b) > RISK_ORDER.indexOf(a) ? b : a)) : result.storm[i] ? 'TSTM' : 'NONE';
  }
  return result;
}

// SPC's practically perfect forecast: reports on an 80 km grid, Gaussian-smoothed (sigma 120 km).
const PP_GRID_KM = 80, PP_SIGMA_KM = 120;
export function practicallyPerfectProbability(exact, width, height, cellKm, levels) {
  const box = Math.max(1, Math.round(PP_GRID_KM / cellKm));
  const boxes = new Map();
  for (let i = 0; i < exact.length; i++) if (exact[i]) {
    const bx = Math.floor((i % width) / box), by = Math.floor(Math.floor(i / width) / box);
    boxes.set(`${bx},${by}`, { x: (bx + 0.5) * box * cellKm, y: (by + 0.5) * box * cellKm });
  }
  const out = new Uint8Array(exact.length);
  if (!boxes.size) return out;
  const weight = (PP_GRID_KM * PP_GRID_KM) / (2 * Math.PI * PP_SIGMA_KM * PP_SIGMA_KM);
  const centers = [...boxes.values()];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = (x + 0.5) * cellKm, py = (y + 0.5) * cellKm;
    let p = 0;
    for (const c of centers) p += weight * Math.exp(-((px - c.x) ** 2 + (py - c.y) ** 2) / (2 * PP_SIGMA_KM * PP_SIGMA_KM));
    const pct = 100 * Math.min(1, p);
    let level = 0;
    for (const value of levels) if (pct >= value) level = value;
    out[y * width + x] = level;
  }
  return out;
}

function observedCig(sig, extreme, violent, maximum) {
  const out = new Uint8Array(sig.length);
  for (let i = 0; i < out.length; i++) {
    if (sig[i]) out[i] = 1;
    if (extreme?.[i]) out[i] = Math.min(maximum, 2);
    if (violent?.[i]) out[i] = Math.min(maximum, 3);
  }
  return out;
}

export function diskOffsets(radius) {
  const offsets = [], span = Math.ceil(radius);
  for (let dy = -span; dy <= span; dy++) for (let dx = -span; dx <= span; dx++) if (Math.hypot(dx, dy) <= radius + 1e-9) offsets.push([dx, dy]);
  return offsets;
}

function spread(target, index, width, height, offsets) {
  const x = index % width, y = (index - x) / width;
  for (const [dx, dy] of offsets) {
    const xx = x + dx, yy = y + dy;
    if (xx >= 0 && xx < width && yy >= 0 && yy < height) target[yy * width + xx] = 1;
  }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Severe-weather "reports" from the simulation, defined as SPC verifies outlooks: tornado
// tracks, hail >= 1 in, wind gusts >= 58 mph, with significant tiers (EF2+, 2 in, 75 mph) and
// the extreme/violent tiers used for conditional intensity groups. The same definitions serve
// the authoritative verification and the forecast ensemble members.
import { RISK_ORDER, HAZARDS, categoryFromHazard } from '../forecast/spcOutlookRules.js';
import { worldCategory, contourCig, CIG_TIERS } from '../forecast/worldRiskCategories.js';
import { logStormTick } from '../reports/stormLog.js';

export const TRUTH_FIELDS = ['storm', 'tornado', 'tornadoSig', 'tornadoExtreme', 'tornadoViolent', 'hail', 'hailSig', 'hailExtreme', 'wind', 'windSig', 'windExtreme', 'windViolent'];
// The fields whose chance within 25 miles is worked out unrounded (result.chance): each hazard
// and the tiers its intensity groups are defined by (EF2+, EF3+, EF4+; 2 in, 3.5 in hail;
// 75, 85, 96 mph wind, which are the SPC's 65, 74 and 83 kt).
export const CHANCE_FIELDS = ['tornado', 'tornadoSig', 'tornadoExtreme', 'tornadoViolent', 'hail', 'hailSig', 'hailExtreme', 'wind', 'windSig', 'windExtreme', 'windViolent'];

// Appends one frame (cells where each hazard is occurring now) and records new storms.
// places ({ layer, milesPerKm }, server/CountyLayer.js placesFor): with them, hail and wind are
// taken from the reports the storm log makes (js/reports/stormLog.js), as the Storm Prediction
// Center verifies with reports: a cell has hail or wind where a report came in, at the size or
// gust reported there, not wherever a storm's core passed. Tornadoes are their tracks either way,
// as surveyed. (2026-10-23: until then hail and wind were the storm's own core size and peak gust
// in its cell, so hail of 2 in or more made half the hail areas' cells where it makes perhaps
// 10-15% of real reports, and hail alone made three quarters of the Moderate days.)
export function captureTruth(world, frames, seenStormIds = new Set(), initiations = [], places = null) {
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
    // Each tornado's track is rated by that tornado alone: a storm that cycles may put down a
    // weak one after a strong one, and the weak one's track is not the strong one's.
    for (const point of collectTornadoTruthPoints(storm, previousHourUtc, world.validHourUtc)) {
      const t = cellOf(point.x, point.y), ef = point.ef;
      frame.tornado[t] = 1;
      if (ef >= 2) frame.tornadoSig[t] = 1;
      if (ef >= 3) frame.tornadoExtreme[t] = 1;
      if (ef >= 4) frame.tornadoViolent[t] = 1;
      frame.tornadoTrackPoints.push({ stormId: storm.id, tornado: point.tornado, cell: t, xKm: point.x, yKm: point.y, hourUtc: point.hourUtc, ef });
    }
    if (!places) {
      if (hailSize >= 1) frame.hail[idx] = 1;
      if (hailSize >= 2) frame.hailSig[idx] = 1;
      if (hailSize >= 3.5) frame.hailExtreme[idx] = 1;
    }
    // A line produces its wind along its whole length (strongest near the middle, where it
    // bows); a single cell at its position. Its thunderstorm covers every cell along it, but
    // its wind is reported once for each stretch of WIND_REPORT_SPACING_KM, as reports of a
    // real line come in: one cell for every cell would make each line a wide swath of reports.
    for (const { index, share, report } of windFootprint(world, storm, idx, cellOf)) {
      const local = gust * share;
      if (isLine(storm) && (Number(storm.intensity) || 0) >= 0.22) frame.storm[index] = 1;
      if (!report || places) continue;
      if (local >= 58) frame.wind[index] = 1;
      if (local >= 75) frame.windSig[index] = 1;
      if (local >= 85) frame.windExtreme[index] = 1;
      if (local >= 96) frame.windViolent[index] = 1;
    }
    frame.activeStorms++;
    if (storm.tornado?.onGround) frame.tornadoes++;
    if (!seenStormIds.has(storm.id)) {
      seenStormIds.add(storm.id);
      initiations.push({ stormId: storm.id, hourUtc: storm.createdHourUtc, x: idx % world.width, y: Math.floor(idx / world.width), mode: storm.mode });
    }
  }
  if (places) reportedHazards(world, frames, frame, places, cellOf);
  frames.push(frame);
  return frame;
}

// The hail and wind reports that came in since the last frame (the storm log run on this world),
// put into the frame's cells by what was reported. Reports the world already held when the
// frames began (a forecast run starts from the live world's log) are not new.
function reportedHazards(world, frames, frame, places, cellOf) {
  const all = () => Object.values(world.reportLog?.days ?? {}).flatMap(day => day.reports);
  frames.reportsSeen ??= new Set(all());
  logStormTick(world, places);
  const k = places.milesPerKm || 0.621371;
  for (const report of all()) {
    if (frames.reportsSeen.has(report)) continue;
    frames.reportsSeen.add(report);
    const i = cellOf(report.x / k, report.y / k);
    if (report.type === 'hail') {
      const inches = (Number(report.size) || 0) / 100;
      if (inches >= 1) frame.hail[i] = 1;
      if (inches >= 2) frame.hailSig[i] = 1;
      if (inches >= 3.5) frame.hailExtreme[i] = 1;
    } else if (report.type === 'wind') {
      const mph = Number(report.speed ?? report.estimatedMph) || 0;
      if (mph >= 58) frame.wind[i] = 1;
      if (mph >= 75) frame.windSig[i] = 1;
      if (mph >= 85) frame.windExtreme[i] = 1;
      if (mph >= 96) frame.windViolent[i] = 1;
    }
  }
}

const LINEAR_MODES = ['broken line', 'linear segment', 'QLCS with embedded supercells', 'QLCS', 'MCS'];
const LINE_END_GUST_SHARE = 0.8;
// One wind report along a line for each stretch this long (25 miles), at each capture.
const WIND_REPORT_SPACING_KM = 40;
// A storm is part of a line by its line organization (the name is a fallback for old records).
const isLine = storm => Number.isFinite(storm.lineOrganization) ? storm.lineOrganization >= 0.5 : LINEAR_MODES.includes(storm.mode);

// Cells along a line's axis (perpendicular to its motion), with the share of the peak gust;
// report: whether the cell takes a wind report (the middle, and every WIND_REPORT_SPACING_KM
// out from it).
function windFootprint(world, storm, centreIndex, cellOf) {
  const half = isLine(storm) ? Number(storm.lineHalfLengthKm ?? storm.radar?.radiusXKm) || 0 : 0;
  const speed = Math.hypot(storm.velocityKph?.east ?? 0, storm.velocityKph?.north ?? 0);
  if (half < world.cellSizeKm || !(speed > 1)) return [{ index: centreIndex, share: 1, report: true }];
  // Screen frame: y grows southward, so north motion is -y.
  const ax = (storm.velocityKph.north) / speed, ay = (storm.velocityKph.east) / speed;
  const out = new Map(), at = d => cellOf(storm.positionKm.x + ax * d, storm.positionKm.y + ay * d), shareAt = d => 1 - (1 - LINE_END_GUST_SHARE) * Math.abs(d) / half;
  for (let d = -half; d <= half + 1e-6; d += world.cellSizeKm / 2) { const index = at(d), known = out.get(index); out.set(index, { share: Math.max(shareAt(d), known?.share ?? 0), report: false }); }
  for (let d = -Math.floor(half / WIND_REPORT_SPACING_KM) * WIND_REPORT_SPACING_KM; d <= half + 1e-6; d += WIND_REPORT_SPACING_KM) { const index = at(d); out.set(index, { share: Math.max(shareAt(d), out.get(index)?.share ?? 0), report: true }); }
  return [...out].map(([index, { share, report }]) => ({ index, share, report }));
}

export function maxTornadoEf(storm) {
  const ratings = [storm.hazardExtremes?.tornado?.maxEfRating, storm.tornado?.efRating, ...(storm.tornadoHistory ?? []).map(t => t.efRating ?? t.maxEfRating)];
  return ratings.reduce((best, value) => {
    const match = String(value ?? '').match(/EF([0-5])/i);
    return match ? Math.max(best, Number(match[1])) : best;
  }, -1);
}

const efNumber = rating => { const match = String(rating ?? '').match(/EF([0-5])/i); return match ? Number(match[1]) : -1; };

// Tornado track points laid down in (previousHourUtc, currentHourUtc], each with the damage
// rating so far of the tornado that laid it down (ef: 0-5, -1 if none yet), as the Storm
// Prediction Center verifies its outlooks (the surveys' ratings). (The user's choice, 2026-10-23;
// from 2026-10-21 the tornado's peak wind was taken, which runs 1-1.5 categories above the
// ratings: on 40 days High verified on 23% of them against 13% by ratings, EF4+ hatching on 20%
// against none, and two High days had no tornado rated EF2. docs/FIX-PLAN-2026-10-22.md.)
export function collectTornadoTruthPoints(storm, previousHourUtc, currentHourUtc) {
  const epsilon = 1e-6, points = [], seen = new Set();
  let ef = -1, key = null;
  const addPoint = point => {
    const x = Number(point?.x), y = Number(point?.y), hourUtc = Number(point?.hourUtc);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (Number.isFinite(hourUtc) && (hourUtc <= previousHourUtc + epsilon || hourUtc > currentHourUtc + epsilon)) return;
    // (Its own key for repeats: the tornado's key, below, names the tornado. 2026-10-24: this one was
    // also called key and hid it, so every point was its own tornado and a track was not rated as a whole.)
    const pointKey = `${x.toFixed(4)}|${y.toFixed(4)}|${Number.isFinite(hourUtc) ? hourUtc.toFixed(4) : 'current'}`;
    if (seen.has(pointKey)) return;
    seen.add(pointKey);
    points.push({ x, y, hourUtc: Number.isFinite(hourUtc) ? hourUtc : currentHourUtc, ef, tornado: key });
  };
  const current = () => { ef = efNumber(storm.tornado?.estimatedEf ?? storm.tornado?.efRating ?? storm.tornado?.windEf); key = `${storm.id}|${storm.tornado?.cycleCount ?? 0}`; };
  current();
  for (const point of storm.tornado?.trackPoints ?? []) addPoint(point);
  for (const tornado of storm.tornadoHistory ?? []) { ef = efNumber(tornado.estimatedEf ?? tornado.efRating ?? tornado.maxEfRating ?? tornado.windEf); key = `${storm.id}|${tornado.cycle ?? 0}`; for (const point of tornado.trackPoints ?? []) addPoint(point); }
  current();
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
  // A tornado is rated as a whole, by the strongest it got: the parts of its track laid down
  // before it strengthened take the same rating as the rest.
  const strongest = new Map();
  for (const frame of frames) for (const p of frame.tornadoTrackPoints ?? []) if (p.tornado) strongest.set(p.tornado, Math.max(strongest.get(p.tornado) ?? -1, p.ef ?? -1));
  for (const frame of frames) for (const p of frame.tornadoTrackPoints ?? []) {
    const ef = strongest.get(p.tornado) ?? p.ef ?? -1;
    if (p.cell === undefined) continue;
    if (ef >= 2 && frame.tornadoSig) frame.tornadoSig[p.cell] = 1;
    if (ef >= 3 && frame.tornadoExtreme) frame.tornadoExtreme[p.cell] = 1;
    if (ef >= 4 && frame.tornadoViolent) frame.tornadoViolent[p.cell] = 1;
  }
  for (const frame of frames) for (const field of TRUTH_FIELDS) {
    if (!frame[field]) continue;
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
  // The same chances unrounded (percent within 25 miles), for each hazard and each intensity tier.
  result.chance = Object.fromEntries(CHANCE_FIELDS.map(field => [field, practicallyPerfectChance(result[`${field}Exact`], width, height, cellKm)]));
  // Conditional intensity groups: for each area inside a contour, the highest tier that a
  // large enough share of the reports in it reached (worldRiskCategories.js).
  result.observedCig = Object.fromEntries(HAZARDS.map(h => [h, contourCig(h, result.chance[h], result[`${h}Exact`], CIG_TIERS[h].map(field => result[`${field}Exact`]), width, height)]));
  // The category at each point (the Storm Prediction Center's tables). `risk` is the same
  // thing from the older code path and is kept for the reports that read it.
  result.worldRisk = Array(n);
  for (let i = 0; i < n; i++) result.worldRisk[i] = worldCategory(Object.fromEntries(HAZARDS.map(h => [h, { percent: result.observedProbability[h][i], cig: result.observedCig[h][i] }])), { thunder: Boolean(result.storm[i]) });
  for (let i = 0; i < n; i++) {
    const severe = HAZARDS.filter(h => result.observedProbability[h][i] > 0).map(h => categoryFromHazard(h, result.observedProbability[h][i], result.observedCig[h][i]));
    result.risk[i] = severe.length ? severe.reduce((a, b) => (RISK_ORDER.indexOf(b) > RISK_ORDER.indexOf(a) ? b : a)) : result.storm[i] ? 'TSTM' : 'NONE';
  }
  return result;
}

// SPC's practically perfect forecast: reports on an 80 km grid, Gaussian-smoothed (sigma 120 km).
const PP_GRID_KM = 80, PP_SIGMA_KM = 120;
// The chance (percent, 0-100) of a report within radiusMiles of each cell, from one day's
// reports: the share of the country round about (the practically perfect chance's own 120 km
// Gaussian) that had a report within that radius. At 25 miles it is close to the practically
// perfect chance itself; a smaller radius counts less of the country as hit, so it is lower.
export function neighbourhoodChance(exact, width, height, cellKm, radiusMiles) {
  const n = width * height, radiusCells = radiusMiles * 1.609344 / cellKm, near = new Float32Array(n), offsets = diskOffsets(Math.max(0.5, radiusCells));
  for (let i = 0; i < n; i++) if (exact[i]) { const x = i % width, y = (i - x) / width; for (const [dx, dy] of offsets) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < width && Y < height) near[Y * width + X] = 1; } }
  const sigma = PP_SIGMA_KM / cellKm, reach = Math.max(1, Math.ceil(3 * sigma)), kernel = Array.from({ length: 2 * reach + 1 }, (_, k) => Math.exp(-((k - reach) ** 2) / (2 * sigma * sigma)));
  const total = kernel.reduce((p, q) => p + q, 0), pass = (field, stride, count, lines) => {
    const out = new Float32Array(n);
    for (let line = 0; line < lines; line++) for (let k = 0; k < count; k++) { let sum = 0; for (let d = -reach; d <= reach; d++) { const j = k + d; if (j >= 0 && j < count) sum += kernel[d + reach] * field[stride === 1 ? line * width + j : j * width + line]; } out[stride === 1 ? line * width + k : k * width + line] = sum / total; }
    return out;
  };
  const smooth = pass(pass(near, 1, width, height), width, height, width);
  for (let i = 0; i < n; i++) smooth[i] = 100 * Math.min(1, smooth[i]);
  return smooth;
}

// The same chance unrounded (percent, 0-100) at every cell.
export function practicallyPerfectChance(exact, width, height, cellKm) {
  const box = Math.max(1, Math.round(PP_GRID_KM / cellKm)), boxes = new Map(), out = new Float32Array(exact.length);
  for (let i = 0; i < exact.length; i++) if (exact[i]) {
    const bx = Math.floor((i % width) / box), by = Math.floor(Math.floor(i / width) / box);
    boxes.set(`${bx},${by}`, { x: (bx + 0.5) * box * cellKm, y: (by + 0.5) * box * cellKm });
  }
  if (!boxes.size) return out;
  const weight = (PP_GRID_KM * PP_GRID_KM) / (2 * Math.PI * PP_SIGMA_KM * PP_SIGMA_KM), centers = [...boxes.values()];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = (x + 0.5) * cellKm, py = (y + 0.5) * cellKm;
    let p = 0;
    for (const c of centers) p += weight * Math.exp(-((px - c.x) ** 2 + (py - c.y) ** 2) / (2 * PP_SIGMA_KM * PP_SIGMA_KM));
    out[y * width + x] = 100 * Math.min(1, p);
  }
  return out;
}

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

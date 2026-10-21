// A damage survey of one tornado, as the National Weather Service's Damage Assessment Toolkit
// (DAT) holds one: the track's centreline, the damage swath's EF contours (where its wind
// reached each EF threshold), and damage points: each a damage indicator (what was hit) with
// its degree of damage and the wind estimated from it. The tornado is rated from its damage,
// as a survey rates it: the highest wind any damage point supports, and EFU (unknown) where it
// met nothing the scale can rate.
//
// The wind across the track comes from the tornado's own wind and width at each step (the
// storm log, stormLog.js): inside its core the full wind, outside it falling off as a
// tornado's does (as the distance to the power PROFILE.decay) to 65 mph at the edge of its
// width. What it meets comes from the map: towns (their core and extent), the land cover
// (forest, range, farmland), schools and industrial parks; each spot of ground on a 0.05-mile
// grid holds a structure or not by its own fixed draw, so two tornadoes over the same town
// meet the same houses.
import { DAMAGE_INDICATORS, EF_THRESHOLDS, damageAt, efFromWind } from './damageIndicators.js';

export const PROFILE = Object.freeze({ decay: 0.6, stepMi: 0.05, gridMi: 0.05, maxPoints: 400 });
// Structures per 0.05-mile spot of ground (1.6 acres), and what they are.
const GROUND = Object.freeze({
  townCore: { chance: 0.55, mix: [['FR12', 0.62], ['MBS', 0.1], ['MHSW', 0.06], ['MHDW', 0.06], ['TH', 0.16]] },
  townEdge: { chance: 0.3, mix: [['FR12', 0.7], ['MHSW', 0.08], ['MHDW', 0.07], ['TH', 0.15]] },
  forest: { chance: 0.6, mix: [['TH', 0.65], ['TS', 0.35]] },
  cedars: { chance: 0.25, mix: [['TS', 1]] },
  // A farmstead about every 600 acres (one a section): a house or a manufactured home, its
  // outbuildings and its shelter belt.
  farm: { chance: 0.0027, mix: [['FR12', 0.8], ['MHSW', 0.2]], with: ['SBO', 'SBO', 'TH'] },
  // The share of section lines carrying a distribution line.
  lines: 0.5,
  // Field-edge and creek trees.
  open: { chance: 0.02, mix: [['TH', 0.7], ['TS', 0.3]] }
});

const MPH_PER_KPH = 0.621371;

// entry: a tornado from the storm log; map: the survey's map (server/SurveyMap.js), or null;
// places: { layer, milesPerKm } as the warnings use (the counties, for names).
export function surveyTornado(entry, map, places, seed = 1) {
  const k = places?.milesPerKm ?? MPH_PER_KPH;
  const raw = lifeTrack(entry.points.map(([x, y, hourUtc, windMph, widthYards]) => ({ x: x * k, y: y * k, hourUtc, windMph: Math.max(65, windMph || 65), widthYards: Math.max(20, widthYards || 20) })), entry);
  const samples = densify(raw);
  const centreline = samples.map(s => [round(s.x), round(s.y)]);
  const contours = EF_THRESHOLDS.map((threshold, ef) => ({ ef, polygons: contourPolygons(samples, threshold) })).filter(c => c.polygons.length);
  const points = map ? damagePoints(samples, map, seed) : [];
  // The rating's damage point: the highest estimated wind, a building over a tree at the same wind
  // (a survey cites the damage that tells most).
  const isTree = p => p.di === 'TH' || p.di === 'TS';
  const peak = points.reduce((best, p) => (!best || p.estimatedMph > best.estimatedMph || (p.estimatedMph === best.estimatedMph && isTree(best) && !isTree(p)) ? p : best), null);
  const lengthMi = samples.reduce((a, s, i) => (i ? a + Math.hypot(s.x - samples[i - 1].x, s.y - samples[i - 1].y) : 0), 0);
  const counties = [...new Set(samples.map(s => places?.layer?.at?.(s.x, s.y)).filter(i => i >= 0))].map(i => places.layer.counties[i]);
  const reach = Math.max(...raw.map(p => p.widthYards)) / 1760 / 2 + 0.5;
  const towns = (places?.layer?.towns ?? []).filter(t => samples.some(s => Math.hypot(s.x - t.x, s.y - t.y) <= reach)).map(t => t.name);
  const byIndicator = {};
  for (const p of points) { const b = byIndicator[p.di] ??= { di: p.di, name: DAMAGE_INDICATORS[p.di].name, count: 0, maxEf: -1 }; b.count++; b.maxEf = Math.max(b.maxEf, p.ef); }
  return {
    id: entry.id, stormId: entry.stormId, day: entry.day,
    startHourUtc: raw[0]?.hourUtc ?? null, endHourUtc: entry.ended ? raw.at(-1)?.hourUtc ?? null : null, ongoing: !entry.ended,
    durationMinutes: raw.length ? Math.round((raw.at(-1).hourUtc - raw[0].hourUtc) * 60 * 10) / 10 : 0, endedBy: entry.endedBy ?? null,
    rating: peak ? `EF${peak.ef}` : 'EFU', peakWindMph: peak?.estimatedMph ?? null, peakPoint: peak,
    lengthMi: round(lengthMi, 2), maxWidthYards: Math.round(Math.max(...raw.map(p => p.widthYards))),
    start: centreline[0] ?? null, end: centreline.at(-1) ?? null,
    startPlace: centreline.length ? placeName(places?.layer, ...centreline[0]) : null, endPlace: centreline.length ? placeName(places?.layer, ...centreline.at(-1)) : null,
    counties: counties.map(c => c.name).filter(Boolean), offices: [...new Set(counties.map(c => c.office).filter(Boolean))], towns,
    centreline, contours, points, indicators: Object.values(byIndicator).sort((a, b) => b.count - a.count)
  };
}

// The track as the tornado lived it. The log has its position, wind and width at each 5-minute
// storm step; a tornado whose vortex ran out (endedBy 'vortex spent') ended within its last step,
// at its drawn life, so its path stops there. Its damage path starts and ends where its wind
// crosses the damage threshold (65 mph), narrow: it builds from touchdown to the wind of the
// step it was seen at and falls away to its end. (The strongest step is kept for a tornado
// shorter than two steps.)
function lifeTrack(points, entry) {
  if (points.length < 2) return points;
  let pts = points;
  const strongest = pts.slice(1).reduce((a, p) => (p.windMph > a.windMph ? p : a), pts[1]);
  const start = pts[0].hourUtc, end = entry.ended && entry.endedBy === 'vortex spent' && entry.lifeMinutes > 0 ? start + entry.lifeMinutes / 60 : null;
  if (end != null && end < pts.at(-1).hourUtc - 1e-6) {
    const i = pts.findIndex(p => p.hourUtc >= end), a = pts[i - 1], b = pts[i], f = (end - a.hourUtc) / Math.max(1e-9, b.hourUtc - a.hourUtc);
    pts = [...pts.slice(0, i), { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, hourUtc: end, windMph: b.windMph, widthYards: b.widthYards }];
  }
  if (pts.length < 3) {
    const [a, b] = pts;
    pts = [a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, hourUtc: (a.hourUtc + b.hourUtc) / 2, windMph: strongest.windMph, widthYards: strongest.widthYards }, b];
  }
  const edge = p => ({ ...p, windMph: 66, widthYards: Math.min(p.widthYards, 25) });
  if (entry.ended) return [edge(pts[0]), ...pts.slice(1, -1), edge(pts.at(-1))];
  return [edge(pts[0]), ...pts.slice(1)];
}

// The track at every PROFILE.stepMi, its wind and width taken along between the logged points,
// its course a smooth curve through them (Catmull-Rom).
function densify(raw) {
  if (raw.length === 1) return [{ ...raw[0], dx: 1, dy: 0 }];
  const out = [];
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1], b = raw[i], d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(d / PROFILE.stepMi));
    for (let s = i === 1 ? 0 : 1; s <= n; s++) {
      const f = s / n;
      const p0 = raw[Math.max(0, i - 2)], p3 = raw[Math.min(raw.length - 1, i + 1)];
      out.push({ x: spline(p0.x, a.x, b.x, p3.x, f), y: spline(p0.y, a.y, b.y, p3.y, f), hourUtc: a.hourUtc + (b.hourUtc - a.hourUtc) * f, windMph: a.windMph + (b.windMph - a.windMph) * f, widthYards: a.widthYards + (b.widthYards - a.widthYards) * f });
    }
  }
  // Each sample's direction of travel (for the swath's sides).
  for (let i = 0; i < out.length; i++) {
    const p = out[Math.max(0, i - 1)], q = out[Math.min(out.length - 1, i + 1)], d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    out[i].dx = (q.x - p.x) / d || (i ? out[i - 1].dx : 1); out[i].dy = (q.y - p.y) / d || (i ? out[i - 1].dy : 0);
  }
  return out;
}

const spline = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);

// Half the width (miles) over which a sample's wind is at least `mph`, or 0.
function halfWidthAt(s, mph) {
  if (s.windMph < mph) return 0;
  const edge = s.widthYards / 1760 / 2, core = edge * Math.pow(65 / s.windMph, 1 / PROFILE.decay);
  return Math.min(edge, core * Math.pow(s.windMph / mph, 1 / PROFILE.decay));
}
// The wind at a distance (miles) from the centreline.
function windAt(s, r) {
  const edge = s.widthYards / 1760 / 2, core = edge * Math.pow(65 / s.windMph, 1 / PROFILE.decay);
  return r <= core ? s.windMph : s.windMph * Math.pow(core / r, PROFILE.decay);
}

// The contour for one EF threshold: a polygon for each stretch of track where the wind reached
// it (left side forward, right side back).
function contourPolygons(samples, mph) {
  const polygons = [];
  let run = [];
  const close = () => {
    if (!run.length) return;
    const left = run.map(({ s, h }) => [round(s.x - s.dy * h), round(s.y + s.dx * h)]), right = run.map(({ s, h }) => [round(s.x + s.dy * h), round(s.y - s.dx * h)]).reverse();
    // A stretch of one sample: a short swath along its direction.
    if (run.length === 1) { const { s, h } = run[0], e = Math.max(h, 0.02); polygons.push([[s.x - s.dx * e - s.dy * h, s.y - s.dy * e + s.dx * h], [s.x + s.dx * e - s.dy * h, s.y + s.dy * e + s.dx * h], [s.x + s.dx * e + s.dy * h, s.y + s.dy * e - s.dx * h], [s.x - s.dx * e + s.dy * h, s.y - s.dy * e - s.dx * h]].map(([x, y]) => [round(x), round(y)])); }
    else polygons.push([...left, ...right]);
    run = [];
  };
  for (const s of samples) { const h = halfWidthAt(s, mph); if (h > 0) run.push({ s, h }); else close(); }
  close();
  return polygons;
}

// The damage points: every spot of ground the swath crossed (winds of 65 mph or more) that
// holds a structure or trees, with the damage the wind there did to it.
function damagePoints(samples, map, seed) {
  const g = PROFILE.gridMi, spots = new Map();
  for (const s of samples) {
    const h = halfWidthAt(s, 65);
    for (let r = -h; r <= h + 1e-9; r += g / 2) {
      const x = s.x + s.dy * r, y = s.y - s.dx * r, key = `${Math.floor(x / g)},${Math.floor(y / g)}`;
      const wind = windAt(s, Math.abs(r)), known = spots.get(key);
      if (!known || wind > known.wind) spots.set(key, { wind, hourUtc: s.hourUtc, key });
    }
  }
  const points = [];
  for (const { wind, hourUtc, key } of spots.values()) {
    const [i, j] = key.split(',').map(Number), x = (i + 0.5) * g, y = (j + 0.5) * g;
    for (const di of structuresAt(map, x, y, key, seed)) {
      const quality = deterministicUnit(`${seed}|dat|${key}|${di.slot}|q`);
      const damage = damageAt(di.di, wind, quality);
      if (damage) points.push({ di: di.di, x: round(x + di.dx), y: round(y + di.dy), hourUtc: round(hourUtc, 3), ...damage, windMph: Math.round(wind) });
    }
  }
  // The strongest damage is always kept; the rest thinned to PROFILE.maxPoints (trees first),
  // as a survey records the points that tell the story rather than every tree.
  points.sort((a, b) => b.estimatedMph - a.estimatedMph);
  if (points.length <= PROFILE.maxPoints) return points;
  const buildings = points.filter(p => p.di !== 'TH' && p.di !== 'TS'), trees = points.filter(p => p.di === 'TH' || p.di === 'TS');
  const keep = buildings.slice(0, PROFILE.maxPoints), room = PROFILE.maxPoints - keep.length;
  const step = trees.length / Math.max(1, room);
  for (let n = 0; n < room && n * step < trees.length; n++) keep.push(trees[Math.floor(n * step)]);
  return keep.sort((a, b) => b.estimatedMph - a.estimatedMph);
}

// What stands at one spot of ground (x, y miles), drawn once for the spot.
function structuresAt(map, x, y, key, seed) {
  const out = [], draw = name => deterministicUnit(`${seed}|dat|${key}|${name}`);
  const pick = mix => { let u = draw('type'); for (const [di, share] of mix) { if ((u -= share) <= 0) return di; } return mix.at(-1)[0]; };
  const place = (di, slot) => out.push({ di, slot, dx: (draw(`${slot}x`) - 0.5) * PROFILE.gridMi, dy: (draw(`${slot}y`) - 0.5) * PROFILE.gridMi });
  if (map.schoolAt?.(x, y)) place('ES', 'school');
  // Distribution lines along the section lines (every mile), on about half of them.
  const g = PROFILE.gridMi, nearX = Math.abs(x - Math.round(x)) < g / 2, nearY = Math.abs(y - Math.round(y)) < g / 2;
  const line = name => deterministicUnit(`${seed}|line|${name}`);
  if ((nearX && line(`x${Math.round(x)}`) < GROUND.lines) || (nearY && line(`y${Math.round(y)}`) < GROUND.lines)) if (map.groundAt(x, y)) place('ETL', 'pole');
  if (map.industrialAt?.(x, y)) { if (draw('mbs') < 0.5) place('MBS', 'industry'); return out; }
  const name = map.groundAt(x, y), ground = GROUND[name];
  if (!ground) return out;
  if (draw('here') < ground.chance) { place(pick(ground.mix), 'main'); (ground.with ?? []).forEach((di, n) => place(di, `with${n}`)); }
  else if (name === 'farm' && draw('trees') < GROUND.open.chance) place(pick(GROUND.open.mix), 'tree');
  return out;
}

// "3 NE Smith Falls": where a point (miles) is from the nearest town.
const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function placeName(layer, x, y) {
  let town = null, miles = Infinity;
  for (const t of layer?.towns ?? []) { const d = Math.hypot(t.x - x, t.y - y); if (d < miles) { miles = d; town = t; } }
  if (!town) return null;
  const deg = Math.atan2(x - town.x, -(y - town.y)) * 180 / Math.PI, bearing = POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
  return Math.round(miles) < 1 ? town.name : `${Math.round(miles)} ${bearing} ${town.name}`;
}

// A fixed draw in [0, 1) for a name (FNV-1a, mixed).
function deterministicUnit(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const round = (v, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;
export { efFromWind };

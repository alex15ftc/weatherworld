// Fronts and drylines found from the fields (stage 3 of docs/ATMOSPHERE-REDESIGN.md). Nothing
// here knows what the weather pattern is supposed to be: a front is where the air-mass
// temperature changes fastest, a dryline where the moisture does, and the kind of front
// follows from which way the line moves. Each line is followed from one analysis to the next,
// as an analyst keeps continuity: it keeps its id, its motion is averaged over a couple of hours,
// and it is kept down to a lower contrast than a new line needs. Only the drawing: storms read
// the fields, never these lines.
//
// Method (the standard objective one): smooth the field, take the size of its gradient, keep
// the crest lines of that gradient (points where it is larger than on either side along the
// gradient's own direction), join them into lines, and place a front on the warm edge of its
// zone of contrast, which is where analysts draw it.
import { clamp } from '../scenarios/math.js';

export const BOUNDARY_DEFAULTS = Object.freeze({
  smoothingPasses: 2,
  // Smallest contrast that counts, per 100 km: air-mass temperature (K) and moisture (g/kg).
  // (4 and 200 km until 2026-10-16: with the air masses' contrasts at real strength, the weaker
  // zones those let through gave 3.7 lines a map, most of them short; analysts draw one or two.)
  frontGradient: 5, drylineGradient: 5,
  minLengthKm: 200, frontMinLengthKm: 250,
  // An outflow boundary is the edge of storm-cooled air at least this much colder (K) than
  // its air mass; such lines are shorter than fronts.
  // ...and only where the storm-cooled air makes up at least outflowShare of the contrast across
  // the line (its deficit on the cold side less that on the warm side, against the whole
  // temperature difference). 2026-10-19: until then any front with 1.5 K of rain-cooled air
  // behind it was drawn as an outflow boundary, a 43 F cold front among them.
  outflowDeficitK: 2, outflowMinLengthKm: 120, outflowShare: 0.5,
  // Next to storm-cooled air (a cold pool at least outflowDeficitK cold within two cells) an edge
  // counts from this weaker contrast (K per 100 km): analysts follow an outflow boundary as a
  // wind shift long after its contrast has fallen below a front's (2026-10-16: with the front's 5,
  // outflow boundaries lasted 1.5 hours, a twentieth of them 6 hours or more).
  outflowGradient: 2.5,
  // Cold air advancing or retreating slower than this (m/s) makes the front stationary.
  stationarySpeedMs: 2,
  // Continuity, as analysts keep it from one map to the next (2026-10-16): where the last analysis
  // had a front within continuityKm, it keeps its kind until the cold air's push has passed the
  // threshold by typeHysteresisMs the other way (a cold front turns stationary below -0.5 m/s, a
  // stationary one cold or warm beyond 4.5). Without it 8% of front points changed kind every half
  // hour; 5% with it (2.5; 1.5 gave 7% once the kind came from the line's own motion, which is
  // noisier). Only the drawing: storms read the fields, not the lines.
  typeHysteresisMs: 2.5, continuityKm: 48,
  // The kind of a front follows how the line itself moves since the last analysis (toward the warm
  // air: cold; toward the cold air: warm), as analysts type them; the cold air's push (the wind on
  // its cold side) is used only for a line with nothing before it. (2026-10-17: typed by the push
  // alone, a third of the moving cold-front points went the way a warm front goes, and one in six
  // had its symbols on the cold side.) Smoothed over motionSmoothPoints either side along the line.
  motionSmoothPoints: 4,
  // One front to a frontal zone: a crest must be the strongest gradient within this many cells
  // either side across it (2026-10-17: with only its neighbours, broad zones gave two parallel
  // fronts about 90 km apart in 14% of analyses; 11% with 5 cells, 8% with 7).
  frontSeparationCells: 7,
  // A dryline has its moist air to the east or to the side, not to the west (the cosine of the
  // angle between the way to the moist air and east is at least this): dry air off the high
  // ground meeting the Gulf's, where it bends round into an east-west moisture edge too.
  // (0.5 until 2026-10-22: the bend where storms started was not drawn at all.)
  drylineMoistEastCos: -0.2,
  // A temperature contrast whose cool side is the moist side of a sharp moisture change is the
  // dryline's (moist air cooler than the hot dry air beside it), not a front, where the moist air
  // lies to the east within this cosine. Elsewhere, cool moist air beside warmer air is a front:
  // the cool side of a warm front near a low. (Until 2026-10-22 every such edge was taken for a
  // dryline, and no warm front was drawn even beside a 983 hPa low.)
  drylineVetoEastCos: 0.5,
  // Continuity (2026-10-22): a line that lies along one in the last analysis (at least half of
  // either line within matchKm of the other: a line that grows or shrinks is still itself) is
  // that line: it keeps its id, and its kind follows its motion averaged over about motionHours. A
  // line followed this way is drawn down to keepShare of the contrast (and length) a new one needs. (Before,
  // kinds came from each half hour's motion, which the grid makes noisy by 4-9 m/s, and lines
  // came and went as their contrast hovered at the threshold: one moisture edge was cold, then
  // stationary, then a dryline, then warm in 7 hours.)
  matchKm: 60, motionHours: 2, keepShare: 0.7,
  // A front must show at the ground as analysts read it there (2026-10-24): across it, the air's
  // potential temperature as it now is changes by thetaK, or its moisture by moistureGkg, or its wind by
  // windMs, along at least share of the front. The air mass the front is found in leaves out the day's
  // heating, which can even it out: three "warm fronts" were drawn in uniform 80-90 F air with no
  // dewpoint or wind change (docs/METEOROLOGIST-REVIEW-2026-10-24.md).
  groundShows: { thetaK: 2, moistureGkg: 2, windMs: 8, share: 0.5 },
  // How far into the cold air its wind is read (cells), and how far a moisture line must be
  // from a front, and how much colder its dry side may be, to count as a dryline.
  coldSideReachCells: 2, drylineFrontClearanceCells: 3, drylineColdSideLimitK: 2
});

const MS_PER_KT = 0.514444;

// Reads the fields the analysis needs from the cells. Rows count southward, so "y" grows to
// the south here and in the returned points, like every other map product.
function readFields(world) {
  const { width, height } = world, n = width * height;
  const temperature = new Float64Array(n), moisture = new Float64Array(n), u = new Float64Array(n), v = new Float64Array(n), coldPool = new Float64Array(n), ground = new Float64Array(n);
  world.forEachCell((cell, x, y) => {
    const k = y * width + x, surface = cell.surface;
    // Potential temperature of the air mass where the state carries it (no day-night swing, no
    // terrain in it), else of the air at the ground.
    const airMassK = Number(cell.features?.airMassThetaK);
    coldPool[k] = Number(cell.features?.coldPoolK) || 0;
    ground[k] = ((surface.temperature - 32) * 5 / 9 + 273.15) * (1000 / (surface.pressure || 1000)) ** 0.2857;
    temperature[k] = Number.isFinite(airMassK) && airMassK > 0 ? airMassK : ground[k];
    const dewpointC = (surface.dewpoint - 32) * 5 / 9, vapour = 6.112 * Math.exp(17.67 * dewpointC / (dewpointC + 243.5));
    moisture[k] = 622 * vapour / Math.max(100, (surface.pressure || 1000) - vapour);
    const speed = (Number(surface.wind?.speed) || 0) * MS_PER_KT, direction = (Number(surface.wind?.direction) || 0) * Math.PI / 180;
    u[k] = -Math.sin(direction) * speed; v[k] = Math.cos(direction) * speed;   // v positive toward the south (down the rows)
  });
  return { temperature, moisture, u, v, coldPool, ground };
}

function smooth(values, width, height, passes) {
  let source = values;
  for (let pass = 0; pass < passes; pass++) {
    const out = new Float64Array(source.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0, count = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) { sum += source[yy * width + xx]; count++; }
      out[y * width + x] = sum / count;
    }
    source = out;
  }
  return source;
}

function bilinear(field, width, height, x, y) {
  const cx = clamp(x, 0, width - 1), cy = clamp(y, 0, height - 1), x0 = Math.min(width - 2, Math.floor(cx)), y0 = Math.min(height - 2, Math.floor(cy)), tx = cx - x0, ty = cy - y0;
  return (field[y0 * width + x0] * (1 - tx) + field[y0 * width + x0 + 1] * tx) * (1 - ty) + (field[(y0 + 1) * width + x0] * (1 - tx) + field[(y0 + 1) * width + x0 + 1] * tx) * ty;
}

// Gradient of a field per 100 km: components and size.
function gradient(field, width, height, cellKm) {
  const gx = new Float64Array(field.length), gy = new Float64Array(field.length), size = new Float64Array(field.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const e = Math.min(width - 1, x + 1), w = Math.max(0, x - 1), s = Math.min(height - 1, y + 1), nn = Math.max(0, y - 1), k = y * width + x;
    gx[k] = (field[y * width + e] - field[y * width + w]) / ((e - w) * cellKm) * 100;
    gy[k] = (field[s * width + x] - field[nn * width + x]) / ((s - nn) * cellKm) * 100;
    size[k] = Math.hypot(gx[k], gy[k]);
  }
  return { gx, gy, size };
}

// Cells on a crest of the gradient: at least the threshold (one value, or one for each cell), and
// no smaller than the gradient `reach` cells either way along its own direction.
function crestCells(grad, width, height, threshold, edge, reach = 1) {
  const least = typeof threshold === 'number' ? () => threshold : k => threshold[k];
  const crest = new Uint8Array(grad.size.length);
  // The outermost cells are left out: air entering the map there has not met the map's own air
  // yet. That is every cell the smoothing and the gradient carry the edge cells' values into.
  for (let y = edge; y < height - edge; y++) for (let x = edge; x < width - edge; x++) {
    const k = y * width + x, g = grad.size[k];
    if (g < least(k)) continue;
    const nx = grad.gx[k] / g, ny = grad.gy[k] / g;
    let top = true;
    for (let r = 1; r <= reach && top; r++) if (g < bilinear(grad.size, width, height, x + nx * r, y + ny * r) || g < bilinear(grad.size, width, height, x - nx * r, y - ny * r)) top = false;
    if (top) crest[k] = 1;
  }
  return crest;
}

// Joins crest cells into lines: the longest path through each connected group, repeated on
// what is left so branches become their own lines when they are long enough.
function linkLines(crest, width, height, minCells) {
  const remaining = Uint8Array.from(crest), lines = [];
  const neighbours = k => { const x = k % width, y = (k - x) / width, out = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if ((dx || dy) && xx >= 0 && yy >= 0 && xx < width && yy < height && remaining[yy * width + xx]) out.push(yy * width + xx); } return out; };
  const farthest = start => { const parent = new Map([[start, -1]]); let queue = [start], last = start; while (queue.length) { const next = []; for (const k of queue) { last = k; for (const m of neighbours(k)) if (!parent.has(m)) { parent.set(m, k); next.push(m); } } queue = next; } return { last, parent }; };
  for (let k = 0; k < remaining.length; k++) {
    while (remaining[k]) {
      const end = farthest(k).last, { last, parent } = farthest(end), path = [];
      for (let at = last; at !== -1; at = parent.get(at)) path.push(at);
      if (path.length >= minCells) lines.push(path);
      // Take the path and the crest cells touching it out, so a thick crest gives one line.
      for (const cell of path) { for (const m of neighbours(cell)) remaining[m] = 0; remaining[cell] = 0; }
      if (path.length < minCells) for (const cell of parent.keys()) remaining[cell] = 0;
    }
  }
  return lines;
}

const smoothLine = points => points.map((p, i) => { const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)]; return i === 0 || i === points.length - 1 ? p : { ...p, x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 }; });
const lengthKm = (points, cellKm) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0) * cellKm;

// Returns { boundaries, fields } for the world's current state. Each boundary:
//   { id, type: 'cold' | 'warm' | 'stationary' | 'dryline' | 'outflow', symbolSide, pointsKm: [{ x, y }], lengthKm,
//     contrast (K or g/kg per 100 km), advanceMs (cold or dry air moving toward the warm, moist side),
//     motionMs (each point's motion toward the warm or moist side, averaged in time) }
// options: previous (the last analysis's boundaries) and previousHours (how long ago it was).
// The kind of front for the cold air's push across it (m/s, toward the warm air), given the kind
// the last analysis had there (or null).
function frontKind(advance, previous, p) {
  const s = p.stationarySpeedMs, h = previous ? p.typeHysteresisMs : 0;
  if (previous === 'cold' && advance > s - h) return 'cold';
  if (previous === 'warm' && advance < -(s - h)) return 'warm';
  const reach = previous === 'stationary' ? s + h : s;
  return advance > reach ? 'cold' : advance < -reach ? 'warm' : 'stationary';
}

export function analyseBoundaries(world, options = {}) {
  const p = { ...BOUNDARY_DEFAULTS, ...options }, { width, height } = world, cellKm = world.cellSizeKm, n = width * height;
  const raw = readFields(world);
  const temperature = smooth(raw.temperature, width, height, p.smoothingPasses), moisture = smooth(raw.moisture, width, height, p.smoothingPasses);
  const u = smooth(raw.u, width, height, 1), v = smooth(raw.v, width, height, 1);
  const thermal = gradient(temperature, width, height, cellKm), moist = gradient(moisture, width, height, cellKm);
  const minCells = Math.max(3, Math.round(p.minLengthKm / cellKm / 1.2)), frontCells = Math.max(3, Math.round((p.frontMinLengthKm ?? p.minLengthKm) / cellKm / 1.2)), edge = p.smoothingPasses + 2;
  const outflowCells = Math.max(3, Math.round(p.outflowMinLengthKm / cellKm / 1.2)), shortestFront = Math.min(frontCells, outflowCells);
  const toKm = point => ({ x: Math.round((point.x + 0.5) * cellKm * 10) / 10, y: Math.round((point.y + 0.5) * cellKm * 10) / 10 });
  const hours = Number(options.previousHours) || 0, blend = hours > 0 ? 1 - Math.exp(-hours / p.motionHours) : 1;

  // --- The last analysis's lines (cell coordinates), for continuity.
  const familyOf = type => (type === 'dryline' || type === 'outflow' ? type : 'front');
  const previous = (options.previous ?? []).filter(b => (b.pointsKm?.length ?? 0) > 1).map(b => ({
    id: b.id, type: b.type, family: familyOf(b.type),
    points: b.pointsKm.map((q, i) => ({ x: q.x / cellKm - 0.5, y: q.y / cellKm - 0.5, type: b.type, motion: Number.isFinite(b.motionMs?.[i]) ? b.motionMs[i] : null }))
  }));
  // How much a line and a previous line lie along each other: the larger share of either's points
  // within matchKm of the other (0-1). The previous line (of the given families) a line is, if any.
  const within = (a, b) => { const reach = (p.matchKm / cellKm) ** 2; let count = 0; for (const q of a) { for (const r of b) if ((q.x - r.x) ** 2 + (q.y - r.y) ** 2 <= reach) { count++; break; } } return count / Math.max(1, a.length); };
  const overlap = (points, line) => Math.max(within(points, line.points), within(line.points, points));
  const matchOf = (points, families) => {
    let best = null;
    for (const line of previous) if (families.includes(line.family)) { const o = overlap(points, line); if (o >= 0.5 && (!best || o > best.o)) best = { line, o }; }
    return best?.line ?? null;
  };
  const nearestIn = (line, point) => { let best = null, reach = (p.continuityKm / cellKm) ** 2; for (const q of line?.points ?? []) { const d = (q.x - point.x) ** 2 + (q.y - point.y) ** 2; if (d <= reach) { reach = d; best = q; } } return best; };
  // The contrast each cell needs: less near a line of the family the last analysis had there.
  const thresholdNear = (family, full) => {
    const out = new Float64Array(n).fill(full), reach = Math.ceil(p.continuityKm / cellKm);
    for (const line of previous) if (line.family === family || (family === 'front' && line.family === 'outflow')) for (const q of line.points) {
      const cx = Math.round(q.x), cy = Math.round(q.y);
      for (let y = Math.max(0, cy - reach); y <= Math.min(height - 1, cy + reach); y++) for (let x = Math.max(0, cx - reach); x <= Math.min(width - 1, cx + reach); x++) out[y * width + x] = full * p.keepShare;
    }
    return out;
  };
  const dilate = (mask, cells) => {
    const out = new Uint8Array(n);
    for (let k = 0; k < n; k++) if (mask[k]) { const x = k % width, y = (k - x) / width; for (let yy = Math.max(0, y - cells); yy <= Math.min(height - 1, y + cells); yy++) for (let xx = Math.max(0, x - cells); xx <= Math.min(width - 1, x + cells); xx++) out[yy * width + xx] = 1; }
    return out;
  };
  const boundaries = [];

  // --- Fronts.
  const frontThreshold = thresholdNear('front', p.frontGradient);
  const local = crestCells(thermal, width, height, frontThreshold, edge);
  {
    // Next to storm-cooled air an edge counts from a weaker contrast (an outflow boundary).
    const weak = crestCells(thermal, width, height, p.outflowGradient ?? p.frontGradient, edge);
    for (let k = 0; k < n; k++) if (weak[k] && !local[k]) {
      const x = k % width, y = (k - x) / width;
      near: for (let yy = Math.max(0, y - 2); yy <= Math.min(height - 1, y + 2); yy++) for (let xx = Math.max(0, x - 2); xx <= Math.min(width - 1, x + 2); xx++) if (raw.coldPool[yy * width + xx] >= p.outflowDeficitK) { local[k] = 1; break near; }
    }
  }
  // Moist air east of a dryline is usually cooler than the hot dry air west of it.
  // That contrast, along a sharp moisture change with the moist air to the east, is the dryline's;
  // but where the last analysis had a front, it is that front still (a cold front overtaking the
  // dryline is drawn as the cold front).
  const besideFront = thresholdNear('front', 1);
  for (let k = 0; k < n; k++) {
    if (!local[k] || besideFront[k] < 1) continue;
    const x = k % width, y = (k - x) / width;
    search: for (let yy = Math.max(0, y - 2); yy <= Math.min(height - 1, y + 2); yy++) for (let xx = Math.max(0, x - 2); xx <= Math.min(width - 1, x + 2); xx++) {
      const m = yy * width + xx, g = moist.size[m];
      if (g >= p.drylineGradient && moist.gx[m] * thermal.gx[k] + moist.gy[m] * thermal.gy[k] < 0 && moist.gx[m] / g >= p.drylineVetoEastCos) { local[k] = 0; break search; }
    }
  }
  // One front to a frontal zone: the strongest crest across it, but only crests that are drawn
  // keep the others away (a stronger crest that is a dryline's, or too short to draw, does not).
  const strong = crestCells(thermal, width, height, frontThreshold, edge, p.frontSeparationCells ?? 1);
  for (let k = 0; k < n; k++) strong[k] = strong[k] && local[k] ? 1 : 0;
  const drawn = new Uint8Array(n);
  for (const line of linkLines(strong, width, height, shortestFront)) for (const k of line) drawn[k] = 1;
  const shadow = dilate(drawn, p.frontSeparationCells ?? 1), frontCrest = new Uint8Array(n);
  for (let k = 0; k < n; k++) frontCrest[k] = drawn[k] || (local[k] && !shadow[k]) ? 1 : 0;
  const frontLineCells = new Uint8Array(n);
  for (const line of linkLines(frontCrest, width, height, shortestFront)) {
    for (const k of line) frontLineCells[k] = 1;
    const points = line.map(k => {
      const x = k % width, y = (k - x) / width, g = thermal.size[k], nx = thermal.gx[k] / g, ny = thermal.gy[k] / g;   // (nx, ny) points at the warm air
      // The front lies on the warm edge of the zone: walk toward the warm air until the
      // contrast has fallen to half its crest value.
      let reach = 0; while (reach < 6 && bilinear(thermal.size, width, height, x + nx * (reach + 0.5), y + ny * (reach + 0.5)) > 0.5 * g) reach += 0.5;
      const coldX = x - nx * p.coldSideReachCells, coldY = y - ny * p.coldSideReachCells;
      const warmX = x + nx * (reach + p.coldSideReachCells), warmY = y + ny * (reach + p.coldSideReachCells);
      const poolCold = bilinear(raw.coldPool, width, height, coldX, coldY), poolWarm = bilinear(raw.coldPool, width, height, warmX, warmY);
      const across = Math.max(0.5, bilinear(temperature, width, height, warmX, warmY) - bilinear(temperature, width, height, coldX, coldY));
      const outflow = poolCold >= p.outflowDeficitK && (poolCold - poolWarm) >= p.outflowShare * across;
      // What the front shows at the ground across it: the air's temperature as it is now, its moisture, its wind.
      const gs = p.groundShows, at = (field, gx, gy) => bilinear(field, width, height, gx, gy);
      const shows = at(raw.ground, warmX, warmY) - at(raw.ground, coldX, coldY) >= gs.thetaK || Math.abs(at(raw.moisture, warmX, warmY) - at(raw.moisture, coldX, coldY)) >= gs.moistureGkg
        || Math.hypot(at(u, warmX, warmY) - at(u, coldX, coldY), at(v, warmX, warmY) - at(v, coldX, coldY)) >= gs.windMs;
      return { x: clamp(x + nx * reach, 0, width - 1), y: clamp(y + ny * reach, 0, height - 1), nx, ny, contrast: g, moistContrast: moist.size[k], outflow, shows: shows ? 1 : 0, advance: bilinear(u, width, height, coldX, coldY) * nx + bilinear(v, width, height, coldX, coldY) * ny };
    });
    // The line it was in the last analysis (of any kind: a dryline that gains a temperature
    // contrast after dark is still that dryline).
    const was = matchOf(points, ['front', 'outflow']) ?? matchOf(points, ['dryline']), wasFront = was && was.family !== 'dryline' ? was : null;
    // How the line moves toward the warm air (m/s), point by point, from where that line was; with
    // nothing before it, how the cold air pushes. Smoothed along the line, then averaged in time.
    const moved = points.map(q => { if (!(hours > 0) || !wasFront) return null; const r = nearestIn(wasFront, q); return r ? ((q.x - r.x) * q.nx + (q.y - r.y) * q.ny) * cellKm * 1000 / (hours * 3600) : null; });
    const reach = moved.some(m => m !== null) ? p.motionSmoothPoints : 2;
    const own = points.map((q, i) => moved[i] ?? (moved.some(m => m !== null) ? null : q.advance));
    const along = points.map((_, i) => { let sum = 0, count = 0; for (let j = Math.max(0, i - reach); j <= Math.min(points.length - 1, i + reach); j++) if (own[j] !== null) { sum += own[j]; count++; } return count ? sum / count : points[i].advance; });
    points.forEach((q, i) => { const r = nearestIn(wasFront, q); q.motion = Number.isFinite(r?.motion) ? r.motion + (along[i] - r.motion) * blend : along[i]; q.before = r && r.type !== 'outflow' ? r.type : null; });
    // The edge of storm-cooled air is an outflow boundary whichever way it is moving (where the
    // storm-cooled air is most of the contrast; see outflowShare).
    const kind = points.map(q => (q.outflow ? 'outflow' : frontKind(q.motion, q.before, p)));
    const half = Math.max(2, Math.floor(shortestFront / 2));
    for (let i = 0; i < kind.length;) {   // short runs take the kind of the run before them
      let j = i; while (j < kind.length && kind[j] === kind[i]) j++;
      if (j - i < half && i > 0) for (let m = i; m < j; m++) kind[m] = kind[i - 1];
      i = j;
    }
    for (let i = 0; i < kind.length;) {
      let j = i; while (j < kind.length && kind[j] === kind[i]) j++;
      const part = smoothLine(points.slice(Math.max(0, i - 1), j));
      // (A front followed from the last analysis is kept down to keepShare of a new one's length
      // too: one weakening as it overtook the dryline broke into pieces just short of it.)
      if (part.length >= (kind[i] === 'outflow' ? half : Math.max(half, Math.floor(frontCells / 2))) && (kind[i] === 'outflow' || line.length >= (wasFront ? Math.ceil(p.keepShare * frontCells) : frontCells))) {
        // A line that was a dryline stays one while its moisture change is still a dryline's and
        // its dry air is not pushing on as a cold front's does (a dryline drifting back after dark
        // gains a temperature contrast; a cold front overtaking the dryline is the cold front).
        const mean = key => part.reduce((sum, q) => sum + q[key], 0) / part.length;
        // A front is drawn only where it shows at the ground along at least groundShows.share of it.
        if (kind[i] !== 'outflow' && mean('shows') < p.groundShows.share) { i = j; continue; }
        const stillDryline = was?.family === 'dryline' && kind[i] !== 'outflow' && mean('moistContrast') >= p.drylineGradient * p.keepShare && mean('motion') <= p.stationarySpeedMs;
        boundaries.push({ type: stillDryline ? 'dryline' : kind[i], points: part });
      }
      i = j;
    }
  }

  // --- Drylines: sharp moisture lines that are not the moisture change of a front. Its dry
  // side is as warm as the moist side or warmer, its moist air is not to the west, and no drawn
  // front runs along it.
  const nearFront = dilate(frontLineCells, p.drylineFrontClearanceCells);
  const dryCrest = crestCells(moist, width, height, thresholdNear('dryline', p.drylineGradient), edge);
  for (let k = 0; k < n; k++) {
    if (!dryCrest[k]) continue;
    const x = k % width, y = (k - x) / width, g = moist.size[k], nx = moist.gx[k] / g, ny = moist.gy[k] / g;   // points at the moist air
    const drySideColder = bilinear(temperature, width, height, x + 2 * nx, y + 2 * ny) - bilinear(temperature, width, height, x - 2 * nx, y - 2 * ny);
    if (nearFront[k] || drySideColder > p.drylineColdSideLimitK || nx < p.drylineMoistEastCos) dryCrest[k] = 0;
  }
  for (const line of linkLines(dryCrest, width, height, minCells)) {
    const points = smoothLine(line.map(k => {
      const x = k % width, y = (k - x) / width, g = moist.size[k], nx = moist.gx[k] / g, ny = moist.gy[k] / g, dryX = x - nx * p.coldSideReachCells, dryY = y - ny * p.coldSideReachCells;
      return { x, y, nx, ny, contrast: g, advance: bilinear(u, width, height, dryX, dryY) * nx + bilinear(v, width, height, dryX, dryY) * ny };
    }));
    points.forEach(q => { q.motion = q.advance; });
    boundaries.push({ type: 'dryline', points });
  }

  // --- Ids: each line keeps the id of the line it was in the last analysis (the one it lies along
  // most, a line of its own family first, each given once); a new line gets the next number.
  let next = 1 + previous.reduce((most, line) => Math.max(most, Number(/(\d+)$/.exec(String(line.id ?? ''))?.[1]) || 0), 0);
  const pairs = [];
  boundaries.forEach((b, i) => previous.forEach((line, j) => { const o = overlap(b.points, line); if (o >= 0.5) pairs.push({ i, j, o: o + (familyOf(b.type) === line.family ? 1 : 0) }); }));
  pairs.sort((a, b) => b.o - a.o);
  const ids = new Array(boundaries.length).fill(null), taken = new Set();
  for (const { i, j } of pairs) if (ids[i] === null && !taken.has(j)) { ids[i] = previous[j].id; taken.add(j); }

  return {
    boundaries: boundaries.map(({ type, points }, i) => {
      const mean = key => points.reduce((sum, q) => sum + q[key], 0) / points.length;
      // Which side of the line (left of its drawing direction = +1) its symbols go on: the side
      // a cold front or the dry air is heading for, the cold side of a warm front.
      let left = 0;
      for (let j = 1; j < points.length; j++) { const a = points[j - 1], b = points[j]; left += (b.y - a.y) * (a.nx + b.nx) - (b.x - a.x) * (a.ny + b.ny); }
      const symbolSide = (left >= 0 ? 1 : -1) * (type === 'warm' ? -1 : 1);
      return {
        id: ids[i] ?? `line-${next++}`, type, symbolSide, pointsKm: points.map(toKm), lengthKm: Math.round(lengthKm(points, cellKm)), contrast: Math.round(mean('contrast') * 10) / 10, advanceMs: Math.round(mean('advance') * 10) / 10,
        // How fast each point has been moving toward the warm (or moist) air, averaged in time (m/s).
        motionMs: points.map(q => Math.round((q.motion ?? q.advance) * 10) / 10),
        widthKm: 30, active: true, diagnosed: true
      };
    }),
    fields: { temperature, moisture, thermalGradient: thermal.size, moistureGradient: moist.size }
  };
}

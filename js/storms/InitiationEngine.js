// Convective initiation from parcel physics. A storm can form where the lift available at a
// point can carry a parcel through its convective inhibition (CIN) to a level of free
// convection with meaningful CAPE behind it:
//   - Surface-based storms use the mixed-layer parcel. Lift comes from boundary convergence
//     (fronts, dryline, outflow gust fronts), synoptic-scale ascent, terrain, and afternoon
//     boundary-layer thermals.
//   - Elevated storms use the most-unstable parcel above a stable surface layer, lifted by
//     synoptic ascent and frontal overrunning (warm advection on the nocturnal low-level jet).
// The chance of an updraft forming grows with how far the lift exceeds the CIN and with the
// CAPE. Existing storms suppress new updrafts close by (compensating subsidence, stabilised
// outflow air) while their gust fronts can trigger new cells along the outflow edge, so
// storms cluster where forcing is strong and stay isolated where it is weak.
import { clamp } from '../scenarios/math.js';

// CIN (J/kg) that each forcing source can overcome at full strength.
const LIFT_ENERGY_J_KG = { boundary: 170, synoptic: 60, terrain: 90, outflow: 150, thermals: 30 };
const MIN_CAPE_J_KG = 300;
const UNFOCUSED_BOUNDARY_LIFT = 0.4;
// Initiation rate per cell and hour where the lift exceeds the inhibition by NET_LIFT_SCALE.
// The rate rises steeply with the surplus: a strongly forced, uncapped front fires along its
// length within an hour or two, a capped dryline releases a few storms, and broad weak ascent
// only the occasional one.
const FORCED_RATE_PER_HOUR = 0.03;
const NET_LIFT_SCALE_J_KG = 100;
const SUPPRESSION_RADIUS_KM = 40;        // compensating subsidence around an updraft
const SUPPRESSION_STRENGTH = 0.92;
// Forced ascent along a strong boundary overcomes the subsidence between updrafts, so cells
// there form closer together (and can grow into lines).
const BOUNDARY_SPACING_REDUCTION = 0.75;
const GUST_FRONT_WIDTH_KM = 14;
const MAX_ACTIVE_STORMS = 70;     // computational limit, not a meteorological one

export function findInitiationCandidates(world, existingStorms, hourUtc, dtHours = 0.5) {
  const active = existingStorms.filter(storm => storm.active !== false);
  if (active.length >= MAX_ACTIVE_STORMS) return [];
  const localHour = (((Number(hourUtc) - 6) % 24) + 24) % 24;
  const thermals = localHour > 10 && localHour < 19.5 ? Math.sin(Math.PI * (localHour - 10) / 9.5) : 0;
  const seed = world.evolution?.config?.seed ?? 'seed';
  const outflows = (world.stormOutflows ?? []).filter(o => o.active !== false && (o.strength ?? 0) > 0.1);
  const candidates = [];

  for (let y = 1; y < world.height - 1; y++) {
    for (let x = 1; x < world.width - 1; x++) {
      const cell = world.getCell(x, y);
      const sounding = cell.derived?.sounding;
      if (!sounding) continue;
      const xKm = (x + nextUnit(seed, hourUtc, x, y, 'x')) * world.cellSizeKm;
      const yKm = (y + nextUnit(seed, hourUtc, x, y, 'y')) * world.cellSizeKm;

      // Synoptic-scale ascent: 500 mb height falls ahead of the troughs and shortwaves.
      const synoptic = clamp(Number(cell.features?.synopticAscent) || 0, 0, 1);
      // A boundary lifts hardest where the upper wave crosses it and where boundaries meet
      // (triple point); elsewhere along its length the circulation is shallower.
      const meeting = Object.values(cell.features?.synopticBoundaryInfluences ?? {}).filter(b => b.influence > 0.3).length >= 2;
      const focus = clamp(synoptic + (meeting ? 0.5 : 0), 0, 1);
      const boundary = clamp(Math.max(Number(cell.features?.boundaryConvergence) || 0, (Number(cell.features?.explicitBoundaryInfluence) || 0) * (UNFOCUSED_BOUNDARY_LIFT + (1 - UNFOCUSED_BOUNDARY_LIFT) * focus)), 0, 1);
      const terrain = clamp((Number(cell.dynamics?.terrainLiftMs) || 0) / 0.05, 0, 1);
      const outflow = gustFrontLift(outflows, xKm, yKm);
      const surfaceLift = LIFT_ENERGY_J_KG.boundary * boundary + LIFT_ENERGY_J_KG.synoptic * synoptic
        + LIFT_ENERGY_J_KG.terrain * terrain + LIFT_ENERGY_J_KG.outflow * outflow + LIFT_ENERGY_J_KG.thermals * thermals;
      // Elevated parcels are lifted mainly by overrunning of frontal zones, helped by
      // synoptic ascent; broad weak ascent alone rarely releases them.
      const elevatedLift = LIFT_ENERGY_J_KG.synoptic * synoptic * 0.8 + LIFT_ENERGY_J_KG.boundary * 0.6 * boundary;

      const mlCape = Number(sounding.mlcape) || 0, mlCin = Math.abs(Number(sounding.mlcin) || 0);
      const muCape = Number(sounding.mucape) || 0, muCin = Math.abs(Number(sounding.mucin) || 0);
      // Elevated only when the most-unstable parcel originates above the surface layer.
      const muAloft = muCape > (Number(sounding.sbcape) || 0) + 50;
      const surfaceExcess = mlCape >= MIN_CAPE_J_KG ? (surfaceLift - mlCin) / Math.max(40, 0.5 * surfaceLift) : -1;
      const elevatedExcess = muAloft && muCape >= MIN_CAPE_J_KG * 1.5 && mlCin > 75 ? (elevatedLift - muCin) / Math.max(40, 0.5 * elevatedLift) : -1;
      const elevated = elevatedExcess > surfaceExcess;
      const excess = clamp(Math.max(surfaceExcess, elevatedExcess), 0, 1);
      if (excess <= 0) continue;

      const buoyancy = clamp(((elevated ? muCape : mlCape) - MIN_CAPE_J_KG) / 1500, 0.15, 1);
      const processed = clamp(Number(cell.features?.stormProcessedAir) || 0, 0, 1);
      const spacingKm = SUPPRESSION_RADIUS_KM * (1 - BOUNDARY_SPACING_REDUCTION * boundary);
      const suppression = stormSuppression(active, xKm, yKm, spacingKm);
      const netLift = elevated ? elevatedLift - muCin : surfaceLift - mlCin;
      const rate = FORCED_RATE_PER_HOUR * clamp(netLift / NET_LIFT_SCALE_J_KG, 0, 1.5) ** 2 * buoyancy * (1 - 0.8 * processed) * (1 - suppression);
      const probability = 1 - Math.exp(-rate * dtHours);
      if (nextUnit(seed, hourUtc, x, y, 'fire') > probability) continue;

      const sources = { boundary, synoptic, terrain, outflow, thermals };
      const primary = Object.entries(sources).sort((a, b) => b[1] - a[1])[0][0];
      const boundaryType = primary === 'boundary' ? (cell.features?.primaryBoundaryType ?? null) : primary === 'outflow' ? 'outflow' : null;
      const boundaryId = primary === 'boundary' ? (cell.features?.primaryBoundaryId ?? null) : null;
      candidates.push({
        x, y, xKm, yKm, probability, elevated, spacingKm,
        cin: elevated ? muCin : mlCin, cape: elevated ? muCape : mlCape,
        liftEnergy: elevated ? elevatedLift : surfaceLift,
        boundaryType, corridorId: boundaryId ? `boundary:${boundaryId}` : `${primary}:${Math.floor(x / 5)}:${Math.floor(y / 5)}`,
        secondaryOutflow: primary === 'outflow',
        forcingComponents: sources
      });
    }
  }

  // Accept in random order; each new updraft suppresses others close by, like existing storms.
  candidates.sort((a, b) => nextUnit(seed, hourUtc, a.x, a.y, 'order') - nextUnit(seed, hourUtc, b.x, b.y, 'order'));
  const accepted = [];
  for (const candidate of candidates) {
    if (active.length + accepted.length >= MAX_ACTIVE_STORMS) break;
    const suppression = stormSuppression(accepted.map(c => ({ positionKm: { x: c.xKm, y: c.yKm } })), candidate.xKm, candidate.yKm, candidate.spacingKm);
    if (nextUnit(seed, hourUtc, candidate.x, candidate.y, 'accept') < suppression) continue;
    accepted.push(candidate);
  }
  return accepted;
}

// Fraction of new-updraft formation suppressed by nearby storms.
function stormSuppression(storms, xKm, yKm, radiusKm = SUPPRESSION_RADIUS_KM) {
  let open = 1;
  for (const storm of storms) {
    const d = Math.hypot(storm.positionKm.x - xKm, storm.positionKm.y - yKm);
    if (d < 3 * radiusKm) open *= 1 - SUPPRESSION_STRENGTH * Math.exp(-((d / radiusKm) ** 2));
  }
  return 1 - open;
}

// Convergence along the leading edge of storm outflows (gust fronts).
function gustFrontLift(outflows, xKm, yKm) {
  let lift = 0;
  for (const o of outflows) {
    const d = Math.hypot(xKm - o.centerKm.x, yKm - o.centerKm.y);
    lift = Math.max(lift, clamp(o.strength, 0, 1) * Math.exp(-(((d - o.radiusKm) / GUST_FRONT_WIDTH_KM) ** 2)));
  }
  return lift;
}

function nextUnit(seed, hour, x, y, salt) {
  let h = 2166136261;
  const text = `${seed}|${hour}|${x}|${y}|${salt}`;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

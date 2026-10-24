// Convective initiation from parcel physics. A storm can form where the lift available at a
// point can carry a parcel through its convective inhibition (CIN) to a level of free
// convection with meaningful CAPE behind it. The lift is worked out the way convection schemes
// do (2026-10-15):
//   - Rising air at cloud base warms the rising parcel relative to its surroundings (the
//     Kain-Fritsch trigger, Kain 2004): about 1 K for 1 cm/s above a threshold of 2 cm/s,
//     a little over 2 K at 10 cm/s. Over the layer between cloud base and the level of free
//     convection that is the energy it brings against the CIN. For surface parcels the rising
//     air is the convergence of the surface winds through the mixed layer (fronts, the
//     dryline, outflow, confluence bands, wherever they converge), upslope flow and the outer
//     model's own slow ascent.
//   - Thermals bring the kinetic energy of their updraughts (about half the square of 1.8
//     times the convective velocity scale; the "available lifting energy" of Rio et al.): a few
//     J/kg, so the sun alone starts storms only where there is next to no cap.
//   - Elevated storms use the most-unstable parcel above a stable surface layer, lifted where
//     warm, moist air is pushed up over cooler air (850 mb warm advection over the stability
//     above it) and where the low-level jet converges at its end, plus the outer model's ascent.
// The chance of an updraft forming grows with how far the lift exceeds the CIN and with the
// CAPE. Existing storms suppress new updrafts close by (compensating subsidence, stabilised
// outflow air) while their gust fronts can trigger new cells along the outflow edge, so
// storms cluster where forcing is strong and stay isolated where it is weak.
import { clamp } from '../scenarios/math.js';

// Kain-Fritsch trigger: parcel warming (K) = KF_COEFFICIENT * (w - threshold)^(1/3), w in m/s;
// the threshold is KF_THRESHOLD_MS for a cloud base at 2 km and above, less for lower ones.
const KF_COEFFICIENT = 4.64, KF_THRESHOLD_MS = 0.02;
// Depth (m) the convergence of the surface winds is taken through: the mixed layer, up to
// cloud base. Cooling of the outer model's 250-750 mb layer per metre of lift (K/m).
const CONVERGENCE_DEPTH_M = [300, 2500], ASCENT_COOLING_PER_M = 0.0033;
// Depth (m) of the capping layer the parcel's warming acts over when the sounding gives none.
const CAP_DEPTH_M = [200, 2000], DEFAULT_CAP_DEPTH_M = 800;
// Thermals: strongest updraught as a multiple of the convective velocity scale, and the
// sensible heat flux at full heating (W/m^2; the regional layer's dry-ground peak).
const THERMAL_PEAK = 1.8, FULL_HEATING_WM2 = 390;
const MIN_CAPE_J_KG = 300;
// Initiation rate per cell and hour where the lift beats the inhibition over the whole cell
// (times the share of the cell where it does, and the CAPE). History: 0.012 to 0.005 on
// 2026-10-14 (127 storms a day filled the outlooks' contours); 0.015 on 2026-10-15 with the
// physical lift energies, which are a few tens of J/kg rather than the old fixed 150+.
const FORCED_RATE_PER_HOUR = 0.015;
// Spread of lift within a cell (rolls, small convergence lines, uneven heating): this share
// of the cell's mean lift plus a little (J/kg). With no lift there is nothing to spread. The
// least share of a cell where lift must beat the cap for a storm to be possible at all.
const SUBGRID_SPREAD_SHARE = 0.4, SUBGRID_SPREAD_J_KG = 3, MIN_OVERCOME_SHARE = 0.01;
// The fastest storms start anywhere (per cell and hour): lift well clear of the cap, ample CAPE.
export const FULL_INITIATION_RATE_PER_HOUR = FORCED_RATE_PER_HOUR;
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
  const seed = world.evolution?.config?.seed ?? 'seed';
  // A forecast run's own error in the lift that starts storms (ensemblePerturbation.js); 1 in
  // the live world.
  const liftScale = Number(world.forecastLiftScale) || 1;
  const candidates = [];

  for (let y = 1; y < world.height - 1; y++) {
    for (let x = 1; x < world.width - 1; x++) {
      const cell = world.getCell(x, y);
      const start = diagnoseInitiation(cell, liftScale);
      if (!start?.canStart) continue;
      const { synoptic, boundary, terrain, thermals, surfaceLift, elevatedLift, mlCape, mlCin, muCape, muCin, elevated } = start;
      const xKm = (x + nextUnit(seed, hourUtc, x, y, 'x')) * world.cellSizeKm;
      const yKm = (y + nextUnit(seed, hourUtc, x, y, 'y')) * world.cellSizeKm;
      const spacingKm = SUPPRESSION_RADIUS_KM * (1 - BOUNDARY_SPACING_REDUCTION * boundary);
      const suppression = stormSuppression(active, xKm, yKm, spacingKm);
      const rate = start.ratePerHour * (1 - suppression);
      const probability = 1 - Math.exp(-rate * dtHours);
      if (nextUnit(seed, hourUtc, x, y, 'fire') > probability) continue;

      const sources = { boundary, synoptic, terrain, thermals };
      const primary = Object.entries(sources).sort((a, b) => b[1] - a[1])[0][0];
      const boundaryType = null, boundaryId = null;
      candidates.push({
        x, y, xKm, yKm, probability, elevated, spacingKm,
        cin: elevated ? muCin : mlCin, cape: elevated ? muCape : mlCape,
        liftEnergy: elevated ? elevatedLift : surfaceLift,
        boundaryType, corridorId: boundaryId ? `boundary:${boundaryId}` : `${primary}:${Math.floor(x / 5)}:${Math.floor(y / 5)}`,
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

// Whether the lift at a cell can carry a parcel through its inhibition, and how fast storms
// start there with no other storm near (per cell and hour). Null where nothing can start.
// Energy (J/kg) the Kain-Fritsch warming of a parcel lifted at w (m/s) brings over a capping
// layer capDepth deep, for a cloud base lclAgl (m) above the ground.
export function kainFritschLift(w, lclAgl, capDepth) {
  const threshold = KF_THRESHOLD_MS * clamp(lclAgl / 2000, 0.25, 1);
  if (!(w > threshold)) return 0;
  const warming = KF_COEFFICIENT * Math.cbrt(w - threshold);
  return 9.81 * warming / 293 * capDepth;
}

// liftScale: a forecast run's error in the mesoscale lift (1: none).
export function diagnoseInitiation(cell, liftScale = 1) {
  const sounding = cell.derived?.sounding;
  if (!sounding) return null;
  const terrainM = Number(cell.terrain?.elevationM) || 0, features = cell.features ?? {}, dynamics = cell.dynamics ?? {};
  const lclAgl = Number.isFinite(sounding.lclAglM) ? sounding.lclAglM : Math.max(100, (Number(sounding.lclM) || terrainM + 1000) - terrainM);
  const lfcAgl = Number(sounding.lfcM) - terrainM;
  const capDepth = Number.isFinite(lfcAgl) && lfcAgl > lclAgl ? clamp(lfcAgl - lclAgl, CAP_DEPTH_M[0], CAP_DEPTH_M[1]) : DEFAULT_CAP_DEPTH_M;
  // Rising air at cloud base (m/s): surface convergence through the mixed layer, upslope flow,
  // the outer model's ascent.
  const mixedDepth = Number(features.mixedLayerDepthM) || 1000;
  const wBoundary = Math.max(0, Number(dynamics.surfaceConvergenceS1) || 0) * clamp(Math.min(lclAgl, Math.max(mixedDepth, 500)), CONVERGENCE_DEPTH_M[0], CONVERGENCE_DEPTH_M[1]);
  const wTerrain = Math.max(0, Number(dynamics.terrainLiftMs) || 0);
  const wLarge = Math.max(0, Number(features.ascentCoolingKh) || 0) / 3600 / ASCENT_COOLING_PER_M;
  const w = wBoundary + wTerrain + wLarge;
  // Thermals: convective velocity scale from the heating and the mixed layer's depth.
  const heatFlux = clamp(Number(features.surfaceHeating) || 0, 0, 1) * FULL_HEATING_WM2;
  const wStar = Math.cbrt(9.81 / 300 * heatFlux / (1.2 * 1005) * mixedDepth);
  const thermalLift = 0.5 * (THERMAL_PEAK * wStar) ** 2;
  const surfaceLift = liftScale * (kainFritschLift(w, lclAgl, capDepth) + thermalLift);
  // Elevated parcels: warm air lifted over cooler air, the low-level jet's convergence, ascent.
  const wElevated = Math.max(0, Number(features.isentropicLiftMs) || 0) + Math.max(0, Number(features.jetConvergenceLiftMs) || 0) + wLarge;
  const elevatedLift = liftScale * kainFritschLift(wElevated, 1500, DEFAULT_CAP_DEPTH_M);
  // What did the lifting (shares), for the reports and the storms' records.
  const total = w + 0.02 * thermalLift || 1;
  const boundary = clamp(wBoundary / total, 0, 1), terrain = clamp(wTerrain / total, 0, 1), synoptic = clamp(wLarge / total, 0, 1), thermals = clamp(0.02 * thermalLift / total, 0, 1);

  const mlCape = Number(sounding.mlcape) || 0, mlCin = Math.abs(Number(sounding.mlcin) || 0);
  const muCape = Number(sounding.mucape) || 0, muCin = Math.abs(Number(sounding.mucin) || 0);
  // Elevated where the most-unstable parcel originates above the surface layer (more so the more
  // of its CAPE the surface parcel lacks) and the surface air is capped (more so the more it is).
  // (2026-10-23: both were on-off steps, at 50 J/kg more CAPE and 75 J/kg of surface CIN.)
  const aloftShare = clamp((muCape - (Number(sounding.sbcape) || 0)) / 100, 0, 1), cappedShare = clamp((mlCin - 25) / 100, 0, 1), muAloft = aloftShare > 0;
  // The share of the cell where the lift beats the cap: lift varies within a 16 km cell, so a
  // cell whose mean lift is a little short of its mean CIN still has places where a storm can
  // start, and one just over it has places where none can.
  const surfaceShare = mlCape >= MIN_CAPE_J_KG ? overcomeShare(surfaceLift, mlCin) : 0;
  const elevatedShare = muCape >= MIN_CAPE_J_KG * 1.5 ? aloftShare * cappedShare * overcomeShare(elevatedLift, muCin) : 0;
  const elevated = elevatedShare > surfaceShare;
  const share = Math.max(surfaceShare, elevatedShare);
  const base = { synoptic, boundary, terrain, thermals, surfaceLift, elevatedLift, mlCape, mlCin, muCape, muCin, elevated };
  if (share < MIN_OVERCOME_SHARE) return { ...base, canStart: false, netLift: Math.max(surfaceLift - mlCin, muAloft ? elevatedLift - muCin : -Infinity), ratePerHour: 0 };

  const buoyancy = clamp(((elevated ? muCape : mlCape) - MIN_CAPE_J_KG) / 1500, 0.15, 1);
  const processed = clamp(Number(cell.features?.stormProcessedAir) || 0, 0, 1);
  const netLift = elevated ? elevatedLift - muCin : surfaceLift - mlCin;
  return { ...base, canStart: true, netLift, overcomeShare: share, ratePerHour: FORCED_RATE_PER_HOUR * share * buoyancy * (1 - 0.8 * processed) };
}

// Share of a cell where lift beats the inhibition, for its mean lift and CIN (J/kg), the lift
// spread normally within the cell.
function overcomeShare(lift, cin) {
  const z = (lift - cin) / ((SUBGRID_SPREAD_SHARE * lift + SUBGRID_SPREAD_J_KG) * Math.SQRT2), t = 1 / (1 + 0.3275911 * Math.abs(z));
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + Math.sign(z) * erf);
}

// Fraction of new-updraft formation suppressed by nearby storms.
function stormSuppression(storms, xKm, yKm, radiusKm = SUPPRESSION_RADIUS_KM) {
  let open = 1;
  for (const storm of storms) {
    const d = Math.hypot(storm.positionKm.x - xKm, storm.positionKm.y - yKm);
    // Inside a mature storm's cold pool the air is stable: nothing new forms there (new cells
    // form on its gust front, which is lift, not suppression).
    const reach = Math.max(radiusKm, Number(storm.coldPoolRadiusKm) || 0);
    if (d < 3 * reach) open *= 1 - SUPPRESSION_STRENGTH * Math.exp(-((d / reach) ** 2));
  }
  return 1 - open;
}

function nextUnit(seed, hour, x, y, salt) {
  let h = 2166136261;
  const text = `${seed}|${hour}|${x}|${y}|${salt}`;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

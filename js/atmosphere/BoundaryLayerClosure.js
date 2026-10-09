// Boundary-layer closure applied after the transport/synoptic engines each step.
//
// 1. Dry convective adjustment: a surface layer warmer (in potential temperature) than
//    850 mb mixes with it, and with 700 mb if heating is deep enough to break the cap.
//    This bounds afternoon highs and warms the layer aloft, as real mixing does.
// 2. Surface wind follows the boundary layer: a well-mixed fraction of the 850 mb wind
//    by day, decoupled (lighter) at night.
// 3. Nocturnal low-level jet: after sunset the decoupled 850 mb flow accelerates in the
//    warm sector (inertial oscillation), raising evening storm-relative helicity.

const KAPPA = 0.2857;
const C_TO_K = 273.15;
const DEG_TO_RAD = Math.PI / 180;
const MAX_MIDLEVEL_LAPSE = 9.3; // K/km
const LLJ_BOOST = 0.35;       // peak nocturnal 850 mb acceleration in the warm sector

export function applyBoundaryLayer(world, dtHours = 0.5) {
  const localHour = (((world.validHourUtc - 6) % 24) + 24) % 24;
  const daylight = localHour > 6 && localHour < 20.5 ? Math.sin(Math.PI * (localHour - 6) / 14.5) : 0;
  // Mixing peaks mid-afternoon; the jet peaks a few hours after sunset (~06Z).
  const mixing = clamp(daylight * 1.15, 0, 1);
  const jetPhase = nocturnalJetPhase(localHour);
  const relax = clamp(dtHours * 0.6, 0, 1);
  let mixedCells = 0, capBreaks = 0;

  world.forEachCell(cell => {
    const elev = Number(cell.terrain?.elevationM) || 0;
    const ps = Number(cell.surface.pressure) || 1000;
    const l850 = cell.levels[850], l700 = cell.levels[700];

    // --- 1. Convective adjustment -------------------------------------------------
    if (ps > 870 && Number.isFinite(l850.temperature)) {
      let thS = theta(fToK(cell.surface.temperature), ps);
      const th850 = theta(l850.temperature + C_TO_K, 850);
      if (thS > th850 + 0.2) {
        // Equal-mass two-node mix of the surface layer and the 850 mb layer.
        let thM = (thS + th850) / 2;
        mixedCells++;
        const th700 = Number.isFinite(l700.temperature) ? theta(l700.temperature + C_TO_K, 700) : Infinity;
        if (thM > th700 + 0.2) {
          // Heating has eroded the cap: the mixed layer deepens through 700 mb.
          thM = (2 * thM + th700) / 3;
          l700.temperature = fromTheta(thM, 700) - C_TO_K;
          capBreaks++;
        }
        cell.surface.temperature = kToF(fromTheta(thM, ps));
        l850.temperature = fromTheta(thM, 850) - C_TO_K;
        thS = thM;
        // The same turbulent mixing homogenises moisture: equal-mass mean mixing ratio.
        if (Number.isFinite(l850.dewpoint)) {
          const wM = (mixingRatio((cell.surface.dewpoint - 32) * 5 / 9, ps) + mixingRatio(l850.dewpoint, 850)) / 2;
          cell.surface.dewpoint = Math.min(cell.surface.temperature, dewpointFromMixingRatio(wM, ps) * 9 / 5 + 32);
          l850.dewpoint = Math.min(l850.temperature, dewpointFromMixingRatio(wM, 850));
        }
      }
    }

    // --- Mid-level stability: 700-500 mb cannot exceed ~9.3 K/km (an EML is nearly dry
    // adiabatic; anything steeper overturns). Adjust both levels toward each other.
    const l500 = cell.levels[500];
    if (Number.isFinite(l700.temperature) && Number.isFinite(l500.temperature)) {
      const depthKm = Math.max(1.8, ((Number(l500.heightDm) || 560) * 10 - 3010) / 1000);
      const excess = (l700.temperature - l500.temperature) - MAX_MIDLEVEL_LAPSE * depthKm;
      if (excess > 0) { l700.temperature -= excess * 0.5; l500.temperature += excess * 0.5; }
    }

    // --- 3. Nocturnal low-level jet ------------------------------------------------
    const warm = clamp(Math.max(cell.features?.warmSector ? 1 : 0, Number(cell.features?.synopticWarmSectorFraction) || 0), 0, 1);
    const southerly = Math.max(0, Math.cos(((Number(l850.windDirection) || 180) - 190) * Math.PI / 180));
    const jetBase = l850.baseWindSpeed ??= l850.windSpeed;
    // Track the synoptic 850 wind slowly so the jet modulates it rather than replacing it.
    l850.baseWindSpeed = jetBase + (l850.windSpeed / (1 + LLJ_BOOST * (l850.jetFactor ?? 0)) - jetBase) * clamp(dtHours * 0.25, 0, 1);
    const jetTarget = jetPhase * warm * southerly;
    l850.jetFactor = (l850.jetFactor ?? 0) + (jetTarget - (l850.jetFactor ?? 0)) * relax;
    l850.windSpeed = Math.max(3, l850.baseWindSpeed * (1 + LLJ_BOOST * l850.jetFactor));

    // --- 2. Surface wind follows the boundary layer -------------------------------
    const roughness = clamp(Number(cell.terrain?.roughness) || 0.12, 0.02, 0.5);
    // Surface wind is ~30% of the 850 mb wind under a stable night-time layer and ~42% with
    // full afternoon mixing (850 mb is near the top of the boundary layer).
    const fraction = (0.30 + 0.12 * mixing) * (1 - 0.6 * (roughness - 0.12));
    const targetSpeed = clamp(fraction * l850.windSpeed + 3, 4, 34);
    // Friction backs the surface wind from the 850 mb wind near the top of the boundary layer
    // (Ekman turning): ~30 degrees by day, ~42 degrees in the stable night-time layer. The
    // isallobaric wind (toward falling pressure) adds to it.
    const ekmanBacking = 30 + 12 * (1 - mixing);
    const targetDir = normalizeDeg(l850.windDirection - ekmanBacking) * DEG_TO_RAD;
    const isallobaric = cell.dynamics?.isallobaricWindKt ?? { e: 0, n: 0 };
    const goalE = -targetSpeed * Math.sin(targetDir) + 0.5 * isallobaric.e, goalN = -targetSpeed * Math.cos(targetDir) + 0.5 * isallobaric.n;
    const currentDir = (Number(cell.surface.wind.direction) || 0) * DEG_TO_RAD, currentSpeed = Number(cell.surface.wind.speed) || targetSpeed;
    const e = -currentSpeed * Math.sin(currentDir) + (goalE + currentSpeed * Math.sin(currentDir)) * relax;
    const n = -currentSpeed * Math.cos(currentDir) + (goalN + currentSpeed * Math.cos(currentDir)) * relax;
    cell.surface.wind.speed = Math.max(2, Math.hypot(e, n));
    cell.surface.wind.direction = normalizeDeg(Math.atan2(-e, -n) / DEG_TO_RAD);
  });

  world.boundaryLayer = { version: '2.73.0', localHour, mixing, jetPhase, mixedCellFraction: mixedCells / (world.width * world.height), capBreakFraction: capBreaks / (world.width * world.height) };
  return world.boundaryLayer;
}

// Night-time surface cooling toward a dewpoint-limited floor; slower under cloud and wind.
export function nocturnalCoolingFph(cell, solar) {
  if (solar >= 0.08) return 0;
  const night = 1 - solar / 0.08;
  const t = Number(cell.surface.temperature), td = Number(cell.surface.dewpoint);
  const cloud = clamp(Number(cell.memory?.cloudCover ?? cell.features?.cloudCover) || 0, 0, 1);
  const wind = clamp(((Number(cell.surface.wind?.speed) || 10) - 6) / 18, 0, 1);
  const floor = td + 2 + 3 * wind;
  const rate = 0.17 * (1 - 0.55 * cloud) * (1 - 0.4 * wind);
  return night * Math.max(0, t - floor) * rate;
}

function nocturnalJetPhase(localHour) {
  // Ramps up after ~19 local, peaks near 00-02 local, fades by ~09 local.
  const h = localHour < 12 ? localHour + 24 : localHour;
  if (h < 19 || h > 33) return 0;
  return Math.sin(Math.PI * (h - 19) / 14) ** 1.5;
}

// Mixing ratio (kg/kg) from dewpoint (C) and pressure (hPa), and its inverse.
export function mixingRatio(tdC, p) { const e = 6.112 * Math.exp(17.67 * tdC / (tdC + 243.5)); return 0.622 * e / Math.max(1, p - e); }
export function dewpointFromMixingRatio(w, p) { const e = Math.max(1e-3, w * p / (0.622 + w)); const l = Math.log(e / 6.112); return 243.5 * l / (17.67 - l); }
function angleDiff(a, b) { return ((a - b + 540) % 360) - 180; }
function normalizeDeg(d) { return ((d % 360) + 360) % 360; }
function theta(tK, p) { return tK * (1000 / p) ** KAPPA; }
function fromTheta(th, p) { return th * (p / 1000) ** KAPPA; }
function fToK(f) { return (f - 32) * 5 / 9 + C_TO_K; }
function kToF(k) { return (k - C_TO_K) * 9 / 5 + 32; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

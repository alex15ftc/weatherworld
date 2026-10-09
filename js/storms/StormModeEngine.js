import { clamp } from '../scenarios/math.js';
import { diagnoseStormRealizationPhysics } from './StormRealizationPhysics.js';

// Storm mode from the environment alone, using the standard operational discriminators:
//   - buoyancy available to the storm (no buoyancy, no organized updraft);
//   - deep-layer (0-6 km) shear: <~25 kt pulse/multicell, >~40 kt supports supercells;
//   - the supercell composite parameter (SCP: CAPE x helicity x shear);
//   - line tendency: deep shear along a forcing boundary and crowded storms (environmentSampling);
//   - crowding decides isolated / discrete / clustered supercells;
//   - elevated: the surface parcel is capped while a parcel aloft is unstable and free.
export function diagnosePreferredMode(environment) {
  const physics = diagnoseStormRealizationPhysics(environment);
  const cape = Number(environment.cape) || 0, cin = Number(environment.cin) || 0;
  const shearKt = Number(environment.bulkShear) || 0, srh = Number(environment.srh) || 0;
  const scp = Number.isFinite(environment.scp) && environment.scp > 0 ? environment.scp : (cape / 1000) * (srh / 50) * clamp(shearKt * 0.514 / 20, 0, 1.5);
  const linear = clamp(Number(environment.linearFraction) || 0, 0, 1);
  const coverage = clamp(Number(environment.stormCoverage) || 0, 0, 1);
  const buoyant = ramp(cape, 150, 1000) * (1 - ramp(cin, 150, 300));
  const muAloft = (environment.mostUnstableCape ?? 0) > (environment.surfaceBasedCape ?? cape) + 50;
  const elevated = muAloft && cin > 100 && (environment.mostUnstableCape ?? 0) > 500 && (environment.mostUnstableCin ?? 0) < 60;

  const weakShear = 1 - ramp(shearKt, 18, 32);
  const supercell = buoyant * ramp(shearKt, 28, 45) * ramp(scp, 0.5, 4);
  const lineOrganized = buoyant * linear * (1 - weakShear);
  const scores = {
    'elevated convection': elevated ? 0.6 + 0.4 * ramp(environment.mostUnstableCape ?? 0, 500, 2000) : 0,
    'pulse storm': buoyant * weakShear,
    'multicell': buoyant * (1 - weakShear) * 0.45,
    'broken line': lineOrganized * (1 - supercell) * 0.9,
    'isolated supercell': supercell * (1 - linear) * (1 - ramp(coverage, 0.1, 0.35)),
    'discrete supercell': supercell * (1 - linear) * ramp(coverage, 0.1, 0.35) * (1 - ramp(coverage, 0.45, 0.8)),
    'discrete supercell cluster': supercell * (1 - linear) * ramp(coverage, 0.45, 0.8),
    'mixed supercell cluster': supercell * linear
  };
  const ranked = Object.entries(scores).sort((x, y) => y[1] - x[1]);
  const [mode, score] = ranked[0];
  return { mode, confidence: clamp(score - 0.5 * (ranked[1]?.[1] ?? 0) + 0.25, 0, 1), scores, physics, scp };
}

function ramp(value, start, end) { return clamp((value - start) / (end - start), 0, 1); }

export function shouldSplitStorm(storm, environment) {
  return !storm.hasSplit && storm.ageHours >= 0.9 && storm.ageHours <= 3.2 &&
    ['discrete supercell','isolated supercell','semi-discrete supercell'].includes(storm.mode) && storm.organization >= 0.52 &&
    environment.bulkShear >= 38 && environment.cape >= 850;
}

export function shouldBecomeQlcs(storm, neighbors, environment) {
  const discreteProtection = (environment.prefrontalSupercellSupport ?? 0) >= 0.48 || (environment.tornadicEnvironmentSupport ?? 0) >= 0.58;
  return (storm.mode === 'linear segment' || storm.mode === 'multicell') &&
    neighbors >= (discreteProtection ? 3 : 2) && storm.ageHours >= (discreteProtection ? 3.2 : 1.8) &&
    storm.coldPoolStrength >= (discreteProtection ? 0.50 : 0.38) && environment.bulkShear >= 25;
}

export function shouldBecomeMcs(storm, neighbors, environment) {
  const discreteProtection = (environment.prefrontalSupercellSupport ?? 0) >= 0.48 || (environment.tornadicEnvironmentSupport ?? 0) >= 0.58;
  return (storm.mode === 'QLCS' || storm.mode === 'linear segment' || storm.mode === 'multicell') &&
    neighbors >= (discreteProtection ? 4 : 3) && storm.ageHours >= (discreteProtection ? 4.5 : 2.8) &&
    storm.coldPoolStrength >= (discreteProtection ? 0.58 : 0.48) && environment.stormCoverage >= 0.55;
}

export function shouldUpscaleIntoLine(storm, neighbors, environment) {
  if (storm.mode === 'MCS' || storm.mode === 'QLCS' || storm.mode === 'QLCS with embedded supercells' || storm.mode === 'left-moving supercell') return false;
  const discreteProtection = (environment.prefrontalSupercellSupport ?? 0) >= 0.48 || (environment.tornadicEnvironmentSupport ?? 0) >= 0.58;
  if (storm.mode.includes('supercell') && discreteProtection && storm.ageHours < 5.5) return false;
  const matureEnough = storm.ageHours >= (discreteProtection ? 5.0 : 3.5);
  const longLived = storm.ageHours >= 5.5;
  // Strong linear forcing (e.g. along a cold front) organizes lines before cold pools mature.
  const coldPoolReady = storm.coldPoolStrength >= (environment.linearFraction >= 0.45 ? 0.10 : 0.34);
  const organizedCorridor = environment.linearFraction >= 0.42 || environment.forcing >= 0.48;
  const interacting = neighbors >= 1;
  // Long-lived storms increasingly favor upscale growth, but isolated discrete
  // supercells may remain discrete when forcing and linear support stay weak.
  return coldPoolReady && ((matureEnough && interacting && organizedCorridor) ||
    (longLived && neighbors >= 1) ||
    (longLived && environment.forcing >= 0.62 && environment.linearFraction >= 0.50));
}

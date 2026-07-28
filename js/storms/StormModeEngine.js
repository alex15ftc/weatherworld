import { clamp } from '../scenarios/math.js?v=2.20.1';
import { diagnoseStormRealizationPhysics } from './StormRealizationPhysics.js?v=2.28.14';

export function diagnosePreferredMode(environment, setupKey = '', lifecycle = null, elapsedHours = 0) {
  const physics = diagnoseStormRealizationPhysics(environment);
  const shear = clamp((environment.bulkShear - 15) / 40, 0, 1);
  const buoyancy = clamp(physics.realizedUpdraft, 0, 1);
  const forcing = clamp(environment.forcing, 0, 1);
  const elevated = environment.lcl > 1700 && environment.cin > 70;
  const scores = {
    'pulse storm': physics.initiationProbability * (1 - shear) * (0.42 + 0.58 * buoyancy),
    'multicell': physics.initiationProbability * buoyancy * (0.38 + 0.42 * shear + 0.20 * physics.balanceSupport),
    'discrete supercell': physics.supercellProbability * (0.70 + 0.30 * clamp(environment.discreteFraction ?? 0.5, 0, 1)),
    'linear segment': physics.linearProbability * (0.62 + 0.38 * clamp(environment.linearFraction ?? 0.5, 0, 1)),
    'elevated convection': elevated ? physics.initiationProbability * (0.48 + 0.35 * forcing) : 0.03,
    'MCS': physics.linearProbability * clamp(environment.stormCoverage ?? 0, 0, 1) * forcing * 0.78
  };
  if (setupKey === 'elevated_mcs') scores.MCS += 0.18 * physics.initiationProbability;
  if (setupKey === 'progressive_cold_front') scores['linear segment'] += 0.14 * physics.linearProbability;
  if (['dryline_cyclone','lee_cyclogenesis','warm_front_wave'].includes(setupKey)) scores['discrete supercell'] += 0.12 * physics.supercellProbability;
  const lifecycleMode = modeForLifecycle(lifecycle, elapsedHours);
  if (lifecycleMode === 'discrete') scores['discrete supercell'] += 0.24 * Math.max(physics.supercellProbability, physics.initiationProbability);
  if (lifecycleMode === 'multicell' || lifecycleMode === 'mixed') scores.multicell += 0.18 * physics.initiationProbability;
  if (lifecycleMode === 'linear' || lifecycleMode === 'mixed') scores['linear segment'] += 0.24 * physics.linearProbability;
  if (lifecycleMode === 'QLCS') scores['linear segment'] += 0.32 * physics.linearProbability;
  if (lifecycleMode === 'MCS') scores.MCS += 0.34 * Math.max(physics.linearProbability, physics.initiationProbability);
  if (lifecycleMode === 'elevated') scores['elevated convection'] += 0.28 * physics.initiationProbability;
  if (lifecycleMode === 'pulse') scores['pulse storm'] += 0.24 * physics.initiationProbability;
  if (['capped','conditional','stable','decay'].includes(lifecycleMode)) {
    for (const key of Object.keys(scores)) scores[key] *= lifecycleMode === 'stable' ? 0.35 : 0.62;
  }
  const [mode, score] = Object.entries(scores).sort((a,b) => b[1]-a[1])[0];
  return { mode, confidence: clamp(score, 0, 1), scores, physics, lifecycleMode };
}

export function modeForLifecycle(contract = null, elapsedHours = 0) {
  if (!contract) return null;
  const transition = Number(contract.modeTransitionHours) || 6;
  const late = Number(contract.lateTransitionHours) || transition + 5;
  if (elapsedHours >= late) return contract.lateMode ?? contract.preferredMatureMode ?? contract.initialMode;
  if (elapsedHours >= transition) return contract.preferredMatureMode ?? contract.initialMode;
  return contract.initialMode ?? contract.preferredMatureMode ?? null;
}

export function shouldSplitStorm(storm, environment) {
  return !storm.hasSplit && storm.ageHours >= 0.9 && storm.ageHours <= 3.2 &&
    storm.mode === 'discrete supercell' && storm.organization >= 0.52 &&
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
  if (storm.mode === 'MCS' || storm.mode === 'QLCS' || storm.mode === 'left-moving supercell') return false;
  const discreteProtection = (environment.prefrontalSupercellSupport ?? 0) >= 0.48 || (environment.tornadicEnvironmentSupport ?? 0) >= 0.58;
  if (storm.mode.includes('supercell') && discreteProtection && storm.ageHours < 5.5) return false;
  const matureEnough = storm.ageHours >= (discreteProtection ? 5.0 : 3.5);
  const longLived = storm.ageHours >= 5.5;
  const coldPoolReady = storm.coldPoolStrength >= 0.34;
  const organizedCorridor = environment.linearFraction >= 0.42 || environment.forcing >= 0.48;
  const interacting = neighbors >= 1;
  // Long-lived storms increasingly favor upscale growth, but isolated discrete
  // supercells may remain discrete when forcing and linear support stay weak.
  return coldPoolReady && ((matureEnough && interacting && organizedCorridor) ||
    (longLived && neighbors >= 1) ||
    (longLived && environment.forcing >= 0.62 && environment.linearFraction >= 0.50));
}

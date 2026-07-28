import { clamp01, createRandom, normal } from './random.js';
import { matchAnalogEnsemble } from './AnalogMatcher.js';

export function buildForecastEnsemble(scenario, { memberCount = 20, leadHours = 24 } = {}) {
  const count = Math.max(12, Math.min(30, Math.floor(memberCount)));
  const random = createRandom(`${scenario.seed}|ensemble|${leadHours}`);
  const spread = .65 + Math.min(1, leadHours / 72) * .7;
  const members = Array.from({ length: count }, (_, id) => {
    const moisture = clamp01(scenario.ingredients.moistureQuality + normal(random, 0, .08 * spread));
    const cap = clamp01(scenario.ingredients.capStrength + normal(random, 0, .07 * spread));
    const forcing = clamp01(scenario.ingredients.forcingTiming + normal(random, 0, .08 * spread));
    const shear = clamp01(scenario.ingredients.lowLevelJetStrength + normal(random, 0, .06 * spread));
    const discrete = clamp01(scenario.ingredients.discreteBias + normal(random, 0, .09 * spread));
    const potential = clamp01(moisture * .36 + shear * .38 + scenario.ingredients.troughAmplitude * .26);
    const opportunity = clamp01(forcing * .57 + (1 - cap) * .30 + moisture * .13);
    const realization = clamp01(potential * opportunity);
    return {
      id, moistureReturn: moisture, capStrength: cap, forcingTiming: forcing,
      lowLevelShear: shear, discreteStormProbability: discrete,
      environmentalPotential: potential, stormOpportunity: opportunity,
      realizationProbability: realization,
      hazards: {
        tornado: clamp01(potential * opportunity * shear * discrete),
        significantTornado: clamp01(potential * opportunity * shear * discrete * Math.max(0, (shear - .55) * 1.8)),
        hail: clamp01(potential * opportunity * (.45 + discrete * .55)),
        wind: clamp01(potential * opportunity * forcing * (1.15 - discrete * .35))
      }
    };
  });
  return Object.freeze({
    memberCount: count, leadHours,
    analogs: matchAnalogEnsemble(scenario, { count: Math.min(30, Math.max(10, count)) }),
    members: Object.freeze(members)
  });
}

export function summarizeHazards(ensemble) {
  const mean = key => ensemble.members.reduce((sum, member) => sum + member.hazards[key], 0) / ensemble.memberCount;
  const realization = ensemble.members.reduce((sum, member) => sum + member.realizationProbability, 0) / ensemble.memberCount;
  const hazards = { tornado: mean('tornado'), significantTornado: mean('significantTornado'), hail: mean('hail'), wind: mean('wind') };
  return Object.freeze({ ...hazards, realization, categorical: deriveCategoricalRisk(hazards, realization) });
}

export function deriveCategoricalRisk(hazards, realization = 1) {
  const maximum = Math.max(hazards.tornado || 0, hazards.hail || 0, hazards.wind || 0);
  if (maximum >= .62 && realization >= .72) return 'HIGH';
  if (maximum >= .45 && realization >= .55) return 'MODERATE';
  if (maximum >= .30 && realization >= .40) return 'ENHANCED';
  if (maximum >= .18 && realization >= .25) return 'SLIGHT';
  if (maximum >= .08) return 'MARGINAL';
  return 'GENERAL';
}

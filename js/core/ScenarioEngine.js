import { clamp01, createRandom } from './random.js';

const FAMILIES = Object.freeze({
  ejectingSouthwestTrough: { trough: .86, moisture: .82, shear: .85, forcing: .76, discrete: .72 },
  leeCyclogenesis: { trough: .67, moisture: .73, shear: .71, forcing: .58, discrete: .82 },
  progressiveColdFront: { trough: .69, moisture: .77, shear: .78, forcing: .91, discrete: .26 },
  highPlainsUpslope: { trough: .48, moisture: .59, shear: .65, forcing: .62, discrete: .86 },
  northwestFlow: { trough: .51, moisture: .55, shear: .71, forcing: .72, discrete: .38 }
});

export function generateWeatherScenario({ seed = 1, aggression = .65, durationHours = 96, season = 'lateSpring' } = {}) {
  const random = createRandom(seed);
  const names = Object.keys(FAMILIES);
  const family = names[Math.floor(random() * names.length)];
  const base = FAMILIES[family];
  const vary = (value, spread = .12) => clamp01(value + (random() - .5) * spread);
  const aggressive = value => clamp01(value + aggression * (.03 + random() * .12));
  const moisture = aggressive(vary(base.moisture));
  const shear = aggressive(vary(base.shear));
  const forcing = aggressive(vary(base.forcing));
  const cap = clamp01(.38 + random() * .38 + aggression * .04);
  const opportunity = clamp01(forcing * .55 + moisture * .25 + (1 - cap) * .20);
  const potential = clamp01(moisture * .34 + shear * .38 + base.trough * .28);

  return Object.freeze({
    id: `scenario-${seed}`,
    seed,
    family,
    subtype: base.discrete > .65 ? 'negativelyTilted' : 'progressive',
    season,
    durationHours: Math.max(72, Math.min(120, durationHours)),
    aggression: clamp01(aggression),
    progression: Object.freeze({
      speed: vary(.68), deepeningRate: vary(base.trough),
      moistureReturnRate: moisture, boundaryMotion: vary(.58)
    }),
    ingredients: Object.freeze({
      troughAmplitude: aggressive(vary(base.trough)), troughTilt: vary(base.discrete),
      lowLevelJetStrength: shear, moistureQuality: moisture, capStrength: cap,
      forcingTiming: forcing, discreteBias: vary(base.discrete)
    }),
    dominantHazards: Object.freeze({
      tornado: clamp01(potential * shear * (0.45 + base.discrete * .55)),
      hail: clamp01(potential * (.55 + base.discrete * .4)),
      wind: clamp01(potential * (.45 + forcing * .55) * (1.15 - base.discrete * .3))
    }),
    failureModes: Object.freeze({
      morningConvection: clamp01(random() * .35),
      weakMoistureReturn: clamp01((1 - moisture) * (.45 + random() * .35)),
      excessiveCapping: clamp01(cap * (1 - forcing) * 1.25),
      earlyColdFront: clamp01(base.discrete < .4 ? .25 + random() * .35 : random() * .22)
    }),
    environmentalPotential: potential,
    stormOpportunity: opportunity,
    realizationProbability: clamp01(potential * opportunity),
    causalChain: Object.freeze([
      'upper-wave-evolution', 'surface-cyclogenesis', 'low-level-jet-response',
      'moisture-return', 'boundary-sharpening', 'cap-evolution', 'convective-initiation'
    ])
  });
}

import assert from 'node:assert/strict';
import { projectEnvironmentAtHour } from '../js/forecast/OutlookCycleEngine.js';
import { activeStormCapacity, findInitiationCandidates } from '../js/storms/InitiationEngine.js';

const cell = {
  surface: { dewpoint: 68 },
  levels: {
    850: { windDirection: 180, windSpeed: 42 },
    500: { windDirection: 235, windSpeed: 55 }
  },
  features: { warmSector: true, cloudCover: 0.08 },
  thermodynamics: { cin: { mlMagnitude: 105 } },
  derived: {
    cape: 2100,
    cin: 105,
    srh: 245,
    bulkShear: 47,
    lclAgl: 1050,
    dcape: 750,
    diagnostics: {
      forcing: 0.68,
      lowLevelUpdraftHelicity: 95,
      energyBudget: { netDewpointTendencyFph: 0.35 }
    }
  },
  forecast: {
    initiationProbability: 0.66,
    capBreakProbability: 0.55,
    expectedCapBreakHourUtc: 21,
    discreteFraction: 0.72,
    linearFraction: 0.28
  }
};

const lifecycle = {
  narrative: 'classic_tornado_outbreak',
  peakHour: 12,
  developmentHours: 10,
  decayHours: 14,
  initialMaturity: 0.3
};

const developing = projectEnvironmentAtHour(cell, 21, {
  issuedHourUtc: 15,
  elapsedHours: 4,
  config: { scenarioEvolution: lifecycle }
});
assert.equal(developing.lifecycleStage, 'developing');
assert.equal(developing.trend, 'strengthening');
assert.ok(developing.lifecycleRatio > 1, 'pre-peak outlook environment must strengthen');
assert.ok(developing.cape > cell.derived.cape, 'pre-peak CAPE projection must respond to event maturation');

const weakening = projectEnvironmentAtHour(cell, 29, {
  issuedHourUtc: 21,
  elapsedHours: 18,
  config: { scenarioEvolution: lifecycle }
});
assert.equal(weakening.lifecycleStage, 'decaying');
assert.equal(weakening.trend, 'weakening');
assert.ok(weakening.lifecycleRatio < 1, 'post-peak outlook environment must weaken');
assert.ok(weakening.cape < cell.derived.cape, 'post-peak CAPE must no longer retain an optimistic floor');
assert.ok(weakening.initiationProbability < cell.forecast.initiationProbability,
  'post-peak initiation probability must be allowed to decline');

assert.equal(activeStormCapacity(1, true), 36);
assert.equal(activeStormCapacity(0, false), 11);
const saturatedWorld = {
  width: 80,
  height: 48,
  setupForecast: { profile: { coverage: 1 } },
  evolution: { config: { scenarioEvolution: lifecycle } }
};
const saturatedStorms = Array.from({ length: 36 }, () => ({ active: true }));
assert.deepEqual(findInitiationCandidates(saturatedWorld, saturatedStorms, 21), [],
  'a saturated significant event must not initiate storms beyond its active-population capacity');

console.log('2.31.0 forecast lifecycle and storm-capacity regression passed');

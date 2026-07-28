import assert from 'node:assert/strict';
import { coupleTrajectoryEnvironment } from '../js/forecast/OutlookCycleEngine.js';

const source = {
  leadHours: 6,
  initiationProbability: 0.82,
  capBreakProbability: 0.88,
  lifecycleStage: 'developing',
  realizationChain: {
    coverage: 0.84,
    initiation: 0.78,
    environmentSuitability: 0.28,
    organization: 0.35,
    supercell: 0.22,
    linear: 0.30
  }
};
const favorableTarget = {
  cape: 3200, cin: 35, srh: 310, shear: 52, lcl: 900,
  initiationProbability: 0.08,
  realizationChain: {
    coverage: 0.20,
    initiation: 0.06,
    environmentSuitability: 0.92,
    organization: 0.86,
    supercell: 0.82,
    linear: 0.42,
    realizedUpdraftMs: 43,
    coldPoolSpeedMs: 14,
    balanceSupport: 0.72
  }
};
const poorTarget = {
  cape: 550, cin: 170, srh: 55, shear: 24, lcl: 2100,
  initiationProbability: 0.65,
  realizationChain: {
    coverage: 0.75,
    initiation: 0.70,
    environmentSuitability: 0.18,
    organization: 0.22,
    supercell: 0.08,
    linear: 0.18,
    realizedUpdraftMs: 14,
    coldPoolSpeedMs: 5,
    balanceSupport: 0.18
  }
};

const overlap = coupleTrajectoryEnvironment(source, favorableTarget);
const missed = coupleTrajectoryEnvironment(source, poorTarget);
assert.equal(overlap.realizationChain.trajectoryCoupling, 'source-initiation-target-environment');
assert.ok(overlap.realizationChain.initiation > source.realizationChain.initiation);
assert.equal(overlap.realizationChain.sourceInstantaneousInitiation, source.realizationChain.initiation);
assert.equal(overlap.realizationChain.coverage, source.realizationChain.coverage);
assert.equal(overlap.realizationChain.environmentSuitability, favorableTarget.realizationChain.environmentSuitability);
assert.equal(overlap.realizationChain.supercell, favorableTarget.realizationChain.supercell);
assert.equal(overlap.cape, favorableTarget.cape);
assert.equal(overlap.sourceInitiationEnvironment.initiationProbability, source.initiationProbability);
assert.ok(overlap.qualifyingStormOpportunity > missed.qualifyingStormOpportunity * 5,
  'risk opportunity must maximize where upstream storms overlap the downstream favorable environment');

console.log('2.32.3 source-initiation/target-environment overlap regression passed');

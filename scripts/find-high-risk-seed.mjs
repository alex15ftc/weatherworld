import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution } from '../js/evolution.js';

const start = Math.max(1, Number(process.argv[2]) || 1);
const end = Math.max(start, Number(process.argv[3]) || start + 999);
const wanted = Math.max(1, Number(process.argv[4]) || 3);
const size = Math.max(12, Number(process.argv[5]) || 50);
const matches = [];
const capableExamples = [];

for (let seed = start; seed <= end && matches.length < wanted; seed++) {
  const probe = new Atmosphere(1, 1);
  const probeConfig = generateScenario(probe, seed);
  const highCapable = (probeConfig.narrative === 'classic_tornado_outbreak' && probeConfig.intensity >= 0.80)
    || (probeConfig.narrative === 'classic_tornado_outbreak_extreme' && probeConfig.intensity >= 0.78);
  if (!highCapable) continue;
  const world = new Atmosphere(size, size);
  const config = generateScenario(world, seed);
  initializeEvolution(world, config);
  const analyzedOutlook = world.initialAuthoritativeOutlook ?? world.evolution?.outlookAnalysis;
  const predictiveOutlook = world.outlookCycle?.products?.day1;
  let maxTorProbability = 0, maxTorCig = 0, torThirtyCells = 0, tierThreeCells = 0;
  world.forEachCell(cell => {
    const probability = Number(cell.derived?.hazards?.tornadoProbability) || 0;
    maxTorProbability = Math.max(maxTorProbability, probability);
    maxTorCig = Math.max(maxTorCig, Number(cell.derived?.hazards?.tornadoCig) || 0);
    if (probability >= 30) torThirtyCells++;
    if ((cell.derived?.diagnostics?.tornadoEnvironmentTier ?? 0) >= 3) tierThreeCells++;
  });
  if (capableExamples.length < 8) capableExamples.push({
    seed,
    intensity: Number(probeConfig.intensity.toFixed(3)),
    analyzedRisk: analyzedOutlook?.overallRisk,
    predictiveRisk: predictiveOutlook?.overallRisk,
    maxCape: Math.round(world.evolution?.outlookAnalysis?.maxCape ?? 0),
    maxStp: Number((world.evolution?.outlookAnalysis?.maxStp ?? 0).toFixed(2)),
    maxSrh: Math.round(world.evolution?.outlookAnalysis?.maxSrh ?? 0),
    maxShear: Math.round(world.evolution?.outlookAnalysis?.maxShear ?? 0),
    maxTornadoProbability: maxTorProbability,
    maxTornadoCig: maxTorCig,
    torThirtyCells,
    tierThreeCells
  });
  if (analyzedOutlook?.overallRisk !== 'HIGH' && predictiveOutlook?.overallRisk !== 'HIGH') continue;
  matches.push({
    seed,
    narrative: config.narrative,
    setupType: config.setupType,
    stormMode: config.stormMode,
    primaryHazard: config.primaryHazard,
    analyzedRisk: analyzedOutlook?.overallRisk,
    predictiveRisk: predictiveOutlook?.overallRisk,
    peakHour: config.scenarioEvolution?.peakHour
  });
  console.log(`HIGH seed ${seed} (${config.narrative}, ${config.setupType})`);
}

console.log(JSON.stringify({ searched: [start, end], gridSize: size, matches, capableExamples }, null, 2));
if (!matches.length) process.exitCode = 2;

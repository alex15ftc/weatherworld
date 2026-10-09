import { performance } from 'node:perf_hooks';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';
import { SIMULATION_CONFIG } from '../js/simulationConfig.js';
const seed = Number(process.argv[2] ?? 100000);
const hours = Math.max(0, Number(process.argv[3] ?? 6));
const profile = process.argv[4] ?? 'gameplay';
const world = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
let started = performance.now();
const config = generateScenario(world, seed);
initializeEvolution(world, config, { profile });
const initializationMs = performance.now() - started;
started = performance.now();
for (let elapsed=0; elapsed<hours-1e-9;) { const dt=Math.min(1,hours-elapsed); advanceAtmosphere(world,dt); elapsed+=dt; }
const simulationMs = performance.now() - started;
console.log(JSON.stringify({version:'2.69.0',seed,hours,profile,initializationMs,simulationMs,simulatedHoursPerSecond:simulationMs?hours/(simulationMs/1000):0,products:Object.keys(world.outlookCycle.products),performance:world.evolution.performance},null,2));

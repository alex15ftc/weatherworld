import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';
import { SIMULATION_CONFIG } from '../js/simulationConfig.js';
import { access, readFile } from 'node:fs/promises';

assert.equal(SIMULATION_CONFIG.startHourUtc,12);
assert.equal(SIMULATION_CONFIG.endHourUtc,36);
assert.equal(SIMULATION_CONFIG.durationHours,24);
const world=new Atmosphere(12,10);
const config=generateScenario(world,41);
initializeEvolution(world,config);
assert.deepEqual(Object.keys(world.outlookCycle.products),['day1']);
advanceAtmosphere(world,30,{advanceStorms:false});
assert.equal(world.validHourUtc,36);
assert.equal(world.evolution.elapsedHours,24);
advanceAtmosphere(world,12,{advanceStorms:false});
assert.equal(world.validHourUtc,36,'seed cannot advance beyond next 12Z');
assert.equal(world.evolution.elapsedHours,24);
assert.deepEqual(Object.keys(world.outlookCycle.products),['day1']);
for(const page of ['index.html','day1.html']){
  const html=await readFile(new URL(`../${page}`,import.meta.url),'utf8');
  assert.match(html,/id="simulationTime"[^>]+max="36"/);
  assert.doesNotMatch(html,/day2\.html|day3\.html|value="day2"|value="day3"/);
}
for(const removed of ['day2.html','day3.html']){
  await assert.rejects(access(new URL(`../${removed}`,import.meta.url)));
}
const authoritySource=await readFile(new URL('../server/WeatherAuthorityRuntime.js',import.meta.url),'utf8');
assert.match(authoritySource,/SIMULATION_CONFIG\.endHourUtc/);
console.log({window:`${SIMULATION_CONFIG.startHourUtc}Z-${SIMULATION_CONFIG.endHourUtc}Z`,products:Object.keys(world.outlookCycle.products)});

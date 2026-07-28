import { ConvectiveBudget } from './ConvectiveBudget.js';
import { EnvironmentalGrid, UPDATE_TIER } from './EnvironmentalGrid.js';
import { createScenarioFeatures, projectFeatures } from './FeatureProjector.js';
import { buildForecastEnsemble, summarizeHazards } from './ForecastEnsemble.js';
import { createRandom } from './random.js';
import { generateWeatherScenario } from './ScenarioEngine.js';
import { SimulationClock } from './SimulationClock.js';

export class WeatherSimulationCore {
  constructor(options = {}) {
    this.scenario = generateWeatherScenario(options);
    this.grid = new EnvironmentalGrid(options.grid);
    this.features = createScenarioFeatures(this.scenario, this.grid);
    this.clock = new SimulationClock(options.cadences);
    this.budget = new ConvectiveBudget(this.grid);
    this.random = createRandom(`${this.scenario.seed}|truth`);
    this.storms = [];
    this.nextStormId = 1;
    this.validHour = Number(options.startHour ?? 12);
    projectFeatures(this.grid, this.scenario, this.features, this.validHour);
    this.forecast = this.issueOutlook(24);
  }

  issueOutlook(leadHours) {
    const ensemble = buildForecastEnsemble(this.scenario, { leadHours });
    const hazards = summarizeHazards(ensemble);
    return Object.freeze({ issuedHour: this.validHour, leadHours, ensemble, hazards, source: 'forecast-ensemble' });
  }

  advance(deltaSeconds) {
    const due = this.clock.advance(deltaSeconds);
    this.validHour += deltaSeconds / 3600;
    if (due.synoptic || due.mesoscale) projectFeatures(this.grid, this.scenario, this.features, this.validHour);
    for (let i = 0; i < due.storms; i++) this.advanceStorms(this.clock.cadences.storms);
    if (due.outlooks) this.forecast = this.issueOutlook(this.validHour < 36 ? 24 : 48);
    this.budget.recover(deltaSeconds / 3600);
    return this.snapshot();
  }

  advanceStorms(deltaSeconds) {
    const dtHours = deltaSeconds / 3600;
    for (const storm of this.storms) {
      storm.ageHours += dtHours;
      storm.position[0] += storm.velocity[0] * dtHours;
      storm.position[1] += storm.velocity[1] * dtHours;
      storm.intensity = Math.max(0, storm.intensity - dtHours * .025);
      storm.lifecycle = lifecycleForAge(storm.ageHours);
      const x = Math.floor(storm.position[0] / this.grid.cellSizeKm);
      const y = Math.floor(storm.position[1] / this.grid.cellSizeKm);
      const index = this.grid.index(x, y);
      if (index >= 0) {
        const density = this.grid.activeStormCount[index] / 3;
        const linearScore = this.grid.fields.forcing[index] * .45 + storm.wind * .25 + density * .30;
        const discreteScore = this.scenario.ingredients.discreteBias * .40 + this.grid.fields.shear06km[index] / 40 * .35 + (1 - density) * .25;
        storm.mode = linearScore > discreteScore ? 3 : discreteScore > .58 ? 2 : 1;
        this.budget.consumeAt(index, { overturning: dtHours * .05, precipitation: dtHours * .025, coldPool: dtHours * storm.wind * .05 });
      }
      if (storm.ageHours > 8 || storm.intensity < .04) storm.active = false;
    }
    this.storms = this.storms.filter(storm => storm.active);
    const candidates = [];
    for (let i = 0; i < this.grid.cellCount; i++) {
      if (this.grid.updateTier[i] !== UPDATE_TIER.ACTIVE || this.grid.activeStormCount[i]) continue;
      const rate = this.grid.fields.initiationPotential[i] * this.grid.fields.availableInstability[i] * this.grid.fields.moistureSupply[i];
      const probability = 1 - Math.exp(-rate * dtHours);
      if (this.random() < probability) candidates.push({ i, probability });
    }
    candidates.sort((a, b) => b.probability - a.probability);
    for (const candidate of candidates.slice(0, 3)) this.initiate(candidate.i);
    this.recountStorms();
  }

  initiate(index) {
    const x = index % this.grid.width;
    const y = Math.floor(index / this.grid.width);
    const km = this.grid.cellSizeKm;
    if (this.storms.some(storm => Math.hypot(storm.position[0] - (x + .5) * km, storm.position[1] - (y + .5) * km) < 30)) return;
    const f = this.grid.fields;
    this.storms.push({
      id: this.nextStormId++, active: true, position: [(x + .5) * km, (y + .5) * km],
      velocity: [24 + f.shear06km[index] * .7, -4 - f.shear01km[index] * .25],
      ageHours: 0, lifecycle: 'tower', mode: f.shear06km[index] > 25 ? 2 : 1,
      intensity: Math.min(1, .12 + f.severePotential[index] * .34),
      hail: Math.min(1, f.mlcape[index] / 4500 * f.shear06km[index] / 35),
      tornado: Math.min(1, f.srh01km[index] / 350 * f.mlcape[index] / 3500),
      wind: Math.min(1, f.stormCoveragePotential[index] * f.forcing[index])
    });
    this.budget.consumeAt(index);
  }

  recountStorms() {
    this.grid.activeStormCount.fill(0);
    for (const storm of this.storms) {
      const x = Math.floor(storm.position[0] / this.grid.cellSizeKm);
      const y = Math.floor(storm.position[1] / this.grid.cellSizeKm);
      const index = this.grid.index(x, y);
      if (index >= 0) this.grid.activeStormCount[index] = Math.min(255, this.grid.activeStormCount[index] + 1);
    }
    this.grid.classifyTiers();
  }

  snapshot() {
    return Object.freeze({
      validHour: this.validHour,
      scenarioId: this.scenario.id,
      storms: this.storms.map(storm => Object.freeze({
        stormId: storm.id, position: [...storm.position], velocity: [...storm.velocity],
        intensity: storm.intensity, mode: storm.mode, hail: storm.hail, tornado: storm.tornado, wind: storm.wind
      })),
      outlook: this.forecast.hazards
    });
  }
}

function lifecycleForAge(age) {
  if (age < .25) return 'tower';
  if (age < .75) return 'developing';
  if (age < 1.5) return 'organized';
  if (age < 4.5) return 'mature';
  if (age < 6.5) return 'cycling';
  return 'weakening';
}

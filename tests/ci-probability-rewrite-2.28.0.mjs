import assert from 'node:assert/strict';
import { initializeSetupForecast, updateSetupForecast } from '../js/scenarios/SetupForecastEngine.js';
import { findInitiationCandidates } from '../js/storms/InitiationEngine.js';

function makeWorld(overrides = {}) {
  const width = 9, height = 9;
  const cells = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => ({
    x, y,
    terrain: { elevationM: 350 },
    surface: { dewpoint: 66 },
    levels: { 500: { windSpeed: 45 }, 850: { windSpeed: 32 } },
    features: { warmSector: true, synopticAscent: .45, explicitBoundaryInfluence: .18, explicitBoundaryType: 'dryline', lapseRate700500: 7.2 },
    mesoscaleFields: { effectiveInflow: .68, moisturePooling: .55, initiationFocus: .2, convergenceCorridor: .2 },
    memory: { recovery: .8 },
    dynamics: { convectiveReadiness: .74, triggerStrength: .38, initiationPotential: .72, forcingScore: .45 },
    derived: { cape: 2600, cin: 165, bulkShear: 45, srh: 170, stp: 2.1, lcl: 1400, lclAgl: 1050 },
    ...overrides
  })));
  return {
    width, height, cellSizeKm: 10, validHourUtc: 21,
    scenarioMetadata: { setupType: 'dryline_cyclone', narrative: 'cap_bust' },
    evolution: { config: { setupType: 'dryline_cyclone', seed: 'test' } },
    storms: [], cells,
    getCell(x,y){ return x >= 0 && y >= 0 && x < width && y < height ? cells[y][x] : null; },
    forEachCell(fn){ for(let y=0;y<height;y++) for(let x=0;x<width;x++) fn(cells[y][x],x,y); }
  };
}

const capped = makeWorld();
initializeSetupForecast(capped);
const c = capped.getCell(4,4).forecast;
assert.ok(c.convectivePotential > .45, `supportive environment should retain broad potential: ${c.convectivePotential}`);
assert.ok(c.initiationProbability < c.convectivePotential * .45, `strong cap should sharply reduce actual CI: ${c.initiationProbability}`);
assert.ok(c.capFailureProbability < .55, `cap failure should remain conditional: ${c.capFailureProbability}`);
assert.equal(findInitiationCandidates(capped, [], 21).length, 0, 'uniform capped field should not create broad false CI candidates');

const forced = makeWorld();
for (let y=0;y<forced.height;y++) for (let x=0;x<forced.width;x++) {
  const cell=forced.getCell(x,y);
  const focus=Math.exp(-((x-4)**2+(y-4)**2)/3);
  cell.derived.cin=25;
  cell.dynamics.triggerStrength=.45+.5*focus;
  cell.features.synopticAscent=.55+.38*focus;
  cell.features.explicitBoundaryInfluence=.25+.7*focus;
  cell.mesoscaleFields.initiationFocus=.15+.8*focus;
  cell.mesoscaleFields.convergenceCorridor=.2+.7*focus;
}
initializeSetupForecast(forced);
updateSetupForecast(forced);
const f=forced.getCell(4,4).forecast;
assert.ok(f.initiationProbability > .25, `focused uncapped forcing should support initiation: ${f.initiationProbability}`);
assert.ok(f.initiationProbability > forced.getCell(1,1).forecast.initiationProbability * 2, 'CI should focus near the boundary maximum');
assert.ok(findInitiationCandidates(forced, [], 21).length >= 1, 'focused forcing should produce at least one candidate');
console.log('CI probability rewrite 2.28.0: ok');

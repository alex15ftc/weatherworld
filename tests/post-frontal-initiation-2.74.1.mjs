import assert from 'node:assert/strict';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';
import { diagnoseStormRealizationPhysics } from '../js/storms/StormRealizationPhysics.js';

let checkedPostFrontalCells = 0;
for (const seed of [740101, 740102, 740103, 740104]) {
  const world = new Atmosphere(30, 24);
  initializeEvolution(world, generateScenario(world, seed));
  for (let hour = 0; hour < 6; hour++) {
    advanceAtmosphere(world, 1);
    world.forEachCell(cell => {
      if (cell.airMass?.sector !== 'post-cold-front') return;
      checkedPostFrontalCells++;
      assert.ok(cell.surfaceParcelValidity.score <= 0.120001);
      assert.ok(cell.derived.cape <= cell.derived.surfaceBasedCapeUnmodified * 0.120001 + 1e-6);
      assert.ok(cell.derived.stp <= 0.150001, 'surface STP overlay must be suppressed behind the cold front');
      assert.equal(cell.features.warmSector, false);
    });
    for (const storm of world.storms) {
      if (storm.sourceCell?.airMassSector === 'post-cold-front') {
        assert.equal(storm.modeHistory?.[0]?.mode, 'elevated convection', 'post-frontal initiation must be explicitly elevated');
      }
    }
  }
}
assert.ok(checkedPostFrontalCells > 0, 'fixture must exercise the post-cold-frontal air mass');
const commonEnvironment = { cape: 2500, cin: 30, bulkShear: 45, srh: 180, lcl: 900, forcing: 0.7, parcelReleaseFraction: 0.9, surfaceParcelValidity: 0.9 };
const warmInflow = diagnoseStormRealizationPhysics(commonEnvironment, { mode: 'discrete supercell' });
const coldSide = diagnoseStormRealizationPhysics({ ...commonEnvironment, postFrontalFraction: 0.8, corePostFrontalFraction: 1, surfaceParcelValidity: 0.12 }, { mode: 'discrete supercell' });
assert.ok(coldSide.realizedUpdraftMs < warmInflow.realizedUpdraftMs * 0.2, 'surface storm must collapse after losing warm-sector inflow');
console.log(`2.74.1 post-frontal parcel and initiation authority passed across ${checkedPostFrontalCells} cell-hours`);

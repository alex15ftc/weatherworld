// The engine's ground is the game map's: the stored grid matches the generator, the divide stands where it should,
// and the regional layer stands its cells on it.
import assert from 'node:assert/strict';
import { computeEngineGroundReliefM, engineGroundReliefM } from '../js/worldmap/engineGround.js';
import { ENGINE_GROUND } from '../js/worldmap/engineGroundData.js';
import { REGIONAL_DEFAULTS, RegionalAtmosphere } from '../js/atmosphere/RegionalAtmosphere.js';
import { QuasiGeostrophicModel } from '../js/atmosphere/QuasiGeostrophicModel.js';

const N = REGIONAL_DEFAULTS.columns;
const made = computeEngineGroundReliefM(), stored = engineGroundReliefM();
let worst = 0;
for (let k = 0; k < made.length; k++) worst = Math.max(worst, Math.abs(made[k] - stored[k]));
assert.ok(worst < 0.01, `engineGroundData.js is out of date with the world map (by up to ${worst.toFixed(2)} m): run node scripts/build-engine-ground.mjs`);
assert.equal(ENGINE_GROUND.reliefM.length, N * REGIONAL_DEFAULTS.rows);

// The divide: 250-400 m above the slope at its western end, about a third of the way south; nothing of it in the east.
const flat = computeEngineGroundReliefM(REGIONAL_DEFAULTS, { divide: null });
const divideAt = (x, y) => made[y * N + x] - flat[y * N + x];
let crest = 0, crestRow = -1;
for (let y = 0; y < REGIONAL_DEFAULTS.rows; y++) if (divideAt(1, y) > crest) { crest = divideAt(1, y); crestRow = y; }
assert.ok(crest > 250 && crest < 400, `divide crest ${crest.toFixed(0)} m`);
assert.ok(crestRow >= 13 && crestRow <= 19, `divide crest row ${crestRow}`);
for (let y = 0; y < REGIONAL_DEFAULTS.rows; y++) assert.ok(Math.abs(divideAt(30, y)) < 15, `divide reaches column 30 (row ${y}: ${divideAt(30, y).toFixed(0)} m)`);
// Off the divide, the map's ground is the slope within its hills' and valleys' reach.
for (let k = 0; k < flat.length; k++) assert.ok(Math.abs(flat[k]) < 150, `relief ${flat[k].toFixed(0)} m at cell ${k}`);

// Other grids are not the map: no ground for them.
assert.equal(engineGroundReliefM({ columns: 20, rows: 20 }), null);
assert.equal(engineGroundReliefM({ geographyOffset: 0 }), null);

// The regional layer stands each cell on the slope plus the relief.
const model = new QuasiGeostrophicModel({ nx: 64, ny: 32, seed: 4, initialNoise: 4e-4 });
const regional = new RegionalAtmosphere(model, { groundReliefM: stored, diagnostics: false });
for (const [x, y] of [[1, crestRow], [25, 25], [45, 45]]) assert.ok(Math.abs(regional.world.cells[y][x].terrain.elevationM - (regional.terrainAt(x) + stored[y * N + x])) < 1e-9);
console.log(`engine ground ok: crest ${crest.toFixed(0)} m at row ${crestRow}, stored grid within ${worst.toFixed(3)} m`);

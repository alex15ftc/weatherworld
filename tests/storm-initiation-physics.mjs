import assert from 'node:assert/strict';
import { findInitiationCandidates } from '../js/storms/InitiationEngine.js';

// Synthetic 30x30 world: every cell gets a sounding and forcing from the supplied function.
function world(cellFor) {
  const width = 30, height = 30, cells = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells.push(cellFor(x, y));
  return { width, height, cellSizeKm: 16, getCell: (x, y) => cells[y * width + x], evolution: { config: { seed: 7 } }, stormOutflows: [] };
}
const cell = ({ mlcape = 2500, mlcin = 20, mucape = mlcape, mucin = mlcin, sbcape = mlcape, boundary = 0, synoptic = 0 }) => ({
  derived: { sounding: { mlcape, mlcin: -mlcin, mucape, mucin: -mucin, sbcape } },
  features: { boundaryConvergence: boundary, explicitBoundaryInfluence: boundary, synopticAscent: synoptic, primaryBoundaryType: boundary ? 'dryline' : null, primaryBoundaryId: boundary ? 'OBJ-DRYLINE-001' : null },
  dynamics: {}
});
const runSlots = (w, storms = [], slots = 16) => {
  let total = [];
  for (let i = 0; i < slots; i++) total = total.concat(findInitiationCandidates(w, storms, 18 + i * 0.5, 0.5));
  return total;
};

// A strongly capped warm sector without forcing produces no storms, even with large CAPE.
const capped = world(() => cell({ mlcin: 220, boundary: 0, synoptic: 0.3 }));
assert.equal(runSlots(capped).length, 0, 'forcing weaker than the cap must not initiate storms');

// A strong boundary through the same capped air is not enough either (lift 170 < CIN 220)...
const cappedBoundary = world((x) => cell({ mlcin: 220, boundary: x === 15 ? 0.9 : 0 }));
assert.equal(runSlots(cappedBoundary).length, 0, 'a boundary cannot lift parcels through a cap stronger than its lift');

// ...but where the cap is modest, storms form along the boundary and only there.
const forced = world((x) => cell({ mlcin: 60, boundary: x === 15 ? 0.9 : 0 }));
const formed = runSlots(forced);
assert.ok(formed.length >= 2, `boundary lift exceeding the cap should initiate storms (${formed.length})`);
assert.ok(formed.every(c => c.x === 15), 'storms must form where the lift exceeds the inhibition');
assert.ok(formed.every(c => c.liftEnergy > c.cin), 'every storm must have lift exceeding its CIN');

// Positions are continuous within the cell, not snapped to the grid.
assert.ok(new Set(formed.map(c => (c.xKm % 16).toFixed(1))).size > 1, 'initiation positions should vary within cells');

// An existing storm suppresses new updrafts right next to it.
const crowd = Array.from({ length: 30 }, (_, y) => ({ active: true, positionKm: { x: 15.5 * 16, y: (y + 0.5) * 16 } }));
assert.ok(runSlots(forced, crowd).length < formed.length, 'nearby storms must suppress new initiation');

// Elevated storms need a most-unstable parcel originating above the surface.
const elevatedAloft = world(() => cell({ mlcape: 800, mlcin: 200, mucape: 2200, mucin: 10, sbcape: 600, synoptic: 0.9 }));
const elevated = runSlots(elevatedAloft, [], 24);
assert.ok(elevated.length > 0 && elevated.every(c => c.elevated), 'synoptic ascent should release an uncapped elevated parcel');
const surfaceOnly = world(() => cell({ mlcape: 800, mlcin: 200, mucape: 2200, mucin: 0, sbcape: 2200, synoptic: 0.9 }));
assert.ok(runSlots(surfaceOnly, [], 24).every(c => !c.elevated), 'a surface-based most-unstable parcel is not elevated convection');

console.log(`storm initiation physics passed (${formed.length} boundary storms, ${elevated.length} elevated)`);

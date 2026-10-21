// Copies of the authoritative world. A forecast snapshot holds the physical state only (no
// issued products, histories or observation archives, and nothing a run works out again before
// it reads it: each cell's sounding figures, each storm's radar picture); a full snapshot
// holds everything needed to resume the world later. Both are safe to structured-clone or
// serialize. (The forecast one was a quarter the size of the full one while cells kept their
// whole sounding profiles; since 2026-10-17 they do not, and it is about 85%.)
import { Atmosphere } from '../atmosphere.js';

const SKIP_WORLD = new Set([
  'runtime', 'outlookCycle', 'meteorologicalIntegrityHistory',
  'stormArchive', 'stormHistory'
]);
const SKIP_CELL = new Set(['predictiveOutlook', 'thermodynamics']);

// Shallow-stripped view of the world. Pass { clone: true } for an independent deep copy;
// serializing or posting to a worker makes its own copy, so those can skip the clone.
export function snapshotWorld(world, { clone = false, full = false } = {}) {
  const state = {};
  for (const [key, value] of Object.entries(world)) {
    if (typeof value === 'function' || key === 'runtime' || (!full && SKIP_WORLD.has(key))) continue;
    if (key === 'cells' && !full) state[key] = value.map(row => row.map(stripCell));
    else if (key === 'storms' && !full) state[key] = value.map(storm => ({ ...storm, internalField: null }));
    // Queued issuances carry their own world snapshots; they are re-issued, not saved.
    else if (key === 'outlookCycle') state[key] = { ...value, pending: [], memberLog: undefined };
    else state[key] = value;
  }
  return clone ? structuredClone(state) : state;
}

// A working world from a snapshot (the snapshot object is adopted, not copied).
export function hydrateWorld(state, runtime) {
  const world = Object.assign(Object.create(Atmosphere.prototype), state);
  world.runtime = runtime;
  world.stormArchive ??= [];
  world.stormHistory ??= [];
  return world;
}

function stripCell(cell) {
  const out = {};
  for (const key in cell) if (!SKIP_CELL.has(key)) out[key] = cell[key];
  return out;
}

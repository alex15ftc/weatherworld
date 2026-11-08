// Expected tornadoes in a forecast run (I2 of docs/research/OUTLOOKS-MDS-WATCHES.md, 2026-11-05).
// A run's storms put a tornado down by chance: each 5-minute tick, a storm not already under one
// draws against the rate its low-level rotation gives (TornadoEngine tornadoRatePerHour of
// tornadoImminence). Which ticks come up is noise the forecast cannot know; the rate is what the
// run's storms really say. So beside the tornadoes its draws made, each run adds up the rate:
// rate x tick at the cell under the wall cloud (where the engine puts a tornado down), and for each
// strength tier the same times the share of tornadoes under that rotation whose wind reaches the
// tier (tornadoShareReaching of the engine's own wind spread). These are the expected tornado
// starts per cell over the run; a place's chance of one within a radius is 1 - exp(-their sum).
// Hail and wind are left as the runs' reports: the engine draws no rate for them (a storm's hail
// and gusts follow from its state; only the report log's who-reports draws are chance, and the
// truth has the same ones).
import { tornadoImminence, tornadoRatePerHour, tornadoWindScaleMph, tornadoShareReaching } from '../storms/TornadoEngine.js';

// The wind each tier of the outlooks' tornado fields begins at: EF2, EF3 and EF4 (the EF scale).
export const TORNADO_TIER_MPH = Object.freeze({ tornadoSig: 111, tornadoExtreme: 136, tornadoViolent: 166 });
export const EXPECTED_TORNADO_FIELDS = Object.freeze(['tornado', ...Object.keys(TORNADO_TIER_MPH)]);

export function expectedTornadoGrids(n) { return Object.fromEntries(EXPECTED_TORNADO_FIELDS.map(field => [field, new Float32Array(n)])); }

const cellOf = (world, at) => Math.min(world.height - 1, Math.max(0, Math.floor(at.y / world.cellSizeKm))) * world.width + Math.min(world.width - 1, Math.max(0, Math.floor(at.x / world.cellSizeKm)));
function add(world, grids, storm, amount) {
  const i = cellOf(world, storm.tornado?.positionKm ?? storm.positionKm);
  grids.tornado[i] += amount;
  const scale = tornadoWindScaleMph(storm.lowRotationFree ?? storm.lowRotation ?? 0, storm.tornado?.rawStp ?? 0);
  for (const [field, mph] of Object.entries(TORNADO_TIER_MPH)) if (grids[field]) grids[field][i] += amount * tornadoShareReaching(scale, mph);
}

// After a storm tick of `hours`: each storm not under a tornado adds its rate for the next tick.
export function addExpectedTornadoes(world, grids, hours) {
  if (!grids) return;
  for (const storm of world.storms ?? []) {
    if (!storm.active || storm.tornado?.onGround) continue;
    const rate = tornadoRatePerHour(tornadoImminence(storm));
    if (rate > 0) add(world, grids, storm, rate * hours);
  }
}

// Tornadoes already on the ground when a run (or a run's day) starts: not chance, they are there.
export function addOngoingTornadoes(world, grids) {
  if (!grids) return;
  for (const storm of world.storms ?? []) if (storm.active && storm.tornado?.onGround) add(world, grids, storm, 1);
}

// The chance (0-1) at each cell of at least one within the given cells around it (offsets: diskOffsets of the radius).
export function chanceWithin(expected, width, height, offsets) {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0;
    for (const [dx, dy] of offsets) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < width && Y < height) sum += expected[Y * width + X]; }
    out[y * width + x] = 1 - Math.exp(-sum);
  }
  return out;
}

// The chance of at least k events from a Poisson count of this mean.
export function poissonAtLeast(mean, k) {
  if (!(mean > 0)) return 0;
  let term = Math.exp(-mean), below = 0;
  for (let i = 0; i < k; i++) { below += term; term *= mean / (i + 1); }
  return Math.max(0, 1 - below);
}

// The wide window (2026-11-13, the owner's request): the regional layer (RegionalAtmosphere.js) run a second
// time on a wider, coarser grid around the game map, so that what that layer adds to the large-scale model
// (the lee trough and its southerly low-level wind, the cap's air off the high ground, the heated boundary
// layer, friction, the night's low-level jet) can be shown beyond the map's edges: the large-scale pages'
// CAPE, CIN, supercell composite and tornado parameter (server/SynopticRuntime.js). The large-scale model's own
// columns have none of it: their low-level winds do not turn with height, and the composites read near zero.
//
// It is for display only. It reads the large-scale model and the map's place; nothing of it goes back into the
// map, the storms or the large-scale model (the map's layer advances that model; this one never does). It has
// no storms and no cold pools. Its ground is the map's own geography carried on east and west as that layer
// defines it: the high ground holds to the west of the map's geography and the low plains to the east. It moves
// with the map, as the map's ground does.
//
// Where the window lies under the map it is given the map's own air each step (feed): the mean of the map's
// cells in each of its cells, for everything the layer carries from step to step. The wind then takes that air on
// through the rest of the window. Without it the window's middle, 1,600 km from its edges where moisture comes
// in, ran a day or two behind the map, whose edges are 400 km off (2026-11-13). Nothing goes the other way.
//
// Its cells are WIDE.factor map cells across (80 km, the large-scale model's spacing), WIDE.cells each way
// (3,200 km), with the map at its middle.
import { RegionalAtmosphere } from '../atmosphere/RegionalAtmosphere.js';

export const WIDE = Object.freeze({
  cells: 40, factor: 5,
  // How soon the window's air is drawn to what air entering at its place would be (the layer's
  // airMassRelaxationDays and moistTopDays; days). On the map air that blows in across an edge is given that, and
  // no place is more than about half a day's wind from an edge; the map's own two-day pull is on top of it. The
  // window's middle is 1,600 km from an edge, and with two days its air south and east of the map was the dry
  // air of the high ground far upwind (3.7 g/kg against the map's 15.9, no CAPE) for days at a time. With a
  // quarter of a day the ring of cells round the map's box follows the map's own edge strips on the south, east
  // and north (measured 2026-11-13, docs/STATUS.md); the west stays dry, which is the dryline.
  refreshDays: Number(process.env.WEATHER_WIDE_REFRESH_DAYS) || 0.25,
  // A window made afresh is not shown until it has run this long (wide.ageHours): its cap and the heated layer
  // of the days before take about a day to form.
  readyHours: 24
});

// What the layer carries from step to step. The storms' rain-cooled air, their anvils and the ground they have
// wetted go with it (the window has no storms of its own, but under the map it is the map's air as it is: left
// out, the map had no CAPE after a night of storms where the window just outside it had 1,000 J/kg, a line along
// the box's edge; the owner, 2026-11-13). Beyond the map that air drifts and fades by the layer's own rules.
const CARRIED = ['coldPool', 'wetGround', 'anvil', 'theta', 'moisture', 'eml', 'lidTheta', 'moistTop', 'heat', 'residualHeat', 'eveningTheta', 'nightTheta', 'mixedDepth', 'mixedTheta', 'eveningExcess', 'eveningDepth', 'surfaceMixingRatio', 'ageoU', 'ageoV', 'noseU', 'noseV', 'capLift'];

// Gives the window's cells under the map the map's air: each takes the mean of the map's cells it covers (the
// window is centred on the map and its cells are a whole number of the map's across, so they line up).
export function feed(wide, map) {
  const f = WIDE.factor, x0 = (wide.nx - map.nx / f) / 2, y0 = (wide.ny - map.ny / f) / 2;
  if (!Number.isInteger(x0) || !Number.isInteger(y0)) return;
  for (const key of CARRIED) {
    const from = map[key], to = wide[key];
    if (!(from instanceof Float64Array) || !(to instanceof Float64Array)) continue;
    for (let wy = 0; wy < map.ny / f; wy++) for (let wx = 0; wx < map.nx / f; wx++) {
      let sum = 0;
      for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) sum += from[(wy * f + j) * map.nx + wx * f + i];
      to[(y0 + wy) * wide.nx + x0 + wx] = sum / (f * f);
    }
  }
}

const arraysOf = object => Object.fromEntries(Object.entries(object).filter(([, value]) => value instanceof Float64Array || value instanceof Float32Array));

// Puts the window about the map: its place in the large-scale model, the same north-south reference as the
// map's (so its climate is the map's), and the geography under it.
function place(wide, map) {
  const span = wide.nx * wide.dx, length = wide.model.lengthX;
  wide.origin.x = (((map.origin.x + map.nx * map.dx / 2 - span / 2) % length) + length) % length;
  wide.origin.y = map.origin.y + map.ny * map.dx / 2 - span / 2;
  wide.homeY = wide.origin.y - (map.origin.y - map.homeY);
  // The geography is counted in cells from its western edge: the same ground under the same place.
  const west = map.nx * map.dx / 2 - span / 2;   // the window's western edge from the map's (m; negative)
  const offset = (west + 0.5 * (wide.dx - map.dx) + map.geographyOffset * map.dx) / wide.dx;
  if (offset !== wide.geographyOffset) {
    wide.geographyOffset = wide.geographyTarget = offset; wide.geographyVersion++;
    wide.world.forEachCell((cell, x) => { cell.terrain.elevationM = wide.terrainAt(x); });
  }
}

// The window for a map's layer. saved: what saveWide kept of one (a restart, or a forecast run's start);
// without it the window starts from the air masses the large-scale model gives, and is ready WIDE.readyHours on.
export function createWide(map, saved = null) {
  const p = map.params, columns = (p.geographyColumns ?? map.nx);
  const wide = new RegionalAtmosphere(map.model, {
    ...p, columns: WIDE.cells, rows: WIDE.cells, cellKm: p.cellKm * WIDE.factor,
    // (the geography's width in this window's cells; its offset is set by place)
    geographyColumns: (columns - 1) / WIDE.factor + 1, geographyOffset: 0, diagnostics: false, startHourUtc: map.hourUtc,
    airMassRelaxationDays: WIDE.refreshDays, moistTopDays: WIDE.refreshDays
  });
  if (saved) {
    for (const [key, values] of Object.entries(saved.arrays)) wide[key] = values;
    wide.sunsetHour = saved.sunsetHour; wide.midReference = saved.midReference; wide.gulfSupply = saved.gulfSupply;
    // (so that place sets the ground again under the restored air)
    wide.geographyOffset = NaN;
  }
  place(wide, map);
  wide.hourUtc = map.hourUtc;
  wide.ageHours = saved?.ageHours ?? 0;
  if (!saved) feed(wide, map);
  wide.fill(0);
  return wide;
}

// Call after the map's layer has stepped (it has advanced the large-scale model): the window follows the map
// and works its own processes over the same time.
export function stepWide(wide, map) {
  place(wide, map);
  // (no 500 mb height change is worked out here: the window has moved with the map since its last look)
  wide.previousMid = null;
  wide.gulfSupply = map.gulfSupply;
  wide.hourUtc = map.hourUtc; wide.ageHours += map.params.stepSeconds / 3600;
  wide.fill(map.params.stepSeconds);
  // (after its own step, so that what is kept, shown and carried on next step is the map's air under the map)
  feed(wide, map);
  wide.fill(0);
}

export const wideReady = wide => Boolean(wide) && wide.ageHours >= WIDE.readyHours - 1e-6;

export const saveWide = wide => ({ arrays: arraysOf(wide), ageHours: wide.ageHours, sunsetHour: wide.sunsetHour, midReference: wide.midReference, gulfSupply: wide.gulfSupply });

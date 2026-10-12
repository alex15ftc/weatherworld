// The redesigned atmosphere as a world that storms can run on (stage 4 of
// docs/ATMOSPHERE-REDESIGN.md). It owns the outer model, the regional layer and the boundary
// analysis, and after each atmosphere step works out, from the fields alone, the things the
// storm engine reads from a cell: soundings, lift where the surface winds converge, ascent
// ahead of troughs (500 mb height falls) and upslope flow. Nothing here knows what kind of
// day it is supposed to be, and nothing is drawn around a front for storms to find.
import { QuasiGeostrophicModel } from '../atmosphere/QuasiGeostrophicModel.js';
import { RegionalAtmosphere } from '../atmosphere/RegionalAtmosphere.js';
import { analyseBoundaries } from '../atmosphere/BoundaryAnalysis.js';
import { updateCellDiagnostics } from '../sounding.js';
import { diagnoseForcing } from '../diagnostics/forcingDiagnosis.js';
import { updateMesoscaleFields } from '../mesoscale/MesoscaleFieldEngine.js';
import { initializeStormEngine, advanceStormEngine, applyStormFeedback } from '../storms/StormEngine.js';
import { snapshotWorld, hydrateWorld } from './worldSnapshot.js';
import { clamp } from '../scenarios/math.js';
import { RegionSteering } from './RegionSteering.js';

const ramp = (value, low, high) => clamp((value - low) / (high - low), 0, 1);

const STATE_VERSION = 3;

export const STORM_COUPLING = Object.freeze({
  // Surface convergence (the same measure and range the storm engine was built with:
  // difference in wind, kt, across two cells, over 8 x their distance in km) that counts as
  // weak to strong lift, and how much of the previous half hour's lift carries over.
  convergenceLiftRange: [0.005, 0.028], liftMemory: 0.72,
  // 500 mb height falls (dam per 12 h) from weak to strong ascent, smoothed over this long.
  // Lifting cools the capping layer (and sinking warms it) by this much at full strength (C).
  heightFallRangeDm: [1.5, 9], ascentMemoryHours: 2, capCoolingC: 1.5, capWarmingC: 0.5,
  // Contrast (K or g/kg per 100 km) of a strong front or dryline, for the strength shown on maps.
  strongFrontContrast: 6, strongDrylineContrast: 10,
  // Warming aloft and drying of the inflow layer by storms fade over this long.
  stormAirRecoveryHours: 3,
  // Storms at least this strong leave rain-cooled air; it is centred this share of its
  // radius behind the storm. Its coldest air is this much colder (K) for the strongest cold
  // pool the storm engine produces (rain evaporating into dry air under a strong storm).
  coldPoolMinStrength: 0.22, coldPoolTrailShare: 0.7, coldPoolDeficitK: 18
});

export class AtmosphereWorld {
  // Pass `model` to share an already spun-up outer model (it is advanced by this world).
  // steering: settings for RegionSteering, or false to keep the region where it starts.
  constructor({ seed = 1, spinUpDays = 45, model = null, regional = {}, storms = true, steering = {} } = {}) {
    this.seed = seed;
    this.model = model ?? new QuasiGeostrophicModel({ seed });
    if (!model) this.model.advance(spinUpDays * 86400);
    // Soundings are computed here, after the storms' own cooling has been put back in.
    this.regional = new RegionalAtmosphere(this.model, { ...regional, diagnostics: false });
    const world = this.world = this.regional.world, n = world.width * world.height;
    world.evolution = { config: { seed } };
    world.runtime = { profile: { name: 'atmosphere-world', stormSubstepsPerHour: 12, verification: false } };
    // What storms have done to the air aloft and to the inflow layer (C), fading with time.
    // (Their rain-cooled air at the ground is in the regional layer: its cold pools.)
    this.stormAir = { mid: new Float32Array(n), inflow: new Float32Array(n) };
    // Slope of the ground (m per km, toward the east and toward the south), for upslope lift.
    const elevation = (x, y) => world.cells[clamp(y, 0, world.height - 1)][clamp(x, 0, world.width - 1)].terrain.elevationM;
    world.forEachCell((cell, x, y) => { cell.terrain.slopeX = (elevation(x + 1, y) - elevation(x - 1, y)) / (2 * world.cellSizeKm); cell.terrain.slopeY = (elevation(x, y + 1) - elevation(x, y - 1)) / (2 * world.cellSizeKm); });
    this.stormsEnabled = storms;
    this.boundaries = [];
    this.steering = steering ? new RegionSteering(this.regional, seed, steering) : null;
    this.steering?.update();
    this.prepare(0);
    if (storms) initializeStormEngine(world);
  }

  get hourUtc() { return this.regional.hourUtc; }

  // Everything needed to carry on later from exactly here (safe to serialize; the arrays are
  // the live ones, so serialize before advancing again).
  saveState() {
    const model = this.model, regional = this.regional;
    const arraysOf = object => Object.fromEntries(Object.entries(object).filter(([, value]) => value instanceof Float64Array || value instanceof Float32Array));
    return {
      version: STATE_VERSION, seed: this.seed,
      model: { params: model.params, time: model.time, history: model.history, q1: model.q1, q2: model.q2, psi1: model.psi1, psi2: model.psi2 },
      regional: { params: regional.params, hourUtc: regional.hourUtc, sunsetHour: regional.sunsetHour, midReference: regional.midReference, gulfSupply: regional.gulfSupply, originX: regional.origin.x, slideMs: regional.slideMs, arrays: arraysOf(regional) },
      steering: this.steering?.saveState() ?? null,
      heightFall: this.heightFall, stormAir: this.stormAir, stormsEnabled: this.stormsEnabled,
      world: snapshotWorld(this.world, { full: true })
    };
  }

  // The world a saved state describes, or null when the state is from an older layout.
  static restore(state) {
    if (state?.version !== STATE_VERSION) return null;
    const model = new QuasiGeostrophicModel(state.model.params);
    for (const key of ['q1', 'q2', 'psi1', 'psi2']) model[key].set(state.model[key]);
    model.time = state.model.time; model.history = state.model.history;
    const restored = new AtmosphereWorld({ seed: state.seed, model, regional: state.regional.params, storms: false, steering: state.steering ? state.steering.params : false });
    const regional = restored.regional;
    regional.origin.x = state.regional.originX; regional.slideMs = state.regional.slideMs;
    if (state.steering) restored.steering.restoreState(state.steering);
    for (const [key, values] of Object.entries(state.regional.arrays)) regional[key] = values;
    regional.hourUtc = state.regional.hourUtc; regional.sunsetHour = state.regional.sunsetHour; regional.midReference = state.regional.midReference; regional.gulfSupply = state.regional.gulfSupply;
    const world = hydrateWorld(state.world, restored.world.runtime);
    regional.world = restored.world = world;
    restored.heightFall = state.heightFall; restored.stormAir = state.stormAir; restored.stormsEnabled = state.stormsEnabled;
    restored.boundaries = world.mesoscale?.boundaries ?? [];
    return restored;
  }

  // Advances the atmosphere in half-hour steps, and the storms with it. A live clock moves
  // the storms itself in short ticks (advanceStormLayer) and passes advanceStorms: false here,
  // so that only their effect on the air is applied at each atmosphere step.
  advance(hours = 0.5, { advanceStorms = true } = {}) {
    const stepHours = this.regional.params.stepSeconds / 3600, steps = Math.max(1, Math.round(hours / stepHours));
    for (let step = 0; step < steps; step++) {
      this.regional.step();
      this.steering?.update();
      this.prepare(stepHours);
      if (this.stormsEnabled) this.withStormEffects(() => (advanceStorms ? advanceStormEngine(this.world, stepHours) : applyStormFeedback(this.world, stepHours)));
    }
  }

  // Moves the storms alone, between atmosphere steps (they may run up to a step ahead of it).
  advanceStormLayer(hours = 1 / 12) {
    if (this.stormsEnabled && hours > 0) advanceStormEngine(this.world, hours, { applyFeedback: false, initiate: true });
  }

  // Storms warm the air aloft and dry their inflow layer. The regional layer rewrites the
  // cells each step, so what the storms did is kept here and put back, fading with time.
  // Their rain-cooled air goes into the regional layer as cold pools.
  withStormEffects(run) {
    const world = this.world, { width } = world, air = this.stormAir, c = STORM_COUPLING;
    const before = { mid: new Float32Array(air.mid.length), inflow: new Float32Array(air.mid.length) };
    world.forEachCell((cell, x, y) => { const k = y * width + x; before.mid[k] = cell.levels[500].temperature; before.inflow[k] = cell.levels[850].dewpoint; });
    run();
    world.forEachCell((cell, x, y) => {
      const k = y * width + x;
      air.mid[k] += cell.levels[500].temperature - before.mid[k]; air.inflow[k] += cell.levels[850].dewpoint - before.inflow[k];
    });
    // Each storm's rain-cooled air goes into the atmosphere as a cold pool, centred behind
    // the storm (its inflow side stays in the warm air).
    for (const storm of world.storms) {
      if (!storm.active || storm.intensity < c.coldPoolMinStrength || !(storm.coldPoolStrength > 0)) continue;
      const speed = Math.hypot(storm.velocityKph.east, storm.velocityKph.north) || 1, radius = Math.max(8, storm.coldPoolRadiusKm ?? 8), back = c.coldPoolTrailShare * radius;
      this.regional.addColdPool(storm.positionKm.x - storm.velocityKph.east / speed * back, storm.positionKm.y + storm.velocityKph.north / speed * back, radius, c.coldPoolDeficitK * storm.coldPoolStrength);
    }
  }

  // Everything the storm engine reads, from the fields as they are now.
  prepare(dtHours) {
    const world = this.world, { width, height } = world, cellKm = world.cellSizeKm, c = STORM_COUPLING, air = this.stormAir;
    const fade = dtHours > 0 ? Math.exp(-dtHours / c.stormAirRecoveryHours) : 1;

    // --- Ascent ahead of troughs (500 mb heights falling) and sinking behind them; what they
    // do to the cap; air modified by storms; then the soundings of the result.
    const ascentBlend = dtHours > 0 ? 1 - Math.exp(-dtHours / c.ascentMemoryHours) : 1;
    this.heightFall ??= new Float32Array(width * height);
    world.forEachCell((cell, x, y) => {
      const k = y * width + x, features = cell.features;
      this.heightFall[k] += (-(Number(cell.levels[500].heightTendencyDm12h) || 0) - this.heightFall[k]) * ascentBlend;
      features.synopticAscent = ramp(this.heightFall[k], c.heightFallRangeDm[0], c.heightFallRangeDm[1]);
      features.synopticSubsidence = ramp(-this.heightFall[k], c.heightFallRangeDm[0], c.heightFallRangeDm[1]);
      cell.levels[700].temperature += c.capWarmingC * features.synopticSubsidence - c.capCoolingC * features.synopticAscent;
      air.mid[k] *= fade; air.inflow[k] *= fade;
      if (air.mid[k] || air.inflow[k]) {
        cell.levels[500].temperature += air.mid[k]; cell.levels[700].temperature += 0.4 * air.mid[k];
        cell.levels[850].dewpoint += air.inflow[k];
      }
      updateCellDiagnostics(cell);
    });

    // --- Lines: fronts, drylines and outflow boundaries from the fields, for the maps and the
    // radar. Storms do not read them: they feel a line only through the winds and the air.
    this.boundaries = analyseBoundaries(world).boundaries.map(line => ({
      ...line, strength: clamp(line.contrast / (line.type === 'dryline' ? c.strongDrylineContrast : c.strongFrontContrast), 0.2, 1)
    }));
    world.mesoscale = { boundaries: this.boundaries };
    // --- Lift and ascent.
    const wind = (x, y) => { const w = world.cells[clamp(y, 0, height - 1)][clamp(x, 0, width - 1)].surface.wind, d = w.direction * Math.PI / 180; return { east: -Math.sin(d) * w.speed, north: -Math.cos(d) * w.speed }; };
    const liftMemory = dtHours > 0 ? c.liftMemory : 0;
    world.forEachCell((cell, x, y) => {
      const k = y * width + x, features = cell.features, dynamics = cell.dynamics ??= {};
      const e = wind(x + 1, y), w = wind(x - 1, y), north = wind(x, y - 1), south = wind(x, y + 1);
      const convergence = clamp(-((e.east - w.east) + (north.north - south.north)) / (2 * cellKm * 8), -1, 1);
      dynamics.kinematicConvergence = convergence;
      const lift = ramp(convergence, c.convergenceLiftRange[0], c.convergenceLiftRange[1]);
      features.convergenceLift = (Number(features.convergenceLift) || 0) * liftMemory + lift * (1 - liftMemory);
      features.boundaryConvergence = clamp((Number(features.boundaryConvergence) || 0) * liftMemory + Math.max(0, convergence) * (1 - liftMemory), 0, 1);
    });
    // The storm engine's own diagnoses of the fields: convergence, moisture convergence,
    // upslope flow, divergence aloft and how ready the air is; then the inflow each storm draws on.
    diagnoseForcing(world);
    updateMesoscaleFields(world, dtHours);
  }
}

// The redesigned atmosphere as a world that storms can run on (stage 4 of
// docs/ATMOSPHERE-REDESIGN.md). It owns the outer model, the regional layer and the boundary
// analysis, and after each atmosphere step works out, from the fields alone, the things the
// storm engine reads from a cell: soundings, lift where the surface winds converge, ascent
// ahead of troughs (500 mb height falls) and upslope flow. Nothing here knows what kind of
// day it is supposed to be, and nothing is drawn around a front for storms to find.
import { QuasiGeostrophicModel } from '../atmosphere/QuasiGeostrophicModel.js';
import { spunUpModel } from '../atmosphere/spinUpCache.node.js';
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

const STATE_VERSION = 4;
const ISENTROPIC_STABILITY = 0.003;   // K per m: the least stability isentropic lift is worked out with

export const STORM_COUPLING = Object.freeze({
  // Surface convergence (the same measure and range the storm engine was built with:
  // difference in wind, kt, across two cells, over 8 x their distance in km) that counts as
  // weak to strong lift, and how much of the previous half hour's lift carries over.
  convergenceLiftRange: [0.005, 0.028], liftMemory: 0.72,
  // The outer model's ascent (K per hour of cooling of its 250-750 mb layer) from weak to strong,
  // smoothed over this long. It works on the cap in the regional layer (capLift there); here it
  // is only described, for the storm engine's forcing diagnosis and elevated parcels.
  ascentRangeKh: [0.03, 0.25], ascentMemoryHours: 2,
  // Contrast (K or g/kg per 100 km) of a strong front or dryline, for the strength shown on maps.
  strongFrontContrast: 6, strongDrylineContrast: 10,
  // Warming aloft and drying of the inflow layer by storms fade over this long.
  stormAirRecoveryHours: 3,
  // Storms at least this strong leave rain-cooled air; it is centred this share of its
  // radius behind the storm. Its coldest air is this much colder (K) for the strongest cold
  // pool the storm engine produces (rain evaporating into dry air under a strong storm).
  // (18 to 12 on 2026-10-19: Oklahoma Mesonet cold pools run 5-10 K, above 11 K by day, Engerer
  // et al. 2008; with up to 1.2 strength that is now at most about 14 K.)
  coldPoolMinStrength: 0.22, coldPoolTrailShare: 0.7, coldPoolDeficitK: 12,
  // Storms at least this strong spread an anvil of cirrus, anvilKm plus anvilKmPerStrength times
  // their strength in radius, as thick as anvilShare times their strength (2026-10-19).
  anvilMinStrength: 0.3, anvilKm: 20, anvilKmPerStrength: 60, anvilShare: 1.5
});

export class AtmosphereWorld {
  // Pass `model` to share an already spun-up outer model (it is advanced by this world).
  // steering: settings for RegionSteering, or false to keep the region where it starts.
  // plan: false leaves the first steering plan unmade (a restored world is given its saved one).
  constructor({ seed = 1, spinUpDays = 45, model = null, regional = {}, storms = true, steering = {}, plan = true } = {}) {
    this.seed = seed;
    // (A spin-up already run for this seed is read back from disk: spinUpCache.node.js.)
    this.model = model ?? spunUpModel({ seed }, spinUpDays * 86400);
    // Soundings are computed here, after the storms' own cooling has been put back in.
    this.regional = new RegionalAtmosphere(this.model, { ...regional, diagnostics: false });
    const world = this.world = this.regional.world, n = world.width * world.height;
    world.evolution = { config: { seed } };
    world.runtime = { profile: { name: 'atmosphere-world', stormSubstepsPerHour: 12, verification: false } };
    // What storms have done to the air aloft and to the inflow layer (C), fading with time.
    // (Their rain-cooled air at the ground is in the regional layer: its cold pools.)
    this.stormAir = { mid: new Float32Array(n), inflow: new Float32Array(n) };
    // Slope of the ground (m per km, toward the east and toward the south), for upslope lift.
    // (Recomputed when the map moves along the geography; reads the world as it is now, since a
    // restored world replaces the one built here.)
    this.updateSlopes = () => {
      const w = this.world, elevation = (x, y) => w.cells[clamp(y, 0, w.height - 1)][clamp(x, 0, w.width - 1)].terrain.elevationM;
      w.forEachCell((cell, x, y) => { cell.terrain.slopeX = (elevation(x + 1, y) - elevation(x - 1, y)) / (2 * w.cellSizeKm); cell.terrain.slopeY = (elevation(x, y + 1) - elevation(x, y - 1)) / (2 * w.cellSizeKm); });
      this.slopeVersion = this.regional.geographyVersion;
    };
    this.updateSlopes();
    this.stormsEnabled = storms;
    this.boundaries = [];
    this.steering = steering ? new RegionSteering(this.regional, seed, steering) : null;
    if (plan) this.steering?.update();
    this.prepare(0);
    if (storms) initializeStormEngine(world);
  }

  get hourUtc() { return this.regional.hourUtc; }

  // Everything needed to carry on later from exactly here (safe to serialize; the arrays are
  // the live ones, so serialize before advancing again).
  // forecast: the smaller copy a forecast run starts from (worldSnapshot.js). A run from it
  // goes exactly as one from the full copy, but the live world is not resumed from it.
  saveState({ forecast = false } = {}) {
    const model = this.model, regional = this.regional;
    const arraysOf = object => Object.fromEntries(Object.entries(object).filter(([, value]) => value instanceof Float64Array || value instanceof Float32Array));
    return {
      version: STATE_VERSION, seed: this.seed,
      model: { params: model.params, time: model.time, history: model.history, q1: model.q1, q2: model.q2, psi1: model.psi1, psi2: model.psi2, moisture: model.moisture, ascentCooling: model.ascentCooling, surfaceTheta: model.surfaceTheta, surfaceMoisture: model.surfaceMoisture },
      regional: { params: regional.params, hourUtc: regional.hourUtc, sunsetHour: regional.sunsetHour, midReference: regional.midReference, gulfSupply: regional.gulfSupply, originX: regional.origin.x, originY: regional.origin.y, homeY: regional.homeY, slideMs: regional.slideMs, slideNorthMs: regional.slideNorthMs, geography: { offset: regional.geographyOffset, target: regional.geographyTarget, rate: regional.geographyRate }, arrays: arraysOf(regional) },
      steering: this.steering?.saveState() ?? null,
      ascent: this.ascent, stormAir: this.stormAir, stormsEnabled: this.stormsEnabled,
      world: snapshotWorld(this.world, { full: !forecast })
    };
  }

  // The world a saved state describes, or null when the state is from an older layout.
  static restore(state) {
    if (state?.version !== STATE_VERSION) return null;
    const model = new QuasiGeostrophicModel(state.model.params);
    for (const key of ['q1', 'q2', 'psi1', 'psi2', 'moisture', 'ascentCooling', 'surfaceTheta', 'surfaceMoisture']) if (state.model[key]) model[key].set(state.model[key]);
    model.time = state.model.time; model.history = state.model.history;
    const restored = new AtmosphereWorld({ seed: state.seed, model, regional: state.regional.params, storms: false, steering: state.steering ? state.steering.params : false, plan: false });
    const regional = restored.regional;
    regional.origin.x = state.regional.originX; regional.slideMs = state.regional.slideMs;
    if (Number.isFinite(state.regional.originY)) { regional.origin.y = state.regional.originY; regional.homeY = state.regional.homeY; regional.slideNorthMs = state.regional.slideNorthMs ?? 0; }
    if (state.regional.geography) { regional.geographyOffset = state.regional.geography.offset; regional.geographyTarget = state.regional.geography.target; regional.geographyRate = state.regional.geography.rate; regional.geographyVersion++; }
    if (state.steering) restored.steering.restoreState(state.steering);
    for (const [key, values] of Object.entries(state.regional.arrays)) regional[key] = values;
    regional.hourUtc = state.regional.hourUtc; regional.sunsetHour = state.regional.sunsetHour; regional.midReference = state.regional.midReference; regional.gulfSupply = state.regional.gulfSupply;
    const world = hydrateWorld(state.world, restored.world.runtime);
    regional.world = restored.world = world;
    restored.ascent = state.ascent; restored.stormAir = state.stormAir; restored.stormsEnabled = state.stormsEnabled;
    restored.boundaries = world.mesoscale?.boundaries ?? [];
    return restored;
  }

  // Advances the atmosphere in half-hour steps, and the storms with it. A live clock moves
  // the storms itself in short ticks (advanceStormLayer) and passes advanceStorms: false here,
  // so that only their effect on the air is applied at each atmosphere step. `onStep` is
  // called after every step, for a caller that keeps a record of each one.
  advance(hours = 0.5, { advanceStorms = true, onStep } = {}) {
    const stepHours = this.regional.params.stepSeconds / 3600, steps = Math.max(1, Math.round(hours / stepHours));
    for (let step = 0; step < steps; step++) {
      this.regional.step();
      if (this.regional.geographyVersion !== this.slopeVersion) this.updateSlopes();
      this.steering?.update();
      this.prepare(stepHours);
      if (this.stormsEnabled) this.withStormEffects(() => (advanceStorms ? advanceStormEngine(this.world, stepHours) : applyStormFeedback(this.world, stepHours)));
      if (advanceStorms && this.stormsEnabled) this.onStormTick?.();
      onStep?.();
    }
  }

  // Moves the storms alone, between atmosphere steps (they may run up to a step ahead of it).
  // onStormTick, when set (the live world's storm log, js/reports/stormLog.js), is called after
  // each move of the storms.
  advanceStormLayer(hours = 1 / 12) {
    if (this.stormsEnabled && hours > 0) { advanceStormEngine(this.world, hours, { applyFeedback: false, initiate: true }); this.onStormTick?.(); }
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
    for (const storm of world.storms) if (storm.active && storm.intensity >= c.anvilMinStrength) this.regional.addAnvil(storm.positionKm.x, storm.positionKm.y, c.anvilKm + c.anvilKmPerStrength * storm.intensity, Math.min(1, c.anvilShare * storm.intensity));
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

    // --- Large-scale ascent and sinking (the outer model's own; the cap has already felt them
    // in the regional layer); air modified by storms; then the soundings of the result.
    const ascentBlend = dtHours > 0 ? 1 - Math.exp(-dtHours / c.ascentMemoryHours) : 1;
    this.ascent ??= new Float32Array(width * height);
    world.forEachCell((cell, x, y) => {
      const k = y * width + x, features = cell.features;
      this.ascent[k] += ((Number(features.ascentCoolingKh) || 0) - this.ascent[k]) * ascentBlend;
      features.synopticAscent = ramp(this.ascent[k], c.ascentRangeKh[0], c.ascentRangeKh[1]);
      features.synopticSubsidence = ramp(-this.ascent[k], c.ascentRangeKh[0], c.ascentRangeKh[1]);
      air.mid[k] *= fade; air.inflow[k] *= fade;
      if (air.mid[k] || air.inflow[k]) {
        cell.levels[500].temperature += air.mid[k]; cell.levels[700].temperature += 0.4 * air.mid[k];
        cell.levels[850].dewpoint += air.inflow[k];
      }
      updateCellDiagnostics(cell);
    });

    // --- Lines: fronts, drylines and outflow boundaries from the fields, for the maps and the
    // radar. Storms do not read them: they feel a line only through the winds and the air.
    const analysis = analyseBoundaries(world, { previous: this.boundaries, previousHours: dtHours });
    // How fast the moisture changes here (g/kg per 100 km, smoothed as the analysis smooths): a dryline.
    world.forEachCell((cell, x, y) => { cell.features.moistureGradientGkg100 = analysis.fields.moistureGradient[y * width + x]; });
    this.boundaries = analysis.boundaries.map(line => ({
      ...line, strength: clamp(line.contrast / (line.type === 'dryline' ? c.strongDrylineContrast : c.strongFrontContrast), 0.2, 1)
    }));
    world.mesoscale = { boundaries: this.boundaries };
    // --- How fast the density of the air masses changes across a place (K of virtual potential
    // temperature per 100 km, smoothed as the front analysis smooths): a front. Moist air is
    // lighter, so a dryline has little of it; storms' rain-cooled air is left out (its edge is
    // the outflow contrast). Storms near a front take in the spin it makes (StormRotation.js).
    {
      const density = new Float64Array(width * height);
      world.forEachCell((cell, x, y) => {
        const theta = (Number(cell.features.airMassThetaK) || 0) + (Number(cell.features.coldPoolK) || 0), dewC = (cell.surface.dewpoint - 32) * 5 / 9;
        const vapour = 6.112 * Math.exp(17.67 * dewC / (dewC + 243.5)), mixing = 0.622 * vapour / Math.max(100, (cell.surface.pressure || 1000) - vapour);
        density[y * width + x] = theta * (1 + 0.61 * mixing);
      });
      let field = density;
      for (let pass = 0; pass < 2; pass++) {
        const out = new Float64Array(field.length);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          let sum = 0, count = 0;
          for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) { sum += field[yy * width + xx]; count++; }
          out[y * width + x] = sum / count;
        }
        field = out;
      }
      world.forEachCell((cell, x, y) => {
        const e = Math.min(width - 1, x + 1), w = Math.max(0, x - 1), s = Math.min(height - 1, y + 1), n = Math.max(0, y - 1);
        const gx = (field[y * width + e] - field[y * width + w]) / ((e - w) * cellKm), gy = (field[s * width + x] - field[n * width + x]) / ((s - n) * cellKm);
        cell.features.densityGradientK100 = Math.hypot(gx, gy) * 100;
      });
    }
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
    // Lift for parcels above the ground: warm, moist air carried up over cooler air (isentropic
    // ascent: the change of 850 mb potential temperature following the air, over the stability
    // above it; a pattern that only moves with the wind lifts nothing) and the convergence of
    // the 850 mb wind, strongest where the low-level jet ends (taken through 1 km).
    const level = (x, y, p) => world.cells[clamp(y, 0, height - 1)][clamp(x, 0, width - 1)].levels[p];
    const theta = (x, y, p) => (level(x, y, p).temperature + 273.15) * (1000 / p) ** 0.2857;
    const wind850 = (x, y) => { const l = level(x, y, 850), d = l.windDirection * Math.PI / 180, s = l.windSpeed * 0.514444; return { east: -Math.sin(d) * s, north: -Math.cos(d) * s }; };
    // (The 850 mb field is smoothed twice first, as the front analysis smooths, so that the grid's
    // own unevenness is not taken for lift; and the stability is at least ISENTROPIC_STABILITY:
    // where the layer is nearly well mixed, under the elevated mixed layer, air is not lifted
    // along it, it mixes.)
    const metres = cellKm * 1000, previous = this.previousTheta850;
    let current = new Float32Array(width * height);
    world.forEachCell((cell, x, y) => { current[y * width + x] = theta(x, y, 850); });
    for (let pass = 0; pass < 2; pass++) {
      const out = new Float32Array(width * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let sum = 0, count = 0;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) { sum += current[yy * width + xx]; count++; }
        out[y * width + x] = sum / count;
      }
      current = out;
    }
    const smoothTheta = (x, y) => current[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)];
    // The 850 mb wind, smoothed the same way, for its convergence.
    let jetEast = new Float32Array(width * height), jetNorth = new Float32Array(width * height);
    world.forEachCell((cell, x, y) => { const v = wind850(x, y); jetEast[y * width + x] = v.east; jetNorth[y * width + x] = v.north; });
    for (let pass = 0; pass < 2; pass++) {
      const outEast = new Float32Array(width * height), outNorth = new Float32Array(width * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let east = 0, north = 0, count = 0;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) { east += jetEast[yy * width + xx]; north += jetNorth[yy * width + xx]; count++; }
        outEast[y * width + x] = east / count; outNorth[y * width + x] = north / count;
      }
      jetEast = outEast; jetNorth = outNorth;
    }
    const jet = (x, y) => { const k = clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1); return { east: jetEast[k], north: jetNorth[k] }; };
    world.forEachCell((cell, x, y) => {
      const here = wind850(x, y), dThetaEast = (smoothTheta(x + 1, y) - smoothTheta(x - 1, y)) / (2 * metres), dThetaNorth = (smoothTheta(x, y - 1) - smoothTheta(x, y + 1)) / (2 * metres);
      const localChange = previous && dtHours > 0 ? (current[y * width + x] - previous[y * width + x]) / (dtHours * 3600) : 0;
      const warmAdvection = -(here.east * dThetaEast + here.north * dThetaNorth) - localChange;   // K/s, following the air
      const stability = Math.max(ISENTROPIC_STABILITY, (theta(x, y, 700) - theta(x, y, 850)) / 1500);   // K/m
      cell.features.isentropicLiftMs = clamp(warmAdvection / stability, 0, 0.3);
      const e = jet(x + 1, y), w = jet(x - 1, y), n = jet(x, y - 1), s = jet(x, y + 1);
      cell.features.jetConvergenceLiftMs = clamp(-((e.east - w.east) + (n.north - s.north)) / (2 * metres) * 1000, 0, 0.3);
    });
    if (dtHours > 0) this.previousTheta850 = current;
    // The storm engine's own diagnoses of the fields: convergence, moisture convergence,
    // upslope flow, divergence aloft and how ready the air is; then the inflow each storm draws on.
    diagnoseForcing(world);
    updateMesoscaleFields(world, dtHours);
  }
}

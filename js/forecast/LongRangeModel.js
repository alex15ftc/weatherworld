// The long range model (2026-11-13, the owner's request; the game's medium-range run). One run from the live
// world at each 06Z, LONG_RANGE.hours (7 days) ahead, shown across the whole large-scale model on the model
// pages (/models/long-range).
//
// It is a copy of the world stepped ahead without storms (which storm forms where is dice beyond a day or so),
// with one forecast error of its own: a timing error (ensemblePerturbation.js), the commonest way a real forecast
// goes wrong. Its weather systems travel a little faster or slower over the map than they really will, by a speed
// drawn once for the run, so where a system is over the map is off by a distance that grows with every hour:
// about 100 km a day at one standard deviation. The first day or two is close; the end of the week is a guide.
// Without the error the run would be exact: the large-scale model and the map's steering are deterministic and
// storms do not feed back into them (checked 2026-11-13: a storm-free copy matched the live world's map position
// and large-scale fields to the bit over 5 days). The map's steering in the run plans from where the run thinks
// the map is, so its later days can also choose differently from the world.
// What a run keeps: the large-scale model's frame (server/SynopticRuntime.js) every LONG_RANGE.synopticEvery hours.
import { AtmosphereWorld } from '../world/AtmosphereWorld.js';
import { timingErrorMs, TIMING } from './ensemblePerturbation.js';

export const LONG_RANGE = Object.freeze({
  hours: 168,
  // The hour (UTC) of the day a run starts at.
  atUtc: 6,
  // A picture of the whole large-scale model every so many forecast hours (about 0.5 MB each).
  synopticEvery: 3,
  atmosphereStepHours: 0.5,
  // How much a run's systems differ in speed from the world's (m/s, standard deviation): the outlook runs' own.
  timingSpreadMs: TIMING.spreadMs,
  // Runs the server keeps (about 28 MB each).
  keepRuns: 4
});

// Whether a run starts at this hour (UTC).
export const longRangeDue = hourUtc => (((Math.round(hourUtc) % 24) + 24) % 24) === LONG_RANGE.atUtc;

// One run. state: the live world's forecast copy (saveState({ forecast: true })), this run's own.
// synopticOf(atmosphere): the large-scale model's frame; it only reads the run's world.
// timingMs: the run's timing error, when it is not to be drawn (a test's, or 0 for an exact run).
export function runLongRange(state, { hours = LONG_RANGE.hours, synopticOf = null, timingMs = null } = {}) {
  const atmosphere = AtmosphereWorld.restore(state);
  if (!atmosphere) throw new Error('the saved world is from another layout');
  const world = atmosphere.world, started = performance.now(), initHourUtc = world.validHourUtc;
  world.withoutStormPictures = true; atmosphere.model.fastTransforms = true;
  // No storms: the storms on the map at the start are left out, and none form.
  atmosphere.stormsEnabled = false; world.storms = [];
  const error = timingMs ?? timingErrorMs(`${state.seed}|long-range|${initHourUtc}`, LONG_RANGE.timingSpreadMs);
  atmosphere.regional.timingErrorMs = error;

  const synoptic = [];
  const keep = () => { if (synopticOf) synoptic.push({ forecastHour: Math.round((world.validHourUtc - initHourUtc) * 100) / 100, ...synopticOf(atmosphere) }); };
  keep();
  const steps = Math.round(hours / LONG_RANGE.atmosphereStepHours);
  for (let step = 0; step < steps; step++) {
    atmosphere.advance(LONG_RANGE.atmosphereStepHours);
    if (Math.abs((world.validHourUtc - initHourUtc) % LONG_RANGE.synopticEvery) < 1e-6) keep();
  }
  return {
    seed: state.seed, initHourUtc, hours, timingErrorMs: Math.round(error * 1000) / 1000, synoptic,
    // (where the run ends with the map, for checks: metres along and across the large-scale model)
    endOrigin: { x: atmosphere.regional.origin.x, y: atmosphere.regional.origin.y },
    ms: Math.round(performance.now() - started)
  };
}

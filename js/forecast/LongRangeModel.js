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
// What a run keeps, every LONG_RANGE.synopticEvery hours: the large-scale model's frame (server/SynopticRuntime.js),
// and what a sounding is made from for every cell of the map (soundingColumns.js).
// The tornado guide (2026-11-18, the owner's request; admin only, on the model page): for each outlook day the run
// covers (12Z to 12Z), the ingredients for storms gathered every step as Day 3's are, and from them the chance of a
// tornado (and an EF2+, EF3+, EF4+ one) within 25 miles, as the ensemble's (DayOneOutlook.js tornadoGuide), shown on the
// frame at the 06Z before the day.
// Day 7 of a 06Z run ends at the run's end, 06Z: its last six hours (the early morning) are not counted.
import { AtmosphereWorld } from '../world/AtmosphereWorld.js';
import { timingErrorMs, TIMING } from './ensemblePerturbation.js';
import { packColumns } from './soundingColumns.js';
import { freshIngredients, addIngredients, tornadoGuide, hoursToDayEnd, OUTLOOK } from './DayOneOutlook.js';

export const LONG_RANGE = Object.freeze({
  hours: 168,
  // The hour (UTC) of the day a run starts at.
  atUtc: 6,
  // A picture of the whole large-scale model every so many forecast hours (about 0.5 MB each).
  synopticEvery: 3,
  atmosphereStepHours: 0.5,
  // How much a run's systems differ in speed from the world's (m/s, standard deviation): the outlook runs' own.
  timingSpreadMs: TIMING.spreadMs,
  // Runs the server keeps (about 45 MB each: the large-scale frames and the map's columns for soundings).
  // Only the newest (2026-11-17, to save memory on Railway): a new run replaces the last as it starts and fills in.
  keepRuns: 1
});

// Whether a run starts at this hour (UTC).
export const longRangeDue = hourUtc => (((Math.round(hourUtc) % 24) + 24) % 24) === LONG_RANGE.atUtc;

// One run. state: the live world's forecast copy (saveState({ forecast: true })), this run's own.
// synopticOf(atmosphere): the large-scale model's frame; it only reads the run's world.
// timingMs: the run's timing error, when it is not to be drawn (a test's, or 0 for an exact run).
// onProgress(part): when given, each kept frame is sent as soon as it is made, as { head, readyHours, synoptic,
// soundings } (the new ones), and the run returns the rest without them ({ ..., streamed: true }; 2026-11-16).
export function runLongRange(state, { hours = LONG_RANGE.hours, synopticOf = null, timingMs = null, onProgress = null } = {}) {
  const atmosphere = AtmosphereWorld.restore(state);
  if (!atmosphere) throw new Error('the saved world is from another layout');
  const world = atmosphere.world, started = performance.now(), initHourUtc = world.validHourUtc;
  world.withoutStormPictures = true; atmosphere.model.fastTransforms = true;
  // No storms: the storms on the map at the start are left out, and none form.
  atmosphere.stormsEnabled = false; world.storms = [];
  const error = timingMs ?? timingErrorMs(`${state.seed}|long-range|${initHourUtc}`, LONG_RANGE.timingSpreadMs);
  atmosphere.regional.timingErrorMs = error;

  const synoptic = [], soundings = [], tornadoDays = [], head = { seed: state.seed, initHourUtc, hours, synopticEvery: LONG_RANGE.synopticEvery };
  const keep = () => {
    const forecastHour = Math.round((world.validHourUtc - initHourUtc) * 100) / 100, sounding = { hour: forecastHour, ...packColumns(world) }, frame = synopticOf ? { forecastHour, ...synopticOf(atmosphere) } : null;
    soundings.push(sounding); if (frame) synoptic.push(frame);
    onProgress?.({ head, readyHours: forecastHour, soundings: [sounding], synoptic: frame ? [frame] : [], tornadoDays: closed.splice(0) });
  };
  // The outlook days: the first starts at the first 12Z (or at the start, when that is more than 6 hours off).
  const n = world.width * world.height, dt = LONG_RANGE.atmosphereStepHours, firstFrom = hoursToDayEnd(initHourUtc) <= 6 + 1e-6 ? initHourUtc + hoursToDayEnd(initHourUtc) : initHourUtc;
  const closed = [];
  let day = null;
  const close = () => {
    const validToHourUtc = day.fromHourUtc + hoursToDayEnd(day.fromHourUtc), number = 1 + Math.round((validToHourUtc - (firstFrom + hoursToDayEnd(firstFrom))) / 24);
    // (the frame at the 06Z before the day, or the nearest kept one before it)
    const sixZ = validToHourUtc - 24 - (OUTLOOK.dayStartUtc - LONG_RANGE.atUtc), frameHour = Math.max(0, Math.floor((sixZ - initHourUtc) / LONG_RANGE.synopticEvery + 1e-6) * LONG_RANGE.synopticEvery);
    const guide = tornadoGuide(world, day.ingredients);
    const entry = { day: number, frameHour, validFromHourUtc: validToHourUtc - 24, validToHourUtc, countedFromHourUtc: day.fromHourUtc, countedToHourUtc: world.validHourUtc, ...guide };
    tornadoDays.push(entry); closed.push(entry); day = null;
  };
  keep();
  const steps = Math.round(hours / dt);
  for (let step = 0; step < steps; step++) {
    const before = world.validHourUtc;
    atmosphere.advance(dt);
    if (before + 1e-6 >= firstFrom) {
      day ??= { fromHourUtc: before, ingredients: freshIngredients(n, { tornado: true }) };
      addIngredients(world, day.ingredients, dt);
      if (hoursToDayEnd(world.validHourUtc) > 24 - 1e-6 || step === steps - 1) close();
    }
    if (Math.abs((world.validHourUtc - initHourUtc) % LONG_RANGE.synopticEvery) < 1e-6 || (step === steps - 1 && closed.length)) keep();
  }
  return {
    ...head, timingErrorMs: Math.round(error * 1000) / 1000, ...(onProgress ? { streamed: true } : { synoptic, soundings, tornadoDays }),
    // (where the run ends with the map, for checks: metres along and across the large-scale model)
    endOrigin: { x: atmosphere.regional.origin.x, y: atmosphere.regional.origin.y },
    ms: Math.round(performance.now() - started)
  };
}

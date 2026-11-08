// Each storm's rain field (PrecipitationField.js): where its rain, snow and hail are, worked out
// once per storm tick and read by everything that shows the storm's precipitation - the radar
// (RadarSimulator.js, through server/RadarPool.js) and the frames of the storms players are near
// (StormStructure.js). So the rain a player stands in is the rain the radar shows.
//
// A field is worked out from the storm and the cells (radarSceneInputs), so one is kept until the
// next storm tick or atmosphere step (rainFieldKey) and then worked out again when next asked
// for. The fields are kept beside the world, never on it: the world's state stays what the engine
// alone made it (tools/engine/fingerprint.mjs). Fields are built in memory other threads can read
// (shared), as the radar's threads build them, so the radar's scene can be handed one built here
// without a copy; a field is the same numbers wherever it was built.
import { radarSceneInputs, buildStormEcho } from '../radar/RadarSimulator.js';

const kept = new WeakMap();   // world -> { key, inputs, byId: storm id -> input, fields: storm id -> field | Promise }

// What a world's fields are kept for: its storm time and the cells' version (AtmosphereWorld.js).
export function rainFieldKey(world) {
  return `${Number(world.stormEngine?.validHourUtc ?? world.validHourUtc)}|${world.cellsVersion ?? ''}`;
}

function entry(world) {
  const key = rainFieldKey(world);
  let e = kept.get(world);
  if (!e || e.key !== key) {
    // (the cells' part, env, is the same until the next atmosphere step: kept across storm ticks)
    const env = e && e.key.split('|')[1] === key.split('|')[1] ? e.inputs?.env ?? null : null;
    const inputs = radarSceneInputs(world, { reuseEnv: env });
    e = { key, inputs, byId: new Map(inputs.storms.map(input => [input.storm.id, input])), fields: new Map() };
    kept.set(world, e);
  }
  return e;
}

// radarSceneInputs(world) as of now (the storms' columns the fields are worked out from).
export function rainFieldInputs(world) { return entry(world).inputs; }

// One storm's field, worked out here if it is not kept (null: the storm has none). A field still
// being worked out elsewhere is not waited for: this one is the same numbers.
export function rainFieldOf(world, storm) {
  const e = entry(world), id = storm?.id, have = e.fields.get(id);
  if (have !== undefined && typeof have?.then !== 'function') return have;
  const input = e.byId.get(id);
  const field = input ? buildStormEcho(input, { shared: true }) ?? null : null;
  e.fields.set(id, field);
  return field;
}

// The fields of these storms (entries of rainFieldInputs(world).storms), in order: kept ones as
// they are, the rest from build(input) -> field or Promise (the radar's threads), kept as they come.
export function rainFieldsFor(world, inputs, build) {
  const e = entry(world);
  return Promise.all(inputs.map(input => {
    const id = input.storm.id, have = e.fields.get(id);
    if (have !== undefined) return have;
    const made = Promise.resolve(build(input)).then(field => { if (e.fields.get(id) === made) e.fields.set(id, field ?? null); return field ?? null; },
      error => { if (e.fields.get(id) === made) e.fields.delete(id); throw error; });
    e.fields.set(id, made);
    return made;
  }));
}

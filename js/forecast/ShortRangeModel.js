// The short range model (2026-10-28, the user's request; the game's HRRR). One run from the live world
// each simulated hour, 18 hours ahead, 48 at 00, 06, 12 and 18Z, shown on the model page next to the
// mesoanalysis. It is the live world stepped exactly as the server steps it (the storms in 5-minute
// ticks up to each half hour, then the atmosphere: WeatherAuthorityRuntime.stormTicksTo), with no
// forecast errors added (the user's choice). For its first SHORT_RANGE.shareHours it takes the same
// chances as the live world (the same storm dice: the world's seed), so those hours come out as the
// live world will (tmp/ens/hrrr-check.mjs: 100% of storms and reports in 0-3 h on 8 seeds); after
// that it takes its own, and like any single run it can no longer say which storm makes a tornado
// (tornado places 20-40% right from 3 h on, severe-weather areas 83-95% out to 18 h).
// What a run keeps:
//   fields   each hour (forecast hour 0 = the start): the mesoanalysis fields, from fieldsOf(world)
//            (the worker passes the server's mesoanalysis parameters), as Float32Arrays
//   storms   every STORM_EVERY hours: each storm, compact (position, motion, reflectivity, rain
//            area, hail, updraft, rotation, updraft helicity, tornado)
//   tracks   every storm tick: the points of storms with updraft helicity, and of tornadoes
import { AtmosphereWorld } from '../world/AtmosphereWorld.js';
import { buildStormAppearance } from '../storms/StormAppearance.js';

export const SHORT_RANGE = Object.freeze({
  hours: 18, longHours: 48, longAtUtc: [0, 6, 12, 18],
  // Hours the run shares the live world's storm dice (the user's choice, 2026-10-28).
  shareHours: 3,
  stormTickHours: 1 / 12, atmosphereStepHours: 0.5,
  // A storm record every 15 minutes.
  stormEvery: 0.25,
  // Updraft helicity (2-5 km, m2/s2, as the HRRR's): the updraft (m/s) times the mid-level rotation's
  // vorticity (0.003 /s at a mesocyclone strength of 1) over 3 km, so a strong supercell (42 m/s,
  // strength 0.9) reads about 340 and a weakly rotating storm (20 m/s, 0.2) about 36, the HRRR's
  // range (75+ marks a rotating storm, 150+ a strong one).
  uhPerUpdraftMeso: 0.003 * 3000,
  // Track points are kept from this much updraft helicity.
  trackLeastUh: 25,
  // Runs the server keeps.
  keepRuns: 8
});

const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
export const updraftHelicity = storm => Math.round((storm.updraughtMs ?? 0) * (storm.mesocycloneStrength ?? 0) * SHORT_RANGE.uhPerUpdraftMeso);

// One storm, compact (map km, y south; motion km/h).
function stormRecord(storm) {
  const a = buildStormAppearance(storm), t = storm.tornado?.onGround ? storm.tornado : null;
  return {
    id: storm.id, x: r2(storm.positionKm.x), y: r2(storm.positionKm.y), east: r1(storm.velocityKph?.east ?? 0), north: r1(storm.velocityKph?.north ?? 0),
    mode: storm.mode, intensity: r2(storm.intensity ?? 0), dbz: Math.round(storm.radar?.maxReflectivityDbz ?? 0), hailIn: r2(storm.currentHailSizeInches ?? 0),
    updraftMs: r1(storm.updraughtMs ?? 0), meso: r2(storm.mesocycloneStrength ?? 0), lowRotation: r2(storm.lowRotation ?? 0), uh: updraftHelicity(storm),
    rain: a?.rain ?? null, hail: a?.hail ?? null, line: a?.line ? { share: a.line.share, halfLengthKm: a.line.halfLengthKm, axisBearingDeg: a.line.axisBearingDeg, bow: a.line.bow } : null,
    hook: a ? r2(a.rain?.wrap ?? 0) : 0,
    tornado: t ? { x: r2(t.positionKm.x), y: r2(t.positionKm.y), mph: Math.round(t.windSpeedMph ?? 0), ef: t.estimatedEf ?? null, yards: Math.round(t.widthYards ?? 0) } : null
  };
}

// One run. state: the live world's forecast copy (saveState({ forecast: true })), this run's own.
// fieldsOf(world): { key: { values, ...meta } } for the hour's fields. Returns the run.
export function runShortRange(state, { hours = SHORT_RANGE.hours, shareHours = SHORT_RANGE.shareHours, fieldsOf = null } = {}) {
  const atmosphere = AtmosphereWorld.restore(state);
  if (!atmosphere) throw new Error('the saved world is from another layout');
  const world = atmosphere.world, started = performance.now();
  // No radar picture is drawn from it, and its large-scale model may use the fast transforms
  // (neither changes what the storms do: the shared hours matched the live world exactly).
  world.withoutStormPictures = true; atmosphere.model.fastTransforms = true;
  const initHourUtc = world.validHourUtc, liveSeed = world.evolution?.config?.seed, ownSeed = `${state.seed}|short-range|${initHourUtc}`;
  const setSeed = seed => { world.evolution = { ...(world.evolution ?? {}), config: { ...(world.evolution?.config ?? {}), seed } }; };
  const stormHour = () => world.stormEngine?.validHourUtc ?? world.validHourUtc;
  let shared = shareHours > 0;
  if (!shared) setSeed(ownSeed);

  const parameters = [], fields = [], storms = [], tracks = [];
  const keepFields = () => {
    if (!fieldsOf) return;
    const all = fieldsOf(world), frame = {};
    for (const [key, field] of Object.entries(all)) {
      if (!parameters.some(p => p.key === key)) { const { values, barbs, second, ...meta } = field; parameters.push({ ...meta, key, ...(second ? { second: { label: second.label, unit: second.unit, levels: second.levels, colour: second.colour } } : {}), barbs: Boolean(barbs) }); }
      frame[key] = Float32Array.from(field.values);
      if (field.second) frame[`${key}:second`] = Float32Array.from(field.second.values);
      if (field.barbs) frame[`${key}:barbs`] = field.barbs;
    }
    fields.push({ hour: r2(world.validHourUtc - initHourUtc), values: frame });
  };
  const keepStorms = () => storms.push({ minute: Math.round((stormHour() - initHourUtc) * 60), list: (world.storms ?? []).filter(s => s.active && (s.intensity ?? 0) >= 0.15).map(stormRecord) });
  const keepTracks = () => {
    const minute = Math.round((stormHour() - initHourUtc) * 60);
    for (const s of world.storms ?? []) {
      if (!s.active) continue;
      const uh = updraftHelicity(s), t = s.tornado?.onGround ? s.tornado : null;
      if (uh >= SHORT_RANGE.trackLeastUh || t) tracks.push({ id: s.id, minute, x: r2(s.positionKm.x), y: r2(s.positionKm.y), uh, ...(t ? { tornado: { x: r2(t.positionKm.x), y: r2(t.positionKm.y), mph: Math.round(t.windSpeedMph ?? 0), ef: t.estimatedEf ?? null } } : {}) });
    }
  };
  keepFields(); keepStorms();
  let nextStorms = SHORT_RANGE.stormEvery;
  const tick = hoursAhead => {
    atmosphere.advanceStormLayer(hoursAhead);
    const into = stormHour() - initHourUtc;
    if (shared && into >= shareHours - 1e-3) { shared = false; setSeed(ownSeed); }
    keepTracks();
    if (into >= nextStorms - 1e-3) { keepStorms(); nextStorms += SHORT_RANGE.stormEvery; }
  };
  const steps = Math.round(hours / SHORT_RANGE.atmosphereStepHours);
  for (let step = 0; step < steps; step++) {
    // The storms up to the next atmosphere step, in ticks (as WeatherAuthorityRuntime.stormTicksTo).
    const target = world.validHourUtc + SHORT_RANGE.atmosphereStepHours;
    for (let guard = 0; guard < 64; guard++) {
      const left = target - stormHour();
      if (left <= 1e-3) { if (left > 0 && world.stormEngine) world.stormEngine.validHourUtc = target; break; }
      tick(Math.min(SHORT_RANGE.stormTickHours, left));
    }
    atmosphere.advance(SHORT_RANGE.atmosphereStepHours, { advanceStorms: false });
    if (Math.abs((world.validHourUtc - initHourUtc) % 1) < 1e-6) keepFields();
  }
  return {
    seed: state.seed, initHourUtc, hours, shareHours, cellKm: world.cellSizeKm, width: world.width, height: world.height,
    parameters, fields, storms, tracks, ms: Math.round(performance.now() - started)
  };
}

// Whether the run started at this hour (UTC) goes the long way.
export const shortRangeHours = hourUtc => (SHORT_RANGE.longAtUtc.includes(((Math.round(hourUtc) % 24) + 24) % 24) ? SHORT_RANGE.longHours : SHORT_RANGE.hours);

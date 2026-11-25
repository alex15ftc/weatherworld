// A preview of the coming week's severe weather under other settings (the admin tool, tools/admin: npm run admin;
// 2026-11-17, the owner's request): a copy of a world (a local engine's saved one, or a new one for a seed), with the large-scale model's jet and mean winds (QuasiGeostrophicModel
// retune) and the region's steering (RegionSteering) set as asked, run ahead with its storms the way the server runs
// them (storms every 5 minutes, the atmosphere every half hour), day by day. Each convective day (12Z to 12Z) gives
// what happened: tornadoes and their ratings, hail and wind reports, the strongest of each, and the category a
// perfect outlook would have drawn (the verification's practically perfect chances, js/verification/truth.js), with a
// picture of the large-scale model's 250 mb wind and 500 mb height at the day's 00Z.
// Settings left as the game has them change nothing: a preview with the game's own settings is the world's own week
// to come (the storm engine is deterministic; only what players do is left out). The steering plans afresh at the
// start only when its settings were changed.
import { AtmosphereWorld } from '../../js/world/AtmosphereWorld.js';
import { RETUNABLE } from '../../js/atmosphere/QuasiGeostrophicModel.js';
import { captureTruth, aggregateTruth } from '../../js/verification/truth.js';
import { RISK_RADIUS_MILES } from '../../js/forecast/spcOutlookRules.js';
import { convectiveDay } from '../../js/reports/stormLog.js';

export const PREVIEW = Object.freeze({ days: 7, stormTickHours: 1 / 12, atmosphereStepHours: 0.5 });
const ORDER = ['NONE', 'TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'];
const efOf = mph => (mph >= 201 ? 5 : mph >= 166 ? 4 : mph >= 136 ? 3 : mph >= 111 ? 2 : mph >= 86 ? 1 : 0);
const KT = 1.943844, GRAVITY = 9.81;
// The steering settings a preview may change (plain numbers, or [low, high] pairs, or the kinds' shares).
export const STEERING_KEYS = Object.freeze(['windCapKt', 'southerlyCapKt', 'moistRangeGkg', 'wantedLow', 'wantedHigh', 'kinds', 'systemSpeedMs', 'northSpeedMs', 'homeReachKm', 'homePull', 'lookAheadDays', 'maxMissKm', 'liftShare', 'liftRangeKh']);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pick = (object, keys) => Object.fromEntries(keys.filter(key => key in (object ?? {})).map(key => [key, object[key]]));

// What a world's settings are, for the page's sliders.
export function previewSettingsOf(atmosphere) {
  return { qg: pick(atmosphere.model.params, RETUNABLE), steering: pick(atmosphere.steering?.params, STEERING_KEYS) };
}

// The large-scale model's 250 mb wind (kt) and 500 mb height (dam) on its grid, with the map's place in it.
function jetPicture(atmosphere) {
  const regional = atmosphere.regional, m = atmosphere.model, { nx, ny, d } = m, f0 = m.params.f0, refMid = regional.referenceMidPsi();
  const wind = new Uint8Array(nx * ny), height = new Int16Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const outer = regional.outer(i * d, (j + 0.5) * d), w = regional.windAt(outer, 250), k = j * nx + i;
    wind[k] = Math.min(255, Math.round(Math.hypot(w.u, w.v) * KT));
    height[k] = Math.round((5760 + f0 * (outer.midPsi - refMid) / GRAVITY) / 10 * 10);   // (tenths of a dam)
  }
  const box = { x: ((regional.origin.x / d) % nx + nx) % nx, y: ((regional.origin.y / d - 0.5) % ny + ny) % ny, width: regional.nx * regional.dx / d, height: regional.ny * regional.dx / d };
  return { hourUtc: regional.hourUtc, nx, ny, km: d / 1000, box, wind250Kt: Array.from(wind), z500TenthDam: Array.from(height) };
}

// One preview. state: the live world's forecast copy (saveState({ forecast: true })). qg, steering: the settings to
// use (any left out, or as the game has them, stay as they are). placesFor(world): the counties, for the reports.
// onProgress({ day } | { hoursDone }) as it goes.
export function runSeverePreview(state, options = {}) {
  const atmosphere = AtmosphereWorld.restore(state);
  if (!atmosphere) throw new Error('the saved world is from another layout');
  return runPreviewOn(atmosphere, options);
}

// The same on a world already in hand (it is run ahead: pass a copy).
export function runPreviewOn(atmosphere, { days = PREVIEW.days, qg = {}, steering = {}, placesFor = null, onProgress = null } = {}) {
  const world = atmosphere.world, started = performance.now(), places = placesFor?.(world) ?? null;
  world.withoutStormPictures = true;
  const game = previewSettingsOf(atmosphere);
  // The settings asked for, where they differ from the game's.
  const qgChanges = Object.fromEntries(Object.entries(pick(qg, RETUNABLE)).filter(([key, value]) => !same(value, game.qg[key] ?? null)));
  const steeringChanges = Object.fromEntries(Object.entries(pick(steering, STEERING_KEYS)).filter(([key, value]) => !same(value, game.steering[key])));
  if (Object.keys(qgChanges).length) atmosphere.model.retune(qgChanges);
  if (atmosphere.steering && Object.keys(steeringChanges).length) {
    Object.assign(atmosphere.steering.params, steeringChanges);
    atmosphere.steering.makePlan();
  }

  // The days are kept on the storm clock, to the tick. (A saved world's storms can be a few ticks ahead of its
  // atmosphere's half-hour steps, the server saving between them: until 2026-11-18 a day closed only at 12Z on an
  // atmosphere step, and on such a world never did, the whole week coming out as one day.)
  const tick = PREVIEW.stormTickHours;
  const clock = () => Math.round((world.stormEngine?.validHourUtc ?? world.validHourUtc) / tick) * tick;
  // (days convective days: the rest of today's, to its 12Z, and the days - 1 after it)
  const startHour = clock(), endHour = 12 + 24 * (convectiveDay(startHour + 1e-6) - 1) + 24 * days, results = [];
  const looks = new Map();
  let day = null;
  const open = () => {
    const hour = clock();
    day = { key: convectiveDay(hour + 1e-6), fromHourUtc: hour, frames: [], seen: new Set(), initiations: [], tornadoKeys: [], supercells: new Set(), speeds: [], maxHail: 0, maxGust: 0, picture: null };
  };
  const close = () => {
    const truth = aggregateTruth(day.frames, day.initiations, world.width, world.height, RISK_RADIUS_MILES / world.cellSizeMiles, world.cellSizeMiles);
    const log = world.reportLog?.days?.[day.key];
    const reports = log?.reports ?? [];
    const hail = reports.filter(r => r.type === 'hail').map(r => (Number(r.size) || 0) / 100), wind = reports.filter(r => r.type === 'wind').map(r => Number(r.speed ?? r.estimatedMph) || 0);
    const ratings = [0, 0, 0, 0, 0, 0];
    const tornadoes = day.tornadoKeys.map(key => looks.get(key));
    for (const t of tornadoes) ratings[t.ef]++;
    const speeds = day.speeds.sort((a, b) => a - b);
    const record = {
      day: results.length + 1, convectiveDay: day.key, fromHourUtc: day.fromHourUtc, toHourUtc: clock(),
      partial: clock() - day.fromHourUtc < 24 - 1e-6,
      category: ORDER[Math.max(...truth.worldRisk.map(r => ORDER.indexOf(r)))],
      cig: Object.fromEntries(['tornado', 'wind', 'hail'].map(hz => [hz, Math.max(0, ...truth.observedCig[hz])])),
      tornadoes: tornadoes.length, ratings, strongestEf: tornadoes.length ? Math.max(...tornadoes.map(t => t.ef)) : null,
      longestTrackMi: tornadoes.length ? Math.round(Math.max(...tornadoes.map(t => t.km)) * 0.621371 * 10) / 10 : 0,
      hailReports: hail.length, hail2in: hail.filter(v => v >= 2).length, windReports: wind.length, wind75: wind.filter(v => v >= 75).length,
      maxHailIn: Math.round(day.maxHail * 100) / 100, maxGustMph: Math.round(day.maxGust),
      storms: day.seen.size, supercells: day.supercells.size, stormMphMedian: speeds.length ? Math.round(speeds[speeds.length >> 1] * 10) / 10 : null,
      picture: day.picture ?? jetPicture(atmosphere)
    };
    results.push(record);
    onProgress?.({ day: record });
  };

  open();
  const stepsPerAtmosphere = Math.round(PREVIEW.atmosphereStepHours / PREVIEW.stormTickHours);
  for (let step = 1; clock() < endHour - 1e-6; step++) {
    atmosphere.advanceStormLayer(PREVIEW.stormTickHours);
    if (step % stepsPerAtmosphere === 0) atmosphere.advance(PREVIEW.atmosphereStepHours, { advanceStorms: false });
    const hour = clock();
    captureTruth(world, day.frames, day.seen, day.initiations, places);
    for (const s of world.storms ?? []) {
      if (!s.active) continue;
      day.maxHail = Math.max(day.maxHail, s.currentHailSizeInches ?? 0); day.maxGust = Math.max(day.maxGust, s.surfaceWind?.gustMph ?? 0);
      if ((s.mesocycloneStrength ?? 0) >= 0.3) day.supercells.add(s.id);
      if (step % stepsPerAtmosphere === 0 && (s.intensity ?? 0) >= 0.22) day.speeds.push(Math.hypot(s.velocityKph?.east ?? 0, s.velocityKph?.north ?? 0) * 0.621371);
      if (s.tornado?.onGround) {
        const key = `${s.id}#${s.tornado.cycleCount}`;
        let look = looks.get(key);
        if (!look) { look = { ef: 0, km: 0 }; looks.set(key, look); day.tornadoKeys.push(key); }
        look.ef = Math.max(look.ef, efOf(s.tornado.ratedWindMph ?? s.tornado.peakWindSpeedMph ?? s.tornado.windSpeedMph ?? 0));
        look.km = Math.max(look.km, s.tornado.pathLengthKm ?? 0);
      }
    }
    // The day's picture at 00Z (the afternoon's storms), and a day closed when the storm clock reaches 12Z.
    const utc = ((hour % 24) + 24) % 24;
    if (!day.picture && Math.abs(utc) < 1e-3) day.picture = jetPicture(atmosphere);
    if (step % 12 === 0) onProgress?.({ hoursDone: Math.round((hour - startHour) * 10) / 10 });
    if (convectiveDay(hour + 1e-6) !== day.key) { close(); if (hour < endHour - 1e-6) open(); else day = null; }
  }
  if (day && clock() - day.fromHourUtc > 1) close();
  return { startHourUtc: startHour, hours: endHour - startHour, applied: { qg: qgChanges, steering: steeringChanges }, game, days: onProgress ? null : results, ms: Math.round(performance.now() - started) };
}

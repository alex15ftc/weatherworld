// The live authority: one world of weather (the redesigned atmosphere with its storms, see
// docs/ATMOSPHERE-REDESIGN.md) advanced on a clock and served as products: fields, tiles,
// soundings, storms, radar and the surface analysis overlays. The weather is continuous;
// there are no separate systems to switch between.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import v8 from 'node:v8';
import { fileURLToPath } from 'node:url';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { buildSounding, diagnoseSoundingDisplay } from '../js/sounding.js';
import { diagnoseEngineMotion } from '../js/storms/SoundingHazards.js';
import { serializeStormInternalField } from '../js/storms/StormInternalField.js';
import { renderTile, decodeF32Base64, TILE_PYRAMID, OUTLOOK_LEGENDS } from './tiles/ProductTileRenderer.js';
import { assembleRadarScene, scanRadarTilt, buildRadarMosaic, mosaicSize, MOSAIC_KINDS, MOSAIC_RES_KM, STACKED_MOSAIC_KINDS } from '../js/radar/RadarSimulator.js';
import { buildSatellite, satelliteInputs } from '../js/satellite/Satellite.js';
import { AnvilField } from '../js/satellite/AnvilField.js';
import { rainFieldInputs, rainFieldOf } from '../js/storms/StormRainFields.js';
import { detectRotation, lowLevelShearGrid } from '../js/radar/RotationDetection.js';
import { radarSitesFor } from './RadarSites.js';
import { buildAnalysisOverlays } from './analysisOverlays.js';
import { GameFeed } from './GameFeed.js';
import { buildLabWindow, labStorms } from '../js/game/LabWindow.js';
import { buildStormFeedList } from '../js/storms/StormAppearance.js';
import { buildSkyAppearance } from '../js/world/SkyAppearance.js';
import { countiesFor, placesFor } from './CountyLayer.js';
import { logStormTick } from '../js/reports/stormLog.js';
import { createDayRecorder } from './DayReviewRecorder.js';
import { LightningLog } from '../js/storms/Lightning.js';
import { dateText } from '../js/forecast/calendar.js';
import { RADAR_TILTS_DEG, RADAR_PRODUCT_KEYS, RADAR_RADIALS, RADAR_GATES, RADAR_GATE_KM, RADAR_FINE_GATE_KM, RADAR_BEAMWIDTH_DEG, encodeRadarValue } from '../js/radar/RadarFormat.js';

const DEFAULT_SEED = 1000;
const START_HOUR_UTC = 12;
// A simulated day takes 3 real hours (8x, 2026-10-29, the user's choice: a slower game, more time with
// each storm; it was 2 hours, 12x, from 2026-10-15, and 96 minutes, 15x, before). Storms move
// every five simulated minutes; the atmosphere steps every half hour and then takes account
// of what the storms did meanwhile.
export const SIM_HOURS_PER_REAL_MINUTE = 24 / 180;
const SIM_HOURS_PER_REAL_HOUR = SIM_HOURS_PER_REAL_MINUTE * 60;
const STORM_CADENCE_HOURS = 1 / 12, ATMOSPHERE_STEP_HOURS = 0.5;
const REAL_MS_PER_STORM_TICK = (STORM_CADENCE_HOURS / SIM_HOURS_PER_REAL_MINUTE) * 60000;
const MAX_STEPS_PER_TICK = 4;
const RADAR_PREWARM_MS = 60_000;
// The tilts a radar's rotation detections look through: its lowest nine, 0.5-6.4 deg (from 1 to 6 km
// up a storm at 50 km, enough for the TDA's 1.5 km and the MDA's 3 km depths at most ranges).
const RADAR_ROTATION_TILTS = 9;
// Rotation tracks: the greatest low-level shear of the scans of the last hour (sim time), as the
// MRMS rotation tracks (60 min). Made from the scans of while they were asked for.
const ROTATION_TRACK_HOURS = 1;
// Mosaics kept for the radar page's loop (one per scan time: an hour's worth).
const RADAR_HISTORY_FRAMES = 12;
const RISK_CODES = { NONE: 0, TSTM: 1, MRGN: 2, SLGT: 3, ENH: 4, MDT: 5, HIGH: 6 };
const TILE_STYLE_REVISION = 'spc-probability-v6';
const STATE_VERSION = 2;
const OUTLOOK_NOTE = 'Outlooks are being rebuilt for the redesigned atmosphere and are not issued yet.';

export class WeatherAuthorityRuntime {
  // statePath: file the world is saved to every simulated hour and resumed from (null: nothing
  // is kept). An explicit seed always starts that world fresh. A fresh world first lets the
  // large-scale weather develop for spinUpDays, which takes about a second per day.
  // radarPool (RadarPool.js): threads the radar is worked out on; without one it is worked out here.
  // regional: settings for the regional layer (RegionalAtmosphere's), for audits that try them.
  // dayReviews: { dir, png, keepDays } to write a review package for each finished day
  // (DayReviewRecorder.js), or null; dayReviewOutlook(from, to) gives it that day's Day 1 outlook.
  // clockLock: the world's clock follows real UTC time (startClocks; the hosted engine turns it on).
  constructor({ seed, statePath = null, spinUpDays = 45, radarPool = null, regional = {}, dayReviews = null, clockLock = false } = {}) {
    this.clockLock = clockLock;
    // World hour = SIM_HOURS_PER_REAL_HOUR x real hours since 1970 + clockOffset (whole world days), when locked.
    this.clockOffset = null;
    this.regionalSettings = regional;
    this.dayReviews = dayReviews;
    this.dayReviewOutlook = null;
    this.authorityInstance = crypto.randomBytes(8).toString('hex');
    this.radarPool = radarPool;
    // Radar products asked for lately (cache key -> when), made ready again as each new scan comes in.
    this.radarWanted = new Map();
    // The latest mosaics of each kind, oldest first: { validHourUtc, mosaic }.
    this.radarHistory = Object.fromEntries(MOSAIC_KINDS.map(kind => [kind, []]));
    this.statePath = statePath;
    this.spinUpDays = spinUpDays;
    this.codeVersion = statePath ? sourceVersion() : 'unversioned';
    this.savingState = null;
    this.lastSavedHour = null;
    this.startedAt = Date.now();
    this.lastAdvancedAt = Date.now();
    this.lastStormAdvancedAt = this.lastAdvancedAt;
    this.revision = 0;
    this.productCache = new Map();
    this.performance = { cacheHits: 0, cacheMisses: 0, productBuilds: {} };
    this.autoAdvance = true;
    this.systemNumber = 1;
    // The storms as the game draws them, a frame each storm tick (GameFeed.js).
    // (Their rain grids are worked out on the radar's threads when there are some.)
    this.gameFeed = new GameFeed({ tickMs: REAL_MS_PER_STORM_TICK, regional, precipGrids: radarPool ? world => radarPool.precipGrids(world) : null });
    const explicitSeed = seed !== undefined && seed !== null && seed !== '';
    if (explicitSeed || !this.restoreState()) { this.build(seed); this.saveState(); }
  }

  build(seed) {
    const number = Number(seed), given = seed !== undefined && seed !== null && seed !== '' && Number.isFinite(number);
    // A new world: things saved beside it (the outlooks, OutlookRuntime.js) are kept only for the world they came from.
    this.worldId = crypto.randomUUID();
    this.clockOffset = null;
    this.adoptEngine(new AtmosphereWorld({ seed: given ? Math.trunc(number) : DEFAULT_SEED, spinUpDays: this.spinUpDays, regional: this.regionalSettings ?? {} }));
  }

  adoptEngine(engine) {
    this.engine = engine;
    const world = engine.world;
    world.evolution.config.flowRegime = 'continuous';
    this.atmosphere = world;
    this.config = world.evolution.config;
    this.seed = engine.seed;
    this.assertSpatialIntegrity();
    // The clocks run from now, not from before the world took its time to build.
    this.startClocks();
    this.gameFeed?.restart(world, Date.now());
    // The day's storm reports and tornado tracks (js/reports/stormLog.js), after each storm tick.
    const places = placesFor(world);
    this.places = places;
    // The last half hour's lightning (js/storms/Lightning.js), added to after each storm tick.
    this.lightning = new LightningLog({ seed: engine.seed });
    // The storms' anvils for the satellite (js/satellite/AnvilField.js): a puff from each storm each tick.
    this.anvils = new AnvilField().update(world);
    // The meteorologist's day packages (DayReviewRecorder.js), from the next 12Z on.
    this.dayReview = this.dayReviews ? createDayRecorder({ engine, outDir: this.dayReviews.dir, places, png: Boolean(this.dayReviews.png), keepDays: this.dayReviews.keepDays ?? null, outlookFor: (from, to) => this.dayReviewOutlook?.(from, to) ?? null }) : null;
    engine.onStormTick = () => {
      logStormTick(world, places); this.lightning.record(world); this.dayReview?.stormTick();
      try { this.anvils.update(world); } catch (error) { console.error('[anvils]', error); }
      // The cloud model workers (js/game/StormWorkers.js, set by server/index.js): they only read
      // the world, and a fault in them never stops it.
      try { this.stormWorkers?.stormTick(world); } catch (error) { console.error('[storm-workers]', error); }
      // Whatever else follows each tick (set by server/index.js: the day replays' tornado radar); it only reads the world.
      try { this.afterStormTick?.(world); } catch (error) { console.error('[storm-tick]', error); }
    };
  }

  reset(seed = this.seed) {
    this.finishPieces();
    this.build(seed);
    this.radarHistory = Object.fromEntries(MOSAIC_KINDS.map(kind => [kind, []]));
    this.rotationScans = [];
    this.startClocks();
    this.revision += 1;
    this.invalidateProducts();
    this.saveState();
    return this.metadata();
  }

  // `onStep` is called after each atmosphere step of the advance.
  advance(hours = 0.5, onStep) {
    const amount = Math.max(0, Math.min(72, Number(hours) || 0));
    if (amount < ATMOSPHERE_STEP_HOURS) return this.metadata();
    this.finishPieces();
    // Storms may have been ticked ahead of the atmosphere; bring both to the same time first.
    // The storms move in the same five-minute ticks as on the clock (in half-hour steps tornadoes
    // came and went unseen and storms jumped past the towns that would report them).
    const world = this.atmosphere;
    for (let step = 0; step < Math.round(amount / ATMOSPHERE_STEP_HOURS); step++) {
      this.stormTicksTo(world.validHourUtc + ATMOSPHERE_STEP_HOURS);
      this.engine.advance(ATMOSPHERE_STEP_HOURS, { advanceStorms: false, onStep });
      this.dayReview?.afterStep();
    }
    this.startClocks();
    this.gameFeed.restart(world);
    this.revision += 1;
    this.invalidateProducts();
    this.saveState();
    return this.metadata();
  }

  // The weather only runs forward.
  seek(targetHour) {
    const delta = (Number(targetHour) || 0) - this.atmosphere.validHourUtc;
    return delta >= ATMOSPHERE_STEP_HOURS ? this.advance(delta) : this.metadata();
  }

  setAutoAdvance(enabled) {
    this.finishPieces();
    this.autoAdvance = Boolean(enabled);
    this.startClocks();
    return this.metadata();
  }

  // Where the clocks start from. Unlocked: now. Locked (clockLock): from the real time the world's hour
  // falls on, so each real UTC day holds exactly 8 world days, Day 1 from 00 UTC, Day 2 from 03 UTC ... Day 8
  // from 21 UTC (js/forecast/calendar.js names them "11/11/26 Day 3"). The world is never ahead of that
  // clock and less than a world day behind it, and catches up; when it would be further off (a new world,
  // a long pause, a manual advance) a new offset is picked, a whole number of world days.
  startClocks(now = Date.now()) {
    const world = this.atmosphere;
    if (!this.clockLock || !world) { this.lastAdvancedAt = now; this.lastStormAdvancedAt = now; return; }
    const hour = world.validHourUtc, base = now / 3600000 * SIM_HOURS_PER_REAL_HOUR;
    const behind = this.clockOffset === null ? -1 : base + this.clockOffset - hour;
    if (!(behind >= 0 && behind < 24)) this.clockOffset = 24 * Math.ceil((hour - base) / 24 - 1e-9);
    this.lastAdvancedAt = this.realMsOf(hour);
    this.lastStormAdvancedAt = this.realMsOf(world.stormEngine?.validHourUtc ?? hour);
  }
  // The real time (ms) a world hour falls on, on the locked clock.
  realMsOf(hour) { return (hour - this.clockOffset) / SIM_HOURS_PER_REAL_HOUR * 3600000; }

  invalidateProducts() { this.productCache.clear(); }

  // Moves the storms on to an hour in storm ticks (the last one shorter if it must be).
  stormTicksTo(hourUtc) {
    const world = this.atmosphere;
    for (let guard = 0; guard < 64; guard++) {
      const left = hourUtc - (world.stormEngine?.validHourUtc ?? world.validHourUtc);
      // The storm clock is rounded at each tick; a sliver left over is not a tick, and the clock is
      // set to the hour.
      if (left <= 1e-3) { if (left > 0 && world.stormEngine) world.stormEngine.validHourUtc = hourUtc; return; }
      this.engine.advanceStormLayer(Math.min(STORM_CADENCE_HOURS, left));
    }
  }

  // Moves the world on to the clock, all at once (true when anything moved).
  advanceOnTimer(now = Date.now()) {
    this.finishPieces();
    const pieces = this.advancePieces(now);
    for (;;) { const next = pieces.next(); if (next.done) return next.value; }
  }

  // The same, a piece at a time (a storm tick with its frame, or an atmosphere step), each in its
  // own turn of the event loop, so requests are answered between them rather than waiting for
  // the whole catch-up. The pieces are the same and run in the same order, so the world goes
  // exactly as with advanceOnTimer; between them it is as it is between two calls of that.
  // Resolves to true when anything moved (false when a run is already under way).
  async advanceOnTimerInTurns(now = Date.now()) {
    if (this.pieces) return false;
    const pieces = this.pieces = this.advancePieces(now);
    this.piecesResult = false;
    try {
      for (;;) {
        const next = pieces.next();
        if (next.done) return next.value;
        // What was worked out from the world as it was is out of date.
        this.revision += 1; this.invalidateProducts();
        await new Promise(resolve => setImmediate(resolve));
        // (advance or reset ran the rest meanwhile: finishPieces)
        if (this.pieces !== pieces) return this.piecesResult;
      }
    } finally { if (this.pieces === pieces) this.pieces = null; }
  }

  // Runs what is left of a run in turns at once (before anything else moves the world).
  finishPieces() {
    const pieces = this.pieces;
    if (!pieces) return;
    this.pieces = null;
    for (;;) { const next = pieces.next(); if (next.done) { this.piecesResult = next.value; return; } }
  }

  *advancePieces(now) {
    if (!this.autoAdvance) return false;
    const world = this.atmosphere;
    let changed = false;
    // Storms never run more than one atmosphere step ahead of the atmosphere.
    const room = Math.round((world.validHourUtc + ATMOSPHERE_STEP_HOURS - (world.stormEngine?.validHourUtc ?? world.validHourUtc)) / STORM_CADENCE_HOURS);
    const due = Math.floor(Math.max(0, now - this.lastStormAdvancedAt) / REAL_MS_PER_STORM_TICK), ticks = Math.max(0, Math.min(due, room));
    // One tick at a time, so the game gets a frame for each, stamped with when it fell due.
    for (let tick = 1; tick <= ticks; tick++) {
      this.engine.advanceStormLayer(STORM_CADENCE_HOURS); this.gameFeed.capture(world, this.lastStormAdvancedAt + tick * REAL_MS_PER_STORM_TICK); changed = true;
      if (tick < ticks) yield;
    }
    if (due > 0) this.lastStormAdvancedAt += due * REAL_MS_PER_STORM_TICK;
    const steps = Math.min(MAX_STEPS_PER_TICK, Math.floor((Math.max(0, now - this.lastAdvancedAt) / 60000 * SIM_HOURS_PER_REAL_MINUTE) / ATMOSPHERE_STEP_HOURS));
    if (steps > 0) {
      if (changed) yield;
      for (let step = 0; step < steps; step++) {
        const ahead = (world.stormEngine?.validHourUtc ?? world.validHourUtc) - world.validHourUtc;
        if (ahead < ATMOSPHERE_STEP_HOURS - 1e-6) { this.stormTicksTo(world.validHourUtc + ATMOSPHERE_STEP_HOURS); this.gameFeed.capture(world, now); }
        this.engine.advance(ATMOSPHERE_STEP_HOURS, { advanceStorms: false });
        this.dayReview?.afterStep();
        if (step < steps - 1) yield;
      }
      // Caught up after a long pause: the storms jumped, and the game should not glide across it.
      if (steps === MAX_STEPS_PER_TICK) this.gameFeed.restart(world, now);
      // After a long pause the clock restarts from now instead of racing to catch up; the locked clock
      // catches up (less than a world day; startClocks), MAX_STEPS_PER_TICK steps a turn.
      const restart = steps === MAX_STEPS_PER_TICK && !this.clockLock;
      this.lastAdvancedAt = restart ? now : this.lastAdvancedAt + steps * ATMOSPHERE_STEP_HOURS / SIM_HOURS_PER_REAL_MINUTE * 60000;
      if (restart) this.lastStormAdvancedAt = now;
      changed = true;
    }
    if (!changed) return false;
    this.revision += 1;
    this.invalidateProducts();
    // Saved once per simulated hour.
    if (Math.floor(world.validHourUtc) !== this.lastSavedHour) this.saveState();
    return true;
  }

  metadata() {
    return {
      ok: true, version: '2.28.14.1', revision: this.revision, seed: this.seed, systemNumber: this.systemNumber,
      flowRegime: this.config?.flowRegime ?? null, authorityInstance: this.authorityInstance, tileStyleRevision: TILE_STYLE_REVISION,
      validHourUtc: this.atmosphere.validHourUtc, width: this.atmosphere.width, height: this.atmosphere.height,
      cellSizeMiles: this.atmosphere.cellSizeMiles, cellSizeKm: this.atmosphere.cellSizeKm,
      domainWidthMiles: this.atmosphere.domainWidthMiles, domainHeightMiles: this.atmosphere.domainHeightMiles,
      domainWidthKm: this.atmosphere.domainWidthKm, domainHeightKm: this.atmosphere.domainHeightKm,
      stormCount: this.atmosphere.storms?.length ?? 0, activeTornadoes: this.atmosphere.stormEngine?.activeTornadoes ?? 0, totalTornadoes: this.atmosphere.stormEngine?.totalTornadoes ?? 0,
      atmosphereValidHourUtc: this.atmosphere.validHourUtc, stormValidHourUtc: this.atmosphere.stormEngine?.validHourUtc ?? this.atmosphere.validHourUtc,
      stormCadenceMinutes: 5, atmosphereCadenceMinutes: 30, autoAdvance: this.autoAdvance,
      // The world day now, by the locked clock ("11/11/26 Day 3", js/forecast/calendar.js).
      worldDate: dateText(this.atmosphere.stormEngine?.validHourUtc ?? this.atmosphere.validHourUtc),
      spatialIntegrity: this.spatialIntegrity(),
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000), tilePyramid: TILE_PYRAMID,
      outlookStatus: this.outlookStatus(),
      forecastDiagnosis: null
    };
  }

  // Day 1-3 outlooks are rebuilt on this atmosphere in stage 6 of the redesign.
  outlookStatus() { return { enabled: false, running: false, queued: 0, lastRunMs: null, nextSystemSeed: null, products: {}, note: OUTLOOK_NOTE }; }

  spatialIntegrity() {
    const cells = this.atmosphere.cells?.flat?.() ?? [];
    const sampleIndexes = [0, Math.floor(cells.length * 0.17), Math.floor(cells.length * 0.39), Math.floor(cells.length * 0.61), Math.floor(cells.length * 0.83), cells.length - 1]
      .filter(index => index >= 0 && index < cells.length);
    const samples = sampleIndexes.map(index => {
      const cell = cells[index];
      return [
        Number(cell?.surface?.temperature ?? 0),
        Number(cell?.surface?.dewpoint ?? 0),
        Number(cell?.derived?.cape ?? 0),
        Number(cell?.derived?.bulkShear ?? 0),
        Number(cell?.derived?.srh ?? 0)
      ];
    });
    const distinct = new Set(samples.map(values => values.map(value => Math.round(value * 100) / 100).join('|'))).size;
    const temperatureValues = cells.map(cell => Number(cell?.surface?.temperature ?? 0));
    const dewpointValues = cells.map(cell => Number(cell?.surface?.dewpoint ?? 0));
    const capeValues = cells.map(cell => Number(cell?.derived?.cape ?? 0));
    const spread = values => values.length ? Math.max(...values) - Math.min(...values) : 0;
    return {
      ok: distinct >= 3 && spread(temperatureValues) >= 3 && spread(dewpointValues) >= 3,
      distinctSamples: distinct,
      temperatureSpreadF: spread(temperatureValues),
      dewpointSpreadF: spread(dewpointValues),
      capeSpreadJkg: spread(capeValues)
    };
  }

  assertSpatialIntegrity() {
    const integrity = this.spatialIntegrity();
    if (!integrity.ok) {
      throw new Error(`Generated atmosphere failed spatial integrity: ${JSON.stringify(integrity)}`);
    }
    return integrity;
  }

  authorityState() {
    return {
      revision: this.revision, seed: this.seed, currentSeed: this.seed,
      validHourUtc: this.atmosphere.validHourUtc, systemStartHour: START_HOUR_UTC, systemNumber: this.systemNumber,
      authorityRealTimestamp: this.lastAdvancedAt,
      atmosphere: this.serializeAtmosphere(), radarSnapshot: null,
      forecastProducts: {}
    };
  }

  serializeAtmosphere() {
    const a = this.atmosphere;
    return {
      width: a.width, height: a.height, validHourUtc: a.validHourUtc, cells: a.cells,
      evolution: a.evolution, analysis: a.analysis,
      storms: (a.storms ?? []).map(persistentStormSnapshot),
      stormArchive: (a.stormArchive ?? []).slice(-120),
      stormEngine: a.stormEngine, mesoscale: a.mesoscale, radarNetwork: a.radarNetwork,
      config: this.config
    };
  }

  cached(key, producer) {
    const cacheKey = `${this.revision}:${key}`;
    if (this.productCache.has(cacheKey)) { this.performance.cacheHits += 1; return this.productCache.get(cacheKey); }
    this.performance.cacheMisses += 1;
    const started = performance.now();
    const value = producer();
    const durationMs = performance.now() - started;
    const stat = this.performance.productBuilds[key] ??= { count: 0, totalMs: 0, maxMs: 0 };
    stat.count += 1; stat.totalMs += durationMs; stat.maxMs = Math.max(stat.maxMs, durationMs);
    this.productCache.set(cacheKey, value);
    return value;
  }

  async cachedAsync(key, producer) {
    const cacheKey = `${this.revision}:${key}`;
    if (this.productCache.has(cacheKey)) { this.performance.cacheHits += 1; return await this.productCache.get(cacheKey); }
    this.performance.cacheMisses += 1;
    const started = performance.now();
    const pending = Promise.resolve().then(producer);
    this.productCache.set(cacheKey, pending);
    try {
      const value = await pending;
      // (Not when the cache was cleared meanwhile: a new revision has no use for it, and it would
      // be kept until the next clear - a whole radar scene, 30-150 MB.)
      if (this.productCache.get(cacheKey) === pending) this.productCache.set(cacheKey, value);
      const durationMs = performance.now() - started;
      const stat = this.performance.productBuilds[key] ??= { count: 0, totalMs: 0, maxMs: 0 };
      stat.count += 1; stat.totalMs += durationMs; stat.maxMs = Math.max(stat.maxMs, durationMs);
      return value;
    } catch (error) { this.productCache.delete(cacheKey); throw error; }
  }

  liveField(product = 'temperature') {
    return this.cached(`live:${product}`, () => encodeGrid(this.atmosphere, cell => resolveField(cell, product), {
      product, validHourUtc: this.atmosphere.validHourUtc
    }));
  }

  boundaries() { return this.cached('boundaries', () => this.atmosphere.mesoscale?.boundaries ?? this.atmosphere.mesoscale ?? {}); }
  // The storm lab's view round a point (game servers run the lab's atmosphere from it:
  // docs/stormlab/SYNC-PLAN.md): map km (y south), half = cells each way. labWindow: soundings,
  // boundaries, storms; labStormsAt: only the storms (cheap, for keeping the game's storms in step).
  labWindow(xKm, yKm, half = 7) {
    const world = this.atmosphere;
    const h = Math.max(2, Math.min(12, Math.round(Number(half) || 7)));
    const centreKm = { x: Number(xKm) || world.domainWidthKm / 2, y: Number(yKm) || world.domainHeightKm / 2 };
    const sky = buildSkyAppearance(world);
    return buildLabWindow(world, { centreKm, half: h, boundaries: this.engine.boundaries ?? world.mesoscale?.boundaries ?? [], feed: buildStormFeedList(world, new Map()), meta: { name: 'live', seed: this.seed, sun: sky?.sun ?? null, revision: this.revision, paused: !this.autoAdvance } });
  }
  labStormsAt(xKm, yKm, half = 7, withInflow = false) {
    const world = this.atmosphere;
    const cellKm = world.cellSizeKm, h = Math.max(2, Math.min(12, Math.round(Number(half) || 7)));
    // (the same centre snapping as the window)
    const cx = Math.min(world.width - 1 - h, Math.max(h, Math.floor((Number(xKm) || 0) / cellKm)));
    const cy = Math.min(world.height - 1 - h, Math.max(h, Math.floor((Number(yKm) || 0) / cellKm)));
    const centre = { x: (cx + 0.5) * cellKm, y: (cy + 0.5) * cellKm };
    // paused: the authority's clock is stopped (the game holds its storms still, Roblox StormHost)
    return { simHourUtc: +(world.stormEngine?.validHourUtc ?? world.validHourUtc).toFixed(4), paused: !this.autoAdvance, centreMapKm: centre, storms: labStorms(world, centre, (h + 0.5) * cellKm, buildStormFeedList(world, new Map()), { withInflow }) };
  }
  storms() { return this.cached('storms', () => ({
    schemaVersion: 3,
    revision: this.revision,
    stormValidHourUtc: this.atmosphere.stormEngine?.validHourUtc ?? this.atmosphere.validHourUtc,
    storms: (this.atmosphere.storms ?? []).map(publicStormSnapshot),
    recentEnded: (this.atmosphere.stormArchive ?? []).slice(-40)
  })); }

  cellSummary(row, column, day = 'day1') {
    const r = Number(row), c = Number(column);
    return this.cached(`cell:${day}:${r}:${c}`, () => {
      const cell = this.atmosphere.cells?.[r]?.[c];
      if (!cell) return null;
      const surface = cell.surface ?? {}, wind = surface.wind ?? {};
      const derived = cell.derived ?? {}, dynamics = cell.dynamics ?? {}, meso = cell.mesoscaleFields ?? {};
      const outlook = cell.predictiveOutlook?.[day] ?? null;
      return {
        row: r, column: c, revision: this.revision, validHourUtc: this.atmosphere.validHourUtc,
        centerKm: { x: (c + 0.5) * this.atmosphere.cellSizeKm, y: (r + 0.5) * this.atmosphere.cellSizeKm },
        surface: {
          temperatureF: surface.temperatureF ?? surface.temperature ?? null,
          dewpointF: surface.dewpointF ?? surface.dewpoint ?? null,
          pressureMb: surface.seaLevelPressure ?? surface.pressure ?? null,
          windDirectionDeg: surface.windDirectionDeg ?? wind.direction ?? null,
          windSpeedKt: surface.windSpeedKt ?? wind.speed ?? null
        },
        instability: { cape: derived.cape ?? null, cin: derived.cin ?? null, lclM: derived.lcl ?? null, stp: derived.stp ?? null, vtp: derived.vtp ?? null, scp: derived.scp ?? null },
        shear: { srh01: derived.srh ?? null, bulkShear06Kt: derived.bulkShear ?? null },
        forcing: {
          forcingScore: dynamics.forcingScore ?? null,
          verticalVelocityMs: dynamics.verticalVelocityMs ?? null,
          convectiveReadiness: dynamics.convectiveReadiness ?? null,
          triggerStrength: dynamics.triggerStrength ?? null,
          initiationPotential: dynamics.initiationPotential ?? meso.initiationFocus ?? null
        },
        terrain: { elevationM: cell.terrain?.elevationM ?? null, region: cell.region?.name ?? cell.region?.id ?? cell.features?.regionId ?? null },
        features: { airMass: cell.features?.airMass ?? null, front: cell.features?.front ?? null, dryline: Boolean(cell.features?.dryline) },
        outlook
      };
    });
  }

  sounding(row, column, day = 'day1') {
    const r=Number(row), c=Number(column);
    return this.cached(`sounding:${day}:${r}:${c}`,()=>{
      const cell=this.atmosphere.cells?.[r]?.[c];
      if (!cell) return null;
      const sounding=buildSounding(cell);
      return {
        ...sounding,
        // The table values and possible hazard type a forecaster reads off the profile, and the
        // storm motion the storm engine would give a storm here (for the hodograph).
        display: diagnoseSoundingDisplay(sounding, cell.terrain.elevationM),
        engineMotion: diagnoseEngineMotion(this.atmosphere, c, r),
        row:r,
        column:c,
        revision:this.revision,
        validHourUtc:this.atmosphere.validHourUtc,
        context:this.cellSummary(r,c,day)
      };
    });
  }
  // Product header without the per-cell grid; fields and tiles carry the map data.
  outlook(day) {
    const product = this.atmosphere.outlookCycle?.products?.[day];
    if (!product) return null;
    const { grid, rawProbability, ...summary } = product;
    return summary;
  }
  outlookField(day, product = 'risk') {
    return this.cached(`outlook:${day}:${product}`, () => encodeGrid(this.atmosphere, cell => {
      const value = cell.predictiveOutlook?.[day] ?? {};
      if (product === 'risk') return RISK_CODES[value.risk] ?? 0;
      if (product === 'tornadoRisk') return value.tornadoProbability ?? 0;
      if (product === 'hailRisk') return value.hailProbability ?? 0;
      if (product === 'windRisk') return value.windProbability ?? 0;
      if (product === 'severeRisk') return value.severeProbability ?? 0;
      return RISK_CODES[value.risk] ?? 0;
    }, { day, product, validHourUtc: this.atmosphere.validHourUtc, outlook: this.outlook(day) }));
  }


  outlookHatchField(day, product) {
    const hazard = product === 'tornadoRisk' ? 'Tornado' : product === 'hailRisk' ? 'Hail' : product === 'windRisk' ? 'Wind' : product === 'severeRisk' ? 'Severe' : null;
    if (!hazard) return null;
    return this.cached(`outlook-hatch:${day}:${product}`, () => encodeGrid(this.atmosphere, cell => {
      const probability = Number(cell.predictiveOutlook?.[day]?.[`${hazard.toLowerCase()}Probability`]) || 0;
      if (probability <= 0) return 0;
      const key = `${hazard.toLowerCase()}Cig`;
      // Probability and CIG must come from the same forecast valid time. Using
      // the live issuance-hour environment here suppressed afternoon CIG tiers.
      const cig = Number(cell.predictiveOutlook?.[day]?.[key]) || 0;
      // Preserve the diagnosed CIG tier through the tile pipeline:
      // CIG1 = broken diagonal, CIG2 = solid diagonal, CIG3 = crossed solid.
      const maxCig = hazard === 'Hail' || hazard === 'Severe' ? 2 : 3;
      return Math.max(0, Math.min(maxCig, Math.round(cig)));
    }, { day, product, kind: 'conditional-intensity-tier', validHourUtc: this.atmosphere.validHourUtc }));
  }

  radarCatalog() {
    return this.cached('radar:catalog', () => ({
      revision: this.revision,
      validHourUtc: this.atmosphere.stormEngine?.validHourUtc ?? this.atmosphere.validHourUtc,
      domainWidthKm: this.atmosphere.domainWidthKm, domainHeightKm: this.atmosphere.domainHeightKm,
      sites: radarSitesFor(this.atmosphere), tilts: RADAR_TILTS_DEG, products: RADAR_PRODUCT_KEYS,
      radials: RADAR_RADIALS, gates: RADAR_GATES, gateKm: RADAR_GATE_KM, beamwidthDeg: RADAR_BEAMWIDTH_DEG
    }));
  }

  // The radar's products are worked out on the radar pool's threads when there is one (the same
  // bytes either way), so they are all asynchronous. The scene's storms are the engine's rain
  // fields (js/storms/StormRainFields.js), the ones the frames of storms near players read too.
  radarScene() {
    return this.cachedAsync('radar:scene', async () => {
      const world = this.atmosphere;
      if (this.radarPool) return this.radarPool.buildScene(world);
      const inputs = rainFieldInputs(world);
      return assembleRadarScene(inputs, inputs.storms.map(input => rainFieldOf(world, input.storm)));
    });
  }

  // Reflectivity from every site combined on a 1 km grid: composite (the strongest echo above
  // each place) or base (the lowest tilt that clears the ground).
  radarMosaic(kind = 'composite') {
    kind = MOSAIC_KINDS.includes(kind) ? kind : 'composite';
    this.radarWanted.set('mosaic|' + kind, Date.now());
    if (kind === 'rotationTrack') return this.radarRotationTrack();
    const revision = this.revision, sites = this.radarCatalog().sites;
    return this.cachedAsync('radar:mosaic:' + kind, async () => {
      const scene = await this.radarScene();
      const built = !this.radarPool ? buildRadarMosaic(scene, sites, { kind })
        : STACKED_MOSAIC_KINDS.includes(kind) ? (await this.radarStackedMosaics(scene, sites, kind))[kind] : await this.radarPool.mosaic(scene, sites, kind);
      const mosaic = { ...built, revision };
      this.rememberMosaic(kind, mosaic);
      return mosaic;
    });
  }

  // Composite, echo tops, VIL and hail size sample the same beams: the ones looked at in the last
  // minute (and kind) are built in one pass on the radar pool's threads (buildRadarMosaics, the same
  // bytes as each alone), and every one of them asking for this revision shares it. (Kinds already
  // built for the revision are left out; ones still being built are not, so that the kinds asked for
  // together, as the prewarm asks, name the same pass.)
  radarStackedMosaics(scene, sites, kind) {
    const now = Date.now(), built = k => { const kept = this.productCache.get(`${this.revision}:radar:mosaic:${k}`); return kept !== undefined && typeof kept?.then !== 'function'; };
    const kinds = STACKED_MOSAIC_KINDS.filter(k => k === kind || (now - (this.radarWanted.get('mosaic|' + k) ?? -Infinity) <= RADAR_PREWARM_MS && !built(k)));
    return this.cachedAsync('radar:mosaics:' + kinds.join('+'), () => this.radarPool.mosaics(scene, sites, kinds));
  }

  // Each radar's lowest scan (on the radar pool's threads), its low-level shear laid on the
  // mosaic grid, and the greatest of the last hour's scans kept (one byte grid per scan time).
  radarRotationTrack() {
    const revision = this.revision, sites = this.radarCatalog().sites;
    return this.cachedAsync('radar:mosaic:rotationTrack', async () => {
      const scene = await this.radarScene(), { width, height } = mosaicSize(scene);
      const scans = await Promise.all(sites.map(site => this.radarScan(site.id, RADAR_TILTS_DEG[0])));
      let shear;
      if (this.radarPool) shear = await this.radarPool.shearGrid(width, height, sites, scans);
      else { shear = new Float32Array(width * height); sites.forEach((site, k) => { if (scans[k]) lowLevelShearGrid(shear, width, height, MOSAIC_RES_KM, site, scans[k]); }); }
      const now = scene.validHourUtc, bytes = new Uint8Array(width * height);
      for (let i = 0; i < shear.length; i++) if (shear[i] > 0) bytes[i] = encodeRadarValue('azShear', shear[i]);
      const kept = (this.rotationScans ?? []).filter(s => s.width === width && s.height === height && now - s.validHourUtc < ROTATION_TRACK_HOURS - 1e-6 && Math.abs(now - s.validHourUtc) > 1e-6 && s.validHourUtc < now);
      kept.push({ validHourUtc: now, width, height, bytes });
      this.rotationScans = kept;
      const track = new Uint8Array(width * height);
      for (const s of kept) for (let i = 0; i < track.length; i++) if (s.bytes[i] > track[i]) track[i] = s.bytes[i];
      const mosaic = { width, height, rows: [0, height], resKm: MOSAIC_RES_KM, kind: 'rotationTrack', product: 'azShear', composite: false, validHourUtc: now,
        fromHourUtc: kept[0].validHourUtc, scans: kept.length, bytes: track, revision };
      this.rememberMosaic('rotationTrack', mosaic);
      return mosaic;
    });
  }

  // The satellite's images of the whole map (js/satellite/Satellite.js: clean IR and visible, made
  // together), worked out once a revision while asked for. What it is made from is read from the
  // world here (~15 ms); the images are drawn on a radar thread when there are some (~0.7 s).
  satellite() {
    this.radarWanted.set('satellite', Date.now());
    const revision = this.revision;
    return this.cachedAsync('satellite', async () => {
      const options = { seed: this.seed, regional: this.engine.regional, anvils: this.anvils };
      const images = this.radarPool ? await this.radarPool.satellite(satelliteInputs(this.atmosphere, options)) : buildSatellite(this.atmosphere, options);
      return { ...images, revision };
    });
  }

  // The newest mosaic of a kind is kept as it is; the older ones with their grid deflated (a grid is
  // 648 KB and deflates to 4-70 KB in a few ms: 47 MB for the whole history became ~3 MB, 2026-11-10).
  rememberMosaic(kind, mosaic) {
    const history = this.radarHistory[kind].filter(frame => Math.abs(frame.validHourUtc - mosaic.validHourUtc) > 1e-6);
    history.push({ validHourUtc: mosaic.validHourUtc, mosaic });
    history.sort((a, b) => a.validHourUtc - b.validHourUtc);
    const kept = history.slice(-RADAR_HISTORY_FRAMES);
    for (let i = 0; i < kept.length - 1; i++) {
      const frame = kept[i];
      if (frame.mosaic) { const { bytes, ...rest } = frame.mosaic; kept[i] = { validHourUtc: frame.validHourUtc, packed: { ...rest, deflated: deflateRawSync(bytes, { level: 1 }) } }; }
    }
    this.radarHistory[kind] = kept;
  }

  // The scan times of the mosaics of a kind kept, and one of them.
  radarMosaicFrames(kind = 'composite') { return { kind, frames: (this.radarHistory[kind] ?? []).map(({ validHourUtc, mosaic, packed }) => ({ validHourUtc, revision: (mosaic ?? packed).revision })) }; }
  radarMosaicAt(validHourUtc, kind = 'composite') {
    const frame = (this.radarHistory[kind] ?? []).find(f => Math.abs(f.validHourUtc - validHourUtc) < 1e-6);
    if (!frame) return null;
    if (frame.mosaic) return frame.mosaic;
    const { deflated, ...rest } = frame.packed;
    return { ...rest, bytes: new Uint8Array(inflateRawSync(deflated)) };
  }

  // One tilt of one site; all products are simulated together and cached per revision. fine: with
  // the 250 m gates of a close look (RADAR_FINE_GATE_KM) rather than the usual.
  async radarScan(siteId, tiltDeg, { fine = false } = {}) {
    const site = this.radarCatalog().sites.find(s => s.id === siteId);
    if (!site) return null;
    const tilt = RADAR_TILTS_DEG.reduce((a, b) => (Math.abs(b - tiltDeg) < Math.abs(a - tiltDeg) ? b : a));
    const gateKm = fine ? RADAR_FINE_GATE_KM : RADAR_GATE_KM, tag = fine ? '|fine' : '';
    this.radarWanted.set(`${site.id}|${tilt}${tag}`, Date.now());
    const revision = this.revision;
    return this.cachedAsync(`radar:scan:${site.id}:${tilt}${tag}`, async () => {
      const scene = await this.radarScene();
      return { ...(this.radarPool ? await this.radarPool.scan(scene, site, tilt, gateKm) : scanRadarTilt(scene, site, tilt, { gateKm })), revision };
    });
  }

  // The rotation one radar's volume scan shows (js/radar/RotationDetection.js): its lowest tilts
  // scanned and the detections worked out from them (on the radar pool's threads when there is one).
  radarRotation(siteId) {
    const site = this.radarCatalog().sites.find(s => s.id === siteId);
    if (!site) return Promise.resolve(null);
    this.radarWanted.set(`rotation|${site.id}`, Date.now());
    const revision = this.revision, tilts = RADAR_TILTS_DEG.slice(0, RADAR_ROTATION_TILTS);
    return this.cachedAsync(`radar:rotation:${site.id}`, async () => {
      const scans = (await Promise.all(tilts.map(tilt => this.radarScan(site.id, tilt)))).filter(Boolean);
      if (!scans.length) return null;
      return { siteId: site.id, validHourUtc: scans[0].validHourUtc, tilts, ...(this.radarPool ? await this.radarPool.rotation(site, scans) : detectRotation(site, scans)), revision };
    });
  }

  // After a new scan time: works out again, on the radar pool's threads, what has been looked at
  // in the last minute, so it is ready when the radar pages ask. The mosaic is always made, so
  // the radar page's loop has the last hour as soon as it opens.
  prewarmRadar(now = Date.now()) {
    if (!this.radarPool) return;
    for (const [key, at] of this.radarWanted) {
      if (now - at > RADAR_PREWARM_MS) { this.radarWanted.delete(key); continue; }
      if (key.startsWith('mosaic|')) { this.radarMosaic(key.slice(7)).catch(() => {}); this.radarWanted.set(key, at); continue; }
      if (key === 'satellite') { this.satellite().catch(() => {}); this.radarWanted.set(key, at); continue; }
      if (key.startsWith('rotation|')) { this.radarRotation(key.slice(9)).catch(() => {}); this.radarWanted.set(key, at); continue; }
      if (now - at > RADAR_PREWARM_MS) { this.radarWanted.delete(key); continue; }
      const [site, tilt, fine] = key.split('|');
      (key === 'mosaic' ? this.radarMosaic() : this.radarScan(site, Number(tilt), { fine: fine === 'fine' })).catch(() => {});
      this.radarWanted.set(key, at);
    }
  }


  async productTile({ scope = 'live', product = 'temperature', day = 'day1', station = 'composite', z = 0, x = 0, y = 0 } = {}) {
    const zoom = Math.max(TILE_PYRAMID.minZoom, Math.min(TILE_PYRAMID.maxZoom, Number(z) || 0));
    const tx = Number(x) || 0, ty = Number(y) || 0;
    const key = `tile:${scope}:${day}:${product}:${station}:${zoom}:${tx}:${ty}`;
    return this.cachedAsync(key, async () => {
      if (scope === 'radar') return null;
      const grid = scope === 'outlook' ? this.outlookField(day, product) : this.liveField(product);
      const hatch = scope === 'outlook' ? this.outlookHatchField(day, product) : null;
      return await renderTile({ values: decodeF32Base64(grid.values), width: grid.width, height: grid.height, product, z: zoom, x: tx, y: ty, hatchValues: hatch ? decodeF32Base64(hatch.values) : null });
    });
  }


  prewarmView(view = {}) {
    const scope=view.scope==='outlook'?'outlook':'live', day=/^day[123]$/.test(view.day)?view.day:'day1';
    const product=String(view.product|| (scope==='outlook'?'risk':'temperature'));
    const zoom=Math.max(0,Math.min(3,Number(view.z)||2)),count=2**zoom;
    setImmediate(()=>{for(let y=0;y<count;y++)for(let x=0;x<count;x++)this.productTile({scope,day,product,z:zoom,x,y}).catch(()=>{});});
  }

  mapManifest({ scope = 'live', product = 'temperature', day = 'day1', station = 'composite' } = {}) {
    return { ...this.metadata(), scope, product, day, station, forecastDiagnosis: null, ...TILE_PYRAMID,
      overlays: this.mapOverlayGeometry(),
      legend: scope === 'outlook' ? (OUTLOOK_LEGENDS[product] ?? null) : null,
      hatchLegend: scope === 'outlook' && product !== 'risk' ? 'CIG1 broken diagonal · CIG2 solid diagonal · CIG3 crossed diagonal' : null,
      tileUrl: `/api/tiles/${scope}/{z}/{x}/{y}.png?product=${encodeURIComponent(product)}&day=${encodeURIComponent(day)}&station=${encodeURIComponent(station)}&revision=${this.revision}&authority=${this.authorityInstance}&style=${TILE_STYLE_REVISION}` };
  }

  mapOverlayGeometry() {
    const framework=this.atmosphere.worldFramework;
    const regionIds=[...new Set(framework?.cells?.flatMap(row=>row.map(cell=>cell.regionId))??[])];
    const regionIndex=new Map(regionIds.map((id,index)=>[id,index]));
    const boundaries=(this.atmosphere.mesoscale?.boundaries??[]).filter(boundary=>boundary.active!==false).map(boundary=>({
      id:boundary.id,type:boundary.type,strength:boundary.strength,
      pointsKm:(boundary.pointsKm??[]).map(point=>({x:point.x,y:point.y}))
    }));
    return {
      // Fronts with their symbol side, isobars, pressure centres and wind barbs (per revision).
      ...this.cached('analysisOverlays',()=>buildAnalysisOverlays(this.atmosphere,boundaries)),
      regions:{
        ids:regionIds,
        cells:framework?.cells?.map(row=>row.map(cell=>regionIndex.get(cell.regionId)??-1))??[],
        labels:(framework?.regions??[]).map(region=>({id:region.id,label:region.shortLabel??region.label??region.id,centroid:region.centroid}))
      }
    };
  }

  // Writes the whole world so a restart resumes it at this hour. The copy is taken now; the
  // file is written in the background.
  saveState() {
    if (!this.statePath) return;
    this.lastSavedHour = Math.floor(this.atmosphere.validHourUtc);
    if (this.savingState) { this.saveQueued = true; return; }
    const bytes = v8.serialize({ version: STATE_VERSION, code: this.codeVersion, revision: this.revision, worldId: this.worldId, clockOffset: this.clockOffset, engine: this.engine.saveState() });
    // (the cloud model storms are saved with the world, so a restart resumes both from the same moment)
    this.savingState = this.writeFile(this.statePath, bytes)
      .then(() => this.stormWorkers?.saveModels?.())
      .catch(error => console.warn('[authority] state not saved:', error.message))
      .finally(() => { this.savingState = null; if (this.saveQueued) { this.saveQueued = false; this.saveState(); } });
  }

  async writeFile(file, bytes) {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(`${file}.tmp`, bytes);
    await fs.promises.rename(`${file}.tmp`, file);
  }

  // Resumes the saved world. A state written by different simulation code is not resumed, unless
  // WEATHER_KEEP_WORLD=on (the hosted game): then the world is carried on under the new code when
  // a throwaway copy of it steps cleanly, and otherwise a new world starts and the old save is kept
  // as <state>.old. (Bump STATE_VERSION when the saved layout changes in a way that cannot carry on.)
  restoreState() {
    if (!this.statePath || !fs.existsSync(this.statePath)) return false;
    try {
      const bytes = fs.readFileSync(this.statePath), state = v8.deserialize(bytes);
      const otherCode = state.code !== this.codeVersion, keep = process.env.WEATHER_KEEP_WORLD === 'on';
      if (state.version !== STATE_VERSION || (otherCode && !keep)) { console.log('[authority] saved state is from other code; starting a new world'); return false; }
      if (otherCode) {
        const problem = carryOverProblem(v8.deserialize(bytes).engine);
        if (problem) {
          console.warn(`[authority] saved world does not carry on under the new code (${problem}); starting a new world, old save kept as .old`);
          fs.copyFileSync(this.statePath, `${this.statePath}.old`);
          return false;
        }
      }
      const engine = AtmosphereWorld.restore(state.engine);
      if (!engine) return false;
      this.revision = state.revision;
      // (saves from before 2026-11-11 have no id: the seed stands in, and is saved from then on)
      this.worldId = state.worldId ?? `seed-${state.engine?.seed ?? this.seed}`;
      this.clockOffset = state.clockOffset ?? null;
      this.adoptEngine(engine);
      console.log(`[authority] resumed seed ${this.seed} at hour ${this.atmosphere.validHourUtc}${otherCode ? ' (carried over from other code)' : ''}`);
      return true;
    } catch (error) {
      console.warn('[authority] saved state unreadable:', error.message);
      return false;
    }
  }

}


function publicStormSnapshot(storm) {
  const tornado = storm.tornado ? {
    state: storm.tornado.state, onGround: Boolean(storm.tornado.onGround), probability: storm.tornado.probability ?? 0,
    genesisPotential: storm.tornado.genesisPotential ?? 0, positionKm: storm.tornado.positionKm,
    previousPositionKm: storm.tornado.previousPositionKm, windSpeedMph: storm.tornado.windSpeedMph ?? 0,
    peakWindSpeedMph: storm.tornado.peakWindSpeedMph ?? 0, estimatedEf: storm.tornado.estimatedEf,
    widthYards: storm.tornado.widthYards ?? 0, groundTimeMinutes: storm.tornado.groundTimeMinutes ?? 0,
    pathLengthKm: storm.tornado.pathLengthKm ?? 0, forwardSpeedMph: storm.tornado.forwardSpeedMph ?? 0,
    motionDirectionDeg: storm.tornado.motionDirectionDeg ?? 0, cycleCount: storm.tornado.cycleCount ?? 0,
    trackPoints: (storm.tornado.trackPoints ?? []).slice(-96),
    intensityEnvironment: storm.tornado.intensityEnvironment ?? 0, synopticSupport: storm.tornado.synopticSupport ?? 0,
    environmentWindCeilingMph: storm.tornado.environmentWindCeilingMph ?? 0
  } : null;
  return {
    id: storm.id, active: storm.active, positionKm: storm.positionKm, previousPositionKm: storm.previousPositionKm,
    velocityKph: storm.velocityKph, lifecycleState: storm.lifecycleState, ageHours: storm.ageHours,
    intensity: storm.intensity, maxIntensity: storm.maxIntensity, organization: storm.organization,
    updraftStrength: storm.updraftStrength, peakUpdraftStrength: storm.peakUpdraftStrength ?? 0,
    rotationStrength: storm.rotationStrength ?? 0, peakRotationStrength: storm.peakRotationStrength ?? 0,
    // The storm's own state, for anything that draws it: its budgets, the rotation near the
    // ground that comes before a tornado, how far its outflow has wrapped around, the air
    // driven down behind a line, and where its parts are.
    updraughtMs: storm.updraughtMs ?? 0, precipitation: storm.precipitation ?? 0, lowRotation: storm.lowRotation ?? 0, occlusion: storm.occlusion ?? 0,
    rearInflow: storm.rearInflow ?? 0, boundaryBoost: storm.boundaryBoost ?? 0, geometry: storm.geometry ?? null,
    coldPoolStrength: storm.coldPoolStrength ?? 0, coldPoolRadiusKm: storm.coldPoolRadiusKm ?? 0,
    inflowQuality: storm.inflowQuality ?? 0, mode: storm.mode, modeConfidence: storm.modeConfidence ?? 0,
    motion: storm.motion ?? {}, surfaceWind: storm.surfaceWind ?? {}, tornado,
    hazardExtremes: structuredClone(storm.hazardExtremes ?? {
      tornado:{ maxWindMph:0, maxEfRating:null, maxWidthYards:0, maxPathLengthKm:0, cycles:0 },
      wind:{ maxSustainedMph:storm.surfaceWind?.maxSustainedMph ?? 0, maxGustMph:storm.surfaceWind?.maxGustMph ?? 0 },
      hail:{ maxSizeInches:storm.hazards?.hailSizeInches ?? 0 }
    }),
    tornadoHistory: (storm.tornadoHistory ?? []).slice(-8), eventTags: storm.eventTags ?? [], hazards: storm.hazards ?? {},
    radar: storm.radar ?? {}, parentId: storm.parentId ?? null, children: storm.children ?? [],
    mergeCount: storm.mergeCount ?? 0, mergedStormIds: storm.mergedStormIds ?? [], trackKm: storm.trackKm ?? 0,
    trackPoints: (storm.trackPoints ?? []).slice(-240),
    environmentSummary: { stp: storm.environment?.stp ?? 0, vtp: storm.environment?.vtp ?? 0, srh: storm.environment?.srh ?? 0, bulkShear: storm.environment?.bulkShear ?? 0,
      cape: storm.environment?.cape ?? 0, lcl: storm.environment?.lcl ?? 0, synopticAscent: storm.environment?.synopticAscent ?? 0,
      synopticCoherence: storm.environment?.synopticCoherence ?? 0, prefrontalSupercellSupport: storm.environment?.prefrontalSupercellSupport ?? 0 }
  };
}
function persistentStormSnapshot(storm) {
  return { ...publicStormSnapshot(storm), createdHourUtc: storm.createdHourUtc, sourceCell: storm.sourceCell,
    environment: storm.environment, interactionSuppression: storm.interactionSuppression ?? 0,
    hasSplit: Boolean(storm.hasSplit), internalField: serializeStormInternalField(storm.internalField) };
}

function encodeGrid(atmosphere, resolver, extra = {}) {
  const values = new Float32Array(atmosphere.width * atmosphere.height);
  let min = Infinity, max = -Infinity, index = 0;
  for (const row of atmosphere.cells) for (const cell of row) {
    const value = Number(resolver(cell)) || 0;
    values[index++] = value; min = Math.min(min, value); max = Math.max(max, value);
  }
  return { ...extra, revision: atmosphere.worldRevision ?? 0, width: atmosphere.width, height: atmosphere.height, min, max, encoding: 'f32-base64', values: Buffer.from(values.buffer).toString('base64') };
}

function resolveField(cell, product) {
  const d = cell.derived?.diagnostics ?? cell.diagnostics ?? {};
  const m = cell.mesoscaleFields ?? cell.mesoscale ?? {};
  switch (product) {
    case 'temperature': return cell.surface?.temperatureF ?? cell.surface?.temperature;
    case 'dewpoint': return cell.surface?.dewpointF ?? cell.surface?.dewpoint;
    case 'pressure': return cell.surface?.seaLevelPressure ?? cell.surface?.pressureMb;
    case 'cape': return cell.derived?.cape;
    case 'cin': return Math.abs(cell.derived?.cin ?? 0);
    case 'srh': return cell.derived?.srh ?? cell.kinematics?.srh01M2s2;
    case 'bulkShear': return cell.derived?.bulkShear ?? cell.kinematics?.bulkShear06Kt;
    case 'stp': return cell.derived?.stp ?? 0;
    case 'vtp': return cell.derived?.vtp ?? 0;
    case 'forcing': return d.forcingScore ?? cell.dynamics?.forcing;
    case 'verticalMotion': return d.verticalVelocityMs ?? d.verticalMotion;
    case 'initiation': return (m.initiationFocus ?? d.initiationPotential ?? 0) * 100;
    case 'readiness': return (d.convectiveReadiness ?? 0) * 100;
    case 'trigger': return (d.triggerStrength ?? 0) * 100;
    case 'emlInfluence': return (cell.dynamics?.emlInfluence ?? 0) * 100;
    case 'lapseRate': return cell.thermodynamics?.lapseRates?.mb700_500 ?? cell.derived?.lapseRate700500 ?? cell.derived?.sounding?.lapseRate700500 ?? 0;
    case 'windSurface': return cell.surface?.windSpeedKt ?? cell.surface?.windSpeed ?? cell.surface?.wind?.speed;
    case 'wind800': return levelWind(cell, 800).speed;
    case 'wind500': return levelWind(cell, 500).speed;
    case 'wind250': return levelWind(cell, 250).speed;
    default: return cell.surface?.temperatureF ?? cell.surface?.temperature;
  }
}

function levelWind(cell, pressure) {
  const source=cell.levels ?? {};
  const direct=Array.isArray(source)?source.find(v=>Number(v.pressure)===pressure):source[pressure];
  if(direct)return{direction:Number(direct.windDirection??direct.direction)||0,speed:Number(direct.windSpeed??direct.speed)||0};
  const levels=(Array.isArray(source)?source:Object.entries(source).map(([p,v])=>({pressure:Number(p),...v}))).filter(v=>Number.isFinite(Number(v.pressure))).sort((a,b)=>Number(b.pressure)-Number(a.pressure));
  const hi=levels.find(v=>Number(v.pressure)>=pressure),lo=[...levels].reverse().find(v=>Number(v.pressure)<=pressure);
  if(!hi||!lo||Number(hi.pressure)===Number(lo.pressure)){const v=hi??lo??{};return{direction:Number(v.windDirection)||0,speed:Number(v.windSpeed)||0};}
  const f=(Number(hi.pressure)-pressure)/(Number(hi.pressure)-Number(lo.pressure));
  const ar=(Number(hi.windDirection)||0)*Math.PI/180,br=(Number(lo.windDirection)||0)*Math.PI/180;
  const u=(1-f)*Math.sin(ar)*(Number(hi.windSpeed)||0)+f*Math.sin(br)*(Number(lo.windSpeed)||0);
  const v=(1-f)*Math.cos(ar)*(Number(hi.windSpeed)||0)+f*Math.cos(br)*(Number(lo.windSpeed)||0);
  return{direction:(Math.atan2(u,v)*180/Math.PI+360)%360,speed:Math.hypot(u,v)};
}

// Why a saved world from other code would not carry on, or null: a copy restored and stepped
// half an hour must not throw, and its large-scale and regional fields must stay numbers.
function carryOverProblem(engineState) {
  try {
    const probe = AtmosphereWorld.restore(engineState);
    if (!probe) return 'old layout';
    probe.advance(0.5);
    const finite = values => { for (let i = 0; i < values.length; i++) if (!Number.isFinite(values[i])) return false; return true; };
    for (const key of ['q1', 'q2', 'psi1', 'psi2', 'moisture', 'surfaceTheta', 'surfaceMoisture']) if (probe.model[key] && !finite(probe.model[key])) return `model ${key} not finite`;
    for (const [key, values] of Object.entries(probe.regional)) if ((values instanceof Float32Array || values instanceof Float64Array) && !finite(values)) return `regional ${key} not finite`;
    return null;
  } catch (error) { return error?.message ?? String(error); }
}

// Fingerprint of the simulation source (file contents, so a fresh checkout or image build of the
// same code matches): saved states and cached forecasts from other code are not reused.
function sourceVersion() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const hash = crypto.createHash('sha1');
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name.endsWith('.js')) hash.update(`${path.relative(root, full)}|`).update(fs.readFileSync(full));
    }
  };
  visit(path.join(root, 'js'));
  visit(path.join(root, 'server'));
  return hash.digest('hex').slice(0, 16);
}

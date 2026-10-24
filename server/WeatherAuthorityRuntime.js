// The live authority: one world of weather (the redesigned atmosphere with its storms, see
// docs/ATMOSPHERE-REDESIGN.md) advanced on a clock and served as products: fields, tiles,
// soundings, storms, radar and the surface analysis overlays. The weather is continuous;
// there are no separate systems to switch between.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import v8 from 'node:v8';
import { fileURLToPath } from 'node:url';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { buildSounding, diagnoseSoundingDisplay } from '../js/sounding.js';
import { diagnoseEngineMotion } from '../js/storms/SoundingHazards.js';
import { serializeStormInternalField } from '../js/storms/StormInternalField.js';
import { renderTile, decodeF32Base64, TILE_PYRAMID, OUTLOOK_LEGENDS } from './tiles/ProductTileRenderer.js';
import { buildRadarScene, scanRadarTilt, buildRadarMosaic, MOSAIC_KINDS } from '../js/radar/RadarSimulator.js';
import { radarSitesFor } from './RadarSites.js';
import { buildAnalysisOverlays } from './analysisOverlays.js';
import { GameFeed } from './GameFeed.js';
import { countiesFor, placesFor } from './CountyLayer.js';
import { logStormTick } from '../js/reports/stormLog.js';
import { createDayRecorder } from './DayReviewRecorder.js';
import { LightningLog } from '../js/storms/Lightning.js';
import { RADAR_TILTS_DEG, RADAR_PRODUCT_KEYS, RADAR_RADIALS, RADAR_GATES, RADAR_GATE_KM, RADAR_BEAMWIDTH_DEG } from '../js/radar/RadarFormat.js';

const DEFAULT_SEED = 1000;
const START_HOUR_UTC = 12;
// A simulated day takes 120 real minutes (12x; it was 96, 15x, until 2026-10-15). Storms move
// every five simulated minutes; the atmosphere steps every half hour and then takes account
// of what the storms did meanwhile.
const SIM_HOURS_PER_REAL_MINUTE = 0.2;
const STORM_CADENCE_HOURS = 1 / 12, ATMOSPHERE_STEP_HOURS = 0.5;
const REAL_MS_PER_STORM_TICK = (STORM_CADENCE_HOURS / SIM_HOURS_PER_REAL_MINUTE) * 60000;
const MAX_STEPS_PER_TICK = 4;
const RADAR_PREWARM_MS = 60_000;
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
  constructor({ seed, statePath = null, spinUpDays = 45, radarPool = null, regional = {}, dayReviews = null } = {}) {
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
    this.gameFeed = new GameFeed({ tickMs: REAL_MS_PER_STORM_TICK, regional });
    const explicitSeed = seed !== undefined && seed !== null && seed !== '';
    if (explicitSeed || !this.restoreState()) { this.build(seed); this.saveState(); }
  }

  build(seed) {
    const number = Number(seed), given = seed !== undefined && seed !== null && seed !== '' && Number.isFinite(number);
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
    this.lastAdvancedAt = Date.now(); this.lastStormAdvancedAt = this.lastAdvancedAt;
    this.gameFeed?.restart(world, this.lastStormAdvancedAt);
    // The day's storm reports and tornado tracks (js/reports/stormLog.js), after each storm tick.
    const places = placesFor(world);
    this.places = places;
    // The last half hour's lightning (js/storms/Lightning.js), added to after each storm tick.
    this.lightning = new LightningLog({ seed: engine.seed });
    // The meteorologist's day packages (DayReviewRecorder.js), from the next 12Z on.
    this.dayReview = this.dayReviews ? createDayRecorder({ engine, outDir: this.dayReviews.dir, places, png: Boolean(this.dayReviews.png), keepDays: this.dayReviews.keepDays ?? null, outlookFor: (from, to) => this.dayReviewOutlook?.(from, to) ?? null }) : null;
    engine.onStormTick = () => { logStormTick(world, places); this.lightning.record(world); this.dayReview?.stormTick(); };
  }

  reset(seed = this.seed) {
    this.build(seed);
    this.radarHistory = Object.fromEntries(MOSAIC_KINDS.map(kind => [kind, []]));
    this.lastAdvancedAt = Date.now(); this.lastStormAdvancedAt = this.lastAdvancedAt;
    this.revision += 1;
    this.invalidateProducts();
    this.saveState();
    return this.metadata();
  }

  // `onStep` is called after each atmosphere step of the advance.
  advance(hours = 0.5, onStep) {
    const amount = Math.max(0, Math.min(72, Number(hours) || 0));
    if (amount < ATMOSPHERE_STEP_HOURS) return this.metadata();
    // Storms may have been ticked ahead of the atmosphere; bring both to the same time first.
    // The storms move in the same five-minute ticks as on the clock (in half-hour steps tornadoes
    // came and went unseen and storms jumped past the towns that would report them).
    const world = this.atmosphere;
    for (let step = 0; step < Math.round(amount / ATMOSPHERE_STEP_HOURS); step++) {
      this.stormTicksTo(world.validHourUtc + ATMOSPHERE_STEP_HOURS);
      this.engine.advance(ATMOSPHERE_STEP_HOURS, { advanceStorms: false, onStep });
      this.dayReview?.afterStep();
    }
    this.lastAdvancedAt = Date.now(); this.lastStormAdvancedAt = this.lastAdvancedAt;
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
    this.autoAdvance = Boolean(enabled);
    this.lastAdvancedAt = Date.now();
    this.lastStormAdvancedAt = this.lastAdvancedAt;
    return this.metadata();
  }

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

  advanceOnTimer(now = Date.now()) {
    if (!this.autoAdvance) return false;
    const world = this.atmosphere;
    let changed = false;
    // Storms never run more than one atmosphere step ahead of the atmosphere.
    const room = Math.round((world.validHourUtc + ATMOSPHERE_STEP_HOURS - (world.stormEngine?.validHourUtc ?? world.validHourUtc)) / STORM_CADENCE_HOURS);
    const due = Math.floor(Math.max(0, now - this.lastStormAdvancedAt) / REAL_MS_PER_STORM_TICK), ticks = Math.max(0, Math.min(due, room));
    // One tick at a time, so the game gets a frame for each, stamped with when it fell due.
    for (let tick = 1; tick <= ticks; tick++) { this.engine.advanceStormLayer(STORM_CADENCE_HOURS); this.gameFeed.capture(world, this.lastStormAdvancedAt + tick * REAL_MS_PER_STORM_TICK); changed = true; }
    if (due > 0) this.lastStormAdvancedAt += due * REAL_MS_PER_STORM_TICK;
    const steps = Math.min(MAX_STEPS_PER_TICK, Math.floor((Math.max(0, now - this.lastAdvancedAt) / 60000 * SIM_HOURS_PER_REAL_MINUTE) / ATMOSPHERE_STEP_HOURS));
    if (steps > 0) {
      for (let step = 0; step < steps; step++) {
        const ahead = (world.stormEngine?.validHourUtc ?? world.validHourUtc) - world.validHourUtc;
        if (ahead < ATMOSPHERE_STEP_HOURS - 1e-6) { this.stormTicksTo(world.validHourUtc + ATMOSPHERE_STEP_HOURS); this.gameFeed.capture(world, now); }
        this.engine.advance(ATMOSPHERE_STEP_HOURS, { advanceStorms: false });
        this.dayReview?.afterStep();
      }
      // Caught up after a long pause: the storms jumped, and the game should not glide across it.
      if (steps === MAX_STEPS_PER_TICK) this.gameFeed.restart(world, now);
      // After a long pause the clock restarts from now instead of racing to catch up.
      this.lastAdvancedAt = steps === MAX_STEPS_PER_TICK ? now : this.lastAdvancedAt + steps * ATMOSPHERE_STEP_HOURS / SIM_HOURS_PER_REAL_MINUTE * 60000;
      if (steps === MAX_STEPS_PER_TICK) this.lastStormAdvancedAt = now;
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
      this.productCache.set(cacheKey, value);
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
  // bytes either way), so they are all asynchronous.
  radarScene() {
    return this.cachedAsync('radar:scene', () => (this.radarPool ? this.radarPool.buildScene(this.atmosphere) : buildRadarScene(this.atmosphere)));
  }

  // Reflectivity from every site combined on a 1 km grid: composite (the strongest echo above
  // each place) or base (the lowest tilt that clears the ground).
  radarMosaic(kind = 'composite') {
    kind = MOSAIC_KINDS.includes(kind) ? kind : 'composite';
    this.radarWanted.set('mosaic|' + kind, Date.now());
    const revision = this.revision, sites = this.radarCatalog().sites;
    return this.cachedAsync('radar:mosaic:' + kind, async () => {
      const scene = await this.radarScene();
      const mosaic = { ...(this.radarPool ? await this.radarPool.mosaic(scene, sites, kind) : buildRadarMosaic(scene, sites, { kind })), revision };
      this.rememberMosaic(kind, mosaic);
      return mosaic;
    });
  }

  rememberMosaic(kind, mosaic) {
    const history = this.radarHistory[kind].filter(frame => Math.abs(frame.validHourUtc - mosaic.validHourUtc) > 1e-6);
    history.push({ validHourUtc: mosaic.validHourUtc, mosaic });
    history.sort((a, b) => a.validHourUtc - b.validHourUtc);
    this.radarHistory[kind] = history.slice(-RADAR_HISTORY_FRAMES);
  }

  // The scan times of the mosaics of a kind kept, and one of them.
  radarMosaicFrames(kind = 'composite') { return { kind, frames: (this.radarHistory[kind] ?? []).map(({ validHourUtc, mosaic }) => ({ validHourUtc, revision: mosaic.revision })) }; }
  radarMosaicAt(validHourUtc, kind = 'composite') { return (this.radarHistory[kind] ?? []).find(frame => Math.abs(frame.validHourUtc - validHourUtc) < 1e-6)?.mosaic ?? null; }

  // One tilt of one site; all products are simulated together and cached per revision.
  async radarScan(siteId, tiltDeg) {
    const site = this.radarCatalog().sites.find(s => s.id === siteId);
    if (!site) return null;
    const tilt = RADAR_TILTS_DEG.reduce((a, b) => (Math.abs(b - tiltDeg) < Math.abs(a - tiltDeg) ? b : a));
    this.radarWanted.set(`${site.id}|${tilt}`, Date.now());
    const revision = this.revision;
    return this.cachedAsync(`radar:scan:${site.id}:${tilt}`, async () => {
      const scene = await this.radarScene();
      return { ...(this.radarPool ? await this.radarPool.scan(scene, site, tilt) : scanRadarTilt(scene, site, tilt)), revision };
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
      if (now - at > RADAR_PREWARM_MS) { this.radarWanted.delete(key); continue; }
      const [site, tilt] = key.split('|');
      (key === 'mosaic' ? this.radarMosaic() : this.radarScan(site, Number(tilt))).catch(() => {});
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
    const bytes = v8.serialize({ version: STATE_VERSION, code: this.codeVersion, revision: this.revision, engine: this.engine.saveState() });
    this.savingState = this.writeFile(this.statePath, bytes)
      .catch(error => console.warn('[authority] state not saved:', error.message))
      .finally(() => { this.savingState = null; if (this.saveQueued) { this.saveQueued = false; this.saveState(); } });
  }

  async writeFile(file, bytes) {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(`${file}.tmp`, bytes);
    await fs.promises.rename(`${file}.tmp`, file);
  }

  // Resumes the saved world. A state written by different simulation code is not resumed.
  restoreState() {
    if (!this.statePath || !fs.existsSync(this.statePath)) return false;
    try {
      const state = v8.deserialize(fs.readFileSync(this.statePath));
      if (state.version !== STATE_VERSION || state.code !== this.codeVersion) { console.log('[authority] saved state is from other code; starting a new world'); return false; }
      const engine = AtmosphereWorld.restore(state.engine);
      if (!engine) return false;
      this.revision = state.revision;
      this.adoptEngine(engine);
      console.log(`[authority] resumed seed ${this.seed} at hour ${this.atmosphere.validHourUtc}`);
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

// Fingerprint of the simulation source: saved states and cached forecasts from other code are
// not reused.
function sourceVersion() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const hash = crypto.createHash('sha1');
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name.endsWith('.js')) { const stat = fs.statSync(full); hash.update(`${full}|${stat.size}|${stat.mtimeMs}`); }
    }
  };
  visit(path.join(root, 'js'));
  visit(path.join(root, 'server'));
  return hash.digest('hex').slice(0, 16);
}

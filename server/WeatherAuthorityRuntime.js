import fs from 'node:fs';
import { buildOutlookDiscussion } from '../js/forecast/OutlookDiscussionEngine.js?v=2.25.1';
import path from 'node:path';
import crypto from 'node:crypto';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere, advanceStormLayer } from '../js/evolution.js';
import { SIMULATION_CONFIG } from '../js/simulationConfig.js';
import { buildSounding } from '../js/sounding.js';
import { serializeStormInternalField } from '../js/storms/StormInternalField.js';
import { renderTile, decodeF32Base64, decodeU8Base64, TILE_PYRAMID, OUTLOOK_LEGENDS } from './tiles/ProductTileRenderer.js';

const DEFAULT_SEED = 20270503;
const SIM_HOURS_PER_REAL_MINUTE = 0.25;
const STORM_CADENCE_HOURS = 1 / 12;
const REAL_MS_PER_STORM_TICK = (STORM_CADENCE_HOURS / SIM_HOURS_PER_REAL_MINUTE) * 60000;
const RISK_CODES = { TSTM: 0, MRGN: 1, SLGT: 2, ENH: 3, MDT: 4, HIGH: 5 };
const TILE_STYLE_REVISION = 'spc-probability-v6';

export class WeatherAuthorityRuntime {
  constructor({ seed = DEFAULT_SEED, checkpointPath = path.resolve('data/authority-checkpoint.json') } = {}) {
    this.seed = Number(seed) || DEFAULT_SEED;
    this.authorityInstance = crypto.randomBytes(8).toString('hex');
    this.checkpointPath = checkpointPath;
    this.startedAt = Date.now();
    this.lastAdvancedAt = Date.now();
    this.lastStormAdvancedAt = this.lastAdvancedAt;
    this.revision = 0;
    this.atmosphere = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
    this.config = generateScenario(this.atmosphere, this.seed);
    initializeEvolution(this.atmosphere, this.config);
    this.assertSpatialIntegrity();
    this.radarCache = null;
    this.radarCacheHour = null;
    this.productCache = new Map();
    this.performance = { cacheHits: 0, cacheMisses: 0, productBuilds: {} };
    this.autoAdvance = true;
  }


  reset(seed = this.seed) {
    const parsed = Number(seed);
    this.seed = Number.isFinite(parsed) ? Math.trunc(parsed) : DEFAULT_SEED;
    this.atmosphere = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
    this.config = generateScenario(this.atmosphere, this.seed);
    initializeEvolution(this.atmosphere, this.config);
    this.assertSpatialIntegrity();
    this.lastAdvancedAt = Date.now();
    this.lastStormAdvancedAt = this.lastAdvancedAt;
    this.revision += 1;
    this.invalidateProducts();
    this.persistCheckpoint();
    return this.metadata();
  }

  advance(hours = 0.5) {
    const amount = Math.max(0, Math.min(72, Number(hours) || 0));
    if (amount <= 0) return this.metadata();
    advanceAtmosphere(this.atmosphere, amount);
    this.lastAdvancedAt = Date.now();
    this.lastStormAdvancedAt = this.lastAdvancedAt;
    this.revision += 1;
    this.invalidateProducts();
    this.persistCheckpoint();
    return this.metadata();
  }

  seek(targetHour) {
    const target = Math.max(SIMULATION_CONFIG.startHourUtc, Math.min(84, Number(targetHour) || SIMULATION_CONFIG.startHourUtc));
    if (target + 1e-6 < this.atmosphere.validHourUtc) this.reset(this.seed);
    const delta = target - this.atmosphere.validHourUtc;
    if (delta > 1e-6) this.advance(delta);
    return this.metadata();
  }

  setAutoAdvance(enabled) {
    this.autoAdvance = Boolean(enabled);
    this.lastAdvancedAt = Date.now();
    this.lastStormAdvancedAt = this.lastAdvancedAt;
    return this.metadata();
  }

  invalidateProducts() {
    this.radarCache = null;
    this.radarCacheHour = null;
    this.productCache.clear();
  }

  advanceOnTimer(now = Date.now()) {
    if (!this.autoAdvance) return false;
    let changed = false;
    const dueStormTicks = Math.min(72, Math.floor(Math.max(0, now - this.lastStormAdvancedAt) / REAL_MS_PER_STORM_TICK));
    if (dueStormTicks > 0) {
      advanceStormLayer(this.atmosphere, dueStormTicks * STORM_CADENCE_HOURS, { applyFeedback: false, initiate: true });
      this.lastStormAdvancedAt += dueStormTicks * REAL_MS_PER_STORM_TICK;
      changed = true;
    }
    const elapsedMinutes = Math.max(0, now - this.lastAdvancedAt) / 60000;
    const hours = Math.floor((elapsedMinutes * SIM_HOURS_PER_REAL_MINUTE) / 0.5) * 0.5;
    if (hours >= 0.5) {
      advanceAtmosphere(this.atmosphere, hours, { advanceStorms: false });
      this.lastAdvancedAt += (hours / SIM_HOURS_PER_REAL_MINUTE) * 60000;
      changed = true;
    }
    if (!changed) return false;
    this.revision += 1;
    this.invalidateProducts();
    this.persistCheckpoint();
    return true;
  }

  metadata() {
    return {
      ok: true, version: '2.28.14.1', revision: this.revision, seed: this.seed, authorityInstance: this.authorityInstance, tileStyleRevision: TILE_STYLE_REVISION,
      validHourUtc: this.atmosphere.validHourUtc, width: this.atmosphere.width, height: this.atmosphere.height,
      cellSizeMiles: this.atmosphere.cellSizeMiles, cellSizeKm: this.atmosphere.cellSizeKm,
      domainWidthMiles: this.atmosphere.domainWidthMiles, domainHeightMiles: this.atmosphere.domainHeightMiles,
      domainWidthKm: this.atmosphere.domainWidthKm, domainHeightKm: this.atmosphere.domainHeightKm,
      stormCount: this.atmosphere.storms?.length ?? 0, activeTornadoes: this.atmosphere.stormEngine?.activeTornadoes ?? 0, totalTornadoes: this.atmosphere.stormEngine?.totalTornadoes ?? 0,
      atmosphereValidHourUtc: this.atmosphere.validHourUtc, stormValidHourUtc: this.atmosphere.stormEngine?.validHourUtc ?? this.atmosphere.validHourUtc,
      stormCadenceMinutes: 5, atmosphereCadenceMinutes: 30, autoAdvance: this.autoAdvance,
      spatialIntegrity: this.spatialIntegrity(),
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000), tilePyramid: TILE_PYRAMID,
      forecastDiagnosis: buildOutlookDiscussion(this.atmosphere, this.config, 'day1')
    };
  }


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
      validHourUtc: this.atmosphere.validHourUtc, systemStartHour: SIMULATION_CONFIG.startHourUtc, systemNumber: 1,
      authorityRealTimestamp: this.lastAdvancedAt,
      atmosphere: this.serializeAtmosphere(), radarSnapshot: null,
      forecastProducts: this.atmosphere.outlookCycle?.products ?? {}
    };
  }

  serializeAtmosphere() {
    const a = this.atmosphere;
    return {
      width: a.width, height: a.height, validHourUtc: a.validHourUtc, cells: a.cells,
      evolution: a.evolution, analysis: a.analysis,
      storms: (a.storms ?? []).map(persistentStormSnapshot),
      stormArchive: (a.stormArchive ?? []).slice(-120),
      stormOutflows: (a.stormOutflows ?? []).slice(-160),
      stormEngine: a.stormEngine, mesoscale: a.mesoscale, airMassEngine: a.airMassEngine,
      regions: a.regions, synopticCoherence: a.synopticCoherence, setupForecast: a.setupForecast,
      outlookCycle: a.outlookCycle, upcomingSystemForecast: a.upcomingSystemForecast, radarNetwork: a.radarNetwork,
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
      return {
        ...buildSounding(cell),
        row:r,
        column:c,
        revision:this.revision,
        validHourUtc:this.atmosphere.validHourUtc,
        context:this.cellSummary(r,c,day)
      };
    });
  }
  outlook(day) { return this.atmosphere.outlookCycle?.products?.[day] ?? null; }
  outlookField(day, product = 'risk') {
    return this.cached(`outlook:${day}:${product}`, () => encodeGrid(this.atmosphere, cell => {
      const value = cell.predictiveOutlook?.[day] ?? {};
      if (product === 'risk') return RISK_CODES[value.risk] ?? 0;
      if (product === 'tornadoRisk') return value.tornadoProbability ?? 0;
      if (product === 'hailRisk') return value.hailProbability ?? 0;
      if (product === 'windRisk') return value.windProbability ?? 0;
      return RISK_CODES[value.risk] ?? 0;
    }, { day, product, validHourUtc: this.atmosphere.validHourUtc, outlook: this.outlook(day) }));
  }


  outlookHatchField(day, product) {
    const hazard = product === 'tornadoRisk' ? 'Tornado' : product === 'hailRisk' ? 'Hail' : product === 'windRisk' ? 'Wind' : null;
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
      const maxCig = hazard === 'Hail' ? 2 : 3;
      return Math.max(0, Math.min(maxCig, Math.round(cig)));
    }, { day, product, kind: 'conditional-intensity-tier', validHourUtc: this.atmosphere.validHourUtc }));
  }

  getRadarSnapshot() {
    const stormHour = this.atmosphere.stormEngine?.validHourUtc ?? this.atmosphere.validHourUtc;
    const scanHour = Math.floor(stormHour * 12) / 12;
    if (!this.radarCache || this.radarCacheHour !== scanHour) {
      this.radarCache = createRadarSnapshot(this.atmosphere);
      this.radarCacheHour = scanHour;
    }
    return this.radarCache;
  }

  radarStations() { return this.atmosphere.radarNetwork?.stations ?? []; }

  radarScan(product = 'reflectivity', station = 'composite') {
    return this.cached(`radar:${product}:${station}`, () => {
      const snapshot = this.getRadarSnapshot();
      const frame = rasterizeRadarValues(snapshot, product, station);
      const quantized = quantizeRadar(frame.values, product);
      return {
        product, station, revision: this.revision, validHourUtc: snapshot.validHourUtc,
        size: frame.size, encoding: 'u8-base64', values: Buffer.from(quantized.values.buffer).toString('base64'),
        valueMin: quantized.min, valueMax: quantized.max,
        domainWidthKm: snapshot.domainWidthKm, domainHeightKm: snapshot.domainHeightKm,
        radarNetwork: snapshot.radarNetwork,
        storms: (snapshot.storms ?? []).map(({ internalField, ...storm }) => storm)
      };
    });
  }


  async productTile({ scope = 'live', product = 'temperature', day = 'day1', station = 'composite', z = 0, x = 0, y = 0 } = {}) {
    const zoom = Math.max(TILE_PYRAMID.minZoom, Math.min(TILE_PYRAMID.maxZoom, Number(z) || 0));
    const tx = Number(x) || 0, ty = Number(y) || 0;
    const key = `tile:${scope}:${day}:${product}:${station}:${zoom}:${tx}:${ty}`;
    return this.cachedAsync(key, async () => {
      if (scope === 'radar') return null;
      if (false) {
        const scan = this.radarScan(product, station);
        return await renderTile({ values: decodeU8Base64(scan.values), width: scan.size, height: scan.size, product, z: zoom, x: tx, y: ty, valueMin: scan.valueMin, valueMax: scan.valueMax });
      }
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
    return { ...this.metadata(), scope, product, day, station, forecastDiagnosis: buildOutlookDiscussion(this.atmosphere, this.config, day), ...TILE_PYRAMID,
      overlays: this.mapOverlayGeometry(),
      legend: scope === 'outlook' ? (OUTLOOK_LEGENDS[product] ?? null) : null,
      hatchLegend: scope === 'outlook' && product !== 'risk' ? 'CIG1 broken diagonal · CIG2 solid diagonal · CIG3 crossed diagonal' : null,
      tileUrl: `/api/tiles/${scope}/{z}/{x}/{y}.png?product=${encodeURIComponent(product)}&day=${encodeURIComponent(day)}&station=${encodeURIComponent(station)}&revision=${this.revision}&authority=${this.authorityInstance}&style=${TILE_STYLE_REVISION}` };
  }

  mapOverlayGeometry() {
    const framework=this.atmosphere.worldFramework;
    const regionIds=[...new Set(framework?.cells?.flatMap(row=>row.map(cell=>cell.regionId))??[])];
    const regionIndex=new Map(regionIds.map((id,index)=>[id,index]));
    return {
      boundaries:(this.atmosphere.mesoscale?.boundaries??[]).filter(boundary=>boundary.active!==false).map(boundary=>({
        id:boundary.id,type:boundary.type,strength:boundary.strength,
        pointsKm:(boundary.pointsKm??[]).map(point=>({x:point.x,y:point.y}))
      })),
      regions:{
        ids:regionIds,
        cells:framework?.cells?.map(row=>row.map(cell=>regionIndex.get(cell.regionId)??-1))??[],
        labels:(framework?.regions??[]).map(region=>({id:region.id,label:region.shortLabel??region.label??region.id,centroid:region.centroid}))
      }
    };
  }

  persistCheckpoint() {
    try {
      fs.mkdirSync(path.dirname(this.checkpointPath), { recursive: true });
      const tmp = `${this.checkpointPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ revision: this.revision, seed: this.seed, validHourUtc: this.atmosphere.validHourUtc, savedAt: Date.now() }));
      fs.renameSync(tmp, this.checkpointPath);
    } catch (error) { console.warn('[authority] checkpoint skipped:', error.message); }
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
    case 'cape': return cell.derived?.cape ?? cell.thermodynamics?.capeJkg;
    case 'cin': return Math.abs(cell.derived?.cin ?? cell.thermodynamics?.cinJkg ?? 0);
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

function quantizeRadar(values, product) {
  const min = product === 'reflectivity' ? -10 : product === 'velocity' ? -160 : 0.48;
  const max = product === 'reflectivity' ? 82 : product === 'velocity' ? 160 : 1;
  const output = new Uint8Array(values.length);
  const scale = 254 / (max - min);
  // Byte zero is reserved for no meteorological echo. This prevents velocity
  // and CC from painting the entire radar coverage area with their minimum
  // palette color when the analytic raster contains NaN outside storms.
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    output[index] = Number.isFinite(value)
      ? 1 + Math.max(0, Math.min(254, Math.round((value - min) * scale)))
      : 0;
  }
  return { values: output, min, max, noDataValue: 0 };
}

// The surface analysis of the live world: station observations, isobars, pressure centres,
// fronts, the dryline, outflow boundaries and storms, all read from the atmosphere's fields
// (docs/ATMOSPHERE-REDESIGN.md), and the mesoanalysis fields that can be laid over them. It
// does not advance anything: the authority does. It keeps the analyses of the last hours so
// the page can step back through them and loop them.
import { buildAnalysisOverlays } from './analysisOverlays.js';
import { MESOANALYSIS_PARAMETERS, buildParameterField } from './mesoanalysisParameters.js';

const HISTORY_FRAMES = 36;   // 18 simulated hours at one frame per atmosphere step

export class SurfaceAnalysisRuntime {
  // atmosphere: the authority's AtmosphereWorld. simHoursPerRealMinute is only reported.
  constructor({ atmosphere, simHoursPerRealMinute = 0.25, stationCount = 110, stationSpacingKm = 55 }) {
    this.simHoursPerRealMinute = simHoursPerRealMinute;
    this.stationCount = stationCount; this.stationSpacingKm = stationSpacingKm;
    this.steps = 0;
    this.attach(atmosphere);
  }

  // Call again when the authority starts a new world.
  attach(atmosphere) {
    this.atmosphere = atmosphere; this.regional = atmosphere.regional; this.seed = atmosphere.seed;
    this.stations = placeStations(this.regional.world, this.seed, this.stationCount, this.stationSpacingKm);
    this.frames = []; this.stormStamp = null;
    this.capture();
  }

  // Keeps a frame for every atmosphere step it is called on (the server calls it on its
  // clock), and keeps the newest frame's storms current between steps. The fields are read
  // now because the cells are overwritten at the next step.
  capture() {
    const world = this.regional.world, hour = this.regional.hourUtc, stormStamp = world.stormEngine?.revision ?? 0;
    const last = this.frames.at(-1);
    if (!last || last.hour !== hour) {
      this.steps++;
      this.frames.push({ hour, analysis: this.buildAnalysis(), fields: new Map(MESOANALYSIS_PARAMETERS.map(parameter => [parameter.key, buildParameterField(world, parameter)])) });
      if (this.frames.length > HISTORY_FRAMES) this.frames.shift();
    } else if (stormStamp !== this.stormStamp) { this.steps++; last.analysis = this.buildAnalysis(); }
    this.stormStamp = stormStamp;
  }

  frame(hour) { return (hour === undefined || hour === null || hour === '' ? null : this.frames.find(f => f.hour === Number(hour))) ?? this.frames.at(-1); }

  // The surface analysis of a kept frame (the newest when none is named), with the list of
  // frames and of parameters the page can ask for.
  analysis(hour) {
    this.capture();
    const frame = this.frame(hour);
    return { ...frame.analysis, frameHour: frame.hour, latest: frame === this.frames.at(-1), frames: this.frames.map(f => f.hour), parameters: MESOANALYSIS_PARAMETERS.map(({ key, group, label, unit }) => ({ key, group, label, unit })) };
  }

  // One mesoanalysis field of a kept frame, or null for an unknown name.
  parameter(key, hour) {
    this.capture();
    const frame = this.frame(hour), field = frame.fields.get(key);
    return field ? { ...field, frameHour: frame.hour } : null;
  }

  buildAnalysis() {
    const regional = this.regional, world = regional.world, hours = regional.hourUtc;
    const boundaries = this.atmosphere.boundaries;
    const overlays = buildAnalysisOverlays(world, boundaries.map(({ id, type, symbolSide, pointsKm, lengthKm, contrast, advanceMs }) => ({ id, type, symbolSide, pointsKm, lengthKm, contrast, advanceMph: Math.round(advanceMs * 2.237) })));
    const field = read => { const out = new Array(world.width * world.height); world.forEachCell((cell, x, y) => { out[y * world.width + x] = Math.round(read(cell)); }); return out; };
    return {
      status: 'ready', seed: this.seed, revision: this.steps,
      day: Math.floor(hours / 24) + 1, hourUtc: ((hours % 24) + 24) % 24, localOffsetHours: regional.params.utcOffsetHours,
      simHoursPerRealMinute: this.simHoursPerRealMinute,
      domain: { widthKm: world.domainWidthKm, heightKm: world.domainHeightKm, cellKm: world.cellSizeKm, columns: world.width, rows: world.height },
      stations: this.stations.map(station => observe(world, station)),
      isobars: overlays.isobars, pressureCentres: overlays.pressureCentres, boundaries: overlays.boundaries,
      storms: world.storms.filter(storm => storm.active && storm.intensity >= 0.15).map(describeStorm),
      tornadoesSoFar: world.stormEngine.totalTornadoes,
      // Whole-map fields for the optional shading and the cursor readout (row by row from the north-west).
      fields: { temperatureF: field(c => c.surface.temperature), dewpointF: field(c => c.surface.dewpoint), elevationM: field(c => c.terrain.elevationM) }
    };
  }
}

// A fixed, irregular network of stations, like a real one: scattered, never crowded.
function placeStations(world, seed, count, spacingKm) {
  let state = (seed * 2654435761 + 97) >>> 0;
  const random = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const stations = [], margin = world.cellSizeKm;
  for (let attempt = 0; attempt < 6000 && stations.length < count; attempt++) {
    const xKm = margin + random() * (world.domainWidthKm - 2 * margin), yKm = margin + random() * (world.domainHeightKm - 2 * margin);
    if (stations.every(s => Math.hypot(s.xKm - xKm, s.yKm - yKm) >= spacingKm)) stations.push({ id: `S${String(stations.length + 1).padStart(3, '0')}`, xKm: Math.round(xKm * 10) / 10, yKm: Math.round(yKm * 10) / 10 });
  }
  return stations;
}

// What a station at that spot reports: the fields around it, interpolated between cell centres.
function observe(world, station) {
  const gx = Math.max(0, Math.min(world.width - 1, station.xKm / world.cellSizeKm - 0.5)), gy = Math.max(0, Math.min(world.height - 1, station.yKm / world.cellSizeKm - 0.5));
  const x0 = Math.min(world.width - 2, Math.floor(gx)), y0 = Math.min(world.height - 2, Math.floor(gy)), tx = gx - x0, ty = gy - y0;
  const blend = read => (read(world.cells[y0][x0]) * (1 - tx) + read(world.cells[y0][x0 + 1]) * tx) * (1 - ty) + (read(world.cells[y0 + 1][x0]) * (1 - tx) + read(world.cells[y0 + 1][x0 + 1]) * tx) * ty;
  const u = blend(c => -Math.sin(c.surface.wind.direction * Math.PI / 180) * c.surface.wind.speed), v = blend(c => -Math.cos(c.surface.wind.direction * Math.PI / 180) * c.surface.wind.speed);
  const temperatureF = blend(c => c.surface.temperature);
  return {
    ...station, elevationM: Math.round(blend(c => c.terrain.elevationM)),
    temperatureF: Math.round(temperatureF), dewpointF: Math.round(Math.min(temperatureF, blend(c => c.surface.dewpoint))),
    pressureHpa: Math.round(blend(c => c.surface.seaLevelPressure) * 10) / 10,
    windKt: Math.round(Math.hypot(u, v)), windFromDeg: Math.round((Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360)
  };
}

// A storm as the map shows it: where it is, how strong, where it is going, what it is producing.
function describeStorm(storm) {
  const tornado = storm.tornado?.onGround ? { windMph: Math.round(storm.tornado.windSpeedMph ?? 0), widthYards: Math.round(storm.tornado.widthYards ?? 0) } : null;
  return {
    id: storm.id, xKm: Math.round(storm.positionKm.x * 10) / 10, yKm: Math.round(storm.positionKm.y * 10) / 10,
    strength: Math.round(storm.intensity * 100) / 100, character: storm.mode,
    speedMph: Math.round(storm.motion?.speedMph ?? 0), towardDeg: Math.round(storm.motion?.directionDeg ?? 0),
    hailInches: Math.round((storm.currentHailSizeInches ?? 0) * 100) / 100, gustMph: Math.round(storm.surfaceWind?.gustMph ?? 0), tornado
  };
}

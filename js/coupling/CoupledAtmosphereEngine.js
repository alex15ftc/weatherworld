import { clamp } from '../scenarios/math.js?v=2.21.4';

const EPSILON = 0.025;
const MAX_IDLE_HOURS = 18;

export function initializeCoupledAtmosphere(world) {
  world.coupledAtmosphere = {
    version: '2.22.12',
    mode: 'sparse-active-cells',
    cellScaleMiles: 10,
    lastUpdateHourUtc: world.validHourUtc,
    integratedStormHours: 0,
    activeFeedbackCells: 0,
    memoryCells: Object.create(null)
  };
  world.forEachCell(cell => clearExposedMemory(cell));
}

export function advanceCoupledAtmosphere(world, dtHours = 1) {
  if (!world.coupledAtmosphere) initializeCoupledAtmosphere(world);
  const state = world.coupledAtmosphere;
  state.memoryCells ??= Object.create(null);
  const utcHour = ((world.validHourUtc % 24) + 24) % 24;
  const localHour = ((utcHour - 6) % 24 + 24) % 24;
  const daylight = localHour < 6 || localHour > 20.5 ? 0 : localHour <= 15.5
    ? smoothstep(6,15.5,localHour) : 1-smoothstep(15.5,20.5,localHour);
  const night = 1 - daylight;
  let activeFeedbackCells = 0;

  world.forEachCell((cell, x, y) => {
    const key = y * world.width + x;
    const stormProcessed = clamp(cell.features?.stormProcessedAir ?? 0, 0, 1);
    const outflow = clamp(cell.features?.stormOutflowConvergence ?? 0, 0, 1);
    const nearbyStorm = clamp(cell.features?.nearbyStormIntensity ?? 0, 0, 1);
    const forcingActive = Math.max(stormProcessed, outflow, nearbyStorm) > EPSILON;
    let memory = state.memoryCells[key];

    if (!memory && !forcingActive) {
      clearExposedMemory(cell);
      return;
    }
    memory ??= state.memoryCells[key] = createMemory(world.validHourUtc);
    memory.lastActiveHour = forcingActive ? world.validHourUtc : memory.lastActiveHour;

    const currentPrecip = clamp(Math.max(stormProcessed * 0.72, nearbyStorm * 0.58), 0, 1);
    const synopticAscent = clamp(cell.features?.synopticAscent ?? 0, 0, 1);
    const moistureTransport = clamp(((cell.levels?.[850]?.windSpeed ?? 0) - 15) / 38, 0, 1);
    const warmSector = cell.features?.warmSector ? 1 : 0;
    const regionalRecovery = clamp(cell.region?.moistureRecovery ?? cell.features?.moistureRecovery ?? 0.9, 0.55, 1.2);
    const recoverySupport = clamp(0.30 * synopticAscent + 0.30 * moistureTransport + 0.24 * warmSector + 0.16 * regionalRecovery, 0, 1.15);
    const daytimeVentilation = daylight * (0.55 + 0.45 * recoverySupport);

    memory.precip = relax(memory.precip, currentPrecip, currentPrecip > memory.precip ? 0.72 : 0.15 + 0.10 * daytimeVentilation, dtHours);
    memory.coldPool = relax(memory.coldPool, Math.max(stormProcessed, outflow * 0.82), stormProcessed > memory.coldPool ? 0.68 : 0.11 + 0.10 * daytimeVentilation, dtHours);
    memory.processed = relax(memory.processed, stormProcessed, stormProcessed > memory.processed ? 0.75 : 0.10 + 0.13 * daytimeVentilation + 0.06 * recoverySupport, dtHours);
    memory.boundary = relax(memory.boundary, outflow, outflow > memory.boundary ? 0.62 : 0.10 + 0.04 * daytimeVentilation, dtHours);
    memory.stormMax = Math.max(nearbyStorm, memory.stormMax * Math.pow(0.88, dtHours));

    const humidCloud = clamp((cell.surface.dewpoint - 48) / 24, 0, 1) * clamp((cell.derived.cape ?? 0) / 2200, 0, 1);
    const targetCloud = clamp(humidCloud * 0.24 + Math.max(memory.precip, memory.stormMax * 0.9) * 0.82, 0, 1);
    memory.cloud = relax(memory.cloud, targetCloud, targetCloud > memory.cloud ? 0.62 : 0.13, dtHours);

    const wetting = memory.precip * 0.18 * dtHours;
    const evaporation = daylight * (1 - memory.cloud * 0.65) * 0.018 * dtHours;
    memory.wetness = clamp(memory.wetness + wetting - evaporation, 0, 1);
    // Terrain is immutable geography. Event-scale rain and evaporation belong
    // in coupled atmospheric memory rather than rewriting the framework's
    // climatological soil-moisture field.

    const nightTarget = clamp(night * (1 - memory.cloud * 0.55) * (0.55 + (1 - cell.surface.wind.speed / 35) * 0.45), 0, 1);
    memory.stability = relax(memory.stability, nightTarget, nightTarget > memory.stability ? 0.3 : 0.18, dtHours);
    // Persistent synoptic moisture transport and afternoon mixing can rapidly
    // rebuild the warm sector after morning or prior-day convection. Storms still
    // damage the local environment, but they no longer erase an entire subsequent
    // forecast period when the parent system remains supportive.
    const recovery = clamp(0.34 + recoverySupport * 0.46 + daylight * 0.15
      - memory.processed * 0.46 - memory.coldPool * 0.16
      + memory.wetness * daylight * 0.18, 0.22, 1);
    if (daylight > 0.35 && recoverySupport > 0.58) {
      cell.surface.temperature += (0.12 + recoverySupport * 0.16) * daylight * dtHours;
      cell.surface.dewpoint += (0.05 + moistureTransport * 0.10 + memory.wetness * 0.06) * dtHours;
    }

    cell.surface.temperature -= (daylight * memory.cloud * 0.42 + memory.precip * 0.30 + memory.stability * 0.20) * dtHours;
    cell.surface.dewpoint += (memory.wetness * daylight * 0.11 - memory.processed * 0.035) * dtHours;
    exposeMemory(cell, memory, recovery, stormProcessed, outflow);

    const strength = Math.max(memory.processed, memory.cloud, memory.boundary, memory.precip, memory.wetness, memory.coldPool);
    const idleHours = Math.max(0, world.validHourUtc - memory.lastActiveHour);
    if (strength < EPSILON && idleHours >= MAX_IDLE_HOURS) {
      delete state.memoryCells[key];
      clearExposedMemory(cell);
    } else {
      activeFeedbackCells++;
    }
  });

  state.lastUpdateHourUtc = world.validHourUtc;
  state.integratedStormHours += (world.storms?.filter(s => s.active).length ?? 0) * dtHours;
  state.activeFeedbackCells = activeFeedbackCells;
}

export function projectStormInfluence(world) {
  world.forEachCell(cell => { cell.features.nearbyStormIntensity = 0; });
  for (const storm of world.storms ?? []) {
    if (!storm.active) continue;
    const radiusKm = Math.max(world.cellSizeKm, (storm.radar?.radiusXKm ?? 18) * 1.35);
    const radiusCells = Math.ceil(radiusKm / world.cellSizeKm);
    const cx = storm.positionKm.x / world.cellSizeKm - 0.5;
    const cy = storm.positionKm.y / world.cellSizeKm - 0.5;
    for (let y = Math.max(0, Math.floor(cy - radiusCells)); y <= Math.min(world.height - 1, Math.ceil(cy + radiusCells)); y++) {
      for (let x = Math.max(0, Math.floor(cx - radiusCells)); x <= Math.min(world.width - 1, Math.ceil(cx + radiusCells)); x++) {
        const cell = world.getCell(x, y);
        const dx = (x + 0.5) * world.cellSizeKm - storm.positionKm.x;
        const dy = (y + 0.5) * world.cellSizeKm - storm.positionKm.y;
        const distance = Math.hypot(dx, dy);
        if (distance > radiusKm) continue;
        const weight = Math.exp(-Math.pow(distance / Math.max(1, radiusKm * 0.58), 2));
        cell.features.nearbyStormIntensity = Math.max(cell.features.nearbyStormIntensity ?? 0, weight * storm.intensity);
      }
    }
  }
}

function createMemory(hour) { return { cloud:0, precip:0, coldPool:0, processed:0, boundary:0, wetness:0, stability:0, stormMax:0, lastActiveHour:hour }; }
function exposeMemory(cell, m, recovery, stormProcessed, outflow) {
  const synopticColdWake = Number(cell.memory?.synopticColdWake) || 0;
  const synopticColdWakeAgeHours = Number(cell.memory?.synopticColdWakeAgeHours) || 0;
  cell.memory = { cloudCover:m.cloud, precipitationMemory:m.precip, coldPoolMemory:m.coldPool, processedAir:m.processed, boundaryMemory:m.boundary, surfaceWetness:m.wetness, nocturnalStability:m.stability, recovery, maxRecentStormIntensity:m.stormMax, synopticColdWake, synopticColdWakeAgeHours };
  cell.features.cloudCover = m.cloud;
  cell.features.precipitationMemory = m.precip;
  cell.features.surfaceWetness = m.wetness;
  cell.features.nocturnalStability = m.stability;
  cell.features.recoveryFactor = recovery;
  cell.features.residualOutflow = m.boundary;
  cell.features.stormProcessedAir = Math.max(stormProcessed, m.processed * 0.78);
  cell.features.stormOutflowConvergence = Math.max(outflow, m.boundary * 0.64);
}
function clearExposedMemory(cell) {
  const synopticColdWake = Number(cell.memory?.synopticColdWake) || 0;
  const synopticColdWakeAgeHours = Number(cell.memory?.synopticColdWakeAgeHours) || 0;
  if (synopticColdWake > 0) cell.memory = { synopticColdWake, synopticColdWakeAgeHours };
  else delete cell.memory;
  cell.features.cloudCover = 0; cell.features.precipitationMemory = 0; cell.features.surfaceWetness = 0;
  cell.features.nocturnalStability = 0; cell.features.recoveryFactor = 1; cell.features.residualOutflow = 0;
}
function relax(current, target, rate, dtHours) { return clamp(current + (target - current) * clamp(rate * dtHours, 0, 1), 0, 1); }

function smoothstep(a,b,value){const t=clamp((value-a)/Math.max(1e-6,b-a),0,1);return t*t*(3-2*t);}

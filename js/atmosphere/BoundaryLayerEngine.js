import { clamp } from '../scenarios/math.js?v=2.20.1';

export function initializeBoundaryLayer(world) {
  world.forEachCell(cell => {
    cell.boundaryLayer = createState(cell, world.validHourUtc);
  });
  world.boundaryLayerEngine = { version: '2.74.0', validHourUtc: world.validHourUtc };
}

export function advanceBoundaryLayer(world, dtHours = 0.5) {
  const localHour = mod24(world.validHourUtc - 6);
  const solar = localHour >= 5.75 && localHour <= 20.75
    ? Math.max(0, Math.sin(Math.PI * (localHour - 5.75) / 15)) : 0;
  world.forEachCell(cell => {
    const state = cell.boundaryLayer ?? createState(cell, world.validHourUtc);
    const soil = clamp(cell.terrain?.soilMoisture ?? 0.45, 0, 1);
    const cloud = clamp(cell.memory?.cloudCover ?? cell.features?.cloudCover ?? 0, 0, 1);
    const windKt = Math.max(0, Number(cell.surface?.wind?.speed) || 0);
    const sensibleFluxWm2 = solar * (1 - cloud * 0.72) * (95 + 170 * (1 - soil));
    const latentFluxWm2 = solar * (1 - cloud * 0.55) * (45 + 185 * soil);
    const mechanicalMixing = clamp((windKt - 5) / 35, 0, 1);
    const convectiveGrowthMph = sensibleFluxWm2 * 2.9 + mechanicalMixing * 210;
    const nocturnalCollapseMph = solar < 0.03 ? 180 * (1 - mechanicalMixing * 0.65) : 0;
    const targetDepthM = clamp(180 + sensibleFluxWm2 * 7 + mechanicalMixing * 620, 120, 3200);
    const response = clamp(dtHours * (targetDepthM > state.depthM ? 0.48 : 0.72), 0, 1);
    state.depthM += (targetDepthM - state.depthM) * response;
    state.depthM = clamp(state.depthM + (convectiveGrowthMph - nocturnalCollapseMph) * dtHours * 0.08, 100, 3400);
    const inversionTarget = solar < 0.03 ? clamp(1 - mechanicalMixing * 0.75 - cloud * 0.35, 0, 1) : clamp(0.25 - solar * 0.45, 0, 0.25);
    state.inversionStrength += (inversionTarget - state.inversionStrength) * clamp(dtHours * 0.7, 0, 1);
    state.residualLayerDepthM = Math.max(state.depthM, state.residualLayerDepthM * Math.pow(0.94, dtHours));
    if (solar > 0.15) state.residualLayerDepthM = Math.max(state.residualLayerDepthM, state.depthM);
    state.sensibleHeatFluxWm2 = sensibleFluxWm2;
    state.latentHeatFluxWm2 = latentFluxWm2;
    state.mechanicalMixing = mechanicalMixing;
    state.mixedLayerTemperatureF = cell.surface.temperature;
    state.mixedLayerDewpointF = cell.surface.dewpoint;
    state.validHourUtc = world.validHourUtc;
    cell.boundaryLayer = state;
    cell.features.boundaryLayerDepthM = state.depthM;
    cell.features.nocturnalInversionStrength = state.inversionStrength;
  });
  world.boundaryLayerEngine = { version: '2.74.0', validHourUtc: world.validHourUtc };
}

function createState(cell, hourUtc) {
  return { version: '2.74.0', depthM: 450, residualLayerDepthM: 800, inversionStrength: 0.2,
    sensibleHeatFluxWm2: 0, latentHeatFluxWm2: 0, mechanicalMixing: 0,
    mixedLayerTemperatureF: cell.surface.temperature, mixedLayerDewpointF: cell.surface.dewpoint, validHourUtc: hourUtc };
}
function mod24(value) { return ((value % 24) + 24) % 24; }

import { clamp01 } from './random.js';

export function createScenarioFeatures(scenario, grid) {
  const { width, height } = grid;
  const lowX = width * (.27 + scenario.progression.speed * .12);
  const lowY = height * (.25 + (1 - scenario.ingredients.troughTilt) * .18);
  return [
    { type: 'surfaceLow', id: 'low-1', x: lowX, y: lowY, pressure: 1004 - scenario.progression.deepeningRate * 18, influenceRadius: width * .38 },
    { type: 'dryline', id: 'dryline-1', x: width * (.38 + scenario.progression.boundaryMotion * .1), moistureGradient: scenario.ingredients.moistureQuality, convergenceStrength: scenario.ingredients.forcingTiming },
    { type: 'jetStreak', id: 'jet-1', x: width * .46, y: height * .3, radius: width * .42, strength: scenario.ingredients.lowLevelJetStrength }
  ];
}

export function projectFeatures(grid, scenario, features, validHour = 0) {
  grid.beginUpdate();
  const f = grid.fields;
  const diurnal = Math.max(0, Math.sin((((validHour % 24) - 6) / 12) * Math.PI));
  const low = features.find(feature => feature.type === 'surfaceLow');
  const dryline = features.find(feature => feature.type === 'dryline');
  const jet = features.find(feature => feature.type === 'jetStreak');

  for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
    const i = y * grid.width + x;
    const nx = x / Math.max(1, grid.width - 1);
    const ny = y / Math.max(1, grid.height - 1);
    const lowInfluence = Math.exp(-Math.hypot(x - low.x, y - low.y) / low.influenceRadius);
    const warmSide = 1 / (1 + Math.exp(-(x - dryline.x) * .35));
    const boundary = Math.exp(-Math.abs(x - dryline.x) / 5);
    const jetInfluence = Math.exp(-Math.hypot(x - jet.x, y - jet.y) / jet.radius);
    const moisture = clamp01(warmSide * scenario.ingredients.moistureQuality * (.82 + ny * .18));
    const cap = scenario.ingredients.capStrength * (.65 + (1 - nx) * .35);
    f.temperature2m[i] = 17 + 16 * diurnal + 5 * warmSide - 4 * ny;
    f.dewpoint2m[i] = 5 + 19 * moisture;
    f.pressure[i] = 1017 - lowInfluence * (1017 - low.pressure);
    f.mlcape[i] = Math.max(0, moisture * (900 + 3900 * diurnal) * (1 - cap * .22));
    f.mlcin[i] = -Math.max(0, 25 + cap * 180 - diurnal * 145 - boundary * 45);
    f.lcl[i] = 600 + (1 - moisture) * 1550;
    f.shear01km[i] = 5 + 19 * jetInfluence * jet.strength;
    f.shear06km[i] = 12 + 27 * jetInfluence * scenario.ingredients.troughAmplitude;
    f.srh01km[i] = 35 + 290 * jetInfluence * jet.strength * lowInfluence;
    f.srh03km[i] = f.srh01km[i] * 1.55;
    f.lapseRate700500[i] = 6.2 + scenario.ingredients.troughAmplitude * 2.1;
    f.effectiveInflowDepth[i] = Math.max(0, moisture * 2500 - Math.abs(f.mlcin[i]) * 4);
    f.convergence[i] = clamp01(boundary * dryline.convergenceStrength);
    grid.boundaryMask[i] = boundary > .55 ? 1 : 0;
    f.lift[i] = clamp01(lowInfluence * .45 + boundary * .35 + jetInfluence * .2);
    f.forcing[i] = clamp01(f.lift[i] * scenario.ingredients.forcingTiming);
    const capErosion = clamp01(1 - Math.abs(f.mlcin[i]) / 220);
    f.initiationPotential[i] = clamp01(f.convergence[i] * f.forcing[i] * moisture * capErosion * (0.25 + diurnal * .75));
    f.stormCoveragePotential[i] = clamp01(f.initiationPotential[i] * (.35 + f.forcing[i] * .65));
    f.severePotential[i] = clamp01((f.mlcape[i] / 4000) * .42 + (f.shear06km[i] / 40) * .35 + f.forcing[i] * .23);
  }
  grid.classifyTiers();
}

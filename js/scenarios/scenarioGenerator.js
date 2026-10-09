// Builds the initial atmosphere for a seed. A severe-weather narrative supplies ingredient
// ranges (narratives.js); the seed picks a setup family, a flow regime and a point in each
// range. From those this module builds a balanced large-scale pattern (500 mb heights,
// sea-level pressure, fronts, dryline, air masses) and fills every cell with physical
// profiles: temperature/dewpoint/wind at the surface, 850, 700, 500 and 250 mb. Severe
// indices (CAPE, CIN, SRH, shear, STP) are never written here; soundings derive them.
import { NARRATIVES, SETUPS, FLOW_REGIMES } from './narratives.js';
import { clamp, gaussian, lerp, mulberry32 } from './math.js';
import { createSynopticPattern, sampleSynopticPattern, samplePatternWinds, cyclonicGradientWindKt } from './synopticPattern.js';

const RHO = 1.15, CORIOLIS = 1e-4, MS_TO_KT = 1.943844, DEG = Math.PI / 180;

export function generateScenario(world, seedValue, options = {}) {
  const seed = normalizeSeed(seedValue);
  const random = mulberry32(seed);
  const domainKm = world.width * (Number(world.cellSizeKm) || 16.09);
  const config = createSeedConfiguration(random, { ...options, domainKm });
  world.scenarioMetadata = { seed, ...config };
  initializeAtmosphere(world, config, seed);
  detectBoundaries(world);
  return { ...config, seed };
}

function createSeedConfiguration(random, { domainKm, narrative: forcedNarrative } = {}) {
  const narrative = NARRATIVES.find(n => n.name === forcedNarrative) ?? weightedChoice(NARRATIVES, random);
  const setupType = narrative.setups[Math.floor(random() * narrative.setups.length)];
  const setup = SETUPS[setupType];
  const regimeName = setup.regimes[Math.floor(random() * setup.regimes.length)];
  const regime = FLOW_REGIMES[regimeName];
  const intensity = lerp(narrative.intensity[0], narrative.intensity[1], random());
  // Ingredients are correlated with intensity but keep independent variety.
  const position = clamp((intensity - narrative.intensity[0]) / (narrative.intensity[1] - narrative.intensity[0]), 0, 1);
  const draw = range => lerp(range[0], range[1], clamp(0.6 * position + 0.4 * random(), 0, 1));
  const ingredients = {
    gulfDewpointF: draw(narrative.gulfDewpointF), moistureDepth: draw(narrative.moistureDepth),
    t850C: draw(narrative.t850C), cap700C: draw(narrative.cap700C), lapse700500: draw(narrative.lapse700500),
    flow500Kt: draw(narrative.flow500Kt), jetPeakKt: draw(narrative.jetPeakKt), lljKt: draw(narrative.lljKt),
    troughDm: draw(narrative.troughDm), lowDepthHpa: draw(narrative.lowDepthHpa), tilt: draw(narrative.tilt)
  };
  const troughX = lerp(regime.troughX[0], regime.troughX[1], random());
  const northwest = regimeName === 'northwest';
  const synopticPattern = createSynopticPattern(random, setupType, intensity, {
    domainKm, flowFromDeg: lerp(regime.fromDeg[0], regime.fromDeg[1], random()),
    flow500Kt: ingredients.flow500Kt, troughX, troughY: lerp(0.2, 0.45, random()),
    // Behind the trough (northwest flow) the ridge lies upstream and the surface low is
    // downstream of the trough near the domain's eastern side.
    lowX: northwest ? lerp(0.55, 0.72, random()) : undefined,
    highX: northwest ? troughX - lerp(0.75, 0.95, random()) : undefined,
    troughDm: ingredients.troughDm, tilt: ingredients.tilt, jetPeakKt: ingredients.jetPeakKt,
    lljKt: ingredients.lljKt, lowDepthHpa: ingredients.lowDepthHpa
  });
  const boundaryTopology = setup.topology[Math.floor(random() * setup.topology.length)];
  synopticPattern.boundaryTopology = [...boundaryTopology];
  return {
    synopticPattern,
    narrative: narrative.name, narrativeLabel: narrative.label,
    setupType, setupLabel: setup.label, flowRegime: regimeName,
    intensity, regime: regimeFromIntensity(intensity), ingredients,
    boundaryTopology: [...boundaryTopology],
    // Modest rotation of the whole physical frame for geographic variety.
    patternOrientation: 0, patternMirror: false, patternRotationDegrees: lerp(-18, 18, random()),
    gulfDewpoint: ingredients.gulfDewpointF,
    northMoistureLoss: lerp(12, 4, ingredients.moistureDepth),
    moistureAxisX: lerp(0.55, 0.78, random()), moistureAxisY: lerp(0.5, 0.75, random()),
    moistureAxisBoost: lerp(0.5, 2.5, ingredients.moistureDepth),
    // The synoptic low-level jet sits south-southeast of the surface low and moves with it.
    lljOffsetX: lerp(0.12, 0.3, random()),
    lljOffsetY: lerp(0.22, 0.4, random()),
    temp500Base: ingredients.cap700C - ingredients.lapse700500 * 2.7,
    noisePhase: random() * 1000,
    patternLifecycle: buildPatternLifecycle(setupType, narrative.name, intensity)
  };
}

// Fills every cell with physical profiles from the large-scale pattern and air masses.
function initializeAtmosphere(world, config, seed) {
  const pattern = config.synopticPattern, ing = config.ingredients;
  const rotation = config.patternRotationDegrees;
  world.forEachCell((cell, x, y) => {
    const point = displayToPattern(world.width <= 1 ? 0 : x / (world.width - 1), world.height <= 1 ? 0 : y / (world.height - 1), 0, false, rotation);
    const nx = point.x, ny = point.y;
    const s = { ...sampleSynopticPattern(pattern, nx, ny, 0), ...samplePatternWinds(pattern, nx, ny, 0) };
    const warm = s.warmSector, dry = s.hotDry, cold = clamp(1 - warm - dry, 0, 1);
    const air = airMassSurfaceState(config, s, nx, ny);
    const noiseT = smoothNoise(seed, nx * 6 + config.noisePhase, ny * 6), noiseTd = smoothNoise(seed ^ 0x9e37, nx * 7, ny * 7 + config.noisePhase);
    const afternoonT = air.afternoonTemperatureF + 2 * (noiseT - 0.5);
    let td = air.dewpointF + 3 * (noiseTd - 0.5);
    // Dawn (12Z): ~10-14 F below the afternoon high in humid air, ~20 F in dry air, and
    // radiative cooling stalls a couple of degrees above the dewpoint.
    const temperature = Math.max(afternoonT - air.diurnalRangeF, td + 2);
    td = Math.min(td, temperature - 0.5);
    const moistureAxis = air.moistureAxis;
    cell.surface.temperature = temperature;
    cell.surface.dewpoint = td;
    cell.surface.pressure = s.seaLevelPressureHpa;

    // Upper-air temperatures: warm-sector 850 mb warmth, the elevated mixed layer (cap) at
    // 700 mb (warmest over its dry source region), the narrative's 700-500 mb lapse rate and
    // the trough's cold core aloft.
    const t850 = air.t850C;
    const t700 = air.t700C, t500 = air.t500C;
    const t250 = -46 - 3 * s.troughCore;

    // Winds. Upper levels are geostrophic from the 500 mb heights (with the jet streak);
    // low levels come from the sea-level pressure gradient, friction and the low-level jet.
    const vg = cyclonicGradientWindKt(surfaceGeostrophicKt(pattern, nx, ny), Math.hypot(nx - pattern.lowX, ny - pattern.lowY) * pattern.domainKm);
    const surfaceWind = rotateEN({ e: vg.e * 0.62, n: vg.n * 0.62 }, 25); // friction: backed toward low pressure
    const lljCore = gaussian(nx - (pattern.lowX + config.lljOffsetX), ny - (pattern.lowY + config.lljOffsetY), 0.32) * s.southOfWarmFront * s.aheadOfColdFront;
    const thermal = { e: 0.25 * (s.u500Kt - vg.e), n: 0.25 * (s.v500Kt - vg.n) };
    const base850 = { e: vg.e * 0.95 + thermal.e, n: vg.n * 0.95 + thermal.n };
    const base850Speed = Math.hypot(base850.e, base850.n) || 1;
    const jet = 0.5 * pattern.lljKt * lljCore;
    const w850 = { e: base850.e + jet * base850.e / base850Speed, n: base850.n + jet * base850.n / base850Speed };
    const w500 = { e: s.u500Kt, n: s.v500Kt }, w250 = { e: s.u250Kt, n: s.v250Kt };
    const w700 = { e: 0.6 * w500.e + 0.4 * w850.e, n: 0.6 * w500.n + 0.4 * w850.n };
    const set = (target, w) => { const d = rotateEN(w, rotation); target.windSpeed = Math.hypot(d.e, d.n); target.windDirection = fromDirection(d.e, d.n); };
    const sfc = rotateEN(surfaceWind, rotation);
    cell.surface.wind.speed = Math.hypot(sfc.e, sfc.n);
    cell.surface.wind.direction = fromDirection(sfc.e, sfc.n);
    cell.levels[850] = { temperature: t850, dewpoint: air.td850C }; set(cell.levels[850], w850);
    cell.levels[700] = { temperature: t700, dewpoint: air.td700C }; set(cell.levels[700], w700);
    cell.levels[500] = { temperature: t500, heightDm: s.height500Dm }; set(cell.levels[500], w500);
    cell.levels[250] = { temperature: t250, heightDm: 1035 + (s.height500Dm - 570) * 0.72 }; set(cell.levels[250], w250);

    cell.features.warmSector = warm > 0.42;
    cell.features.moistureAxis = moistureAxis > 0.61 && s.eastOfDryline > 0.7;
    cell.features.leeTrough = false;
    cell.features.jetStreak = s.jetCore > 0.56;
    cell.features.airMass = s.airMass;
    cell.features.airMassTemperatureF = air.meanTemperatureF;
    cell.features.airMass850C = air.t850C;
    cell.features.synopticAscent = s.upperSupport;
    cell.features.upperTrough = s.troughCore > 0.48;
    cell.features.shortwaveTrough = s.shortwaveCore > 0.52;
    cell.features._warmFrontY = s.warmFrontY;
    cell.features._warmFrontActive = config.boundaryTopology.includes('warm');
    cell.features._drylineX = s.drylineX;
    cell.features._drylineActive = s.drylineActive;
    cell.features._coldFrontX = s.coldFrontX;
    cell.features._coldFrontActive = config.boundaryTopology.includes('cold');
    cell.features._patternX = nx;
    cell.features._patternY = ny;
  });
}

// Surface air-mass state for a pattern sample: afternoon temperature potential, dewpoint and
// diurnal range, built from the narrative's ingredients. Shared by initialization and the
// evolution's air-mass source term so both describe the same air masses.
export function airMassSurfaceState(config, s, nx, ny) {
  const warm = s.warmSector, dry = s.hotDry, cold = clamp(1 - warm - dry, 0, 1);
  const moistureAxis = gaussian(nx - config.moistureAxisX, ny - config.moistureAxisY, 0.45);
  const gulfTd = config.gulfDewpoint - config.northMoistureLoss * (1 - ny) + config.moistureAxisBoost * moistureAxis;
  const warmT = lerp(78, 88, ny) + 3 * config.intensity, dryT = warmT + 9;
  const coldT = s.airMass === 'mP' ? lerp(50, 64, ny) : lerp(44, 60, ny);
  const dryTd = lerp(28, 44, ny), coldTd = s.airMass === 'upslope' ? lerp(48, 58, ny) : lerp(34, 50, ny);
  const afternoonTemperatureF = warm * warmT + dry * dryT + cold * coldT;
  const dewpointF = Math.min(afternoonTemperatureF - 1, warm * gulfTd + dry * dryTd + cold * coldTd);
  const diurnalRangeF = 8 + 12 * clamp((afternoonTemperatureF - dewpointF) / 30, 0, 1);
  const ing = config.ingredients;
  // Warm-sector 850 mb air warms toward the south and into the elevated-mixed-layer plume
  // west of the moist axis; it is not uniform.
  const warm850 = ing.t850C + 3 * (ny - 0.6) + 1.5 * (1 - moistureAxis) + 1.2 * (smoothNoise(0x850, nx * 4 + 3.1, ny * 4) - 0.5);
  const t850C = warm * warm850 + dry * (warm850 + 4) + cold * lerp(2, 9, ny);
  // 700 mb: the elevated mixed layer (cap), warmest over its dry source region; 500 mb from
  // the narrative's lapse rate and the trough's cold core aloft.
  const t700C = warm * ing.cap700C + dry * (ing.cap700C + 3) + cold * (ing.cap700C - 8);
  const t500C = t700C - ing.lapse700500 * 2.7 - 3 * (s.troughCore ?? 0) - 2 * (s.shortwaveCore ?? 0);
  // Moisture aloft: deep in the Gulf air (depth from the narrative), very dry in the elevated
  // mixed layer and the continental air behind the dryline.
  const depth = ing.moistureDepth;
  const td850C = Math.min(t850C, warm * (t850C - (4 + 8 * (1 - depth))) + dry * (t850C - 20) + cold * (t850C - 6));
  const td700C = Math.min(t700C, warm * (t700C - (8 + 14 * (1 - depth))) + dry * (t700C - 24) + cold * (t700C - 8));
  return { afternoonTemperatureF, dewpointF, diurnalRangeF, meanTemperatureF: afternoonTemperatureF - diurnalRangeF / 2, t850C, t700C, t500C, td850C, td700C, moistureAxis };
}

// Geostrophic wind (kt, east/north in the pattern frame) from the sea-level pressure field.
function surfaceGeostrophicKt(pattern, nx, ny) {
  // Synoptic-scale gradient (~65 km either side); frontal-scale flow is not geostrophic.
  const h = 0.04, metres = h * (pattern.domainKm ?? 805) * 1000;
  const p = (x, y) => sampleSynopticPattern(pattern, x, y, 0).seaLevelPressureHpa * 100;
  const dpdx = (p(nx + h, ny) - p(nx - h, ny)) / (2 * metres);
  const dpdNorth = (p(nx, ny - h) - p(nx, ny + h)) / (2 * metres);
  return { e: -dpdNorth / (RHO * CORIOLIS) * MS_TO_KT, n: dpdx / (RHO * CORIOLIS) * MS_TO_KT };
}

// Rotate an (east, north) vector counterclockwise by degrees. The display frame is the
// pattern frame rotated by -patternRotationDegrees (see displayToPattern), which in
// east/north terms is a counterclockwise rotation by the same angle.
function rotateEN(w, degrees) {
  const c = Math.cos(degrees * DEG), s = Math.sin(degrees * DEG);
  return { e: w.e * c - w.n * s, n: w.e * s + w.n * c };
}

function fromDirection(east, north) {
  return ((Math.atan2(-east, -north) / DEG) % 360 + 360) % 360;
}

function buildPatternLifecycle(setup, narrative, intensity) {
  const coldFront = setup === 'progressive_cold_front';
  const profiles = {
    isolated_supercells: { geometry: 'discrete-corridor', initial: 'discrete', mature: 'discrete', late: 'multicell', delay: 2.5, transition: 8, coverage: [.58, .82, .52], coldPool: 0.86, aftermath: 'localized-outflow' },
    loaded_gun: { geometry: 'isolated-boundary-points', initial: 'capped', mature: 'discrete', late: 'discrete', delay: 5.5, transition: 7, coverage: [.18, .76, .48], coldPool: 0.82, aftermath: 'isolated-outflow' },
    mixed_mode: { geometry: 'multi-boundary-corridor', initial: 'discrete', mature: 'mixed', late: 'linear', delay: 2, transition: 5, coverage: [.62, 1.02, .86], coldPool: 1.10, aftermath: 'storm-processed' },
    hp_supercell: { geometry: 'moist-axis-corridor', initial: 'discrete', mature: 'multicell', late: 'MCS', delay: 2, transition: 6, coverage: [.66, 1.02, .90], coldPool: 1.16, aftermath: 'broad-outflow' },
    classic_tornado_outbreak: { geometry: 'open-warm-sector', initial: 'discrete', mature: 'discrete', late: 'mixed', delay: 1.5, transition: 8, coverage: [.72, 1.08, .88], coldPool: .92, aftermath: 'frontal-cleanout' },
    giant_hail: { geometry: 'isolated-boundary-points', initial: 'discrete', mature: 'discrete', late: 'multicell', delay: 3, transition: 8, coverage: [.48, .78, .50], coldPool: .88, aftermath: 'localized-outflow' },
    progressive_mcs: { geometry: 'cluster-corridor', initial: 'multicell', mature: 'linear', late: 'MCS', delay: 2, transition: 4, coverage: [.68, 1.08, .96], coldPool: 1.24, aftermath: 'broad-cold-pool' },
    qlcs: { geometry: 'boundary-line', initial: 'linear', mature: 'QLCS', late: 'MCS', delay: 1.5, transition: 3.5, coverage: [.78, 1.10, .92], coldPool: 1.28, aftermath: 'frontal-cold-pool' },
    derecho: { geometry: 'boundary-line', initial: 'linear', mature: 'QLCS', late: 'MCS', delay: 1, transition: 3, coverage: [.82, 1.14, 1.00], coldPool: 1.38, aftermath: 'derecho-wake' }
  };
  const profile = profiles[narrative] ?? profiles.isolated_supercells;
  const transitionHours = Math.max(2, profile.transition - intensity * 1.5);
  return {
    version: 3, narrative,
    boundaryType: coldFront ? 'cold' : setup === 'dryline_cyclone' || setup === 'lee_cyclogenesis' ? 'dryline' : setup === 'warm_front_wave' ? 'warm' : null,
    initiationGeometry: coldFront && !['isolated_supercells', 'loaded_gun', 'giant_hail'].includes(narrative) ? 'boundary-line' : profile.geometry,
    initialMode: profile.initial, preferredMatureMode: profile.mature, lateMode: profile.late,
    initiationDelayHours: Math.max(0, profile.delay - intensity * 1.2),
    modeTransitionHours: transitionHours,
    lateTransitionHours: transitionHours + (['derecho', 'qlcs', 'progressive_mcs'].includes(narrative) ? 3 : 5),
    coverageEvolution: profile.coverage, aftermath: profile.aftermath, linearTransitionHours: transitionHours,
    boundarySpeedMultiplier: coldFront ? 1.08 + intensity * 0.22 : 1,
    wakeCoolingF: coldFront ? 5 + intensity * 7 : 0, wakeDryingF: coldFront ? 2.5 + intensity * 5 : 0,
    wakePersistenceHours: coldFront ? 14 + intensity * 10 : 0,
    coldPoolMultiplier: clamp(profile.coldPool * (coldFront ? 1.08 : 1), .48, 1.55),
    recoveryMultiplier: profile.aftermath === 'rapid-recovery' ? 1.35 : profile.aftermath === 'none' ? 1.08 : .72
  };
}

function regimeFromIntensity(intensity) {
  if (intensity < 0.40) return 'modest';
  if (intensity < 0.58) return 'organized';
  if (intensity < 0.72) return 'significant';
  if (intensity < 0.86) return 'outbreak';
  return 'historic';
}

function detectBoundaries(world) {
  world.forEachCell((cell, x, y) => {
    const nx = Number.isFinite(cell.features._patternX) ? cell.features._patternX : (world.width === 1 ? 0 : x / (world.width - 1));
    const ny = Number.isFinite(cell.features._patternY) ? cell.features._patternY : (world.height === 1 ? 0 : y / (world.height - 1));
    const scaleX = 1 / Math.max(1, world.width - 1), scaleY = 1 / Math.max(1, world.height - 1);
    cell.features.dryline = Boolean(cell.features._drylineActive) && Math.abs(nx - cell.features._drylineX) < scaleX * 0.8 && ny > 0.24;
    const nearWarmFront = Boolean(cell.features._warmFrontActive) && Math.abs(ny - cell.features._warmFrontY) < scaleY * 0.8 && nx > 0.3;
    const nearColdFront = Boolean(cell.features._coldFrontActive) && Math.abs(nx - cell.features._coldFrontX) < scaleX * 0.8 && ny > 0.2;
    cell.features.front = nearWarmFront ? 'warm' : nearColdFront ? 'cold' : null;
  });
}

function displayToPattern(x, y, orientation = 0, mirror = false, rotationDegrees = 0) {
  let px, py;
  switch (((orientation % 4) + 4) % 4) {
    case 1: px = y; py = 1 - x; break;
    case 2: px = 1 - x; py = 1 - y; break;
    case 3: px = 1 - y; py = x; break;
    default: px = x; py = y;
  }
  if (mirror) px = 1 - px;
  if (rotationDegrees) {
    const r = rotationDegrees * DEG, dx = px - 0.5, dy = py - 0.5, c = Math.cos(r), s = Math.sin(r);
    px = 0.5 + dx * c - dy * s;
    py = 0.5 + dx * s + dy * c;
  }
  return { x: px, y: py };
}

// Smooth value noise in [0, 1] for gentle mesoscale variety (never per-cell white noise).
function smoothNoise(seed, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const h = (i, j) => { let k = Math.imul(seed ^ Math.imul(i, 374761393) ^ Math.imul(j, 668265263), 1274126177); k ^= k >>> 13; k = Math.imul(k, 1103515245); return ((k ^ (k >>> 16)) >>> 0) / 4294967296; };
  return (h(x0, y0) * (1 - sx) + h(x0 + 1, y0) * sx) * (1 - sy) + (h(x0, y0 + 1) * (1 - sx) + h(x0 + 1, y0 + 1) * sx) * sy;
}

function weightedChoice(options, random) {
  const roll = random() * options.reduce((sum, option) => sum + option.weight, 0);
  let cumulative = 0;
  for (const option of options) { cumulative += option.weight; if (roll <= cumulative) return option; }
  return options[options.length - 1];
}

function normalizeSeed(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.abs(Math.trunc(numeric)) || 1;
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0 || 1;
}

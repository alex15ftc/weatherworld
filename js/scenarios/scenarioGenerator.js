import { GAMEPLAY_NARRATIVE_WEIGHTS, STORY_MODIFIER_WEIGHTS, ATMOSPHERIC_ENVELOPE_WEIGHTS, SYNOPTIC_SETUP_WEIGHTS } from './config.js?v=2.20.1';
import { clamp, gaussian, lerp, meteorologicalDirection, mulberry32, smoothstep } from './math.js?v=2.20.1';
import { airMassThermodynamics, createSynopticPattern, sampleSynopticPattern } from './synopticPattern.js?v=2.20.1';
import { PRESSURE_LEVELS_HPA } from '../constants.js?v=2.20.1';
import { chooseAnalogBlend } from './AnalogPatternLibrary.js?v=2.28.8';

export function generateScenario(world, seedValue, analogOptions = {}) {
  const seed = normalizeSeed(seedValue);
  const random = mulberry32(seed);
  const config = createSeedConfiguration(random, analogOptions);
  // Preserve the seed narrative for the authoritative outlook builder.
  world.scenarioMetadata = { seed, ...config };

  world.forEachCell((cell, x, y) => {
    const displayNx = world.width === 1 ? 0 : x / (world.width - 1);
    const displayNy = world.height === 1 ? 0 : y / (world.height - 1);
    // 2.13.2: generate the atmosphere in pattern coordinates, then map it
    // onto the display using a seed-selected rotation/reflection. This moves
    // entire synoptic systems rather than merely translating risk colors.
    const patternPoint = displayToPattern(
      displayNx, displayNy, config.patternOrientation, config.patternMirror, config.patternRotationDegrees
    );
    const nx = patternPoint.x;
    const ny = patternPoint.y;
    const synoptic = sampleSynopticPattern(config.synopticPattern, nx, ny, 0);
    const airMass = airMassThermodynamics(synoptic.airMass, ny, config.intensity);
    const dxLow = nx - config.lowX;
    const dyLow = ny - config.lowY;
    const lowInfluence = gaussian(dxLow, dyLow, config.lowRadius);
    const terrainWave = Math.sin(nx * config.waveX + config.phaseA) * Math.cos(ny * config.waveY + config.phaseB);
    const mesoscaleWave = Math.sin((nx + ny) * 14 + config.phaseC);
    const noise = terrainWave * config.waveAmplitude + mesoscaleWave * 0.28 + (random() - 0.5) * 0.7;

    const ridge = gaussian(nx - config.ridgeX, ny - config.ridgeY, config.ridgeRadius);
    const shortwaveCore = gaussian(nx - config.shortwaveX, ny - config.shortwaveY, config.shortwaveRadius);
    const leeTroughCore = gaussian(nx - config.leeTroughX, ny - config.leeTroughY, config.leeTroughRadius);
    const troughPressure = config.basePressure - config.lowDepth * lowInfluence;
    cell.surface.pressure = lerp(
      troughPressure + config.ridgeStrength * ridge
        - config.shortwavePressureDepth * shortwaveCore
        - config.leeTroughPressureDepth * leeTroughCore + noise,
      synoptic.seaLevelPressureHpa,
      0.62
    );

    const warmFrontY = synoptic.warmFrontY;
    const southOfWarmFront = synoptic.southOfWarmFront;

    const drylineX = synoptic.drylineX;
    const eastOfDryline = synoptic.eastOfDryline;

    const coldFrontX = synoptic.coldFrontX;
    const aheadOfColdFront = synoptic.aheadOfColdFront;

    const warmSector = southOfWarmFront * eastOfDryline * aheadOfColdFront;
    const hotDrySector = southOfWarmFront * (1 - eastOfDryline) * aheadOfColdFront;
    const coldSector = 1 - southOfWarmFront;

    const meridionalBase = lerp(config.northTemp, config.southTemp, ny);
    cell.surface.temperature = meridionalBase
      + warmSector * config.warmBoost
      + hotDrySector * config.hotDryBoost
      - coldSector * config.coldPenalty
      - (1 - aheadOfColdFront) * config.postFrontalCooling
      + noise * 0.75;

    const moistureReturn = smoothstep(config.moistureStart, config.moistureEnd, ny);
    const moistureAxis = gaussian(nx - config.moistureAxisX, ny - config.moistureAxisY, config.moistureRadius);
    const moistTd = config.gulfDewpoint - config.northMoistureLoss * (1 - moistureReturn) + config.moistureAxisBoost * moistureAxis;
    const dryTd = config.dryDewpoint + config.dryNorthSouthSlope * ny;
    cell.surface.dewpoint = lerp(dryTd, moistTd, eastOfDryline)
      - coldSector * config.coldSectorDrying
      - (1 - aheadOfColdFront) * config.postFrontalDrying
      + noise * 0.45;
    // Air masses provide coherent thermodynamic source regions; mesoscale
    // sectors then refine them instead of inventing each cell independently.
    cell.surface.temperature = lerp(cell.surface.temperature, airMass.temperatureF, 0.38);
    cell.surface.dewpoint = lerp(cell.surface.dewpoint, airMass.dewpointF * config.synopticPattern.moistureFactor, 0.42);
    if (synoptic.airMass === 'upslope') cell.surface.dewpoint += 3.5 * synoptic.troughCore;
    cell.surface.dewpoint = Math.min(cell.surface.dewpoint, cell.surface.temperature - 1);

    // Initialize the warm sector at the thermodynamic state appropriate for
    // the simulation's local solar time. The synoptic configuration stores
    // the day's potential, but a 12Z/06-local initialization must not begin
    // with isolated cells already at their late-afternoon maximum.
    const initialUtcHour = ((Number(world.validHourUtc) || 0) % 24 + 24) % 24;
    const initialLocalHour = ((initialUtcHour - 6) % 24 + 24) % 24;
    const initialHeatingRealization = initialLocalHour < 6 || initialLocalHour > 20.5 ? 0
      : initialLocalHour <= 15.5 ? smoothstep(6, 15.5, initialLocalHour)
      : 1 - smoothstep(15.5, 20.5, initialLocalHour);
    const unrealizedWarmSector = warmSector * (1 - initialHeatingRealization);
    cell.surface.temperature -= unrealizedWarmSector * (12.0 + 4.0 * config.intensity);
    cell.surface.dewpoint -= unrealizedWarmSector * (1.4 + 1.1 * (1 - moistureAxis));
    cell.surface.dewpoint = Math.min(cell.surface.dewpoint, cell.surface.temperature - 1);

    const dist = Math.max(0.04, Math.hypot(dxLow, dyLow));
    const tangentU = -dyLow / dist;
    const tangentV = dxLow / dist;
    const inflowU = -dxLow / dist;
    const inflowV = -dyLow / dist;
    const cycloneSpeed = (8 + config.cycloneWind * lowInfluence) * config.intensity;
    let u = tangentU * cycloneSpeed + inflowU * cycloneSpeed * config.crossIsobarFraction;
    let v = tangentV * cycloneSpeed + inflowV * cycloneSpeed * config.crossIsobarFraction;
    u += warmSector * config.inflowU;
    v += warmSector * config.inflowV;
    if (!aheadOfColdFront) { u += config.postFrontU; v += config.postFrontV; }
    // 2.13.2: spatial pattern orientation no longer rotates the wind field into
    // climatologically implausible easterly deep-layer flow. The background
    // atmosphere receives a modest, seed-dependent directional perturbation
    // while retaining the prevailing west-to-east Great Plains regime.
    const surfaceVector = rotateVector(u, v, config.backgroundFlowRotation);
    const preferredSurface = meteorologicalVector(
      config.surfaceFlowDirection,
      Math.max(8, Math.hypot(surfaceVector.u, surfaceVector.v) + 4)
    );
    const surfaceBlend = clamp(Number(config.surfaceFlowBlend) || 0, 0, 0.9);
    const physicalSurfaceVector = {
      u: lerp(surfaceVector.u, preferredSurface.u, surfaceBlend),
      v: lerp(surfaceVector.v, preferredSurface.v, surfaceBlend)
    };
    cell.surface.wind.speed = clamp(Math.hypot(physicalSurfaceVector.u, physicalSurfaceVector.v) + 4, 3, 48);
    cell.surface.wind.direction = meteorologicalDirection(physicalSurfaceVector.u, physicalSurfaceVector.v);

    const jetCore = gaussian(nx - config.jetX, ny - config.jetY, config.jetRadius);
    const lljCore = gaussian(nx - config.lljX, ny - config.lljY, config.lljRadius) * southOfWarmFront;
    const troughCore = gaussian(nx - config.troughX, ny - config.troughY, config.troughRadius);
    const upperWave = clamp(shortwaveCore * config.shortwaveStrength + troughCore * 0.45, 0, 1.5);

    cell.levels[850] = {
      temperature: 7 + 12 * warmSector + 9 * hotDrySector - 9 * coldSector
        + (Number(config.elevatedWarmNoseC) || 0) * synoptic.upperSupport,
      windDirection: config.dir850Base + config.dir850Slope * nx - 13 * lowInfluence,
      windSpeed: clamp(12 + config.llj850 * lljCore + 9 * lowInfluence, 8, 75)
    };
    cell.levels[700] = {
      temperature: config.temp700Base + config.emlStrength * hotDrySector + config.emlWarmSector * warmSector,
      windDirection: config.dir700Base + 20 * nx - 7 * troughCore,
      windSpeed: clamp(20 + config.jet500 * 0.52 * jetCore + 10 * config.intensity, 14, 75)
    };
    cell.levels[500] = {
      temperature: config.temp500Base - config.coldPoolStrength * troughCore - 4 * lowInfluence,
      windDirection: config.dir500Base + 22 * nx - config.negativeTilt * 14 * troughCore - config.shortwaveTurn * shortwaveCore,
      windSpeed: clamp(lerp(27 + config.jet500 * jetCore + 13 * config.intensity + config.shortwaveWindBoost * shortwaveCore, synoptic.jet500Kt, 0.58), 22, 115),
      heightDm: synoptic.height500Dm
    };
    cell.levels[250] = {
      temperature: -47,
      windDirection: config.dir250Base + 15 * nx - config.negativeTilt * 7 * troughCore - config.shortwaveTurn * 0.45 * shortwaveCore,
      windSpeed: clamp(lerp(48 + config.jet250 * jetCore + 16 * config.intensity + config.shortwaveWindBoost * 0.75 * shortwaveCore, synoptic.jet250Kt, 0.64), 40, 190),
      heightDm: 1035 + (synoptic.height500Dm - 570) * 0.72
    };

    // Hodograph variety comes from the generated background-flow regime,
    // veering profile, jet placement, and low-level inflow—not from rotating
    // the finished winds by 90/180 degrees. This keeps westward storm motion
    // extraordinarily rare while still allowing broad directional variety.
    for (const level of PRESSURE_LEVELS_HPA) {
      const levelTurn = level === 850 ? config.lowLevelFlowOffset
        : level === 700 ? config.midLevelFlowOffset
        : level === 500 ? config.deepLayerFlowOffset
        : config.upperLevelFlowOffset;
      cell.levels[level].windDirection = normalizeDirection(
        cell.levels[level].windDirection + config.backgroundFlowRotation + levelTurn
      );
    }

    const moistureQuality = clamp((cell.surface.dewpoint - 47) / 29, 0, 1.25);
    const heating = clamp((cell.surface.temperature - 60) / 35, 0, 1.25);
    const lapseContribution = clamp((-cell.levels[500].temperature - 7) / 20, 0, 1.35);
    const capStrength = clamp((cell.levels[700].temperature - 1) / 15, 0, 1.15);
    const forcingRelease = clamp(config.forcing * (0.42 + 0.52 * lowInfluence + 0.40 * jetCore + 0.22 * troughCore + 0.50 * upperWave + 0.22 * leeTroughCore), 0, 1.45);

    cell.derived.cape = clamp(config.capePotential * moistureQuality * heating * lapseContribution * (0.62 + 0.38 * warmSector), 0, 6800);
    cell.derived.cin = clamp(config.capBase * capStrength * (1 - 0.78 * forcingRelease) + 20 * (1 - heating), 0, 250);
    cell.derived.bulkShear = clamp(cell.levels[500].windSpeed - cell.surface.wind.speed * 0.24 + 8 * config.intensity, 6, 98);
    const backedFlow = clamp((195 - cell.surface.wind.direction) / 75 + 0.68, 0.18, 1.55);
    cell.derived.srh = clamp((cell.levels[850].windSpeed * 4.1 + cell.derived.bulkShear * 2.15) * backedFlow * southOfWarmFront, 0, 850);
    cell.derived.lcl = clamp(125 * (cell.surface.temperature - cell.surface.dewpoint) * 5 / 9, 300, 2600);

    const capeTerm = clamp(cell.derived.cape / 1500, 0, 2.7);
    const srhTerm = clamp(cell.derived.srh / 150, 0, 3.2);
    const shearTerm = clamp(cell.derived.bulkShear / 40, 0, 2.2);
    const lclTerm = clamp((2100 - cell.derived.lcl) / 1000, 0, 1.6);
    const cinTerm = clamp((155 - cell.derived.cin) / 125, 0, 1.25);
    cell.derived.stp = clamp(capeTerm * srhTerm * shearTerm * lclTerm * cinTerm * 0.58, 0, 16);
    cell.derived.scp = clamp((cell.derived.cape / 1000) * (cell.derived.srh / 100) * (cell.derived.bulkShear / 40), 0, 40);
    // Risk is diagnosed after boundaries are detected so forcing can include them.

    cell.features.warmSector = warmSector > 0.42;
    cell.features.moistureAxis = moistureAxis > 0.61 && eastOfDryline > 0.7;
    cell.features.leeTrough = config.leeTroughActive && leeTroughCore > 0.70;
    cell.features.shortwaveTrough = config.shortwaveActive && shortwaveCore > 0.58;
    cell.features.upperTrough = troughCore > 0.58;
    cell.features.jetStreak = synoptic.jetCore > 0.56;
    cell.features.airMass = synoptic.airMass;
    cell.features.synopticAscent = synoptic.upperSupport;
    cell.features.upperTrough = synoptic.troughCore > 0.48;
    cell.features.shortwaveTrough = synoptic.shortwaveCore > 0.52;
    cell.features._warmFrontY = warmFrontY;
    cell.features._warmFrontActive = config.boundaryTopology.includes('warm');
    cell.features._drylineX = drylineX;
    cell.features._drylineActive = synoptic.drylineActive;
    cell.features._coldFrontX = coldFrontX;
    cell.features._coldFrontActive = config.boundaryTopology.includes('cold');
    cell.features._patternX = nx;
    cell.features._patternY = ny;
  });

  detectBoundaries(world);
  applyAtmosphericEnvelopeToWorld(world, config);

  // 2.13.2: scenario generation now creates atmospheric fields only. The
  // authoritative diagnostics and outlook are produced once, after terrain,
  // station-pressure, diurnal, boundary, and forcing initialization in
  // initializeEvolution(). This prevents pre-initialization calibration from
  // disagreeing with the outlook displayed by the browser.
  return { ...config, seed, chaseabilityAdjusted: false };
}


function applyAtmosphericEnvelopeToWorld(world, config) {
  const envelope = config.atmosphericEnvelope;
  const strength = config.atmosphericEnvelopeStrength ?? 1;


  world.forEachCell((cell, x, y) => {
    const displayNx = world.width <= 1 ? 0 : x / (world.width - 1);
    const displayNy = world.height <= 1 ? 0 : y / (world.height - 1);
    const point = displayToPattern(
      displayNx, displayNy, config.patternOrientation, config.patternMirror, config.patternRotationDegrees
    );
    const nx = point.x;
    const ny = point.y;
    const corridorRadius = envelope === 'organized_local' ? 0.21 : envelope === 'extreme_regional' ? 0.30 + 0.025 * strength : 0.34;

    // The repeated crescent came from intersecting one smooth ellipse with a
    // hard warm-sector mask. Seeds changed the ellipse, but the same clipped
    // geometry repeatedly produced a moon-shaped surviving corridor. Use a
    // seed-selected composite field and a soft thermodynamic support mask so
    // the risk geometry emerges as lobes, ribbons, broken corridors, or broad
    // ellipses rather than the same clipped annulus.
    const rawCorridor = severeEnvelopeInfluence(nx, ny, config, corridorRadius);
    const thermoSupport = smoothstep(48, 63, cell.surface.dewpoint)
      * smoothstep(55, 74, cell.surface.temperature);
    const sectorSupport = cell.features.warmSector ? 1 : 0.18 + 0.32 * thermoSupport;
    const corridor = rawCorridor * sectorSupport;
    if (corridor < 0.12) return;

    if (envelope === 'organized_local') {
      cell.derived.cape = Math.min(cell.derived.cape * (0.88 + 0.07 * corridor), 3200);
      cell.derived.bulkShear = Math.min(cell.derived.bulkShear * (0.91 + 0.05 * corridor), 54);
      cell.derived.srh = Math.min(cell.derived.srh * (0.88 + 0.06 * corridor), 105);
      cell.derived.cin = Math.max(cell.derived.cin, 68 - 18 * corridor);
    } else if (envelope === 'organized_regional') {
      // Ordinary organized days may be locally impressive, but they should not
      // accidentally acquire the broad low-level shear/STP combination that
      // produces a 30% CIG2 tornado High Risk. This is an atmospheric cap, not
      // a risk-layer downgrade.
      cell.derived.srh = Math.min(cell.derived.srh, 180 + 5 * corridor);
      cell.derived.bulkShear = Math.min(cell.derived.bulkShear, 61);
      cell.derived.cape = Math.min(cell.derived.cape, 4000);
      if (corridor > 0.42) {
        cell.surface.dewpoint = Math.min(cell.surface.temperature - 1, Math.max(cell.surface.dewpoint, 60 + 3.5 * corridor));
        cell.derived.cape = Math.max(cell.derived.cape, 1750 + 750 * corridor);
        cell.derived.bulkShear = Math.max(cell.derived.bulkShear, 40 + 8 * corridor);
        cell.derived.srh = Math.max(cell.derived.srh, 105 + 45 * corridor);
        cell.derived.cin = clamp(cell.derived.cin, 34, 115);
      }
    } else if (envelope === 'significant_regional') {
      // Broad significant-severe envelope: strong instability and deep-layer
      // shear, but deliberately moderate low-level shear. This favors a
      // regional 45% CIG2 hail or wind corridor without manufacturing a
      // 30% CIG2 tornado High Risk.
      cell.surface.dewpoint = Math.min(cell.surface.temperature - 1, Math.max(cell.surface.dewpoint, 63 + 4 * corridor));
      cell.derived.cape = clamp(Math.max(cell.derived.cape, 3000 + 1550 * corridor), 0, 4550);
      cell.derived.bulkShear = clamp(Math.max(cell.derived.bulkShear, 49 + 14 * corridor), 6, 64);
      cell.derived.srh = clamp(Math.max(cell.derived.srh, 115 + 60 * corridor), 0, 185);
      cell.derived.cin = clamp(Math.min(cell.derived.cin, 88 - 52 * corridor), 24, 250);
    } else if (envelope === 'extreme_regional') {
      // Extreme environments now span a continuum instead of every draw being
      // forced into the same outbreak-level corridor. Only the strongest part
      // of the envelope consistently supports 30% CIG2+ tornado probabilities.
      cell.surface.dewpoint = Math.min(cell.surface.temperature - 1, Math.max(cell.surface.dewpoint, 64.5 + (2.5 + 2.2 * strength) * corridor));
      cell.derived.cape = clamp(Math.max(cell.derived.cape, 2500 + (700 + 650 * strength) * corridor), 0, 4700);
      cell.derived.bulkShear = clamp(Math.max(cell.derived.bulkShear, 47 + (8 + 7 * strength) * corridor), 6, 70);
      const extremeSrhFloor = 155 + (65 + 150 * strength) * corridor;
      const extremeSrhCeiling = 285 + 180 * strength;
      cell.derived.srh = clamp(Math.max(cell.derived.srh, extremeSrhFloor), 0, extremeSrhCeiling);
      cell.derived.cin = clamp(Math.min(cell.derived.cin, 94 - (28 + 15 * strength) * corridor), 25, 250);
    }

    cell.derived.lcl = clamp(125 * (cell.surface.temperature - cell.surface.dewpoint) * 5 / 9, 300, 2600);
    const capeTerm = clamp(cell.derived.cape / 1500, 0, 2.7);
    const srhTerm = clamp(cell.derived.srh / 150, 0, 3.2);
    const shearTerm = clamp(cell.derived.bulkShear / 40, 0, 2.2);
    const lclTerm = clamp((2100 - cell.derived.lcl) / 1000, 0, 1.6);
    const cinTerm = clamp((155 - cell.derived.cin) / 125, 0, 1.25);
    cell.derived.stp = clamp(capeTerm * srhTerm * shearTerm * lclTerm * cinTerm * 0.58, 0, 16);
    cell.derived.scp = clamp((cell.derived.cape / 1000) * (cell.derived.srh / 100) * (cell.derived.bulkShear / 40), 0, 40);
  });
}

function establishChaseableTarget(world, attempt = 0) {
  let anchor = null;
  world.forEachCell((cell, x, y) => {
    const support = cell.derived?.diagnostics?.severeSupport ?? 0;
    if (!anchor || support > anchor.support) anchor = { x, y, support };
  });
  if (!anchor) return false;

  const radius = Math.max(4, Math.round(Math.min(world.width, world.height) * (0.12 + attempt * 0.025)));
  const boost = 1 + attempt * 0.35;
  world.forEachCell((cell, x, y) => {
    const distance = Math.hypot(x - anchor.x, y - anchor.y);
    const influence = Math.exp(-(distance * distance) / (2 * radius * radius));
    if (influence < 0.08) return;

    // Create one authentic low-end chase corridor. Values are capped so the
    // validator cannot manufacture an outbreak from an otherwise weak day.
    cell.surface.dewpoint = Math.min(cell.surface.temperature - 1, cell.surface.dewpoint + 3.5 * boost * influence);
    cell.derived.cape = clamp(cell.derived.cape * (1 + 0.48 * boost * influence) + 260 * boost * influence, 0, 2450);
    cell.derived.bulkShear = clamp(cell.derived.bulkShear + 11 * boost * influence, 6, 50);
    cell.derived.srh = clamp(cell.derived.srh + 75 * boost * influence, 0, 255);
    cell.derived.cin = clamp(cell.derived.cin * (1 - Math.min(0.68, 0.48 * boost) * influence), 28, 250);
    if (attempt > 0 && influence >= 0.55) {
      cell.surface.dewpoint = Math.min(cell.surface.temperature - 1, Math.max(cell.surface.dewpoint, 60));
      cell.derived.cape = Math.max(cell.derived.cape, 1650 + 250 * influence);
      cell.derived.bulkShear = Math.max(cell.derived.bulkShear, 40 + 4 * influence);
      cell.derived.srh = Math.max(cell.derived.srh, 130 + 35 * influence);
      cell.derived.cin = Math.min(cell.derived.cin, 82 - 18 * influence);
    }
    cell.derived.lcl = clamp(125 * (cell.surface.temperature - cell.surface.dewpoint) * 5 / 9, 450, 2200);

    const capeTerm = clamp(cell.derived.cape / 1500, 0, 2.7);
    const srhTerm = clamp(cell.derived.srh / 150, 0, 3.2);
    const shearTerm = clamp(cell.derived.bulkShear / 40, 0, 2.2);
    const lclTerm = clamp((2100 - cell.derived.lcl) / 1000, 0, 1.6);
    const cinTerm = clamp((155 - cell.derived.cin) / 125, 0, 1.25);
    cell.derived.stp = clamp(capeTerm * srhTerm * shearTerm * lclTerm * cinTerm * 0.58, 0, 16);
    cell.derived.scp = clamp((cell.derived.cape / 1000) * (cell.derived.srh / 100) * (cell.derived.bulkShear / 40), 0, 40);
    cell.features.warmSector = true;
    if (distance <= radius * 0.65) cell.features.moistureAxis = true;
  });
  return true;
}

function createSeedConfiguration(random, analogOptions = {}) {
  const narrative = weightedChoice(GAMEPLAY_NARRATIVE_WEIGHTS, random);
  const atmosphericEnvelope = chooseEnvelopeForNarrative(narrative.name, random);
  const modifier = weightedChoice(STORY_MODIFIER_WEIGHTS, random);
  const setup = chooseSetupForNarrative(narrative.name, random);
  let intensity = clamp(
    lerp(narrative.intensity[0], narrative.intensity[1], random()) * modifier.shear,
    0.30,
    1.02
  );
  const lowX = lerp(0.29, 0.47, random());
  const lowY = lerp(0.18, 0.36, random());
  const negativeTilt = random() < 0.68 ? lerp(0.35, 1, random()) : lerp(0, 0.4, random());
  const analogGuidance = chooseAnalogBlend(random, setup.name, narrative.name, analogOptions);
  if(analogGuidance.historicalIntensityScore!==null){
    const historicalIntensity=clamp(analogGuidance.historicalIntensityScore/82,0.25,1.08);
    intensity=clamp(lerp(intensity,historicalIntensity,analogGuidance.historicalInfluence*.42),0.30,1.05);
  }
  const regime = regimeFromIntensity(intensity);
  const synopticPattern = createSynopticPattern(random, setup.name, intensity, { lowX, lowY });
  synopticPattern.analogGuidance = analogGuidance;
  synopticPattern.negativeTilt = clamp((synopticPattern.negativeTilt * 0.82) + (analogGuidance.troughTilt * 0.18), 0, 1);
  synopticPattern.coherence = clamp(0.62 + analogGuidance.frontalCoherence * 0.34 + intensity * 0.12, 0, 1);

  const config = {
    synopticPattern,
    analogGuidance,
    regime,
    narrative: narrative.name,
    narrativeLabel: narrative.label,
    storyModifier: modifier.name,
    storyModifierLabel: modifier.label,
    setupType: setup.name,
    setupLabel: setup.label,
    intensity,
    // Great Plains systems vary in tilt and placement, but cardinal rotations
    // invert the geographic source regions and create sideways drylines.
    // Retain the legacy fields for saved-state compatibility while applying a
    // modest continuous rotation to the complete physical coordinate frame.
    patternOrientation: 0,
    patternMirror: false,
    patternRotationDegrees: lerp(-18, 18, random()),
    // Background flow remains climatologically westerly. Most seeds vary by
    // only a few tens of degrees; a tiny anomalous branch permits unusual
    // profiles without post-processing storm motion.
    backgroundFlowRotation: random() < 0.003 ? lerp(70, 115, random()) : lerp(-24, 24, random()),
    lowLevelFlowOffset: lerp(-18, 16, random()),
    midLevelFlowOffset: lerp(-8, 12, random()),
    deepLayerFlowOffset: lerp(-5, 10, random()),
    upperLevelFlowOffset: lerp(-4, 8, random()),
    envelopeShape: weightedChoice([
      { name: 'ellipse', weight: 0.24 },
      { name: 'dual_lobe', weight: 0.24 },
      { name: 'broken_corridor', weight: 0.22 },
      { name: 'boundary_ribbon', weight: 0.18 },
      { name: 'compact_cluster', weight: 0.12 }
    ], random).name,
    envelopeSecondaryOffset: lerp(0.10, 0.27, random()),
    envelopeLobeBalance: lerp(0.50, 0.92, random()),
    envelopeWavePhase: random() * Math.PI * 2,
    envelopeWaveAmplitude: lerp(0.025, 0.095, random()),
    envelopeCenterX: lerp(0.42, 0.76, random()),
    envelopeCenterY: lerp(0.45, 0.74, random()),
    envelopeAngle: random() * Math.PI,
    envelopeAxisMajor: lerp(0.90, 1.45, random()),
    envelopeAxisMinor: lerp(0.58, 1.02, random()),
    lowX,
    lowY,
    lowRadius: lerp(0.22, 0.37, random()),
    basePressure: lerp(1016, 1021, random()),
    lowDepth: lerp(5, 24, intensity) * lerp(0.88, 1.08, random()) * narrative.coverage,
    ridgeX: lerp(0.82, 1.03, random()), ridgeY: lerp(0.36, 0.64, random()), ridgeRadius: lerp(0.32, 0.5, random()), ridgeStrength: lerp(2.5, 6.2, random()),
    warmFrontOffset: lerp(0.02, 0.09, random()), warmFrontSlope: lerp(0.08, 0.29, random()), warmFrontWidth: lerp(0.045, 0.085, random()),
    drylineX: lerp(0.34, 0.53, random()), drylineBulge: lerp(0.015, 0.07, random()), drylineTilt: lerp(-0.06, 0.08, random()), drylineWidth: lerp(0.028, 0.058, random()),
    coldFrontSlope: lerp(0.22, 0.48, random()), coldFrontWidth: lerp(0.04, 0.075, random()), frontWaviness: lerp(0.005, 0.026, random()), phaseOffset: random(),
    northTemp: lerp(42, 64, random()) - intensity * 5, southTemp: lerp(70, 87, random()) + intensity * 2.5,
    warmBoost: lerp(4, 12, random()), hotDryBoost: lerp(12, 25, random()), coldPenalty: lerp(3, 9, random()), postFrontalCooling: lerp(5, 13, random()),
    gulfDewpoint: (lerp(55, 72.5, intensity) + lerp(-3, 2, random())) * narrative.moisture * modifier.moisture, dryDewpoint: lerp(24, 44, 1 - intensity) + lerp(-3, 3, random()),
    moistureStart: lerp(0.04, 0.18, random()), moistureEnd: lerp(0.70, 0.9, random()), moistureAxisX: lerp(0.58, 0.77, random()), moistureAxisY: lerp(0.57, 0.76, random()), moistureRadius: lerp(0.34, 0.56, random()) * narrative.coverage * modifier.coverage, moistureAxisBoost: lerp(1, 5, random()), northMoistureLoss: lerp(5, 11, random()), dryNorthSouthSlope: lerp(2, 8, random()), coldSectorDrying: lerp(4, 10, random()), postFrontalDrying: lerp(3, 8, random()),
    cycloneWind: lerp(15, 34, intensity), crossIsobarFraction: lerp(0.18, 0.38, random()), inflowU: -lerp(4, 12, intensity), inflowV: -lerp(7, 18, intensity), postFrontU: lerp(8, 16, random()), postFrontV: lerp(2, 8, random()),
    jetX: clamp(lowX + lerp(0.08, 0.25, random()), 0.32, 0.7), jetY: clamp(lowY + lerp(0.03, 0.17, random()), 0.18, 0.55), jetRadius: lerp(0.23, 0.39, random()),
    lljX: lerp(0.52, 0.72, random()), lljY: lerp(0.52, 0.76, random()), lljRadius: lerp(0.27, 0.42, random()),
    troughX: clamp(lowX - lerp(0.02, 0.16, random()), 0.15, 0.5), troughY: clamp(lowY + lerp(0.02, 0.18, random()), 0.18, 0.55), troughRadius: lerp(0.22, 0.38, random()), negativeTilt,
    jet250: lerp(46, 124, intensity) * lerp(0.88, 1.08, random()) * modifier.shear, jet500: lerp(24, 70, intensity) * lerp(0.88, 1.08, random()) * modifier.shear, llj850: lerp(12, 48, intensity) * lerp(0.86, 1.10, random()) * narrative.moisture,
    dir850Base: lerp(165, 205, random()), dir850Slope: lerp(8, 28, random()), dir700Base: lerp(205, 230, random()), dir500Base: lerp(225, 250, random()), dir250Base: lerp(242, 267, random()),
    temp700Base: lerp(-4, 4, random()), emlStrength: lerp(6, 15, random()), emlWarmSector: lerp(2, 8, random()), temp500Base: lerp(-12, -20, intensity), coldPoolStrength: lerp(2, 10, intensity),
    forcing: lerp(0.16, 0.86, intensity) * lerp(0.86, 1.10, random()) * narrative.forcing * modifier.forcing, capePotential: lerp(1500, 4100, intensity) * lerp(0.86, 1.10, random()) * narrative.moisture, capBase: lerp(105, 190, random()) * narrative.cap * modifier.cap,
    drylineActive: setup.name === 'dryline_cyclone' || setup.name === 'lee_cyclogenesis' || (setup.name === 'shortwave_ejection' && random() < 0.45),
    leeTroughActive: setup.name === 'lee_cyclogenesis'
      || setup.name === 'dryline_cyclone'
      || setup.name === 'high_plains_upslope',
    shortwaveActive: setup.name === 'shortwave_ejection' || setup.name === 'northwest_flow' || setup.name === 'warm_front_wave',
    shortwaveX: setup.name === 'northwest_flow' ? lerp(0.18, 0.38, random()) : clamp(lowX - lerp(0.02, 0.18, random()), 0.12, 0.56),
    shortwaveY: setup.name === 'northwest_flow' ? lerp(0.10, 0.34, random()) : clamp(lowY + lerp(0.02, 0.20, random()), 0.12, 0.62),
    shortwaveRadius: lerp(0.12, 0.23, random()), shortwaveStrength: lerp(0.55, 1.20, intensity),
    shortwavePressureDepth: (setup.name === 'shortwave_ejection' || setup.name === 'warm_front_wave' || setup.name === 'northwest_flow') ? lerp(1.5, 5.5, intensity) : lerp(0.2, 1.2, random()),
    shortwaveWindBoost: (setup.name === 'shortwave_ejection' || setup.name === 'northwest_flow') ? lerp(10, 32, intensity) : lerp(2, 10, random()),
    shortwaveTurn: setup.name === 'northwest_flow' ? -lerp(18, 35, random()) : lerp(8, 24, random()),
    leeTroughX: lerp(0.18, 0.34, random()), leeTroughY: lerp(0.45, 0.68, random()), leeTroughRadius: lerp(0.22, 0.36, random()),
    leeTroughPressureDepth: setup.name === 'high_plains_upslope'
      ? lerp(1.5, 4.5, intensity)
      : (setup.name === 'lee_cyclogenesis' || setup.name === 'dryline_cyclone')
        ? lerp(1.8, 5.8, intensity) : 0,
    waveX: lerp(5.3, 9.4, random()), waveY: lerp(4.1, 7.8, random()), waveAmplitude: lerp(0.15, 0.62, random()), phaseA: random() * Math.PI * 2, phaseB: random() * Math.PI * 2, phaseC: random() * Math.PI * 2,
    // 2.28.13: the seed describes a developing synoptic story rather than a
    // fully realized composite. These lifecycle controls are consumed by both
    // atmospheric evolution and predictive outlook synthesis.
    scenarioEvolution: buildScenarioEvolution(narrative.name, setup.name, intensity, random),
    patternLifecycle: buildPatternLifecycle(setup.name, narrative.name, intensity, analogGuidance)
  };
  config.atmosphericEnvelopeStrength = atmosphericEnvelope.name === 'extreme_regional'
    ? lerp(0.78, 1.00, random())
    : atmosphericEnvelope.name === 'significant_regional'
      ? lerp(0.75, 1.0, random())
      : 1;
  applyAtmosphericEnvelope(config, atmosphericEnvelope.name, random);
  applyAnalogAtmosphereProfile(config, analogGuidance, narrative.name, random);
  applyNarrativeAtmosphereProfile(config, narrative.name, random);
  applySetupPhysicalTemplate(config);
  config.boundaryTopology = boundaryTopologyFor(
    config.setupType, config.synopticPattern, config.drylineActive
  );
  config.synopticPattern.boundaryTopology = [...config.boundaryTopology];
  config.atmosphericEnvelope = atmosphericEnvelope.name;
  return config;
}

function applySetupPhysicalTemplate(config) {
  const phaseJitter = Math.sin(Number(config.synopticPattern?.phase) || 0) * 6;
  const setFlow = ({ surface, surfaceBlend, d850, d700, d500, d250, rotation = 0 }) => {
    config.surfaceFlowDirection = normalizeDirection(surface + phaseJitter * 0.45);
    config.surfaceFlowBlend = surfaceBlend;
    config.dir850Base = normalizeDirection(d850 + phaseJitter);
    config.dir700Base = normalizeDirection(d700 + phaseJitter);
    config.dir500Base = normalizeDirection(d500 + phaseJitter);
    config.dir250Base = normalizeDirection(d250 + phaseJitter * 0.7);
    config.backgroundFlowRotation = rotation;
    config.lowLevelFlowOffset = 0;
    config.midLevelFlowOffset = 0;
    config.deepLayerFlowOffset = 0;
    config.upperLevelFlowOffset = 0;
  };
  switch (config.setupType) {
    case 'high_plains_upslope':
      setFlow({ surface: 115, surfaceBlend: 0.82, d850: 125, d700: 235, d500: 270, d250: 278 });
      config.synopticPattern.negativeTilt = Math.min(config.synopticPattern.negativeTilt, 0.35);
      config.synopticPattern.troughY = Math.min(config.synopticPattern.troughY, 0.42);
      config.lljX = 0.35;
      config.lljY = 0.58;
      config.moistureAxisX = Math.min(config.moistureAxisX, 0.56);
      config.moistureRadius = Math.max(config.moistureRadius, 0.46);
      break;
    case 'northwest_flow':
      setFlow({ surface: 170, surfaceBlend: 0.76, d850: 250, d700: 292, d500: 310, d250: 315 });
      config.shortwaveTurn = 0;
      config.synopticPattern.negativeTilt = Math.min(config.synopticPattern.negativeTilt, 0.22);
      config.synopticPattern.troughY = Math.min(config.synopticPattern.troughY, 0.28);
      config.synopticPattern.motionYPerHour = Math.max(0.004, config.synopticPattern.motionYPerHour);
      config.gulfDewpoint = Math.max(config.gulfDewpoint, 59);
      config.northMoistureLoss = Math.min(config.northMoistureLoss, 6.5);
      config.moistureRadius = Math.max(config.moistureRadius, 0.43);
      config.capePotential = Math.max(config.capePotential, 2500);
      break;
    case 'warm_front_wave':
      setFlow({ surface: 105, surfaceBlend: 0.60, d850: 170, d700: 215, d500: 238, d250: 250 });
      config.lljY = Math.min(config.lljY, 0.58);
      break;
    case 'lee_cyclogenesis':
      setFlow({ surface: 135, surfaceBlend: 0.64, d850: 175, d700: 220, d500: 245, d250: 258 });
      config.synopticPattern.negativeTilt = Math.max(config.synopticPattern.negativeTilt, 0.42);
      break;
    case 'shortwave_ejection':
      setFlow({ surface: 155, surfaceBlend: 0.48, d850: 180, d700: 220, d500: 238, d250: 250 });
      config.synopticPattern.negativeTilt = Math.max(config.synopticPattern.negativeTilt, 0.5);
      break;
    case 'progressive_cold_front':
      setFlow({ surface: 175, surfaceBlend: 0.42, d850: 195, d700: 235, d500: 258, d250: 270 });
      config.synopticPattern.motionXPerHour = Math.max(config.synopticPattern.motionXPerHour, 0.017);
      break;
    case 'elevated_mcs':
      setFlow({ surface: 120, surfaceBlend: 0.68, d850: 175, d700: 220, d500: 245, d250: 258 });
      config.llj850 = Math.max(config.llj850, 38);
      config.elevatedWarmNoseC = 5;
      config.synopticPattern.motionXPerHour = Math.min(config.synopticPattern.motionXPerHour, 0.012);
      break;
    default:
      setFlow({ surface: 150, surfaceBlend: 0.42, d850: 185, d700: 225, d500: 245, d250: 258 });
  }
}

function boundaryTopologyFor(setup, pattern, drylineActive) {
  // Phase supplies deterministic within-family variety without another random
  // draw changing unrelated thermodynamics.
  const variant = (Math.sin(Number(pattern?.phase) || 0) + 1) * 0.5;
  switch (setup) {
    case 'dryline_cyclone':
      return variant < 0.24 ? ['dryline']
        : variant < 0.58 ? ['dryline', 'warm']
          : ['cold', 'warm', 'dryline'];
    case 'progressive_cold_front':
      return variant < 0.72 ? ['cold'] : ['cold', 'warm'];
    case 'warm_front_wave':
      return variant < 0.78 ? ['warm'] : ['cold', 'warm'];
    case 'lee_cyclogenesis':
      return variant < 0.22 ? ['dryline']
        : variant < 0.62 ? ['warm', 'dryline']
          : ['cold', 'warm', 'dryline'];
    case 'shortwave_ejection':
      return drylineActive && variant < 0.34 ? ['cold', 'warm', 'dryline']
        : variant < 0.72 ? ['cold', 'warm'] : ['cold'];
    case 'northwest_flow':
      return ['cold'];
    case 'high_plains_upslope':
      // Terrain convergence and a lee trough are the forcing mechanisms; an
      // analyzed surface front is not required.
      return [];
    case 'elevated_mcs':
      // Elevated systems may ride a warm-advection zone, an advancing cold
      // front, or no sharply analyzed surface boundary.
      return variant < 0.20 ? [] : variant < 0.72 ? ['warm'] : ['cold'];
    default:
      return ['cold', 'warm'];
  }
}

function buildScenarioEvolution(narrative, setup, intensity, random) {
  const nocturnalSetup = setup === 'elevated_mcs';
  const diurnalUpslope = setup === 'high_plains_upslope';
  const fastNorthwestWave = setup === 'northwest_flow';
  const delayed = ['conditional_tornado','cap_bust','late_recovery','elevated_mcs'].includes(narrative);
  const fastEligible = ['classic_tornado_outbreak','mixed_mode','hp_supercell','derecho','qlcs'].includes(narrative);
  const fastRoll = random();
  const fast = narrative === 'classic_tornado_outbreak' || (fastEligible && fastRoll < 0.58);
  const peakHour = nocturnalSetup ? lerp(14, 18, random())
    : diurnalUpslope ? lerp(8, 14, random())
      : fastNorthwestWave ? lerp(7, 13, random())
    : delayed ? lerp(31, 48, random()) : fast ? lerp(8, 18, random()) : lerp(18, 34, random());
  const developmentHours = nocturnalSetup ? lerp(7, 12, random())
    : diurnalUpslope ? lerp(5, 9, random())
      : fastNorthwestWave ? lerp(5, 9, random())
    : delayed ? lerp(18, 30, random()) : fast ? lerp(6, 13, random()) : lerp(11, 22, random());
  const decayHours = lerp(14, 28, random());
  const realization = clamp((0.34 + intensity * 0.52) * (delayed ? lerp(0.58, 0.88, random()) : lerp(0.78, 1.04, random())), 0.25, 1);
  return {
    stage: 'developing', peakHour, developmentHours, decayHours, realization,
    initialMaturity: clamp(1 - developmentHours / 34, 0.12, 0.62),
    moistureLagHours: nocturnalSetup ? lerp(2, 6, random()) : delayed ? lerp(6, 14, random()) : lerp(1, 7, random()),
    forcingLagHours: setup === 'shortwave_ejection' ? lerp(2, 8, random()) : lerp(0, 5, random()),
    fastTornadogenesis: fast,
    delayedTornadogenesis: delayed || random() < 0.28,
    narrative
  };
}

function buildPatternLifecycle(setup, narrative, intensity, analog = {}) {
  const coldFront = setup === 'progressive_cold_front';
  const profiles = {
    isolated_supercells: { geometry:'discrete-corridor', initial:'discrete', mature:'discrete', late:'multicell', delay:2.5, transition:8, coverage:[.58,.82,.52], coldPool:0.86, aftermath:'localized-outflow' },
    loaded_gun: { geometry:'isolated-boundary-points', initial:'capped', mature:'discrete', late:'discrete', delay:5.5, transition:7, coverage:[.18,.76,.48], coldPool:0.82, aftermath:'isolated-outflow' },
    mixed_mode: { geometry:'multi-boundary-corridor', initial:'discrete', mature:'mixed', late:'linear', delay:2, transition:5, coverage:[.62,1.02,.86], coldPool:1.10, aftermath:'storm-processed' },
    hp_supercell: { geometry:'moist-axis-corridor', initial:'discrete', mature:'multicell', late:'MCS', delay:2, transition:6, coverage:[.66,1.02,.90], coldPool:1.16, aftermath:'broad-outflow' },
    classic_tornado_outbreak: { geometry:'open-warm-sector', initial:'discrete', mature:'discrete', late:'mixed', delay:1.5, transition:8, coverage:[.72,1.08,.88], coldPool:.92, aftermath:'frontal-cleanout' },
    giant_hail: { geometry:'isolated-boundary-points', initial:'discrete', mature:'discrete', late:'multicell', delay:3, transition:8, coverage:[.48,.78,.50], coldPool:.88, aftermath:'localized-outflow' },
    progressive_mcs: { geometry:'cluster-corridor', initial:'multicell', mature:'linear', late:'MCS', delay:2, transition:4, coverage:[.68,1.08,.96], coldPool:1.24, aftermath:'broad-cold-pool' },
    qlcs: { geometry:'boundary-line', initial:'linear', mature:'QLCS', late:'MCS', delay:1.5, transition:3.5, coverage:[.78,1.10,.92], coldPool:1.28, aftermath:'frontal-cold-pool' },
    derecho: { geometry:'boundary-line', initial:'linear', mature:'QLCS', late:'MCS', delay:1, transition:3, coverage:[.82,1.14,1.00], coldPool:1.38, aftermath:'derecho-wake' },
    elevated_mcs: { geometry:'elevated-warm-advection', initial:'elevated', mature:'MCS', late:'MCS', delay:5, transition:7, coverage:[.42,1.04,.82], coldPool:1.18, aftermath:'nocturnal-cold-pool' },
    pulse_convection: { geometry:'scattered-heating', initial:'pulse', mature:'multicell', late:'decay', delay:3, transition:6, coverage:[.35,.70,.18], coldPool:.72, aftermath:'rapid-recovery' },
    cap_bust: { geometry:'conditional-boundary-points', initial:'capped', mature:'conditional', late:'decay', delay:9, transition:12, coverage:[.04,.24,.08], coldPool:.65, aftermath:'none' },
    stable_day: { geometry:'none', initial:'stable', mature:'stable', late:'stable', delay:24, transition:30, coverage:[.01,.05,.01], coldPool:.55, aftermath:'none' }
  };
  const profile = profiles[narrative] ?? profiles.isolated_supercells;
  // The narrative supplies bounds, not a script. Continuous analog properties
  // create deterministic per-seed variation without consuming the scenario RNG
  // a second time or changing unrelated atmospheric draws.
  const phasing = clamp(Number(analog.forcingTiming) || .8, .55, 1);
  const moisture = clamp(Number(analog.moistureDepth ?? analog.moistureReturn) || .8, .6, 1);
  const discreteBias = clamp(Number(analog.discreteBias) || .5, .1, 1);
  const frontal = clamp(Number(analog.frontalCoherence) || .8, .5, 1);
  const capPersistence = clamp(Number(analog.capPersistence) || .5, .15, .9);
  const timingVariation = (1 - phasing) * 2.8 + (capPersistence - .5) * 2.2;
  const transitionHours = Math.max(2, profile.transition - intensity * 1.5 + timingVariation);
  const coverageVariation = clamp(.88 + moisture * .12 + frontal * .08, .90, 1.08);
  const initialCoverage = clamp(profile.coverage[0] * coverageVariation * (.92 + discreteBias * .08), .01, 1.2);
  const matureCoverage = clamp(profile.coverage[1] * coverageVariation, .01, 1.2);
  const lateCoverage = clamp(profile.coverage[2] * (.90 + frontal * .12), .01, 1.2);
  return {
    version: 2,
    narrative,
    boundaryType: coldFront ? 'cold' : setup === 'dryline_cyclone' || setup === 'lee_cyclogenesis' ? 'dryline' : setup === 'warm_front_wave' ? 'warm' : null,
    initiationGeometry: coldFront && !['isolated_supercells','loaded_gun','giant_hail'].includes(narrative) ? 'boundary-line' : profile.geometry,
    initialMode: profile.initial,
    preferredMatureMode: profile.mature,
    lateMode: profile.late,
    lifecycleVariant: `${analog.primary ?? analog.archetype ?? 'synthetic'}:${phasing >= .86 ? 'well-phased' : phasing <= .7 ? 'delayed' : 'typical'}`,
    initiationDelayHours: Math.max(0, profile.delay - intensity * 1.2 + timingVariation),
    modeTransitionHours: transitionHours,
    lateTransitionHours: transitionHours + (['derecho','qlcs','progressive_mcs'].includes(narrative) ? 3 : 5),
    coverageEvolution: [initialCoverage, matureCoverage, lateCoverage],
    aftermath: profile.aftermath,
    linearTransitionHours: transitionHours,
    boundarySpeedMultiplier: coldFront ? 1.08 + intensity * 0.22 : 1,
    wakeCoolingF: coldFront ? 5 + intensity * 7 : 0,
    wakeDryingF: coldFront ? 2.5 + intensity * 5 : 0,
    wakePersistenceHours: coldFront ? 14 + intensity * 10 : 0,
    coldPoolMultiplier: clamp(profile.coldPool * (coldFront ? 1.08 : 1) * (.88 + moisture * .08 + frontal * .08), .48, 1.55),
    recoveryMultiplier: clamp((profile.aftermath === 'rapid-recovery' ? 1.35 : profile.aftermath === 'none' ? 1.08 : .72) * (1.08 - moisture * .10 + (1 - frontal) * .08), .55, 1.5)
  };
}

function applyAnalogAtmosphereProfile(config, analog, narrative, random) {
  // Analog influence is applied once, upstream, to the generated atmosphere.
  // Downstream diagnostics and outlook probabilities receive no analog bonus.
  const jitter = (spread = 0.025) => 1 + (random() * 2 - 1) * spread;
  const thermo = clamp(analog?.thermodynamics ?? 1, 0.92, 1.22);
  const kine = clamp(analog?.kinematics ?? 1, 0.94, 1.22);
  const moisture = clamp(analog?.moistureDepth ?? analog?.moistureReturn ?? .8, .62, 1);
  const phasing = clamp(analog?.forcingTiming ?? .8, .55, 1);
  const lapse = clamp(analog?.lapseQuality ?? .85, .72, 1);

  config.gulfDewpoint = clamp(config.gulfDewpoint + (moisture - .72) * 12, 58, 74);
  config.moistureRadius = clamp(config.moistureRadius * (0.92 + moisture * .18), .28, .68);
  config.moistureAxisBoost = clamp(config.moistureAxisBoost + (moisture - .7) * 7, 1, 7);
  config.northMoistureLoss = clamp(config.northMoistureLoss * (1.10 - moisture * .18), 3.5, 11);

  config.capePotential = clamp(config.capePotential * thermo * (0.94 + lapse * .09) * jitter(), 1600, 4700);
  config.emlStrength = clamp(config.emlStrength * (0.88 + lapse * .22), 5, 16.5);
  config.temp500Base = clamp(config.temp500Base - (lapse - .82) * 8, -24, -11);
  config.capBase = clamp(config.capBase * (0.80 + (analog?.capPersistence ?? .5) * .38), 85, 205);

  config.jet250 = clamp(config.jet250 * kine * jitter(), 44, 145);
  config.jet500 = clamp(config.jet500 * kine * jitter(), 24, 82);
  config.llj850 = clamp(config.llj850 * (0.94 + kine * .10) * (0.92 + moisture * .10) * jitter(), 12, 55);
  config.cycloneWind = clamp(config.cycloneWind * (0.92 + kine * .12), 14, 39);

  config.forcing = clamp(config.forcing * (0.82 + phasing * .28) * jitter(), .15, .98);
  config.shortwaveStrength = clamp(config.shortwaveStrength * (0.82 + phasing * .25), .48, 1.35);
  config.shortwaveWindBoost = clamp(config.shortwaveWindBoost * (0.86 + phasing * .20), 2, 36);
  config.synopticPattern.coherence = clamp(config.synopticPattern.coherence * .72 + (analog?.frontalCoherence ?? .8) * .28, .55, 1);
  config.negativeTilt = clamp(config.negativeTilt * .72 + (analog?.troughTilt ?? .6) * .28, 0, 1);

  // Impactful narratives should usually contain a coherent severe corridor,
  // while conditional analogs retain legitimate bust potential through cap,
  // cloud, boundary, and storm-mode failure modes.
  const impactful = ['classic_tornado_outbreak','derecho','mixed_mode','hp_supercell','loaded_gun'].includes(narrative);
  if (impactful) {
    const linear = narrative === 'derecho';
    config.gulfDewpoint = Math.max(config.gulfDewpoint, linear ? 65 : 66);
    config.capePotential = Math.max(config.capePotential, linear ? 2600 : 2800);
    config.jet500 = Math.max(config.jet500, 47);
    config.llj850 = Math.max(config.llj850, 26);
    config.forcing = Math.max(config.forcing, narrative === 'loaded_gun' ? .48 : .57);
  }
}


function applyNarrativeAtmosphereProfile(config, narrative, random) {
  const jitter = (amount = 0.04) => 1 + (random() * 2 - 1) * amount;
  const raise = (key, value) => { config[key] = Math.max(config[key], value); };
  const lower = (key, value) => { config[key] = Math.min(config[key], value); };

  switch (narrative) {
    case 'isolated_supercells':
      raise('capePotential', 2300); raise('jet500', 43); raise('llj850', 22);
      config.forcing = clamp(config.forcing * 0.88, .25, .70);
      config.capBase = clamp(config.capBase * 1.06, 100, 180);
      config.moistureRadius *= .86;
      break;
    case 'loaded_gun':
      raise('capePotential', 3200); raise('jet500', 50); raise('llj850', 28); raise('gulfDewpoint', 66);
      config.capBase = clamp(config.capBase * 1.24, 140, 205);
      config.forcing = clamp(config.forcing * .88, .38, .68);
      config.shortwaveStrength *= .94;
      break;
    case 'classic_tornado_outbreak':
      raise('gulfDewpoint', 68); raise('capePotential', 3150); raise('jet250', 98);
      raise('jet500', 58); raise('llj850', 36); raise('forcing', .70);
      config.negativeTilt = Math.max(config.negativeTilt, .55);
      config.moistureRadius = Math.max(config.moistureRadius, .54);
      config.moistureDepth = Math.max(config.moistureDepth ?? 0, .90);
      config.capBase = clamp(config.capBase, 88, 132);
      if (config.intensity >= .88) {
        raise('gulfDewpoint', 70); raise('capePotential', 3500); raise('jet250', 108);
        raise('jet500', 64); raise('llj850', 42); raise('forcing', .78);
        config.moistureRadius = Math.max(config.moistureRadius, .62);
        config.moistureAxisBoost = Math.max(config.moistureAxisBoost, 5);
        config.capBase = clamp(config.capBase, 82, 115);
        config.shortwaveStrength = Math.max(config.shortwaveStrength, 1.05);
      }
      break;
    case 'mixed_mode':
      raise('capePotential', 2450); raise('jet500', 48); raise('llj850', 28); raise('forcing', .58);
      config.capBase = clamp(config.capBase, 90, 150);
      config.moistureRadius *= 1.05;
      break;
    case 'giant_hail':
      raise('capePotential', 2700); raise('emlStrength', 10); lower('temp500Base', -17);
      config.llj850 *= .92; config.forcing *= .92; config.capBase *= 1.05;
      break;
    case 'hp_supercell':
      raise('gulfDewpoint', 67); raise('capePotential', 2600); raise('llj850', 27);
      config.moistureRadius *= 1.10; config.forcing = clamp(config.forcing, .50, .82);
      break;
    case 'derecho':
      raise('capePotential', 3200); raise('jet500', 58); raise('forcing', .72);
      config.capBase = clamp(config.capBase, 75, 118); config.moistureRadius *= 1.18;
      break;
    case 'progressive_mcs':
      raise('capePotential', 2200); raise('jet500', 46); raise('forcing', .58);
      config.moistureRadius *= 1.12; config.capBase = clamp(config.capBase, 85, 140);
      break;
    case 'qlcs':
      raise('jet500', 50); raise('llj850', 29); raise('forcing', .66);
      config.capePotential = clamp(config.capePotential, 1500, 3300);
      config.capBase = clamp(config.capBase, 75, 125);
      break;
    case 'elevated_mcs':
      raise('llj850', 30); raise('gulfDewpoint', 64);
      config.capBase = clamp(config.capBase * 1.18, 135, 205);
      config.forcing = clamp(config.forcing, .48, .76); config.moistureRadius *= 1.08;
      break;
    case 'pulse_convection':
      config.jet500 = clamp(config.jet500 * .72, 20, 42); config.llj850 = clamp(config.llj850 * .72, 10, 24);
      config.forcing = clamp(config.forcing * .70, .12, .42); config.capePotential = clamp(config.capePotential, 900, 2300);
      config.capBase = clamp(config.capBase * .84, 65, 125);
      break;
    case 'cap_bust':
      raise('capePotential', 3000); raise('gulfDewpoint', 66); raise('jet500', 48);
      config.capBase = clamp(config.capBase * 1.38, 175, 225);
      config.forcing = clamp(config.forcing * .68, .22, .48); config.moistureRadius *= .86;
      break;
    case 'stable_day':
      config.capePotential = clamp(config.capePotential * .42, 250, 1100);
      config.jet500 = clamp(config.jet500 * .72, 18, 40); config.llj850 = clamp(config.llj850 * .68, 8, 22);
      config.forcing = clamp(config.forcing * .72, .10, .42); config.capBase = clamp(config.capBase * 1.22, 145, 220);
      config.gulfDewpoint = Math.min(config.gulfDewpoint, 61);
      break;
  }

  config.capePotential *= jitter(.025);
  config.jet500 *= jitter(.02);
  config.llj850 *= jitter(.02);
  config.forcing = clamp(config.forcing * jitter(.018), .08, .98);
}

function chooseEnvelopeForNarrative(narrativeName, random) {
  // Narratives constrain the plausible atmospheric envelope, but do not
  // dictate the eventual outlook or storm realization.
  if (narrativeName === 'classic_tornado_outbreak') {
    return weightedChoice([
      { name: 'extreme_regional', weight: 0.18 },
      { name: 'significant_regional', weight: 0.67 },
      { name: 'organized_regional', weight: 0.15 }
    ], random);
  }
  if (narrativeName === 'loaded_gun') {
    return weightedChoice([
      { name: 'significant_regional', weight: 0.43 },
      { name: 'organized_regional', weight: 0.37 },
      { name: 'organized_local', weight: 0.20 }
    ], random);
  }
  if (['derecho','mixed_mode','hp_supercell'].includes(narrativeName)) {
    return weightedChoice([
      { name: 'significant_regional', weight: 0.25 },
      { name: 'organized_regional', weight: 0.52 },
      { name: 'organized_local', weight: 0.23 }
    ], random);
  }
  if (['cap_bust','stable_day','pulse_convection'].includes(narrativeName)) {
    return weightedChoice([
      { name: 'organized_local', weight: 0.86 },
      { name: 'organized_regional', weight: 0.14 }
    ], random);
  }
  return weightedChoice(ATMOSPHERIC_ENVELOPE_WEIGHTS, random);
}

function applyAtmosphericEnvelope(config, envelope, random) {
  const jitter = () => lerp(0.97, 1.03, random());
  if (envelope === 'organized_local') {
    config.intensity = Math.min(config.intensity, 0.59);
    config.gulfDewpoint = Math.min(config.gulfDewpoint, 67);
    config.jet250 *= 0.94 * jitter();
    config.jet500 *= 0.95 * jitter();
    config.llj850 *= 0.94 * jitter();
    config.capePotential *= 0.94 * jitter();
    config.forcing *= 0.94 * jitter();
    config.moistureRadius *= 0.94;
    config.lowDepth *= 0.95;
  } else if (envelope === 'organized_regional') {
    config.intensity = clamp(config.intensity, 0.48, 0.68);
    config.gulfDewpoint = clamp(config.gulfDewpoint * 1.01, 61, 69);
    config.jet250 *= 0.99 * jitter();
    config.jet500 *= 1.00 * jitter();
    config.llj850 *= 0.98 * jitter();
    config.capePotential *= 1.00 * jitter();
    config.forcing *= 1.00 * jitter();
    config.moistureRadius *= 1.00;
  } else if (envelope === 'significant_regional') {
    config.intensity = clamp(Math.max(config.intensity, 0.68), 0.68, 0.79);
    config.gulfDewpoint = clamp(Math.max(config.gulfDewpoint, 66.5), 66.5, 71);
    config.jet250 = clamp(Math.max(config.jet250, 88) * jitter(), 82, 112);
    config.jet500 = clamp(Math.max(config.jet500, 52) * jitter(), 49, 67);
    config.llj850 = clamp(Math.max(config.llj850, 30) * jitter(), 28, 42);
    config.capePotential = clamp(Math.max(config.capePotential, 2950) * jitter(), 2750, 3800);
    config.forcing = clamp(Math.max(config.forcing, 0.64) * jitter(), 0.60, 0.78);
    config.moistureRadius = Math.max(config.moistureRadius, 0.48);
    config.lowDepth = Math.max(config.lowDepth, 16);
    config.capBase = clamp(config.capBase, 105, 145);
  } else if (envelope === 'extreme_regional') {
    config.intensity = clamp(Math.max(config.intensity, 0.76 + 0.10 * config.atmosphericEnvelopeStrength), 0.78, 0.94);
    config.gulfDewpoint = clamp(Math.max(config.gulfDewpoint, 67.5 + 1.5 * config.atmosphericEnvelopeStrength), 67.5, 72.5);
    config.jet250 = clamp(Math.max(config.jet250, 98 + 10 * config.atmosphericEnvelopeStrength) * jitter(), 96, 130);
    config.jet500 = clamp(Math.max(config.jet500, 57 + 7 * config.atmosphericEnvelopeStrength) * jitter(), 55, 75);
    config.llj850 = clamp(Math.max(config.llj850, 33 + 7 * config.atmosphericEnvelopeStrength) * jitter(), 32, 49);
    config.capePotential = clamp(Math.max(config.capePotential, 3150 + 450 * config.atmosphericEnvelopeStrength) * jitter(), 3000, 4250);
    config.forcing = clamp(Math.max(config.forcing, 0.69 + 0.09 * config.atmosphericEnvelopeStrength) * jitter(), 0.67, 0.90);
    config.moistureRadius = Math.max(config.moistureRadius, 0.49 + 0.04 * config.atmosphericEnvelopeStrength);
    config.lowDepth = Math.max(config.lowDepth, 17 + 3 * config.atmosphericEnvelopeStrength);
    config.capBase = clamp(config.capBase, 96, 138);
    config.negativeTilt = Math.max(config.negativeTilt, 0.48 + 0.16 * config.atmosphericEnvelopeStrength);
  }
  config.regime = regimeFromIntensity(config.intensity);
}

function chooseSetupForNarrative(narrative, random) {
  const preferred = {
    isolated_supercells: ['dryline_cyclone', 'lee_cyclogenesis', 'warm_front_wave', 'high_plains_upslope'],
    loaded_gun: ['dryline_cyclone', 'lee_cyclogenesis', 'shortwave_ejection', 'high_plains_upslope'],
    mixed_mode: ['shortwave_ejection', 'progressive_cold_front', 'warm_front_wave'],
    hp_supercell: ['dryline_cyclone', 'shortwave_ejection', 'warm_front_wave', 'high_plains_upslope'],
    classic_tornado_outbreak: ['shortwave_ejection', 'dryline_cyclone', 'warm_front_wave'],
    giant_hail: ['dryline_cyclone', 'lee_cyclogenesis', 'northwest_flow', 'high_plains_upslope'],
    progressive_mcs: ['progressive_cold_front', 'northwest_flow', 'elevated_mcs'],
    qlcs: ['progressive_cold_front', 'shortwave_ejection', 'warm_front_wave'],
    derecho: ['progressive_cold_front', 'northwest_flow', 'elevated_mcs'],
    elevated_mcs: ['elevated_mcs', 'warm_front_wave', 'northwest_flow'],
    pulse_convection: ['warm_front_wave', 'northwest_flow', 'lee_cyclogenesis', 'high_plains_upslope'],
    cap_bust: ['dryline_cyclone', 'lee_cyclogenesis'],
    stable_day: ['progressive_cold_front', 'warm_front_wave']
  }[narrative];
  if (!preferred || random() < 0.10) return weightedChoice(SYNOPTIC_SETUP_WEIGHTS, random);
  const name = preferred[Math.floor(random() * preferred.length)];
  return SYNOPTIC_SETUP_WEIGHTS.find(option => option.name === name) ?? weightedChoice(SYNOPTIC_SETUP_WEIGHTS, random);
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
    const scaleX = 1 / Math.max(1, world.width - 1);
    const scaleY = 1 / Math.max(1, world.height - 1);
    cell.features.dryline = Boolean(cell.features._drylineActive) && Math.abs(nx - cell.features._drylineX) < scaleX * 0.8 && ny > 0.24;
    const nearWarmFront = Boolean(cell.features._warmFrontActive)
      && Math.abs(ny - cell.features._warmFrontY) < scaleY * 0.8 && nx > 0.3;
    const nearColdFront = Boolean(cell.features._coldFrontActive)
      && Math.abs(nx - cell.features._coldFrontX) < scaleX * 0.8 && ny > 0.2;
    cell.features.front = nearWarmFront ? 'warm' : nearColdFront ? 'cold' : null;
  });
}

function displayToPattern(x, y, orientation = 0, mirror = false, rotationDegrees = 0) {
  let px;
  let py;
  switch (((orientation % 4) + 4) % 4) {
    case 1: px = y; py = 1 - x; break;
    case 2: px = 1 - x; py = 1 - y; break;
    case 3: px = 1 - y; py = x; break;
    default: px = x; py = y;
  }
  if (mirror) px = 1 - px;
  if (rotationDegrees) {
    const radians = rotationDegrees * Math.PI / 180;
    const dx = px - 0.5;
    const dy = py - 0.5;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    px = 0.5 + dx * cos - dy * sin;
    py = 0.5 + dx * sin + dy * cos;
  }
  return { x: px, y: py };
}

function severeEnvelopeInfluence(nx, ny, config, corridorRadius) {
  const dx = nx - config.envelopeCenterX;
  const dy = ny - config.envelopeCenterY;
  const major = corridorRadius * config.envelopeAxisMajor;
  const minor = corridorRadius * config.envelopeAxisMinor;
  const angle = config.envelopeAngle;
  const primary = orientedGaussian(dx, dy, major, minor, angle);
  const alongX = Math.cos(angle);
  const alongY = Math.sin(angle);
  const normalX = -alongY;
  const normalY = alongX;
  const offset = config.envelopeSecondaryOffset;

  switch (config.envelopeShape) {
    case 'dual_lobe': {
      const second = orientedGaussian(
        dx - alongX * offset, dy - alongY * offset,
        major * 0.82, minor * 0.78, angle + 0.12
      );
      return Math.max(primary, second * config.envelopeLobeBalance);
    }
    case 'broken_corridor': {
      const wave = Math.sin((dx * alongX + dy * alongY) * 19 + config.envelopeWavePhase);
      const broken = primary * clamp(0.58 + 0.50 * wave, 0.12, 1);
      const satellite = orientedGaussian(
        dx + alongX * offset * 0.9, dy + alongY * offset * 0.9,
        major * 0.62, minor * 0.72, angle - 0.16
      );
      return Math.max(broken, satellite * 0.72);
    }
    case 'boundary_ribbon': {
      const along = dx * alongX + dy * alongY;
      const across = dx * normalX + dy * normalY;
      const waviness = config.envelopeWaveAmplitude
        * Math.sin(along * 18 + config.envelopeWavePhase);
      const ribbon = Math.exp(-((along * along) / (major * major)
        + ((across - waviness) * (across - waviness)) / ((minor * 0.48) ** 2)));
      const embedded = orientedGaussian(
        dx - alongX * offset * 0.45, dy - alongY * offset * 0.45,
        major * 0.55, minor * 0.72, angle
      );
      return Math.max(ribbon, embedded * 0.78);
    }
    case 'compact_cluster': {
      const coreA = orientedGaussian(dx, dy, major * 0.62, minor * 0.62, angle);
      const coreB = orientedGaussian(
        dx - normalX * offset * 0.55, dy - normalY * offset * 0.55,
        major * 0.48, minor * 0.52, angle + 0.4
      );
      return Math.max(coreA, coreB * 0.82);
    }
    default:
      return primary;
  }
}

function rotateVector(u, v, degrees) {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { u: u * cos - v * sin, v: u * sin + v * cos };
}

function meteorologicalVector(direction, speed) {
  const radians = normalizeDirection(direction) * Math.PI / 180;
  return { u: -speed * Math.sin(radians), v: -speed * Math.cos(radians) };
}

function normalizeDirection(direction) {
  return ((direction % 360) + 360) % 360;
}

function orientedGaussian(dx, dy, radiusMajor, radiusMinor, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const along = dx * cos + dy * sin;
  const across = -dx * sin + dy * cos;
  const major = Math.max(0.04, radiusMajor);
  const minor = Math.max(0.04, radiusMinor);
  return Math.exp(-((along * along) / (major * major) + (across * across) / (minor * minor)));
}

function weightedChoice(options, random) {
  const roll = random() * options.reduce((sum, option) => sum + option.weight, 0);
  let cumulative = 0;
  for (const option of options) {
    cumulative += option.weight;
    if (roll <= cumulative) return option;
  }
  return options[options.length - 1];
}

function normalizeSeed(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.abs(Math.trunc(numeric)) || 1;
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0 || 1;
}

import { clamp } from '../scenarios/math.js?v=2.22.0';

const MPH_PER_KPH = 0.621371;
const TORNADO_STATES = Object.freeze(['none', 'developing', 'on-ground', 'lifting', 'ended']);

export function initializeTornadoState(storm) {
  storm.tornado = {
    state: 'none', onGround: false, probability: 0, genesisPotential: 0,
    ageMinutes: 0, groundTimeMinutes: 0, pathLengthKm: 0, widthYards: 0,
    windSpeedMph: 0, estimatedEf: null, positionKm: { ...storm.positionKm },
    previousPositionKm: { ...storm.positionKm }, motionDirectionDeg: 0,
    forwardSpeedMph: 0, startedHourUtc: null, endedHourUtc: null,
    peakWindSpeedMph: 0, peakWidthYards: 0, cycleCount: 0, trackPoints: [],
    favorableMinutes: 0, unfavorableMinutes: 0, lastGenesisHourUtc: null, genesisCooldownMinutes: 0, pathway: null
  };
  storm.tornadoHistory = [];
  return storm.tornado;
}

export function updateTornadoState(world, storm, environment, dtHours) {
  const tornado = storm.tornado ?? initializeTornadoState(storm);
  const dtMinutes = dtHours * 60;
  const supercell = storm.mode?.includes('supercell');
  const qlcs = storm.mode === 'QLCS' || storm.mode === 'linear segment';
  const lowLcl = clamp((1500 - (environment.lcl ?? 1800)) / 850, 0, 1);
  const srh = clamp(((environment.srh ?? 0) - 80) / 260, 0, 1.15);
  const shear = clamp(((environment.bulkShear ?? 0) - 28) / 34, 0, 1.1);
  const instability = clamp(((environment.cape ?? 0) - 450) / 2300, 0, 1.1);
  const inflow = clamp((environment.mesoscale?.effectiveInflow ?? environment.readiness ?? 0), 0, 1);
  const stretch = clamp(environment.mesoscale?.stretchingPotential ?? 0, 0, 1);
  const boundary = clamp((environment.boundaryInfluence ?? 0) * 0.45 + (environment.outflowConvergence ?? 0) * 0.25 + (environment.mesoscale?.boundaryAugmentation ?? 0) * 0.30, 0, 1);
  const interactionQuality = clamp(environment.mesoscale?.interactionQuality ?? storm.interactionQuality ?? (1 - (storm.interactionSuppression ?? 0)), 0, 1);
  const inflowContamination = clamp(environment.mesoscale?.processedAirFraction ?? storm.processedAirFraction ?? 0, 0, 1);
  const cellCompetition = clamp(environment.mesoscale?.stormCompetition ?? storm.neighborCompetition ?? 0, 0, 1);
  const modeFactor = supercell ? 1.18 : qlcs ? 0.78 : 0.26;
  const mesocyclone = clamp(storm.mesocycloneStrength ?? storm.rotationStrength ?? 0, 0, 1.2);
  const prefrontal = clamp(environment.prefrontalSupercellSupport ?? 0, 0, 1);
  const tornadicEnvironment = clamp(environment.tornadicEnvironmentSupport ?? 0, 0, 1.15);
  const synopticAscent = clamp(environment.synopticAscent ?? environment.mesoscale?.ascent ?? 0, 0, 1);
  const synopticCoherence = clamp(environment.synopticCoherence ?? 1, 0, 1);
  const moisturePooling = clamp(environment.moisturePooling ?? environment.mesoscale?.moisturePooling ?? 0, 0, 1);
  const capErosion = clamp(environment.capErosion ?? environment.mesoscale?.capErosion ?? 0, 0, 1);
  const stormStructure = clamp(Math.max(storm.rotationStrength ?? 0, mesocyclone * 0.92) * 0.34 + storm.organization * 0.22 + storm.updraftStrength * 0.20 + storm.inflowQuality * 0.14 + prefrontal * 0.06 + tornadicEnvironment * 0.04, 0, 1.2);
  const coldPoolBalance = clamp(1 - Math.abs((storm.coldPoolStrength ?? 0) - 0.52) / 0.58, 0.15, 1);
  const maturity = storm.lifecycleState === 'mature' || storm.lifecycleState === 'organizing' ? 1 : storm.lifecycleState === 'developing' ? 0.72 : 0.24;
  const warmSector = clamp(environment.openWarmSectorSupport ?? environment.warmSector ?? 0, 0, 1);
  const synopticSupport = clamp(environment.synopticTornadoSupport ?? (synopticAscent * 0.42 + synopticCoherence * 0.23 + moisturePooling * 0.20 + capErosion * 0.15), 0, 1);
  const diagnosedRawStp = clamp(
    (environment.cape ?? 0) / 1500 * ((environment.srh ?? 0) / 150) *
    ((environment.bulkShear ?? 0) / 40) * clamp((2000 - (environment.lcl ?? 2000)) / 1000, 0, 1.5) *
    clamp((150 - Math.abs(environment.cin ?? 50)) / 125, 0, 1.2) * 0.55,
    0, 18
  );
  const rawStpValue = clamp(environment.rawStp ?? environment.stp ?? diagnosedRawStp, 0, 18);
  const stpValue = clamp(environment.stp ?? rawStpValue * (0.62 + 0.38 * synopticSupport), 0, 18);
  // STP is analysis-only. Tornado physics uses the underlying ingredients.
  const physicalTornadoSupport = clamp(srh * 0.30 + shear * 0.18 + lowLcl * 0.20 + instability * 0.10 + inflow * 0.12 + stretch * 0.10, 0, 1.2);
  // VTP is an analysis-only diagnostic. It is sampled for display but must
  // never influence tornado genesis, intensity, duration, or environmental ceilings.
  const vtp = clamp(environment.vtp ?? 0, 0, 5);
  const inhibition = clamp(((Math.abs(environment.cin ?? 0)) - 25) / 175, 0, 1);
  const environmentSupport = clamp(0.02 + srh * 0.20 + shear * 0.11 + lowLcl * 0.14 + instability * 0.08 + inflow * 0.11 + stretch * 0.06 + boundary * 0.05 + warmSector * 0.04 + prefrontal * 0.07 + tornadicEnvironment * 0.05 + physicalTornadoSupport * 0.10 + synopticSupport * 0.05 - inhibition * 0.09, 0, 1.15);
  const mesoscaleQuality = clamp(interactionQuality * 0.55 + coldPoolBalance * 0.25 + (1 - inflowContamination) * 0.14 + (1 - cellCompetition) * 0.06, 0, 1);
  const genesisPotential = clamp(modeFactor * maturity * (stormStructure * 0.52 + environmentSupport * 0.48) * (0.48 + mesoscaleQuality * 0.52), 0, 1);
  tornado.genesisPotential += (genesisPotential - tornado.genesisPotential) * clamp(dtHours * 3.2, 0, 1);
  tornado.probability = clamp(tornado.genesisPotential * (supercell ? 1.15 : qlcs ? 0.76 : 0.28), 0, 0.98);

  const tickIndex = Math.round(((world.stormEngine?.validHourUtc ?? world.validHourUtc ?? 0) + storm.ageHours) * 12);
  const trigger = deterministicUnit(`${world.evolution?.config?.seed ?? 1}|${storm.id}|tor|${tickIndex}`);
  tornado.genesisCooldownMinutes = Math.max(0, (tornado.genesisCooldownMinutes ?? 0) - dtMinutes);
  const favorableNow = supercell && physicalTornadoSupport >= 0.18 && genesisPotential >= 0.36 && environmentSupport >= 0.40 && mesoscaleQuality >= 0.42 && mesocyclone >= 0.30 && (srh >= 0.18 || boundary >= 0.45) && inflow >= 0.38;
  tornado.favorableMinutes = favorableNow ? Math.min(180, (tornado.favorableMinutes ?? 0) + dtMinutes) : Math.max(0, (tornado.favorableMinutes ?? 0) - dtMinutes * 1.4);
  tornado.unfavorableMinutes = favorableNow ? 0 : Math.min(180, (tornado.unfavorableMinutes ?? 0) + dtMinutes);
  const canTornado = storm.ageHours >= (supercell ? 0.45 : 0.75) && storm.intensity >= (supercell ? 0.34 : 0.46) && storm.organization >= (supercell ? 0.42 : 0.58) && mesocyclone >= (supercell ? 0.28 : 0.38) && tornado.genesisCooldownMinutes <= 0;
  const scenario = world.evolution?.config?.scenarioEvolution ?? {};
  const fastPath = Boolean(scenario.fastTornadogenesis) && storm.ageHours <= 1.5 && mesocyclone >= 0.42 && boundary >= 0.38;
  const delayedPath = Boolean(scenario.delayedTornadogenesis) && storm.ageHours >= 1.1 && tornado.favorableMinutes >= 25 && mesoscaleQuality >= 0.55;
  tornado.pathway = fastPath ? 'fast' : delayedPath ? 'delayed' : 'standard';
  const pathwayAdjustment = fastPath ? 0.035 : delayedPath ? 0.025 : 0;
  const genesisThreshold = supercell ? clamp(0.37 - physicalTornadoSupport * 0.055 - synopticSupport * 0.015 - pathwayAdjustment, 0.27, 0.37) : qlcs ? 0.50 : 0.82;

  if (!tornado.onGround && (tornado.state === 'none' || tornado.state === 'developing' || tornado.state === 'ended')) {
    const opportunity = clamp((tornado.favorableMinutes ?? 0) / 45, 0, 1);
    const perTickChance = clamp((tornado.genesisPotential - genesisThreshold + 0.08) * opportunity * mesoscaleQuality * (supercell ? 0.22 : 0.12), 0, supercell ? 0.16 : 0.08);
    const sustainedFavorableRealization = supercell && tornado.favorableMinutes >= 60 && tornado.genesisPotential >= genesisThreshold * 0.94 && mesoscaleQuality >= 0.50;
    if (canTornado && tornado.genesisPotential >= genesisThreshold && tornado.favorableMinutes >= (supercell ? (fastPath ? 8 : delayedPath ? 25 : 15) : 25) && (trigger < perTickChance || sustainedFavorableRealization)) {
      beginTornado(world, storm, tornado);
    } else if (canTornado && tornado.genesisPotential >= genesisThreshold * 0.82 && tornado.favorableMinutes >= 10) tornado.state = 'developing';
    else if (tornado.state !== 'ended') tornado.state = 'none';
  }

  tornado.previousPositionKm = { ...tornado.positionKm };
  tornado.positionKm = tornadoPosition(storm);
  const speedKph = Math.hypot(storm.velocityKph?.east ?? 0, storm.velocityKph?.north ?? 0);
  tornado.forwardSpeedMph = speedKph * MPH_PER_KPH;
  tornado.motionDirectionDeg = motionDirection(storm.velocityKph);

  if (tornado.onGround) {
    tornado.ageMinutes += dtMinutes;
    tornado.groundTimeMinutes += dtMinutes;
    tornado.pathLengthKm += Math.hypot(tornado.positionKm.x - tornado.previousPositionKm.x, tornado.positionKm.y - tornado.previousPositionKm.y);
    if (!tornado.trackPoints) tornado.trackPoints = [];
    tornado.trackPoints.push({ x: tornado.positionKm.x, y: tornado.positionKm.y, hourUtc: world.stormEngine?.validHourUtc ?? world.validHourUtc });
    if (tornado.trackPoints.length > 96) tornado.trackPoints.shift();
    // Tornado occurrence and tornado violence are deliberately separate.
    // A modest environment can support a brief tornado, but EF3+ requires
    // sustained overlap of the underlying ingredients and storm-scale structure.
    // STP now represents the local ingredient overlap adjusted by pattern maintenance;
    // VTP is intentionally excluded: intensity uses the underlying physical ingredients directly.
    const violentEnvironment = clamp(
      srh * 0.22 + shear * 0.14 + lowLcl * 0.15 + instability * 0.10 + inflow * 0.10 +
      stretch * 0.05 + physicalTornadoSupport * 0.14 + synopticSupport * 0.05 + tornadicEnvironment * 0.04 + prefrontal * 0.03 +
      interactionQuality * 0.04 - inhibition * 0.07, 0, 1.35
    );
    const stormIntensitySupport = clamp((storm.rotationStrength ?? 0) * 0.38 + mesocyclone * 0.24 + storm.updraftStrength * 0.18 + storm.organization * 0.12 + stretch * 0.08, 0, 1.2);
    const durationSupport = clamp((tornado.groundTimeMinutes - 5) / 35, 0, 1);
    const intensityCore = clamp(violentEnvironment * 0.58 + stormIntensitySupport * 0.34 + mesoscaleQuality * 0.08, 0, 1.25);
    let targetWind = 68 + intensityCore * 132 + durationSupport * violentEnvironment * 24;
    // The intensity ceiling uses the same coupled hierarchy shown to the user.
    const significantSupport = clamp(
      srh * 0.27 + shear * 0.17 + lowLcl * 0.18 + instability * 0.10 + inflow * 0.10 +
      physicalTornadoSupport * 0.20 + synopticSupport * 0.04 + stretch * 0.06 + mesoscaleQuality * 0.03 - inhibition * 0.10,
      0, 1.2
    );
    let environmentWindCeiling = significantSupport < 0.30 ? 105 : significantSupport < 0.43 ? 120 : significantSupport < 0.56 ? 140 : significantSupport < 0.69 ? 165 : significantSupport < 0.82 ? 190 : 235;
    // Low synoptic support alone is no longer a hard veto when the storm actually
    // enters a strong STP environment. Conversely, zero-STP air cannot support
    // a significant tornado regardless of broad synoptic ascent.
    if (physicalTornadoSupport < 0.22) environmentWindCeiling = Math.min(environmentWindCeiling, 105);
    else if (physicalTornadoSupport < 0.38) environmentWindCeiling = Math.min(environmentWindCeiling, 120);
    if (synopticCoherence < 0.50) environmentWindCeiling = Math.min(environmentWindCeiling, 135);
    if (lowLcl < 0.20 || srh < 0.22 || inflow < 0.42) environmentWindCeiling = Math.min(environmentWindCeiling, 120);
    if (tornado.groundTimeMinutes < 15) environmentWindCeiling = Math.min(environmentWindCeiling, 135);
    if (tornado.groundTimeMinutes < 30) environmentWindCeiling = Math.min(environmentWindCeiling, 165);
    targetWind = clamp(targetWind, 65, environmentWindCeiling);
    tornado.windSpeedMph += (targetWind - tornado.windSpeedMph) * clamp(dtHours * 2.6, 0, 1);
    tornado.intensityEnvironment = violentEnvironment;
    tornado.synopticSupport = synopticSupport;
    tornado.analysisStp = stpValue;
    tornado.rawStp = rawStpValue;
    tornado.vtp = vtp;
    tornado.environmentWindCeilingMph = environmentWindCeiling;
    const targetWidth = clamp(35 + intensityCore * 760 + storm.coldPoolStrength * 120, 25, violentEnvironment > 0.85 ? 1600 : 900);
    tornado.widthYards += (targetWidth - tornado.widthYards) * clamp(dtHours * 2.1, 0, 1);
    tornado.peakWindSpeedMph = Math.max(tornado.peakWindSpeedMph, tornado.windSpeedMph);
    tornado.peakWidthYards = Math.max(tornado.peakWidthYards, tornado.widthYards);
    tornado.estimatedEf = efRating(tornado.windSpeedMph);
    storm.hazardExtremes ??= { tornado:{maxWindMph:0,maxEfRating:null,maxWidthYards:0,maxPathLengthKm:0,cycles:0}, wind:{maxSustainedMph:0,maxGustMph:0}, hail:{maxSizeInches:0} };
    const torExtreme = storm.hazardExtremes.tornado;
    torExtreme.maxWindMph = Math.max(torExtreme.maxWindMph ?? 0, tornado.windSpeedMph);
    torExtreme.maxWidthYards = Math.max(torExtreme.maxWidthYards ?? 0, tornado.widthYards);
    torExtreme.maxPathLengthKm = Math.max(torExtreme.maxPathLengthKm ?? 0, tornado.pathLengthKm);
    torExtreme.maxEfRating = efRating(torExtreme.maxWindMph);
    torExtreme.cycles = Math.max(torExtreme.cycles ?? 0, tornado.cycleCount ?? 0);
    const persistence = tornado.genesisPotential * 0.62 + mesoscaleQuality * 0.22 + (supercell ? 0.10 : qlcs ? 0.02 : 0) + prefrontal * 0.03 + tornadicEnvironment * 0.03;
    const maxGroundMinutes = supercell ? Math.round(35 + prefrontal * 45 + tornadicEnvironment * 35 + mesoscaleQuality * 35) : 25;
    if (persistence < 0.43 || storm.lifecycleState === 'dissipating' || tornado.groundTimeMinutes >= maxGroundMinutes) {
      tornado.state = 'lifting';
      if (persistence < 0.34 || tornado.groundTimeMinutes >= maxGroundMinutes + 5) endTornado(world, storm, tornado);
    } else tornado.state = 'on-ground';
  } else if (tornado.state === 'lifting') {
    tornado.windSpeedMph *= Math.max(0, 1 - dtHours * 5);
    tornado.widthYards *= Math.max(0, 1 - dtHours * 4);
    if (tornado.windSpeedMph < 55) endTornado(world, storm, tornado);
  }

  return tornado;
}

function beginTornado(world, storm, tornado) {
  tornado.state = 'on-ground'; tornado.onGround = true; tornado.ageMinutes = 0;
  tornado.groundTimeMinutes = 0; tornado.pathLengthKm = 0; tornado.widthYards = 60;
  tornado.windSpeedMph = 75; tornado.startedHourUtc = world.stormEngine?.validHourUtc ?? world.validHourUtc;
  tornado.endedHourUtc = null; tornado.cycleCount += 1; tornado.trackPoints = []; tornado.positionKm = tornadoPosition(storm);
  tornado.lastGenesisHourUtc = world.stormEngine?.validHourUtc ?? world.validHourUtc; tornado.genesisCooldownMinutes = 0;
}

function endTornado(world, storm, tornado) {
  if (tornado.onGround || tornado.startedHourUtc != null) {
    storm.tornadoHistory ??= [];
    storm.tornadoHistory.push({
      cycle: tornado.cycleCount, startedHourUtc: tornado.startedHourUtc,
      endedHourUtc: world.stormEngine?.validHourUtc ?? world.validHourUtc,
      pathLengthKm: tornado.pathLengthKm, groundTimeMinutes: tornado.groundTimeMinutes,
      peakWindSpeedMph: tornado.peakWindSpeedMph, peakWidthYards: tornado.peakWidthYards,
      estimatedEf: efRating(tornado.peakWindSpeedMph), trackPoints: (tornado.trackPoints ?? []).slice(-96)
    });
    if (storm.tornadoHistory.length > 8) storm.tornadoHistory.shift();
  }
  tornado.state = 'ended'; tornado.onGround = false; tornado.endedHourUtc = world.stormEngine?.validHourUtc ?? world.validHourUtc;
  tornado.windSpeedMph = 0; tornado.widthYards = 0; tornado.startedHourUtc = null; tornado.genesisCooldownMinutes = 25;
}

function tornadoPosition(storm) {
  const angle = (storm.orientationDeg ?? 0) * Math.PI / 180;
  const offset = storm.mode?.includes('left-moving') ? 5 : -5;
  return { x: storm.positionKm.x + Math.cos(angle) * offset, y: storm.positionKm.y + Math.sin(angle) * offset };
}
function motionDirection(v = {}) { return (Math.atan2(v.east ?? 0, v.north ?? 0) * 180 / Math.PI + 360) % 360; }
function efRating(mph) { return mph >= 200 ? 'EF5' : mph >= 166 ? 'EF4' : mph >= 136 ? 'EF3' : mph >= 111 ? 'EF2' : mph >= 86 ? 'EF1' : mph >= 65 ? 'EF0' : null; }
function deterministicUnit(text) {
  let h=2166136261;
  for(let i=0;i<text.length;i++) h=Math.imul(h^text.charCodeAt(i),16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h>>>0)/4294967296;
}
export { TORNADO_STATES };

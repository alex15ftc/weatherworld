import { clamp } from '../scenarios/math.js?v=2.20.1';

const VERSION = '2.75.0';

export function initializeSimplifiedSevereWeather(world) {
  // WeatherWorld intentionally represents an active severe-weather climate.
  // Outbreak regimes are meaningful but remain less frequent than ordinary
  // severe days.
  const regime = severeRegimeForSeed(world.evolution?.config?.seed ?? 1);
  world.severeWeatherEngine = {
    version: VERSION, regime,
    frequencyMultiplier: regime === 'outbreak-favorable' ? 1.52 : regime === 'severe-favorable' ? 1.30 : 0.88,
    outbreakPrior: regime === 'outbreak-favorable' ? 0.72 : regime === 'severe-favorable' ? 0.14 : 0.03,
    validHourUtc: world.validHourUtc
  };
  updateSimplifiedSevereWeather(world);
}

export function severeRegimeForSeed(seed) {
  const unit = deterministicUnit(seed, 'severe-regime');
  return unit < 0.18 ? 'outbreak-favorable' : unit < 0.82 ? 'severe-favorable' : 'marginal';
}

export function updateSimplifiedSevereWeather(world) {
  if (!world.severeWeatherEngine) initializeSimplifiedSevereWeather(world);
  const engine = world.severeWeatherEngine;
  const soundingGuidance = interpolateSoundingAnchors(world.evolution?.config?.soundingAnchors, world.validHourUtc);
  engine.soundingGuidance = soundingGuidance;
  world.soundingSchedule = world.evolution?.config?.soundingAnchors ?? null;
  let severeCells = 0, outbreakCells = 0, initiationSum = 0, favorableCorridorCells = 0;
  world.forEachCell(cell => {
    const cape = Math.max(0, Number(cell.derived?.cape) || 0);
    const mucape = Math.max(cape, Number(cell.derived?.sounding?.mucape) || 0);
    const cin = Math.max(0, Number(cell.derived?.cin) || 0);
    const shearKt = Math.max(0, Number(cell.derived?.bulkShear) || 0);
    const srh = Math.max(0, Number(cell.derived?.srh) || 0);
    const lclM = Math.max(250, Number(cell.derived?.lclAgl ?? cell.derived?.lcl) || 1800);
    const liftWork = Math.max(0, Number(cell.liftBudget?.liftingWorkJkg) || 0);
    const liftDepthFraction = clamp(Number(cell.liftBudget?.depthFraction) || 0, 0, 1.25);
    const forcing = clamp(Math.max(Number(cell.dynamics?.forcingScore) || 0, Number(cell.mesoscaleFields?.ascent) || 0), 0, 1);
    const convergence = clamp(Math.max(Number(cell.mesoscaleFields?.convergenceCorridor) || 0, Number(cell.features?.stormOutflowConvergence) || 0), 0, 1);
    const parcelValidity = clamp(Number(cell.surfaceParcelValidity?.score) || 0, 0, 1);
    const elevated = elevatedSupport(cell);

    const buoyancy = ramp(cape, 350, 2600);
    const elevatedBuoyancy = ramp(mucape, 500, 3000);
    const deepShear = ramp(shearKt, 18, 52);
    const lowLevelRotation = ramp(srh, 60, 320);
    const lowCloudBase = 1 - ramp(lclM, 750, 2200);
    const inhibitionRelease = logistic((liftWork - cin + 20) / 48) * clamp(0.58 + 0.42 * liftDepthFraction, 0, 1);
    const trigger = clamp(0.58 * forcing + 0.42 * convergence, 0, 1);
    const surfaceRooted = parcelValidity >= 0.35;
    const usableBuoyancy = surfaceRooted ? buoyancy * (0.48 + 0.52 * parcelValidity) : elevatedBuoyancy * elevated;

    const corridor = resolveMovingSoundingCorridor(
      cell,
      world.evolution?.config?.soundingCorridors,
      world.validHourUtc
    );
    if (cell.features) cell.features.soundingCorridor = corridor;
    const corridorInfluence = clamp(Number(corridor.influence) || 0, 0, 1);
    const corridorMultiplier = interpolateCorridorMultiplier(corridor.anchorMultiplier, world.validHourUtc);
    const temporalOverlap = clamp((soundingGuidance?.overlap ?? 0.5) * corridorMultiplier * (0.68 + 0.48 * corridorInfluence), 0, 1);
    const severePotential = clamp(
      usableBuoyancy * (0.42 + 0.40 * deepShear + 0.18 * trigger) *
      (0.62 + 0.38 * inhibitionRelease) * (0.72 + 0.42 * temporalOverlap), 0, 1
    );
    const initiationProbability = clamp(
      engine.frequencyMultiplier * (0.10 + 0.90 * trigger) *
      (0.30 + 0.70 * inhibitionRelease) *
      (0.18 + 0.82 * usableBuoyancy) * (0.68 + 0.48 * temporalOverlap), 0, 0.92
    );
    const supercell = clamp(deepShear * (0.42 + 0.38 * lowLevelRotation + 0.20 * (1 - forcing)) * severePotential, 0, 1);
    const linear = clamp((0.48 * forcing + 0.30 * convergence + 0.22 * deepShear) * severePotential, 0, 1);
    const multicell = clamp(severePotential * (1 - 0.52 * Math.max(supercell, linear)), 0, 1);
    const tornado = clamp(supercell * lowLevelRotation * lowCloudBase * parcelValidity, 0, 1);
    const hail = clamp(severePotential * (0.25 + 0.39 * deepShear + 0.36 * ramp(mucape, 900, 3600)), 0, 1);
    const wind = clamp(severePotential * (0.24 + 0.34 * linear + 0.24 * forcing + 0.18 * ramp(cell.derived?.dcape ?? 0, 300, 1200)), 0, 1);
    const outbreakPotential = clamp(
      engine.outbreakPrior * severePotential * initiationProbability * (0.55 + 0.75 * temporalOverlap) *
      (0.42 + 0.34 * supercell + 0.24 * linear), 0, 1
    );

    cell.severeWeather = {
      version: VERSION, regime: engine.regime, cape, mucape, cin, shearKt, srh, lclM,
      buoyancy, deepShear, lowLevelRotation, inhibitionRelease, trigger,
      parcelValidity, surfaceRooted, elevatedSupport: elevated, temporalOverlap,
      soundingCorridor: { id: corridor.id ?? null, type: corridor.type ?? null, influence: corridorInfluence, quality: corridor.quality ?? 0, multiplier: corridorMultiplier },
      targetSounding: soundingGuidance ? {
        hourUtc: world.validHourUtc,
        mlcape: soundingGuidance.mlcape * corridorMultiplier,
        mlcin: soundingGuidance.mlcin / Math.max(0.75, corridorMultiplier),
        dewpointF: soundingGuidance.dewpointF + corridorInfluence * 2,
        shearKt: soundingGuidance.shearKt * corridorMultiplier,
        srh: soundingGuidance.srh * corridorMultiplier,
        forcing: clamp(soundingGuidance.forcing * corridorMultiplier, 0, 1),
        profile: soundingGuidance.profile ? structuredClone(soundingGuidance.profile) : null,
        overlap: temporalOverlap,
        limitingFactors: [...soundingGuidance.limitingFactors]
      } : null,
      severePotential,
      initiationProbability, outbreakPotential,
      modeProbability: { supercell, linear, multicell },
      hazardPotential: { tornado, hail, wind }
    };
    if (severePotential >= 0.42) severeCells++;
    if (outbreakPotential >= 0.18) outbreakCells++;
    if (corridorInfluence >= 0.45 && temporalOverlap >= 0.60) favorableCorridorCells++;
    initiationSum += initiationProbability;
  });
  const total = Math.max(1, world.width * world.height);
  engine.validHourUtc = world.validHourUtc;
  engine.summary = {
    severeCoverage: severeCells / total,
    outbreakCoverage: outbreakCells / total,
    favorableSoundingCorridorCoverage: favorableCorridorCells / total,
    meanInitiationProbability: initiationSum / total,
    outbreakActive: outbreakCells / total >= 0.035
  };
  return engine.summary;
}

export function applySoundingCorridorForcing(world, dtHours = 0.5) {
  const guidance = interpolateSoundingAnchors(world.evolution?.config?.soundingAnchors, world.validHourUtc);
  if (!guidance) return;
  const config = world.evolution?.config ?? {};
  world.forEachCell(cell => {
    const corridor = resolveMovingSoundingCorridor(
      cell,
      world.evolution?.config?.soundingCorridors,
      world.validHourUtc
    );
    if (cell.features) cell.features.soundingCorridor = corridor;
    const influence = clamp(Number(corridor?.influence) || 0, 0, 1);
    if (influence < 0.03) return;
    const multiplier = interpolateCorridorMultiplier(corridor.anchorMultiplier, world.validHourUtc);
    const response = clamp(dtHours * influence * 0.90, 0, 0.45);
    const targetProfile = guidance.profile;
    const dewpointTarget = (targetProfile?.surface?.dewpointF ?? guidance.dewpointF) + influence * 0.8;
    const temperatureTarget = targetProfile?.surface?.temperatureF
      ?? dewpointTarget + 7 + 10 * clamp((guidance.mlcape - 500) / 3000, 0, 1);
    cell.surface.temperature += (temperatureTarget - cell.surface.temperature) * response;
    cell.surface.dewpoint += (Math.min(cell.surface.temperature - 1, dewpointTarget) - cell.surface.dewpoint) * response;
    if (targetProfile?.surface) {
      cell.surface.wind.speed += (targetProfile.surface.windSpeedKt * multiplier - cell.surface.wind.speed) * response;
      cell.surface.wind.direction = blendDirection(cell.surface.wind.direction, targetProfile.surface.windDirection, response);
    }
    for (const pressure of [850, 700, 500, 250]) {
      const target = targetProfile?.[pressure];
      const level = cell.levels?.[pressure];
      if (!target || !level) continue;
      level.temperature += (target.temperatureC - level.temperature) * response;
      const currentDewpoint = Number.isFinite(level.dewpoint) ? level.dewpoint : target.dewpointC;
      level.dewpoint = currentDewpoint + (target.dewpointC - currentDewpoint) * response;
      level.windSpeed += (target.windSpeedKt * multiplier - level.windSpeed) * response;
      level.windDirection = blendDirection(level.windDirection, target.windDirection, response);
    }
  });
}

function interpolateCorridorMultiplier(multipliers, hourUtc) {
  if (!multipliers) return 1;
  let hour = ((Number(hourUtc) % 24) + 24) % 24;
  if (hour < 12) hour += 24;
  const points = [{ hour: 12, value: multipliers[12] ?? 1 }, { hour: 18, value: multipliers[18] ?? 1 }, { hour: 24, value: multipliers[24] ?? 1 }, { hour: 36, value: multipliers[12] ?? 1 }];
  for (let i = 0; i < points.length - 1; i++) if (hour >= points[i].hour && hour <= points[i + 1].hour) {
    const f = (hour - points[i].hour) / (points[i + 1].hour - points[i].hour);
    return points[i].value + (points[i + 1].value - points[i].value) * f;
  }
  return 1;
}

function resolveMovingSoundingCorridor(cell, schedule, hourUtc) {
  const frames = schedule?.frames;
  if (!Array.isArray(frames) || frames.length < 2) return cell.features?.soundingCorridor ?? {};
  const hour = clamp(Number(hourUtc) || 12, frames[0].hourUtc, frames.at(-1).hourUtc);
  let left = frames[0], right = frames.at(-1);
  for (let index = 0; index < frames.length - 1; index++) {
    if (hour >= frames[index].hourUtc && hour <= frames[index + 1].hourUtc) {
      left = frames[index]; right = frames[index + 1]; break;
    }
  }
  const fraction = clamp((hour - left.hourUtc) / Math.max(1, right.hourUtc - left.hourUtc), 0, 1);
  const start = interpolatePoint(left.start, right.start, fraction);
  const end = interpolatePoint(left.end, right.end, fraction);
  const width = left.width + (right.width - left.width) * fraction;
  const quality = left.quality + (right.quality - left.quality) * fraction;
  const x = Number(cell.features?._patternX) || 0;
  const y = Number(cell.features?._patternY) || 0;
  const distance = pointSegmentDistance(x, y, start, end);
  let influence = Math.exp(-0.5 * Math.pow(distance / Math.max(0.015, width), 2)) * quality;
  if (!cell.features?.warmSector) influence = 0;
  const base = cell.features?.soundingCorridor ?? {};
  return {
    ...base,
    id: 'SC-PRIMARY',
    type: 'historical-moving-warm-sector-overlap',
    influence,
    quality,
    distance,
    validHourUtc: hour,
    frameHours: [left.hourUtc, right.hourUtc],
    frameFraction: fraction
  };
}

function interpolatePoint(left, right, fraction) {
  return {
    x: left.x + (right.x - left.x) * fraction,
    y: left.y + (right.y - left.y) * fraction
  };
}

function pointSegmentDistance(x, y, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const amount = clamp(((x - start.x) * dx + (y - start.y) * dy) / Math.max(1e-9, dx * dx + dy * dy), 0, 1);
  return Math.hypot(x - (start.x + dx * amount), y - (start.y + dy * amount));
}

function interpolateSoundingAnchors(schedule, hourUtc) {
  const anchors = schedule?.anchors;
  if (!Array.isArray(anchors) || anchors.length < 2) return null;
  let hour = ((Number(hourUtc) % 24) + 24) % 24;
  if (hour < 12) hour += 24;
  let left = anchors[0], right = anchors.at(-1);
  if (hour > anchors.at(-1).hourUtc) {
    left = anchors.at(-1);
    right = { ...anchors[0], hourUtc: anchors[0].hourUtc + 24 };
  }
  for (let i = 0; i < anchors.length - 1; i++) {
    if (hour >= anchors[i].hourUtc && hour <= anchors[i + 1].hourUtc) {
      left = anchors[i]; right = anchors[i + 1]; break;
    }
  }
  const fraction = clamp((hour - left.hourUtc) / Math.max(1, right.hourUtc - left.hourUtc), 0, 1);
  const result = { version: schedule.version, hourUtc, leftHourUtc: left.hourUtc, rightHourUtc: right.hourUtc, fraction };
  for (const key of ['mlcape','mlcin','dewpointF','shearKt','srh','forcing','lljKt','overlap']) result[key] = left[key] + (right[key] - left[key]) * fraction;
  result.profile = interpolateTargetProfile(left.profile, right.profile, fraction);
  result.limitingFactors = fraction < 0.5 ? [...left.limitingFactors] : [...right.limitingFactors];
  return result;
}

function interpolateTargetProfile(left, right, fraction) {
  if (!left || !right) return left ?? right ?? null;
  const result = {};
  for (const key of ['surface', 850, 700, 500, 250]) {
    const a = left[key], b = right[key];
    if (!a || !b) continue;
    result[key] = {};
    for (const field of Object.keys(a)) {
      result[key][field] = field === 'windDirection'
        ? blendDirection(a[field], b[field], fraction)
        : a[field] + (b[field] - a[field]) * fraction;
    }
  }
  return result;
}

function blendDirection(from, to, amount) {
  const delta = ((to - from + 540) % 360) - 180;
  return (from + delta * amount + 360) % 360;
}

function elevatedSupport(cell) {
  const mu = Math.max(0, Number(cell.derived?.sounding?.mucape) || 0);
  const sb = Math.max(0, Number(cell.derived?.sounding?.sbcape) || 0);
  const llj = ramp(cell.levels?.[850]?.windSpeed ?? 0, 20, 50);
  const stable = clamp(Number(cell.boundaryLayer?.inversionStrength) || 0, 0, 1);
  return clamp(ramp(mu - sb, 300, 1800) * llj * (0.35 + 0.65 * stable), 0, 1);
}
function ramp(value, low, high) { return clamp((Number(value) - low) / Math.max(1e-6, high - low), 0, 1); }
function logistic(value) { return 1 / (1 + Math.exp(-value)); }
function deterministicUnit(seed, key) {
  let h = 2166136261;
  for (const ch of `${seed}|${key}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

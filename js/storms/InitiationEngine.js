import { clamp } from '../scenarios/math.js?v=2.20.1';

export function findInitiationCandidates(world, existingStorms, hourUtc) {
  const candidates = [];
  const setup = world.setupForecast?.profile ?? { coverage: 0.55 };
  const setupKey = world.setupForecast?.key ?? world.evolution?.config?.setupType ?? '';
  const evolution = world.evolution?.config?.scenarioEvolution ?? {};
  const significantEvent = ['classic_tornado_outbreak','mixed_mode','hp_supercell','derecho','qlcs'].includes(evolution.narrative);
  const activeStorms = existingStorms.reduce((count, storm) => count + (storm.active === false ? 0 : 1), 0);
  const activeCapacity = activeStormCapacity(setup.coverage, significantEvent);
  const remainingCapacity = Math.max(0, activeCapacity - activeStorms);
  if (remainingCapacity <= 0) return candidates;
  const cycleHour = ((Number(hourUtc) % 24) + 24) % 24;
  // This family specifically represents convection rooted above a nocturnally
  // stabilizing boundary layer and sustained by the evening/overnight LLJ.
  // Generic afternoon convergence must not turn it into an ordinary diurnal
  // surface-based MCS.
  if (setupKey === 'elevated_mcs' && cycleHour >= 12) return candidates;
  // Compact northwest-flow waves typically realize in a focused afternoon
  // window; repeatedly reseeding weak elevated cells all night creates an
  // unrealistic conveyor belt rather than organized clusters/supercells.
  if (setupKey === 'northwest_flow' && (cycleHour < 18 || cycleHour > 23.5)) return candidates;
  const elapsed = Number(world.evolution?.elapsedHours) || 0;
  const developmentStart = Math.max(0, Number(evolution.peakHour ?? 18) - Number(evolution.developmentHours ?? 12));
  const eventRelease = significantEvent
    ? clamp((elapsed - developmentStart) / Math.max(3, Number(evolution.developmentHours ?? 12) * 0.65), 0, 1)
    : 1;

  for (let y = 1; y < world.height - 1; y++) {
    for (let x = 1; x < world.width - 1; x++) {
      const cell = world.getCell(x, y);
      const rawProbability = cell.forecast?.initiationProbability ?? cell.dynamics?.initiationPotential ?? 0;
      const terrainLift = clamp((cell.dynamics?.terrainLiftMs ?? 0) / 0.05, 0, 1);
      const upslopeSignal = setupKey === 'high_plains_upslope'
        ? terrainLift * (0.55 + 0.45 * Math.max(
          cell.dynamics?.convectiveReadiness ?? 0,
          cell.features?.synopticAscent ?? 0
        ))
        : 0;
      const northwestWaveSignal = setupKey === 'northwest_flow'
        ? Math.max(cell.dynamics?.triggerStrength ?? 0, cell.features?.synopticAscent ?? 0)
          * clamp((cell.derived?.sounding?.mucape ?? cell.derived?.cape ?? 0) / 2500, 0, 1)
        : 0;
      const forcedSignal = clamp(Math.max(
        Math.max(cell.dynamics?.triggerStrength ?? 0, cell.features?.synopticAscent ?? 0)
          * Math.max(cell.mesoscaleFields?.initiationFocus ?? 0, cell.forecast?.capFailureProbability ?? 0),
        upslopeSignal,
        northwestWaveSignal
      ), 0, 1);
      const ungatedProbability = Math.max(rawProbability, forcedSignal >= 0.32 ? 0.045 + forcedSignal * 0.10 : rawProbability);
      const elevatedHourDistance = Math.min(Math.abs(hourUtc % 24 - 4), 24 - Math.abs(hourUtc % 24 - 4));
      const elevatedTimeGate = setupKey === 'elevated_mcs'
        ? 0.015 + 0.985 * Math.exp(-0.5 * Math.pow(elevatedHourDistance / 2.5, 2))
        : 1;
      const probability = ungatedProbability * (0.18 + 0.82 * eventRelease) * elevatedTimeGate;
      const rawConvectivePotential = cell.forecast?.convectivePotential ?? cell.dynamics?.convectiveReadiness ?? 0;
      const convectivePotential = setupKey === 'northwest_flow'
        ? Math.max(rawConvectivePotential, clamp(
          ((cell.derived?.sounding?.mucape ?? 0) - 500) / 3000,
          0,
          1
        ) * 0.55)
        : rawConvectivePotential;
      const capFailureProbability = cell.forecast?.capFailureProbability ?? 0;
      const forcingConfidence = cell.forecast?.forcingConfidence ?? 0;
      const releaseProbability = cell.forecast?.releaseProbability ?? probability;
      const rawReadiness = cell.dynamics?.convectiveReadiness ?? 0;
      const readiness = setupKey === 'northwest_flow'
        ? Math.max(rawReadiness, clamp(
          ((cell.derived?.sounding?.mucape ?? 0) - 500) / 3000,
          0,
          1
        ) * 0.22)
        : rawReadiness;
      const trigger = cell.dynamics?.triggerStrength ?? 0;
      const mesoscale = cell.mesoscaleFields ?? {};
      const corridor = Math.max(
        cell.forecast?.initiationCorridor ?? 0,
        mesoscale.convergenceCorridor ?? 0,
        cell.features?.explicitBoundaryInfluence ?? 0
      );
      const mesoscaleFocus = mesoscale.initiationFocus ?? 0;
      const openSector = cell.forecast?.openWarmSectorSupport ?? (cell.features?.warmSector ? readiness : 0);
      const trackSupport = cell.forecast?.projectedStormTrackSupport ?? 0;
      const prefrontal = cell.forecast?.prefrontalSupercellSupport ?? 0;
      const tornadicSupport = cell.forecast?.tornadicEnvironmentSupport ?? 0;
      const surfaceTiming = cell.forecast?.surfaceBasedTiming ?? 0.5;
      const capErosion = cell.forecast?.capErosion ?? 0.5;
      const nocturnalElevated = cell.forecast?.nocturnalElevatedSupport ?? 0;
      const nightStability = cell.forecast?.nightStability ?? 0;
      // Time of day modifies the ingredients; it is not a permission switch.
      const physicalRelease = clamp(
        0.30 * capErosion + 0.22 * trigger + 0.16 * corridor +
        0.14 * (cell.features?.synopticAscent ?? 0) + 0.10 * mesoscaleFocus +
        0.08 * openSector, 0, 1);
      const timingSupport = Math.max(0.18 + 0.82 * physicalRelease, nocturnalElevated * 0.82);

      // Staged gating: convection must be possible, but no longer requires all
      // ingredients to independently exceed high thresholds.
      if (convectivePotential < 0.24 || readiness < 0.18) continue;
      if (probability < 0.035 && Math.max(mesoscaleFocus, prefrontal) < 0.42 && forcedSignal < 0.30) continue;
      if (probability < 0.12 && mesoscaleFocus < 0.30 && capFailureProbability < 0.36 && forcedSignal < 0.32) continue;
      if (forcingConfidence < 0.16 && probability < 0.10) continue;
      const exceptionalForcedInitiation = setupKey !== 'elevated_mcs'
        && (trigger >= 0.84 && (cell.features?.synopticAscent ?? 0) >= 0.72
          || setupKey === 'northwest_flow' && forcedSignal >= 0.55);
      if (physicalRelease < 0.12 && nocturnalElevated < 0.18 && !exceptionalForcedInitiation) continue;
      if ((cell.forecast?.capBreakProbability ?? cell.forecast?.capFailureProbability ?? 0) < 0.015 && nocturnalElevated < 0.30 && !exceptionalForcedInitiation) continue;
      if (trigger < 0.16 && corridor < 0.24 && mesoscaleFocus < 0.30 && openSector < 0.42 && prefrontal < 0.38) continue;
      if (!isBroadLocalMaximum(world, x, y, probability)) continue;

      const score = clamp(
        probability * 0.34 + convectivePotential * 0.06 + capFailureProbability * 0.10 + forcingConfidence * 0.10 + releaseProbability * 0.08 + mesoscaleFocus * 0.08 + readiness * 0.05 + trigger * 0.04 + corridor * 0.05 + openSector * 0.03 + trackSupport * 0.02 + prefrontal * 0.03 + tornadicSupport * 0.01 + timingSupport * 0.01,
        0,
        1
      );
      const xKm = (x + 0.5) * world.cellSizeKm;
      const yKm = (y + 0.5) * world.cellSizeKm;
      if (nearestDistanceKm(existingStorms, xKm, yKm) < spacingFor(cell)) continue;
      candidates.push({ x, y, xKm, yKm, score, probability, convectivePotential, capFailureProbability, forcingConfidence, releaseProbability, corridor, mesoscaleFocus, openSector, trackSupport, prefrontal, tornadicSupport, surfaceTiming, capErosion, nocturnalElevated, nightStability, timingSupport, physicalRelease, eventRelease, hourUtc });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const accepted = [];
  const peakTiming = candidates.reduce((max, candidate) => Math.max(max, candidate.timingSupport ?? 0), 0);
  const setupLimit = setupKey === 'northwest_flow' ? 3 : 14;
  const maxNewStorms = Math.min(remainingCapacity, Math.max(1, Math.min(setupLimit, Math.round((1 + setup.coverage * 11) * (0.18 + 0.82 * peakTiming)))));
  if (maxNewStorms <= 0) return accepted;

  for (const candidate of candidates) {
    if (accepted.some(other => Math.hypot(other.xKm - candidate.xKm, other.yKm - candidate.yKm) < acceptedSpacing(candidate))) continue;
    if (deterministicUnit(world.evolution?.config?.seed ?? 'seed', hourUtc, candidate.x, candidate.y) > formationChance(candidate)) continue;
    accepted.push(candidate);
    if (accepted.length >= maxNewStorms) break;
  }
  return accepted;
}

export function activeStormCapacity(coverage = 0.55, significantEvent = false) {
  return Math.round((significantEvent ? 15 : 11) + clamp(Number(coverage) || 0, 0, 1) * (significantEvent ? 21 : 15));
}

function isBroadLocalMaximum(world, x, y, value) {
  let greater = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (dx === 0 && dy === 0) continue;
    if ((world.getCell(x + dx, y + dy)?.forecast?.initiationProbability ?? world.getCell(x + dx, y + dy)?.dynamics?.initiationPotential ?? 0) > value + 0.035) greater++;
  }
  return greater <= 1;
}

function spacingFor(cell) {
  const cin = cell.derived.cin ?? 0;
  const coverage = cell.forecast?.stormCoverage ?? 0.5;
  const linear = cell.forecast?.linearFraction ?? 0.4;
  return clamp(34 + cin * 0.08 - coverage * 16 - linear * 5, 18, 48);
}

function acceptedSpacing(candidate) {
  return clamp(30 - candidate.corridor * 8, 20, 30);
}

function nearestDistanceKm(storms, xKm, yKm) {
  let nearest = Infinity;
  for (const storm of storms) if (storm.active !== false) nearest = Math.min(nearest, Math.hypot(storm.positionKm.x - xKm, storm.positionKm.y - yKm));
  return nearest;
}

function formationChance(candidate) {
  const base = 0.01 + candidate.probability * 0.56 + candidate.score * 0.20 + (candidate.forcingConfidence ?? 0) * 0.08 + (candidate.capFailureProbability ?? 0) * 0.06 + candidate.corridor * 0.03 + (candidate.prefrontal ?? 0) * 0.04;
  const surfaceChance = base * (candidate.surfaceTiming ?? 0.5) * (0.22 + 0.78 * (candidate.capErosion ?? 0.5));
  const elevatedChance = base * (candidate.nocturnalElevated ?? 0) * 0.74;
  const stabilityPenalty = 1 - (candidate.nightStability ?? 0) * 0.48 * (1 - (candidate.nocturnalElevated ?? 0));
  return clamp(Math.max(surfaceChance, elevatedChance) * stabilityPenalty, 0.005, 0.94);
}

function deterministicUnit(seed, hour, x, y) {
  let h = 2166136261;
  const text = `${seed}|${hour}|${x}|${y}`;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

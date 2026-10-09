import { clamp } from '../scenarios/math.js';

export function findInitiationCandidates(world, existingStorms, hourUtc) {
  const candidates = [];
  const setup = world.setupForecast?.profile ?? { coverage: 0.55 };
  const setupKey = world.setupForecast?.key ?? world.evolution?.config?.setupType ?? '';
  // Every narrative is a severe setup; storm capacity is the higher (significant) one.
  const significantEvent = true;
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


  for (let y = 1; y < world.height - 1; y++) {
    for (let x = 1; x < world.width - 1; x++) {
      const cell = world.getCell(x, y);
      if (cell.meteorologicalIntegrity?.initiationCompatible === false) continue;
      const rawProbability = cell.forecast?.initiationProbability ?? cell.dynamics?.initiationPotential ?? 0;
      const airMassSector = cell.airMass?.sector ?? cell.features?.airMassSector ?? cell.features?.airMass ?? 'ambient';
      const surfaceBasedAirMass = !['dry-sector','post-cold-front','cool-sector','outflow'].includes(airMassSector);
      const elevatedSupportEarly = Number(cell.forecast?.nocturnalElevatedSupport) || 0;
      const explicitBoundaryEarly = Math.max(Number(cell.features?.explicitBoundaryInfluence) || 0, Number(cell.features?.boundaryConvergence) || 0);
      const synopticLiftEarly = Number(cell.features?.synopticAscent) || 0;
      // 2.68.0: reject obviously incompatible surface parcels before the expensive
      // candidate calculation. Elevated convection may still form when explicitly supported.
      if (!surfaceBasedAirMass && elevatedSupportEarly < 0.42) continue;
      if (rawProbability < 0.015 && explicitBoundaryEarly < 0.18 && synopticLiftEarly < 0.36) continue;
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
      const baseProbability = ungatedProbability * elevatedTimeGate;
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
      const releaseProbability = cell.forecast?.releaseProbability ?? baseProbability;
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
      // 2.47.0: use one shared signal for both published CI guidance and storm
      // realization. Previously the storm engine could use strong boundary or
      // forcing pathways while the reported initiation probability stayed near
      // zero, creating INITIATION_WITHOUT_SIGNAL contradictions.
      // 2.48.0: represent mesoscale lift as a coherent corridor object.
      // Boundary identity is inherited from the authoritative mesoscale object;
      // cells without an explicit object are grouped into broad forcing bands so
      // neighboring maxima do not behave as unrelated storm sources.
      const namedInfluences = Object.values(cell.features?.synopticBoundaryInfluences ?? {}).sort((a,b)=>(b.influence??0)-(a.influence??0));
      const namedPrimary = namedInfluences[0] ?? null;
      const boundaryType = namedPrimary?.influence >= 0.12 ? Object.keys(cell.features?.synopticBoundaryInfluences ?? {}).find(key => cell.features.synopticBoundaryInfluences[key] === namedPrimary) : (cell.features?.primaryBoundaryType ?? null);
      const boundaryId = namedPrimary?.influence >= 0.12 ? namedPrimary.id : (cell.features?.primaryBoundaryId ?? null);
      const namedBoundaryInfluence = clamp(namedPrimary?.influence ?? 0,0,1);
      const outflowSupport = clamp(cell.memory?.coldPool ?? cell.features?.outflowBoundaryInfluence ?? 0, 0, 1);
      const corridorStrength = clamp(
        0.34 * (cell.features?.boundaryConvergence ?? 0) +
        0.16 * (cell.features?.explicitBoundaryInfluence ?? 0) + 0.12 * namedBoundaryInfluence +
        0.18 * mesoscaleFocus + 0.12 * trigger +
        0.08 * (cell.features?.synopticAscent ?? 0) + 0.06 * outflowSupport,
        0,
        1
      );
      const segmentIndex = boundaryId ? Math.max(0, Math.min(5, Math.floor((boundaryType === 'warm' ? x : y) / Math.max(1, (boundaryType === 'warm' ? world.width : world.height) / 6)))) : null;
      const corridorId = boundaryId && namedBoundaryInfluence >= 0.12
        ? `boundary:${boundaryId}:segment:${segmentIndex}`
        : outflowSupport >= 0.35
          ? `outflow:${Math.floor(x / 5)}:${Math.floor(y / 5)}`
          : `forcing:${Math.floor(x / 7)}:${Math.floor(y / 7)}`;
      const boundaryLift = clamp(
        0.20 * corridor + 0.12 * namedBoundaryInfluence + 0.20 * mesoscaleFocus + 0.14 * trigger + 0.30 * corridorStrength +
        0.12 * (cell.features?.synopticAscent ?? 0) + 0.10 * openSector,
        0,
        1
      );
      const effectiveInitiationSignal = clamp(1 -
        (1 - baseProbability) *
        (1 - 0.72 * boundaryLift) *
        (1 - 0.48 * capFailureProbability) *
        (1 - 0.34 * forcedSignal), 0, 1);
      const probability = effectiveInitiationSignal;
      cell.forecast ??= {};
      cell.forecast.effectiveInitiationSignal = effectiveInitiationSignal;
      cell.forecast.initiationProbability = Math.max(Number(cell.forecast.initiationProbability) || 0, effectiveInitiationSignal);

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
      const coherentSource = boundaryId || outflowSupport >= 0.35 || corridorStrength >= 0.30 || (trigger >= 0.58 && (cell.features?.synopticAscent ?? 0) >= 0.45);
      if (!coherentSource) continue;
      if (!surfaceBasedAirMass && nocturnalElevated < 0.42) continue;
      if (!isBroadLocalMaximum(world, x, y, probability)) continue;

      const score = clamp(
        // Favor candidates whose inflow stays in the open warm sector (dryline / prefrontal
        // storms) over boundary cells whose storms quickly cross into cool, stable air.
        probability * 0.30 + convectivePotential * 0.06 + capFailureProbability * 0.09 + forcingConfidence * 0.09 + releaseProbability * 0.07 + mesoscaleFocus * 0.07 + readiness * 0.05 + trigger * 0.04 + corridor * 0.04 + openSector * 0.09 + trackSupport * 0.03 + prefrontal * 0.07 + tornadicSupport * 0.04 + timingSupport * 0.01,
        0,
        1
      );
      const persistenceKey = `${x},${y}`;
      world.stormEngine ??= {};
      const persistence = world.stormEngine.initiationPersistence ??= new Map();
      const priorPersistence = persistence.get(persistenceKey) ?? { slots: 0, lastHour: -Infinity };
      const consecutive = Math.abs((priorPersistence.lastHour ?? -Infinity) - (hourUtc - 0.5)) < 0.01 ? priorPersistence.slots + 1 : 1;
      persistence.set(persistenceKey, { slots: consecutive, lastHour: hourUtc });
      const immediateRelease = probability >= 0.32 && corridorStrength >= 0.48;
      if (consecutive < 2 && !immediateRelease) continue;
      const xKm = (x + 0.5) * world.cellSizeKm;
      const yKm = (y + 0.5) * world.cellSizeKm;
      if (nearestDistanceKm(existingStorms, xKm, yKm) < spacingFor(world, cell, { existing: true })) continue;
      candidates.push({ x, y, xKm, yKm, score, probability, effectiveInitiationSignal, corridorId, corridorStrength, boundaryType, processedAir: clamp(cell.features?.stormProcessedAir ?? 0, 0, 1), secondaryOutflow: outflowSupport >= 0.35, primaryTrigger:{ boundaryId, boundaryType, influence:namedBoundaryInfluence, secondary:namedInfluences.slice(1,3) }, forcingComponents: { boundaryConvergence: cell.features?.boundaryConvergence ?? 0, explicitBoundaryInfluence: cell.features?.explicitBoundaryInfluence ?? 0, mesoscaleFocus, trigger, synopticAscent: cell.features?.synopticAscent ?? 0, outflowSupport }, convectivePotential, capFailureProbability, forcingConfidence, releaseProbability, corridor, mesoscaleFocus, openSector, trackSupport, prefrontal, tornadicSupport, surfaceTiming, capErosion, nocturnalElevated, nightStability, timingSupport, physicalRelease, hourUtc, airMassSector, persistenceSlots: consecutive });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const accepted = [];
  const peakTiming = candidates.reduce((max, candidate) => Math.max(max, candidate.timingSupport ?? 0), 0);
  const setupLimit = setupKey === 'northwest_flow' ? 3 : (significantEvent ? 10 : 7);
  const peakSignal = candidates.reduce((max, candidate) => Math.max(max, candidate.effectiveInitiationSignal ?? candidate.probability ?? 0), 0);
  const maxNewStorms = Math.min(remainingCapacity, Math.max(0, Math.min(setupLimit,
    Math.round((1 + setup.coverage * 8) * peakSignal * (0.35 + 0.65 * peakTiming)))));
  if (maxNewStorms <= 0) return accepted;

  const persistence = world.stormEngine?.initiationPersistence;
  if (persistence instanceof Map && persistence.size > world.width * world.height * 0.5) {
    for (const [key, value] of persistence) if ((value.lastHour ?? -Infinity) < hourUtc - 2) persistence.delete(key);
  }
  for (const candidate of candidates) {
    if (accepted.some(other => Math.hypot(other.xKm - candidate.xKm, other.yKm - candidate.yKm) < acceptedSpacing(world, candidate, other))) continue;
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

// 2.52.0: spacing is expressed relative to the 10 km grid and the expected
// storm mode, not as one synoptic-scale exclusion radius. A cell covers 100
// km², so multiple storms can legitimately occupy neighboring cells while
// still representing distinct updrafts or members of a cluster.
export function spacingFor(world, cell, { existing = false } = {}) {
  const cellKm = Math.max(1, Number(world?.cellSizeKm) || 10);
  const cin = Math.max(0, Number(cell.derived?.cinMagnitude ?? cell.derived?.cin) || 0);
  const coverage = clamp(Number(cell.forecast?.stormCoverage) || 0.5, 0, 1);
  const discrete = clamp(Number(cell.forecast?.discreteFraction) || 0, 0, 1);
  const linear = clamp(Number(cell.forecast?.linearFraction) || 0, 0, 1);
  const corridor = clamp(Math.max(cell.forecast?.initiationCorridor ?? 0, cell.mesoscaleFields?.convergenceCorridor ?? 0), 0, 1);
  const processed = clamp(Number(cell.features?.stormProcessedAir) || 0, 0, 1);
  const baseCells = 1.15 + discrete * 0.85 - linear * 0.32 - coverage * 0.30 - corridor * 0.22;
  const capAdjustmentCells = clamp(cin / 240, 0, 0.65);
  const processedAdjustmentCells = processed * 0.45;
  const existingBufferCells = existing ? 0.20 : 0;
  return clamp((baseCells + capAdjustmentCells + processedAdjustmentCells + existingBufferCells) * cellKm, cellKm * 0.9, cellKm * 2.8);
}

export function acceptedSpacing(world, candidate, other) {
  const cellKm = Math.max(1, Number(world?.cellSizeKm) || 10);
  const corridorSupport = clamp(Math.max(candidate.corridor ?? 0, candidate.corridorStrength ?? 0), 0, 1);
  const sameCorridor = candidate.corridorId && candidate.corridorId === other.corridorId;
  const clustered = candidate.secondaryOutflow || sameCorridor && corridorSupport >= 0.58;
  const baseCells = clustered ? 0.95 : 1.35;
  const corridorReduction = corridorSupport * (clustered ? 0.20 : 0.28);
  return clamp((baseCells - corridorReduction) * cellKm, cellKm * 0.75, cellKm * 1.65);
}

function nearestDistanceKm(storms, xKm, yKm) {
  let nearest = Infinity;
  for (const storm of storms) if (storm.active !== false) nearest = Math.min(nearest, Math.hypot(storm.positionKm.x - xKm, storm.positionKm.y - yKm));
  return nearest;
}

function formationChance(candidate) {
  const base = 0.004 + candidate.probability * 0.70 + candidate.score * 0.12 + (candidate.forcingConfidence ?? 0) * 0.08 + (candidate.capFailureProbability ?? 0) * 0.06 + candidate.corridor * 0.03 + (candidate.prefrontal ?? 0) * 0.04;
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

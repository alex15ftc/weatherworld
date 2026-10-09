import { createSharedStormState, evolveSharedStormState, snapshotSharedStormState, SHARED_STORM_KERNEL_VERSION } from '../storms/SharedStormEvolutionKernel.js?v=2.62.0';
const HAZARDS = ['tornado','hail','wind'];

export function buildForecastStormProjection(grid, width, height, {
  key = 'day1',
  cellSizeKm = 10,
  maxCandidates = null,
  memberPerturbation = null
} = {}) {
  if (!Array.isArray(grid) || grid.length !== width * height) throw new Error('Forecast storm projection requires a complete grid.');
  const candidateLimit = maxCandidates ?? (key === 'day1' ? 32 : key === 'day2' ? 24 : 18);
  const candidates = selectCandidates(grid, width, height, candidateLimit, key);
  const fields = Object.fromEntries(HAZARDS.map(h => [h, new Float64Array(grid.length)]));
  const attribution = Object.fromEntries(HAZARDS.map(h => [h, { candidates: 0, totalContribution: 0, swathCells: 0 }]));
  const maximumPublished = Object.fromEntries(HAZARDS.map(h => [h, Math.max(0, ...grid.map(cell => Number(cell[`${h}Probability`]) || 0))]));

  for (const candidate of candidates) {
    const mode = diagnoseMode(candidate.cell, memberPerturbation);
    const lifetimeHours = expectedLifetime(candidate.cell, mode, key) * (memberPerturbation?.lifetimeFactor ?? 1);
    const confidence = forecastConfidence(candidate.cell, key);
    const steps = Math.max(2, Math.ceil(lifetimeHours));
    const evolution = buildTrack(candidate, width, height, steps, mode, memberPerturbation, confidence);
    const track = evolution.track;
    candidate.mode = mode;
    candidate.lifetimeHours = lifetimeHours;
    candidate.confidence = confidence;
    candidate.track = track;
    candidate.motionHistory = evolution.motionHistory;
    candidate.modeHistory = evolution.modeHistory;
    candidate.boundaryInteractions = evolution.boundaryInteractions;
    candidate.corridor50RadiusCells = evolution.corridor50RadiusCells;
    candidate.corridor90RadiusCells = evolution.corridor90RadiusCells;
    candidate.stateHistory = evolution.stateHistory;
    candidate.kernelVersion = evolution.kernelVersion;
    candidate.finalState = evolution.finalState;

    for (const hazard of HAZARDS) {
      const intensity = hazardIntensity(candidate.cell, hazard, mode);
      if (intensity <= 0.02) continue;
      attribution[hazard].candidates++;
      const widthCells = swathWidthCells(hazard, mode, key, confidence);
      for (let step = 0; step < track.length; step++) {
        const point = track[step];
        const lifecycle = lifecycleWeight(step / Math.max(1, track.length - 1), hazard, mode);
        const sourceProbability = clamp((Number(candidate.cell[`${hazard}Probability`]) || 0) / 100, 0, 0.9);
        const contribution = clamp(sourceProbability * (0.55 + 0.45 * intensity) * lifecycle * confidence, 0, 0.55);
        accumulateSwath(fields[hazard], width, height, point.x, point.y, widthCells, contribution);
        attribution[hazard].totalContribution += contribution;
      }
    }
  }

  for (const hazard of HAZARDS) {
    attribution[hazard].swathCells = [...fields[hazard]].filter(v => v >= 0.02).length;
  }

  return {
    version: '2.60.1',
    engineVersion: '2.62.0',
    kernelVersion: SHARED_STORM_KERNEL_VERSION,
    method: 'shared-storm-evolution-kernel',
    cellSizeKm,
    candidates,
    fields,
    attribution,
    maximumPublished
  };
}

export function applyForecastStormProjection(grid, width, height, options = {}) {
  const projection = buildForecastStormProjection(grid, width, height, options);
  for (let i = 0; i < grid.length; i++) {
    const cell = grid[i];
    const direct = {
      tornado: Number(cell.tornadoProbability) || 0,
      hail: Number(cell.hailProbability) || 0,
      wind: Number(cell.windProbability) || 0
    };
    for (const hazard of HAZARDS) {
      const projectedPct = Math.min(projection.maximumPublished[hazard], probabilityToPublished(projection.fields[hazard][i] * 100, hazard));
      const directPct = direct[hazard];
      // Forecast storms are authoritative for the corridor. Retain only a small
      // environmental background so weakly resolved candidates do not erase all guidance.
      const background = directPct * (options.key === 'day1' ? 0.18 : 0.28);
      cell[`${hazard}Probability`] = probabilityToPublished(Math.max(projectedPct, background), hazard);
    }
    cell.forecastStormProjection = {
      method: projection.method,
      tornadoSupport: projection.fields.tornado[i],
      hailSupport: projection.fields.hail[i],
      windSupport: projection.fields.wind[i]
    };
  }
  return projection;
}

function selectCandidates(grid, width, height, limit, key) {
  const rows = grid.map((cell, index) => {
    const initiation = clamp(Number(cell.peakInitiation) || 0, 0, 1);
    const occupancy = clamp(Number(cell.projectedStormOccupancy) || 0, 0, 1);
    const overlap = clamp(Number(cell.hazardOverlapScore) || 0, 0, 2);
    const confidence = clamp((Number(cell.confidence) || 50) / 100, 0.2, 1);
    const score = initiation * 0.42 + occupancy * 0.38 + Math.min(1, overlap) * 0.20;
    return { index, x: index % width, y: Math.floor(index / width), cell, score: score * confidence };
  }).filter(row => row.score >= (key === 'day1' ? 0.12 : 0.09));
  rows.sort((a,b) => b.score - a.score || a.index - b.index);
  const selected = [];
  for (const row of rows) {
    const mode = diagnoseMode(row.cell);
    const minSpacing = mode === 'linear' ? 1.25 : 1.8;
    if (selected.some(s => Math.hypot(s.x-row.x,s.y-row.y) < minSpacing)) continue;
    row.baseProbability = clamp(0.06 + row.score * 0.42, 0.04, 0.48);
    selected.push(row);
    if (selected.length >= limit) break;
  }
  return selected;
}

function buildTrack(candidate, width, height, steps, mode, perturbation = null, confidence = 0.5) {
  const trajectory = mode === 'linear'
    ? candidate.cell.hazardTrajectories?.wind ?? candidate.cell.trajectory
    : candidate.cell.hazardTrajectories?.tornado ?? candidate.cell.trajectory;
  const lifetimeHours = Math.max(1, Number(candidate.lifetimeHours) || steps);
  const dtHours = lifetimeHours / Math.max(1, steps);
  let baseVx = (Number(trajectory?.dxCells) || 0) * (perturbation?.motionFactor ?? 1) / Math.max(0.25, lifetimeHours);
  let baseVy = (Number(trajectory?.dyCells) || 0) * (perturbation?.motionFactor ?? 1) / Math.max(0.25, lifetimeHours);
  if (perturbation?.motionAngleDeg) {
    const a = perturbation.motionAngleDeg * Math.PI / 180, x = baseVx, y = baseVy;
    baseVx = x * Math.cos(a) - y * Math.sin(a);
    baseVy = x * Math.sin(a) + y * Math.cos(a);
  }
  const boundaryStrength = clamp(Number(candidate.cell.boundaryRelativePlacement ?? candidate.cell.hazardCorridors?.boundarySupport ?? 0), 0, 1);
  const boundaryPropagation = candidate.cell.projectedEnvironment?.boundaryPropagation ?? { east: 0, north: 0 };
  let state = createSharedStormState({
    mode,
    confidence,
    remainingLifetimeHours: lifetimeHours,
    motion: { east: baseVx, north: baseVy },
    organization: clamp(Number(candidate.cell.projectedStormOccupancy) || 0.3, 0.1, 1),
    inflowQuality: clamp(Number(candidate.cell.projectedEnvironment?.openWarmSectorSupport ?? candidate.cell.projectedStormOccupancy) || 0.65, 0.1, 1),
    coldPoolStrength: mode === 'linear' ? 0.28 : 0.08
  });
  const track = [{ x: candidate.x, y: candidate.y, t: 0, hourOffset: 0, mode: state.mode }];
  const motionHistory = [], modeHistory = [{ step: 0, hourOffset: 0, mode: state.mode }], boundaryInteractions = [], stateHistory = [snapshotSharedStormState(state, 0, { x: candidate.x, y: candidate.y })];
  let x = candidate.x, y = candidate.y, previousMode = state.mode;
  for (let i = 1; i <= steps; i++) {
    const environment = {
      cape: Number(candidate.cell.projectedEnvironment?.cape ?? candidate.cell.projectedEnvironment?.mlcape ?? 0),
      bulkShear: Number(candidate.cell.projectedEnvironment?.bulkShear ?? candidate.cell.projectedEnvironment?.shear ?? 0),
      forcing: Number(candidate.cell.projectedEnvironment?.forcing ?? candidate.cell.peakInitiation ?? 0),
      openWarmSectorSupport: Number(candidate.cell.projectedEnvironment?.openWarmSectorSupport ?? candidate.cell.projectedStormOccupancy ?? 0),
      processedAir: clamp((i / steps) * (0.08 + (1 - confidence) * 0.18), 0, 0.45),
      competition: clamp(Number(candidate.cell.projectedEnvironment?.stormCoverage ?? 0) * 0.35 + (perturbation?.competitionBias ?? 0), 0, 1),
      discreteFraction: Number(candidate.cell.projectedEnvironment?.discreteFraction ?? (mode === 'discrete' ? 0.7 : 0.25)),
      linearFraction: Number(candidate.cell.projectedEnvironment?.linearFraction ?? (mode === 'linear' ? 0.7 : 0.2)),
      lcl: Number(candidate.cell.projectedEnvironment?.lcl ?? 1100),
      boundaryStrength,
      boundaryPropagation,
      boundaryId: candidate.cell.boundaryRelativePlacement?.boundaryId ?? null,
      boundaryType: candidate.cell.boundaryRelativePlacement?.boundaryType ?? null,
      baseMotion: { east: baseVx, north: baseVy }
    };
    state = evolveSharedStormState(state, environment, dtHours, { mode: 'forecast' });
    x = clamp(x + state.motion.east * dtHours, 0, width - 1);
    y = clamp(y + state.motion.north * dtHours, 0, height - 1);
    const hourOffset = i * dtHours;
    if (state.mode !== previousMode) {
      modeHistory.push({ step: i, hourOffset, from: previousMode, mode: state.mode });
      previousMode = state.mode;
    }
    if (boundaryStrength > 0.28 && state.boundaryFollowingStrength > 0.12) {
      boundaryInteractions.push({ step: i, hourOffset, type: state.boundaryType ?? 'boundary-following', id: state.boundaryId, strength: state.boundaryFollowingStrength });
    }
    track.push({ x, y, t: i / steps, hourOffset, mode: state.mode });
    motionHistory.push({ step: i, hourOffset, dx: state.motion.east * dtHours, dy: state.motion.north * dtHours, speedCellsPerHour: Math.hypot(state.motion.east, state.motion.north), confidence: state.confidence });
    stateHistory.push(snapshotSharedStormState(state, hourOffset, { x, y }));
    if (state.remainingLifetimeHours <= 0 || state.intensity < 0.045) break;
  }
  const uncertainty = (1 - state.confidence) * (state.mode === 'linear' ? 2.6 : 2.1) + (perturbation ? Math.abs((perturbation.motionFactor ?? 1) - 1) * 2 : 0);
  return {
    kernelVersion: SHARED_STORM_KERNEL_VERSION,
    track,
    motionHistory,
    modeHistory,
    boundaryInteractions,
    stateHistory,
    finalState: state,
    corridor50RadiusCells: clamp(0.8 + uncertainty * 0.65, 0.8, 3.5),
    corridor90RadiusCells: clamp(1.8 + uncertainty * 1.45, 1.8, 7)
  };
}

function diagnoseMode(cell, perturbation = null) {
  const discrete = Number(cell.projectedEnvironment?.discreteFraction ?? (cell.trajectory?.mode === 'discrete' ? 1 : cell.conditionalTornadoIntensity)) || 0;
  const linear = (Number(cell.projectedEnvironment?.linearFraction ?? cell.conditionalWindIntensity) || 0) + (perturbation?.modeBias ?? 0);
  if (linear > discrete * 1.15) return 'linear';
  if (discrete > 0.55) return 'discrete';
  return 'cluster';
}

function expectedLifetime(cell, mode, key) {
  const occupancy = clamp(Number(cell.projectedStormOccupancy)||0,0,1);
  const persistence = clamp((Number(cell.persistenceSignal)||50)/100,0,1);
  const base = mode === 'discrete' ? 3.2 : mode === 'linear' ? 4.3 : 2.4;
  return clamp(base + occupancy*2.2 + persistence*1.4 + (key === 'day1' ? 0 : 0.8), 1.5, 8);
}

function forecastConfidence(cell, key) {
  const lead = clamp(Number(cell.leadTimeConfidence) || (Number(cell.confidence)||60)/100, 0.2, 1);
  const occupancy = clamp(Number(cell.projectedStormOccupancy)||0,0,1);
  return clamp(0.45*lead + 0.55*occupancy, key === 'day1' ? 0.28 : 0.2, 0.95);
}

function hazardIntensity(cell, hazard, mode) {
  const field = hazard === 'tornado' ? 'conditionalTornadoIntensity' : hazard === 'hail' ? 'conditionalHailIntensity' : 'conditionalWindIntensity';
  let value = clamp(Number(cell[field])||0,0,1.2);
  if (hazard === 'tornado') value *= mode === 'discrete' ? 1 : mode === 'linear' ? 0.42 : 0.7;
  if (hazard === 'wind') value *= mode === 'linear' ? 1.15 : mode === 'discrete' ? 0.55 : 0.85;
  if (hazard === 'hail') value *= mode === 'discrete' ? 1.08 : mode === 'linear' ? 0.62 : 0.9;
  return clamp(value,0,1.2);
}

function swathWidthCells(hazard, mode, key, confidence) {
  const base = hazard === 'tornado' ? 0.65 : hazard === 'hail' ? 1.15 : 1.35;
  const modeFactor = mode === 'linear' ? (hazard === 'wind' ? 1.55 : 1.15) : mode === 'cluster' ? 1.25 : 1;
  const uncertainty = (1-confidence) * (key === 'day1' ? 1.2 : 2.2);
  return clamp(base*modeFactor + uncertainty, 0.55, key === 'day1' ? 2.4 : 3.4);
}

function lifecycleWeight(t, hazard, mode) {
  const peak = hazard === 'tornado' ? 0.42 : hazard === 'hail' ? 0.34 : mode === 'linear' ? 0.68 : 0.58;
  const sigma = hazard === 'tornado' ? 0.25 : 0.34;
  return Math.exp(-0.5 * Math.pow((t-peak)/sigma,2));
}

function accumulateSwath(field,width,height,cx,cy,radius,probability) {
  const span = Math.ceil(radius*2.2);
  for (let dy=-span;dy<=span;dy++) for (let dx=-span;dx<=span;dx++) {
    const x=Math.round(cx+dx), y=Math.round(cy+dy);
    if (x<0||y<0||x>=width||y>=height) continue;
    const distance=Math.hypot(x-cx,y-cy);
    if (distance>radius*2.2) continue;
    const weight=Math.exp(-0.5*Math.pow(distance/Math.max(0.45,radius),2));
    const p=clamp(probability*weight,0,0.9);
    const i=y*width+x;
    field[i]=1-(1-field[i])*(1-p);
  }
}

function probabilityToPublished(value,hazard) {
  const levels = hazard === 'tornado' ? [0,2,5,10,15,30,45,60] : [0,5,15,30,45,60,75,90];
  let result=0;
  for (const level of levels) if (value >= level*0.82) result=level;
  return result;
}

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

import { clamp } from '../scenarios/math.js';

export const SHARED_STORM_KERNEL_VERSION = '2.62.0';

export function createSharedStormState(input = {}) {
  const mode = normalizeMode(input.mode);
  return {
    version: SHARED_STORM_KERNEL_VERSION,
    mode,
    ageHours: Number(input.ageHours) || 0,
    intensity: clamp(Number(input.intensity) || 0.2, 0, 1.25),
    organization: clamp(Number(input.organization) || 0.25, 0, 1),
    inflowQuality: clamp(Number(input.inflowQuality) || 0.75, 0.05, 1),
    coldPoolStrength: clamp(Number(input.coldPoolStrength) || 0.08, 0, 1),
    boundaryFollowingStrength: clamp(Number(input.boundaryFollowingStrength) || 0, 0, 1),
    boundaryId: input.boundaryId ?? null,
    boundaryType: input.boundaryType ?? null,
    confidence: clamp(Number(input.confidence) || 0.4, 0.08, 0.98),
    mesocyclonePhase: Number(input.mesocyclonePhase) || 0,
    remainingLifetimeHours: Math.max(0, Number(input.remainingLifetimeHours) || 4),
    motion: {
      east: Number(input.motion?.east) || 0,
      north: Number(input.motion?.north) || 0
    }
  };
}

export function evolveSharedStormState(state, environment = {}, dtHours = 1, options = {}) {
  const next = createSharedStormState(state);
  const forecast = options.mode === 'forecast';
  const boundaryStrength = clamp(Number(environment.boundaryStrength ?? environment.boundaryInteraction?.strength) || 0, 0, 1);
  const boundaryPropagation = environment.boundaryPropagation ?? environment.boundaryInteraction?.propagation ?? { east: 0, north: 0 };
  const capeSupport = clamp((Number(environment.cape) || 0) / 4000, 0, 1.2);
  const shearSupport = clamp(((Number(environment.bulkShear ?? environment.shear) || 0) - 18) / 45, 0, 1);
  const forcing = clamp(Number(environment.forcing) || 0, 0, 1);
  const warmSector = clamp(Number(environment.openWarmSectorSupport ?? environment.warmSector) || 0, 0, 1);
  const processed = clamp(Number(environment.processedAir) || 0, 0, 1);
  const competition = clamp(Number(environment.interactionSuppression ?? environment.competition) || 0, 0, 1);
  const discrete = clamp(Number(environment.discreteFraction) || (next.mode === 'discrete' ? 0.7 : 0.25), 0, 1);
  const linear = clamp(Number(environment.linearFraction) || (next.mode === 'linear' ? 0.7 : 0.2), 0, 1);
  const lcl = Number(environment.lcl) || 1100;

  const supercell = next.mode === 'discrete';
  const isLinear = next.mode === 'linear';
  const boundaryTarget = boundaryStrength * (supercell ? 0.72 : isLinear ? 0.45 : 0.32);
  next.boundaryFollowingStrength += (boundaryTarget - next.boundaryFollowingStrength) * clamp(dtHours * 1.25, 0, 1);
  if (boundaryStrength > 0.18) {
    next.boundaryId = environment.boundaryId ?? environment.boundaryInteraction?.id ?? next.boundaryId;
    next.boundaryType = environment.boundaryType ?? environment.boundaryInteraction?.type ?? next.boundaryType;
  }

  const inflowTarget = clamp(1 - processed * 0.58 - competition * 0.42 + warmSector * 0.16, 0.08, 1);
  next.inflowQuality += (inflowTarget - next.inflowQuality) * clamp(dtHours * 0.8, 0, 1);
  const organizationTarget = clamp(0.12 + shearSupport * 0.36 + discrete * 0.22 + forcing * 0.12 + next.inflowQuality * 0.18, 0, 1);
  next.organization += (organizationTarget - next.organization) * clamp(dtHours * 0.48, 0, 1);
  const intensityTarget = clamp(capeSupport * 0.36 + shearSupport * 0.18 + forcing * 0.18 + next.inflowQuality * 0.28 - competition * 0.18, 0, 1.2);
  next.intensity += (intensityTarget - next.intensity) * clamp(dtHours * (intensityTarget > next.intensity ? 0.55 : 0.30), 0, 1);
  const coldTarget = clamp(next.intensity * (0.28 + linear * 0.42 + clamp((lcl - 850) / 1600, 0, 1) * 0.22), 0, 1);
  next.coldPoolStrength += (coldTarget - next.coldPoolStrength) * clamp(dtHours * 0.34, 0, 1);

  let mode = next.mode;
  if (mode === 'discrete' && next.ageHours > 1.5 && (linear + next.coldPoolStrength * 0.65 + competition * 0.35) > (discrete + 0.34)) mode = 'cluster';
  if (mode === 'cluster' && next.ageHours > 2.2 && (linear + next.coldPoolStrength * 0.75 + forcing * 0.25) > 0.92) mode = 'linear';
  if (mode !== 'discrete' && discrete > 0.72 && shearSupport > 0.55 && competition < 0.35 && next.ageHours < 2.5) mode = 'discrete';
  next.mode = mode;

  const baseMotion = environment.baseMotion ?? state.motion ?? { east: 0, north: 0 };
  const speed = Math.max(0.5, Math.hypot(Number(baseMotion.east) || 0, Number(baseMotion.north) || 0));
  const ux = (Number(baseMotion.east) || 0) / speed;
  const uy = (Number(baseMotion.north) || 0) / speed;
  const right = { east: -uy, north: ux };
  next.mesocyclonePhase = (next.mesocyclonePhase + dtHours / Math.max(0.8, 2.6 - next.organization)) % 1;
  const cycleDeviation = next.mode === 'discrete' ? Math.sin(next.mesocyclonePhase * Math.PI * 2) * (1.2 + next.organization * 3.8) : 0;
  const coldPoolPush = next.mode === 'linear' ? 4 + next.coldPoolStrength * 20 : next.coldPoolStrength * 3;
  const boundaryWeight = next.boundaryFollowingStrength;
  const targetMotion = {
    east: (Number(baseMotion.east) || 0) + right.east * cycleDeviation + (Number(boundaryPropagation.east) || 0) * boundaryWeight + ux * coldPoolPush,
    north: (Number(baseMotion.north) || 0) + right.north * cycleDeviation + (Number(boundaryPropagation.north) || 0) * boundaryWeight + uy * coldPoolPush
  };
  const responseHours = next.mode === 'linear' ? 0.45 : next.mode === 'discrete' ? 0.62 : 0.8;
  const response = clamp(dtHours / responseHours, 0, forecast ? 0.78 : 1);
  next.motion.east += (targetMotion.east - next.motion.east) * response;
  next.motion.north += (targetMotion.north - next.motion.north) * response;

  const confidenceTarget = clamp(0.18 + next.organization * 0.28 + next.inflowQuality * 0.24 + boundaryStrength * 0.10 + shearSupport * 0.12 - competition * 0.18, 0.08, 0.97);
  next.confidence += (confidenceTarget - next.confidence) * clamp(dtHours * 0.75, 0, 1);
  next.ageHours += dtHours;
  const decayRate = 1 + competition * 0.7 + processed * 0.5 - next.inflowQuality * 0.3;
  next.remainingLifetimeHours = Math.max(0, next.remainingLifetimeHours - dtHours * clamp(decayRate, 0.55, 2));

  return next;
}

export function snapshotSharedStormState(state, hourUtc = null, position = null) {
  return {
    hourUtc,
    position: position ? { x: Number(position.x), y: Number(position.y) } : null,
    mode: state.mode,
    ageHours: state.ageHours,
    intensity: state.intensity,
    organization: state.organization,
    inflowQuality: state.inflowQuality,
    coldPoolStrength: state.coldPoolStrength,
    boundaryFollowingStrength: state.boundaryFollowingStrength,
    boundaryId: state.boundaryId,
    boundaryType: state.boundaryType,
    confidence: state.confidence,
    mesocyclonePhase: state.mesocyclonePhase,
    remainingLifetimeHours: state.remainingLifetimeHours,
    motion: { ...state.motion }
  };
}

function normalizeMode(mode) {
  const value = String(mode ?? '').toLowerCase();
  if (value.includes('supercell') || value === 'discrete') return 'discrete';
  if (value.includes('qlcs') || value.includes('mcs') || value.includes('linear')) return 'linear';
  return 'cluster';
}

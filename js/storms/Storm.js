export const STORM_STATES = Object.freeze(['tower', 'developing', 'organizing', 'mature', 'cyclic', 'weakening', 'dissipating']);
export const STORM_MODES = Object.freeze([
  'pulse storm', 'multicell', 'discrete supercell', 'left-moving supercell',
  'linear segment', 'QLCS', 'MCS', 'elevated convection'
]);

export class Storm {
  constructor({ id, xKm, yKm, velocityEastKph, velocityNorthKph, sourceCell, createdHourUtc, modeHint = null, parentId = null }) {
    this.id = id;
    this.positionKm = { x: xKm, y: yKm };
    this.previousPositionKm = { x: xKm, y: yKm };
    this.velocityKph = { east: velocityEastKph, north: velocityNorthKph };
    this.ageHours = 0;
    this.createdHourUtc = createdHourUtc;
    this.lifecycleState = 'tower';
    this.lifecycle = { phase: 'tower', previousPhase: null, phaseAgeHours: 0, cycleNumber: 0, cyclePhase: 0, transitionCount: 0, peakPhase: 'tower' };
    this.hazardMemory = { tornado: 0, hail: 0, wind: 0, decayHours: 1.25 };
    this.mesocycloneCycle = { phase: 0, strengthening: false, occlusion: 0, cyclesCompleted: 0 };
    this.interactions = { mergerBoost: 0, inflowCompetition: 0, outflowBoundaryBoost: 0, lastType: null };
    this.intensity = 0.12;
    this.organization = 0.15;
    this.updraftStrength = 0.15;
    this.coldPoolStrength = 0;
    this.coldPoolRadiusKm = 4;
    this.coldPoolTemperatureDeficitF = 0;
    this.coldPoolPressureRiseHpa = 0;
    this.coldPoolPropagation = { east: 0, north: 0 };
    this.outflowBoundaryId = null;
    this.boundaryInteraction = { strength: 0, type: null, id: null, propagation: { east: 0, north: 0 } };
    this.boundaryInteractionCount = 0;
    this.mode = modeHint ?? 'developing convection';
    this.modeConfidence = 0.2;
    this.modeAgeHours = 0;
    this.sourceCell = { x: sourceCell.x, y: sourceCell.y };
    this.environment = {};
    this.active = true;
    this.parentId = parentId;
    this.children = [];
    this.hasSplit = false;
    this.mergeCount = 0;
    this.mergedStormIds = [];
    this.lastInteractionHourUtc = null;
    this.interactionSuppression = 0;
    this.inflowQuality = 1;
    this.trackKm = 0;
    this.trackPoints = [{ x: xKm, y: yKm, hourUtc: createdHourUtc }];
    this.motion = { speedKph: Math.hypot(velocityEastKph, velocityNorthKph), speedMph: Math.hypot(velocityEastKph, velocityNorthKph) * 0.621371, directionDeg: (Math.atan2(velocityEastKph, velocityNorthKph) * 180 / Math.PI + 360) % 360 };
    this.surfaceWind = { sustainedMph: 0, gustMph: 0, maxSustainedMph: 0, maxGustMph: 0 };
    this.hazardExtremes = {
      tornado: { maxWindMph: 0, maxEfRating: null, maxWidthYards: 0, maxPathLengthKm: 0, cycles: 0 },
      wind: { maxSustainedMph: 0, maxGustMph: 0 },
      hail: { maxSizeInches: 0 }
    };
    this.confidence = {
      initiation: 0.18,
      organization: 0.08,
      persistence: 0.05,
      hazard: 0.04,
      tornado: 0,
      hail: 0,
      wind: 0
    };
    this.maxIntensity = this.intensity;
    this.peakRotationStrength = 0;
    this.peakUpdraftStrength = this.updraftStrength;
    this.peakColdPoolStrength = this.coldPoolStrength;
    this.dissipationReason = null;
    this.internalField = null;
    this.structure = null;
  }

  toSnapshot() {
    return {
      ...this,
      positionKm: { ...this.positionKm },
      previousPositionKm: { ...this.previousPositionKm },
      velocityKph: { ...this.velocityKph },
      sourceCell: { ...this.sourceCell },
      environment: { ...this.environment },
      children: [...this.children],
      trackPoints: this.trackPoints.map(point => ({ ...point })),
      internalField: this.internalField,
      structure: this.structure ? structuredClone(this.structure) : null
    };
  }
}

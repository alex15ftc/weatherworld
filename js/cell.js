export class Cell {
  constructor(x, y) {
    this.x = x;
    this.y = y;

    this.region = null;

    this.terrain = { elevationM: 0, slopeX: 0, slopeY: 0, roughness: 0.12, soilMoisture: 0.45 };

    this.surface = {
      pressure: 1013,
      seaLevelPressure: 1013,
      temperature: 70,
      dewpoint: 50,
      wind: { direction: 180, speed: 10 }
    };

    this.levels = {
      850: { temperature: 15, heightDm: 145, windDirection: 190, windSpeed: 25 },
      700: { temperature: 5, heightDm: 305, windDirection: 220, windSpeed: 40 },
      500: { temperature: -12, heightDm: 570, windDirection: 245, windSpeed: 60 },
      250: { temperature: -45, heightDm: 1040, windDirection: 260, windSpeed: 110 }
    };

    this.derived = {
      cape: 0,
      cin: 0,
      srh: 0,
      bulkShear: 0,
      lcl: 1200,
      stp: 0,
      rawStp: 0,
      vtp: 0,
      synopticTornadoSupport: 0,
      scp: 0,
      risk: 'TSTM',
      hazards: { tornado: 0, hail: 0, wind: 0, tornadoProbability: 0, hailProbability: 0, windProbability: 0, tornadoCig: 0, hailCig: 0, windCig: 0, dominant: 'tornado' },
      diagnostics: { severeSupport: 0, forcing: 0, stormMode: 'disorganized', discretePotential: 0, linearPotential: 0, limitingFactors: [] }
    };

    this.dynamics = { surfaceConvergenceS1: 0, moistureFluxConvergence: 0, frontogenesis: 0, terrainLiftMs: 0, upperDivergenceS1: 0, vorticityAdvection: 0, verticalVelocityMs: 0, capErosionRate: 0, forcingScore: 0, convectiveReadiness: 0, triggerStrength: 0, initiationPotential: 0, initiationCoverage: 0.42 };

    this.features = {
      front: null,
      dryline: false,
      warmSector: false,
      moistureAxis: false,
      leeTrough: false,
      shortwaveTrough: false,
      upperTrough: false,
      jetStreak: false,
      airMass: 'mT',
      synopticAscent: 0,
      regionId: null,
      emlInfluence: 0,
      emlBaseHpa: 0,
      emlDepthHpa: 0,
      midlevelLapseRateCkm: 6.3,
      capStrength: 0,
      synopticCoherence: 1
    };

    // Everything the engines attach to a cell later is declared here, in one fixed order, so
    // that every cell keeps the same object layout (properties added to some cells only, or in
    // different orders, give the JavaScript engine several layouts to handle).
    this.environmentDiagnostics = null;
    this.thermodynamics = null;
    this.cap = null;
    this.airMassFractions = null;
    this.airMassAuthority = null;
    this.surfaceParcelValidity = null;
    this._integrityBoundaryKey = null;
    this._integritySurface = null;
    this.meteorologicalIntegrity = null;
    this.mesoscaleFields = null;
    this.memory = null;
    this.diagnosticCacheInvalidated = false;
    this.diagnosticInvalidationReasons = null;
    this.predictiveOutlook = null;
  }
}

// Severe-weather narratives and synoptic setups. A narrative only describes the ingredients
// of the large-scale setup (moisture, cap, lapse rates, jets, trough, flow regime); the
// atmosphere is built from them once (SynopticSetupBuilder) and everything after that —
// storms, modes, timing, risk — comes from the simulation itself.
//
// Ranges are [weak end, strong end]; a seed's intensity picks a correlated point in each.
//   gulfDewpointF   warm-sector surface dewpoint at the Gulf (southern) edge, °F
//   moistureDepth   0-1, how far moisture extends north and how deep the moist layer is
//   t850C           warm-sector 850 mb temperature, °C
//   cap700C         warm-sector 700 mb temperature (elevated mixed layer cap), °C
//   lapse700500     700-500 mb lapse rate, °C/km
//   flow500Kt       background 500 mb flow speed, kt
//   jetPeakKt       250 mb jet streak speed added at the streak core, kt
//   lljKt           850 mb low-level jet core speed, kt
//   troughDm        depth of the local 500 mb trough (Gaussian dip), dam
//   lowDepthHpa     surface cyclone depth, hPa
//   tilt            0 = neutral/positive tilt .. 1 = strongly negative tilt

export const RISK_ORDER = ['TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'];
export const RISK_LABELS = {
  TSTM: 'General thunderstorms', MRGN: 'Marginal risk', SLGT: 'Slight risk',
  ENH: 'Enhanced risk', MDT: 'Moderate risk', HIGH: 'High risk'
};

// Flow regimes: direction the 500 mb background flow comes FROM (degrees), and where the
// trough sits relative to the domain (west = ahead of the trough, east = behind it).
export const FLOW_REGIMES = {
  southwest: { fromDeg: [232, 255], troughX: [-0.32, -0.05] },
  meridional: { fromDeg: [212, 228], troughX: [-0.02, 0.18] },
  west: { fromDeg: [262, 285], troughX: [0.10, 0.32] },
  northwest: { fromDeg: [295, 325], troughX: [0.78, 1.02] }
};

export const SETUPS = {
  dryline_cyclone: { label: 'Dryline cyclone', topology: [['dryline', 'warm'], ['cold', 'warm', 'dryline']], regimes: ['southwest', 'meridional', 'west'] },
  lee_cyclogenesis: { label: 'Lee cyclogenesis', topology: [['warm', 'dryline'], ['cold', 'warm', 'dryline']], regimes: ['southwest', 'west'] },
  warm_front_wave: { label: 'Warm-front wave', topology: [['warm'], ['cold', 'warm']], regimes: ['southwest', 'west'] },
  shortwave_ejection: { label: 'Ejecting shortwave trough', topology: [['cold', 'warm'], ['cold', 'warm', 'dryline']], regimes: ['southwest', 'meridional'] },
  progressive_cold_front: { label: 'Progressive cold front', topology: [['cold'], ['cold', 'warm']], regimes: ['west', 'southwest'] },
  northwest_flow: { label: 'Northwest-flow disturbance', topology: [['cold', 'warm']], regimes: ['northwest'] },
  high_plains_upslope: { label: 'High Plains upslope', topology: [['warm'], []], regimes: ['west', 'northwest'] }
};

export const NARRATIVES = [
  { name: 'classic_tornado_outbreak', label: 'Classic tornado outbreak', weight: 0.16, intensity: [0.78, 1.0],
    setups: ['shortwave_ejection', 'dryline_cyclone', 'warm_front_wave'],
    gulfDewpointF: [66, 71], moistureDepth: [0.75, 1], t850C: [16, 20], cap700C: [6, 9], lapse700500: [7.0, 8.0],
    flow500Kt: [34, 48], jetPeakKt: [55, 90], lljKt: [40, 58], troughDm: [7, 12], lowDepthHpa: [16, 26], tilt: [0.55, 1] },
  { name: 'isolated_supercells', label: 'Isolated tornadic supercells', weight: 0.16, intensity: [0.55, 0.8],
    setups: ['dryline_cyclone', 'lee_cyclogenesis', 'warm_front_wave', 'high_plains_upslope'],
    gulfDewpointF: [63, 69], moistureDepth: [0.5, 0.8], t850C: [15, 19], cap700C: [8, 11], lapse700500: [7.6, 8.6],
    flow500Kt: [28, 40], jetPeakKt: [35, 60], lljKt: [30, 45], troughDm: [4, 8], lowDepthHpa: [8, 16], tilt: [0.2, 0.7] },
  { name: 'loaded_gun', label: 'Loaded-gun supercell setup', weight: 0.10, intensity: [0.65, 0.92],
    setups: ['dryline_cyclone', 'lee_cyclogenesis', 'shortwave_ejection'],
    gulfDewpointF: [66, 72], moistureDepth: [0.6, 0.9], t850C: [17, 21], cap700C: [10.5, 13.5], lapse700500: [8.2, 9.0],
    flow500Kt: [30, 44], jetPeakKt: [45, 75], lljKt: [35, 52], troughDm: [5, 10], lowDepthHpa: [10, 20], tilt: [0.35, 0.85] },
  { name: 'hp_supercell', label: 'HP supercell day', weight: 0.11, intensity: [0.6, 0.85],
    setups: ['dryline_cyclone', 'shortwave_ejection', 'warm_front_wave'],
    gulfDewpointF: [67, 72], moistureDepth: [0.8, 1], t850C: [16, 20], cap700C: [5, 8], lapse700500: [6.6, 7.4],
    flow500Kt: [30, 42], jetPeakKt: [40, 65], lljKt: [38, 55], troughDm: [5, 9], lowDepthHpa: [10, 18], tilt: [0.3, 0.8] },
  { name: 'giant_hail', label: 'Giant-hail supercell day', weight: 0.10, intensity: [0.55, 0.85],
    setups: ['dryline_cyclone', 'lee_cyclogenesis', 'northwest_flow', 'high_plains_upslope'],
    gulfDewpointF: [61, 67], moistureDepth: [0.45, 0.75], t850C: [16, 21], cap700C: [7.5, 10.5], lapse700500: [8.4, 9.2],
    flow500Kt: [32, 46], jetPeakKt: [40, 70], lljKt: [25, 40], troughDm: [4, 8], lowDepthHpa: [6, 14], tilt: [0.1, 0.6] },
  { name: 'mixed_mode', label: 'Mixed-mode severe evolution', weight: 0.11, intensity: [0.6, 0.88],
    setups: ['shortwave_ejection', 'progressive_cold_front', 'warm_front_wave'],
    gulfDewpointF: [64, 70], moistureDepth: [0.6, 0.9], t850C: [15, 19], cap700C: [6, 9], lapse700500: [7.0, 8.0],
    flow500Kt: [34, 48], jetPeakKt: [50, 80], lljKt: [35, 52], troughDm: [6, 10], lowDepthHpa: [12, 22], tilt: [0.3, 0.8] },
  { name: 'qlcs', label: 'QLCS severe line', weight: 0.10, intensity: [0.6, 0.88],
    setups: ['progressive_cold_front', 'shortwave_ejection'],
    gulfDewpointF: [62, 68], moistureDepth: [0.55, 0.85], t850C: [14, 18], cap700C: [4, 7], lapse700500: [6.6, 7.5],
    flow500Kt: [40, 55], jetPeakKt: [55, 90], lljKt: [45, 62], troughDm: [7, 12], lowDepthHpa: [14, 26], tilt: [0.3, 0.9] },
  { name: 'derecho', label: 'Derecho evolution', weight: 0.08, intensity: [0.65, 0.92],
    setups: ['northwest_flow', 'progressive_cold_front'],
    gulfDewpointF: [67, 74], moistureDepth: [0.7, 1], t850C: [19, 24], cap700C: [9, 12], lapse700500: [7.6, 8.6],
    flow500Kt: [34, 46], jetPeakKt: [40, 70], lljKt: [35, 50], troughDm: [4, 7], lowDepthHpa: [6, 14], tilt: [0, 0.4] },
  { name: 'progressive_mcs', label: 'Progressive MCS', weight: 0.08, intensity: [0.55, 0.82],
    setups: ['progressive_cold_front', 'northwest_flow', 'warm_front_wave'],
    gulfDewpointF: [65, 72], moistureDepth: [0.65, 0.95], t850C: [17, 22], cap700C: [7, 10], lapse700500: [7.2, 8.2],
    flow500Kt: [30, 44], jetPeakKt: [40, 65], lljKt: [38, 55], troughDm: [4, 8], lowDepthHpa: [8, 16], tilt: [0.1, 0.5] }
];

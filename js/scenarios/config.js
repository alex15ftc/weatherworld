export const RISK_ORDER = ['TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'];

export const RISK_LABELS = {
  TSTM: 'General thunderstorms',
  MRGN: 'Marginal risk',
  SLGT: 'Slight risk',
  ENH: 'Enhanced risk',
  MDT: 'Moderate risk',
  HIGH: 'High risk'
};

// Aggressive severe-weather climatology, but no longer outbreak-biased.
// Most generated days still support organized convection; true outbreak and
// historic environments require uncommon draws near the top of their ranges.
export const REGIME_WEIGHTS = [
  { name: 'weak', weight: 0.06, range: [0.14, 0.32] },
  { name: 'modest', weight: 0.22, range: [0.28, 0.48] },
  { name: 'organized', weight: 0.32, range: [0.43, 0.65] },
  { name: 'significant', weight: 0.23, range: [0.60, 0.80] },
  { name: 'outbreak', weight: 0.13, range: [0.76, 0.94] },
  { name: 'historic', weight: 0.04, range: [0.91, 1.04] }
];

export const SYNOPTIC_SETUP_WEIGHTS = [
  { name: 'dryline_cyclone', label: 'Dryline cyclone', weight: 0.24 },
  { name: 'progressive_cold_front', label: 'Progressive cold front', weight: 0.16 },
  { name: 'warm_front_wave', label: 'Warm-front wave', weight: 0.11 },
  { name: 'lee_cyclogenesis', label: 'Lee cyclogenesis', weight: 0.14 },
  { name: 'shortwave_ejection', label: 'Ejecting shortwave trough', weight: 0.18 },
  { name: 'northwest_flow', label: 'Northwest-flow disturbance', weight: 0.08 },
  { name: 'high_plains_upslope', label: 'High Plains upslope', weight: 0.10 },
  { name: 'elevated_mcs', label: 'Elevated nocturnal MCS', weight: 0.08 }
];


// Gameplay climatology: every generated day is intended to contain at least
// one meaningful chase target, while the style and spatial coverage vary.
export const GAMEPLAY_NARRATIVE_WEIGHTS = [
  // Tornado-oriented narratives are intentionally the most common, but most
  // are localized, conditional, or mixed-mode rather than large outbreaks.
  { name: 'isolated_supercells', label: 'Isolated tornadic supercells', weight: 0.20, intensity: [0.42, 0.68], coverage: 0.76, discrete: 1.22, linear: 0.72, moisture: 1.03, forcing: 0.90, cap: 1.06 },
  { name: 'loaded_gun', label: 'Loaded-gun supercell setup', weight: 0.16, intensity: [0.56, 0.82], coverage: 0.84, discrete: 1.24, linear: 0.70, moisture: 1.09, forcing: 0.93, cap: 1.16 },
  { name: 'mixed_mode', label: 'Mixed-mode severe evolution', weight: 0.13, intensity: [0.54, 0.80], coverage: 1.08, discrete: 1.03, linear: 1.04, moisture: 1.07, forcing: 1.10, cap: 0.92 },
  { name: 'hp_supercell', label: 'HP supercell day', weight: 0.11, intensity: [0.54, 0.78], coverage: 1.06, discrete: 1.00, linear: 1.02, moisture: 1.13, forcing: 1.05, cap: 0.88 },
  { name: 'classic_tornado_outbreak', label: 'Classic tornado outbreak', weight: 0.09, intensity: [0.74, 0.94], coverage: 1.22, discrete: 1.18, linear: 0.96, moisture: 1.15, forcing: 1.18, cap: 0.78 },
  { name: 'giant_hail', label: 'Giant-hail supercell day', weight: 0.08, intensity: [0.48, 0.74], coverage: 0.88, discrete: 1.20, linear: 0.72, moisture: 1.00, forcing: 0.94, cap: 1.02 },
  { name: 'progressive_mcs', label: 'Progressive MCS', weight: 0.075, intensity: [0.50, 0.74], coverage: 1.16, discrete: 0.72, linear: 1.20, moisture: 1.07, forcing: 1.12, cap: 0.88 },
  { name: 'qlcs', label: 'QLCS severe line', weight: 0.07, intensity: [0.48, 0.74], coverage: 1.16, discrete: 0.62, linear: 1.25, moisture: 1.06, forcing: 1.19, cap: 0.82 },
  { name: 'derecho', label: 'Derecho evolution', weight: 0.06, intensity: [0.62, 0.84], coverage: 1.26, discrete: 0.62, linear: 1.30, moisture: 1.08, forcing: 1.17, cap: 0.82 },
  { name: 'elevated_mcs', label: 'Elevated nocturnal MCS', weight: 0.025, intensity: [0.38, 0.62], coverage: 1.04, discrete: 0.55, linear: 1.14, moisture: 1.08, forcing: 1.08, cap: 1.16 },
  { name: 'pulse_convection', label: 'Pulse-convection day', weight: 0.015, intensity: [0.24, 0.44], coverage: 0.94, discrete: 0.72, linear: 0.74, moisture: 1.02, forcing: 0.68, cap: 0.88 },
  { name: 'cap_bust', label: 'Rare cap-bust setup', weight: 0.003, intensity: [0.52, 0.76], coverage: 0.46, discrete: 1.18, linear: 0.62, moisture: 1.06, forcing: 0.72, cap: 1.42 },
  { name: 'stable_day', label: 'Rare stable day', weight: 0.002, intensity: [0.12, 0.28], coverage: 0.54, discrete: 0.58, linear: 0.62, moisture: 0.94, forcing: 0.72, cap: 1.18 }
];


// Atmospheric severity envelopes are generation targets, not outlook quotas.
// The risk layer never reads these names; it only analyzes the resulting fields.
export const ATMOSPHERIC_ENVELOPE_WEIGHTS = [
  { name: 'organized_local', weight: 0.51 },
  { name: 'organized_regional', weight: 0.24 },
  { name: 'significant_regional', weight: 0.20 },
  { name: 'extreme_regional', weight: 0.05 }
];

export const STORY_MODIFIER_WEIGHTS = [
  { name: 'none', label: 'Clean evolution', weight: 0.20, moisture: 1.00, forcing: 1.00, cap: 1.00, shear: 1.00, coverage: 1.00 },
  { name: 'moisture_surge', label: 'Late moisture surge', weight: 0.14, moisture: 1.06, forcing: 1.00, cap: 0.96, shear: 1.00, coverage: 1.02 },
  { name: 'stout_cap', label: 'Delayed initiation from a stout cap', weight: 0.13, moisture: 1.00, forcing: 0.96, cap: 1.18, shear: 1.00, coverage: 0.88 },
  { name: 'morning_mcs', label: 'Morning MCS and remnant outflow', weight: 0.13, moisture: 0.98, forcing: 1.08, cap: 0.92, shear: 0.98, coverage: 0.92 },
  { name: 'faster_jet', label: 'Faster upper jet', weight: 0.10, moisture: 1.00, forcing: 1.05, cap: 1.00, shear: 1.10, coverage: 1.02 },
  { name: 'dryline_mixing', label: 'Aggressive dryline mixing', weight: 0.10, moisture: 0.94, forcing: 1.04, cap: 1.04, shear: 1.00, coverage: 0.84 },
  { name: 'stalled_warm_front', label: 'Stalled warm-front corridor', weight: 0.10, moisture: 1.04, forcing: 1.05, cap: 0.96, shear: 1.04, coverage: 0.86 },
  { name: 'cold_pool_dominance', label: 'Early cold-pool dominance', weight: 0.10, moisture: 0.98, forcing: 1.10, cap: 0.92, shear: 1.00, coverage: 1.08 }
];

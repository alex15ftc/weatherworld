export const STORM_MODES = Object.freeze({
  DEVELOPING_CONVECTION: 'developing convection',
  PULSE_STORM: 'pulse storm',
  MULTICELL: 'multicell',
  ISOLATED_DISCRETE: 'isolated discrete',
  SEMI_DISCRETE: 'semi-discrete',
  DISCRETE_SUPERCELL_CLUSTER: 'discrete supercell cluster',
  MIXED_SUPERCELL_CLUSTER: 'mixed supercell cluster',
  DISCRETE_SUPERCELL: 'discrete supercell',
  LEFT_MOVING_SUPERCELL: 'left-moving supercell',
  BROKEN_LINE: 'broken line',
  LINEAR_SEGMENT: 'linear segment',
  QLCS: 'QLCS',
  QLCS_EMBEDDED_SUPERCELLS: 'QLCS with embedded supercells',
  MCS: 'MCS',
  ELEVATED_CONVECTION: 'elevated convection'
});

export const KNOWN_STORM_MODES = Object.freeze(Object.values(STORM_MODES));
const KNOWN_MODE_SET = new Set(KNOWN_STORM_MODES);

export function isKnownStormMode(mode) {
  return KNOWN_MODE_SET.has(mode);
}

export function isDiscreteStormMode(mode) {
  return mode === STORM_MODES.ISOLATED_DISCRETE ||
    mode === STORM_MODES.SEMI_DISCRETE ||
    mode === STORM_MODES.DISCRETE_SUPERCELL ||
    mode === STORM_MODES.DISCRETE_SUPERCELL_CLUSTER ||
    mode === STORM_MODES.LEFT_MOVING_SUPERCELL;
}

export function isLinearStormMode(mode) {
  return mode === STORM_MODES.BROKEN_LINE ||
    mode === STORM_MODES.LINEAR_SEGMENT ||
    mode === STORM_MODES.QLCS ||
    mode === STORM_MODES.QLCS_EMBEDDED_SUPERCELLS ||
    mode === STORM_MODES.MCS;
}

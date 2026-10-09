export const STORM_MODES = Object.freeze({
  DEVELOPING_CONVECTION: 'developing convection',
  PULSE_STORM: 'pulse storm',
  MULTICELL: 'multicell',
  ISOLATED_DISCRETE: 'isolated supercell',
  SEMI_DISCRETE: 'semi-discrete supercell',
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


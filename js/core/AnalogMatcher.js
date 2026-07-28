const ANALOG_LIBRARY = Object.freeze([
  analog('southern-plains-cyclic-supercell-014', .86, .72, .88, .84, .58, .76, 'discrete'),
  analog('central-plains-tornado-corridor-021', .78, .81, .92, .76, .43, .88, 'discrete'),
  analog('loaded-gun-dryline-009', .72, .66, .74, .79, .82, .55, 'discrete'),
  analog('progressive-mixed-mode-017', .68, .55, .81, .83, .34, .92, 'mixed'),
  analog('high-plains-upslope-006', .49, .44, .63, .67, .51, .67, 'discrete'),
  analog('cold-front-qlcs-012', .65, .40, .79, .86, .23, .95, 'linear'),
  analog('northwest-flow-cluster-004', .53, .34, .58, .72, .20, .74, 'mixed'),
  analog('warm-front-supercell-019', .73, .77, .94, .89, .38, .85, 'discrete'),
  analog('conditional-cap-bust-015', .81, .61, .78, .82, .88, .48, 'discrete'),
  analog('nocturnal-forward-mcs-010', .58, .42, .91, .76, .69, .91, 'linear'),
  analog('giant-hail-dryline-023', .71, .52, .72, .71, .67, .69, 'discrete'),
  analog('high-shear-low-cape-008', .62, .85, .53, .93, .24, .88, 'mixed')
]);

export function matchAnalogEnsemble(scenario, { count = 10, temperature = .16 } = {}) {
  const current = scenario.ingredients;
  const matches = ANALOG_LIBRARY.map(record => {
    const distance =
      2.0 * squared(current.troughAmplitude, record.pattern.troughAmplitude) +
      1.5 * squared(current.troughTilt, record.pattern.troughTilt) +
      1.8 * squared(current.lowLevelJetStrength, record.pattern.lowLevelJetStrength) +
      1.6 * squared(current.moistureQuality, record.pattern.moistureQuality) +
      1.4 * squared(current.capStrength, record.pattern.capStrength) +
      1.7 * squared(current.forcingTiming, record.pattern.forcingTiming);
    return { ...record, distance, weight: Math.exp(-distance / Math.max(.01, temperature)) };
  }).sort((a, b) => a.distance - b.distance).slice(0, Math.max(10, Math.min(30, count)));
  const totalWeight = matches.reduce((sum, match) => sum + match.weight, 0) || 1;
  return Object.freeze(matches.map(match => Object.freeze({ ...match, weight: match.weight / totalWeight })));
}

function squared(a, b) { return ((Number(a) || 0) - (Number(b) || 0)) ** 2; }
function analog(id, troughAmplitude, troughTilt, moistureQuality, lowLevelJetStrength, capStrength, forcingTiming, initialMode) {
  return Object.freeze({ analogId: id, pattern: Object.freeze({ troughAmplitude, troughTilt, moistureQuality, lowLevelJetStrength, capStrength, forcingTiming }), evolution: Object.freeze({ initialMode }) });
}

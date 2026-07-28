const PATTERN_KEYS = Object.freeze([
  'troughAmplitude', 'troughTilt', 'lowLevelJetStrength',
  'moistureQuality', 'capStrength', 'forcingTiming', 'discreteBias'
]);

/**
 * Select atmospheric forecast analogs without reading historical outcomes.
 * Records returned by this function intentionally omit intensity, reports,
 * observations, and later forecast products.
 */
export function selectForecastAnalogs(catalog, atmosphericState, {
  count = 20,
  temperature = .18,
  family = null,
  season = null
} = {}) {
  const target = atmosphericState?.pattern ?? atmosphericState ?? {};
  const candidates = catalog.filter(record =>
    (!family || record.pattern?.family === family) &&
    (!season || record.season === season)
  );
  const ranked = candidates.map(record => {
    const distance = atmosphericDistance(target, record.pattern ?? {}, family);
    return { record, distance, weight: Math.exp(-distance / Math.max(.02, Number(temperature) || .18)) };
  }).sort((a, b) => a.distance - b.distance).slice(0, Math.max(1, Math.min(30, count)));
  const total = ranked.reduce((sum, row) => sum + row.weight, 0) || 1;
  return Object.freeze(ranked.map(({ record, distance, weight }) => Object.freeze({
    analogId: String(record.analogId),
    eventDate: record.eventDate == null ? null : String(record.eventDate),
    season: record.season == null ? null : String(record.season),
    pattern: sanitizePattern(record.pattern),
    provenance: sanitizeAtmosphericProvenance(record.provenance),
    distance,
    weight: weight / total,
    selectionMode: 'forecast-atmosphere-only'
  })));
}

export function atmosphericDistance(target = {}, candidate = {}, preferredFamily = null) {
  const weights = {
    troughAmplitude: 2.0, troughTilt: 1.5, lowLevelJetStrength: 1.8,
    moistureQuality: 1.6, capStrength: 1.4, forcingTiming: 1.7, discreteBias: 1.1
  };
  let distance = preferredFamily && candidate.family !== preferredFamily ? .24 : 0;
  for (const key of PATTERN_KEYS) distance += weights[key] * squared(target[key], candidate[key]);
  return distance;
}

function sanitizePattern(pattern = {}) {
  return Object.freeze({
    family: pattern.family == null ? null : String(pattern.family),
    ...Object.fromEntries(PATTERN_KEYS.map(key => [key, finite(pattern[key])])),
    environment: freezeNumericObject(pattern.environment),
    diagnostics: freezeNumericObject(pattern.diagnostics)
  });
}
function sanitizeAtmosphericProvenance(provenance = {}) {
  return Object.freeze({ environment: provenance.environment ?? null });
}
function freezeNumericObject(value = {}) {
  return Object.freeze(Object.fromEntries(Object.entries(value ?? {}).filter(([, item]) => Number.isFinite(Number(item))).map(([key, item]) => [key, Number(item)])));
}
function finite(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function squared(a, b) { return (finite(a) - finite(b)) ** 2; }

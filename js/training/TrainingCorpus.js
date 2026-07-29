export const TRAINING_CORPUS_SCHEMA_VERSION = '2.36.0';
export const HISTORICAL_TRAINING_CORPUS_VERSION = TRAINING_CORPUS_SCHEMA_VERSION;

const ABSOLUTE_LON_RANGE = [-180, 180];
const ABSOLUTE_LAT_RANGE = [-90, 90];
const SPC_OPERATIONAL_ENVELOPE = Object.freeze({ minLon: -180, maxLon: -45, minLat: 0, maxLat: 80 });
const PROBABILITY_LEVELS = Object.freeze({
  tornado: new Set([0.02, 0.05, 0.10, 0.15, 0.30, 0.45, 0.60]),
  wind: new Set([0.05, 0.15, 0.30, 0.45, 0.60]),
  hail: new Set([0.05, 0.15, 0.30, 0.45, 0.60])
});
const REQUIRED_DAY1_HAZARDS = Object.freeze(['categorical']);
const OPTIONAL_DAY1_HAZARDS = Object.freeze(['tornado', 'wind', 'hail']);
const SIGNIFICANT_HAZARDS = new Set(['significantTornado', 'significantWind', 'significantHail']);

export function validateNormalizedSpcRecord(payload, { sourceFile = null } = {}) {
  const product = payload?.normalizedProduct;
  const errors = [];
  const warnings = [];
  if (!product || typeof product !== 'object') errors.push('normalizedProduct is missing');
  if (!product?.hazards || typeof product.hazards !== 'object') errors.push('normalizedProduct.hazards is missing');

  const metadata = deriveMetadata(payload, sourceFile);
  validateMetadata(payload, metadata, errors, warnings);

  const stats = {
    hazardCount: 0,
    contourCount: 0,
    polygonCount: 0,
    ringCount: 0,
    coordinateCount: 0,
    rejectedCoordinateCount: 0,
    bounds: null,
    hazardLevels: {},
    hazardMaxima: {}
  };
  const bounds = { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity };

  for (const [hazard, contours] of Object.entries(product?.hazards ?? {})) {
    if (!Array.isArray(contours)) {
      errors.push(`hazard ${hazard} is not an array`);
      continue;
    }
    if (contours.length) stats.hazardCount += 1;
    stats.contourCount += contours.length;
    const levels = [];

    contours.forEach((contour, contourIndex) => {
      validateHazardValue(hazard, contour?.value, metadata.policyEra, errors, warnings, `${hazard}[${contourIndex}]`);
      levels.push(contour?.value);
      if (!Array.isArray(contour?.polygons)) {
        errors.push(`${hazard}[${contourIndex}].polygons is missing`);
        return;
      }
      stats.polygonCount += contour.polygons.length;
      contour.polygons.forEach((polygon, polygonIndex) => {
        const rings = collectRings(polygon);
        if (!rings.length) errors.push(`${hazard}[${contourIndex}].polygons[${polygonIndex}] has no rings`);
        for (const ring of rings) {
          stats.ringCount += 1;
          if (ring.length < 4) warnings.push(`${hazard}[${contourIndex}] contains a ring with fewer than four coordinates`);
          for (const point of ring) {
            stats.coordinateCount += 1;
            const lon = Number(point?.[0]);
            const lat = Number(point?.[1]);
            if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < ABSOLUTE_LON_RANGE[0] || lon > ABSOLUTE_LON_RANGE[1] || lat < ABSOLUTE_LAT_RANGE[0] || lat > ABSOLUTE_LAT_RANGE[1]) {
              stats.rejectedCoordinateCount += 1;
              continue;
            }
            bounds.minLon = Math.min(bounds.minLon, lon);
            bounds.maxLon = Math.max(bounds.maxLon, lon);
            bounds.minLat = Math.min(bounds.minLat, lat);
            bounds.maxLat = Math.max(bounds.maxLat, lat);
          }
        }
      });
    });

    stats.hazardLevels[hazard] = uniqueSortedLevels(levels);
    stats.hazardMaxima[hazard] = deriveHazardMaximum(hazard, levels);
  }

  if (metadata.forecastDay === 'day1') {
    for (const hazard of REQUIRED_DAY1_HAZARDS) {
      if (!Array.isArray(product?.hazards?.[hazard]) || product.hazards[hazard].length === 0) {
        errors.push(`required Day 1 hazard ${hazard} is missing or empty`);
      }
    }
    for (const hazard of OPTIONAL_DAY1_HAZARDS) {
      if (!Array.isArray(product?.hazards?.[hazard]) || product.hazards[hazard].length === 0) {
        warnings.push(`Day 1 hazard ${hazard} is absent and will be treated as a zero-probability target`);
      }
    }
  }

  if (stats.rejectedCoordinateCount) errors.push(`${stats.rejectedCoordinateCount} invalid longitude/latitude coordinates detected`);
  if (!stats.coordinateCount) errors.push('no polygon coordinates were found');
  if (Number.isFinite(bounds.minLon)) {
    stats.bounds = bounds;
    if (!intersectsEnvelope(bounds, SPC_OPERATIONAL_ENVELOPE)) warnings.push('geometry does not intersect the broad SPC operational envelope');
    if ((bounds.maxLon - bounds.minLon) > 150) warnings.push('geometry longitude span is unusually large');
    if ((bounds.maxLat - bounds.minLat) > 70) warnings.push('geometry latitude span is unusually large');
  }

  return {
    schemaVersion: HISTORICAL_TRAINING_CORPUS_VERSION,
    sourceFile,
    recordId: metadata.recordId,
    valid: errors.length === 0,
    status: errors.length ? 'invalid' : warnings.length ? 'valid_with_warnings' : 'valid',
    metadata,
    stats,
    errors,
    warnings: [...new Set([...(product?.warnings ?? []).map(formatWarning), ...warnings])]
  };
}

export function createTrainingCorpusCatalog(records, { generatedAt = new Date().toISOString() } = {}) {
  const entries = records.map(({ validation, sourceFile }) => ({
    recordId: validation.recordId,
    eventDate: validation.metadata.eventDate,
    sourceFile,
    status: validation.status,
    valid: validation.valid,
    forecastDay: validation.metadata.forecastDay,
    cycle: validation.metadata.cycle,
    issuedAt: validation.metadata.issuedAt,
    validStart: validation.metadata.validStart,
    validEnd: validation.metadata.validEnd,
    sourceFormat: validation.metadata.sourceFormat,
    policyEra: validation.metadata.policyEra,
    hazardCount: validation.stats.hazardCount,
    contourCount: validation.stats.contourCount,
    polygonCount: validation.stats.polygonCount,
    hazardLevels: validation.stats.hazardLevels,
    hazardMaxima: validation.stats.hazardMaxima,
    bounds: validation.stats.bounds,
    warningCount: validation.warnings.length,
    errorCount: validation.errors.length
  })).sort((a, b) => String(a.issuedAt ?? '').localeCompare(String(b.issuedAt ?? '')));
  return {
    schemaVersion: HISTORICAL_TRAINING_CORPUS_VERSION,
    purpose: 'backend-training-corpus',
    generatedAt: new Date(generatedAt).toISOString(),
    summary: {
      recordCount: entries.length,
      eventDateCount: new Set(entries.map(item => item.eventDate).filter(Boolean)).size,
      validCount: entries.filter(item => item.valid).length,
      invalidCount: entries.filter(item => !item.valid).length,
      warningCount: entries.reduce((sum, item) => sum + item.warningCount, 0)
    },
    records: entries
  };
}

export function pairTrainingCorpus({ spcCatalog, era5ByDate = {}, noaaCatalog = { records: [] }, generatedAt = new Date().toISOString() }) {
  const noaaByDate = new Map((noaaCatalog?.records ?? []).map(record => [record.eventDate, record]));
  const grouped = new Map();
  for (const record of spcCatalog?.records ?? []) {
    if (!record.eventDate) continue;
    if (!grouped.has(record.eventDate)) grouped.set(record.eventDate, []);
    grouped.get(record.eventDate).push(record);
  }
  const allDates = new Set([...grouped.keys(), ...Object.keys(era5ByDate ?? {}), ...noaaByDate.keys()]);
  const cases = [...allDates].sort().map(eventDate => {
    const allSpc = (grouped.get(eventDate) ?? []).sort((a, b) => String(a.issuedAt).localeCompare(String(b.issuedAt)));
    const spc = allSpc.filter(record => record.valid);
    const era5 = era5ByDate?.[eventDate] ?? null;
    const noaa = noaaByDate.get(eventDate) ?? null;
    const hasSpc = spc.length > 0;
    const hasEra5 = Boolean(era5);
    const hasNoaa = Boolean(noaa);
    const status = hasSpc && hasEra5 && hasNoaa ? 'complete' : (hasSpc || hasEra5 || hasNoaa) ? 'partial' : 'empty';
    return {
      caseId: `training-${eventDate}`,
      eventDate,
      status,
      completeness: { spc: hasSpc, era5: hasEra5, noaa: hasNoaa },
      spc: {
        discoveredIssuanceCount: allSpc.length,
        issuanceCount: spc.length,
        rejectedIssuanceCount: allSpc.length - spc.length,
        issuances: spc.map(record => ({
          recordId: record.recordId,
          cycle: record.cycle,
          issuedAt: record.issuedAt,
          validStart: record.validStart,
          validEnd: record.validEnd,
          hazardLevels: record.hazardLevels,
          hazardMaxima: record.hazardMaxima,
          sourceFile: record.sourceFile
        }))
      },
      atmosphere: era5,
      outcomes: noaa ? { intensity: noaa.intensity, outcomes: noaa.outcomes, provenance: noaa.provenance } : null,
      provenance: {
        spc: hasSpc ? 'normalized SPC outlook corpus' : null,
        era5: hasEra5 ? 'ERA5-derived summary' : null,
        noaa: hasNoaa ? 'NOAA NCEI Storm Events analog catalog' : null
      }
    };
  });
  return {
    schemaVersion: HISTORICAL_TRAINING_CORPUS_VERSION,
    purpose: 'paired-backend-training-cases',
    generatedAt: new Date(generatedAt).toISOString(),
    summary: {
      caseCount: cases.length,
      completeCount: cases.filter(item => item.status === 'complete').length,
      partialCount: cases.filter(item => item.status === 'partial').length,
      spcCaseCount: cases.filter(item => item.completeness.spc).length,
      era5CaseCount: cases.filter(item => item.completeness.era5).length,
      noaaCaseCount: cases.filter(item => item.completeness.noaa).length
    },
    cases
  };
}

function validateMetadata(payload, metadata, errors, warnings) {
  for (const field of ['issuedAt', 'validStart', 'validEnd']) {
    if (!metadata[field] || Number.isNaN(Date.parse(metadata[field]))) errors.push(`${field} is missing or invalid`);
  }
  if (!/^day[123]$/.test(String(metadata.forecastDay))) errors.push(`unsupported forecastDay: ${metadata.forecastDay}`);
  if (metadata.issuedAt && metadata.validStart && Date.parse(metadata.validStart) < Date.parse(metadata.issuedAt) - 60_000) warnings.push('validStart precedes issuedAt');
  if (metadata.validStart && metadata.validEnd && Date.parse(metadata.validEnd) <= Date.parse(metadata.validStart)) errors.push('validEnd must be after validStart');
  if (metadata.issuedAt && metadata.cycle && String(metadata.issuedAt).slice(11, 16).replace(':', '') !== metadata.cycle) errors.push('issuedAt does not match record cycle');
  if (metadata.eventDate && metadata.issuedAt && String(metadata.issuedAt).slice(0, 10) !== metadata.eventDate) errors.push('issuedAt date does not match record event date');

  const sources = [payload?.parsedProduct, payload?.originalProduct].filter(Boolean);
  for (const source of sources) {
    if (source.forecastDay && source.forecastDay !== metadata.forecastDay) errors.push('forecastDay differs between source layers');
    for (const field of ['issuedAt', 'validStart', 'validEnd']) {
      if (source[field] && metadata[field] && Date.parse(source[field]) !== Date.parse(metadata[field])) errors.push(`${field} differs between source layers`);
    }
  }
}

function validateHazardValue(hazard, value, policyEra, errors, warnings, path) {
  if (PROBABILITY_LEVELS[hazard]) {
    const number = Number(value);
    if (!PROBABILITY_LEVELS[hazard].has(number)) errors.push(`${path} has unsupported probability ${value}`);
    return;
  }
  if (hazard === 'categorical') {
    const allowed = new Set(['TSTM', 'MRGL', 'SLGT', 'ENH', 'MDT', 'HIGH']);
    if (!allowed.has(String(value))) errors.push(`${path} has unsupported categorical value ${value}`);
    if (['MRGL', 'ENH'].includes(String(value)) && String(policyEra ?? '').includes('pre-2014')) warnings.push(`${path} uses a post-2014 category in a pre-2014 policy era`);
    return;
  }
  if (SIGNIFICANT_HAZARDS.has(hazard) && value !== 'SIGN') errors.push(`${path} must use SIGN`);
}

function uniqueSortedLevels(levels) {
  return [...new Set(levels.map(value => typeof value === 'number' ? Number(value) : value))].sort((a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));
}
function deriveHazardMaximum(hazard, levels) {
  if (!levels.length) return null;
  if (PROBABILITY_LEVELS[hazard]) return Math.max(...levels.map(Number).filter(Number.isFinite));
  if (hazard === 'categorical') {
    const order = ['TSTM', 'MRGL', 'SLGT', 'ENH', 'MDT', 'HIGH'];
    return levels.map(String).sort((a, b) => order.indexOf(a) - order.indexOf(b)).at(-1) ?? null;
  }
  if (SIGNIFICANT_HAZARDS.has(hazard)) return levels.includes('SIGN') ? 'SIGN' : null;
  return levels.at(-1) ?? null;
}
function collectRings(polygon) {
  const rings = [];
  if (Array.isArray(polygon?.outer)) rings.push(polygon.outer);
  for (const hole of polygon?.holes ?? []) if (Array.isArray(hole)) rings.push(hole);
  if (Array.isArray(polygon?.coordinates)) {
    if (Array.isArray(polygon.coordinates[0]?.[0]?.[0])) {
      for (const part of polygon.coordinates) for (const ring of part) if (Array.isArray(ring)) rings.push(ring);
    } else if (Array.isArray(polygon.coordinates[0]?.[0])) {
      for (const ring of polygon.coordinates) if (Array.isArray(ring)) rings.push(ring);
    }
  }
  return rings;
}
function intersectsEnvelope(a, b) { return a.maxLon >= b.minLon && a.minLon <= b.maxLon && a.maxLat >= b.minLat && a.minLat <= b.maxLat; }
function deriveMetadata(payload, sourceFile) {
  const product = payload?.normalizedProduct ?? {};
  const original = payload?.originalProduct ?? {};
  const issuedAt = product.issuedAt ?? original.issuedAt ?? null;
  const filename = String(sourceFile ?? '').match(/day([123])_(\d{8})_(\d{4})\.json$/i);
  const dateToken = filename?.[2] ?? (String(issuedAt ?? original.issueDate ?? '').slice(0, 10).replaceAll('-', '') || 'unknown');
  const eventDate = /^\d{8}$/.test(dateToken) ? `${dateToken.slice(0, 4)}-${dateToken.slice(4, 6)}-${dateToken.slice(6, 8)}` : null;
  const cycle = filename?.[3] ?? (issuedAt ? String(issuedAt).slice(11, 16).replace(':', '') : original.cycle ?? 'unknown');
  const forecastDay = product.forecastDay ?? original.forecastDay ?? (filename ? `day${filename[1]}` : 'unknown');
  return {
    recordId: `${dateToken}-${forecastDay}-${cycle}`,
    eventDate,
    cycle,
    forecastDay,
    issuedAt,
    validStart: product.validStart ?? original.validStart ?? null,
    validEnd: product.validEnd ?? original.validEnd ?? null,
    sourceFormat: product.sourceFormat ?? payload?.parsedProduct?.format ?? original.format ?? null,
    policyEra: product.policyEra ?? null,
    sourceFile
  };
}
function formatWarning(value) { return typeof value === 'string' ? value : value?.message ?? JSON.stringify(value); }

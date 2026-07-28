export const HISTORICAL_OUTLOOK_DATASET_VERSION = '2.34.4';
export const HISTORICAL_COORDINATE_SPACE = 'historical-geographic';
export const FICTIONAL_COORDINATE_SPACE = 'fictional-world';

export function createHistoricalOutlookCase({ sourceFile = null, originalProduct = null, parsedProduct = null, normalizedProduct, rasterizedOutlook, atmosphere = null, observations = null } = {}) {
  if (!normalizedProduct?.hazards) throw new TypeError('normalizedProduct.hazards is required');
  if (!rasterizedOutlook?.grid || !Array.isArray(rasterizedOutlook?.cells)) throw new TypeError('rasterizedOutlook is required');
  assertCoordinateSpace(rasterizedOutlook.coordinateSpace ?? HISTORICAL_COORDINATE_SPACE, HISTORICAL_COORDINATE_SPACE);

  const forecastDay = normalizedProduct.forecastDay ?? originalProduct?.forecastDay ?? null;
  const issuedAt = normalizedProduct.issuedAt ?? originalProduct?.issuedAt ?? null;
  const caseDate = String(issuedAt ?? originalProduct?.issueDate ?? '').slice(0, 10).replaceAll('-', '');
  const cycle = issuedAt ? String(issuedAt).slice(11, 16).replace(':', '') : (originalProduct?.cycle ?? null);
  const caseId = [caseDate || 'unknown', forecastDay || 'unknown', cycle || 'unknown'].join('-');
  const available = Object.freeze({ outlook: true, atmosphere: Boolean(atmosphere), observations: Boolean(observations) });

  return deepFreeze({
    schemaVersion: HISTORICAL_OUTLOOK_DATASET_VERSION,
    caseId,
    coordinateSpace: HISTORICAL_COORDINATE_SPACE,
    sourceFile,
    metadata: {
      forecastDay,
      issueDate: originalProduct?.issueDate ?? (caseDate || null),
      cycle,
      issuedAt,
      validStart: normalizedProduct.validStart ?? originalProduct?.validStart ?? null,
      validEnd: normalizedProduct.validEnd ?? originalProduct?.validEnd ?? null,
      productCode: originalProduct?.productCode ?? parsedProduct?.productCode ?? null,
      sourceAgency: 'NOAA/NWS Storm Prediction Center'
    },
    completeness: available.atmosphere && available.observations ? 'complete' : available.atmosphere ? 'outlook-atmosphere' : available.observations ? 'outlook-observations' : 'outlook-only',
    available,
    outlook: {
      normalizedProduct,
      rasterizedOutlook: { ...rasterizedOutlook, coordinateSpace: HISTORICAL_COORDINATE_SPACE }
    },
    atmosphere,
    observations,
    diagnostics: buildCaseDiagnostics(normalizedProduct, rasterizedOutlook)
  });
}

export function createHistoricalOutlookCatalog(cases = [], { generatedAt = new Date().toISOString() } = {}) {
  const ordered = [...cases].sort((a, b) => String(a.metadata?.issuedAt ?? '').localeCompare(String(b.metadata?.issuedAt ?? '')));
  const entries = ordered.map(item => ({
    caseId: item.caseId,
    coordinateSpace: item.coordinateSpace,
    forecastDay: item.metadata.forecastDay,
    issueDate: item.metadata.issueDate,
    cycle: item.metadata.cycle,
    issuedAt: item.metadata.issuedAt,
    validStart: item.metadata.validStart,
    validEnd: item.metadata.validEnd,
    completeness: item.completeness,
    available: item.available,
    contourCount: item.diagnostics.contourCount,
    populatedCellCount: item.diagnostics.populatedCellCount,
    gridWidth: item.outlook.rasterizedOutlook.grid.width,
    gridHeight: item.outlook.rasterizedOutlook.grid.height,
    fileName: `${item.caseId}.json`
  }));
  return deepFreeze({
    schemaVersion: HISTORICAL_OUTLOOK_DATASET_VERSION,
    coordinateSpace: HISTORICAL_COORDINATE_SPACE,
    generatedAt: new Date(generatedAt).toISOString(),
    summary: summarizeEntries(entries),
    cases: entries
  });
}

export function assertCoordinateSpace(actual, expected) {
  if (actual !== expected) throw new Error(`Coordinate-space mismatch: expected ${expected}, received ${actual ?? 'unspecified'}`);
  return true;
}

function buildCaseDiagnostics(normalizedProduct, rasterizedOutlook) {
  const hazardCounts = {};
  for (const [hazard, contours] of Object.entries(normalizedProduct.hazards ?? {})) hazardCounts[hazard] = contours.length;
  return {
    contourCount: Object.values(hazardCounts).reduce((sum, value) => sum + value, 0),
    hazardCounts,
    populatedCellCount: rasterizedOutlook.diagnostics?.populatedCellCount ?? rasterizedOutlook.cells.length,
    totalCellCount: rasterizedOutlook.diagnostics?.totalCellCount ?? rasterizedOutlook.grid.width * rasterizedOutlook.grid.height,
    warningCount: normalizedProduct.diagnostics?.warningCount ?? normalizedProduct.warnings?.length ?? 0,
    infoCount: normalizedProduct.diagnostics?.infoCount ?? normalizedProduct.information?.length ?? 0
  };
}
function summarizeEntries(entries) {
  const byForecastDay = {};
  const byCompleteness = {};
  for (const item of entries) {
    byForecastDay[item.forecastDay ?? 'unknown'] = (byForecastDay[item.forecastDay ?? 'unknown'] ?? 0) + 1;
    byCompleteness[item.completeness] = (byCompleteness[item.completeness] ?? 0) + 1;
  }
  return { caseCount: entries.length, byForecastDay, byCompleteness };
}
function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) value.forEach(deepFreeze); else Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

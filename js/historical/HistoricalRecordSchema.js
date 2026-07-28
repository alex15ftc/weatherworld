export const HISTORICAL_SCHEMA_VERSION = '2.34.0';

export const FORECAST_DAYS = Object.freeze(['day1', 'day2', 'day3']);
export const HAZARDS = Object.freeze(['categorical', 'tornado', 'hail', 'wind']);

export function createHistoricalForecastRecord(input) {
  const issuance = normalizeIssuance(input?.issuance);
  return Object.freeze({
    schemaVersion: HISTORICAL_SCHEMA_VERSION,
    recordId: requiredString(input?.recordId, 'recordId'),
    eventId: requiredString(input?.eventId, 'eventId'),
    eventWindow: normalizeEventWindow(input?.eventWindow),
    issuance,
    environmentAtIssuance: freezeCopy(input?.environmentAtIssuance ?? {}),
    spcForecast: normalizeSpcForecast(input?.spcForecast),
    observations: freezeCopy(input?.observations ?? {}),
    provenance: normalizeProvenance(input?.provenance)
  });
}

export function normalizeIssuance(value = {}) {
  const forecastDay = requiredEnum(value.forecastDay, FORECAST_DAYS, 'issuance.forecastDay');
  const issuedAt = validDate(value.issuedAt, 'issuance.issuedAt');
  const validStart = validDate(value.validStart, 'issuance.validStart');
  const validEnd = validDate(value.validEnd, 'issuance.validEnd');
  if (validEnd <= validStart) throw new RangeError('issuance.validEnd must be after validStart');
  return Object.freeze({
    productId: requiredString(value.productId, 'issuance.productId'),
    forecastDay,
    issuedAt: issuedAt.toISOString(),
    validStart: validStart.toISOString(),
    validEnd: validEnd.toISOString(),
    cycle: String(value.cycle ?? issuedAt.toISOString().slice(11, 16).replace(':', '') + 'Z'),
    leadHours: Number.isFinite(Number(value.leadHours)) ? Number(value.leadHours) : hoursBetween(issuedAt, validStart)
  });
}

export function normalizeSpcForecast(value = {}) {
  return Object.freeze({
    originalProduct: freezeCopy(value.originalProduct ?? {}),
    normalizedProduct: Object.freeze({
      categorical: freezeCopy(value.normalizedProduct?.categorical ?? null),
      tornado: freezeCopy(value.normalizedProduct?.tornado ?? null),
      hail: freezeCopy(value.normalizedProduct?.hail ?? null),
      wind: freezeCopy(value.normalizedProduct?.wind ?? null),
      significantTornado: freezeCopy(value.normalizedProduct?.significantTornado ?? null),
      significantHail: freezeCopy(value.normalizedProduct?.significantHail ?? null),
      significantWind: freezeCopy(value.normalizedProduct?.significantWind ?? null)
    }),
    normalizationVersion: String(value.normalizationVersion ?? HISTORICAL_SCHEMA_VERSION)
  });
}

export function normalizeProvenance(value = {}) {
  return Object.freeze({
    spc: freezeCopy(value.spc ?? {}),
    environment: freezeCopy(value.environment ?? {}),
    observations: freezeCopy(value.observations ?? {}),
    pipeline: Object.freeze({
      schemaVersion: HISTORICAL_SCHEMA_VERSION,
      codeVersion: String(value.pipeline?.codeVersion ?? HISTORICAL_SCHEMA_VERSION),
      builtAt: String(value.pipeline?.builtAt ?? new Date(0).toISOString()),
      checksum: value.pipeline?.checksum == null ? null : String(value.pipeline.checksum)
    })
  });
}

function normalizeEventWindow(value = {}) {
  const start = validDate(value.start, 'eventWindow.start');
  const end = validDate(value.end, 'eventWindow.end');
  if (end <= start) throw new RangeError('eventWindow.end must be after start');
  return Object.freeze({ start: start.toISOString(), end: end.toISOString() });
}
function requiredString(value, path) { if (!String(value ?? '').trim()) throw new TypeError(`${path} is required`); return String(value); }
function requiredEnum(value, allowed, path) { if (!allowed.includes(value)) throw new TypeError(`${path} must be one of ${allowed.join(', ')}`); return value; }
function validDate(value, path) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new TypeError(`${path} must be a valid date`); return date; }
function hoursBetween(a, b) { return Math.round(((b - a) / 36e5) * 100) / 100; }
function freezeCopy(value) {
  if (value == null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) return Object.freeze(Array.from(value));
  if (Array.isArray(value)) return Object.freeze(value.map(freezeCopy));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeCopy(item)])));
}

export const ATMOSPHERIC_RECORD_SCHEMA_VERSION = '2.36.1';

export function createAtmosphericRecord({ eventDate, source = 'ERA5', validTimes = [], surface = {}, levels = {}, derived = {}, provenance = {} }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) throw new TypeError(`Invalid eventDate: ${eventDate}`);
  return {
    schemaVersion: ATMOSPHERIC_RECORD_SCHEMA_VERSION,
    eventDate,
    source,
    validTimes,
    surface,
    levels: {
      1000: levels[1000] ?? levels['1000'] ?? {},
      925: levels[925] ?? levels['925'] ?? {},
      850: levels[850] ?? levels['850'] ?? {},
      700: levels[700] ?? levels['700'] ?? {},
      500: levels[500] ?? levels['500'] ?? {},
      300: levels[300] ?? levels['300'] ?? {},
      250: levels[250] ?? levels['250'] ?? {}
    },
    derived,
    provenance: {
      dataset: provenance.dataset ?? 'reanalysis-era5',
      acquiredAt: provenance.acquiredAt ?? null,
      pressureFileSha256: provenance.pressureFileSha256 ?? null,
      surfaceFileSha256: provenance.surfaceFileSha256 ?? null,
      extractorVersion: provenance.extractorVersion ?? ATMOSPHERIC_RECORD_SCHEMA_VERSION
    }
  };
}

export function validateAtmosphericRecord(record) {
  const errors = [];
  if (record?.schemaVersion !== ATMOSPHERIC_RECORD_SCHEMA_VERSION) errors.push('schemaVersion mismatch');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record?.eventDate ?? '')) errors.push('invalid eventDate');
  if (!record?.surface || typeof record.surface !== 'object') errors.push('surface is required');
  if (!record?.levels || typeof record.levels !== 'object') errors.push('levels are required');
  if (!record?.derived || typeof record.derived !== 'object') errors.push('derived is required');
  return { valid: errors.length === 0, errors };
}

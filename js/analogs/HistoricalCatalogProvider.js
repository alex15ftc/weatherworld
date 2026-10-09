import { NOAA_HISTORICAL_ANALOG_CATALOG } from './generatedNoaaHistoricalAnalogCatalog.js';
import { HISTORICAL_ANALOG_CATALOG as LEGACY_ERA5_CATALOG } from './generatedHistoricalAnalogCatalog.js';

export function historicalCatalog() {
  if (isValidatedNoaaCatalog(NOAA_HISTORICAL_ANALOG_CATALOG)) {
    return {
      records: NOAA_HISTORICAL_ANALOG_CATALOG,
      provider: 'NOAA NCEI NARR + IGRA + Storm Events',
      providerId: 'noaa-narr-igra',
      legacyFallback: false
    };
  }
  return {
    records: LEGACY_ERA5_CATALOG,
    provider: 'NOAA Storm Events + legacy ERA5-derived environment',
    providerId: 'legacy-era5',
    legacyFallback: true
  };
}

export function isValidatedNoaaCatalog(records) {
  return Array.isArray(records)
    && records.length >= 25
    && records.every(record =>
      record?.provenance?.environment === 'NOAA NCEI NARR'
      && record?.provenance?.soundings === 'NOAA NCEI IGRA 2 / NARR hybrid'
      && Array.isArray(record?.soundingSequence)
      && record.soundingSequence.length === 3
    );
}

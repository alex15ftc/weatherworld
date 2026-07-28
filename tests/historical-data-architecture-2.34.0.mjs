import assert from 'node:assert/strict';
import { selectForecastAnalogs } from '../js/analogs/ForecastAnalogSelector.js';
import { createHistoricalForecastRecord } from '../js/historical/HistoricalRecordSchema.js';
import { buildAnalogEnsemble } from '../js/forecast/AnalogEnsembleEngine.js';

const forbidden = () => { throw new Error('forecast selector accessed an outcome label'); };
const record = {
  analogId: 'test-analog',
  eventDate: '2020-05-20',
  season: 'spring',
  pattern: {
    family: 'dryline_cyclone', troughAmplitude:.7, troughTilt:.4,
    lowLevelJetStrength:.8, moistureQuality:.9, capStrength:.6,
    forcingTiming:.7, discreteBias:.8,
    environment:{ shear06Ms:30 }, diagnostics:{ cape95Jkg:2500 }
  },
  provenance:{ environment:'ERA5-derived summary' }
};
Object.defineProperties(record, {
  intensity:{ enumerable:true, get:forbidden },
  outcomes:{ enumerable:true, get:forbidden },
  observations:{ enumerable:true, get:forbidden }
});
const matches = selectForecastAnalogs([record], record.pattern, { family:'dryline_cyclone' });
assert.equal(matches.length, 1);
assert.equal(matches[0].selectionMode, 'forecast-atmosphere-only');
assert.equal('intensity' in matches[0], false);
assert.equal('outcomes' in matches[0], false);
assert.deepEqual(matches[0].provenance, { environment:'ERA5-derived summary' });

const historical = createHistoricalForecastRecord({
  recordId:'day1-20200520-1300', eventId:'event-20200520',
  eventWindow:{ start:'2020-05-20T12:00:00Z', end:'2020-05-21T12:00:00Z' },
  issuance:{ productId:'day1-20200520-1300', forecastDay:'day1', issuedAt:'2020-05-20T13:00:00Z', validStart:'2020-05-20T12:00:00Z', validEnd:'2020-05-21T12:00:00Z' },
  environmentAtIssuance:{ pattern:record.pattern },
  spcForecast:{ originalProduct:{ format:'shapefile' }, normalizedProduct:{ tornado:{ probabilities:[2,5,10] } }, normalizationVersion:'2.34.0' },
  observations:{ reports:[] },
  provenance:{ spc:{ archive:'SPC' }, environment:{ dataset:'ERA5' }, observations:{ dataset:'Storm Events' }, pipeline:{ codeVersion:'2.34.0' } }
});
assert.equal(historical.issuance.forecastDay, 'day1');
assert.equal(historical.issuance.leadHours, -1);
assert.ok(historical.spcForecast.originalProduct);
assert.ok(historical.spcForecast.normalizedProduct.tornado);
assert.throws(() => createHistoricalForecastRecord({ ...historical, issuance:{ ...historical.issuance, validEnd:historical.issuance.validStart } }), /after validStart/);

const analogGuidance = {
  family:'dryline_cyclone', moistureReturn:.8, clearing:.7, capPersistence:.5,
  frontalCoherence:.8, discreteBias:.7, historicalInfluence:.3,
  historicalIntensityScore:100,
  historicalResiduals:[{ analogId:'x', weight:1, pattern:{ moistureQuality:0, capStrength:0, forcingTiming:0, discreteBias:0 }, intensityResidual:9999 }]
};
const a = buildAnalogEnsemble({ seed:42, intensity:.7, analogGuidance }, 'day1', 10);
const b = buildAnalogEnsemble({ seed:42, intensity:.7, analogGuidance:{ ...analogGuidance, historicalIntensityScore:0, historicalResiduals:[{ ...analogGuidance.historicalResiduals[0], intensityResidual:-9999 }] } }, 'day1', 10);
assert.deepEqual(a.members, b.members, 'historical outcomes must not influence forecast members');
assert.equal(a.causality.outcomeLabelsUsed, false);

console.log('2.34.0 historical data architecture and no-outcome-leakage checks passed');

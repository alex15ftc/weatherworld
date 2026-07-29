import assert from 'node:assert/strict';
import { parseSpcLatLonText, normalizeSpcOutlook, SPC_PARSER_VERSION } from '../js/training/spc/SPCOutlookParser.js';

const fixture = `PROBABILISTIC OUTLOOK POINTS DAY 1
... TORNADO ...
0.02 35009700 35009800 36009800 36009700 35009700
0.02 35009700 35009800 36009800 36009700 35009700
&&
CATEGORICAL OUTLOOK POINTS DAY 1
... CATEGORICAL ...
MRGL 34009900 34010000 37010000 37009900 34009900
&&`;

const parsed = parseSpcLatLonText(fixture, {
  forecastDay: 'day1',
  issuedAt: '2024-05-06T16:30:00.000Z',
  validStart: '2024-05-06T16:30:00.000Z',
  validEnd: '2024-05-07T12:00:00.000Z'
});
const normalized = normalizeSpcOutlook(parsed);

assert.equal(SPC_PARSER_VERSION, '2.34.2.6');
assert.equal(parsed.warnings.length, 0);
assert.equal(parsed.contours.length, 3);
assert.equal(parsed.contours[0].id, 'DAY1_202405061630_TORNADO_02_01');
assert.equal(parsed.contours[1].id, 'DAY1_202405061630_TORNADO_02_02');
assert.notEqual(parsed.contours[0].id, parsed.contours[1].id);

const polygon = parsed.contours[0].polygons[0];
assert.deepEqual(polygon.bbox, { minLon: -98, maxLon: -97, minLat: 35, maxLat: 36 });
assert.ok(polygon.areaKm2 > 9000 && polygon.areaKm2 < 11000);
assert.deepEqual(polygon.outer[0], polygon.outer.at(-1));
assert.equal(polygon.validation.valid, true);
assert.equal(polygon.validation.selfIntersections, 0);
assert.ok(signedArea(polygon.outer) > 0, 'outer ring must be counter-clockwise');
assert.equal(normalized.diagnostics.contourCount, 3);

const malformed = `PROBABILISTIC OUTLOOK POINTS DAY 1
... HAIL ...
0.15 35009700 36009800 35009800 36009700 35009700
&&`;
const rejected = parseSpcLatLonText(malformed, { forecastDay: 'day1', issuedAt: '2024-05-06T16:30:00.000Z' });
assert.equal(rejected.contours.length, 0);
assert.equal(rejected.warnings[0].code, 'discarded-outline-fragment');
assert.equal(rejected.warnings[0].severity, 'info');

function signedArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return area / 2;
}

console.log('2.34.2.5 SPC geometry optimization: passed');

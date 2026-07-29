import assert from 'node:assert/strict';
import { parseSpcLatLonText, normalizeSpcOutlook } from '../js/training/spc/SPCOutlookParser.js';

// Representative excerpts copied from the official 2024-05-06 1630 UTC
// KWNSPTSDY1 compact outline product. This format does not use LAT...LON.
const fixture = `DAY 1 CONVECTIVE OUTLOOK AREAL OUTLINE
PROBABILISTIC OUTLOOK POINTS DAY 1
... TORNADO ...
0.02 31230083 33390039 35820047 37950072 31230083
0.02 34278499 34598688 35718719 36788656 34278499
0.05 33349965 33669997 34190013 34820007 33349965
0.10 35039459 34459566 33899725 33869788 35039459
0.15 38429824 38349615 37729548 37159526 38429824
0.30 34779775 34789855 35309888 36789868 34779775
SIGN 34489566 33929720 33869800 33969898 34489566
&&
... HAIL ...
0.05 29340213 29680191 31290125 33080064 29340213
0.05 33238290 33968879 35198852 36298724 33238290
0.15 42669660 40129528 38339495 35849523 42669660
0.30 36879985 38710018 40269988 40889883 36879985
0.45 34399903 34519959 37209917 38069890 34399903
SIGN 33379965 34430049 39380090 40730083 33379965
&&
... WIND ...
0.05 29590192 33130064 36440104 39920131 29590192
0.15 42049222 40949026 38909007 36669149 42049222
0.30 34279841 34279866 37629866 37629841 34279841
0.45 38369488 38029449 37279451 36309467 38369488
SIGN 39799169 39789216 36899390 36899366 39799169
&&
CATEGORICAL OUTLOOK POINTS DAY 1
... CATEGORICAL ...
HIGH 37499644 36989626 35499667 34929706 37499644
MDT 37239917 38079890 38419828 38359488 37239917
ENH 35079978 36879985 38700018 40269990 35079978
SLGT 43000079 43000168 45870168 45870079 43000079
MRGL 29600195 30540156 33120064 36460104 29600195
TSTM 49479576 48359468 47619386 47079300 49479576
99999999
29378050 29218079 28598104 28018138 29378050
99999999
29290249 30890173 32730112 33200102 29290249
&&`;

const parsed = parseSpcLatLonText(fixture, {
  forecastDay: 'day1',
  issuedAt: '2024-05-06T16:30:00.000Z',
  validStart: '2024-05-06T16:30:00.000Z',
  validEnd: '2024-05-07T12:00:00.000Z'
});
const normalized = normalizeSpcOutlook(parsed);

assert.equal(parsed.format, 'spc-outline-text');
assert.equal(parsed.warnings.length, 0);
assert.equal(parsed.contours.length, 24);
assert.equal(normalized.hazards.tornado.length, 6);
assert.equal(normalized.hazards.significantTornado.length, 1);
assert.equal(normalized.hazards.hail.length, 5);
assert.equal(normalized.hazards.significantHail.length, 1);
assert.equal(normalized.hazards.wind.length, 4);
assert.equal(normalized.hazards.significantWind.length, 1);
assert.equal(normalized.hazards.categorical.length, 6);
assert.deepEqual(normalized.hazards.categorical.map(item => item.value), ['TSTM', 'MRGL', 'SLGT', 'ENH', 'MDT', 'HIGH']);
const tstm = normalized.hazards.categorical.find(item => item.value === 'TSTM');
assert.equal(tstm.polygons.length, 3);
assert.deepEqual(tstm.polygons[0].outer[0], tstm.polygons[0].outer.at(-1));
assert.equal(normalized.policyEra, '2015-present');

console.log('2.34.2.4 SPC compact outline parsing: passed');

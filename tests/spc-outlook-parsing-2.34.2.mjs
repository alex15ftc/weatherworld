import assert from 'node:assert/strict';
import { inferSpcPolicyEra, mergeParsedSpcProducts, normalizeSpcOutlook, parseSpcKml, parseSpcLatLonText } from '../js/historical/spc/SPCOutlookParser.js';

const categoricalKml = `<?xml version="1.0"?><kml><Document>
<Placemark><name>SLGT</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-101,32 -95,32 -95,38 -101,38 -101,32</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>ENH</name><MultiGeometry><Polygon><outerBoundaryIs><LinearRing><coordinates>-99,33 -96,33 -96,36 -99,36 -99,33</coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>-98,34 -97,34 -97,35 -98,35 -98,34</coordinates></LinearRing></innerBoundaryIs></Polygon></MultiGeometry></Placemark>
</Document></kml>`;
const categorical = parseSpcKml(categoricalKml, { forecastDay: 'day1', issuedAt: '2024-05-20T13:00:00Z' });
assert.equal(categorical.contours.length, 2);
assert.equal(categorical.contours[0].hazardType, 'categorical');
assert.equal(categorical.contours[1].value, 'ENH');
assert.equal(categorical.contours[1].polygons[0].holes.length, 1);
assert.ok(Object.isFrozen(categorical));

const tornadoKml = `<kml><Document>
<Placemark><name>5%</name><ExtendedData><Data name="HAZARD"><value>tornado</value></Data></ExtendedData><Polygon><outerBoundaryIs><LinearRing><coordinates>-100,33 -97,33 -97,36 -100,36</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>SIGN</name><ExtendedData><Data name="HAZARD"><value>tornado</value></Data></ExtendedData><Polygon><outerBoundaryIs><LinearRing><coordinates>-99,34 -98,34 -98,35 -99,35</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`;
const tornado = parseSpcKml(tornadoKml, { hazardType: 'tornado' });
assert.equal(tornado.contours[0].value, 0.05);
assert.equal(tornado.contours[1].hazardType, 'significantTornado');
assert.equal(tornado.contours[0].polygons[0].outer.length, 5, 'open rings should be closed');

const text = `TORNADO PROBABILITIES\n5%\nLAT...LON 35009700 36009800 35509900\n`;
const textParsed = parseSpcLatLonText(text, { hazardType: 'tornado', issuedAt: '2013-05-20T13:00:00Z' });
assert.equal(textParsed.contours.length, 1);
assert.equal(textParsed.contours[0].value, 0.05);
assert.deepEqual(textParsed.contours[0].polygons[0].outer[0], [-97, 35]);

const merged = mergeParsedSpcProducts([categorical, tornado, tornado]);
assert.equal(merged.contours.length, 4, 'duplicate merged contours should collapse');
assert.ok(merged.warnings.some(warning => warning.code === 'duplicate-contour'));
const normalized = normalizeSpcOutlook(merged);
assert.equal(normalized.hazards.categorical.length, 2);
assert.equal(normalized.hazards.tornado.length, 1);
assert.equal(normalized.hazards.significantTornado.length, 1);
assert.equal(normalized.policyEra, '2015-present');
assert.equal(inferSpcPolicyEra('2010-04-22T12:00:00Z'), '2006-2014');
assert.equal(inferSpcPolicyEra(null), 'unknown');

const malformed = parseSpcKml('<kml><Placemark><name>SLGT</name></Placemark></kml>');
assert.equal(malformed.contours.length, 0);
assert.ok(malformed.warnings.some(warning => warning.code === 'missing-geometry'));
console.log('2.34.2 SPC outlook parsing checks passed');

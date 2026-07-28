import assert from 'node:assert/strict';
import {
  buildSpcArchiveYearUrl,
  createSpcAcquisitionManifest,
  extractSpcArtifactLinks,
  extractSpcProductMetadata,
  findDuplicateSpcProducts,
  listMissingRequestedDates,
  parseSpcArchiveListing
} from '../js/historical/spc/SPCOutlookArchive.js';

const listing = `
<a href="day1otlk_20240520_1300.html">Day 1</a>
<a href="day1otlk_20240520_1300.html">duplicate link</a>
<a href="day2otlk_20240520_1730.html">Day 2</a>
<a href="day3otlk_20240521_0730.html">Day 3</a>`;
const entries = parseSpcArchiveListing(listing, { year: 2024 });
assert.equal(entries.length, 3, 'duplicate index links should collapse to one issuance');
assert.equal(entries[0].identity, 'day1:20240520:1300');
assert.equal(entries[0].url, `${buildSpcArchiveYearUrl(2024)}day1otlk_20240520_1300.html`);

const page = `
<html><body>
<a href="day1otlk_20240520_1300-shp.zip">shapefile</a>
<a href="KWNSPTSDY1_202405201300.txt">text</a>
<a href="day1otlk_20240520_1300.kml">kml</a>
<a href="javascript:void(0)">ignore</a>
<pre>
SPC AC 201245
Day 1 Convective Outlook
Valid 201300Z - 211200Z
</pre>
</body></html>`;
const artifacts = extractSpcArtifactLinks(page, entries[0].url);
assert.deepEqual(artifacts.map(item => item.type).sort(), ['kml', 'shapefile', 'text']);
assert.ok(artifacts.every(item => item.url.startsWith('https://www.spc.noaa.gov/products/outlook/archive/2024/')));

const metadata = extractSpcProductMetadata(page, entries[0]);
assert.equal(metadata.issuedAt, '2024-05-20T13:00:00.000Z');
assert.equal(metadata.validStart, '2024-05-20T13:00:00.000Z');
assert.equal(metadata.validEnd, '2024-05-21T12:00:00.000Z');
assert.equal(metadata.productCode, '201245');

const missing = listMissingRequestedDates(entries, { startDate: '2024-05-20', endDate: '2024-05-21', forecastDays: ['day1', 'day2'] });
assert.deepEqual(missing, [
  { forecastDay: 'day1', issueDate: '20240521', reason: 'no-archive-entry' },
  { forecastDay: 'day2', issueDate: '20240521', reason: 'no-archive-entry' }
]);
const duplicateRows = [
  { ...entries[0], sourceUrl: 'https://example.test/a' },
  { ...entries[0], sourceUrl: 'https://example.test/b' }
];
const duplicates = findDuplicateSpcProducts(duplicateRows);
assert.equal(duplicates.length, 1);
assert.equal(duplicates[0].count, 2);

const manifest = createSpcAcquisitionManifest({
  requested: { startDate: '2024-05-20', endDate: '2024-05-21', forecastDays: ['day1', 'day2'] },
  products: [{ ...entries[0], issuedAt: metadata.issuedAt, validStart: metadata.validStart, validEnd: metadata.validEnd, artifacts: [
    { type: 'html', sha256: 'a'.repeat(64), byteLength: 10 },
    { type: 'text', sha256: 'b'.repeat(64), byteLength: 20 }
  ] }],
  missing,
  duplicates,
  generatedAt: '2024-05-22T00:00:00Z'
});
assert.equal(manifest.schemaVersion, '2.34.1');
assert.equal(manifest.summary.productCount, 1);
assert.equal(manifest.summary.artifactCount, 2);
assert.equal(manifest.summary.missingCount, 2);
assert.ok(Object.isFrozen(manifest.products));

console.log('2.34.1 SPC outlook acquisition checks passed');

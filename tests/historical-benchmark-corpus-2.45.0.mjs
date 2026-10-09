import assert from 'node:assert/strict';
import fs from 'node:fs';
const corpus=JSON.parse(fs.readFileSync(new URL('../calibration/cases/benchmark-corpus-v1.json',import.meta.url),'utf8'));
assert.equal(corpus.schemaVersion,2);
assert.equal(corpus.cases.length,30);
assert.equal(corpus.cases.filter(c=>c.status==='active').length,12);
assert.equal(corpus.cases.filter(c=>c.status==='reference-only').length,18);
assert.ok(corpus.cases.every(c=>c.provenance?.kind));
console.log('2.45.0 historical benchmark corpus regression: PASS');

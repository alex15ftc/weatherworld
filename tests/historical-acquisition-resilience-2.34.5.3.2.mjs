import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchWithRetry } from '../js/training/spc/SPCFetchClient.js';

const source = await readFile(new URL('../scripts/fetch-spc-outlooks.mjs', import.meta.url), 'utf8');
assert.match(source, /OPTIONAL_ARTIFACT_UNAVAILABLE/);
assert.match(source, /status: 'unavailable'/);
assert.match(source, /products\.length === 0/);
assert.match(source, /failedProducts/);
assert.match(source, /isRequiredArtifact/);

let calls404 = 0;
await assert.rejects(() => fetchWithRetry('https://example.invalid/missing', {
  retries: 4,
  retryDelayMs: 1,
  fetchImpl: async () => { calls404 += 1; return new Response('', { status: 404 }); }
}), /HTTP 404/);
assert.equal(calls404, 1, 'permanent 404 responses must not be retried');

let calls503 = 0;
const recovered = await fetchWithRetry('https://example.invalid/transient', {
  retries: 2,
  retryDelayMs: 1,
  fetchImpl: async () => {
    calls503 += 1;
    return calls503 < 2 ? new Response('', { status: 503 }) : new Response('ok', { status: 200 });
  }
});
assert.equal(await recovered.text(), 'ok');
assert.equal(calls503, 2, 'transient 503 responses should retry');

const populate = await readFile(new URL('../scripts/populate-historical-archive.mjs', import.meta.url), 'utf8');
assert.match(populate, /retry-failed/);
assert.match(populate, /population-report\.json/);

console.log('2.34.5.3.2 acquisition resilience regression passed.');

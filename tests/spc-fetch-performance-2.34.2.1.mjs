import assert from 'node:assert/strict';
import { fetchWithRetry, mapWithConcurrency } from '../js/training/spc/SPCFetchClient.js';

let attempts = 0;
const response = await fetchWithRetry('https://example.test/archive/', {
  retries: 2,
  retryDelayMs: 1,
  timeoutMs: 1000,
  fetchImpl: async () => {
    attempts += 1;
    return attempts < 3 ? new Response('', { status: 504 }) : new Response('ok', { status: 200 });
  }
});
assert.equal(await response.text(), 'ok');
assert.equal(attempts, 3, '504 responses should retry until successful');

let active = 0;
let peak = 0;
const values = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async value => {
  active += 1;
  peak = Math.max(peak, active);
  await new Promise(resolve => setTimeout(resolve, 5));
  active -= 1;
  return value * 2;
});
assert.deepEqual(values, [2, 4, 6, 8, 10, 12]);
assert.equal(peak, 3, 'worker pool should respect the configured concurrency');

await assert.rejects(() => fetchWithRetry('https://example.test/not-found', {
  retries: 5,
  retryDelayMs: 1,
  fetchImpl: async () => new Response('', { status: 404 })
}), /HTTP 404/);

console.log('2.34.2.1 SPC acquisition performance checks passed');

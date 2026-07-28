import assert from 'node:assert/strict';
import { buildTargetedArchiveCandidates, discoverTargetedArchiveEntries } from '../js/historical/spc/SPCArchiveDiscovery.js';

const candidates = buildTargetedArchiveCandidates({
  startDate: '2024-05-06',
  endDate: '2024-05-06',
  forecastDays: ['day1']
});
assert.equal(candidates.length, 6);
assert.ok(candidates.some(entry => entry.url.endsWith('/2024/day1otlk_20240506_1630.html')));

let active = 0;
let peak = 0;
const discovery = await discoverTargetedArchiveEntries(candidates, {
  concurrency: 3,
  maxProducts: 2,
  request: async url => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active -= 1;
    if (url.includes('_1200.html') || url.includes('_1630.html')) return new Response('<html>ok</html>', { status: 200 });
    const error = new Error(`HTTP 404: ${url}`);
    error.status = 404;
    throw error;
  }
});
assert.equal(discovery.entries.length, 2);
assert.equal(discovery.failures.length, 0);
assert.ok(peak <= 3);
assert.equal(discovery.pages.get('day1:20240506:1200'), '<html>ok</html>');

const resilient = await discoverTargetedArchiveEntries(candidates.slice(0, 2), {
  concurrency: 2,
  request: async url => {
    if (url.includes('_0100.html')) {
      const error = new DOMException('This operation was aborted', 'AbortError');
      throw error;
    }
    const error = new Error(`HTTP 404: ${url}`);
    error.status = 404;
    throw error;
  }
});
assert.equal(resilient.entries.length, 0);
assert.equal(resilient.failures.length, 1, 'timeouts should be recorded without terminating discovery');

console.log('2.34.2.2 targeted SPC discovery checks passed');

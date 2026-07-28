import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../js/worker/timelinePrecompute.worker.js', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../js/api/TimelinePrecomputeClient.js', import.meta.url), 'utf8');

assert.match(worker, /hours = DEFAULT_HOURS/);
assert.match(worker, /stepHours = DEFAULT_STEP_HOURS/);
assert.match(worker, /timeline\.frames\.push\(captureFrame/);
assert.match(worker, /setTimeout\(resolve, 0\)/);
assert.match(client, /getFrame\(hourOffset = 0\)/);
assert.match(main, /UPCOMING_PRECOMPUTE_LEAD_HOURS = 36/);
assert.match(main, /if \(!upcomingSystem\?\.readyFrame\) return/);
assert.match(main, /activeTimelineClient = upcomingTimelineClient/);
assert.match(main, /restorePrecomputedFrame/);
assert.doesNotMatch(main, /if \(!upcomingSystem\?\.readyFrame\)[\s\S]{0,300}generateScenario\(atmosphere/);
console.log('2.27.2 background timeline architecture passed');

// The live server writes a review package for each finished day (server/DayReviewRecorder.js):
// from the first 12Z it sees to the next, with charts of the whole large-scale model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WeatherAuthorityRuntime } from '../server/WeatherAuthorityRuntime.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'day-review-'));
try {
  const runtime = new WeatherAuthorityRuntime({ seed: 77, spinUpDays: 5, dayReviews: { dir, keepDays: 1 } });
  const start = runtime.atmosphere.validHourUtc, toNoon = (((12 - start) % 24) + 24) % 24;
  // The first 12Z starts a day (a world may start at any hour), the next one finishes it.
  runtime.advance(toNoon + 24 + 0.5);
  await runtime.dayReview.flush();
  const day = path.join(dir, 'seed-77', `day-${Math.floor((start + toNoon - 12) / 24) + 1}`);
  const files = fs.readdirSync(day);
  for (const name of ['day.md', 'day.json', 'storms.svg', 'full-12Z.svg', 'full-00Z.svg', 'region-21Z.svg']) assert.ok(files.includes(name), `${name} written (${files.join(', ')})`);
  assert.ok(!files.includes('outlook.md'), 'no outlook without an outlook runtime');
  const json = JSON.parse(fs.readFileSync(path.join(day, 'day.json'), 'utf8'));
  assert.equal(json.hourly.length, 9, 'the region every 3 hours, both 12Zs included');
  assert.ok(fs.readFileSync(path.join(day, 'full-12Z.svg'), 'utf8').startsWith('<svg'), 'the large-scale chart is an SVG');
  console.log(`day review recorder: ${files.length} files for one day`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

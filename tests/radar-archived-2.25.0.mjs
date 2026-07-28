import assert from 'node:assert/strict';
import fs from 'node:fs';
for (const file of ['index.html','day1.html','day2.html','day3.html']) {
  const html=fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
  assert.ok(!html.includes('radar.html'));
}
assert.ok(!fs.existsSync(new URL('../radar.html',import.meta.url)));
assert.ok(fs.existsSync(new URL('../archive/radar-2.24.0/radar.html',import.meta.url)));
console.log('2.25.0 radar archive regression passed');

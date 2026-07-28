import assert from 'node:assert/strict';
import fs from 'node:fs';
for (const page of ['index.html','day1.html','day2.html','day3.html']) {
  const html=fs.readFileSync(new URL(`../${page}`,import.meta.url),'utf8');
  assert.match(html,/href="\.\/radar\.html"[^>]*>Radar<\/a>/,`${page} must link to radar endpoint`);
}
const radar=fs.readFileSync(new URL('../radar.html',import.meta.url),'utf8');
assert.match(radar,/data-page="radar"/);
assert.match(radar,/id="radarProduct"/);
assert.match(radar,/id="radarStation"/);
assert.match(radar,/js\/radarPage\.js\?v=2\.20\.0/);
console.log('radar endpoint navigation passed');

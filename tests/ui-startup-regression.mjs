import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');

for (const id of ['mapCanvas', 'toggleRegions', 'toggleRegionLabels', 'toggleGrid', 'toggleFeatures', 'toggleSmoothing']) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `index.html must contain #${id}`);
  if (id !== 'mapCanvas') assert.match(ui, new RegExp(`byId\\(["']${id}["']\\)`), `UI must bind #${id}`);
}

assert.match(main, /const mapHitTarget = ui\.canvas;/, 'canvas must remain the authoritative hit target');
assert.match(main, /mapHitTarget\.addEventListener\('click', selectMapCellFromEvent\)/, 'canvas click must open cell selection pipeline');
assert.match(main, /bindOptionalControl\(ui\.toggleRegionLabels/, 'optional controls must not abort startup');
assert.match(main, /bindOptionalControl\(ui\.toggleGrid/, 'optional controls must not abort startup');

console.log('ui startup regression passed.');

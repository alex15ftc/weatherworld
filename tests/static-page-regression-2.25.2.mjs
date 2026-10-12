import assert from 'node:assert/strict';
import fs from 'node:fs';

// The live page is the surface observations and mesoanalysis page.
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../js/pages/surfaceAnalysisPage.js', import.meta.url), 'utf8');
assert.match(html, /^<!doctype html>/i);
assert.match(html, /<link rel="stylesheet" href="\.\/css\/styles\.css"/);
assert.match(html, /<body data-page="live">/);
assert.match(html, /<script type="module" src="\.\/js\/pages\/surfaceAnalysisPage\.js/);
// Every element the page script looks up exists on the page.
for (const [, id] of script.matchAll(/\$\('([A-Za-z]+)'\)/g)) assert.match(html, new RegExp(`id="${id}"`), `#${id} is on the page`);
for (const page of ['day1.html', 'day2.html', 'day3.html', 'radar.html']) assert.doesNotMatch(fs.readFileSync(new URL(`../${page}`, import.meta.url), 'utf8'), /analysis\.html/, `${page} does not link to the removed page`);
assert.ok(css.length > 10000, 'stylesheet should not be truncated');
console.log('Static live-page regression checks passed');

import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
assert.match(html, /^<!doctype html>/i);
assert.match(html, /<link rel="stylesheet" href="\.\/css\/styles\.css"/);
assert.match(html, /<body data-page="live">/);
assert.match(html, /<script type="module" src="\.\/js\/pageBootstrap\.js/);
assert.ok(css.length > 10000, 'stylesheet should not be truncated');
console.log('Static live-page regression checks passed');

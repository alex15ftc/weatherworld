import assert from 'node:assert/strict';
import fs from 'node:fs';
const src=fs.readFileSync(new URL('../js/remoteProductPage.js',import.meta.url),'utf8');
assert.match(src,/formatNumber\(p\.vtp,1,''\)/);
assert.doesNotMatch(src,/formatNumber\(params\.vtp/);
assert.match(src,/drawSounding\(document\.querySelector\('#skewTCanvas'\),s\)/);
assert.match(src,/drawHodograph\(document\.querySelector\('#hodoCanvas'\),s\)/);
assert.match(src,/cellSizeMiles/);
console.log('sounding VTP render regression passed');

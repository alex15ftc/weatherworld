import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const renderer=await fs.readFile(new URL('server/tiles/ProductTileRenderer.js',root),'utf8');
for(const c of ['#c1e9c1','#66a366','#ffe066','#ffa366','#e06666','#ee99ee']) assert.ok(renderer.includes(c),`missing ${c}`);
const page=await fs.readFile(new URL('js/remoteProductPage.js',root),'utf8');
assert.ok(page.includes('Effective Layer STP (with CIN)'));
assert.ok(page.includes("['EF4+'"));
console.log('effective STP + NWS categorical colors: ok');

import { readFileSync } from 'node:fs';
import { interchangeRamps, tee } from './js/worldmap/interchanges.js';
const m = JSON.parse(readFileSync('data/worldmap/seed-1/meta.json'));
const segDist = (x, y, a, b) => { const dx=b[0]-a[0], dy=b[1]-a[1], l=dx*dx+dy*dy; const t=l?Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/l)):0; return Math.hypot(a[0]+dx*t-x,a[1]+dy*t-y); };
const onRoad = (x, y, pred = () => true, tol = 0.06) => m.roads.filter(pred).filter(r => r.points.some((q, i) => i && segDist(x, y, r.points[i-1], q) < tol));
const sec = new Uint8Array(readFileSync('data/worldmap/seed-1/sections.u8')), S = m.sectionGrid.size;
const pavedAt = (x, y) => { // paved section road through point
  const I = Math.round(x), J = Math.round(y);
  if (Math.abs(x - I) < 0.06) { const j = Math.floor(y); return ((sec[j*S+I]>>2)&3) === 3; }
  if (Math.abs(y - J) < 0.06) { const i = Math.floor(x); return (sec[J*S+i]&3) === 3; }
  return false; };
let bad = 0;
for (const c of m.crossings) {
  if (c.type !== 'interchange') continue;
  const ramps = interchangeRamps(c), T = tee(c);
  const ends = ramps.map(r => r.at(-1)).concat(T ? ramps.map(r => r[0]) : []);
  const missing = [];
  for (const [x, y] of ends) {
    const roads = onRoad(x, y, r => true, 0.08);
    if (!roads.length && !pavedAt(x, y)) missing.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  if (missing.length) { bad++; console.log(`${c.interstate} exit ${c.exit} ${c.kind}${T ? ' T' : ''} at ${c.x.toFixed(2)},${c.y.toFixed(2)} v=${c.vx.toFixed(2)},${c.vy.toFixed(2)} uEnd=${c.uEnd} vEnd=${c.vEnd}: ramp ends off-road ${missing.join(' ')}`); }
}
console.log('interchanges with ramps ending off any road:', bad, 'of', m.crossings.filter(c => c.type === 'interchange').length);

import { readFileSync } from 'node:fs';
import { sectionSegments, signalJunctions } from './js/worldmap/roadNetwork.js';
const m = JSON.parse(readFileSync('data/worldmap/seed-1/meta.json'));
const roads = new Uint8Array(readFileSync('data/worldmap/seed-1/sections.u8')), S = m.sectionGrid.size;
const sections = { size: S, roads };
const segDist = (x, y, a, b) => { const dx=b[0]-a[0], dy=b[1]-a[1], l=dx*dx+dy*dy; const t=l?Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/l)):0; return Math.hypot(a[0]+dx*t-x,a[1]+dy*t-y); };
const cells = new Map();
for (const r of m.rivers) for (let k = 2; k < r.points.length; k += 2) {
  const seg = [[r.points[k-2], r.points[k-1]], [r.points[k], r.points[k+1]], Math.min(220, Math.max(12, r.widthsM[k/2] * 0.18)) / 2000];
  for (let x = Math.floor(Math.min(seg[0][0], seg[1][0])) - 1; x <= Math.floor(Math.max(seg[0][0], seg[1][0])) + 1; x++) for (let y = Math.floor(Math.min(seg[0][1], seg[1][1])) - 1; y <= Math.floor(Math.max(seg[0][1], seg[1][1])) + 1; y++) { const key = x * 4096 + y; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(seg); }
}
const inRiver = (x, y, pad = 0.03) => (cells.get(Math.floor(x) * 4096 + Math.floor(y)) ?? []).some(([a, b, half]) => segDist(x, y, a, b) < half + pad);
const elm = m.settlements.find(s => s.name === 'Elm City'); console.log('Elm City', elm.x, elm.y, elm.kind, elm.extentMi);
// Signal junctions in rivers.
const sig = signalJunctions(m, sections).filter(([x, y]) => inRiver(x, y));
console.log('signals in rivers', sig.length, sig.slice(0, 10).map(p => p.map(v => v.toFixed(2)).join(',')).join(' '));
// Section corners with 3+ arms in rivers.
let corners = 0; const near = [];
for (let J = 1; J < S - 1; J++) for (let I = 1; I < S - 1; I++) {
  const arms = ((roads[J*S+I]&3)?1:0) + ((roads[J*S+I-1]&3)?1:0) + (((roads[J*S+I]>>2)&3)?1:0) + (((roads[(J-1)*S+I]>>2)&3)?1:0);
  if (arms >= 3 && inRiver(I, J, 0.01)) { corners++; if (Math.hypot(I - elm.x, J - elm.y) < 15) near.push(`${I},${J}`); }
}
console.log('section junctions in rivers', corners, 'near Elm City:', near.join(' '));
// Highway vertices (turns/junctions) in rivers.
const hv = [];
for (const r of m.roads) r.points.forEach(([x, y], i) => { if (i && i < r.points.length - 1 && inRiver(x, y, 0.01)) hv.push(`${r.name}@${x},${y}`); });
console.log('highway bends in rivers', hv.length, hv.slice(0, 15).join(' '));
// Paved section miles running along a river (in it for most of the mile).
let along = 0;
for (let J = 0; J < S; J++) for (let I = 0; I < S; I++) for (const [cls, dx, dy] of [[roads[J*S+I]&3,1,0],[(roads[J*S+I]>>2)&3,0,1]]) {
  if (!cls) continue; let wet = 0; for (let t = 0.1; t < 1; t += 0.2) if (inRiver(I + dx * t, J + dy * t, 0)) wet++;
  if (wet >= 3) along++;
}
console.log('section road miles lying in a river', along);

import { readFileSync } from 'node:fs';
const m = JSON.parse(readFileSync('data/worldmap/seed-1/meta.json'));
const lake = new Uint8Array(readFileSync('data/worldmap/seed-1/lake.u8'));
const segDist = (x, y, a, b) => { const dx=b[0]-a[0], dy=b[1]-a[1], l=dx*dx+dy*dy; const t=l?Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/l)):0; return Math.hypot(a[0]+dx*t-x,a[1]+dy*t-y); };
const len = r => r.points.reduce((s, q, i) => i ? s + Math.hypot(q[0]-r.points[i-1][0], q[1]-r.points[i-1][1]) : 0, 0);
const M = m.size * m.cellMiles;
const onOther = (r, [x, y]) => m.roads.some(o => o !== r && o.points.some((q, i) => i && segDist(x, y, o.points[i-1], q) < 0.1));
const atTown = ([x, y]) => m.settlements.some(s => Math.hypot(s.x - x, s.y - y) <= Math.max(1.6, s.extentMi * 0.5));
const atEdge = ([x, y]) => x <= 0.5 || y <= 0.5 || x >= M - 0.5 || y >= M - 0.5;
const issues = {};
const note = (k, v) => (issues[k] ??= []).push(v);
for (const r of m.roads) {
  if (r.name?.includes('bypass') || r.kind === 'interstate' && /I-[24]35/.test(r.name)) continue;
  const L = len(r);
  if (L < 1.5) note('very short road', `${r.name} ${L.toFixed(2)} mi`);
  for (const e of [r.points[0], r.points.at(-1)]) if (!atTown(e) && !atEdge(e) && !onOther(r, e)) note('dead-end highway', `${r.name} at ${e.join(',')}`);
  for (const [x, y] of r.points) { const k = Math.floor(y / m.cellMiles) * m.size + Math.floor(x / m.cellMiles); if (lake[k]) { note('road in lake', `${r.name} ${x},${y}`); break; } }
}
// Duplicate routes: two highways sharing most of their length.
const hw = m.roads.filter(r => r.kind !== 'interstate');
for (let a = 0; a < hw.length; a++) for (let b = a + 1; b < hw.length; b++) {
  const A = hw[a], B = hw[b], samples = []; for (let i = 1; i < A.points.length; i++) samples.push([(A.points[i-1][0]+A.points[i][0])/2, (A.points[i-1][1]+A.points[i][1])/2]);
  const shared = samples.filter(p => B.points.some((q, i) => i && segDist(p[0], p[1], B.points[i-1], q) < 0.05)).length;
  if (samples.length >= 2 && shared / samples.length > 0.8) note('route duplicated by another', `${A.name} inside ${B.name}`);
}
for (const c of m.crossings) if (c.type === 'overpass' && (c.kind === 'us' || c.kind === 'expressway' || c.kind === 'state')) note('highway only bridged over interstate (no exit)', `${c.kind} over ${c.interstate} at ${c.x},${c.y}`);
// Shallow merges: two highways crossing at under 20 degrees.
for (const A of hw) for (const B of hw) if (A.name < B.name) for (let i = 1; i < A.points.length; i++) for (let k = 1; k < B.points.length; k++) {
  const a = A.points[i-1], b = A.points[i], c = B.points[k-1], d = B.points[k];
  const rx=b[0]-a[0], ry=b[1]-a[1], sx=d[0]-c[0], sy=d[1]-c[1], den=rx*sy-ry*sx; if (Math.abs(den) < 1e-9) continue;
  const t=((c[0]-a[0])*sy-(c[1]-a[1])*sx)/den, u=((c[0]-a[0])*ry-(c[1]-a[1])*rx)/den;
  if (t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99 && Math.abs(den)/(Math.hypot(rx,ry)*Math.hypot(sx,sy)) < 0.34) note('shallow crossing (<20 deg)', `${A.name} x ${B.name} at ${(a[0]+rx*t).toFixed(1)},${(a[1]+ry*t).toFixed(1)}`);
}
for (const [k, v] of Object.entries(issues)) console.log(`${k}: ${v.length}\n   ${v.slice(0, 8).join('\n   ')}`);

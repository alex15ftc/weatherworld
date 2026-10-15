import { readFileSync } from 'node:fs';
const m = JSON.parse(readFileSync('data/worldmap/seed-1/meta.json'));
const segDist = (x, y, a, b) => { const dx=b[0]-a[0], dy=b[1]-a[1], l=dx*dx+dy*dy; const t=l?Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/l)):0; return Math.hypot(a[0]+dx*t-x,a[1]+dy*t-y); };
for (const [x, y] of [[402.78,121.22]]) {
  console.log(`== ${x},${y}`, m.settlements.filter(s => Math.hypot(s.x-x,s.y-y)<1).map(s=>s.name+' '+s.population).join());
  for (const r of m.roads) { const i = r.points.findIndex((q, i) => i && segDist(x, y, r.points[i-1], q) < 0.1); if (i < 0) continue;
    console.log(' ', r.kind, r.name, 'idx', i, '/', r.points.length - 1, JSON.stringify(r.points.slice(Math.max(0,i-2), i+2))); }
}

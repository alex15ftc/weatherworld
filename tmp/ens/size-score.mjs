// Scores the ensemble-size test: for N runs, the chance of each hazard within the outlook radius
// (share of runs with a report within it) against the live world. Brier skill against a fixed
// climatology chance; plus the hit rate and false share of each run-count's 30%+ area.
import fs from 'node:fs';
const files = ['tmp/ens/size', 'tmp/ens/cheap'].flatMap(dir => fs.readdirSync(dir).map(f => JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'))));
const seeds = [...new Set(files.map(f => f.seed))].sort((a, b) => a - b);
const W = files[0].width, H = files[0].height, n = W * H, R = 1; // 1 cell = the 10-mile outlook radius
const unpack = s => Uint8Array.from(s, c => c === '1' ? 1 : 0);
const dilate = g => { const o = new Uint8Array(n); for (let i = 0; i < n; i++) { if (!g[i]) continue; const x = i % W, y = (i / W) | 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { if (dx * dx + dy * dy > R * R) continue; const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) o[yy * W + xx] = 1; } } return o; };
const HAZ = ['severe', 'tornado', 'tornadoSig'];
const data = seeds.map(seed => {
  const truth = files.find(f => f.seed === seed && f.kind === 'truth').members[0];
  const members = kind => files.filter(f => f.seed === seed && f.kind === kind).flatMap(f => f.members).sort((a, b) => a.member - b.member);
  const ev = m => Object.fromEntries(HAZ.map(h => [h, dilate(unpack(m[h]))]));
  return { seed, truth: ev(truth), full: members('full').map(ev), dice: members('dice').map(ev), cheapA: members('cheapA').map(ev), cheapB: members('cheapB').map(ev), ms: members('full').map(m => m.ms) };
});
let rand = 12345; const rnd = () => ((rand = (rand * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (arr, k) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, k); };
const clim = Object.fromEntries(HAZ.map(h => [h, data.reduce((s, d) => s + d.truth[h].reduce((a, b) => a + b, 0), 0) / (n * data.length)]));
function score(h, choose, draws = 30) {
  let bs = 0, bsClim = 0, hit = 0, tot = 0, inArea = 0, falseA = 0;
  for (const d of data) for (let k = 0; k < draws; k++) {
    const runs = choose(d), o = d.truth[h];
    for (let i = 0; i < n; i++) { let c = 0; for (const r of runs) c += r[h][i]; const p = c / runs.length;
      bs += (p - o[i]) ** 2; bsClim += (clim[h] - o[i]) ** 2;
      if (o[i]) { tot++; if (p >= 0.3) hit++; } if (p >= 0.3) { inArea++; if (!o[i]) falseA++; } }
  }
  return { bss: 1 - bs / bsClim, hit: tot ? hit / tot : NaN, falseShare: inArea ? falseA / inArea : NaN };
}
const fmt = s => `${(100 * s.bss).toFixed(0).padStart(4)}%  ${(100 * s.hit).toFixed(0).padStart(3)}%  ${(100 * s.falseShare).toFixed(0).padStart(3)}%`;
console.log(`${data.length} seeds, 16Z-12Z; per cell: event = report within 10 mi. Columns: skill (Brier vs climatology), share of truth's events inside the 30% area, share of the 30% area that stayed quiet`);
console.log(`full run: ${(data.flatMap(d => d.ms).reduce((a, b) => a + b, 0) / data.flatMap(d => d.ms).length / 1000).toFixed(1)} s per 20 h`);
for (const h of HAZ) {
  console.log(`\n${h} (climatology ${(100 * clim[h]).toFixed(1)}% of cells)`);
  for (const N of [1, 4, 8, 16, 32]) console.log(`  ${String(N).padStart(2)} full runs  ${fmt(score(h, d => pick(d.full, N)))}     ${String(N).padStart(2)} dice-only  ${fmt(score(h, d => pick(d.dice, N)))}`);
  for (const N of [8, 16, 32]) console.log(`  ${String(N).padStart(2)} cheap A    ${fmt(score(h, d => pick(d.cheapA, N)))}     ${String(N).padStart(2)} cheap B    ${fmt(score(h, d => pick(d.cheapB, N)))}`);
  for (const [f, c] of [[8, 24]]) console.log(`  mix ${f} full + ${c} cheap A  ${fmt(score(h, d => [...pick(d.full, f), ...pick(d.cheapA, c)]))}   mix with cheap B  ${fmt(score(h, d => [...pick(d.full, f), ...pick(d.cheapB, c)]))}`);
  for (const [f, c] of [[4, 12], [4, 28], [8, 24]]) console.log(`  mix ${f} full + ${c} dice-only  ${fmt(score(h, d => [...pick(d.full, f), ...pick(d.dice, c)]))}`);
}

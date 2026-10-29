// How much do two outlooks made from different run sets (same day, same truth) disagree? That is
// pure noise: it is what changes between issues when nothing about the weather has changed.
import fs from 'node:fs';
const dir = 'tmp/ens/size', files = fs.readdirSync(dir).map(f => JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')));
const seeds = [...new Set(files.map(f => f.seed))];
const W = files[0].width, H = files[0].height, n = W * H, R = 1;
const unpack = s => Uint8Array.from(s, c => c === '1' ? 1 : 0);
const dilate = g => { const o = new Uint8Array(n); for (let i = 0; i < n; i++) { if (!g[i]) continue; const x = i % W, y = (i / W) | 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { if (dx * dx + dy * dy > R * R) continue; const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) o[yy * W + xx] = 1; } } return o; };
const levels = { severe: [0.15, 0.3, 0.45], tornado: [0.05, 0.1, 0.15] };
let rand = 777; const rnd = () => ((rand = (rand * 1103515245 + 12345) % 2147483648) / 2147483648);
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
for (const h of Object.keys(levels)) {
  console.log(`\n${h}: two outlooks from different runs, same day. Per level: overlap of the two areas (1 = identical), and how often the top level reached differs`);
  for (const N of [4, 8, 16, 32]) {
    const ov = levels[h].map(() => [0, 0]); let topDiff = 0, pairs = 0;
    for (const seed of seeds) {
      const runs = files.filter(f => f.seed === seed && f.kind !== 'truth').flatMap(f => f.members).map(m => dilate(unpack(m[h])));
      for (let k = 0; k < (N === 32 ? 1 : 10); k++) {
        const s = shuffle(runs), A = s.slice(0, N), B = s.slice(N, 2 * N);
        const p = set => Float32Array.from({ length: n }, (_, i) => set.reduce((c, r) => c + r[i], 0) / set.length);
        const pa = p(A), pb = p(B);
        const top = q => levels[h].filter(l => q.some(v => v >= l)).length;
        if (top(pa) !== top(pb)) topDiff++; pairs++;
        levels[h].forEach((l, j) => { let both = 0, either = 0; for (let i = 0; i < n; i++) { const a = pa[i] >= l, b = pb[i] >= l; if (a && b) both++; if (a || b) either++; } if (either) { ov[j][0] += both / either; ov[j][1]++; } });
      }
    }
    console.log(`  ${String(N).padStart(2)} runs  ` + levels[h].map((l, j) => `${Math.round(l * 100)}%: ${(ov[j][0] / ov[j][1]).toFixed(2)}`).join('   ') + `   top level differs ${Math.round(100 * topDiff / pairs)}%`);
  }
}

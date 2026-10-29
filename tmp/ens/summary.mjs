import fs from 'node:fs';
const dir = 'tmp/ens/out', runs = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => fs.readFileSync(`${dir}/${f}`, 'utf8').trim()).filter(Boolean).map(JSON.parse);
const BINS = ['0-1 h', '1-3 h', '3-6 h', '6-12 h', '12-18 h'];
console.log(`${runs.length} seeds; truth tornadoes: ${runs.map(r => r.truthTornadoes).join(', ')}`);
for (const field of ['storm', 'severe', 'tornado']) {
  console.log(`\n${field}: truth found within 20 mi / run's own near truth`);
  console.log('variant'.padEnd(13) + BINS.map(b => b.padStart(14)).join(''));
  for (const name of Object.keys(runs[0].variants)) {
    const cells = BINS.map((_, k) => { let f = 0, tn = 0, g = 0, rn = 0;
      for (const r of runs) { const c = r.variants[name].bins[k][field]; f += c.found; tn += c.truthN; g += c.good; rn += c.runN; }
      return (tn ? Math.round(100 * f / tn) : '-') + '/' + (rn ? Math.round(100 * g / rn) : '-') + '%'; });
    console.log(name.padEnd(13) + cells.map(c => c.padStart(14)).join(''));
  }
}
console.log('\ntornadoes per run (seed order) and seconds per 18 h run:');
for (const name of Object.keys(runs[0].variants)) console.log(name.padEnd(13), runs.map(r => r.variants[name].tornadoes).join(', ').padEnd(40), (runs.reduce((s, r) => s + r.variants[name].ms, 0) / runs.length / 1000).toFixed(1) + ' s');

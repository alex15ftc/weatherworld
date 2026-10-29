import { spawn } from 'node:child_process';
const jobs = [];
for (let s = 1; s <= 8; s++) { jobs.push(['truth', s]); for (const kind of ['full', 'dice']) for (let from = 0; from < 32; from += 8) jobs.push([kind, s, from, 8]); }
let running = 0, done = 0; const LIMIT = 16;
const next = () => { while (running < LIMIT && jobs.length) { const args = jobs.shift().map(String); running++;
  const p = spawn('node', ['tmp/ens/ens-job.mjs', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
  p.on('exit', code => { running--; done++; console.log(`${done} done (${args.join(' ')}) exit ${code}`); next(); }); } };
next();

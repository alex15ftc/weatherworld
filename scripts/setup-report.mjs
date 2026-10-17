// What kinds of tornado days the world makes (agenda step 10): each tornado is labelled by the
// conditions where its storm started (read from the fields, not from drawn lines; a dryline
// storm has usually moved well into the warm sector by the time it puts one down), or "line" if
// its storm is part of a squall line then, and each day by the label most of its tornadoes
// share. Steps the storms like the server.
//   node scripts/setup-report.mjs [days] [--seeds 1,2,3] [--days] [key=value ...]
// key=value sets a regional-layer setting, qg.key=value one of the outer model's. Also counts the days with an MCS (a storm in MCS mode).
// Labels, first that applies: line (squall-line mode), triple point (a frontal zone and a
// dryline together), front, dryline, outflow (the edge of rain-cooled air), cold core (500 mb
// at COLD_CORE_C or colder), warm sector (none of these).
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();

// How far from where a storm starts its lines are looked for (cells of 16 km): storms start up to
// about 30 km from a dryline, on its moist side. (Dryline and frontal zones often overlap: the
// dryline's hot dry side is dense too, so many starts near one are labelled triple point.)
const BIRTH_REACH_CELLS = Number(process.env.BIRTH_REACH ?? 2);
const FRONT_GRADIENT_K100 = 4, DRYLINE_GRADIENT_GKG100 = 5, OUTFLOW_CONTRAST_K = 1.5, COLD_CORE_C = -15;
const LINE_MODES = ['QLCS', 'QLCS with embedded supercells', 'linear segment', 'broken line', 'MCS'];
const LABELS = ['line', 'triple point', 'front', 'dryline', 'outflow', 'cold core', 'warm sector'];

const args = process.argv.slice(2);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 10);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

if (flag('--worker') !== null) await worker(Number(flag('--worker'))); else await main();

function label(storm, cell, env = storm.environment ?? {}) {
  const front = (env.densityGradient ?? 0) >= FRONT_GRADIENT_K100, dryline = (env.moistureGradient ?? 0) >= DRYLINE_GRADIENT_GKG100;
  if (front && dryline) return 'triple point';
  if (front) return 'front';
  if (dryline) return 'dryline';
  if ((env.outflowContrastK ?? 0) >= OUTFLOW_CONTRAST_K) return 'outflow';
  if ((cell?.levels?.[500]?.temperature ?? 0) <= COLD_CORE_C) return 'cold core';
  return 'warm sector';
}

async function worker(seed) {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const { buildAnalysisOverlays } = await import('../server/analysisOverlays.js');
  const pairs = args.filter(a => a.includes('=')).map(a => { const [k, v] = a.split('='); return [k, Number(v)]; });
  const regional = Object.fromEntries(pairs.filter(([k]) => !k.startsWith('qg.'))), outer = Object.fromEntries(pairs.filter(([k]) => k.startsWith('qg.')).map(([k, v]) => [k.slice(3), v]));
  let model = null;
  if (Object.keys(outer).length) { const { QuasiGeostrophicModel } = await import('../js/atmosphere/QuasiGeostrophicModel.js'); model = new QuasiGeostrophicModel({ seed, ...outer }); model.advance(45 * 86400); }
  const atmosphere = new AtmosphereWorld({ seed, regional, ...(model ? { model } : {}) }), world = atmosphere.world, seen = new Set(), born = new Map(), out = [];
  // The lines at the place itself (the largest within one cell of it), with the storm's own
  // reading of outflow: a storm's sampled environment lies ahead of it, in its inflow.
  const birthplace = storm => {
    const x0 = Math.floor(storm.positionKm.x / world.cellSizeKm), y0 = Math.floor(storm.positionKm.y / world.cellSizeKm);
    let densityGradient = 0, moistureGradient = 0;
    for (let y = y0 - BIRTH_REACH_CELLS; y <= y0 + BIRTH_REACH_CELLS; y++) for (let x = x0 - BIRTH_REACH_CELLS; x <= x0 + BIRTH_REACH_CELLS; x++) {
      const cell = world.cells[y]?.[x]; if (!cell) continue;
      densityGradient = Math.max(densityGradient, cell.features.densityGradientK100 ?? 0); moistureGradient = Math.max(moistureGradient, cell.features.moistureGradientGkg100 ?? 0);
    }
    return { densityGradient, moistureGradient, outflowContrastK: storm.environment?.outflowContrastK ?? 0 };
  };
  const cellAt = storm => world.cells[Math.max(0, Math.min(world.height - 1, Math.floor(storm.positionKm.y / world.cellSizeKm)))][Math.max(0, Math.min(world.width - 1, Math.floor(storm.positionKm.x / world.cellSizeKm)))];
  for (let day = 1; day <= days; day++) {
    const counts = Object.fromEntries(LABELS.map(l => [l, 0])), starts = Object.fromEntries(LABELS.map(l => [l, 0])), dayStarts = Object.fromEntries(LABELS.map(l => [l, 0]));
    let lowOnMap = false, night = 0, mcs = false;
    for (let tick = 0; tick < 288; tick++) {
      atmosphere.advanceStormLayer(1 / 12);
      if ((tick + 1) % 6 === 0) atmosphere.advance(0.5, { advanceStorms: false });
      const utc = ((world.validHourUtc % 24) + 24) % 24;
      if ((tick + 1) % 6 === 0 && Math.abs(utc - 21) < 1e-6) lowOnMap = buildAnalysisOverlays(world, []).pressureCentres.some(c => c.type === 'L');
      mcs ||= world.storms.some(s => s.active && s.mode === 'MCS');
      for (const storm of world.storms) {
        // Where each storm started (a split keeps its parent's).
        if (!born.has(storm.id)) { born.set(storm.id, born.get(storm.parentId) ?? label(storm, cellAt(storm), birthplace(storm))); if (!storm.parentId) { starts[born.get(storm.id)]++; const local = ((((world.validHourUtc % 24) + 24) % 24) - 6 + 24) % 24; if (local >= 10 && local < 21) dayStarts[born.get(storm.id)]++; } }
        if (!storm.tornado?.onGround) continue;
        const key = `${storm.id}|${storm.tornado.startedHourUtc}`;
        if (seen.has(key)) continue;
        seen.add(key);
        counts[LINE_MODES.includes(storm.mode) ? 'line' : born.get(storm.id)]++;
        const local = ((utc - 6) % 24 + 24) % 24;
        if (local < 9 || local >= 21) night++;
      }
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0), top = LABELS.reduce((a, b) => (counts[b] > counts[a] ? b : a));
    out.push({ starts, dayStarts, seed, day, kind: atmosphere.steering?.plan?.kind ?? '-', lowOnMap, mcs, tornadoes: total, night, counts, setup: total ? (counts[top] / total >= 0.4 ? top : 'mixed') : 'no tornado' });
  }
  process.send(out);
}

async function main() {
  const seeds = (flag('--seeds') ?? '1,2,3').split(',').map(Number), started = Date.now();
  const results = await Promise.all(seeds.map(seed => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [String(days), '--worker', String(seed), ...args.filter(a => a.includes('='))]);
    child.once('message', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error(`seed ${seed} exited with ${code}`)); });
  })));
  const all = results.flat().filter(d => d.day > 1), share = (rows, test) => `${Math.round(100 * rows.filter(test).length / Math.max(1, rows.length))}%`;
  console.log(`=== Setup report: ${days} days x seeds ${seeds.join(', ')} (first day left out; ${((Date.now() - started) / 1000).toFixed(0)} s) ===`);
  if (args.includes('--days')) for (const d of all) console.log(`  seed ${d.seed} day ${String(d.day).padStart(2)}  ${d.kind.padEnd(34)} L ${d.lowOnMap ? 'yes' : 'no '}  tornadoes ${String(d.tornadoes).padStart(3)} (night ${d.night})  ${d.setup}  ${LABELS.filter(l => d.counts[l]).map(l => `${l} ${d.counts[l]}`).join(', ')}`);
  const setups = [...LABELS, 'mixed', 'no tornado'];
  console.log(`\nDays by main setup: ${setups.map(s => `${s} ${share(all, d => d.setup === s)}`).filter(t => !t.endsWith(' 0%')).join(', ')}`);
  const tornadoes = LABELS.map(l => [l, all.reduce((sum, d) => sum + d.counts[l], 0)]), total = tornadoes.reduce((s, [, n]) => s + n, 0);
  console.log(`Tornadoes by setup (${total}): ${tornadoes.filter(([, n]) => n).map(([l, n]) => `${l} ${Math.round(100 * n / total)}%`).join(', ')} | at night ${Math.round(100 * all.reduce((s, d) => s + d.night, 0) / Math.max(1, total))}%`);
  const startTotals = LABELS.map(l => [l, all.reduce((sum, d) => sum + d.starts[l], 0)]), startSum = startTotals.reduce((s, [, n]) => s + n, 0);
  console.log(`Storm starts by setup (${startSum}): ${startTotals.filter(([, n]) => n).map(([l, n]) => `${l} ${Math.round(100 * n / startSum)}%`).join(', ')}; tornadoes per 100 starts: ${startTotals.filter(([, n]) => n).map(([l, n]) => `${l} ${(100 * (tornadoes.find(t => t[0] === l)?.[1] ?? 0) / n).toFixed(1)}`).join(', ')}`);
  const dayTotals = LABELS.map(l => [l, all.reduce((sum, d) => sum + d.dayStarts[l], 0)]), daySum = dayTotals.reduce((s, [, n]) => s + n, 0);
  console.log(`Daytime storm starts (10 am - 9 pm local, ${daySum}, ${Math.round(100 * daySum / Math.max(1, startSum))}% of all): ${dayTotals.filter(([, n]) => n).map(([l, n]) => `${l} ${Math.round(100 * n / daySum)}%`).join(', ')}`);
  console.log(`A closed low on the map at 21Z: ${share(all, d => d.lowOnMap)} of days | an MCS: ${share(all, d => d.mcs)} of days`);
  const kinds = [...new Set(all.map(d => d.kind.split(' (')[0]))];
  for (const kind of kinds) {
    const rows = all.filter(d => d.kind.split(' (')[0] === kind);
    console.log(`  steered for ${kind.padEnd(11)} ${String(rows.length).padStart(3)} days: low on map ${share(rows, d => d.lowOnMap)}, tornado ${share(rows, d => d.tornadoes > 0)}, main setups ${setups.map(s => `${s} ${share(rows, d => d.setup === s)}`).filter(t => !t.endsWith(' 0%')).join(', ')}`);
  }
}

// How real the analysed boundaries are (step 6 of the 2026-10-16 plan): fronts, drylines and
// outflow boundaries, stepped like the server and analysed every half hour as the server does.
//   node scripts/boundary-report.mjs [days] [--seeds 1,2,3] [key=value ...]
// key=value sets a regional-layer setting, qg.key=value one of the outer model's.
//
// Motion is tracked point by point: each point of a line is matched with the nearest point of
// the last analysis's lines of the same family (fronts of any kind; drylines; outflow) within
// MATCH_KM, and its move across the line (along the line's normal) is its motion; a line growing
// or shrinking does not move it. Contrasts are read 64 km either side of each point.
//
// Orientation: the way each piece of a line lies (an axis, 0-180 degrees: N-S, NNE-SSW, NE-SW, ...),
// weighted by length. Real: cold fronts mostly SW-NE to about N-S, warm fronts about E-W
// (WNW-ESE), drylines about N-S, stationary fronts often about E-W, outflow arcs any way.
// Real values to compare with (approximate; Plains, spring): cold fronts move toward the east to
// south at about 5-15 m/s, with 10-15 F of cooling and the wind turning 45-90 degrees across
// them; warm fronts move north to east, about half as fast; stationary fronts a few m/s at most;
// drylines lie north-south with 10-20 F of dewpoint across, move east by day (100-200 km by late
// afternoon) and back west at night at about 20-30 km/h; outflow boundaries move at 5-15 m/s with
// 2-10 K of cooling and last for hours, some into the next morning.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 8);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const settings = args.filter(a => a.includes('='));
const MATCH_KM = 80, SAMPLE_KM = 64, STEP_HOURS = 0.5;
const FAMILY = { cold: 'front', warm: 'front', stationary: 'front', dryline: 'dryline', outflow: 'outflow' };
const TYPES = ['cold', 'warm', 'stationary', 'dryline', 'outflow'];

if (flag('--worker') !== null) await worker(Number(flag('--worker'))); else await main();

async function worker(seed) {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const { buildAnalysisOverlays } = await import('../server/analysisOverlays.js');
  const pairs = settings.map(a => { const [k, v] = a.split('='); return [k, Number(v)]; });
  const regional = Object.fromEntries(pairs.filter(([k]) => !k.startsWith('qg.'))), outer = Object.fromEntries(pairs.filter(([k]) => k.startsWith('qg.')).map(([k, v]) => [k.slice(3), v]));
  let model = null;
  if (Object.keys(outer).length) { const { QuasiGeostrophicModel } = await import('../js/atmosphere/QuasiGeostrophicModel.js'); model = new QuasiGeostrophicModel({ seed, ...outer }); model.advance(45 * 86400); }
  const atmosphere = new AtmosphereWorld({ seed, regional, ...(model ? { model } : {}) }), world = atmosphere.world;
  const cellKm = world.cellSizeKm, W = world.width, H = world.height;
  const at = (x, y) => world.cells[Math.max(0, Math.min(H - 1, Math.floor(y / cellKm)))][Math.max(0, Math.min(W - 1, Math.floor(x / cellKm)))];
  const out = { motion: [], flips: [], contrast: [], dryline: [], lows: [], outflowLife: [], axis: [], dryAxis: [], pairs: [], counts: [], crossings: [], facing: [] };
  let previous = [], outflowTracks = [];
  for (let tick = 0; tick < days * 288; tick++) {
    atmosphere.advanceStormLayer(1 / 12);
    if ((tick + 1) % 6) continue;
    atmosphere.advance(STEP_HOURS, { advanceStorms: false });
    const hour = ((world.validHourUtc % 24) + 24) % 24, local = ((hour - 6) % 24 + 24) % 24;
    const lines = atmosphere.boundaries.filter(b => (b.pointsKm?.length ?? 0) > 2);
    const current = [];
    for (const line of lines) {
      const p = line.pointsKm, family = FAMILY[line.type];
      // Orientation of each piece (degrees east of north, 0-180), with its length.
      for (let i = 1; i < p.length; i++) { const dx = p[i].x - p[i - 1].x, dyNorth = -(p[i].y - p[i - 1].y), len = Math.hypot(dx, dyNorth); if (len > 0) out.axis.push([line.type, ((Math.atan2(dx, dyNorth) * 180 / Math.PI) % 180 + 180) % 180, len]); }
      for (let i = 1; i < p.length - 1; i += 2) {
        const tx = p[i + 1].x - p[i - 1].x, ty = p[i + 1].y - p[i - 1].y, tl = Math.hypot(tx, ty) || 1;
        const point = { x: p[i].x, y: p[i].y, nx: -ty / tl, ny: tx / tl, type: line.type, family };
        if (line.type === 'dryline') { let near = Infinity; for (const other of lines) if (FAMILY[other.type] === 'front') for (const q of other.pointsKm) near = Math.min(near, Math.hypot(q.x - p[i].x, q.y - p[i].y)); out.dryAxis.push([((Math.atan2(tx, -ty) * 180 / Math.PI) % 180 + 180) % 180, near]); }
        current.push(point);
        // Motion across the line since the last analysis.
        let best = null;
        for (const q of previous) if (q.family === family) { const d = Math.hypot(q.x - point.x, q.y - point.y); if (d < MATCH_KM && (!best || d < best.d)) best = { d, q }; }
        if (best) {
          const across = ((point.x - best.q.x) * point.nx + (point.y - best.q.y) * point.ny) * 1000 / (STEP_HOURS * 3600);   // m/s along the normal
          { const coldSide = at(point.x - SAMPLE_KM * point.nx * Math.sign(across || 1), point.y - SAMPLE_KM * point.ny * Math.sign(across || 1)); out.motion.push([line.type, across * point.nx, -across * point.ny, local, ((Math.atan2(tx, -ty) * 180 / Math.PI) % 180 + 180) % 180, point.x / (W * cellKm), coldSide.features.coldPoolK ?? 0, coldSide.terrain.elevationM]); }   // east, north (rows run south); axis
          if (family === 'front') out.flips.push(best.q.type !== line.type ? 1 : 0);
        }
        // Where the drawn symbols face (the analysis's symbolSide: +1 is the side (ty, -tx) of the
        // drawing direction): toward the warm air for a cold front or an outflow boundary, the cold
        // air for a warm front, the moist air for a dryline; and whether that is where the line went.
        if (line.type !== 'stationary') {
          const sx = (line.symbolSide ?? 1) * ty / tl, sy = -(line.symbolSide ?? 1) * tx / tl;
          const ahead = at(point.x + SAMPLE_KM * sx, point.y + SAMPLE_KM * sy), behind = at(point.x - SAMPLE_KM * sx, point.y - SAMPLE_KM * sy);
          const right = line.type === 'dryline' ? ahead.surface.dewpoint > behind.surface.dewpoint : line.type === 'warm' ? ahead.surface.temperature < behind.surface.temperature : ahead.surface.temperature > behind.surface.temperature;
          let moved = null;
          if (best) { const across = (point.x - best.q.x) * sx + (point.y - best.q.y) * sy; if (Math.abs(across) * 1000 / (STEP_HOURS * 3600) > 1) moved = across > 0; }
          out.facing.push([line.type, right ? 1 : 0, moved === null ? -1 : moved ? 1 : 0, (Math.atan2(sx, -sy) * 180 / Math.PI + 360) % 360]);
        }
        // Contrasts across the line.
        const a = at(point.x + SAMPLE_KM * point.nx, point.y + SAMPLE_KM * point.ny), c = at(point.x - SAMPLE_KM * point.nx, point.y - SAMPLE_KM * point.ny);
        const [warm, cold] = line.type === 'dryline' ? (a.surface.dewpoint > c.surface.dewpoint ? [a, c] : [c, a]) : (a.surface.temperature > c.surface.temperature ? [a, c] : [c, a]);
        const turn = ((cold.surface.wind.direction - warm.surface.wind.direction) % 360 + 540) % 360 - 180;
        out.contrast.push([line.type, warm.surface.temperature - cold.surface.temperature, warm.surface.dewpoint - cold.surface.dewpoint, turn, line.type === 'outflow' ? (cold.features.coldPoolK ?? 0) : 0, local]);
      }
      if (line.type === 'dryline') out.dryline.push([local, p.reduce((s, q) => s + q.x, 0) / p.length]);
    }
    // Interactions: front lines lying side by side (most of the shorter one within PAIR_KM of the
    // other and running within 30 degrees of it), fronts crossing each other, and lines per analysis.
    {
      const fronts = lines.filter(l => FAMILY[l.type] === 'front');
      const axisOf = l => { const a = l.pointsKm[0], b = l.pointsKm.at(-1); return ((Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI) % 180 + 180) % 180; };
      let doubled = null, crossed = 0;
      for (let i = 0; i < fronts.length; i++) for (let j = i + 1; j < fronts.length; j++) {
        const [a, b] = fronts[i].pointsKm.length <= fronts[j].pointsKm.length ? [fronts[i], fronts[j]] : [fronts[j], fronts[i]];
        const gaps = a.pointsKm.map(p => Math.min(...b.pointsKm.map(q => Math.hypot(p.x - q.x, p.y - q.y))));
        const near = gaps.filter(g => g < 150), turn = Math.abs(axisOf(a) - axisOf(b)) % 180, parallel = Math.min(turn, 180 - turn) < 30;
        if (Math.min(...gaps) < 10) crossed++;
        else if (near.length >= 0.5 * gaps.length && parallel) { const gap = near.reduce((s, g) => s + g, 0) / near.length; if (!doubled || gap < doubled.gap) doubled = { gap, types: [a.type, b.type].sort().join('+') }; }
      }
      out.pairs.push(doubled ? [doubled.types, doubled.gap] : null);
      out.crossings.push(crossed);
      out.counts.push(Object.fromEntries(TYPES.map(t => [t, lines.filter(l => l.type === t).length])));
    }
    // Outflow boundaries: how long each lasts (a boundary continues while one is within MATCH_KM of it).
    const outflowNow = lines.filter(l => l.type === 'outflow').map(l => ({ x: l.pointsKm.reduce((s, q) => s + q.x, 0) / l.pointsKm.length, y: l.pointsKm.reduce((s, q) => s + q.y, 0) / l.pointsKm.length }));
    const next = [];
    for (const o of outflowNow) { const t = outflowTracks.find(t => Math.hypot(t.x - o.x, t.y - o.y) < MATCH_KM && !t.taken); if (t) { t.taken = true; next.push({ ...o, age: t.age + STEP_HOURS, born: t.born }); } else next.push({ ...o, age: STEP_HOURS, born: local }); }
    for (const t of outflowTracks) if (!t.taken) out.outflowLife.push([t.age, t.born]);
    outflowTracks = next.map(t => ({ ...t, taken: false }));
    // Where the fronts lie about a closed low, in the afternoon and evening.
    if (Math.abs(hour - 21) < 1e-6 || Math.abs(hour - 3) < 1e-6) {
      for (const low of buildAnalysisOverlays(world, []).pressureCentres.filter(c => c.type === 'L')) for (const line of lines) if (line.type !== 'outflow') {
        const cx = line.pointsKm.reduce((s, q) => s + q.x, 0) / line.pointsKm.length, cy = line.pointsKm.reduce((s, q) => s + q.y, 0) / line.pointsKm.length;
        if (Math.hypot(cx - low.xKm, cy - low.yKm) < 500) out.lows.push([line.type, (Math.atan2(cx - low.xKm, -(cy - low.yKm)) * 180 / Math.PI + 360) % 360]);
      }
    }
    previous = current;
  }
  process.send({ ...out, mapKm: W * cellKm });
}

async function main() {
  const seeds = (flag('--seeds') ?? '1,2,3,4,5,6').split(',').map(Number), started = Date.now();
  const results = await Promise.all(seeds.map(seed => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [String(days), '--worker', String(seed), ...settings]);
    child.once('message', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error(`seed ${seed} exited with ${code}`)); });
  })));
  const all = key => results.flatMap(r => r[key]), mapKm = results[0].mapKm;
  const q = (v, f) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(f * (s.length - 1))] : NaN; };
  const compass = d => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((d % 360) + 360) % 360 / 45) % 8];
  console.log(`=== Boundary report: ${days} days x seeds ${seeds.join(', ')} (${((Date.now() - started) / 1000).toFixed(0)} s), ${JSON.stringify(settings)} ===`);
  console.log('\n1. Motion across the line (m/s; median, 90th) and where the moving parts (over 1 m/s) go');
  for (const t of TYPES) {
    const m = all('motion').filter(r => r[0] === t); if (!m.length) continue;
    const speed = m.map(r => Math.hypot(r[1], r[2])), moving = m.filter(r => Math.hypot(r[1], r[2]) > 1), dirs = {};
    for (const r of moving) { const d = compass(Math.atan2(r[1], r[2]) * 180 / Math.PI); dirs[d] = (dirs[d] ?? 0) + 1; }
    console.log(`  ${t.padEnd(10)} ${q(speed, 0.5).toFixed(1)} ${q(speed, 0.9).toFixed(1)}  | ${Object.entries(dirs).sort((a, b) => b[1] - a[1]).map(([d, c]) => `${d} ${Math.round(100 * c / moving.length)}%`).join(' ')}`);
  }
  const flips = all('flips');
  console.log(`  front points whose type changed since the last analysis (half an hour): ${Math.round(100 * flips.reduce((a, b) => a + b, 0) / Math.max(1, flips.length))}%`);
  console.log('\n2. Across the line, 64 km either side (median, 75th): temperature drop F, dewpoint drop F; wind turn, cold or dry side against the other (degrees, median; + veering)');
  for (const t of TYPES) {
    const c = all('contrast').filter(r => r[0] === t); if (!c.length) continue;
    console.log(`  ${t.padEnd(10)} T ${q(c.map(r => r[1]), 0.5).toFixed(1)} ${q(c.map(r => r[1]), 0.75).toFixed(1)}  Td ${q(c.map(r => r[2]), 0.5).toFixed(1)} ${q(c.map(r => r[2]), 0.75).toFixed(1)}  turn ${q(c.map(r => r[3]), 0.5).toFixed(0)} (|turn| median ${q(c.map(r => Math.abs(r[3])), 0.5).toFixed(0)})${t === 'outflow' ? `  cooling K ${q(c.map(r => r[4]), 0.5).toFixed(1)} (90th ${q(c.map(r => r[4]), 0.9).toFixed(1)})` : ''}`);
  }
  console.log('\n   Orientation of the lines (share of their length lying each way)');
  const AXES = ['N-S', 'NNE-SSW', 'NE-SW', 'ENE-WSW', 'E-W', 'ESE-WNW', 'SE-NW', 'SSE-NNW'];
  for (const t of TYPES) {
    const a = all('axis').filter(r => r[0] === t), total = a.reduce((s, r) => s + r[2], 0); if (!total) continue;
    const share = AXES.map(() => 0); for (const r of a) share[Math.round(r[1] / 22.5) % 8] += r[2] / total;
    console.log(`  ${t.padEnd(10)} ${AXES.map((n, k) => [n, share[k]]).sort((x, y) => y[1] - x[1]).map(([n, v]) => `${n} ${Math.round(100 * v)}%`).join(' ')}`);
  }
  // Cold fronts by the way they lie and the way they move.
  {
    const m = all('motion').filter(r => r[0] === 'cold' && Math.hypot(r[1], r[2]) > 1), heading = r => ((Math.atan2(r[1], r[2]) * 180 / Math.PI) + 360) % 360;
    const lies = axis => (axis < 67.5 || axis >= 157.5 ? (axis >= 157.5 || axis < 22.5 ? 'N-S' : 'NE-SW') : axis < 112.5 ? 'E-W' : 'NW-SE');
    const kind = r => { const h = heading(r), a = lies(r[4]); if ((a === 'N-S' || a === 'NE-SW') && h >= 45 && h <= 225) return 'normal'; if (a === 'E-W' && h >= 112.5 && h <= 247.5) return 'normal'; if (a === 'NW-SE' && h >= 157.5 && h <= 292.5) return 'back-door'; return 'wrong way'; };
    const counts = {}; for (const r of m) { const k = `${lies(r[4])} ${kind(r)}`; counts[k] = (counts[k] ?? 0) + 1; }
    const total = m.length, wrong = m.filter(r => kind(r) === 'wrong way').length, back = m.filter(r => kind(r) === 'back-door').length;
    const wrongs = m.filter(r => kind(r) === 'wrong way'), normals = m.filter(r => kind(r) === 'normal');
    const where = rows => `east share ${q(rows.map(r => r[5]), 0.5).toFixed(2)}, trailing side's storm cooling ${q(rows.map(r => r[6]), 0.5).toFixed(1)} K (75th ${q(rows.map(r => r[6]), 0.75).toFixed(1)}), ground ${Math.round(q(rows.map(r => r[7]), 0.5))} m, local hour ${q(rows.map(r => r[3]), 0.5)}`;
    console.log(`
   Wrong-way cold-front points: ${where(wrongs)}  |  normal ones: ${where(normals)}`);
    console.log(`   Cold fronts (moving points): normal ${Math.round(100 * (total - wrong - back) / total)}%, back-door ${Math.round(100 * back / total)}%, wrong way ${Math.round(100 * wrong / total)}%  |  ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${Math.round(100 * c / total)}%`).join(', ')}`);
    const d = all('dryAxis'), ew = d.filter(r => r[0] >= 45 && r[0] < 135);
    console.log(`   Dryline pieces lying nearer E-W than N-S: ${Math.round(100 * ew.length / Math.max(1, d.length))}%; of them within 100 km of a front: ${Math.round(100 * ew.filter(r => r[1] < 100).length / Math.max(1, ew.length))}% (N-S pieces: ${Math.round(100 * d.filter(r => !(r[0] >= 45 && r[0] < 135) && r[1] < 100).length / Math.max(1, d.length - ew.length))}%)`);
  }
  {
    const pairs = all('pairs'), found = pairs.filter(Boolean), byTypes = {};
    for (const [t] of found) byTypes[t] = (byTypes[t] ?? 0) + 1;
    console.log(`
6. Interactions: analyses with two fronts side by side (within 150 km, parallel): ${Math.round(100 * found.length / Math.max(1, pairs.length))}% (gap median ${Math.round(q(found.map(r => r[1]), 0.5))} km; ${Object.entries(byTypes).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t} ${c}`).join(', ')}); with fronts crossing: ${Math.round(100 * all('crossings').filter(c => c > 0).length / Math.max(1, pairs.length))}%`);
    const counts = all('counts');
    console.log('   lines per analysis (mean; share of analyses with 2 or more): ' + TYPES.map(t => `${t} ${(counts.reduce((s, c) => s + c[t], 0) / counts.length).toFixed(1)} (${Math.round(100 * counts.filter(c => c[t] >= 2).length / counts.length)}%)`).join(', '));
  }
  console.log('\n7. Where the symbols face: toward the right air (warm air for cold fronts and outflow, cold air for warm fronts, moist air for drylines), and the way the line moved (moving points)');
  for (const t of ['cold', 'warm', 'dryline', 'outflow']) { const f = all('facing').filter(r => r[0] === t), m = f.filter(r => r[2] >= 0); if (f.length) console.log(`  ${t.padEnd(10)} right air ${Math.round(100 * f.filter(r => r[1]).length / f.length)}%, the way it moved ${Math.round(100 * m.filter(r => r[2]).length / Math.max(1, m.length))}%`); }
  console.log('   The way the symbols face (compass; real: cold fronts E-SE-S, rarely W or N; warm fronts N-NE; drylines E; outflow any)');
  for (const t of ['cold', 'warm', 'dryline', 'outflow']) { const f = all('facing').filter(r => r[0] === t), dirs = {}; for (const r of f) { const d = compass(r[3]); dirs[d] = (dirs[d] ?? 0) + 1; } if (f.length) console.log(`  ${t.padEnd(10)} ${Object.entries(dirs).sort((a, b) => b[1] - a[1]).map(([d, c]) => `${d} ${Math.round(100 * c / f.length)}%`).join(' ')}`); }
  const dayNight = (t, k) => { const c = all('contrast').filter(r => r[0] === t), day = c.filter(r => r[5] >= 12 && r[5] < 18).map(r => r[k]), night = c.filter(r => r[5] < 6 || r[5] >= 22).map(r => r[k]); return `${q(day, 0.5).toFixed(1)} afternoon / ${q(night, 0.5).toFixed(1)} night`; };
  console.log(`  temperature drop by time of day (median, F): cold ${dayNight('cold', 1)}; stationary ${dayNight('stationary', 1)}; warm ${dayNight('warm', 1)}`);
  const dry = all('dryline'), by = h => dry.filter(r => r[0] >= h && r[0] < h + 3).map(r => r[1]);
  console.log('\n3. The dryline through the day: km from the western edge (median) by local time');
  console.log('  ' + [0, 3, 6, 9, 12, 15, 18, 21].map(h => `${h}h ${by(h).length ? Math.round(q(by(h), 0.5)) : '-'} (${by(h).length})`).join('  ') + `   [map ${Math.round(mapKm)} km]`);
  const life = all('outflowLife');
  console.log(`\n4. Outflow boundaries: last ${q(life.map(r => r[0]), 0.5)} h (median), ${q(life.map(r => r[0]), 0.9)} h (90th), ${life.length} of them; ${Math.round(100 * life.filter(r => r[0] >= 6).length / Math.max(1, life.length))}% last 6 h or more`);
  const lows = all('lows');
  console.log('\n5. Lines within 500 km of a closed low (21Z and 03Z), by where they lie from it');
  for (const t of ['cold', 'warm', 'stationary', 'dryline']) { const v = lows.filter(r => r[0] === t), dirs = {}; for (const r of v) { const d = compass(r[1]); dirs[d] = (dirs[d] ?? 0) + 1; } if (v.length) console.log(`  ${t.padEnd(10)} ${v.length}: ${Object.entries(dirs).sort((a, b) => b[1] - a[1]).map(([d, c]) => `${d} ${c}`).join(' ')}`); }
}

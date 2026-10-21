// Climate tuning, step 3 (docs/ATMOSPHERE-REDESIGN.md): how often severe weather happens.
// Runs the world with its storms and counts severe reports day by day (a day is 12Z to 12Z),
// using the same definitions the outlooks are verified with (js/verification/truth.js).
//   node scripts/activity-report.mjs [days] [--seeds 1,2,3] [--days] [key=value ...]
// key=value sets a regional-layer setting, qg.key=value one of the outer model's, steer.key=value one of
// the region steering's; --fixed keeps the region where it starts; --days lists every day.
// Steps like the server (storms every 5 minutes, the atmosphere every half hour) and looks at the
// storms every 5 minutes; --half-hour steps everything by half hours as before 2026-10-16 (pulse
// storms live under an hour; on 80 days the two gave 14% and 15% quiet days).
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 30);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const settings = args.filter(a => a.includes('='));
const ORDER = ['NONE', 'TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'];

// The time-of-day windows (local CDT hour).
function timeBand(h) { return h >= 7 && h < 13 ? 'morning' : h >= 13 && h < 20 ? 'afternoon' : h >= 20 ? 'evening' : 'overnight'; }

if (flag('--worker') !== null) await worker(Number(flag('--worker'))); else await main();

async function worker(seed) {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const { captureTruth, aggregateTruth } = await import('../js/verification/truth.js');
  const { buildStormAppearance, tornadoAppearance } = await import('../js/storms/StormAppearance.js');
  const { worldCategoryFromHazard } = await import('../js/forecast/worldRiskCategories.js');
  // Each tornado (storm and cycle): its look at its peak wind and its rating (EF from the rated wind).
  const looks = new Map();
  const efOf = mph => (mph >= 201 ? 5 : mph >= 166 ? 4 : mph >= 136 ? 3 : mph >= 111 ? 2 : mph >= 86 ? 1 : 0);
  const pairs = settings.map(a => { const [k, v] = a.split('='); return [k, Number(v)]; });
  const steer = Object.fromEntries(pairs.filter(([k]) => k.startsWith('steer.')).map(([k, v]) => [k.slice(6), v]));
  const regional = Object.fromEntries(pairs.filter(([k]) => !k.startsWith('qg.') && !k.startsWith('steer.'))), outer = Object.fromEntries(pairs.filter(([k]) => k.startsWith('qg.')).map(([k, v]) => [k.slice(3), v]));
  let model = null;
  if (Object.keys(outer).length) { const { QuasiGeostrophicModel } = await import('../js/atmosphere/QuasiGeostrophicModel.js'); model = new QuasiGeostrophicModel({ seed, ...outer }); model.advance(45 * 86400); }
  const atmosphere = new AtmosphereWorld({ seed, regional, steering: args.includes('--fixed') ? false : steer, ...(model ? { model } : {}) }), world = atmosphere.world, n = world.width * world.height;
  const daily = [];
  for (let day = 0; day < days; day++) {
    const frames = [], seen = new Set(), initiations = [], tornadoesBefore = world.stormEngine.totalTornadoes, plan = atmosphere.steering?.plan ?? null;
    const record = { storms: 0, peak: 0, hailStorms: new Set(), windStorms: new Set(), sigHail: false, sigWind: false, maxHail: 0, maxGust: 0, maxWindEf: -1, wind500: 0, shear: 0, cape: 0, speeds: [], supercell: false, groundSupercell: false, afternoonSupercell: false, tornadoKeys: [] };
    const halfHour = args.includes('--half-hour');
    for (let step = 0; step < (halfHour ? 48 : 288); step++) {
      if (halfHour) atmosphere.advance(0.5);
      else { atmosphere.advanceStormLayer(1 / 12); if ((step + 1) % 6 === 0) atmosphere.advance(0.5, { advanceStorms: false }); }
      const frame = captureTruth(world, frames, seen, initiations);
      record.peak = Math.max(record.peak, frame.activeStorms);
      for (const s of world.storms) {
        if (!s.active) continue;
        const hail = s.currentHailSizeInches ?? 0, gust = s.surfaceWind?.gustMph ?? 0;
        if (hail >= 1) record.hailStorms.add(s.id); if (gust >= 58) record.windStorms.add(s.id);
        record.maxHail = Math.max(record.maxHail, hail); record.maxGust = Math.max(record.maxGust, gust);
        // A supercell: a storm with a mesocyclone; fed from the ground: not elevated, and the ground
        // air lifted into it through little inhibition (under 100 J/kg).
        if ((s.mesocycloneStrength ?? 0) >= 0.3) {
          record.supercell = true;
          if (!s.elevatedFeed && Math.abs(s.environment?.cin ?? 999) < 100) {
            record.groundSupercell = true;
            // Any hour counts: players chase day and night.
            const localHour = ((((world.stormEngine.validHourUtc ?? world.validHourUtc) - 5) % 24) + 24) % 24;
            record.supercellBands ??= new Set(); record.supercellBands.add(timeBand(localHour));
          }
        }
        if (s.tornado?.onGround) {
          const key = `${s.id}#${s.tornado.cycleCount}`, wind = s.tornado.windSpeedMph ?? 0;
          let look = looks.get(key);
          if (!look) { look = { startHourUtc: world.stormEngine.validHourUtc ?? world.validHourUtc, peak: -1, ef: 0 }; looks.set(key, look); record.tornadoKeys.push(key); }
          look.ef = Math.max(look.ef, efOf(s.tornado.ratedWindMph ?? s.tornado.peakWindSpeedMph ?? wind));
          look.windEf = Math.max(look.windEf ?? 0, efOf(s.tornado.peakWindSpeedMph ?? wind));
          if (wind > look.peak) { const t = tornadoAppearance(s, buildStormAppearance(s)); if (t) { look.peak = wind; look.shape = t.shape; look.multi = t.vortices > 1; look.wrapped = (t.rainWrap ?? 0) >= 0.55; } }
        }
        if ((halfHour || step % 6 === 5) && (s.intensity ?? 0) >= 0.22) record.speeds.push(Math.hypot(s.velocityKph?.east ?? 0, s.velocityKph?.north ?? 0) * 0.621371);
        const since = halfHour ? world.validHourUtc - 0.5 : (world.stormEngine.validHourUtc ?? world.validHourUtc) - 1 / 12;
        if (s.tornado?.onGround || (s.tornadoHistory ?? []).some(t => t.endedHourUtc > since)) { const mph = Math.max(s.tornado?.peakWindSpeedMph ?? 0, ...(s.tornadoHistory ?? []).filter(t => t.endedHourUtc > since).map(t => t.peakWindSpeedMph ?? 0)); record.maxWindEf = Math.max(record.maxWindEf, mph >= 200 ? 5 : mph >= 166 ? 4 : mph >= 136 ? 3 : mph >= 111 ? 2 : mph >= 86 ? 1 : 0); }
      }
      if (Math.abs(((world.validHourUtc % 24) + 24) % 24 - 22) < 1e-6) {
        const unstable = []; world.forEachCell(cell => { if (cell.derived.sounding.mlcape >= 1000) unstable.push(cell); });
        const median = values => { const v = values.sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0; };
        record.cape = median(unstable.map(c => c.derived.sounding.mlcape)); record.shear = median(unstable.map(c => c.derived.bulkShear)); record.wind500 = median(unstable.map(c => c.levels[500].windSpeed));
      }
    }
    const truth = aggregateTruth(frames, initiations, world.width, world.height, 25 / world.cellSizeMiles, world.cellSizeMiles);
    const order = truth.risk.map(r => ORDER.indexOf(r)), share = level => order.filter(o => o >= ORDER.indexOf(level)).length / n, any = field => truth[`${field}Exact`].some(Boolean);
    daily.push({
      seed, day: day + 1, support: plan?.support ?? null, wanted: plan?.wanted ?? null, slideMs: plan?.slideMs ?? null, storms: seen.size, peak: record.peak, tornadoes: world.stormEngine.totalTornadoes - tornadoesBefore,
      hailStorms: record.hailStorms.size, windStorms: record.windStorms.size, maxHail: record.maxHail, maxGust: record.maxGust, maxWindEf: record.maxWindEf,
      severe: any('hail') || any('wind') || any('tornado'), tornado: any('tornado'), sigTornado: any('tornadoSig'), sigHail: any('hailSig'), sigWind: any('windSig'),
      category: ORDER[Math.max(...order)], worldCategory: ORDER[Math.max(...truth.worldRisk.map(r => ORDER.indexOf(r)))], worldSlightArea: truth.worldRisk.filter(r => ORDER.indexOf(r) >= ORDER.indexOf('SLGT')).length / n, worldEnhancedArea: truth.worldRisk.filter(r => ORDER.indexOf(r) >= ORDER.indexOf('ENH')).length / n, slightArea: share('SLGT'), enhancedArea: share('ENH'), cape: record.cape, shear: record.shear, wind500: record.wind500,
      supercell: record.supercell, groundSupercell: record.groundSupercell, afternoonSupercell: record.afternoonSupercell, supercellBands: [...(record.supercellBands ?? [])],
      tornadoList: record.tornadoKeys.map(k => { const l = looks.get(k); return { start: l.startHourUtc, ef: l.ef, windEf: l.windEf ?? l.ef, shape: l.shape ?? 'unseen', multi: Boolean(l.multi), wrapped: Boolean(l.wrapped) }; }),
      // What drives the day's category: the category each hazard alone reaches somewhere, and the
      // highest intensity group each verified with.
      byHazard: Object.fromEntries(['tornado', 'wind', 'hail'].map(h => { let top = 0; for (let i = 0; i < n; i++) { const c = worldCategoryFromHazard(h, truth.observedProbability[h][i], truth.observedCig[h][i]); if (c) top = Math.max(top, ORDER.indexOf(c)); } return [h, { top, cig: Math.max(0, ...truth.observedCig[h]) }]; })),
      stormMph: record.speeds.length ? record.speeds.sort((a, b) => a - b)[Math.floor(record.speeds.length / 2)] : null
    });
  }
  process.send(daily);
}

async function main() {
  const seeds = (flag('--seeds') ?? '1,2,3').split(',').map(Number), started = Date.now();
  const results = await Promise.all(seeds.map(seed => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [String(days), '--worker', String(seed), ...settings, ...['--fixed', '--half-hour'].filter(a => args.includes(a))]);
    child.once('message', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error(`seed ${seed} exited with ${code}`)); });
  })));
  const all = results.flat(), pct = (a, q) => { const v = [...a].sort((x, y) => x - y); return v[Math.floor(q * (v.length - 1))]; };
  const share = test => `${Math.round(100 * all.filter(test).length / all.length)}%`;
  console.log(`=== Activity report: ${days} days x seeds ${seeds.join(', ')} = ${all.length} days (${((Date.now() - started) / 1000).toFixed(0)} s), ${JSON.stringify(settings)} ===`);
  if (args.includes('--days')) {
    console.log('seed day  storms peak tor  hail>=1in wind>=58  maxHail maxGust  category  SLGT+area | CAPE shear 500mb(kt)');
    for (const d of all) console.log(`${String(d.seed).padStart(4)} ${String(d.day).padStart(3)} ${String(d.storms).padStart(7)} ${String(d.peak).padStart(4)} ${String(d.tornadoes).padStart(3)} ${String(d.hailStorms).padStart(10)} ${String(d.windStorms).padStart(8)} ${d.maxHail.toFixed(2).padStart(8)} ${d.maxGust.toFixed(0).padStart(7)}  ${d.category.padEnd(8)} ${(100 * d.slightArea).toFixed(0).padStart(8)}% | ${String(Math.round(d.cape)).padStart(4)} ${String(Math.round(d.shear)).padStart(5)} ${String(Math.round(d.wind500)).padStart(5)}`);
  }
  // Quiet = no severe report anywhere on the map that day.
  const runs = []; for (const seedDays of results) { let run = 0; for (const d of seedDays) { if (d.severe) { if (run) runs.push(run); run = 0; } else run++; } if (run) runs.push(run); }
  console.log(`\nquiet days (no severe report anywhere): ${share(d => !d.severe)}  [about 5%] | longest run of quiet days: ${runs.length ? Math.max(...runs) : 0}  [1-2] | quiet runs of 2 or more: ${runs.filter(r => r >= 2).length}`);
  console.log(`days without any storm: ${share(d => d.storms === 0)}`);
  const mix = Object.fromEntries(ORDER.map(k => [k, all.filter(d => d.category === k).length]));
  console.log(`strongest category of the day by the real-world rules: ${ORDER.filter(k => mix[k]).map(k => `${k} ${Math.round(100 * mix[k] / all.length)}%`).join(', ')}  [aim: HIGH 5, MDT 20, ENH 40, SLGT 30, less 5]`);
  const worldMix = Object.fromEntries(ORDER.map(k => [k, all.filter(d => d.worldCategory === k).length]));
  console.log(`this world's categories (js/forecast/worldRiskCategories.js): ${ORDER.filter(k => worldMix[k]).map(k => `${k} ${Math.round(100 * worldMix[k] / all.length)}%`).join(', ')}  [aim: HIGH 5, MDT 20, ENH 40, SLGT 30, less 5] | share of the map at Slight or more: median ${(100 * pct(all.map(d => d.worldSlightArea), 0.5)).toFixed(0)}%, at Enhanced or more: ${(100 * pct(all.map(d => d.worldEnhancedArea), 0.5)).toFixed(0)}%`);
  { const t = all.map(d => d.tornadoes), mph = all.map(d => d.stormMph).filter(v => v !== null);
    console.log(`tornadoes a day: mean ${(t.reduce((a, b) => a + b, 0) / Math.max(1, t.length)).toFixed(1)} | days with 30+: ${share(d => d.tornadoes >= 30)}, 60+: ${share(d => d.tornadoes >= 60)} | storm speed (median of the days' medians): ${mph.length ? pct(mph, 0.5).toFixed(0) : '-'} mph`); }
  console.log(`days with a supercell: ${share(d => d.supercell)}, fed from the ground: ${share(d => d.groundSupercell)} | days without a tornado that had a ground-fed supercell: ${Math.round(100 * all.filter(d => !d.tornado && d.groundSupercell).length / Math.max(1, all.filter(d => !d.tornado).length))}%`);
  // --- For the game: droughts, chaseable afternoons, what drives the categories, tornado ratings and looks.
  {
    const bySeed = new Map(); for (const d of all) { if (!bySeed.has(d.seed)) bySeed.set(d.seed, []); bySeed.get(d.seed).push(d); }
    const streaks = [], gaps = [];
    for (const rows of bySeed.values()) {
      rows.sort((a, b) => a.day - b.day);
      let run = 0; for (const d of rows) { if (d.tornado) { if (run) streaks.push(run); run = 0; } else run++; } if (run) streaks.push(run);
      const starts = rows.flatMap(d => d.tornadoList.map(t => t.start)).sort((a, b) => a - b);
      for (let i = 1; i < starts.length; i++) gaps.push((starts[i] - starts[i - 1]) / 12);   // real hours at the 12x clock
    }
    const g = [...gaps].sort((a, b) => a - b), at = f => (g.length ? g[Math.floor(f * (g.length - 1))] : 0);
    console.log('\nFor the game (a game day is 2 real hours):');
    console.log(`  tornado-free days in a row: ${streaks.filter(r => r === 1).length} single, ${streaks.filter(r => r === 2).length} pairs, ${streaks.filter(r => r >= 3).length} runs of 3+ (longest ${Math.max(0, ...streaks)})`);
    console.log(`  real time between tornadoes: median ${at(0.5).toFixed(1)} h, 90th ${at(0.9).toFixed(1)} h, longest ${(g.at(-1) ?? 0).toFixed(1)} h; gaps over 4 real hours: ${g.filter(x => x > 4).length} of ${g.length}`);
    // Players chase day and night: a day is chaseable when a ground-fed supercell is on the map at any hour.
    console.log(`  chaseable days (a ground-fed supercell at any hour, day or night): ${share(d => d.supercellBands.length > 0)} | with a tornado at any hour: ${share(d => d.tornado)}`);
    console.log("  what reaches the day's category (days; the hazards that alone reach it):");
    for (const c of ['MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH']) {
      const rows = all.filter(d => d.worldCategory === c), k = ORDER.indexOf(c); if (!rows.length) continue;
      const kinds = {};
      for (const d of rows) { const top = ['tornado', 'wind', 'hail'].filter(h => d.byHazard[h].top >= k); const name = top.length > 1 ? 'mix (' + top.join('+') + ')' : top[0] ? top[0] + ' only' : 'none'; kinds[name] = (kinds[name] ?? 0) + 1; }
      console.log(`    ${c.padEnd(5)} ${String(rows.length).padStart(3)}: ${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([nm, v]) => `${nm} ${Math.round(100 * v / rows.length)}%`).join(', ')}`);
    }
    const bigDays = all.filter(d => d.worldCategory === 'MDT' || d.worldCategory === 'HIGH');
    console.log('  intensity groups verified (share of days with each as the highest):');
    for (const h of ['tornado', 'wind', 'hail']) {
      const tiers = h === 'hail' ? [0, 1, 2] : [0, 1, 2, 3];
      console.log(`    ${h.padEnd(8)} ${tiers.map(c => `${c ? 'CIG' + c : 'none'} ${share(d => d.byHazard[h].cig === c)}`).join('  ')}  | on Moderate and High days: ${tiers.slice(1).map(c => `CIG${c}+ ${Math.round(100 * bigDays.filter(d => d.byHazard[h].cig >= c).length / Math.max(1, bigDays.length))}%`).join(' ')}`);
    }
    const tor = all.flatMap(d => d.tornadoList), count = fn => { const c = {}; for (const t of tor) { const k = fn(t); c[k] = (c[k] ?? 0) + 1; } return c; };
    const efs = count(t => 'EF' + t.ef), windEfs = count(t => 'EF' + t.windEf), shapes = count(t => t.shape);
    console.log(`  tornadoes (${tor.length}): ${[0, 1, 2, 3, 4, 5].map(e => `EF${e} ${(100 * (efs['EF' + e] ?? 0) / Math.max(1, tor.length)).toFixed(1)}%`).join('  ')}   [US record 2008-22 about EF0 52%, EF1 35%, EF2 9%, EF3 2.4%, EF4 0.45%, EF5 0.05%]`);
    console.log(`  their peak wind on the same scale (what a radar would measure near the ground): ${[0, 1, 2, 3, 4, 5].map(e => `EF${e} ${(100 * (windEfs['EF' + e] ?? 0) / Math.max(1, tor.length)).toFixed(1)}%`).join('  ')}   [mobile radar: about 1-1.5 categories above the ratings, EF4+ winds in roughly 10-20% of supercell tornadoes]
  their look at peak wind: ${Object.entries(shapes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(100 * v / Math.max(1, tor.length))}%`).join(', ')} | multi-vortex ${Math.round(100 * tor.filter(t => t.multi).length / Math.max(1, tor.length))}%, rain-wrapped ${Math.round(100 * tor.filter(t => t.wrapped).length / Math.max(1, tor.length))}%`);
    for (const e of [0, 1, 2, 3, 4, 5]) { const these = tor.filter(t => t.ef === e); if (!these.length) continue; const sh = {}; for (const t of these) sh[t.shape] = (sh[t.shape] ?? 0) + 1; console.log(`    EF${e} (${these.length}): ${Object.entries(sh).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(100 * v / these.length)}%`).join(', ')}`); }
  }
  console.log(`days with: 1 in hail ${share(d => d.hailStorms > 0)}, 58 mph wind ${share(d => d.windStorms > 0)}, a tornado ${share(d => d.tornado)}, 2 in hail ${share(d => d.sigHail)}, 75 mph wind ${share(d => d.sigWind)}, a tornado rated EF2+ ${share(d => d.sigTornado)}, a tornado with EF2+ winds ${share(d => d.maxWindEf >= 2)}`);
  console.log(`per day: storms median ${pct(all.map(d => d.storms), 0.5)} (90th ${pct(all.map(d => d.storms), 0.9)}, most ${pct(all.map(d => d.storms), 1)}) | tornadoes median ${pct(all.map(d => d.tornadoes), 0.5)} (90th ${pct(all.map(d => d.tornadoes), 0.9)}, most ${pct(all.map(d => d.tornadoes), 1)}) | largest hail median ${pct(all.map(d => d.maxHail), 0.5).toFixed(2)} in (90th ${pct(all.map(d => d.maxHail), 0.9).toFixed(2)}) | strongest gust median ${pct(all.map(d => d.maxGust), 0.5).toFixed(0)} mph (90th ${pct(all.map(d => d.maxGust), 0.9).toFixed(0)})`);
  console.log(`share of the map at Slight or more: median ${(100 * pct(all.map(d => d.slightArea), 0.5)).toFixed(0)}% (90th ${(100 * pct(all.map(d => d.slightArea), 0.9)).toFixed(0)}%) | at Enhanced or more: median ${(100 * pct(all.map(d => d.enhancedArea), 0.5)).toFixed(0)}% (90th ${(100 * pct(all.map(d => d.enhancedArea), 0.9)).toFixed(0)}%)`);
  if (all.some(d => d.support !== null)) {
    // How the day turned out against the large-scale support the steering put over the region.
    console.log('by large-scale support over the region (steering):   days | Slight or more | Moderate or more | High | tornadoes median | storms median | missed the wanted support by');
    for (const [low, high] of [[0, 0.15], [0.15, 0.3], [0.3, 0.45], [0.45, 0.6], [0.6, 1.01]]) {
      const rows = all.filter(d => d.support >= low && d.support < high); if (!rows.length) continue;
      const part = level => `${Math.round(100 * rows.filter(d => ORDER.indexOf(d.category) >= ORDER.indexOf(level)).length / rows.length)}%`;
      console.log(`  ${low.toFixed(2)}-${Math.min(1, high).toFixed(2)}`.padEnd(52) + `${String(rows.length).padStart(5)} | ${part('SLGT').padStart(14)} | ${part('MDT').padStart(16)} | ${part('HIGH').padStart(4)} | ${String(pct(rows.map(d => d.tornadoes), 0.5)).padStart(16)} | ${String(pct(rows.map(d => d.storms), 0.5)).padStart(13)} | ${pct(rows.map(d => Math.abs(d.support - d.wanted)), 0.5).toFixed(2)}`);
    }
  }
  const quiet = all.filter(d => !d.severe), active = all.filter(d => d.severe), med = (rows, key) => (rows.length ? Math.round(pct(rows.map(d => d[key]), 0.5)) : '-');
  console.log(`quiet days against the rest, afternoon medians in the unstable air: CAPE ${med(quiet, 'cape')} / ${med(active, 'cape')}, shear ${med(quiet, 'shear')} / ${med(active, 'shear')} kt, 500 mb wind ${med(quiet, 'wind500')} / ${med(active, 'wind500')} kt, storms ${med(quiet, 'storms')} / ${med(active, 'storms')}`);
}

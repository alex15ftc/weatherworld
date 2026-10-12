// Stage 4 of the atmosphere redesign: runs the storm engine on the redesigned atmosphere and
// reports how the storms behave against the reference numbers (docs/ATMOSPHERE-REDESIGN.md).
//   node scripts/storm-prototype.mjs [days] [--seed n] [key=value ...]
// key=value sets a regional-layer setting. A day runs 12Z to 12Z.
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { MEAN_WIND_WEIGHTS } from '../js/storms/environmentSampling.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 8);
const seed = Number(args.includes('--seed') ? args[args.indexOf('--seed') + 1] : 1);
const regional = Object.fromEntries(args.filter(a => a.includes('=')).map(a => { const [k, v] = a.split('='); return [k, Number(v)]; }));
const pct = (a, q) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[Math.floor(q * (v.length - 1))] : NaN; };
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '-');
const angle = (a, b) => Math.atan2(a.u * b.v - a.v * b.u, a.u * b.u + a.v * b.v) * 180 / Math.PI;   // + = b is left of a
const efOf = mph => (mph >= 200 ? 5 : mph >= 166 ? 4 : mph >= 136 ? 3 : mph >= 111 ? 2 : mph >= 86 ? 1 : 0);

const started = performance.now();
const atmosphere = new AtmosphereWorld({ seed, regional });
const world = atmosphere.world, spinSeconds = (performance.now() - started) / 1000;
const seen = new Map(), initiationHour = new Array(24).fill(0), daily = [], forcing = {}, nearLine = { front: 0, dryline: 0, outflow: 0, none: 0 }, pools = [];
// Lift each source can supply at full strength (J/kg), as the initiation engine weighs them.
const LIFT = { boundary: 170, synoptic: 60, terrain: 90, outflow: 150, thermals: 30 };
const distanceTo = (line, x, y) => Math.min(...line.pointsKm.map(p => Math.hypot(p.x - x, p.y - y)));
const runStarted = performance.now();
for (let day = 0; day < days; day++) {
  const record = { storms: 0, peak: 0, tornadoes: 0, maxEf: -1, hail: 0, gust: 0, severeStorms: new Set(), cape: 0, shear: 0, srh: 0, cin: 0, lift: 0, ascent: 0, lines: '' };
  const tornadoesBefore = world.stormEngine.totalTornadoes;
  for (let step = 0; step < 48; step++) {
    atmosphere.advance(0.5);
    const hour = world.validHourUtc, utc = ((hour % 24) + 24) % 24;
    if (utc === 22) {
      // The afternoon environment where it matters: the moist, unstable part of the map.
      const cells = []; world.forEachCell(cell => { if ((cell.derived.sounding?.mlcape ?? 0) >= 1000) cells.push(cell); });
      record.unstableShare = cells.length / (world.width * world.height);
      record.cape = pct(cells.map(c => c.derived.sounding.mlcape), 0.5); record.cin = pct(cells.map(c => Math.abs(c.derived.sounding.mlcin)), 0.5);
      record.shear = pct(cells.map(c => c.derived.bulkShear), 0.5); record.srh = pct(cells.map(c => c.derived.srh), 0.9); record.stp = pct(cells.map(c => c.derived.stp ?? 0), 0.95);
      record.lift = pct(cells.map(c => c.features.convergenceLift), 0.98); record.ascent = pct(cells.map(c => c.features.synopticAscent), 0.9);
      record.lines = atmosphere.boundaries.map(b => b.type[0].toUpperCase()).sort().join('');
    }
    if (utc === 1) {
      const pool = atmosphere.regional.coldPool; let area = 0, deepest = 0; for (const v of pool) { if (v >= 1.5) area++; deepest = Math.max(deepest, v); }
      pools.push({ area: area / pool.length, deepestF: deepest * 1.8, outflows: atmosphere.boundaries.filter(b => b.type === 'outflow').length });
    }
    let active = 0;
    for (const s of world.storms) {
      if (!s.active && !seen.has(s.id)) continue;
      const r = seen.get(s.id) ?? { born: s.createdHourUtc, speeds: [], deviations: [], speedRatio: [], lineSpeedRatio: [], hail: 0, gust: 0, rotating: 0, line: 0, n: 0, elevated: Boolean(s.elevatedFeed), left: Boolean(s.leftMover), source: s.sourceCell?.forcingComponents };
      if (!seen.has(s.id)) {
        seen.set(s.id, r); record.storms++; initiationHour[Math.floor(((s.createdHourUtc % 24) + 24) % 24)]++;
        const top = Object.entries(r.source ?? {}).sort((a, b) => b[1] * LIFT[b[0]] - a[1] * LIFT[a[0]])[0]?.[0] ?? 'unknown'; forcing[top] = (forcing[top] ?? 0) + 1;
        // Which analysed line, if any, it formed within 40 miles of.
        const close = atmosphere.boundaries.map(line => ({ type: line.type, d: distanceTo(line, s.positionKm.x, s.positionKm.y) })).filter(l => l.d <= 64).sort((a, b) => a.d - b.d)[0];
        nearLine[!close ? 'none' : close.type === 'dryline' || close.type === 'outflow' ? close.type : 'front']++;
      }
      if (!s.active) { r.ended ??= hour; continue; }
      active++;
      const e = s.environment ?? {}, motion = { u: s.velocityKph.east / 1.852, v: s.velocityKph.north / 1.852 };
      if (e.wind850 && e.wind500) {
        const meanWind = { u: e.surfaceWind.eastKt * MEAN_WIND_WEIGHTS.surface + e.wind850.eastKt * MEAN_WIND_WEIGHTS[850] + e.wind500.eastKt * MEAN_WIND_WEIGHTS[500], v: e.surfaceWind.northKt * MEAN_WIND_WEIGHTS.surface + e.wind850.northKt * MEAN_WIND_WEIGHTS[850] + e.wind500.northKt * MEAN_WIND_WEIGHTS[500] };
        const ratio = Math.hypot(motion.u, motion.v) / Math.max(1, Math.hypot(meanWind.u, meanWind.v));
        // The turn is measured only while the storm is rotating and not part of a line: that is when it should be turning right.
        if ((s.mesocycloneStrength ?? 0) >= 0.35 && (s.lineOrganization ?? 0) < 0.3) { r.deviations.push(angle(meanWind, motion)); r.speedRatio.push(ratio); }
        if ((s.lineOrganization ?? 0) >= 0.5) r.lineSpeedRatio.push(ratio);
      }
      const hail = s.currentHailSizeInches ?? 0, gust = s.surfaceWind?.gustMph ?? 0;
      r.speeds.push(Math.hypot(motion.u, motion.v) * 1.15078);
      r.hail = Math.max(r.hail, hail); r.gust = Math.max(r.gust, gust); r.peak = Math.max(r.peak ?? 0, s.intensity ?? 0);
      r.rotating += (s.mesocycloneStrength ?? 0) >= 0.25 ? 1 : 0; r.line += (s.lineOrganization ?? 0) >= 0.5 ? 1 : 0; r.n++; r.last = hour; r.storm = s;
      record.hail = Math.max(record.hail, hail); record.gust = Math.max(record.gust, gust);
      if (hail >= 1 || gust >= 58 || s.tornado?.onGround) record.severeStorms.add(s.id);
      if (s.tornado?.onGround) record.maxEf = Math.max(record.maxEf, efOf(s.tornado.peakWindSpeedMph ?? 0));
    }
    record.peak = Math.max(record.peak, active);
  }
  record.tornadoes = world.stormEngine.totalTornadoes - tornadoesBefore;
  daily.push(record);
}
const runSeconds = (performance.now() - runStarted) / 1000;

const storms = [], tornadoes = [];
for (const r of seen.values()) {
  storms.push({ life: (r.ended ?? r.last ?? r.born) - r.born, speed: mean(r.speeds), deviation: pct(r.deviations, 0.5), speedRatio: pct(r.speedRatio, 0.5), lineSpeedRatio: pct(r.lineSpeedRatio, 0.5), hail: r.hail, gust: r.gust, peak: r.peak ?? 0, rotatingShare: r.n ? r.rotating / r.n : 0, lineShare: r.n ? r.line / r.n : 0, elevated: r.elevated, left: r.left });
  for (const t of r.storm?.tornadoHistory ?? []) tornadoes.push({ minutes: t.groundTimeMinutes, miles: (t.pathLengthKm ?? 0) / 1.609, yards: t.peakWidthYards, mph: t.peakWindSpeedMph, ratedMph: t.ratedWindMph ?? t.peakWindSpeedMph });
}

console.log(`=== Storms on the redesigned atmosphere: ${days} days, seed ${seed}, ${JSON.stringify(regional)} ===`);
console.log(`speed: spin-up ${spinSeconds.toFixed(0)} s; ${(runSeconds / days).toFixed(1)} s per simulated day`);
console.log(`\n1. Day by day (12Z-12Z). Afternoon values are for the part of the map with CAPE >= 1,000.`);
console.log('  day  storms peak severe  tor maxEF  hail(in) gust(mph) | unstable  CAPE  CIN shear SRH90 STP95 lift98 ascent90 lines');
daily.forEach((d, i) => console.log(`  ${String(i + 1).padStart(3)} ${String(d.storms).padStart(7)} ${String(d.peak).padStart(4)} ${String(d.severeStorms.size).padStart(6)} ${String(d.tornadoes).padStart(4)} ${(d.maxEf >= 0 ? 'EF' + d.maxEf : '-').padStart(5)} ${fmt(d.hail, 2).padStart(9)} ${fmt(d.gust).padStart(9)} | ${fmt(100 * (d.unstableShare ?? 0)).padStart(7)}% ${fmt(d.cape).padStart(5)} ${fmt(d.cin).padStart(4)} ${fmt(d.shear).padStart(5)} ${fmt(d.srh).padStart(5)} ${fmt(d.stp, 1).padStart(5)} ${fmt(d.lift, 2).padStart(6)} ${fmt(d.ascent, 2).padStart(8)} ${d.lines || '-'}`));
const count = test => daily.filter(test).length;
console.log(`  days with: any storm ${count(d => d.storms > 0)}/${days}, a severe storm ${count(d => d.severeStorms.size > 0)}/${days} [about 19 in 20], 2 in+ hail ${count(d => d.hail >= 2)}, 75 mph+ wind ${count(d => d.gust >= 75)}, a tornado ${count(d => d.tornadoes > 0)}, an EF2+ ${count(d => d.maxEf >= 2)}`);
console.log(`  per day: storms median ${fmt(pct(daily.map(d => d.storms), 0.5))} (max ${Math.max(...daily.map(d => d.storms))}), tornadoes median ${fmt(pct(daily.map(d => d.tornadoes), 0.5))} (90th ${fmt(pct(daily.map(d => d.tornadoes), 0.9))}, max ${Math.max(...daily.map(d => d.tornadoes))})`);

const S = storms, rotatingAll = S.filter(s => s.rotatingShare >= 0.5 && s.lineShare < 0.5), rotating = rotatingAll.filter(s => !s.left), leftMovers = rotatingAll.filter(s => s.left), lines = S.filter(s => s.lineShare >= 0.5);
console.log(`\n2. Storms (${S.length}; ${S.filter(s => s.elevated).length} elevated)`);
if (S.length) {
  console.log(`  largest source of lift where they formed: ${Object.entries(forcing).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${Math.round(100 * n / S.length)}%`).join(', ')}`);
  console.log(`  formed within 40 miles of: a front ${Math.round(100 * nearLine.front / S.length)}%, the dryline ${Math.round(100 * nearLine.dryline / S.length)}%, an outflow boundary ${Math.round(100 * nearLine.outflow / S.length)}%, no line ${Math.round(100 * nearLine.none / S.length)}%`);
  console.log(`  cold pools at 01Z: cover ${fmt(100 * pct(pools.map(q => q.area), 0.5))}% of the map at the median (most ${fmt(100 * Math.max(...pools.map(q => q.area)))}%), deepest ${fmt(pct(pools.map(q => q.deepestF), 0.5))} F at the median (${fmt(Math.max(...pools.map(q => q.deepestF)))} F at most) [10-20 F under strong storms] | outflow boundaries analysed: ${fmt(mean(pools.map(q => q.outflows)), 1)} per evening`);
  console.log(`  initiation by UTC hour: ${initiationHour.map((n, h) => `${h}:${n}`).join(' ')}  [peak 20-00Z, secondary overnight]`);
  console.log(`  lifetime h: median ${fmt(pct(S.map(s => s.life), 0.5), 1)}, 90th ${fmt(pct(S.map(s => s.life), 0.9), 1)} [ordinary 0.5-1, supercell 2-4+] | forward speed mph: median ${fmt(pct(S.map(s => s.speed), 0.5))}, 90th ${fmt(pct(S.map(s => s.speed), 0.9))} [25-45]`);
  console.log(`  character: rotating ${Math.round(100 * rotatingAll.length / S.length)}% (${Math.round(100 * leftMovers.length / Math.max(1, rotatingAll.length))}% of those are left-moving splits), lines ${Math.round(100 * lines.length / S.length)}% | peak strength (0-1): median ${fmt(pct(S.map(s => s.peak), 0.5), 2)}, 90th ${fmt(pct(S.map(s => s.peak), 0.9), 2)}`);
  console.log(`  right-moving rotating storms (${rotating.length}): motion ${fmt(pct(rotating.map(s => s.deviation), 0.5))} degrees from the 0-6 km mean wind [20-30 right = -20 to -30], speed ${fmt(pct(rotating.map(s => s.speedRatio), 0.5), 2)} of it [0.75-1.1] | left-movers (${leftMovers.length}): ${fmt(pct(leftMovers.map(s => s.deviation), 0.5))} degrees | lines (${lines.length}): speed ${fmt(pct(lines.map(s => s.lineSpeedRatio), 0.5), 2)} of it [1.0-1.3]`);
  console.log(`  peak hail in: median ${fmt(pct(S.map(s => s.hail), 0.5), 2)}, 90th ${fmt(pct(S.map(s => s.hail), 0.9), 2)}, largest ${fmt(pct(S.map(s => s.hail), 1), 2)} | peak gust mph: median ${fmt(pct(S.map(s => s.gust), 0.5))}, 90th ${fmt(pct(S.map(s => s.gust), 0.9))}, strongest ${fmt(pct(S.map(s => s.gust), 1))}`);
  console.log(`  storms reaching: 1 in hail ${Math.round(100 * S.filter(s => s.hail >= 1).length / S.length)}%, 2 in ${Math.round(100 * S.filter(s => s.hail >= 2).length / S.length)}%, 58 mph ${Math.round(100 * S.filter(s => s.gust >= 58).length / S.length)}%, 75 mph ${Math.round(100 * S.filter(s => s.gust >= 75).length / S.length)}%`);
}
console.log(`\n3. Tornadoes (${tornadoes.length} finished, ${world.stormEngine.totalTornadoes} in all)`);
if (tornadoes.length) {
  const counts = [0, 0, 0, 0, 0, 0], byWind = [0, 0, 0, 0, 0, 0]; for (const t of tornadoes) { counts[efOf(t.ratedMph ?? 0)]++; byWind[efOf(t.mph ?? 0)]++; }
  console.log(`  damage ratings: ${counts.map((n, i) => `EF${i} ${Math.round(100 * n / tornadoes.length)}%`).join(', ')}  [real ratings: EF0 64, EF1 26, EF2 7.6, EF3 2.2, EF4 0.4]`);
  console.log(`  by peak wind alone: ${byWind.map((n, i) => `EF${i} ${Math.round(100 * n / tornadoes.length)}%`).join(', ')}  [stronger than the ratings: radar measurements put a quarter or more at EF2 winds and above]`);
  console.log(`  time on ground min: median ${fmt(pct(tornadoes.map(t => t.minutes), 0.5))}, 90th ${fmt(pct(tornadoes.map(t => t.minutes), 0.9))} [about 5 / 20] | path miles: median ${fmt(pct(tornadoes.map(t => t.miles), 0.5), 1)}, 90th ${fmt(pct(tornadoes.map(t => t.miles), 0.9), 1)} [about 1-2 / 10] | width yards: median ${fmt(pct(tornadoes.map(t => t.yards), 0.5))}, 90th ${fmt(pct(tornadoes.map(t => t.yards), 0.9))} [about 50-75 / 300]`);
}

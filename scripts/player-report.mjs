// What a player would find: how often there is something to chase, how long the waits are,
// and how close the weather comes to a place on the map.
//   node scripts/player-report.mjs [days] [--seeds 1,2,3] [--fixed]
// A day is 12Z to 12Z. Places are a 5 x 5 spread of points across the map (each stands for
// one 10 x 10 mile game place). --fixed keeps the region where it starts.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 30);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const KM_PER_MILE = 1.609344, STEP = 0.5, CHASEABLE_MINUTES = 10;

if (flag('--worker') !== null) await worker(Number(flag('--worker'))); else await main();

async function worker(seed) {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const atmosphere = new AtmosphereWorld({ seed, steering: args.includes('--fixed') ? false : {} }), world = atmosphere.world;
  const places = []; for (let j = 1; j <= 5; j++) for (let i = 1; i <= 5; i++) places.push({ x: world.domainWidthKm * i / 6, y: world.domainHeightKm * j / 6 });
  const tornadoes = new Map(), daily = [], start = world.validHourUtc;
  const note = (id, t, fallback) => {
    if (t.startedHourUtc == null) return;
    const key = `${id}|${t.cycle ?? t.cycleCount}|${t.startedHourUtc}`, points = (t.trackPoints ?? []).length ? t.trackPoints : [fallback];
    tornadoes.set(key, { start: t.startedHourUtc, end: t.endedHourUtc ?? world.validHourUtc, minutes: t.groundTimeMinutes ?? 0, pathKm: t.pathLengthKm ?? 0, mph: t.peakWindSpeedMph ?? 0, rated: t.ratedWindMph ?? t.peakWindSpeedMph ?? 0, points: points.filter(Boolean).map(p => ({ x: p.x, y: p.y })) });
  };
  for (let day = 0; day < days; day++) {
    const d = { seed, day, severeSteps: 0, stormSteps: 0, tornadoSteps: 0, place: places.map(() => ({ storm: 1e9, severe: 1e9, strong: 1e9 })) };
    for (let step = 0; step < 24 / STEP; step++) {
      atmosphere.advance(STEP);
      let severe = false, any = false, onGround = false;
      for (const s of world.storms) {
        for (const t of s.tornadoHistory ?? []) note(s.id, t, s.positionKm);
        if (s.tornado?.onGround) { onGround = true; note(s.id, { ...s.tornado, cycle: s.tornado.cycleCount, endedHourUtc: world.validHourUtc }, s.positionKm); }
        if (!s.active || s.intensity < 0.25) continue;
        const isSevere = (s.currentHailSizeInches ?? 0) >= 1 || (s.surfaceWind?.gustMph ?? 0) >= 58 || s.tornado?.onGround, isStrong = (s.currentHailSizeInches ?? 0) >= 2 || (s.surfaceWind?.gustMph ?? 0) >= 75;
        any = true; severe ||= isSevere;
        places.forEach((p, k) => { const km = Math.hypot(s.positionKm.x - p.x, s.positionKm.y - p.y); d.place[k].storm = Math.min(d.place[k].storm, km); if (isSevere) d.place[k].severe = Math.min(d.place[k].severe, km); if (isStrong) d.place[k].strong = Math.min(d.place[k].strong, km); });
      }
      for (const record of world.stormArchive ?? []) for (const t of record.tornadoHistory ?? []) note(record.id, t, null);
      if (severe) d.severeSteps++; if (any) d.stormSteps++; if (onGround) d.tornadoSteps++;
    }
    daily.push(d);
  }
  process.send({ seed, start, daily, places, tornadoes: [...tornadoes.values()] });
}

async function main() {
  const seeds = (flag('--seeds') ?? '1,2,3').split(',').map(Number), started = Date.now();
  const results = await Promise.all(seeds.map(seed => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [String(days), '--worker', String(seed), ...(args.includes('--fixed') ? ['--fixed'] : [])]);
    child.once('message', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error(`seed ${seed} exited with ${code}`)); });
  })));
  const pct = (a, q) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[Math.floor(q * (v.length - 1))] : NaN; };
  const share = (rows, test) => (rows.length ? `${Math.round(100 * rows.filter(test).length / rows.length)}%` : '-');
  const ef = mph => (mph >= 200 ? 5 : mph >= 166 ? 4 : mph >= 136 ? 3 : mph >= 111 ? 2 : mph >= 86 ? 1 : 0);
  const dayRows = [], placeDays = [], gaps = [], all = [];
  for (const r of results) {
    const dayOf = hour => Math.floor((hour - r.start) / 24), sorted = [...r.tornadoes].sort((a, b) => a.start - b.start);
    all.push(...sorted);
    for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i].start - Math.max(...sorted.slice(Math.max(0, i - 40), i).map(t => t.end)));
    for (const d of r.daily) {
      const mine = sorted.filter(t => dayOf(t.start) === d.day);
      // Minutes of the day with at least one tornado on the ground (overlaps counted once).
      let covered = 0, until = -Infinity; for (const t of mine) { const a = Math.max(t.start, until), b = Math.max(t.end, t.start + t.minutes / 60); if (b > a) { covered += b - a; until = b; } }
      dayRows.push({ tornadoes: mine.length, chaseable: mine.filter(t => t.minutes >= CHASEABLE_MINUTES).length, long: mine.filter(t => t.minutes >= 20).length, strong: mine.filter(t => ef(t.mph) >= 2).length, violent: mine.filter(t => ef(t.mph) >= 4).length, minutes: covered * 60, severeHours: d.severeSteps * STEP, stormHours: d.stormSteps * STEP });
      r.places.forEach((p, k) => {
        const near = Math.min(Infinity, ...mine.flatMap(t => t.points.map(q => Math.hypot(q.x - p.x, q.y - p.y))));
        const nearChase = Math.min(Infinity, ...mine.filter(t => t.minutes >= CHASEABLE_MINUTES).flatMap(t => t.points.map(q => Math.hypot(q.x - p.x, q.y - p.y))));
        placeDays.push({ tornado: near / KM_PER_MILE, chase: nearChase / KM_PER_MILE, storm: d.place[k].storm / KM_PER_MILE, severe: d.place[k].severe / KM_PER_MILE, strong: d.place[k].strong / KM_PER_MILE });
      });
    }
  }
  const localHour = t => (((t.start - 6) % 24) + 24) % 24;
  console.log(`=== Player report: ${days} days x seeds ${seeds.join(', ')} = ${dayRows.length} days, ${all.length} tornadoes (${((Date.now() - started) / 1000).toFixed(0)} s)${args.includes('--fixed') ? ', region fixed' : ''} ===`);
  console.log(`\n1. Is there something to chase today? (whole 500 x 500 mile map)`);
  console.log(`  days with a tornado: ${share(dayRows, d => d.tornadoes > 0)} | with one on the ground ${CHASEABLE_MINUTES} minutes or more: ${share(dayRows, d => d.chaseable > 0)} | 20 minutes or more: ${share(dayRows, d => d.long > 0)} | with EF2+ winds: ${share(dayRows, d => d.strong > 0)} | EF4+ winds: ${share(dayRows, d => d.violent > 0)}`);
  console.log(`  tornadoes per day: 10th ${pct(dayRows.map(d => d.tornadoes), 0.1)}, median ${pct(dayRows.map(d => d.tornadoes), 0.5)}, 90th ${pct(dayRows.map(d => d.tornadoes), 0.9)} | lasting ${CHASEABLE_MINUTES} min+: median ${pct(dayRows.map(d => d.chaseable), 0.5)}, 90th ${pct(dayRows.map(d => d.chaseable), 0.9)}`);
  console.log(`  minutes of the day with a tornado on the ground somewhere: 10th ${pct(dayRows.map(d => d.minutes), 0.1).toFixed(0)}, median ${pct(dayRows.map(d => d.minutes), 0.5).toFixed(0)}, 90th ${pct(dayRows.map(d => d.minutes), 0.9).toFixed(0)}`);
  console.log(`  hours of the day with a severe storm somewhere: median ${pct(dayRows.map(d => d.severeHours), 0.5)}, 10th ${pct(dayRows.map(d => d.severeHours), 0.1)} | with any storm: median ${pct(dayRows.map(d => d.stormHours), 0.5)}, 10th ${pct(dayRows.map(d => d.stormHours), 0.1)}`);
  console.log(`\n2. The tornadoes`);
  console.log(`  time on the ground (min): median ${pct(all.map(t => t.minutes), 0.5).toFixed(0)}, 90th ${pct(all.map(t => t.minutes), 0.9).toFixed(0)}, longest ${pct(all.map(t => t.minutes), 1).toFixed(0)} | ${CHASEABLE_MINUTES} min+: ${share(all, t => t.minutes >= CHASEABLE_MINUTES)}, 20 min+: ${share(all, t => t.minutes >= 20)}, 45 min+: ${share(all, t => t.minutes >= 45)}`);
  console.log(`  path (miles): median ${(pct(all.map(t => t.pathKm), 0.5) / KM_PER_MILE).toFixed(1)}, 90th ${(pct(all.map(t => t.pathKm), 0.9) / KM_PER_MILE).toFixed(1)}, longest ${(pct(all.map(t => t.pathKm), 1) / KM_PER_MILE).toFixed(0)}`);
  console.log(`  by peak wind: ${[0, 1, 2, 3, 4, 5].map(k => `EF${k} ${share(all, t => ef(t.mph) === k)}`).join(', ')} | by damage rating: ${[0, 1, 2, 3, 4, 5].map(k => `EF${k} ${share(all, t => ef(t.rated) === k)}`).join(', ')}`);
  console.log(`  local time they start: noon-6pm ${share(all, t => localHour(t) >= 12 && localHour(t) < 18)}, 6pm-midnight ${share(all, t => localHour(t) >= 18)}, midnight-6am ${share(all, t => localHour(t) < 6)}, 6am-noon ${share(all, t => localHour(t) >= 6 && localHour(t) < 12)}`);
  console.log(`\n3. The waits (simulated hours, whole map)`);
  const waits = gaps.filter(g => g > 0);
  console.log(`  from the end of one tornado to the start of the next, when there is a gap: median ${pct(waits, 0.5).toFixed(1)} h, 90th ${pct(waits, 0.9).toFixed(1)} h, longest ${pct(waits, 1).toFixed(0)} h | gaps of 12 h or more: ${waits.filter(g => g >= 12).length}, of 24 h or more: ${waits.filter(g => g >= 24).length} in ${dayRows.length} days`);
  console.log(`\n4. From one place on the map (${placeDays.length} place-days; each place stands for a 10 x 10 mile game place)`);
  const within = (key, miles) => share(placeDays, p => p[key] <= miles);
  console.log(`  a storm passes within 10 miles: ${within('storm', 10)} of days | a severe storm within 10 miles: ${within('severe', 10)} | within 25: ${within('severe', 25)} | a storm with 2 in hail or 75 mph wind within 25: ${within('strong', 25)}`);
  console.log(`  a tornado within 5 miles (inside the place): ${within('tornado', 5)} of days | within 25 miles: ${within('tornado', 25)} | within 60 miles (about an hour's drive): ${within('tornado', 60)} | within 120: ${within('tornado', 120)}`);
  console.log(`  a tornado lasting ${CHASEABLE_MINUTES} min+ within 25 miles: ${within('chase', 25)} | within 60: ${within('chase', 60)} | within 120: ${within('chase', 120)}`);
  console.log(`  distance to the day's nearest tornado (miles): 10th ${pct(placeDays.map(p => p.tornado), 0.1).toFixed(0)}, median ${pct(placeDays.map(p => p.tornado), 0.5).toFixed(0)}, 90th ${pct(placeDays.map(p => p.tornado), 0.9).toFixed(0)} (days with a tornado only)`);
}

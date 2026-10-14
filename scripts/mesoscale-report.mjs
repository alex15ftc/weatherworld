// Mesoscale discussions and watches over some days: how many are issued, when, with what
// lead, with what probabilities, and whether those meant what they said.
//   node scripts/mesoscale-report.mjs [days per seed] [--seeds 1,2,...] [--from day] [--show n]
// Each hour of each world the look ahead is made as the server makes it (a watch waiting for
// its storms goes out at the half hour they fire); then the same hours are run as they will
// really go, and each product is checked: did a discussion's area get what calls for a
// watch, were the strongest tornado, gust and hail inside the ranges it gave, and did a
// watch's ground get what its kind is for?
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();
const args = process.argv.slice(2), flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 2);

if (args.includes('--worker')) await worker(Number(flag('--worker'))); else await main();

async function worker(seed) {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const { stateFromBytes } = await import('../js/forecast/DayOneOutlook.js');
  const { MESOSCALE, runMesoscaleMember, describeNow, areaOutcome, peakRange } = await import('../js/forecast/MesoscaleDiscussion.js');
  const { WATCH, lookAhead, nextLookHourUtc, issueWatch, stormsFiring, readyHourUtc } = await import('../js/forecast/Watch.js');
  const atmosphere = new AtmosphereWorld({ seed }); atmosphere.advance(24 * Number(flag('--from', 2)));
  const world = atmosphere.world, rows = [], watchRows = [];
  let discussions = [], watches = [], pending = [], next = 1, nextWatch = 1, memberMs = 0, runs = 0, overlaps = 0, looks = 0, nextLook = -Infinity;
  const copy = () => v8.serialize(atmosphere.saveState({ forecast: true }));
  // What a watch's ground then gets over its own hours.
  const checkWatch = (watch, bytes, waitedHours) => {
    const real = runMesoscaleMember(stateFromBytes(bytes), 0, WATCH.hours, { asItHappens: true }), got = areaOutcome(real, watch.cells), now = describeNow(atmosphere);
    const there = now.storms.filter(s => watch.cells[s.cell]);
    if (watches.some(other => other !== watch && other.validToHourUtc > watch.issuedHourUtc + 1e-6 && other.cells.some((v, i) => v && watch.cells[i]))) overlaps++;
    // Following on: most of its ground was under a watch that expired in the last two hours.
    const before = watches.filter(other => other !== watch && other.validToHourUtc <= watch.issuedHourUtc + 1e-6 && other.validToHourUtc > watch.issuedHourUtc - 2);
    // A discussion before it: one issued earlier that said a watch was likely there, or announced this one.
    const preceded = discussions.some(md => md.issuedHourUtc < watch.issuedHourUtc - 1e-6 && watch.issuedHourUtc - md.issuedHourUtc <= 8 && (md.watchPercent >= 80 || md.replacement) && md.cells.reduce((a, v, i) => a + (v && watch.cells[i] ? 1 : 0), 0) >= 0.2 * watch.areaCells);
    const gapHours = before.length ? watch.issuedHourUtc - Math.max(...before.map(other => other.validToHourUtc)) : null;
    const followsOn = watch.cells.reduce((a, v, i) => a + (v && before.some(other => other.cells[i]) ? 1 : 0), 0) >= 0.5 * watch.areaCells;
    watchRows.push({ seed, number: watch.number, type: watch.type, pds: watch.pds, hourUtc: watch.issuedHourUtc, cells: watch.areaCells, waitedHours, followsOn, preceded, gapHours, peakTornadoMph: watch.peak.tornadoMph, runs: watch.runs.map(m => ({ strong: m.strong, gust: m.gust, windSignificant: m.windSignificant })), stormsThere: there.length, severeThere: there.filter(s => s.hail >= 1 || s.gust >= 58 || s.tornado).length,
      probabilities: watch.probabilities, got: { toward: got.toward, tornadoCase: got.tornadoCase, tornadoes: got.tornadoes, strong: got.strong, reports: got.reports, gust: got.gust, hail: got.hail, tornadoMph: got.tornadoMph, first: Number.isFinite(got.first) ? got.first : null }, text: watch.text });
  };
  // The hour itself, a half hour at a time: a watch waiting for storms goes out when they fire.
  const liveHour = () => {
    for (let step = 0; step < MESOSCALE.everyHours / MESOSCALE.stepHours; step++) {
      atmosphere.advance(MESOSCALE.stepHours);
      for (const waiting of pending.filter(p => readyHourUtc(p.draft, world) !== null)) {
        const watch = issueWatch(waiting.draft, nextWatch++, readyHourUtc(waiting.draft, world), stormsFiring(world, waiting.draft.cells) || waiting.draft.here.forming);
        pending = pending.filter(p => p !== waiting); watches = [watch, ...watches];
        checkWatch(watch, copy(), world.validHourUtc - waiting.sinceHourUtc);
      }
    }
  };
  for (let hour = 0; hour < days * 24; hour++) {
    // As on the server: no look while nothing new is in sight.
    if (world.validHourUtc < nextLook - 1e-6) { liveHour(); continue; }
    looks++;
    const bytes = copy(), now = describeNow(atmosphere), started = Date.now();
    const members = Array.from({ length: MESOSCALE.members }, (_, k) => runMesoscaleMember(stateFromBytes(bytes), k));
    memberMs += Date.now() - started; runs += members.length;
    const found = lookAhead(members, now, { discussions, watches, nextDiscussion: next, nextWatch, seed });
    if (found.discussions.length) {
      const real = runMesoscaleMember(stateFromBytes(bytes), 0, MESOSCALE.hoursAhead, { asItHappens: true });
      for (const md of found.discussions) {
        const got = areaOutcome(real, md.cells);
        rows.push({ seed, number: md.number, hourUtc: md.issuedHourUtc, day: Math.floor((md.issuedHourUtc - 12) / 24), percent: md.threatPercent, aboutWatch: md.watchNumber !== null, tornadoWatch: md.tornadoWatch, concerning: md.concerning, cells: md.areaCells, storms: md.here.storms, severeNow: md.here.severeNow, stormsIn: md.stormsInHours, startsIn: md.startsInHours,
          peakText: md.peakText, got: { toward: got.toward, tornadoCase: got.tornadoCase, tornadoes: got.tornadoes, reports: got.reports, first: Number.isFinite(got.first) ? got.first : null, storm: Number.isFinite(got.storm) ? got.storm : null, tornado: got.tornadoes ? peakRange('tornado', got.tornadoMph) : null, wind: peakRange('wind', got.gust), hail: peakRange('hail', got.hail), tornadoMph: got.tornadoMph, gust: got.gust, hailInches: got.hail }, text: md.text });
      }
    }
    next += found.discussions.length; nextWatch += found.watches.length;
    discussions = [...found.discussions, ...discussions].slice(0, MESOSCALE.kept); watches = [...found.watches, ...watches].slice(0, WATCH.kept); pending = found.pending.map(draft => ({ draft, sinceHourUtc: now.hourUtc }));
    for (const watch of found.watches) checkWatch(watch, bytes, 0);
    nextLook = nextLookHourUtc(found, now.hourUtc, watches);
    liveHour();
  }
  process.send({ rows, watchRows, overlaps, looks, secondsPerRun: memberMs / 1000 / Math.max(1, runs) });
}

async function main() {
  const { MESOSCALE } = await import('../js/forecast/MesoscaleDiscussion.js');
  const { WATCH } = await import('../js/forecast/Watch.js');
  const seeds = flag('--seeds', '1,2,3,4,5,6,7,8').split(',').map(Number), started = Date.now();
  const results = await Promise.all(seeds.map(seed => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [String(days), '--worker', String(seed), '--from', flag('--from', '2')]);
    child.once('message', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error(`seed ${seed} exited with ${code}`)); });
  })));
  const every = results.flatMap(r => r.rows), all = every.filter(md => !md.aboutWatch), about = every.filter(md => md.aboutWatch), watches = results.flatMap(r => r.watchRows);
  const worldDays = days * seeds.length, pc = (a, b) => (b ? `${Math.round(100 * a / b)}%` : '-');
  const middle = values => { const v = values.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : NaN; };
  console.log(`=== Mesoscale discussions and watches: ${days} days x seeds ${seeds.join(', ')} (${((Date.now() - started) / 1000).toFixed(0)} s; a ${MESOSCALE.hoursAhead}-hour run takes ${(results.reduce((a, r) => a + r.secondsPerRun, 0) / results.length).toFixed(1)} s) ===`);
  const perDay = new Map(); for (const md of all) perDay.set(`${md.seed}|${md.day}`, (perDay.get(`${md.seed}|${md.day}`) ?? 0) + 1);
  console.log(`\n0. Looks ahead: ${(results.reduce((a, r) => a + r.looks, 0) / worldDays).toFixed(1)} a world day (one an hour would be 24)`);
  const counts = [...Array(worldDays)].map((_, k) => [...perDay.values()][k] ?? 0).sort((a, b) => a - b);
  console.log(`\n1. Discussions for ground under no watch: ${all.length} in ${worldDays} world days (${(all.length / worldDays).toFixed(1)} a day; a day's count: least ${counts[0]}, median ${counts[Math.floor(counts.length / 2)]}, most ${counts.at(-1)}). About a watch in effect: ${about.length} (${(about.length / worldDays).toFixed(1)} a day).`);
  console.log(`   by hour of issue (UTC): ${Array.from({ length: 24 }, (_, h) => all.filter(md => ((Math.floor(md.hourUtc) % 24) + 24) % 24 === h).length).map((c, h) => `${String(h).padStart(2, '0')}:${c}`).join(' ')}`);
  console.log(`   area (median): ${middle(all.map(md => md.cells)) * 100} sq mi`);
  console.log('\n2. Lead: what was in the area when the discussion went out, and how long until the first storm and the first severe weather really came (hours, median)');
  for (const [label, group] of [['tornado watch in prospect', all.filter(md => md.tornadoWatch)], ['other', all.filter(md => !md.tornadoWatch)]]) {
    const ahead = group.filter(md => !md.storms);
    console.log(`   ${label.padEnd(26)}${String(group.length).padStart(3)} issued | no storms there yet: ${pc(ahead.length, group.length).padStart(4)} | severe weather already under way: ${pc(group.filter(md => md.severeNow > 0).length, group.length).padStart(4)} | of those ahead of the storms: first storm after ${middle(ahead.map(md => md.got.storm ?? NaN))} h, first severe after ${middle(ahead.map(md => md.got.first ?? NaN))} h`);
  }
  console.log('\n3. Do the probabilities mean what they say? (share of the discussions at each probability whose area then had what calls for a watch)');
  for (const step of [5, 20, 40, 60, 80, 95]) { const at = all.filter(md => md.percent === step); console.log(`   ${String(step).padStart(2)}%: ${String(at.length).padStart(3)} issued | a watch was called for in ${pc(at.filter(md => md.got.toward >= 1).length, at.length).padStart(4)} | no severe weather at all in ${pc(at.filter(md => md.got.reports === 0 && md.got.tornadoes === 0).length, at.length)}`); }
  const likely = all.filter(md => md.percent >= 80);
  console.log(`   of those saying a tornado watch is likely (${likely.filter(md => md.tornadoWatch).length}), the tornado case was met in ${pc(likely.filter(md => md.tornadoWatch && md.got.tornadoCase >= 1).length, likely.filter(md => md.tornadoWatch).length)}; of those saying a severe thunderstorm watch (${likely.filter(md => !md.tornadoWatch).length}), it was met anyway in ${pc(likely.filter(md => !md.tornadoWatch && md.got.tornadoCase >= 1).length, likely.filter(md => !md.tornadoWatch).length)}`);
  console.log('\n4. The most probable peaks (share of discussions where what happened was inside the range given / below it / above it)');
  for (const [key, order] of [['wind', ['UP TO 60 MPH', '55-70 MPH', '65-80 MPH', '75-90 MPH', '85+ MPH']], ['hail', ['UP TO 1.25 IN', '1.00-1.75 IN', '1.50-2.50 IN', '2.00-3.50 IN', '2.75+ IN']]]) {
    const cmp = every.map(md => order.indexOf(md.got[key]) - order.indexOf(md.peakText[key]));
    console.log(`   ${key.padEnd(8)}inside ${pc(cmp.filter(c => c === 0).length, every.length)} | within one range ${pc(cmp.filter(c => Math.abs(c) <= 1).length, every.length)} | below ${pc(cmp.filter(c => c < 0).length, every.length)} | above ${pc(cmp.filter(c => c > 0).length, every.length)}`);
  }
  const withTag = every.filter(md => md.peakText.tornado), without = every.filter(md => !md.peakText.tornado);
  console.log(`   tornado: a peak was given in ${withTag.length}; a tornado then came in ${pc(withTag.filter(md => md.got.tornadoes > 0).length, withTag.length)} of them, in the range given in ${pc(withTag.filter(md => md.got.tornado === md.peakText.tornado).length, withTag.length)} | none was given in ${without.length}; a tornado came anyway in ${pc(without.filter(md => md.got.tornadoes > 0).length, without.length)}`);

  const tor = watches.filter(w => w.type === 'tornado'), svr = watches.filter(w => w.type !== 'tornado');
  console.log(`\n5. Watches: ${watches.length} in ${worldDays} world days (${(watches.length / worldDays).toFixed(1)} a day): ${tor.length} tornado (${tor.filter(w => w.pds).length} PDS), ${svr.length} severe thunderstorm (${svr.filter(w => w.pds).length} PDS). Area (median): ${middle(watches.map(w => w.cells)) * 100} sq mi. Two in effect on the same ground: ${results.reduce((a, r) => a + r.overlaps, 0)} (must be 0).`);
  for (const [label, group] of [['on new ground', watches.filter(w => !w.followsOn)], ['following an expired watch', watches.filter(w => w.followsOn)]])
    console.log(`   ${label.padEnd(27)}${String(group.length).padStart(3)} | waited for storms to fire: ${pc(group.filter(w => w.waitedHours > 0).length, group.length).padStart(4)} | storms on its ground when issued (median): ${middle(group.map(w => w.stormsThere))} | severe weather already under way there: ${pc(group.filter(w => w.severeThere > 0).length, group.length).padStart(4)} | first severe weather after (median): ${middle(group.map(w => w.got.first ?? NaN))} h`);
  // How many would be particularly dangerous situations under other settings (most runs: 3 of 4).
  const most = (w, test) => w.runs.filter(test).length >= 0.75 * w.runs.length, half = (w, test) => w.runs.filter(test).length >= 0.5 * w.runs.length;
  console.log(`   PDS tornado under other settings: strong tornado in most runs ${tor.filter(w => most(w, m => m.strong >= 1)).length} | 2 strong in half ${tor.filter(w => most(w, m => m.strong >= 1) && half(w, m => m.strong >= 2)).length} | 2 strong in most ${tor.filter(w => most(w, m => m.strong >= 2)).length} | 2 strong in most and peak 136+ ${tor.filter(w => most(w, m => m.strong >= 2) && w.peakTornadoMph >= 136).length} | 3 strong in most ${tor.filter(w => most(w, m => m.strong >= 3)).length}   (of ${tor.length})`);
  console.log(`   PDS severe under other settings (gust mph / cells of 75+ mph wind, in most runs): ${[[90, 10], [90, 25], [100, 10], [100, 25], [100, 40], [110, 25], [110, 40]].map(([gust, cells]) => `${gust}/${cells}: ${svr.filter(w => most(w, m => m.gust >= gust && m.windSignificant >= cells)).length}`).join(' | ')}   (of ${svr.length})`);
  const line = (label, group, test) => console.log(`   ${label.padEnd(58)}${pc(group.filter(test).length, group.length).padStart(4)} of ${group.length}`);
  console.log(`   what the ground then got in the watch's ${WATCH.hours} hours:`);
  console.log(`   with a discussion before it: ${pc(watches.filter(w => w.preceded).length, watches.length)} | following an expired watch with no gap: ${pc(watches.filter(w => w.followsOn && w.gapHours !== null && w.gapHours < 1e-6).length, watches.filter(w => w.followsOn).length)} (largest gap ${Math.max(0, ...watches.filter(w => w.followsOn && w.gapHours !== null).map(w => w.gapHours))} h)`);
  line('any watch: what calls for a watch', watches, w => w.got.toward >= 1);
  line('tornado watch: 2 or more tornadoes, or a strong one', tor, w => w.got.tornadoCase >= 1);
  line('tornado watch: a strong tornado', tor, w => w.got.strong >= 1);
  line('severe thunderstorm watch: the tornado case anyway', svr, w => w.got.tornadoCase >= 1);
  line('severe thunderstorm watch: a strong tornado anyway', svr, w => w.got.strong >= 1);
  line('PDS tornado watch: 2 or more strong tornadoes', tor.filter(w => w.pds), w => w.got.strong >= 2);
  line('other tornado watch: 2 or more strong tornadoes', tor.filter(w => !w.pds), w => w.got.strong >= 2);
  line('PDS severe thunderstorm watch: a gust of 100 mph or more', svr.filter(w => w.pds), w => w.got.gust >= 100);
  const show = Number(flag('--show', 1));
  for (const md of [...all].sort((a, b) => (a.storms ? 1 : 0) - (b.storms ? 1 : 0) || b.percent - a.percent).slice(0, show)) console.log(`\n--- seed ${md.seed}, what then happened: ${md.got.reports} cells with severe hail or wind, ${md.got.tornadoes} tornadoes (strongest ${Math.round(md.got.tornadoMph)} mph), gust ${Math.round(md.got.gust)} mph, hail ${md.got.hailInches.toFixed(2)} in ---\n${md.text}`);
  for (const md of about.slice(0, show)) console.log(`\n--- seed ${md.seed}, a discussion about a watch ---\n${md.text}`);
  for (const w of [...watches].sort((a, b) => b.waitedHours - a.waitedHours || (b.pds ? 1 : 0) - (a.pds ? 1 : 0)).slice(0, show)) console.log(`\n--- seed ${w.seed}, waited ${w.waitedHours} h for storms; what then happened: ${w.got.reports} cells with severe hail or wind, ${w.got.tornadoes} tornadoes (${w.got.strong} strong, strongest ${Math.round(w.got.tornadoMph)} mph), gust ${Math.round(w.got.gust)} mph, hail ${w.got.hail.toFixed(2)} in ---\n${w.text}`);
}

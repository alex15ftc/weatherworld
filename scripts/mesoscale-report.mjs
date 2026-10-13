// Mesoscale discussions over some days: how many are issued, when, with what probabilities,
// and whether those meant what they said.
//   node scripts/mesoscale-report.mjs [days per seed] [--seeds 1,2,...] [--from day] [--show n]
// Each hour of each world the discussions are made as the server makes them; then the same
// three hours are run as they will really go, and each discussion is checked: did its area
// get what calls for a watch, and were the strongest tornado, gust and hail inside the
// ranges it gave?
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();
const args = process.argv.slice(2), flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 3);

if (args.includes('--worker')) await worker(Number(flag('--worker'))); else await main();

async function worker(seed) {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const { stateFromBytes } = await import('../js/forecast/DayOneOutlook.js');
  const { MESOSCALE, runMesoscaleMember, buildMesoscaleDiscussions, describeNow, areaOutcome, peakRange } = await import('../js/forecast/MesoscaleDiscussion.js');
  const atmosphere = new AtmosphereWorld({ seed }); atmosphere.advance(24 * Number(flag('--from', 2)));
  const out = []; let active = [], next = 1, memberMs = 0, runs = 0;
  for (let hour = 0; hour < days * 24; hour++) {
    const bytes = v8.serialize(atmosphere.saveState()), now = describeNow(atmosphere), started = Date.now();
    const members = Array.from({ length: MESOSCALE.members }, (_, k) => runMesoscaleMember(stateFromBytes(bytes), k));
    memberMs += Date.now() - started; runs += members.length;
    const issued = buildMesoscaleDiscussions(members, now, { active, next, seed });
    if (issued.length) {
      const real = runMesoscaleMember(stateFromBytes(bytes), 0, MESOSCALE.hoursAhead, { asItHappens: true });
      for (const md of issued) {
        const got = areaOutcome(real, md.cells);
        out.push({ seed, number: md.number, hourUtc: md.issuedHourUtc, day: Math.floor((md.issuedHourUtc - 12) / 24), percent: md.watchPercent, tornadoWatch: md.tornadoWatch, concerning: md.concerning, cells: md.areaCells, storms: md.here.storms, severeNow: md.here.severeNow, startsIn: md.startsInHours,
          peakText: md.peakText, got: { toward: got.toward, tornadoCase: got.tornadoCase, tornadoes: got.tornadoes, reports: got.reports, first: Number.isFinite(got.first) ? got.first : null, tornado: got.tornadoes ? peakRange('tornado', got.tornadoMph) : null, wind: peakRange('wind', got.gust), hail: peakRange('hail', got.hail), tornadoMph: got.tornadoMph, gust: got.gust, hailInches: got.hail }, text: md.text });
      }
      next += issued.length; active = [...issued, ...active].slice(0, MESOSCALE.kept);
    }
    atmosphere.advance(MESOSCALE.everyHours);
  }
  process.send({ rows: out, secondsPerRun: memberMs / 1000 / Math.max(1, runs) });
}

async function main() {
  const seeds = flag('--seeds', '1,2,3,4,5,6,7,8').split(',').map(Number), started = Date.now();
  const results = await Promise.all(seeds.map(seed => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [String(days), '--worker', String(seed), '--from', flag('--from', '2')]);
    child.once('message', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error(`seed ${seed} exited with ${code}`)); });
  })));
  const all = results.flatMap(r => r.rows), worldDays = days * seeds.length, pc = (a, b) => (b ? `${Math.round(100 * a / b)}%` : '-');
  console.log(`=== Mesoscale discussions: ${days} days x seeds ${seeds.join(', ')} (${((Date.now() - started) / 1000).toFixed(0)} s; a three-hour run takes ${(results.reduce((a, r) => a + r.secondsPerRun, 0) / results.length).toFixed(1)} s) ===`);
  const perDay = new Map(); for (const md of all) perDay.set(`${md.seed}|${md.day}`, (perDay.get(`${md.seed}|${md.day}`) ?? 0) + 1);
  const counts = [...Array(worldDays)].map((_, k) => [...perDay.values()][k] ?? 0).sort((a, b) => a - b);
  console.log(`\n1. How many: ${all.length} in ${worldDays} world days (${(all.length / worldDays).toFixed(1)} a day; a day's count: least ${counts[0]}, median ${counts[Math.floor(counts.length / 2)]}, most ${counts.at(-1)}; days with none: ${counts.filter(c => !c).length})`);
  console.log(`   by hour of issue (UTC): ${Array.from({ length: 24 }, (_, h) => all.filter(md => ((Math.floor(md.hourUtc) % 24) + 24) % 24 === h).length).map((c, h) => `${String(h).padStart(2, '0')}:${c}`).join(' ')}`);
  console.log(`   severe weather already under way in the area when issued: ${pc(all.filter(md => md.severeNow > 0).length, all.length)} | no storms there yet: ${pc(all.filter(md => !md.storms).length, all.length)} | area (median): ${counts.length ? [...all].sort((a, b) => a.cells - b.cells)[Math.floor(all.length / 2)]?.cells * 100 : 0} sq mi`);
  console.log('\n2. Do the probabilities mean what they say? (share of the discussions at each probability whose area then had what calls for a watch)');
  for (const step of [5, 20, 40, 60, 80, 95]) { const at = all.filter(md => md.percent === step); console.log(`   ${String(step).padStart(2)}%: ${String(at.length).padStart(3)} issued | a watch was called for in ${pc(at.filter(md => md.got.toward >= 1).length, at.length).padStart(4)} | no severe weather at all in ${pc(at.filter(md => md.got.reports === 0 && md.got.tornadoes === 0).length, at.length)}`); }
  const likely = all.filter(md => md.percent >= 80);
  console.log(`   of those saying a tornado watch is likely (${likely.filter(md => md.tornadoWatch).length}), the tornado case was met in ${pc(likely.filter(md => md.tornadoWatch && md.got.tornadoCase >= 1).length, likely.filter(md => md.tornadoWatch).length)}; of those saying a severe thunderstorm watch (${likely.filter(md => !md.tornadoWatch).length}), it was met anyway in ${pc(likely.filter(md => !md.tornadoWatch && md.got.tornadoCase >= 1).length, likely.filter(md => !md.tornadoWatch).length)}`);
  console.log('\n3. The most probable peaks (share of discussions where what happened was inside the range given / below it / above it)');
  for (const [key, value, order] of [['wind', 'gust', ['UP TO 60 MPH', '55-70 MPH', '65-80 MPH', '75-90 MPH', '85+ MPH']], ['hail', 'hailInches', ['UP TO 1.25 IN', '1.00-1.75 IN', '1.50-2.50 IN', '2.00-3.50 IN', '2.75+ IN']]]) {
    const cmp = all.map(md => order.indexOf(md.got[key]) - order.indexOf(md.peakText[key]));
    console.log(`   ${key.padEnd(8)}inside ${pc(cmp.filter(c => c === 0).length, all.length)} | within one range ${pc(cmp.filter(c => Math.abs(c) <= 1).length, all.length)} | below ${pc(cmp.filter(c => c < 0).length, all.length)} | above ${pc(cmp.filter(c => c > 0).length, all.length)}`);
  }
  const withTag = all.filter(md => md.peakText.tornado), without = all.filter(md => !md.peakText.tornado);
  console.log(`   tornado: a peak was given in ${withTag.length}; a tornado then came in ${pc(withTag.filter(md => md.got.tornadoes > 0).length, withTag.length)} of them, in the range given in ${pc(withTag.filter(md => md.got.tornado === md.peakText.tornado).length, withTag.length)} | none was given in ${without.length}; a tornado came anyway in ${pc(without.filter(md => md.got.tornadoes > 0).length, without.length)}`);
  const show = Number(flag('--show', 2));
  for (const md of [...all].sort((a, b) => b.percent - a.percent || b.cells - a.cells).slice(0, show)) console.log(`\n--- seed ${md.seed}, what then happened: ${md.got.reports} cells with severe hail or wind, ${md.got.tornadoes} tornadoes (strongest ${Math.round(md.got.tornadoMph)} mph), gust ${Math.round(md.got.gust)} mph, hail ${md.got.hailInches.toFixed(2)} in ---\n${md.text}`);
}

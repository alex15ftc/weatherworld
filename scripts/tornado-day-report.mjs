// Why a day with tornado-favourable air does or does not get a tornado, and what part fronts,
// the dryline and outflow boundaries play in where storms and tornadoes form.
//   node scripts/tornado-day-report.mjs [days] [--seeds 1,2,3] [--no-outflow]
// --no-outflow runs the same large-scale weather with the storms' cold pools kept out of the
// atmosphere, so the difference between the two runs is what outflow boundaries do.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

avoidBackgroundThrottling();

const args = process.argv.slice(2);
const days = Number(args.find(a => /^\d+$/.test(a)) ?? 30);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const noOutflow = args.includes('--no-outflow');
const FAVOURABLE_STP = 1, NEAR_KM = 64, POOL_K = 1.5, STEP_HOURS = 0.5;
// The lift each source can supply against the cap, as the initiation code counts it.
const LIFT = { boundary: 170, synoptic: 60, terrain: 90, thermals: 30 };
const KINDS = ['front', 'dryline', 'outflow'];

if (flag('--worker') !== null) await worker(Number(flag('--worker'))); else await main();

async function worker(seed) {
  const { AtmosphereWorld } = await import('../js/world/AtmosphereWorld.js');
  const { rotatingShare, lineShare, outflowDominance } = await import('../js/storms/StormModeEngine.js');
  const atmosphere = new AtmosphereWorld({ seed }), world = atmosphere.world, regional = atmosphere.regional;
  if (noOutflow) regional.addColdPool = () => {};
  const nx = world.width, ny = world.height, n = nx * ny, cellKm = world.cellSizeKm, reach = Math.ceil(NEAR_KM / cellKm);
  const index = p => Math.max(0, Math.min(ny - 1, Math.floor(p.y / cellKm))) * nx + Math.max(0, Math.min(nx - 1, Math.floor(p.x / cellKm)));
  const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));
  const known = new Map(), daily = [];
  for (let day = 0; day < days; day++) {
    const d = {
      seed, day: day + 1, favourable: 0, liftBeatsCap: 0, cin: 0, convergence: 0, ascent: 0, formed: 0, formedFavourable: 0, tornadoes: 0, maxHail: 0, maxGust: 0,
      stormSteps: 0, stormStepsFavourable: 0, rotating: 0, mature: 0, inLine: 0, undercut: 0, chance: 0, expected: 0, expectedAll: 0,
      mapNear: { front: 0, dryline: 0, outflow: 0 }, formedNear: { front: 0, dryline: 0, outflow: 0, none: 0 }, tornadoNear: { front: 0, dryline: 0, outflow: 0, none: 0 },
      liftNear: { front: 0, dryline: 0, outflow: 0, none: 0 }, cellsNear: { front: 0, dryline: 0, outflow: 0, none: 0 },
      formedPool: { inside: 0, edge: 0, clear: 0 }, tornadoPool: { inside: 0, edge: 0, clear: 0 }, mapPool: { inside: 0, edge: 0, clear: 0 }, lines: { front: 0, dryline: 0, outflow: 0 }
    };
    for (let step = 0; step < 48; step++) {
      atmosphere.advance(STEP_HOURS);
      // Which cells are within 40 miles of each kind of analysed line.
      const near = { front: new Uint8Array(n), dryline: new Uint8Array(n), outflow: new Uint8Array(n) };
      for (const line of atmosphere.boundaries ?? []) {
        const kind = line.type === 'dryline' || line.type === 'outflow' ? line.type : 'front';
        d.lines[kind] += 1 / 48;
        for (const p of line.pointsKm) {
          const cx = Math.floor(p.x / cellKm), cy = Math.floor(p.y / cellKm);
          for (let y = Math.max(0, cy - reach); y <= Math.min(ny - 1, cy + reach); y++) for (let x = Math.max(0, cx - reach); x <= Math.min(nx - 1, cx + reach); x++) {
            if (Math.hypot((x + 0.5) * cellKm - p.x, (y + 0.5) * cellKm - p.y) <= NEAR_KM) near[kind][y * nx + x] = 1;
          }
        }
      }
      // Rain-cooled air: inside a pool, on its edge (the gust front), or clear of it.
      const pool = regional.coldPool, poolKind = k => {
        if (pool[k] >= POOL_K) return 'inside';
        const x = k % nx, y = Math.floor(k / nx);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < nx && Y < ny && pool[Y * nx + X] >= POOL_K) return 'edge'; }
        return 'clear';
      };
      const nearKinds = k => { const kinds = KINDS.filter(kind => near[kind][k]); return kinds.length ? kinds : ['none']; };
      world.forEachCell((cell, x, y) => {
        const k = y * nx + x, f = cell.features ?? {}, lift = clamp01(f.convergenceLift);
        for (const kind of KINDS) if (near[kind][k]) d.mapNear[kind] += 1 / (48 * n);
        for (const kind of nearKinds(k)) { d.liftNear[kind] += lift; d.cellsNear[kind]++; }
        d.mapPool[poolKind(k)] += 1 / (48 * n);
        if (!((cell.derived?.stp ?? 0) >= FAVOURABLE_STP)) return;
        const cin = Math.abs(cell.derived.sounding?.mlcin ?? 0);
        const energy = LIFT.boundary * lift + LIFT.synoptic * clamp01(f.synopticAscent) + LIFT.terrain * clamp01((cell.dynamics?.terrainLiftMs ?? 0) / 0.05) + LIFT.thermals * clamp01(f.surfaceHeating);
        d.favourable++; d.cin += cin; d.convergence += lift; d.ascent += clamp01(f.synopticAscent);
        if (energy > cin) d.liftBeatsCap++;
      });
      for (const storm of world.storms) {
        const k = index(storm.positionKm), stp = world.cells[Math.floor(k / nx)][k % nx].derived?.stp ?? 0, cycles = storm.tornado?.cycleCount ?? 0;
        if (!known.has(storm.id)) {
          known.set(storm.id, 0); d.formed++;
          if (stp >= FAVOURABLE_STP) d.formedFavourable++;
          for (const kind of nearKinds(k)) d.formedNear[kind]++;
          d.formedPool[poolKind(k)]++;
        }
        if (cycles > known.get(storm.id)) {
          const added = cycles - known.get(storm.id); known.set(storm.id, cycles); d.tornadoes += added;
          for (const kind of nearKinds(k)) d.tornadoNear[kind] += added;
          d.tornadoPool[poolKind(k)] += added;
        }
        if (!storm.active) continue;
        d.maxHail = Math.max(d.maxHail, storm.currentHailSizeInches ?? 0); d.maxGust = Math.max(d.maxGust, storm.surfaceWind?.gustMph ?? 0);
        const chance = Math.min(0.95, storm.tornado?.probability ?? 0), expected = -Math.log(1 - chance) / 2.5 * STEP_HOURS;
        d.stormSteps++; d.expectedAll += expected;
        if (stp < FAVOURABLE_STP) continue;
        const mature = Math.max(0, Math.min(1, (storm.ageHours - 0.3) / 0.6)) * Math.max(0, Math.min(1, (storm.intensity - 0.25) / 0.25));
        d.stormStepsFavourable++; d.rotating += rotatingShare(storm); d.mature += mature; d.inLine += lineShare(storm);
        d.undercut += storm.environment ? outflowDominance(storm, storm.environment) : 0; d.chance += chance; d.expected += expected;
      }
    }
    daily.push(d);
  }
  process.send(daily);
}

async function main() {
  const seeds = (flag('--seeds') ?? '1,2,3').split(',').map(Number), started = Date.now();
  const results = await Promise.all(seeds.map(seed => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [String(days), '--worker', String(seed), ...(noOutflow ? ['--no-outflow'] : [])]);
    child.once('message', resolve); child.once('error', reject); child.once('exit', code => { if (code) reject(new Error(`seed ${seed} exited with ${code}`)); });
  })));
  const all = results.flat(), sum = (rows, read) => rows.reduce((a, r) => a + read(r), 0);
  const med = (rows, read, digits = 0) => { const v = rows.map(read).filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)].toFixed(digits) : '-'; };
  const pc = (a, b) => (b ? `${Math.round(100 * a / b)}%` : '-');
  console.log(`=== Tornado-day report: ${days} days x seeds ${seeds.join(', ')} = ${all.length} days (${((Date.now() - started) / 1000).toFixed(0)} s)${noOutflow ? ', storms\' cold pools kept out of the atmosphere' : ''} ===`);
  const severe = d => d.tornadoes > 0 || d.maxHail >= 1 || d.maxGust >= 58;
  console.log(`\ndays with: a tornado ${pc(all.filter(d => d.tornadoes).length, all.length)} | any severe storm ${pc(all.filter(severe).length, all.length)} | 1 in hail ${pc(all.filter(d => d.maxHail >= 1).length, all.length)} | 58 mph ${pc(all.filter(d => d.maxGust >= 58).length, all.length)} | 75 mph ${pc(all.filter(d => d.maxGust >= 75).length, all.length)}`);
  console.log(`per day: storms ${med(all, d => d.formed)} | tornadoes mean ${(sum(all, d => d.tornadoes) / all.length).toFixed(1)}, total ${sum(all, d => d.tornadoes)} | strongest gust ${med(all, d => d.maxGust)} mph | largest hail ${med(all, d => d.maxHail, 2)} in`);

  // --- 1. Tornado days against the rest.
  const some = d => d.favourable >= 20, groups = [['tornado days', all.filter(d => d.tornadoes)], ['no tornado, favourable air present', all.filter(d => !d.tornadoes && some(d))], ['no tornado, no favourable air', all.filter(d => !d.tornadoes && !some(d))]];
  console.log(`\n1. What the favourable air (tornado parameter ${FAVOURABLE_STP}+) has and lacks, per day (medians)`);
  const rows = [
    ['days', g => String(g.length)],
    ['favourable air, share of the map over the day', g => `${med(g, d => 100 * d.favourable / (48 * 2500), 1)}%`],
    ['  inhibition in it (J/kg)', g => med(g, d => d.cin / d.favourable)],
    ['  convergence lift in it (0-1)', g => med(g, d => d.convergence / d.favourable, 2)],
    ['  ascent aloft over it (0-1)', g => med(g, d => d.ascent / d.favourable, 2)],
    ['  share of it where the lift beats the cap', g => `${med(g, d => 100 * d.liftBeatsCap / d.favourable)}%`],
    ['storms formed', g => med(g, d => d.formed)],
    ['  of them in favourable air', g => med(g, d => d.formedFavourable)],
    ['storm-hours in favourable air', g => med(g, d => d.stormStepsFavourable * STEP_HOURS, 1)],
    ['  those storms: rotating (0-1)', g => med(g, d => d.rotating / d.stormStepsFavourable, 2)],
    ['  mature (0-1)', g => med(g, d => d.mature / d.stormStepsFavourable, 2)],
    ['  part of a line (0-1)', g => med(g, d => d.inLine / d.stormStepsFavourable, 2)],
    ['  undercut by outflow (0-1)', g => med(g, d => d.undercut / d.stormStepsFavourable, 2)],
    ['  tornado chance per storm (2.5 h window)', g => `${med(g, d => 100 * d.chance / d.stormStepsFavourable, 1)}%`],
    ['tornadoes expected from the rates', g => med(g, d => d.expectedAll, 2)],
    ['tornadoes that happened', g => med(g, d => d.tornadoes)]
  ];
  console.log(`  ${''.padEnd(46)}${groups.map(([name]) => name.padStart(36)).join('')}`);
  for (const [label, read] of rows) console.log(`  ${label.padEnd(46)}${groups.map(([, g]) => (g.length ? read(g) : '-').padStart(36)).join('')}`);

  // --- 2. Lines.
  const total = kind => ({ map: sum(all, d => d.mapNear[kind]) / all.length, formed: sum(all, d => d.formedNear[kind]), tornado: sum(all, d => d.tornadoNear[kind]), lift: sum(all, d => d.liftNear[kind]) / Math.max(1, sum(all, d => d.cellsNear[kind])), lines: sum(all, d => d.lines[kind]) / all.length });
  const formed = sum(all, d => d.formed), tornadoes = sum(all, d => d.tornadoes);
  console.log(`\n2. Lines: within ${Math.round(NEAR_KM / 1.609)} miles of a front, the dryline or an outflow boundary (a storm can be near more than one)`);
  console.log(`  ${'line'.padEnd(10)}${'on the map'.padStart(12)}${'share of map'.padStart(14)}${'storms formed'.padStart(15)}${'against chance'.padStart(16)}${'tornadoes'.padStart(11)}${'against chance'.padStart(16)}${'lift there (0-1)'.padStart(18)}`);
  for (const kind of KINDS) {
    const t = total(kind);
    console.log(`  ${kind.padEnd(10)}${t.lines.toFixed(1).padStart(12)}${`${(100 * t.map).toFixed(0)}%`.padStart(14)}${pc(t.formed, formed).padStart(15)}${(t.map ? `x${(t.formed / formed / t.map).toFixed(1)}` : '-').padStart(16)}${pc(t.tornado, tornadoes).padStart(11)}${(t.map && tornadoes ? `x${(t.tornado / tornadoes / t.map).toFixed(1)}` : '-').padStart(16)}${t.lift.toFixed(2).padStart(18)}`);
  }
  console.log(`  ${'no line'.padEnd(10)}${''.padStart(26)}${pc(sum(all, d => d.formedNear.none), formed).padStart(15)}${''.padStart(16)}${pc(sum(all, d => d.tornadoNear.none), tornadoes).padStart(11)}${''.padStart(16)}${(sum(all, d => d.liftNear.none) / Math.max(1, sum(all, d => d.cellsNear.none))).toFixed(2).padStart(18)}`);
  console.log(`\n3. Rain-cooled air (a pool ${POOL_K} K or more colder than its air mass)`);
  for (const where of ['inside', 'edge', 'clear']) {
    const map = sum(all, d => d.mapPool[where]) / all.length, f = sum(all, d => d.formedPool[where]), t = sum(all, d => d.tornadoPool[where]);
    console.log(`  ${({ inside: 'inside a pool', edge: 'on its edge (within 20 mi)', clear: 'clear of any pool' })[where].padEnd(28)} map ${`${(100 * map).toFixed(0)}%`.padStart(4)} | storms formed ${pc(f, formed).padStart(4)} (x${(f / formed / map).toFixed(1)}) | tornadoes ${pc(t, tornadoes).padStart(4)}${tornadoes ? ` (x${(t / tornadoes / map).toFixed(1)})` : ''}`);
  }
}

// Regression scorecard: node agg.cjs <name> [baseline]
// Reads <name>/seed-*.json and <name>/coldpool-*.csv, computes each measure on all seeds and on the
// two halves (seeds 1-4, 5-8), and a tolerance from the seed-to-seed spread (sd of the per-seed
// values; with 8 seeds the run-to-run difference has sd about sd_seed/2, so this is about 2 sigma),
// never below the measure's floor. Writes <name>/scorecard.json and scorecard.txt.
// With a baseline: REGRESSION = moved further from its real target than the baseline by more than
// the baseline's tolerance; track-only measures are flagged MOVED when |after - base| > tolerance.
const fs = require('fs'), path = require('path');
const [name, baseName] = process.argv.slice(2);
const dir = path.join(process.env.REG_OUT || __dirname, name);
const runs = fs.readdirSync(dir).filter(f => /^seed-\d+\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).sort((a, b) => a.seed - b.seed);
const rows = {};
for (const r of runs) {
  const text = fs.readFileSync(path.join(dir, `coldpool-${r.seed}.csv`), 'utf8').trim().split('\n'), head = text[0].split(',');
  rows[r.seed] = text.slice(1).map(line => { const v = line.split(','); const o = {}; head.forEach((h, i) => { o[h] = h === 'mode' || h === 'id' ? v[i].replace(/"/g, '') : (v[i] === '' ? NaN : Number(v[i])); }); return o; });
}

// ---- helpers
const q = (a, f) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[Math.floor(f * (v.length - 1))] : NaN; };
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const pct = (a, test) => (a.length ? 100 * a.filter(test).length / a.length : NaN);
const LINE = ['broken line', 'linear segment', 'QLCS with embedded supercells', 'QLCS', 'MCS'];
const modeKind = m => (LINE.includes(m) ? 'line' : m.includes('supercell') ? 'supercell' : m === 'multicell' ? 'multicell' : 'other');
const ORDER = ['NONE', 'TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'], cat = d => ORDER.indexOf(d.worldCategory);
// local CDT hour of a UTC hour
const local = h => (((h - 5) % 24) + 24) % 24;

// Each measure: fn(set) where set = { days, reportDays, storms, tornadoes, rows } pooled over the chosen seeds.
// target: number (two-sided), { max } (fine at or under), { min } (fine at or over); null = track only.
const M = [];
const add = (group, key, label, fn, target, floor, note = '') => M.push({ group, key, label, fn, target, floor, note });
// Activity
add('activity', 'tor_day', 'Tornadoes a day (mean)', s => mean(s.days.map(d => d.tornadoes)), 7.5, 0.5, 'TARGETS doc');
add('activity', 'ef2_day', 'EF2+ tornadoes a day (mean)', s => s.tornadoes.filter(t => t.ef >= 2).length / s.days.length, 0.89, 0.15, '7.5 x 11.9% (US EF2+ share)');
add('activity', 'tor_days', 'Days with a tornado %', s => pct(s.days, d => d.tornado), 83, 3, 'TARGETS (real May CONUS 81%)');
add('activity', 'tor30', 'Days with 30+ tornadoes %', s => pct(s.days, d => d.tornadoes >= 30), 5, 2.5, 'TARGETS');
add('activity', 'quiet', 'Quiet days (no severe report) %', s => pct(s.days, d => !d.severe), { max: 10 }, 2.5, 'TARGETS: under 10%');
add('activity', 'chase', 'Chaseable days (ground-fed supercell) %', s => pct(s.days, d => d.groundSupercells > 0), { min: 100 }, 3, 'as many as possible');
add('activity', 'sigtor_days', 'Days with an EF2+ tornado %', s => pct(s.days, d => d.sigTornado), null, 4);
add('activity', 'hail_days', 'Days with 1 in hail %', s => pct(s.days, d => d.hailStorms > 0), null, 3);
add('activity', 'wind_days', 'Days with 58 mph wind %', s => pct(s.days, d => d.windStorms > 0), null, 3);
// Ratings
for (const [e, t] of [[0, 52], [1, 35], [2, 9], [3, 2.4]]) add('ratings', `ef${e}`, `EF${e} share of tornadoes %`, s => pct(s.tornadoes, x => x.ef === e), t, e < 2 ? 3 : 1, 'US 2008-22');
add('ratings', 'ef4p', 'EF4+ share of tornadoes %', s => pct(s.tornadoes, x => x.ef >= 4), 0.5, 0.4, 'US 2008-22');
add('ratings', 'track_mi', 'Tornado track median (mi)', s => q(s.tornadoes.map(t => t.km / 1.609), 0.5), null, 0.5);
// Categories (this world's rules); MDT and HIGH judged together
add('categories', 'mdt_high', 'MDT+HIGH days %', s => pct(s.days, d => cat(d) >= 5), 25, 4, 'TARGETS 20+5 (real central 22.2)');
add('categories', 'high', '  HIGH days % (info; judged in MDT+HIGH)', s => pct(s.days, d => cat(d) === 6), null, 4, 'target 5');
add('categories', 'enh', 'ENH days %', s => pct(s.days, d => cat(d) === 4), 40, 4, 'TARGETS (real central 35.5)');
add('categories', 'slgt', 'SLGT days %', s => pct(s.days, d => cat(d) === 3), 30, 4, 'TARGETS');
add('categories', 'below', 'Below SLGT days %', s => pct(s.days, d => cat(d) < 3), 5, 4, 'TARGETS (real central 15.1)');
// Intensity groups (days)
for (const [hz, tiers] of [['tornado', [[1, 20], [2, 5], [3, 1.5]]], ['wind', [[1, 30], [2, 10], [3, 3]]], ['hail', [[1, 35], [2, 10]]]])
  for (const [c, t] of tiers) add('groups', `cig_${hz}${c}`, `${hz} CIG${c}+ days %`, s => pct(s.days, d => d.cig[hz] >= c), t, c === 1 ? 4 : 2, 'TARGETS');
// Reports
const repDays = s => s.reportDays;
add('reports', 'wind_med', 'Wind reports a day, median', s => q(repDays(s).map(d => d.wind.length), 0.5), 22, 4, 'real busiest 500 mi window');
add('reports', 'wind_p90', 'Wind reports a day, 90th', s => q(repDays(s).map(d => d.wind.length), 0.9), 73, 40, 'real busiest window');
add('reports', 'hail_med', 'Hail reports a day, median', s => q(repDays(s).map(d => d.hail.length), 0.5), 22, 4, 'real busiest window');
add('reports', 'hail_p90', 'Hail reports a day, 90th', s => q(repDays(s).map(d => d.hail.length), 0.9), 84, 40, 'real busiest window');
add('reports', 'wind_mean', 'Wind reports a day, mean', s => mean(repDays(s).map(d => d.wind.length)), null, 10);
add('reports', 'hail_mean', 'Hail reports a day, mean', s => mean(repDays(s).map(d => d.hail.length)), null, 10);
add('reports', 'wind75', 'Wind reports at 75+ mph %', s => pct(repDays(s).flatMap(d => d.wind), v => v >= 75), 11.4, 1.5, 'real measured gusts');
add('reports', 'hail2', 'Hail reports at 2 in+ %', s => pct(repDays(s).flatMap(d => d.hail), v => v >= 2), 14.1, 1.5, 'SPC (brief: engine was 13.5)');
add('reports', 'hail35', 'Hail reports at 3.5 in+ %', s => pct(repDays(s).flatMap(d => d.hail), v => v >= 3.5), 0.7, 0.3, 'SPC');
// Storms
add('storms', 'storms_day', 'Storms a day, median', s => q(s.days.map(d => d.storms), 0.5), null, 6);
add('storms', 'peak_day', 'Peak active storms, median', s => q(s.days.map(d => d.peak), 0.5), null, 4);
const ended = s => s.storms.filter(x => x.ended && x.maxIntensity >= 0.22);
add('storms', 'life_med', 'Storm life, median h (ended, intensity 0.22+)', s => q(ended(s).map(x => x.lifeHours), 0.5), null, 0.2, 'long lives deliberate');
add('storms', 'life_p90', 'Storm life, 90th h', s => q(ended(s).map(x => x.lifeHours), 0.9), null, 0.5);
add('storms', 'sc_life', 'Supercell life, median h', s => q(ended(s).filter(x => x.supercell).map(x => x.lifeHours), 0.5), null, 0.4, 'game: 4-9 h wanted');
const modeShare = kind => s => { let a = 0, t = 0; for (const d of s.days) for (const [m, c] of Object.entries(d.modeCount)) { t += c; if (modeKind(m) === kind) a += c; } return 100 * a / t; };
add('storms', 'mode_sc', 'Storm time as supercell %', modeShare('supercell'), null, 3);
add('storms', 'mode_line', 'Storm time as line %', modeShare('line'), null, 3);
add('storms', 'mode_multi', 'Storm time as multicell %', modeShare('multicell'), null, 3);
add('storms', 'mode_other', 'Storm time pulse/elevated %', modeShare('other'), null, 3);
add('storms', 'mode_cluster', 'Storm time as supercell cluster %', s => { let a = 0, t = 0; for (const d of s.days) for (const [m, c] of Object.entries(d.modeCount)) { t += c; if (m.includes('cluster')) a += c; } return 100 * a / t; }, null, 3);
add('storms', 'speed', 'Storm speed, median mph', s => q(s.days.map(d => d.stormMph), 0.5), null, 2);
// Cold pool (every active storm every half hour, intensity 0.22+)
const act = s => s.rows.filter(r => r.intensity >= 0.22);
add('coldpool', 'cps_med', 'coldPoolStrength, median', s => q(act(s).map(r => r.coldPoolStrength), 0.5), null, 0.02);
add('coldpool', 'cps_p10', 'coldPoolStrength, 10th', s => q(act(s).map(r => r.coldPoolStrength), 0.1), null, 0.02);
add('coldpool', 'cps_p90', 'coldPoolStrength, 90th', s => q(act(s).map(r => r.coldPoolStrength), 0.9), null, 0.03);
add('coldpool', 'def_med', 'Cold pool deficit F, median', s => q(act(s).map(r => r.coldPoolDeficitF), 0.5), null, 0.3, 'E2: keep median');
add('coldpool', 'def_p10', 'Cold pool deficit F, 10th', s => q(act(s).map(r => r.coldPoolDeficitF), 0.1), null, 0.3);
add('coldpool', 'def_p90', 'Cold pool deficit F, 90th', s => q(act(s).map(r => r.coldPoolDeficitF), 0.9), null, 0.5);
add('coldpool', 'def_line', 'Deficit F in lines, median', s => q(act(s).filter(r => r.lineShare >= 0.5).map(r => r.coldPoolDeficitF), 0.5), null, 0.5);
add('coldpool', 'contrast_mean', 'outflowContrastK at storms, mean', s => mean(act(s).map(r => r.outflowContrastK).filter(Number.isFinite)), null, 0.1);
add('coldpool', 'contrast_p90', 'outflowContrastK at storms, 90th', s => q(act(s).map(r => r.outflowContrastK), 0.9), null, 0.2);
add('coldpool', 'contrast_1k', 'Storm samples with outflowContrastK 1+ %', s => pct(act(s).filter(r => Number.isFinite(r.outflowContrastK)), r => r.outflowContrastK >= 1), null, 2);
add('coldpool', 'pool_map', 'Map share with ground pool 1.5 K+ % (mean)', s => 100 * mean(s.days.map(d => d.poolShare)), null, 1);
add('coldpool', 'pool_max', 'Strongest ground pool K a day, median', s => q(s.days.map(d => d.poolMax), 0.5), null, 0.5);
// Outflow boundaries
add('outflow', 'ofb_lines', 'Outflow boundaries per analysis (mean)', s => mean(s.days.map(d => d.outflowLinesPerAnalysis)), null, 0.2);
add('outflow', 'ofb_km', 'Outflow boundary km per analysis (mean)', s => mean(s.days.map(d => d.outflowKmPerAnalysis)), null, 40);
add('outflow', 'ofb_pool', 'Cooling at outflow boundaries K, median', s => q(s.days.flatMap(d => d.outflowPoolK), 0.5), null, 0.3, 'real 2-10 K');
add('outflow', 'ofb_life', 'Outflow boundary life, median h', s => q(s.days.flatMap(d => d.outflowLife), 0.5), null, 0.5);
add('outflow', 'ofb_life6', 'Outflow boundaries lasting 6 h+ %', s => pct(s.days.flatMap(d => d.outflowLife), v => v >= 6), null, 3);
// Tornado attribution
add('tornado source', 'src_line', 'Tornadoes from line mesovortices %', s => pct(s.tornadoes, t => t.source === 'line'), 20, 3, 'real ~1/5 (StormRotation note)');
add('tornado source', 'src_spout', 'Landspout tornadoes %', s => pct(s.tornadoes, t => t.source === 'landspout'), 10, 2, 'real ~1/10 boundary, ordinary storms');
add('tornado source', 'near_ofb', 'Tornadoes starting within 40 mi of an outflow boundary %', s => pct(s.tornadoes, t => t.nearOutflow), null, 4);
add('tornado source', 'near_any', 'Tornadoes within 40 mi of any analysed line %', s => pct(s.tornadoes, t => t.nearOutflow || t.nearFront || t.nearDryline), null, 4);
add('tornado source', 'tor_cps', 'Parent coldPoolStrength at tornado start, median', s => q(s.tornadoes.map(t => t.cps), 0.5), null, 0.03);
add('tornado source', 'tor_night', 'Tornadoes 8 pm-7 am CDT %', s => pct(s.tornadoes, t => { const h = local(t.start); return h >= 20 || h < 7; }), null, 4, 'brief: engine 37 vs real 27 (definition unclear)');
add('tornado source', 'tor_3to9', 'Tornadoes 3-9 pm CDT %', s => pct(s.tornadoes, t => { const h = local(t.start); return h >= 15 && h < 21; }), null, 4, 'lock-in baseline 48%');

// ---- compute
const setOf = list => ({ days: list.flatMap(r => r.daily), reportDays: list.flatMap(r => r.reportDays), storms: list.flatMap(r => r.storms), tornadoes: list.flatMap(r => r.daily.flatMap(d => d.tornadoList)), rows: list.flatMap(r => rows[r.seed]) });
const all = setOf(runs), halfA = setOf(runs.filter(r => r.seed <= 4)), halfB = setOf(runs.filter(r => r.seed > 4));
const per = runs.map(r => setOf([r]));
const sd = a => { const v = a.filter(Number.isFinite), m = mean(v); return v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)) : NaN; };
const dist = (v, t) => (t === null ? null : typeof t === 'number' ? Math.abs(v - t) : 'max' in t ? Math.max(0, v - t.max) : Math.max(0, t.min - v));
const base = baseName ? JSON.parse(fs.readFileSync(path.join(process.env.REG_OUT || __dirname, baseName, 'scorecard.json'), 'utf8')) : null;
const card = [];
for (const m of M) {
  const value = m.fn(all), seedSd = sd(per.map(m.fn));
  const tol = Math.max(m.floor, Number.isFinite(seedSd) ? seedSd : 0);
  const entry = { key: m.key, group: m.group, label: m.label, value, halfA: m.fn(halfA), halfB: m.fn(halfB), seedSd, tol, target: m.target, note: m.note };
  if (base) {
    const b = base.measures.find(x => x.key === m.key);
    if (b) {
      entry.base = b.value; entry.baseTol = b.tol;
      if (m.target !== null) { const worse = dist(value, m.target) - dist(b.value, m.target); entry.verdict = worse > b.tol ? 'REGRESSION' : worse < -b.tol ? 'better' : 'ok'; }
      else entry.verdict = Math.abs(value - b.value) > b.tol ? 'MOVED' : 'ok';
    }
  }
  card.push(entry);
}
const info = fs.existsSync(path.join(dir, 'run-info.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'run-info.json'), 'utf8')) : {};
fs.writeFileSync(path.join(dir, 'scorecard.json'), JSON.stringify({ name, base: baseName ?? null, seeds: runs.map(r => r.seed), days: all.days.length, reportDays: all.reportDays.length, tornadoes: all.tornadoes.length, stormRows: all.rows.length, info, measures: card }, null, 1));
const fmt = v => (v === undefined || v === null ? '' : typeof v === 'object' ? ('max' in v ? `<=${v.max}` : `>=${v.min}`) : Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)) : String(v));
const lines = [`Scorecard ${name}${baseName ? ` against ${baseName}` : ''}: seeds ${runs.map(r => r.seed).join(',')}, ${all.days.length} days, ${all.reportDays.length} report days, ${all.tornadoes.length} tornadoes, ${all.rows.length} storm samples${info.minutes ? `, run ${info.minutes} min` : ''}`];
lines.push(['measure'.padEnd(58), 'value'.padStart(7), 'half1'.padStart(7), 'half2'.padStart(7), 'target'.padStart(7), 'tol'.padStart(6), ...(base ? ['base'.padStart(7), 'verdict'.padStart(11)] : []), '  note'].join(''));
let group = '';
for (const e of card) {
  if (e.group !== group) { group = e.group; lines.push(`--- ${group}`); }
  lines.push([e.label.padEnd(58), fmt(e.value).padStart(7), fmt(e.halfA).padStart(7), fmt(e.halfB).padStart(7), (e.target === null ? 'track' : fmt(e.target)).padStart(7), fmt(e.tol).padStart(6), ...(base ? [fmt(e.base).padStart(7), (e.verdict ?? '').padStart(11)] : []), e.note ? `  ${e.note}` : ''].join(''));
}
if (base) { const bad = card.filter(e => e.verdict === 'REGRESSION'), moved = card.filter(e => e.verdict === 'MOVED'); lines.push(`\nREGRESSIONS: ${bad.length ? bad.map(e => e.key).join(', ') : 'none'} | track-only MOVED: ${moved.length ? moved.map(e => e.key).join(', ') : 'none'}`); }
const text = lines.join('\n');
fs.writeFileSync(path.join(dir, 'scorecard.txt'), text + '\n');
console.log(text);

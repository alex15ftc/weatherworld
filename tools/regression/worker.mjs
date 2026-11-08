// Regression-suite worker: one seed, N days, stepped like the server (storms every 5 min,
// atmosphere every 30 min), storm log on (captureTruth with places runs logStormTick each tick).
//   node worker.mjs <seed> <days> <outDir>
// Writes <outDir>/seed-<seed>.json (per-day records + per-storm summaries + tornado list)
// and <outDir>/coldpool-<seed>.csv (every active storm every half hour).
// Day logic copied from scripts/activity-report.mjs (worker), plus cold pool, mode, outflow
// boundaries, tornado source and report counts.
import fs from 'node:fs';
import path from 'node:path';
const REPO = 'file:///C:/Users/alex1/Documents/VSCodeProjects/weatherworld/';
const { avoidBackgroundThrottling } = await import(REPO + 'js/runtime/processPriority.node.js');
avoidBackgroundThrottling();
const { AtmosphereWorld } = await import(REPO + 'js/world/AtmosphereWorld.js');
const { captureTruth, aggregateTruth } = await import(REPO + 'js/verification/truth.js');
const { placesFor } = await import(REPO + 'server/CountyLayer.js');
const { RISK_RADIUS_MILES } = await import(REPO + 'js/forecast/spcOutlookRules.js');
const { worldCategoryFromHazard, PROBABILITY_LEVELS } = await import(REPO + 'js/forecast/worldRiskCategories.js');
const { lineShare, rotatingShare, describeStormMode } = await import(REPO + 'js/storms/StormModeEngine.js');
const { convectiveDay } = await import(REPO + 'js/reports/stormLog.js');

const seed = Number(process.argv[2]), days = Number(process.argv[3] ?? 10), outDir = process.argv[4];
const ORDER = ['NONE', 'TSTM', 'MRGN', 'SLGT', 'ENH', 'MDT', 'HIGH'];
const efOf = mph => (mph >= 201 ? 5 : mph >= 166 ? 4 : mph >= 136 ? 3 : mph >= 111 ? 2 : mph >= 86 ? 1 : 0);
const NEAR_KM = 64;
const started = Date.now();

const atmosphere = new AtmosphereWorld({ seed }), world = atmosphere.world, n = world.width * world.height;
const regional = atmosphere.regional, cellKm = world.cellSizeKm;
const places = placesFor(world);
const startHour = world.stormEngine?.validHourUtc ?? world.validHourUtc;
const hourNow = () => world.stormEngine?.validHourUtc ?? world.validHourUtc;
const looks = new Map(), stormInfo = new Map(), daily = [];
const csv = fs.createWriteStream(path.join(outDir, `coldpool-${seed}.csv`));
csv.write('seed,id,hourUtc,ageHours,intensity,coldPoolStrength,coldPoolDeficitF,lineShare,rotating,mode,lclM,outflowContrastK,bulkShearKt,coldPoolRadiusKm\n');
const r3 = v => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : '');
const outflowTracks = {};

// Outflow boundary tracking (2026-11-07): a line continues a track whose points lie near its own (the
// mean distance from the shorter of the two to the other under 60 km, so a line that grows, shrinks
// or splits keeps its track), and a track survives up to two analyses in which the line is not drawn
// (it can drop under the analysis's length or contrast for an hour and still be there). Life is from
// the first analysis that drew it to the last, plus one half-hour. (Until then: centroids within
// 80 km from one analysis to the next, ending at the first analysis that missed it.)
function trackOutflowLines(state, lines, lifeOut) {
  state.n = (state.n ?? 0) + 1; state.list ??= [];
  const pick = p => { const step = Math.max(1, Math.floor(p.length / 12)); return p.filter((_, i) => i % step === 0); };
  const meanNear = (a, b) => a.reduce((s, q) => s + Math.min(...b.map(r => Math.hypot(q.x - r.x, q.y - r.y))), 0) / a.length;
  const now = lines.map(l => pick(l.pointsKm)), pairs = [];
  now.forEach((p, i) => state.list.forEach((t, j) => { const d = p.length <= t.points.length ? meanNear(p, t.points) : meanNear(t.points, p); if (d < 60) pairs.push({ i, j, d }); }));
  pairs.sort((a, b) => a.d - b.d);
  const usedLine = new Set(), usedTrack = new Set();
  for (const { i, j } of pairs) { if (usedLine.has(i) || usedTrack.has(j)) continue; usedLine.add(i); usedTrack.add(j); Object.assign(state.list[j], { points: now[i], last: state.n }); }
  now.forEach((p, i) => { if (!usedLine.has(i)) state.list.push({ points: p, born: state.n, last: state.n }); });
  state.list = state.list.filter(t => { if (state.n - t.last <= 2) return true; lifeOut.push(0.5 * (t.last - t.born + 1)); return false; });
}

// Is a point within NEAR_KM of a line of this type in the latest analysis?
function nearLine(p, type) {
  for (const line of atmosphere.boundaries ?? []) if (line.type === type) for (const q of line.pointsKm ?? []) if (Math.hypot(q.x - p.x, q.y - p.y) <= NEAR_KM) return true;
  return false;
}

for (let day = 0; day < days; day++) {
  const frames = [], seen = new Set(), initiations = [], tornadoesBefore = world.stormEngine.totalTornadoes;
  const rec = { peak: 0, hailStorms: new Set(), windStorms: new Set(), maxHail: 0, maxGust: 0, supercellIds: new Set(), groundSupercellIds: new Set(), tornadoKeys: [], speeds: [],
    outflowLines: 0, outflowKm: 0, analyses: 0, poolShare: 0, poolMax: 0, outflowPoolK: [], stormSamples: 0, modeCount: {} };
  for (let step = 0; step < 288; step++) {
    atmosphere.advanceStormLayer(1 / 12);
    const half = (step + 1) % 6 === 0;
    if (half) atmosphere.advance(0.5, { advanceStorms: false });
    const frame = captureTruth(world, frames, seen, initiations, places);
    rec.peak = Math.max(rec.peak, frame.activeStorms);
    const h = hourNow();
    for (const s of world.storms) {
      if (!s.active) continue;
      let info = stormInfo.get(s.id);
      if (!info) { info = { id: s.id, born: s.createdHourUtc ?? h, last: h, maxIntensity: 0, supercell: false, line: false, maxCps: 0, maxDefF: 0 }; stormInfo.set(s.id, info); }
      info.last = h; info.maxIntensity = Math.max(info.maxIntensity, s.intensity ?? 0);
      info.maxCps = Math.max(info.maxCps, s.coldPoolStrength ?? 0); info.maxDefF = Math.max(info.maxDefF, s.coldPoolTemperatureDeficitF ?? 0);
      const hail = s.currentHailSizeInches ?? 0, gust = s.surfaceWind?.gustMph ?? 0;
      if (hail >= 1) rec.hailStorms.add(s.id); if (gust >= 58) rec.windStorms.add(s.id);
      rec.maxHail = Math.max(rec.maxHail, hail); rec.maxGust = Math.max(rec.maxGust, gust);
      if ((s.mesocycloneStrength ?? 0) >= 0.3) {
        rec.supercellIds.add(s.id);
        if (!s.elevatedFeed && Math.abs(s.environment?.cin ?? 999) < 100) rec.groundSupercellIds.add(s.id);
      }
      if (s.tornado?.onGround) {
        const key = `${s.id}#${s.tornado.cycleCount}`, wind = s.tornado.windSpeedMph ?? 0;
        let look = looks.get(key);
        if (!look) {
          const pos = s.tornado.positionKm ?? s.positionKm;
          look = { start: h, ef: 0, source: s.tornado.source ?? 'mesocyclone', nearOutflow: nearLine(pos, 'outflow'), nearFront: ['cold', 'warm', 'stationary'].some(t => nearLine(pos, t)), nearDryline: nearLine(pos, 'dryline'),
            mode: s.mode ?? describeStormMode(s), cps: s.coldPoolStrength ?? 0, defF: s.coldPoolTemperatureDeficitF ?? 0, contrastK: s.environment?.outflowContrastK ?? 0 };
          looks.set(key, look); rec.tornadoKeys.push(key);
        }
        look.ef = Math.max(look.ef, efOf(s.tornado.ratedWindMph ?? s.tornado.peakWindSpeedMph ?? wind));
        look.km = Math.max(look.km ?? 0, s.tornado.pathLengthKm ?? 0); look.min = Math.max(look.min ?? 0, s.tornado.groundTimeMinutes ?? 0);
      }
      if (half) {
        const mode = s.mode ?? describeStormMode(s), ls = lineShare(s), rot = rotatingShare(s), env = s.environment ?? {};
        if (ls >= 0.5) info.line = true; else if (rot >= 0.5) info.supercell = true;
        rec.modeCount[mode] = (rec.modeCount[mode] ?? 0) + 1; rec.stormSamples++;
        if ((s.intensity ?? 0) >= 0.22) rec.speeds.push(Math.hypot(s.velocityKph?.east ?? 0, s.velocityKph?.north ?? 0) * 0.621371);
        csv.write(`${seed},${s.id},${r3(h)},${r3(s.ageHours)},${r3(s.intensity)},${r3(s.coldPoolStrength)},${r3(s.coldPoolTemperatureDeficitF)},${r3(ls)},${r3(rot)},"${mode}",${Math.round(env.lcl ?? NaN) || ''},${r3(env.outflowContrastK)},${r3(env.bulkShear)},${r3(s.coldPoolRadiusKm)}\n`);
      }
    }
    if (half) {
      // Outflow boundaries in this analysis, cold pool coverage, and how long each boundary lasts.
      rec.analyses++;
      const outflows = (atmosphere.boundaries ?? []).filter(b => b.type === 'outflow' && (b.pointsKm?.length ?? 0) > 1);
      rec.outflowLines += outflows.length;
      for (const b of outflows) {
        let len = b.lengthKm; if (!Number.isFinite(len)) { len = 0; for (let i = 1; i < b.pointsKm.length; i++) len += Math.hypot(b.pointsKm[i].x - b.pointsKm[i - 1].x, b.pointsKm[i].y - b.pointsKm[i - 1].y); }
        rec.outflowKm += len;
      }
      const pool = regional.coldPool; let cnt = 0, mx = 0;
      for (let k = 0; k < pool.length; k++) { if (pool[k] >= 1.5) cnt++; if (pool[k] > mx) mx = pool[k]; }
      rec.poolShare += cnt / pool.length; rec.poolMax = Math.max(rec.poolMax, mx);
      // Storm cooling read at outflow boundary points (largest pool within two cells).
      for (const b of outflows) for (let i = 0; i < b.pointsKm.length; i += 3) {
        const p = b.pointsKm[i], cx = Math.floor(p.x / cellKm), cy = Math.floor(p.y / cellKm); let best = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = cx + dx, Y = cy + dy; if (X >= 0 && Y >= 0 && X < world.width && Y < world.height) best = Math.max(best, pool[Y * world.width + X]); }
        rec.outflowPoolK.push(Math.round(best * 100) / 100);
      }
      trackOutflowLines(outflowTracks, outflows, (rec.outflowLife ??= []));
    }
  }
  const truth = aggregateTruth(frames, initiations, world.width, world.height, RISK_RADIUS_MILES / world.cellSizeMiles, world.cellSizeMiles);
  const any = field => truth[`${field}Exact`].some(Boolean);
  daily.push({
    seed, day: day + 1, storms: seen.size, peak: rec.peak, tornadoes: world.stormEngine.totalTornadoes - tornadoesBefore,
    hailStorms: rec.hailStorms.size, windStorms: rec.windStorms.size, maxHail: rec.maxHail, maxGust: rec.maxGust,
    severe: any('hail') || any('wind') || any('tornado'), tornado: any('tornado'), sigTornado: any('tornadoSig'), sigHail: any('hailSig'), sigWind: any('windSig'),
    category: ORDER[Math.max(...truth.risk.map(r => ORDER.indexOf(r)))], worldCategory: ORDER[Math.max(...truth.worldRisk.map(r => ORDER.indexOf(r)))],
    supercells: rec.supercellIds.size, groundSupercells: rec.groundSupercellIds.size,
    cig: Object.fromEntries(['tornado', 'wind', 'hail'].map(hz => [hz, Math.max(0, ...truth.observedCig[hz])])),
    tornadoList: rec.tornadoKeys.map(k => { const l = looks.get(k); return { storm: k.slice(0, k.indexOf('#')), start: l.start, ef: l.ef, km: Math.round(l.km ?? 0), minutes: Math.round(l.min ?? 0), source: l.source, nearOutflow: l.nearOutflow, nearFront: l.nearFront, nearDryline: l.nearDryline, mode: l.mode, cps: l.cps, defF: l.defF, contrastK: l.contrastK }; }),
    stormMph: rec.speeds.length ? rec.speeds.sort((a, b) => a - b)[Math.floor(rec.speeds.length / 2)] : null,
    modeCount: rec.modeCount, stormSamples: rec.stormSamples,
    outflowLinesPerAnalysis: rec.outflowLines / rec.analyses, outflowKmPerAnalysis: rec.outflowKm / rec.analyses, poolShare: rec.poolShare / rec.analyses, poolMax: rec.poolMax,
    outflowPoolK: rec.outflowPoolK, outflowLife: rec.outflowLife ?? []
  });
  process.stderr.write(`seed ${seed} day ${day + 1} done (${((Date.now() - started) / 1000).toFixed(0)} s)\n`);
}
// Reports by convective day; keep only days fully inside the run.
const endHour = hourNow(), reportDays = [];
for (const [key, d] of Object.entries(world.reportLog?.days ?? {})) {
  const k = Number(key), from = 12 + 24 * (k - 1), to = from + 24;
  if (from < startHour - 1e-6 || to > endHour + 0.01) continue;
  const hail = d.reports.filter(r => r.type === 'hail').map(r => (Number(r.size) || 0) / 100);
  const wind = d.reports.filter(r => r.type === 'wind').map(r => Number(r.speed ?? r.estimatedMph) || 0);
  reportDays.push({ day: k, hail, wind, tornadoReports: d.reports.filter(r => r.type === 'tornado').length, tornadoTracks: d.tornadoes.length });
}
const storms = [...stormInfo.values()].map(s => ({ ...s, lifeHours: s.last - s.born, ended: s.last < endHour - 0.1 }));
csv.end();
await new Promise(res => csv.on('finish', res));
fs.writeFileSync(path.join(outDir, `seed-${seed}.json`), JSON.stringify({ seed, days, startHour, endHour, seconds: (Date.now() - started) / 1000, daily, reportDays, storms }));
process.stderr.write(`seed ${seed} finished in ${((Date.now() - started) / 1000).toFixed(0)} s\n`);

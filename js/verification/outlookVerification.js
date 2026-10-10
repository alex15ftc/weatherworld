// Verification of issued outlooks against the authoritative simulation's severe reports
// (hazard within 25 mi during the valid period). Shared by scripts/outlook-audit.mjs and
// scripts/outlook-tune.mjs.
import { RISK_ORDER } from '../forecast/spcOutlookRules.js';

export const RELIABILITY_BINS = 40;

// truth: aggregateTruth() for the product's valid period.
export function verifyProduct(product, truth, { width, height, cellSizeMiles }, histograms = null) {
  const n = width * height;
  const observed = {
    tornado: truth.tornado, hail: truth.hail, wind: truth.wind, thunder: truth.storm,
    severe: Uint8Array.from(truth.tornado, (v, i) => v || truth.hail[i] || truth.wind[i])
  };
  const observedSig = {
    tornado: truth.tornadoSig, hail: truth.hailSig, wind: truth.windSig,
    severe: Uint8Array.from(truth.tornadoSig, (v, i) => v || truth.hailSig[i] || truth.windSig[i])
  };
  const hazards = product.key === 'day3' ? ['severe'] : ['tornado', 'hail', 'wind'];
  const row = {
    key: product.key, issued: product.issuedHourUtc, valid: [product.validStartHour, product.validEndHour],
    forecastRisk: product.overallRisk, observedRisk: truth.risk.reduce((a, b) => (RISK_ORDER.indexOf(b) > RISK_ORDER.indexOf(a) ? b : a), 'NONE'),
    members: product.ensemble, hazards: {}
  };
  for (const hazard of [...hazards, 'thunder']) {
    const raw = hazard === 'thunder' ? product.grid.map(g => g.thunderProbability / 100) : product.rawProbability[hazard];
    const published = hazard === 'thunder' ? product.grid.map(g => (g.thunderProbability >= 10 ? 0.1 : 0)) : product.grid.map(g => g[`${hazard}Probability`] / 100);
    const cig = hazard === 'thunder' ? null : product.grid.map(g => g[`${hazard}Cig`]);
    const o = observed[hazard];
    const hist = histograms ? (((histograms[product.key] ??= {})[hazard]) ??= emptyHistogram()) : null;
    let brier = 0, base = 0, fcArea = 0, obsArea = 0, hit = 0, fx = 0, fy = 0, fw = 0, ox = 0, oy = 0, maxP = 0, cigCells = 0, cigSigHits = 0, cigEventCells = 0;
    const levels = {};
    for (let i = 0; i < n; i++) {
      if (hist) { const b = Math.min(RELIABILITY_BINS - 1, Math.floor(raw[i] * RELIABILITY_BINS)); hist.cells[b]++; hist.hits[b] += o[i]; hist.sumRaw[b] += raw[i]; }
      const p = published[i];
      brier += (p - o[i]) ** 2; base += o[i]; maxP = Math.max(maxP, p);
      if (p > 0) {
        fcArea++; fx += (i % width) * p; fy += Math.floor(i / width) * p; fw += p; if (o[i]) hit++;
        const level = (levels[Math.round(p * 100)] ??= { cells: 0, hits: 0, cig: [0, 0, 0, 0] }); level.cells++; level.hits += o[i]; level.cig[Math.min(3, cig?.[i] ?? 0)]++;
      }
      if (o[i]) { obsArea++; ox += i % width; oy += Math.floor(i / width); }
      if (cig?.[i] > 0) { cigCells++; if (o[i]) { cigEventCells++; if (observedSig[hazard][i]) cigSigHits++; } }
    }
    row.hazards[hazard] = {
      brier: brier / n, baseRate: base / n, maxProb: maxP, forecastAreaCells: fcArea, observedAreaCells: obsArea, hitCells: hit, levels,
      centroidErrorMiles: fw && obsArea ? Math.hypot(fx / fw - ox / obsArea, fy / fw - oy / obsArea) * cellSizeMiles : null,
      cig: { cells: cigCells, eventCells: cigEventCells, sigHits: cigSigHits }
    };
  }
  return row;
}

export function emptyHistogram() {
  return { cells: new Array(RELIABILITY_BINS).fill(0), hits: new Array(RELIABILITY_BINS).fill(0), sumRaw: new Array(RELIABILITY_BINS).fill(0) };
}

export function mergeHistograms(target, source) {
  for (const [day, byHazard] of Object.entries(source)) for (const [hazard, hist] of Object.entries(byHazard)) {
    const h = ((target[day] ??= {})[hazard] ??= emptyHistogram());
    for (let b = 0; b < RELIABILITY_BINS; b++) { h.cells[b] += hist.cells[b]; h.hits[b] += hist.hits[b]; h.sumRaw[b] += hist.sumRaw[b]; }
  }
  return target;
}

// Summary tables. Returns per day/hazard scores for programmatic use.
export function summarizeVerification(rows, { print = true } = {}) {
  const fmt = (v, d = 2) => (v == null || !Number.isFinite(v) ? '  -  ' : v.toFixed(d));
  const log = print ? console.log : () => {};
  const scores = {};
  log('\n=== Reliability of published levels (observed frequency within 25 mi) ===');
  const levelTable = {};
  for (const r of rows) for (const [hazard, x] of Object.entries(r.hazards)) for (const [level, v] of Object.entries(x.levels)) {
    const b = ((levelTable[r.key] ??= {})[hazard] ??= {})[level] ??= { cells: 0, hits: 0, cig: [0, 0, 0, 0] };
    b.cells += v.cells; b.hits += v.hits; v.cig?.forEach((n, c) => { b.cig[c] += n; });
  }
  for (const day of ['day1', 'day2', 'day3']) for (const [hazard, levels] of Object.entries(levelTable[day] ?? {})) {
    log(`${day} ${hazard.padEnd(7)} ` + Object.entries(levels).sort((a, b) => a[0] - b[0]).map(([lvl, { cells, hits }]) => `${lvl}%: ${(100 * hits / cells).toFixed(0)}% (n=${cells})`).join(' | '));
  }
  // Higher probabilities should come with higher conditional intensity groups.
  log('\n=== Conditional intensity by probability level (share of area at CIG0/1/2/3) ===');
  for (const day of ['day1', 'day2', 'day3']) for (const [hazard, levels] of Object.entries(levelTable[day] ?? {})) {
    if (hazard === 'thunder') continue;
    log(`${day} ${hazard.padEnd(7)} ` + Object.entries(levels).sort((a, b) => a[0] - b[0]).map(([lvl, { cells, cig }]) => `${lvl}%: ${cig.map(n => Math.round(100 * n / cells)).join('/')}`).join(' | '));
  }
  log('\n=== Per day / hazard (published product) ===');
  for (const day of ['day1', 'day2', 'day3']) {
    const set = rows.filter(r => r.key === day);
    if (!set.length) continue;
    for (const hazard of Object.keys(set[0].hazards)) {
      const hs = set.map(r => r.hazards[hazard]);
      const climo = hs.reduce((a, x) => a + x.baseRate, 0) / hs.length;
      const brier = hs.reduce((a, x) => a + x.brier, 0) / hs.length;
      const brierRef = hs.reduce((a, x) => a + x.baseRate * (1 - climo) ** 2 + (1 - x.baseRate) * climo ** 2, 0) / hs.length;
      const withObs = hs.filter(x => x.observedAreaCells > 0), withFc = hs.filter(x => x.forecastAreaCells > 0);
      const pod = withObs.length ? withObs.reduce((a, x) => a + x.hitCells / x.observedAreaCells, 0) / withObs.length : null;
      const far = withFc.length ? withFc.reduce((a, x) => a + 1 - x.hitCells / x.forecastAreaCells, 0) / withFc.length : null;
      const bias = withObs.length ? withObs.reduce((a, x) => a + Math.min(x.forecastAreaCells / x.observedAreaCells, 20), 0) / withObs.length : null;
      const cent = hs.filter(x => x.centroidErrorMiles != null).map(x => x.centroidErrorMiles);
      const cig = hs.reduce((a, x) => ({ cells: a.cells + x.cig.cells, events: a.events + x.cig.eventCells, sig: a.sig + x.cig.sigHits }), { cells: 0, events: 0, sig: 0 });
      const bss = 1 - brier / brierRef;
      (scores[day] ??= {})[hazard] = { bss, bias, pod, far };
      log(`${day} ${hazard.padEnd(7)} n=${hs.length} BSS ${fmt(bss)} | area bias ${fmt(bias)} POD ${fmt(pod)} FAR ${fmt(far)} | centroid err ${cent.length ? Math.round(cent.reduce((a, b) => a + b, 0) / cent.length) + ' mi' : '-'} | false-alarm products ${hs.filter(x => x.forecastAreaCells > 0 && !x.observedAreaCells).length}/${withFc.length}, missed ${hs.filter(x => !x.forecastAreaCells && x.observedAreaCells).length}/${withObs.length}${cig.cells ? ` | CIG area: sig share of events ${fmt(cig.events ? cig.sig / cig.events : null)} (n=${cig.events})` : ''}`);
    }
  }
  log('\n=== Categorical: forecast overall risk vs observed (practically perfect) ===');
  for (const day of ['day1', 'day2', 'day3']) {
    const set = rows.filter(r => r.key === day);
    if (!set.length) continue;
    let exact = 0, within1 = 0, over = 0, under = 0;
    const matrix = {};
    for (const r of set) {
      const d = RISK_ORDER.indexOf(r.forecastRisk) - RISK_ORDER.indexOf(r.observedRisk);
      if (!d) exact++; if (Math.abs(d) <= 1) within1++; if (d > 0) over++; if (d < 0) under++;
      const k = `${r.forecastRisk}->${r.observedRisk}`; matrix[k] = (matrix[k] ?? 0) + 1;
    }
    (scores[day] ??= {}).categorical = { n: set.length, exact, within1, over, under };
    log(`${day} n=${set.length} exact ${exact} within-one ${within1} over ${over} under ${under} | ${Object.entries(matrix).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  }
  return scores;
}

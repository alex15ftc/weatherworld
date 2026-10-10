// Convective outlooks from an ensemble of the simulation itself. At each SPC issuance time the
// current world is copied into perturbed members (analysis and model uncertainty, see
// ensembleMember.js) that run forward with the full physics. The probability of each hazard
// within 25 mi of a point is the fraction of members producing it there, smoothed for the
// finite ensemble and calibrated against the authoritative simulation's own history. The
// SPC probability levels, conditional intensity groups and category matrix make the product.
//
// Outlooks roll across weather systems as SPC's roll across days: a period beyond the end of
// the current system is forecast from the next system's starting state (fixed by its seed),
// with larger perturbations the further ahead that system is. When the authority switches to
// that system its outlooks are already issued and are carried over.
import { snapshotWorld } from '../world/worldSnapshot.js';
import { runEnsembleMember } from './ensembleMember.js';
import { calibrateProbability } from './OutlookCalibration.js';
import { HAZARDS, MAX_CIG, GENERAL_THUNDER_LEVEL, probabilityLevel, publishedCigForHazard, categoryFromHazard, highestRisk, RISK_ORDER, RISK_LABELS } from './spcOutlookRules.js';
import { INITIAL_VALID_HOUR_UTC, SYSTEM_DURATION_HOURS } from '../constants.js';
import { diskOffsets } from '../verification/truth.js';
import { nextSystemSeed, buildSystemWorld } from '../world/systemBuilder.js';

export const OUTLOOK_DAYS = {
  day1: { key: 'day1', label: 'Day 1', offset: 0 },
  day2: { key: 'day2', label: 'Day 2', offset: 1 },
  day3: { key: 'day3', label: 'Day 3', offset: 2 }
};
// Issuance times (UTC hour of day) and the outlooks each one issues: Day 1 every 6 hours,
// Day 2 every 12, Day 3 once a day.
export const ISSUANCE_SCHEDULE = [
  { hourUtc: 0, days: ['day1'] },
  { hourUtc: 6, days: ['day1', 'day2', 'day3'] },
  { hourUtc: 12, days: ['day1'] },
  { hourUtc: 18, days: ['day1', 'day2'] }
];
const NEIGHBORHOOD_MILES = 25;
// Gaussian smoothing of member frequencies (km): represents placement uncertainty the finite
// ensemble cannot sample and turns member counts into continuous probability.
export const SMOOTHING_KM = { day1: 40, day2: 55, day3: 70 };
// Tornado tracks are narrow and few, so their frequencies are smoothed over a shorter
// distance than hail and wind swaths (a factor on SMOOTHING_KM).
export const OUTLOOK_TUNING = { tornadoSmoothing: 0.6 };
// A significant-intensity CIG applies where at least this fraction of the members' events
// near a point reach that intensity (CIG1 significant, CIG2 extreme, CIG3 violent).
export const CIG_CONDITIONAL_FRACTION = [0.2, 0.3, 0.3];
const MIN_CIG_EVENT_FRACTION = 0.05;
const MIN_CONTOUR_CELLS = 4;
const MIN_REISSUE_HOURS = 1.5;
// Perturbation amplitude of next-system members grows with the lead to that system's start.
const NEXT_SYSTEM_AMPLITUDE_PER_DAY = 0.5;
const SIG_FIELDS = {
  tornado: ['tornadoSig', 'tornadoExtreme', 'tornadoViolent'],
  hail: ['hailSig', 'hailExtreme'],
  wind: ['windSig', 'windExtreme'],
  severe: ['severeSig', 'severeExtreme']
};

// previousWorld: the system this one follows; its outlooks for this system are carried over
// and only the days it had not issued are requested.
export function initializeOutlookCycle(world, previousWorld = null) {
  world.outlookCycle = { version: 7, products: {}, pending: [], lastIssuedHour: {}, archive: { day1: [], day2: [], day3: [] }, updateLog: [] };
  const carried = previousWorld ? carryOutlooks(previousWorld, world) : [];
  const missing = Object.keys(OUTLOOK_DAYS).filter(key => !carried.includes(key));
  if (missing.length) requestOutlookIssuance(world, missing);
}

function carryOutlooks(previousWorld, world) {
  const seed = world.evolution?.config?.seed, carried = [];
  for (const product of Object.values(previousWorld.outlookCycle?.products ?? {})) {
    if (product.status !== 'issued' || product.system !== 'next' || product.systemSeed !== seed) continue;
    const { system, systemSeed, ...rest } = product;
    const rebased = { ...rest, issuedHourUtc: product.issuedHourUtc - SYSTEM_DURATION_HOURS, validStartHour: product.validStartHour - SYSTEM_DURATION_HOURS, validEndHour: product.validEndHour - SYSTEM_DURATION_HOURS };
    // Only a product that is this same outlook day at the new system's first hour carries over.
    const window = outlookWindow(product.key, world.validHourUtc);
    if (Math.abs(window.start - rebased.validStartHour) > 1e-6 || Math.abs(window.end - rebased.validEndHour) > 1e-6) continue;
    publishProduct(world, rebased);
    world.outlookCycle.lastIssuedHour[product.key] = rebased.issuedHourUtc;
    carried.push(product.key);
  }
  return carried;
}

// Called after each evolution step: issues the outlooks scheduled in (previousHour, now].
export function scheduleOutlookIssuance(world, previousHour) {
  if (!world.outlookCycle) return initializeOutlookCycle(world);
  if (world.runtime?.profile?.outlookInitialOnly) return;
  const now = world.validHourUtc;
  const days = new Set();
  for (const entry of ISSUANCE_SCHEDULE) {
    const first = entry.hourUtc + 24 * Math.ceil((previousHour + 1e-6 - entry.hourUtc) / 24);
    if (first <= now + 1e-6) entry.days.forEach(day => days.add(day));
  }
  if (days.size) requestOutlookIssuance(world, [...days]);
}

// Start of the Day 1 convective period (12Z-12Z) for an issuance at `hour`: issuances from
// 04Z onward look ahead to the period starting at the next 12Z, as SPC's 06Z Day 1 does.
export function day1PeriodStart(hour) {
  return 12 + 24 * Math.floor((hour - 4) / 24);
}

export function outlookWindow(key, issuedHour) {
  const start = day1PeriodStart(issuedHour) + 24 * OUTLOOK_DAYS[key].offset;
  return { key, start: key === 'day1' ? Math.max(issuedHour, start) : start, end: start + 24 };
}

export function systemEndHour() { return INITIAL_VALID_HOUR_UTC + SYSTEM_DURATION_HOURS; }

export function requestOutlookIssuance(world, days) {
  const cycle = world.outlookCycle;
  const mode = world.runtime?.profile?.outlookIssuance ?? 'async';
  const issuedHour = world.validHourUtc;
  const profile = world.runtime?.profile ?? {};
  const lookAhead = profile.outlookNextSystem !== false;
  const windows = [], nextWindows = [];
  for (const key of days) {
    const window = outlookWindow(key, issuedHour);
    const beyond = window.start >= systemEndHour() - 1e-6;
    if (beyond && !lookAhead) {
      publishProduct(world, { productSchemaVersion: 7, key, label: OUTLOOK_DAYS[key].label, status: 'beyond-system', issuedHourUtc: issuedHour, validStartHour: window.start, validEndHour: window.end, overallRisk: 'NONE', grid: null });
      continue;
    }
    if (issuedHour - (cycle.lastIssuedHour[key] ?? -Infinity) < MIN_REISSUE_HOURS && cycle.products[key]?.validEndHour === window.end) continue;
    // A period beyond this system is the next system's, in that system's own hours.
    if (beyond) nextWindows.push({ ...window, sourceStart: window.start - SYSTEM_DURATION_HOURS, sourceEnd: window.end - SYSTEM_DURATION_HOURS });
    else windows.push(window);
  }
  if ((!windows.length && !nextWindows.length) || mode === 'off') return null;
  const seed = world.evolution?.config?.seed ?? 'seed';
  const request = {
    id: `${seed}-${issuedHour}-${[...windows, ...nextWindows].map(w => w.key).join('')}`,
    issuedHourUtc: issuedHour, windows, endHour: windows.length ? Math.max(...windows.map(w => w.end)) : issuedHour,
    members: Math.max(1, Number(profile.outlookMembers) || 12),
    amplitude: Number(profile.outlookAmplitude) || 1,
    memberSeed: hashSeed(seed, issuedHour),
    next: nextWindows.length ? {
      seed: nextSystemSeed(seed), windows: nextWindows, endHour: Math.max(...nextWindows.map(w => w.sourceEnd)),
      amplitude: 1 + NEXT_SYSTEM_AMPLITUDE_PER_DAY * Math.max(0, systemEndHour() - issuedHour) / 24
    } : null
  };
  for (const window of [...windows, ...nextWindows]) cycle.lastIssuedHour[window.key] = issuedHour;
  if (mode === 'sync') {
    const results = windows.length ? runOutlookMembers(snapshotWorld(world, { clone: true }), request) : [];
    const nextResults = request.next ? runNextSystemMembers(world, request) : [];
    // Audits keep the member results to re-build products offline (scripts/outlook-tune.mjs).
    if (profile.keepMemberResults) (cycle.memberLog ??= []).push({ request, results });
    publishOutlookProducts(world, buildOutlookProducts(world, request, results, nextResults));
    return request;
  }
  // async: the host runs the members off-thread. A newer issuance supersedes queued ones.
  const superseded = w => [...windows, ...nextWindows].some(n => n.key === w.key);
  for (const queued of cycle.pending) {
    queued.windows = queued.windows.filter(w => !superseded(w));
    if (queued.next) { queued.next.windows = queued.next.windows.filter(w => !superseded(w)); if (!queued.next.windows.length) queued.next = null; }
    if (!queued.windows.length) queued.snapshot = null;
  }
  cycle.pending = cycle.pending.filter(queued => queued.windows.length || queued.next);
  // The host may supply a cheaper snapshot (serialized for its worker threads).
  if (windows.length) request.snapshot = world.runtime?.snapshot?.(world) ?? snapshotWorld(world, { clone: true });
  cycle.pending.push(request);
  return request;
}

export function memberSpecs(request) {
  return Array.from({ length: request.members }, (_, index) => ({ index, seed: request.memberSeed, amplitude: request.amplitude ?? 1, endHour: request.endHour, windows: request.windows }));
}

// Members for the next system's periods: run from that system's starting state, in its hours.
export function nextMemberSpecs(request) {
  const next = request.next;
  if (!next) return [];
  const windows = next.windows.map(w => ({ key: w.key, start: w.sourceStart, end: w.sourceEnd }));
  return Array.from({ length: request.members }, (_, index) => ({ index, seed: (request.memberSeed ^ 0x5bd1e995) >>> 0, amplitude: next.amplitude, endHour: next.endHour, windows }));
}

function runNextSystemMembers(world, request) {
  const cycle = world.outlookCycle;
  if (cycle.nextSystemState?.seed !== request.next.seed) cycle.nextSystemState = { seed: request.next.seed, state: snapshotWorld(buildSystemWorld(request.next.seed), { clone: true }) };
  return nextMemberSpecs(request).map(spec => runEnsembleMember(structuredClone(cycle.nextSystemState.state), spec));
}

// Runs every member in this thread. The snapshot is consumed by the last member.
export function runOutlookMembers(snapshot, request, specs = memberSpecs(request)) {
  return specs.map((spec, i) => runEnsembleMember(i === specs.length - 1 ? snapshot : structuredClone(snapshot), spec));
}

// --- Products ---------------------------------------------------------------------------

// nextResults: members for request.next (periods belonging to the next weather system).
export function buildOutlookProducts(world, request, memberResults, nextResults = []) {
  const { width, height } = world;
  const cellKm = world.cellSizeKm, cellMiles = world.cellSizeMiles ?? cellKm / 1.609344;
  const disk = diskOffsets(NEIGHBORHOOD_MILES / cellMiles);
  const products = {};
  const parts = [
    ...request.windows.map(window => ({ window, results: memberResults, next: null })),
    ...(request.next?.windows ?? []).map(window => ({ window, results: nextResults, next: request.next }))
  ];
  for (const { window, results, next } of parts) {
    const key = window.key;
    const members = results.map(m => m.windows.find(w => w.key === key)).filter(Boolean);
    const n = width * height;
    // Member event frequency within 25 mi, then smoothed.
    const sigma = SMOOTHING_KM[key] / cellKm;
    const field = (getter, factor = 1) => gaussianSmooth(neighborhoodFrequency(members, getter, width, height, disk), width, height, sigma * factor);
    const tor = OUTLOOK_TUNING.tornadoSmoothing;
    const union = names => m => { const out = new Uint8Array(n); for (const name of names) { const a = m.masks[name]; for (let i = 0; i < n; i++) if (a[i]) out[i] = 1; } return out; };
    const freq = {
      thunder: field(m => m.masks.storm),
      tornado: field(m => m.masks.tornado, tor), tornadoSig: field(m => m.masks.tornadoSig, tor), tornadoExtreme: field(m => m.masks.tornadoExtreme, tor), tornadoViolent: field(m => m.masks.tornadoViolent, tor),
      hail: field(m => m.masks.hail), hailSig: field(m => m.masks.hailSig), hailExtreme: field(m => m.masks.hailExtreme),
      wind: field(m => m.masks.wind), windSig: field(m => m.masks.windSig), windExtreme: field(m => m.masks.windExtreme)
    };
    if (key === 'day3') {
      freq.severe = field(union(['tornado', 'hail', 'wind']));
      freq.severeSig = field(union(['tornadoSig', 'hailSig', 'windSig']));
      freq.severeExtreme = field(union(['tornadoExtreme', 'hailExtreme', 'windExtreme']));
    }
    const hazards = key === 'day3' ? ['severe'] : HAZARDS;
    const levels = {}, cigs = {}, raw = {};
    for (const hazard of hazards) {
      raw[hazard] = freq[hazard];
      const percent = Float32Array.from(freq[hazard], p => 100 * calibrateProbability(key, hazard, p));
      levels[hazard] = cleanContours(Float32Array.from(percent, p => probabilityLevel(hazard, p)), width, height);
      cigs[hazard] = conditionalIntensity(hazard, freq, levels[hazard], width, height);
    }
    const thunder = Float32Array.from(freq.thunder, p => 100 * p);
    const grid = new Array(n);
    const counts = Object.fromEntries(RISK_ORDER.map(r => [r, 0]));
    for (let i = 0; i < n; i++) {
      const severe = hazards.filter(h => levels[h][i] > 0).map(h => categoryFromHazard(h, levels[h][i], cigs[h][i]));
      const risk = severe.length ? highestRisk(severe) : thunder[i] >= GENERAL_THUNDER_LEVEL ? 'TSTM' : 'NONE';
      counts[risk]++;
      grid[i] = key === 'day3'
        ? { risk, severeProbability: levels.severe[i], severeCig: cigs.severe[i], tornadoProbability: 0, hailProbability: 0, windProbability: 0, tornadoCig: 0, hailCig: 0, windCig: 0, thunderProbability: Math.round(thunder[i]) }
        : { risk, tornadoProbability: levels.tornado[i], tornadoCig: cigs.tornado[i], hailProbability: levels.hail[i], hailCig: cigs.hail[i], windProbability: levels.wind[i], windCig: cigs.wind[i], thunderProbability: Math.round(thunder[i]) };
    }
    const overallRisk = highestRisk(grid.map(g => g.risk));
    const storms = members.map(m => m.storms).sort((a, b) => a - b), tornadoes = members.map(m => m.tornadoes).sort((a, b) => a - b);
    products[key] = {
      productSchemaVersion: 7, key, label: OUTLOOK_DAYS[key].label, status: 'issued',
      ...(next ? { system: 'next', systemSeed: next.seed } : {}),
      cycleId: `${request.id}-${key}`, method: 'perturbed-simulation-ensemble', neighborhoodMiles: NEIGHBORHOOD_MILES,
      issuedHourUtc: request.issuedHourUtc, validStartHour: window.start, validEndHour: window.end,
      overallRisk, riskLabel: RISK_LABELS[overallRisk], counts, memberCount: members.length,
      ensemble: {
        stormsPerMember: { min: storms[0] ?? 0, median: storms[Math.floor(storms.length / 2)] ?? 0, max: storms.at(-1) ?? 0 },
        tornadoesPerMember: { min: tornadoes[0] ?? 0, median: tornadoes[Math.floor(tornadoes.length / 2)] ?? 0, max: tornadoes.at(-1) ?? 0 },
        membersWithTornadoes: tornadoes.filter(t => t > 0).length
      },
      // Uncalibrated smoothed member frequencies (0-1), kept for calibration fitting.
      rawProbability: Object.fromEntries(Object.entries(raw).map(([h, values]) => [h, Array.from(values, v => Math.round(v * 1000) / 1000)])),
      grid
    };
  }
  return products;
}

export function publishOutlookProducts(world, products) {
  for (const product of Object.values(products)) publishProduct(world, product);
}

function publishProduct(world, product) {
  const cycle = world.outlookCycle;
  const previous = cycle.products[product.key];
  if (previous?.status === 'issued') {
    const history = cycle.archive[product.key] ??= [];
    history.push({ ...previous, grid: undefined, rawProbability: undefined });
    if (history.length > 24) history.shift();
  }
  cycle.products[product.key] = product;
  world.forEachCell((cell, x, y) => {
    cell.predictiveOutlook ??= {};
    cell.predictiveOutlook[product.key] = product.grid?.[y * world.width + x] ?? null;
  });
  cycle.updateLog.push({ cycleId: product.cycleId ?? null, key: product.key, status: product.status, issuedHourUtc: product.issuedHourUtc, overallRisk: product.overallRisk });
  if (cycle.updateLog.length > 36) cycle.updateLog.shift();
}

// Issued products serve the matching day; outlooks issued from a world are only published
// back into that same world (the server checks the system number before calling this).
export function getOutlookSpec(key) { return OUTLOOK_DAYS[key] ?? OUTLOOK_DAYS.day1; }

// --- Fields ------------------------------------------------------------------------------

function neighborhoodFrequency(members, getter, width, height, disk) {
  const out = new Float32Array(width * height);
  if (!members.length) return out;
  const spread = new Uint8Array(width * height);
  for (const member of members) {
    spread.fill(0);
    const mask = getter(member);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const x = i % width, y = (i - x) / width;
      for (const [dx, dy] of disk) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < width && yy < height) spread[yy * width + xx] = 1;
      }
    }
    for (let i = 0; i < out.length; i++) out[i] += spread[i];
  }
  for (let i = 0; i < out.length; i++) out[i] /= members.length;
  return out;
}

// Separable Gaussian blur, renormalised at the domain edges.
export function gaussianSmooth(values, width, height, sigma) {
  if (!(sigma > 0.3)) return values;
  const radius = Math.ceil(3 * sigma);
  const kernel = Array.from({ length: 2 * radius + 1 }, (_, k) => Math.exp(-((k - radius) ** 2) / (2 * sigma * sigma)));
  const pass = (src, horizontal) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0, weight = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = horizontal ? x + k : x, yy = horizontal ? y : y + k;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const w = kernel[k + radius];
        sum += src[yy * width + xx] * w; weight += w;
      }
      out[y * width + x] = weight ? sum / weight : 0;
    }
    return out;
  };
  return pass(pass(values, true), false);
}

// CIG from the share of the members' events that reach each intensity tier, inside the
// published probability contours (and only where SPC allows that tier).
function conditionalIntensity(hazard, freq, levels, width, height) {
  const fields = SIG_FIELDS[hazard];
  const any = freq[hazard];
  const out = new Float32Array(levels.length);
  for (let i = 0; i < levels.length; i++) {
    if (!levels[i] || any[i] < MIN_CIG_EVENT_FRACTION) continue;
    let cig = 0;
    fields.forEach((name, tier) => { if (freq[name][i] / any[i] >= CIG_CONDITIONAL_FRACTION[tier]) cig = tier + 1; });
    out[i] = publishedCigForHazard(hazard, levels[i], Math.min(cig, MAX_CIG[hazard]));
  }
  return cleanContours(out, width, height);
}

// SPC draws smooth, closed contours: drop specks smaller than MIN_CONTOUR_CELLS at each level
// (they fall back to the surrounding lower level) and fill pinholes inside a contour.
function cleanContours(values, width, height) {
  const levels = [...new Set(values)].filter(v => v > 0).sort((a, b) => b - a);
  for (const level of levels) {
    const lower = Math.max(0, ...[...new Set(values)].filter(v => v < level));
    for (const component of components(values, width, height, v => v >= level)) {
      if (component.length >= MIN_CONTOUR_CELLS) continue;
      for (const i of component) if (values[i] >= level) values[i] = lower;
    }
    for (const hole of components(values, width, height, v => v < level)) {
      if (hole.length >= MIN_CONTOUR_CELLS || hole.some(i => isEdge(i, width, height))) continue;
      for (const i of hole) values[i] = level;
    }
  }
  return values;
}

function components(values, width, height, inside) {
  const seen = new Uint8Array(values.length), out = [];
  for (let start = 0; start < values.length; start++) {
    if (seen[start] || !inside(values[start])) continue;
    const queue = [start], member = [];
    seen[start] = 1;
    while (queue.length) {
      const i = queue.pop(); member.push(i);
      const x = i % width, y = (i - x) / width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy, j = yy * width + xx;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height || seen[j] || !inside(values[j])) continue;
        seen[j] = 1; queue.push(j);
      }
    }
    out.push(member);
  }
  return out;
}

const isEdge = (i, width, height) => { const x = i % width, y = (i - x) / width; return x === 0 || y === 0 || x === width - 1 || y === height - 1; };

function hashSeed(seed, hour) {
  let h = 2166136261;
  for (const ch of `${seed}|${hour}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

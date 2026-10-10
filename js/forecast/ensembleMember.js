// One forecast ensemble member: a copy of the authoritative world, perturbed within the
// uncertainty of the analysis and of the model, run forward by the same simulation. Members
// report where each hazard occurred, defined exactly as the verification truth is.
import { advanceAtmosphere, updateSoundingDiagnostics } from '../evolution.js';
import { resolveRuntimeProfile } from '../runtime/RuntimeProfile.js';
import { hydrateWorld } from '../world/worldSnapshot.js';
import { captureTruth, TRUTH_FIELDS } from '../verification/truth.js';
import { mulberry32 } from '../scenarios/math.js';

export const EVENT_FIELDS = TRUTH_FIELDS;

// Standard deviations of the perturbations (scaled by `amplitude`).
const ANALYSIS_SPREAD = {
  troughPosition: 0.025, troughDepth: 0.08, shortwavePosition: 0.03, shortwaveDepth: 0.12,
  lowPosition: 0.02, lowDepthHpa: 1.0, maxLowDepth: 0.08, frontOffset: 0.02, drylineOffset: 0.025,
  flow500: 0.06, jet: 0.06, llj: 0.10,
  gulfDewpointF: 1.2, moistureAxis: 0.025, cap700C: 0.6, lapse700500: 0.15, t850C: 0.5, moistureDepth: 0.06,
  fieldDewpointF: 1.5, fieldT850C: 0.5, fieldT700C: 0.4
};
// Model uncertainty: multipliers on the synoptic rates (see SynopticDynamics).
const RATE_SPREAD = { trough: 0.25, shortwave: 0.08, low: 0.15, deepening: 0.2, coldFront: 0.15, warmFront: 0.2, dryline: 0.2 };

// state: snapshot (adopted and mutated); spec: { index, seed, amplitude, endHour, windows }
// windows: [{ key, start, end }] in absolute sim hours. Returns exact event masks per window.
export function runEnsembleMember(state, spec) {
  const profile = resolveRuntimeProfile('ensemble');
  const world = hydrateWorld(state, { profile, phaseMs: {}, phaseRuns: {}, deferred: {} });
  world.evolution.cadence = { mediumHours: profile.mediumAnalysisHours, slowHours: profile.slowAnalysisHours, thermodynamicsHours: profile.fullThermodynamicsCadenceHours, mesoscaleHours: profile.mesoscaleCadenceHours, coupledHours: profile.coupledCadenceHours };
  perturbMember(world, spec);
  updateSoundingDiagnostics(world);

  const frames = [], seen = new Set(), initiations = [];
  const n = world.width * world.height;
  const windows = spec.windows.map(w => ({ ...w, masks: Object.fromEntries(EVENT_FIELDS.map(f => [f, new Uint8Array(n)])), tornadoIds: new Set() }));
  const collect = () => {
    const frame = frames.at(-1);
    for (const w of windows) {
      if (frame.hourUtc < w.start + 1e-6 || frame.hourUtc > w.end + 1e-6) continue;
      for (const field of EVENT_FIELDS) {
        const src = frame[field], dst = w.masks[field];
        for (let i = 0; i < n; i++) if (src[i]) dst[i] = 1;
      }
    }
    frames.length = 0;   // only the latest frame is needed (captureTruth reads the previous hour)
    frames.push(frame);
  };
  const startStorms = new Set((world.storms ?? []).map(s => s.id));
  while (world.validHourUtc < spec.endHour - 1e-6) {
    advanceAtmosphere(world, 0.5);
    captureTruth(world, frames, seen, initiations);
    collect();
    for (const w of windows) {
      if (world.validHourUtc < w.start + 1e-6 || world.validHourUtc > w.end + 1e-6) continue;
      for (const storm of world.storms ?? []) if (storm.tornado?.onGround) w.tornadoIds.add(`${storm.id}:${storm.tornado.cycleCount ?? 0}`);
    }
  }
  return {
    index: spec.index, seed: spec.seed,
    windows: windows.map(({ key, start, end, masks, tornadoIds }) => ({
      key, start, end, masks, tornadoes: tornadoIds.size,
      storms: initiations.filter(r => r.hourUtc >= start - 1e-6 && r.hourUtc < end && !startStorms.has(r.stormId)).length
    }))
  };
}

export function perturbMember(world, { index = 0, seed = 1, amplitude = 1 } = {}) {
  const random = mulberry32((Number(seed) >>> 0) ^ Math.imul(index + 1, 0x9e3779b1));
  const normal = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, random()))) * Math.cos(2 * Math.PI * random());
  const s = amplitude, A = ANALYSIS_SPREAD;
  const config = world.evolution.config;
  // Storm-scale randomness (initiation, tornadogenesis) differs in every member.
  config.seed = (Math.imul(Number(seed) >>> 0, 2654435761) + index * 40503 + 7) >>> 0;
  const p = config.synopticPattern;
  if (p) {
    p.troughX += normal() * A.troughPosition * s; p.troughY += normal() * A.troughPosition * s;
    p.troughDm *= 1 + normal() * A.troughDepth * s;
    for (const sw of p.shortwaves ?? []) {
      sw.x += normal() * A.shortwavePosition * s; sw.y += normal() * A.shortwavePosition * s;
      sw.dm *= Math.max(0.3, 1 + normal() * A.shortwaveDepth * s);
    }
    p.lowX += normal() * A.lowPosition * s; p.lowY += normal() * A.lowPosition * s;
    p.lowDepthHpa = Math.max(2, p.lowDepthHpa + normal() * A.lowDepthHpa * s);
    p.maxLowDepthHpa *= 1 + normal() * A.maxLowDepth * s;
    p.coldFrontOffset += normal() * A.frontOffset * s;
    p.warmFrontOffset += normal() * A.frontOffset * 0.75 * s;
    p.drylineOffset += normal() * A.drylineOffset * s;
    p.flow500Kt *= 1 + normal() * A.flow500 * s;
    p.jetPeakKt *= 1 + normal() * A.jet * s;
    p.lljKt *= 1 + normal() * A.llj * s;
    if (p.dynamics) {
      p.dynamics.rng = (p.dynamics.rng ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0;
      p.dynamics.rates = Object.fromEntries(Object.entries(RATE_SPREAD).map(([key, sd]) => [key, Math.max(0.3, 1 + normal() * sd * s)]));
    }
  }
  // Air-mass ingredients the evolution relaxes toward.
  config.gulfDewpoint += normal() * A.gulfDewpointF * s;
  if (Number.isFinite(config.moistureAxisX)) { config.moistureAxisX += normal() * A.moistureAxis * s; config.moistureAxisY += normal() * A.moistureAxis * s; }
  const ing = config.ingredients;
  if (ing) {
    ing.cap700C += normal() * A.cap700C * s;
    ing.lapse700500 += normal() * A.lapse700500 * s;
    ing.t850C += normal() * A.t850C * s;
    ing.moistureDepth = Math.min(1, Math.max(0, ing.moistureDepth + normal() * A.moistureDepth * s));
  }
  // Analysis errors in the fields themselves: smooth, a few hundred km across.
  const dewpoint = smoothRandomField(random), t850 = smoothRandomField(random), t700 = smoothRandomField(random);
  world.forEachCell((cell, x, y) => {
    const nx = x / world.width, ny = y / world.height;
    cell.surface.dewpoint += dewpoint(nx, ny) * A.fieldDewpointF * s;
    const l850 = cell.levels[850], l700 = cell.levels[700];
    const d850 = t850(nx, ny) * A.fieldT850C * s, d700 = t700(nx, ny) * A.fieldT700C * s;
    l850.temperature += d850; if (Number.isFinite(l850.dewpoint)) l850.dewpoint += d850;
    l700.temperature += d700; if (Number.isFinite(l700.dewpoint)) l700.dewpoint += d700;
  });
  return world;
}

// Unit-variance smooth random field on the unit square from a few random waves
// (wavelengths ~1/3 to 1 of the domain).
function smoothRandomField(random) {
  const waves = Array.from({ length: 6 }, () => {
    const k = 2 * Math.PI * (1 + 2 * random()), theta = random() * Math.PI * 2;
    return { kx: k * Math.cos(theta), ky: k * Math.sin(theta), phase: random() * Math.PI * 2 };
  });
  const norm = Math.sqrt(2 / waves.length);
  return (x, y) => norm * waves.reduce((sum, w) => sum + Math.cos(w.kx * x + w.ky * y + w.phase), 0);
}

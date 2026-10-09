// Active multi-day pattern: a slow, deep trough parked west of the Plains with one shortwave
// ejecting per day and Gulf moisture returning every night, so all three days of a system
// produce severe weather. Every engine that used to translate the pattern linearly in time
// (positions = start + speed * elapsedHours) or assumed one lifecycle peak reads its time
// and lifecycle from here instead.
//
// Day k spans elapsed hours [24k, 24k + 24) (12Z to 12Z). Within a day the pattern ejects
// normally; between 06Z and 12Z it "rewinds" to a start slightly east of the previous day's,
// which is the dryline retreating and the warm front lifting back overnight while a new lee
// low forms. The last wave keeps ejecting so its cold front sweeps the domain.

export const ACTIVITY_LEVELS = ['normal', 'active', 'outbreak'];
export const SEQUENCE_DAYS = 3;
const REWIND_START = 18;            // hours into the day (06Z)
const DAILY_DRIFT_HOURS = 6;        // effective-hour progress of the parked trough per day
const CHARACTERS = {
  'warm-front': { eject: 0.85, coldPush: 0.7, dryline: 0.6, modes: ['discrete', 'discrete', 'mixed'] },
  dryline: { eject: 1.0, coldPush: 0.8, dryline: 1.35, modes: ['discrete', 'discrete', 'mixed'] },
  'cold-front': { eject: 1.25, coldPush: 1.6, dryline: 0.7, modes: ['mixed', 'linear', 'QLCS'] }
};

export function createActiveSequence(random, { activity = 'active', setupName = '', intensity = 0.6 } = {}) {
  if (activity === 'normal') return null;
  const outbreak = activity === 'outbreak';
  // Usual order builds to a main dryline/warm-front day and ends with the cold front; seeds vary it.
  const orders = [['warm-front', 'dryline', 'cold-front'], ['dryline', 'dryline', 'cold-front'], ['warm-front', 'warm-front', 'cold-front'], ['dryline', 'warm-front', 'cold-front']];
  const order = orders[Math.floor(random() * orders.length) % orders.length];
  const main = 1 + Math.floor(random() * 2); // Day 2 or 3 is usually the main event
  const days = order.map((character, index) => {
    const reload = !outbreak && index !== main && random() < 0.3;
    const strength = clamp((index === main ? 1 : reload ? 0.55 : 0.8) * (0.85 + 0.3 * intensity) * (outbreak ? 1.1 : 1), 0.45, 1.15);
    return { index, character, strength, reload, peakHour: 9 + random() * 3 /* 21-24Z */, ...CHARACTERS[character] };
  });
  return { version: 1, activity, setupName, days };
}

export function waveAt(sequence, elapsedHours) {
  const e = Math.max(0, Number(elapsedHours) || 0);
  const k = Math.min(SEQUENCE_DAYS - 1, Math.floor(e / 24));
  const day = sequence.days[k];
  const u = e - 24 * k; // hours since 12Z of this day (can exceed 24 after the last wave)
  return { index: k, day, hoursIntoDay: u, final: k === SEQUENCE_DAYS - 1 };
}

// Time to use wherever the pattern was translated linearly with elapsed hours.
export function effectivePatternHours(sequence, elapsedHours) {
  if (!sequence) return elapsedHours;
  const { index, day, hoursIntoDay: u, final } = waveAt(sequence, elapsedHours);
  const base = index * DAILY_DRIFT_HOURS;
  const ejected = base + u * day.eject;
  if (final || u < REWIND_START) return ejected;
  const nextBase = (index + 1) * DAILY_DRIFT_HOURS;
  const t = smoothstep(REWIND_START, 24, u);
  // Rewind from the end of today's ejection to tomorrow's starting position overnight.
  return lerp(base + REWIND_START * day.eject, nextBase, t);
}

// d(effective time)/d(real time): scales pattern-derived velocities (negative while the
// pattern reloads overnight, so boundaries are reported moving back west/north).
export function effectivePatternRate(sequence, elapsedHours) {
  if (!sequence) return 1;
  return (effectivePatternHours(sequence, elapsedHours + 0.25) - effectivePatternHours(sequence, Math.max(0, elapsedHours - 0.25))) / (elapsedHours >= 0.25 ? 0.5 : elapsedHours + 0.25);
}

// Per-day multipliers on boundary behaviour, cross-faded through the overnight transition.
export function dayCharacterFactors(sequence, elapsedHours) {
  if (!sequence) return { coldPush: 1, dryline: 1, strength: 1 };
  const { index, day, hoursIntoDay: u, final } = waveAt(sequence, elapsedHours);
  const next = !final && u >= REWIND_START ? sequence.days[index + 1] : null;
  const t = next ? smoothstep(REWIND_START, 24, u) : 0;
  const pick = key => next ? lerp(day[key], next[key], t) : day[key];
  return { coldPush: pick('coldPush'), dryline: pick('dryline'), strength: pick('strength') };
}

// Multi-pulse replacement for the single-peak scenario lifecycle (same output shape).
export function activeLifecycle(sequence, elapsedHours) {
  const e = Math.max(0, Number(elapsedHours) || 0);
  let pulse = 0;
  for (const day of sequence.days) {
    const peak = 24 * day.index + day.peakHour;
    // Builds through the day, peaks in the evening, decays overnight.
    const d = e - peak;
    const shape = d <= 0 ? Math.exp(-0.5 * (d / 6) ** 2) : Math.exp(-0.5 * (d / 5) ** 2);
    pulse = Math.max(pulse, shape * day.strength);
  }
  const { day, hoursIntoDay: u } = waveAt(sequence, e);
  const maturity = clamp(0.35 + 0.65 * pulse, 0.25, 1);
  // Moisture returns on the first night and is recharged every night by the low-level jet.
  const moisture = clamp(0.62 + 0.38 * smoothstep(0, 10, e) - (u < 6 ? 0.06 : 0), 0.5, 1);
  const forcing = clamp(0.30 + 0.70 * pulse, 0.25, 1);
  const stage = pulse > 0.75 * day.strength ? 'mature' : u < day.peakHour ? 'deepening' : 'decaying';
  return { stage, maturity, moisture, forcing, kinematic: clamp(0.45 + 0.55 * pulse, 0.3, 1), realization: day.strength, peakHour: 24 * day.index + day.peakHour, pulse, dayIndex: day.index, character: day.character };
}

// Storm-mode contract for the current day (initial / mature / late modes).
export function dayModeContract(sequence, elapsedHours) {
  const { day, hoursIntoDay: u } = waveAt(sequence, elapsedHours);
  return { hoursIntoWave: u, modes: day.modes, character: day.character };
}

function smoothstep(a, b, v) { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// A tornado's life in the tornado lab's six stages (2026-11-19, the lab's request: tornado-windfield
// docs/engine-request-stages.md and engine-tornado-stages.js, src/shared/Tornado/Lifecycle.luau), the observed
// sequence (Golden & Purcell 1978; Davies-Jones, Trapp & Bluestein 2001; French & Kingfield 2019):
//
//   gestation   before touchdown: the wall cloud lowers, broad weak rotation, a funnel aloft
//   organizing  on the ground: the core contracts and spins up (keeping its circulation), the funnel comes down
//   mature      the vortex's peak wind and core
//   shrinking   the occlusion cuts it off: the wind eases, the core contracts to 0.45 of mature, the base drifts
//               from the mesocyclone, the funnel starts to contort
//   rope        thin (0.45 -> 0.3 of the mature core) and contorted; still strong at first, then its wind falls
//               through EF0 and it ends
//   dissipated  after it ends: the wall cloud lifts, the remnant circulation broadens; no tornado
//
// What stays TornadoEngine's: the drawn life (lifeMinutes), the intensity (intensityMph: the rating and the width
// follow it), the mature wind and core (matureCoreM), rotationLossFall (an early loss of the rotation starts the
// decay early - into shrinking), and the end of a tornado at the EF0 wind. The stages scale the wind's EXCESS over
// 65 mph of the vortex's own spin, so a tornado touches down, and ends, with its swirl at the EF0 wind (the lab scales
// the whole wind: its rope runs from 0.7 of the peak to 0). Unlike the lab's, the mature stage does not pulse on a set period (a painted wave): it
// varies as the vortex the storm supports does (its occlusion, surges, the ceiling it is drawn under).
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth01 = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const ramp = (x, a, b) => clamp((x - a) / (b - a), 0, 1);

export const TORNADO_STAGES = Object.freeze({
  // the life's shares on the ground (the lab's: organizing 0.15, mature 0.45, shrinking 0.25, rope 0.15)
  // (organizingMinutes: two time constants of the vortex's spin-up, TornadoEngine INTENSITY.spinUpPerHour 6 - 10 min - so
  // it is at 86% of the wind it is heading for when it matures (three, 30 min, left most lives a tick or none of mature); 2026-11-19, the lab: at 10 min it was still spinning up
  // through its first mature ticks, 0.74-0.84 of its peak swirl. Spinning it up faster instead - a third of the stage -
  // moved EF0 from 43 to 33% of tornadoes and EF2 from 13 to 17%, brief ones reaching their peak before they ended.)
  organizingShare: 0.15, organizingMinutes: 20, briefShare: 0.4,   // (a brief one peaks sooner)
  matureWeight: 0.45, shrinkingWeight: 0.25,                       // share what organizing and the rope leave
  ropeShare: 0.15, ropeMinutes: 5, ropeMaxShare: 0.25,             // the rope lasts a bundle tick where it can
  // the core, of the mature core: organizing starts this broad, or broader where the circulation it keeps says so
  touchdownCore: 2.5, shrinkCore: 0.45, ropeCore: 0.3,
  // the share of the wind's excess over 65 mph left at the end of shrinking; the shape of the rope's fall
  shrinkWind: 0.5, ropeFallPower: 0.7,
  // the share of its peak swirl (its own spin: the wind less motionShare of the motion) a mature vortex varies by without
  // shrinking - its fall from its peak counts past it (the lab's mature vortex is 0.85+ of its peak swirl; at none a 3 mph
  // dip started its decay, ratcheted; as a share of the excess over EF0 a weak vortex, with little excess, still skipped
  // its mature stage on a 5 m/s dip off a 42 m/s peak)
  matureSlack: 0.15,
  // contortion (TornadoFunnel tornadoDecay): the lab's wobble 1 -> 1.8 over shrinking, 1.8 -> 3.3 over the rope
  shrinkContortion: 0.35,
  // before and after
  gestationFrom: 0.4,           // genesisPotential where the funnel aloft starts (StormAppearance)
  dissipatedMinutes: 10, remnantCore: [0.3, 2.5],
  minCoreM: 10,
  // the share of the storm's motion in the wind at the core (the owner's choice, 2026-11-19): the stages shape the
  // swirl over the EF0 wind less this share of the motion, so a tornado touches down and ends with swirl + share x
  // motion at the EF0 wind. With all of it (1) most of the engine's tornadoes - storms move ~43 mph - never had EF0
  // swirl and their stages shaped nothing; with none (0) a rope in a fast storm kept 0-2 m/s of its own spin.
  // (A set share until a relation from the fields is found; the lab's vortex fades the motion out beyond the core.)
  motionShare: 0.5
});

// The stage boundaries (shares of the life) for a life of lifeMinutes.
export function tornadoStageShares(lifeMinutes) {
  const S = TORNADO_STAGES, life = Math.max(1e-3, Number(lifeMinutes) || 0);
  const organizing = Math.min(Math.max(S.organizingShare * life, S.organizingMinutes), S.briefShare * life) / life;
  const rope = Math.min(Math.max(S.ropeShare * life, S.ropeMinutes), S.ropeMaxShare * life) / life;
  const rest = Math.max(0, 1 - organizing - rope), w = S.matureWeight + S.shrinkingWeight;
  const mature = rest * S.matureWeight / w, shrinking = rest * S.shrinkingWeight / w;
  return { organizing, mature, shrinking, rope, matureEnds: organizing + mature, shrinkingEnds: organizing + mature + shrinking };
}

// A tornado on the ground: minutes down, its drawn life, the vortex's wind now (intensityMph) and at maturity,
// and lossFall (TornadoEngine rotationLossFall). Returns
//   name        'organizing' | 'mature' | 'shrinking' | 'rope'
//   share       of its life gone; progress  0-1 through the stage
//   fall        0-1 through shrinking + rope (0 before)
//   windMph     the wind it shows; coreShare  its core, of the mature core
//   contortion  0-1 (TornadoFunnel tornadoDecay); drift  0-1 of the decay drift's weight (TornadoEngine decayDrift)
// fallFloor: the fall it has reached in its decay - a rope does not fatten back into a mature vortex, nor a shrinking one
// regrow (the lab, 2026-11-19: not observed, and a glitch on screen; an EF5's swirl went 0.93 -> 0.76 -> 0.94 of its peak
// and its core 161 -> 96 -> 153 m in shrinking), so once its decay starts its fall only rises.
// options (2026-11-19, the owner's rulings through the lab):
//   motionMph  the storm's speed. The stages shape the vortex's own spin - its swirl, the wind less motionShare of the
//              motion - so it touches down and ends with swirl + motionShare x motion at the EF0 wind (baseMph = 65 +
//              motionShare x motion), not its ground wind: a rope is still a vortex to its end (it had kept 0-2 m/s of its
//              own spin, 35 min at 65 mph in a fast storm). A vortex that never passes that keeps its own wind (base = it).
//   peakMph    the vortex's peak so far. Its fall from it is part of its decay: having lost share q of its excess it is
//              q / (1 - shrinkWind) of the way through shrinking (or further on), the larger of that, its time and its
//              loss of rotation - a surge or the occlusion weakening it is shrinking, not mature. The wind it then shows
//              is the stage's share of its peak excess, never more than the vortex now gives.
export function tornadoStage(groundMinutes, lifeMinutes, intensityMph, matureWindMph = intensityMph, lossFall = 0, fallFloor = 0, { motionMph = 0, peakMph = intensityMph } = {}) {
  const S = TORNADO_STAGES, life = Math.max(1e-3, Number(lifeMinutes) || 0), minutes = Number(groundMinutes) || 0;
  const share = clamp(minutes / life, 0, 1), b = tornadoStageShares(life);
  const wind = Math.max(65, Number(intensityMph) || 65), m = Math.max(0, Number(motionMph) || 0);
  const base = Math.min(wind, 65 + S.motionShare * m), excess = wind - base;
  const peakExcess = Math.max(excess, Math.max(wind, Number(peakMph) || 0) - base);
  // organizing: the swirl's excess rises smoothly from the EF0 wind; the core contracts from touchdownCore (or the
  // circulation it keeps, V r of its swirl, where that is broader)
  const o = share < b.organizing ? share / b.organizing : 1, rise = smooth01(o);
  const swirlMature = Math.max(65, (Number(matureWindMph) || 65) - (base - 65)), swirlGrown = 65 + excess * rise;
  const kept = clamp(swirlMature / swirlGrown, 1, S.touchdownCore);
  const spunCore = o < 1 ? Math.max(kept, 1 + (S.touchdownCore - 1) * (1 - rise)) : 1;
  // shrinking and rope: by its time, the loss of its rotation, its fall from its peak (once organized), the largest
  const decaySpan = Math.max(1e-3, 1 - b.matureEnds), shrinkPart = b.shrinking / decaySpan;
  // (its fall from its peak takes it through shrinking, never into the rope: the rope comes with its time or the loss of
  // its rotation - 2026-11-19, the lab: an EF1 ~20% off its peak went from organizing straight into an unshrunk rope)
  const peakWind = base + peakExcess, slackMph = S.matureSlack * (peakWind - S.motionShare * m), span = peakExcess * (1 - S.shrinkWind) - slackMph;
  const lost = o >= 1 && span > 0 ? shrinkPart * Math.min(1 - 1e-6, clamp((peakWind - wind - slackMph) / span, 0, 1)) : 0;
  const timeFall = share > b.matureEnds ? (share - b.matureEnds) / decaySpan : 0, lossShare = clamp(Number(lossFall) || 0, 0, 1);
  const fall = Math.max(timeFall, lossShare, clamp(Number(fallFloor) || 0, 0, 1), lost);
  // (what is taking it down: its time, the loss of its rotation, or its fall from its peak)
  const by = timeFall >= Math.max(lossShare, lost) ? 'time' : lossShare >= lost ? 'loss' : 'strength';
  let name, progress, shown, coreShare, contortion, drift;
  if (fall > 0 && fall < shrinkPart) {
    name = 'shrinking'; progress = fall / shrinkPart;
    const e = smooth01(progress);
    shown = Math.min(excess, peakExcess * rise * (1 - (1 - S.shrinkWind) * e)); coreShare = spunCore * (1 - (1 - S.shrinkCore) * e);
    contortion = S.shrinkContortion * e; drift = e;
  } else if (fall > 0) {
    name = 'rope'; progress = clamp((fall - shrinkPart) / Math.max(1e-3, 1 - shrinkPart), 0, 1);
    shown = Math.min(excess, peakExcess * rise * S.shrinkWind * (1 - smooth01(progress)) ** S.ropeFallPower);
    coreShare = spunCore * (S.shrinkCore - (S.shrinkCore - S.ropeCore) * progress);
    contortion = S.shrinkContortion + (1 - S.shrinkContortion) * progress; drift = 1;
  } else if (o < 1) {
    name = 'organizing'; progress = o; shown = excess * rise; coreShare = spunCore; contortion = 0; drift = 0;
  } else {
    name = 'mature'; progress = clamp((share - b.organizing) / Math.max(1e-3, b.mature), 0, 1); shown = excess; coreShare = 1; contortion = 0; drift = 0;
  }
  return { name, share, progress, fall, windMph: base + shown, coreShare, contortion, drift, baseMph: base, by };
}

// Before touchdown: a storm whose low-level rotation is near putting a tornado down (StormAppearance's funnel
// aloft, genesisPotential > gestationFrom). progress 0-1 lowers the wall cloud and the funnel aloft; null when not.
export function gestationStage(genesisPotential) {
  const g = Number(genesisPotential) || 0;
  if (!(g > TORNADO_STAGES.gestationFrom)) return null;
  const progress = ramp(g, TORNADO_STAGES.gestationFrom, 1);
  return { name: 'gestation', progress, wallLowering: smooth01(progress), coreShare: TORNADO_STAGES.touchdownCore };
}

// After it ends, for dissipatedMinutes: the wall cloud lifts (wallLowering 1 -> 0) and the remnant circulation
// broadens (remnantCore 0.3 -> 2.5 of the mature core); no tornado. null once it is over.
export function dissipatedStage(minutesSinceEnd) {
  const S = TORNADO_STAGES, m = Number(minutesSinceEnd);
  if (minutesSinceEnd == null || !(m >= 0) || m >= S.dissipatedMinutes) return null;
  const progress = m / S.dissipatedMinutes, e = smooth01(progress);
  return { name: 'dissipated', progress, wallLowering: 1 - e, coreShare: S.remnantCore[0] + (S.remnantCore[1] - S.remnantCore[0]) * e };
}

// The storm's stage (scene.life.stage): its tornado's while one is down, else dissipated (just ended) or
// gestation (one near), else null.
export function stormTornadoStage(storm) {
  const t = storm?.tornado;
  if (t?.onGround && t.lifeStage) return { name: t.lifeStage, progress: t.stageProgress ?? 0 };
  return dissipatedStage(t?.minutesSinceEnd) ?? gestationStage(t?.genesisPotential);
}

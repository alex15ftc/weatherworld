// What a storm looks like from the ground, from its own state and the air it feeds on: the
// description the game draws (server/GameFeed.js sends it to Roblox). Everything here is a
// continuous quantity worked out from fields the storm engine already carries; the names
// (wedge, rope, LP, shelf cloud, ...) only describe those quantities for the chaser's log and
// the pages, and nothing draws or decides anything from a name.
//
// Frame: x east and y south in km on the map (as storm positions are); heights in metres above
// the ground; bearings in degrees clockwise from north, the way the thing extends or faces.
//
// The tornado's funnel. The air spiralling into a tornado loses pressure, and cools as it
// expands; the cloud reaches down to where that pressure fall equals the fall between the
// ground and the cloud base (Rankine vortex in cyclostrophic balance: a core of radius rc
// turning as a solid body with the peak wind v at its edge, the wind falling off as 1/r
// outside). Per unit density the pressure deficit is K v^2 (1 - r^2 / 2rc^2) inside the core and
// K v^2 rc^2 / 2r^2 outside; the deficit needed at height z is g (zBase - z). So:
//   - the funnel reaches down to zBase - K v^2 / g; below that the vortex is uncondensed and
//     only its debris shows;
//   - where the needed deficit is small (near the cloud base) the funnel is wide, and it narrows
//     toward the ground: a cone; where the core deficit is far more than is needed all the way
//     down, the funnel is about the core's width throughout: a stovepipe; a wide core under a
//     low base is wider than it is tall: a wedge.
// K stands for what a dry hydrostatic vortex leaves out (moist inflow already cooled by rain,
// the lowered pressure of the air drawn in along the ground); it is the one constant set to
// match how often funnels reach the ground (scripts/appearance-report.mjs).
// The cloud base the funnel hangs from is the wall cloud's: the lifting condensation level
// less the wall cloud's lowering.
//
// Multiple vortices. In laboratory and numerical vortices the structure is set by the swirl
// ratio, the turning of the inflow against the rate air is drawn up (Ward; Church et al. 1979;
// Rotunno 1984): a narrow one-celled vortex at low swirl, the downdraught of vortex breakdown
// reaching the ground (a broad two-celled vortex) as it rises, then two and up to about six
// smaller vortices turning round the core. Here the swirl is the tornado's circulation (rc v)
// against the storm's updraught drawing air through an inflow layer SWIRL.inflowDepthM deep.
import { clamp } from '../scenarios/math.js';
import { rotatingShare, lineShare, outflowDominance, describeStormMode } from './StormModeEngine.js';
import { BUDGET } from './StormBudgets.js';
import { MERGE_GLIDE_KPH } from './StormEngine.js';

const G = 9.81, MS_PER_MPH = 0.44704, M_PER_YD = 0.9144, KPH_PER_KT = 1.852;
// The wind at the edge of the damage path (EF0, 65 mph), which sets the core's radius from the
// path's width: outside the core the wind falls as rc / r.
const EDGE_WIND_MS = 65 * MS_PER_MPH;
export const FUNNEL = Object.freeze({ deficitFactor: 2.6, levels: 9, minBaseM: 80, flareKm: 1.2 });
// Classic at a storm-relative 500 mb wind of windMs and a cloud base of baseM; a span either way to LP or HP.
export const SPECTRUM = Object.freeze({ windMs: 15, windSpanMs: 5, baseM: 1000, baseSpanM: 600, windShare: 0.6 });
// How far a fully decayed tornado's top sits from its ground point, in cloud-base heights.
const ROPE_LEAN = 0.8;
export const SWIRL = Object.freeze({ inflowDepthM: 120, breakdown: 0.45, multiple: 1.0, perVortex: 0.9, maxVortices: 6 });
const ramp = (value, low, high) => clamp(((Number(value) || 0) - low) / (high - low), 0, 1);
const bearing = (east, north) => (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
const r2 = v => Math.round(v * 100) / 100, r0 = v => Math.round(v);

// Flashes a minute (in the cloud and to the ground together), rising steeply with the updraught
// that lofts the ice that charges a storm. js/storms/Lightning.js places them.
export const flashRatePerMin = updraughtMs => 30 * ramp(updraughtMs, 8, 50) ** 2;

export function buildStormAppearance(storm, environment = storm.environment ?? {}) {
  const g = storm.geometry, s = storm.structure;
  if (!g) return null;
  const rotating = rotatingShare(storm), linear = lineShare(storm), dominance = outflowDominance(storm, environment);
  const lcl = clamp(Number(environment.lcl) || 1200, 100, 4000);
  const moist = ramp(1700 - lcl, 0, 1100);                       // a low cloud base: moist inflow
  const precipEff = clamp(s?.precipitationEfficiency ?? storm.precipitation ?? 0, 0, 1.2);
  const inflow = clamp(s?.wind?.inflowStrength ?? 0, 0, 1.2);
  const up = g.updraught, wall = g.wallCloud, rain = g.rain;
  const v = storm.velocityKph ?? { east: 0, north: 0 };

  // The supercell spectrum (-1 LP, 0 classic, +1 HP). The storm-relative wind aloft carries the
  // rain away from the updraught: weak, and the rain falls close by and wraps it (HP); strong,
  // and the updraught stands bare and sculpted (LP) (Rasmussen and Straka 1998, who found this
  // at anvil level; the engine carries 500 mb, where the wind is weaker). A high, dry cloud
  // base makes less rain and favours LP; a low, moist one favours HP.
  const aloft = environment.wind500 ?? { eastKt: 0, northKt: 0 };
  const relativeAloftMs = Math.hypot((aloft.eastKt ?? 0) * KPH_PER_KT - v.east, (aloft.northKt ?? 0) * KPH_PER_KT - v.north) / 3.6;
  const spectrum = clamp(SPECTRUM.windShare * clamp((SPECTRUM.windMs - relativeAloftMs) / SPECTRUM.windSpanMs, -1, 1)
    + (1 - SPECTRUM.windShare) * clamp((SPECTRUM.baseM - lcl) / SPECTRUM.baseSpanM, -1, 1), -1, 1);
  const supercell = rotating * (1 - linear);
  const rainWrap = clamp((s?.hookStrength ?? 0) * precipEff * (0.4 + 0.6 * clamp(storm.occlusion ?? 0, 0, 1)) + 0.5 * Math.max(0, spectrum) * supercell, 0, 1);

  // Inflow: the low-level wind relative to the storm, which the inflow bands lie along.
  const low = environment.wind850 ?? environment.surfaceWind ?? { eastKt: 0, northKt: 0 };
  const inE = (low.eastKt ?? 0) * KPH_PER_KT - v.east, inN = (low.northKt ?? 0) * KPH_PER_KT - v.north;
  const inflowFromDeg = bearing(-inE, -inN);                      // where the inflow comes from
  const bandStrength = clamp(inflow * moist * ramp(environment.srh, 100, 350) * supercell, 0, 1);
  // A tail cloud runs from the wall cloud toward the forward-flank rain along the cool, moist air it draws in.
  const tail = clamp(wall.strength * moist * (0.4 + 0.6 * inflow), 0, 1);
  // Shelf cloud: the moist air lifted over the gust front, the more where the outflow leads.
  const shelf = clamp(g.gustFront.strength * (0.25 + 0.75 * Math.max(dominance, linear)) * (0.4 + 0.6 * moist), 0, 1);
  const dryAloft = ramp(environment.dcape, 600, 1400);
  const updraughtMs = up.speedMs ?? 0, intensity = clamp(storm.intensity ?? 0, 0, 1.2);

  const appearance = {
    id: storm.id,
    mode: describeStormMode(storm, environment),
    supercellType: supercell >= 0.5 ? (spectrum <= -0.3 ? 'LP' : spectrum >= 0.3 ? 'HP' : 'classic') : null,
    xKm: r2(storm.positionKm.x), yKm: r2(storm.positionKm.y), eastKph: r2(v.east), northKph: r2(v.north),
    intensity: r2(intensity), rotating: r2(rotating), linear: r2(linear), spectrum: r2(spectrum),
    updraft: {
      xKm: r2(up.xKm), yKm: r2(up.yKm), radiusKm: r2(up.radiusKm), speedMs: r2(updraughtMs),
      baseM: r0(lcl), topM: r0(up.topM), overshootM: r0(1800 * ramp(updraughtMs, 25, 60)),
      rotation: r2(clamp(up.rotation ?? 0, 0, 1.2)),
      // Banding on a rotating tower, clearest where little rain hides it.
      striation: r2(rotating * (1 - 0.7 * clamp(precipEff, 0, 1)))
    },
    // The flat, rain-free base under the updraught, hidden as the rain wraps in.
    base: { radiusKm: r2(1.3 * up.radiusKm), rainFree: r2(clamp(1 - rainWrap, 0, 1) * (0.3 + 0.7 * supercell)) },
    // A wall cloud lowers the base by a share of its height (the moist, rain-cooled air it takes in
    // condenses a little lower), 15-45% as it strengthens. (2026-10-22: it was the geometry's
    // 150-600 m capped at 80% of the base: under a 600 m base a strong wall cloud hung 120 m off
    // the ground, and the funnel under it, whose cloud base is the wall cloud's, was a squat disc.)
    wallCloud: { xKm: r2(wall.xKm), yKm: r2(wall.yKm), radiusKm: r2(wall.radiusKm), loweringM: r0(Math.min(wall.loweringM, (0.15 + 0.3 * clamp(wall.strength, 0, 1)) * lcl)), rotation: r2(wall.rotation), strength: r2(wall.strength),
      tail: r2(tail), tailBearingDeg: r0(bearing(rain.xKm - wall.xKm, -(rain.yKm - wall.yKm))) },
    inflowBands: { strength: r2(bandStrength), fromDeg: r0(inflowFromDeg), count: bandStrength > 0.05 ? 1 + Math.round(3 * bandStrength) : 0, lengthKm: r2(10 + 40 * bandStrength) },
    rain: { xKm: r2(rain.xKm), yKm: r2(rain.yKm), alongKm: r2(rain.alongKm), acrossKm: r2(rain.acrossKm), bearingDeg: r0(rain.bearingDeg), intensity: r2(rain.intensity), wrap: r2(rainWrap) },
    hail: { xKm: r2(g.hail.xKm), yKm: r2(g.hail.yKm), radiusKm: r2(g.hail.radiusKm), sizeInches: r2(g.hail.sizeInches) },
    // Downdraughts: the rear flank's wraps round the low-level rotation (and round a tornado as
    // the storm occludes) and, in dry air aloft, clears a slot of sky.
    rearFlank: { wrap: r2(g.rearFlank.wrap), strength: r2(g.rearFlank.strength),
      clearSlot: r2(clamp(Math.max(g.rearFlank.wrap, ramp(storm.lowRotation, 0.1, 0.5)) * (0.3 + 0.7 * g.rearFlank.strength) * (0.3 + 0.7 * dryAloft) * supercell, 0, 1)),
      downdraftMs: r2(Math.sqrt(2 * Math.max(0, Number(environment.dcape) || 0)) * 0.35 * clamp(storm.coldPoolStrength ?? 0, 0, 1)) },
    gustFront: { radiusKm: r2(g.gustFront.radiusKm), leadKm: r2(g.gustFront.leadKm), strength: r2(g.gustFront.strength), gustMph: r0(g.gustFront.gustMph) },
    shelf: { strength: r2(shelf), facingDeg: r0(bearing(v.east, v.north)), heightM: r0(0.8 * lcl),
      // Tiers where the cold pool is deep; running out ahead of the storm (a roll cloud) where the outflow leads.
      tiers: shelf > 0.1 ? 1 + Math.round(2 * clamp(storm.coldPoolStrength ?? 0, 0, 1)) : 0, detached: r2(shelf * ramp(dominance, 0.6, 1)),
      halfArcDeg: r0(linear > 0.3 ? 0 : 40 + 80 * dominance) },
    line: { share: r2(linear), halfLengthKm: r2(g.line.halfLengthKm), axisBearingDeg: r0(g.line.axisBearingDeg), bow: r2(g.line.bow) },
    anvil: { lengthKm: r2(g.anvil.lengthKm), widthKm: r2(g.anvil.widthKm), bearingDeg: r0(g.anvil.bearingDeg), topM: r0(g.anvil.topM),
      mammatus: r2(ramp(intensity, 0.5, 1) * ramp(storm.ageHours, 1, 3)) },
    lightningPerMin: r2(flashRatePerMin(updraughtMs)),
    life: stormLife(storm),
    tornado: null, funnelAloft: null
  };
  const t = storm.tornado;
  if (t?.onGround) appearance.tornado = tornadoAppearance(storm, appearance, environment);
  else if ((t?.genesisPotential ?? 0) > 0.4) {
    // Low-level rotation close to putting a tornado down lowers a funnel from the wall cloud.
    const share = ramp(t.genesisPotential, 0.4, 1) ** 2;
    appearance.funnelAloft = { xKm: appearance.wallCloud.xKm, yKm: appearance.wallCloud.yKm, lengthShare: r2(0.6 * share), radiusM: r0(40 + 120 * share) };
  }
  return appearance;
}

// Where the storm is in its life, as numbers the game can blend (StormTrack) and draw from. From
// the updraught budget (StormBudgets.js), which heads for a target it can support:
//   trend = (target - w) / max(deadMs, w), so target = w + trend * max(deadMs, w).
//   growth: how built-up the storm is against what it can be now, w / max(target, w), held back
//     early by the age it takes to grow (two growth time constants): min(w / max(target, w),
//     age / 2 tau_grow). A new storm starts near 0, one at its potential is 1, a dying one that
//     has caught its falling target is 1 too (it is all it can be: decay says it is going).
//   decay: how far it has fallen from its peak toward the updraught that ends it,
//     (wPeak - w) / (wPeak - deadMs), while it is falling toward a target well below it (ramp
//     of -trend, 0.3 to 0.8: a storm whose inflow is gone has trend -1; the swings of a healthy
//     storm's target as the air it feeds on is renewed each half hour stay above about -0.4);
//     1 when it has gone (a remnant, below).
//   towering: the growing cumulus tower before the storm has spread out: 1 through the engine's
//     tower stage (its first 0.3 h) and while growth < 0.5, gone by 1 h of age or growth 0.95.
//   mergedFrom / splitFrom: the storm that merged into this one, or that it split from, for
//     EVENT_HOURS (two storm ticks) after it happened.
export const LIFE = Object.freeze({ towerHours: [0.3, 1], towerGrowth: [0.5, 0.95], fallingTrend: [0.3, 0.8], eventHours: 2 / 12,
  // An anvil left by a storm that has died thins out over remnantHours, the longer the larger it
  // was (more ice to sublimate): anvil length 15 km to 300 km.
  remnantHours: [0.5, 0.75], remnantAnvilKm: [15, 300] });

export function stormLife(storm) {
  const w = Math.max(0, storm.updraughtMs ?? 0), trend = Number(storm.updraughtTrend) || 0, age = Math.max(0, storm.ageHours ?? 0);
  const target = Math.max(0, w + trend * Math.max(BUDGET.deadUpdraughtMs, w));
  const growth = Math.min(w / Math.max(target, w, 1e-6), clamp(age / (2 * BUDGET.growthHours), 0, 1));
  const peak = Math.max(w, 65 * (storm.peakUpdraftStrength ?? 0));
  const fall = peak > BUDGET.deadUpdraughtMs ? clamp((peak - w) / (peak - BUDGET.deadUpdraughtMs), 0, 1) : 0;
  const life = {
    ageMin: r0(age * 60), growth: r2(growth), trend: r2(clamp(trend, -1, 1)),
    decay: r2(fall * ramp(-trend, LIFE.fallingTrend[0], LIFE.fallingTrend[1])),
    coldPool: r2(clamp(storm.coldPoolStrength ?? 0, 0, 1)), organization: r2(clamp(storm.organization ?? 0, 0, 1)),
    towering: r2(Math.min(1 - ramp(age, LIFE.towerHours[0], LIFE.towerHours[1]), 1 - ramp(growth, LIFE.towerGrowth[0], LIFE.towerGrowth[1]))),
    fade: 0
  };
  if (storm.lastMergedFromId && age - (storm.mergedAtAgeHours ?? -Infinity) <= LIFE.eventHours + 1e-6) life.mergedFrom = storm.lastMergedFromId;
  if (storm.parentId && age - (storm.splitAtAgeHours ?? -Infinity) <= LIFE.eventHours + 1e-6) life.splitFrom = storm.parentId;
  return life;
}

// What a storm leaves for a while after it has gone, from its last appearance, `hours` after:
// one merged into another glides into it (at the engine's MERGE_GLIDE_KPH, carried along with
// the storm that took it) for LIFE.eventHours with life.mergeInto; one that died leaves its
// anvil, drifting with the wind aloft and thinning (life.fade 0 to 1) over LIFE.remnantHours.
// Everything that needs a living updraught (the tower, rain, hail, outflow, lowerings,
// lightning) is 0, so the game blends the storm's last frame into it.
function remnantAppearance(last, hours, lifeHours, { dx, dy, velocity }, mergeInto = null) {
  const a = structuredClone(last);
  const move = obj => { for (const [k, v] of Object.entries(obj)) { if ((k === 'xKm' || k === 'yKm') && typeof v === 'number') obj[k] = r2(v + (k === 'xKm' ? dx : dy)); else if (v && typeof v === 'object' && !Array.isArray(v)) move(v); } };
  move(a);
  a.eastKph = r2(velocity.east); a.northKph = r2(velocity.north);
  a.intensity = 0; a.rotating = 0; a.lightningPerMin = 0; a.tornado = null; a.funnelAloft = null; a.precip = null;
  Object.assign(a.updraft, { speedMs: 0, overshootM: 0, rotation: 0, striation: 0 });
  a.base.rainFree = 0;
  Object.assign(a.wallCloud, { loweringM: 0, rotation: 0, strength: 0, tail: 0 });
  Object.assign(a.inflowBands, { strength: 0, count: 0 });
  a.rain.intensity = 0; a.rain.wrap = 0;
  Object.assign(a.hail, { radiusKm: 0, sizeInches: 0 });
  Object.assign(a.rearFlank, { wrap: 0, strength: 0, clearSlot: 0, downdraftMs: 0 });
  Object.assign(a.gustFront, { strength: 0, gustMph: 0 });
  Object.assign(a.shelf, { strength: 0, tiers: 0, detached: 0 });
  const fade = clamp(hours / lifeHours, 0, 1);
  a.anvil.mammatus = r2(a.anvil.mammatus * (1 - fade));
  a.life = { ...a.life, ageMin: r0(a.life.ageMin + hours * 60), growth: 0, trend: -1, decay: 1, coldPool: 0, towering: 0, fade: r2(fade) };
  delete a.life.mergedFrom; delete a.life.splitFrom;
  if (mergeInto) a.life.mergeInto = mergeInto;
  return a;
}

// The storms of one game frame (server/GameFeed.js, scripts/export-storm-replay.mjs): each
// living storm's appearance with its precipitation grid, and the remnants of those that have
// gone (above). `keep(xKm, yKm)` limits them to a place. The last appearance of each storm is
// remembered against the world, so call this once a storm tick.
const lastSeen = new WeakMap();
export function buildStormFeedList(world, precip = new Map(), keep = () => true) {
  const now = world.stormEngine?.validHourUtc ?? world.validHourUtc ?? 0;
  let seen = lastSeen.get(world);
  if (!seen) lastSeen.set(world, seen = new Map());
  const out = [], alive = new Map();
  for (const storm of world.storms ?? []) {
    if (storm.active === false) continue;
    alive.set(storm.id, storm);
    const a = buildStormAppearance(storm);
    if (!a) continue;
    a.precip = precip.get(storm.id) ?? null;
    const aloft = storm.environment?.wind500 ?? { eastKt: 0, northKt: 0 };
    seen.set(storm.id, { appearance: a, hourUtc: now, aloftKph: { east: (aloft.eastKt ?? 0) * KPH_PER_KT, north: (aloft.northKt ?? 0) * KPH_PER_KT } });
    if (keep(a.xKm, a.yKm)) out.push(a);
  }
  const ended = new Map((world.stormArchive ?? []).map(r => [r.id, r]));
  for (const [id, memory] of seen) {
    if (alive.has(id)) continue;
    const record = ended.get(id), reason = record?.dissipationReason ?? '';
    // Time since its last frame (it ended during the tick after it).
    const hours = now - memory.hourUtc, last = memory.appearance;
    const mergeInto = reason.startsWith('merged-into-') ? reason.slice('merged-into-'.length) : null, keeper = mergeInto && alive.get(mergeInto);
    const lifeHours = mergeInto ? LIFE.eventHours : LIFE.remnantHours[0] + (LIFE.remnantHours[1] - LIFE.remnantHours[0]) * ramp(last.anvil.lengthKm, LIFE.remnantAnvilKm[0], LIFE.remnantAnvilKm[1]);
    if (!record || reason === 'left-domain' || (mergeInto && !keeper) || hours > lifeHours + 1e-6) { seen.delete(id); continue; }
    const aloft = memory.aloftKph;
    let move = { dx: aloft.east * hours, dy: -aloft.north * hours, velocity: aloft };
    if (keeper) {
      // Carried with the storm that took it in, and gliding toward it at MERGE_GLIDE_KPH.
      const v = keeper.velocityKph ?? { east: 0, north: 0 }, carryX = v.east * hours, carryY = -v.north * hours;
      const gx = keeper.positionKm.x - carryX - last.xKm, gy = keeper.positionKm.y - carryY - last.yKm;
      const share = Math.min(1, MERGE_GLIDE_KPH * hours / Math.max(Math.hypot(gx, gy), 1e-6));
      move = { dx: carryX + gx * share, dy: carryY + gy * share, velocity: v };
    }
    const r = remnantAppearance(last, hours, lifeHours, move, mergeInto);
    if (keep(r.xKm, r.yKm)) out.push(r);
  }
  return out;
}

// The tornado's look while it is down.
export function tornadoAppearance(storm, appearance, environment = storm.environment ?? {}) {
  const t = storm.tornado, wall = appearance.wallCloud;
  const windMs = Math.max(EDGE_WIND_MS * 1.05, (t.windSpeedMph ?? 0) * MS_PER_MPH);
  const halfWidthM = Math.max(10, (t.widthYards ?? 0) * M_PER_YD / 2);
  const coreM = Math.max(5, halfWidthM * EDGE_WIND_MS / windMs);
  const baseM = Math.max(FUNNEL.minBaseM, appearance.updraft.baseM - wall.loweringM);
  const funnel = funnelProfile(windMs, coreM, baseM, wall.radiusKm * 1000);
  // Swirl, and the vortex structure it gives.
  const swirl = coreM * windMs / (SWIRL.inflowDepthM * Math.max(5, appearance.updraft.speedMs));
  const vortices = swirl < SWIRL.multiple ? 1 : Math.min(SWIRL.maxVortices, 2 + Math.floor((swirl - SWIRL.multiple) / SWIRL.perVortex));
  const twoCell = ramp(swirl, SWIRL.breakdown, SWIRL.multiple);
  // Lean: the ground point lags the wall cloud as the storm moves on (TornadoEngine drift).
  let tiltE = (wall.xKm - t.positionKm.x) * 1000, tiltN = -(wall.yKm - t.positionKm.y) * 1000;
  // Decay: the wind falling away from its peak as the outflow wraps round (TornadoEngine ties the
  // wind to the occlusion). The occluding outflow carries the lower vortex off to the left of
  // the storm's track, under a parent rotation that goes on with the storm: the lean of a
  // rope-out (the funnel's top sits to the right of its ground point).
  const weakening = (t.peakWindSpeedMph ?? 0) > 0 ? clamp(1 - t.windSpeedMph / t.peakWindSpeedMph, 0, 1) : 0;
  const decay = ramp(weakening, 0.12, 0.35);
  const vel = storm.velocityKph ?? { east: 0, north: 0 }, speed = Math.hypot(vel.east, vel.north) || 1;
  tiltE += vel.north / speed * decay * ROPE_LEAN * baseM; tiltN -= vel.east / speed * decay * ROPE_LEAN * baseM;
  const lean = Math.hypot(tiltE, tiltN) / Math.max(1, baseM);
  // Debris lofted where the wind exceeds what lifts it; dust where the ground layer is dry.
  const debris = ramp(t.windSpeedMph, 65, 170);
  const shape = describeFunnel(funnel, baseM, lean, decay);
  const type = [shape.name, vortices > 1 ? 'multi-vortex' : null, appearance.rain.wrap >= 0.55 ? 'rain-wrapped' : null].filter(Boolean).join(', ');
  return {
    id: `${storm.id}#${t.cycleCount}`, type, shape: shape.name,
    xKm: r2(t.positionKm.x), yKm: r2(t.positionKm.y), windMph: r0(t.windSpeedMph), widthYards: r0(t.widthYards), ef: t.estimatedEf, windEf: t.windEf ?? null,
    groundMinutes: r0(t.groundTimeMinutes), forwardMph: r0(t.forwardSpeedMph), headingDeg: r0(t.motionDirectionDeg),
    coreRadiusM: r0(coreM), baseM: r0(baseM),
    // Radius of the visible funnel (m) at heights evenly spaced from the ground to the base; 0 where uncondensed.
    funnelRadiusM: funnel.radii.map(r0), condensedM: r0(funnel.bottomM), condensedShare: r2(1 - funnel.bottomM / baseM),
    swirl: r2(swirl), vortices, twoCell: r2(twoCell), subvortexRadiusM: r0(vortices > 1 ? 0.2 * coreM : 0),
    tiltEastM: r0(tiltE), tiltNorthM: r0(tiltN), decay: r2(decay), contortion: r2(decay * ramp(lean, 0.2, 1.2)),
    debris: { radiusM: r0(halfWidthM * (1 + 0.6 * debris)), heightM: r0(debris > 0 ? 40 + 260 * debris : 0), strength: r2(debris), dust: r2(debris * ramp(appearance.updraft.baseM, 1000, 2200)) },
    rainWrap: appearance.rain.wrap
  };
}

// Radius of the condensation funnel at FUNNEL.levels heights from the ground to the base.
export function funnelProfile(windMs, coreM, baseM, flareM = FUNNEL.flareKm * 1000) {
  const core = FUNNEL.deficitFactor * windMs * windMs, radii = [];
  for (let i = 0; i < FUNNEL.levels; i++) {
    const z = baseM * i / (FUNNEL.levels - 1), need = G * (baseM - z);
    let r;
    if (need >= core) r = 0;
    else if (need >= core / 2) r = coreM * Math.sqrt(2 * (1 - need / core));
    else r = need > 0 ? coreM * Math.sqrt(core / (2 * need)) : Infinity;
    radii.push(Math.min(r, Math.max(flareM, coreM)));
  }
  return { radii, bottomM: Math.max(0, baseM - core / G) };
}

// A name for the funnel's shape: what a chaser would call it.
//   uncondensed   the cloud reaches less than a third of the way down
//   rope          thin, and leaning or decaying
//   drillbit      thin and upright
//   wedge         at least as wide as it is tall, at half height
//   stovepipe     about the same width from bottom to top
//   cone          widening toward the cloud base
//   elephant trunk  a cone bent by its lean
export function describeFunnel(funnel, baseM, lean = 0, decay = 0) {
  const n = funnel.radii.length, condensed = 1 - funnel.bottomM / baseM;
  if (condensed < 0.35) return { name: 'uncondensed' };
  const visible = funnel.radii.map((r, i) => ({ r, z: baseM * i / (n - 1) })).filter(p => p.r > 0 && p.z < baseM * 0.97);
  if (visible.length < 2) return { name: 'uncondensed' };
  const height = baseM - funnel.bottomM;
  const at = share => { const z = funnel.bottomM + share * height; return visible.reduce((best, p) => Math.abs(p.z - z) < Math.abs(best.z - z) ? p : best).r; };
  const bottom = at(0.15), mid = at(0.5), top = at(0.85);
  const thin = 2 * mid / height;
  if (thin < 0.15) return { name: decay > 0.3 || lean > 0.5 ? 'rope' : 'drillbit' };
  if (thin >= 0.9) return { name: condensed < 0.85 ? 'partial wedge' : 'wedge' };
  if (top / Math.max(1, bottom) < 1.6) return { name: 'stovepipe' };
  return { name: lean > 0.6 ? 'elephant trunk' : 'cone' };
}

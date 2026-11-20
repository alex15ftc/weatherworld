// The scene round a storm's tornado, for a lab that draws one (tools/engine/storm-bundle-samples.mjs
// writes it beside each storm's bundle entry; the tornado-windfield lab's Replay reads the samples).
// Not the tornado's state - its wind, width and life are the bundle's look (StormWorkers lookOf) -
// but what it is seen in: the cloud over it, the rain and hail round it, the air and the ground.
// Nothing here decides how anything looks: each number is the engine's own (StormAppearance, the
// sky's cell fields) or measured from the sounding of the air the storm takes in (LabWindow
// inflowSounding: the cell INFLOW_KM back along the 0-1 km storm-relative wind).
//
// Places are metres east and north of the tornado's ground point (of the wall cloud when none is
// down); heights metres above the ground there; winds m/s, [east, north].
//   cloud   baseM (the cloud base the bundle's cloudBaseM is: the inflow's LCL), topM, overshootM,
//           striation (0-1), the wall cloud (place, radius, lowering below the base, rotation,
//           strength, tail cloud and its bearing), the rain-free base (radius, share of it clear),
//           the shelf (strength, height, facing, tiers), the anvil (length, width, bearing, top,
//           mammatus), and the sky's cover over the storm's cell (low, mid, high, per cent)
//   precip  the rain core (place, length along and across, bearing, intensity 0-1, how far it wraps
//           round the updraught and tornado 0-1), the hail core (place, radius, size), the rear
//           flank (wrap, strength, its clear slot 0-1, downdraught m/s), the storm's peak
//           reflectivity (dBZ), flashes a minute; and from the sounding the freezing level and the
//           wet-bulb zero (where hail and snow melt on the way down) and the precipitable water
//   air     the surface air the storm takes in (T, Td C, relative humidity %), its LCL, LFC and EL
//           (m above the ground), DCAPE (J/kg: the downdraughts' fuel), the wind every 250 m from
//           the ground to 3 km (ground-relative), the storm's motion, the 0-1 km storm-relative
//           inflow, and the lapse rates 0-1 and 0-3 km (C/km)
//   ground  where the tornado is: the ground's height (m), soil moisture (0-1: dry ground gives up
//           dust), the ground wind there (m/s)
//           and its cover (js/game/groundCover.node.js: the world map's class at the tornado and the
//           share of each within its damage width or 1 km - what its debris is made of)
//   sun     latitude, the local hour, the day's sunrise and sunset (local hours), and the sun's height
//           and bearing (degrees; js/satellite/Satellite.js sunAt, whose declination is the one that
//           gives the engine's own day - the world keeps one late-spring day, so there is no date to
//           send); date: the calendar's name for the hour on the hosted engine's locked clock, else null
//   vortices  the rotation in metres and m/s (js/storms/StormVortices.js, which the frames, the radar
//           and the debris all read): the mesocyclone at 0, 1, 3 and 5 km (its centre, radius and the
//           wind at it) and, with a tornado down, the tornado (core radius at the ground and aloft, its
//           swirl - its ground wind less the storm's motion - and its ground wind, its depth) and the
//           tornado cyclone round it (radius, wind, depth)
//   tornado the tornado's look, as the engine's appearance draws it (StormAppearance tornadoAppearance):
//           its shape and type, the swirl ratio and the vortex structure it gives (vortices, two-cell
//           share, subvortex radius), core radius, base, the condensed funnel (its bottom, the share of
//           the way down, its radius at heights from the ground to the base), tilt, decay, contortion,
//           debris cloud (radius, height, strength, dust), rain wrap; null with none down
//   life    the tornado's life and track (TornadoStages, TornadoEngine RFD_SURGE, DECAY_DRIFT): its stage - the lab's
//           six: gestation (none down yet, one near: genesisPotential > 0.4), organizing, mature, shrinking,
//           rope, dissipated (10 min after it ended) - with its progress 0-1 through the stage and its
//           contortion 0-1 (on the ground), share of its drawn life, minutes down and its life, the wind it shows
//           and the vortex's (intensity, which its rating follows) and peak, its core and mature core, how far
//           the loss of its rotation has taken it into decay, the storm's occlusion now and its peak, the surge
//           under way (wrap or push, minutes left, turn and speed of a push), surges and failed occlusions so
//           far, where it is held from the wall cloud (m: the occlusion's offset, the decay drift, a surge's
//           push), and its track to date (m east, north of it now, minutes ago; substeps while it revolves) and
//           the loops in it. With none down: only the stage (gestation, dissipated) and its progress; null
//           when neither
//   nearGround  the air the tornado draws in at the ground (the frame's tornado record, StormStructure:
//           the share of it that is the storm's rain-cooled outflow, so its temperature between the
//           inflow's and the outflow's, and where it condenses - the core's condensation level - under
//           the wall cloud's base; the funnel's tip; the core's and the mesocyclone's pressure drops)
//           and the cold pool (deficit K, depth); the frame's part is null without a frame (frameInfo)
//   gustFront  where it is (its lead ahead of the storm along its motion, placed round the tornado),
//           its radius, strength and gusts, and how it moves (js/storms/GustFront.js gustFrontAdvance:
//           the density current's speed, its speed relative to the storm and over the ground, heading)
//   light   the sunlight round the tornado (or the wall cloud without one), from the frame's cloud
//           (js/storms/StormLight.js, the frame's info.light when it was built): the optical depth and
//           diffuse transmittance overhead; on 16 bearings the distance to the low base's edge, the cloud
//           over the gap beyond it, the rain between and the gap's side light on a vertical surface; the
//           clear slot (the strongest gap: bearing, width, distance, place m east/north of the tornado,
//           openness); the direct sun at the ground, mid-height and the base. null without a frame
import { buildSounding } from '../sounding.js';
import { buildStormAppearance, flashRatePerMin } from '../storms/StormAppearance.js';
import { stormVortices, mesoLevel } from '../storms/StormVortices.js';
import { gustFrontAdvance } from '../storms/GustFront.js';
import { RFD_SURGE, trackLoops } from '../storms/TornadoEngine.js';
import { stormTornadoStage } from '../storms/TornadoStages.js';
import { coldPoolDeficitK, coldPoolDepthM } from '../storms/ColdPool.js';
import { REGIONAL_DEFAULTS } from '../atmosphere/RegionalAtmosphere.js';
import { WARNING } from '../forecast/Warning.js';
import { sunAt } from '../satellite/Satellite.js';
import { worldDate } from '../forecast/calendar.js';
import { inflowCell } from './LabWindow.js';
import { groundCoverAt } from './groundCover.node.js';

const MS_PER_KT = 0.514444;
const r0 = x => Math.round(Number(x) || 0), r1 = x => Math.round((Number(x) || 0) * 10) / 10, r2 = x => Math.round((Number(x) || 0) * 100) / 100;
const fToC = f => (f - 32) * 5 / 9;
// Relative humidity from temperature and dewpoint (Magnus, over water), per cent.
const rhOf = (tC, tdC) => 100 * Math.exp(17.625 * tdC / (243.04 + tdC) - 17.625 * tC / (243.04 + tC));
// The rain-cooled outflow's dew point (2026-11-19, the tornado lab's ask): the inflow air cooled by the cold pool's deficit
// through the evaporation of rain into it (constant enthalpy: each kelvin lost takes cp / Lv of vapour up, ~0.4 g/kg), its
// mixing ratio capped at saturation at the outflow's temperature (cooled past its wet bulb, the rest is colder air brought
// down, saturated). Magnus vapour pressure, as rhOf.
const eSat = tC => 6.1094 * Math.exp(17.625 * tC / (243.04 + tC));
export function outflowDewpointC(tC, tdC, deficitK, pHpa = 1000) {
  const e = eSat(tdC), r = 0.622 * e / (pHpa - e), tOut = tC - Math.max(0, deficitK), es = eSat(tOut);
  const rOut = Math.min(r + 1004 * Math.max(0, deficitK) / 2.5e6, 0.622 * es / (pHpa - es));
  const eOut = rOut * pHpa / (0.622 + rOut), l = Math.log(eOut / 6.1094);
  return Math.min(tOut, 243.04 * l / (17.625 - l));
}

// The sounding's wind (kt in its rows) at a height above the ground, m/s [east, north].
function windAt(profile, groundM, zAgl) {
  const z = groundM + zAgl;
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i], b = profile[i + 1];
    if (a.heightM <= z && b.heightM >= z) { const f = (z - a.heightM) / Math.max(1e-6, b.heightM - a.heightM); return [(a.u + (b.u - a.u) * f) * MS_PER_KT, (a.v + (b.v - a.v) * f) * MS_PER_KT]; }
  }
  const last = z < profile[0].heightM ? profile[0] : profile.at(-1);
  return [last.u * MS_PER_KT, last.v * MS_PER_KT];
}

// frameInfo: the storm's engine frame's info this tick (StormStructure buildStormFrame; StormWorkers
// keeps it on each engine entry), for nearGround's frame part. mapSeed: the world map's.
// The sun's height and bearing over a place on the map (km from the map's north-west corner, y south) at
// hourUtc (with the latitude and local hour): the scene's, and the frames' light (StormWorkers -> buildStormFrame -> info.light).
export function stormSun(world, at, hourUtc) {
  const [north] = WARNING.mapNorthwest, d = REGIONAL_DEFAULTS;
  const latDeg = north - at.y / 111.1, localHour = (((hourUtc + d.utcOffsetHours) % 24) + 24) % 24;
  return { ...sunAt(latDeg, localHour, { middleLatDeg: north - world.height * world.cellSizeKm / 2 / 111.1 }), latDeg, localHour };
}

export function tornadoSceneOf(world, storm, hourUtc = Number(world.stormEngine?.validHourUtc ?? world.validHourUtc), { frameInfo = null, mapSeed = 1 } = {}) {
  const a = buildStormAppearance(storm, undefined, { frameTornado: frameInfo?.tornado ?? null });
  if (!a) return null;
  const t = storm.tornado, on = !!t?.onGround;
  const at = on ? t.positionKm : { x: a.wallCloud.xKm, y: a.wallCloud.yKm };
  // (map km, y south -> m east and north of the tornado)
  const rel = (xKm, yKm) => [r0((xKm - at.x) * 1000), r0(-(yKm - at.y) * 1000)];
  const inflow = inflowCell(world, storm), sounding = buildSounding(inflow), p = sounding.params, profile = sounding.profile;
  const inflowGround = inflow.terrain?.elevationM ?? profile[0].heightM;
  const cellKm = world.cellSizeKm, here = world.getCell(Math.floor(at.x / cellKm), Math.floor(at.y / cellKm)), storms = world.getCell(Math.floor(storm.positionKm.x / cellKm), Math.floor(storm.positionKm.y / cellKm));
  const tC = fToC(inflow.surface.temperature), tdC = fToC(Math.min(inflow.surface.temperature, inflow.surface.dewpoint));
  const motion = [(storm.velocityKph?.east ?? 0) / 3.6, (storm.velocityKph?.north ?? 0) / 3.6];
  const profileWinds = [];
  for (let z = 0; z <= 3000; z += 250) { const [u, v] = windAt(profile, inflowGround, z); profileWinds.push([z, r1(u), r1(v)]); }
  const mean01 = [0, 1, 2, 3, 4].map(k => windAt(profile, inflowGround, k * 250)).reduce((s, w) => [s[0] + w[0] / 5, s[1] + w[1] / 5], [0, 0]);
  const agl = m => Number.isFinite(m) ? r0(m - inflowGround) : null;
  const ft = storms?.features ?? {}, groundWind = here?.surface?.wind?.speed ?? 0; // (a cell is null off the map)
  const sun = stormSun(world, at, hourUtc);
  // (StormVortices' frame: km from the storm's centre, x east, y south)
  const vx = stormVortices(storm, a.updraft.topM), pos = storm.positionKm, relV = (x, y) => rel(pos.x + x, pos.y + y);
  const tv = vx?.tornado, ta = a.tornado, tl = storm.tornado;
  const offM = o => (o ? [r0((o.x ?? 0) * 1000), r0(-(o.y ?? 0) * 1000)] : [0, 0]);
  const strength = clamp01(storm.coldPoolStrength), deficitK = coldPoolDeficitK(strength), ft0 = frameInfo?.tornado ?? null;
  const share = ft0 ? ft0.coreOutflow : null, outflowTC = tC - deficitK, outflowTdC = outflowDewpointC(tC, tdC, deficitK, profile[0]?.p ?? 1000);
  const gf = gustFrontAdvance(storm, storm.environment ?? {}), heading = gf.headingDeg * Math.PI / 180;
  const frontKm = { x: pos.x + Math.sin(heading) * gf.leadKm, y: pos.y - Math.cos(heading) * gf.leadKm };
  return {
    frame: on ? 'tornado' : 'wall cloud',
    cloud: {
      baseM: a.updraft.baseM, topM: a.updraft.topM, overshootM: a.updraft.overshootM, striation: a.updraft.striation,
      // (newAt, with a tornado down: the storm's own mesocyclone, where a new wall cloud forms as the
      // occluding tornado and the wall cloud over it fall behind; StormAppearance)
      wallCloud: { at: rel(a.wallCloud.xKm, a.wallCloud.yKm), newAt: a.wallCloud.newAtKm ? rel(...a.wallCloud.newAtKm) : null, radiusM: r0(a.wallCloud.radiusKm * 1000), loweringM: a.wallCloud.loweringM, rotation: a.wallCloud.rotation,
        strength: a.wallCloud.strength, tail: a.wallCloud.tail, tailBearingDeg: a.wallCloud.tailBearingDeg },
      rainFreeBase: { at: rel(a.updraft.xKm, a.updraft.yKm), radiusM: r0(a.base.radiusKm * 1000), clear: a.base.rainFree },
      shelf: { strength: a.shelf.strength, heightM: a.shelf.heightM, facingDeg: a.shelf.facingDeg, tiers: a.shelf.tiers },
      anvil: { lengthKm: a.anvil.lengthKm, widthKm: a.anvil.widthKm, bearingDeg: a.anvil.bearingDeg, topM: a.anvil.topM, mammatus: a.anvil.mammatus },
      coverPct: { low: r0(100 * (ft.cloudLow ?? 0)), mid: r0(100 * (ft.cloudMid ?? 0)), high: r0(100 * (ft.cloudHigh ?? 0)) }
    },
    precip: {
      rain: { at: rel(a.rain.xKm, a.rain.yKm), alongM: r0(a.rain.alongKm * 1000), acrossM: r0(a.rain.acrossKm * 1000), bearingDeg: a.rain.bearingDeg, intensity: a.rain.intensity, wrap: a.rain.wrap },
      hail: { at: rel(a.hail.xKm, a.hail.yKm), radiusM: r0(a.hail.radiusKm * 1000), sizeIn: a.hail.sizeInches },
      rearFlank: { wrap: a.rearFlank.wrap, strength: a.rearFlank.strength, clearSlot: a.rearFlank.clearSlot, downdraftMs: a.rearFlank.downdraftMs },
      maxDbz: r0(storm.radar?.maxReflectivityDbz ?? 0), flashesPerMin: r1(flashRatePerMin(Number(storm.geometry?.updraught?.speedMs ?? storm.updraughtMs) || 0)),
      freezingM: agl(p.freezingM), wetBulbZeroM: agl(p.wetBulbZeroM), pwMm: r1((p.precipWater ?? 0) * 25.4)
    },
    air: {
      surface: { tC: r1(tC), tdC: r1(tdC), rhPct: r0(rhOf(tC, tdC)) },
      lclM: r0(p.lclAglM), lfcM: agl(p.lfcM), elM: agl(p.elM), dcape: r0(p.dcape),
      lapse01CKm: r1(p.lapseRate01km), lapse03CKm: r1(p.lapseRate03km),
      windProfile: profileWinds, stormMotionMs: [r1(motion[0]), r1(motion[1])],
      inflow01Ms: [r1(mean01[0] - motion[0]), r1(mean01[1] - motion[1])]
    },
    ground: { elevationM: r0(here?.terrain?.elevationM ?? 0), soilMoisture: r2(here?.terrain?.soilMoisture ?? 0), windMs: r1(groundWind * MS_PER_KT),
      cover: groundCoverAt(at.x, at.y, on ? Math.max(0.25, (t.widthYards ?? 0) * 0.9144 / 2000) : 1, mapSeed) },
    sun: { latDeg: r2(sun.latDeg), localHour: r2(sun.localHour), sunriseLocal: REGIONAL_DEFAULTS.sunriseLocal, sunsetLocal: REGIONAL_DEFAULTS.sunsetLocal,
      elevationDeg: r1(sun.elevationDeg), azimuthDeg: r1(sun.azimuthDeg), date: worldDate(hourUtc)?.date ?? null },
    vortices: vx ? {
      spin: vx.spin,
      mesocyclone: [0, 1000, 3000, 5000].map(z => { const m = mesoLevel(vx, z); return { zM: z, at: relV(m.x, m.y), radiusM: r0(m.R * 1000), windMs: r1(m.V) }; }),
      lowLevelShare: r2(vx.meso.low),
      tornado: tv ? { at: relV(tv.x, tv.y), coreRadiusM: r0(tv.R * 1000), coreRadiusAloftM: r0(tv.Raloft * 1000), swirlMs: r1(tv.V), swirlAloftMs: r1(tv.Valoft ?? tv.V),
        groundWindMs: r1(tv.Vg), depthM: r0(tv.depthM), cyclone: tv.cyclone ? { radiusM: r0(tv.cyclone.R * 1000), windMs: r1(tv.cyclone.V), depthM: r0(tv.cyclone.depthM) } : null } : null
    } : null,
    tornado: ta ? {
      type: ta.type, shape: ta.shape, swirlRatio: ta.swirl, vortices: ta.vortices, twoCell: ta.twoCell, subvortexRadiusM: ta.subvortexRadiusM,
      coreRadiusM: ta.coreRadiusM, baseM: ta.baseM, condensedM: ta.condensedM, condensedShare: ta.condensedShare, funnelRadiusM: ta.funnelRadiusM,
      tiltM: [ta.tiltEastM, ta.tiltNorthM], decay: ta.decay, contortion: ta.contortion, debris: ta.debris, rainWrap: ta.rainWrap,
      forwardMph: ta.forwardMph, headingDeg: ta.headingDeg
    } : null,
    life: tl?.onGround ? {
      stage: tl.lifeStage ?? null, stageProgress: r2(tl.stageProgress ?? 0), contortion: r2(tl.contortion ?? 0), lifeShare: r2(tl.lifeShare ?? 0), minutesOnGround: r1(tl.groundTimeMinutes ?? 0), lifeMinutes: r1(tl.lifeMinutes ?? 0),
      windMph: r0(tl.windSpeedMph ?? 0), intensityMph: r0(tl.intensityMph ?? tl.windSpeedMph ?? 0), peakMph: r0(tl.peakWindSpeedMph ?? 0),
      coreRadiusM: r0(tl.coreRadiusM ?? 0), matureCoreM: r0(tl.matureCoreM ?? 0), lossFall: r2(tl.lossFall ?? 0),
      occlusion: r2(storm.occlusion ?? 0), occlusionPeak: r2(tl.occlusionPeak ?? 0),
      surge: tl.surge && tl.surge.until > (tl.groundTimeMinutes ?? 0) ? { kind: tl.surge.kind, minutesLeft: r1(Math.max(0, tl.surge.until - (tl.groundTimeMinutes ?? 0))), turnDeg: tl.surge.kind === 'push' ? r0(tl.surge.turnDeg) : null, speedFactor: tl.surge.kind === 'push' ? r2(tl.surge.speed) : null, failing: tl.surge.kind === 'push' && tl.surge.occlusion >= RFD_SURGE.occludedFrom } : null,
      surges: tl.surges ?? 0, failedOcclusions: tl.failedOcclusions ?? 0,
      heldOffsetM: { occlusion: offM(tl.occlusionOffsetKm), drift: offM(tl.decayDriftBeforeKm), surge: offM(tl.surgeOffsetKm) },
      track: (tl.trackPoints ?? []).map(p => [...rel(p.x, p.y), r1((hourUtc - p.hourUtc) * 60)]), loops: trackLoops(tl.trackPoints ?? [])
    } : (st => st ? { stage: st.name, stageProgress: r2(st.progress) } : null)(stormTornadoStage(storm)),
    nearGround: {
      coldPool: { deficitK: r1(deficitK), depthM: r0(coldPoolDepthM(strength)), strength: r2(strength) },
      drawnIn: ft0 ? { outflowShare: share, inflowTC: r1(tC), outflowTC: r1(outflowTC), outflowTdC: r1(outflowTdC), outflowRhPct: r0(rhOf(outflowTC, outflowTdC)), tC: r1(tC + (outflowTC - tC) * share) } : null,
      condensationM: ft0?.coreBaseM ?? null, wallCloudBaseM: ft0?.wallBaseM ?? frameInfo?.wallCloud?.baseM ?? null, wallCloudLoweringM: frameInfo?.wallCloud?.loweringM ?? null, funnelTipM: ft0?.tipM ?? null,
      coreDropHpa: ft0?.dropHpa ?? null, mesoDropHpa: ft0?.mesoDropHpa ?? frameInfo?.mesoDropHpa ?? null
    },
    gustFront: {
      at: rel(frontKm.x, frontKm.y), leadM: r0(gf.leadKm * 1000), radiusM: r0(a.gustFront.radiusKm * 1000), strength: a.gustFront.strength, gustMs: r1(a.gustFront.gustMph * 0.44704),
      densityCurrentMs: r1(gf.densityCurrentMs), relativeMs: r1(gf.relativeMs), groundMs: r1(gf.groundMs), headingDeg: r0(gf.headingDeg), pinned: gf.pinned
    },
    light: frameInfo?.light ?? null
  };
}
const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));

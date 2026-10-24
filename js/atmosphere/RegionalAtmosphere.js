// Regional layer of the redesigned atmosphere (stage 2 of docs/ATMOSPHERE-REDESIGN.md): the
// 500 x 500 mile map as a window in the quasi-geostrophic model. The outer model supplies
// balanced winds, the temperature of the troposphere and the surface pressure pattern. This
// layer adds, as processes on the 10-mile grid:
//   - terrain rising to the west, and the mountains beyond it that block the low-level westerly;
//   - the thermal low over the hot high ground and the lee trough, with the southerly
//     low-level wind in balance with them;
//   - air masses carried by the wind: low-level temperature and moisture (Gulf air entering
//     from the south) and the hot, dry, deeply mixed air that forms over the high terrain and
//     overruns the moist layer at 700 mb (the cap);
//   - a mixed boundary layer with a daily heating cycle: it deepens through the day, and where
//     it grows deeper than the moist layer (shallow over the high ground) it mixes dry air to
//     the surface: the dryline;
//   - the night-time low-level jet: once the surface decouples at sunset the wind above it is
//     freed from friction and swings around its balanced value (inertial oscillation).
// It fills the same cells the storm engine and the soundings read.
import { Atmosphere } from '../atmosphere.js';
import { updateCellDiagnostics } from '../sounding.js';
import { clamp } from '../scenarios/math.js';

const KT = 1.943844, KAPPA = 0.2857, RD = 287, GRAVITY = 9.81, DAY = 86400, RHO_AIR = 1.2, LATENT_HEAT = 2.5e6;
const kelvinToF = k => (k - 273.15) * 9 / 5 + 32;
const ramp = (value, low, high) => clamp((value - low) / (high - low), 0, 1);

export const REGIONAL_DEFAULTS = Object.freeze({
  columns: 50, rows: 50, cellKm: 16.09344,
  utcOffsetHours: -6,
  // The day, in local solar time (clocks there read CDT, an hour later): sunrise and sunset, and how
  // long after sunrise the ground starts heating the air and before sunset it stops. (2026-10-21:
  // 5 and 19, a late-spring day, with 0.75. Until then the heating ran from 6:30 to 17:00, a
  // winter's day: the air decoupled near 6 pm CDT, an hour and a half early.)
  sunriseLocal: 5, sunsetLocal: 19, heatingLagHours: 0.75,
  // Terrain: High Plains rising to the west (m above sea level).
  terrainEastM: 300, terrainWestM: 1500, terrainShape: 1.25,
  // Reference state at the map centre for a warm-season Plains air mass.
  // (302.5 to 301 on 2026-10-16, with Gulf air back at 16 g/kg: the warm sector ran at 85 F over
  // 66 F, cloud bases near 1,500 m and the tornado parameter low; now about 83 F over 67 F.)
  airMassThetaK: 301,                 // potential temperature of the low-level air mass
  plateauWarmthK: 11,                 // the air over the high ground is hotter (and deeply mixed)
  // Lee trough: westerly flow descending the high ground lowers the pressure along its foot;
  // the low-level wind east of it turns southerly. (The outer model has no mountains, so this
  // part is set here. The thermal low over the hot plateau is not set: it follows from the
  // temperature of the low-level air, see thermalBalance.)
  // leeTroughColumn 0.2 to 0.39 on 2026-10-16: the axis along the foot of the high ground at
  // the map's western edge (ground near 1,000 m, where lee troughs lie over the Plains) instead
  // of 80 km west of the map, where neither it nor the lows that form in it could be seen.
  leeTroughFlowHpa: 4, leeTroughColumn: 0.39, leeTroughWidthKm: 450, leeFlowMs: 15,
  // Lee cyclogenesis: where the outer model's ascent (an approaching trough) crosses the lee
  // trough, air descending the slope is stretched and the trough deepens there, by up to
  // leeCycloneGain of its depth at leeCycloneAscentKh, into a closed low.
  leeCycloneGain: 0.5, leeCycloneAscentKh: 0.2, leeCycloneOuterLowHpa: [4, 12],
  // Cyclone development on the fronts (Petterssen's): where the outer model's ascent (an
  // approaching trough) reaches a low-level baroclinic zone, the surface pressure falls at
  // cycloneGainHpa per hour for each K/h of ascent, in full where the air-mass contrast is
  // cycloneFrontK100[1] K per 100 km or more (none below [0]). The fall moves with
  // cycloneSteeringShare of the 700 mb wind, fills over cycloneFillHours, and its pressure
  // spreads over cycloneSmoothingCells. (2026-10-19: the outer model's lows are broad and lay
  // off the map; with nothing to deepen them on the fronts, no closed low was ever on the map
  // and fronts met with no low at their junction.) (2026-10-20: smoothing 3 to 6 cells, the deformation
  // radius the other low-level pressure follows: on seed 1357 the fall reached 17 hPa in a low about
  // 50 km across, its balanced wind 188 kt at 850 mb, and 4,760 cell-hours over 70 kt; now 141, at most
  // 76 kt, with closed lows on the map in 14 of 73 hours (16 before). Fading the fall under an outer
  // low as well cut the jet further but left closed lows in 4 hours; not kept.)
  // Cloud (2026-10-19), from the fields, as shares of the sky 0-1, and what it does to the sun's
  // heating and the night's cooling. Low: stratus where the air near the ground is within
  // stratusSpreadK of saturation (none at the first, overcast at the second), fair-weather
  // cumulus (up to cumulusShare) once the mixed layer reaches its cloud base, and cloud where 850
  // mb is more humid than cloudRh (Sundqvist's scheme). Mid: the outer model's ascent
  // (midAscentKh), less where the dry lid is. High: cirrus with stronger ascent (highAscentKh)
  // and storms' anvils, carried by the 250 mb wind and thinning over anvilHours. Heating is cut by
  // heatingCloudCut of each layer's share, the night's cooling by coolingCloudCut.
  stratusSpreadK: [1.5, 0.3], cumulusShare: 0.3, cloudRh: 0.8, midAscentKh: [0.03, 0.2], highAscentKh: [0.05, 0.3], anvilHours: 3,
  // (Cuts as for a sky that share covered on average, broken cumulus letting much of the sun
  // through: 0.65/0.4/0.15 and 0.75/0.45/0.2 at first left the moist air's day-night range at 10 F.)
  heatingCloudCut: { low: 0.5, mid: 0.3, high: 0.1 }, coolingCloudCut: { low: 0.6, mid: 0.35, high: 0.15 },
  cycloneGainHpa: 3, cycloneFrontK100: [2, 6], cycloneSteeringShare: 0.8, cycloneFillHours: 18, cycloneSmoothingCells: 6,
  // The geography (the rise to the high ground, the lee trough, where dry, continental and
  // Gulf air come from) is laid out over geographyColumns cells from its western edge; the map
  // starts geographyOffset cells east of that edge. With 0 and null the map spans all of it.
  // East of the geography the plains go on flat.
  geographyColumns: 50, geographyOffset: 15,
  // Cells over which the pressure responds to low-level temperature contrasts, and how long
  // the day's heat stays in the air after sunset.
  thermalSmoothingCells: 8, residualHeatHours: 8,
  // The same for the contrasts between air masses that the wind has brought together (fronts):
  // their cold air is shallow (coldAirDepthM), and the pressure follows its edge more closely.
  airMassPressureSmoothingCells: 2,
  // Depth (m) of the near-ground air whose own temperature shows in the pressure (the rest of
  // the column is the outer model's).
  airMassPressureDepthM: 400,
  // Cold air is a wedge, not a slab (2026-10-19): it deepens with distance behind the edge of the
  // warmer air, at domeSlope (about 1:120, as real fronts slope), from domeMinM to domeMaxM. Its
  // coldness fades from full at the ground to none at its top, so 850 and 700 mb cool once it is
  // deep enough, the lid rides up over it, and its weight (half its depth times its deficit)
  // makes the pressure rise steadily behind a front, which then lies in a kinked trough. Air no
  // more than domeWarmK colder than its column holds counts as the warmer air. (Until then the
  // cold air weighed as if 400 m deep everywhere and 700 mb never felt it: fronts were a
  // pressure step under a flat slab capped by a 6-10 C inversion, with no wind shift.)
  // Where the wind squeezes the air masses together (deformation and convergence, D), mixing and
  // the circulations across a front too small for the grid hold it about frontWidthKm wide: a
  // diffusion of K = D L^2 on the air-mass temperature (2026-10-19; until then nothing did, and
  // fronts closed to a single 10-mile cell with 15-20 C across it at 850 mb).
  frontWidthKm: 25, frontDeformationS: 4e-4,
  // A dome's depth is also no more than its coldness allows (domeDeficitKPerM: the cold air's
  // coldness fades upward at about the rate a real cold air mass's does, so a colder dome is
  // deeper). 2026-10-23: until then a dome with no warmer air on the map was taken at domeMaxM
  // whatever its coldness, and every dome jumped to 4.5 km deep, or back, as the last warm cell
  // left or came onto the map: 6-10 hPa in an hour.
  domeSlope: 1 / 120, domeMinM: 300, domeMaxM: 4500, domeWarmK: 1.5, domeDeficitKPerM: 0.0035,
  // Air cooled by storms' rain (cold pools): how deep it is, and how long it takes to warm back up
  // at night (by day the sun warms it; see fill).
  coldPoolDepthM: 800, coldPoolRecoveryHoursNight: 8,
  // ...and how fast the wind over it mixes it out (the wind's run, km, for one e-folding), and
  // the least deficit kept (K; fainter is mixed in with its air mass). Its air: evaporating rain
  // cools it toward the wet bulb and adds the vapour (at most coldPoolEvaporationShare of the way),
  // and the air that came down in the downdraught arrives below saturation, warmed by its descent
  // faster than the rain could keep it saturated: at most coldPoolHumidity relative humidity
  // (outflow air is observed 2-6 F short of saturation). 2026-10-19: until then the pool's air
  // kept the ambient vapour, so every pool colder than the spread was saturated.
  coldPoolMixingKm: 300, coldPoolLeastK: 0.3, coldPoolEvaporationShare: 0.7, coldPoolHumidity: 0.85,
  // The mountains west of the map block the mean westerly below their crest: share of it
  // removed at 850 mb and below, fading to none at the crest.
  mountainBlocking: 0.8, crestPressureHpa: 700,
  reference700C: 5, reference500C: -11.5, reference250C: -48,
  // The hot, dry air off the plateau is well mixed from its base to near 500 mb, so where it
  // lies overhead the temperature falls off faster with height: 500 mb is this share of the
  // way from its ordinary temperature to the dry adiabat through 700 mb.
  emlLapseShare: 0.45,
  // Moisture offshore: the Gulf's air is gulfMixingRatio plus the outer model's moisture anomaly
  // near the ground there (its surfaceMoisture; 2026-10-16, in place of this layer's own scouring
  // by northerly wind at the map's southern edge and recovery over 2.5 days, which the outer
  // field now does over the whole country). After a front has dried the air over the Gulf, the
  // moisture coming back north is modest at first, and shallow (moistReturnShallowM) while it is
  // still near gulfScouredMixingRatio. The Gulf's air is at most gulfMixingRatio + gulfMoistMoreGkg
  // (1.5 gave warm sectors at 17.5 g/kg, a CAPE 90th of 4,100 and Moderate on 28% of days).
  gulfScouredMixingRatio: 8.5, gulfMoistMoreGkg: 0.5,
  // How strongly each level follows the outer model's tropospheric temperature. Cold air
  // masses are shallow and sharpest near the ground. Warm ones are not: the moist air under a
  // warm pattern comes off the sea and keeps close to the sea's temperature, and the warmth
  // shows above it instead, which is what strengthens the cap.
  // (250 mb: 0.3 to 0.7 on 2026-10-19, so the jet has the temperature gradient thermal wind
  // gives it, about 4-6 C across the map instead of 1-2; above the tropopause (tropopauseC) the
  // air stops cooling, which is what weakens the gradient at the jet's top over cold air.)
  temperatureShare: { 700: 1.0, 500: 0.9, 250: 0.7 }, tropopauseC: -58,
  // The low-level air masses come from the outer model's air near the ground (its surface
  // temperature, carried by its low-level flow over the whole country; 2026-10-16, in place of
  // 1.8 times its 250-750 mb temperature, which varies far too little to make a front). Warm
  // anomalies count at surfaceWarmShare: warm-sector air comes off the sea and keeps close to
  // the sea's temperature. (0.45 to 0.3 on 2026-10-16 with the cap: the warm sector reached 88-93 F
  // by afternoon and its CAPE ran at twice the real values.)
  surfaceWarmShare: 0.3,
  // Moisture: mixing ratio (g/kg) of the air entering at each side, and the altitude of the
  // top of the Gulf moist layer. (2026-10-16: continental air 0.55 to 0.45 of saturation, so the
  // dewpoint falls further behind fronts.)
  // How much faster than the outer model's mean (surfaceMoistureGradientGkgPer1000Km, 3) the
  // Gulf's air thins northward over the Plains (g/kg per 1000 km): about 5 in all, as from the
  // Texas coast to Nebraska in late spring (2026-10-19, in place of a share by the map's row).
  gulfNorthwardFallGkgPer1000Km: 2, gulfCoastSouthKm: 500,
  // (gulfMixingRatio 16 to 14.75 on 2026-10-20 with reference500C -9.5 to -11.5: the outer model's
  // moisture held the Gulf's air at its cap, 16.5, and afternoon dewpoints over moist air near 67 F;
  // with the steeper mid-levels this keeps MLCAPE about where it was. 14.5 gave 17% of days under a
  // Slight Risk and tornadoes on 58%; 15 gave Moderate on 44%.)
  gulfMixingRatio: 14.75, continentalMixingRatio: 7, continentalHumidity: 0.45, dryMixingRatio: 3.5, moistLayerTopM: 2100,
  // Boundary layer.
  // Peak heating of the air by the ground: moist, vegetated ground puts most of the sun's
  // energy into evaporation, dry ground into heating the air.
  heatingMoistWm2: 110, heatingDryWm2: 390,
  // Night cooling of the air near the ground on a calm night (K, sunset to sunrise, moist air at
  // nightMoistShare of dry air's), shrinking with the low-level wind (to 0.62 at nightWindMs, at
  // least nightWindFloor of it), and the spread the wind keeps the air from saturation (K, from
  // calm to windy over nightSpreadWindMs). 2026-10-19: calm dry air about 14 K (25 F; 12 until cloud came in, which now holds part of the night's heat), calm moist
  // 10.5 K, a warm-sector night under a 15-20 m/s jet about 5 K (floor 0.25 to 0.4 the same day: windy
  // nights stayed at 80 F and more until dawn); until then 11-21 K whatever the wind.
  // (2026-10-21: moist share 0.75 to 0.85 and floor 0.4 to 0.6. The moist air's day-night range
  // was 6-13 F on four seeds, against 18-25 F on spring Plains nights, and warm-sector air stayed
  // 8-10 F above its dewpoint at dawn under the jet; a windy moist night now cools about 8.5 K.)
  // (nightCoolingHours 4 to 2.5 on 2026-10-21, with the later sunset: most of a night's cooling at
  // the ground comes in the first hours after sunset, and with 4 the surface parcel's inhibition was
  // still low at 9-11 pm, when 32% of tornadoes came; 24% with 2.5.)
  nightCoolingK: 14, nightCoolingHours: 2.5, nightMoistShare: 0.85, nightWindMs: 10, nightWindFloor: 0.6,
  nightSpreadK: [0.2, 2], nightSpreadWindMs: [3, 12],
  // By day the boundary layer is mixed, so it has one wind through its depth: the mean
  // balanced wind of the layer, less this share lost to friction at the ground. The wind at
  // the ground is surfaceWindShare of it, backed by surfaceBackingDeg. At sunset the layer is
  // cut off from the ground and its departure from balance swings freely: the night-time jet.
  // (2026-10-16: friction 0.3 to 0.4, turning 22 to 15 degrees by day and 38 to 25 at night,
  // with the lee trough at most 4 hPa instead of 7: helicity in the lowest km came down from a
  // median of 138 to 96, 90th 311 to 220; the night turning made the evening's jump.)
  // How much of it reaches the ground, and how far friction turns it toward low pressure, follow
  // the stability of the air near the ground (2026-10-19; until then a fixed 0.75 and 15 degrees
  // by day, 0.4 and 25 at night, so the surface wind was 0.4 of geostrophic and crossed the
  // isobars at 20-25 degrees everywhere in quiet weather). By day, from a shallow to a deep mixed
  // layer (surfaceMixedDepthM): surfaceWindShare and surfaceBackingDeg from their first values
  // to their second. At night, from a near-neutral night (a strong wind over a weak inversion) to
  // a decoupled one, by the bulk Richardson number of the lowest nightLayerM (half way at
  // nightRichardson): surfaceWindShareNight and surfaceBackingNightDeg from first to second.
  // 2026-10-20 (final tuning): friction 0.4 to 0.15, surface share 0.6-0.75 to 0.5-0.65 and turning
  // 25-15 to 40-30 degrees. A convective mixed layer carries about 0.8-0.9 of the balanced wind, and
  // the wind at the ground runs at about 0.5-0.7 of it, crossing it at 20-40 degrees over land. With
  // 0.4 the afternoon's 850 mb wind was about 17 kt and nearly the surface wind's, so 0-1 km
  // helicity over moist air was about 53 by day against 147 at night (the night's jet swinging from
  // that deficit), and 66% of the tornadoes came between 9 pm and 6 am. Now about 88 by day and
  // 130 at night, and 26% at night (tune audit, 8 seeds x 5 days).
  // 2026-10-21: friction 0.15 to 0.25, and the layer's wind crosses the isobars toward low pressure
  // by mixedLayerTurnDeg (the surface's turning is now counted from it, so the wind at the ground
  // keeps its direction). That departure from balance is what swings into the night-time jet
  // (Blackadar): with 0.15 and no turning it was 2-4 kt, the 850 mb wind barely rose after dark,
  // and 0-1 km helicity was lowest from 3 to 6 pm and never had its evening rise, so only 21 of
  // 102 tornadoes on four seeds came between 3 and 9 pm. Now the jet is back to balance by about
  // 8 pm and peaks near 1.3 times it around 1-3 am.
  mixedLayerFriction: 0.25, mixedLayerTurnDeg: 10, surfaceWindShare: [0.5, 0.65], surfaceBackingDeg: [30, 20], surfaceMixedDepthM: [300, 2500],
  surfaceWindShareNight: [0.4, 0.15], surfaceBackingNightDeg: [20, 40], nightLayerM: 150, nightRichardson: 0.25,
  // Depth (m) of the night's inversion the morning's mixed layer wears through before the day's
  // surface wind holds (0: at once at sunrise).
  morningTransitionM: 300,
  // Most of the mid-level wind a mixed layer 3 km deep brings down to the ground.
  momentumMixingShare: 0.7,
  // Hot, dry mixed air from the high terrain (elevated mixed layer, Carlson et al. 1983): the
  // afternoon mixed layer over the high ground, carried off it by the 700 mb wind over the
  // cooler Gulf air, where it is the cap. It is well mixed, so one potential temperature (its
  // source's) describes it; it cools by radiation at lidCoolingKPerDay on the way. Where it
  // forms (terrain), and how long the share of it at a place lasts once it stops being renewed.
  emlSourceTerrainM: 1150, emlLifetimeDays: 2, lidCoolingKPerDay: 1.5,
  // Its main source is beyond the map: the deep afternoon mixed layer over the higher, hotter
  // desert plateau to the west and south-west. Lid air entering across the map's western side
  // has that layer's potential temperature (K), changed by the outer model's warmth there that day.
  // (318 gave a cap that held for days over the best air: no severe weather on 18% of days. That
  // was with the lid covering at most 0.6-0.7 of the map; 316 to 315.5 on 2026-10-16 once the lid
  // air came in whole, and 317 gave quiet days on half the days.)
  lidSourceThetaK: 315.5,
  airMassRelaxationDays: 2,
  // Convective adjustment (step): the margin (K) the low-level air may stand above 700 mb's potential
  // temperature, and how fast it mixes down past it.
  adjustMarginK: 0.5, adjustHours: 1,
  // Average turning of the wind toward low pressure through the low-level air mass (degrees):
  // the friction layer's flow across the isobars, which carries the air masses into troughs.
  airMassInflowDeg: 15,
  // Cold air is heavier and pushes under the warm air next to it like a density current. The
  // colder the air than the warmest air within reach, the faster it pushes, so the cold edge
  // catches up with itself and sharpens into a front, while a retreating edge spreads out.
  // Speed = factor x sqrt(g x depth x deficit / temperature).
  coldPushFactor: 0.4, coldAirDepthM: 1200, coldPushReachCells: 10,
  // Temperature gradient (K per 100 km) from which the push starts to its full strength: a
  // frontal contrast. (From 0.5-1.5 on 2026-10-15: the warm sector has gradients like that
  // everywhere, and the push they set off was most of the convergence away from the lines.)
  coldPushGradient: [2, 4],
  // Large-scale ascent and the cap. The outer model's ascent cools its 250-750 mb layer at the
  // rate it reports; the capping layer near 700 mb is far more stable, so the same lift cools it
  // capLiftRatio times as much ((dry adiabatic - cap lapse rate) / (dry adiabatic - mean lapse
  // rate), about (9.8 - 2) / (9.8 - 6.5)). The extra cooling stays with the air it was done to,
  // moves with the 700 mb wind and fades over capLiftHours; sinking air warms the cap the same way.
  capLiftRatio: 2.4, capLiftHours: 24,
  // The map's air takes the large-scale change a slide makes under it (see step).
  carryDeparture: true,
  // The share of the 1000-750 mb column's weight counted in the ground pressure (balancedPressureHpa).
  groundColumnShare: 1,
  // 850 and 700 mb mix where 700 mb would be cooler in potential temperature (see fill).
  convectiveAdjustment: true,
  // The share of the ground air's moisture at 850 mb above the day's mixed layer (and all night): the
  // moist layer thins toward its top. (0.85 to 0.75 on 2026-10-24: 850 mb dewpoints of 15-17.5 C over most
  // of the warm sector, where outbreak soundings usually have 12-14, and MLCAPE rising overnight to 4,500-
  // 5,300 J/kg; docs/METEOROLOGIST-REVIEW-2026-10-24.md.)
  moisture850Share: 0.75,
  // The lift the outer model cannot see works on the cap the same way: warm air carried up over
  // cooler air and the low-level jet's air piling up where it ends (AtmosphereWorld's
  // isentropicLiftMs and jetConvergenceLiftMs, m/s, up to mesoLiftMaxMs) cool the capping layer
  // as lifting any stable layer does (by capLapseGapKPerM, the dry adiabat less the cap's lapse
  // rate, per metre), mesoCapLiftShare of it. (2026-10-23: until then only the outer model's
  // ascent wore the cap down, and under a 50-60 kt low-level jet at night the elevated parcels
  // still faced 170-350 J/kg against the 50-65 their lift brings: no storms started at night.)
  mesoCapLiftShare: 0.25, mesoLiftMaxMs: 0.1, capLapseGapKPerM: 0.0078,
  // The moist layer's top (m above sea level) moves with the low-level air. Large-scale ascent
  // raises it and sinking lowers it (at the rate the outer model's cooling implies: about
  // ascentCoolingPerMetre K per m of lift in the mid troposphere); it settles back toward
  // moistLayerTopM over moistTopDays. Gulf air coming back soon after a front has scoured the
  // Gulf arrives only moistReturnShallowM deep.
  ascentCoolingPerMetre: 0.0033, moistTopDays: 2, moistReturnShallowM: 1300,
  // Ground wetted by storms' rain heats the air less and gives it moisture instead, until the
  // sun has dried it (wetGroundDryingDays of sunshine): wetGroundHeatingCut of the heating goes
  // into evaporation, adding up to wetGroundMoisteningGkgH g/kg an hour at full sun.
  wetGroundDryingDays: 1.5, wetGroundHeatingCut: 0.6, wetGroundMoisteningGkgH: 0.15,
  // How fast (hours) the moist layer itself is lost where the mixed layer has grown well past it:
  // its moisture is carried off by the stronger winds aloft. The air at the ground takes the
  // mixed-down moisture at once (the dryline's eastward surge by day); the layer goes more slowly,
  // so that after sunset, when the ground air is cut off from the mixing, what is left of it shows
  // at the ground again and the dryline falls back west.
  moistureErosionHours: 1,
  // Air entering across the western side has come down off the high ground, as the lid air has,
  // and is dry (2026-10-16; it took the moisture of its place in the geography, mostly the Gulf's,
  // and the dryline had no dry air behind it: it sat furthest east at dawn and furthest west at
  // noon; now it is furthest west around noon, east into the evening and back west overnight).
  westInflowDry: 1,
  // Entrainment (mixed-layer models; CLASS): the growing mixed layer draws down warmer air from
  // above it, adding this share of the surface heating to its own warming.
  entrainmentRatio: 0.2,
  // Ratio of the large-scale clock to the daily cycle (a tempo above 1 brings systems more often).
  tempo: 1,
  // Soundings and the indices built on them for every cell, every step. Costly; switch off
  // when only the fields are needed.
  diagnostics: true,
  stepSeconds: 1800,
  // Map edges: how far beyond the edge (cells) air entering keeps the edge's departure from the
  // outer model (see advect).
  edgeMemoryCells: 6
});

export class RegionalAtmosphere {
  // model: a spun-up QuasiGeostrophicModel. The map sits in the middle of its domain (the
  // weather is statistically the same everywhere in it).
  constructor(model, { startHourUtc = 12, ...options } = {}) {
    const p = this.params = { ...REGIONAL_DEFAULTS, ...options };
    this.model = model;
    this.hourUtc = startHourUtc;
    this.nx = p.columns; this.ny = p.rows; this.dx = p.cellKm * 1000;
    const centreY = model.lengthY / 2;
    this.origin = { x: model.lengthX / 2 - this.nx * this.dx / 2, y: centreY - this.ny * this.dx / 2 };
    this.world = new Atmosphere(this.nx, this.ny);
    const n = this.nx * this.ny;
    // Carried by the wind: low-level air-mass potential temperature (K), moist-layer mixing
    // ratio (g/kg) and the share of elevated mixed-layer air at 700 mb.
    this.theta = new Float64Array(n); this.moisture = new Float64Array(n); this.eml = new Float64Array(n);
    // Boundary layer: heat put in since sunrise (K m), evening temperature, departure of the
    // low-level wind from balance (m/s).
    this.heat = new Float64Array(n); this.eveningTheta = new Float64Array(n); this.mixedDepth = new Float64Array(n);
    this.nightTheta = new Float64Array(n);   // the night's surface potential temperature, which the sun must first make up (K)
    this.ageoU = new Float64Array(n); this.ageoV = new Float64Array(n); this.surfaceMixingRatio = new Float64Array(n);
    // Low-level pressure (hPa) and balanced wind (m/s) owed to the temperature of the air near
    // the ground; the day's heat left in the air after sunset.
    this.thermalHpa = new Float64Array(n); this.thermalU = new Float64Array(n); this.thermalV = new Float64Array(n);
    this.residualHeat = new Float64Array(n); this.mixedTheta = new Float64Array(n); this.eveningExcess = new Float64Array(n); this.eveningDepth = new Float64Array(n);
    this.coldPushU = new Float64Array(n); this.coldPushV = new Float64Array(n);   // m/s, east and north
    this.domeU = new Float64Array(n); this.domeV = new Float64Array(n);   // the part of the balanced wind owed to the weight of deep cold air (m/s)
    this.cyclone = new Float64Array(n);
    this.cloudLow = new Float64Array(n); this.cloudMid = new Float64Array(n); this.cloudHigh = new Float64Array(n);   // share of the sky (0-1)
    this.anvil = new Float64Array(n);   // storms' anvil cirrus (0-1), carried by the 250 mb wind   // pressure fall from cyclone development on the fronts (Pa, negative)
    this.domeDepth = new Float64Array(n); this.domeDeficit = new Float64Array(n); this.domeTopM = new Float64Array(n);   // cold air's depth (m) and how much colder than its column it is at the ground (K)
    this.coldPool = new Float64Array(n);   // how much colder than its air mass the air at the ground is (K)
    this.capLift = new Float64Array(n);    // extra cooling of the capping layer by large-scale ascent (K; warming negative)
    // Potential temperature of the elevated mixed layer (K), wherever its air is.
    this.lidTheta = new Float64Array(n).fill((p.reference700C + 6.5 + 273.15) * (1000 / 700) ** KAPPA);
    this.moistTop = new Float64Array(n).fill(p.moistLayerTopM);   // top of the moist layer (m above sea level)
    this.wetGround = new Float64Array(n);  // how wet storms' rain has left the ground (0-1)
    this.gulfSupply = p.gulfMixingRatio;   // mixing ratio of the air offshore now (g/kg)
    this.previousMid = null;
    // The region may slide east (+) or west along the outer model (m/s); see RegionSteering.
    this.slideMs = 0;
    // ...and north (+) or south (slideNorthMs). Only the weather overhead changes with it, not
    // the map's climate: the mean north-south fall of temperature and the 500 mb height reference
    // are taken about the map's own place (homeY is where it started).
    this.slideNorthMs = 0; this.homeY = this.origin.y;
    // A forecast run's timing error (ensemblePerturbation.js): its weather systems travel this
    // much faster (+) than the model has them (m/s), and how far ahead that has put them (m).
    // Always zero in the live world.
    this.timingErrorMs = 0; this.timingLeadM = 0;
    // Where the map sits along the geography now (cells east of its western edge), where it is
    // heading, and how fast it may move (cells per hour). See RegionSteering.
    this.geographyOffset = p.geographyOffset; this.geographyTarget = p.geographyOffset; this.geographyRate = 0; this.geographyVersion = 0;
    // Reference: the outer model's tropospheric temperature at the map centre, time-mean.
    this.referenceLayerK = model.params.f0 * model.meanThickness(centreY) / (RD * Math.log(3));
    this.world.forEachCell((cell, x, y) => {
      cell.terrain.elevationM = this.terrainAt(x);
      const k = y * this.nx + x, outer = this.outerAt(x, y);
      this.theta[k] = this.airMassTheta(outer, cell.terrain.elevationM);
      this.moisture[k] = this.inflowMoisture(x, y);
      this.eml[k] = ramp(cell.terrain.elevationM, p.emlSourceTerrainM - 300, p.emlSourceTerrainM);
      this.eveningTheta[k] = this.theta[k];
    });
    this.fill(0);
  }

  // Position (m) of a cell centre in the channel; rows count southward from the north edge.
  position(x, y) { return { x: this.origin.x + (x + 0.5) * this.dx, y: this.origin.y + (this.ny - 0.5 - y) * this.dx }; }
  outerAt(x, y) { const at = this.position(x, y); return this.outer(at.x, at.y); }

  // Outer-model fields at a point (bilinear in the channel grid; the weather repeats north-south,
  // so rows wrap).
  outer(xm, ym) {
    const m = this.model, gx = xm / m.d, gy = ym / m.d - 0.5, shift = this.origin.y - (this.homeY ?? this.origin.y);
    const i0 = Math.floor(gx), j0 = Math.floor(gy), tx = gx - i0, ty = gy - j0;
    const out = { upperU: 0, upperV: 0, lowerU: 0, lowerV: 0, layerK: 0, lowPsi: 0, midPsi: 0, ascentKh: 0, surfaceK: 0, surfaceQ: 0, north: ym - m.lengthY / 2 - shift };
    for (const [di, dj, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
      const f = m.fieldsAt(((i0 + di) % m.nx + m.nx) % m.nx, j0 + dj);
      // (The west winds without their mean: the mean is the map's own; see below.)
      out.upperU += w * (f.upperWind.u - f.upperMeanU); out.upperV += w * f.upperWind.v; out.lowerU += w * (f.lowerWind.u - f.lowerMeanU); out.lowerV += w * f.lowerWind.v;
      out.layerK += w * f.layerTemperatureK; out.lowPsi += w * f.lowerDisturbanceStreamfunction; out.midPsi += w * f.midStreamfunction; out.ascentKh += w * (f.ascentCoolingKh ?? 0); out.surfaceK += w * (f.surfaceThetaK ?? 0); out.surfaceQ += w * (f.surfaceMoistureGkg ?? 0);
    }
    // The mean state's fall of temperature and height northward is taken about the map's own
    // place, not the slide's (the map keeps its climate). Its west winds are where the map has
    // slid to: under the jet's core at home, and slacker on its flanks, so a day slid off the jet
    // has the weaker flow and shear of the flank, and one under a cut-off low the slack flow round
    // it. (2026-10-23: the winds were also taken at home until then, and every day had the core's
    // strong shear.) The ground-level pressure slope follows the same winds (meanGroundPsi, about
    // the map's middle).
    const q = m.params, home = ym - shift, [upperMean, lowerMean] = m.meanWinds(ym);
    out.layerK += q.f0 * (m.meanThickness(home) - m.meanThickness(ym)) / (RD * Math.log(3));
    out.midPsi += m.meanMidStreamfunction(home) - m.meanMidStreamfunction(ym);
    out.upperMeanU = upperMean; out.lowerMeanU = lowerMean; out.upperU += upperMean; out.lowerU += lowerMean;
    const ground = y => { const [s1, s2] = m.meanStreamfunction(y); return s2 - 0.5 * (s1 - s2); };
    out.meanGroundPsi = ground(ym) - ground(ym - out.north);
    return out;
  }

  // Balanced wind (m/s) at a pressure level. The mean flow is linear in pressure through the
  // two layers, less the part the mountains block below their crest. The weather systems are
  // linear in pressure between the layers; below the lower layer's level (750 mb) they keep
  // that layer's wind: the lower layer is the whole lower troposphere, and carrying its
  // systems further down along the shear would weaken them toward the ground, where real
  // lows and their winds are strongest.
  windAt(outer, pressure) {
    const s = (750 - pressure) / 500, between = Math.max(0, s), p = this.params;
    const mean = (outer.lowerMeanU + s * (outer.upperMeanU - outer.lowerMeanU)) * (1 - p.mountainBlocking * ramp(pressure, p.crestPressureHpa, 850));
    const lowerU = outer.lowerU - outer.lowerMeanU, upperU = outer.upperU - outer.upperMeanU;
    return { u: mean + lowerU + between * (upperU - lowerU), v: outer.lowerV + between * (outer.upperV - outer.lowerV) };
  }

  // Pressure pattern near the ground (hPa about the mean): the lower layer's systems, plus the
  // north-south slope that balances what is left of the mean wind at the ground (the mean state's
  // streamfunction carried down to the ground along the shear, about the map's middle; see outer).
  // The lower layer's pressure is that of about 750 mb; the air between there and the ground weighs
  // less where the layer is warmer than usual and more where colder (hydrostatic: about 1 hPa per K
  // over the 1000-750 mb column), so a high in warm air is weaker at the ground and one in cold air
  // stronger. (2026-10-23: the 750 mb pressure was taken to the ground as it was, and highs of
  // 1037-1043 hPa sat over 85-90 F air; on seed 31 the layer was 4.4 K warm under a +22 hPa high.)
  // Only the pressure: the winds keep the lower layer's (see windAt).
  balancedPressureHpa(outer) {
    const columnHpa = -this.params.groundColumnShare * 1013 * Math.log(1013 / 750) * (outer.layerK - this.referenceLayerK) / 285;
    return RHO_AIR * this.model.params.f0 * (outer.lowPsi + outer.meanGroundPsi * (1 - this.params.mountainBlocking)) / 100 + columnHpa;
  }

  // How far up the slope a place is (0 on the low plains, 1 at the western edge).
  plateau(terrain) { return ramp(terrain, this.params.terrainEastM, this.params.terrainWestM); }
  airMassTheta(outer, terrain) {
    const p = this.params, q = this.model.params;
    // The ground-level air about the middle of the map: its own anomaly and the mean fall northward.
    const anomaly = outer.surfaceK - (q.surfaceGradientKPer1000Km ?? 0) * outer.north / 1e6;
    return p.airMassThetaK + (anomaly > 0 ? p.surfaceWarmShare : 1) * anomaly + p.plateauWarmthK * this.plateau(terrain);
  }

  // Lee trough: westerly flow descending the high ground lowers the pressure along its foot,
  // most when the mid-level flow crosses it squarely. Returns the pressure change (hPa) and the
  // southerly balanced wind (m/s) it adds near the ground east of the trough axis
  // (v = dp/dx / (rho f)); the trough is shallow and is gone by 700 mb.
  // The lee trough over the map (hPa) and the balanced wind it adds near the ground (m/s, east
  // and north), worked out from its pressure as the other pressure patterns are.
  leeTroughField(outers) {
    const { nx, ny, dx } = this, f0 = this.model.params.f0, n = nx * ny;
    const pressure = this.leeHpa ??= new Float64Array(n), u = this.leeU ??= new Float64Array(n), v = this.leeV ??= new Float64Array(n);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) pressure[y * nx + x] = this.leeTrough(x, outers[y * nx + x]).pressureHpa;
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const k = y * nx + x, e = Math.min(nx - 1, x + 1), w = Math.max(0, x - 1), north = Math.max(0, y - 1), south = Math.min(ny - 1, y + 1);
      const eastward = (pressure[y * nx + e] - pressure[y * nx + w]) * 100 / ((e - w) * dx), northward = (pressure[north * nx + x] - pressure[south * nx + x]) * 100 / ((south - north) * dx);
      u[k] = -northward / (RHO_AIR * f0); v[k] = eastward / (RHO_AIR * f0);
    }
  }

  leeTrough(x, outer) {
    const p = this.params, width = p.leeTroughWidthKm * 1000;
    // The trough deepens with the flow across the high ground and levels off as it strengthens
    // (it was linear up to 2.5 times leeTroughFlowHpa, which gave lee troughs of up to 17 hPa
    // and a balanced southerly of over 40 kt beside them; real ones are a few hPa).
    const cross = Math.tanh(Math.max(0, this.windAt(outer, 700).u) / p.leeFlowMs);
    // The cyclogenesis is the lee trough's own low forming; where the outer model already has its low
    // overhead (its disturbance pressure leeCycloneOuterLowHpa below normal) that low is the cyclone,
    // and the gain fades so it is not counted twice. (2026-10-20: near a 986 hPa low the two together
    // gave 75-90 kt at 850 mb over the western high ground; 733 cell-hours over 70 kt on seed 4096.)
    const outerLowHpa = -RHO_AIR * this.model.params.f0 * (outer.lowPsi ?? 0) / 100;
    const gain = p.leeCycloneGain * (1 - ramp(outerLowHpa, p.leeCycloneOuterLowHpa[0], p.leeCycloneOuterLowHpa[1]));
    const depthHpa = p.leeTroughFlowHpa * cross * (1 + gain * clamp((outer.ascentKh ?? 0) / p.leeCycloneAscentKh, 0, 1));
    const distance = (x + this.geographyOffset - p.leeTroughColumn * ((p.geographyColumns ?? this.nx) - 1)) * this.dx, shape = Math.exp(-((distance / width) ** 2));
    return { pressureHpa: -depthHpa * shape, wind: depthHpa * 100 * shape * 2 * distance / (width * width) / (1.2 * this.model.params.f0) };
  }

  // Depth (m above ground) of the air that is already well mixed. It belongs to the air, not
  // the place: moist air is mixed through most of the moist layer, dry air through a layer
  // that is deep over the high ground (yesterday's mixed layer, the source of the cap).
  airMassDepth(terrain, k) {
    const p = this.params, moistLayer = clamp((this.moistTop?.[k] ?? p.moistLayerTopM) - terrain, 50, 3000);
    const moistShare = ramp(this.moisture[k], p.dryMixingRatio + 1, p.gulfMixingRatio - 3);
    return clamp(0.8 * moistLayer + (1 - moistShare) * (2800 - 0.8 * moistLayer) * this.plateau(terrain), 300, 3200);
  }

  // Mixing across fronts (see frontWidthKm), on the air-mass temperature with the high ground's
  // standing warmth taken out, in as many sub-steps as keep it stable.
  frontalMixing(windOf, dt) {
    const { nx, ny, dx } = this, p = this.params, n = nx * ny, L2 = (p.frontWidthKm * 1000) ** 2;
    const u = new Float64Array(n), v = new Float64Array(n), K = new Float64Array(n), terrainShare = new Float64Array(n);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { const w = windOf(x, y), k = y * nx + x; u[k] = w.u; v[k] = w.v; terrainShare[k] = p.plateauWarmthK * this.plateau(this.world.cells[y][x].terrain.elevationM); }
    let most = 0;
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const k = y * nx + x, e = y * nx + Math.min(nx - 1, x + 1), w = y * nx + Math.max(0, x - 1), no = Math.max(0, y - 1) * nx + x, so = Math.min(ny - 1, y + 1) * nx + x;
      const sx = (Math.min(nx - 1, x + 1) - Math.max(0, x - 1)) * dx, sy = (Math.min(ny - 1, y + 1) - Math.max(0, y - 1)) * dx;
      const ux = (u[e] - u[w]) / sx, vx = (v[e] - v[w]) / sx, uy = (u[no] - u[so]) / sy, vy = (v[no] - v[so]) / sy;   // y northward
      // (At most frontDeformationS, the strongest that real fronts are squeezed by; more at this
      // grid is noise across a single cell.)
      const deformation = Math.min(p.frontDeformationS, Math.hypot(ux - vy, vx + uy) + Math.max(0, -(ux + vy)));
      K[k] = deformation * L2; most = Math.max(most, K[k]);
    }
    const steps = Math.max(1, Math.ceil(most * dt / (dx * dx) / 0.2)), h = dt / steps / (dx * dx), air = new Float64Array(n);
    for (let k = 0; k < n; k++) air[k] = this.theta[k] - terrainShare[k];
    for (let step = 0; step < steps; step++) {
      const next = new Float64Array(n);
      for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        const k = y * nx + x; let change = 0;
        for (const j of [x > 0 ? k - 1 : -1, x < nx - 1 ? k + 1 : -1, y > 0 ? k - nx : -1, y < ny - 1 ? k + nx : -1]) if (j >= 0) change += 0.5 * (K[k] + K[j]) * (air[j] - air[k]);
        next[k] = air[k] + h * change;
      }
      air.set(next);
    }
    for (let k = 0; k < n; k++) this.theta[k] = air[k] + terrainShare[k];
  }

  // Cyclone development on the fronts (see cycloneGainHpa): moved by the steering wind, filled,
  // and deepened where ascent meets a baroclinic zone.
  cycloneDevelopment(outers, dt) {
    if (!(dt > 0)) return;
    const { nx, ny, dx } = this, p = this.params, n = nx * ny;
    this.advect(this.cyclone, (x, y) => { const w = this.windAt(outers[y * nx + x], 700); return { u: p.cycloneSteeringShare * w.u, v: p.cycloneSteeringShare * w.v }; }, () => 0, dt, () => false);
    const air = new Float64Array(n);
    this.world.forEachCell((cell, x, y) => { air[y * nx + x] = this.theta[y * nx + x] - p.plateauWarmthK * this.plateau(cell.terrain.elevationM); });
    const fill = Math.exp(-dt / (p.cycloneFillHours * 3600));
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const k = y * nx + x, e = y * nx + Math.min(nx - 1, x + 1), w = y * nx + Math.max(0, x - 1), no = Math.max(0, y - 1) * nx + x, so = Math.min(ny - 1, y + 1) * nx + x;
      const gradient = Math.hypot((air[e] - air[w]) / ((Math.min(nx - 1, x + 1) - Math.max(0, x - 1)) * dx), (air[no] - air[so]) / ((Math.min(ny - 1, y + 1) - Math.max(0, y - 1)) * dx)) * 1e5;
      const front = ramp(gradient, p.cycloneFrontK100[0], p.cycloneFrontK100[1]);
      this.cyclone[k] = this.cyclone[k] * fill - p.cycloneGainHpa * 100 * Math.max(0, outers[k].ascentKh ?? 0) * front * dt / 3600;
    }
  }

  // The column's own low-level potential temperature (what the outer model's layer holds, with
  // the high ground's standing warmth): air colder than this is a cold air mass.
  heldTheta(outer, terrain) { const p = this.params; return p.airMassThetaK + (outer.layerK - this.referenceLayerK) + p.plateauWarmthK * this.plateau(terrain); }

  // The cold air's depth from its distance behind the warmer air (see domeSlope). Distances by a
  // two-pass chamfer transform from the cells of warmer air; with no warmer air on the map the
  // cold air is as deep as its coldness allows.
  coldDome(outers) {
    const { nx, ny, dx } = this, p = this.params, n = nx * ny, far = 1e12, distance = new Float64Array(n);
    this.world.forEachCell((cell, x, y) => {
      const k = y * nx + x, deficit = Math.max(0, this.heldTheta(outers[k], cell.terrain.elevationM) - this.theta[k]);
      this.domeDeficit[k] = deficit; distance[k] = deficit <= p.domeWarmK ? 0 : far;
    });
    const diag = Math.SQRT2 * dx, relax = (k, j, step) => { if (distance[j] + step < distance[k]) distance[k] = distance[j] + step; };
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { const k = y * nx + x; if (x > 0) relax(k, k - 1, dx); if (y > 0) { relax(k, k - nx, dx); if (x > 0) relax(k, k - nx - 1, diag); if (x < nx - 1) relax(k, k - nx + 1, diag); } }
    for (let y = ny - 1; y >= 0; y--) for (let x = nx - 1; x >= 0; x--) { const k = y * nx + x; if (x < nx - 1) relax(k, k + 1, dx); if (y < ny - 1) { relax(k, k + nx, dx); if (x < nx - 1) relax(k, k + nx + 1, diag); if (x > 0) relax(k, k + nx - 1, diag); } }
    // (No deeper than the 750 mb level: from there up the outer model's layer holds the temperature, and
    // the column below it is counted in the ground pressure already (balancedPressureHpa). 2026-10-24:
    // up to domeMaxM, 4.5 km, and air 15 K below a layer of normal warmth weighed as a 4.3 km dome, its
    // high 8-12 hPa too strong in the map's cool corners.)
    const below750 = 8434.5 * Math.log(1013 / 750);
    this.world.forEachCell((cell, x, y) => { const k = y * nx + x; this.domeTopM[k] = Math.max(p.domeMinM, Math.min(p.domeMaxM, below750 - cell.terrain.elevationM)); });
    for (let k = 0; k < n; k++) this.domeDepth[k] = this.domeDeficit[k] > p.domeWarmK ? clamp(Math.min(p.domeSlope * distance[k], this.domeDeficit[k] / p.domeDeficitKPerM), p.domeMinM, this.domeTopM[k]) : 0;
  }

  // Hydrostatic balance near the ground: a column of warm low-level air weighs less, so the
  // surface pressure under it is lower, and the balanced wind blows with that low pressure on
  // its left. Only temperature the outer model does not hold is counted, so nothing is counted
  // twice: the standing heat of the high ground and the heating of the day. The pressure
  // responds over the distance set by the depth of that air (its deformation radius, about
  // 200 km), not cell by cell.
  thermalBalance(outers) {
    const { nx, ny, dx } = this, p = this.params, n = nx * ny, f0 = this.model.params.f0;
    let pressure = new Float64Array(n), airMass = new Float64Array(n), deep = new Float64Array(n);
    this.world.forEachCell((cell, x, y) => {
      const k = y * nx + x, terrain = cell.terrain.elevationM;
      const column = p.plateauWarmthK * this.plateau(terrain) * Math.min(this.airMassDepth(terrain, k), Math.max(600, 3050 - terrain)) + Math.max(this.heat[k], this.residualHeat[k]);   // K m
      pressure[k] = -RHO_AIR * GRAVITY * column / this.theta[k];   // Pa
      // The low-level air masses (fronts) differ from the temperature the outer model's pressure
      // already holds (its 250-750 mb layer); the cold side is heavier, so the pressure rises
      // behind a front and the front lies in a trough.
      // Cold air weighs by its wedge (half its depth times its deficit; see coldDome), warmer air
      // by the shallow layer airMassPressureDepthM.
      const layerHeld = this.heldTheta(outers[k], terrain), departure = this.theta[k] - layerHeld;
      // The shallow part follows the front closely; the weight of a deep dome beyond it adjusts
      // over that depth's deformation radius (about 200 km), as the heating's does.
      airMass[k] = -RHO_AIR * GRAVITY * p.airMassPressureDepthM * departure / this.theta[k];
      if (departure < 0 && this.domeDepth[k] > 0) deep[k] = -RHO_AIR * GRAVITY * Math.max(0, 0.5 * this.domeDepth[k] - p.airMassPressureDepthM) * departure / this.theta[k];
    });
    const smooth = (field, r) => {
      for (let pass = 0; pass < 2 && r > 0; pass++) {
        const out = new Float64Array(n);
        for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
          let sum = 0, count = 0;
          for (let yy = Math.max(0, y - r); yy <= Math.min(ny - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(nx - 1, x + r); xx++) { sum += field[yy * nx + xx]; count++; }
          out[y * nx + x] = sum / count;
        }
        field = out;
      }
      return field;
    };
    pressure = smooth(pressure, p.thermalSmoothingCells);
    airMass = smooth(airMass, p.airMassPressureSmoothingCells);
    deep = smooth(deep, p.thermalSmoothingCells);
    const cyclone = smooth(this.cyclone, p.cycloneSmoothingCells);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const k = y * nx + x, e = Math.min(nx - 1, x + 1), w = Math.max(0, x - 1), north = Math.max(0, y - 1), south = Math.min(ny - 1, y + 1);
      this.domeU[k] = -(deep[north * nx + x] - deep[south * nx + x]) / ((south - north) * dx) / (RHO_AIR * f0); this.domeV[k] = (deep[y * nx + e] - deep[y * nx + w]) / ((e - w) * dx) / (RHO_AIR * f0);
    }
    for (let k = 0; k < n; k++) pressure[k] += airMass[k] + deep[k] + cyclone[k];
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const k = y * nx + x, e = Math.min(nx - 1, x + 1), w = Math.max(0, x - 1), north = Math.max(0, y - 1), south = Math.min(ny - 1, y + 1);
      const eastward = (pressure[y * nx + e] - pressure[y * nx + w]) / ((e - w) * dx), northward = (pressure[north * nx + x] - pressure[south * nx + x]) / ((south - north) * dx);
      this.thermalHpa[k] = pressure[k] / 100; this.thermalU[k] = -northward / (RHO_AIR * f0); this.thermalV[k] = eastward / (RHO_AIR * f0);
    }
  }

  // A storm's anvil: cirrus within radiusKm of (xKm, yKm), as thick as share (0-1) at its middle.
  addAnvil(xKm, yKm, radiusKm, share) {
    const cellKm = this.dx / 1000, cx = xKm / cellKm - 0.5, cy = yKm / cellKm - 0.5, reach = Math.ceil(radiusKm / cellKm);
    for (let y = Math.max(0, Math.floor(cy - reach)); y <= Math.min(this.ny - 1, Math.ceil(cy + reach)); y++) for (let x = Math.max(0, Math.floor(cx - reach)); x <= Math.min(this.nx - 1, Math.ceil(cx + reach)); x++) {
      const d = Math.hypot(x - cx, y - cy) * cellKm; if (d > radiusKm) continue;
      const k = y * this.nx + x; this.anvil[k] = Math.max(this.anvil[k], share * (1 - 0.5 * d / radiusKm));
    }
  }

  // A storm's rain-cooled air: at least deficitK colder at (xKm, yKm), fading over radiusKm.
  // From then on it is the atmosphere's own: it is carried by the wind, spreads under the
  // warmer air around it like any cold air here, and warms back up over some hours.
  addColdPool(xKm, yKm, radiusKm, deficitK) {
    const cellKm = this.dx / 1000, cx = xKm / cellKm - 0.5, cy = yKm / cellKm - 0.5, reach = Math.ceil(2 * radiusKm / cellKm);
    for (let y = Math.max(0, Math.floor(cy - reach)); y <= Math.min(this.ny - 1, Math.ceil(cy + reach)); y++) for (let x = Math.max(0, Math.floor(cx - reach)); x <= Math.min(this.nx - 1, Math.ceil(cx + reach)); x++) {
      const value = deficitK * Math.exp(-((Math.hypot(x - cx, y - cy) * cellKm / radiusKm) ** 2)), k = y * this.nx + x;
      if (value > this.coldPool[k]) this.coldPool[k] = value;
      // Where the rain-cooled air is, the rain has wetted the ground.
      this.wetGround[k] = Math.max(this.wetGround[k], clamp(value / 8, 0, 1));
    }
  }

  // Flow of cold air toward the warmer air beside it (see coldPushFactor). Works on the
  // air-mass temperature with the standing warmth of the high ground taken out, so the slope
  // of the terrain is not mistaken for a front.
  coldPush() {
    const { nx, ny, dx } = this, p = this.params, n = nx * ny, reach = p.coldPushReachCells;
    const air = new Float64Array(n);
    this.world.forEachCell((cell, x, y) => { air[y * nx + x] = this.theta[y * nx + x] - p.plateauWarmthK * this.plateau(cell.terrain.elevationM) - this.coldPool[y * nx + x]; });
    // Warmest air within reach, in two sweeps (rows, then columns).
    const rowMax = new Float64Array(n), warmest = new Float64Array(n);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { let m = -Infinity; for (let xx = Math.max(0, x - reach); xx <= Math.min(nx - 1, x + reach); xx++) m = Math.max(m, air[y * nx + xx]); rowMax[y * nx + x] = m; }
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { let m = -Infinity; for (let yy = Math.max(0, y - reach); yy <= Math.min(ny - 1, y + reach); yy++) m = Math.max(m, rowMax[yy * nx + x]); warmest[y * nx + x] = m; }
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const k = y * nx + x, e = Math.min(nx - 1, x + 1), w = Math.max(0, x - 1), north = Math.max(0, y - 1), south = Math.min(ny - 1, y + 1);
      const gx = (air[y * nx + e] - air[y * nx + w]) / ((e - w) * dx), gy = (air[north * nx + x] - air[south * nx + x]) / ((south - north) * dx), size = Math.hypot(gx, gy);
      // No push where the air is the same all around (deep inside an air mass).
      const speed = p.coldPushFactor * Math.sqrt(GRAVITY * p.coldAirDepthM * Math.max(0, warmest[k] - air[k]) / this.theta[k]) * ramp(size * 1e5, p.coldPushGradient[0], p.coldPushGradient[1]);
      this.coldPushU[k] = size > 0 ? speed * gx / size : 0; this.coldPushV[k] = size > 0 ? speed * gy / size : 0;
    }
  }

  // How far east a column is across the geography (0 at its western edge, 1 at its eastern, and 1 beyond).
  eastShare(x) { const p = this.params; return clamp((x + this.geographyOffset) / ((p.geographyColumns ?? this.nx) - 1), 0, 1); }
  terrainAt(x) { const p = this.params; return p.terrainEastM + (p.terrainWestM - p.terrainEastM) * (1 - this.eastShare(x)) ** p.terrainShape; }
  // Moves the map along the geography toward its target, at most geographyRate cells per hour.
  // The air, the storms and their cold pools stay where they are on the map; the ground under
  // them changes by a few miles an hour, and the dryline and the lee trough follow it.
  driftGeography(dt) {
    const gap = this.geographyTarget - this.geographyOffset;
    if (!gap || !(this.geographyRate > 0)) return;
    const move = Math.min(Math.abs(gap), this.geographyRate * dt / 3600);
    this.geographyOffset += Math.sign(gap) * move;
    this.world.forEachCell((cell, x) => { cell.terrain.elevationM = this.terrainAt(x); });
    this.geographyVersion++;
  }

  // The Gulf's air (g/kg) for the outer model's air near the ground at a place: gulfMixingRatio
  // plus the outer model's moisture anomaly there (about the map's own place, as the temperature),
  // and a forecast run's own error in it (ensemblePerturbation.js; 0 in the live world).
  gulfAir(outer) {
    const p = this.params, q = this.model.params;
    // (The mean falls northward, as the outer model carries it: minus. Until 2026-10-19 it was
    // added, so the Gulf's air grew moister northward; the row weighting in inflowMoisture hid it.)
    // Measured from the coast, gulfCoastSouthKm south of the map's middle.
    const anomaly = outer.surfaceQ - ((q.surfaceMoistureGradientGkgPer1000Km ?? 0) + p.gulfNorthwardFallGkgPer1000Km) * (outer.north + p.gulfCoastSouthKm * 1000) / 1e6;
    return clamp(p.gulfMixingRatio + anomaly + (this.gulfMoistureErrorGkg ?? 0), p.dryMixingRatio, p.gulfMixingRatio + p.gulfMoistMoreGkg);
  }

  // Moisture of the air entering the map: Gulf air along the south-eastern side, continental
  // air to the north, dry air off the high ground to the west. It is also what the air on the map
  // is drawn toward over airMassRelaxationDays, as its temperature is (2026-10-16; until then the
  // air was only ever dried, toward continentalHumidity of what its temperature allows, and Gulf
  // air in a warm sector at 16 g/kg was drawn toward about 9).
  inflowMoisture(x, y, outer = this.outerAt(x, y)) {
    // The Gulf's share is by how far east (off the high ground) a place is; how its air thins
    // northward is the outer model's own (gulfAir: its surface moisture and that field's
    // north-south fall). 2026-10-19: it also fell from all to 0.45 by the map's row, which counted
    // the northward fall twice and kept the most moisture and CAPE on the map's southern row.
    const p = this.params, east = this.eastShare(x);
    const gulf = ramp(east, 0.1, 0.4);
    // Continental air holds the moisture its temperature allows (continentalHumidity of
    // saturation, at most continentalMixingRatio): air from the cold north is dry because it is
    // cold, which is the dryness behind a cold front.
    const continental = Math.min(p.continentalMixingRatio, this.continentalMoisture(outer, this.terrainAt(x)));
    return p.dryMixingRatio + (continental - p.dryMixingRatio) * ramp(east, 0.05, 0.3) + (Math.max(continental, this.gulfAir(outer)) - continental) * gulf;
  }

  // Moisture (g/kg) continental air of the air mass the outer model has here can hold at
  // continentalHumidity.
  continentalMoisture(outer, terrain) {
    const pressure = 1000 * Math.exp(-terrain / 8434.5), temperatureC = this.airMassTheta(outer, terrain) * (pressure / 1000) ** KAPPA - 273.15;
    const vapour = 6.112 * Math.exp(17.67 * temperatureC / (temperatureC + 243.5));
    return this.params.continentalHumidity * 622 * vapour / (pressure - vapour);
  }

  // Semi-Lagrangian transport by the low-level (or given) wind; air entering takes the
  // properties of its source. The value at the departure point is read with cubic
  // interpolation held within the four nearest values (quasi-monotone, Bermejo and Staniforth
  // 1992). Linear interpolation spreads an edge by a cell or more a day wherever the wind is
  // slow across it, which is exactly at fronts and the dryline.
  //
  // Air entering across the map's edge comes from where the outer model is all that is known.
  // It keeps the departure from that (inflowOf) the air at the edge has, fading over
  // edgeMemoryCells of its way in from beyond, as a limited-area model's boundary zone relaxes
  // toward its driving model; where keeps(sx, sy) is false what enters is inflowOf's alone (a
  // source such as the plateau's lid air). 2026-10-19: until then the edge row took inflowOf's
  // value every step, so the regional air masses, fronts and rain-cooled air stopped one cell
  // short of the edge and the edge rows jumped up to 40-50 F from their neighbours.
  advect(field, windOf, inflowOf, dt, keeps = () => true) {
    const { nx, ny, dx } = this, out = new Float64Array(field.length), memory = this.params.edgeMemoryCells;
    const at = (i, j) => field[clamp(j, 0, ny - 1) * nx + clamp(i, 0, nx - 1)];
    const cubic = (a, b, c, d, t) => b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const w = windOf(x, y), sx = x - w.u * dt / dx, sy = y + w.v * dt / dx;   // rows count southward
      if (sx < 0 || sy < 0 || sx > nx - 1 || sy > ny - 1) {
        const ex = clamp(Math.round(sx), 0, nx - 1), ey = clamp(Math.round(sy), 0, ny - 1), inflow = inflowOf(ex, ey, x, y);
        const beyond = Math.max(-sx, sx - (nx - 1), -sy, sy - (ny - 1));
        out[y * nx + x] = keeps(ex, ey) ? inflow + (field[ey * nx + ex] - inflow) * Math.exp(-beyond / memory) : inflow;
        continue;
      }
      const x0 = Math.min(nx - 2, Math.floor(sx)), y0 = Math.min(ny - 2, Math.floor(sy)), tx = sx - x0, ty = sy - y0;
      const rows = [-1, 0, 1, 2].map(j => cubic(at(x0 - 1, y0 + j), at(x0, y0 + j), at(x0 + 1, y0 + j), at(x0 + 2, y0 + j), tx));
      const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      out[y * nx + x] = clamp(cubic(rows[0], rows[1], rows[2], rows[3], ty), Math.min(a, b, c, d), Math.max(a, b, c, d));
    }
    field.set(out);
  }

  // Heating of the air by the ground (0-1 of its early-afternoon peak) at a local solar hour:
  // it turns positive a while after sunrise and negative again before sunset.
  sunshine(localHour) { const p = this.params, start = p.sunriseLocal + p.heatingLagHours, end = p.sunsetLocal - p.heatingLagHours; return Math.max(0, Math.sin(Math.PI * (localHour - start) / (end - start))); }

  step() {
    const p = this.params, dt = p.stepSeconds;
    this.driftGeography(dt);
    if (this.slideMs || this.slideNorthMs || this.timingErrorMs) {
      // Slide first, then read the heights at the new place before the model moves on, so
      // that their change over the step is the passing weather and not the slide itself.
      const length = this.model.lengthX;
      // Systems running ahead of the model are the same as reading the model further back.
      this.origin.x = ((this.origin.x + (this.slideMs - this.timingErrorMs) * dt) % length + length) % length;
      this.origin.y += this.slideNorthMs * dt;
      this.timingLeadM += this.timingErrorMs * dt;
      const mid = this.previousMid ??= new Float64Array(this.nx * this.ny);
      for (let y = 0; y < this.ny; y++) for (let x = 0; x < this.nx; x++) mid[y * this.nx + x] = this.outerAt(x, y).midPsi;
    }
    this.model.advance(dt * p.tempo);
    this.hourUtc += dt / 3600;
    this.fill(dt);
  }

  // Advances the regional processes by dt seconds and writes every cell.
  fill(dt) {
    const p = this.params, { nx, ny } = this, world = this.world, f0 = this.model.params.f0;
    const localHour = (((this.hourUtc + p.utcOffsetHours) % 24) + 24) % 24;
    const sun = this.sunshine(localHour), daytime = sun > 0;
    const outers = new Array(nx * ny);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) outers[y * nx + x] = this.outerAt(x, y);

    this.coldDome(outers);
    this.cycloneDevelopment(outers, dt);
    this.thermalBalance(outers);
    this.leeTroughField(outers);
    this.coldPush();
    if (dt > 0) {
      // Air masses move with the low-level wind, the elevated mixed layer with the 700 mb wind.
      const inflowCos = Math.cos(p.airMassInflowDeg * Math.PI / 180), inflowSin = Math.sin(p.airMassInflowDeg * Math.PI / 180);
      const lowWind = (x, y) => {
        const k = y * nx + x, w = this.windAt(outers[k], 900), mixed = daytime ? this.momentumMixing(this.mixedDepth[k]) : 0, aloft = this.windAt(outers[k], 700);
        // Friction in the layer turns the balanced wind toward low pressure, so the air runs
        // into troughs, fronts among them, and draws their air masses together.
        const bu = w.u + 0.85 * (this.thermalU[k] + this.leeU[k]), bv = w.v + 0.85 * (this.thermalV[k] + this.leeV[k]);
        const u = bu * inflowCos - bv * inflowSin + this.ageoU[k], v = bu * inflowSin + bv * inflowCos + this.ageoV[k];
        return { u: u + mixed * (aloft.u - u) + this.coldPushU[k], v: v + mixed * (aloft.v - v) + this.coldPushV[k] };
      };
      const midWind = (x, y) => this.windAt(outers[y * nx + x], 700);
      if (p.carryDeparture) {
        // The map's air is the large-scale air where the map now is, plus its own departure from it
        // (fronts it has sharpened, storms' cooled air, the day's heating), which moves with the
        // map's wind. (2026-10-23: the map's air was moved whole, and on a sliding day it caught up
        // with the large-scale air beneath only over airMassRelaxationDays: 4 K behind on average,
        // read as cold domes under 1036-1046 hPa highs in 85 F air. Moving the large-scale air as
        // well, by the map's wind less the lower layer's, put it 5.7 K behind: the two winds differ
        // steadily. docs/FIX-PLAN-2026-10-22.md, "Regional pressure: the slide lag".)
        const target = new Float64Array(nx * ny), was = this.lastTarget;
        for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) target[y * nx + x] = this.airMassTheta(outers[y * nx + x], world.cells[y][x].terrain.elevationM);
        for (let k = 0; k < nx * ny; k++) this.theta[k] -= was ? was[k] : target[k];
        this.advect(this.theta, lowWind, () => 0, dt);
        for (let k = 0; k < nx * ny; k++) this.theta[k] += target[k];
        this.lastTarget = target;
      } else this.advect(this.theta, lowWind, (sx, sy) => this.airMassTheta(outers[sy * nx + sx], world.cells[sy][sx].terrain.elevationM), dt);
      this.frontalMixing(lowWind, dt);
      // The Gulf's air along the map's south-eastern edge (it sets how deep the moisture coming back is).
      let gulf = 0, count = 0;
      for (let x = Math.floor(0.4 * nx); x < nx; x += 2) { gulf += this.gulfAir(outers[(ny - 1) * nx + x]); count++; }
      this.gulfSupply = gulf / count;
      this.advect(this.moisture, lowWind, (sx, sy) => (p.westInflowDry && sx === 0 ? Math.min(p.dryMixingRatio + 1, this.inflowMoisture(sx, sy, outers[sy * nx + sx])) : this.inflowMoisture(sx, sy, outers[sy * nx + sx])), dt, sx => !(p.westInflowDry && sx === 0));
      this.advect(this.coldPool, lowWind, () => 0, dt);
      this.advect(this.capLift, midWind, () => 0, dt);
      this.advect(this.anvil, (x, y) => this.windAt(outers[y * nx + x], 250), () => 0, dt, () => false);
      const thin = Math.exp(-dt / (p.anvilHours * 3600));
      for (let k = 0; k < this.anvil.length; k++) this.anvil[k] *= thin;
      // The moist layer's depth goes with its air; air entering from the Gulf side is shallow
      // while the Gulf is still recovering from a front.
      const returnTop = p.moistReturnShallowM + (p.moistLayerTopM - p.moistReturnShallowM) * ramp(this.gulfSupply, p.gulfScouredMixingRatio, p.gulfMixingRatio - 1);
      this.advect(this.moistTop, lowWind, (sx, sy) => (this.eastShare(sx) > 0.3 ? returnTop : p.moistLayerTopM), dt);
      // Lid air entering across the western side (and the western half of the southern side) has
      // come off the plateau beyond the map, so it is all lid air, as hot as its source; elsewhere
      // what enters is what the edge itself holds. (Until 2026-10-16 the share came from the edge
      // cell's own terrain, about 1,050 m: the lid never covered more than 0.6-0.7 of the moist
      // air, 700 mb stayed near 9 C and the cap was gone by 21Z almost everywhere.)
      const offPlateau = (sx, sy) => sx === 0 || (sy === ny - 1 && this.eastShare(sx) < 0.5);
      this.advect(this.eml, midWind, (sx, sy) => (offPlateau(sx, sy) ? 1 : ramp(world.cells[sy][sx].terrain.elevationM, p.emlSourceTerrainM - 300, p.emlSourceTerrainM)), dt, (sx, sy) => !offPlateau(sx, sy));
      this.advect(this.lidTheta, midWind, (sx, sy) => (offPlateau(sx, sy) ? p.lidSourceThetaK + p.temperatureShare[700] * (outers[sy * nx + sx].layerK - this.referenceLayerK) : this.lidTheta[sy * nx + sx]), dt, (sx, sy) => !offPlateau(sx, sy));
    }

    world.validHourUtc = this.hourUtc;
    world.forEachCell((cell, x, y) => {
      const k = y * nx + x, outer = outers[k], terrain = cell.terrain.elevationM;
      // The wind just above the ground (balanced wind near 900 mb with the departure of the
      // night-time jet): what stirs the air near the ground.
      const g900 = this.windAt(outer, 900), stir = Math.hypot(g900.u + this.thermalU[k] + this.leeU[k] + this.ageoU[k], g900.v + this.thermalV[k] + this.leeV[k] + this.ageoV[k]);
      // The sun that gets through the last step's cloud, and the share of the night's cooling the cloud lets through.
      const hc = p.heatingCloudCut, cc = p.coolingCloudCut;
      const sunHere = sun * clamp(1 - hc.low * this.cloudLow[k] - hc.mid * this.cloudMid[k] - hc.high * this.cloudHigh[k], 0.15, 1);
      const clearNight = clamp(1 - cc.low * this.cloudLow[k] - cc.mid * this.cloudMid[k] - cc.high * this.cloudHigh[k], 0.1, 1);
      if (dt > 0) {
        // The air mass stays tied to the air near the ground in the outer model over a couple of
        // days: its temperature, and its moisture (the air coming in here would have; see
        // inflowMoisture): moist where the large-scale flow has brought the Gulf's air, dry where
        // a front has swept it away or the air came from a cold land.
        const relax = clamp(dt / (p.airMassRelaxationDays * DAY), 0, 1);
        this.theta[k] += (this.airMassTheta(outer, terrain) - this.theta[k]) * relax;
        this.moisture[k] += (this.inflowMoisture(x, y, outer) - this.moisture[k]) * relax;
        this.eml[k] *= Math.exp(-dt / (p.emlLifetimeDays * DAY));
        this.lidTheta[k] -= p.lidCoolingKPerDay * dt / DAY;
        if (daytime) {
          // The sun warms the rain-cooled layer at the rate the ground heats the air there (less over
          // wet ground), through its depth: a 4 K pool 800 m deep goes in about five hours of full
          // sun, a deeper or colder one takes longer. (2026-10-16; it faded over 3 hours whatever
          // its size, and outflow boundaries lasted 1.5 hours.)
          const dryHere = 1 - ramp(this.surfaceMixingRatio[k] || this.moisture[k], p.dryMixingRatio + 1, p.gulfMixingRatio - 3);
          const heating = (p.heatingMoistWm2 + (p.heatingDryWm2 - p.heatingMoistWm2) * dryHere) * (1 - p.wetGroundHeatingCut * this.wetGround[k]) * sunHere;
          this.coldPool[k] = Math.max(0, this.coldPool[k] - heating * dt / (RHO_AIR * 1005 * p.coldPoolDepthM));
        } else this.coldPool[k] *= Math.exp(-dt / 3600 / p.coldPoolRecoveryHoursNight);
        this.coldPool[k] *= Math.exp(-stir * dt / (p.coldPoolMixingKm * 1000));
        if (this.coldPool[k] < p.coldPoolLeastK) this.coldPool[k] = 0;
        const mesoLift = Math.min(p.mesoLiftMaxMs, Math.max(0, Number(cell.features?.isentropicLiftMs) || 0) + Math.max(0, Number(cell.features?.jetConvergenceLiftMs) || 0));
        this.capLift[k] = this.capLift[k] * Math.exp(-dt / (p.capLiftHours * 3600)) + (p.capLiftRatio - 1) * outer.ascentKh * dt / 3600 + p.mesoCapLiftShare * mesoLift * p.capLapseGapKPerM * dt;
        const liftMs = outer.ascentKh / 3600 / p.ascentCoolingPerMetre;
        this.moistTop[k] = clamp(this.moistTop[k] + liftMs * dt + (p.moistLayerTopM - this.moistTop[k]) * clamp(dt / (p.moistTopDays * DAY), 0, 1), 600, 3500);
      }
      const leePressureHpa = this.leeHpa[k], leeU = this.leeU[k], leeV = this.leeV[k];
      // Rain-cooled air is heavier: the pressure under it is higher (the storm's mesohigh).
      const coldPoolHpa = RHO_AIR * GRAVITY * p.coldPoolDepthM * this.coldPool[k] / this.theta[k] / 100;
      const surfacePressure = (1013 + leePressureHpa + this.thermalHpa[k] + coldPoolHpa + this.balancedPressureHpa(outer)) * Math.exp(-terrain / 8434.5);
      const seaLevelPressure = surfacePressure / Math.exp(-terrain / 8434.5);
      const anomaly = outer.layerK - this.referenceLayerK;
      // 700 mb: the ordinary troposphere, or the lid where its air is and is warmer; then what
      // large-scale ascent or sinking has done to the capping layer.
      const ordinary700 = p.reference700C + p.temperatureShare[700] * anomaly, lid700 = this.lidTheta[k] * 0.7 ** KAPPA - 273.15;
      // The cold dome: its coldness fades to none at its top, and the lid's air rides up over it.
      const dome = this.domeDepth[k], z700 = Math.max(600, 3050 - terrain), coldAt = z => (dome > 0 ? this.domeDeficit[k] * Math.max(0, 1 - z / dome) : 0);
      const lidHere = this.eml[k] * (1 - ramp(dome, z700 - 500, z700 + 500));
      const t700 = ordinary700 + lidHere * Math.max(0, lid700 - ordinary700) - this.capLift[k] - coldAt(z700) * 0.7 ** KAPPA;
      const adiabat500 = (t700 + 273.15) * (500 / 700) ** KAPPA - 273.15, ordinary500 = p.reference500C + p.temperatureShare[500] * anomaly;
      const t500 = ordinary500 + Math.min(0, adiabat500 - ordinary500) * p.emlLapseShare * this.eml[k], t250 = softMax(p.reference250C + p.temperatureShare[250] * anomaly, p.tropopauseC, 2);
      const theta700 = (t700 + 273.15) * (1000 / 700) ** KAPPA;

      // --- Boundary layer. The sun heats a mixed layer that first erodes the night's inversion,
      // then deepens through the air mass (potential temperature theta) and into the stable
      // air beneath 700 mb. Depths are above ground.
      // Convective adjustment: air near the ground left potentially warmer than the air at 700 mb
      // (cold air arriving aloft over a warm night, as behind a deep low) overturns and mixes down
      // toward it within about adjustHours. (2026-10-20: nothing tied the two, since 700 mb is the
      // outer model's; behind a 986 hPa low 700 mb fell to -5 C over a 25 C surface and the 850-700
      // mb layer was left at about 13 C/km.)
      if (dt > 0 && this.theta[k] > theta700 + p.adjustMarginK) this.theta[k] += (theta700 + p.adjustMarginK - this.theta[k]) * clamp(dt / (p.adjustHours * 3600), 0, 1);
      const airTheta = this.theta[k], height700 = Math.max(600, 3050 - terrain);
      const moistLayer = clamp(this.moistTop[k] - terrain, 50, 3000), airMassDepth = this.airMassDepth(terrain, k);
      const lapseAbove = Math.max(0.0015, Math.max(0.5, theta700 - airTheta) / Math.max(300, height700 - airMassDepth));   // K per m above it
      // How dry the air at the ground was a step ago: dry air over dry ground is heated harder,
      // mixes deeper and dries further, which is what sharpens the dryline.
      const dryness = 1 - ramp(this.surfaceMixingRatio[k] || this.moisture[k], p.dryMixingRatio + 1, p.gulfMixingRatio - 3);
      if (dt > 0) {
        // Wet ground puts part of the sun's energy into evaporation instead of heating the air.
        const wet = this.wetGround[k];
        if (daytime) {
          this.heat[k] += (p.heatingMoistWm2 + (p.heatingDryWm2 - p.heatingMoistWm2) * dryness) * (1 - p.wetGroundHeatingCut * wet) * sunHere / 1200 * dt;
          this.moisture[k] += p.wetGroundMoisteningGkgH * wet * sunHere * dt / 3600;
          this.wetGround[k] = wet * Math.exp(-sun * dt / (p.wetGroundDryingDays * 0.45 * DAY));
        }
        else if (this.heat[k] > 0) {
          // Sunset: the heated layer is left above the ground as a residual layer.
          this.eveningTheta[k] = this.surfaceTheta(k, airTheta, airMassDepth, lapseAbove);
          this.residualHeat[k] = this.heat[k]; this.eveningExcess[k] = Math.max(0, this.mixedTheta[k] - airTheta); this.eveningDepth[k] = this.mixedDepth[k];
          this.heat[k] = 0; this.sunsetHour = this.hourUtc;
        }
        const fade = Math.exp(-dt / (p.residualHeatHours * 3600));
        this.residualHeat[k] *= fade; this.eveningExcess[k] *= fade;
      }
      const nightHours = daytime ? 0 : Math.max(0, this.hourUtc - (this.sunsetHour ?? this.hourUtc - 6));
      // At night the ground loses heat to the sky and cools the air next to it, the more so the
      // drier the air (moist air sends more back down). How much of that the air near the ground
      // keeps depends on the wind: a calm night lets a shallow layer cool and decouple, a windy
      // one (the night-time jet over the warm sector) keeps stirring warmer air down, and cools
      // perhaps a third as much. (2026-10-19: until then every place cooled 11-21 K whatever
      // the wind, so the moist air was saturated by midnight and dry air fell into the 20s F.)
      const windShare = p.nightWindFloor + (1 - p.nightWindFloor) / (1 + (stir / p.nightWindMs) ** 2);
      const nightDrop = p.nightCoolingK * (p.nightMoistShare + (1 - p.nightMoistShare) * dryness) * windShare * clearNight * (1 - Math.exp(-nightHours / p.nightCoolingHours));
      const surfaceTheta = daytime ? this.surfaceTheta(k, airTheta, airMassDepth, lapseAbove) : Math.max(airTheta - p.nightCoolingK, this.eveningTheta[k] - nightDrop);
      const depth = daytime ? this.mixedDepth[k] : 150;
      if (daytime) {
        // Over the high ground the day's deepest, hottest mixed layer is the lid's air (what is
        // left of it aloft after sunset is the elevated mixed layer): the lid takes on its
        // potential temperature, but cooler hours of the day do not cool it.
        const source = ramp(terrain, p.emlSourceTerrainM - 300, p.emlSourceTerrainM) * ramp(depth, 1200, 2200);
        this.eml[k] = Math.max(this.eml[k], source);
        if (dt > 0 && source > 0 && this.mixedTheta[k] > this.lidTheta[k]) this.lidTheta[k] += source * (this.mixedTheta[k] - this.lidTheta[k]) * clamp(dt / 3600, 0, 1);
      }
      // Moisture: the mixed layer holds the moist layer's vapour, diluted by the dry air it
      // entrains once it grows deeper than the moist layer.
      const moistDepth = moistLayer;
      const mixingRatio = depth <= moistDepth ? this.moisture[k] : (this.moisture[k] * moistDepth + p.dryMixingRatio * (depth - moistDepth)) / depth;
      this.surfaceMixingRatio[k] = mixingRatio;
      // Where the mixed layer has grown well past the moist layer, the moisture is carried up
      // and away on the stronger winds aloft: the moist layer itself erodes there by day (and is
      // replaced from the east and south at night, when the dryline retreats).
      if (dt > 0 && daytime && depth > 1.15 * moistDepth) this.moisture[k] += (mixingRatio - this.moisture[k]) * clamp(dt / (p.moistureErosionHours * 3600), 0, 1);
      const exner = (surfacePressure / 1000) ** KAPPA;
      let temperatureK = (surfaceTheta - this.coldPool[k]) * exner, dewpointK = dewpointFromMixingRatio(mixingRatio, surfacePressure);
      if (this.coldPool[k] > 0) {
        // Rain-cooled air: the part of its cooling that evaporation could do (toward the air's
        // wet bulb) brought its vapour; the rest is air from the downdraught, arriving below
        // saturation (coldPoolHumidity).
        const air = temperatureK + this.coldPool[k] * exner, wetBulb = wetBulbK(air, Math.min(air, dewpointK), surfacePressure);
        const evaporated = Math.min(this.coldPool[k] * exner, p.coldPoolEvaporationShare * (air - wetBulb));
        const moist = mixingRatio + 1005 * evaporated / LATENT_HEAT * 1000, most = p.coldPoolHumidity * mixingRatioAt(temperatureK, surfacePressure);
        dewpointK = dewpointFromMixingRatio(Math.min(moist, most), surfacePressure);
      }
      if (!daytime) {
        // Near saturation the night's cooling goes into dew on the ground (and fog where it is
        // calm): the heat the vapour gives up as it condenses holds the air back, so the air and
        // its dewpoint then fall together, at 1 / (1 + L dqs/dT / cp) of the clear-air rate
        // (about a third). The wind keeps the air at screen height that much short of saturation
        // (nightSpreadK, calm to windy), while the dew forms on the colder ground below it.
        const cooling = Math.max(0, (this.eveningTheta[k] - surfaceTheta) * exner), before = temperatureK + cooling;
        const keep = p.nightSpreadK[0] + (p.nightSpreadK[1] - p.nightSpreadK[0]) * ramp(stir, p.nightSpreadWindMs[0], p.nightSpreadWindMs[1]);
        const free = Math.min(cooling, Math.max(0, before - dewpointK - keep)), rest = cooling - free;
        if (rest > 0) {
          const qs = mixingRatioAt(dewpointK, surfacePressure) / 1000, gamma = LATENT_HEAT ** 2 * qs / (1005 * 461.5 * dewpointK * dewpointK), slowed = rest / (1 + gamma);
          temperatureK = before - free - slowed; dewpointK -= slowed;
        }
        this.nightTheta[k] = temperatureK / exner + this.coldPool[k];
      }
      dewpointK = Math.min(temperatureK, dewpointK);

      // --- Winds. Above the boundary layer the wind is the balanced wind. Within it by day the
      // wind is the layer's own (see mixedLayerFriction); at night the layer is cut off from
      // the ground and its departure from balance rotates freely.
      const geo850 = this.windAt(outer, 850), geoSurface = this.windAt(outer, 1000);
      // The pressure pattern owed to the low-level air fades upward through that air.
      const z850 = Math.max(0, 1460 - terrain), thermalShare850 = clamp(1 - z850 / height700, 0, 1);
      // (The deep cold air's weight is less at 850 mb by ((h - z) / h)^2 of a dome h deep.)
      const domeShare850 = this.domeDepth[k] > z850 ? ((this.domeDepth[k] - z850) / this.domeDepth[k]) ** 2 : 0;
      geo850.u += 0.7 * leeU + thermalShare850 * (this.thermalU[k] - this.domeU[k]) + domeShare850 * this.domeU[k]; geo850.v += 0.7 * leeV + thermalShare850 * (this.thermalV[k] - this.domeV[k]) + domeShare850 * this.domeV[k];
      geoSurface.u += leeU + this.thermalU[k]; geoSurface.v += leeV + this.thermalV[k];
      const layerTurn = p.mixedLayerTurnDeg * Math.PI / 180, layerCos = Math.cos(layerTurn), layerSin = Math.sin(layerTurn);
      const meanU = (1 - p.mixedLayerFriction) * 0.5 * (geoSurface.u + geo850.u), meanV = (1 - p.mixedLayerFriction) * 0.5 * (geoSurface.v + geo850.v);
      const layerWind = { u: meanU * layerCos - meanV * layerSin, v: meanU * layerSin + meanV * layerCos };
      if (dt > 0) {
        if (daytime) {
          // 850 mb takes the mixed layer's wind where the layer has grown up past it (over the
          // low plains that is late in the day, near the layer's top) and keeps its balanced
          // wind where it is still above the layer.
          const blend = clamp(dt / (2 * 3600), 0, 1), inside = ramp(depth - z850, 0, 300);
          this.ageoU[k] += (inside * (layerWind.u - geo850.u) - this.ageoU[k]) * blend; this.ageoV[k] += (inside * (layerWind.v - geo850.v) - this.ageoV[k]) * blend;
        } else {
          const turn = -f0 * dt, c = Math.cos(turn), s = Math.sin(turn), u = this.ageoU[k], v = this.ageoV[k];
          this.ageoU[k] = u * c - v * s; this.ageoV[k] = u * s + v * c;
        }
      }
      const w850 = { u: geo850.u + this.ageoU[k], v: geo850.v + this.ageoV[k] };
      // A deep, dry mixed layer brings the mid-level wind down to the ground: west of the
      // dryline the afternoon wind turns westerly and strengthens, and the air converges on it.
      const mixedDown = daytime ? this.momentumMixing(depth) : 0, w700 = this.windAt(outer, 700);
      w850.u += mixedDown * (w700.u - w850.u) + 0.5 * this.coldPushU[k]; w850.v += mixedDown * (w700.v - w850.v) + 0.5 * this.coldPushV[k];
      // Surface wind: the mixed layer's wind by day, the mean of the lowest levels at night,
      // slowed and turned toward low pressure by friction (more so at night).
      const between = (range, share) => range[0] + (range[1] - range[0]) * share;
      const deep = ramp(depth, p.surfaceMixedDepthM[0], p.surfaceMixedDepthM[1]);
      const richardson = GRAVITY / airTheta * Math.max(0, airTheta - temperatureK / exner) * p.nightLayerM / Math.max(1, stir * stir), decoupled = richardson / (richardson + p.nightRichardson);
      // In the morning the ground stays cut off from the wind above until the mixed layer has worn
      // through the night's inversion (its first 300 m): until then the night's rule holds, and the
      // day's takes over as the inversion goes. (2026-10-21: the switch at sunrise doubled the
      // surface wind and backed it 40 degrees at once, so 0-1 km helicity peaked at 8-11 am.)
      const eroded = daytime ? (p.morningTransitionM > 0 ? ramp(depth, 0, p.morningTransitionM) : 1) : 0;
      const nightLow = { u: 0.5 * (geoSurface.u + w850.u), v: 0.5 * (geoSurface.v + w850.v) };
      const drag = between(p.surfaceWindShareNight, decoupled) + (between(p.surfaceWindShare, deep) - between(p.surfaceWindShareNight, decoupled)) * eroded;
      const turn = (between(p.surfaceBackingNightDeg, decoupled) + (between(p.surfaceBackingDeg, deep) - between(p.surfaceBackingNightDeg, decoupled)) * eroded) * Math.PI / 180;
      const low = { u: nightLow.u + (layerWind.u - nightLow.u) * eroded, v: nightLow.v + (layerWind.v - nightLow.v) * eroded };
      const base = { u: low.u + mixedDown * (w700.u - low.u), v: low.v + mixedDown * (w700.v - low.v) };
      const surfaceWind = { u: drag * (base.u * Math.cos(turn) - base.v * Math.sin(turn)) + this.coldPushU[k], v: drag * (base.u * Math.sin(turn) + base.v * Math.cos(turn)) + this.coldPushV[k] };

      // --- Write the cell.
      const set = (target, w) => { target.windSpeed = Math.hypot(w.u, w.v) * KT; target.windDirection = (Math.atan2(-w.u, -w.v) * 180 / Math.PI + 360) % 360; };
      cell.surface.pressure = surfacePressure; cell.surface.seaLevelPressure = seaLevelPressure;
      cell.surface.temperature = kelvinToF(temperatureK); cell.surface.dewpoint = kelvinToF(dewpointK);
      cell.surface.wind = { speed: Math.hypot(surfaceWind.u, surfaceWind.v) * KT, direction: (Math.atan2(-surfaceWind.u, -surfaceWind.v) * 180 / Math.PI + 360) % 360 };
      // 850 mb: inside the mixed layer by day it has the mixed layer's temperature and moisture;
      // otherwise the air mass (with what is left of yesterday's heating) or the stable air above it.
      // (Above a shallow cold dome 850 mb is in the warmer air over it: the deficit comes back with height.)
      const profile850 = airTheta + (z850 > airMassDepth ? lapseAbove * (z850 - airMassDepth) : 0) + (z850 < this.eveningDepth[k] ? this.eveningExcess[k] : 0) + (dome > 0 ? this.domeDeficit[k] - coldAt(z850) : 0);
      const mixed850 = daytime && z850 < depth, t850 = (mixed850 ? Math.max(this.mixedTheta[k], profile850) : profile850) * 0.85 ** KAPPA - 273.15;
      const moistReaches850 = ramp(terrain + moistDepth, 1350, 1700);
      cell.levels[850].temperature = t850; cell.levels[850].dewpoint = Math.min(t850 - 1, dewpointFromMixingRatio(mixed850 ? mixingRatio : p.dryMixingRatio + (p.moisture850Share * this.moisture[k] - p.dryMixingRatio) * moistReaches850, 850) - 273.15);
      // A mixed layer grown up past 700 mb gives it its own temperature (a deep mixed layer is one
      // potential temperature through its depth; until 2026-10-20 700 mb kept the outer model's).
      const mixedTo700 = daytime && this.mixedDepth[k] >= height700 ? this.mixedTheta[k] * 0.7 ** KAPPA - 273.15 : -Infinity;
      cell.levels[700].temperature = Math.max(t700, mixedTo700); cell.levels[700].dewpoint = cell.levels[700].temperature - (12 + 14 * this.eml[k]);
      // Air cannot stay cooler (in potential temperature) at 700 mb than at 850 mb: such a layer
      // overturns at once, and the two levels mix to the potential temperature they share, the heat
      // kept (convective adjustment). (2026-10-24: 850 mb carries the map's own warm-sector air and
      // 700 mb the large-scale layer's, less up to 6 K of lift cooling, and nothing stopped 700 mb
      // from falling past the dry adiabat: lapse rates of 10-13 C/km between them, and CAPE of 4,500-
      // 5,900 J/kg on seed 1000; docs/METEOROLOGIST-REVIEW-2026-10-24.md.)
      if (p.convectiveAdjustment) {
        const theta850 = (cell.levels[850].temperature + 273.15) / 0.85 ** KAPPA, theta700 = (cell.levels[700].temperature + 273.15) / 0.7 ** KAPPA;
        if (theta700 < theta850) {
          const shared = (theta850 + theta700) / 2, dew850 = cell.levels[850].dewpoint - cell.levels[850].temperature;
          cell.levels[850].temperature = shared * 0.85 ** KAPPA - 273.15; cell.levels[850].dewpoint = cell.levels[850].temperature + Math.min(-1, dew850);
          cell.levels[700].temperature = shared * 0.7 ** KAPPA - 273.15; cell.levels[700].dewpoint = cell.levels[700].temperature - (12 + 14 * this.eml[k]);
        }
      }
      cell.levels[500].temperature = t500; cell.levels[250].temperature = t250;
      set(cell.levels[850], w850); set(cell.levels[700], this.windAt(outer, 700)); set(cell.levels[500], this.windAt(outer, 500)); set(cell.levels[250], this.windAt(outer, 250));
      cell.levels[500].heightDm = (5760 + f0 * (outer.midPsi - this.referenceMidPsi()) / GRAVITY) / 10;
      // 500 mb height tendency (dam per 12 h): falls mark large-scale ascent.
      if (this.previousMid && dt > 0) cell.levels[500].heightTendencyDm12h = f0 * (outer.midPsi - this.previousMid[k]) / GRAVITY / 10 / dt * 43200 / p.tempo;
      cell.features.airMassTemperatureF = kelvinToF(airTheta * (surfacePressure / 1000) ** KAPPA) - 6;
      // The air mass itself: its potential temperature without the standing warmth of the high
      // ground or the day's heating. This is the field fronts are found in.
      cell.features.airMassThetaK = airTheta - p.plateauWarmthK * this.plateau(terrain) - this.coldPool[k];
      cell.features.coldPoolK = this.coldPool[k];
      // The outer model's ascent here (K per hour of cooling; sinking negative) and what it has
      // done to the capping layer so far (K of cooling).
      cell.features.ascentCoolingKh = outer.ascentKh; cell.features.capLiftK = this.capLift[k];
      cell.features.emlInfluence = this.eml[k]; cell.features.lidThetaK = this.lidTheta[k]; cell.features.mixedLayerDepthM = depth;
      // The cap air is well mixed from its base to 700 mb, so its base is warmer than 700 mb by
      // the dry-adiabatic difference between the two pressures.
      cell.features.emlBaseExcessC = (t700 + 273.15) * ((780 / 700) ** KAPPA - 1) * 0.9;
      // How much this is warm, moist air that the boundary layer has not mixed out (0-1).
      cell.features.warmSector = ramp(this.moisture[k], 9, 13) * (1 - ramp(depth / moistDepth, 1.3, 1.9));
      // How hard the ground is heating the air now, against the most it does over dry ground (0-1).
      cell.features.surfaceHeating = daytime ? (p.heatingMoistWm2 + (p.heatingDryWm2 - p.heatingMoistWm2) * dryness) * (1 - p.wetGroundHeatingCut * this.wetGround[k]) * sunHere / p.heatingDryWm2 : 0;
      cell.features.moistLayerTopM = this.moistTop[k]; cell.features.wetGround = this.wetGround[k];
      // Cloud (see stratusSpreadK): low from the air near the ground and at 850 mb, mid and high
      // from the large-scale ascent, high also from storms' anvils.
      {
        const spreadK = temperatureK - dewpointK, lclM = 125 * spreadK;
        const stratus = ramp(spreadK, p.stratusSpreadK[0], p.stratusSpreadK[1]);
        const cumulus = daytime ? p.cumulusShare * ramp(this.mixedDepth[k] - lclM, 0, 400) : 0;
        const t850c = cell.levels[850].temperature, d850c = cell.levels[850].dewpoint;
        const rh850 = Math.exp(17.67 * d850c / (d850c + 243.5) - 17.67 * t850c / (t850c + 243.5));
        const humid850 = rh850 > p.cloudRh ? 1 - Math.sqrt(Math.max(0, 1 - rh850) / (1 - p.cloudRh)) : 0;
        const ascent = outer.ascentKh ?? 0;
        this.cloudLow[k] = Math.max(stratus, cumulus, humid850);
        this.cloudMid[k] = ramp(ascent, p.midAscentKh[0], p.midAscentKh[1]) * (1 - 0.5 * this.eml[k]);
        this.cloudHigh[k] = Math.max(this.anvil[k], 0.8 * ramp(ascent, p.highAscentKh[0], p.highAscentKh[1]));
        cell.features.cloudLow = this.cloudLow[k]; cell.features.cloudMid = this.cloudMid[k]; cell.features.cloudHigh = this.cloudHigh[k];
        cell.features.cloudTotal = 1 - (1 - this.cloudLow[k]) * (1 - this.cloudMid[k]) * (1 - this.cloudHigh[k]);
      }
      if (p.diagnostics) updateCellDiagnostics(cell);
    });
    this.previousMid = Float64Array.from(outers, o => o.midPsi);
  }

  // Share of the mid-level wind mixed down to the ground by a mixed layer of this depth (m).
  momentumMixing(depth) { return this.params.momentumMixingShare * ramp(depth, 1800, 3000); }

  referenceMidPsi() { return this.midReference ??= this.outer(this.origin.x + this.nx * this.dx / 2, this.origin.y + this.ny * this.dx / 2).midPsi; }

  // Potential temperature of the mixed layer for the heat put in so far, and its depth.
  // Profile above ground: a night inversion in the lowest 300 m, the well-mixed air mass up
  // to airMassDepth, then stable air with potential temperature rising at lapseAbove.
  surfaceTheta(k, airTheta, airMassDepth, lapseAbove) {
    // The night's own inversion (how far the night cooled the air near the ground below its air
    // mass); before a night has been worked out, what a calm night would have left.
    const inversion = Math.max(0, airTheta - (this.nightTheta[k] > 0 ? this.nightTheta[k] : this.eveningTheta[k] - this.params.nightCoolingK * 0.8));
    const inversionHeat = 0.5 * 300 * inversion;            // K m needed to erode the night inversion
    // The mixed layer warms by the surface heating and, once it is growing into the stable air,
    // by the warmer air it entrains from above (entrainmentRatio of the surface heating).
    const heat = this.heat[k] * (this.heat[k] > inversionHeat ? 1 + this.params.entrainmentRatio : 1);
    if (heat <= inversionHeat) {
      const fraction = inversionHeat > 0 ? Math.sqrt(heat / inversionHeat) : 1;
      this.mixedDepth[k] = 300 * fraction;
      return this.mixedTheta[k] = airTheta - inversion * (1 - fraction);
    }
    // Then the whole air mass is mixed; extra heat warms it and deepens it into the stable air:
    // heat = rise * airMassDepth + rise^2 / (2 * lapseAbove).
    const extra = heat - inversionHeat, a = 1 / (2 * lapseAbove), b = airMassDepth;
    const rise = (-b + Math.sqrt(b * b + 4 * a * extra)) / (2 * a);
    this.mixedDepth[k] = airMassDepth + rise / lapseAbove; this.mixedTheta[k] = airTheta + rise;
    return airTheta + rise + 1;   // the air next to the ground is slightly superadiabatic
  }
}

// The larger of a and b, rounded off over about `width` where they meet.
const softMax = (a, b, width) => (a + b + Math.sqrt((a - b) ** 2 + width * width)) / 2;

// Saturation mixing ratio (g/kg) at a temperature (K) and pressure (hPa).
function mixingRatioAt(temperatureK, pressure) {
  const t = temperatureK - 273.15, e = 6.112 * Math.exp(17.67 * t / (t + 243.5));
  return 622 * e / Math.max(1, pressure - e);
}

// Wet-bulb temperature (K) of air at temperatureK with dewpointK: where the heat evaporation
// takes, cp (T - Tw), equals the latent heat of the vapour it adds, L (qs(Tw) - q). Newton steps.
function wetBulbK(temperatureK, dewpointK, pressure) {
  const q = mixingRatioAt(dewpointK, pressure) / 1000;
  let tw = dewpointK + (temperatureK - dewpointK) / 3;
  for (let i = 0; i < 4; i++) {
    const qs = mixingRatioAt(tw, pressure) / 1000, f = 1005 * (temperatureK - tw) - LATENT_HEAT * (qs - q);
    const slope = -1005 - LATENT_HEAT * qs * LATENT_HEAT / (461.5 * tw * tw);
    tw -= f / slope;
  }
  return clamp(tw, dewpointK, temperatureK);
}

// Dewpoint (K) for a mixing ratio (g/kg) at a pressure (hPa).
function dewpointFromMixingRatio(mixingRatio, pressure) {
  const e = pressure * (mixingRatio / 1000) / (0.622 + mixingRatio / 1000);
  const ln = Math.log(Math.max(0.05, e) / 6.112);
  return 243.5 * ln / (17.67 - ln) + 273.15;
}

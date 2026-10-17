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

const KT = 1.943844, KAPPA = 0.2857, RD = 287, GRAVITY = 9.81, DAY = 86400, RHO_AIR = 1.2;
const kelvinToF = k => (k - 273.15) * 9 / 5 + 32;
const ramp = (value, low, high) => clamp((value - low) / (high - low), 0, 1);

export const REGIONAL_DEFAULTS = Object.freeze({
  columns: 50, rows: 50, cellKm: 16.09344,
  utcOffsetHours: -6,
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
  leeCycloneGain: 0.5, leeCycloneAscentKh: 0.2,
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
  // Air cooled by storms' rain (cold pools): how deep it is, and how long it takes to warm back up
  // at night (by day the sun warms it; see fill).
  coldPoolDepthM: 800, coldPoolRecoveryHoursNight: 8,
  // The mountains west of the map block the mean westerly below their crest: share of it
  // removed at 850 mb and below, fading to none at the crest.
  mountainBlocking: 0.8, crestPressureHpa: 700,
  reference700C: 5, reference500C: -9.5, reference250C: -48,
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
  temperatureShare: { 700: 1.0, 500: 0.9, 250: 0.3 },
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
  gulfMixingRatio: 16, continentalMixingRatio: 7, continentalHumidity: 0.45, dryMixingRatio: 3.5, moistLayerTopM: 2100,
  // Boundary layer.
  // Peak heating of the air by the ground: moist, vegetated ground puts most of the sun's
  // energy into evaporation, dry ground into heating the air.
  heatingMoistWm2: 110, heatingDryWm2: 390, nightCoolingK: 16, nightCoolingHours: 4,
  // By day the boundary layer is mixed, so it has one wind through its depth: the mean
  // balanced wind of the layer, less this share lost to friction at the ground. The wind at
  // the ground is surfaceWindShare of it, backed by surfaceBackingDeg. At sunset the layer is
  // cut off from the ground and its departure from balance swings freely: the night-time jet.
  // (2026-10-16: friction 0.3 to 0.4, turning 22 to 15 degrees by day and 38 to 25 at night,
  // with the lee trough at most 4 hPa instead of 7: helicity in the lowest km came down from a
  // median of 138 to 96, 90th 311 to 220; the night turning made the evening's jump.)
  mixedLayerFriction: 0.4, surfaceWindShare: 0.75, surfaceBackingDeg: 15, surfaceBackingNightDeg: 25,
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
  stepSeconds: 1800
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
    this.ageoU = new Float64Array(n); this.ageoV = new Float64Array(n); this.surfaceMixingRatio = new Float64Array(n);
    // Low-level pressure (hPa) and balanced wind (m/s) owed to the temperature of the air near
    // the ground; the day's heat left in the air after sunset.
    this.thermalHpa = new Float64Array(n); this.thermalU = new Float64Array(n); this.thermalV = new Float64Array(n);
    this.residualHeat = new Float64Array(n); this.mixedTheta = new Float64Array(n); this.eveningExcess = new Float64Array(n); this.eveningDepth = new Float64Array(n);
    this.coldPushU = new Float64Array(n); this.coldPushV = new Float64Array(n);   // m/s, east and north
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
      out.upperU += w * f.upperWind.u; out.upperV += w * f.upperWind.v; out.lowerU += w * f.lowerWind.u; out.lowerV += w * f.lowerWind.v;
      out.layerK += w * f.layerTemperatureK; out.lowPsi += w * f.lowerDisturbanceStreamfunction; out.midPsi += w * f.midStreamfunction; out.ascentKh += w * (f.ascentCoolingKh ?? 0); out.surfaceK += w * (f.surfaceThetaK ?? 0); out.surfaceQ += w * (f.surfaceMoistureGkg ?? 0);
    }
    // The mean state's own fall northward is taken about the map's place, not the slide's.
    const q = m.params;
    out.layerK += q.f0 * (q.upperWindMs - q.lowerWindMs) * shift / (RD * Math.log(3));
    out.midPsi += (q.upperWindMs + q.lowerWindMs) / 2 * shift;
    return out;
  }

  // Balanced wind (m/s) at a pressure level. The mean flow is linear in pressure through the
  // two layers, less the part the mountains block below their crest. The weather systems are
  // linear in pressure between the layers; below the lower layer's level (750 mb) they keep
  // that layer's wind: the lower layer is the whole lower troposphere, and carrying its
  // systems further down along the shear would weaken them toward the ground, where real
  // lows and their winds are strongest.
  windAt(outer, pressure) {
    const s = (750 - pressure) / 500, between = Math.max(0, s), q = this.model.params, p = this.params;
    const mean = (q.lowerWindMs + s * (q.upperWindMs - q.lowerWindMs)) * (1 - p.mountainBlocking * ramp(pressure, p.crestPressureHpa, 850));
    const lowerU = outer.lowerU - q.lowerWindMs, upperU = outer.upperU - q.upperWindMs;
    return { u: mean + lowerU + between * (upperU - lowerU), v: outer.lowerV + between * (outer.upperV - outer.lowerV) };
  }

  // Pressure pattern near the ground (hPa about the mean): the lower layer's systems, plus the
  // north-south slope that balances what is left of the mean wind at the ground.
  balancedPressureHpa(outer) {
    const q = this.model.params, meanAtGround = (q.lowerWindMs - 0.5 * (q.upperWindMs - q.lowerWindMs)) * (1 - this.params.mountainBlocking);
    return RHO_AIR * q.f0 * (outer.lowPsi - meanAtGround * outer.north) / 100;
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
    const depthHpa = p.leeTroughFlowHpa * cross * (1 + p.leeCycloneGain * clamp((outer.ascentKh ?? 0) / p.leeCycloneAscentKh, 0, 1));
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

  // Hydrostatic balance near the ground: a column of warm low-level air weighs less, so the
  // surface pressure under it is lower, and the balanced wind blows with that low pressure on
  // its left. Only temperature the outer model does not hold is counted, so nothing is counted
  // twice: the standing heat of the high ground and the heating of the day. The pressure
  // responds over the distance set by the depth of that air (its deformation radius, about
  // 200 km), not cell by cell.
  thermalBalance(outers) {
    const { nx, ny, dx } = this, p = this.params, n = nx * ny, f0 = this.model.params.f0;
    let pressure = new Float64Array(n), airMass = new Float64Array(n);
    this.world.forEachCell((cell, x, y) => {
      const k = y * nx + x, terrain = cell.terrain.elevationM;
      const column = p.plateauWarmthK * this.plateau(terrain) * Math.min(this.airMassDepth(terrain, k), Math.max(600, 3050 - terrain)) + Math.max(this.heat[k], this.residualHeat[k]);   // K m
      pressure[k] = -RHO_AIR * GRAVITY * column / this.theta[k];   // Pa
      // The low-level air masses (fronts) differ from the temperature the outer model's pressure
      // already holds (its 250-750 mb layer); the cold side is heavier, so the pressure rises
      // behind a front and the front lies in a trough.
      const layerHeld = p.airMassThetaK + (outers[k].layerK - this.referenceLayerK) + p.plateauWarmthK * this.plateau(terrain);
      airMass[k] = -RHO_AIR * GRAVITY * p.airMassPressureDepthM * (this.theta[k] - layerHeld) / this.theta[k];
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
    for (let k = 0; k < n; k++) pressure[k] += airMass[k];
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const k = y * nx + x, e = Math.min(nx - 1, x + 1), w = Math.max(0, x - 1), north = Math.max(0, y - 1), south = Math.min(ny - 1, y + 1);
      const eastward = (pressure[y * nx + e] - pressure[y * nx + w]) / ((e - w) * dx), northward = (pressure[north * nx + x] - pressure[south * nx + x]) / ((south - north) * dx);
      this.thermalHpa[k] = pressure[k] / 100; this.thermalU[k] = -northward / (RHO_AIR * f0); this.thermalV[k] = eastward / (RHO_AIR * f0);
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
    const anomaly = outer.surfaceQ + (q.surfaceMoistureGradientGkgPer1000Km ?? 0) * outer.north / 1e6;
    return clamp(p.gulfMixingRatio + anomaly + (this.gulfMoistureErrorGkg ?? 0), p.dryMixingRatio, p.gulfMixingRatio + p.gulfMoistMoreGkg);
  }

  // Moisture of the air entering the map: Gulf air along the south-eastern side, continental
  // air to the north, dry air off the high ground to the west. It is also what the air on the map
  // is drawn toward over airMassRelaxationDays, as its temperature is (2026-10-16; until then the
  // air was only ever dried, toward continentalHumidity of what its temperature allows, and Gulf
  // air in a warm sector at 16 g/kg was drawn toward about 9).
  inflowMoisture(x, y, outer = this.outerAt(x, y)) {
    const p = this.params, east = this.eastShare(x), south = y / (this.ny - 1);
    const gulf = (0.45 + 0.55 * south) * ramp(east, 0.1, 0.4);
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
  advect(field, windOf, inflowOf, dt) {
    const { nx, ny, dx } = this, out = new Float64Array(field.length);
    const at = (i, j) => field[clamp(j, 0, ny - 1) * nx + clamp(i, 0, nx - 1)];
    const cubic = (a, b, c, d, t) => b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const w = windOf(x, y), sx = x - w.u * dt / dx, sy = y + w.v * dt / dx;   // rows count southward
      if (sx < 0 || sy < 0 || sx > nx - 1 || sy > ny - 1) { out[y * nx + x] = inflowOf(clamp(Math.round(sx), 0, nx - 1), clamp(Math.round(sy), 0, ny - 1), x, y); continue; }
      const x0 = Math.min(nx - 2, Math.floor(sx)), y0 = Math.min(ny - 2, Math.floor(sy)), tx = sx - x0, ty = sy - y0;
      const rows = [-1, 0, 1, 2].map(j => cubic(at(x0 - 1, y0 + j), at(x0, y0 + j), at(x0 + 1, y0 + j), at(x0 + 2, y0 + j), tx));
      const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      out[y * nx + x] = clamp(cubic(rows[0], rows[1], rows[2], rows[3], ty), Math.min(a, b, c, d), Math.max(a, b, c, d));
    }
    field.set(out);
  }

  // Heating of the air by the ground (0-1 of its early-afternoon peak) at a local solar hour:
  // it turns positive a while after sunrise and negative again before sunset.
  sunshine(localHour) { return Math.max(0, Math.sin(Math.PI * (localHour - 6.5) / 10.5)); }

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
      this.advect(this.theta, lowWind, (sx, sy) => this.airMassTheta(outers[sy * nx + sx], world.cells[sy][sx].terrain.elevationM), dt);
      // The Gulf's air along the map's south-eastern edge (it sets how deep the moisture coming back is).
      let gulf = 0, count = 0;
      for (let x = Math.floor(0.4 * nx); x < nx; x += 2) { gulf += this.gulfAir(outers[(ny - 1) * nx + x]); count++; }
      this.gulfSupply = gulf / count;
      this.advect(this.moisture, lowWind, (sx, sy) => (p.westInflowDry && sx === 0 ? Math.min(p.dryMixingRatio + 1, this.inflowMoisture(sx, sy, outers[sy * nx + sx])) : this.inflowMoisture(sx, sy, outers[sy * nx + sx])), dt);
      this.advect(this.coldPool, lowWind, () => 0, dt);
      this.advect(this.capLift, midWind, () => 0, dt);
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
      this.advect(this.eml, midWind, (sx, sy) => (offPlateau(sx, sy) ? 1 : ramp(world.cells[sy][sx].terrain.elevationM, p.emlSourceTerrainM - 300, p.emlSourceTerrainM)), dt);
      this.advect(this.lidTheta, midWind, (sx, sy) => (offPlateau(sx, sy) ? p.lidSourceThetaK + p.temperatureShare[700] * (outers[sy * nx + sx].layerK - this.referenceLayerK) : this.lidTheta[sy * nx + sx]), dt);
    }

    world.validHourUtc = this.hourUtc;
    world.forEachCell((cell, x, y) => {
      const k = y * nx + x, outer = outers[k], terrain = cell.terrain.elevationM;
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
          const heating = (p.heatingMoistWm2 + (p.heatingDryWm2 - p.heatingMoistWm2) * dryHere) * (1 - p.wetGroundHeatingCut * this.wetGround[k]) * sun;
          this.coldPool[k] = Math.max(0, this.coldPool[k] - heating * dt / (RHO_AIR * 1005 * p.coldPoolDepthM));
        } else this.coldPool[k] *= Math.exp(-dt / 3600 / p.coldPoolRecoveryHoursNight);
        this.capLift[k] = this.capLift[k] * Math.exp(-dt / (p.capLiftHours * 3600)) + (p.capLiftRatio - 1) * outer.ascentKh * dt / 3600;
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
      const t700 = ordinary700 + this.eml[k] * Math.max(0, lid700 - ordinary700) - this.capLift[k];
      const adiabat500 = (t700 + 273.15) * (500 / 700) ** KAPPA - 273.15, ordinary500 = p.reference500C + p.temperatureShare[500] * anomaly;
      const t500 = ordinary500 + Math.min(0, adiabat500 - ordinary500) * p.emlLapseShare * this.eml[k], t250 = p.reference250C + p.temperatureShare[250] * anomaly;
      const theta700 = (t700 + 273.15) * (1000 / 700) ** KAPPA;

      // --- Boundary layer. The sun heats a mixed layer that first erodes the night's inversion,
      // then deepens through the air mass (potential temperature theta) and into the stable
      // air beneath 700 mb. Depths are above ground.
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
          this.heat[k] += (p.heatingMoistWm2 + (p.heatingDryWm2 - p.heatingMoistWm2) * dryness) * (1 - p.wetGroundHeatingCut * wet) * sun / 1200 * dt;
          this.moisture[k] += p.wetGroundMoisteningGkgH * wet * sun * dt / 3600;
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
      const nightDrop = p.nightCoolingK * (0.7 + 0.6 * dryness) * (1 - Math.exp(-nightHours / p.nightCoolingHours));
      const surfaceTheta = daytime ? this.surfaceTheta(k, airTheta, airMassDepth, lapseAbove) : Math.max(airTheta - 12, this.eveningTheta[k] - nightDrop);
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
      const temperatureK = (surfaceTheta - this.coldPool[k]) * (surfacePressure / 1000) ** KAPPA;
      const dewpointK = Math.min(temperatureK, dewpointFromMixingRatio(mixingRatio, surfacePressure));

      // --- Winds. Above the boundary layer the wind is the balanced wind. Within it by day the
      // wind is the layer's own (see mixedLayerFriction); at night the layer is cut off from
      // the ground and its departure from balance rotates freely.
      const geo850 = this.windAt(outer, 850), geoSurface = this.windAt(outer, 1000);
      // The pressure pattern owed to the low-level air fades upward through that air.
      const z850 = Math.max(0, 1460 - terrain), thermalShare850 = clamp(1 - z850 / height700, 0, 1);
      geo850.u += 0.7 * leeU + thermalShare850 * this.thermalU[k]; geo850.v += 0.7 * leeV + thermalShare850 * this.thermalV[k];
      geoSurface.u += leeU + this.thermalU[k]; geoSurface.v += leeV + this.thermalV[k];
      const layerWind = { u: (1 - p.mixedLayerFriction) * 0.5 * (geoSurface.u + geo850.u), v: (1 - p.mixedLayerFriction) * 0.5 * (geoSurface.v + geo850.v) };
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
      const drag = daytime ? p.surfaceWindShare : 0.4, turn = (daytime ? p.surfaceBackingDeg : p.surfaceBackingNightDeg) * Math.PI / 180;
      const low = daytime ? layerWind : { u: 0.5 * (geoSurface.u + w850.u), v: 0.5 * (geoSurface.v + w850.v) };
      const base = { u: low.u + mixedDown * (w700.u - low.u), v: low.v + mixedDown * (w700.v - low.v) };
      const surfaceWind = { u: drag * (base.u * Math.cos(turn) - base.v * Math.sin(turn)) + this.coldPushU[k], v: drag * (base.u * Math.sin(turn) + base.v * Math.cos(turn)) + this.coldPushV[k] };

      // --- Write the cell.
      const set = (target, w) => { target.windSpeed = Math.hypot(w.u, w.v) * KT; target.windDirection = (Math.atan2(-w.u, -w.v) * 180 / Math.PI + 360) % 360; };
      cell.surface.pressure = surfacePressure; cell.surface.seaLevelPressure = seaLevelPressure;
      cell.surface.temperature = kelvinToF(temperatureK); cell.surface.dewpoint = kelvinToF(dewpointK);
      cell.surface.wind = { speed: Math.hypot(surfaceWind.u, surfaceWind.v) * KT, direction: (Math.atan2(-surfaceWind.u, -surfaceWind.v) * 180 / Math.PI + 360) % 360 };
      // 850 mb: inside the mixed layer by day it has the mixed layer's temperature and moisture;
      // otherwise the air mass (with what is left of yesterday's heating) or the stable air above it.
      const profile850 = airTheta + (z850 > airMassDepth ? lapseAbove * (z850 - airMassDepth) : 0) + (z850 < this.eveningDepth[k] ? this.eveningExcess[k] : 0);
      const mixed850 = daytime && z850 < depth, t850 = (mixed850 ? Math.max(this.mixedTheta[k], profile850) : profile850) * 0.85 ** KAPPA - 273.15;
      const moistReaches850 = ramp(terrain + moistDepth, 1350, 1700);
      cell.levels[850].temperature = t850; cell.levels[850].dewpoint = Math.min(t850 - 1, dewpointFromMixingRatio(mixed850 ? mixingRatio : p.dryMixingRatio + (0.85 * this.moisture[k] - p.dryMixingRatio) * moistReaches850, 850) - 273.15);
      cell.levels[700].temperature = t700; cell.levels[700].dewpoint = t700 - (12 + 14 * this.eml[k]);
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
      cell.features.surfaceHeating = daytime ? (p.heatingMoistWm2 + (p.heatingDryWm2 - p.heatingMoistWm2) * dryness) * (1 - p.wetGroundHeatingCut * this.wetGround[k]) * sun / p.heatingDryWm2 : 0;
      cell.features.moistLayerTopM = this.moistTop[k]; cell.features.wetGround = this.wetGround[k];
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
    const inversion = Math.max(0, airTheta - (this.eveningTheta[k] - this.params.nightCoolingK * 0.8));
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

// Dewpoint (K) for a mixing ratio (g/kg) at a pressure (hPa).
function dewpointFromMixingRatio(mixingRatio, pressure) {
  const e = pressure * (mixingRatio / 1000) / (0.622 + mixingRatio / 1000);
  const ln = Math.log(Math.max(0.05, e) / 6.112);
  return 243.5 * ln / (17.67 - ln) + 273.15;
}

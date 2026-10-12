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
  airMassThetaK: 302.5,               // potential temperature of the low-level air mass
  plateauWarmthK: 11,                 // the air over the high ground is hotter (and deeply mixed)
  // Lee trough: westerly flow descending the high ground lowers the pressure along its foot;
  // the low-level wind east of it turns southerly. (The outer model has no mountains, so this
  // part is set here. The thermal low over the hot plateau is not set: it follows from the
  // temperature of the low-level air, see thermalBalance.)
  leeTroughFlowHpa: 7, leeTroughColumn: 0.2, leeTroughWidthKm: 450, leeFlowMs: 15,
  // The geography (the rise to the high ground, the lee trough, where dry, continental and
  // Gulf air come from) is laid out over geographyColumns cells from its western edge; the map
  // starts geographyOffset cells east of that edge. With 0 and null the map spans all of it.
  // East of the geography the plains go on flat.
  geographyColumns: 50, geographyOffset: 15,
  // Cells over which the pressure responds to low-level temperature contrasts, and how long
  // the day's heat stays in the air after sunset.
  thermalSmoothingCells: 8, residualHeatHours: 8,
  // Air cooled by storms' rain (cold pools): how deep it is, and how long it takes to warm
  // back up under the sun and at night.
  coldPoolDepthM: 800, coldPoolRecoveryHoursDay: 3, coldPoolRecoveryHoursNight: 8,
  // The mountains west of the map block the mean westerly below their crest: share of it
  // removed at 850 mb and below, fading to none at the crest.
  mountainBlocking: 0.8, crestPressureHpa: 700,
  reference700C: 5, reference500C: -9.5, reference250C: -48,
  // The hot, dry air off the plateau is well mixed from its base to near 500 mb, so where it
  // lies overhead the temperature falls off faster with height: 500 mb is this share of the
  // way from its ordinary temperature to the dry adiabat through 700 mb.
  emlLapseShare: 0.45,
  // Moisture offshore. A front that reaches the Gulf replaces the moist air there with drier
  // air (down to gulfScouredMixingRatio, over gulfScourHours of northerly flow of
  // gulfScourWindMs across the map's southern edge); afterwards the sea moistens it again
  // over gulfRecoveryDays. So the moisture coming back north after a front is modest at first.
  gulfScouredMixingRatio: 8.5, gulfScourHours: 12, gulfScourWindMs: 6, gulfRecoveryDays: 4.5,
  // How strongly each level follows the outer model's tropospheric temperature. Cold air
  // masses are shallow and sharpest near the ground. Warm ones are not: the moist air under a
  // warm pattern comes off the sea and keeps close to the sea's temperature, and the warmth
  // shows above it instead, which is what strengthens the cap.
  temperatureShare: { lowCold: 1.8, lowWarm: 0.7, 700: 1.0, 500: 0.9, 250: 0.3 },
  // Moisture: mixing ratio (g/kg) of the air entering at each side, and the altitude of the
  // top of the Gulf moist layer.
  gulfMixingRatio: 16, continentalMixingRatio: 7, dryMixingRatio: 3.5, moistLayerTopM: 2100,
  // Boundary layer.
  // Peak heating of the air by the ground: moist, vegetated ground puts most of the sun's
  // energy into evaporation, dry ground into heating the air.
  heatingMoistWm2: 110, heatingDryWm2: 390, nightCoolingK: 16, nightCoolingHours: 4,
  // By day the boundary layer is mixed, so it has one wind through its depth: the mean
  // balanced wind of the layer, less this share lost to friction at the ground. The wind at
  // the ground is surfaceWindShare of it, backed by surfaceBackingDeg. At sunset the layer is
  // cut off from the ground and its departure from balance swings freely: the night-time jet.
  mixedLayerFriction: 0.3, surfaceWindShare: 0.75, surfaceBackingDeg: 22,
  // Hot, dry mixed air from the high terrain (elevated mixed layer): where it forms and how
  // much warmer it is at 700 mb than the air it overruns.
  emlSourceTerrainM: 1150, emlWarmthK: 6.5, emlLifetimeDays: 2,
  airMassRelaxationDays: 2,
  // Cold air is heavier and pushes under the warm air next to it like a density current. The
  // colder the air than the warmest air within reach, the faster it pushes, so the cold edge
  // catches up with itself and sharpens into a front, while a retreating edge spreads out.
  // Speed = factor x sqrt(g x depth x deficit / temperature).
  coldPushFactor: 0.4, coldAirDepthM: 1200, coldPushReachCells: 10,
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
    this.gulfSupply = p.gulfMixingRatio;   // mixing ratio of the air offshore now (g/kg)
    this.previousMid = null;
    // The region may slide east (+) or west along the outer model (m/s); see RegionSteering.
    this.slideMs = 0;
    // Reference: the outer model's tropospheric temperature at the map centre, time-mean.
    this.referenceLayerK = model.params.f0 * model.meanThickness(centreY) / (RD * Math.log(3));
    this.world.forEachCell((cell, x, y) => {
      const west = 1 - this.eastShare(x);
      cell.terrain.elevationM = p.terrainEastM + (p.terrainWestM - p.terrainEastM) * west ** p.terrainShape;
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

  // Outer-model fields at a point (bilinear in the channel grid).
  outer(xm, ym) {
    const m = this.model, gx = xm / m.d, gy = ym / m.d - 0.5;
    const i0 = Math.floor(gx), j0 = clamp(Math.floor(gy), 1, m.ny - 3), tx = gx - i0, ty = clamp(gy - j0, 0, 1);
    const out = { upperU: 0, upperV: 0, lowerU: 0, lowerV: 0, layerK: 0, lowPsi: 0, midPsi: 0, north: ym - m.lengthY / 2 };
    for (const [di, dj, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
      const f = m.fieldsAt(((i0 + di) % m.nx + m.nx) % m.nx, j0 + dj);
      out.upperU += w * f.upperWind.u; out.upperV += w * f.upperWind.v; out.lowerU += w * f.lowerWind.u; out.lowerV += w * f.lowerWind.v;
      out.layerK += w * f.layerTemperatureK; out.lowPsi += w * f.lowerDisturbanceStreamfunction; out.midPsi += w * f.midStreamfunction;
    }
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
    const p = this.params, anomaly = outer.layerK - this.referenceLayerK;
    return p.airMassThetaK + (anomaly < 0 ? p.temperatureShare.lowCold : p.temperatureShare.lowWarm) * anomaly + p.plateauWarmthK * this.plateau(terrain);
  }

  // Lee trough: westerly flow descending the high ground lowers the pressure along its foot,
  // most when the mid-level flow crosses it squarely. Returns the pressure change (hPa) and the
  // southerly balanced wind (m/s) it adds near the ground east of the trough axis
  // (v = dp/dx / (rho f)); the trough is shallow and is gone by 700 mb.
  leeTrough(x, outer) {
    const p = this.params, width = p.leeTroughWidthKm * 1000;
    const cross = clamp(this.windAt(outer, 700).u / p.leeFlowMs, 0, 2.5);
    const depthHpa = p.leeTroughFlowHpa * cross;
    const distance = (x + p.geographyOffset - p.leeTroughColumn * ((p.geographyColumns ?? this.nx) - 1)) * this.dx, shape = Math.exp(-((distance / width) ** 2));
    return { pressureHpa: -depthHpa * shape, wind: depthHpa * 100 * shape * 2 * distance / (width * width) / (1.2 * this.model.params.f0) };
  }

  // Depth (m above ground) of the air that is already well mixed. It belongs to the air, not
  // the place: moist air is mixed through most of the moist layer, dry air through a layer
  // that is deep over the high ground (yesterday's mixed layer, the source of the cap).
  airMassDepth(terrain, k) {
    const p = this.params, moistLayer = clamp(p.moistLayerTopM - terrain, 50, 3000);
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
    let pressure = new Float64Array(n);
    this.world.forEachCell((cell, x, y) => {
      const k = y * nx + x, terrain = cell.terrain.elevationM;
      const column = p.plateauWarmthK * this.plateau(terrain) * Math.min(this.airMassDepth(terrain, k), Math.max(600, 3050 - terrain)) + Math.max(this.heat[k], this.residualHeat[k]);   // K m
      pressure[k] = -RHO_AIR * GRAVITY * column / this.theta[k];   // Pa
    });
    const r = p.thermalSmoothingCells;
    for (let pass = 0; pass < 2 && r > 0; pass++) {
      const out = new Float64Array(n);
      for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        let sum = 0, count = 0;
        for (let yy = Math.max(0, y - r); yy <= Math.min(ny - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(nx - 1, x + r); xx++) { sum += pressure[yy * nx + xx]; count++; }
        out[y * nx + x] = sum / count;
      }
      pressure = out;
    }
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
      const speed = p.coldPushFactor * Math.sqrt(GRAVITY * p.coldAirDepthM * Math.max(0, warmest[k] - air[k]) / this.theta[k]) * ramp(size * 1e5, 0.5, 1.5);
      this.coldPushU[k] = size > 0 ? speed * gx / size : 0; this.coldPushV[k] = size > 0 ? speed * gy / size : 0;
    }
  }

  // How far east a column is across the geography (0 at its western edge, 1 at its eastern, and 1 beyond).
  eastShare(x) { const p = this.params; return clamp((x + p.geographyOffset) / ((p.geographyColumns ?? this.nx) - 1), 0, 1); }

  // Moisture of the air entering the map: Gulf air along the south-eastern side, continental
  // air to the north, dry air off the high ground to the west.
  inflowMoisture(x, y) {
    const p = this.params, east = this.eastShare(x), south = y / (this.ny - 1);
    const gulf = (0.45 + 0.55 * south) * ramp(east, 0.1, 0.4);
    return p.dryMixingRatio + (p.continentalMixingRatio - p.dryMixingRatio) * ramp(east, 0.05, 0.3) + (this.gulfSupply - p.continentalMixingRatio) * gulf;
  }

  // Semi-Lagrangian transport by the low-level (or given) wind; air entering takes the
  // properties of its source.
  advect(field, windOf, inflowOf, dt) {
    const { nx, ny, dx } = this, out = new Float64Array(field.length);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const w = windOf(x, y), sx = x - w.u * dt / dx, sy = y + w.v * dt / dx;   // rows count southward
      if (sx < 0 || sy < 0 || sx > nx - 1 || sy > ny - 1) { out[y * nx + x] = inflowOf(clamp(Math.round(sx), 0, nx - 1), clamp(Math.round(sy), 0, ny - 1), x, y); continue; }
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(nx - 1, x0 + 1), y1 = Math.min(ny - 1, y0 + 1), tx = sx - x0, ty = sy - y0;
      out[y * nx + x] = (field[y0 * nx + x0] * (1 - tx) + field[y0 * nx + x1] * tx) * (1 - ty) + (field[y1 * nx + x0] * (1 - tx) + field[y1 * nx + x1] * tx) * ty;
    }
    field.set(out);
  }

  // Heating of the air by the ground (0-1 of its early-afternoon peak) at a local solar hour:
  // it turns positive a while after sunrise and negative again before sunset.
  sunshine(localHour) { return Math.max(0, Math.sin(Math.PI * (localHour - 6.5) / 10.5)); }

  step() {
    const p = this.params, dt = p.stepSeconds;
    if (this.slideMs) {
      // Slide first, then read the heights at the new place before the model moves on, so
      // that their change over the step is the passing weather and not the slide itself.
      const length = this.model.lengthX;
      this.origin.x = ((this.origin.x + this.slideMs * dt) % length + length) % length;
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
    this.coldPush();
    if (dt > 0) {
      // Air masses move with the low-level wind, the elevated mixed layer with the 700 mb wind.
      const lowWind = (x, y) => {
        const k = y * nx + x, w = this.windAt(outers[k], 900), mixed = daytime ? this.momentumMixing(this.mixedDepth[k]) : 0, aloft = this.windAt(outers[k], 700);
        const u = w.u + this.ageoU[k] + 0.85 * this.thermalU[k], v = w.v + this.ageoV[k] + 0.85 * (this.thermalV[k] + this.leeTrough(x, outers[k]).wind);
        return { u: u + mixed * (aloft.u - u) + this.coldPushU[k], v: v + mixed * (aloft.v - v) + this.coldPushV[k] };
      };
      const midWind = (x, y) => this.windAt(outers[y * nx + x], 700);
      this.advect(this.theta, lowWind, (sx, sy) => this.airMassTheta(outers[sy * nx + sx], world.cells[sy][sx].terrain.elevationM), dt);
      // Offshore moisture: scoured by northerly flow across the southern edge, restored by the sea.
      let northerly = 0, count = 0;
      for (let x = Math.floor(0.4 * nx); x < nx; x += 2) { northerly += -lowWind(x, ny - 1).v; count++; }
      const scour = clamp(northerly / count / p.gulfScourWindMs, 0, 1);
      this.gulfSupply += (p.gulfScouredMixingRatio - this.gulfSupply) * scour * clamp(dt / (p.gulfScourHours * 3600), 0, 1) + (p.gulfMixingRatio - this.gulfSupply) * (1 - scour) * clamp(dt / (p.gulfRecoveryDays * DAY), 0, 1);
      this.advect(this.moisture, lowWind, (sx, sy) => this.inflowMoisture(sx, sy), dt);
      this.advect(this.coldPool, lowWind, () => 0, dt);
      this.advect(this.eml, midWind, (sx, sy) => ramp(world.cells[sy][sx].terrain.elevationM, p.emlSourceTerrainM - 300, p.emlSourceTerrainM), dt);
    }

    world.validHourUtc = this.hourUtc;
    world.forEachCell((cell, x, y) => {
      const k = y * nx + x, outer = outers[k], terrain = cell.terrain.elevationM;
      if (dt > 0) {
        // The air mass stays tied to the troposphere above it over a couple of days.
        this.theta[k] += (this.airMassTheta(outer, terrain) - this.theta[k]) * clamp(dt / (p.airMassRelaxationDays * DAY), 0, 1);
        this.eml[k] *= Math.exp(-dt / (p.emlLifetimeDays * DAY));
        this.coldPool[k] *= Math.exp(-dt / 3600 / (daytime ? p.coldPoolRecoveryHoursDay : p.coldPoolRecoveryHoursNight));
      }
      const { pressureHpa: leePressureHpa, wind: leeWind } = this.leeTrough(x, outer);
      // Rain-cooled air is heavier: the pressure under it is higher (the storm's mesohigh).
      const coldPoolHpa = RHO_AIR * GRAVITY * p.coldPoolDepthM * this.coldPool[k] / this.theta[k] / 100;
      const surfacePressure = (1013 + leePressureHpa + this.thermalHpa[k] + coldPoolHpa + this.balancedPressureHpa(outer)) * Math.exp(-terrain / 8434.5);
      const seaLevelPressure = surfacePressure / Math.exp(-terrain / 8434.5);
      const anomaly = outer.layerK - this.referenceLayerK;
      const t700 = p.reference700C + p.temperatureShare[700] * anomaly + p.emlWarmthK * this.eml[k];
      const adiabat500 = (t700 + 273.15) * (500 / 700) ** KAPPA - 273.15, ordinary500 = p.reference500C + p.temperatureShare[500] * anomaly;
      const t500 = ordinary500 + Math.min(0, adiabat500 - ordinary500) * p.emlLapseShare * this.eml[k], t250 = p.reference250C + p.temperatureShare[250] * anomaly;
      const theta700 = (t700 + 273.15) * (1000 / 700) ** KAPPA;

      // --- Boundary layer. The sun heats a mixed layer that first erodes the night's inversion,
      // then deepens through the air mass (potential temperature theta) and into the stable
      // air beneath 700 mb. Depths are above ground.
      const airTheta = this.theta[k], height700 = Math.max(600, 3050 - terrain);
      const moistLayer = clamp(p.moistLayerTopM - terrain, 50, 3000), airMassDepth = this.airMassDepth(terrain, k);
      const lapseAbove = Math.max(0.0015, Math.max(0.5, theta700 - airTheta) / Math.max(300, height700 - airMassDepth));   // K per m above it
      // How dry the air at the ground was a step ago: dry air over dry ground is heated harder,
      // mixes deeper and dries further, which is what sharpens the dryline.
      const dryness = 1 - ramp(this.surfaceMixingRatio[k] || this.moisture[k], p.dryMixingRatio + 1, p.gulfMixingRatio - 3);
      if (dt > 0) {
        if (daytime) this.heat[k] += (p.heatingMoistWm2 + (p.heatingDryWm2 - p.heatingMoistWm2) * dryness) * sun / 1200 * dt;
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
      if (daytime) this.eml[k] = Math.max(this.eml[k], ramp(terrain, p.emlSourceTerrainM - 300, p.emlSourceTerrainM) * ramp(depth, 1200, 2200));
      // Moisture: the mixed layer holds the moist layer's vapour, diluted by the dry air it
      // entrains once it grows deeper than the moist layer.
      const moistDepth = moistLayer;
      const mixingRatio = depth <= moistDepth ? this.moisture[k] : (this.moisture[k] * moistDepth + p.dryMixingRatio * (depth - moistDepth)) / depth;
      this.surfaceMixingRatio[k] = mixingRatio;
      // Where the mixed layer has grown well past the moist layer, the moisture is carried up
      // and away on the stronger winds aloft: the moist layer itself erodes there by day (and is
      // replaced from the east and south at night, when the dryline retreats).
      if (dt > 0 && daytime && depth > 1.15 * moistDepth) this.moisture[k] += (mixingRatio - this.moisture[k]) * clamp(dt / 3600, 0, 1);
      const temperatureK = (surfaceTheta - this.coldPool[k]) * (surfacePressure / 1000) ** KAPPA;
      const dewpointK = Math.min(temperatureK, dewpointFromMixingRatio(mixingRatio, surfacePressure));

      // --- Winds. Above the boundary layer the wind is the balanced wind. Within it by day the
      // wind is the layer's own (see mixedLayerFriction); at night the layer is cut off from
      // the ground and its departure from balance rotates freely.
      const geo850 = this.windAt(outer, 850), geoSurface = this.windAt(outer, 1000);
      // The pressure pattern owed to the low-level air fades upward through that air.
      const z850 = Math.max(0, 1460 - terrain), thermalShare850 = clamp(1 - z850 / height700, 0, 1);
      geo850.u += thermalShare850 * this.thermalU[k]; geo850.v += 0.7 * leeWind + thermalShare850 * this.thermalV[k];
      geoSurface.u += this.thermalU[k]; geoSurface.v += leeWind + this.thermalV[k];
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
      const drag = daytime ? p.surfaceWindShare : 0.4, turn = (daytime ? p.surfaceBackingDeg : 38) * Math.PI / 180;
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
      cell.features.emlInfluence = this.eml[k]; cell.features.mixedLayerDepthM = depth;
      // The cap air is well mixed from its base to 700 mb, so its base is warmer than 700 mb by
      // the dry-adiabatic difference between the two pressures.
      cell.features.emlBaseExcessC = (t700 + 273.15) * ((780 / 700) ** KAPPA - 1) * 0.9;
      // How much this is warm, moist air that the boundary layer has not mixed out (0-1).
      cell.features.warmSector = ramp(this.moisture[k], 9, 13) * (1 - ramp(depth / moistDepth, 1.3, 1.9));
      // How hard the ground is heating the air now, against the most it does over dry ground (0-1).
      cell.features.surfaceHeating = daytime ? (p.heatingMoistWm2 + (p.heatingDryWm2 - p.heatingMoistWm2) * dryness) * sun / p.heatingDryWm2 : 0;
      if (p.diagnostics) updateCellDiagnostics(cell);
    });
    this.previousMid = Float64Array.from(outers, o => o.midPsi);
  }

  // Share of the mid-level wind mixed down to the ground by a mixed layer of this depth (m).
  momentumMixing(depth) { return 0.7 * ramp(depth, 1800, 3000); }

  referenceMidPsi() { return this.midReference ??= this.outer(this.origin.x + this.nx * this.dx / 2, this.origin.y + this.ny * this.dx / 2).midPsi; }

  // Potential temperature of the mixed layer for the heat put in so far, and its depth.
  // Profile above ground: a night inversion in the lowest 300 m, the well-mixed air mass up
  // to airMassDepth, then stable air with potential temperature rising at lapseAbove.
  surfaceTheta(k, airTheta, airMassDepth, lapseAbove) {
    const inversion = Math.max(0, airTheta - (this.eveningTheta[k] - this.params.nightCoolingK * 0.8));
    const inversionHeat = 0.5 * 300 * inversion;            // K m needed to erode the night inversion
    const heat = this.heat[k];
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

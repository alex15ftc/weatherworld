// Where the 500-mile region sits in the large-scale model. That model is the whole country;
// the region (and its terrain with it) slides east or west along the wave train so that the
// large-scale weather wanted for the day is over it by the afternoon.
//
// Nothing in the region is moved: its air, storms and cold pools stay on the map. Only the
// place where the region reads the large-scale model slides, and never faster than the weather
// systems themselves travel. Seen from the map, a system lingers (the region riding east with
// it) or crosses sooner (the region sliding west to meet the next one); it never backs up.
//
// Once a day a copy of the large-scale model is run ahead to the coming afternoon and evening
// (the model is deterministic, so this is exact) and the slide speed for the next 24 hours is
// the one that puts the region closest to the large-scale support wanted that day.
import { QuasiGeostrophicModel } from '../atmosphere/QuasiGeostrophicModel.js';
import { clamp } from '../scenarios/math.js';

export const STEERING_DEFAULTS = Object.freeze({
  planHourUtc: 6,                  // after the evening's storms (local midnight)
  scoreHoursUtc: [21, 2],          // the afternoon and the evening the plan is judged on
  // Speed of the weather systems (m/s, eastward): the most the region may slide either way.
  // (15 until 2026-10-23; with the jet stream the systems move about 15 m/s, not 22.)
  // (10 until 2026-10-28: 15 lets the map stay with a system through its afternoon more often.)
  systemSpeedMs: 15, speedStepMs: 1,
  // Large-scale support: wind aloft times low-level flow from the south, each up to a cap.
  // 0 to 1 ahead of a trough; below 0 where the low-level flow is from the north (behind a
  // trough: a wanted value below 0 lets its cold front sweep the region).
  windCapKt: 70, southerlyCapKt: 25,
  // ...less where the outer model's air near the ground is drier than usual: none where it is
  // dryGkg below the mean (2026-10-16). Southerly flow under strong wind aloft right behind a
  // front has not yet brought the moisture back, and aiming there made dry, quiet days.
  // (dryGkg is used only when moistRangeGkg is null.)
  dryGkg: 4,
  // Moisture ramp (2026-11-17): the support scales with the outer model's moisture over the map about its mean,
  // from none at moistRangeGkg[0] to all of it at [1], in place of the dry cut, which gave average and very moist
  // air the same support. Over 80 days of the regression suite the map's moisture tracked tornado counts (rank
  // 0.50) where the support did not (0.13), and lull days sat on the jet's cold, dry flank, which the dry cut
  // scored well. With [-2, 4]: below Slight 13.8 to 6.3%, Enhanced 27.5 to 38.8%, Moderate 22.5 to 20%, High 3.8
  // to 6.3%, runs of 2+ below Slight 5 to 0%; wind and hail report counts rose past tolerance (wind 90th 213 to
  // 320, hail median 120 to 190; the owner accepted). warmRangeK does the same with warmth (null: off; with
  // [-6, 6] as well, lulls a little fewer but the category mix no better).
  moistRangeGkg: [-2, 4], warmRangeK: null,
  // The support wanted on a day is drawn evenly between these (the same for a given seed and day).
  // (0.35-0.8 until 2026-10-16. With the outer model's systems slowed and weakened, the support
  // reached is seldom above 0.35, so steering just took the most it could every day and the
  // wanted value meant nothing; 0.2-0.35 is a real choice between moderate and strong places.)
  // (2026-10-28, the outbreak climate: 1 and 1, so every day aims at the strongest support it can
  // reach. The world is a storm-chasing game, and every day should be an active one; with 0.2-0.35
  // a quarter of days had no tornado.)
  wantedLow: 1, wantedHigh: 1,
  // The map's place along the geography (cells east of its western edge; see the regional
  // layer's geographyOffset). Given both roamLow and roamHigh, each day the map is sent
  // roamStep cells one way or the other within that range, at no more than roamCellsPerHour, so the dryline and
  // the storms that form along it fall on a different part of the map from day to day, and
  // on every part of it over many days. With null the map stays where it is: the default, as
  // the Roblox world's ground is fixed and must be the ground the weather is made over (roaming
  // was -6 to 30).
  roamLow: null, roamHigh: null, roamStep: [5, 15], roamCellsPerHour: 0.7,
  // What kind of place in the weather each day aims for (shares; 2026-10-16). warmSector: the
  // large-scale support above (southerly flow under strong wind aloft, ahead of a trough).
  // nearLow: a surface low of at least lowDepthHpa (against its surroundings 480 km out) with
  // the map's middle lowOffsetKm from it (east, north): the low near the map's north-west
  // corner, its warm front and the dryline crossing the map, the triple point between.
  // upperLow: the middle of an upper trough or low (the 500 mb disturbance at least
  // upperLowDepthM deep; the mean westerlies seldom let one close off in this model) with the
  // map's middle upperLowOffsetKm from it: cold-core days. Where no such low can be reached to within
  // maxMissKm, the day aims for the warm sector instead. The map may slide north or south at
  // up to northSpeedMs; only the weather overhead changes with it (RegionalAtmosphere).
  kinds: { warmSector: 0.55, nearLow: 0.3, upperLow: 0.15 },
  lowDepthHpa: 2, lowOffsetKm: [0, -100], upperLowDepthM: 20, upperLowOffsetKm: [150, -100],
  maxMissKm: 500, northSpeedMs: 8, northStepMs: 2,
  // How far north or south of its home latitude (the jet's core) the map may be slid (km), and,
  // among slides that do equally well, the one ending the day nearest home is taken: the map goes
  // to a jet's flank or under a cut-off low when the day aims there, and comes back after.
  // (2026-10-23; before, the least north-south slide was taken, and nothing brought the map back.)
  homeReachKm: 1500,
  // Hours between fresh aims on a day aimed at a low (see reaim).
  reaimHours: 6,
  // Days beyond the coming one a warm-sector plan looks at (0: the coming afternoon and evening alone).
  // With 1 or 2, today's slide is the one that, with the best slides open on the following days
  // (east-west, at the latitude today's slide ends on), comes nearest the support wanted over all of
  // them, each day counted alike: a weaker afternoon now may put the map in reach of the next system.
  // (2026-11-15; 1 since 2026-11-16: with homePull, over 8 seeds x 80 days the days in runs of 2+ below
  // Slight fell from 2.66 to 1.25%, with no regressions. The copy runs a day further each morning: ~0.8 s a plan.)
  lookAheadDays: 1,
  // Support given up for each 1000 km a warm-sector slide leaves the map from its home latitude (0: none).
  // The map keeps its home climate wherever it slides, but the jet's core is at home: off it, the mean
  // westerlies and shear are the flank's. (2026-11-16: the live world's warm-sector plans took the map
  // ~1350 km north on 11/15 Days 2-3 by small gains in support, and it sat on the jet's flank with
  // 16-34 kt at 500 mb through a four-day lull while the jet ran 157-164 kt.)
  // (Not done, 2026-11-16: keeping a low-aimed day only while its slide reached 25-70% of the best
  // warm-sector slide's support. Low-aimed slides seldom reach a quarter of it, so nearly every day became a
  // warm-sector day, and the regression suite's EF0/EF1 shares and tornado CIG1+ days regressed.)
  homePull: 0.15,
  // Lift (2026-11-18): the share of a warm-sector place's support that rests on the outer model's large-scale
  // ascent there (its omega: vorticity advection, warm advection and friction), averaged over the liftHours before
  // each time the plan is judged on. That share rises smoothly from none at liftRangeKh[0] (K/h of cooling by
  // rising air) to all of it at [1]. Wind aloft over moist southerly flow scores a trough's whole downstream side
  // alike; the lift picks out where the trough is actually lifting the air (the jet's exit region, the
  // vorticity advection ahead of the wave). 0: off. Under strongly supported places the 6-hour ascent runs about
  // 0.09 K/h (median) to 0.21 (top tenth). Regression suite, 8 seeds x 10 days against 0: with 0.5 no regressions,
  // MDT+HIGH 22.5 to 28.8% (target 25), below Slight 6.25 to 5%, tornado CIG3+ days 2.5 to 5%; with 1, EF4+ share
  // (0.64 to 1.37%) and tornado CIG3+ days (8.75%) regressed.
  liftShare: 0.5, liftRangeKh: [0, 0.2], liftHours: 6
});

const KT = 1.943844;

export class RegionSteering {
  constructor(regional, seed, options = {}) {
    this.regional = regional; this.seed = seed;
    this.params = { ...STEERING_DEFAULTS, ...options };
    this.lastPlanDay = null; this.plan = null; this.scratch = null;
  }

  // Call after each step of the regional layer: plans when the planning hour comes round.
  update() {
    const hour = this.regional.hourUtc, day = Math.floor((hour - this.params.planHourUtc) / 24);
    if (this.lastPlanDay === null || day > this.lastPlanDay) { this.lastPlanDay = day; this.makePlan(); }
    else if (this.plan && (this.plan.kind === 'nearLow' || this.plan.kind === 'upperLow') && hour - (this.plan.aimedHourUtc ?? this.plan.hourUtc) >= this.params.reaimHours - 1e-6) this.reaim();
  }

  // On a day aimed at a low, the slide is worked out again every reaimHours from a fresh look
  // ahead, so the map follows the low as it turns or slows. (2026-10-20: one slide held all day
  // missed its low by a median of 219 km, and the low was on the map's edge on 9 of 16 such days.)
  reaim() {
    const regional = this.regional, p = this.params, kind = this.plan.kind, { copy, fields } = this.forecastFields();
    const aimed = this.aimAtLow(copy, fields, kind === 'nearLow' ? 'lows' : 'upperLows', kind === 'nearLow' ? p.lowOffsetKm : p.upperLowOffsetKm);
    if (aimed) { regional.slideMs = aimed.speed; regional.slideNorthMs = aimed.north; this.plan = { ...this.plan, missKm: Math.round(aimed.miss / 1000), slideMs: aimed.speed, slideNorthMs: aimed.north }; }
    this.plan.aimedHourUtc = regional.hourUtc;
  }

  // A copy of the outer model run ahead to each time the plan is judged on, with the support,
  // lows and upper lows there.
  // With extraDays, the same times on each of the following days too (field.day 1, 2, ...); their
  // support is read where today's slide leaves the map (north for its 24 hours, then staying there).
  forecastFields(extraDays = 0) {
    const p = this.params, now = this.regional.hourUtc;
    const today = p.scoreHoursUtc.map(h => ((h - now) % 24 + 24) % 24 || 24).sort((a, b) => a - b), fields = [];
    const ahead = [];
    for (let day = 0; day <= extraDays; day++) for (const hours of today) ahead.push({ day, hours: hours + 24 * day });
    const norths = [];
    for (let north = -p.northSpeedMs; north <= p.northSpeedMs + 1e-9; north += p.northStepMs) if (this.withinReach(north)) norths.push(north);
    const copy = this.runAhead(ahead.map(a => a.hours), (model, i) => {
      const { day, hours } = ahead[i];
      fields.push({ day, hours, supportByNorth: new Map(norths.map(north => [north, this.supportByColumn(model, north * Math.min(hours, 24) * 3600)])), lows: day ? [] : this.findLows(model, 'surface'), upperLows: day ? [] : this.findLows(model, 'upper') });
    });
    return { copy, fields: fields.filter(f => f.day === 0), later: fields.filter(f => f.day > 0), norths };
  }

  // A copy of the outer model run ahead through each of hoursList (ascending, hours from now), visit(model, i)
  // at each. Returns the copy.
  runAhead(hoursList, visit) {
    const regional = this.regional, live = regional.model;
    const copy = this.scratch ??= new QuasiGeostrophicModel(live.params);
    for (const key of ['q1', 'q2', 'psi1', 'psi2', 'moisture', 'surfaceTheta', 'surfaceMoisture']) if (live[key]) copy[key].set(live[key]);
    copy.time = live.time; copy.history = live.history;   // the model replaces these arrays, never writes into them
    copy.fastTransforms = live.fastTransforms;
    let advanced = 0;
    // The last liftHours before each time are an advance of their own, so the copy's ascent is theirs (the steps
    // taken are the same either way: the hours are whole and the model's step divides an hour).
    const liftHours = Math.max(0, Math.round(this.params.liftHours ?? 0));
    hoursList.forEach((hours, i) => {
      const last = Math.min(liftHours, hours - advanced);
      if (hours - advanced - last > 0) copy.advance((hours - advanced - last) * 3600 * regional.params.tempo);
      if (last > 0) copy.advance(last * 3600 * regional.params.tempo);
      advanced = hours; visit(copy, i);
    });
    return copy;
  }

  // Large-scale support along the belt at one time of the copy: for each column of the model,
  // the support a region whose west edge is there would have (northM: with the region that far
  // north of where it is).
  supportByColumn(model, northM = 0) {
    const regional = this.regional, p = this.params, { nx, d } = model;
    const span = Math.max(1, Math.round(regional.nx * regional.dx / d)), j0 = Math.floor((regional.origin.y + northM) / d);
    const mid = new Float64Array(nx), south = new Float64Array(nx), wet = new Float64Array(nx), warm = new Float64Array(nx), lift = new Float64Array(nx);
    // The mean moisture and warmth fall northward: a slide north is a move into drier, cooler air.
    const meanWet = -(model.params.surfaceMoistureGradientGkgPer1000Km ?? 0) * northM / 1e6;
    const meanWarm = -(model.params.surfaceGradientKPer1000Km ?? 0) * northM / 1e6;
    const ramp = (v, range) => clamp((v - range[0]) / (range[1] - range[0]), 0, 1);
    for (let i = 0; i < nx; i++) {
      for (let dj = 0; dj < span; dj++) {
        const f = model.fieldsAt(i, j0 + dj);
        mid[i] += Math.hypot(f.midWind.u, f.midWind.v) * KT / span; south[i] += f.lowerWind.v * KT / span;
        wet[i] += ((f.surfaceMoistureGkg ?? 0) + meanWet) / span; warm[i] += ((f.surfaceThetaK ?? 0) + meanWarm) / span;
        lift[i] += (f.ascentCoolingKh ?? 0) / span;
      }
    }
    const support = new Float64Array(nx), liftShare = clamp(p.liftShare ?? 0, 0, 1);
    for (let i = 0; i < nx; i++) {
      let m = 0, s = 0, q = 0, t = 0, a = 0;
      for (let di = 0; di < span; di++) { m += mid[(i + di) % nx] / span; s += south[(i + di) % nx] / span; q += wet[(i + di) % nx] / span; t += warm[(i + di) % nx] / span; a += lift[(i + di) % nx] / span; }
      support[i] = Math.min(m, p.windCapKt) / p.windCapKt * clamp(s, -p.southerlyCapKt, p.southerlyCapKt) / p.southerlyCapKt;
      if (support[i] > 0) {
        // With moistRangeGkg, the air's moisture about its mean rises smoothly from none at the range's low end to all
        // the support at its high end (in place of the dry cut); with warmRangeK, its warmth the same way.
        support[i] *= p.moistRangeGkg ? ramp(q, p.moistRangeGkg) : clamp(1 + q / p.dryGkg, 0, 1);
        if (p.warmRangeK) support[i] *= ramp(t, p.warmRangeK);
        // With liftShare, that share of the support comes only with the large-scale ascent (see liftShare).
        if (liftShare > 0) support[i] *= 1 - liftShare + liftShare * ramp(a, p.liftRangeKh);
      }
    }
    return support;
  }

  makePlan() {
    const regional = this.regional, p = this.params, now = regional.hourUtc;
    // The outer model run ahead to each time the plan is judged on, and the north-south slides tried (m/s).
    const lookAhead = Math.max(0, Math.round(p.lookAheadDays ?? 0));
    const { copy, fields, later, norths } = this.forecastFields(lookAhead);
    const wantedOn = d => p.wantedLow + (p.wantedHigh - p.wantedLow) * unit(`${this.seed}|steer|${d}`);
    const day = Math.floor((now - p.planHourUtc) / 24), wanted = wantedOn(day);
    // The kind of day aimed for.
    const draw = unit(`${this.seed}|kind|${day}`), shares = Object.entries(p.kinds), total = shares.reduce((s, [, v]) => s + v, 0);
    let kind = shares[0][0], acc = 0;
    for (const [name, share] of shares) { acc += share / total; if (draw < acc) { kind = name; break; } }
    const aimed = kind === 'warmSector' ? null : this.aimAtLow(copy, fields, kind === 'nearLow' ? 'lows' : 'upperLows', kind === 'nearLow' ? p.lowOffsetKm : p.upperLowOffsetKm);
    const at = (support, xm) => { const g = ((xm / copy.d) % copy.nx + copy.nx) % copy.nx, i = Math.floor(g), t = g - i; return support[i] * (1 - t) + support[(i + 1) % copy.nx] * t; };
    const start = regional.origin.x + (regional.timingLeadM ?? 0);
    if (aimed) {
      regional.slideMs = aimed.speed; regional.slideNorthMs = aimed.north;
      this.plan = { hourUtc: now, day, kind, missKm: Math.round(aimed.miss / 1000), slideMs: aimed.speed, slideNorthMs: aimed.north, geographyTarget: regional.geographyTarget };
      return this.plan;
    }
    regional.slideNorthMs = 0;
    if (kind !== 'warmSector') kind = `warmSector (no ${kind} in reach)`;
    const best = this.warmSectorSlide({ fields, later, norths, lookAhead, wantedOn, day, wanted, at, start });
    regional.slideMs = best.speed; regional.slideNorthMs = best.north;
    if (Number.isFinite(p.roamLow) && Number.isFinite(p.roamHigh)) {
      // A day's move of roamStep cells one way or the other from where the map was heading,
      // turned back at the ends of the range: every place in the range comes up equally often,
      // and each day is some way from the last.
      const stride = (p.roamStep[0] + (p.roamStep[1] - p.roamStep[0]) * unit(`${this.seed}|roam|${day}`)) * (unit(`${this.seed}|roam-way|${day}`) < 0.5 ? -1 : 1);
      let next = clamp(regional.geographyTarget, p.roamLow, p.roamHigh) + stride;
      if (next > p.roamHigh) next = 2 * p.roamHigh - next;
      if (next < p.roamLow) next = 2 * p.roamLow - next;
      regional.geographyTarget = clamp(next, p.roamLow, p.roamHigh); regional.geographyRate = p.roamCellsPerHour;
    }
    this.plan = { hourUtc: now, day, kind, wanted, support: best.support, slideMs: best.speed, slideNorthMs: best.north, geographyTarget: regional.geographyTarget };
    return this.plan;
  }

  // The warm-sector slide: east-west and north-south, the one whose support comes nearest the day's wanted value,
  // less homePull for each 1000 km the day's slide leaves the map from its home latitude (see homePull).
  warmSectorSlide({ fields, later, norths, lookAhead, wantedOn, day, wanted, at, start }) {
    const p = this.params;
    // The slide, east-west and north-south, that brings the support nearest the day's wanted
    // value (the least north-south slide among equals: only the weather overhead changes with it).
    // With lookAheadDays, a slide is also judged by the best the following days can then reach
    // (each day's miss added; see lookAheadDays).
    const speeds = [];
    for (let speed = -p.systemSpeedMs; speed <= p.systemSpeedMs + 1e-9; speed += p.speedStepMs) speeds.push(speed);
    const laterByDay = Array.from({ length: lookAhead }, (_, i) => later.filter(f => f.day === i + 1));
    const laterMiss = (d, north, x) => {
      if (d > lookAhead) return 0;
      const list = laterByDay[d - 1], want = wantedOn(day + d);
      let least = Infinity;
      for (const speed of speeds) {
        let support = 0;
        for (const field of list) support += at(field.supportByNorth.get(north), x + speed * (field.hours - 24 * d) * 3600) / list.length;
        least = Math.min(least, Math.abs(support - want) + laterMiss(d + 1, north, x + speed * 86400));
      }
      return least;
    };
    let best = null;
    for (const north of norths) for (const speed of speeds) {
      let support = 0;
      for (const field of fields) support += at(field.supportByNorth.get(north), start + speed * field.hours * 3600) / fields.length;
      const miss = Math.abs(support - wanted) + (lookAhead ? laterMiss(1, north, start + speed * 86400) : 0) + (p.homePull ?? 0) * this.fromHome(north) / 1e6;
      if (!best || miss < best.miss - 0.01 || (Math.abs(miss - best.miss) <= 0.01 && this.fromHome(north) < this.fromHome(best.north))) best = { speed, north, support, miss };
    }
    return best;
  }

  // Lows in the copy at one time: surface lows (the lower layer's pressure) or the middle of
  // upper troughs and lows (the mid-level disturbance), each a local minimum at least so deep
  // against its surroundings 480 km out. Positions in metres in the channel.
  findLows(model, which) {
    const { nx, ny, d } = model, p = this.params, f0 = model.params.f0, field = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      // hPa for the surface, metres of height for 500 mb.
      field[k] = which === 'surface' ? 1.2 * f0 * model.psi2[k] / 100 : f0 * (model.psi1[k] + model.psi2[k]) / 2 / 9.81;
    }
    const lows = [], need = which === 'surface' ? p.lowDepthHpa : p.upperLowDepthM;
    for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx; i++) {
      const v = field[j * nx + i]; let lowest = true;
      for (let dj = -2; dj <= 2 && lowest; dj++) for (let di = -2; di <= 2; di++) if ((di || dj) && field[model.index(i + di, Math.min(ny - 1, Math.max(0, j + dj)))] < v) { lowest = false; break; }
      if (!lowest) continue;
      let ring = 0; for (let a = 0; a < 16; a++) ring += field[model.index(i + Math.round(6 * Math.cos(a * Math.PI / 8)), Math.min(ny - 1, Math.max(0, j + Math.round(6 * Math.sin(a * Math.PI / 8)))))] / 16;
      if (ring - v >= need) lows.push({ x: (i + 0.5) * d, y: (j + 0.5) * d, depth: ring - v });
    }
    return lows;
  }

  // The slide (m/s east and north) that best brings the map's middle to offsetKm from one of the
  // lows at the times the plan is judged on; null when none comes within maxMissKm.
  aimAtLow(model, fields, key, offsetKm) {
    const regional = this.regional, p = this.params, Lx = model.lengthX, Ly = model.lengthY;
    const cx = regional.origin.x + (regional.timingLeadM ?? 0) + regional.nx * regional.dx / 2, cy = regional.origin.y + regional.ny * regional.dx / 2;
    const wrap = (v, L) => ((v % L) + L + L / 2) % L - L / 2;
    let best = null;
    for (let speed = -p.systemSpeedMs; speed <= p.systemSpeedMs + 1e-9; speed += p.speedStepMs) for (let north = -p.northSpeedMs; north <= p.northSpeedMs + 1e-9; north += p.northStepMs) {
      if (!this.withinReach(north)) continue;
      let miss = 0;
      for (const field of fields) {
        const x = cx + speed * field.hours * 3600, y = cy + north * field.hours * 3600;
        let nearest = Infinity;
        for (const low of field[key]) nearest = Math.min(nearest, Math.hypot(wrap(x - low.x - offsetKm[0] * 1000, Lx), wrap(y - low.y - offsetKm[1] * 1000, Ly)));
        miss += nearest / fields.length;
      }
      if (!best || miss < best.miss - 1 || (Math.abs(miss - best.miss) <= 1 && this.fromHome(north) < this.fromHome(best.north))) best = { speed, north, miss };
    }
    return best && best.miss <= p.maxMissKm * 1000 ? best : null;
  }

  // How far from its home latitude (m) the map would be after a day's slide north at this speed, and
  // whether that is within homeReachKm (or nearer home than now).
  fromHome(northMs) { const r = this.regional; return Math.abs(r.origin.y - (r.homeY ?? r.origin.y) + northMs * 86400); }
  withinReach(northMs) { const r = this.regional, now = Math.abs(r.origin.y - (r.homeY ?? r.origin.y)); return this.fromHome(northMs) <= Math.max(this.params.homeReachKm * 1000, now); }

  saveState() { return { params: this.params, lastPlanDay: this.lastPlanDay, plan: this.plan }; }
  restoreState(state) { this.lastPlanDay = state.lastPlanDay; this.plan = state.plan; }
}

function unit(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

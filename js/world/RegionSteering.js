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
  systemSpeedMs: 22, speedStepMs: 1,
  // Large-scale support: wind aloft times low-level flow from the south, each up to a cap.
  // 0 to 1 ahead of a trough; below 0 where the low-level flow is from the north (behind a
  // trough: a wanted value below 0 lets its cold front sweep the region).
  windCapKt: 70, southerlyCapKt: 25,
  // The support wanted on a day is drawn evenly between these (the same for a given seed and day).
  wantedLow: 0.35, wantedHigh: 0.8,
  // Where on the map the day's weather is wanted. With focusWidth above 0 the support is
  // wanted in a band that wide (a share of the map's width) centred on a place drawn for the
  // day between focusRange (0 = the west edge, 1 = the east edge), and unwanted over the rest
  // of the map (restWeight). Over many days every part of the map gets its turn. With 0 the
  // support is wanted over the map as a whole.
  focusWidth: 0, focusRange: [0.15, 0.85], restWeight: 0.5,
  // The map's place along the geography (cells east of its western edge; see the regional
  // layer's geographyOffset). Given both roamLow and roamHigh, each day the map is sent
  // roamStep cells one way or the other within that range, at no more than roamCellsPerHour, so the dryline and
  // the storms that form along it fall on a different part of the map from day to day, and
  // on every part of it over many days. With null the map stays where it is.
  roamLow: -6, roamHigh: 30, roamStep: [5, 15], roamCellsPerHour: 0.7
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
  }

  // Large-scale support along the belt at one time of the copy: for each column of the model,
  // the support a region whose west edge is there would have.
  supportByColumn(model) {
    const regional = this.regional, p = this.params, { nx, d } = model;
    const span = Math.max(1, Math.round(regional.nx * regional.dx / d)), j0 = Math.floor(regional.origin.y / d);
    const mid = new Float64Array(nx), south = new Float64Array(nx);
    for (let i = 0; i < nx; i++) {
      for (let dj = 0; dj < span; dj++) { const f = model.fieldsAt(i, j0 + dj); mid[i] += Math.hypot(f.midWind.u, f.midWind.v) * KT / span; south[i] += f.lowerWind.v * KT / span; }
    }
    const support = new Float64Array(nx), column = new Float64Array(nx);
    for (let i = 0; i < nx; i++) {
      let m = 0, s = 0;
      for (let di = 0; di < span; di++) { m += mid[(i + di) % nx] / span; s += south[(i + di) % nx] / span; }
      support[i] = Math.min(m, p.windCapKt) / p.windCapKt * clamp(s, -p.southerlyCapKt, p.southerlyCapKt) / p.southerlyCapKt;
      // The same for this one column of the model (the region's rows only).
      column[i] = Math.min(mid[i], p.windCapKt) / p.windCapKt * clamp(south[i], -p.southerlyCapKt, p.southerlyCapKt) / p.southerlyCapKt;
    }
    support.column = column;
    return support;
  }

  makePlan() {
    const regional = this.regional, live = regional.model, p = this.params, now = regional.hourUtc;
    const copy = this.scratch ??= new QuasiGeostrophicModel(live.params);
    for (const key of ['q1', 'q2', 'psi1', 'psi2']) copy[key].set(live[key]);
    copy.time = live.time; copy.history = live.history;   // the model replaces these arrays, never writes into them
    // Hours from now to each time the plan is judged on, soonest first.
    const ahead = p.scoreHoursUtc.map(h => ((h - now) % 24 + 24) % 24 || 24).sort((a, b) => a - b), fields = [];
    let advanced = 0;
    for (const hours of ahead) { copy.advance((hours - advanced) * 3600 * regional.params.tempo); advanced = hours; fields.push({ hours, support: this.supportByColumn(copy) }); }
    const day = Math.floor((now - p.planHourUtc) / 24), wanted = p.wantedLow + (p.wantedHigh - p.wantedLow) * unit(`${this.seed}|steer|${day}`);
    const at = (support, xm) => { const g = ((xm / copy.d) % copy.nx + copy.nx) % copy.nx, i = Math.floor(g), t = g - i; return support[i] * (1 - t) + support[(i + 1) % copy.nx] * t; };
    // The day's place on the map (a share of its width from the west edge), and the support
    // inside the band around it and over the rest of the map for a region whose west edge is at xm.
    const focused = p.focusWidth > 0, target = focused ? p.focusRange[0] + (p.focusRange[1] - p.focusRange[0]) * unit(`${this.seed}|focus|${day}`) : null;
    const width = regional.nx * regional.dx, SAMPLES = 10;
    const split = (support, xm) => {
      let inside = 0, insideCount = 0, outside = 0, outsideCount = 0;
      for (let k = 0; k < SAMPLES; k++) {
        const share = (k + 0.5) / SAMPLES, value = at(support.column, xm + share * width);
        if (Math.abs(share - target) <= p.focusWidth / 2) { inside += value; insideCount++; } else { outside += value; outsideCount++; }
      }
      return { inside: insideCount ? inside / insideCount : at(support.column, xm + target * width), outside: outsideCount ? outside / outsideCount : 0 };
    };
    let best = null;
    for (let speed = -p.systemSpeedMs; speed <= p.systemSpeedMs + 1e-9; speed += p.speedStepMs) {
      let support = 0, rest = 0;
      for (const field of fields) {
        const xm = regional.origin.x + speed * field.hours * 3600;
        if (focused) { const part = split(field.support, xm); support += part.inside / fields.length; rest += part.outside / fields.length; }
        else support += at(field.support, xm) / fields.length;
      }
      const miss = Math.abs(support - wanted) + (focused ? p.restWeight * Math.max(0, rest) : 0);
      if (!best || miss < best.miss - 1e-9) best = { speed, support, rest, miss };
    }
    regional.slideMs = best.speed;
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
    this.plan = { hourUtc: now, day, wanted, support: best.support, slideMs: best.speed, target, rest: focused ? best.rest : null, geographyTarget: regional.geographyTarget };
    return this.plan;
  }

  saveState() { return { params: this.params, lastPlanDay: this.lastPlanDay, plan: this.plan }; }
  restoreState(state) { this.lastPlanDay = state.lastPlanDay; this.plan = state.plan; }
}

function unit(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

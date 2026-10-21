// The storm reports and damage surveys pages' data, from the live world's storm log
// (js/reports/stormLog.js): the days it holds, each day's reports, and each day's tornadoes as
// surveyed (js/reports/damageSurvey.js). A tornado's survey is worked out when it is asked for
// and kept until its track grows.
import { logDays } from '../js/reports/stormLog.js';
import { surveyTornado } from '../js/reports/damageSurvey.js';
import { surveyMap } from '../js/reports/surveyMap.node.js';

export class ReportsRuntime {
  constructor({ runtime }) { this.runtime = runtime; this.surveys = new Map(); this.engine = null; }

  get log() {
    const engine = this.runtime.engine;
    if (engine !== this.engine) { this.engine = engine; this.surveys.clear(); }
    return engine?.world?.reportLog ?? null;
  }

  nowHourUtc() { const w = this.runtime.engine?.world; return w ? (w.stormEngine?.validHourUtc ?? w.validHourUtc) : null; }

  days() { return { nowHourUtc: this.nowHourUtc(), currentDay: this.log?.day ?? null, days: logDays(this.log) }; }

  reports(day) {
    const log = this.log, d = log?.days?.[day ?? log?.day];
    return { nowHourUtc: this.nowHourUtc(), day: d?.day ?? null, startHourUtc: d?.startHourUtc ?? null, miles: this.runtime.places?.layer?.miles ?? null, reports: d?.reports ?? [] };
  }

  damage(day) {
    const log = this.log, d = log?.days?.[day ?? log?.day];
    const map = surveyMap(Number(process.env.WORLD_MAP_SEED ?? 1)), seed = this.runtime.seed ?? 1;
    const tornadoes = (d?.tornadoes ?? []).filter(t => t.points.length).map(t => {
      const key = `${t.id}|${t.points.length}|${t.ended}`, known = this.surveys.get(t.id);
      if (known?.key === key) return known.survey;
      const survey = surveyTornado(t, map, this.runtime.places, seed);
      this.surveys.set(t.id, { key, survey });
      return survey;
    });
    return { nowHourUtc: this.nowHourUtc(), day: d?.day ?? null, startHourUtc: d?.startHourUtc ?? null, miles: this.runtime.places?.layer?.miles ?? null, tornadoes };
  }
}

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
    const tornadoes = (d?.tornadoes ?? []).filter(t => t.points.length).map(t => this.survey(t));
    return { nowHourUtc: this.nowHourUtc(), day: d?.day ?? null, startHourUtc: d?.startHourUtc ?? null, miles: this.runtime.places?.layer?.miles ?? null, tornadoes };
  }

  // One logged tornado's survey (worked out again only when its track has grown).
  survey(entry) {
    const key = `${entry.id}|${entry.points.length}|${entry.ended}`, known = this.surveys.get(entry.id);
    if (known?.key === key) return known.survey;
    const survey = surveyTornado(entry, surveyMap(Number(process.env.WORLD_MAP_SEED ?? 1)), this.runtime.places, this.runtime.seed ?? 1);
    this.surveys.set(entry.id, { key, survey });
    return survey;
  }

  // The tornadoes of a day that have lifted and so can be surveyed for good.
  ended(day) { return (this.log?.days?.[day]?.tornadoes ?? []).filter(t => t.ended && t.points.length); }
}

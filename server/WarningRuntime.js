// Issues tornado and severe thunderstorm warnings for the live world (js/forecast/Warning.js).
// They are worked out at each new volume scan, every 5 minutes of storm time, from the storms
// as the radar sees them; nothing is run ahead. Call update() often: it does nothing until the
// storms have moved on.
import { WARNING, createWarningState, updateWarnings, publicWarning } from '../js/forecast/Warning.js';
import { radarSitesFor } from './RadarSites.js';
import { countiesFor } from './CountyLayer.js';

export class WarningRuntime {
  constructor({ runtime }) { this.runtime = runtime; this.adopt(null); }

  // A new world starts its own series.
  adopt(engine) { this.engine = engine; this.state = createWarningState(engine ? countiesFor(engine.world) : null); this.sites = engine ? radarSitesFor(engine.world) : []; }

  update() {
    const engine = this.runtime.engine;
    if (!engine) return null;
    if (engine !== this.engine) this.adopt(engine);
    return updateWarnings(this.state, engine.world, this.sites);
  }

  // Newest first, each marked in effect or ended.
  list() {
    this.update();
    const world = this.engine?.world, hour = world ? (world.stormEngine?.validHourUtc ?? world.validHourUtc) : null;
    return {
      enabled: true, nowHourUtc: hour, minutes: WARNING.minutes,
      warnings: [...this.state.warnings].reverse().map(warning => publicWarning(warning, hour))
    };
  }
}

import { avoidBackgroundThrottling } from '../../js/runtime/processPriority.node.js';
import { AtmosphereWorld } from '../../js/world/AtmosphereWorld.js';
import { runShortRange } from '../../js/forecast/ShortRangeModel.js';
avoidBackgroundThrottling();
const live = new AtmosphereWorld({ seed: 4 }); live.advance(4);
console.log('atm', live.world.validHourUtc, 'storm', live.world.stormEngine?.validHourUtc);
const a = runShortRange(live.saveState({ forecast: true }), { hours: 2 });
console.log(a.storms.map(f => f.minute + ':' + f.list.length).join(' '));

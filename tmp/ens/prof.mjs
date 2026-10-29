import { avoidBackgroundThrottling } from '../../js/runtime/processPriority.node.js';
import { AtmosphereWorld } from '../../js/world/AtmosphereWorld.js';
import { runOutlookMemberDays } from '../../js/forecast/DayOneOutlook.js';
avoidBackgroundThrottling();
const w = new AtmosphereWorld({ seed: 1000 }); w.advance(4);
const state = w.saveState();
runOutlookMemberDays(structuredClone(state), 0, 24, {});

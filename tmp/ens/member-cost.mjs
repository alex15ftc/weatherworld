// Times one outlook member with storms vs without (ingredients only), 24 h, from a fresh seed world.
import { avoidBackgroundThrottling } from '../../js/runtime/processPriority.node.js';
import { AtmosphereWorld } from '../../js/world/AtmosphereWorld.js';
import { runOutlookMemberDays } from '../../js/forecast/DayOneOutlook.js';
avoidBackgroundThrottling();
const w = new AtmosphereWorld({ seed: 1000 });
w.advance(4); // to 16Z
const state = w.saveState();
const copy = () => structuredClone(state);
let t = performance.now(); runOutlookMemberDays(copy(), 0, 24, {}); const full = performance.now() - t;
t = performance.now(); runOutlookMemberDays(copy(), 1, 24, { stormDays: 0 }); const light = performance.now() - t;
console.log(`24 h member with storms ${(full/1000).toFixed(1)} s, without storms ${(light/1000).toFixed(1)} s`);

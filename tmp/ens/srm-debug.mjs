import { avoidBackgroundThrottling } from '../../js/runtime/processPriority.node.js';
import { AtmosphereWorld } from '../../js/world/AtmosphereWorld.js';
import { runShortRange } from '../../js/forecast/ShortRangeModel.js';
avoidBackgroundThrottling();
const live = new AtmosphereWorld({ seed: 4 }); live.advance(4);
const state = live.saveState({ forecast: true });
const a = runShortRange(structuredClone(state), { hours: 8, shareHours: 3 }), b = runShortRange(structuredClone(state), { hours: 8, shareHours: 8 });
const sig = (run, m) => run.storms.find(f => f.minute === m)?.list.map(s => `${s.id}:${s.intensity}:${s.uh}:${s.tornado ? 'T' : ''}`).sort().join(' ');
for (let m = 120; m <= 480; m += 30) console.log(m, sig(a, m) === sig(b, m) ? 'same' : 'DIFFER', a.storms.find(f => f.minute === m)?.list.length, b.storms.find(f => f.minute === m)?.list.length);

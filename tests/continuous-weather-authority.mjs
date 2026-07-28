import assert from 'node:assert/strict';
import { WeatherAuthorityClock, REAL_MS_PER_SIM_STEP, SIM_HOURS_PER_STEP } from '../js/world/WeatherAuthority.js';
import { WorldStateStore } from '../js/world/WorldStateStore.js';

const clock = new WeatherAuthorityClock({ now: () => 1_000_000 });
const state = { authorityRealTimestamp: 1_000_000 - REAL_MS_PER_SIM_STEP * 5 };
assert.equal(clock.dueSteps(state), 5);
assert.equal(clock.consume(state, 5).simulatedHoursAdvanced, 5 * SIM_HOURS_PER_STEP);

const memory = new Map();
const storage = { getItem:k=>memory.get(k)??null, setItem:(k,v)=>memory.set(k,v), removeItem:k=>memory.delete(k) };
const store = new WorldStateStore(storage);
store.save({ currentSeed: 7, validHourUtc: 18, systemStartHour: 12, systemNumber: 2, authorityRealTimestamp: 123, productArchive: { day1:[{issuedHourUtc:12,validStartHour:12,validEndHour:36,overallRisk:'ENH',sourceSystem:'current'}] } });
const loaded = store.load();
assert.equal(loaded.currentSeed, 7);
assert.equal(loaded.authorityRealTimestamp, 123);
assert.equal(loaded.productArchive.day1.length, 1);
console.log('continuous weather authority passed');

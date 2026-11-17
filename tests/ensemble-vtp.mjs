// The ensemble's VTP chances (2026-11-17): each full outlook run keeps its storm days' highest violent tornado
// parameter per cell (DayOneOutlook vtpMax, VTP x10 in a byte), its cheap runs none, and the model page gets it as base64.
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { runOutlookMemberSet, stateFromBytes } from '../js/forecast/DayOneOutlook.js';
import { OutlookRuntime, vtpDays } from '../server/OutlookRuntime.js';

const atmosphere = new AtmosphereWorld({ seed: 2, spinUpDays: 6 }); atmosphere.advance(30);   // to 18Z of the second day
const n = atmosphere.world.width * atmosphere.world.height;
const set = runOutlookMemberSet(stateFromBytes(v8.serialize(atmosphere.saveState())), 0, 4, { cheapRuns: 1 });
const day = set.days[0];
assert.ok(day.vtpMax instanceof Uint8Array && day.vtpMax.length === n, 'a full run keeps a VTP grid for its storm day');
assert.ok(Math.max(...day.vtpMax) > 0, 'an afternoon warm sector has some VTP');
assert.equal(set.cheap[0][0].vtpMax, undefined, 'a cheap run shares its host air and keeps none');
// The world's own VTP at the start is under each cell's day highest (the run steps the same air on from it).
let under = 0; atmosphere.world.forEachCell((cell, x, y) => { if (Math.round(10 * (cell.derived?.vtp ?? 0)) <= day.vtpMax[y * atmosphere.world.width + x] + 30) under++; });
assert.ok(under > 0.9 * n, `the day highest is not below the start's VTP (${under}/${n})`);
// What the model page gets.
const kept = vtpDays(set.days), cheapKept = vtpDays(set.cheap[0]);
assert.equal(cheapKept.vtp, undefined);
const engine = {}, runtime = Object.create(OutlookRuntime.prototype);
Object.assign(runtime, { runtime: { engine }, ensembles: [{ engine, issuedHourUtc: 42, hours: 4, runs: [{ member: 0, cheap: null, track: [], ...kept }, { member: 0, cheap: 0, track: [], ...cheapKept }] }] });
const out = runtime.ensembleTracks(42);
assert.equal(out.vtpScale, 10);
const back = Uint8Array.from(Buffer.from(out.runs[0].vtp[0].max, 'base64'));
assert.deepEqual(back, day.vtpMax, 'the bytes go to the page unchanged');
assert.ok(out.runs[0].vtp[0].fromHourUtc < out.runs[0].vtp[0].toHourUtc);
assert.equal(out.runs[1].vtp, undefined);
console.log(`ensemble VTP: ok (day highest VTP ${Math.max(...day.vtpMax) / 10}, ${Buffer.from(out.runs[0].vtp[0].max, 'base64').length} bytes, ${out.runs[0].vtp[0].max.length} chars base64)`);

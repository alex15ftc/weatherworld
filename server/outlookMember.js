// One member of the outlooks, run in its own process so the server keeps serving. It reports
// each outlook day it reaches (an array, Day 1 first).
//   node server/outlookMember.js <state file> <member number> <hours>
// The result goes back to the parent over the process channel (advanced serialization, so the
// typed arrays arrive as they are). Started any other way it does nothing.
import fs from 'node:fs';
import v8 from 'node:v8';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';
import { runOutlookMemberDays } from '../js/forecast/DayOneOutlook.js';

if (typeof process.send === 'function') {
  avoidBackgroundThrottling();
  const [statePath, member, hours] = process.argv.slice(2);
  try {
    const state = v8.deserialize(fs.readFileSync(statePath));   // this process's own read of the file
    process.send({ ok: true, result: runOutlookMemberDays(state, Number(member), Number(hours)) }, () => process.exit(0));
  } catch (error) {
    process.send({ ok: false, error: String(error?.stack ?? error) }, () => process.exit(1));
  }
}

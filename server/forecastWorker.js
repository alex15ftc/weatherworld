// One of the forecast pool's threads (ForecastPool.js): does the runs it is sent, one at a
// time, and sends back what each found. Started any other way it does nothing.
import { parentPort } from 'node:worker_threads';
import { runOutlookMemberDays, stateFromBytes } from '../js/forecast/DayOneOutlook.js';
import { runMesoscaleMember } from '../js/forecast/MesoscaleDiscussion.js';

const RUNS = { outlook: runOutlookMemberDays, mesoscale: runMesoscaleMember };

parentPort?.on('message', ({ kind, state, member, hours, options }) => {
  try {
    // The bytes are shared with the other threads; stateFromBytes reads this run's own world out of them.
    parentPort.postMessage({ ok: true, result: RUNS[kind](stateFromBytes(state), member, hours, options) });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: String(error?.stack ?? error) });
  }
});

// A worker thread's memory handed back once it has had nothing to do for a while. A thread that
// has finished a run holds that run's whole world as garbage, and an idle thread never collects
// it: forecast threads were measured at 240-490 MB each after their runs and growing run by run,
// radar threads ~40 MB each and growing tick by tick (2026-11-09). A full collection when idle
// brings a forecast thread back to ~10-55 MB over its baseline, in 30-90 ms; the run after it is
// 10-15% slower (its compiled code is let go too), so it waits for a pause, not every run.
// (The collection has to come after the reply is sent: inside the message handler the run is
// still held on the stack.)
import v8 from 'node:v8';
import vm from 'node:vm';

let gc = null;
try { v8.setFlagsFromString('--expose-gc'); gc = vm.runInNewContext('gc'); } catch { gc = null; }

// Returns a function to call after each task: the thread collects its garbage once idleMs have
// passed with no further call.
export function collectWhenIdle(idleMs) {
  let timer = null;
  return () => {
    if (!gc) return;
    clearTimeout(timer);
    timer = setTimeout(() => { try { gc({ type: 'major', execution: 'sync', flavor: 'last-resort' }); } catch { /* only memory */ } }, idleMs);
    timer.unref();
  };
}

// Windows throttles normal-priority processes that have no foreground window (efficiency
// mode): about three seconds after start they run several times slower. Long simulation runs
// (audits, tests, the authority server) ask for above-normal priority, which is exempt.
// Measured here: identical work took 27 ms before the throttle and about 230 ms after it.
import os from 'node:os';

export function avoidBackgroundThrottling() {
  if (process.platform !== 'win32' || process.env.WEATHER_PRIORITY === 'normal') return false;
  try { os.setPriority(os.constants.priority.PRIORITY_ABOVE_NORMAL); return true; } catch { return false; }
}

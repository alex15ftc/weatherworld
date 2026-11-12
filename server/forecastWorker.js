// One of the forecast pool's threads (ForecastPool.js): does the runs it is sent, one at a
// time, and sends back what each found. Started any other way it does nothing.
import { parentPort } from 'node:worker_threads';
import { runOutlookMemberSet, stateFromBytes } from '../js/forecast/DayOneOutlook.js';
import { runMesoscaleMember } from '../js/forecast/MesoscaleDiscussion.js';
import { placesFor } from './CountyLayer.js';
import { collectWhenIdle } from './idleCollect.js';

import { runShortRange } from '../js/forecast/ShortRangeModel.js';
import { MESOANALYSIS_PARAMETERS, buildParameterField } from './mesoanalysisParameters.js';
import { SynopticRuntime } from './SynopticRuntime.js';

// The mesoanalysis fields of a world (the short range model keeps them each hour).
const fieldsOf = world => Object.fromEntries(MESOANALYSIS_PARAMETERS.map(parameter => [parameter.key, buildParameterField(world, parameter)]));

// The large-scale model's frame of a run's world (the short range model keeps one every few hours).
const synopticOf = atmosphere => new SynopticRuntime({ atmosphere }).frame();

// (outlook: a member and its cheap runs, { days, cheap }; shortRange: one run of the short range model)
const RUNS = { outlook: runOutlookMemberSet, mesoscale: runMesoscaleMember, shortRange: (state, member, hours) => runShortRange(state, { hours, fieldsOf, synopticOf }) };

// (A run's world is garbage once it is sent back: collected after a pause, idleCollect.js. Runs of
// one issue come back to back; the hourly ones 7.5 minutes apart.)
const idle = collectWhenIdle((Number(process.env.WEATHER_FORECAST_GC_SECONDS) || 30) * 1000);

parentPort?.on('message', ({ kind, state, member, hours, options }) => {
  try {
    // The bytes are shared with the other threads; stateFromBytes reads this run's own world out of them.
    parentPort.postMessage({ ok: true, result: RUNS[kind](stateFromBytes(state), member, hours, { ...options, placesFor }) });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: String(error?.stack ?? error) });
  }
  idle();
});

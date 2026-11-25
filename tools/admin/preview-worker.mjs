// One week preview, on a thread of its own (tools/admin/server.mjs starts it). workerData:
//   source  { kind: 'saved', file } a local engine's saved world (data/cache/atmosphere-state.bin), or
//           { kind: 'seed', seed } a new world for that seed (its spin-up is cached after the first time)
//   days, qg, steering  as for runPreviewOn (SeverePreview.js)
// Sends { progress } as it goes and { done } or { error } at the end.
import fs from 'node:fs';
import v8 from 'node:v8';
import { parentPort, workerData } from 'node:worker_threads';
import { AtmosphereWorld } from '../../js/world/AtmosphereWorld.js';
import { placesFor } from '../../server/CountyLayer.js';
import { runPreviewOn } from './SeverePreview.js';

try {
  const { source, days, qg, steering } = workerData;
  let atmosphere;
  if (source.kind === 'saved') {
    atmosphere = AtmosphereWorld.restore(v8.deserialize(fs.readFileSync(source.file)).engine);
    if (!atmosphere) throw new Error(`the saved world in ${source.file} is from another layout`);
  } else atmosphere = new AtmosphereWorld({ seed: source.seed });
  const result = runPreviewOn(atmosphere, { days, qg, steering, placesFor, onProgress: progress => parentPort.postMessage({ progress }) });
  parentPort.postMessage({ done: result });
} catch (error) {
  parentPort.postMessage({ error: String(error?.message ?? error) });
}

// Worker-thread entry for the server: runs outlook ensemble members off the main thread.
//   { snapshot | seed, specs } -> member event masks (transferred, not copied).
//   snapshot: serialized current world; seed: start from that system's first hour.
import { parentPort } from 'node:worker_threads';
import v8 from 'node:v8';
import { runEnsembleMember } from './ensembleMember.js';
import { snapshotWorld } from '../world/worldSnapshot.js';
import { buildSystemWorld } from '../world/systemBuilder.js';

// Starting worlds by seed (serialized); a worker only ever needs the next system or two.
const systems = new Map();
function systemBytes(seed) {
  if (!systems.has(seed)) {
    if (systems.size >= 2) systems.delete(systems.keys().next().value);
    systems.set(seed, v8.serialize(snapshotWorld(buildSystemWorld(seed))));
  }
  return systems.get(seed);
}

parentPort.on('message', ({ jobId, snapshot, seed, specs }) => {
  try {
    const bytes = snapshot ? Buffer.from(new Uint8Array(snapshot)) : systemBytes(seed);
    const results = specs.map(spec => runEnsembleMember(v8.deserialize(bytes), spec));
    const transfer = results.flatMap(r => r.windows.flatMap(w => Object.values(w.masks).map(mask => mask.buffer)));
    parentPort.postMessage({ jobId, results }, transfer);
  } catch (error) {
    parentPort.postMessage({ jobId, error: error?.stack ?? String(error) });
  }
});

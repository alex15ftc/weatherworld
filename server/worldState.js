// Binary copies of a world (V8 serialization): handed to worker threads for the outlook
// ensemble, and written to disk so the server resumes where it stopped.
import v8 from 'node:v8';
import { snapshotWorld } from '../js/world/worldSnapshot.js';

// Physical state only (what a forecast member needs), in shared memory so every worker
// thread reads the same bytes without another copy on the main thread.
export function serializeSnapshot(world) {
  const bytes = v8.serialize(snapshotWorld(world));
  const shared = new SharedArrayBuffer(bytes.length);
  new Uint8Array(shared).set(bytes);
  return shared;
}

export function deserializeSnapshot(buffer) {
  return v8.deserialize(buffer instanceof SharedArrayBuffer ? Buffer.from(new Uint8Array(buffer)) : Buffer.from(buffer));
}

export const isSerializedSnapshot = value => value instanceof SharedArrayBuffer || value instanceof ArrayBuffer || ArrayBuffer.isView(value);

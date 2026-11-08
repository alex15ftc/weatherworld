// One of the radar's threads (RadarPool.js): works out a storm's precipitation, a strip of the
// mosaic, a scan or the satellite's images (from js/satellite/Satellite.js satelliteInputs), one
// at a time. It keeps the last scene it was given; the scene's storm
// fields are in memory shared with the other threads.
import { parentPort } from 'node:worker_threads';
import { buildStormEcho, buildRadarMosaic, scanRadarTilt } from '../js/radar/RadarSimulator.js';
import { renderSatellite } from '../js/satellite/Satellite.js';

let scene = null, sceneId = null;
const TASKS = {
  echo: ({ input }) => buildStormEcho(input, { shared: true }),
  mosaic: ({ sites, rows, mosaicKind }) => buildRadarMosaic(scene, sites, { rows, kind: mosaicKind }),
  scan: ({ site, tiltDeg, gateKm }) => scanRadarTilt(scene, site, tiltDeg, { gateKm }),
  satellite: ({ inputs }) => renderSatellite(inputs)
};

parentPort?.on('message', message => {
  try {
    if (message.scene) { scene = message.scene; sceneId = message.sceneId; }
    const result = TASKS[message.kind](message);
    // Scan and mosaic bytes are this thread's own: handed over, not copied.
    const transfer = message.kind === 'scan' ? Object.values(result.products).map(a => a.buffer) : message.kind === 'mosaic' ? [result.bytes.buffer] : message.kind === 'satellite' ? [result.ir.buffer, result.visible.buffer] : [];
    parentPort.postMessage({ ok: true, result, sceneId }, transfer);
  } catch (error) {
    parentPort.postMessage({ ok: false, error: String(error?.stack ?? error) });
  }
});

// One of the radar's threads (RadarPool.js): works out, one at a time, a storm's precipitation, a
// strip of a mosaic (or of several at once), a scan, the rotation in scans, the low-level shear
// grid, a storm's rain grid for the game or the satellite's images (from js/satellite/Satellite.js
// satelliteInputs). It keeps the last scene it was given; the scene's storm fields are in memory
// shared with the other threads.
import { parentPort } from 'node:worker_threads';
import { buildStormEcho, buildRadarMosaic, buildRadarMosaics, scanRadarTilt, stormColdPool, MOSAIC_RES_KM } from '../js/radar/RadarSimulator.js';
import { detectRotation, lowLevelShearGrid } from '../js/radar/RotationDetection.js';
import { stormPrecipGrid } from '../js/radar/StormPrecipGrid.js';
import { renderSatellite } from '../js/satellite/Satellite.js';
import { collectWhenIdle } from './idleCollect.js';

let scene = null, sceneId = null;
// (Old scenes and finished work are let go after a short pause: idleCollect.js. Measured: 4 threads
// 676 -> 505 MB and flat, with no change in how long a tick's radar takes.)
const idle = collectWhenIdle(1500);
const TASKS = {
  // (with the storm's cold pool as the scan reads it, worked out here rather than on the authority's thread)
  echo: ({ input }) => { const field = buildStormEcho(input, { shared: true }); if (field) field.radarColdPool = stormColdPool(field, input); return field; },
  mosaic: ({ sites, rows, mosaicKind }) => buildRadarMosaic(scene, sites, { rows, kind: mosaicKind }),
  mosaics: ({ sites, rows, kinds }) => buildRadarMosaics(scene, sites, { rows, kinds }),
  // (one storm's rain grid for the game feed, server/GameFeed.js)
  precipGrid: ({ input }) => stormPrecipGrid(input),
  scan: ({ site, tiltDeg, gateKm }) => scanRadarTilt(scene, site, tiltDeg, { gateKm }),
  rotation: ({ site, scans }) => detectRotation(site, scans),
  shearGrid: ({ width, height, sites, scans }) => {
    const shear = new Float32Array(width * height);
    sites.forEach((site, k) => { if (scans[k]) lowLevelShearGrid(shear, width, height, MOSAIC_RES_KM, site, scans[k]); });
    return shear;
  },
  satellite: ({ inputs }) => renderSatellite(inputs)
};

parentPort?.on('message', message => {
  try {
    if (message.scene) { scene = message.scene; sceneId = message.sceneId; }
    const result = TASKS[message.kind](message);
    // Scan and mosaic bytes are this thread's own: handed over, not copied.
    const transfer = message.kind === 'scan' ? Object.values(result.products).map(a => a.buffer) : message.kind === 'mosaic' ? [result.bytes.buffer] : message.kind === 'mosaics' ? Object.values(result.bytes).map(a => a.buffer)
      : message.kind === 'shearGrid' ? [result.buffer] : message.kind === 'satellite' ? [result.ir.buffer, result.visible.buffer] : [];
    parentPort.postMessage({ ok: true, result, sceneId }, transfer);
  } catch (error) {
    parentPort.postMessage({ ok: false, error: String(error?.stack ?? error) });
  }
  idle();
});

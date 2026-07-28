import { serializeStormInternalField } from './StormInternalField.js?v=2.20.1';
const REPORT_INTERVAL_HOURS = 1 / 60;
const RADAR_AGGREGATION_HOURS = 5 / 60;

export function initializeStormObservationLayer(world) {
  world.stormObservationLayer = {
    schemaVersion: 1,
    reportIntervalHours: REPORT_INTERVAL_HOURS,
    aggregationIntervalHours: RADAR_AGGREGATION_HOURS,
    sequence: 0,
    lastReportHourUtc: world.stormEngine?.validHourUtc ?? world.validHourUtc,
    nextReportHourUtc: world.stormEngine?.validHourUtc ?? world.validHourUtc,
    shards: {},
    reports: [],
    latestByStormId: {},
    radarFrames: []
  };
  publishStormObservations(world, 0);
}

export function publishStormObservations(world, dtHours = 0) {
  if (!world.stormObservationLayer) initializeStormObservationLayer(world);
  const layer = world.stormObservationLayer;
  const end = Math.max(Number(world.validHourUtc) || 0, Number(world.stormEngine?.validHourUtc) || 0);
  const start = Math.max(layer.lastReportHourUtc ?? end, end - Math.max(0, dtHours));
  let t = Math.max(layer.nextReportHourUtc ?? start, start);
  if (dtHours === 0) t = end;
  while (t <= end + 1e-8) {
    const fraction = dtHours > 0 ? Math.max(0, Math.min(1, (t - start) / dtHours)) : 1;
    const batch = [];
    for (const storm of world.storms ?? []) {
      if (!storm.active) continue;
      const previous = storm.previousPositionKm ?? storm.positionKm;
      const x = previous.x + (storm.positionKm.x - previous.x) * fraction;
      const y = previous.y + (storm.positionKm.y - previous.y) * fraction;
      const shardX = Math.max(0, Math.min(world.width - 1, Math.floor(x / world.cellSizeKm)));
      const shardY = Math.max(0, Math.min(world.height - 1, Math.floor(y / world.cellSizeKm)));
      const shardId = `cell-${shardX}-${shardY}`;
      const report = {
        reportId: `${storm.id}-${(++layer.sequence).toString(36)}`,
        stormId: storm.id,
        shardId,
        observedHourUtc: Number(t.toFixed(6)),
        positionKm: { x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) },
        velocityKph: { ...storm.velocityKph },
        lifecycleState: storm.lifecycleState,
        intensity: storm.intensity,
        organization: storm.organization,
        updraftStrength: storm.updraftStrength,
        rotationStrength: storm.rotationStrength ?? 0,
        orientationDeg: storm.orientationDeg ?? 0,
        mode: storm.mode,
        radar: { ...(storm.radar ?? {}) },
        hazards: { ...(storm.hazards ?? {}) },
        motion: { ...(storm.motion ?? {}) },
        surfaceWind: { ...(storm.surfaceWind ?? {}) },
        tornado: storm.tornado ? structuredClone(storm.tornado) : null,
        eventTags: [...(storm.eventTags ?? [])],
        internalField: serializeStormInternalField(storm.internalField)
      };
      batch.push(report);
      layer.latestByStormId[storm.id] = report;
      (layer.shards[shardId] ??= []).push(report);
      if (layer.shards[shardId].length > 24) layer.shards[shardId].splice(0, layer.shards[shardId].length - 24);
    }
    layer.reports.push(...batch);
    layer.lastReportHourUtc = Number(t.toFixed(6));
    t += REPORT_INTERVAL_HOURS;
    if (dtHours === 0) break;
  }
  layer.nextReportHourUtc = Number((layer.lastReportHourUtc + REPORT_INTERVAL_HOURS).toFixed(6));
  const cutoff = end - 1;
  layer.reports = layer.reports.filter(r => r.observedHourUtc >= cutoff);
  const frameSlot = Math.floor((end + 1e-8) / RADAR_AGGREGATION_HOURS);
  const currentSlot = layer.radarFrames.at(-1)?.slot;
  if (frameSlot !== currentSlot) {
    layer.radarFrames.push({
      slot: frameSlot,
      validHourUtc: Number((frameSlot * RADAR_AGGREGATION_HOURS).toFixed(6)),
      storms: Object.values(layer.latestByStormId).map(cloneReport)
    });
    if (layer.radarFrames.length > 24) layer.radarFrames.shift();
  }
  return layer;
}

export function getAggregatedStormTruth(world) {
  const layer = world.stormObservationLayer;
  if (!layer) return [];
  return Object.values(layer.latestByStormId).map(cloneReport);
}

function cloneReport(report) {
  return {
    ...report,
    positionKm: { ...report.positionKm },
    velocityKph: { ...report.velocityKph },
    radar: { ...(report.radar ?? {}) },
    hazards: { ...(report.hazards ?? {}) },
    motion: { ...(report.motion ?? {}) },
    surfaceWind: { ...(report.surfaceWind ?? {}) },
    tornado: report.tornado ? structuredClone(report.tornado) : null,
    eventTags: [...(report.eventTags ?? [])],
    internalField: report.internalField ? structuredClone(report.internalField) : null
  };
}

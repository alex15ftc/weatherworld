import { clamp } from '../scenarios/math.js?v=2.20.1';

export const RADAR_PRODUCTS = Object.freeze(['reflectivity', 'velocity', 'correlationCoefficient']);
export const RADAR_SCAN_INTERVAL_HOURS = 5 / 60;
export const RADAR_SCAN_STRATEGY = 'VCP-SEVERE-5';

export function initializeRadarNetwork(world) {
  const w = world.domainWidthKm, h = world.domainHeightKm;
  world.radarNetwork = {
    networkId: 'FPWX-NEXRAD',
    scanStrategy: RADAR_SCAN_STRATEGY,
    stations: [
      station('KFPW', 'West Plains', w * .14, h * .20, 356),
      station('KCRK', 'Central Ridge', w * .52, h * .13, 442),
      station('KPLS', 'East Prairie', w * .86, h * .29, 301),
      station('KDRY', 'Dryline South', w * .25, h * .72, 515),
      station('KRIV', 'River Valley', w * .67, h * .79, 274)
    ],
    scanIntervalHours: RADAR_SCAN_INTERVAL_HOURS,
    lastScanHourUtc: world.validHourUtc,
    nextScanHourUtc: world.validHourUtc + RADAR_SCAN_INTERVAL_HOURS,
    scanNumber: 1
  };
  for (const radar of world.radarNetwork.stations) stampScan(radar, world.validHourUtc, 1);
}

export function updateRadarNetwork(world) {
  if (!world.radarNetwork) initializeRadarNetwork(world);
  const network = world.radarNetwork;
  const interval = network.scanIntervalHours ?? RADAR_SCAN_INTERVAL_HOURS;
  let scans = 0;
  while (world.validHourUtc + 1e-8 >= network.nextScanHourUtc) {
    network.lastScanHourUtc = Number(network.nextScanHourUtc.toFixed(6));
    network.scanNumber += 1;
    scans += 1;
    for (const radar of network.stations) stampScan(radar, network.lastScanHourUtc, network.scanNumber);
    network.nextScanHourUtc = Number((network.nextScanHourUtc + interval).toFixed(6));
  }
  return scans;
}

export function getProductRangeKm(radar, product = 'reflectivity') {
  return radar?.productRangesKm?.[product] ?? radar?.rangeKm ?? 0;
}

export function getRadarScanStatus(world, stationId = 'composite', product = 'reflectivity') {
  const network = world.radarNetwork;
  if (!network) return null;
  if (stationId === 'composite') return {
    stationId, scanNumber: network.scanNumber, lastScanHourUtc: network.lastScanHourUtc,
    nextScanHourUtc: network.nextScanHourUtc, rangeKm: null, scanStrategy: network.scanStrategy
  };
  const radar = network.stations.find(item => item.id === stationId);
  return radar ? {
    stationId, stationName: radar.name, scanNumber: radar.scanNumber,
    lastScanHourUtc: radar.lastScanHourUtc, nextScanHourUtc: radar.nextScanHourUtc,
    rangeKm: getProductRangeKm(radar, product), productRangesKm: radar.productRangesKm,
    antennaHeightM: radar.antennaHeightM, scanStrategy: radar.scanStrategy
  } : null;
}

export function sampleRadarProduct(world, xKm, yKm, product, selectedStationId = 'composite') {
  const stations = world.radarNetwork?.stations ?? [];
  const eligible = selectedStationId === 'composite' ? stations : stations.filter(s => s.id === selectedStationId);
  const observations = eligible.map(radar => stationObservation(world, radar, xKm, yKm, product)).filter(o => o.covered);
  if (!observations.length) return { value: null, covered: false, quality: 0, stationId: null };
  observations.sort((a,b) => b.quality - a.quality);
  if (product === 'reflectivity') return observations.reduce((best, obs) => obs.value > best.value ? obs : best, observations[0]);
  const totalWeight = observations.reduce((sum,o) => sum + o.quality, 0) || 1;
  return { value: observations.reduce((sum,o) => sum + o.value * o.quality, 0) / totalWeight, covered: true,
    quality: clamp(totalWeight / Math.max(1, observations.length), 0, 1), stationId: observations[0].stationId };
}

export function coverageAt(world, xKm, yKm, stationId = 'composite', product = 'reflectivity') {
  const stations = world.radarNetwork?.stations ?? [];
  const eligible = stationId === 'composite' ? stations : stations.filter(s => s.id === stationId);
  let best = 0;
  for (const radar of eligible) best = Math.max(best, coverageQuality(world, radar, xKm, yKm, product));
  return best;
}

function station(id, name, xKm, yKm, antennaHeightM) {
  const productRangesKm = { reflectivity: 230, velocity: 185, correlationCoefficient: 175 };
  return { id, name, xKm, yKm, rangeKm: productRangesKm.reflectivity, productRangesKm, antennaHeightM,
    blockedSectors: stationBlockage(id),
    lowestElevationDeg: .5, scanStrategy: RADAR_SCAN_STRATEGY, status: 'online', scanNumber: 0,
    lastScanHourUtc: null, nextScanHourUtc: null };
}
function stampScan(radar, hour, number) { radar.scanNumber = number; radar.lastScanHourUtc = hour; radar.nextScanHourUtc = Number((hour + RADAR_SCAN_INTERVAL_HOURS).toFixed(6)); }
function stationObservation(world, radar, xKm, yKm, product) {
  const quality = coverageQuality(world, radar, xKm, yKm, product);
  if (quality <= .035) return { covered: false, value: null, quality: 0, stationId: radar.id };
  const dx = xKm - radar.xKm, dy = yKm - radar.yKm, distanceKm = Math.hypot(dx,dy);
  const azimuthUnit = { x: dx / Math.max(1,distanceKm), y: dy / Math.max(1,distanceKm) };
  let reflectivity = -5, velocityWeighted = 0, velocityWeight = 0, cc = .995;
  for (const storm of world.storms ?? []) {
    if (!storm.active) continue;
    const along = rotate(xKm-storm.positionKm.x, yKm-storm.positionKm.y, storm.orientationDeg ?? 0);
    const rx = Math.max(8, storm.radar?.radiusXKm ?? (10 + storm.intensity * 20));
    const ry = Math.max(7, storm.radar?.radiusYKm ?? (8 + storm.intensity * 14));
    const norm = Math.sqrt((along.x/rx)**2 + (along.y/ry)**2);
    if (norm > 2.2) continue;
    const core = Math.exp(-norm * norm * 1.35);
    const hook = (storm.hazards?.tornadoProbability ?? 0) > .25 ? Math.exp(-(((along.x+rx*.45)/(rx*.32))**2 + ((along.y-ry*.55)/(ry*.28))**2)) : 0;
    reflectivity = Math.max(reflectivity, 12 + 52 * storm.intensity * core + 10 * hook + (storm.hazards?.hailProbability ?? 0) * 8);
    const translation = storm.velocityKph.east * azimuthUnit.x + (-storm.velocityKph.north) * azimuthUnit.y;
    const rotational = Math.sign(along.y || 1) * (storm.rotationStrength ?? 0) * 85 * Math.exp(-norm*norm*2.4);
    velocityWeighted += (translation + rotational) * core; velocityWeight += core;
    if ((storm.hazards?.hailProbability ?? 0) > .35 && norm < .45) cc = Math.min(cc, .88 - storm.hazards.hailProbability * .10);
    if ((storm.hazards?.tornadoProbability ?? 0) > .42 && norm < .32) cc = Math.min(cc, .72);
    else if (reflectivity > 35) cc = Math.min(cc, .96 - storm.intensity * .035);
  }
  let value = product === 'reflectivity' ? reflectivity : product === 'velocity' ? velocityWeighted / Math.max(.01, velocityWeight) : cc;
  if (product === 'velocity') value = clamp(value, -120, 120);
  if (product === 'correlationCoefficient') value = clamp(value, .62, 1);
  return { covered: true, value, quality, stationId: radar.id, distanceKm };
}
function coverageQuality(world, radar, xKm, yKm, product) {
  if (radar.status !== 'online') return 0;
  const distance=Math.hypot(xKm-radar.xKm,yKm-radar.yKm), rangeKm=getProductRangeKm(radar, product);
  if (distance > rangeKm) return 0;
  const rangeQuality = clamp(1 - (distance/rangeKm)**2, 0, 1);
  const cell = world.getCell(Math.floor(xKm/world.cellSizeKm), Math.floor(yKm/world.cellSizeKm));
  const stationCell = world.getCell(Math.floor(radar.xKm/world.cellSizeKm), Math.floor(radar.yKm/world.cellSizeKm));
  const beamHeightPenalty = clamp((distance - rangeKm*.55) / (rangeKm*.55), 0, .38);
  const terrainBlock = clamp(((cell?.terrain?.elevationM ?? 0) - (stationCell?.terrain?.elevationM ?? 0) - 350) / 900, 0, .75);
  const n = holeNoise(radar.id, Math.floor(xKm/20), Math.floor(yKm/20));
  const holePenalty = n > .91 ? .96 : n > .83 ? .55 : 0;
  return clamp(rangeQuality * (1-beamHeightPenalty) * (1-terrainBlock) * (1-holePenalty), 0, 1);
}
function rotate(x,y,degrees){ const a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a); return {x:x*c+y*s,y:-x*s+y*c}; }
function holeNoise(id,x,y){ let h=2166136261; const t=`${id}|${x}|${y}`; for(let i=0;i<t.length;i++){h^=t.charCodeAt(i);h=Math.imul(h,16777619);} return (h>>>0)/4294967296; }

function stationBlockage(id) {
  const sectors={KFPW:[{fromDeg:300,toDeg:326,strength:.55}],KCRK:[{fromDeg:35,toDeg:58,strength:.42}],KPLS:[{fromDeg:164,toDeg:190,strength:.48}],KDRY:[{fromDeg:248,toDeg:270,strength:.38}],KRIV:[{fromDeg:85,toDeg:108,strength:.5}]};
  return sectors[id]??[];
}

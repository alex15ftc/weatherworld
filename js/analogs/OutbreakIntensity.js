const SEVERE_TYPES = new Set(['Tornado', 'Hail', 'Thunderstorm Wind']);

export const INTENSITY_BANDS = Object.freeze([
  Object.freeze({ key: 'localized', min: 0, max: 20 }),
  Object.freeze({ key: 'organized', min: 20, max: 40 }),
  Object.freeze({ key: 'significant', min: 40, max: 60 }),
  Object.freeze({ key: 'major', min: 60, max: 80 }),
  Object.freeze({ key: 'exceptional', min: 80, max: 101 })
]);

export function scoreOutbreak(events, options = {}) {
  const reports = events.filter(event => SEVERE_TYPES.has(normalizeType(event.eventType)));
  const tornadoes = reports.filter(event => normalizeType(event.eventType) === 'Tornado');
  const hail = reports.filter(event => normalizeType(event.eventType) === 'Hail');
  const wind = reports.filter(event => normalizeType(event.eventType) === 'Thunderstorm Wind');
  const significantTornadoes = tornadoes.filter(event => tornadoRating(event) >= 2);
  const violentTornadoes = tornadoes.filter(event => tornadoRating(event) >= 4);
  const significantHail = hail.filter(event => Number(event.magnitude) >= 2);
  const destructiveWind = wind.filter(event => Number(event.magnitude) >= 75);
  const eraWeight = reportingEraWeight(options.year ?? eventYear(reports[0]));
  const coverage = spatialCoverage(reports);
  const concentration = temporalConcentration(reports);
  const components = {
    significantTornado: saturating(significantTornadoes.length / eraWeight, 12),
    violentTornado: saturating(violentTornadoes.length / eraWeight, 4),
    significantHail: saturating(significantHail.length / eraWeight, 35),
    destructiveWind: saturating(destructiveWind.length / eraWeight, 55),
    spatialCoverage: saturating(coverage, 850),
    temporalConcentration: concentration
  };
  const score = 100 * (
    .30 * components.significantTornado +
    .15 * components.violentTornado +
    .15 * components.significantHail +
    .15 * components.destructiveWind +
    .15 * components.spatialCoverage +
    .10 * components.temporalConcentration
  );
  return Object.freeze({
    score: round(score, 2),
    band: intensityBand(score),
    reportCount: reports.length,
    counts: Object.freeze({
      tornado: tornadoes.length, significantTornado: significantTornadoes.length,
      violentTornado: violentTornadoes.length, hail: hail.length,
      significantHail: significantHail.length, wind: wind.length,
      destructiveWind: destructiveWind.length
    }),
    components: Object.freeze(components),
    reportingEraWeight: eraWeight
  });
}

export function intensityBand(score) {
  const value = Math.max(0, Math.min(100, Number(score) || 0));
  return INTENSITY_BANDS.find(band => value >= band.min && value < band.max)?.key ?? 'exceptional';
}

export function reportingEraWeight(year) {
  const value = Number(year) || 2005;
  if (value < 1973) return .55;
  if (value < 1996) return .72;
  if (value < 2007) return .88;
  return 1;
}

function spatialCoverage(events) {
  const points = events.map(event => [Number(event.latitude), Number(event.longitude)]).filter(point => point.every(Number.isFinite));
  if (points.length < 2) return points.length ? 25 : 0;
  let minLat=Infinity,maxLat=-Infinity,minLon=Infinity,maxLon=-Infinity;
  for(const [lat,lon] of points){minLat=Math.min(minLat,lat);maxLat=Math.max(maxLat,lat);minLon=Math.min(minLon,lon);maxLon=Math.max(maxLon,lon);}
  const meanLat=(minLat+maxLat)/2*Math.PI/180;
  return Math.hypot((maxLat-minLat)*111,(maxLon-minLon)*111*Math.cos(meanLat));
}

function temporalConcentration(events) {
  const hours = events.map(event => Number(event.beginHourUtc)).filter(Number.isFinite);
  if (hours.length < 2) return hours.length ? .25 : 0;
  const bins = new Map();
  for (const hour of hours) bins.set(Math.floor(hour / 3), (bins.get(Math.floor(hour / 3)) ?? 0) + 1);
  return Math.min(1, Math.max(...bins.values()) / Math.max(8, events.length * .35));
}

function normalizeType(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'tornado') return 'Tornado';
  if (text === 'hail') return 'Hail';
  if (text.includes('thunderstorm') && text.includes('wind')) return 'Thunderstorm Wind';
  return value;
}
function tornadoRating(event) { const match=String(event.torFScale??event.magnitude??'').match(/[EFU]*(\d)/i); return match?Number(match[1]):-1; }
function eventYear(event) { return Number(String(event?.beginDateTime??'').match(/\d{4}/)?.[0]); }
function saturating(value, scale) { return Math.max(0, Math.min(1, 1 - Math.exp(-Math.max(0,value)/scale))); }
function round(value, digits) { const factor=10**digits;return Math.round(value*factor)/factor; }

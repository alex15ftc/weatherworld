import shp from 'shpjs';
import { normalizeSpcOutlook } from './SPCOutlookParser.js';

const CATEGORY = Object.freeze({ TSTM:'TSTM', MRGL:'MRGL', SLGT:'SLGT', ENH:'ENH', MDT:'MDT', HIGH:'HIGH' });
const PROBABILITIES = new Set([0.02,0.05,0.10,0.15,0.30,0.45,0.60]);

/** Parse an official SPC zipped shapefile into the same normalized outlook schema. */
export async function parseSpcShapefileZip(buffer, options = {}) {
  const parsed = await shp(buffer);
  const collections = Array.isArray(parsed) ? parsed : [parsed];
  const contours = [];
  const warnings = [];
  let sourceIndex = 0;

  for (const collection of collections) {
    const fileName = String(collection?.fileName ?? options.fileName ?? '');
    for (const feature of collection?.features ?? []) {
      const classification = classifyFeature(feature, fileName, options);
      if (!classification) {
        warnings.push(issue('unclassified-shapefile-feature', 'SPC shapefile feature could not be classified', { fileName, properties: feature?.properties ?? null }, 'info'));
        continue;
      }
      const polygons = geometryToPolygons(feature?.geometry);
      if (!polygons.length) {
        warnings.push(issue('missing-shapefile-geometry', 'SPC shapefile feature contained no polygon geometry', { fileName, properties: feature?.properties ?? null }));
        continue;
      }
      contours.push({ ...classification, polygons, sourceLabel: classification.sourceLabel, sourceIndex: sourceIndex++ });
    }
  }

  const parsedProduct = {
    schemaVersion: '2.34.5.1',
    format: 'spc-shapefile',
    forecastDay: options.forecastDay ?? null,
    issuedAt: options.issuedAt ?? null,
    validStart: options.validStart ?? null,
    validEnd: options.validEnd ?? null,
    source: options.source ?? null,
    contours: assignStableIds(contours, options),
    warnings
  };
  return { parsedProduct, normalizedProduct: normalizeSpcOutlook(parsedProduct) };
}

function classifyFeature(feature, fileName, options) {
  const props = feature?.properties ?? {};
  const values = Object.values(props).filter(value => value != null).map(value => String(value).trim());
  const combined = `${fileName} ${values.join(' ')}`.toUpperCase();
  const hazardType = inferHazard(fileName, combined, options.hazardType);

  for (const token of Object.keys(CATEGORY)) {
    if (new RegExp(`(?:^|[^A-Z])${token}(?:$|[^A-Z])`).test(combined)) {
      return { hazardType: 'categorical', value: token, significant: false, sourceLabel: token };
    }
  }

  const significant = /\b(SIGN|SIG|SIGNIFICANT)\b/.test(combined);
  if (significant && hazardType && hazardType !== 'categorical') {
    return { hazardType: `significant${capitalize(hazardType)}`, value: 'SIGN', significant: true, sourceLabel: 'SIGN' };
  }

  const probability = extractProbability(values, props);
  if (probability != null && hazardType && hazardType !== 'categorical') {
    return { hazardType, value: probability, significant: false, sourceLabel: String(probability) };
  }
  return null;
}

function inferHazard(fileName, combined, explicit) {
  if (explicit) return explicit;
  const text = `${fileName} ${combined}`.toLowerCase();
  if (/torn|_tor\b|prob_t/.test(text)) return 'tornado';
  if (/hail|prob_h/.test(text)) return 'hail';
  if (/wind|prob_w/.test(text)) return 'wind';
  if (/cat|categor|otlk/.test(text)) return 'categorical';
  return null;
}

function extractProbability(values, props) {
  const preferredKeys = ['LABEL','LABEL2','DN','D_N','PROB','PROBABILITY','VALUE','RISK'];
  const candidates = [...preferredKeys.map(key => props[key]).filter(value => value != null), ...values];
  for (const raw of candidates) {
    const text = String(raw).trim().replace('%','');
    const number = Number(text);
    if (!Number.isFinite(number)) continue;
    const normalized = number > 1 ? number / 100 : number;
    const rounded = Math.round(normalized * 100) / 100;
    if (PROBABILITIES.has(rounded)) return rounded;
  }
  return null;
}

function geometryToPolygons(geometry) {
  if (!geometry) return [];
  const groups = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return groups.map(rings => ({ outer: closeRing(rings?.[0]), holes: (rings ?? []).slice(1).map(closeRing).filter(Boolean) })).filter(p => p.outer);
}

function closeRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const points = ring.map(point => [Number(point[0]), Number(point[1])]).filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (points.length < 3) return null;
  const first = points[0], last = points.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1]) points.push([...first]);
  return points;
}

function assignStableIds(contours, options) {
  const occurrence = new Map();
  return contours.map((contour, index) => {
    const valueToken = typeof contour.value === 'number' ? String(Math.round(contour.value * 100)).padStart(2,'0') : String(contour.value).toUpperCase();
    const key = `${contour.hazardType}:${valueToken}`;
    const sequence = (occurrence.get(key) ?? 0) + 1;
    occurrence.set(key, sequence);
    const day = String(options.forecastDay ?? 'day').replace(/[^A-Za-z0-9]/g,'').toUpperCase();
    const stamp = String(options.issuedAt ?? 'unknown').replace(/[-:TZ.]/g,'').slice(0,12) || 'UNKNOWN';
    const hazard = contour.hazardType.replace(/[^A-Za-z0-9]/g,'').toUpperCase();
    return { ...contour, id: `${day}_${stamp}_${hazard}_${valueToken}_${String(sequence).padStart(2,'0')}`, sourceIndex: contour.sourceIndex ?? index };
  });
}

function issue(code, message, details, severity='warning') { return { code, message, severity, details }; }
function capitalize(value) { return value.charAt(0).toUpperCase() + value.slice(1); }

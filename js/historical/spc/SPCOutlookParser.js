export const SPC_PARSER_VERSION = '2.34.2';

export const SPC_HAZARD_TYPES = Object.freeze([
  'categorical', 'tornado', 'wind', 'hail',
  'significantTornado', 'significantWind', 'significantHail'
]);

const CATEGORY_ALIASES = Object.freeze({
  TSTM: 'TSTM', THUNDER: 'TSTM', GENERAL: 'TSTM',
  MRGL: 'MRGL', MARGINAL: 'MRGL',
  SLGT: 'SLGT', SLIGHT: 'SLGT',
  ENH: 'ENH', ENHANCED: 'ENH',
  MDT: 'MDT', MODERATE: 'MDT',
  HIGH: 'HIGH'
});

const PROBABILITY_ALIASES = Object.freeze({
  '0.02': 0.02, '2': 0.02, '2%': 0.02,
  '0.05': 0.05, '5': 0.05, '5%': 0.05,
  '0.10': 0.10, '10': 0.10, '10%': 0.10,
  '0.15': 0.15, '15': 0.15, '15%': 0.15,
  '0.30': 0.30, '30': 0.30, '30%': 0.30,
  '0.45': 0.45, '45': 0.45, '45%': 0.45,
  '0.60': 0.60, '60': 0.60, '60%': 0.60
});

export function parseSpcKml(kml, options = {}) {
  const source = String(kml ?? '');
  const placemarks = extractBlocks(source, 'Placemark');
  const warnings = [];
  const contours = [];

  placemarks.forEach((placemark, placemarkIndex) => {
    const name = decodeXml(firstTagText(placemark, 'name') ?? '').trim();
    const extended = parseExtendedData(placemark);
    const classification = classifyContour({ name, extended, ...options });
    if (!classification) {
      warnings.push(issue('unclassified-placemark', `Could not classify placemark "${name || placemarkIndex}"`, { placemarkIndex, name }));
      return;
    }
    const polygons = parseKmlPolygons(placemark, warnings, placemarkIndex);
    if (!polygons.length) {
      warnings.push(issue('missing-geometry', `Placemark "${name || placemarkIndex}" contains no valid polygons`, { placemarkIndex, name }));
      return;
    }
    contours.push(createContour({ ...classification, polygons, sourceLabel: name || null, sourceIndex: placemarkIndex }));
  });

  return createParsedProduct({
    format: 'kml',
    forecastDay: options.forecastDay,
    issuedAt: options.issuedAt,
    validStart: options.validStart,
    validEnd: options.validEnd,
    source: options.source,
    contours,
    warnings
  });
}

export function parseSpcLatLonText(text, options = {}) {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  const warnings = [];
  const contours = [];
  let activeLabel = options.label ?? null;
  let activeHazard = options.hazardType ?? null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const labelMatch = line.match(/^(TSTM|MRGL|SLGT|ENH|MDT|HIGH|SIGN|SIG|\d+(?:\.\d+)?%?)\b/i);
    if (labelMatch && !/^\d{8}\b/.test(line)) activeLabel = labelMatch[1];
    if (/^&&\s*TORNADO/i.test(line) || /TORNADO\s+PROBABILIT/i.test(line)) activeHazard = 'tornado';
    if (/^&&\s*WIND/i.test(line) || /WIND\s+PROBABILIT/i.test(line)) activeHazard = 'wind';
    if (/^&&\s*HAIL/i.test(line) || /HAIL\s+PROBABILIT/i.test(line)) activeHazard = 'hail';
    if (!/LAT\.\.\.LON/i.test(line)) continue;

    const tokens = [];
    let cursor = index;
    let remainder = lines[cursor].replace(/^.*?LAT\.\.\.LON\s*/i, ' ');
    while (cursor < lines.length) {
      tokens.push(...remainder.trim().split(/\s+/).filter(token => /^\d{8}$/.test(token)));
      cursor += 1;
      remainder = lines[cursor] ?? '';
      if (!/^\s*\d{8}(?:\s+\d{8})*\s*$/.test(remainder)) break;
    }
    index = cursor - 1;

    const classification = classifyContour({ name: activeLabel, hazardType: activeHazard, ...options });
    if (!classification) {
      warnings.push(issue('unclassified-latlon', 'LAT...LON block could not be classified', { line: index + 1, label: activeLabel, hazardType: activeHazard }));
      continue;
    }
    const ring = tokens.map(parseLatLonToken).filter(Boolean);
    const normalized = normalizeRing(ring);
    if (!normalized) {
      warnings.push(issue('invalid-latlon-ring', 'LAT...LON block did not contain at least three valid coordinates', { line: index + 1, tokenCount: tokens.length }));
      continue;
    }
    contours.push(createContour({ ...classification, polygons: [{ outer: normalized, holes: [] }], sourceLabel: activeLabel, sourceIndex: contours.length }));
  }

  return createParsedProduct({
    format: 'spc-latlon-text', forecastDay: options.forecastDay,
    issuedAt: options.issuedAt, validStart: options.validStart, validEnd: options.validEnd,
    source: options.source, contours, warnings
  });
}

export function mergeParsedSpcProducts(products, metadata = {}) {
  const valid = (products ?? []).filter(Boolean);
  const warnings = valid.flatMap(product => product.warnings ?? []);
  const contours = deduplicateContours(valid.flatMap(product => product.contours ?? []), warnings);
  return createParsedProduct({
    format: valid.map(product => product.format).filter(Boolean).join('+') || 'unknown',
    forecastDay: metadata.forecastDay ?? firstDefined(valid, 'forecastDay'),
    issuedAt: metadata.issuedAt ?? firstDefined(valid, 'issuedAt'),
    validStart: metadata.validStart ?? firstDefined(valid, 'validStart'),
    validEnd: metadata.validEnd ?? firstDefined(valid, 'validEnd'),
    source: metadata.source ?? valid.map(product => product.source).filter(Boolean),
    contours, warnings
  });
}

export function normalizeSpcOutlook(parsed, { policyEra = inferSpcPolicyEra(parsed?.issuedAt) } = {}) {
  const hazards = Object.fromEntries(SPC_HAZARD_TYPES.map(type => [type, []]));
  for (const contour of parsed?.contours ?? []) hazards[contour.hazardType]?.push(contour);
  for (const type of SPC_HAZARD_TYPES) hazards[type] = Object.freeze(sortContours(hazards[type]));
  return deepFreeze({
    schemaVersion: SPC_PARSER_VERSION,
    policyEra,
    forecastDay: parsed?.forecastDay ?? null,
    issuedAt: parsed?.issuedAt ?? null,
    validStart: parsed?.validStart ?? null,
    validEnd: parsed?.validEnd ?? null,
    hazards,
    diagnostics: {
      contourCount: parsed?.contours?.length ?? 0,
      warningCount: parsed?.warnings?.length ?? 0,
      warnings: parsed?.warnings ?? []
    }
  });
}

export function inferSpcPolicyEra(issuedAt) {
  const prefix = String(issuedAt ?? '').slice(0, 4);
  if (!/^\d{4}$/.test(prefix)) return 'unknown';
  const year = Number(prefix);
  if (!Number.isFinite(year)) return 'unknown';
  if (year < 2006) return 'pre-2006';
  if (year < 2015) return '2006-2014';
  return '2015-present';
}

function classifyContour({ name, hazardType, extended = {}, significant = false }) {
  const raw = String(extended.LABEL ?? extended.Label ?? extended.label ?? extended.PROB ?? extended.prob ?? name ?? '').trim();
  const upper = raw.toUpperCase().replace(/\s+/g, ' ');
  const explicitHazard = normalizeHazardType(hazardType ?? extended.HAZARD ?? extended.hazard ?? extended.TYPE ?? extended.type);
  const isSignificant = significant || /\b(SIG|SIGN|SIGNIFICANT)\b/.test(upper) || ['SIGN', 'SIG'].includes(upper);
  if (isSignificant) {
    const base = explicitHazard ?? inferHazardFromText(upper);
    if (!base || base === 'categorical') return null;
    return { hazardType: `significant${capitalize(base)}`, value: 'SIGN', significant: true };
  }
  const category = CATEGORY_ALIASES[upper];
  if (category) return { hazardType: 'categorical', value: category, significant: false };
  const probability = parseProbability(raw);
  if (probability != null && explicitHazard && explicitHazard !== 'categorical') return { hazardType: explicitHazard, value: probability, significant: false };
  return null;
}

function parseKmlPolygons(placemark, warnings, placemarkIndex) {
  return extractBlocks(placemark, 'Polygon').map((polygon, polygonIndex) => {
    const outerBlock = extractBlocks(polygon, 'outerBoundaryIs')[0] ?? polygon;
    const outer = normalizeRing(parseCoordinates(firstTagText(outerBlock, 'coordinates')));
    const holes = extractBlocks(polygon, 'innerBoundaryIs').map(block => normalizeRing(parseCoordinates(firstTagText(block, 'coordinates')))).filter(Boolean);
    if (!outer) {
      warnings.push(issue('invalid-kml-ring', 'KML polygon outer ring is invalid', { placemarkIndex, polygonIndex }));
      return null;
    }
    return { outer, holes };
  }).filter(Boolean);
}

function parseCoordinates(value) {
  return String(value ?? '').trim().split(/\s+/).map(token => {
    const [lon, lat] = token.split(',').map(Number);
    return validCoordinate(lon, lat) ? [lon, lat] : null;
  }).filter(Boolean);
}

function parseLatLonToken(token) {
  const lat = Number(token.slice(0, 4)) / 100;
  let lonRaw = Number(token.slice(4, 8));
  let lon = -(lonRaw / 100);
  if (lonRaw < 3000) lon = -((lonRaw + 10000) / 100);
  return validCoordinate(lon, lat) ? [lon, lat] : null;
}

function normalizeRing(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const ring = points.map(([lon, lat]) => Object.freeze([round(lon), round(lat)]));
  const [firstLon, firstLat] = ring[0];
  const [lastLon, lastLat] = ring.at(-1);
  if (firstLon !== lastLon || firstLat !== lastLat) ring.push(Object.freeze([firstLon, firstLat]));
  return ring.length >= 4 ? Object.freeze(ring) : null;
}

function createContour({ hazardType, value, significant, polygons, sourceLabel, sourceIndex }) {
  return deepFreeze({ hazardType, value, significant: Boolean(significant), polygons, sourceLabel, sourceIndex });
}

function createParsedProduct({ format, forecastDay, issuedAt, validStart, validEnd, source, contours, warnings }) {
  return deepFreeze({ schemaVersion: SPC_PARSER_VERSION, format, forecastDay: forecastDay ?? null, issuedAt: issuedAt ?? null, validStart: validStart ?? null, validEnd: validEnd ?? null, source: source ?? null, contours, warnings });
}

function deduplicateContours(contours, warnings) {
  const seen = new Set();
  return contours.filter(contour => {
    const key = JSON.stringify([contour.hazardType, contour.value, contour.polygons]);
    if (seen.has(key)) {
      warnings.push(issue('duplicate-contour', 'Duplicate contour was removed during merge', { hazardType: contour.hazardType, value: contour.value }));
      return false;
    }
    seen.add(key);
    return true;
  });
}
function normalizeHazardType(value) {
  const normalized = String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (normalized.includes('tornado') || normalized === 'tor') return 'tornado';
  if (normalized.includes('wind')) return 'wind';
  if (normalized.includes('hail')) return 'hail';
  if (normalized.includes('categor')) return 'categorical';
  return null;
}
function inferHazardFromText(value) { return normalizeHazardType(value); }
function parseProbability(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/^prob(?:ability)?\s*/i, '');
  if (PROBABILITY_ALIASES[normalized] != null) return PROBABILITY_ALIASES[normalized];
  const number = Number(normalized.replace('%', ''));
  if (!Number.isFinite(number) || number <= 0) return null;
  const probability = number > 1 ? number / 100 : number;
  return probability <= 1 ? round(probability) : null;
}
function parseExtendedData(block) {
  const values = {};
  for (const data of extractBlocks(block, 'Data')) {
    const name = data.match(/\bname=["']([^"']+)["']/i)?.[1];
    if (name) values[decodeXml(name)] = decodeXml(firstTagText(data, 'value') ?? '');
  }
  for (const simple of block.matchAll(/<SimpleData\b[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/SimpleData>/gi)) values[decodeXml(simple[1])] = decodeXml(simple[2].replace(/<[^>]+>/g, '').trim());
  return values;
}
function extractBlocks(text, tag) { return [...String(text).matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'))].map(match => match[1]); }
function firstTagText(text, tag) { return String(text).match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] ?? null; }
function decodeXml(value) { return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'"); }
function validCoordinate(lon, lat) { return Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90; }
function issue(code, message, details) { return deepFreeze({ code, message, details }); }
function sortContours(contours) { return [...contours].sort((a, b) => contourRank(a.value) - contourRank(b.value)); }
function contourRank(value) { return typeof value === 'number' ? value : ['TSTM', 'MRGL', 'SLGT', 'ENH', 'MDT', 'HIGH', 'SIGN'].indexOf(value); }
function firstDefined(items, key) { return items.map(item => item?.[key]).find(value => value != null) ?? null; }
function capitalize(value) { return value[0].toUpperCase() + value.slice(1); }
function round(value) { return Math.round(value * 1e6) / 1e6; }
function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) value.forEach(deepFreeze); else Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

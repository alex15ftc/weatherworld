export const SPC_PARSER_VERSION = '2.34.2.6';

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
  const sourceText = String(text ?? '').replace(/\r/g, '');
  const compact = parseCompactSpcOutline(sourceText, options);
  if (compact.detected) {
    return createParsedProduct({
      format: 'spc-outline-text', forecastDay: options.forecastDay,
      issuedAt: options.issuedAt, validStart: options.validStart, validEnd: options.validEnd,
      source: options.source, contours: compact.contours, warnings: compact.warnings
    });
  }

  const lines = sourceText.split('\n');
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

    const classification = classifyContour({ ...options, name: activeLabel, hazardType: activeHazard });
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

function parseCompactSpcOutline(text, options) {
  const contours = [];
  const warnings = [];
  let detected = false;
  const sectionPattern = /(?:PROBABILISTIC OUTLOOK POINTS DAY \d+\s*)?\.\.\.\s*(TORNADO|HAIL|WIND)\s*\.\.\.([\s\S]*?)(?=&&)/gi;
  for (const match of text.matchAll(sectionPattern)) {
    detected = true;
    parseOutlineSection(match[2], match[1].toLowerCase(), contours, warnings, options);
  }
  const categoricalPattern = /CATEGORICAL OUTLOOK POINTS DAY \d+\s*\.\.\.\s*CATEGORICAL\s*\.\.\.([\s\S]*?)(?=&&)/gi;
  for (const match of text.matchAll(categoricalPattern)) {
    detected = true;
    parseOutlineSection(match[1], 'categorical', contours, warnings, options);
  }
  return { detected, contours, warnings };
}

function parseOutlineSection(sectionText, hazardType, contours, warnings, options) {
  const tokens = String(sectionText).trim().split(/\s+/).filter(Boolean);
  let activeLabel = null;
  let activeCoordinates = [];
  let activePolygons = [];
  let sourceIndex = contours.length;

  const flushRing = () => {
    if (!activeCoordinates.length) return;
    const normalized = normalizeRing(activeCoordinates.map(parseLatLonToken).filter(Boolean));
    if (normalized) activePolygons.push({ outer: normalized, holes: [] });
    else warnings.push(issue('discarded-outline-fragment', 'Discarded an SPC outline fragment that did not contain at least three valid coordinates', { hazardType, label: activeLabel, tokenCount: activeCoordinates.length }, 'info'));
    activeCoordinates = [];
  };
  const flushContour = () => {
    if (!activeLabel) return;
    flushRing();
    const classification = classifyContour({ ...options, name: activeLabel, hazardType });
    if (!classification) warnings.push(issue('unclassified-outline', 'SPC outline contour could not be classified', { hazardType, label: activeLabel }));
    else if (activePolygons.length) contours.push(createContour({ ...classification, polygons: activePolygons, sourceLabel: activeLabel, sourceIndex: sourceIndex++ }));
    activeLabel = null;
    activePolygons = [];
  };

  for (const token of tokens) {
    const upper = token.toUpperCase();
    if (isOutlineLabel(upper, hazardType)) {
      flushContour();
      activeLabel = upper;
    } else if (token === '99999999') {
      flushRing();
    } else if (/^\d{8}$/.test(token)) {
      if (!activeLabel) warnings.push(issue('orphan-outline-coordinate', 'Coordinate appeared before an SPC outline label', { hazardType, token }));
      else activeCoordinates.push(token);
    }
  }
  flushContour();
}

function isOutlineLabel(token, hazardType) {
  if (hazardType === 'categorical') return CATEGORY_ALIASES[token] != null;
  return token === 'SIGN' || token === 'SIG' || PROBABILITY_ALIASES[token] != null;
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
      warningCount: (parsed?.warnings ?? []).filter(entry => entry?.severity !== 'info').length,
      infoCount: (parsed?.warnings ?? []).filter(entry => entry?.severity === 'info').length,
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

function normalizeRing(points, { clockwise = false } = {}) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const cleaned = [];
  for (const point of points) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const candidate = [round(point[0]), round(point[1])];
    if (!validCoordinate(candidate[0], candidate[1])) continue;
    const previous = cleaned.at(-1);
    if (!previous || previous[0] !== candidate[0] || previous[1] !== candidate[1]) cleaned.push(candidate);
  }
  if (cleaned.length > 1 && coordinatesEqual(cleaned[0], cleaned.at(-1))) cleaned.pop();
  if (new Set(cleaned.map(point => point.join(','))).size < 3) return null;
  cleaned.push([...cleaned[0]]);
  if (ringSelfIntersects(cleaned)) return null;
  const isClockwise = signedRingArea(cleaned) < 0;
  if (isClockwise !== clockwise) cleaned.reverse();
  return Object.freeze(cleaned.map(point => Object.freeze(point)));
}

function createContour({ hazardType, value, significant, polygons, sourceLabel, sourceIndex }) {
  return { hazardType, value, significant: Boolean(significant), polygons, sourceLabel, sourceIndex };
}

function createParsedProduct({ format, forecastDay, issuedAt, validStart, validEnd, source, contours, warnings }) {
  const occurrence = new Map();
  const enrichedContours = (contours ?? []).map((contour, index) => {
    const valueToken = formatContourValueToken(contour.value);
    const key = `${contour.hazardType}:${valueToken}`;
    const sequence = (occurrence.get(key) ?? 0) + 1;
    occurrence.set(key, sequence);
    const id = createStableContourId({ forecastDay, issuedAt, hazardType: contour.hazardType, valueToken, sequence });
    const polygons = (contour.polygons ?? []).map((polygon, polygonIndex) => enrichPolygon(polygon, polygonIndex));
    return deepFreeze({ ...contour, id, sourceIndex: contour.sourceIndex ?? index, polygons });
  });
  return deepFreeze({ schemaVersion: SPC_PARSER_VERSION, format, forecastDay: forecastDay ?? null, issuedAt: issuedAt ?? null, validStart: validStart ?? null, validEnd: validEnd ?? null, source: source ?? null, contours: enrichedContours, warnings });
}

function enrichPolygon(polygon, polygonIndex) {
  const outer = normalizeRing(polygon?.outer, { clockwise: false });
  if (!outer) throw new TypeError(`Invalid SPC polygon outer ring at index ${polygonIndex}`);
  const holes = (polygon?.holes ?? []).map(hole => normalizeRing(hole, { clockwise: true })).filter(Boolean);
  const bbox = calculateBoundingBox(outer);
  const outerAreaKm2 = sphericalRingAreaKm2(outer);
  const holesAreaKm2 = holes.reduce((sum, hole) => sum + sphericalRingAreaKm2(hole), 0);
  return deepFreeze({
    outer,
    holes,
    bbox,
    areaKm2: round(Math.max(0, outerAreaKm2 - holesAreaKm2)),
    areaCells10km: round(Math.max(0, outerAreaKm2 - holesAreaKm2) / 100),
    estimatedGridCells: Math.round(Math.max(0, outerAreaKm2 - holesAreaKm2) / 100),
    validation: { valid: true, closed: true, selfIntersections: 0 }
  });
}

function formatContourValueToken(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.round(value * 100)).padStart(2, '0');
  }
  return String(value ?? 'NA').replace(/[^A-Za-z0-9]+/g, '').toUpperCase() || 'NA';
}

function createStableContourId({ forecastDay, issuedAt, hazardType, valueToken, sequence }) {
  const day = String(forecastDay ?? 'day').replace(/[^A-Za-z0-9]+/g, '').toUpperCase();
  const stamp = String(issuedAt ?? 'unknown').replace(/[-:TZ.]/g, '').slice(0, 12) || 'UNKNOWN';
  const hazard = String(hazardType ?? 'unknown').replace(/[^A-Za-z0-9]+/g, '').toUpperCase();
  return `${day}_${stamp}_${hazard}_${valueToken}_${String(sequence).padStart(2, '0')}`;
}

function calculateBoundingBox(ring) {
  const longitudes = ring.map(point => point[0]);
  const latitudes = ring.map(point => point[1]);
  return deepFreeze({
    minLon: Math.min(...longitudes), maxLon: Math.max(...longitudes),
    minLat: Math.min(...latitudes), maxLat: Math.max(...latitudes)
  });
}

function sphericalRingAreaKm2(ring) {
  const radiusKm = 6371.0088;
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [lon1, lat1] = ring[index].map(toRadians);
    const [lon2, lat2] = ring[index + 1].map(toRadians);
    sum += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs(sum) * radiusKm * radiusKm / 2;
}

function signedRingArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  }
  return area / 2;
}

function ringSelfIntersects(ring) {
  const segmentCount = ring.length - 1;
  for (let a = 0; a < segmentCount; a += 1) {
    for (let b = a + 1; b < segmentCount; b += 1) {
      if (Math.abs(a - b) <= 1 || (a === 0 && b === segmentCount - 1)) continue;
      if (segmentsIntersect(ring[a], ring[a + 1], ring[b], ring[b + 1])) return true;
    }
  }
  return false;
}

function segmentsIntersect(a, b, c, d) {
  const orientation = (p, q, r) => Math.sign((q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]));
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 !== o2 && o3 !== o4;
}

function coordinatesEqual(a, b) { return a?.[0] === b?.[0] && a?.[1] === b?.[1]; }
function toRadians(value) { return value * Math.PI / 180; }


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
function issue(code, message, details = {}, severity = 'warning') { return deepFreeze({ code, message, severity, details }); }
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

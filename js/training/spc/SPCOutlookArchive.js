export const SPC_ARCHIVE_BASE_URL = 'https://www.spc.noaa.gov/products/outlook/archive';
export const SPC_ACQUISITION_VERSION = '2.34.1';
export const SPC_FORECAST_DAYS = Object.freeze(['day1', 'day2', 'day3']);

const ARCHIVE_FILE_RE = /day([123])otlk_(\d{8})_(\d{4})\.html/gi;
const VALID_RE = /\bValid\s+(\d{6})Z\s*-\s*(\d{6})Z\b/i;
const LINK_RE = /\bhref\s*=\s*["']([^"']+)["']/gi;

export function buildSpcArchiveYearUrl(year, baseUrl = SPC_ARCHIVE_BASE_URL) {
  const normalizedYear = normalizeYear(year);
  return `${stripTrailingSlash(baseUrl)}/${normalizedYear}/`;
}

export function parseSpcArchiveListing(html, { year, baseUrl = SPC_ARCHIVE_BASE_URL } = {}) {
  const normalizedYear = normalizeYear(year);
  const found = [];
  const seen = new Set();
  for (const match of String(html ?? '').matchAll(ARCHIVE_FILE_RE)) {
    const forecastDay = `day${match[1]}`;
    const issueDate = match[2];
    const cycle = match[3];
    const fileName = `day${match[1]}otlk_${issueDate}_${cycle}.html`;
    const identity = `${forecastDay}:${issueDate}:${cycle}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    found.push(Object.freeze({
      identity,
      forecastDay,
      issueDate,
      cycle,
      year: normalizedYear,
      fileName,
      url: new URL(fileName, buildSpcArchiveYearUrl(normalizedYear, baseUrl)).href
    }));
  }
  return Object.freeze(found.sort(compareArchiveEntries));
}

export function extractSpcArtifactLinks(html, pageUrl) {
  const accepted = [];
  const seen = new Set();
  for (const match of String(html ?? '').matchAll(LINK_RE)) {
    let url;
    try { url = new URL(decodeHtml(match[1]), pageUrl); } catch { continue; }
    if (!/^https?:$/i.test(url.protocol)) continue;
    const fileName = url.pathname.split('/').filter(Boolean).at(-1) ?? '';
    const type = classifyArtifact(fileName, url.pathname);
    if (!type || seen.has(url.href)) continue;
    seen.add(url.href);
    accepted.push(Object.freeze({ type, fileName: safeFileName(fileName || `${type}.dat`), url: url.href }));
  }
  return Object.freeze(accepted);
}

export function extractSpcProductMetadata(html, archiveEntry) {
  const text = htmlToText(html);
  const validMatch = text.match(VALID_RE);
  const issuedAt = issuanceIso(archiveEntry.issueDate, archiveEntry.cycle);
  let validStart = null;
  let validEnd = null;
  if (validMatch) {
    validStart = resolveDayHourMinute(validMatch[1], issuedAt);
    validEnd = resolveDayHourMinute(validMatch[2], validStart ?? issuedAt, { mustFollow: validStart });
  }
  const productCode = text.match(/\bSPC\s+AC\s+(\d{6})\b/i)?.[1] ?? null;
  return Object.freeze({
    issuedAt,
    validStart,
    validEnd,
    productCode,
    forecastDay: archiveEntry.forecastDay,
    issueDate: archiveEntry.issueDate,
    cycle: archiveEntry.cycle
  });
}

export function createSpcAcquisitionManifest({ requested, products = [], missing = [], duplicates = [], generatedAt = new Date().toISOString() }) {
  return Object.freeze({
    schemaVersion: SPC_ACQUISITION_VERSION,
    source: Object.freeze({
      agency: 'NOAA/NWS Storm Prediction Center',
      archiveBaseUrl: SPC_ARCHIVE_BASE_URL,
      informationalArchiveNotice: true
    }),
    requested: deepFreeze({ ...requested }),
    generatedAt: new Date(generatedAt).toISOString(),
    summary: Object.freeze({
      productCount: products.length,
      artifactCount: products.reduce((sum, product) => sum + (product.artifacts?.length ?? 0), 0),
      missingCount: missing.length,
      duplicateCount: duplicates.length
    }),
    products: deepFreeze(products),
    missing: deepFreeze(missing),
    duplicates: deepFreeze(duplicates)
  });
}

export function findDuplicateSpcProducts(products = []) {
  const byIdentity = new Map();
  for (const product of products) {
    const identity = product.identity ?? `${product.forecastDay}:${product.issueDate}:${product.cycle}`;
    const rows = byIdentity.get(identity) ?? [];
    rows.push(product);
    byIdentity.set(identity, rows);
  }
  return Object.freeze([...byIdentity.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([identity, rows]) => Object.freeze({
      identity,
      count: rows.length,
      sourceUrls: Object.freeze(rows.map(row => row.sourceUrl ?? row.url ?? null))
    })));
}

export function listMissingRequestedDates(entries, { startDate, endDate, forecastDays = SPC_FORECAST_DAYS }) {
  const present = new Set(entries.map(entry => `${entry.forecastDay}:${entry.issueDate}`));
  const missing = [];
  for (const date of dateRange(startDate, endDate)) {
    const compact = date.replaceAll('-', '');
    for (const forecastDay of forecastDays) {
      if (!present.has(`${forecastDay}:${compact}`)) missing.push(Object.freeze({ forecastDay, issueDate: compact, reason: 'no-archive-entry' }));
    }
  }
  return Object.freeze(missing);
}

export function normalizeDateInput(value, path = 'date') {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (!match) throw new TypeError(`${path} must be YYYY-MM-DD or YYYYMMDD`);
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) throw new RangeError(`${path} is not a valid calendar date`);
  return iso;
}

function classifyArtifact(fileName, pathname) {
  const lower = `${fileName} ${pathname}`.toLowerCase();
  if (/\.zip(?:$|\?)/.test(lower) || /-shp\b/.test(lower)) return 'shapefile';
  if (/\.kml(?:$|\?)/.test(lower)) return 'kml';
  if (/\.txt(?:$|\?)/.test(lower) || /ptsd[y3]/.test(lower)) return 'text';
  if (/\.html?(?:$|\?)/.test(lower)) return 'html';
  return null;
}
function issuanceIso(issueDate, cycle) {
  const normalizedDate = normalizeDateInput(issueDate, 'issueDate');
  const hour = Number(cycle.slice(0, 2));
  const minute = Number(cycle.slice(2, 4));
  if (hour > 23 || minute > 59) throw new RangeError('cycle must be HHMM');
  return `${normalizedDate}T${cycle.slice(0, 2)}:${cycle.slice(2, 4)}:00.000Z`;
}
function resolveDayHourMinute(ddhhmm, referenceIso, { mustFollow = null } = {}) {
  const reference = new Date(referenceIso);
  const day = Number(ddhhmm.slice(0, 2));
  const hour = Number(ddhhmm.slice(2, 4));
  const minute = Number(ddhhmm.slice(4, 6));
  const candidates = [-1, 0, 1].map(monthOffset => new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + monthOffset, day, hour, minute)));
  const floor = mustFollow ? new Date(mustFollow).getTime() : -Infinity;
  const viable = candidates.filter(candidate => candidate.getTime() >= floor).sort((a, b) => Math.abs(a - reference) - Math.abs(b - reference));
  return (viable[0] ?? candidates.sort((a, b) => Math.abs(a - reference) - Math.abs(b - reference))[0]).toISOString();
}
function htmlToText(html) { return decodeHtml(String(html ?? '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')); }
function decodeHtml(value) { return String(value).replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>'); }
function safeFileName(value) { return String(value).replace(/[^A-Za-z0-9._-]/g, '_'); }
function stripTrailingSlash(value) { return String(value).replace(/\/+$/, ''); }
function normalizeYear(year) { const number = Number(year); if (!Number.isInteger(number) || number < 2003 || number > 2200) throw new RangeError('year must be an integer from 2003 through 2200'); return number; }
function compareArchiveEntries(a, b) { return a.issueDate.localeCompare(b.issueDate) || a.forecastDay.localeCompare(b.forecastDay) || a.cycle.localeCompare(b.cycle); }
function dateRange(start, end) {
  const first = new Date(`${normalizeDateInput(start, 'startDate')}T00:00:00Z`);
  const last = new Date(`${normalizeDateInput(end, 'endDate')}T00:00:00Z`);
  if (last < first) throw new RangeError('endDate must not precede startDate');
  const values = [];
  for (let date = first; date <= last; date = new Date(date.getTime() + 86400000)) values.push(date.toISOString().slice(0, 10));
  return values;
}
function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) value.forEach(deepFreeze); else Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  SPC_FORECAST_DAYS,
  buildSpcArchiveYearUrl,
  createSpcAcquisitionManifest,
  extractSpcArtifactLinks,
  extractSpcProductMetadata,
  findDuplicateSpcProducts,
  listMissingRequestedDates,
  normalizeDateInput,
  parseSpcArchiveListing
} from '../js/historical/spc/SPCOutlookArchive.js';
import { fetchWithRetry, mapWithConcurrency } from '../js/historical/spc/SPCFetchClient.js';
import { buildTargetedArchiveCandidates, discoverTargetedArchiveEntries } from '../js/historical/spc/SPCArchiveDiscovery.js';

const args = parseArgs(process.argv.slice(2));
const startDate = normalizeDateInput(args.start, '--start');
const endDate = normalizeDateInput(args.end ?? args.start, '--end');
const forecastDays = normalizeForecastDays(args.days);
const outputDirectory = path.resolve(args.output ?? 'data/spc/downloads');
const manifestPath = path.resolve(args.manifest ?? path.join(outputDirectory, 'manifest.json'));
const indexCacheDirectory = path.join(outputDirectory, '.archive-index');
const overwrite = Boolean(args.overwrite);
const dryRun = Boolean(args['dry-run']);
const concurrency = positiveInteger(args.concurrency ?? 4, '--concurrency');
const retries = nonNegativeInteger(args.retries ?? 4, '--retries');
const timeoutMs = positiveInteger(args['timeout-ms'] ?? 30000, '--timeout-ms');
const maxProducts = args['max-products'] == null ? Infinity : positiveInteger(args['max-products'], '--max-products');

await mkdir(outputDirectory, { recursive: true });
const discoveryMode = normalizeDiscoveryMode(args.discovery ?? 'targeted');
const archiveEntries = [];
const prefetchedPages = new Map();
const discoveryFailures = [];
let manifestWriteQueue = Promise.resolve();

if (discoveryMode === 'targeted') {
  const candidates = buildTargetedArchiveCandidates({ startDate, endDate, forecastDays });
  console.log(`Targeted discovery: probing ${candidates.length} likely SPC product URLs instead of scanning annual indexes.`);
  const discovery = await discoverTargetedArchiveEntries(candidates, {
    request,
    concurrency,
    maxProducts,
    onProbe: ({ entry, status, found, total, error }) => {
      if (status === 'found') console.log(`[discovery ${found}/${Number.isFinite(maxProducts) ? maxProducts : '?'}] Found ${entry.identity}`);
      else if (status === 'failed') console.warn(`Discovery skipped ${entry.identity}: ${error.message}`);
    }
  });
  archiveEntries.push(...discovery.entries);
  for (const [identity, html] of discovery.pages) prefetchedPages.set(identity, html);
  discoveryFailures.push(...discovery.failures);
} else {
  const years = yearRange(startDate, endDate);
  for (const year of years) {
    const listingUrl = buildSpcArchiveYearUrl(year);
    const cachePath = path.join(indexCacheDirectory, `${year}.html`);
    const listing = await fetchListingWithCache(listingUrl, cachePath);
    archiveEntries.push(...parseSpcArchiveListing(listing, { year }).filter(entry =>
      forecastDays.includes(entry.forecastDay) && withinDateRange(entry.issueDate, startDate, endDate)
    ));
  }
}

const selectedEntries = archiveEntries.slice(0, maxProducts);

const products = [];
let completed = 0;
await mapWithConcurrency(selectedEntries, concurrency, async entry => {
  const product = await archiveProduct(entry);
  products.push(product);
  completed += 1;
  console.log(`[${completed}/${selectedEntries.length}] ${dryRun ? 'Planned' : 'Archived'} ${entry.identity} (${product.artifacts.length} artifact${product.artifacts.length === 1 ? '' : 's'})`);
  if (!dryRun) await queueManifestWrite({ partial: completed < selectedEntries.length });
  return product;
});

const manifest = await queueManifestWrite({ partial: false });
console.log(`Products: ${manifest.summary.productCount}; artifacts: ${manifest.summary.artifactCount}; missing date/products: ${manifest.summary.missingCount}; duplicates: ${manifest.summary.duplicateCount}`);
if (!dryRun) console.log(`Manifest: ${manifestPath}`);

async function archiveProduct(entry) {
  const productDirectory = path.join(outputDirectory, entry.issueDate, `${entry.forecastDay}-${entry.cycle}`);
  const pagePath = path.join(productDirectory, entry.fileName);
  const pageArtifact = dryRun
    ? { type: 'html', fileName: entry.fileName, sourceUrl: entry.url, localPath: relative(outputDirectory, pagePath), status: 'planned', byteLength: null, sha256: null }
    : await downloadArtifact(entry.url, pagePath, { overwrite, prefetchedText: prefetchedPages.get(entry.identity) });
  let html = prefetchedPages.get(entry.identity) ?? '';
  if (!dryRun && !html) html = await readFile(pagePath, 'utf8');
  const linked = dryRun ? [] : extractSpcArtifactLinks(html, entry.url).filter(artifact => artifact.url !== entry.url);
  const linkedArtifacts = await mapWithConcurrency(linked, Math.min(concurrency, 3), artifact =>
    downloadArtifact(artifact.url, path.join(productDirectory, artifact.fileName), { overwrite, type: artifact.type })
  );
  const metadata = dryRun
    ? { issuedAt: isoFromEntry(entry), validStart: null, validEnd: null, productCode: null }
    : extractSpcProductMetadata(html, entry);
  return {
    identity: entry.identity,
    forecastDay: entry.forecastDay,
    issueDate: entry.issueDate,
    cycle: entry.cycle,
    issuedAt: metadata.issuedAt,
    validStart: metadata.validStart,
    validEnd: metadata.validEnd,
    productCode: metadata.productCode,
    sourceUrl: entry.url,
    artifacts: [pageArtifact, ...linkedArtifacts]
  };
}

async function fetchListingWithCache(url, cachePath) {
  try {
    const response = await request(url);
    const text = await response.text();
    if (!dryRun) await atomicWrite(cachePath, text);
    return text;
  } catch (error) {
    if (await exists(cachePath)) {
      console.warn(`Archive index unavailable; using cached listing ${relative(process.cwd(), cachePath)} (${error.message})`);
      return readFile(cachePath, 'utf8');
    }
    throw error;
  }
}

async function downloadArtifact(url, target, { overwrite: replace = false, type = null, prefetchedText = null } = {}) {
  await mkdir(path.dirname(target), { recursive: true });
  if (!replace && await exists(target)) {
    const bytes = await readFile(target);
    return artifactRecord(url, target, bytes, 'cached', type);
  }
  const bytes = prefetchedText != null
    ? Buffer.from(prefetchedText)
    : Buffer.from(await (await request(url)).arrayBuffer());
  const temporary = `${target}.part`;
  await writeFile(temporary, bytes);
  await rename(temporary, target);
  return artifactRecord(url, target, bytes, 'downloaded', type);
}

async function request(url) {
  return fetchWithRetry(url, {
    retries,
    timeoutMs,
    headers: { 'user-agent': 'WeatherWorld historical outlook acquisition/2.34.2.1' },
    onRetry: ({ attempt, retries: retryLimit, delay, error }) => {
      console.warn(`Retry ${attempt}/${retryLimit} in ${delay}ms: ${error.message}`);
    }
  });
}


function queueManifestWrite(options) {
  const next = manifestWriteQueue.then(() => writeManifest(options));
  manifestWriteQueue = next.catch(() => {});
  return next;
}

async function writeManifest({ partial }) {
  const missing = listMissingRequestedDates(archiveEntries, { startDate, endDate, forecastDays });
  const sortedProducts = [...products].sort((a, b) => a.identity.localeCompare(b.identity));
  const duplicates = findDuplicateSpcProducts(sortedProducts);
  const result = createSpcAcquisitionManifest({
    requested: {
      startDate,
      endDate,
      forecastDays,
      outputDirectory: relative(process.cwd(), outputDirectory),
      dryRun,
      concurrency,
      retries,
      timeoutMs,
      maxProducts: Number.isFinite(maxProducts) ? maxProducts : null,
      discoveryMode
    },
    products: sortedProducts,
    missing,
    duplicates,
    generatedAt: new Date().toISOString()
  });
  const enriched = { ...result, acquisition: { partial, completed: sortedProducts.length, selected: selectedEntries.length, discoveryFailures } };
  if (!dryRun) await atomicWrite(manifestPath, `${JSON.stringify(enriched, null, 2)}\n`);
  return enriched;
}

function artifactRecord(url, target, bytes, status, type = null) {
  return { type: type ?? inferType(target), fileName: path.basename(target), sourceUrl: url, localPath: relative(outputDirectory, target), status, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}
function inferType(target) { const lower = target.toLowerCase(); if (lower.endsWith('.zip')) return 'shapefile'; if (lower.endsWith('.kml')) return 'kml'; if (lower.endsWith('.txt')) return 'text'; if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'; return 'other'; }
function parseArgs(tokens) {
  const result = {};
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token.startsWith('--')) throw new TypeError(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (['overwrite', 'dry-run'].includes(key)) result[key] = true;
    else result[key] = tokens[++index];
  }
  if (!result.start) throw new TypeError('Usage: node scripts/fetch-spc-outlooks.mjs --start YYYY-MM-DD [--end YYYY-MM-DD] [--days day1,day2,day3] [--discovery targeted|annual] [--output directory] [--manifest file] [--concurrency 4] [--retries 4] [--timeout-ms 30000] [--max-products N] [--overwrite] [--dry-run]');
  return result;
}
function normalizeDiscoveryMode(value) { const mode = String(value).trim().toLowerCase(); if (!['targeted', 'annual'].includes(mode)) throw new TypeError('--discovery must be targeted or annual'); return mode; }
function normalizeForecastDays(value) { const days = value ? value.split(',').map(item => item.trim().toLowerCase()).filter(Boolean) : [...SPC_FORECAST_DAYS]; for (const day of days) if (!SPC_FORECAST_DAYS.includes(day)) throw new TypeError(`Unsupported forecast day: ${day}`); return [...new Set(days)]; }
function positiveInteger(value, label) { const number = Number(value); if (!Number.isInteger(number) || number < 1) throw new TypeError(`${label} must be a positive integer`); return number; }
function nonNegativeInteger(value, label) { const number = Number(value); if (!Number.isInteger(number) || number < 0) throw new TypeError(`${label} must be a non-negative integer`); return number; }
function yearRange(start, end) { const values = []; for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year++) values.push(year); return values; }
function withinDateRange(compact, start, end) { const dashed = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`; return dashed >= start && dashed <= end; }
function isoFromEntry(entry) { return `${entry.issueDate.slice(0, 4)}-${entry.issueDate.slice(4, 6)}-${entry.issueDate.slice(6, 8)}T${entry.cycle.slice(0, 2)}:${entry.cycle.slice(2, 4)}:00.000Z`; }
function relative(base, target) { return path.relative(base, target).replaceAll(path.sep, '/'); }
async function exists(target) { try { await access(target); return true; } catch { return false; } }
async function atomicWrite(target, content) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.part`;
  await writeFile(temporary, content);
  try {
    await rename(temporary, target);
  } catch (error) {
    if (process.platform === 'win32' && ['EEXIST', 'EPERM'].includes(error?.code)) {
      await rm(target, { force: true });
      await rename(temporary, target);
    } else {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}

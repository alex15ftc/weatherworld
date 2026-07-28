import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  SPC_ARCHIVE_BASE_URL,
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

const args = parseArgs(process.argv.slice(2));
const startDate = normalizeDateInput(args.start, '--start');
const endDate = normalizeDateInput(args.end ?? args.start, '--end');
const forecastDays = normalizeForecastDays(args.days);
const outputDirectory = path.resolve(args.output ?? 'data/spc/downloads');
const manifestPath = path.resolve(args.manifest ?? path.join(outputDirectory, 'manifest.json'));
const overwrite = Boolean(args.overwrite);
const dryRun = Boolean(args['dry-run']);

await mkdir(outputDirectory, { recursive: true });
const years = yearRange(startDate, endDate);
const archiveEntries = [];
for (const year of years) {
  const listingUrl = buildSpcArchiveYearUrl(year);
  const listing = await fetchText(listingUrl);
  archiveEntries.push(...parseSpcArchiveListing(listing, { year }).filter(entry =>
    forecastDays.includes(entry.forecastDay) && withinDateRange(entry.issueDate, startDate, endDate)
  ));
}

const products = [];
for (const entry of archiveEntries) {
  const productDirectory = path.join(outputDirectory, entry.issueDate, `${entry.forecastDay}-${entry.cycle}`);
  const pagePath = path.join(productDirectory, entry.fileName);
  const pageArtifact = dryRun
    ? { type: 'html', fileName: entry.fileName, sourceUrl: entry.url, localPath: relative(outputDirectory, pagePath), status: 'planned', byteLength: null, sha256: null }
    : await downloadArtifact(entry.url, pagePath, { overwrite });
  let html = '';
  if (!dryRun) html = await readFile(pagePath, 'utf8');
  const linked = dryRun ? [] : extractSpcArtifactLinks(html, entry.url).filter(artifact => artifact.url !== entry.url);
  const artifacts = [pageArtifact];
  for (const artifact of linked) {
    const target = path.join(productDirectory, artifact.fileName);
    artifacts.push(await downloadArtifact(artifact.url, target, { overwrite, type: artifact.type }));
  }
  const metadata = dryRun ? { issuedAt: isoFromEntry(entry), validStart: null, validEnd: null, productCode: null } : extractSpcProductMetadata(html, entry);
  products.push({
    identity: entry.identity,
    forecastDay: entry.forecastDay,
    issueDate: entry.issueDate,
    cycle: entry.cycle,
    issuedAt: metadata.issuedAt,
    validStart: metadata.validStart,
    validEnd: metadata.validEnd,
    productCode: metadata.productCode,
    sourceUrl: entry.url,
    artifacts
  });
  console.log(`${dryRun ? 'Planned' : 'Archived'} ${entry.identity} (${artifacts.length} artifact${artifacts.length === 1 ? '' : 's'})`);
}

const missing = listMissingRequestedDates(archiveEntries, { startDate, endDate, forecastDays });
const duplicates = findDuplicateSpcProducts(products);
const manifest = createSpcAcquisitionManifest({
  requested: { startDate, endDate, forecastDays, outputDirectory: relative(process.cwd(), outputDirectory), dryRun },
  products,
  missing,
  duplicates,
  generatedAt: new Date().toISOString()
});
if (!dryRun) await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Products: ${manifest.summary.productCount}; artifacts: ${manifest.summary.artifactCount}; missing date/products: ${manifest.summary.missingCount}; duplicates: ${manifest.summary.duplicateCount}`);
if (!dryRun) console.log(`Manifest: ${manifestPath}`);

async function downloadArtifact(url, target, { overwrite: replace = false, type = null } = {}) {
  await mkdir(path.dirname(target), { recursive: true });
  if (!replace && await exists(target)) {
    const bytes = await readFile(target);
    return artifactRecord(url, target, bytes, 'cached', type);
  }
  const response = await fetch(url, { headers: { 'user-agent': 'WeatherWorld historical outlook acquisition/2.34.1' } });
  if (!response.ok) throw new Error(`SPC download failed (${response.status}) for ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const temporary = `${target}.part`;
  await writeFile(temporary, bytes);
  await rename(temporary, target);
  return artifactRecord(url, target, bytes, 'downloaded', type);
}
function artifactRecord(url, target, bytes, status, type = null) {
  return {
    type: type ?? inferType(target),
    fileName: path.basename(target),
    sourceUrl: url,
    localPath: relative(outputDirectory, target),
    status,
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex')
  };
}
function inferType(target) {
  const lower = target.toLowerCase();
  if (lower.endsWith('.zip')) return 'shapefile';
  if (lower.endsWith('.kml')) return 'kml';
  if (lower.endsWith('.txt')) return 'text';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  return 'other';
}
function parseArgs(tokens) {
  const result = {};
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token.startsWith('--')) throw new TypeError(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (['overwrite', 'dry-run'].includes(key)) result[key] = true;
    else result[key] = tokens[++index];
  }
  if (!result.start) throw new TypeError('Usage: node scripts/fetch-spc-outlooks.mjs --start YYYY-MM-DD [--end YYYY-MM-DD] [--days day1,day2,day3] [--output directory] [--manifest file] [--overwrite] [--dry-run]');
  return result;
}
function normalizeForecastDays(value) {
  const days = value ? value.split(',').map(item => item.trim().toLowerCase()).filter(Boolean) : [...SPC_FORECAST_DAYS];
  for (const day of days) if (!SPC_FORECAST_DAYS.includes(day)) throw new TypeError(`Unsupported forecast day: ${day}`);
  return [...new Set(days)];
}
function yearRange(start, end) { const values = []; for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year++) values.push(year); return values; }
function withinDateRange(compact, start, end) { const dashed = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`; return dashed >= start && dashed <= end; }
function isoFromEntry(entry) { return `${entry.issueDate.slice(0, 4)}-${entry.issueDate.slice(4, 6)}-${entry.issueDate.slice(6, 8)}T${entry.cycle.slice(0, 2)}:${entry.cycle.slice(2, 4)}:00.000Z`; }
function relative(base, target) { return path.relative(base, target).replaceAll(path.sep, '/'); }
async function fetchText(url) { const response = await fetch(url, { headers: { 'user-agent': 'WeatherWorld historical outlook acquisition/2.34.1' } }); if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`); return response.text(); }
async function exists(target) { try { await access(target); return true; } catch { return false; } }
async function atomicWrite(target, content) { await mkdir(path.dirname(target), { recursive: true }); const temporary = `${target}.part`; await writeFile(temporary, content); await rename(temporary, target); }

import path from 'node:path';
import { access, mkdir, readdir, readFile, stat, writeFile, copyFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';

export const HISTORICAL_PIPELINE_VERSION = '2.34.5';
export const DEFAULT_HISTORICAL_ROOT = 'data/historical';
export const NORMALIZED_SPC_CANDIDATES = Object.freeze([
  'data/historical/normalized/spc',
  'data/spc/normalized',
  'data/historical/spc/normalized',
  'archive/spc/normalized'
]);

export function historicalPaths(root = DEFAULT_HISTORICAL_ROOT) {
  const base = path.resolve(root);
  return Object.freeze({
    root: base,
    rawSpc: path.join(base, 'raw', 'spc'),
    normalizedSpc: path.join(base, 'normalized', 'spc'),
    rasterizedSpc: path.join(base, 'rasterized', 'spc'),
    cases: path.join(base, 'cases'),
    catalog: path.join(base, 'catalog'),
    manifest: path.join(base, 'pipeline-manifest.json'),
    legacyDataset: path.join(base, 'spc-cases')
  });
}

export async function ensureHistoricalLayout(root = DEFAULT_HISTORICAL_ROOT) {
  const paths = historicalPaths(root);
  await Promise.all([paths.rawSpc, paths.normalizedSpc, paths.rasterizedSpc, paths.cases, paths.catalog, path.join(paths.legacyDataset, 'cases')].map(dir => mkdir(dir, { recursive: true })));
  return paths;
}

export async function resolveNormalizedSpcInput({ explicitInput = null, root = DEFAULT_HISTORICAL_ROOT, cwd = process.cwd() } = {}) {
  const paths = historicalPaths(root);
  const candidates = explicitInput
    ? [path.resolve(cwd, explicitInput)]
    : [paths.normalizedSpc, ...NORMALIZED_SPC_CANDIDATES.map(item => path.resolve(cwd, item))];
  const unique = [...new Set(candidates)];
  for (const candidate of unique) {
    if (await isDirectory(candidate) && (await listJsonFilesRecursive(candidate)).length > 0) {
      return { inputRoot: candidate, searched: unique, detected: !explicitInput };
    }
  }
  const error = new Error(`No normalized SPC JSON directory was found. Searched:\n${unique.map(item => `  - ${item}`).join('\n')}\nRun historical:normalize, migrate existing files, or pass --input <directory>.`);
  error.code = 'SPC_NORMALIZED_INPUT_NOT_FOUND';
  error.searched = unique;
  throw error;
}

export async function listJsonFilesRecursive(root, { exclude = ['parse-summary.json', 'catalog.json', 'pipeline-manifest.json'] } = {}) {
  if (!(await isDirectory(root))) return [];
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith('.json') && !exclude.includes(entry.name)) files.push(full);
    }
  }
  await walk(root);
  return files.sort();
}

export async function migrateNormalizedSpcFiles(sourceRoot, destinationRoot, { overwrite = false } = {}) {
  const files = await listJsonFilesRecursive(sourceRoot);
  let copied = 0;
  let skipped = 0;
  for (const source of files) {
    const relative = path.relative(sourceRoot, source);
    const destination = path.join(destinationRoot, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    if (!overwrite && await exists(destination)) { skipped += 1; continue; }
    await copyFile(source, destination);
    copied += 1;
  }
  return { copied, skipped, total: files.length };
}

export async function needsRebuild(source, destination, pipelineVersion = HISTORICAL_PIPELINE_VERSION) {
  if (!(await exists(destination))) return true;
  const [sourceStat, destinationStat] = await Promise.all([stat(source), stat(destination)]);
  if (sourceStat.mtimeMs > destinationStat.mtimeMs) return true;
  try {
    const payload = JSON.parse(await readFile(destination, 'utf8'));
    return payload.pipelineVersion !== pipelineVersion;
  } catch {
    return true;
  }
}

export async function writePipelineManifest(filePath, manifest) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({ schemaVersion: HISTORICAL_PIPELINE_VERSION, generatedAt: new Date().toISOString(), ...manifest }, null, 2)}\n`);
}

async function exists(filePath) {
  try { await access(filePath, fsConstants.F_OK); return true; } catch { return false; }
}
async function isDirectory(filePath) {
  try { return (await stat(filePath)).isDirectory(); } catch { return false; }
}

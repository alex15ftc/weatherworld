#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseSpcKml, parseSpcLatLonText, mergeParsedSpcProducts, normalizeSpcOutlook } from '../js/historical/spc/SPCOutlookParser.js';
import { parseSpcShapefileZip } from '../js/historical/spc/SPCShapefileParser.js';

const args = parseArgs(process.argv.slice(2));
if (!args.manifest) fail('Usage: node scripts/parse-spc-outlooks.mjs --manifest <manifest.json> [--output <directory>]');
const manifestPath = path.resolve(args.manifest);
const root = path.dirname(manifestPath);
const outputRoot = path.resolve(args.output ?? path.join(root, 'normalized'));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
await mkdir(outputRoot, { recursive: true });

const summary = { schemaVersion: '2.34.2', sourceManifest: manifestPath, products: [], failures: [] };
for (const product of manifest.products ?? []) {
  try {
    const shapefileArtifact = (product.artifacts ?? []).find(artifact => artifact.type === 'shapefile');
    let merged;
    let normalized;
    if (shapefileArtifact) {
      const localPath = resolveArtifactPath(root, shapefileArtifact.localPath ?? shapefileArtifact.path);
      const buffer = await readFile(localPath);
      const result = await parseSpcShapefileZip(buffer, { ...product, fileName: shapefileArtifact.fileName, source: { url: shapefileArtifact.url, localPath: shapefileArtifact.localPath ?? shapefileArtifact.path } });
      merged = result.parsedProduct;
      normalized = result.normalizedProduct;
    } else {
      const parsed = [];
      for (const artifact of product.artifacts ?? []) {
        if (!['kml', 'text'].includes(artifact.type)) continue;
        const localPath = resolveArtifactPath(root, artifact.localPath ?? artifact.path);
        const content = await readFile(localPath, 'utf8');
        const options = { ...product, source: { url: artifact.url, localPath: artifact.localPath ?? artifact.path }, hazardType: inferHazard(artifact.fileName ?? localPath) };
        parsed.push(artifact.type === 'kml' ? parseSpcKml(content, options) : parseSpcLatLonText(content, options));
      }
      merged = mergeParsedSpcProducts(parsed, product);
      normalized = normalizeSpcOutlook(merged);
    }
    const fileName = `${product.identity?.replaceAll(':', '_') ?? `${product.forecastDay}_${product.issueDate}_${product.cycle}`}.json`;
    await writeFile(path.join(outputRoot, fileName), `${JSON.stringify({ originalProduct: product, parsedProduct: merged, normalizedProduct: normalized }, null, 2)}\n`);
    summary.products.push({ identity: product.identity, fileName, contourCount: merged.contours.length, warningCount: merged.warnings.length });
  } catch (error) {
    summary.failures.push({ identity: product.identity, message: error.message });
  }
}
await writeFile(path.join(outputRoot, 'parse-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Parsed ${summary.products.length} SPC products; ${summary.failures.length} failures.`);
if (summary.failures.length) process.exitCode = 1;

function parseArgs(values) { const out = {}; for (let i = 0; i < values.length; i += 1) { if (values[i] === '--manifest') out.manifest = values[++i]; else if (values[i] === '--output') out.output = values[++i]; } return out; }
function resolveArtifactPath(rootDir, value) { if (!value) throw new Error('Artifact has no local path'); return path.isAbsolute(value) ? value : path.resolve(rootDir, value); }
function inferHazard(fileName) { const name = String(fileName).toLowerCase(); if (/torn|_tor|prob_t/.test(name)) return 'tornado'; if (/wind|prob_w/.test(name)) return 'wind'; if (/hail|prob_h/.test(name)) return 'hail'; if (/cat|categor|otlk/.test(name)) return 'categorical'; return null; }
function fail(message) { console.error(message); process.exit(2); }

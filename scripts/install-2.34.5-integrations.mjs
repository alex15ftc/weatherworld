#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
const packagePath = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
pkg.version = '2.34.5';
pkg.scripts ??= {};
Object.assign(pkg.scripts, {
  'historical:rasterize': 'node scripts/historical-pipeline.mjs --stage rasterize',
  'historical:cases': 'node scripts/historical-pipeline.mjs --stage cases',
  'historical:catalog': 'node scripts/historical-pipeline.mjs --stage catalog',
  'historical:build': 'node scripts/historical-pipeline.mjs --stage build',
  'historical:migrate': 'node scripts/historical-pipeline.mjs --stage build --migrate',
  'test:2.34.5': 'node tests/historical-archive-pipeline-2.34.5.mjs',
  'test:regression-2.34.5': 'npm run test:regression-2.34.4 && npm run test:2.34.5'
});
await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log('Installed package.json integrations for Weather World 2.34.5.');

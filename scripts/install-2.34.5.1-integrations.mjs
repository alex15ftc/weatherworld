#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
const path = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(await readFile(path, 'utf8'));
pkg.version = '2.34.5.1';
pkg.dependencies ??= {};
pkg.dependencies.shpjs = '^6.2.0';
pkg.scripts ??= {};
pkg.scripts['test:2.34.5.1'] = 'node tests/spc-unified-categorical-2.34.5.1.mjs';
pkg.scripts['test:regression-2.34.5.1'] = 'npm run test:regression-2.34.5 && npm run test:2.34.5.1';
await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`);
console.log('Integrated Weather World 2.34.5.1 package metadata. Run npm install.');

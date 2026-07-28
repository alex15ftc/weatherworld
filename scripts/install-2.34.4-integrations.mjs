import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const packagePath = path.join(root, 'package.json');
const serverPath = path.join(root, 'server', 'index.js');

function fail(message) {
  console.error(`2.34.4 integration failed: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(packagePath)) fail('package.json was not found. Run this from the repository root.');
if (!fs.existsSync(serverPath)) fail('server/index.js was not found.');

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.version = '2.34.4';
pkg.scripts ??= {};
pkg.scripts['build:spc-dataset'] = 'node scripts/build-spc-historical-dataset.mjs';
pkg.scripts['test:2.34.4'] = 'node tests/historical-outlook-dataset-2.34.4.mjs';
pkg.scripts['test:regression-2.34.4'] = 'npm run test:regression-2.34.3 && npm run test:2.34.4';
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

let server = fs.readFileSync(serverPath, 'utf8');
let changed = false;

if (!server.includes('HISTORICAL_DATASET_ROOT')) {
  const anchor = /^(const ADVANCE_POLL_MS\s*=.*;\r?\n)/m;
  if (!anchor.test(server)) fail('Could not locate ADVANCE_POLL_MS in server/index.js.');
  server = server.replace(anchor, `$1const HISTORICAL_DATASET_ROOT = path.resolve(process.env.HISTORICAL_DATASET_ROOT ?? path.join(ROOT, 'data', 'historical', 'spc-cases'));\nconst HISTORICAL_CASE_ID_RE = /^[A-Za-z0-9._-]+$/;\n`);
  changed = true;
}

if (!server.includes("'/api/historical/outlooks/catalog'")) {
  const routeAnchor = /^(\s*if \(url\.pathname === '\/api\/map\/manifest'\).*\r?\n)/m;
  if (!routeAnchor.test(server)) fail('Could not locate the map manifest route in server/index.js.');
  const routes = [
    "  if (url.pathname === '/api/historical/outlooks/catalog') return serveHistoricalJson(req, res, path.join(HISTORICAL_DATASET_ROOT, 'catalog.json'), trace);",
    "  const historicalCase = url.pathname.match(/^\\/api\\/historical\\/outlooks\\/cases\\/([^/]+)$/);",
    '  if (historicalCase) {',
    '    const caseId = decodeURIComponent(historicalCase[1]);',
    "    if (!HISTORICAL_CASE_ID_RE.test(caseId)) return sendJson(req, res, 400, { error: 'Invalid historical case ID' }, { cacheable: false, trace });",
    "    return serveHistoricalJson(req, res, path.join(HISTORICAL_DATASET_ROOT, 'cases', `${caseId}.json`), trace);",
    '  }',
    ''
  ].join('\n');
  server = server.replace(routeAnchor, routes + '$1');
  changed = true;
}

if (!server.includes('function serveHistoricalJson(')) {
  const functionAnchor = /^(async function readJsonBody\(req\)\s*\{)/m;
  if (!functionAnchor.test(server)) fail('Could not locate readJsonBody in server/index.js.');
  const helper = [
    'function serveHistoricalJson(req, res, filename, trace) {',
    '  const resolved = path.resolve(filename);',
    '  const relative = path.relative(HISTORICAL_DATASET_ROOT, resolved);',
    "  if (relative.startsWith('..') || path.isAbsolute(relative)) return sendJson(req, res, 400, { error: 'Invalid historical dataset path' }, { cacheable: false, trace });",
    "  if (!fs.existsSync(resolved)) return sendJson(req, res, 404, { error: 'Historical dataset not built', hint: 'Run npm run build:spc-dataset -- --input <normalized-directory>' }, { cacheable: false, trace });",
    "  try { return sendJson(req, res, 200, JSON.parse(fs.readFileSync(resolved, 'utf8')), { trace }); }",
    "  catch (error) { return sendJson(req, res, 500, { error: `Historical dataset read failed: ${error.message}` }, { cacheable: false, trace }); }",
    '}',
    '',
    ''
  ].join('\n');
  server = server.replace(functionAnchor, helper + '$1');
  changed = true;
}

if (changed) fs.writeFileSync(serverPath, server);
console.log('Weather World 2.34.4 package and server integrations installed.');

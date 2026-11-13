import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sitePage, renderPage, NOT_FOUND_PAGE } from '../server/SitePages.js';

// The site's pages (server/SitePages.js): every address has its page, every page takes the shared header,
// every link in the menu and footer leads somewhere, and the engine image ships all of it.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADDRESSES = { '/': 'home.html', '/outlooks': 'outlook.html', '/outlook/day1': 'outlook.html', '/outlook/day3/': 'outlook.html', '/watches': 'products.html', '/discussions': 'products.html',
  '/warnings': 'warnings.html', '/days': 'days.html', '/day/2026-11-12-7': 'days.html', '/day/live-3': 'days.html', '/day/2026-11-12-7/analysis': 'index.html', '/day/2026-11-12-7/synoptic': 'synoptic.html', '/models/large-scale': 'synoptic.html', '/watch/43': 'product.html', '/md/97': 'product.html', '/chasers': 'chasers.html', '/analysis': 'index.html', '/synoptic': 'synoptic.html', '/models': 'models.html', '/about': 'about.html' };
for (const [address, page] of Object.entries(ADDRESSES)) assert.equal(sitePage(address), page, address);
for (const address of ['/nope', '/outlook/day4', '/watch/x', '/api/health', '/css/site.css']) assert.equal(sitePage(address), null, address);

const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
for (const page of new Set([...Object.values(ADDRESSES), NOT_FOUND_PAGE, 'performance.html'])) {
  const file = path.join(ROOT, page);
  assert.ok(fs.existsSync(file), `${page} exists`);
  const raw = fs.readFileSync(file, 'utf8'), html = renderPage(ROOT, file);
  assert.match(raw, /<!--site:head-->/, `${page} takes the shared head`);
  assert.match(raw, /<!--site:header-->/, `${page} takes the shared header`);
  assert.doesNotMatch(html, /<!--site:/, `${page}: every shared part is filled`);
  assert.match(html, /class="site-header"/, `${page} shows the header`);
  assert.ok(dockerfile.split(/\r?\n/).some(line => line.startsWith('COPY ') && line.split(' ').includes(page)), `${page} is in the engine image`);
}
for (const folder of ['site', 'fonts', 'css']) assert.match(dockerfile, new RegExp(`COPY ${folder} `), `${folder}/ is in the engine image`);

// Links in the shared parts and the pages: a site address, or a file that is there.
const shared = ['header', 'footer', 'head'].map(name => fs.readFileSync(path.join(ROOT, 'site', `${name}.html`), 'utf8')).join('\n');
const pages = [...new Set(Object.values(ADDRESSES))].map(page => fs.readFileSync(path.join(ROOT, page), 'utf8')).join('\n');
for (const [, whole] of (shared + pages).matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
  // (addresses a page's script builds, and the engine's own API, are not files or pages)
  if (whole.includes('${') || whole.startsWith('/api/')) continue;
  const href = whole.split(/[#?]/)[0];
  assert.ok(sitePage(href) || fs.existsSync(path.join(ROOT, href)), `${href} leads somewhere`);
}
console.log('Site page checks passed');

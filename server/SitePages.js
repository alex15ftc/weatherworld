// The site's pages (site/README.md): which page each address shows, and the parts every page shares.
// A page's <!--site:head-->, <!--site:header--> and <!--site:footer--> are filled from site/*.html, so the
// menu and the footer are written once.
import fs from 'node:fs';
import path from 'node:path';

// The old addresses (/index.html, /models.html, /outlook/day1) keep working: the Discord bot links to the
// outlook, watch and discussion pages.
const SITE_PAGES = [
  [/^\/$/, 'home.html'],
  [/^\/outlooks?(\/day[123])?\/?$/, 'outlook.html'],
  [/^\/(watches|discussions)\/?$/, 'products.html'],
  [/^\/warnings\/?$/, 'warnings.html'],
  [/^\/(watch|md)\/\d+\/?$/, 'product.html'],
  [/^\/chasers\/?$/, 'chasers.html'],
  [/^\/analysis\/?$/, 'index.html'],
  [/^\/synoptic\/?$/, 'synoptic.html'],
  [/^\/models\/?$/, 'models.html'],
  [/^\/models\/large-scale\/?$/, 'synoptic.html'],
  [/^\/days\/?$/, 'days.html'],
  [/^\/day\/[A-Za-z0-9-]+\/?$/, 'days.html'],
  // A saved day's replays: the mesoanalysis and large-scale pages on the day's kept hours.
  [/^\/day\/[A-Za-z0-9-]+\/analysis\/?$/, 'index.html'],
  [/^\/day\/[A-Za-z0-9-]+\/synoptic\/?$/, 'synoptic.html'],
  [/^\/about\/?$/, 'about.html']
];
export const NOT_FOUND_PAGE = '404.html';

// The page file an address shows, or null when the address is not one of the site's pages.
export const sitePage = pathname => SITE_PAGES.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;

// The shared parts are read again when their file changes, so editing needs no restart.
const partials = new Map();
function partial(root, name) {
  const file = path.resolve(root, 'site', `${name}.html`);
  try {
    const stamp = fs.statSync(file).mtimeMs, hit = partials.get(file);
    if (hit?.stamp === stamp) return hit.text;
    const text = fs.readFileSync(file, 'utf8');
    partials.set(file, { stamp, text });
    return text;
  } catch { return ''; }
}

// A page's HTML with its shared parts put in.
export const renderPage = (root, filename) => fs.readFileSync(filename, 'utf8').replace(/<!--site:(head|header|footer)-->/g, (_, name) => partial(root, name));

export const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

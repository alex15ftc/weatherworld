// A picture of a page, taken by a headless Chrome or Edge (CHROME=path to choose one), as the day-review
// charts are. Used by make-post.mjs and make-loop.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);
const browser = CANDIDATES.find(file => fs.existsSync(file));
const profile = path.join(os.tmpdir(), 'weatherworld-social-chrome');

// url: http(s) or file URL. waitMs: page time allowed for its data to load and draw.
export function screenshot(url, file, { width = 1600, height = 900, waitMs = 6000 } = {}) {
  if (!browser) throw new Error('No Chrome or Edge found; set CHROME to its path.');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const run = spawnSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--blink-settings=preferredColorScheme=1',
    `--user-data-dir=${profile}`, `--window-size=${width},${height}`, `--virtual-time-budget=${waitMs}`, `--screenshot=${path.resolve(file)}`, url], { encoding: 'utf8' });
  if (!fs.existsSync(file)) throw new Error(`No picture written for ${url}: ${run.stderr?.slice(-400)}`);
  return file;
}

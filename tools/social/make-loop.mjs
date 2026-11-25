// Makes loops of the synoptic charts for a recorded day (tools/social/README.md): each analysis of the day
// is drawn by the site's own synoptic page in its share view (title, time, key and the site's name in the
// frame), and the pictures are joined into an MP4 (what X, Bluesky and Reddit play) and a small GIF (Discord).
//   node tools/social/make-loop.mjs <day dir> [--charts vort,jet] [--zoom 1.7] [--fps 5] [--size 1600x900] [--hold] [--codec av1]
// <day dir>/raw is a day recorded by record-live.mjs. Needs Chrome or Edge, and ffmpeg.
// The MP4 is AV1 (ffmpeg's SVT-AV1): a constant quantizer of 18 for a picture taller than 1080 lines, else a
// constant 8000 kbit/s. --codec h264 makes it H.264 instead, for a site or a player that does not take AV1.
// By default the game map is held in the middle of the picture, so the weather is seen passing over the map.
// --hold instead holds the view on where the map is in the middle of the loop, so the map's box moves through
// the weather. Neither draws an arrow for the map's drift. Charts: jet, wind500, vort, llj, surface,
// moisture (js/pages/synopticPage.js PRESETS; the fields recorded are listed in record-live.mjs).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { screenshot } from './chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), DAY = path.resolve(args[0] ?? '.'), RAW = path.join(DAY, 'raw'), OUT = path.join(DAY, 'post');
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const CHARTS = flag('charts', 'vort,wind500,jet').split(','), ZOOM = Number(flag('zoom', 1.7)), FPS = Number(flag('fps', 5)), PORT = Number(flag('port', 8097));
const [WIDTH, HEIGHT] = flag('size', '1600x900').split('x').map(Number);
const CODEC = flag('codec', 'av1');
if (!['av1', 'h264'].includes(CODEC)) throw new Error('--codec is av1 or h264');
// (constant bit rate needs SVT-AV1's low-delay order of frames; aq-mode 0 keeps the quantizer the same all over)
const VIDEO = CODEC === 'h264' ? ['-c:v', 'libx264', '-crf', '20']
  : HEIGHT > 1080 ? ['-c:v', 'libsvtav1', '-qp', '18', '-svtav1-params', 'rc=0:aq-mode=0']
    : ['-c:v', 'libsvtav1', '-b:v', '8000k', '-svtav1-params', 'rc=2:pred-struct=1'];
// ffmpeg: FFMPEG=path, else the one on PATH, else winget's copy (not on PATH in every shell on Windows).
function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  if (spawnSync('ffmpeg', ['-version']).status === 0) return 'ffmpeg';
  const packages = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft/WinGet/Packages');
  for (const dir of fs.existsSync(packages) ? fs.readdirSync(packages).filter(d => /ffmpeg/i.test(d)) : []) {
    const hit = fs.readdirSync(path.join(packages, dir), { recursive: true }).find(f => /bin[\\/]ffmpeg\.exe$/.test(String(f)));
    if (hit) return path.join(packages, dir, String(hit));
  }
  throw new Error('ffmpeg not found; set FFMPEG to its path.');
}
const FFMPEG = findFfmpeg();
const NAMES = { vort: 'vorticity-500mb', wind500: 'wind-500mb', jet: 'wind-250mb', llj: 'low-level-jet-850mb', surface: 'surface-temperature', moisture: 'surface-dewpoint' };

const hours = fs.readdirSync(path.join(RAW, 'synoptic')).filter(f => f.endsWith('.json.gz')).map(f => Number(f.replace('.json.gz', ''))).sort((a, b) => a - b);
if (hours.length < 2) throw new Error(`Fewer than two recorded analyses in ${RAW}/synoptic`);
// --hold: the view stays on the map's place in the middle of the loop.
let hold = '';
if (args.includes('--hold')) {
  const middle = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(RAW, 'synoptic', `${hours[hours.length >> 1].toFixed(3).padStart(9, '0')}.json.gz`)))).summary.map;
  hold = `&follow=0&cx=${(middle.x + middle.width / 2).toFixed(2)}&cy=${(middle.y + middle.height / 2).toFixed(2)}`;
}

const server = spawn(process.execPath, [path.join(ROOT, 'scripts/site-preview.mjs'), '--port', String(PORT), '--replay', RAW], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('exit', () => reject(new Error('The preview server did not start'))); });
try {
  for (const chart of CHARTS) {
    const frames = path.join(OUT, 'frames', chart), name = `3-${NAMES[chart] ?? chart}`;
    fs.rmSync(frames, { recursive: true, force: true });
    hours.forEach((hour, k) => {
      screenshot(`http://localhost:${PORT}/synoptic?share=1&chart=${chart}&frame=${hour}&zoom=${ZOOM}${hold}`, path.join(frames, `${String(k).padStart(3, '0')}.png`), { width: WIDTH, height: HEIGHT, waitMs: 4000 });
      process.stdout.write(`\r${chart}: ${k + 1}/${hours.length}`);
    });
    // The last analysis is held for a moment before the loop starts again.
    const last = hours.length - 1, held = Math.round(FPS * 1.4);
    for (let k = 1; k <= held; k++) fs.copyFileSync(path.join(frames, `${String(last).padStart(3, '0')}.png`), path.join(frames, `${String(last + k).padStart(3, '0')}.png`));
    const input = ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, '%03d.png')];
    const run = (extra, file) => { const r = spawnSync(FFMPEG, [...input, ...extra, path.join(OUT, file)], { stdio: 'inherit', env: { ...process.env, SVT_LOG: '1' } }); if (r.status !== 0) throw new Error(`ffmpeg failed for ${file}`); };
    run([...VIDEO, '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart'], `${name}.mp4`);
    run(['-vf', `fps=${FPS},scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`], `${name}.gif`);
    fs.copyFileSync(path.join(frames, `${String(last).padStart(3, '0')}.png`), path.join(OUT, `${name}.png`));
    const mb = file => (fs.statSync(path.join(OUT, file)).size / 1048576).toFixed(1);
    console.log(`\r${name}: ${hours.length} analyses (${hours[0]} to ${hours.at(-1)}), mp4 ${mb(`${name}.mp4`)} MB, gif ${mb(`${name}.gif`)} MB`);
  }
} finally { server.kill(); }

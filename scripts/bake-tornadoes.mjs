// Bakes the tornado images the Roblox place draws its tornadoes with: every funnel shape the
// engine names (describeFunnel in js/storms/StormAppearance.js), and multiple-vortex ones, each
// through its life and seen from 8 sides.
//   node scripts/bake-tornadoes.mjs [--only cone,wedge] [--out roblox/Textures/build]
//
// Each archetype's tornado is found from the engine itself: a search over wind, core width,
// cloud base and wall-cloud width for settings the engine's own funnel model (funnelProfile)
// draws as that shape. It is drawn as the funnel the game would build from particles
// (js/meshes/tornadoParticles.js), simulated headlessly (js/bake/headlessParticles.js).
//
// Its life is 64 frames: 0-15 the funnel lowering from the cloud, 16-39 mature (still moving),
// 40-55 roping out (narrowing, leaning, contorting), 56-63 lifting away. Every frame is drawn
// from 8 sides (bearings 0, 45, ... 315: where the camera stands), so the game can turn it by
// stepping round them. Debris is not baked: the game draws it, sized by the engine.
//
// Output, per archetype: tornado-<name>-<bearing>.png, 8 x 8 frames of 128 px; manifest.json
// (merged with what is there) records the layout; preview-tornadoes.png shows every archetype.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { funnelProfile, describeFunnel } from '../js/storms/StormAppearance.js';
import { tornadoEmitters } from '../js/meshes/tornadoParticles.js';
import { spriteSheet } from '../js/meshes/cloudTextures.js';
import { HeadlessParticles, renderPuffs, downsampleHalf } from '../js/bake/headlessParticles.js';
import { png } from '../js/bake/png.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const OUT = path.resolve(ROOT, flag('--out', 'roblox/Textures/build'));
const ONLY = flag('--only', null)?.split(',');

const VIEWS = [0, 45, 90, 135, 180, 225, 270, 315];
const GRID = 8, CELL = 128, RENDER = CELL * 2, FRAMES = GRID * GRID;
const SECONDS_PER_FRAME = 0.35; // simulated time between frames: neighbouring frames stay close
const MPH = 0.44704;
// The particles are tuned for the game, where each puff fills much of the screen; a 128 px image
// needs them bigger, denser and a shade greyer to read as one funnel.
const LOOK = { sizeGain: 1.4, alphaGain: 1.8, tint: 0.8 };

// The shapes, with the kind of tornado to look for (the closest match wins) and, for the
// multiple-vortex ones, how many vortices.
const ARCHETYPES = [
  { name: 'cone', want: { mph: 150, coreM: 110, baseM: 1000, flareM: 1200 } },
  { name: 'stovepipe', want: { mph: 175, coreM: 170, baseM: 900, flareM: 260 } },
  { name: 'wedge', want: { mph: 210, coreM: 420, baseM: 800, flareM: 1400 } },
  { name: 'partial wedge', minCondensed: 0, want: { mph: 150, coreM: 380, baseM: 1100, flareM: 1300 } },
  { name: 'drillbit', want: { mph: 110, coreM: 35, baseM: 1000, flareM: 400 } },
  { name: 'rope', want: { mph: 95, coreM: 30, baseM: 1100, flareM: 400 }, lean: 0.7, decay: 0.5, bakeLean: 0.3 },
  { name: 'elephant trunk', want: { mph: 150, coreM: 110, baseM: 1000, flareM: 1200 }, lean: 0.8, bakeLean: 0.45 },
  { name: 'uncondensed', minCondensed: 0, want: { mph: 85, coreM: 60, baseM: 1500, flareM: 900 } },
  { name: 'wedge', id: 'wedge-multi', vortices: 4, want: { mph: 220, coreM: 420, baseM: 800, flareM: 1400 } },
  { name: 'cone', id: 'cone-multi', vortices: 3, want: { mph: 170, coreM: 160, baseM: 1000, flareM: 1200 } },
  { name: 'stovepipe', id: 'stovepipe-multi', vortices: 3, want: { mph: 185, coreM: 200, baseM: 900, flareM: 300 } },
];

// The settings closest to `want` that the engine's funnel model calls `name`.
function find(arch) {
  let best = null;
  for (let mph = 70; mph <= 320; mph += 5) {
    for (const coreM of [20, 25, 30, 35, 45, 60, 80, 100, 120, 140, 170, 200, 250, 300, 350, 400, 450, 500, 600]) {
      for (const baseM of [700, 800, 900, 1000, 1100, 1200, 1350, 1500]) {
        for (const flareM of [200, 260, 300, 400, 600, 900, 1200, 1400, 1800]) {
          const funnel = funnelProfile(mph * MPH, coreM, baseM, flareM);
          if (describeFunnel(funnel, baseM, arch.lean ?? 0, arch.decay ?? 0).name !== arch.name) continue;
          // Condensed (nearly) to the ground, except the shapes that by definition are not.
          const condensed = 1 - funnel.bottomM / baseM;
          if (condensed < (arch.minCondensed ?? 0.9)) continue;
          const w = arch.want;
          const score = ((mph - w.mph) / 60) ** 2 + Math.log(coreM / w.coreM) ** 2 + ((baseM - w.baseM) / 400) ** 2 + Math.log(flareM / w.flareM) ** 2 * 0.3;
          if (!best || score < best.score) best = { score, mph, coreM, baseM, flareM, funnel };
        }
      }
    }
  }
  if (!best) throw new Error(`the engine has no ${arch.name} near ${JSON.stringify(arch.want)}`);
  return best;
}

// The tornado as StormAppearance describes it, at a point in its life (frame 0..63).
function tornadoAt(arch, found, frame) {
  const { mph, coreM, baseM, funnel } = found;
  const forming = Math.min(1, (frame + 1) / 16);
  const decaying = frame < 40 ? 0 : Math.min(1, (frame - 39) / 16);
  const lifting = frame < 56 ? 0 : (frame - 55) / 8;
  const rope = arch.name === 'rope';
  // Roping out: narrower, leaning further and contorting.
  const narrow = 1 - decaying * (rope ? 0.3 : 0.72);
  // The flare into the cloud base is cut (the game draws that cloud), so the image stays tall;
  // a wedge keeps its width.
  const midR = funnel.radii[Math.floor(funnel.radii.length / 2)];
  const maxR = Math.min(Math.max(midR * 2.5, baseM * 0.1), Math.max(baseM * 0.42, Math.min(midR, baseM) * 1.3));
  const radii = funnel.radii.map(r => Math.min(maxR, r) * narrow);
  // Only shapes that lean by definition lean: the game stands the image upright, so a rope-out
  // shows as narrowing and contorting instead.
  const lean = arch.bakeLean ?? arch.lean ?? 0;
  const contortion = Math.min(1, (arch.decay ?? 0) * 0.6 + decaying);
  const vortices = arch.vortices ?? 1;
  return {
    touch: frame < 16 ? forming : 1 - lifting,
    baseM, funnelRadiusM: radii, condensedM: funnel.bottomM,
    tiltEastM: lean * baseM, tiltNorthM: 0, contortion,
    windMph: mph * (1 - 0.4 * decaying), coreRadiusM: coreM * narrow,
    vortices: decaying > 0.5 ? 1 : vortices, subvortexRadiusM: vortices > 1 ? 0.2 * coreM : 0,
    rainWrap: 0, debris: { strength: 0, radiusM: 0, heightM: 0, dust: 0 },
  };
}

function bake(arch, sheets) {
  const found = find(arch);
  const id = arch.id ?? arch.name.replace(/ /g, '-');
  const { baseM } = found;
  // The frame: square, ground on its bottom edge, wide enough for the widest funnel and lean.
  let reach = 0;
  for (let f = 0; f < FRAMES; f++) {
    const t = tornadoAt(arch, found, f);
    const widest = Math.max(...t.funnelRadiusM);
    const puff = Math.min(300, widest * 1.6) * 1.15 * LOOK.sizeGain * 0.5; // a puff reaches past the funnel by half its size
    reach = Math.max(reach, widest + Math.abs(t.tiltEastM) * 0.9 + puff);
  }
  const box = Math.max(baseM * 1.12, 2 * reach * 1.05);
  const sheetsOut = VIEWS.map(() => new Uint8ClampedArray(GRID * CELL * GRID * CELL * 4));
  const sim = new HeadlessParticles(id.length * 7919 + 13);
  const scale = { tornado: 1, sky: 1, km: 1000 };
  sim.setEmitters(tornadoEmitters({ tornado: tornadoAt(arch, found, 0) }, scale));
  sim.run(6);
  const started = Date.now();
  for (let f = 0; f < FRAMES; f++) {
    const t = tornadoAt(arch, found, f);
    sim.setEmitters(tornadoEmitters({ tornado: t }, scale).filter(e => e.name !== 'dustCloud'));
    sim.run(SECONDS_PER_FRAME);
    const puffs = sim.placed();
    VIEWS.forEach((bearing, v) => {
      const frame = downsampleHalf(renderPuffs(puffs, sheets, bearing, box, RENDER, LOOK), RENDER);
      const sheet = sheetsOut[v], ox = (f % GRID) * CELL, oy = Math.floor(f / GRID) * CELL, W = GRID * CELL;
      for (let y = 0; y < CELL; y++) sheet.set(frame.subarray(y * CELL * 4, (y + 1) * CELL * 4), ((oy + y) * W + ox) * 4);
    });
  }
  const files = {};
  VIEWS.forEach((bearing, v) => {
    const file = `tornado-${id}-${String(bearing).padStart(3, '0')}.png`;
    writeFileSync(path.join(OUT, file), png(GRID * CELL, GRID * CELL, sheetsOut[v]));
    files[bearing] = file;
  });
  const midRadiusM = found.funnel.radii[Math.floor(found.funnel.radii.length / 2)];
  console.log(`${id}: ${found.mph} mph, core ${found.coreM} m, base ${found.baseM} m, flare ${found.flareM} m; frame ${Math.round(box)} m (${Math.round((Date.now() - started) / 1000)} s)`);
  return {
    id,
    entry: {
      shape: arch.name, vortices: arch.vortices ?? 1, grid: GRID, frames: FRAMES,
      // The frame is frameShare cloud-base heights square, standing on the ground; the funnel's
      // radius halfway up is midRadiusShare of the base height.
      frameShare: box / baseM, midRadiusShare: midRadiusM / baseM,
      views: VIEWS, files,
    },
    preview: sheetsOut[0],
  };
}

function main() {
  mkdirSync(OUT, { recursive: true });
  console.log('making the puff textures...');
  const sheets = { smoke: { ...spriteSheet('smoke', 1, 96, 4), grid: 4 }, dust: { ...spriteSheet('dust', 1, 96, 4), grid: 4 } };
  const baked = [];
  for (const arch of ARCHETYPES) {
    const id = arch.id ?? arch.name.replace(/ /g, '-');
    if (ONLY && !ONLY.includes(id)) continue;
    baked.push(bake(arch, sheets));
  }
  // The manifest: these tornadoes, alongside whatever else is there (the cloud sheets).
  const manifestFile = path.join(OUT, 'manifest.json');
  const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {};
  delete manifest.tornado;
  manifest.tornadoes = manifest.tornadoes ?? {};
  for (const b of baked) manifest.tornadoes[b.id] = b.entry;
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  // Preview: per archetype, 16 frames of its life from the first side, over a sky.
  const tile = 96, cols = 16, W = cols * tile, H = baked.length * tile, sky = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) { const y = (Math.floor(p / W) % tile) / tile; sky[p * 4] = 110 + 40 * y; sky[p * 4 + 1] = 130 + 35 * y; sky[p * 4 + 2] = 160 + 25 * y; sky[p * 4 + 3] = 255; }
  baked.forEach((b, row) => {
    for (let k = 0; k < cols; k++) {
      const f = k * 4, sx = (f % GRID) * CELL, sy = Math.floor(f / GRID) * CELL, SW = GRID * CELL;
      for (let j = 0; j < tile; j++) for (let i = 0; i < tile; i++) {
        const s = ((sy + Math.floor(j * CELL / tile)) * SW + sx + Math.floor(i * CELL / tile)) * 4;
        const d = ((row * tile + j) * W + k * tile + i) * 4, a = b.preview[s + 3] / 255;
        for (let c = 0; c < 3; c++) sky[d + c] = sky[d + c] * (1 - a) + b.preview[s + c] * a;
      }
    }
  });
  writeFileSync(path.join(OUT, 'preview-tornadoes.png'), png(W, H, sky));
  console.log(`${baked.length} archetypes -> ${path.relative(ROOT, OUT)}`);
}

main();

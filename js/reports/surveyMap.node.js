// What a damage survey can find on the ground (damageSurvey.js), from the built world map
// (data/worldmap/seed-N): each half-mile cell's kind of ground (a town's core or its edge,
// forest, cedar range, or farmland), the elementary schools' lots and the industrial parks.
// Read once per map seed; null if the map is not built.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cache = new Map();
const COVER_GROUND = { forest: 'forest', riparian: 'forest', breaks: 'cedars', redRange: 'cedars', urban: 'townCore', suburban: 'townEdge', water: null };
const GROUNDS = [null, 'townCore', 'townEdge', 'forest', 'cedars', 'farm'];

export function surveyMap(seed = 1) {
  if (cache.has(seed)) return cache.get(seed);
  let map = null;
  try { map = build(path.join(ROOT, 'data', 'worldmap', `seed-${seed}`)); } catch (error) { console.warn(`[survey] world map unavailable (${error?.message ?? error}); surveys will find no damage points`); }
  cache.set(seed, map);
  return map;
}

function build(dir) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const cover = fs.readFileSync(path.join(dir, 'cover.u8')), size = meta.size, cell = meta.cellMiles;
  const ground = new Uint8Array(size * size);
  for (let k = 0; k < ground.length; k++) {
    const kind = meta.cover[cover[k]], g = kind in COVER_GROUND ? COVER_GROUND[kind] : 'farm';
    ground[k] = GROUNDS.indexOf(g);
  }
  // Towns: their core and the rest of their extent, over whatever cover is there.
  for (const s of meta.settlements ?? []) {
    const extent = s.extentMi ?? s.coreMi ?? 0.5, core = s.coreMi ?? extent / 3;
    const i0 = Math.max(0, Math.floor((s.x - extent) / cell)), i1 = Math.min(size - 1, Math.floor((s.x + extent) / cell));
    const j0 = Math.max(0, Math.floor((s.y - extent) / cell)), j1 = Math.min(size - 1, Math.floor((s.y + extent) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot((i + 0.5) * cell - s.x, (j + 0.5) * cell - s.y), k = j * size + i;
      if (d <= core) ground[k] = 1; else if (d <= extent && ground[k] !== 1) ground[k] = 2;
    }
  }
  const facilities = JSON.parse(fs.readFileSync(path.join(dir, 'facilities.json'), 'utf8'));
  const schools = (facilities.schools ?? []).filter(s => s.level === 'elementary' && s.lot?.length).map(s => box(s.lot));
  const industry = (facilities.landUse?.areas ?? []).filter(a => a.kind === 'industrial' && a.poly?.length).map(a => ({ ...box(a.poly), poly: a.poly }));
  const inBox = (b, x, y) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
  return {
    size, cellMiles: cell,
    groundAt(x, y) { const i = Math.floor(x / cell), j = Math.floor(y / cell); return i < 0 || j < 0 || i >= size || j >= size ? null : GROUNDS[ground[j * size + i]]; },
    schoolAt: (x, y) => schools.some(b => inBox(b, x, y)),
    industrialAt: (x, y) => industry.some(b => inBox(b, x, y) && inside(b.poly, x, y))
  };
}

const box = poly => ({ x0: Math.min(...poly.map(p => p[0])), x1: Math.max(...poly.map(p => p[0])), y0: Math.min(...poly.map(p => p[1])), y1: Math.max(...poly.map(p => p[1])) });
function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit; }
  return hit;
}

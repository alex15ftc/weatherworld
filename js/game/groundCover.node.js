// The world map's ground cover round a place (data/worldmap/seed-N: cover.u8, a byte a half-mile
// cell, row by row from the north-west corner, its classes in meta.json `cover`), for the game's
// tornado scene (js/game/TornadoScene.js): what a tornado there picks up - red soil on the red
// range, sand in the sandhills, crop stubble, grass, trees, a town. Map miles east and south of the
// north-west corner are the engine's km / 1.609344.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const KM_PER_MILE = 1.609344;
const maps = new Map();
function load(seed) {
  if (maps.has(seed)) return maps.get(seed);
  let map = null;
  try {
    const dir = fileURLToPath(new URL(`../../data/worldmap/seed-${seed}/`, import.meta.url));
    const meta = JSON.parse(fs.readFileSync(dir + 'meta.json', 'utf8'));
    map = { seed, size: meta.size, cellMiles: meta.cellMiles, classes: meta.cover, cover: fs.readFileSync(dir + 'cover.u8') };
  } catch { map = null; }
  maps.set(seed, map);
  return map;
}

// The cover at (xKm, yKm) (engine map km, y south) and the share of each class within radiusKm of it;
// null without the map. seed: the map's (the game's place is built from seed 1's).
export function groundCoverAt(xKm, yKm, radiusKm = 1, seed = 1) {
  const m = load(seed);
  if (!m) return null;
  const cell = m.cellMiles, xMi = xKm / KM_PER_MILE, yMi = yKm / KM_PER_MILE, rMi = Math.max(cell / 2, radiusKm / KM_PER_MILE);
  const classAt = (i, j) => (i >= 0 && j >= 0 && i < m.size && j < m.size ? m.classes[m.cover[j * m.size + i]] ?? null : null);
  const counts = {};
  let n = 0;
  for (let j = Math.floor((yMi - rMi) / cell); j <= Math.floor((yMi + rMi) / cell); j++) {
    for (let i = Math.floor((xMi - rMi) / cell); i <= Math.floor((xMi + rMi) / cell); i++) {
      if (Math.hypot((i + 0.5) * cell - xMi, (j + 0.5) * cell - yMi) > rMi) continue;
      const c = classAt(i, j);
      if (c == null) continue;
      counts[c] = (counts[c] ?? 0) + 1; n++;
    }
  }
  const shares = Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c, k]) => [c, Math.round(100 * k / n) / 100]));
  return { mapSeed: seed, at: classAt(Math.floor(xMi / cell), Math.floor(yMi / cell)), radiusKm: Math.round(rMi * KM_PER_MILE * 100) / 100, shares };
}

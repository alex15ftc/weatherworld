// A map zoomed in on a product's area (a watch, a mesoscale discussion, a warning's polygon), as an
// SVG for the public pages and the Discord posts (ProductArchive.js). Shapes are rings in map miles
// (flat lists x1, y1, x2, y2 ..., 0-500 east and south from the north-west corner), as the game
// products carry them (GameProducts.js); layer: the county layer (CountyLayer.js countiesFor).
const FONT = 'DejaVu Sans, Segoe UI, Arial, Helvetica, sans-serif';
const W = 1000, FOOTER = 40;

const escapeXml = text => String(text).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

// The square of map miles to show: the shapes' bounds with room around them, at least minMiles across.
function viewOf(rings, { pad = 0.35, minMiles = 60, mapMiles = 500 } = {}) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const flat of rings) for (let k = 0; k < flat.length; k += 2) { x0 = Math.min(x0, flat[k]); x1 = Math.max(x1, flat[k]); y0 = Math.min(y0, flat[k + 1]); y1 = Math.max(y1, flat[k + 1]); }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, size: mapMiles };
  const size = Math.min(mapMiles, Math.max(minMiles, (x1 - x0) * (1 + 2 * pad), (y1 - y0) * (1 + 2 * pad)));
  // Kept inside the map, so a product near its edge does not leave half the picture empty.
  const inside = v => Math.min(Math.max(v, 0), mapMiles - size);
  return { x: inside((x0 + x1) / 2 - size / 2), y: inside((y0 + y1) / 2 - size / 2), size };
}

// shapes: [{ rings, fill, fillOpacity, stroke, width, dash, label }]; focus: the rings to frame
// (all shapes' rings when left out); key: [{ colour, text }]; footer: a line under the key (bold
// part first: [bold, rest]).
export function areaSvg({ layer, shapes, focus = null, key = [], footer = null, minMiles = 60 }) {
  const mapMiles = layer?.miles ?? 500, view = viewOf(focus ?? shapes.flatMap(s => s.rings), { minMiles, mapMiles }), scale = W / view.size;
  const X = x => ((x - view.x) * scale).toFixed(1), Y = y => ((y - view.y) * scale).toFixed(1);
  const flatPath = rings => rings.map(flat => { let d = `M${X(flat[0])} ${Y(flat[1])}`; for (let k = 2; k < flat.length; k += 2) d += `L${X(flat[k])} ${Y(flat[k + 1])}`; return `${d}Z`; }).join('');
  const nestedPath = rings => rings.map(ring => `M${ring.map(([x, y]) => `${X(x)} ${Y(y)}`).join('L')}Z`).join('');
  // The key's entries side by side, each as wide as its text, onto a new row when one is full.
  const keySpots = [];
  let kx = 24, row = 0;
  for (const k of key) {
    const width = 44 + k.text.length * 8.4;
    if (kx > 24 && kx + width > W - 24) { kx = 24; row++; }
    keySpots.push({ ...k, x: kx, y: W + 18 + row * 36 });
    kx += width + 28;
  }
  const keyHeight = key.length ? 64 + row * 36 : 0, height = W + keyHeight + (footer ? FOOTER : 0);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" font-family="${FONT}">`];
  out.push(`<defs><clipPath id="map"><rect width="${W}" height="${W}"/></clipPath></defs><rect width="${W}" height="${height}" fill="#ffffff"/>`);
  out.push(`<g clip-path="url(#map)"><rect width="${W}" height="${W}" fill="#dfe3e8"/>`);
  out.push(`<rect x="${X(0)}" y="${Y(0)}" width="${(mapMiles * scale).toFixed(1)}" height="${(mapMiles * scale).toFixed(1)}" fill="#f4f1e8"/>`);
  for (const s of shapes) if (s.rings.length && s.fill) out.push(`<path d="${flatPath(s.rings)}" fill="${s.fill}" fill-opacity="${s.fillOpacity ?? 0.35}" fill-rule="evenodd"/>`);
  const counties = layer?.counties ?? [];
  if (counties.length) out.push(`<path d="${counties.map(c => nestedPath(c.rings)).join('')}" fill="none" stroke="#6f6a5f" stroke-opacity="0.55" stroke-width="${view.size < 150 ? 1.2 : 0.8}"/>`);
  for (const s of shapes) if (s.rings.length) out.push(`<path d="${flatPath(s.rings)}" fill="none" stroke="${s.stroke ?? s.fill ?? '#000'}" stroke-width="${s.width ?? 4}" stroke-linejoin="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`);
  // Close in, the counties' names (the middle of their first ring), as the warning graphics have them.
  if (view.size <= 140) {
    for (const c of counties) {
      const ring = c.rings[0]; if (!ring?.length) continue;
      const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
      if (cx < view.x || cx > view.x + view.size || cy < view.y || cy > view.y + view.size) continue;
      out.push(`<text x="${X(cx)}" y="${Y(cy)}" font-size="15" font-style="italic" fill="#6b6457" text-anchor="middle" letter-spacing="1">${escapeXml(c.name.toUpperCase())}</text>`);
    }
  }
  // Towns in view, the biggest first.
  const towns = (layer?.towns ?? []).filter(t => t.x >= view.x && t.x <= view.x + view.size && t.y >= view.y && t.y <= view.y + view.size)
    .sort((a, b) => b.population - a.population).slice(0, view.size <= 140 ? 14 : 10);
  // A town whose name would overlap one already drawn is left out (the bigger one wins).
  const taken = [];
  for (const t of towns) {
    const big = t.kind === 'metro' || t.kind === 'city', size = big ? 18 : 15, x = Number(X(t.x)), y = Number(Y(t.y));
    const box = [x - 6, y - size, x + 12 + t.name.length * size * 0.6, y + 8];
    if (taken.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    taken.push(box);
    out.push(`<circle cx="${X(t.x)}" cy="${Y(t.y)}" r="${big ? 5.5 : 4}" fill="#222" stroke="#fff" stroke-width="1.5"/>`);
    out.push(`<text x="${(Number(X(t.x)) + 9).toFixed(1)}" y="${(Number(Y(t.y)) + 5).toFixed(1)}" font-size="${big ? 18 : 15}" font-weight="${big ? 700 : 400}" fill="#111" stroke="#fff" stroke-width="3.5" paint-order="stroke" stroke-linejoin="round">${escapeXml(t.name)}</text>`);
  }
  for (const s of shapes) {
    if (!s.label || !s.rings.length) continue;
    const flat = s.rings[0]; let top = 0;
    for (let k = 3; k < flat.length; k += 2) if (flat[k] < flat[top + 1]) top = k - 1;
    out.push(`<text x="${X(flat[top])}" y="${(Number(Y(flat[top + 1])) - 10).toFixed(1)}" font-size="20" font-weight="700" fill="${s.stroke ?? '#000'}" stroke="#fff" stroke-width="4" paint-order="stroke" text-anchor="middle">${escapeXml(s.label)}</text>`);
  }
  out.push('</g>', `<rect x="0.75" y="0.75" width="${W - 1.5}" height="${W - 1.5}" fill="none" stroke="#333" stroke-width="1.5"/>`);
  for (const k of keySpots) {
    out.push(`<rect x="${k.x}" y="${k.y}" width="34" height="26" rx="3" fill="${k.colour}" fill-opacity="0.45" stroke="${k.colour}" stroke-width="3"/>`);
    out.push(`<text x="${k.x + 44}" y="${k.y + 19}" font-size="15" fill="#222">${escapeXml(k.text)}</text>`);
  }
  if (footer) {
    const y = W + keyHeight;
    out.push(`<rect x="0" y="${y}" width="${W}" height="${FOOTER}" fill="#f1f3f6"/><line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#d5d9e0"/>`);
    out.push(`<text x="24" y="${y + 26}" font-size="15" fill="#222"><tspan font-weight="700">${escapeXml(footer[0])}</tspan>${footer[1] ? ` · ${escapeXml(footer[1])}` : ''}</text>`);
  }
  out.push('</svg>');
  return out.join('');
}

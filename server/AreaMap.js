// A map zoomed in on a product's area (a watch, a mesoscale discussion, a warning's polygon), as an
// SVG for the public pages and the Discord posts (ProductArchive.js). Shapes are rings in map miles
// (flat lists x1, y1, x2, y2 ..., 0-500 east and south from the north-west corner), as the game
// products carry them (GameProducts.js); layer: the county layer (CountyLayer.js countiesFor).
const FONT = 'DejaVu Sans, Segoe UI, Arial, Helvetica, sans-serif';
const W = 1000, FOOTER = 40, BAR = 48, FACTS = 78;

const escapeXml = text => String(text).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

// The square of map miles to show: the shapes' bounds with room around them, at least minMiles across.
export function viewOf(rings, { pad = 0.35, minMiles = 60, mapMiles = 500 } = {}) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const flat of rings) for (let k = 0; k < flat.length; k += 2) { x0 = Math.min(x0, flat[k]); x1 = Math.max(x1, flat[k]); y0 = Math.min(y0, flat[k + 1]); y1 = Math.max(y1, flat[k + 1]); }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, size: mapMiles };
  const size = Math.min(mapMiles, Math.max(minMiles, (x1 - x0) * (1 + 2 * pad), (y1 - y0) * (1 + 2 * pad)));
  // Kept inside the map, so a product near its edge does not leave half the picture empty.
  const inside = v => Math.min(Math.max(v, 0), mapMiles - size);
  return { x: inside((x0 + x1) / 2 - size / 2), y: inside((y0 + y1) / 2 - size / 2), size };
}

// A front, dryline or outflow boundary in pixels, as the surface analysis draws it (js/pages/surfaceAnalysisPage.js
// drawBoundaries, its colours and symbols at this map's size): a dark edge under the line; triangles on a cold front
// and half-circles on a warm front, on the side it moves toward; both, on opposite sides, on a stationary front (the
// triangles facing the warm air); open scallops on the moist side of a dryline; an outflow boundary dashed.
export const BOUNDARY_COLOURS = { cold: '#3d8bff', warm: '#ff4d5e', stationary: '#b06cff', dryline: '#d98a2b', outflow: '#e8d44d' };
export const BOUNDARY_NAMES = { cold: 'Cold front', warm: 'Warm front', stationary: 'Stationary front', dryline: 'Dryline', outflow: 'Outflow boundary' };
function boundarySvg(points, type, side) {
  const colour = BOUNDARY_COLOURS[type]; if (!colour || points.length < 2) return '';
  const outflow = type === 'outflow', d = points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(''), f = v => v.toFixed(1);
  const out = [`<path d="${d}" fill="none" stroke="rgba(0,0,0,.7)" stroke-width="${outflow ? 6 : 8}" stroke-linejoin="round" stroke-linecap="round"/>`, `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${outflow ? 3 : 4}" stroke-linejoin="round" stroke-linecap="round"${outflow ? ' stroke-dasharray="10 7"' : ''}/>`];
  if (outflow) return out.join('');
  const dry = type === 'dryline', spacing = dry ? 28 : 46, size = dry ? 7 : 10;
  let carried = spacing / 2, n = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]); if (length < 1e-6) continue;
    const tx = (b[0] - a[0]) / length, ty = (b[1] - a[1]) / length;
    for (let s = carried; s < length; s += spacing, n++) {
      const x = a[0] + tx * s, y = a[1] + ty * s, kind = type === 'stationary' ? (n % 2 ? 'warm' : 'cold') : type, flip = type === 'stationary' && n % 2 ? -side : side, nx = ty * flip, ny = -tx * flip;
      if (kind === 'cold') out.push(`<path d="M${f(x - tx * size)} ${f(y - ty * size)}L${f(x + nx * size * 1.5)} ${f(y + ny * size * 1.5)}L${f(x + tx * size)} ${f(y + ty * size)}Z" fill="${BOUNDARY_COLOURS.cold}" stroke="rgba(0,0,0,.6)" stroke-width="1"/>`);
      else {
        // (the half of a circle on the side the normal points to: from one end of its diameter along the line to the other)
        const sweep = flip > 0 ? 1 : 0, arc = `M${f(x - tx * size)} ${f(y - ty * size)}A${size} ${size} 0 0 ${sweep} ${f(x + tx * size)} ${f(y + ty * size)}`;
        out.push(kind === 'warm' ? `<path d="${arc}Z" fill="${BOUNDARY_COLOURS.warm}" stroke="rgba(0,0,0,.6)" stroke-width="1"/>` : `<path d="${arc}" fill="none" stroke="rgba(0,0,0,.6)" stroke-width="4.5"/><path d="${arc}" fill="none" stroke="${colour}" stroke-width="2.5"/>`);
      }
    }
    carried = (carried - length) % spacing; if (carried < 0) carried += spacing;
  }
  return out.join('');
}

// shapes: [{ rings, fill, fillOpacity, stroke, width, dash, label, hatch }] (hatch: a colour for diagonal lines
// over the shape, as the centre marks a part of an area); focus: the rings to frame (all shapes' rings when left
// out); key: [{ colour, text }]; footer: a line under the key (bold part first: [bold, rest]). For a mesoscale
// discussion's map (2026-11-14): underlay, a picture under the outlines ({ png, x, y, size } in map miles: the
// radar, DiscussionRadar.js); arrows: [{ x0, y0, x1, y1, colour, label }] in map miles; callout: { text, colour },
// a boxed statement at the top of the map, as the centre's graphics have; colourBar: { title, stops: [[value,
// colour]] }, a row of the underlay's colours under the key; facts: { title, items: [{ label, value, colour }] }, a
// row of boxes under the key (a discussion's most probable peak intensities, as the centre's graphics list them);
// base: a picture under everything (the satellite, { png, x, y, size } in map miles); contours: [{ rings, colour,
// label }] (a mesoanalysis field's lines, each labelled with its value); lines: [{ points (flat map miles), type,
// side }] (fronts, drylines, outflow boundaries, drawn with the surface analysis's symbols and colours).
export function areaSvg({ layer, shapes, focus = null, key = [], footer = null, minMiles = 60, underlay = null, arrows = [], callout = null, colourBar = null, facts = null, base = null, contours = [], lines = [] }) {
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
  const keyHeight = key.length ? 64 + row * 36 : 0, factsHeight = facts?.items?.length ? FACTS : 0, barHeight = colourBar ? BAR : 0, height = W + keyHeight + factsHeight + barHeight + (footer ? FOOTER : 0);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" font-family="${FONT}">`];
  const hatches = [...new Set(shapes.filter(sh => sh.hatch && sh.rings.length).map(sh => sh.hatch))];
  const hatchId = colour => `hatch${hatches.indexOf(colour)}`;
  const patterns = hatches.map(c => `<pattern id="${hatchId(c)}" patternUnits="userSpaceOnUse" width="16" height="16" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="16" stroke="${c}" stroke-width="3.5" stroke-opacity="0.6"/></pattern>`).join('');
  out.push(`<defs><clipPath id="map"><rect width="${W}" height="${W}"/></clipPath>${patterns}</defs><rect width="${W}" height="${height}" fill="#ffffff"/>`);
  out.push(`<g clip-path="url(#map)"><rect width="${W}" height="${W}" fill="#dfe3e8"/>`);
  out.push(`<rect x="${X(0)}" y="${Y(0)}" width="${(mapMiles * scale).toFixed(1)}" height="${(mapMiles * scale).toFixed(1)}" fill="#f4f1e8"/>`);
  // The satellite under it all, as the centre's graphics lay their mosaic over GOES, dimmed by a veil of the land's
  // colour over it. (No opacity on an image: resvg, which turns these maps into the Discord bot's PNGs, cuts off an
  // image with an opacity in the clipped map where it runs past the map's edge: half the satellite missing, 2026-11-15.)
  if (base?.png) out.push(`<image href="data:image/png;base64,${Buffer.from(base.png).toString('base64')}" x="${X(base.x)}" y="${Y(base.y)}" width="${(base.size * scale).toFixed(1)}" height="${(base.size * scale).toFixed(1)}" preserveAspectRatio="none"/>`, `<rect x="${X(base.x)}" y="${Y(base.y)}" width="${(base.size * scale).toFixed(1)}" height="${(base.size * scale).toFixed(1)}" fill="#f4f1e8" fill-opacity="0.25"/>`);
  for (const s of shapes) if (s.rings.length && s.fill) out.push(`<path d="${flatPath(s.rings)}" fill="${s.fill}" fill-opacity="${s.fillOpacity ?? 0.35}" fill-rule="evenodd"/>`);
  // The radar over the fills and under the lines, as the centre's graphics lay the mosaic (its see-through made in the
  // picture, DiscussionRadar.js, not by an opacity: see the satellite above).
  if (underlay?.png) out.push(`<image href="data:image/png;base64,${Buffer.from(underlay.png).toString('base64')}" x="${X(underlay.x)}" y="${Y(underlay.y)}" width="${(underlay.size * scale).toFixed(1)}" height="${(underlay.size * scale).toFixed(1)}" preserveAspectRatio="none"/>`);
  const counties = layer?.counties ?? [];
  if (counties.length) out.push(`<path d="${counties.map(c => nestedPath(c.rings)).join('')}" fill="none" stroke="#6f6a5f" stroke-opacity="0.55" stroke-width="${view.size < 150 ? 1.2 : 0.8}"/>`);
  // The air: a field's contours, each labelled with its value,
  // and the boundaries, on a white edge so they read over the satellite and the radar.
  for (const c of contours) {
    out.push(`<path d="${flatPath(c.rings)}" fill="none" stroke="#fff" stroke-opacity="0.6" stroke-width="4.5"/><path d="${flatPath(c.rings)}" fill="none" stroke="${c.colour}" stroke-width="2.2"${c.dash ? ` stroke-dasharray="${c.dash}"` : ''}/>`);
    for (const flat of c.rings) {
      // (at its point nearest the middle of the map, so the label sits by what the map is about, clear of its edges)
      let k = flat.length, best = Infinity;
      for (let j = 0; j + 1 < flat.length; j += 2) { const px = Number(X(flat[j])), py = Number(Y(flat[j + 1])); if (px > 40 && px < W - 40 && py > 40 && py < W - 40) { const d = Math.hypot(px - W / 2, py - W / 2); if (d < best) { best = d; k = j; } } }
      if (k < flat.length && c.label) out.push(`<text x="${X(flat[k])}" y="${Y(flat[k + 1])}" font-size="14" font-weight="700" fill="${c.colour}" stroke="#fff" stroke-width="3.5" paint-order="stroke" text-anchor="middle" dominant-baseline="middle">${escapeXml(c.label)}</text>`);
    }
  }
  for (const l of lines) out.push(boundarySvg(l.points.reduce((pts, v, k) => (k % 2 ? pts : [...pts, [Number(X(v)), Number(Y(l.points[k + 1]))]]), []), l.type, l.side ?? 1));
  for (const s of shapes) if (s.rings.length && s.hatch) out.push(`<path d="${flatPath(s.rings)}" fill="url(#${hatchId(s.hatch)})" fill-rule="evenodd"/>`);
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
  // Arrows: a shaft and a head, on a white halo so they read over the radar (in pixels; dot: a dot where it starts).
  const drawArrow = (x0, y0, x1, y1, colour, { dot = true, label = null, width = 5 } = {}) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 12) return;
    const ux = (x1 - x0) / len, uy = (y1 - y0) / len, head = Math.min(6 * width, len * 0.45), bx = x1 - ux * head, by = y1 - uy * head;
    const tip = `${x1.toFixed(1)},${y1.toFixed(1)} ${(bx - uy * head * 0.5).toFixed(1)},${(by + ux * head * 0.5).toFixed(1)} ${(bx + uy * head * 0.5).toFixed(1)},${(by - ux * head * 0.5).toFixed(1)}`;
    out.push(`<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="#fff" stroke-width="${width + 6}" stroke-linecap="round"/><polygon points="${tip}" fill="#fff" stroke="#fff" stroke-width="6" stroke-linejoin="round"/>`);
    out.push(`<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${colour}" stroke-width="${width}" stroke-linecap="round"/><polygon points="${tip}" fill="${colour}"/>${dot ? `<circle cx="${x0.toFixed(1)}" cy="${y0.toFixed(1)}" r="6" fill="${colour}" stroke="#fff" stroke-width="2"/>` : ''}`);
    if (label) out.push(`<text x="${(x1 + ux * 10 + 6).toFixed(1)}" y="${(y1 + uy * 10 + 6).toFixed(1)}" font-size="16" font-weight="700" fill="${colour}" stroke="#fff" stroke-width="4" paint-order="stroke">${escapeXml(label)}</text>`);
  };
  const arrowPx = arrows.map(a => ({ ...a, px: [Number(X(a.x0)), Number(Y(a.y0)), Number(X(a.x1)), Number(Y(a.y1))] }));
  for (const a of arrowPx) drawArrow(...a.px, a.colour ?? '#111', { label: a.label });
  for (const s of shapes) {
    if (!s.label || !s.rings.length) continue;
    const flat = s.rings[0]; let top = 0;
    for (let k = 3; k < flat.length; k += 2) if (flat[k] < flat[top + 1]) top = k - 1;
    out.push(`<text x="${X(flat[top])}" y="${(Number(Y(flat[top + 1])) - 10).toFixed(1)}" font-size="20" font-weight="700" fill="${s.stroke ?? '#000'}" stroke="#fff" stroke-width="4" paint-order="stroke" text-anchor="middle">${escapeXml(s.label)}</text>`);
  }
  if (callout?.text) {
    // Wrapped at about 46 characters a line, in a white box with the colour's border.
    const words = callout.text.split(' '), lines = [''];
    for (const w of words) { if ((lines.at(-1) + ' ' + w).trim().length > 46) lines.push(w); else lines[lines.length - 1] = (lines.at(-1) + ' ' + w).trim(); }
    const widest = Math.max(...lines.map(l => l.length)), bw = Math.min(W - 40, 40 + widest * 12.6), bh = 22 + lines.length * 28, colour = callout.colour ?? '#dc2626';
    // With callout.rings (the area it speaks of, flat lists of map miles): beside that area on whichever side
    // leaves it and the arrows clear (and the nearer, on a tie), with an arrow in its colour from the box to the
    // area's outline, as the centre's labels point at their area. Else at the top in the middle.
    const pts = []; for (const r of callout.rings ?? []) for (let k = 0; k + 1 < r.length; k += 2) pts.push([Number(X(r[k])), Number(Y(r[k + 1]))]);
    let bx = (W - bw) / 2, by = 20, pointer = null;
    if (pts.length) {
      const f = [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))], cx = (f[0] + f[2]) / 2, cy = (f[1] + f[3]) / 2, gap = 70;
      const clamp = (x, y) => [Math.min(Math.max(x, 20), W - 20 - bw), Math.min(Math.max(y, 20), W - 20 - bh)];
      const overlap = (b, o) => Math.max(0, Math.min(b[2], o[2]) - Math.max(b[0], o[0])) * Math.max(0, Math.min(b[3], o[3]) - Math.max(b[1], o[1]));
      const avoid = [{ box: f, weight: 4 }, ...arrowPx.map(a => ({ box: [Math.min(a.px[0], a.px[2]) - 15, Math.min(a.px[1], a.px[3]) - 15, Math.max(a.px[0], a.px[2]) + 15, Math.max(a.px[1], a.px[3]) + 15], weight: 2 }))];
      const spots = [clamp(cx - bw / 2, f[3] + gap), clamp(cx - bw / 2, f[1] - gap - bh), clamp(f[2] + gap, cy - bh / 2), clamp(f[0] - gap - bw, cy - bh / 2)];
      const cost = ([x, y]) => avoid.reduce((sum, o) => sum + o.weight * overlap([x, y, x + bw, y + bh], o.box), 0) + Math.hypot(x + bw / 2 - cx, y + bh / 2 - cy);
      [bx, by] = spots.reduce((best, s) => (cost(s) < cost(best) ? s : best));
      // From the box's edge toward the area's middle, ending where that line first meets the outline.
      const mx = bx + bw / 2, my = by + bh / 2, dx = cx - mx, dy = cy - my;
      const leave = Math.min(dx ? (bw / 2 + 4) / Math.abs(dx) : Infinity, dy ? (bh / 2 + 4) / Math.abs(dy) : Infinity);
      if (leave < 1) {
        const sx = mx + dx * leave, sy = my + dy * leave; let hit = 1;
        for (const r of callout.rings) for (let k = 0; k + 3 < r.length + 2; k += 2) {
          const ax = Number(X(r[k])), ay = Number(Y(r[k + 1])), bx2 = Number(X(r[(k + 2) % r.length])), by2 = Number(Y(r[(k + 3) % r.length]));
          const ex = cx - sx, ey = cy - sy, gx = bx2 - ax, gy = by2 - ay, d = ex * gy - ey * gx; if (!d) continue;
          const t = ((ax - sx) * gy - (ay - sy) * gx) / d, u = ((ax - sx) * ey - (ay - sy) * ex) / d;
          if (t > 0 && t < hit && u >= 0 && u <= 1) hit = t;
        }
        pointer = [sx, sy, sx + (cx - sx) * hit, sy + (cy - sy) * hit];
      }
    }
    out.push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh}" rx="4" fill="#fff" fill-opacity="0.95" stroke="${colour}" stroke-width="3"/>`);
    lines.forEach((l, k) => out.push(`<text x="${(bx + bw / 2).toFixed(1)}" y="${(by + 28 + k * 28).toFixed(1)}" font-size="22" font-weight="700" fill="${colour}" text-anchor="middle">${escapeXml(l)}</text>`));
    if (pointer) drawArrow(...pointer, colour, { dot: false, width: 4 });
  }
  out.push('</g>', `<rect x="0.75" y="0.75" width="${W - 1.5}" height="${W - 1.5}" fill="none" stroke="#333" stroke-width="1.5"/>`);
  for (const k of keySpots) {
    out.push(`<rect x="${k.x}" y="${k.y}" width="34" height="26" rx="3" fill="${k.colour}" fill-opacity="0.45" stroke="${k.colour}" stroke-width="3"/>`);
    out.push(`<text x="${k.x + 44}" y="${k.y + 19}" font-size="15" fill="#222">${escapeXml(k.text)}</text>`);
  }
  if (factsHeight) {
    // The title, then one box for each item: a bar of its colour, its label small and its value bold.
    const y = W + keyHeight, items = facts.items, x0 = 24, gap = 12, boxW = (W - 2 * x0 - gap * (items.length - 1)) / items.length;
    out.push(`<text x="${x0}" y="${y + 14}" font-size="14" font-weight="700" fill="#222">${escapeXml(facts.title ?? '')}</text>`);
    items.forEach((it, k) => {
      const x = x0 + k * (boxW + gap);
      out.push(`<rect x="${x.toFixed(1)}" y="${y + 22}" width="${boxW.toFixed(1)}" height="48" rx="4" fill="#fff" stroke="#d5d9e0"/><rect x="${x.toFixed(1)}" y="${y + 22}" width="7" height="48" rx="2" fill="${it.colour ?? '#444'}"/>`);
      out.push(`<text x="${(x + 18).toFixed(1)}" y="${y + 40}" font-size="13" fill="#555">${escapeXml(it.label)}</text><text x="${(x + 18).toFixed(1)}" y="${y + 61}" font-size="18" font-weight="700" fill="#111">${escapeXml(it.value)}</text>`);
    });
  }
  if (colourBar) {
    const y = W + keyHeight + factsHeight, stops = colourBar.stops ?? [], titleWidth = 24 + colourBar.title.length * 8.2, cell = Math.min(44, (W - titleWidth - 40) / Math.max(1, stops.length));
    out.push(`<text x="24" y="${y + 29}" font-size="15" fill="#222">${escapeXml(colourBar.title)}</text>`);
    stops.forEach(([value, colour], k) => {
      const x = titleWidth + 16 + k * cell;
      out.push(`<rect x="${x.toFixed(1)}" y="${y + 8}" width="${cell.toFixed(1)}" height="18" fill="${colour}"/><text x="${(x + cell / 2).toFixed(1)}" y="${y + 42}" font-size="12" fill="#444" text-anchor="middle">${value}</text>`);
    });
  }
  if (footer) {
    const y = W + keyHeight + factsHeight + barHeight;
    out.push(`<rect x="0" y="${y}" width="${W}" height="${FOOTER}" fill="#f1f3f6"/><line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#d5d9e0"/>`);
    out.push(`<text x="24" y="${y + 26}" font-size="15" fill="#222"><tspan font-weight="700">${escapeXml(footer[0])}</tspan>${footer[1] ? ` · ${escapeXml(footer[1])}` : ''}</text>`);
  }
  out.push('</svg>');
  return out.join('');
}

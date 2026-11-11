// The public outlook pages and graphics (outlook.html, the Discord bot's posts). They draw the same
// outlook products the game draws (GameProducts.js gameOutlook: rings in map miles, 0-500 east and
// south from the north-west corner) over the county map, as an SVG in the style of the real
// outlook graphics: one categorical map and one map per hazard.
//
// GET /api/outlook/index              the Day 1-3 issues: day, status, times, highest, version
// GET /api/outlook/day<N>             one day's product (as the game gets it)
// GET /api/outlook/day<N>.svg         its map (?hazard=categorical|tornado|wind|hail)
// GET /outlook/day<N>                 the page (outlook.html)
import { CATEGORY_COLOURS, CATEGORY_SHORT, CHANCE_COLOURS } from '../js/forecast/productColours.js';

export const OUTLOOK_DAYS = ['day1', 'day2', 'day3'];
export const OUTLOOK_HAZARDS = ['categorical', 'tornado', 'wind', 'hail'];

// The world's clock: hours from the start of the world, UTC; local time is CDT, five hours behind
// (js/reports/reportText.js).
const dayOf = hour => Math.floor((hour + 1e-6) / 24) + 1;
export const utcStamp = hour => { const z = (((hour % 24) + 24) % 24) + 1e-6, h = Math.floor(z), m = Math.floor((z - h) * 60); return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')} UTC Day ${dayOf(hour)}`; };
export const localStamp = hour => { const l = hour - 5, z = (((l % 24) + 24) % 24) + 1e-6, h = Math.floor(z), m = Math.floor((z - h) * 60); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'} CDT`; };

const escapeXml = text => String(text).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

// Darker shade of a #rrggbb colour, for outlines.
function darker(hex, by = 0.45) {
  const n = parseInt(hex.slice(1), 16), f = v => Math.round(v * (1 - by)).toString(16).padStart(2, '0');
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

const HAZARD_TITLES = { categorical: 'Categorical Outlook', tornado: 'Probabilistic Tornado Outlook', wind: 'Probabilistic Damaging Wind Outlook', hail: 'Probabilistic Large Hail Outlook' };
const FONT = "DejaVu Sans, Segoe UI, Arial, Helvetica, sans-serif";

// The map's layout in pixels: a header, the 500-mile map, and the legend under it.
const W = 1000, HEAD = 112, LEGEND = 132;

// One outlook day's map as an SVG. product: gameOutlook's JSON; layer: the county layer
// ({ miles, counties: [{ rings: [[[x, y], ...]] }], towns: [{ name, kind, x, y, population }] }).
export function outlookSvg(product, layer, hazard = 'categorical') {
  if (!OUTLOOK_HAZARDS.includes(hazard)) hazard = 'categorical';
  const mapMiles = product.mapMiles ?? layer?.miles ?? 500, scale = W / mapMiles, top = HEAD, height = HEAD + W + LEGEND;
  const px = (x, y) => `${(x * scale).toFixed(1)} ${(top + y * scale).toFixed(1)}`;
  const flatPath = rings => rings.map(flat => { let d = `M${px(flat[0], flat[1])}`; for (let k = 2; k < flat.length; k += 2) d += `L${px(flat[k], flat[k + 1])}`; return `${d}Z`; }).join('');
  const nestedPath = rings => rings.map(ring => `M${ring.map(([x, y]) => px(x, y)).join('L')}Z`).join('');
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" font-family="${FONT}">`);
  out.push('<defs>',
    `<clipPath id="map"><rect x="0" y="${top}" width="${W}" height="${W}"/></clipPath>`,
    // Hatching for the significant-severe (CIG) areas, as the real graphics draw it: dashed diagonal lines
    // for level 1, solid for 2, cross-hatched for 3. One spacing for all three; the lines sit in the middle of
    // the tile (a line on the tile's edge is cut in half) and the dashes repeat exactly once a tile.
    '<pattern id="cig1" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="6" y1="0" x2="6" y2="12" stroke="#000" stroke-width="1.5" stroke-dasharray="6 6"/></pattern>',
    '<pattern id="cig2" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="6" y1="0" x2="6" y2="12" stroke="#000" stroke-width="1.5"/></pattern>',
    '<pattern id="cig3" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="6" y1="0" x2="6" y2="12" stroke="#000" stroke-width="1.5"/><line x1="0" y1="6" x2="12" y2="6" stroke="#000" stroke-width="1.5"/></pattern>',
    '</defs>');
  out.push(`<rect width="${W}" height="${height}" fill="#ffffff"/>`);

  // Header: title, times, the headline risk.
  const title = `Day ${product.day} ${HAZARD_TITLES[hazard]}`;
  out.push(`<rect width="${W}" height="${HEAD}" fill="#0f2a4a"/>`);
  out.push(`<text x="24" y="38" font-size="15" font-weight="700" fill="#9cc3ee" letter-spacing="2">WEATHERWORLD STORM PREDICTION CENTER</text>`);
  out.push(`<text x="24" y="70" font-size="28" font-weight="700" fill="#ffffff">${escapeXml(title)}</text>`);
  if (product.status === 'issued') {
    out.push(`<text x="24" y="98" font-size="15" fill="#d6e4f5">Issued ${escapeXml(utcStamp(product.issuedHourUtc))} (${escapeXml(localStamp(product.issuedHourUtc))}) · Valid ${escapeXml(utcStamp(product.validFromHourUtc))} to ${escapeXml(utcStamp(product.validToHourUtc))}</text>`);
    if (hazard === 'categorical' && product.highest && CATEGORY_COLOURS[product.highest]) {
      const label = (product.headline ?? product.highest).toUpperCase(), w = 26 + label.length * 11.5;
      out.push(`<rect x="${W - 24 - w}" y="46" width="${w}" height="34" rx="6" fill="${CATEGORY_COLOURS[product.highest]}" stroke="${darker(CATEGORY_COLOURS[product.highest])}" stroke-width="2"/>`);
      out.push(`<text x="${W - 24 - w / 2}" y="69" font-size="17" font-weight="700" fill="#111" text-anchor="middle">${escapeXml(label)}</text>`);
    }
  }

  // The map: land, the outlook areas, county lines, towns.
  out.push(`<g clip-path="url(#map)"><rect x="0" y="${top}" width="${W}" height="${W}" fill="#f4f1e8"/>`);
  if (product.status === 'issued') {
    if (hazard === 'categorical') {
      for (const entry of product.category ?? []) {
        const colour = CATEGORY_COLOURS[entry.key];
        if (colour && entry.rings.length) out.push(`<path d="${flatPath(entry.rings)}" fill="${colour}" fill-rule="evenodd" stroke="${darker(colour)}" stroke-width="2.2" stroke-linejoin="round"/>`);
      }
    } else {
      const h = product.hazards?.[hazard], colours = CHANCE_COLOURS[hazard] ?? {};
      for (const entry of h?.levels ?? []) {
        const colour = colours[entry.level] ?? '#888888';
        if (entry.rings.length) out.push(`<path d="${flatPath(entry.rings)}" fill="${colour}" fill-opacity="0.78" fill-rule="evenodd" stroke="${darker(colour, 0.3)}" stroke-width="2.2" stroke-linejoin="round"/>`);
      }
      // The CIG areas nest (level 2 inside level 1), so each is hatched only where no higher level is:
      // a mask cuts the higher areas out, and every place shows a single pattern. Outlines go on top.
      const groups = (h?.groups ?? []).filter(entry => entry.rings.length && entry.group >= 1).sort((a, b) => a.group - b.group);
      groups.forEach((entry, k) => {
        const higher = groups.slice(k + 1).map(g => flatPath(g.rings)).join('');
        out.push(`<mask id="cigMask${k}" maskUnits="userSpaceOnUse" x="0" y="${top}" width="${W}" height="${W}"><path d="${flatPath(entry.rings)}" fill="#fff" fill-rule="evenodd"/>${higher ? `<path d="${higher}" fill="#000"/>` : ''}</mask>`);
        out.push(`<rect x="0" y="${top}" width="${W}" height="${W}" fill="url(#cig${Math.min(3, entry.group)})" mask="url(#cigMask${k})"/>`);
      });
      for (const entry of groups) out.push(`<path d="${flatPath(entry.rings)}" fill="none" fill-rule="evenodd" stroke="#000" stroke-width="1.8" stroke-dasharray="10 6" stroke-linejoin="round"/>`);
    }
  }
  if (layer?.counties?.length) out.push(`<path d="${layer.counties.map(c => nestedPath(c.rings)).join('')}" fill="none" stroke="#7d786c" stroke-opacity="0.45" stroke-width="0.8"/>`);
  out.push('</g>');
  out.push(`<rect x="0.75" y="${top + 0.75}" width="${W - 1.5}" height="${W - 1.5}" fill="none" stroke="#333" stroke-width="1.5"/>`);
  // The biggest towns, so a reader can tell where the areas are.
  const named = (layer?.towns ?? []).filter(t => t.kind !== 'town').sort((a, b) => b.population - a.population).slice(0, 12);
  for (const t of named) {
    const [x, y] = px(t.x, t.y).split(' ').map(Number), big = t.kind === 'metro' || t.kind === 'city';
    out.push(`<circle cx="${x}" cy="${y}" r="${big ? 5 : 3.5}" fill="#222" stroke="#fff" stroke-width="1.5"/>`);
    out.push(`<text x="${x + 8}" y="${y + 5}" font-size="${big ? 16 : 13}" font-weight="${big ? 700 : 400}" fill="#111" stroke="#fff" stroke-width="3.5" paint-order="stroke" stroke-linejoin="round">${escapeXml(t.name)}</text>`);
  }
  if (product.status !== 'issued') out.push(`<text x="${W / 2}" y="${top + W / 2}" font-size="26" fill="#555" text-anchor="middle">${product.status === 'running' ? 'Outlook being prepared' : 'No outlook issued yet'}</text>`);

  // Legend.
  const ly = top + W + 24;
  const chips = [];
  if (hazard === 'categorical') {
    for (const key of (product.categories ?? []).filter(k => CATEGORY_COLOURS[k])) chips.push({ colour: CATEGORY_COLOURS[key], short: CATEGORY_SHORT[key], label: product.labels?.[key] ?? key });
  } else {
    const h = product.hazards?.[hazard], colours = CHANCE_COLOURS[hazard] ?? {};
    for (const level of h?.contourLevels ?? Object.keys(colours).map(Number)) chips.push({ colour: colours[level], short: `${level}%`, label: '' });
  }
  const chipW = Math.min(136, (W - 48) / Math.max(1, chips.length));
  chips.forEach((c, k) => {
    const x = 24 + k * chipW;
    out.push(`<rect x="${x}" y="${ly}" width="${chipW - 8}" height="30" rx="4" fill="${c.colour}" stroke="${darker(c.colour)}" stroke-width="1.5"/>`);
    const n = parseInt(c.colour.slice(1), 16), light = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 140;
    out.push(`<text x="${x + (chipW - 8) / 2}" y="${ly + 21}" font-size="15" font-weight="700" fill="${light ? '#111' : '#fff'}" text-anchor="middle">${escapeXml(c.short)}</text>`);
    if (c.label) out.push(`<text x="${x + (chipW - 8) / 2}" y="${ly + 50}" font-size="11.5" fill="#333" text-anchor="middle">${escapeXml(c.label)}</text>`);
  });
  if (hazard !== 'categorical') {
    const h = product.hazards?.[hazard], meaning = (h?.cigMeaning ?? []).slice(1);
    meaning.forEach((text, k) => {
      const x = 24 + k * ((W - 48) / Math.max(1, meaning.length)), y = ly + 52;
      out.push(`<rect x="${x}" y="${y}" width="34" height="22" fill="url(#cig${k + 1})" stroke="#000" stroke-width="1.2"/>`);
      out.push(`<text x="${x + 42}" y="${y + 16}" font-size="12" fill="#222">CIG${k + 1}: ${escapeXml(text.replace(/ where it happens$/, ''))}</text>`);
    });
  }
  out.push(`<text x="${W - 24}" y="${height - 14}" font-size="12" fill="#777" text-anchor="end">weatherworld.up.railway.app/outlook/day${product.day}</text>`);
  out.push('</svg>');
  return out.join('');
}

// The headline sentence for a post: the first "...THERE IS A ... RISK ..." line, put back into
// sentence case with the place names spelled as the summary spells them.
export function outlookHeadline(product) {
  const text = product.discussion ?? '';
  const line = text.split('\n').find(l => /^\.\.\.(THERE IS|NO )/.test(l));
  if (!line) return product.headline ?? '';
  // Place names: words capitalised in the middle of a sentence (not after a full stop or a line start).
  const spelled = new Map();
  for (const m of text.matchAll(/(?<=[a-z,;:(] )[A-Z][a-z][A-Za-z'-]*/g)) spelled.set(m[0].toLowerCase(), m[0]);
  const risks = new Set(['marginal', 'slight', 'enhanced', 'moderate', 'high']);
  let sentence = line.replace(/^\.+|\.+$/g, '').toLowerCase().replace(/[a-z][a-z'-]*/g, (w, at, all) => {
    if (risks.has(w) && /^\s+risk/.test(all.slice(at + w.length))) return w[0].toUpperCase() + w.slice(1);
    if (w === 'risk' && /(marginal|slight|enhanced|moderate|high)\s+$/.test(all.slice(0, at))) return 'Risk';
    return spelled.get(w) ?? w;
  });
  sentence = sentence[0].toUpperCase() + sentence.slice(1);
  return `${sentence}.`;
}

// The index the bot and the page poll.
export function outlookIndex(products) {
  return {
    days: products.map(({ day, product, version }) => ({
      day, status: product?.status ?? 'off', version: version ?? null,
      issuedHourUtc: product?.issuedHourUtc ?? null, validFromHourUtc: product?.validFromHourUtc ?? null, validToHourUtc: product?.validToHourUtc ?? null,
      highest: product?.highest ?? null, headline: product?.headline ?? null, updating: Boolean(product?.updating),
      sentence: product?.status === 'issued' ? outlookHeadline(product) : null,
      mainHazards: product?.discussion?.match(/The main hazards: ([^\n]*?)\.(?:\s|$)/)?.[1] ?? null,
      issued: product?.status === 'issued' ? `${utcStamp(product.issuedHourUtc)} (${localStamp(product.issuedHourUtc)})` : null
    }))
  };
}

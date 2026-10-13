// The Day 1 convective outlook page, drawn as the Storm Prediction Center draws its own: the
// categorical map; for each hazard the chance at its fixed contour levels (never an exact
// figure), with the conditional intensity groups hatched over it; and the discussion.
// Everything shown is what the server issued (GET /api/outlooks/day1); nothing is worked out
// here but the drawing.
const $ = id => document.getElementById(id);
const canvas = $('outlookCanvas'), ctx = canvas.getContext('2d');
const RENDER = 480;   // the map is drawn at this many pixels a side and scaled to fit

// Colours as the real outlooks use them (the 75% and 90% wind levels, added in 2026, are this page's own choice).
const CATEGORY_COLOURS = { TSTM: '#c1e9c1', MRGN: '#66a366', SLGT: '#ffe066', ENH: '#ffa366', MDT: '#e06666', HIGH: '#ee99ee' };
const CHANCE_COLOURS = {
  tornado: { 2: '#008b00', 5: '#8b4726', 10: '#ffc800', 15: '#ff0000', 30: '#ff00ff', 45: '#912cee', 60: '#104e8b' },
  hail: { 5: '#8b4726', 15: '#ffc800', 30: '#ff0000', 45: '#ff00ff', 60: '#912cee' },
  wind: { 5: '#8b4726', 15: '#ffc800', 30: '#ff0000', 45: '#ff00ff', 60: '#912cee', 75: '#104e8b', 90: '#00868b' }
};
const LAYERS = { category: 'Categorical', tornado: 'Tornado', wind: 'Wind', hail: 'Hail' };
const HAZARD = { tornado: 'a tornado', wind: 'damaging wind (58 mph or more)', hail: 'large hail (1 inch or more)' };

let outlook = null, layer = new URLSearchParams(location.search).get('layer') ?? 'category';
if (!LAYERS[layer]) layer = 'category';

const rgb = hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const clock = hour => `${String((((Math.round(hour) % 24) + 24) % 24)).padStart(2, '0')}Z`;
const dayOf = hour => `Day ${Math.floor((hour - 12) / 24) + 1}`;

// A field of the outlook grid read smoothly at a point of the map (0-1 across and down).
function sampler(field, width, height) {
  return (u, v) => {
    const gx = Math.max(0, Math.min(width - 1, u * width - 0.5)), gy = Math.max(0, Math.min(height - 1, v * height - 0.5));
    const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1), tx = gx - x0, ty = gy - y0;
    return (field[y0 * width + x0] * (1 - tx) + field[y0 * width + x1] * tx) * (1 - ty) + (field[y1 * width + x0] * (1 - tx) + field[y1 * width + x1] * tx) * ty;
  };
}
// The highest of a set of nested areas (each a 0/1 grid) a point is inside, by its smoothed edge; -1 for none.
function nested(grids, width, height) {
  // Each area is softened a little first, so its edge is a curve and not the grid's steps.
  const soften = grid => { let field = Float32Array.from(grid); for (let pass = 0; pass < 2; pass++) { const out = new Float32Array(field.length); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { let sum = 0, count = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < width && Y < height) { sum += field[Y * width + X]; count++; } } out[y * width + x] = sum / count; } field = out; } return field; };
  const inside = grids.map(grid => sampler(soften(grid), width, height));
  return (u, v) => { let best = -1; inside.forEach((read, k) => { if (read(u, v) >= 0.5) best = k; }); return best; };
}

// Hatching for an intensity group at a pixel: CIG1 broken lines falling to the lower left,
// CIG2 solid lines falling to the lower right, CIG3 both solid (crossed).
function hatchedAt(group, x, y) {
  if (!group) return false;
  const fallingLeft = (x + y) % 10 < 1.5, fallingRight = (((x - y) % 10) + 10) % 10 < 1.5;
  if (group === 1) return fallingLeft && (((x - y) % 14) + 14) % 14 < 8;
  if (group === 2) return fallingRight;
  return fallingLeft || fallingRight;
}

function draw() {
  const box = canvas.parentElement.getBoundingClientRect(), side = Math.max(240, Math.floor(Math.min(box.width - 24, box.height - 24)));
  const scale = window.devicePixelRatio || 1;
  canvas.style.width = canvas.style.height = `${side}px`; canvas.width = canvas.height = Math.round(side * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#0b1119'; ctx.fillRect(0, 0, side, side);
  if (!outlook || outlook.status !== 'issued') {
    ctx.fillStyle = '#9ca3af'; ctx.font = '600 15px system-ui, sans-serif'; ctx.textAlign = 'center';
    const text = !outlook ? 'Loading the outlook…' : outlook.status === 'running' ? `The Day 1 outlook is being prepared (${outlook.members} forecast runs)…` : outlook.status === 'off' ? 'Outlooks are turned off on this server.' : outlook.status === 'failed' ? 'The outlook could not be prepared.' : 'Waiting for the first outlook…';
    ctx.fillText(text, side / 2, side / 2);
    return;
  }
  const { width, height } = outlook, image = new ImageData(RENDER, RENDER), level = new Int16Array(RENDER * RENDER), group = new Uint8Array(RENDER * RENDER);
  let colours, levelAt, groupAt = null;
  if (layer === 'category') {
    const ranks = outlook.categories.map((name, k) => ({ name, k })).filter(c => CATEGORY_COLOURS[c.name]);
    levelAt = nested(ranks.map(c => outlook.category.map(v => (v >= c.k ? 1 : 0))), width, height);
    colours = ranks.map(c => rgb(CATEGORY_COLOURS[c.name]));
  } else {
    // The chance is drawn only as the contour level it has reached.
    const chance = sampler(outlook.chance[layer], width, height), steps = outlook.levels[layer];
    levelAt = (u, v) => { const value = chance(u, v); let best = -1; steps.forEach((limit, k) => { if (value >= limit) best = k; }); return best; };
    colours = steps.map(limit => rgb(CHANCE_COLOURS[layer][limit]));
    const groups = nested(Array.from({ length: outlook.maxCig[layer] }, (_, k) => outlook.cig[layer].map(v => (v > k ? 1 : 0))), width, height);
    groupAt = (u, v) => groups(u, v) + 1;
  }
  for (let y = 0; y < RENDER; y++) for (let x = 0; x < RENDER; x++) { const u = (x + 0.5) / RENDER, v = (y + 0.5) / RENDER, k = y * RENDER + x; level[k] = levelAt(u, v); if (groupAt && level[k] >= 0) group[k] = groupAt(u, v); }
  for (let y = 0; y < RENDER; y++) for (let x = 0; x < RENDER; x++) {
    const k = y * RENDER + x, o = k * 4, colour = level[k] >= 0 ? colours[level[k]] : null;
    let r = 11, g = 17, b = 25;
    if (colour) { r = Math.round(0.2 * r + 0.8 * colour[0]); g = Math.round(0.2 * g + 0.8 * colour[1]); b = Math.round(0.2 * b + 0.8 * colour[2]); }
    // A line where the contour level changes, and round each intensity group.
    const edge = (x > 0 && level[k - 1] !== level[k]) || (y > 0 && level[k - RENDER] !== level[k]);
    const groupEdge = (x > 0 && group[k - 1] !== group[k]) || (y > 0 && group[k - RENDER] !== group[k]);
    if (edge) { r = Math.round(r * 0.3); g = Math.round(g * 0.3); b = Math.round(b * 0.3); }
    if (groupEdge || hatchedAt(group[k], x, y)) { r = 8; g = 8; b = 8; }
    image.data[o] = r; image.data[o + 1] = g; image.data[o + 2] = b; image.data[o + 3] = 255;
  }
  const buffer = document.createElement('canvas'); buffer.width = buffer.height = RENDER; buffer.getContext('2d').putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.drawImage(buffer, 0, 0, side, side);
  ctx.strokeStyle = '#475569'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, side - 1, side - 1);
  ctx.strokeStyle = 'rgba(148,163,184,.16)'; for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.moveTo(k * side / 5, 0); ctx.lineTo(k * side / 5, side); ctx.moveTo(0, k * side / 5); ctx.lineTo(side, k * side / 5); ctx.stroke(); }
  ctx.fillStyle = '#cbd5e1'; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('N ↑', 8, 16); ctx.textAlign = 'right'; ctx.fillText(`grid lines every ${Math.round(outlook.width * outlook.cellMiles / 5)} miles`, side - 8, side - 8);
}

function renderSide() {
  for (const button of document.querySelectorAll('#layerButtons button')) button.classList.toggle('on', button.dataset.layer === layer);
  const legend = $('legend'), note = $('legendNote');
  if (!outlook || outlook.status !== 'issued') { legend.innerHTML = ''; note.textContent = ''; $('issue').textContent = outlook?.status === 'running' ? 'Being prepared…' : '—'; $('headline').textContent = '—'; $('discussion').textContent = outlook?.error ?? ''; $('summary').innerHTML = ''; return; }
  $('issue').textContent = `${dayOf(outlook.issuedHourUtc)} · issued ${clock(outlook.issuedHourUtc)} · valid to ${clock(outlook.validToHourUtc)}${outlook.running ? ' · next outlook being prepared' : ''}`;
  $('headline').textContent = outlook.labels[outlook.highest];
  $('headline').style.color = CATEGORY_COLOURS[outlook.highest] ?? 'inherit';
  if (layer === 'category') {
    legend.innerHTML = outlook.categories.filter(name => CATEGORY_COLOURS[name]).map((name, k) => `<li><i style="background:${CATEGORY_COLOURS[name]}"></i>${name === 'TSTM' ? 'TSTM' : `${k} - ${{ MRGN: 'MRGL', SLGT: 'SLGT', ENH: 'ENH', MDT: 'MDT', HIGH: 'HIGH' }[name]}`}<b>${outlook.labels[name]}</b></li>`).join('');
    note.textContent = `Thunderstorms: a ${outlook.thunderLevel}% or greater chance of thunderstorms. The severe categories come from the chance of each hazard and its intensity group together.`;
  } else {
    const groups = Array.from({ length: outlook.maxCig[layer] }, (_, k) => `<li><i class="hatch cig${k + 1}"></i>CIG${k + 1}<b>${outlook.cigMeaning[layer][k + 1]}</b></li>`).join('');
    legend.innerHTML = outlook.levels[layer].map(limit => `<li><i style="background:${CHANCE_COLOURS[layer][limit]}"></i>${limit}%</li>`).join('') + groups;
    note.textContent = `Chance of ${HAZARD[layer]} within 25 miles of a point. Hatching: conditional intensity groups, how strong it is expected to be where it happens.`;
  }
  const row = hazard => { const top = outlook.top[hazard]; return `<span>${LAYERS[hazard]}</span><b>${top.level ? `${top.level}%${top.cig ? ` · CIG${top.cig}` : ''}` : 'less than ' + outlook.levels[hazard][0] + '%'}</b>`; };
  $('summary').innerHTML = ['tornado', 'wind', 'hail'].map(row).join('');
  $('discussion').textContent = outlook.discussion;
}

async function load() {
  try { const response = await fetch('/api/outlooks/day1', { cache: 'no-store' }); outlook = await response.json(); }
  catch { outlook = { status: 'failed', error: 'The weather server did not answer.' }; }
  renderSide(); draw();
}

for (const [key, name] of Object.entries(LAYERS)) { const button = document.createElement('button'); button.dataset.layer = key; button.textContent = name; button.addEventListener('click', () => { layer = key; renderSide(); draw(); }); $('layerButtons').append(button); }
window.addEventListener('resize', draw);
load();
setInterval(load, 15000);

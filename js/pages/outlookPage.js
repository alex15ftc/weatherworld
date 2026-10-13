// The Day 1 convective outlook page: the categorical map, the chance of each hazard with its
// hatched area for significant severe weather, and the written discussion. Everything shown is
// what the server issued (GET /api/outlooks/day1); nothing is worked out here but the drawing.
const $ = id => document.getElementById(id);
const canvas = $('outlookCanvas'), ctx = canvas.getContext('2d');
const RENDER = 420;   // the map is drawn at this many pixels a side and scaled to fit

// Colours as the real outlooks use them.
const CATEGORY_COLOURS = { TSTM: '#c1e9c1', MRGN: '#66a366', SLGT: '#ffe066', ENH: '#ffa366', MDT: '#e06666', HIGH: '#ee99ee' };
const CHANCE_COLOURS = {
  tornado: [[2, '#008b00'], [5, '#8b4726'], [10, '#ffc800'], [15, '#ff0000'], [30, '#ff00ff'], [45, '#912cee'], [60, '#104e8b']],
  hail: [[5, '#8b4726'], [15, '#ffc800'], [30, '#ff0000'], [45, '#ff00ff'], [60, '#912cee']],
  wind: [[5, '#8b4726'], [15, '#ffc800'], [30, '#ff0000'], [45, '#ff00ff'], [60, '#912cee']]
};
const LAYERS = { category: 'Categorical outlook', tornado: 'Tornado', wind: 'Wind', hail: 'Hail' };
const SIGNIFICANT = { tornado: 'an EF2 or stronger tornado', wind: 'gusts of 75 mph or more', hail: 'hail of 2 inches or more' };
const HAZARD = { tornado: 'a tornado', wind: 'gusts of 58 mph or more', hail: 'hail of 1 inch or more' };

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
  const { width, height } = outlook, image = new ImageData(RENDER, RENDER), level = new Int16Array(RENDER * RENDER), hatched = new Uint8Array(RENDER * RENDER);
  let colourAt, levelAt, hatchAt = null;
  if (layer === 'category') {
    // The category at a point is the highest one whose smoothed edge it is inside.
    const ranks = outlook.categories.map((name, k) => ({ name, k })).filter(c => CATEGORY_COLOURS[c.name]);
    const inside = ranks.map(c => sampler(outlook.category.map(v => (v >= c.k ? 1 : 0)), width, height));
    levelAt = (u, v) => { let best = -1; ranks.forEach((c, i) => { if (inside[i](u, v) >= 0.5) best = i; }); return best; };
    colourAt = index => (index < 0 ? null : rgb(CATEGORY_COLOURS[ranks[index].name]));
  } else {
    const chance = sampler(outlook.chance[layer], width, height), significant = sampler(outlook.significant[layer], width, height), steps = CHANCE_COLOURS[layer];
    levelAt = (u, v) => { const value = chance(u, v); let best = -1; steps.forEach(([limit], i) => { if (value >= limit) best = i; }); return best; };
    colourAt = index => (index < 0 ? null : rgb(steps[index][1]));
    hatchAt = (u, v) => { const value = significant(u, v); return value >= outlook.hatchChance[1] ? 2 : value >= outlook.hatchChance[0] ? 1 : 0; };
  }
  for (let y = 0; y < RENDER; y++) for (let x = 0; x < RENDER; x++) { const u = (x + 0.5) / RENDER, v = (y + 0.5) / RENDER; level[y * RENDER + x] = levelAt(u, v); if (hatchAt) hatched[y * RENDER + x] = hatchAt(u, v); }
  for (let y = 0; y < RENDER; y++) for (let x = 0; x < RENDER; x++) {
    const k = y * RENDER + x, o = k * 4, colour = colourAt(level[k]);
    let r = 11, g = 17, b = 25;
    if (colour) { r = Math.round(0.25 * r + 0.75 * colour[0]); g = Math.round(0.25 * g + 0.75 * colour[1]); b = Math.round(0.25 * b + 0.75 * colour[2]); }
    // An outline where the level changes.
    const edge = (x > 0 && level[k - 1] !== level[k]) || (y > 0 && level[k - RENDER] !== level[k]);
    if (edge) { r = Math.round(r * 0.35); g = Math.round(g * 0.35); b = Math.round(b * 0.35); }
    // Hatching: diagonal lines where significant severe weather is forecast, crossed where it is likely.
    if (hatched[k] && ((x + y) % 9 < 1.4 || (hatched[k] === 2 && (x - y + RENDER) % 9 < 1.4))) { r = 12; g = 12; b = 12; }
    else if (x > 0 && y > 0 && hatched[k] !== hatched[k - 1] || hatched[k] !== hatched[Math.max(0, k - RENDER)]) { r = 12; g = 12; b = 12; }
    image.data[o] = r; image.data[o + 1] = g; image.data[o + 2] = b; image.data[o + 3] = 255;
  }
  const buffer = document.createElement('canvas'); buffer.width = buffer.height = RENDER; buffer.getContext('2d').putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.drawImage(buffer, 0, 0, side, side);
  // Frame, a scale and the compass.
  ctx.strokeStyle = '#475569'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, side - 1, side - 1);
  ctx.strokeStyle = 'rgba(148,163,184,.18)'; for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.moveTo(k * side / 5, 0); ctx.lineTo(k * side / 5, side); ctx.moveTo(0, k * side / 5); ctx.lineTo(side, k * side / 5); ctx.stroke(); }
  ctx.fillStyle = '#cbd5e1'; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('N ↑', 8, 16); ctx.textAlign = 'right'; ctx.fillText(`grid lines every ${Math.round(outlook.width * outlook.cellMiles / 5)} miles`, side - 8, side - 8);
  // Where the chance is highest.
  if (layer !== 'category' && outlook.peak[layer].value >= 2) {
    const p = outlook.peak[layer], px = p.x * side, py = p.y * side, text = `${Math.round(p.value)}%`;
    ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#0b1119'; ctx.strokeText(text, px, py + 4); ctx.fillStyle = '#ffffff'; ctx.fillText(text, px, py + 4);
  }
}

function renderSide() {
  for (const button of document.querySelectorAll('#layerButtons button')) button.classList.toggle('on', button.dataset.layer === layer);
  const legend = $('legend'), note = $('legendNote');
  if (!outlook || outlook.status !== 'issued') { legend.innerHTML = ''; note.textContent = ''; $('issue').textContent = outlook?.status === 'running' ? 'Being prepared…' : '—'; $('headline').textContent = '—'; $('discussion').textContent = outlook?.error ?? ''; $('facts').innerHTML = ''; return; }
  $('issue').textContent = `${dayOf(outlook.issuedHourUtc)} · issued ${clock(outlook.issuedHourUtc)} · valid to ${clock(outlook.validToHourUtc)}${outlook.running ? ' · next outlook being prepared' : ''}`;
  $('headline').textContent = outlook.labels[outlook.highest];
  $('headline').style.color = CATEGORY_COLOURS[outlook.highest] ?? 'inherit';
  if (layer === 'category') {
    legend.innerHTML = outlook.categories.filter(name => CATEGORY_COLOURS[name]).map(name => `<li><i style="background:${CATEGORY_COLOURS[name]}"></i>${outlook.labels[name]}<b>${Math.round(100 * (outlook.areas[name] ?? 0))}%</b></li>`).join('');
    note.textContent = 'Share of the map at each category or higher. The categories are this world\'s own: about one day in twenty reaches High.';
  } else {
    legend.innerHTML = CHANCE_COLOURS[layer].map(([limit, colour]) => `<li><i style="background:${colour}"></i>${limit}% or more</li>`).join('') + `<li><i class="hatch"></i>Hatched: ${outlook.hatchChance[0]}% or more chance of ${SIGNIFICANT[layer]}</li><li><i class="hatch cross"></i>Cross-hatched: ${outlook.hatchChance[1]}% or more</li>`;
    note.textContent = `Chance of ${HAZARD[layer]} within 25 miles of a point during the period. Highest: ${Math.round(outlook.peak[layer].value)}%.`;
  }
  const e = outlook.expected, facts = [['Forecast runs', outlook.members], ['Runs with a tornado', `${e.membersWithTornado} of ${outlook.members}`], ['Tornadoes expected', e.tornadoes.low === e.tornadoes.high ? e.tornadoes.middle : `${e.tornadoes.low} to ${e.tornadoes.high}`], ['Largest hail', `${e.hailInches.toFixed(1)} in`], ['Peak gust', `${Math.round(e.gustMph)} mph`], ['Storms', e.storms]];
  $('facts').innerHTML = facts.map(([name, value]) => `<span>${name}</span><b>${value}</b>`).join('');
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

// The convective outlook pages (Day 1, 2 and 3; the page's data-page says which), drawn as the Storm Prediction Center draws its own: the
// categorical map; for each hazard the chance at its fixed contour levels (never an exact
// figure), with the conditional intensity groups hatched over it; and the discussion.
// Everything shown is what the server issued (GET /api/outlooks/day1, day2 or day3). The areas arrive as
// outlines (rings of points, shares of the map) and are drawn as shapes: filled, outlined,
// labelled and hatched; nothing is painted cell by cell.
import { CATEGORY_COLOURS, CATEGORY_SHORT, CHANCE_COLOURS } from '../forecast/productColours.js';

const $ = id => document.getElementById(id);
const canvas = $('outlookCanvas'), ctx = canvas.getContext('2d');
const LAYERS = { category: 'Categorical', tornado: 'Tornado', wind: 'Wind', hail: 'Hail', severe: 'Severe' };
const HAZARD = { tornado: 'a tornado', wind: 'damaging wind (58 mph or more)', hail: 'large hail (1 inch or more)', severe: 'severe weather (a tornado, damaging wind or large hail)' };
const PAGE = ['day1', 'day2', 'day3'].includes(document.body.dataset.page) ? document.body.dataset.page : 'day1';
const DAY_NUMBER = { day1: 1, day2: 2, day3: 3 }[PAGE];
const BACKGROUND = [11, 17, 25];

let outlook = null, layer = new URLSearchParams(location.search).get('layer') ?? 'category';
if (!LAYERS[layer]) layer = 'category';

const rgb = hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const mix = (hex, share, towards = BACKGROUND) => `rgb(${rgb(hex).map((v, k) => Math.round(share * v + (1 - share) * towards[k])).join(',')})`;
const clock = hour => `${String((((Math.round(hour) % 24) + 24) % 24)).padStart(2, '0')}Z`;

// The rings of an area as one path (holes are left out by filling it with the even-odd rule).
function pathOf(rings, side) {
  const path = new Path2D();
  for (const ring of rings) { ring.forEach(([x, y], k) => (k ? path.lineTo(x * side, y * side) : path.moveTo(x * side, y * side))); path.closePath(); }
  return path;
}

// Where an area's label goes: on its outline, away from the map edge, as near the middle of
// the map as it can be while clear of the labels already placed.
function labelPoint(rings, side, placed) {
  let best = Infinity, point = null;
  for (const ring of rings) for (const [x, y] of ring) {
    if (x < 0.03 || x > 0.97 || y < 0.03 || y > 0.97) continue;
    const px = x * side, py = y * side;
    const score = Math.abs(x - 0.5) + Math.abs(y - 0.5) + (placed.some(l => Math.hypot(l[0] - px, l[1] - py) < 46) ? 10 : 0);
    if (score < best) { best = score; point = [px, py]; }
  }
  return best < 10 ? point : null;
}

// Parallel lines over the whole map, falling to the lower left or to the lower right.
function hatchLines(side, fallingLeft, spacing) {
  ctx.beginPath();
  for (let c = -side; c <= 2 * side; c += spacing) { if (fallingLeft) { ctx.moveTo(c, 0); ctx.lineTo(c - side, side); } else { ctx.moveTo(c, 0); ctx.lineTo(c + side, side); } }
  ctx.stroke();
}

// Hatching for the intensity groups: CIG1 broken lines falling to the lower left, CIG2 solid
// lines falling to the lower right, CIG3 both solid (crossed). Each is drawn only in the part
// of its area that the next group up does not cover.
function drawGroups(groups, side) {
  groups.forEach((entry, k) => {
    const above = groups[k + 1]?.rings ?? [];
    ctx.save();
    ctx.clip(pathOf([...entry.rings, ...above], side), 'evenodd');
    ctx.strokeStyle = '#080808'; ctx.lineWidth = 1.4;
    if (entry.group === 1) { ctx.setLineDash([9, 6]); hatchLines(side, true, 11); }
    else { ctx.setLineDash([]); hatchLines(side, false, 11); if (entry.group >= 3) hatchLines(side, true, 11); }
    ctx.restore();
  });
  ctx.save(); ctx.strokeStyle = '#080808'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  for (const entry of groups) ctx.stroke(pathOf(entry.rings, side));
  ctx.restore();
}

function draw() {
  const box = canvas.parentElement.getBoundingClientRect(), side = Math.max(240, Math.floor(Math.min(box.width - 24, box.height - 24)));
  const scale = window.devicePixelRatio || 1;
  canvas.style.width = canvas.style.height = `${side}px`; canvas.width = canvas.height = Math.round(side * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = `rgb(${BACKGROUND.join(',')})`; ctx.fillRect(0, 0, side, side);
  if (!outlook || outlook.status !== 'issued') {
    ctx.fillStyle = '#9ca3af'; ctx.font = '600 15px system-ui, sans-serif'; ctx.textAlign = 'center';
    const text = !outlook ? 'Loading the outlook…' : outlook.status === 'running' ? `The Day ${DAY_NUMBER} outlook is being prepared (${outlook.members} forecast runs)…` : outlook.status === 'off' ? 'Outlooks are turned off on this server.' : outlook.status === 'failed' ? 'The outlook could not be prepared.' : 'Waiting for the first outlook…';
    ctx.fillText(text, side / 2, side / 2);
    return;
  }
  // The areas nest, so each is drawn over the one below it.
  const areas = layer === 'category'
    ? outlook.shapes.category.filter(entry => CATEGORY_COLOURS[entry.key]).map(entry => ({ rings: entry.rings, colour: CATEGORY_COLOURS[entry.key], label: CATEGORY_SHORT[entry.key] }))
    : outlook.shapes[layer].levels.map(entry => ({ rings: entry.rings, colour: CHANCE_COLOURS[layer][entry.level], label: `${entry.level}%` }));
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, side, side); ctx.clip();
  ctx.lineJoin = 'round';
  for (const area of areas) {
    const path = pathOf(area.rings, side);
    ctx.fillStyle = mix(area.colour, 0.8); ctx.fill(path, 'evenodd');
    ctx.strokeStyle = mix(area.colour, 0.45, [0, 0, 0]); ctx.lineWidth = 1.6; ctx.stroke(path);
  }
  if (layer !== 'category') drawGroups(outlook.shapes[layer].groups, side);
  ctx.strokeStyle = 'rgba(148,163,184,.16)'; ctx.lineWidth = 1; for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.moveTo(k * side / 5, 0); ctx.lineTo(k * side / 5, side); ctx.moveTo(0, k * side / 5); ctx.lineTo(side, k * side / 5); ctx.stroke(); }
  // One label on each area's outline.
  ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const placed = [];
  for (const area of areas) {
    const point = labelPoint(area.rings, side, placed);
    if (!point) continue;
    placed.push(point);
    const w = ctx.measureText(area.label).width + 8;
    ctx.fillStyle = 'rgba(11,17,25,.92)'; ctx.fillRect(point[0] - w / 2, point[1] - 8, w, 16);
    ctx.strokeStyle = area.colour; ctx.lineWidth = 1; ctx.strokeRect(point[0] - w / 2 + 0.5, point[1] - 7.5, w - 1, 15);
    ctx.fillStyle = '#f1f5f9'; ctx.fillText(area.label, point[0], point[1] + 0.5);
  }
  ctx.restore();
  ctx.textBaseline = 'alphabetic';
  ctx.strokeStyle = '#475569'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, side - 1, side - 1);
  ctx.fillStyle = '#cbd5e1'; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('N ↑', 8, 16); ctx.textAlign = 'right'; ctx.fillText(`grid lines every ${Math.round(outlook.width * outlook.cellMiles / 5)} miles`, side - 8, side - 8);
}

function renderSide() {
  // The maps on offer are the categorical one and one for each hazard this outlook gives.
  const offered = ['category', ...(outlook?.hazards ?? ['tornado', 'wind', 'hail'])];
  if (!offered.includes(layer)) layer = 'category';
  for (const button of document.querySelectorAll('#layerButtons button')) { button.hidden = !offered.includes(button.dataset.layer); button.classList.toggle('on', button.dataset.layer === layer); }
  const legend = $('legend'), note = $('legendNote');
  if (!outlook || outlook.status !== 'issued') { legend.innerHTML = ''; note.textContent = ''; $('issue').textContent = outlook?.status === 'running' ? 'Being prepared…' : '—'; $('headline').textContent = '—'; $('discussion').textContent = outlook?.error ?? ''; $('summary').innerHTML = ''; return; }
  $('issue').textContent = `Issued ${clock(outlook.issuedHourUtc)} · valid ${clock(outlook.validFromHourUtc)} to ${clock(outlook.validToHourUtc)}${outlook.validFromHourUtc > outlook.nowHourUtc ? ` (starts in ${Math.round(outlook.validFromHourUtc - outlook.nowHourUtc)} h)` : ''} · ${outlook.running ? 'update being prepared' : `next update ${clock(outlook.nextUpdateHourUtc)}`}`;
  $('headline').textContent = outlook.labels[outlook.highest];
  $('headline').style.color = CATEGORY_COLOURS[outlook.highest] ?? 'inherit';
  if (layer === 'category') {
    legend.innerHTML = outlook.categories.filter(name => CATEGORY_COLOURS[name]).map((name, k) => `<li><i style="background:${CATEGORY_COLOURS[name]}"></i>${name === 'TSTM' ? 'TSTM' : `${k} - ${CATEGORY_SHORT[name]}`}<b>${outlook.labels[name]}</b></li>`).join('');
    note.textContent = `Thunderstorms: a ${outlook.thunderLevel}% or greater chance of thunderstorms. The severe categories come from the chance of each hazard and its intensity group together.`;
  } else {
    const groups = Array.from({ length: outlook.maxCig[layer] }, (_, k) => `<li><i class="hatch cig${k + 1}"></i>CIG${k + 1}<b>${outlook.cigMeaning[layer][k + 1]}</b></li>`).join('');
    legend.innerHTML = outlook.levels[layer].map(limit => `<li><i style="background:${CHANCE_COLOURS[layer][limit]}"></i>${limit}%</li>`).join('') + groups;
    note.textContent = `Chance of ${HAZARD[layer]} within ${outlook.radiusMiles ?? 25} miles of a point. Hatching: conditional intensity groups, how strong it is expected to be where it happens.`;
  }
  const row = hazard => { const top = outlook.top[hazard]; return `<span>${LAYERS[hazard]}</span><b>${top.level ? `${top.level}%${top.cig ? ` · CIG${top.cig}` : ''}` : 'less than ' + outlook.levels[hazard][0] + '%'}</b>`; };
  $('summary').innerHTML = outlook.hazards.map(row).join('');
  $('discussion').textContent = outlook.discussion;
}

async function load() {
  try { const response = await fetch(`/api/outlooks/${PAGE}`, { cache: 'no-store' }); outlook = await response.json(); }
  catch { outlook = { status: 'failed', error: 'The weather server did not answer.' }; }
  renderSide(); draw();
}

for (const [key, name] of Object.entries(LAYERS)) { const button = document.createElement('button'); button.dataset.layer = key; button.textContent = name; button.addEventListener('click', () => { layer = key; renderSide(); draw(); }); $('layerButtons').append(button); }
window.addEventListener('resize', draw);
load();
setInterval(load, 15000);

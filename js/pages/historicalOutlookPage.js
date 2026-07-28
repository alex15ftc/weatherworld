const canvas = document.querySelector('#outlookCanvas');
const context = canvas.getContext('2d');
const caseSelect = document.querySelector('#caseSelect');
const hazardSelect = document.querySelector('#hazardSelect');
const gridToggle = document.querySelector('#gridToggle');
const opacity = document.querySelector('#opacity');
const stats = document.querySelector('#stats');
const status = document.querySelector('#status');
const inspector = document.querySelector('#inspector');
let activeCase = null;
let cellLookup = new Map();
let viewport = null;

const categoryColors = { TSTM:'#6a8569', MRGL:'#287d3c', SLGT:'#d9c739', ENH:'#d88035', MDT:'#bd3b46', HIGH:'#e151c7' };
const probabilityColors = { 0.02:'#287d3c', 0.05:'#9a5336', 0.10:'#d9c739', 0.15:'#d9c739', 0.30:'#d88035', 0.45:'#bd3b46', 0.60:'#e151c7' };

async function loadCatalog() {
  try {
    const response = await fetch('/api/historical/outlooks/catalog');
    const catalog = await response.json();
    if (!response.ok) throw new Error(catalog.hint ?? catalog.error);
    if (catalog.coordinateSpace !== 'historical-geographic') throw new Error('Catalog coordinate space is not historical-geographic');
    caseSelect.replaceChildren(...catalog.cases.map(item => {
      const option = document.createElement('option');
      option.value = item.caseId;
      option.textContent = `${item.issueDate} ${item.cycle ?? ''} UTC · ${item.forecastDay}`;
      return option;
    }));
    if (!catalog.cases.length) throw new Error('The historical catalog contains no cases');
    await loadCase(catalog.cases.at(-1).caseId);
  } catch (error) {
    status.textContent = error.message;
  }
}
async function loadCase(caseId) {
  status.hidden = false;
  status.textContent = 'Loading rasterized outlook…';
  try {
    const response = await fetch(`/api/historical/outlooks/cases/${encodeURIComponent(caseId)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.hint ?? payload.error);
    if (payload.coordinateSpace !== 'historical-geographic') throw new Error('Case is not in historical-geographic coordinates');
    activeCase = payload;
    cellLookup = new Map(payload.outlook.rasterizedOutlook.cells.map(cell => [`${cell.x}:${cell.y}`, cell]));
    renderStats();
    render();
    status.hidden = true;
  } catch (error) {
    status.hidden = false;
    status.textContent = error.message;
  }
}
function renderStats() {
  const raster = activeCase.outlook.rasterizedOutlook;
  const values = [
    [activeCase.metadata.forecastDay?.toUpperCase() ?? '—', 'Forecast day'],
    [`${raster.grid.width} × ${raster.grid.height}`, 'Historical grid'],
    [raster.diagnostics.populatedCellCount.toLocaleString(), 'Populated cells'],
    [activeCase.diagnostics.contourCount.toLocaleString(), 'SPC contours']
  ];
  stats.innerHTML = values.map(([value,label]) => `<div class="stat"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`).join('');
}
function render() {
  if (!activeCase) return;
  const raster = activeCase.outlook.rasterizedOutlook;
  const { width, height } = raster.grid;
  const padding = 18;
  const scale = Math.min((canvas.width - padding * 2) / width, (canvas.height - padding * 2) / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  viewport = { x: (canvas.width - drawWidth) / 2, y: (canvas.height - drawHeight) / 2, scale, width, height };
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#080c12'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalAlpha = Number(opacity.value) / 100;
  const hazard = hazardSelect.value;
  for (const cell of raster.cells) {
    const style = styleForCell(cell, hazard);
    if (!style) continue;
    context.fillStyle = style;
    context.fillRect(viewport.x + cell.x * scale, viewport.y + cell.y * scale, Math.max(1, scale + .25), Math.max(1, scale + .25));
  }
  context.globalAlpha = 1;
  if (gridToggle.checked && scale >= 3) {
    context.strokeStyle = 'rgba(255,255,255,.14)'; context.lineWidth = .5;
    context.beginPath();
    for (let x = 0; x <= width; x += 1) { const px = viewport.x + x * scale; context.moveTo(px, viewport.y); context.lineTo(px, viewport.y + drawHeight); }
    for (let y = 0; y <= height; y += 1) { const py = viewport.y + y * scale; context.moveTo(viewport.x, py); context.lineTo(viewport.x + drawWidth, py); }
    context.stroke();
  }
  context.strokeStyle = '#617184'; context.lineWidth = 1; context.strokeRect(viewport.x, viewport.y, drawWidth, drawHeight);
}
function styleForCell(cell, hazard) {
  if (hazard === 'coverage') {
    const coverages = Object.values(cell.hazards ?? {}).map(item => Number(item.coverageFraction ?? 0));
    const value = Math.max(0, ...coverages);
    return value ? `rgba(115,184,255,${Math.max(.15, value)})` : null;
  }
  const value = cell.hazards?.[hazard];
  if (!value) return null;
  if (hazard === 'categorical') return categoryColors[value.value] ?? '#8996a5';
  if (hazard.startsWith('significant')) return '#9c63d8';
  return probabilityColors[Number(value.value).toFixed(2)] ?? probabilityColors[value.value] ?? '#73b8ff';
}
function inspect(event) {
  if (!activeCase || !viewport) return;
  const rect = canvas.getBoundingClientRect();
  const px = (event.clientX - rect.left) * canvas.width / rect.width;
  const py = (event.clientY - rect.top) * canvas.height / rect.height;
  const x = Math.floor((px - viewport.x) / viewport.scale);
  const y = Math.floor((py - viewport.y) / viewport.scale);
  if (x < 0 || y < 0 || x >= viewport.width || y >= viewport.height) return;
  const cell = cellLookup.get(`${x}:${y}`);
  if (!cell) {
    inspector.innerHTML = `<h2>Cell ${x}, ${y}</h2><p>This historical grid cell is outside all parsed SPC contours.</p>`;
    return;
  }
  const hazards = Object.entries(cell.hazards ?? {}).map(([name,value]) => `<dt>${escapeHtml(name)}</dt><dd>${escapeHtml(formatHazard(value))}</dd>`).join('');
  inspector.innerHTML = `<h2>${escapeHtml(cell.id)}</h2><dl><dt>Column / row</dt><dd>${x} / ${y}</dd><dt>Center</dt><dd>${cell.center.lat.toFixed(3)}, ${cell.center.lon.toFixed(3)}</dd>${hazards}</dl><h3>Source contours</h3><ul>${cell.contourIds.map(id => `<li>${escapeHtml(id)}</li>`).join('')}</ul>`;
}
function formatHazard(value) {
  const displayed = typeof value.value === 'number' ? `${Math.round(value.value * 100)}%` : value.value;
  return `${displayed}${value.significant ? ' SIGN' : ''} · ${Math.round((value.coverageFraction ?? 0) * 100)}% cover`;
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
caseSelect.addEventListener('change', () => loadCase(caseSelect.value));
hazardSelect.addEventListener('change', render);
gridToggle.addEventListener('change', render);
opacity.addEventListener('input', render);
canvas.addEventListener('click', inspect);
loadCatalog();

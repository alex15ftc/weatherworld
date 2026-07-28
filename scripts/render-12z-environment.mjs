import fs from 'node:fs';
import path from 'node:path';
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution } from '../js/evolution.js';

const seed = Number(process.argv[2]);
if (!Number.isFinite(seed)) {
  console.error('Usage: node scripts/render-12z-environment.mjs <seed> [output.svg]');
  process.exit(1);
}

const output = path.resolve(process.argv[3] ?? `verification-runs/seed-${seed}-12z.svg`);
const world = new Atmosphere(50, 40);
const config = generateScenario(world, seed);
initializeEvolution(world, config);

const panelW = 500;
const panelH = 400;
const left = 34;
const top = 116;
const gap = 32;
const scaleX = panelW / world.width;
const scaleY = panelH / world.height;
const surface = [];
const upper = [];

world.forEachCell((cell, x, y) => {
  const px = left + x * scaleX;
  const py = top + y * scaleY;
  surface.push(rect(px, py, scaleX + 0.2, scaleY + 0.2, dewpointColor(cell.surface.dewpoint)));
  upper.push(rect(left + panelW + gap + x * scaleX, py, scaleX + 0.2, scaleY + 0.2, heightColor(cell.levels[500].heightDm)));
});

const surfaceOverlay = [];
const upperOverlay = [];
for (let y = 2; y < world.height; y += 5) {
  for (let x = 2; x < world.width; x += 5) {
    const cell = world.getCell(x, y);
    const sx = left + (x + 0.5) * scaleX;
    const sy = top + (y + 0.5) * scaleY;
    surfaceOverlay.push(`<text x="${sx}" y="${sy}" class="pressure">${Math.round(cell.surface.seaLevelPressure)}</text>`);
    const wind = windVector(cell.levels[850].windSpeed, cell.levels[850].windDirection);
    upperOverlay.push(arrow(
      left + panelW + gap + (x + 0.5) * scaleX,
      sy,
      wind.u,
      -wind.v,
      cell.levels[850].windSpeed
    ));
  }
}

for (const center of world.analysis?.pressureSystems?.centers ?? []) {
  const x = left + (center.x + 0.5) * scaleX;
  const y = top + (center.y + 0.5) * scaleY;
  surfaceOverlay.push(`<text x="${x}" y="${y}" class="center ${center.type === 'L' ? 'low' : 'high'}">${center.type}</text>`);
}

for (const boundary of world.mesoscale?.boundaries ?? []) {
  const points = boundary.pointsKm.map(point => {
    const x = left + point.x / world.domainWidthKm * panelW;
    const y = top + point.y / world.domainHeightKm * panelH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  surfaceOverlay.push(
    `<polyline points="${points}" class="boundary ${boundary.type}" />`
  );
}

const stats = summarize(world);
const topology = config.boundaryTopology.length ? config.boundaryTopology.join(' + ') : 'none';
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="590" viewBox="0 0 1100 590">
<style>
  .title{font:700 25px system-ui;fill:#f8fafc}.subtitle{font:14px system-ui;fill:#cbd5e1}
  .panel{font:700 16px system-ui;fill:#f8fafc}.pressure{font:9px ui-monospace;fill:#0f172a;opacity:.72;text-anchor:middle}
  .center{font:900 28px system-ui;text-anchor:middle;paint-order:stroke;stroke:#fff;stroke-width:3px}.low{fill:#dc2626}.high{fill:#2563eb}
  .boundary{fill:none;stroke-width:4;stroke-linecap:round;stroke-linejoin:round}.cold{stroke:#2563eb}.warm{stroke:#dc2626}.dryline{stroke:#9a5b2e;stroke-dasharray:10 7}
  .frame{fill:none;stroke:#94a3b8;stroke-width:1}.legend{font:12px system-ui;fill:#e2e8f0}.metric{font:13px ui-monospace;fill:#dbeafe}
</style>
<rect width="1100" height="590" fill="#111827"/>
<text x="34" y="38" class="title">Seed ${seed} · ${escapeXml(config.setupLabel)} · 12Z environment</text>
<text x="34" y="64" class="subtitle">${escapeXml(config.narrativeLabel)} · boundaries: ${topology} · pattern tilt ${config.patternRotationDegrees.toFixed(1)}°</text>
<text x="${left}" y="${top - 14}" class="panel">Surface dewpoint (°F), sea-level pressure (hPa), analyzed boundaries</text>
<text x="${left + panelW + gap}" y="${top - 14}" class="panel">500-mb height (dm) with 850-mb wind vectors</text>
${surface.join('')}${upper.join('')}
<rect x="${left}" y="${top}" width="${panelW}" height="${panelH}" class="frame"/>
<rect x="${left + panelW + gap}" y="${top}" width="${panelW}" height="${panelH}" class="frame"/>
${surfaceOverlay.join('')}${upperOverlay.join('')}
<text x="34" y="548" class="metric">SLP min ${stats.minimumPressure.toFixed(1)} hPa · max Td ${stats.maximumDewpoint.toFixed(1)}°F · mean/max MUCAPE ${stats.meanMuCape.toFixed(0)}/${stats.maximumMuCape.toFixed(0)} J kg⁻¹</text>
<text x="34" y="572" class="legend">Dewpoint: brown = dry, green/blue = richer moisture · 500 mb: blue = lower heights/trough, orange = ridge · arrow length = 850-mb wind speed</text>
</svg>`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, svg);
console.log(JSON.stringify({ seed, setupType: config.setupType, topology: config.boundaryTopology, output, stats }, null, 2));

function summarize(atmosphere) {
  let minimumPressure = Infinity;
  let maximumDewpoint = -Infinity;
  let warmCape = 0;
  let maximumWarmCape = 0;
  let warmCount = 0;
  let muCape = 0;
  let maximumMuCape = 0;
  let muCount = 0;
  atmosphere.forEachCell(cell => {
    minimumPressure = Math.min(minimumPressure, cell.surface.seaLevelPressure);
    maximumDewpoint = Math.max(maximumDewpoint, cell.surface.dewpoint);
    if (cell.features?.warmSector) {
      const cape = Number(cell.derived?.cape) || 0;
      warmCape += cape;
      maximumWarmCape = Math.max(maximumWarmCape, cape);
      warmCount++;
    }
    const mostUnstableCape = Number(cell.derived?.sounding?.mucape);
    if (Number.isFinite(mostUnstableCape)) {
      muCape += mostUnstableCape;
      maximumMuCape = Math.max(maximumMuCape, mostUnstableCape);
      muCount++;
    }
  });
  return {
    minimumPressure,
    maximumDewpoint,
    meanWarmCape: warmCape / Math.max(1, warmCount),
    maximumWarmCape,
    meanMuCape: muCape / Math.max(1, muCount),
    maximumMuCape
  };
}

function rect(x, y, width, height, fill) {
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" fill="${fill}"/>`;
}
function dewpointColor(value) {
  return colorRamp(value, [[25,'#7c4a2d'],[40,'#b08955'],[52,'#8ca866'],[60,'#48a36d'],[67,'#20a486'],[73,'#2a9dba']]);
}
function heightColor(value) {
  return colorRamp(value, [[540,'#264653'],[555,'#287a8c'],[570,'#74a892'],[582,'#d8b365'],[594,'#d97745']]);
}
function colorRamp(value, stops) {
  let nearest = stops[0];
  for (const stop of stops) if (Math.abs(value - stop[0]) < Math.abs(value - nearest[0])) nearest = stop;
  return nearest[1];
}
function windVector(speed, direction) {
  const radians = direction * Math.PI / 180;
  return { u: -speed * Math.sin(radians), v: -speed * Math.cos(radians) };
}
function arrow(x, y, u, v, speed) {
  const magnitude = Math.max(1, Math.hypot(u, v));
  const length = Math.min(23, 5 + speed * 0.24);
  const dx = u / magnitude * length;
  const dy = v / magnitude * length;
  return `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + dx).toFixed(1)}" y2="${(y + dy).toFixed(1)}" stroke="#0f172a" stroke-width="1.5" opacity=".8"/>`;
}
function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, character => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[character]));
}

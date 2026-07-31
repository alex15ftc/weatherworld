#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateAtmosphericSeed, createSeededRandom } from './generate-atmospheric-seed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_ROOT = path.join(ROOT, 'training', 'generated-grids');
const SCHEMA_VERSION = '2.41.1';
const REGION_META = Object.freeze({
  NW_HIGH_PLAINS: { elevationClass: 'high', dewpointBaselineF: 52, moistureRecovery: .62, emlFrequency: .88 },
  SW_HIGH_PLAINS: { elevationClass: 'high', dewpointBaselineF: 55, moistureRecovery: .68, emlFrequency: .94 },
  N_CENTRAL_PLAINS: { elevationClass: 'mid', dewpointBaselineF: 58, moistureRecovery: .82, emlFrequency: .72 },
  S_CENTRAL_PLAINS: { elevationClass: 'mid', dewpointBaselineF: 63, moistureRecovery: .94, emlFrequency: .76 },
  NE_LOW_PLAINS: { elevationClass: 'low', dewpointBaselineF: 61, moistureRecovery: 1.02, emlFrequency: .48 },
  SE_LOW_PLAINS: { elevationClass: 'low', dewpointBaselineF: 67, moistureRecovery: 1.15, emlFrequency: .42 }
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
const finite = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
const round = (v, n = 3) => Math.round(finite(v) * 10 ** n) / 10 ** n;
const gaussian = (x, y, cx, cy, rx, ry = rx) => Math.exp(-(((x-cx)/rx)**2 + ((y-cy)/ry)**2) * 2);
const logistic = x => 1 / (1 + Math.exp(-x));
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function regionIdAt(nx, ny) {
  const north = ny < .5 + .035 * Math.sin(nx * Math.PI * 2);
  const band = nx < .34 + .025 * Math.sin(ny * Math.PI * 2) ? 'HIGH' : nx < .68 + .025 * Math.cos(ny * Math.PI * 2) ? 'CENTRAL' : 'LOW';
  if (band === 'HIGH') return north ? 'NW_HIGH_PLAINS' : 'SW_HIGH_PLAINS';
  if (band === 'CENTRAL') return north ? 'N_CENTRAL_PLAINS' : 'S_CENTRAL_PLAINS';
  return north ? 'NE_LOW_PLAINS' : 'SE_LOW_PLAINS';
}
function staticCell(nx, ny, x, y) {
  const regionId = regionIdAt(nx, ny); const ridge = (1 - nx) ** 1.7;
  return { regionId, elevationM: Math.round(180 + 1450 * ridge + 90 * Math.sin(y * .11) * ridge), roughness: regionId.includes('HIGH') ? .34 : regionId.includes('CENTRAL') ? .48 : .62, soilMoisture: clamp(.32 + nx * .34 + (ny > .5 ? .09 : 0), 0, 1) };
}
function deriveBlueprint(record, random) {
  const raw = record.inputs.raw; const direct = raw.spatialDirect ?? {}; const wind = raw.windProfile ?? {}; const syn = raw.synoptic ?? {};
  const orient = finite(direct.capeCorridorOrientationDeg, 150 + random() * 45) * Math.PI / 180;
  const low = { x: clamp(.30 + random() * .24, .18, .58), y: clamp(.28 + random() * .42, .12, .78) };
  const drylineX = clamp(low.x + .08 + random() * .10, .25, .72);
  const warmFrontY = clamp(low.y + .02 + (random() - .5) * .08, .15, .83);
  return {
    coordinateSystem: 'fictional-world-normalized',
    pattern: record.atmosphericIdentity.pattern,
    surfaceLow: low,
    upperTrough: { x: clamp(low.x - .12, .04, .52), y: clamp(low.y - .04, .05, .88), tiltDegrees: round((orient * 180 / Math.PI + 25) % 180, 1) },
    dryline: { baseX: drylineX, slope: round((random() - .5) * .18, 4) },
    warmFront: { baseY: warmFrontY, curvature: round((random() - .5) * .10, 4) },
    jetStreak: { x: clamp(low.x + .17, .25, .88), y: clamp(low.y - .17, .05, .72), speedMs: round(finite(syn.jetStrengthMs, wind.wind250P90Ms ?? 42), 2) },
    moistureAxis: { x: clamp(drylineX + .15, .38, .90), y: clamp(warmFrontY + .20, .25, .92), orientationDegrees: round(orient * 180 / Math.PI, 1) },
    expectedEvolution: record.narrative.expectedEvolution,
    analogEnvelope: record.analogs ? { confidence: record.analogs.confidence, sourceDates: record.analogs.results.slice(0, 5).map(x => x.eventDate) } : null
  };
}
function synthesize(record, { rows = 60, cols = 80, cellSizeKm = 10 } = {}) {
  const random = createSeededRandom(`${record.seed}:grid:2.41.1`); const blueprint = deriveBlueprint(record, random);
  const raw = record.inputs.raw; const thermo = raw.thermodynamics ?? {}; const wind = raw.windProfile ?? {}; const syn = raw.synoptic ?? {};
  const targetCape = clamp(finite(thermo.capeP90Jkg, thermo.capeMaxJkg ?? 2200), 200, 6000);
  const targetCin = clamp(Math.abs(finite(thermo.cinMeanJkg, 65)), 0, 250);
  const targetTdF = clamp((finite(thermo.dewpointP90K, 292) - 273.15) * 9/5 + 32, 38, 78);
  const shear = clamp(finite(wind.shear850To500Ms, 18), 3, 45);
  const jet = clamp(finite(syn.jetStrengthMs, wind.wind250P90Ms ?? 42), 15, 85);
  const fields = Object.fromEntries(['elevationM','temperature2mF','dewpoint2mF','pressureHpa','wind850Ms','wind500Ms','wind250Ms','capeJkg','cinJkg','lapseRate700500Ckm','shear06kmMs','srh03km','forcing','convergence','capErosion','initiationPotential'].map(k => [k, []]));
  const regions = [];
  for (let y=0; y<rows; y++) for (let x=0; x<cols; x++) {
    const nx = cols === 1 ? 0 : x/(cols-1), ny = rows === 1 ? 0 : y/(rows-1); const st = staticCell(nx, ny, x, y); const meta = REGION_META[st.regionId];
    const drylineX = blueprint.dryline.baseX + blueprint.dryline.slope * (ny-.5); const warmFrontY = blueprint.warmFront.baseY + blueprint.warmFront.curvature * Math.sin(nx*Math.PI);
    const eastDry = logistic((nx-drylineX)*35), southWarm = logistic((ny-warmFrontY)*28); const warmSector = eastDry*southWarm;
    const low = gaussian(nx, ny, blueprint.surfaceLow.x, blueprint.surfaceLow.y, .18, .15); const jetCore = gaussian(nx, ny, blueprint.jetStreak.x, blueprint.jetStreak.y, .25, .12);
    const moistureAxis = gaussian(nx, ny, blueprint.moistureAxis.x, blueprint.moistureAxis.y, .22, .38); const terrainMix = clamp((st.elevationM-180)/1450,0,1);
    const boundary = Math.exp(-Math.abs(nx-drylineX)*38) * southWarm + Math.exp(-Math.abs(ny-warmFrontY)*34) * eastDry;
    const td = clamp(meta.dewpointBaselineF + (targetTdF-meta.dewpointBaselineF)*(.38+.62*warmSector) + 4*moistureAxis - 7*terrainMix, 25, 80);
    const temp = clamp(58 + 25*ny + 10*warmSector + 7*(1-eastDry)*southWarm - st.elevationM*.003, 25, 108);
    const cape = clamp(targetCape * warmSector * (.42+.58*moistureAxis) * (1-.22*terrainMix) + 120*boundary, 0, 7000);
    const forcing = clamp(.12 + .42*low + .30*jetCore + .38*boundary + finite(syn.forcingInstabilityOverlapProxy,.3)*.25, 0, 1.5);
    const cin = clamp(targetCin*(.65+.55*meta.emlFrequency)*(1-.72*forcing) + 35*(1-warmSector), 0, 300);
    const convergence = clamp(.12 + .78*boundary + .22*low, 0, 1.4); const capErosion = clamp(forcing*.62 + boundary*.28 + terrainMix*.14, 0, 1);
    const initiation = clamp((cape/2200)*.42 + (1-cin/220)*.24 + convergence*.22 + forcing*.16, 0, 1);
    const pressure = 1018 - 18*low + 5*gaussian(nx,ny,.88,.20,.28,.24) + st.elevationM*.0005;
    const lapse = clamp(6.1 + 2.1*meta.emlFrequency + .55*terrainMix, 5.2, 9.6); const srh = clamp((shear*7.5)*(1+.75*Math.exp(-Math.abs(ny-warmFrontY)*16))*warmSector,0,650);
    const values = { elevationM:st.elevationM, temperature2mF:temp, dewpoint2mF:Math.min(td,temp-1), pressureHpa:pressure, wind850Ms:clamp(shear*.65+8*warmSector+4*low,0,40), wind500Ms:clamp(shear+12+8*jetCore,0,65), wind250Ms:clamp(jet*(.55+.55*jetCore),0,95), capeJkg:cape, cinJkg:cin, lapseRate700500Ckm:lapse, shear06kmMs:shear*(.75+.35*jetCore), srh03km:srh, forcing, convergence, capErosion, initiationPotential:initiation };
    for (const [k,v] of Object.entries(values)) fields[k].push(round(v)); regions.push(st.regionId);
  }
  return { schemaVersion:SCHEMA_VERSION, generator:'fictional-world-seed-grid-synthesizer', seed:record.seed, seedHash:record.seedHash, generatedAt:new Date().toISOString(), grid:{rows,cols,cellSizeKm,coordinateSystem:'fictional-world-grid'}, blueprint, regions, fields, validation:validateGrid(fields, rows*cols, targetCape, targetTdF), sourceSeedRecord:{pattern:record.atmosphericIdentity.pattern,narrative:record.narrative,analogConfidence:record.analogs?.confidence??null} };
}
function validateGrid(fields, count, targetCape, targetTdF) {
  const errors=[]; for (const [name, values] of Object.entries(fields)) if(values.length!==count || values.some(v=>!Number.isFinite(v))) errors.push(`${name} is incomplete or non-finite.`);
  const maxCape=Math.max(...fields.capeJkg), meanTd=fields.dewpoint2mF.reduce((a,b)=>a+b,0)/count; const boundaryCells=fields.convergence.filter(v=>v>.45).length;
  if(maxCape<Math.min(500,targetCape*.25)) errors.push('Instability corridor did not synthesize.'); if(boundaryCells<Math.max(3,count*.005)) errors.push('Boundary geometry is too weak or discontinuous.');
  return { valid:errors.length===0, errors, checks:{cellCount:count,maxCapeJkg:round(maxCape),meanDewpointF:round(meanTd),targetDewpointF:round(targetTdF),boundaryCellCount:boundaryCells} };
}
function parseArgs(args){const o={rows:60,cols:80,cellSizeKm:10,write:true,analogs:true};for(let i=0;i<args.length;i++){const a=args[i];if(a==='--seed')o.seed=args[++i];else if(a==='--record')o.record=args[++i];else if(a==='--rows')o.rows=Number(args[++i]);else if(a==='--cols')o.cols=Number(args[++i]);else if(a==='--cell-size-km')o.cellSizeKm=Number(args[++i]);else if(a==='--no-analogs')o.analogs=false;else if(a==='--no-write')o.write=false;else if(a==='--json')o.json=true;else if(a==='--output')o.output=args[++i];}return o;}
export function generateSeededGrid(seedOrRecord, options={}) { const record=typeof seedOrRecord==='object'?seedOrRecord:generateAtmosphericSeed(seedOrRecord,{analogs:options.analogs!==false,top:options.top??8}); return synthesize(record,options); }
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{const o=parseArgs(process.argv.slice(2));let record;if(o.record)record=JSON.parse(fs.readFileSync(path.resolve(o.record),'utf8'));else if(o.seed)record=generateAtmosphericSeed(o.seed,{analogs:o.analogs});else throw new Error('Specify --seed <value> or --record <seed-record.json>.');const grid=synthesize(record,o);if(!grid.validation.valid)throw new Error(grid.validation.errors.join('; '));if(o.write){const id=crypto.createHash('sha256').update(`${record.seed}:grid`).digest('hex').slice(0,16);const out=path.resolve(o.output??path.join(OUTPUT_ROOT,id,'grid.json'));writeJson(out,grid);grid.output=path.relative(ROOT,out).replaceAll('\\','/');}if(o.json)console.log(JSON.stringify(grid,null,2));else{console.log('\nSeed-to-Grid Atmospheric Synthesis');console.log(`Seed: ${grid.seed}`);console.log(`Grid: ${grid.grid.cols}x${grid.grid.rows} at ${grid.grid.cellSizeKm} km`);console.log(`Pattern: ${grid.blueprint.pattern}`);console.log(`Validation: ${grid.validation.valid?'PASS':'FAIL'}`);console.log(`Peak CAPE: ${grid.validation.checks.maxCapeJkg} J/kg`);console.log(`Boundary cells: ${grid.validation.checks.boundaryCellCount}`);if(grid.output)console.log(`Grid: ${grid.output}`);}}catch(e){console.error(e.stack??e.message);process.exitCode=1;}}

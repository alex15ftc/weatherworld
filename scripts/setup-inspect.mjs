// Prints what each seed's narrative produced: setup, flow regime, ingredients, and the
// sounding-derived warm-sector environment at 12Z and 21Z (plus upper flow and wind ranges).
//   node scripts/setup-inspect.mjs [seed ...]
import { Atmosphere } from '../js/atmosphere.js';
import { generateScenario } from '../js/scenarios/scenarioGenerator.js';
import { initializeEvolution, advanceAtmosphere } from '../js/evolution.js';
import { SIMULATION_CONFIG } from '../js/simulationConfig.js';

const seeds = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [1, 7, 23, 42, 99, 2011, 5, 314];
const pct = (values, p) => { const v = [...values].sort((a, b) => a - b); return v.length ? v[Math.floor(p * (v.length - 1))] : NaN; };
const circularMean = dirs => { let s = 0, c = 0; for (const d of dirs) { s += Math.sin(d * Math.PI / 180); c += Math.cos(d * Math.PI / 180); } return ((Math.atan2(s, c) * 180 / Math.PI) + 360) % 360; };

function summarize(world) {
  const warm = [], all = [];
  world.forEachCell(cell => { all.push(cell); if (cell.features?.warmSector) warm.push(cell); });
  const f = (cells, get) => cells.map(get).filter(Number.isFinite);
  const cape = f(warm, c => c.derived.cape), cin = f(warm, c => c.derived.cin), srh = f(warm, c => c.derived.srh);
  const shear = f(warm, c => c.derived.bulkShear), lcl = f(warm, c => c.derived.lclAgl), stp = f(all, c => c.derived.stp);
  const td = f(warm, c => c.surface.dewpoint), t = f(warm, c => c.surface.temperature);
  return `warm ${(100 * warm.length / all.length).toFixed(0)}% | T ${pct(t, .5).toFixed(0)}/Td ${pct(td, .5).toFixed(0)}F | MLCAPE p50 ${Math.round(pct(cape, .5))} p90 ${Math.round(pct(cape, .9))} | MLCIN p50 ${Math.round(pct(cin, .5))} | SRH01 p50 ${Math.round(pct(srh, .5))} p90 ${Math.round(pct(srh, .9))} | shear06 p50 ${Math.round(pct(shear, .5))} | LCL p50 ${Math.round(pct(lcl, .5))} m | STP max ${pct(stp, 1).toFixed(1)}`;
}

for (const seed of seeds) {
  const world = new Atmosphere(SIMULATION_CONFIG.fixedColumns, SIMULATION_CONFIG.fixedRows);
  const config = generateScenario(world, seed);
  initializeEvolution(world, config, { profile: { name: 'gameplay', outlookIssuance: 'off' } });
  const i = config.ingredients;
  console.log(`seed ${seed}: ${config.narrative} / ${config.setupType} / ${config.flowRegime} flow (from ${Math.round(config.synopticPattern.flowFromDeg)}°), intensity ${config.intensity.toFixed(2)}, topology ${config.boundaryTopology.join('+') || 'none'}`);
  console.log(`  ingredients: Td ${i.gulfDewpointF.toFixed(0)}F, 850 ${i.t850C.toFixed(0)}C, cap700 ${i.cap700C.toFixed(1)}C, lapse ${i.lapse700500.toFixed(1)}, flow500 ${i.flow500Kt.toFixed(0)}kt, jet +${i.jetPeakKt.toFixed(0)}kt, LLJ ${i.lljKt.toFixed(0)}kt, trough ${i.troughDm.toFixed(0)}dam, low ${i.lowDepthHpa.toFixed(0)}hPa`);
  const winds = level => { const d = [], s = []; world.forEachCell(c => { const l = level === 'sfc' ? c.surface.wind : c.levels[level]; d.push(l.windDirection ?? l.direction); s.push(l.windSpeed ?? l.speed); }); return `${level} from ${Math.round(circularMean(d))}° ${Math.round(pct(s, .1))}-${Math.round(pct(s, .9))}kt`; };
  console.log(`  12Z flow: ${['sfc', 850, 500, 250].map(winds).join(' | ')}`);
  console.log(`  12Z ${summarize(world)}`);
  advanceAtmosphere(world, 9);
  console.log(`  21Z ${summarize(world)}`);
  const storms = world.storms.filter(s => s.active !== false);
  const motion = storms.map(s => ((Math.atan2(s.velocityKph.east, s.velocityKph.north) * 180 / Math.PI) + 360) % 360);
  console.log(`  21Z storms ${storms.length}${storms.length ? `, moving toward ${Math.round(circularMean(motion))}° (range ${Math.round(Math.min(...motion))}-${Math.round(Math.max(...motion))})` : ''}`);
}

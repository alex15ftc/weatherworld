// The day packages a meteorologist reviews (docs/METEOROLOGIST-REVIEW-*.md): as each convective
// day (12Z to 12Z) finishes, the charts and numbers a forecaster would look at to name the setup
// and find real-world analog days, including the whole large-scale model, not only the region.
// Used by scripts/day-review-pack.mjs (worlds it steps itself) and by the live server
// (WeatherAuthorityRuntime: a folder per finished day under data/day-reviews/live).
//   const recorder = createDayRecorder({ engine, seed, outDir, places, outlookFor });
//   after each storm tick: recorder.stormTick(); after each atmosphere step: recorder.afterStep()
// outlookFor(dayStartHour, dayEndHour): the Day 1 outlook for that day (combineOutlook's result),
// or null while there is none; it is asked at each step until it gives one. Recording starts at
// the first 12Z it sees. Charts are SVG; png: true turns them into PNG with a headless Chrome or
// Edge in the background. keepDays keeps only the newest day folders.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { describeStormMode, rotatingShare, lineShare } from '../js/storms/StormModeEngine.js';
import { MESOANALYSIS_PARAMETERS } from './mesoanalysisParameters.js';
import { encodeRgbaPng } from './tiles/PngEncoder.js';

const P = Object.fromEntries(MESOANALYSIS_PARAMETERS.map(p => [p.key, p]));
const KT = 1.943844, GRAVITY = 9.80665;
// For orientation only: the region's middle is put at central Kansas, and the large-scale
// model's distances turned into rough latitude and longitude about it. The model itself has
// no continents, oceans or mountains (those are the regional layer's).
const CENTRE = { lat: 38.5, lon: -97.5 };
export const FULL_HOURS = [12, 18, 0, 6], REGION_HOURS = [18, 21, 0, 3];

export function createDayRecorder({ engine, seed = engine.seed, outDir, places, outlookFor = null, png = false, keepDays = null, folder = `seed-${seed}` }) {
  const world = engine.world, regional = engine.regional, model = engine.model;
  fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(path.join(outDir, 'README.md'))) fs.writeFileSync(path.join(outDir, 'README.md'), README);
  const tracks = new Map();   // storm id -> { points: [[x, y, hour, mode]], maxIntensity }
  const h500At = new Map();   // hour -> the large-scale 500 mb heights, for 12-hour changes
  let dayData = null, svgs = [], busy = Promise.resolve();
  const dayNumber = hour => Math.floor((hour - 12) / 24 + 1e-6) + 1;
  const dayDir = d => { const dir = path.join(outDir, folder, `day-${d}`); fs.mkdirSync(dir, { recursive: true }); return dir; };
  const newDay = hour => ({ day: dayNumber(hour), startHour: hour, hourly: [], soundings: [], steering: engine.steering?.plan ? { ...engine.steering.plan } : null, outlook: null });

  function stormTick() {
    const hour = world.stormEngine?.validHourUtc ?? world.validHourUtc;
    for (const storm of world.storms) {
      if (!storm.active || storm.intensity < 0.3) continue;
      const t = tracks.get(storm.id) ?? { points: [], born: hour, maxIntensity: 0, modes: {} };
      const mode = describeStormMode(storm);
      t.points.push([storm.positionKm.x, storm.positionKm.y, hour, rotatingShare(storm) >= 0.5 ? 'rot' : lineShare(storm) >= 0.5 ? 'line' : 'cell']);
      t.maxIntensity = Math.max(t.maxIntensity, storm.intensity); t.modes[mode] = (t.modes[mode] ?? 0) + 1;
      tracks.set(storm.id, t);
    }
  }

  // After each atmosphere step. What a chart shows is read from the world at once; only its
  // images are awaited, and the steps are queued so the days are written in order.
  function afterStep() {
    const hour = world.validHourUtc;
    const job = step(hour);
    busy = busy.then(() => job).catch(error => console.warn('[day review]', error.message));
    return busy;
  }
  function step(hour) {
    const hh = ((Math.round(hour) % 24) + 24) % 24, onHour = Math.abs(hour - Math.round(hour)) < 1e-6, at12Z = onHour && hh === 12;
    const jobs = [];
    if (dayData && at12Z && hour > dayData.startHour) {
      // The day just finished: its summary, storm map and outlook, written once its charts are drawn.
      dayData.hourly.push(regionStats(hour));
      const finished = dayData, dir = dayDir(finished.day);
      writeDay(finished, dir);
      if (finished.outlook) writeOutlook(finished, dir);
      const done = svgs; svgs = [];
      jobs.push(Promise.all(done).then(items => {
        for (const item of items) fs.writeFileSync(`${item.file}.svg`, item.svg);
        prune(finished);
        return png ? toPng(items, outDir).catch(error => console.warn('[day review] png:', error.message)) : null;
      }));
      dayData = null;
    }
    if (!dayData && at12Z) dayData = newDay(hour);
    if (!dayData) return Promise.all(jobs);
    if (!dayData.outlook && outlookFor) dayData.outlook = outlookFor(dayData.startHour, dayData.startHour + 24) ?? null;
    if (!onHour) return Promise.all(jobs);
    if (hh % 3 === 0) dayData.hourly.push(regionStats(hour));
    const dir = dayDir(dayData.day);
    if (FULL_HOURS.includes(hh)) {
      const full = fullFields(), before = h500At.get(hour - 12), nx = full.nx;
      // (The chart is rolled to the region, which slides: line the two up by model column.)
      const change = before ? full.h500.map((v, k) => v - before.h500[Math.floor(k / nx) * nx + (((k % nx) + full.roll - before.roll) % nx + nx) % nx]) : null;
      h500At.set(hour, { h500: full.h500, roll: full.roll });
      svgs.push(fullChart(full, change, hour).then(svg => ({ file: path.join(dir, `full-${pad(hh)}Z`), svg })));
    }
    if (REGION_HOURS.includes(hh)) {
      if (hh === 21 || hh === 0) dayData.soundings.push(...soundings(hour));
      svgs.push(regionChart(hour).then(svg => ({ file: path.join(dir, `region-${pad(hh)}Z`), svg })));
    }
    return Promise.all(jobs);
  }

  // What is no longer needed: storm tracks and heights from before the day, and old day folders.
  // (The next day's folder is already being filled: only finished days count.)
  function prune(finished) {
    const dayStart = finished.startHour;
    for (const [id, t] of tracks) if (t.points.at(-1)[2] <= dayStart) tracks.delete(id);
    for (const hour of h500At.keys()) if (hour < dayStart) h500At.delete(hour);
    if (!keepDays) return;
    const root = path.join(outDir, folder), days = fs.readdirSync(root).filter(n => /^day-\d+$/.test(n) && Number(n.slice(4)) <= finished.day).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
    for (const name of days.slice(0, Math.max(0, days.length - keepDays))) fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }

  function writeOutlook(D, dir) {
    const outlook = D.outlook, now = outlook.issuedHourUtc ?? D.startHour;
    const e = outlook.expected;
    fs.writeFileSync(path.join(dir, 'outlook.md'), [`# Day 1 outlook, seed ${seed} day ${D.day}, issued ${stamp(now)}`, '', `Highest category: ${outlook.highest}. Runs with a tornado: ${e.membersWithTornado} of ${outlook.members}; tornadoes expected ${e.tornadoes.low}-${e.tornadoes.high} (middle ${e.tornadoes.middle}).`, '', outlook.discussion ?? ''].join('\n'));
    svgs.push(Promise.resolve({ file: path.join(dir, 'outlook'), svg: outlookChart(outlook, D.day, now) }));
  }

  // (A world at 12Z now starts its day now.)
  afterStep();
  return { stormTick, afterStep, flush: () => busy };

  // ---------------------------------------------------------------------------------------------
  function fullFields() {
    const nx = model.nx, ny = model.ny, d = model.d, ref = regional.referenceMidPsi(), f0 = model.params.f0;
    // Columns rolled so the region's middle is in the middle of the chart.
    const mid = regional.origin.x + regional.nx * regional.dx / 2, roll = Math.round(mid / d) - nx / 2;
    const n = nx * ny, out = { nx, ny, roll, h500: new Float64Array(n), u250: new Float64Array(n), v250: new Float64Array(n), u500: new Float64Array(n), v500: new Float64Array(n), u850: new Float64Array(n), v850: new Float64Array(n), slp: new Float64Array(n), temp: new Float64Array(n), q: new Float64Array(n), ascent: new Float64Array(n), rain: new Float64Array(n), layerT: new Float64Array(n) };
    for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
      // Chart row r counts from the north; model row j from the south.
      const j = ny - 1 - r, i = ((c + roll) % nx + nx) % nx, k = r * nx + c;
      const o = regional.outer(i * d, (j + 0.5) * d), f = model.fieldsAt(i, j);
      out.h500[k] = (5760 + f0 * (o.midPsi - ref) / GRAVITY) / 10;
      const w250 = regional.windAt(o, 250), w500 = regional.windAt(o, 500), w850 = regional.windAt(o, 850);
      out.u250[k] = w250.u; out.v250[k] = w250.v; out.u500[k] = w500.u; out.v500[k] = w500.v; out.u850[k] = w850.u; out.v850[k] = w850.v;
      out.slp[k] = 1013 + regional.balancedPressureHpa(o);
      out.temp[k] = (regional.airMassTheta(o, regional.params.terrainEastM) - 273.15) * 9 / 5 + 32;
      out.q[k] = regional.gulfAir(o);
      out.ascent[k] = o.ascentKh; out.rain[k] = f.rainGkgH; out.layerT[k] = o.layerK - 273.15;
    }
    const box = { x0: regional.origin.x / d - roll + 0.5, y0: ny - (regional.origin.y + regional.ny * regional.dx) / d, w: regional.nx * regional.dx / d, h: regional.ny * regional.dx / d };
    box.x0 = ((box.x0 % nx) + nx) % nx;
    out.box = box; out.cellKm = d / 1000;
    // Rough latitude/longitude: the region's middle at CENTRE.
    out.centreCol = box.x0 + box.w / 2; out.centreRow = box.y0 + box.h / 2;
    return out;
  }

  async function fullChart(F, change, hour) {
    const { nx, ny } = F, W = 760, H = Math.round(W * ny / nx), pad = 34, gap = 16, sx = W / nx, sy = H / ny;
    const panels = [
      { title: '500 mb height (dam, black) and 250 mb wind (kt, shaded); 500 mb barbs', shade: speed(F.u250, F.v250), scale: JET, contours: [{ v: F.h500, levels: range(480, 620, 6), color: '#111', width: 1.4, label: v => v.toFixed(0) }], barbs: { u: F.u500, v: F.v500, every: 6 } },
      { title: 'Large-scale MSLP (hPa, black), low-level air temperature (F, shaded), surface barbs', shade: F.temp, scale: TEMP, contours: [{ v: F.slp, levels: range(960, 1060, 4), color: '#111', width: 1.2, label: v => v.toFixed(0) }], barbs: { u: F.u850.map((v, k) => 0.7 * v), v: F.v850.map((v, k) => 0.7 * v), every: 6 }, extrema: F.slp },
      { title: '850 mb wind (kt, isotachs red, barbs) and low-level moisture (g/kg, shaded)', shade: F.q, scale: MOIST, contours: [{ v: speed(F.u850, F.v850), levels: [30, 40, 50, 60], color: '#c00', width: 1.2, label: v => v.toFixed(0) }], barbs: { u: F.u850, v: F.v850, every: 6 } },
      { title: 'Large-scale ascent (K/h, red up, blue down), rain (green), 500 mb 12-h height change (dam, dashed)', shade: F.ascent, scale: ASCENT, contours: [{ v: F.rain, levels: [0.05, 0.15, 0.3], color: '#080', width: 1.6, label: () => '' }, ...(change ? [{ v: change, levels: [-12, -9, -6, -3, 3, 6, 9, 12], color: '#333', width: 1, dash: '4 3', label: v => (v > 0 ? '+' : '') + v.toFixed(0) }] : [])] }
    ];
    const totalW = 2 * W + 3 * pad, totalH = 2 * H + 2 * pad + 2 * gap + 60;
    let body = `<rect width="${totalW}" height="${totalH}" fill="#fff"/><text x="${pad}" y="30" font-size="20" font-weight="bold">Seed ${seed} - large-scale model, whole domain - ${stamp(hour)}  (region boxed; domain ${Math.round(nx * F.cellKm)} x ${Math.round(ny * F.cellKm)} km, wraps east-west)</text>`;
    for (let p = 0; p < 4; p++) {
      const ox = pad + (p % 2) * (W + pad), oy = 60 + Math.floor(p / 2) * (H + pad + gap), panel = panels[p];
      body += `<g transform="translate(${ox},${oy})">`;
      body += `<text x="0" y="-6" font-size="13">${esc(panel.title)}</text>`;
      body += await raster(panel.shade, nx, ny, panel.scale, W, H);
      body += latLon(F, sx, sy, W, H);
      for (const c of panel.contours) body += contours(c.v, nx, ny, c.levels, sx, sy, c);
      if (panel.extrema) body += extrema(panel.extrema, nx, ny, sx, sy);
      if (panel.barbs) for (let r = 3; r < ny; r += panel.barbs.every) for (let c = 3; c < nx; c += panel.barbs.every) { const k = r * nx + c; body += barb((c + 0.5) * sx, (r + 0.5) * sy, panel.barbs.u[k], panel.barbs.v[k], 15); }
      body += `<rect x="${F.box.x0 * sx}" y="${F.box.y0 * sy}" width="${F.box.w * sx}" height="${F.box.h * sy}" fill="none" stroke="#f0f" stroke-width="2.5"/>`;
      body += `<rect width="${W}" height="${H}" fill="none" stroke="#000"/>` + legend(panel.scale, W - 250, H + 4, 250);
      body += '</g>';
    }
    return svgDoc(totalW, totalH, body);
  }

  // --- The region: mesoanalysis panels.
  async function regionChart(hour) {
    const nx = world.width, ny = world.height, W = 420, H = 420, sx = W / nx, sy = H / ny, pad = 30;
    const field = read => { const out = new Float64Array(nx * ny); world.forEachCell((cell, x, y) => { out[y * nx + x] = Number(read(cell)) || 0; }); return out; };
    const wind = (get) => { const u = new Float64Array(nx * ny), v = new Float64Array(nx * ny); world.forEachCell((cell, x, y) => { const w = get(cell), d = w.direction * Math.PI / 180; u[y * nx + x] = -Math.sin(d) * w.speed / KT; v[y * nx + x] = -Math.cos(d) * w.speed / KT; }); return { u, v }; };
    const sfc = wind(c => c.surface.wind), w850 = wind(c => ({ speed: c.levels[850].windSpeed, direction: c.levels[850].windDirection })), w500 = wind(c => ({ speed: c.levels[500].windSpeed, direction: c.levels[500].windDirection }));
    const panels = [
      { title: 'MSLP (hPa), temperature (F), surface wind, lines', shade: field(P.temperature.read), scale: TEMP, contours: [{ v: field(c => c.surface.seaLevelPressure ?? c.surface.pressure), levels: range(960, 1050, 2), color: '#111', width: 1.1, label: v => v.toFixed(0) }], barbs: { ...sfc, every: 5 }, lines: true },
      { title: 'Dewpoint (F), 850 mb wind', shade: field(P.dewpoint.read), scale: DEW, contours: [{ v: field(P.dewpoint.read), levels: [50, 55, 60, 65, 70], color: '#063', width: 1, label: v => v.toFixed(0) }], barbs: { ...w850, every: 5 }, lines: true },
      { title: 'MLCAPE (J/kg), MLCIN 25/100 (dashed), 700 mb temp (C, red)', shade: field(P.mlcape.read), scale: CAPE, contours: [{ v: field(P.mlcin.read), levels: [25, 100], color: '#00a', width: 1.2, dash: '4 3', label: v => v.toFixed(0) }, { v: field(P.cap.read), levels: [8, 10, 12, 14, 16], color: '#c00', width: 1, label: v => v.toFixed(0) }] },
      { title: '0-6 km shear (kt), 500 mb height (dam) and wind', shade: field(P.shear06.read), scale: SHEAR, contours: [{ v: field(c => c.levels[500].heightDm), levels: range(510, 600, 3), color: '#111', width: 1.1, label: v => v.toFixed(0) }], barbs: { ...w500, every: 5 } },
      { title: '0-1 km helicity (m2/s2), LCL 1000/1500 m (dashed)', shade: field(P.srh01.read), scale: SRH, contours: [{ v: field(P.lcl.read), levels: [1000, 1500], color: '#630', width: 1.2, dash: '4 3', label: v => v.toFixed(0) }] },
      { title: 'STP, storms now (red rotating, blue line, grey cell), tornadoes (black)', shade: field(P.stp.read), scale: STP, contours: [], lines: true, storms: true }
    ];
    const totalW = 3 * W + 4 * pad, totalH = 2 * H + 3 * pad + 70;
    const linesNow = boundaryLines(sx / world.cellSizeKm), stormsNow = stormMarks(sx / world.cellSizeKm);
    let body = `<rect width="${totalW}" height="${totalH}" fill="#fff"/><text x="${pad}" y="28" font-size="19" font-weight="bold">Seed ${seed} - the region (${Math.round(nx * world.cellSizeKm * 0.621)} mi square, north up) - ${stamp(hour)}</text>`;
    body += `<text x="${pad}" y="50" font-size="13">Ground rises from ${Math.round(regional.terrainAt(nx - 1))} m (east) to ${Math.round(regional.terrainAt(0))} m (west). Lines: cold blue, warm red, stationary purple, dryline brown dashed, outflow black dashed.</text>`;
    for (let p = 0; p < 6; p++) {
      const ox = pad + (p % 3) * (W + pad), oy = 80 + Math.floor(p / 3) * (H + pad + 14), panel = panels[p];
      body += `<g transform="translate(${ox},${oy})"><text x="0" y="-6" font-size="12.5">${esc(panel.title)}</text>`;
      body += await raster(panel.shade, nx, ny, panel.scale, W, H);
      for (const c of panel.contours) body += contours(c.v, nx, ny, c.levels, sx, sy, c);
      if (panel.lines) body += linesNow;
      if (panel.barbs) for (let y = 2; y < ny; y += panel.barbs.every) for (let x = 2; x < nx; x += panel.barbs.every) { const k = y * nx + x; body += barb((x + 0.5) * sx, (y + 0.5) * sy, panel.barbs.u[k], panel.barbs.v[k], 16); }
      if (panel.storms) body += stormsNow;
      body += `<rect width="${W}" height="${H}" fill="none" stroke="#000"/>` + legend(panel.scale, W - 240, H + 4, 240) + '</g>';
    }
    return svgDoc(totalW, totalH, body);
  }

  function boundaryLines(k) {
    const colour = { cold: '#1040ff', warm: '#e01010', stationary: '#902090', dryline: '#8b5a2b', outflow: '#000' };
    return (engine.boundaries ?? []).map(line => `<polyline points="${line.pointsKm.map(p => `${(p.x * k).toFixed(1)},${(p.y * k).toFixed(1)}`).join(' ')}" fill="none" stroke="${colour[line.type] ?? '#444'}" stroke-width="3" ${line.type === 'dryline' || line.type === 'outflow' ? 'stroke-dasharray="6 4"' : ''}/>`).join('');
  }
  function stormMarks(k) {
    let s = '';
    for (const storm of world.storms) {
      if (!storm.active || storm.intensity < 0.2) continue;
      const x = storm.positionKm.x * k, y = storm.positionKm.y * k, c = rotatingShare(storm) >= 0.5 ? '#d00' : lineShare(storm) >= 0.5 ? '#04c' : '#777';
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(3 + 7 * storm.intensity).toFixed(1)}" fill="${c}" fill-opacity="0.55" stroke="${c}"/>`;
      if (storm.tornado?.onGround) s += `<path d="M${x - 7},${y - 6} L${x + 7},${y - 6} L${x},${y + 8} Z" fill="#000"/>`;
    }
    return s;
  }

  // --- Numbers.
  function regionStats(hour) {
    const vals = { mlcape: [], srh01: [], shear06: [], stp: [], dew: [], cin: [] };
    let minP = Infinity;
    world.forEachCell(cell => {
      const s = cell.derived?.sounding ?? {};
      vals.mlcape.push(s.mlcape ?? 0); vals.srh01.push(s.srh01 ?? 0); vals.shear06.push(s.shear06 ?? 0); vals.stp.push(cell.derived?.stp ?? 0); vals.dew.push(cell.surface.dewpoint); vals.cin.push(Math.abs(s.mlcin ?? 0));
      minP = Math.min(minP, cell.surface.seaLevelPressure ?? cell.surface.pressure);
    });
    const c = world.cells[Math.floor(world.height / 2)][Math.floor(world.width / 2)];
    const active = world.storms.filter(s => s.active && s.intensity >= 0.3);
    const modes = {}; for (const s of active) { const m = describeStormMode(s); modes[m] = (modes[m] ?? 0) + 1; }
    return {
      hour, label: stamp(hour), mlcapeP90: pct(vals.mlcape, 0.9), mlcapeMax: Math.max(...vals.mlcape), srh01P90: pct(vals.srh01, 0.9), shear06P90: pct(vals.shear06, 0.9), stpMax: Math.max(...vals.stp),
      stpArea: Math.round(100 * vals.stp.filter(v => v >= 1).length / vals.stp.length), dew60Area: Math.round(100 * vals.dew.filter(v => v >= 60).length / vals.dew.length), minSlp: minP,
      mid500: `${Math.round(c.levels[500].windDirection)}/${Math.round(c.levels[500].windSpeed)} kt, ${c.levels[500].heightDm.toFixed(0)} dam, ${(c.levels[500].heightTendencyDm12h ?? 0).toFixed(1)} dam/12h`,
      mid850: `${Math.round(c.levels[850].windDirection)}/${Math.round(c.levels[850].windSpeed)} kt`,
      storms: active.length, tornadoesNow: world.storms.filter(s => s.tornado?.onGround).length, modes,
      lines: (engine.boundaries ?? []).reduce((o, l) => ({ ...o, [l.type]: (o[l.type] ?? 0) + 1 }), {}),
      regionKm: { x: Math.round(regional.origin.x / 1000), y: Math.round(regional.origin.y / 1000), slideMs: regional.slideMs, northMs: regional.slideNorthMs }
    };
  }

  // Soundings at the place with the highest STP and the highest MLCAPE.
  function soundings(hour) {
    let best = null, bestCape = null;
    world.forEachCell((cell, x, y) => {
      const stp = cell.derived?.stp ?? 0, cape = cell.derived?.sounding?.mlcape ?? 0;
      // (Where STP is nil everywhere, the supercell composite instead.)
      const score = stp + 0.01 * (cell.derived?.scp ?? 0);
      if (!best || score > best.v) best = { v: score, cell, x, y };
      if (!bestCape || cape > bestCape.v) bestCape = { v: cape, cell, x, y };
    });
    const describe = (what, b) => {
      const c = b.cell, s = c.derived.sounding ?? {}, lv = p => { const l = c.levels[p]; return `${p} mb ${l.temperature.toFixed(1)}${Number.isFinite(l.dewpoint) ? `/${l.dewpoint.toFixed(1)}` : ''} C ${Math.round(l.windDirection)}/${Math.round(l.windSpeed)} kt`; };
      return {
        what, hour: stamp(hour), where: `cell ${b.x},${b.y} (${Math.round(b.x * world.cellSizeKm * 0.621)} mi from W edge, ${Math.round(b.y * world.cellSizeKm * 0.621)} mi from N edge), ground ${Math.round(c.terrain.elevationM)} m`,
        surface: `${c.surface.temperature.toFixed(0)}/${c.surface.dewpoint.toFixed(0)} F, wind ${Math.round(c.surface.wind.direction)}/${Math.round(c.surface.wind.speed)} kt, MSLP ${(c.surface.seaLevelPressure ?? c.surface.pressure).toFixed(1)}`,
        levels: [850, 700, 500, 250].map(lv).join('; '),
        params: `MLCAPE ${r0(s.mlcape)}, SBCAPE ${r0(s.sbcape)}, MUCAPE ${r0(s.mucape)}, MLCIN ${r0(s.mlcin)}, LCL ${r0(c.derived.lclAgl)} m, 700-500 lapse ${(s.lapseRate700500 ?? 0).toFixed(1)} C/km, 0-3 km lapse ${(s.lapseRate03km ?? 0).toFixed(1)}, 0-1 shear ${r0(s.shear01)} kt, 0-6 shear ${r0(s.shear06)} kt, SRH01 ${r0(s.srh01)}, SRH03 ${r0(s.srh03)}, STP ${(c.derived.stp ?? 0).toFixed(1)}, SCP ${(c.derived.scp ?? 0).toFixed(1)}`
      };
    };
    return [describe('highest STP', best), describe('highest MLCAPE', bestCape)];
  }

  function writeDay(D, dir) {
    const log = world.reportLog?.days?.[D.day] ?? { reports: [], tornadoes: [] };
    const end = D.startHour + 24, k = places.milesPerKm;
    const efOf = mph => (mph < 65 ? 'EF0-' : mph <= 85 ? 'EF0' : mph <= 110 ? 'EF1' : mph <= 135 ? 'EF2' : mph <= 165 ? 'EF3' : mph <= 200 ? 'EF4' : 'EF5');
    const tornadoes = log.tornadoes.filter(t => t.points.length).map(t => {
      const peak = Math.max(...t.points.map(p => p[3])), len = t.points.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - t.points[i][0], p[1] - t.points[i][1]), 0) * k;
      return { id: t.id, start: stamp(t.points[0][2]), minutes: Math.round((t.points.at(-1)[2] - t.points[0][2]) * 60), ef: efOf(peak), peak, miles: len.toFixed(1), widthYd: Math.max(...t.points.map(p => p[4])), x: t.points[0][0], y: t.points[0][1] };
    });
    const dayTracks = [...tracks.entries()].filter(([, t]) => t.points.some(p => p[2] > D.startHour && p[2] <= end));
    const modeTime = {}; for (const [, t] of dayTracks) for (const [m, n] of Object.entries(t.modes)) modeTime[m] = (modeTime[m] ?? 0) + n;
    const totalModeTime = Object.values(modeTime).reduce((a, b) => a + b, 0) || 1;
    const counts = { tornado: log.reports.filter(r => r.type === 'tornado').length, hail: log.reports.filter(r => r.type === 'hail').length, wind: log.reports.filter(r => r.type === 'wind').length };
    const bigHail = Math.max(0, ...log.reports.filter(r => r.type === 'hail').map(r => (r.size ?? 0) / 100));
    const hourlyRows = D.hourly.filter(h => h.hour >= D.startHour - 1e-6 && h.hour <= end + 1e-6).map(h => `| ${h.label} | ${r0(h.mlcapeP90)} / ${r0(h.mlcapeMax)} | ${r0(h.shear06P90)} | ${r0(h.srh01P90)} | ${h.stpMax.toFixed(1)} (${h.stpArea}%) | ${h.dew60Area}% | ${h.minSlp.toFixed(0)} | ${h.mid500} | ${h.mid850} | ${h.storms} / ${h.tornadoesNow} | ${Object.entries(h.lines).map(([t, n]) => `${t} ${n}`).join(', ') || '-'} |`);
    const last = D.hourly.at(-1)?.regionKm;
    const md = [
      `# Seed ${seed}, day ${D.day}: ${stamp(D.startHour)} to ${stamp(end)}`,
      '',
      `Region steering plan for this day: ${D.steering ? JSON.stringify(D.steering) : 'none'}. (The 500-mile region is slid east-west, and sometimes north-south, along the large-scale model once a day at 06Z so that the afternoon and evening get the large-scale support picked for the day; kinds: warmSector, nearLow = a surface low near the NW corner, upperLow = under an upper trough or low.)`,
      last ? `Region's south-west corner in the large-scale channel at the end of the day: x ${last.x} km, y ${last.y} km (channel ${Math.round(model.lengthX / 1000)} x ${Math.round(model.lengthY / 1000)} km); slide ${last.slideMs} m/s east, ${last.northMs} m/s north.` : '',
      '',
      '## Region, every 3 hours',
      '',
      '| Time | MLCAPE p90 / max | 0-6 shear p90 kt | SRH01 p90 | STP max (area >=1) | Td>=60F area | min MSLP | 500 mb mid-map | 850 mb mid-map | storms / tornadoes now | analysed lines |',
      '|---|---|---|---|---|---|---|---|---|---|---|',
      ...hourlyRows,
      '',
      '## Soundings (21Z and 00Z)',
      '',
      ...D.soundings.flatMap(s => [`- **${s.hour}, ${s.what}** at ${s.where}`, `  - surface ${s.surface}`, `  - ${s.levels}`, `  - ${s.params}`]),
      '',
      '## What happened',
      '',
      `- Storms (intensity >= 0.3): ${dayTracks.length}. Share of storm time by type: ${Object.entries(modeTime).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} ${Math.round(100 * n / totalModeTime)}%`).join(', ') || 'none'}.`,
      `- Reports (only where someone saw them): ${counts.tornado} tornado, ${counts.hail} hail (largest ${bigHail.toFixed(2)} in), ${counts.wind} wind.`,
      `- Tornadoes (all, seen or not): ${tornadoes.length}${tornadoes.length ? '' : '.'}`,
      ...tornadoes.map(t => `  - ${t.start}, ${t.ef} (peak ${t.peak} mph), ${t.minutes} min, ${t.miles} mi, ${t.widthYd} yd wide, began ${Math.round(t.x * k)} mi E / ${Math.round(t.y * k)} mi S of the NW corner`),
      '',
      'Charts: full-12Z/18Z/00Z/06Z.png (the whole large-scale model), region-18Z/21Z/00Z/03Z.png (mesoanalysis), storms.png (the day\'s storm tracks, tornado tracks and reports).'
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'day.md'), md);
    fs.writeFileSync(path.join(dir, 'day.json'), JSON.stringify({ seed, day: D.day, steering: D.steering, hourly: D.hourly, soundings: D.soundings, tornadoes, reports: counts, bigHail, modeTime }, null, 1));
    svgs.push({ file: path.join(dir, 'storms'), svg: stormMap(D, dayTracks, log, tornadoes) });
  }

  function stormMap(D, dayTracks, log, tornadoes) {
    const W = 760, H = 760, k = W / (world.width * world.cellSizeKm), end = D.startHour + 24;
    let body = `<rect width="${W + 60}" height="${H + 110}" fill="#fff"/><text x="30" y="26" font-size="16" font-weight="bold">Seed ${seed}, day ${D.day} - storms, ${stamp(D.startHour)} to ${stamp(end)}</text>`;
    body += `<text x="30" y="46" font-size="12.5">Storm tracks: red rotating, blue line, grey ordinary cell (thicker = stronger).</text><text x="30" y="62" font-size="12.5">Tornado tracks: orange EF0-1, magenta EF2-3, black EF4+. Report dots: tornado red, hail green, wind blue.</text>`;
    body += `<g transform="translate(30,70)"><rect width="${W}" height="${H}" fill="#f7f7f2" stroke="#000"/>`;
    for (const [, t] of dayTracks) {
      const pts = t.points.filter(p => p[2] > D.startHour && p[2] <= end);
      for (let i = 1; i < pts.length; i++) {
        const c = pts[i][3] === 'rot' ? '#d00' : pts[i][3] === 'line' ? '#04c' : '#999';
        body += `<line x1="${(pts[i - 1][0] * k).toFixed(1)}" y1="${(pts[i - 1][1] * k).toFixed(1)}" x2="${(pts[i][0] * k).toFixed(1)}" y2="${(pts[i][1] * k).toFixed(1)}" stroke="${c}" stroke-width="${(1 + 2 * t.maxIntensity).toFixed(1)}" stroke-opacity="0.6"/>`;
      }
    }
    for (const t of log.tornadoes) {
      if (!t.points.length) continue;
      const peak = Math.max(...t.points.map(p => p[3])), c = peak > 165 ? '#000' : peak > 110 ? '#c0c' : '#f80';
      body += `<polyline points="${t.points.map(p => `${(p[0] * k).toFixed(1)},${(p[1] * k).toFixed(1)}`).join(' ')}" fill="none" stroke="${c}" stroke-width="4"/>`;
    }
    for (const r of log.reports) {
      const x = r.x / places.milesPerKm, y = r.y / places.milesPerKm; if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      body += `<circle cx="${(x * k).toFixed(1)}" cy="${(y * k).toFixed(1)}" r="3.5" fill="${r.type === 'tornado' ? '#e00' : r.type === 'hail' ? '#0a0' : '#06f'}" stroke="#000" stroke-width="0.5"/>`;
    }
    body += '</g>';
    body += `<text x="30" y="${H + 95}" font-size="13">${tornadoes.length} tornadoes; ${log.reports.length} reports. Map ${Math.round(world.width * world.cellSizeKm * 0.621)} mi square, north up.</text>`;
    return svgDoc(W + 60, H + 110, body);
  }

  // The outlook as the Storm Prediction Center draws it: the categories, then each hazard's
  // contour levels with the intensity groups hatched over them (CIG1 dashed, CIG2 solid, CIG3 crossed).
  function outlookChart(outlook, d, now) {
    const nx = outlook.width, ny = outlook.height, W = 380, H = 380, sx = W / nx, sy = H / ny, pad = 26;
    const CAT = { TSTM: '#c1e9c1', MRGN: '#66a366', SLGT: '#f6f67f', ENH: '#e6c27f', MDT: '#e67f7f', HIGH: '#ff66ff' };
    const TOR = { 2: '#008b00', 5: '#8b4726', 10: '#ffc800', 15: '#ff0000', 30: '#ff00ff', 45: '#912cee', 60: '#104e8b' };
    const SEV = { 5: '#8b4726', 15: '#ffc800', 30: '#ff0000', 45: '#ff00ff', 60: '#912cee', 75: '#104e8b', 90: '#4b0082' };
    const cell = (i, fill) => `<rect x="${(i % nx) * sx}" y="${Math.floor(i / nx) * sy}" width="${sx + 0.4}" height="${sy + 0.4}" fill="${fill}"/>`;
    const panels = [
      { title: `Categorical (highest ${outlook.highest})`, draw: () => outlook.category.map((c, i) => (CAT[c] ? cell(i, CAT[c]) : '')).join('') },
      ...['tornado', 'hail', 'wind'].map(h => ({ title: `${h[0].toUpperCase() + h.slice(1)} (contours %, hatched groups)`, draw: () => {
        const colours = h === 'tornado' ? TOR : SEV;
        return Array.from(outlook.level[h], (lv, i) => (lv > 0 && colours[lv] ? cell(i, colours[lv]) : '')).join('') + Array.from(outlook.cig[h], (g, i) => (g > 0 ? cell(i, `url(#cig${g})`) : '')).join('');
      } }))
    ];
    const defs = '<defs><pattern id="cig1" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 8L8 0" stroke="#000" stroke-width="1" stroke-dasharray="2 2"/></pattern><pattern id="cig2" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 0L8 8" stroke="#000" stroke-width="1.2"/></pattern><pattern id="cig3" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 0L8 8M0 8L8 0" stroke="#000" stroke-width="1.2"/></pattern></defs>';
    const legendRow = (o, y) => Object.entries(o).map(([k, c], j) => `<rect x="${j * 46}" y="${y}" width="14" height="10" fill="${c}"/><text x="${j * 46 + 17}" y="${y + 9}" font-size="10">${k}</text>`).join('');
    let body = `${defs}<rect width="${2 * W + 3 * pad}" height="${2 * H + 3 * pad + 90}" fill="#fff"/><text x="${pad}" y="24" font-size="17" font-weight="bold">Seed ${seed}, day ${d} - Day 1 outlook issued ${stamp(now)} (${outlook.members} runs)</text>`;
    panels.forEach((p, k) => {
      const ox = pad + (k % 2) * (W + pad), oy = 50 + Math.floor(k / 2) * (H + pad + 14);
      body += `<g transform="translate(${ox},${oy})"><text x="0" y="-6" font-size="12.5">${esc(p.title)}</text><rect width="${W}" height="${H}" fill="#f7f7f2"/>${p.draw()}<rect width="${W}" height="${H}" fill="none" stroke="#000"/></g>`;
    });
    const ly = 50 + 2 * (H + pad + 14) - 4;
    body += `<g transform="translate(${pad},${ly})">${legendRow(CAT, 0)}<text x="300" y="9" font-size="10">CIG1 dashed / CIG2 solid / CIG3 crossed hatching</text>${legendRow(TOR, 16)}<text x="330" y="25" font-size="10">tornado %</text>${legendRow(SEV, 32)}<text x="330" y="41" font-size="10">hail / wind %</text></g>`;
    return svgDoc(2 * W + 3 * pad, 2 * H + 3 * pad + 90, body);
  }

  // --- Drawing helpers.
  async function raster(values, nx, ny, scale, W, H) {
    const rgba = new Uint8Array(nx * ny * 4);
    for (let k = 0; k < nx * ny; k++) { const [r, g, b, a] = colourAt(scale, values[k]); rgba.set([r, g, b, a], k * 4); }
    const png = await encodeRgbaPng(nx, ny, rgba);
    return `<image href="data:image/png;base64,${png.toString('base64')}" width="${W}" height="${H}" preserveAspectRatio="none"/>`;
  }
}

// ---------------------------------------------------------------------------------------------
// Colour scales: [value, r, g, b, alpha 0-255].
const JET = [[30, 255, 255, 255, 255], [50, 200, 225, 255, 255], [70, 120, 170, 245, 255], [90, 60, 110, 220, 255], [110, 150, 80, 200, 255], [130, 220, 60, 160, 255], [160, 255, 120, 120, 255]];
const TEMP = [[0, 120, 80, 200, 255], [30, 120, 160, 230, 255], [45, 170, 210, 240, 255], [60, 200, 235, 190, 255], [70, 240, 235, 150, 255], [80, 250, 190, 110, 255], [90, 240, 120, 80, 255], [105, 190, 50, 60, 255]];
const MOIST = [[4, 200, 170, 120, 255], [8, 235, 225, 190, 255], [11, 200, 235, 200, 255], [13, 120, 210, 140, 255], [15, 40, 160, 100, 255], [17, 20, 110, 140, 255]];
const ASCENT = [[-0.3, 60, 90, 220, 255], [-0.1, 170, 195, 245, 255], [-0.02, 255, 255, 255, 255], [0.02, 255, 255, 255, 255], [0.1, 250, 190, 160, 255], [0.3, 220, 60, 50, 255]];
const DEW = [[30, 170, 140, 100, 255], [45, 220, 205, 170, 255], [55, 200, 235, 200, 255], [60, 120, 210, 140, 255], [65, 40, 165, 100, 255], [70, 20, 120, 150, 255], [75, 60, 60, 170, 255]];
const CAPE = [[0, 255, 255, 255, 255], [250, 255, 245, 200, 255], [1000, 255, 210, 120, 255], [2000, 250, 150, 60, 255], [3000, 230, 70, 50, 255], [4500, 180, 40, 160, 255]];
const SHEAR = [[0, 255, 255, 255, 255], [20, 235, 240, 255, 255], [30, 180, 210, 250, 255], [40, 110, 160, 240, 255], [50, 70, 100, 220, 255], [65, 130, 60, 200, 255]];
const SRH = [[0, 255, 255, 255, 255], [50, 230, 245, 230, 255], [100, 170, 225, 170, 255], [200, 70, 180, 110, 255], [300, 20, 130, 120, 255], [450, 20, 80, 140, 255]];
const STP = [[0, 255, 255, 255, 255], [0.5, 255, 240, 200, 255], [1, 255, 200, 120, 255], [3, 240, 110, 60, 255], [6, 200, 40, 90, 255], [10, 150, 30, 170, 255]];
const UNITS = new Map([[JET, '250 mb kt'], [TEMP, 'F'], [MOIST, 'g/kg'], [ASCENT, 'K/h'], [DEW, 'F'], [CAPE, 'J/kg'], [SHEAR, 'kt'], [SRH, 'm2/s2'], [STP, 'STP']]);

function colourAt(scale, v) {
  if (!(v > scale[0][0])) return scale[0].slice(1);
  for (let i = 1; i < scale.length; i++) if (v <= scale[i][0]) { const a = scale[i - 1], b = scale[i], t = (v - a[0]) / (b[0] - a[0]); return [1, 2, 3, 4].map(j => Math.round(a[j] + (b[j] - a[j]) * t)); }
  return scale.at(-1).slice(1);
}
function legend(scale, x, y, w) {
  const n = scale.length, step = w / (n - 1);
  let s = `<g transform="translate(${x},${y})"><defs><linearGradient id="g${legendId}"> ${scale.map((c, i) => `<stop offset="${i / (n - 1)}" stop-color="rgb(${c[1]},${c[2]},${c[3]})"/>`).join('')}</linearGradient></defs><rect width="${w}" height="8" fill="url(#g${legendId})" stroke="#555" stroke-width="0.5"/>`;
  legendId++;
  scale.forEach((c, i) => { s += `<text x="${i * step}" y="19" font-size="10" text-anchor="middle">${c[0]}</text>`; });
  return s + `<text x="-4" y="8" font-size="10" text-anchor="end">${UNITS.get(scale) ?? ''}</text></g>`;
}
let legendId = 0;

// Contour lines by marching squares through the cell centres, labelled here and there.
function contours(values, nx, ny, levels, sx, sy, { color = '#000', width = 1, dash = null, label = v => String(v) } = {}) {
  let paths = '', labels = '';
  const placed = [];
  for (const level of levels) {
    const segs = [];
    for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
      const a = values[y * nx + x], b = values[y * nx + x + 1], c = values[(y + 1) * nx + x + 1], d = values[(y + 1) * nx + x];
      const code = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const t = (p, q) => (level - p) / (q - p || 1e-9);
      const top = [x + t(a, b), y], right = [x + 1, y + t(b, c)], bottom = [x + t(d, c), y + 1], left = [x, y + t(a, d)];
      const table = { 1: [[left, bottom]], 2: [[bottom, right]], 3: [[left, right]], 4: [[top, right]], 5: [[left, top], [bottom, right]], 6: [[top, bottom]], 7: [[left, top]], 8: [[left, top]], 9: [[top, bottom]], 10: [[top, right], [left, bottom]], 11: [[top, right]], 12: [[left, right]], 13: [[bottom, right]], 14: [[left, bottom]] };
      for (const [p, q] of table[code]) segs.push([p, q]);
    }
    if (!segs.length) continue;
    const X = p => ((p[0] + 0.5) * sx).toFixed(1), Y = p => ((p[1] + 0.5) * sy).toFixed(1);
    paths += `<path d="${segs.map(([p, q]) => `M${X(p)} ${Y(p)}L${X(q)} ${Y(q)}`).join('')}" stroke="${color}" stroke-width="${width}" fill="none" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
    const text = label(level);
    if (!text) continue;
    let count = 0;
    for (let i = 0; i < segs.length && count < 3; i += 7) {
      const [p, q] = segs[i], lx = ((p[0] + q[0]) / 2 + 0.5) * sx, ly = ((p[1] + q[1]) / 2 + 0.5) * sy;
      if (placed.some(([px, py]) => Math.hypot(px - lx, py - ly) < 90)) continue;
      placed.push([lx, ly]); count++;
      labels += `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" font-size="11" text-anchor="middle" fill="${color}" stroke="#fff" stroke-width="3" paint-order="stroke">${text}</text>`;
    }
  }
  return paths + labels;
}

// Lows and highs: points lowest (or highest) within 6 cells and at least 3 hPa from the
// average 6 cells out.
function extrema(values, nx, ny, sx, sy) {
  let s = '';
  const R = 6;
  for (let y = R; y < ny - R; y++) for (let x = 0; x < nx; x++) {
    const v = values[y * nx + x];
    let lowest = true, highest = true, ring = 0, ringN = 0;
    for (let dy = -R; dy <= R && (lowest || highest); dy++) for (let dx = -R; dx <= R; dx++) {
      if (!dx && !dy) continue;
      const w = values[(y + dy) * nx + ((x + dx) % nx + nx) % nx];
      if (w < v) lowest = false; if (w > v) highest = false;
      if (Math.max(Math.abs(dx), Math.abs(dy)) === R) { ring += w; ringN++; }
    }
    if (!ringN) continue;
    const contrast = v - ring / ringN;
    if (lowest && contrast <= -3) s += `<text x="${(x + 0.5) * sx}" y="${(y + 0.5) * sy + 8}" font-size="22" font-weight="bold" fill="#d00" text-anchor="middle" stroke="#fff" stroke-width="3" paint-order="stroke">L</text><text x="${(x + 0.5) * sx}" y="${(y + 0.5) * sy + 22}" font-size="11" fill="#d00" text-anchor="middle">${v.toFixed(0)}</text>`;
    if (highest && contrast >= 3) s += `<text x="${(x + 0.5) * sx}" y="${(y + 0.5) * sy + 8}" font-size="22" font-weight="bold" fill="#00c" text-anchor="middle" stroke="#fff" stroke-width="3" paint-order="stroke">H</text><text x="${(x + 0.5) * sx}" y="${(y + 0.5) * sy + 22}" font-size="11" fill="#00c" text-anchor="middle">${v.toFixed(0)}</text>`;
  }
  return s;
}

// Rough latitude and longitude lines (every 10 degrees) about the region's middle.
function latLon(F, sx, sy, W, H) {
  let s = '';
  const kmPerLat = 111, kmPerLon = 111 * Math.cos(CENTRE.lat * Math.PI / 180);
  for (let lat = -10; lat <= 90; lat += 10) {
    const row = F.centreRow - (lat - CENTRE.lat) * kmPerLat / F.cellKm;
    if (row < 0 || row > F.ny) continue;
    s += `<line x1="0" x2="${W}" y1="${row * sy}" y2="${row * sy}" stroke="#888" stroke-dasharray="2 4" stroke-width="0.7"/><text x="3" y="${row * sy - 2}" font-size="10" fill="#666">~${lat}N</text>`;
  }
  for (let lon = -180; lon <= 0; lon += 10) {
    const col = F.centreCol + (lon - CENTRE.lon) * kmPerLon / F.cellKm;
    if (col < 0 || col > F.nx) continue;
    s += `<line y1="0" y2="${H}" x1="${col * sx}" x2="${col * sx}" stroke="#888" stroke-dasharray="2 4" stroke-width="0.7"/><text x="${col * sx + 2}" y="${H - 3}" font-size="10" fill="#666">~${-lon}W</text>`;
  }
  return s;
}

// A wind barb at (x, y) for a wind of u, v (m/s, toward east and north).
function barb(x, y, u, v, len) {
  const kt = Math.hypot(u, v) * KT;
  if (kt < 2.5) return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="none" stroke="#000" stroke-width="0.8"/>`;
  const ux = -u / Math.hypot(u, v), uy = v / Math.hypot(u, v);   // toward where the wind comes from (screen y down)
  const fx = -uy, fy = ux;                                          // the side the feathers go
  const ex = x + ux * len, ey = y + uy * len;
  let s = `M${x.toFixed(1)} ${y.toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}`, rest = Math.round(kt / 5) * 5, at = 0;
  const fl = len * 0.45, sp = len * 0.17;
  while (rest >= 50) { const bx = ex - ux * at, by = ey - uy * at; s += `M${bx.toFixed(1)} ${by.toFixed(1)}L${(bx + fx * fl).toFixed(1)} ${(by + fy * fl).toFixed(1)}L${(bx - ux * sp).toFixed(1)} ${(by - uy * sp).toFixed(1)}Z`; at += sp * 1.3; rest -= 50; }
  while (rest >= 10) { const bx = ex - ux * at, by = ey - uy * at; s += `M${bx.toFixed(1)} ${by.toFixed(1)}L${(bx + fx * fl + ux * sp * 0.6).toFixed(1)} ${(by + fy * fl + uy * sp * 0.6).toFixed(1)}`; at += sp; rest -= 10; }
  if (rest >= 5) { if (at === 0) at = sp; const bx = ex - ux * at, by = ey - uy * at; s += `M${bx.toFixed(1)} ${by.toFixed(1)}L${(bx + fx * fl * 0.5 + ux * sp * 0.3).toFixed(1)} ${(by + fy * fl * 0.5 + uy * sp * 0.3).toFixed(1)}`; }
  return `<path d="${s}" stroke="#000" stroke-width="1" fill="#000"/>`;
}

function svgDoc(w, h, body) { return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Arial, Helvetica, sans-serif">${body}</svg>`; }
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const range = (a, b, s) => { const out = []; for (let v = a; v <= b + 1e-9; v += s) out.push(v); return out; };
const speed = (u, v) => u.map((x, k) => Math.hypot(x, v[k]) * KT);
const pct = (a, q) => { const v = [...a].sort((x, y) => x - y); return v[Math.floor(q * (v.length - 1))]; };
const r0 = v => Math.round(Number(v) || 0);
const pad = h => String(h).padStart(2, '0');
// Valid time: UTC and the local (CDT) time the region keeps.
function stamp(hour) {
  const day = Math.floor((hour - 12) / 24) + 1, utc = ((hour % 24) + 24) % 24, local = ((utc - 5) % 24 + 24) % 24;
  const ampm = h => `${((Math.floor(h) + 11) % 12) + 1}${h % 1 ? ':30' : ''} ${h < 12 ? 'am' : 'pm'}`;
  // (00Z-12Z belongs to the convective day that began the morning before.)
  return `day ${day} ${pad(Math.floor(utc))}${utc % 1 ? '30' : '00'}Z (${ampm(local)} CDT${utc < 12 ? ', overnight' : ''})`;
}

// SVG to PNG with a headless browser, a few at a time.
export async function toPng(list, outDir) {
  const browser = process.env.CHROME ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
  if (!browser) { console.warn('[day review] no Chrome or Edge found: SVG only'); return; }
  const queue = [...list], profiles = path.join(outDir, '.chrome', String(process.pid));
  const one = (item, slot) => new Promise(resolve => {
    const size = /width="(\d+)" height="(\d+)"/.exec(item.svg), file = path.resolve(`${item.file}.svg`);
    execFile(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${path.join(profiles, String(slot))}`, `--window-size=${size[1]},${size[2]}`, `--screenshot=${path.resolve(`${item.file}.png`)}`, `file:///${file.replace(/\\/g, '/')}`], { timeout: 60000 }, () => { if (fs.existsSync(path.resolve(`${item.file}.png`))) fs.rmSync(file, { force: true }); resolve(); });
  });
  await Promise.all(Array.from({ length: 2 }, async (_, slot) => { while (queue.length) await one(queue.shift(), slot); }));
  try { fs.rmSync(profiles, { recursive: true, force: true }); } catch { /* a browser still closing; harmless */ }
}

export const README = `# Day packages for a meteorologist's review

Made by scripts/day-review-pack.mjs. One folder per seed and convective day (12Z to 12Z).
Times are UTC with the region's local time (CDT, UTC-5).

## How the engine is built (what the charts are of)

- **Large-scale model**: a two-layer quasi-geostrophic channel, 128 x 64 cells of 80 km
  (10,240 x 5,120 km). It wraps east-west and north-south and has no continents, oceans or
  mountains: troughs, ridges, jets, surface lows and fronts grow and decay on a westerly mean
  flow. 500 mb heights are its mid-level streamfunction; "MSLP" is its low-level pressure
  pattern (1013 + anomaly); low-level temperature is its near-ground air mass before daily
  heating; moisture is the low-level mixing ratio the region's Gulf-type air would have there.
  Ascent is the model's own over the last step, so it is blank on the very first chart of a
  run; the 12-hour height change needs a chart 12 hours earlier, so day 1's first two have none.
- **The region**: 50 x 50 cells of 10 miles (500 x 500 mi), magenta box on the large-scale
  charts. It reads the large-scale model where the box is and adds terrain (high in the west,
  a lee trough), a daily boundary layer, the dryline, Gulf moisture from the south, the
  nocturnal low-level jet, fronts sharpened by the flow, and storms with their cold pools.
  Geography is roughly western Kansas (west edge) to central Missouri (east), Nebraska to
  Oklahoma north-south.
- **Steering**: once a day at 06Z the box is slid east or west (and sometimes north or south)
  along the large-scale model, never faster than the weather systems move, so that the
  afternoon gets the large-scale support picked for that day (warm sector, near a surface low,
  or under an upper trough). Each day.md gives the plan.
- Latitude and longitude on the large-scale charts are approximate: the box's middle is put at
  38.5N 97.5W and distances converted. They give scale and orientation only.

## Files in each day folder

- full-12Z, full-18Z, full-00Z, full-06Z: the whole large-scale model, rolled east-west so
  the region is in the middle. Panels: 500 mb heights with the 250 mb jet; MSLP with the
  low-level temperature and surface wind (L and H marked); the 850 mb wind with low-level
  moisture; large-scale ascent with its rain and the 12-hour 500 mb height change.
- region-18Z, -21Z, -00Z, -03Z: the region's mesoanalysis: MSLP, temperature, wind and the
  analysed lines; dewpoint and the 850 mb wind; MLCAPE, MLCIN and 700 mb temperature;
  0-6 km shear with 500 mb heights; 0-1 km helicity with LCL; STP with the storms of the moment.
- storms: every storm's track over the day by type, tornado tracks by strength, and reports.
- day.md / day.json: the region every 3 hours, soundings at 21Z and 00Z (highest STP and
  highest MLCAPE), storm types, reports and each tornado.
`;


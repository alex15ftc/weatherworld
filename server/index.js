import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WeatherAuthorityRuntime, SIM_HOURS_PER_REAL_MINUTE } from './WeatherAuthorityRuntime.js';
import { SurfaceAnalysisRuntime } from './SurfaceAnalysisRuntime.js';
import { SynopticRuntime } from './SynopticRuntime.js';
import { OutlookRuntime } from './OutlookRuntime.js';
import { MesoscaleRuntime } from './MesoscaleRuntime.js';
import { ShortRangeRuntime } from './ShortRangeRuntime.js';
import { countiesFor, placesFor } from './CountyLayer.js';
import { WarningRuntime } from './WarningRuntime.js';
import { ReportsRuntime } from './ReportsRuntime.js';
import { GameProducts } from './GameProducts.js';
import { OUTLOOK_DAYS, OUTLOOK_HAZARDS, outlookSvg, outlookIndex } from './OutlookPublic.js';
import { ProductArchive } from './ProductArchive.js';
import { ChaserArchive, roleOf, isAdmin } from './ChaserArchive.js';
import { setCalendar, calendarFor } from '../js/forecast/calendar.js';
import { RadarPool } from './RadarPool.js';
import { sitePage, renderPage, NOT_FOUND_PAGE, CONTENT_TYPES } from './SitePages.js';
import { DayArchive } from './DayArchive.js';
import { ReplayArchive } from './ReplayArchive.js';
import { StormWorkers, EMPTY_FRAMES } from '../js/game/StormWorkers.js';
import { avoidBackgroundThrottling } from '../js/runtime/processPriority.node.js';

// Set WEATHER_PRIORITY=normal to leave the process priority alone.
avoidBackgroundThrottling();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
// The authority resumes from its saved state unless WEATHER_SEED names a world to start
// (WEATHER_PERSIST=off keeps nothing on disk; WEATHER_STATE_PATH moves the saved state). A
// fresh world spends about a minute letting the large-scale weather develop before the server
// answers.
const statePath = process.env.WEATHER_PERSIST === 'off' ? null : path.resolve(ROOT, process.env.WEATHER_STATE_PATH ?? 'data/cache/atmosphere-state.bin');
if (process.env.WEATHER_SEED || !statePath || !fs.existsSync(statePath)) console.log('[weather-authority] starting a new world (about a minute)...');
// The radar is worked out on its own threads (WEATHER_RADAR_WORKERS; 0 works it out on this one).
const radarPool = process.env.WEATHER_RADAR_WORKERS === '0' ? null : new RadarPool();
// A review package for each finished day (DayReviewRecorder.js): WEATHER_DAY_REVIEWS=off turns them
// off, WEATHER_DAY_REVIEW_PNG=on adds PNG copies (a headless Chrome or Edge), and the newest
// WEATHER_DAY_REVIEW_DAYS (14) are kept.
const dayReviews = process.env.WEATHER_DAY_REVIEWS === 'off' ? null : { dir: path.resolve(ROOT, process.env.WEATHER_DAY_REVIEW_DIR ?? 'data/day-reviews/live'), png: process.env.WEATHER_DAY_REVIEW_PNG === 'on', keepDays: Number(process.env.WEATHER_DAY_REVIEW_DAYS) || 14 };
const runtime = new WeatherAuthorityRuntime({ seed: process.env.WEATHER_SEED, statePath, radarPool, dayReviews, clockLock: process.env.WEATHER_CLOCK_LOCK !== 'off' });
// The clock is locked to real UTC time, 8 world days a real day; products name hours "11/11/26 Day 3" (js/forecast/calendar.js).
setCalendar({ offset: () => (runtime.clockLock ? runtime.clockOffset : null) });
// The storms players are near, in detail (js/game/StormWorkers.js): engine-built frames
// (WEATHER_ENGINE_FRAMES, default "only"; "model" brings back the cloud model workers, "side"
// runs both). WEATHER_STORM_WORKERS sets how many model workers may run, 0 turns it all off.
if (process.env.WEATHER_STORM_WORKERS !== '0') {
  // (the models are saved beside the world's state, and only carried on in the same world)
  // (the frames' rain fields are worked out on the radar's threads, and the radar's scene uses them)
  runtime.stormWorkers = new StormWorkers({ clockRate: SIM_HOURS_PER_REAL_MINUTE * 60, params: { engineFrames: process.env.WEATHER_ENGINE_FRAMES ?? 'only' }, saveDir: statePath ? path.join(path.dirname(statePath), 'storm-models') : null, worldTag: () => `${runtime.codeVersion}:${runtime.seed}`,
    rainFields: radarPool ? (world, storms) => radarPool.stormFields(world, storms) : null });
  for (const signal of ['exit', 'SIGINT', 'SIGTERM']) process.once(signal, () => { runtime.stormWorkers?.close(); if (signal !== 'exit') process.exit(0); });
}
const surface = new SurfaceAnalysisRuntime({ atmosphere: runtime.engine, simHoursPerRealMinute: SIM_HOURS_PER_REAL_MINUTE });
// The whole large-scale model with the map's place in it, for the synoptic page (SynopticRuntime.js).
const synoptic = new SynopticRuntime({ atmosphere: runtime.engine });
// The Day 1-3 outlooks: issued when the world is ready, then every 6, 12 and 24 hours (WEATHER_OUTLOOK=off turns them off;
// WEATHER_OUTLOOK_MEMBERS sets how many forecast runs go into it).
const outlooks = process.env.WEATHER_OUTLOOK === 'off' ? null : new OutlookRuntime({ runtime, members: Number(process.env.WEATHER_OUTLOOK_MEMBERS) || undefined, file: statePath ? path.join(path.dirname(statePath), 'outlooks.bin') : null });
// The day packages take the day's first Day 1 outlook issued once the day has begun.
runtime.dayReviewOutlook = (from, to) => { const outlook = outlooks?.current('day1')?.outlook; return outlook && outlook.validToHourUtc === to && outlook.issuedHourUtc >= from ? outlook : null; };
// Mesoscale discussions and watches: the world is looked at once in each of its hours, and a
// watch waiting for its storms goes out when they fire (WEATHER_MESOSCALE=off turns them off).
const mesoscale = process.env.WEATHER_MESOSCALE === 'off' ? null : new MesoscaleRuntime({ runtime, file: statePath ? path.join(path.dirname(statePath), 'mesoscale.bin') : null });
// Tornado and severe thunderstorm warnings: worked out at every volume scan from the storms as
// the radar sees them (WEATHER_WARNINGS=off turns them off).
const warnings = process.env.WEATHER_WARNINGS === 'off' ? null : new WarningRuntime({ runtime });
// The short range model: a run at each whole simulated hour, for the model page (ShortRangeRuntime.js;
// WEATHER_SHORT_RANGE=off turns it off).
const shortRange = process.env.WEATHER_SHORT_RANGE === 'off' ? null : new ShortRangeRuntime({ runtime });
// Storm reports and damage surveys, from the live world's daily storm log (ReportsRuntime.js).
const reports = new ReportsRuntime({ runtime });
// The products as the Roblox place draws them (GameProducts.js).
const gameProducts = new GameProducts({ runtime, outlooks, mesoscale, warnings, reports });
// Every watch, discussion and warning issued, for the public pages and the Discord posts (ProductArchive.js).
const archive = new ProductArchive({ runtime, products: gameProducts, layer: () => countiesFor(runtime.engine?.world), file: statePath ? path.join(path.dirname(statePath), 'products.bin') : null });
// The chaser network (ChaserArchive.js): every server's players, live and through each world day.
// The world hour now: on the locked clock from real time (8 world hours a real hour), else the world's own.
const worldHourNow = () => (runtime.clockLock && runtime.clockOffset != null ? runtime.clockOffset + Date.now() * 8 / 3600000 : Number(runtime.engine?.world?.validHourUtc));
const chasers = new ChaserArchive({ runtime, hourNow: worldHourNow, milesPerKm: () => (runtime.engine?.world ? placesFor(runtime.engine.world).milesPerKm : 0.621371), file: statePath ? path.join(path.dirname(statePath), 'chasers.bin') : null });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => chasers.save(true));
// Both share the forecast pool's threads (WEATHER_FORECAST_WORKERS). The mesoscale look is
// asked for first: its runs are short and go ahead of an outlook's.
// Each day's replay: its mesoanalysis, large-scale charts, warnings and tornado radar (ReplayArchive.js), let go
// after 16 world days. The tornado radar is only recorded on a storm tick; it is scanned later, as work that waits.
const replays = new ReplayArchive({ runtime, surface, synoptic, archive, dir: statePath ? path.join(path.dirname(statePath), 'replays') : null });
const keepReplays = () => { try { replays.capture(); } catch (error) { console.warn('[replays]', error.message); } };
runtime.afterStormTick = () => { try { replays.tick(); } catch (error) { console.warn('[replays]', error.message); } };
keepReplays();
// Each day's forecast and what happened, for the day summaries an admin can save (DayArchive.js).
const days = new DayArchive({ runtime, products: gameProducts, reports, archive, replays, layer: () => countiesFor(runtime.engine?.world), file: statePath ? path.join(path.dirname(statePath), 'days.bin') : null });
const issueProducts = () => { warnings?.update(); mesoscale?.maybeIssue(); outlooks?.maybeIssue(); shortRange?.maybeRun(); try { archive.sync(); days.sync(); replays.warnings(); } catch (error) { console.warn('[products]', error.message); } };
outlooks?.maybeIssue();
setInterval(issueProducts, 5_000).unref();
// Often enough that a storm tick is worked out within a couple of seconds of falling due: the
// game shows each tick a fixed time after it falls due (GameFeed.js).
const ADVANCE_POLL_MS = 2_000;
const perf = { startedAt: Date.now(), totals:{requests:0,cacheHits:0,cacheMisses:0}, endpoints:{}, recent:[] };
function beginRequest(pathname){ return { pathname, started: performance.now() }; }
function finishRequest(trace, detail={}) { const totalMs=performance.now()-trace.started; perf.totals.requests++; const stat=perf.endpoints[trace.pathname]??={count:0,totalMs:0,maxMs:0}; stat.count++;stat.totalMs+=totalMs;stat.maxMs=Math.max(stat.maxMs,totalMs);perf.recent.unshift({path:trace.pathname,totalMs:+totalMs.toFixed(2),...detail,at:new Date().toISOString()});if(perf.recent.length>50)perf.recent.length=50; return totalMs; }
// What the machine gives this process: the cores it sees and, in a container, the share of them and the memory it may use.
function hostLimits() {
  const read = file => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; } };
  const [quota, period] = (read('/sys/fs/cgroup/cpu.max') ?? '').split(' ');
  const memory = Number(read('/sys/fs/cgroup/memory.max'));
  return { coresSeen: os.availableParallelism(), cpuLimit: Number(quota) > 0 && Number(period) > 0 ? Math.round(Number(quota) / Number(period) * 100) / 100 : null,
    memoryLimitMb: Number.isFinite(memory) && memory > 0 ? Math.round(memory / 1048576) : null, rssMb: Math.round(process.memoryUsage().rss / 1048576), load: os.loadavg().map(v => Math.round(v * 100) / 100) };
}
function performanceSnapshot(){ const endpoints=Object.fromEntries(Object.entries(perf.endpoints).map(([k,v])=>[k,{count:v.count,averageMs:v.totalMs/v.count,maxMs:v.maxMs}])); return {version:'2.23.2',uptimeSeconds:Math.round((Date.now()-perf.startedAt)/1000),totals:{requests:perf.totals.requests,cacheHits:runtime.performance.cacheHits,cacheMisses:runtime.performance.cacheMisses},endpoints,recent:perf.recent,productBuilds:runtime.performance.productBuilds,radarPool:radarPool?.status()??null,host:hostLimits(),tornadoRadar:replays.radarCost()}; }
// (In turns: requests are answered between the storm ticks and atmosphere steps of a catch-up.)
setInterval(async () => {
  try { if (await runtime.advanceOnTimerInTurns()) { surface.capture(); synoptic.capture(); keepReplays(); warnings?.update(); runtime.prewarmRadar(); } }
  catch (error) { console.error('[weather-authority] advance failed:', error); }
}, ADVANCE_POLL_MS).unref();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await serveApi(url, req, res);
    // The site's pages (site/README.md): every page shares the header and footer in site/.
    const page = sitePage(url.pathname);
    if (page) return sendFile(path.resolve(ROOT, page), res);
    return serveStatic(url.pathname, res);
  } catch (error) { sendJson(req, res, 500, { error: error?.message ?? 'Internal server error' }, { cacheable: false }); }
});

async function serveApi(url, req, res) {
  const trace=beginRequest(url.pathname);
  if (url.pathname === '/api/health') return sendJson(req, res, 200, runtime.metadata(), { trace });
  if (url.pathname === '/api/authority/state') return sendJson(req, res, 200, runtime.authorityState(), { cacheable: false, trace });
  // Resetting, stepping, seeking or stopping the world is admin only (ChaserArchive.js isAdmin): the
  // WEATHER_ADMIN_KEY in x-admin-key, or, with no key set (a local engine), a request from this machine.
  if (url.pathname.startsWith('/api/authority/') && !isAdmin(req)) return sendJson(req, res, 401, { error: 'Admin key needed' }, { cacheable: false, trace });
  if (url.pathname === '/api/authority/reset' && req.method === 'POST') { const body=await readJsonBody(req); const value=runtime.reset(body.seed);return sendJson(req,res,200,value,{cacheable:false,trace}); }
  if (url.pathname === '/api/authority/advance' && req.method === 'POST') { const body=await readJsonBody(req); const value=runtime.advance(body.hours,()=>{ surface.capture(); synoptic.capture(); keepReplays(); });return sendJson(req,res,200,value,{cacheable:false,trace}); }
  if (url.pathname === '/api/authority/seek' && req.method === 'POST') { const body=await readJsonBody(req); const value=runtime.seek(body.validHourUtc);return sendJson(req,res,200,value,{cacheable:false,trace}); }
  if (url.pathname === '/api/authority/clock' && req.method === 'POST') { const body=await readJsonBody(req); return sendJson(req,res,200,runtime.setAutoAdvance(body.enabled),{cacheable:false,trace}); }
  if (url.pathname.startsWith('/api/atmosphere/') && surface.atmosphere !== runtime.engine) surface.attach(runtime.engine);
  if (url.pathname.startsWith('/api/synoptic/')) {
    if (synoptic.atmosphere !== runtime.engine) synoptic.attach(runtime.engine);
    if (url.pathname === '/api/synoptic/frame') return sendJson(req, res, 200, forRole(req, synoptic.summary(url.searchParams.get('frame'))), { cacheable: false, trace });
    if (url.pathname === '/api/synoptic/field') { const field = synoptic.field(url.searchParams.get('key') ?? '', url.searchParams.get('frame')); return sendJson(req, res, field ? 200 : 404, field ?? { error: 'Unknown field' }, { cacheable: Boolean(field), trace }); }
    return sendJson(req, res, 404, { error: 'Unknown API endpoint' }, { cacheable: false, trace });
  }
  if (url.pathname === '/api/atmosphere/surface') return sendJson(req, res, 200, { ...surface.analysis(url.searchParams.get('frame')), clockRunning: runtime.autoAdvance }, { cacheable: false, trace });
  if (url.pathname === '/api/atmosphere/parameter') { const field = surface.parameter(url.searchParams.get('key'), url.searchParams.get('frame')); return sendJson(req, res, field ? 200 : 404, field ?? { error: 'Unknown parameter' }, { cacheable: Boolean(field), trace }); }
  // The short range model's runs (ShortRangeRuntime.js): the list; a run's description (?init=, the newest
  // without); one hour's field (?init&hour&key); the storms at a minute (?init&minute); the tracks (?init).
  if (url.pathname.startsWith('/api/models/short-range/')) {
    const q = name => url.searchParams.get(name), part = url.pathname.slice('/api/models/short-range/'.length);
    if (!shortRange) return sendJson(req, res, 404, { error: 'The short range model is off' }, { cacheable: false, trace });
    const value = part === 'runs' ? shortRange.list() : part === 'run' ? shortRange.meta(q('init')) : part === 'field' ? shortRange.field(q('init'), q('hour'), q('key')) : part === 'storms' ? shortRange.storms(q('init'), q('minute')) : part === 'tracks' ? shortRange.tracks(q('init'))
      // (the run's large-scale view: the frames and fields the synoptic page reads, from the run)
      : part === 'synoptic/frame' ? forRole(req, shortRange.synopticFrame(synoptic, q('init'), q('frame'))) : part === 'synoptic/field' ? shortRange.synopticField(synoptic, q('init'), q('frame'), q('key')) : undefined;
    return sendJson(req, res, value ? 200 : 404, value ?? { error: 'Not found' }, { cacheable: false, trace });
  }
  // The outlook runs as an ensemble (OutlookRuntime.js): the issues kept, and one issue's storm tracks (?issued=).
  if (url.pathname === '/api/models/ensemble/runs') return sendJson(req, res, outlooks ? 200 : 404, outlooks ? outlooks.ensembleList() : { error: 'Outlooks are off' }, { cacheable: false, trace });
  if (url.pathname === '/api/models/ensemble/tracks') { const value = outlooks?.ensembleTracks(url.searchParams.get('issued')); return sendJson(req, res, value ? 200 : 404, value ?? { error: 'Not found' }, { cacheable: false, trace }); }
  // The counties and towns for the model page's base map (miles from the north-west corner).
  if (url.pathname === '/api/map/counties') {
    const layer = countiesFor(runtime.engine?.world);
    if (!layer) return sendJson(req, res, 404, { error: 'No counties' }, { cacheable: false, trace });
    return sendJson(req, res, 200, { miles: layer.miles, counties: layer.counties.map(c => ({ name: c.name, rings: c.rings })), towns: layer.towns.map(t => ({ name: t.name, kind: t.kind, x: t.x, y: t.y, population: t.population })) }, { trace });
  }
  if (url.pathname === '/api/live/metadata') return sendJson(req, res, 200, runtime.metadata(), { trace });
  if (url.pathname === '/api/live/field') return sendJson(req, res, 200, runtime.liveField(url.searchParams.get('product') ?? 'temperature'), { trace });
  if (url.pathname === '/api/live/boundaries') return sendJson(req, res, 200, runtime.boundaries(), { trace });
  // The game's storms (GameFeed.js): ?after=<seq> gives the frames after that one. Set
  // WEATHER_GAME_KEY to require it in the x-api-key header.
  if (url.pathname.startsWith('/api/game/v1/') && process.env.WEATHER_GAME_KEY && req.headers['x-api-key'] !== process.env.WEATHER_GAME_KEY) return sendJson(req, res, 401, { error: 'Bad key' }, { cacheable: false, trace });
  if (url.pathname === '/api/game/v1/frames') return sendText(req, res, 200, runtime.gameFeed.poll(url.searchParams.get('after')), trace);
  // The products the game draws (GameProducts.js): the manifest of versions, and each product's text.
  if (url.pathname === '/api/game/v1/lab/window') return sendJson(req, res, 200, runtime.labWindow(url.searchParams.get('x'), url.searchParams.get('y'), url.searchParams.get('half')), { cacheable: false, trace });
  if (url.pathname === '/api/game/v1/lab/storms') return sendJson(req, res, 200, runtime.labStormsAt(url.searchParams.get('x'), url.searchParams.get('y'), url.searchParams.get('half'), url.searchParams.get('inflow') === '1'), { cacheable: false, trace });
  // The cloud model's storms (js/game/StormWorkers.js): a Roblox server reports where its players
  // are (POST { server, players: [[xKm, yKm], ...] }, map km, y south) and fetches the frames newer
  // than it holds (?have=id:seq,... &parts=full,near,far: a binary bundle).
  if (url.pathname === '/api/game/v1/storm/players' && req.method === 'POST') { const body = await readJsonBody(req); try { chasers.report(body.server, body.players); } catch (error) { console.warn('[chasers]', error.message); } return sendJson(req, res, 200, runtime.stormWorkers?.reportPlayers(body.server, body.players) ?? { detailed: [], off: true }, { cacheable: false, trace }); }
  if (url.pathname === '/api/game/v1/storm/frames') { const parts = (url.searchParams.get('parts') ?? 'full,near,far').split(','); const bundle = runtime.stormWorkers?.frames(url.searchParams.get('have'), parts, { paused: !runtime.autoAdvance }) ?? EMPTY_FRAMES; finishRequest(trace, { status: 200, rawBytes: bundle.length, sentBytes: bundle.length }); res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bundle.length, 'cache-control': 'no-store' }); return res.end(bundle); }
  if (url.pathname === '/api/game/v1/storm/workers') return sendJson(req, res, 200, runtime.stormWorkers?.status() ?? { off: true }, { cacheable: false, trace });
  if (url.pathname === '/api/game/v1/manifest') return sendJson(req, res, 200, gameProducts.manifest(), { cacheable: false, trace });
  const gameProduct = url.pathname.match(/^\/api\/game\/v1\/product\/([A-Za-z0-9._-]+)$/);
  if (gameProduct) { const entry = await gameProducts.productAsync(gameProduct[1]); return entry ? sendText(req, res, 200, entry.text, trace, { 'x-product-version': entry.version }) : sendJson(req, res, 404, { error: 'Unknown product' }, { cacheable: false, trace }); }
  // The public outlooks (OutlookPublic.js): the index, a day's product, and its map as an SVG.
  if (url.pathname === '/api/outlook/index') {
    const list = await Promise.all(OUTLOOK_DAYS.map(async day => { const hit = await outlookProduct(day); return { day, product: hit?.product, version: hit?.version }; }));
    return sendJson(req, res, 200, { nowHourUtc: runtime.engine?.world?.validHourUtc ?? null, ...outlookIndex(list) }, { cacheable: false, trace });
  }
  const outlookDay = url.pathname.match(/^\/api\/outlook\/(day[123])(\.svg)?$/);
  if (outlookDay) {
    const hit = await outlookProduct(outlookDay[1]);
    if (!hit) return sendJson(req, res, 404, { error: 'Outlooks are off' }, { cacheable: false, trace });
    if (!outlookDay[2]) return sendText(req, res, 200, hit.text, trace, { 'x-product-version': hit.version });
    const hazard = OUTLOOK_HAZARDS.includes(url.searchParams.get('hazard')) ? url.searchParams.get('hazard') : 'categorical';
    // ?times=1 adds the issue and valid times under the key (the Discord posts; the page shows them itself).
    const times = url.searchParams.get('times') === '1', key = `${hazard}${times ? ':times' : ''}`;
    if (!hit.svgs.has(key)) hit.svgs.set(key, outlookSvg(hit.product, countiesFor(runtime.engine?.world), hazard, { times }));
    return sendText(req, res, 200, hit.svgs.get(key), trace, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-cache', 'x-product-version': hit.version });
  }
  // The watches, discussions and warnings (ProductArchive.js): the feed, each one, and their maps (?times=1: with the times line).
  // What a page needs to date world hours itself (calendar.js).
  // The chaser network (ChaserArchive.js). Each answer is the view of the asker's role: "admin"
  // (x-admin-key) sees names, user ids and servers; "public" sees dots and unnamed tracks.
  if (url.pathname.startsWith('/api/chasers/')) {
    const role = roleOf(req), admin = role === 'admin';
    if (url.pathname === '/api/chasers/role') return sendJson(req, res, 200, { role }, { cacheable: false, trace });
    if (url.pathname === '/api/chasers/live') return sendJson(req, res, 200, { role, ...(admin ? chasers.adminLive() : chasers.publicLive()) }, { cacheable: false, trace });
    if (url.pathname === '/api/chasers/days') return sendJson(req, res, 200, { role, ...chasers.dayList() }, { cacheable: false, trace });
    if (url.pathname === '/api/chasers/day') {
      const value = chasers.dayTracks(url.searchParams.get('day'), { admin });
      if (!value) return sendJson(req, res, 404, { error: 'No such day' }, { cacheable: false, trace });
      return sendJson(req, res, 200, { role, ...value, reports: reportsBetween(value.startHourUtc, value.startHourUtc + 24) }, { cacheable: false, trace });
    }
    return sendJson(req, res, 404, { error: 'Unknown API endpoint' }, { cacheable: false, trace });
  }
  if (url.pathname === '/api/calendar') return sendJson(req, res, 200, calendarFor(), { cacheable: false, trace });
  if (url.pathname === '/api/products/feed') return sendJson(req, res, 200, archive.feed(), { cacheable: false, trace });
  const archived = url.pathname.match(/^\/api\/(watch|md)\/(\d+)(\.svg)?$/);
  if (archived) {
    const [, kind, number, svg] = archived, times = url.searchParams.get('times') === '1';
    const value = svg ? (kind === 'watch' ? archive.watchSvg(number, { times }) : archive.discussionSvg(number, { times })) : (kind === 'watch' ? archive.watch(number) : archive.discussion(number));
    if (!value) return sendJson(req, res, 404, { error: 'Not found' }, { cacheable: false, trace });
    return svg ? sendText(req, res, 200, value, trace, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-cache' }) : sendJson(req, res, 200, value, { cacheable: false, trace });
  }
  // The day summaries (DayArchive.js): saved days are public; the recent days, saving and removing are admin only.
  if (url.pathname === '/api/days') { days.sync(); return sendJson(req, res, 200, days.list(isAdmin(req)), { cacheable: false, trace }); }
  const dayRoute = url.pathname.match(/^\/api\/day\/([A-Za-z0-9-]+)(?:\/(map\.svg|save|remove|replay\/[A-Za-z0-9/._-]+|tornado\/[A-Za-z0-9._-]+))?$/);
  if (dayRoute) {
    const [, id, part] = dayRoute, admin = isAdmin(req), live = id.startsWith('live-');
    if ((live || part === 'save' || part === 'remove') && !admin) return sendJson(req, res, 401, { error: 'Admin key needed' }, { cacheable: false, trace });
    days.sync();
    if (part === 'save' || part === 'remove') {
      if (req.method !== 'POST') return sendJson(req, res, 405, { error: 'POST only' }, { cacheable: false, trace });
      const value = part === 'save' ? (live ? days.keep(id.slice(5)) : null) : (days.remove(id) ? { removed: id } : null);
      return sendJson(req, res, value ? 200 : 404, value ?? { error: 'No such day' }, { cacheable: false, trace });
    }
    if (part === 'map.svg') {
      const svg = days.mapSvg(id, url.searchParams.get('kind') === 'tracks' ? 'tracks' : 'outlook', OUTLOOK_HAZARDS.includes(url.searchParams.get('hazard')) ? url.searchParams.get('hazard') : 'categorical');
      return svg ? sendText(req, res, 200, svg, trace, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-cache' }) : sendJson(req, res, 404, { error: 'No such day' }, { cacheable: false, trace });
    }
    // The day's replay (ReplayArchive.js): the same answers the live pages get, from the hours kept.
    if (part?.startsWith('replay/')) {
      const found = days.find(id), what = part.slice(7), q = name => url.searchParams.get(name);
      if (!found) return sendJson(req, res, 404, { error: 'No such day' }, { cacheable: false, trace });
      const value = what === 'surface' ? replays.surface(found.day, found.worldId, q('frame')) : what === 'parameter' ? replays.parameter(found.day, found.worldId, q('key'), q('frame'))
        : what === 'synoptic/frame' ? forRole(req, replays.synopticFrame(synoptic, found.day, found.worldId, q('frame'))) : what === 'synoptic/field' ? replays.synopticField(synoptic, found.day, found.worldId, q('frame'), q('key'))
        : what === 'warnings' ? replays.warningList(found.day, found.worldId) : what.startsWith('tornado/') ? replays.tornadoRadar(found.day, found.worldId, what.slice(8), q('frame')) : null;
      return sendJson(req, res, value ? 200 : 404, value ?? { error: 'No replay of that' }, { cacheable: Boolean(value) && found.ended, trace });
    }
    // One tornado's survey (its damage points and swath), for its map on the day page.
    if (part?.startsWith('tornado/')) { const survey = days.tornado(id, part.slice(8)); return sendJson(req, res, survey ? 200 : 404, survey ?? { error: 'No such tornado' }, { cacheable: false, trace }); }
    const value = days.summary(id);
    return sendJson(req, res, value ? 200 : 404, value ?? { error: 'No such day, or the day has not ended yet' }, { cacheable: false, trace });
  }
  // The warnings in effect, each with its polygon and bulletin, for the warnings page.
  if (url.pathname === '/api/warnings/active') return sendJson(req, res, 200, archive.activeWarnings(), { cacheable: false, trace });
  if (url.pathname === '/api/warnings.svg') {
    const value = archive.warningsSvg((url.searchParams.get('keys') ?? '').split(',').filter(Boolean).slice(0, 40), { times: url.searchParams.get('times') === '1' });
    return value ? sendText(req, res, 200, value, trace, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-cache' }) : sendJson(req, res, 404, { error: 'Not found' }, { cacheable: false, trace });
  }
  if (url.pathname === '/api/live/storms') return sendJson(req, res, 200, runtime.storms(), { trace });
  if (url.pathname === '/api/live/cell') return sendJson(req, res, 200, runtime.cellSummary(url.searchParams.get('row'), url.searchParams.get('column'), url.searchParams.get('day') ?? 'day1'), { cacheable: false, trace });
  if (url.pathname === '/api/live/sounding') return sendJson(req, res, 200, runtime.sounding(url.searchParams.get('row'), url.searchParams.get('column'), url.searchParams.get('day') ?? 'day1'), { cacheable: false, trace });
  // The radar, outlook, mesoscale, warning, storm report and damage survey pages were retired
  // on 2026-10-22: those products are drawn in Roblox from /api/game/v1/* (GameProducts.js).
  // What the tornado radar of the day replays is costing and how much is waiting.
  if (url.pathname === '/api/replays/status') return isAdmin(req) ? sendJson(req, res, 200, { radar: replays.radarCost(), radarPool: radarPool?.status() ?? null, host: hostLimits(), today: replays.current ? replays.contents(replays.current.day, replays.worldId) : null }, { cacheable: false, trace }) : sendJson(req, res, 401, { error: 'Admin key needed' }, { cacheable: false, trace });
  if (url.pathname === '/api/performance') return sendJson(req,res,200,performanceSnapshot(),{cacheable:false,trace});
  if (url.pathname === '/api/map/manifest') return sendJson(req,res,200,runtime.mapManifest({scope:url.searchParams.get('scope')??'live',product:url.searchParams.get('product')??'temperature',day:url.searchParams.get('day')??'day1',station:url.searchParams.get('station')??'composite'}),{cacheable:false,trace});
  const tile=url.pathname.match(/^\/api\/tiles\/(live|outlook)\/(\d+)\/(\d+)\/(\d+)\.png$/);
  if(tile){const body=await runtime.productTile({scope:tile[1],z:tile[2],x:tile[3],y:tile[4],product:url.searchParams.get('product')??(tile[1]==='radar'?'reflectivity':'temperature'),day:url.searchParams.get('day')??'day1',station:url.searchParams.get('station')??'composite'});return body?sendBinary(req,res,200,body,'image/png',{trace}):sendJson(req,res,404,{error:'Tile outside pyramid'},{cacheable:false,trace});}
  return sendJson(req, res, 404, { error: 'Unknown API endpoint' }, { cacheable: false, trace });
}

async function readJsonBody(req) {
  const chunks=[]; let size=0;
  for await (const chunk of req) { size += chunk.length; if (size > 64*1024) throw new Error('Request body too large'); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Invalid JSON request body'); }
}

// The storm reports made between two world hours (the report days run 12Z to 12Z), for the chaser loops.
function reportsBetween(from, to) {
  const out = [];
  try {
    const days = JSON.parse(gameProducts.product('reports.days')?.text ?? '{}').days ?? [];
    for (const d of days) {
      if (d.startHourUtc >= to || d.startHourUtc + 24 <= from) continue;
      const entry = gameProducts.product(`reports.day.${d.day}`);
      for (const r of (entry ? JSON.parse(entry.text).reports : [])) if (r.hourUtc >= from && r.hourUtc < to) out.push({ type: r.type, hourUtc: r.hourUtc, x: r.x, y: r.y, title: r.title });
    }
  } catch (error) { console.warn('[chasers] reports:', error.message); }
  return out.sort((a, b) => a.hourUtc - b.hourUtc);
}

// A large-scale frame as the asker may see it: the public is not told that the map moves (its drift and the
// day's aim are left out; the pages then hold the map in the middle of the chart), an admin is.
function forRole(req, frame) {
  if (!frame) return frame;
  if (isAdmin(req)) return { ...frame, role: 'admin' };
  const { slide, ...rest } = frame;
  return { ...rest, role: 'public' };
}

// An outlook day's game product, parsed once a version, with its maps (OutlookPublic.js) kept beside it.
const outlookCache = new Map();
async function outlookProduct(day) {
  const entry = await gameProducts.productAsync(`outlook.${day}`);
  if (!entry) return null;
  let hit = outlookCache.get(day);
  if (hit?.version !== entry.version) { hit = { version: entry.version, text: entry.text, product: JSON.parse(entry.text), svgs: new Map() }; outlookCache.set(day, hit); }
  return hit;
}

function serveStatic(pathname, res) {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  const filename = path.resolve(ROOT, relative);
  if (!filename.startsWith(ROOT) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) return sendFile(path.resolve(ROOT, NOT_FOUND_PAGE), res, 404);
  return sendFile(filename, res);
}
function sendFile(filename, res, status = 200) {
  // (a page missing from the image is a 404, never an unhandled stream error that takes the engine down)
  if (!fs.existsSync(filename)) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
  const ext = path.extname(filename).toLowerCase();
  const types = CONTENT_TYPES;
  res.writeHead(status, { 'content-type': types[ext] ?? 'application/octet-stream', 'cache-control': (ext === '.html' || ext === '.js' || ext === '.css') ? 'no-cache' : 'public, max-age=3600' });
  if (ext === '.html') return res.end(renderPage(ROOT, filename));
  fs.createReadStream(filename).on('error', () => res.destroy()).pipe(res);
}

function sendBinary(req,res,status,body,contentType,{trace=null}={}){
  const etag=`"${crypto.createHash('sha1').update(body).digest('base64url').slice(0,16)}"`;
  if(req.headers['if-none-match']===etag){const totalMs=trace?finishRequest(trace,{status:304,rawBytes:0,sentBytes:0,cacheHit:true}):0;res.writeHead(304,{etag,'cache-control':'public, max-age=31536000, immutable','server-timing':`total;dur=${totalMs.toFixed(2)}`});return res.end();}
  const totalMs=trace?finishRequest(trace,{status,rawBytes:body.length,sentBytes:body.length}):0;
  res.writeHead(status,{'content-type':contentType,'content-length':body.length,etag,'cache-control':'public, max-age=31536000, immutable','server-timing':`total;dur=${totalMs.toFixed(2)}`});res.end(body);
}

function sendJson(req, res, status, value, { cacheable = true, trace = null } = {}) {
  const serializeStarted=performance.now();
  const raw = Buffer.from(JSON.stringify(value));
  const serializeMs=performance.now()-serializeStarted;
  const etag = `"${crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 16)}"`;
  if (cacheable && req.headers['if-none-match'] === etag) {
    const totalMs=trace?finishRequest(trace,{status:304,rawBytes:0,sentBytes:0,serializeMs:+serializeMs.toFixed(2),cacheHit:true}):0;
    res.writeHead(304, { etag, 'cache-control': 'private, max-age=10, must-revalidate','server-timing':`total;dur=${totalMs.toFixed(2)}, serialize;dur=${serializeMs.toFixed(2)}` });
    return res.end();
  }
  const headers = {
    'content-type':'application/json; charset=utf-8',
    'cache-control': cacheable ? 'private, max-age=10, must-revalidate' : 'no-store',
    etag,
    vary: 'Accept-Encoding'
  };
  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
  if (acceptsGzip && raw.length > 1024) {
    return zlib.gzip(raw, (error, body) => {
      if (error) { res.writeHead(status, { ...headers, 'content-length': raw.length }); return res.end(raw); }
      const totalMs=trace?finishRequest(trace,{status,rawBytes:raw.length,sentBytes:body.length,serializeMs:+serializeMs.toFixed(2),compressed:true}):0;
      res.writeHead(status, { ...headers, 'content-encoding':'gzip', 'content-length':body.length,'server-timing':`total;dur=${totalMs.toFixed(2)}, serialize;dur=${serializeMs.toFixed(2)}` });
      res.end(body);
    });
  }
  const totalMs=trace?finishRequest(trace,{status,rawBytes:raw.length,sentBytes:raw.length,serializeMs:+serializeMs.toFixed(2),compressed:false}):0;
  res.writeHead(status, { ...headers, 'content-length':raw.length,'server-timing':`total;dur=${totalMs.toFixed(2)}, serialize;dur=${serializeMs.toFixed(2)}` });
  res.end(raw);
}
// JSON already written as text (the game feed), compressed when the caller takes gzip.
function sendText(req, res, status, text, trace = null, extraHeaders = {}) {
  const raw = Buffer.from(text), headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', vary: 'Accept-Encoding', ...extraHeaders };
  const done = (body, compressed) => {
    if (trace) finishRequest(trace, { status, rawBytes: raw.length, sentBytes: body.length, compressed });
    res.writeHead(status, { ...headers, ...(compressed ? { 'content-encoding': 'gzip' } : {}), 'content-length': body.length });
    res.end(body);
  };
  if (/\bgzip\b/.test(req.headers['accept-encoding'] ?? '') && raw.length > 1024) return zlib.gzip(raw, (error, body) => error ? done(raw, false) : done(body, true));
  done(raw, false);
}
server.listen(PORT, () => console.log(`[weather-authority] 2.23.2 listening on http://localhost:${PORT}`));

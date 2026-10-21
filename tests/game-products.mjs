// The products as the Roblox place gets them (server/GameProducts.js): rings in map miles,
// simplified within the tolerance; versions that change only when the product does; and an
// outlook that has not been issued yet saying so.
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { GameProducts, gameOutlook, gameMesoscale, gameWarnings, ringsToMiles, GAME_PRODUCTS } from '../server/GameProducts.js';

// A circle of 200 points, radius 0.2 of a 500-mile map: about 100 miles across.
const circle = Array.from({ length: 200 }, (_, k) => [0.5 + 0.2 * Math.cos(k / 200 * 2 * Math.PI), 0.5 + 0.2 * Math.sin(k / 200 * 2 * Math.PI)]);
const [ring] = ringsToMiles([circle], 500);
assert.ok(ring.length / 2 < 120 && ring.length / 2 >= 20, `simplified to ${ring.length / 2} points`);
// Every kept point lies on the circle (to rounding), and no original point is farther than the
// tolerance (plus rounding) from the simplified outline.
for (let i = 0; i < ring.length; i += 2) assert.ok(Math.abs(Math.hypot(ring[i] - 250, ring[i + 1] - 250) - 100) < 0.1);
const distanceToRing = (px, py) => {
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    const ax = ring[i], ay = ring[i + 1], bx = ring[(i + 2) % ring.length], by = ring[(i + 3) % ring.length];
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1e-9)));
    best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
  }
  return best;
};
for (const [x, y] of circle) assert.ok(distanceToRing(x * 500, y * 500) <= GAME_PRODUCTS.toleranceMiles + 0.08);
// Degenerate rings are dropped.
assert.deepEqual(ringsToMiles([[[0.1, 0.1], [0.1, 0.1], [0.1, 0.1]]], 500), []);

// An issued outlook, as OutlookRuntime.day() gives it.
const issued = {
  status: 'issued', day: 'day1', seed: 7, width: 50, height: 50, cellMiles: 10, issuedHourUtc: 13, validFromHourUtc: 13, validToHourUtc: 36,
  highest: 'SLGT', labels: { NONE: 'No thunderstorms', TSTM: 'Thunderstorms', SLGT: 'Slight risk' }, categories: ['NONE', 'TSTM', 'SLGT'],
  thunderLevel: 10, hazards: ['tornado'], levels: { tornado: [2, 5] }, maxCig: { tornado: 3 }, cigMeaning: { tornado: ['', 'EF2+'] },
  top: { tornado: { level: 5, cig: 1 } }, discussion: 'TEXT',
  shapes: { category: [{ key: 'TSTM', rings: [circle] }], tornado: { levels: [{ level: 2, rings: [circle] }], groups: [{ group: 1, rings: [circle] }] } },
  // What the game does not need: per-cell arrays.
  category: new Array(2500).fill(1), thunder: new Array(2500).fill(50)
};
const game = gameOutlook('day1', issued, { nextUpdateHourUtc: 16.5 });
assert.equal(game.id, 'outlook.day1'); assert.equal(game.day, 1); assert.equal(game.status, 'issued'); assert.equal(game.mapMiles, 500);
assert.equal(game.headline, 'Slight risk'); assert.equal(game.nextUpdateHourUtc, 16.5); assert.equal(game.discussion, 'TEXT');
assert.equal(game.category[0].key, 'TSTM'); assert.ok(Array.isArray(game.category[0].rings[0]) && typeof game.category[0].rings[0][0] === 'number');
assert.equal(game.hazards.tornado.levels[0].level, 2); assert.equal(game.hazards.tornado.groups[0].group, 1);
assert.deepEqual(game.hazards.tornado.contourLevels, [2, 5]); assert.equal(game.hazards.tornado.top.level, 5);
assert.ok(JSON.stringify(game).length < 4000, 'no per-cell arrays');
assert.deepEqual(gameOutlook('day2', { status: 'running' }), { v: 1, id: 'outlook.day2', kind: 'outlook', day: 2, status: 'running', error: null });

// Versions: unchanged while the source is unchanged; new when an outlook is issued.
const outlooks = {
  running: null, lastError: null, issued: { day1: null },
  current(day) { return this.issued[day] ?? null; },
  day(day) { return this.issued[day]?.public ?? { day, status: this.running ? 'running' : 'pending' }; },
  nextUpdateHourUtc: () => 16.5
};
// A small radar: two sites, and scans made when asked for.
const scanCalls = [];
const runtime = {
  gameFeed: { epoch: 42 }, engine: { world: { validHourUtc: 13 } },
  radarCatalog: () => ({ sites: [{ id: 'KAAA', name: 'Alpha', xKm: 160.9344, yKm: 321.8688 }, { id: 'KBBB', name: 'Bravo', xKm: 0, yKm: 0 }] }),
  radarScan: async (siteId, tilt) => { scanCalls.push([siteId, tilt]); return { siteId, tiltDeg: tilt, validHourUtc: 13, stormMotion: { u: 1, v: 2 }, products: { reflectivity: new Uint8Array(720 * 460).fill(7), velocity: new Uint8Array(720 * 460).fill(9), stormRelativeVelocity: new Uint8Array(720 * 460) } }; }
};
const products = new GameProducts({ runtime, outlooks });
const first = products.manifest();
assert.equal(first.epoch, 42); assert.equal(first.simHourUtc, 13);
assert.deepEqual(Object.keys(first.products), ['outlook.day1', 'outlook.day2', 'outlook.day3', 'mesoscale', 'warnings', 'radar.sites']);
assert.equal(JSON.parse(products.product('outlook.day1').text).status, 'pending');
assert.equal(products.manifest().products['outlook.day1'].version, first.products['outlook.day1'].version);
outlooks.running = { due: ['day1'] };
const running = products.manifest().products['outlook.day1'].version;
assert.notEqual(running, first.products['outlook.day1'].version);
assert.equal(JSON.parse(products.product('outlook.day1').text).status, 'running');
outlooks.running = null; outlooks.issued.day1 = { outlook: { issuedHourUtc: 13 }, public: issued };
const done = products.manifest().products['outlook.day1'];
assert.notEqual(done.version, running);
assert.equal(products.product('outlook.day1').text, JSON.stringify(gameOutlook('day1', issued, { nextUpdateHourUtc: 16.5 })));
assert.equal(products.product('nope'), null);
// The same text gives the same version (so a snapshot and the live server agree).
assert.equal(new GameProducts({ runtime, outlooks }).manifest().products['outlook.day1'].version, done.version);

// Radar sites in map miles, with the lowest tilt's reach.
const sites = JSON.parse(products.product('radar.sites').text);
assert.deepEqual(sites.sites[0], { id: 'KAAA', name: 'Alpha', xMiles: 100, yMiles: 200 });
assert.ok(sites.rangeMiles > 140 && sites.rangeMiles < 145, String(sites.rangeMiles));

// A single radar's scan: made when asked for, listed while asked for, then let go.
assert.equal(await products.productAsync('radar.site.KZZZ.velocity'), null);
assert.equal(await products.productAsync('radar.site.KAAA.bogus'), null);
const scanEntry = await products.productAsync('radar.site.KAAA.velocity');
const scan = JSON.parse(scanEntry.text);
assert.equal(scan.kind, 'radar-polar'); assert.equal(scan.radials, 720); assert.equal(scan.gates, 460); assert.equal(scan.xMiles, 100);
assert.deepEqual(scanCalls.at(-1), ['KAAA', 0.5]);
assert.ok(Math.abs(scan.gateGroundMiles - 0.5 * Math.cos(0.5 * Math.PI / 180) / 1.609344) < 1e-12);
assert.ok(zlib.zstdDecompressSync(Buffer.from(scan.data, 'base64')).every(b => b === 9));
const t0 = Date.now();
assert.equal(products.manifest(t0).products['radar.site.KAAA.velocity'].version, scanEntry.version);
assert.equal(products.manifest(t0 + GAME_PRODUCTS.siteWantedMs + 1).products['radar.site.KAAA.velocity'], undefined);
assert.equal(products.manifest(t0 + GAME_PRODUCTS.siteWantedMs + 2).products['radar.site.KAAA.velocity'], undefined);

// Watches and discussions in effect (shares of the map to miles), with their colour keys and text;
// expired ones left out. Off when there is no mesoscale runtime.
const square = [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]];
const mesoList = {
  enabled: true, nowHourUtc: 20, width: 50, height: 50, cellMiles: 10,
  watches: [
    { number: 7, type: 'tornado', pds: true, title: 'Tornado Watch 7', where: 'portions of Testshire', issuedHourUtc: 19, validToHourUtc: 25, valid: true, rings: [square], text: 'WATCH TEXT' },
    { number: 6, type: 'severe', title: 'Severe Thunderstorm Watch 6', issuedHourUtc: 12, validToHourUtc: 18, valid: false, rings: [square], text: 'OLD' }
  ],
  discussions: [{ number: 12, concerning: 'SEVERE POTENTIAL...WATCH LIKELY', watchPercent: 80, watchNumber: null, issuedHourUtc: 19.5, validToHourUtc: 21, valid: true, rings: [square], text: 'MD TEXT' }]
};
const meso = gameMesoscale(mesoList);
assert.equal(meso.watches.length, 1); assert.equal(meso.watches[0].colourKey, 'tornado'); assert.equal(meso.watches[0].pds, true); assert.equal(meso.watches[0].text, 'WATCH TEXT');
assert.deepEqual(meso.watches[0].rings, [[50, 50, 150, 50, 150, 150, 50, 150]]);
assert.equal(meso.discussions[0].colourKey, 'likely'); assert.equal(meso.discussions[0].text, 'MD TEXT');
assert.equal(JSON.parse(products.product('mesoscale').text).status, 'off');

// Warnings in effect, most urgent first, polygons from km to miles.
const warnList = {
  enabled: true, nowHourUtc: 20,
  warnings: [
    { id: 'SVR-3', type: 'severe', number: 3, title: 'Severe Thunderstorm Warning 3', label: 'Severe T-storm', valid: true, tags: {}, issuedHourUtc: 19.8, validToHourUtc: 20.6, polygon: [[0, 0], [16.09344, 0], [16.09344, 16.09344]], text: 'SVR', latestText: 'SVR LATEST', statements: [{}] },
    { id: 'TOR-4', type: 'tornado', number: 4, title: 'Tornado Warning 4', label: 'PDS Tornado', valid: true, pds: true, tags: { damage: 'CONSIDERABLE' }, issuedHourUtc: 19.9, validToHourUtc: 20.6, polygon: [[0, 0], [8.04672, 0], [8.04672, 8.04672]], text: 'TOR', statements: [{}] },
    { id: 'TOR-1', type: 'tornado', number: 1, valid: false, tags: {}, polygon: [[0, 0], [1, 0], [1, 1]], text: 'OLD', statements: [] }
  ]
};
const warned = gameWarnings(warnList);
assert.deepEqual(warned.warnings.map(w => w.id), ['TOR-4', 'SVR-3']);
assert.equal(warned.warnings[0].colourKey, 'tornadoPds'); assert.equal(warned.warnings[1].colourKey, 'severe');
assert.deepEqual(warned.warnings[1].rings, [[0, 0, 10, 0, 10, 10]]); assert.equal(warned.warnings[1].text, 'SVR LATEST');
// Through the runtime: rebuilt when a statement is added.
const liveWarnings = { list: () => warnList }, liveMeso = { list: () => mesoList };
const withAll = new GameProducts({ runtime, outlooks, mesoscale: liveMeso, warnings: liveWarnings });
const v1 = withAll.manifest().products.warnings.version;
assert.equal(withAll.manifest().products.warnings.version, v1);
warnList.warnings[0].statements.push({}); warnList.warnings[0].latestText = 'SVR UPDATE';
assert.notEqual(withAll.manifest().products.warnings.version, v1);
assert.equal(JSON.parse(withAll.product('mesoscale').text).watches[0].number, 7);

console.log('game-products: ok');

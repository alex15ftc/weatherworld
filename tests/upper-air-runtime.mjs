import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { buildSounding } from '../js/sounding.js';
import { SurfaceAnalysisRuntime } from '../server/SurfaceAnalysisRuntime.js';
import { UpperAirRuntime, UPPER_AIR } from '../server/UpperAirRuntime.js';

// The 6-hourly upper-air soundings (server/UpperAirRuntime.js): a sparse network of the surface stations, a release
// taken once on the first step at or after 00Z, 06Z, 12Z and 18Z, the last day's kept (also on disk).
const atmosphere = new AtmosphereWorld({ seed: 2, spinUpDays: 3 });
const surface = new SurfaceAnalysisRuntime({ atmosphere });
const cells = () => atmosphere.regional.world;
const soundingAt = (row, column) => { const cell = atmosphere.cells?.[row]?.[column] ?? cells().cells?.[row]?.[column]; return cell ? { ...buildSounding(cell), validHourUtc: atmosphere.regional.hourUtc, context: { surface: { temperatureF: cell.surface.temperature }, outlook: 'kept back' } } : null; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upper-air-')), file = path.join(dir, 'upper-air.json');
let world = 'w1';
const upper = new UpperAirRuntime({ surface, soundingAt, worldId: () => world, file });

// --- The sites: stations of the surface network, far apart.
const sites = upper.sites();
assert.ok(sites.length >= 8 && sites.length <= 20, `${sites.length} sites of ${surface.stations.length} stations`);
for (const site of sites) assert.ok(surface.stations.includes(site), 'a site is a station');
for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) assert.ok(Math.hypot(sites[i].xKm - sites[j].xKm, sites[i].yKm - sites[j].yKm) >= UPPER_AIR.siteSpacingKm);

// --- Release times.
assert.equal(UpperAirRuntime.releaseBefore(30), 30);
assert.equal(UpperAirRuntime.releaseBefore(29.5), 24);
assert.equal(UpperAirRuntime.releaseBefore(5), 0);
assert.equal(UpperAirRuntime.releaseBefore(23.5), 18);
assert.equal(UpperAirRuntime.releaseBefore(-0.5), -6);

// --- One release at each 6-hourly time the world steps past (at it, or the first step after it), with every site,
// none in between; at most a day's kept.
const start = atmosphere.regional.hourUtc, hoursRun = 13;
let taken = upper.capture() ? 1 : 0;
for (let step = 0; step < hoursRun / 0.5; step++) {
  atmosphere.advance(0.5);
  if (upper.capture()) taken++;
}
const expected = Math.floor((start + hoursRun) / 6) - Math.ceil(start / 6) + 1;
assert.equal(taken, expected, `${taken} releases in ${hoursRun} h from ${start}Z`);
const summary = upper.summary();
assert.equal(summary.releases.length, Math.min(expected, UPPER_AIR.kept));
for (const release of summary.releases) {
  assert.equal(release.hourUtc % 6, 0, 'a release at 00Z, 06Z, 12Z or 18Z');
  assert.equal(release.sites.length, sites.length, 'every site has a sounding');
}
for (let i = 1; i < summary.releases.length; i++) assert.equal(summary.releases[i - 1].hourUtc - summary.releases[i].hourUtc, 6, '6 hours apart, newest first');
assert.equal(summary.nextReleaseHourUtc - summary.releases[0].hourUtc, 6);
const one = upper.sounding(sites[0].id);
assert.ok(one?.levels?.length || one?.params, 'a sounding with its profile');
assert.equal(one.site, sites[0].id);
assert.equal(one.context.outlook, undefined, 'the cell outlook is not handed out');
assert.equal(upper.sounding('nowhere'), null);
assert.ok(JSON.stringify(one).length < 200_000, `a sounding is ${JSON.stringify(one).length} bytes`);

// --- Kept on disk: a restart answers the same release.
await upper.saved();
const again = new UpperAirRuntime({ surface, soundingAt, worldId: () => world, file });
assert.equal(again.summary().releases[0].hourUtc, summary.releases[0].hourUtc);
assert.equal(again.capture(), false, 'a restart does not take the release again');
assert.deepEqual(again.sounding(sites[0].id).params, one.params);

// --- A new world starts with no releases (and takes none late).
world = 'w2';
again.capture();
assert.equal(again.summary().releases.length, 0);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`upper-air runtime ok: ${sites.length} sites, releases at ${summary.releases.map(r => `${r.hourUtc % 24}Z`).join(' ')}, ${JSON.stringify(one).length} bytes a sounding`);

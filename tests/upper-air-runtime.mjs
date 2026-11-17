import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AtmosphereWorld } from '../js/world/AtmosphereWorld.js';
import { buildSounding } from '../js/sounding.js';
import { SurfaceAnalysisRuntime } from '../server/SurfaceAnalysisRuntime.js';
import { UpperAirRuntime, UPPER_AIR } from '../server/UpperAirRuntime.js';

// The 06Z upper-air soundings (server/UpperAirRuntime.js): a sparse network of the surface stations, a release
// taken once on the first step at or after 06Z, kept (also on disk) until the next.
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
assert.equal(UpperAirRuntime.releaseBefore(29.5), 6);
assert.equal(UpperAirRuntime.releaseBefore(5), -18);

// --- Nothing before 06Z; one release on the first step at or after it, with every site; none again that day.
const start = atmosphere.regional.hourUtc, toRelease = ((6 - (start % 24)) + 24) % 24;
assert.equal(upper.capture(), toRelease === 0, 'a release only at its hour');
let taken = 0;
for (let step = 0; step < Math.round(toRelease / 0.5) + 4; step++) {
  atmosphere.advance(0.5);
  if (upper.capture()) taken++;
}
assert.equal(taken + (toRelease === 0 ? 1 : 0), 1, 'one release a day');
const summary = upper.summary();
assert.equal(summary.releases.length, 1);
assert.equal(summary.releases[0].hourUtc % 24, 6);
assert.equal(summary.releases[0].sites.length, sites.length, 'every site has a sounding');
assert.equal(summary.nextReleaseHourUtc - summary.releases[0].hourUtc, 24);
const one = upper.sounding(sites[0].id);
assert.ok(one?.levels?.length || one?.params, 'a sounding with its profile');
assert.equal(one.site, sites[0].id);
assert.equal(one.context.outlook, undefined, 'the cell outlook is not handed out');
assert.equal(upper.sounding('nowhere'), null);
assert.ok(JSON.stringify(one).length < 200_000, `a sounding is ${JSON.stringify(one).length} bytes`);

// --- Kept on disk: a restart answers the same release.
await new Promise(resolve => setTimeout(resolve, 300));
const again = new UpperAirRuntime({ surface, soundingAt, worldId: () => world, file });
assert.equal(again.summary().releases[0].hourUtc, summary.releases[0].hourUtc);
assert.equal(again.capture(), false, 'a restart does not take the release again');
assert.deepEqual(again.sounding(sites[0].id).params, one.params);

// --- A new world starts with no releases (and takes none late).
world = 'w2';
again.capture();
assert.equal(again.summary().releases.length, 0);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`upper-air runtime ok: ${sites.length} sites, release at ${summary.releases[0].hourUtc % 24}Z, ${JSON.stringify(one).length} bytes a sounding`);

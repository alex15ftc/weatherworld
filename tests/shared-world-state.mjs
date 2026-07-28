import assert from 'node:assert/strict';
import { WorldStateStore, WORLD_STATE_STORAGE_KEY, WORLD_AUTHORITY_LEASE_KEY } from '../js/world/WorldStateStore.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

let now = 10_000;
const storage = new MemoryStorage();
const firstPage = new WorldStateStore(storage, { now: () => now });
const firstSave = firstPage.save({
  currentSeed: 987654321,
  validHourUtc: 61.5,
  systemStartHour: 12,
  systemNumber: 3,
  upcomingSeed: 123456789,
  upcomingHandoffHour: 84
}, { writerId: 'page-a', expectedRevision: 0 });
assert.equal(firstSave.ok, true);

const secondPage = new WorldStateStore(storage, { now: () => now });
const loaded = secondPage.load();
assert.equal(loaded.schemaVersion, 6);
assert.equal(loaded.revision, 1);
assert.equal(loaded.writerId, 'page-a');
assert.equal(loaded.currentSeed, 987654321);
assert.equal(loaded.upcomingSeed, 123456789);
assert.deepEqual(loaded.productArchive, { day1: [], day2: [], day3: [] });
assert.ok(storage.getItem(WORLD_STATE_STORAGE_KEY));

assert.equal(firstPage.acquireAuthorityLease('page-a', { ttlMs: 1000 }), true);
assert.equal(secondPage.acquireAuthorityLease('page-b', { ttlMs: 1000 }), false);
now += 1001;
assert.equal(secondPage.acquireAuthorityLease('page-b', { ttlMs: 1000 }), true);
assert.equal(secondPage.readAuthorityLease().ownerId, 'page-b');

const staleSave = firstPage.save({ ...loaded, validHourUtc: 62 }, { writerId: 'page-a', expectedRevision: 0 });
assert.equal(staleSave.ok, false);
assert.equal(staleSave.conflict, true);
assert.equal(staleSave.record.revision, 1);

secondPage.clear();
assert.equal(secondPage.load(), null);
assert.equal(storage.getItem(WORLD_AUTHORITY_LEASE_KEY), null);
console.log('shared world state persistence and authority lease passed');

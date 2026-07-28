import assert from 'node:assert/strict';
import { WorldStateStore, WORLD_STATE_STORAGE_KEY, WORLD_STATE_STAGING_KEY, WORLD_STATE_BACKUP_KEY, WORLD_STATE_SCHEMA_VERSION } from '../js/world/WorldStateStore.js';

class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(k) { return this.data.has(k) ? this.data.get(k) : null; }
  setItem(k, v) { this.data.set(k, String(v)); }
  removeItem(k) { this.data.delete(k); }
}

let now = 1_000;
const storage = new MemoryStorage();
const store = new WorldStateStore(storage, { now: () => now });
const base = { currentSeed: 42, validHourUtc: 18, systemStartHour: 12, systemNumber: 1, authorityRealTimestamp: 900, productArchive: {} };
const first = store.save(base, { writerId: 'a', expectedRevision: 0 });
assert.equal(first.ok, true);
assert.equal(first.record.schemaVersion, WORLD_STATE_SCHEMA_VERSION);
assert.ok(storage.getItem(WORLD_STATE_STORAGE_KEY));

now += 100;
const second = store.save({ ...base, validHourUtc: 18.5 }, { writerId: 'a', expectedRevision: 1 });
assert.equal(second.ok, true);
assert.ok(storage.getItem(WORLD_STATE_BACKUP_KEY));

storage.setItem(WORLD_STATE_STORAGE_KEY, '{broken');
const recovered = store.load();
assert.equal(recovered.revision, 1);
assert.equal(store.lastLoadStatus.recovered, true);
assert.equal(store.lastLoadStatus.source, 'backup');
assert.equal(store.load().revision, 1);

now += 100;
const third = store.save({ ...base, validHourUtc: 19 }, { writerId: 'b', expectedRevision: 1 });
assert.equal(third.ok, true);
storage.setItem(WORLD_STATE_STAGING_KEY, storage.getItem(WORLD_STATE_STORAGE_KEY));
storage.setItem(WORLD_STATE_STORAGE_KEY, '{partial');
assert.equal(store.load().revision, 2);
assert.equal(store.lastLoadStatus.source, 'staging');

const stale = store.save({ ...base, validHourUtc: 20 }, { expectedRevision: 1 });
assert.equal(stale.conflict, true);
assert.equal(stale.record.revision, 2);

assert.equal(store.acquireAuthorityLease('writer-a', { ttlMs: 1000 }), true);
assert.equal(store.acquireAuthorityLease('writer-b', { ttlMs: 1000 }), false);
now += 1001;
assert.equal(store.acquireAuthorityLease('writer-b', { ttlMs: 1000 }), true);
assert.equal(store.readAuthorityLease().ownerId, 'writer-b');
assert.ok(store.getHealth().leaseEpoch >= 1);

const legacyStorage = new MemoryStorage();
legacyStorage.setItem('fake-plains-weather-world-v4', JSON.stringify({ schemaVersion: 3, currentSeed: 7, validHourUtc: 30, systemStartHour: 24, systemNumber: 2, updatedAt: 500, productArchive: {} }));
const migrated = new WorldStateStore(legacyStorage, { now: () => 2000 }).load();
assert.equal(migrated.schemaVersion, WORLD_STATE_SCHEMA_VERSION);
assert.equal(migrated.currentSeed, 7);
assert.ok(legacyStorage.getItem(WORLD_STATE_STORAGE_KEY));

console.log('state integrity and authority recovery passed');

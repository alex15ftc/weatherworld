import { hydrateStormInternalField, isStormInternalFieldValid, serializeStormInternalField } from '../storms/StormInternalField.js?v=2.20.1';
const STORAGE_KEY = 'fake-plains-weather-world-v7';
const LEGACY_STORAGE_KEYS = ['fake-plains-weather-world-v6', 'fake-plains-weather-world-v5', 'fake-plains-weather-world-v4', 'fake-plains-weather-world-v3', 'fake-plains-weather-world-v2'];
const STAGING_KEY = `${STORAGE_KEY}:staging`;
const BACKUP_KEY = `${STORAGE_KEY}:last-known-good`;
const LEASE_KEY = `${STORAGE_KEY}:authority-lease`;
const HEALTH_KEY = `${STORAGE_KEY}:health`;
const SCHEMA_VERSION = 7;
const DEFAULT_LEASE_MS = 15_000;

export class WorldStateStore {
  constructor(storage = globalThis.localStorage, { now = () => Date.now() } = {}) {
    this.storage = storage;
    this.now = now;
    this.lastLoadStatus = { source: 'none', recovered: false, errors: [] };
  }

  load() {
    const candidates = [
      [STORAGE_KEY, 'primary'],
      [STAGING_KEY, 'staging'],
      [BACKUP_KEY, 'backup'],
      ...LEGACY_STORAGE_KEYS.map(key => [key, 'legacy'])
    ];
    const valid = [];
    const errors = [];
    for (const [key, source] of candidates) {
      const raw = this.storage?.getItem(key);
      if (!raw) continue;
      const decoded = decodeRecord(raw, this.now());
      if (decoded.ok) valid.push({ ...decoded, key, source });
      else errors.push({ key, source, reason: decoded.reason });
    }
    if (!valid.length) {
      this.lastLoadStatus = { source: 'none', recovered: false, errors };
      return null;
    }
    valid.sort((a, b) => compareRecords(b.record, a.record));
    const chosen = valid[0];
    const recovered = chosen.source !== 'primary' || errors.some(error => error.source === 'primary');
    this.lastLoadStatus = { source: chosen.source, recovered, errors };
    if (recovered || chosen.record.schemaVersion !== SCHEMA_VERSION) this.#repairPrimary(chosen.record);
    return chosen.record;
  }

  save(state, { writerId = null, expectedRevision = null } = {}) {
    const now = this.now();
    const current = this.load();
    if (Number.isFinite(expectedRevision) && (current?.revision ?? 0) !== Number(expectedRevision)) {
      return { ok: false, conflict: true, record: current };
    }
    const record = normalizeRecord({
      ...state,
      schemaVersion: SCHEMA_VERSION,
      revision: (current?.revision ?? 0) + 1,
      writerId: writerId ?? state.writerId ?? null,
      updatedAt: now,
      commitId: `${now}-${randomToken()}`
    }, now);
    const validation = validateRecord(record);
    if (!validation.ok) return { ok: false, conflict: false, record: current, error: new Error(validation.reason) };
    let encoded = encodeRecord(record);
    try {
      // Old uncompressed radar snapshots can consume the entire origin quota.
      // Remove expendable copies before committing the compact v6 record.
      this.storage?.removeItem(STAGING_KEY);
      this.storage?.removeItem(BACKUP_KEY);
      for (const key of LEGACY_STORAGE_KEYS) this.storage?.removeItem(key);
      this.storage?.setItem(STAGING_KEY, encoded);
      const staged = decodeRecord(this.storage?.getItem(STAGING_KEY), now);
      if (!staged.ok || staged.record.commitId !== record.commitId) throw new Error('Staging verification failed.');
      const primaryRaw = this.storage?.getItem(STORAGE_KEY);
      const primary = decodeRecord(primaryRaw, now);
      this.storage?.setItem(STORAGE_KEY, encoded);
      // Keep a backup only after the primary succeeds. If quota is tight, primary wins.
      if (primary.ok) { try { this.storage?.setItem(BACKUP_KEY, encodeRecord(primary.record)); } catch {} }
      const committed = decodeRecord(this.storage?.getItem(STORAGE_KEY), now);
      if (!committed.ok || committed.record.commitId !== record.commitId) throw new Error('Primary commit verification failed.');
      this.storage?.removeItem(STAGING_KEY);
      for (const key of LEGACY_STORAGE_KEYS) this.storage?.removeItem(key);
      this.#writeHealth({ lastSuccessfulUpdate: now, lastRevision: record.revision, lastWriterId: record.writerId, recoverySource: this.lastLoadStatus.source });
    } catch (error) {
      console.warn('[weather-sim] Unable to atomically persist shared world state.', error);
      return { ok: false, conflict: false, record: current, error };
    }
    return { ok: true, conflict: false, record };
  }

  acquireAuthorityLease(ownerId, { ttlMs = DEFAULT_LEASE_MS, force = false } = {}) {
    if (!ownerId) return false;
    const now = this.now();
    try {
      const current = this.readAuthorityLease();
      if (!force && current && current.ownerId !== ownerId && current.expiresAt > now) return false;
      const lease = {
        ownerId,
        token: current?.ownerId === ownerId ? current.token : randomToken(),
        epoch: current?.ownerId === ownerId ? current.epoch : Math.max(0, Number(current?.epoch) || 0) + 1,
        acquiredAt: current?.ownerId === ownerId ? current.acquiredAt : now,
        renewedAt: now,
        expiresAt: now + Math.max(1_000, Number(ttlMs) || DEFAULT_LEASE_MS)
      };
      this.storage?.setItem(LEASE_KEY, JSON.stringify(lease));
      const verified = this.readAuthorityLease();
      const owns = verified?.ownerId === ownerId && verified?.token === lease.token && verified.expiresAt > now;
      if (owns) this.#writeHealth({ authorityOwnerId: ownerId, leaseExpiresAt: verified.expiresAt, leaseEpoch: verified.epoch });
      return owns;
    } catch (error) {
      console.warn('[weather-sim] Unable to acquire authority lease.', error);
      return false;
    }
  }

  renewAuthorityLease(ownerId, { ttlMs = DEFAULT_LEASE_MS } = {}) {
    return this.acquireAuthorityLease(ownerId, { ttlMs, force: false });
  }

  releaseAuthorityLease(ownerId) {
    try {
      const current = this.readAuthorityLease();
      if (current?.ownerId === ownerId) {
        this.storage?.removeItem(LEASE_KEY);
        this.#writeHealth({ authorityOwnerId: null, leaseExpiresAt: null });
      }
    } catch {}
  }

  readAuthorityLease() {
    try {
      const raw = this.storage?.getItem(LEASE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.ownerId || !parsed?.token || !Number.isFinite(parsed.expiresAt)) return null;
      return parsed;
    } catch { return null; }
  }

  getHealth() {
    const state = this.load();
    const lease = this.readAuthorityLease();
    let persisted = {};
    try { persisted = JSON.parse(this.storage?.getItem(HEALTH_KEY) ?? '{}'); } catch {}
    return {
      ...persisted,
      schemaVersion: SCHEMA_VERSION,
      stateRevision: state?.revision ?? 0,
      simulationHourUtc: state?.validHourUtc ?? null,
      stateUpdatedAt: state?.updatedAt ?? null,
      authorityOwnerId: lease?.ownerId ?? null,
      leaseExpiresAt: lease?.expiresAt ?? null,
      leaseEpoch: lease?.epoch ?? null,
      leaseExpired: Boolean(lease && lease.expiresAt <= this.now()),
      recovery: { ...this.lastLoadStatus }
    };
  }

  clear() {
    try {
      for (const key of [STORAGE_KEY, STAGING_KEY, BACKUP_KEY, LEASE_KEY, HEALTH_KEY, ...LEGACY_STORAGE_KEYS]) this.storage?.removeItem(key);
    } catch {}
  }

  #repairPrimary(record) {
    try {
      const normalized = normalizeRecord(record, this.now());
      this.storage?.removeItem(STAGING_KEY);
      this.storage?.removeItem(BACKUP_KEY);
      for (const key of LEGACY_STORAGE_KEYS) this.storage?.removeItem(key);
      this.storage?.setItem(STORAGE_KEY, encodeRecord(normalized));
      try { this.storage?.setItem(BACKUP_KEY, encodeRecord(normalized)); } catch {}
    } catch (error) { console.warn('[weather-sim] Unable to repair shared world state.', error); }
  }

  #writeHealth(patch) {
    try {
      let current = {};
      try { current = JSON.parse(this.storage?.getItem(HEALTH_KEY) ?? '{}'); } catch {}
      this.storage?.setItem(HEALTH_KEY, JSON.stringify({ ...current, ...patch, checkedAt: this.now() }));
    } catch {}
  }
}

function decodeRecord(raw, now) {
  if (!raw) return { ok: false, reason: 'missing' };
  try {
    const envelope = JSON.parse(raw);
    const payload = envelope?.payload ?? envelope;
    if (envelope?.payload && envelope.checksum !== checksum(stableStringify(payload))) return { ok: false, reason: 'checksum mismatch' };
    const record = normalizeRecord(payload, now);
    const validation = validateRecord(record);
    return validation.ok ? { ok: true, record } : { ok: false, reason: validation.reason };
  } catch (error) { return { ok: false, reason: error?.message ?? 'invalid json' }; }
}

function encodeRecord(record) {
  const payload = normalizeRecord(record, Number(record.updatedAt) || Date.now());
  return JSON.stringify({ checksum: checksum(stableStringify(payload)), payload });
}

function normalizeRecord(value, now) {
  const version = Number(value?.schemaVersion) || 1;
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: Math.max(0, Number(value?.revision) || 0),
    commitId: typeof value?.commitId === 'string' ? value.commitId : `migrated-${Number(value?.updatedAt) || now}-${Math.max(0, Number(value?.revision) || 0)}`,
    writerId: typeof value?.writerId === 'string' ? value.writerId : null,
    currentSeed: Number(value?.currentSeed),
    validHourUtc: Number(value?.validHourUtc),
    systemStartHour: Number.isFinite(Number(value?.systemStartHour)) ? Number(value.systemStartHour) : Number(value?.validHourUtc),
    systemNumber: Math.max(1, Number(value?.systemNumber) || 1),
    upcomingSeed: Number.isFinite(Number(value?.upcomingSeed)) ? Number(value.upcomingSeed) : null,
    upcomingHandoffHour: Number.isFinite(Number(value?.upcomingHandoffHour)) ? Number(value.upcomingHandoffHour) : null,
    authorityRealTimestamp: Number.isFinite(Number(value?.authorityRealTimestamp)) ? Number(value.authorityRealTimestamp) : Number(value?.updatedAt) || now,
    productArchive: normalizeArchive(value?.productArchive),
    forecastProducts: normalizeProducts(value?.forecastProducts),
    radarSnapshot: normalizeRadarSnapshot(value?.radarSnapshot),
    updatedAt: Number(value?.updatedAt) || now,
    migratedFromSchema: version === SCHEMA_VERSION ? null : version
  };
}

function validateRecord(record) {
  if (!record || record.schemaVersion !== SCHEMA_VERSION) return { ok: false, reason: 'unsupported schema' };
  for (const key of ['currentSeed', 'validHourUtc', 'systemStartHour', 'systemNumber', 'authorityRealTimestamp', 'updatedAt', 'revision']) {
    if (!Number.isFinite(record[key])) return { ok: false, reason: `invalid ${key}` };
  }
  if (record.systemNumber < 1 || record.revision < 0) return { ok: false, reason: 'negative sequence value' };
  if (record.validHourUtc + 1e-6 < record.systemStartHour) return { ok: false, reason: 'simulation time precedes system start' };
  if (!record.forecastProducts || typeof record.forecastProducts !== 'object') return { ok: false, reason: 'invalid forecast products' };
  if (!record.productArchive || !['day1', 'day2', 'day3'].every(key => Array.isArray(record.productArchive[key]))) return { ok: false, reason: 'invalid product archive' };
  return { ok: true };
}

function compareRecords(a, b) {
  return (Number(a.revision) - Number(b.revision)) || (Number(a.updatedAt) - Number(b.updatedAt));
}

function normalizeRadarSnapshot(value) {
  if (!value || typeof value !== 'object') return null;
  if (![value.domainWidthKm, value.domainHeightKm, value.validHourUtc].every(Number.isFinite)) return null;
  const storms = Array.isArray(value.storms) ? value.storms.slice(-80).map(storm => {
    if (!storm || typeof storm !== 'object') return storm;
    const raw = storm.internalField;
    if (!raw) return { ...storm, internalField: null };
    const hydrated = hydrateStormInternalField(raw);
    const { environment, ...compact } = storm;
    return { ...compact, internalField: isStormInternalFieldValid(hydrated) ? serializeStormInternalField(hydrated) : null };
  }) : [];
  return { ...value, storms };
}

function normalizeProducts(value) {
  const products = {};
  for (const key of ['day1', 'day2', 'day3']) {
    const item = value?.[key];
    if (!item || typeof item !== 'object') continue;
    const normalized = normalizeProduct(item, key);
    if (normalized) products[key] = normalized;
  }
  return products;
}

function normalizeProduct(item, key) {
  const issuedHourUtc = Number(item.issuedHourUtc);
  const validStartHour = Number(item.validStartHour);
  const validEndHour = Number(item.validEndHour);
  if (![issuedHourUtc, validStartHour, validEndHour].every(Number.isFinite)) return null;
  const sourceWorldRevision = Math.max(0, Number(item.sourceWorldRevision) || 0);
  const sourceSystemNumber = Math.max(1, Number(item.sourceSystemNumber ?? item.systemNumber) || 1);
  return {
    ...item, key, productSchemaVersion: Math.max(1, Number(item.productSchemaVersion) || 1),
    cycleId: typeof item.cycleId === 'string' ? item.cycleId : `${key}-legacy-${issuedHourUtc}-${sourceSystemNumber}`,
    issuedHourUtc, validStartHour, validEndHour, sourceWorldRevision, sourceSystemNumber,
    currentSeed: Number.isFinite(Number(item.currentSeed)) ? Number(item.currentSeed) : null,
    upcomingSeed: Number.isFinite(Number(item.upcomingSeed)) ? Number(item.upcomingSeed) : null,
    frozen: true
  };
}

function normalizeArchive(value) {
  const archive = { day1: [], day2: [], day3: [] };
  for (const key of Object.keys(archive)) {
    if (!Array.isArray(value?.[key])) continue;
    archive[key] = value[key].slice(-24).map(item => normalizeProduct(item, key)).filter(Boolean);
  }
  return archive;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function checksum(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function randomToken() { return globalThis.crypto?.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}-${Date.now()}`; }

export const WORLD_STATE_STORAGE_KEY = STORAGE_KEY;
export const WORLD_STATE_STAGING_KEY = STAGING_KEY;
export const WORLD_STATE_BACKUP_KEY = BACKUP_KEY;
export const WORLD_AUTHORITY_LEASE_KEY = LEASE_KEY;
export const WORLD_STATE_HEALTH_KEY = HEALTH_KEY;
export const WORLD_STATE_SCHEMA_VERSION = SCHEMA_VERSION;

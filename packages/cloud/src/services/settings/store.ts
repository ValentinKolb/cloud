/**
 * Settings store — Redis cache-aside read/write primitives.
 *
 * Pattern: each key is cached in Redis with a 5-minute TTL. Reads try Redis
 * first, fall back to DB on miss, and populate Redis. Writes update DB and
 * delete the Redis key (next reader repopulates with fresh DB state).
 *
 * This achieves cross-container coherence without polling or pubsub: a write
 * in container A invalidates the shared Redis cache; container B's next read
 * hits Redis (miss after del), goes to DB, sees the new value, repopulates.
 *
 * Reads/writes here are async — sync callers should use the per-request
 * snapshot exposed via `c.get("settings")` (built by snapshot.ts middleware).
 */

import { redis, sql } from "bun";
import { decryptValue, encryptValue } from "./crypto";
import { SETTINGS, SETTINGS_MAP, validateSettingValue, type SettingDef } from "./defaults";
import { toPgTextArray } from "../postgres";

const REDIS_KEY = (k: string) => `settings:${k}`;
const REDIS_TTL_SEC = 300;

type StoredRow = { key: string; value: string };

/**
 * Resolve the env-fallback or default value for a key whose DB row is missing
 * or invalid. Mirrors the existing `resolve()` logic in services/settings/index.ts
 * but takes a SettingDef directly (no global state).
 */
const resolveFallback = (def: SettingDef | undefined): unknown => {
  if (!def) return undefined;
  const raw = def.envFallback?.();
  if (raw !== undefined) {
    const validated = validateSettingValue(def, raw);
    if (validated.ok) return validated.value;
  }
  return def.default;
};

/**
 * Read a single setting key. Tries Redis first, falls back to DB.
 * On DB hit, populates Redis with TTL. On miss, returns env-fallback or default.
 */
export const readKey = async (key: string): Promise<unknown> => {
  const def = SETTINGS_MAP.get(key);

  const cached = await redis.get(REDIS_KEY(key));
  if (cached !== null) {
    try {
      return JSON.parse(cached);
    } catch {
      // Corrupt cache entry — drop and re-read from DB.
      await redis.del(REDIS_KEY(key));
    }
  }

  const rows = await sql<StoredRow[]>`SELECT value FROM settings.entries WHERE key = ${key}`;
  if (rows.length > 0 && rows[0]) {
    try {
      const decrypted = await decryptValue(rows[0].value);
      if (def) {
        const validated = validateSettingValue(def, decrypted);
        if (validated.ok) {
          await redis.set(REDIS_KEY(key), JSON.stringify(validated.value), "EX", REDIS_TTL_SEC);
          return validated.value;
        }
      } else {
        // No def known — still cache the decrypted value (caller's responsibility to interpret).
        await redis.set(REDIS_KEY(key), JSON.stringify(decrypted), "EX", REDIS_TTL_SEC);
        return decrypted;
      }
    } catch {
      // Decryption failure — legacy row encrypted with a different APP_SECRET.
      // Skip silently and fall through to env/default fallback.
    }
  }

  return resolveFallback(def);
};

/**
 * Bulk read for snapshot construction. One Redis MGET round-trip, DB fallback
 * for misses (single SELECT with key = ANY), populates Redis for missed keys.
 *
 * Returns a Map keyed by the input keys; every input key is present in the
 * result (with env-fallback or default as last resort).
 */
export const bulkRead = async (keys: readonly string[]): Promise<Map<string, unknown>> => {
  const result = new Map<string, unknown>();
  if (keys.length === 0) return result;

  // 1. Redis MGET — one round-trip
  const cached = await redis.mget(...keys.map(REDIS_KEY));
  const missing: string[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i]!;
    const c = cached[i];
    if (c !== null && c !== undefined) {
      try {
        result.set(k, JSON.parse(c));
        continue;
      } catch {
        // Drop corrupt cache entry, treat as missing.
      }
    }
    missing.push(k);
  }

  // 2. Fetch missing from DB in one query (Bun sql can't serialize JS arrays
  // for ANY(), so we hand-build the Postgres TEXT[] literal).
  if (missing.length > 0) {
    const rows = await sql<StoredRow[]>`SELECT key, value FROM settings.entries WHERE key = ANY(${toPgTextArray(missing)}::text[])`;
    for (const row of rows) {
      try {
        const decrypted = await decryptValue(row.value);
        const def = SETTINGS_MAP.get(row.key);
        if (def) {
          const validated = validateSettingValue(def, decrypted);
          if (validated.ok) {
            result.set(row.key, validated.value);
            await redis.set(REDIS_KEY(row.key), JSON.stringify(validated.value), "EX", REDIS_TTL_SEC);
          }
        } else {
          result.set(row.key, decrypted);
          await redis.set(REDIS_KEY(row.key), JSON.stringify(decrypted), "EX", REDIS_TTL_SEC);
        }
      } catch {
        // Legacy row with mismatched key — silent skip.
      }
    }
  }

  // 3. Apply env-fallback / default for keys that are still missing
  for (const k of keys) {
    if (!result.has(k)) {
      result.set(k, resolveFallback(SETTINGS_MAP.get(k)));
    }
  }

  return result;
};

/**
 * Get every known setting key (across all registered defs).
 * Used by snapshot loader to determine what to bulk-read.
 */
export const allKnownKeys = (): string[] => SETTINGS.map((d) => d.key);

/**
 * Encrypt the value, upsert the DB row, invalidate the Redis key.
 *
 * Validation is the caller's responsibility — the typed wrapper API
 * (createSettingsAPI) validates against the declared SettingDef before reaching
 * here. Direct callers must ensure the value matches the setting's kind.
 */
export const writeKey = async (key: string, value: unknown): Promise<void> => {
  const def = SETTINGS_MAP.get(key);
  if (!def) throw new Error(`Unknown setting: ${key}`);
  const validated = validateSettingValue(def, value);
  if (!validated.ok) throw new Error(validated.error);

  const encrypted = await encryptValue(validated.value);
  await sql`
    INSERT INTO settings.entries (key, value, updated_at)
    VALUES (${key}, ${encrypted}, now())
    ON CONFLICT (key)
    DO UPDATE SET value = ${encrypted}, updated_at = now()
  `;

  // Invalidate the cache so other containers re-read on next access.
  await redis.del(REDIS_KEY(key));
};

/** Delete the DB row and invalidate Redis. */
export const deleteKey = async (key: string): Promise<void> => {
  await sql`DELETE FROM settings.entries WHERE key = ${key}`;
  await redis.del(REDIS_KEY(key));
};

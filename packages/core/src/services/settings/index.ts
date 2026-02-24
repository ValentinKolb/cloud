/**
 * Settings service — runtime-configurable settings backed by Postgres.
 *
 * Resolution order: DB value → env var → code default.
 *
 * Uses a simple in-memory cache (single-process, settings change rarely).
 * Cache is loaded once at startup; set/remove update both DB and cache.
 */

import { sql } from "bun";
import { SETTINGS, SETTINGS_MAP, type SettingDef } from "./defaults";

// ── Cache ──────────────────────────────────────────────────────────────

let cache: Map<string, unknown> = new Map();

/** Load all settings from DB into cache. Call once at startup. */
export async function loadCache(): Promise<void> {
  const rows: Array<{ key: string; value: unknown }> = await sql`SELECT key, value FROM settings.entries`;
  cache = new Map(
    rows.map((r) => {
      // Bun sql may return JSONB as raw JSON string — parse if needed
      const val = typeof r.value === "string" ? tryParseJson(r.value) : r.value;
      return [r.key, val];
    }),
  );
}

/**
 * Safely parses cached JSON values and falls back to the raw string on parse errors.
 */
function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// ── Public API ─────────────────────────────────────────────────────────

/** Resolve a setting value synchronously from cache/env/default. */
function resolve<T>(key: string): T {
  // 1. Cache (reflects DB)
  if (cache.has(key)) return cache.get(key) as T;

  // 2. Env var fallback
  const def = SETTINGS_MAP.get(key);
  if (def) {
    return def.default as T;
  }

  return undefined as T;
}

/** Get a setting value. Resolution: cache (DB) → env var → code default. */
export async function get<T = unknown>(key: string): Promise<T> {
  return resolve<T>(key);
}

/** Synchronous variant of get(). Safe to call after loadCache() has completed. */
export function getSync<T = unknown>(key: string): T {
  return resolve<T>(key);
}

/** Set a setting value (write-through: DB + cache). */
export async function set(key: string, value: unknown): Promise<void> {
  const jsonText = JSON.stringify(value);
  await sql`
    INSERT INTO settings.entries (key, value, updated_at)
    VALUES (${key}, ${jsonText}::jsonb, now())
    ON CONFLICT (key)
    DO UPDATE SET value = ${jsonText}::jsonb, updated_at = now()
  `;
  cache.set(key, value);
}

/** Delete a setting from DB (reverts to env/default). */
export async function remove(key: string): Promise<void> {
  await sql`DELETE FROM settings.entries WHERE key = ${key}`;
  cache.delete(key);
}

export type SettingEntry = {
  key: string;
  type: SettingDef["type"];
  description: string;
  placeholder?: string;
  group: string;
  /** Current resolved value */
  value: unknown;
  /** Code default */
  default: unknown;
  /** Whether value comes from DB (vs env/default) */
  isCustom: boolean;
  /** Available template variables */
  templateVars?: string[];
};

/** Get all settings with current values and metadata (for admin UI). */
export async function getAll(): Promise<SettingEntry[]> {
  return Promise.all(
    SETTINGS.map(async (def) => {
      const isCustom = cache.has(def.key);
      const value = await get(def.key);
      return {
        key: def.key,
        type: def.type,
        description: def.description,
        placeholder: def.placeholder,
        group: def.group,
        value,
        default: def.default,
        isCustom,
        templateVars: def.templateVars,
      };
    }),
  );
}

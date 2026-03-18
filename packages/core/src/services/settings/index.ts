/**
 * Settings service — runtime-configurable settings backed by Postgres.
 *
 * Resolution order: DB value -> env fallback -> code default.
 *
 * Custom DB values are encrypted at rest using APP_SECRET.
 * Cache is loaded once at startup; set/remove update both DB and cache.
 */

import { sql } from "bun";
import { env } from "@valentinkolb/cloud-core/config/env";
import { crypto } from "@valentinkolb/cloud-lib/server/services";
import { toPgTextArray } from "../postgres";
import {
  LEGACY_SETTING_MIGRATIONS,
  SETTINGS,
  SETTINGS_MAP,
  getSettingLabel,
  type SettingDef,
  type SettingKind,
  type SettingOption,
  validateSettingValue,
} from "./defaults";

let cache: Map<string, unknown> = new Map();

type StoredRow = { key: string; value: string };
type PendingRow = { key: string; value: unknown; rewrite: boolean; existed: boolean };
type NormalizationStats = {
  encryptedLoaded: number;
  legacyReencrypted: number;
  normalizedUpdated: number;
  envBootstrapped: number;
  keyMigrated: number;
  invalidSkipped: number;
};

const getAppSecret = (): string => {
  const secret = env.APP_SECRET.trim();
  if (!secret) {
    throw new Error("APP_SECRET is required to read or write encrypted settings");
  }
  return secret;
};

const parseJsonValue = (value: string): unknown => JSON.parse(value);

const isEqual = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const resolveEnvValue = (def: SettingDef | undefined, mode: "fallback" | "bootstrap"): unknown => {
  const raw = mode === "fallback" ? def?.envFallback?.() : def?.envBootstrap?.();
  if (!def || raw === undefined) return undefined;

  const validated = validateSettingValue(def, raw);
  if (!validated.ok) {
    console.warn(`[settings] ignoring invalid ${mode} value for "${def.key}": ${validated.error}`);
    return undefined;
  }

  return validated.value;
};

const shouldBootstrapValue = (def: SettingDef, value: unknown): boolean => {
  if (value === undefined || value === null) return false;

  switch (def.kind) {
    case "boolean":
      return value === true;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string_list":
    case "number_list":
      return Array.isArray(value) && value.length > 0;
    default:
      return typeof value === "string" && value.trim().length > 0;
  }
};

const encryptValue = async (value: unknown): Promise<string> =>
  crypto.symmetric.encrypt({
    payload: JSON.stringify(value),
    key: getAppSecret(),
    stretched: false,
  });

const decryptValue = async (value: string): Promise<unknown> => {
  const decrypted = await crypto.symmetric.decrypt({
    payload: value,
    key: getAppSecret(),
  });
  return parseJsonValue(decrypted);
};

const upsertEncryptedRow = async (key: string, value: unknown): Promise<void> => {
  const encryptedValue = await encryptValue(value);
  await sql`
    INSERT INTO settings.entries (key, value, updated_at)
    VALUES (${key}, ${encryptedValue}, now())
    ON CONFLICT (key)
    DO UPDATE SET value = ${encryptedValue}, updated_at = now()
  `;
};

const normalizeStoredEntries = async (): Promise<{ rows: Array<{ key: string; value: unknown }>; stats: NormalizationStats }> => {
  const rows = await sql<StoredRow[]>`SELECT key, value FROM settings.entries`;
  const stats: NormalizationStats = {
    encryptedLoaded: 0,
    legacyReencrypted: 0,
    normalizedUpdated: 0,
    envBootstrapped: 0,
    keyMigrated: 0,
    invalidSkipped: 0,
  };
  const pendingRows = new Map<string, PendingRow>();
  const keysToDelete = new Set<string>();

  for (const row of rows) {
    try {
      const value = await decryptValue(row.value);
      pendingRows.set(row.key, { key: row.key, value, rewrite: false, existed: true });
      stats.encryptedLoaded += 1;
      continue;
    } catch {
      try {
        const value = parseJsonValue(row.value);
        pendingRows.set(row.key, { key: row.key, value, rewrite: true, existed: true });
        stats.legacyReencrypted += 1;
      } catch {
        console.warn(`[settings] skipping invalid stored value for "${row.key}"`);
        stats.invalidSkipped += 1;
      }
    }
  }

  for (const migration of LEGACY_SETTING_MIGRATIONS) {
    const legacyRow = pendingRows.get(migration.from);
    if (!legacyRow) continue;

    if (!pendingRows.has(migration.to)) {
      pendingRows.set(migration.to, {
        key: migration.to,
        value: legacyRow.value,
        rewrite: true,
        existed: false,
      });
    }

    if (migration.from !== migration.to) {
      pendingRows.delete(migration.from);
      keysToDelete.add(migration.from);
      stats.keyMigrated += 1;
    }
  }

  const normalized: Array<{ key: string; value: unknown }> = [];

  for (const [key, row] of pendingRows.entries()) {
    const def = SETTINGS_MAP.get(key);
    if (!def) {
      console.warn(`[settings] skipping unknown stored key "${key}"`);
      stats.invalidSkipped += 1;
      continue;
    }

    const validated = validateSettingValue(def, row.value);
    if (!validated.ok) {
      console.warn(`[settings] skipping invalid value for "${key}": ${validated.error}`);
      stats.invalidSkipped += 1;
      continue;
    }

    normalized.push({ key, value: validated.value });

    if (row.rewrite || !row.existed || !isEqual(row.value, validated.value)) {
      await upsertEncryptedRow(key, validated.value);
      stats.normalizedUpdated += 1;
    }
  }

  if (keysToDelete.size > 0) {
    await sql`DELETE FROM settings.entries WHERE key = ANY(${toPgTextArray(Array.from(keysToDelete))}::text[])`;
  }

  return { rows: normalized, stats };
};

const bootstrapEnvBackedEntries = async (config: {
  rows: Array<{ key: string; value: unknown }>;
  stats: NormalizationStats;
}): Promise<Array<{ key: string; value: unknown }>> => {
  const rowsByKey = new Map(config.rows.map((row) => [row.key, row.value]));

  for (const def of SETTINGS) {
    if (rowsByKey.has(def.key)) continue;

    const envValue = resolveEnvValue(def, "bootstrap");
    if (!shouldBootstrapValue(def, envValue)) continue;

    await upsertEncryptedRow(def.key, envValue);
    rowsByKey.set(def.key, envValue);
    config.stats.envBootstrapped += 1;
  }

  return [...rowsByKey.entries()].map(([key, value]) => ({ key, value }));
};

/** Load all settings from DB into cache. Call once at startup. */
export async function loadCache(): Promise<void> {
  getAppSecret();
  const { rows, stats } = await normalizeStoredEntries();
  const bootstrappedRows = await bootstrapEnvBackedEntries({ rows, stats });
  cache = new Map(bootstrappedRows.map((row) => [row.key, row.value]));

  console.log(
    `[settings] loaded ${bootstrappedRows.length} custom setting(s) (${stats.encryptedLoaded} encrypted, ${stats.legacyReencrypted} legacy re-encrypted, ${stats.normalizedUpdated} normalized, ${stats.keyMigrated} migrated, ${stats.envBootstrapped} env-bootstrapped, ${stats.invalidSkipped} skipped)`,
  );
}

function resolve<T>(key: string): T {
  if (cache.has(key)) return cache.get(key) as T;

  const def = SETTINGS_MAP.get(key);
  const envFallback = resolveEnvValue(def, "fallback");
  if (envFallback !== undefined) {
    return envFallback as T;
  }

  if (def) {
    return def.default as T;
  }

  return undefined as T;
}

export async function get<T = unknown>(key: string): Promise<T> {
  return resolve<T>(key);
}

export function getSync<T = unknown>(key: string): T {
  return resolve<T>(key);
}

export async function set(key: string, value: unknown): Promise<void> {
  const def = SETTINGS_MAP.get(key);
  if (!def) {
    throw new Error(`Unknown setting: ${key}`);
  }

  const validated = validateSettingValue(def, value);
  if (!validated.ok) {
    throw new Error(validated.error);
  }

  await upsertEncryptedRow(key, validated.value);
  cache.set(key, validated.value);
}

export async function remove(key: string): Promise<void> {
  await sql`DELETE FROM settings.entries WHERE key = ${key}`;
  cache.delete(key);
}

export type SettingEntry = {
  key: string;
  label: string;
  kind: SettingKind;
  description: string;
  placeholder?: string;
  group: string;
  value: unknown;
  default: unknown;
  isCustom: boolean;
  templateVars?: string[];
  options?: SettingOption[];
  min?: number;
  max?: number;
};

export async function getAll(): Promise<SettingEntry[]> {
  return Promise.all(
    SETTINGS.map(async (def) => {
      const isCustom = cache.has(def.key);
      const value = await get(def.key);
      return {
        key: def.key,
        label: getSettingLabel(def),
        kind: def.kind,
        description: def.description,
        placeholder: def.placeholder,
        group: def.group,
        value,
        default: def.default,
        isCustom,
        templateVars: "templateVars" in def ? def.templateVars : undefined,
        options: "options" in def ? def.options : undefined,
        min: "min" in def ? def.min : undefined,
        max: "max" in def ? def.max : undefined,
      };
    }),
  );
}

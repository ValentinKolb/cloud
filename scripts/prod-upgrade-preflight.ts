import { RedisClient } from "bun";
import { assessRuntimeCompatibility } from "../packages/cloud/src/_internal/runtime-compatibility";
import type { AppRegistryEntry } from "../packages/cloud/src/contracts/registry";

const COMPOSE_FILE = "compose.prod.yml";
const APP_REGISTRY_STATE_KEY = "sync:e:default:cloud-apps:state";
const MAX_SYNC_KEYS = 10_000;
const LEGACY_CLOUD_SYNC_PREFIXES = [
  "cloud:contacts:events",
  "cloud:grids:events",
  "cloud:grids:workflow-events",
  "cloud:grids:workflow-runs",
  "cloud:grids:workflows",
  "cloud:gateway:telemetry",
  "cloud:mail:events",
  "cloud:notebooks",
  "cloud:notifications:live",
  "cloud:spaces:events",
] as const;

export type SyncKeyInventory = {
  currentDurable: string[];
  legacyDurable: string[];
  preservedScheduler: string[];
  nonDurable: string[];
  other: string[];
};

export type SyncStateAnalysis = {
  inventory: SyncKeyInventory;
  runtimeIssues: ReturnType<typeof assessRuntimeCompatibility>;
  failures: string[];
};

export const classifySyncKeys = (keys: readonly string[]): SyncKeyInventory => {
  const inventory: SyncKeyInventory = {
    currentDurable: [],
    legacyDurable: [],
    preservedScheduler: [],
    nonDurable: [],
    other: [],
  };
  for (const key of [...keys].sort()) {
    if (LEGACY_CLOUD_SYNC_PREFIXES.some((prefix) => key.startsWith(`${prefix}:`))) {
      inventory.legacyDurable.push(key);
    } else if (key.startsWith("sync:e:") || key.startsWith("sync:mutex:") || key.startsWith("sync:ratelimit:")) {
      inventory.nonDurable.push(key);
    } else if (key.startsWith("sync:scheduler:") && !key.startsWith("sync:scheduler:namespace:v4:")) {
      inventory.preservedScheduler.push(key);
    } else if (
      key.startsWith("sync:queue:namespace:v2:") ||
      key.startsWith("sync:topic:namespace:v2:") ||
      key.startsWith("sync:pump:namespace:v2:") ||
      key.startsWith("sync:scheduler:namespace:v4:") ||
      key.startsWith("sync:job:claim:v2:") ||
      key.startsWith("sync:job:enqueue-receipt:v2:") ||
      /^sync:job:.+:seq$/.test(key)
    ) {
      inventory.currentDurable.push(key);
    } else if (
      key.startsWith("sync:queue:") ||
      key.startsWith("sync:topic:") ||
      key.startsWith("sync:pump:") ||
      key.startsWith("sync:job:queue:") ||
      (key.startsWith("sync:job:") && key.includes(":idempotency:")) ||
      key.startsWith("sync:scheduler-control:")
    ) {
      inventory.legacyDurable.push(key);
    } else {
      inventory.other.push(key);
    }
  }
  return inventory;
};

const asPairs = (raw: unknown): Array<[string, string]> => {
  if (Array.isArray(raw)) {
    const pairs: Array<[string, string]> = [];
    for (let index = 0; index + 1 < raw.length; index += 2) pairs.push([String(raw[index]), String(raw[index + 1])]);
    return pairs;
  }
  if (raw && typeof raw === "object") return Object.entries(raw).map(([key, value]) => [key, String(value)]);
  return [];
};

export const parseAppRegistryState = (raw: unknown, now = Date.now()): { apps: AppRegistryEntry[]; invalid: string[] } => {
  const apps: AppRegistryEntry[] = [];
  const invalid: string[] = [];
  for (const [key, encoded] of asPairs(raw)) {
    try {
      const stored = JSON.parse(encoded) as { dataJson?: unknown; data?: unknown; expiresAt?: unknown };
      if (typeof stored.expiresAt === "number" && stored.expiresAt <= now) continue;
      const value = typeof stored.dataJson === "string" ? JSON.parse(stored.dataJson) : stored.data;
      if (!value || typeof value !== "object" || typeof value.id !== "string") throw new Error("missing app value");
      apps.push(value as AppRegistryEntry);
    } catch (error) {
      invalid.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { apps, invalid };
};

export const analyzeSyncState = (
  keys: readonly string[],
  apps: readonly AppRegistryEntry[],
  invalidRegistryRecords: readonly string[] = [],
): SyncStateAnalysis => {
  const inventory = classifySyncKeys(keys);
  const runtimeIssues = assessRuntimeCompatibility(apps);
  const failures: string[] = [];
  if (inventory.legacyDurable.length > 0) failures.push("Legacy durable Sync keys require an operator-reviewed drain or cleanup.");
  if (invalidRegistryRecords.length > 0) failures.push(`Invalid app registry records: ${invalidRegistryRecords.join("; ")}`);
  failures.push(...runtimeIssues.filter((issue) => issue.severity === "error").map((issue) => issue.message));
  return { inventory, runtimeIssues, failures };
};

export const findReleaseMismatches = (apps: readonly AppRegistryEntry[], expectedRelease: string): string[] =>
  apps.filter((app) => app.runtime?.release !== expectedRelease).map((app) => `${app.id}=${app.runtime?.release ?? "unknown"}`);

const run = async (command: string[]): Promise<string> => {
  const child = Bun.spawn(command, { cwd: import.meta.dir + "/..", env: processEnv(), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed: ${stderr.trim() || `exit ${exitCode}`}`);
  return stdout.trim();
};

const processEnv = (): Record<string, string> => {
  const entries = Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined);
  return Object.fromEntries(entries);
};

const scanSyncKeys = async (redis: RedisClient): Promise<string[]> => {
  const keys = new Set<string>();
  let scans = 0;
  for (const pattern of ["sync:*", ...LEGACY_CLOUD_SYNC_PREFIXES.map((prefix) => `${prefix}:*`)]) {
    let cursor = "0";
    do {
      scans += 1;
      if (scans > 10_000) throw new Error("Redis Sync inventory exceeded the SCAN iteration safety limit");
      const raw = await redis.send("SCAN", [cursor, "MATCH", pattern, "COUNT", "1000"]);
      if (!Array.isArray(raw) || !Array.isArray(raw[1])) throw new Error("Redis returned an invalid SCAN response");
      cursor = String(raw[0]);
      for (const key of raw[1]) keys.add(String(key));
      if (keys.size > MAX_SYNC_KEYS) throw new Error(`Redis Sync inventory exceeds the ${MAX_SYNC_KEYS}-key safety limit`);
    } while (cursor !== "0");
  }
  return [...keys];
};

const printKeys = (label: string, keys: readonly string[]): void => {
  console.log(`${label}: ${keys.length}`);
  for (const key of keys) console.log(`  ${key}`);
};

export const main = async (): Promise<number> => {
  const expectedTag = process.env.CLOUD_IMAGE_TAG?.trim();
  if (!expectedTag || !/^sha-[0-9a-f]{7,40}$/.test(expectedTag)) {
    console.error("CLOUD_IMAGE_TAG must be an immutable sha-<git-sha> tag.");
    return 1;
  }
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    console.error("REDIS_URL is required for the read-only Sync inventory.");
    return 1;
  }

  const failures: string[] = [];
  let verifyExpectedRuntime = false;
  console.log(`Expected Cloud release: ${expectedTag}`);

  try {
    const images = (await run(["docker", "compose", "-f", COMPOSE_FILE, "config", "--images"])).split(/\r?\n/).filter(Boolean);
    const mismatched = images.filter((image) => !image.endsWith(`:${expectedTag}`));
    if (images.length === 0) failures.push("Production Compose rendered no runtime images.");
    if (mismatched.length > 0) failures.push(`Compose contains images outside ${expectedTag}: ${mismatched.join(", ")}`);
    console.log(`Compose images: ${images.length} on ${expectedTag}`);

    const containerIds = (await run(["docker", "compose", "-f", COMPOSE_FILE, "ps", "-q"])).split(/\r?\n/).filter(Boolean);
    if (containerIds.length > 0) {
      const runningImages = (await run(["docker", "inspect", "--format", "{{.Config.Image}}", ...containerIds]))
        .split(/\r?\n/)
        .filter(Boolean);
      const tags = new Set(runningImages.map((image) => image.slice(image.lastIndexOf(":") + 1)));
      verifyExpectedRuntime = tags.size === 1 && tags.has(expectedTag);
      console.log(`Running containers: ${containerIds.length}; image tags: ${[...tags].sort().join(", ")}`);
      if (tags.size > 1) failures.push(`Running Cloud containers use mixed image tags: ${[...tags].sort().join(", ")}`);
      if ([...tags].some((tag) => tag === "latest" || tag === "main")) failures.push("Running Cloud containers use a mutable image tag.");
    } else {
      console.log("Running containers: none (runtime version checks skipped)");
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  const redis = new RedisClient(redisUrl);
  try {
    const [keys, registryRaw] = await Promise.all([scanSyncKeys(redis), redis.send("HGETALL", [APP_REGISTRY_STATE_KEY])]);
    const registry = parseAppRegistryState(registryRaw);
    const analysis = analyzeSyncState(keys, registry.apps, registry.invalid);
    const { inventory } = analysis;
    printKeys("Current durable Sync keys", inventory.currentDurable);
    printKeys("Legacy durable Sync candidates", inventory.legacyDurable);
    printKeys("Preserved legacy scheduler keys", inventory.preservedScheduler);
    printKeys("Non-durable Sync keys", inventory.nonDurable);
    printKeys("Unclassified Sync keys", inventory.other);
    for (const app of registry.apps.sort((a, b) => a.id.localeCompare(b.id))) {
      console.log(`${app.id}: release ${app.runtime?.release ?? "unknown"}, @k2b/sync ${app.runtime?.syncVersion ?? "unknown"}`);
    }
    for (const issue of analysis.runtimeIssues) {
      console.log(`${issue.severity.toUpperCase()}: ${issue.message}`);
    }
    if (verifyExpectedRuntime) {
      const releaseMismatches = findReleaseMismatches(registry.apps, expectedTag);
      if (releaseMismatches.length > 0) {
        failures.push(`Apps do not report ${expectedTag}: ${releaseMismatches.join(", ")}`);
      }
    }
    failures.push(...analysis.failures);
  } catch (error) {
    failures.push(`Redis preflight failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    redis.close();
  }

  if (failures.length > 0) {
    console.error("\nPreflight blocked:");
    for (const failure of failures) console.error(`- ${failure}`);
    console.error("Create a Redis backup, then follow SYNC_5_9_MIGRATION.md. This command never changes Redis or containers.");
    return 1;
  }
  console.log("Preflight passed. Create a Redis backup before any manual migration step.");
  return 0;
};

if (import.meta.main) process.exitCode = await main();

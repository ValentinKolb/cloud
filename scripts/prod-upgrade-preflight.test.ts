import { describe, expect, test } from "bun:test";
import { analyzeSyncState, classifySyncKeys, findReleaseMismatches, parseAppRegistryState } from "./prod-upgrade-preflight";

const scriptSource = await Bun.file(new URL("./prod-upgrade-preflight.ts", import.meta.url)).text();

describe("production upgrade preflight", () => {
  test("contains no Redis or container mutation commands", () => {
    expect(scriptSource).not.toMatch(/redis\.send\("(?:DEL|FLUSHDB|FLUSHALL|SET|HSET|XADD|ZADD)"/);
    expect(scriptSource).not.toMatch(/"docker",\s*"compose"[^\n]+"(?:up|down|pull|stop|restart)"/);
  });

  test("separates current, legacy, preserved, and ephemeral Sync keys", () => {
    const result = classifySyncKeys([
      "sync:queue:namespace:v2:tenant:jobs:ready",
      "sync:job:enqueue-receipt:v2:tenant",
      "sync:job:mail:seq",
      "sync:queue:tenant:jobs:ready",
      "sync:job:mail:idempotency:message-1",
      "cloud:notebooks:default:snapshots:ready",
      "sync:scheduler:tenant:jobs:definitions",
      "sync:e:default:cloud-apps:state",
    ]);
    expect(result.currentDurable).toHaveLength(3);
    expect(result.legacyDurable).toEqual([
      "cloud:notebooks:default:snapshots:ready",
      "sync:job:mail:idempotency:message-1",
      "sync:queue:tenant:jobs:ready",
    ]);
    expect(result.preservedScheduler).toHaveLength(1);
    expect(result.nonDurable).toHaveLength(1);
  });

  test("reads both 5.9 dataJson and 5.8 data registry records", () => {
    const modern = {
      id: "core",
      name: "Core",
      icon: "cloud",
      description: "Core",
      baseUrl: "http://core:3000",
      routes: ["/"],
      runtime: { release: "sha-aabbccd", syncVersion: "5.9.1" },
    };
    const legacy = {
      id: "gateway",
      name: "Gateway",
      icon: "route",
      description: "Gateway",
      baseUrl: "http://gateway:3000",
      routes: [],
    };
    const raw = ["apps/core", JSON.stringify({ dataJson: JSON.stringify(modern) }), "apps/gateway", JSON.stringify({ data: legacy })];
    expect(parseAppRegistryState(raw)).toEqual({ apps: [modern, legacy], invalid: [] });
  });

  test("reports malformed registry records", () => {
    expect(parseAppRegistryState(["apps/core", "not-json"]).invalid[0]).toContain("apps/core");
  });

  test("ignores expired registry records", () => {
    const raw = ["apps/old", JSON.stringify({ data: modernApp, expiresAt: 99 })];
    expect(parseAppRegistryState(raw, 100)).toEqual({ apps: [], invalid: [] });
  });

  test("blocks mixed Sync generations and unresolved legacy durable state", () => {
    const old = { ...modernApp, id: "old", runtime: { ...modernApp.runtime, syncVersion: "5.8.9" } };
    const result = analyzeSyncState(["sync:queue:tenant:jobs:ready"], [old, modernApp]);
    expect(result.failures).toHaveLength(2);
  });

  test("passes a consistent post-migration state", () => {
    const result = analyzeSyncState(["sync:queue:namespace:v2:tenant:jobs:ready"], [modernApp]);
    expect(result.failures).toEqual([]);
  });

  test("finds missing and unexpected runtime releases", () => {
    expect(findReleaseMismatches([modernApp, { ...modernApp, id: "old", runtime: undefined }], "sha-other")).toEqual([
      "core=sha-aabbccd",
      "old=unknown",
    ]);
  });
});

const modernApp = {
  id: "core",
  name: "Core",
  icon: "cloud",
  description: "Core",
  baseUrl: "http://core:3000",
  routes: ["/"],
  runtime: { release: "sha-aabbccd", syncVersion: "5.9.1" },
};

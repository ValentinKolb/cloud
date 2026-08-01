import { describe, expect, test } from "bun:test";
import type { AppRegistryEntry } from "../contracts/registry";
import { assessRuntimeCompatibility } from "./runtime-compatibility";

const app = (id: string, syncVersion?: string): AppRegistryEntry => ({
  id,
  name: id,
  icon: "box",
  description: id,
  baseUrl: `http://${id}:3000`,
  routes: [`/${id}`],
  runtime: syncVersion ? { release: "sha-0123456789ab", syncVersion } : undefined,
});

describe("assessRuntimeCompatibility", () => {
  test("rejects the durable namespace boundary", () => {
    expect(assessRuntimeCompatibility([app("old", "5.8.9"), app("new", "5.9.1")])).toEqual([
      expect.objectContaining({ code: "mixed-sync-generation", severity: "error", appIds: ["old", "new"] }),
    ]);
  });

  test("warns about safe version drift", () => {
    expect(assessRuntimeCompatibility([app("a", "5.9.0"), app("b", "5.9.1")])).toEqual([
      expect.objectContaining({ code: "mixed-sync-version", severity: "warn" }),
    ]);
  });

  test("accepts matching and missing metadata", () => {
    expect(assessRuntimeCompatibility([app("a", "5.9.1"), app("b", "5.9.1"), app("old")])).toEqual([]);
  });

  test("reports malformed versions without treating them as incompatible", () => {
    expect(assessRuntimeCompatibility([app("bad", "next")])).toEqual([
      expect.objectContaining({ code: "invalid-sync-version", severity: "warn", appIds: ["bad"] }),
    ]);
  });
});

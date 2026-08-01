import { describe, expect, test } from "bun:test";
import { validateAppRegistryEntry } from "./registry-validation";

const valid = {
  id: "core",
  name: "Core",
  icon: "cloud",
  description: "Core",
  baseUrl: "http://core:3000",
  routes: ["/", "/auth"],
  runtime: { release: "sha-0123456789ab", syncVersion: "5.9.1" },
};

describe("validateAppRegistryEntry", () => {
  test("accepts a valid entry", () => expect(validateAppRegistryEntry(valid)).toBeNull());
  test("rejects a scalar entry", () => expect(validateAppRegistryEntry("broken")).toBe("entry must be an object"));
  test("rejects invalid routes", () => expect(validateAppRegistryEntry({ ...valid, routes: ["auth"] })).toContain("routes"));
  test("rejects partial runtime metadata", () =>
    expect(validateAppRegistryEntry({ ...valid, runtime: { release: valid.runtime.release } })).toContain("runtime.syncVersion"));
});

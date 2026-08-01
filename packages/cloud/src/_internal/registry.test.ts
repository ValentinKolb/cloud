import { describe, expect, test } from "bun:test";
import { type AppRegistrySnapshot, requireUsableAppRegistry } from "./registry";

describe("requireUsableAppRegistry", () => {
  test("keeps valid entries when another record is malformed", () => {
    const app = {
      id: "core",
      name: "Core",
      icon: "cloud",
      description: "Core",
      baseUrl: "http://core:3000",
      routes: ["/"],
      createdAt: 1,
      updatedAt: 2,
      expiresAt: 3,
      version: "1",
    };
    const snapshot = { apps: [app], issues: [{ key: "apps/broken", version: "2", reason: "invalid" }] } satisfies AppRegistrySnapshot;
    expect(requireUsableAppRegistry(snapshot)).toEqual([app]);
  });

  test("does not replace the last good consumer state with an all-invalid snapshot", () => {
    const snapshot = {
      apps: [],
      issues: [{ key: "apps/core", version: "2", reason: "entry must be an object" }],
    } satisfies AppRegistrySnapshot;
    expect(() => requireUsableAppRegistry(snapshot)).toThrow("no valid entries");
  });
});

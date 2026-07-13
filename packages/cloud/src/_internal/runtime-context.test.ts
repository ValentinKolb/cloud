import { describe, expect, it } from "bun:test";
import type { AppRegistryEntry } from "../contracts/registry";
import { buildRuntimeFromRegistry } from "./runtime-context";

const entry = (appearance?: AppRegistryEntry["appearance"]): AppRegistryEntry => ({
  id: "example",
  name: "Example",
  icon: "ti ti-example",
  description: "Example app",
  appearance,
  baseUrl: "http://app-example:3000",
  routes: ["/app/example"],
});

describe("buildRuntimeFromRegistry", () => {
  it("preserves optional app appearance", () => {
    const appearance = {
      accent: "#14b8a6" as const,
      background: { from: "#14b8a6" as const, to: "#3b82f6" as const, angle: 135 },
    };

    expect(buildRuntimeFromRegistry([entry(appearance)]).apps[0]?.appearance).toEqual(appearance);
    expect(buildRuntimeFromRegistry([entry()]).apps[0]?.appearance).toBeUndefined();
  });

  it("preserves app-declared admin navigation", () => {
    const app = entry();
    app.adminNav = [
      {
        label: "Operations",
        links: [{ href: "/admin/example/jobs", icon: "ti-activity", label: "Jobs" }],
      },
    ];

    expect(buildRuntimeFromRegistry([app]).apps[0]?.adminNav).toEqual(app.adminNav);
  });
});

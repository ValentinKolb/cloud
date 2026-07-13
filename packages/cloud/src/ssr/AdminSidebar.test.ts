import { describe, expect, it } from "bun:test";
import type { RuntimeAppMeta } from "../contracts/app";
import { buildAdminGroups } from "./admin-navigation";

const app = (overrides: Partial<RuntimeAppMeta> = {}): RuntimeAppMeta => ({
  id: "example",
  name: "Example",
  icon: "ti ti-box",
  description: "Example app",
  routes: ["/app/example"],
  ...overrides,
});

describe("buildAdminGroups", () => {
  it("renders app-declared groups in the existing core group order", () => {
    const groups = buildAdminGroups([
      app({
        adminHref: "/admin/example",
        adminNav: [
          {
            label: "Operations",
            links: [{ href: "/admin/example/jobs", icon: "ti-activity", label: "Jobs" }],
          },
        ],
      }),
    ]);

    expect(groups.map((group) => group.label)).toEqual(["General", "Operations", "AI", "Settings"]);
    expect(groups[1]?.links).toEqual([{ href: "/admin/example/jobs", icon: "ti-activity", label: "Jobs" }]);
  });

  it("keeps adminHref as the single-link fallback", () => {
    const groups = buildAdminGroups([app({ adminHref: "/admin/example" })]);

    expect(groups.at(-1)).toEqual({
      label: "App Admin",
      links: [{ href: "/admin/example", icon: "ti-box", label: "Example" }],
    });
  });

  it("drops non-admin and external links", () => {
    const groups = buildAdminGroups([
      app({
        adminHref: "https://example.com/admin",
        adminNav: [
          {
            label: "Invalid",
            links: [
              { href: "/app/example", icon: "ti-box", label: "App" },
              { href: "//example.com/admin", icon: "ti-link", label: "External" },
            ],
          },
        ],
      }),
    ]);

    expect(groups.map((group) => group.label)).toEqual(["General", "AI", "Settings"]);
  });
});

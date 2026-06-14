import { describe, expect, test } from "bun:test";
import { DASHBOARD_MAX_SHORTCUTS, isSafeDashboardShortcutHref, normalizeDashboardSettings, normalizeDashboardShortcutHref } from "./shared";

describe("normalizeDashboardSettings", () => {
  test("reads legacy JSONB string shortcuts", () => {
    const settings = normalizeDashboardSettings({
      gradient: "default",
      hiddenWidgets: [],
      shortcuts: JSON.stringify([{ id: "shortcut-1", kind: "app", appId: "contacts" }]),
    });

    expect(settings.shortcuts).toEqual([{ id: "shortcut-1", kind: "app", appId: "contacts" }]);
  });

  test("adds https to shortcut links without a protocol", () => {
    expect(normalizeDashboardShortcutHref("kolb-antik.com")).toBe("https://kolb-antik.com");
    expect(normalizeDashboardShortcutHref("http://kolb-antik.com")).toBe("http://kolb-antik.com");
    expect(normalizeDashboardShortcutHref("https://kolb-antik.com")).toBe("https://kolb-antik.com");
  });

  test("normalizes and caps user-controlled settings", () => {
    const settings = normalizeDashboardSettings({
      gradient: "  rainbow  ",
      hiddenWidgets: [" weather/current ", "weather/current", "", 42],
      shortcuts: Array.from({ length: DASHBOARD_MAX_SHORTCUTS + 5 }, (_, index) => ({
        id: ` shortcut-${index} `,
        kind: "link",
        href: index === 0 ? "javascript:alert(1)" : "example.com",
        title: " Example ",
        icon: " ti ti-link ",
      })),
    });

    expect(settings.gradient).toBe("rainbow");
    expect(settings.hiddenWidgets).toEqual(["weather/current"]);
    expect(settings.shortcuts).toHaveLength(DASHBOARD_MAX_SHORTCUTS);
    expect(settings.shortcuts[0]).toMatchObject({
      id: "shortcut-1",
      kind: "link",
      href: "https://example.com",
      title: "Example",
      icon: "ti ti-link",
    });
  });

  test("allows only safe shortcut href schemes", () => {
    expect(isSafeDashboardShortcutHref("/app/weather")).toBe(true);
    expect(isSafeDashboardShortcutHref("https://example.com")).toBe(true);
    expect(isSafeDashboardShortcutHref("mailto:test@example.com")).toBe(true);
    expect(isSafeDashboardShortcutHref("javascript:alert(1)")).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { normalizeDashboardSettings, normalizeDashboardShortcutHref } from "./shared";

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
});

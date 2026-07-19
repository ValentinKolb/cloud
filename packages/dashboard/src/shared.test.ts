import { describe, expect, test } from "bun:test";
import {
  DASHBOARD_MAX_SHORTCUTS,
  groupDashboardWidgetRows,
  isSafeDashboardShortcutHref,
  normalizeDashboardSettings,
  normalizeDashboardShortcutHref,
  resolveDashboardWidgetLayout,
} from "./shared";

describe("normalizeDashboardSettings", () => {
  test("reads legacy JSONB string shortcuts", () => {
    const settings = normalizeDashboardSettings({
      gradient: "default",
      hiddenWidgets: [],
      shortcuts: JSON.stringify([{ id: "shortcut-1", kind: "app", appId: "contacts" }]),
    });

    expect(settings.shortcuts).toEqual([{ id: "shortcut-1", kind: "app", appId: "contacts" }]);
    expect(settings.layout).toEqual({ widgets: [], order: [] });
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

  test("normalizes widget layout overrides and order", () => {
    const settings = normalizeDashboardSettings({
      layout: {
        widgets: [
          { key: " spaces/today ", zone: "focus", span: "wide" },
          { key: "weather/current", zone: "context", span: "wide" },
          { key: "invalid", zone: "somewhere", span: "wide" },
        ],
        order: [" weather/current ", "spaces/today", "weather/current"],
      },
    });

    expect(settings.layout).toEqual({
      widgets: [
        { key: "spaces/today", zone: "focus", span: "wide" },
        { key: "weather/current", zone: "context", span: "standard" },
      ],
      order: ["weather/current", "spaces/today"],
    });
  });

  test("allows only safe shortcut href schemes", () => {
    expect(isSafeDashboardShortcutHref("/app/weather")).toBe(true);
    expect(isSafeDashboardShortcutHref("https://example.com")).toBe(true);
    expect(isSafeDashboardShortcutHref("mailto:test@example.com")).toBe(true);
    expect(isSafeDashboardShortcutHref("javascript:alert(1)")).toBe(false);
  });
});

describe("resolveDashboardWidgetLayout", () => {
  test("uses at most two app focus recommendations", () => {
    const widgets = ["one", "two", "three"].map((key) => ({
      key,
      presentation: { defaultZone: "focus" as const, defaultSpan: "wide" as const },
    }));

    expect(resolveDashboardWidgetLayout(widgets, { widgets: [], order: [] })).toEqual([
      { widget: widgets[0]!, zone: "focus", span: "wide" },
      { widget: widgets[1]!, zone: "focus", span: "wide" },
      { widget: widgets[2]!, zone: "overview", span: "wide" },
    ]);
  });

  test("gives explicit user choices and ordering precedence", () => {
    const spaces = { key: "spaces/today", presentation: { defaultZone: "focus" as const, defaultSpan: "wide" as const } };
    const weather = { key: "weather/current" };
    const resolved = resolveDashboardWidgetLayout([spaces, weather], {
      widgets: [{ key: spaces.key, zone: "overview", span: "standard" }],
      order: [weather.key, spaces.key],
    });

    expect(resolved).toEqual([
      { widget: weather, zone: "overview", span: "standard" },
      { widget: spaces, zone: "overview", span: "standard" },
    ]);
  });

  test("keeps explicit focus choices while limiting automatic recommendations", () => {
    const widgets = [
      { key: "manual" },
      { key: "recommended-one", presentation: { defaultZone: "focus" as const } },
      { key: "recommended-two", presentation: { defaultZone: "focus" as const } },
    ];
    const resolved = resolveDashboardWidgetLayout(widgets, {
      widgets: [{ key: "manual", zone: "focus", span: "standard" }],
      order: [],
    });

    expect(resolved.map(({ widget, zone }) => [widget.key, zone])).toEqual([
      ["manual", "focus"],
      ["recommended-one", "focus"],
      ["recommended-two", "overview"],
    ]);
  });

  test("places context recommendations in the side column with a standard span", () => {
    const weather = {
      key: "weather/current",
      presentation: { defaultZone: "context" as const, defaultSpan: "wide" as const },
    };

    expect(resolveDashboardWidgetLayout([weather], { widgets: [], order: [] })).toEqual([
      { widget: weather, zone: "context", span: "standard" },
    ]);
  });
});

describe("groupDashboardWidgetRows", () => {
  test("preserves order while giving wide widgets their own row", () => {
    const widgets = [
      { widget: { key: "one" }, zone: "overview" as const, span: "standard" as const },
      { widget: { key: "two" }, zone: "overview" as const, span: "standard" as const },
      { widget: { key: "wide" }, zone: "overview" as const, span: "wide" as const },
      { widget: { key: "three" }, zone: "overview" as const, span: "standard" as const },
    ];

    expect(groupDashboardWidgetRows(widgets, 3).map((row) => row.map(({ widget }) => widget.key))).toEqual([
      ["one", "two"],
      ["wide"],
      ["three"],
    ]);
  });
});

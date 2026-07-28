import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";

const root = mkdtempSync(resolve(tmpdir(), "k2b-ui-widget-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { Widget, WidgetCard, WidgetHero, WidgetList, WidgetPills, WidgetStat, WidgetStatus } = await import("../index");

describe("@k2b/ui complete widget composition", () => {
  test("links only the widget header so body links remain valid", () => {
    const html = renderToString(() =>
      createComponent(Widget, {
        title: "Operations",
        meta: "last 24h",
        icon: "ti ti-activity",
        href: "/operations",
        children: createComponent(WidgetList, {
          items: [{ label: "Failed jobs", href: "/jobs?state=failed" }],
        }),
      }),
    );

    expect(html).toContain('<section class="k2b-widget');
    expect(html).toContain('href="/operations" class="k2b-widget__header"');
    expect(html).toContain('href="/jobs?state=failed"');
    expect(html.indexOf("</a><div class=\"k2b-widget__body\"")).toBeGreaterThan(-1);
  });

  test("renders a free-form widget card and centered hero", () => {
    const card = renderToString(() =>
      createComponent(WidgetCard, {
        title: "Custom",
        icon: "ti ti-layout",
        description: "Bring any content",
        children: createComponent(WidgetHero, {
          title: "All clear",
          subtitle: "No pending work",
          icon: "ti ti-circle-check",
          tone: "success",
        }),
      }),
    );

    expect(card).toContain("k2b-widget-card");
    expect(card).toContain("ti ti-layout");
    expect(card).toContain("k2b-widget-hero");
    expect(card).toContain('data-tone="success"');
  });

  test("renders list aliases, empty state, links, and grow behavior", () => {
    const list = renderToString(() =>
      createComponent(WidgetList, {
        grow: true,
        items: [{ label: "Deploy", sub: "Production", meta: "now", icon: "ti ti-rocket", iconTone: "info" }],
      }),
    );
    const empty = renderToString(() => createComponent(WidgetList, { items: [], emptyMessage: "No deployments" }));

    expect(list).toContain('data-grow="true"');
    expect(list).toContain("Production");
    expect(list).toContain('data-tone="info"');
    expect(empty).toContain("No deployments");
  });

  test("renders pill, stat, and status blocks as composable primitives", () => {
    const pills = renderToString(() =>
      createComponent(WidgetPills, {
        grow: true,
        pills: [{ label: "Errors", value: 3, tone: "danger", href: "/errors" }],
      }),
    );
    const stat = renderToString(() =>
      createComponent(WidgetStat, {
        label: "Requests",
        value: 42,
        sub: "last hour",
        grow: true,
        accent: { icon: "ti ti-trending-up", text: "+12%", tone: "success" },
      }),
    );
    const status = renderToString(() =>
      createComponent(WidgetStatus, { title: "Degraded", message: "One source unavailable", tone: "degraded", grow: true }),
    );

    expect(pills).toContain('href="/errors"');
    expect(pills).toContain('data-grow="true"');
    expect(stat).toContain("last hour");
    expect(stat).toContain("+12%");
    expect(status).toContain("ti ti-alert-triangle");
    expect(status).toContain("One source unavailable");
  });
});

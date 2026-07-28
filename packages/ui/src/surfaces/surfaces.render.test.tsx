import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";

const root = mkdtempSync(resolve(tmpdir(), "k2b-ui-surfaces-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { Avatar, LinkCard, NoticeCard, ProgressBar, StatCell, StatGrid, StatusBadge } = await import("../index");

describe("@k2b/ui complete surface migrations", () => {
  test("renders resilient image and initials avatars", () => {
    const image = renderToString(() => createComponent(Avatar, { name: "Ada Lovelace", src: "/ada.webp", size: "lg" }));
    const fallback = renderToString(() => createComponent(Avatar, { name: "Ada Lovelace" }));

    expect(image).toContain('loading="lazy"');
    expect(image).toContain('data-size="lg"');
    expect(fallback).toContain('role="img"');
    expect(fallback).toContain("AL");
  });

  test("renders semantic link and persistent notice cards", () => {
    const link = renderToString(() =>
      createComponent(LinkCard, {
        href: "/details",
        title: "Runtime",
        description: "Open runtime details",
        icon: "ti ti-server",
        tone: "info",
      }),
    );
    const notice = renderToString(() =>
      createComponent(NoticeCard, {
        title: "Database unavailable",
        detail: "Retrying in the background.",
        tone: "danger",
      }),
    );

    expect(link).toContain('href="/details"');
    expect(link).toContain("ti ti-server");
    expect(notice).toContain('role="alert"');
    expect(notice).toContain("ti ti-alert-circle");
    expect(notice).toContain("Retrying in the background.");
  });

  test("renders determinate and indeterminate progress semantics", () => {
    const progress = renderToString(() =>
      createComponent(ProgressBar, { value: 42, label: "Upload", size: "xs", showValue: true }),
    );
    const busy = renderToString(() => createComponent(ProgressBar, { label: "Loading" }));

    expect(progress).toContain('aria-valuenow="42"');
    expect(progress).toContain('data-size="xs"');
    expect(progress).toContain("42%");
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('data-indeterminate="true"');
  });

  test("renders chip, text, and dense-dot status variants", () => {
    const chip = renderToString(() => createComponent(StatusBadge, { label: "Healthy", tone: "success" }));
    const dot = renderToString(() =>
      createComponent(StatusBadge, { label: "Running", tone: "running", variant: "dot", title: "Current state" }),
    );
    const text = renderToString(() =>
      createComponent(StatusBadge, { children: "Offline", tone: "danger", variant: "text", icon: null }),
    );

    expect(chip).toContain("ti ti-check");
    expect(chip).toContain('data-variant="chip"');
    expect(dot).toContain("k2b-status-badge__dot");
    expect(dot).toContain('title="Current state"');
    expect(text).toContain('data-variant="text"');
    expect(text).not.toContain("ti ti-alert-circle");
  });

  test("renders linked stat cells, accents, grids, and trends", () => {
    const html = renderToString(() =>
      createComponent(StatGrid, {
        columns: 2,
        title: "Service",
        action: { label: "Details", href: "/details" },
        children: createComponent(StatCell, {
          label: "Latency",
          value: "42 ms",
          sub: "p95",
          href: "/latency",
          trend: [10, 30, 20, 42],
          accent: { tone: "warning", icon: "ti ti-alert-triangle", text: "high" },
        }),
      }),
    );

    expect(html).toContain('data-columns="2"');
    expect(html).toContain('href="/latency"');
    expect(html).toContain("k2b-stat-cell__trend");
    expect(html).toContain("ti ti-alert-triangle");
  });
});

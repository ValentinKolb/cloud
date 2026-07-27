import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";

const root = mkdtempSync(resolve(tmpdir(), "k2b-ui-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { AppWorkspace, Button, Chart, NoticeCard, Placeholder, ProgressBar, StatusBadge, TextInput } = await import("./index");

describe("@k2b/ui scaffold SSR", () => {
  test("renders the scoped placeholder contract", () => {
    const html = renderToString(() =>
      createComponent(Placeholder, {
        title: "No records",
        description: "Create the first record.",
        state: "empty",
        variant: "panel",
      }),
    );

    expect(html).toContain('class="k2b-placeholder');
    expect(html).toContain('data-state="empty"');
    expect(html).toContain("No records");
  });

  test("renders the compound workspace structure", () => {
    const html = renderToString(() =>
      createComponent(AppWorkspace, {
        get children() {
          return [
            createComponent(AppWorkspace.Sidebar, {
              get children() {
                return createComponent(AppWorkspace.SidebarItem, { active: true, children: "Overview" });
              },
            }),
            createComponent(AppWorkspace.Content, {
              get children() {
                return createComponent(AppWorkspace.Main, { children: "Content" });
              },
            }),
          ];
        },
      }),
    );

    expect(html).toContain("k2b-app-workspace__sidebar");
    expect(html).toContain("k2b-app-workspace__content");
    expect(html).toContain("k2b-app-workspace__main");
  });

  test("renders a real stdlib chart on the server", () => {
    const html = renderToString(() =>
      createComponent(Chart, {
        kind: "line",
        label: "Requests",
        series: [{ data: [{ x: 1, y: 2 }] }],
      }),
    );

    expect(html).toContain('data-chart-kind="line"');
    expect(html).toContain("<svg");
    expect(html).toContain('aria-label="Requests"');
  });

  test("renders accessible foundation controls", () => {
    const button = renderToString(() =>
      createComponent(Button, {
        loading: true,
        loadingLabel: "Saving",
        children: "Save",
      }),
    );
    const input = renderToString(() =>
      createComponent(TextInput, {
        label: "Email",
        description: "Used for updates.",
        error: "Enter a valid address.",
        value: "invalid",
      }),
    );

    expect(button).toContain('aria-busy="true"');
    expect(button).toContain("Saving");
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain("Used for updates.");
    expect(input).toContain("Enter a valid address.");
    expect(input).toMatch(/aria-describedby="[^"]+-description [^"]+-error"/);
  });

  test("renders semantic status surfaces", () => {
    const badge = renderToString(() => createComponent(StatusBadge, { tone: "success", dot: true, children: "Healthy" }));
    const progress = renderToString(() => createComponent(ProgressBar, { label: "Readiness", value: 42 }));
    const notice = renderToString(() =>
      createComponent(NoticeCard, {
        title: "Package boundary",
        tone: "danger",
        children: "No Cloud dependency.",
      }),
    );

    expect(badge).toContain('data-tone="success"');
    expect(badge).toContain("Healthy");
    expect(progress).toContain('role="progressbar"');
    expect(progress).toContain('aria-valuenow="42"');
    expect(notice).toContain('role="alert"');
    expect(notice).toContain("No Cloud dependency.");
  });

  test("keeps the stylesheet free of global resets", () => {
    const css = readFileSync(resolve(import.meta.dir, "styles/index.css"), "utf8");

    expect(css).toContain('@reference "tailwindcss"');
    expect(css).not.toContain('@import "tailwindcss"');
    expect(css).not.toMatch(/(^|[},])\s*(html|body|:root)(?=[\s,{])/m);
  });
});

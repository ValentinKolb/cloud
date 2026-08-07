import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import type { CustomApp } from "../../../service";
import "../ssr-test-plugin";

const { default: CustomAppBuilder } = await import("./CustomAppBuilder");

const app = (): CustomApp => ({
  id: "33333333-3333-4333-8333-333333333333",
  shortId: "APP1",
  baseId: "11111111-1111-4111-8111-111111111111",
  name: "Loan desk",
  icon: "clipboard",
  draftDefinition: {
    schemaVersion: 1,
    kind: "grids.custom-app",
    id: "33333333-3333-4333-8333-333333333333",
    shortId: "APP1",
    baseId: "11111111-1111-4111-8111-111111111111",
    name: "Loan desk",
    icon: "clipboard",
    startPageId: "overview",
    pages: [
      {
        id: "overview",
        title: "Overview",
        navigation: { visible: true, order: 0 },
        parameters: {},
        rows: [
          {
            id: "summary-row",
            columns: [
              {
                id: "summary-column",
                span: 12,
                blocks: [{ id: "intro", type: "markdown", title: "Welcome", markdown: "Choose a request." }],
              },
            ],
          },
        ],
      },
    ],
  },
  draftCapabilities: {
    views: [],
    insights: [],
    recordQueries: [],
    records: [],
    forms: [],
    comments: [],
    documents: [],
    workflowLaunchers: [],
  },
  publishedDefinition: null,
  publishedCapabilities: null,
  publishedAt: null,
  createdAt: "2026-08-07T00:00:00.000Z",
  updatedAt: "2026-08-07T00:00:00.000Z",
});

describe("CustomAppBuilder", () => {
  test("renders pages, canvas, toolbar, and inspector from the canonical draft", () => {
    const html = renderToString(() => createComponent(CustomAppBuilder, { app: app() }));

    expect(html).toContain("k2b-app-workspace__main-pane");
    expect(html).toContain("Custom App builder");
    expect(html).toContain("Overview");
    expect(html).toContain("Welcome");
    expect(html).toContain("Choose a request.");
    expect(html).toContain("k2b-app-workspace__detail");
    expect(html).toContain("Page settings");
    expect(html).toContain("Add text");
    expect(html).toContain("Select a block to edit its content and layout.");
    expect(html).toContain('data-block-id="intro"');
    expect(html).toContain('class="grids-builder-block ');
    expect(html).toContain('data-selected="false"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Close page inspector");
    expect(html).toContain("Show in app navigation");
    expect(html).not.toContain("border-b border-subtle");
    expect(html).not.toContain("border-t border-subtle");
  });

  test("uses the workspace edit accent for selected and focused blocks", async () => {
    const css = await Bun.file(resolve(import.meta.dir, "../../../styles/app.css")).text();

    expect(css).toMatch(/\.grids-workspace-editing\s*\{[^}]*--grids-edit-accent:/);
    expect(css).toMatch(
      /\.grids-builder-block\[data-selected="true"\],\s*\.grids-builder-block:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--grids-edit-accent\)/,
    );
  });
});

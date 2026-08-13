import { describe, expect, test } from "bun:test";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import type { CustomAppDefinition } from "../../custom-apps/contracts";
import "../_components/ssr-test-plugin";

const { CustomAppPageLayout } = await import("./PageLayout");

const definition: CustomAppDefinition = {
  schemaVersion: 3,
  kind: "grids.custom-app",
  id: "33333333-3333-4333-8333-333333333333",
  shortId: "APP1",
  baseId: "11111111-1111-4111-8111-111111111111",
  name: "Loan desk",
  icon: "package",
  startPageId: "overview",
  pages: [
    {
      id: "overview",
      title: "Overview",
      navigation: { visible: true, order: 0 },
      parameters: {},
      rows: [
        {
          id: "main-row",
          columns: [
            {
              id: "main-column",
              span: 12,
              blocks: [{ id: "intro", type: "markdown", title: "Introduction", markdown: "Hello" }],
            },
          ],
        },
      ],
    },
  ],
};

describe("CustomAppPageLayout", () => {
  test("keeps published rows, columns, and blocks flat and free of authoring chrome", () => {
    const html = renderToString(() =>
      createComponent(CustomAppPageLayout, {
        definition,
        page: definition.pages[0]!,
        shortId: "APP1",
        renderBlock: () => "Rendered content",
      }),
    );

    expect(html).toContain('class="custom-app-page ');
    expect(html).toContain("gap-10 p-5 sm:p-7 lg:p-8");
    expect(html).not.toContain("min-h-full");
    expect(html).toContain("k2b-app-workspace__main");
    expect(html.match(/max-w-\[96rem\]/g)).toHaveLength(1);
    expect(html).not.toContain("Loan desk");
    expect(html).not.toContain("Overview");
    expect(html).not.toContain("ti-package");
    expect(html).not.toContain("<h1");
    expect(html).toContain('class="custom-app-row ');
    expect(html).toContain('class="custom-app-column ');
    expect(html).toContain('class="custom-app-block ');
    expect(html).toContain("k2b-panel-header");
    expect(html).toContain("Introduction");
    expect(html).toContain("Rendered content");
    expect(html).not.toContain("paper");
    expect(html).not.toContain("data-editing");
    expect(html).not.toContain("custom-app-editor-label");
    expect(html).not.toContain("custom-app-drop-indicator");
    expect(html).not.toContain("custom-app-pair-indicator");
  });

  test("uses AppWorkspace navigation only when another page or global action exists", () => {
    const withNavigation = {
      ...definition,
      pages: [
        ...definition.pages,
        { ...definition.pages[0]!, id: "reports", title: "Reports", navigation: { visible: true, order: 20, icon: "chart-bar" } },
      ],
    };
    const html = renderToString(() =>
      createComponent(CustomAppPageLayout, {
        definition: withNavigation,
        page: withNavigation.pages[0]!,
        shortId: "APP1",
        renderBlock: () => "Rendered content",
      }),
    );
    expect(html).toContain("k2b-app-workspace__sidebar");
    expect(html).toContain("Reports");
    expect(html).toContain("ti-chart-bar");
  });

  test("keeps a single-page app sidebar when it contains a global action", () => {
    const html = renderToString(() =>
      createComponent(CustomAppPageLayout, {
        definition,
        page: definition.pages[0]!,
        shortId: "APP1",
        hasSidebarActions: true,
        sidebarActions: "New loan",
        renderBlock: () => "Rendered content",
      }),
    );

    expect(html).toContain("k2b-app-workspace__sidebar");
    expect(html).toContain("New loan");
  });
});

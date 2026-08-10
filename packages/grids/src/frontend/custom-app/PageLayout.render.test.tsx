import { describe, expect, test } from "bun:test";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import type { CustomAppDefinition } from "../../custom-apps/contracts";
import "../_components/ssr-test-plugin";

const { CustomAppPageLayout } = await import("./PageLayout");

const definition: CustomAppDefinition = {
  schemaVersion: 2,
  kind: "grids.custom-app",
  id: "33333333-3333-4333-8333-333333333333",
  shortId: "APP1",
  baseId: "11111111-1111-4111-8111-111111111111",
  name: "Loan desk",
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
              blocks: [{ id: "intro", type: "markdown", markdown: "Hello" }],
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
    expect(html).toContain('class="custom-app-row ');
    expect(html).toContain('class="custom-app-column ');
    expect(html).toContain('class="custom-app-block ');
    expect(html).toContain("Rendered content");
    expect(html).not.toContain("paper");
    expect(html).not.toContain("data-editing");
    expect(html).not.toContain("custom-app-editor-label");
    expect(html).not.toContain("custom-app-drop-indicator");
    expect(html).not.toContain("custom-app-pair-indicator");
  });
});

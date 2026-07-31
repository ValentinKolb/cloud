import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import { PANES_VALUE_VERSION, type PanesValue } from "./panes-state";

const root = mkdtempSync(resolve(tmpdir(), "k2b-ui-panes-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));
const { default: Panes } = await import("./Panes");

const value: PanesValue = {
  version: PANES_VALUE_VERSION,
  root: {
    type: "split",
    id: "root",
    direction: "horizontal",
    sizes: [55, 45],
    children: [
      {
        type: "leaf",
        id: "editor",
        elementIds: ["source", "preview"],
        activeElementId: "source",
        presentation: "tabs",
      },
      {
        type: "leaf",
        id: "data",
        elementIds: ["sample"],
        activeElementId: "sample",
        presentation: "single",
      },
    ],
  },
};

describe("@k2b/ui Panes", () => {
  test("renders nested controlled panes with semantic tabs and separators", () => {
    const html = renderToString(() =>
      createComponent(Panes.Root, {
        value,
        onChange: () => undefined,
        label: "Template workspace",
        get children() {
          return [
            createComponent(Panes.Element, {
              id: "source",
              title: "Source",
              icon: "ti ti-code",
              children: "Source editor",
            }),
            createComponent(Panes.Element, {
              id: "preview",
              title: "Preview",
              icon: "ti ti-eye",
              closable: true,
              onClose: () => undefined,
              children: "Preview content",
            }),
            createComponent(Panes.Element, {
              id: "sample",
              title: "Sample data",
              icon: "ti ti-database",
              children: "Sample content",
            }),
          ];
        },
      }),
    );

    expect(html).toContain("data-k2b-panes");
    expect(html).toContain('aria-label="Template workspace"');
    expect(html).toContain('role="separator"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('title="Close Preview"');
    expect(html).toContain("Source editor");
    expect(html).toContain("Sample content");
  });

  test("keeps inactive content mounted by default and can unmount it", () => {
    const render = (keepMounted: boolean) =>
      renderToString(() =>
        createComponent(Panes.Root, {
          value: {
            version: PANES_VALUE_VERSION,
            root: {
              type: "leaf",
              id: "root",
              elementIds: ["one", "two"],
              activeElementId: "one",
              presentation: "tabs",
            },
          },
          onChange: () => undefined,
          keepMounted,
          get children() {
            return [
              createComponent(Panes.Element, { id: "one", title: "One", children: "First" }),
              createComponent(Panes.Element, { id: "two", title: "Two", children: "Second" }),
            ];
          },
        }),
      );

    expect(render(true)).toContain("Second");
    expect(render(false)).not.toContain("Second");
  });

  test("renders every stack element without tab semantics", () => {
    const html = renderToString(() =>
      createComponent(Panes.Root, {
        value: {
          version: PANES_VALUE_VERSION,
          root: {
            type: "leaf",
            id: "root",
            elementIds: ["one", "two"],
            activeElementId: "one",
            presentation: "stack",
          },
        },
        onChange: () => undefined,
        get children() {
          return [
            createComponent(Panes.Element, { id: "one", title: "One", children: "First" }),
            createComponent(Panes.Element, { id: "two", title: "Two", children: "Second" }),
          ];
        },
      }),
    );

    expect(html).not.toContain('role="tablist"');
    expect(html).toContain('data-presentation="stack"');
    expect(html).toContain("First");
    expect(html).toContain("Second");
  });
});

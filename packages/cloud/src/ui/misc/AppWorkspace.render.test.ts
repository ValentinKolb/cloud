import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";

const root = mkdtempSync(resolve(tmpdir(), "cloud-app-workspace-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { default: AppWorkspace } = await import("./AppWorkspace");

const renderWorkspace = (detailResizable: boolean | undefined) =>
  renderToString(() =>
    createComponent(AppWorkspace, {
      get children() {
        return createComponent(AppWorkspace.Content, {
          get children() {
            return [
              createComponent(AppWorkspace.Main, { children: "Content" }),
              createComponent(AppWorkspace.Detail, {
                id: "record",
                open: true,
                width: "lg",
                resizable: detailResizable,
                children: "Detail",
              }),
            ];
          },
        });
      },
    }),
  );

describe("AppWorkspace resize contract", () => {
  test("renders a detail resize handle only for resizable details", () => {
    const resizable = renderWorkspace(undefined);
    const fixed = renderWorkspace(false);

    expect(resizable).toContain('data-app-workspace-resize="detail"');
    expect(resizable).toContain('data-workspace-resizable="true"');
    expect(fixed).not.toContain('data-app-workspace-resize="detail"');
    expect(fixed).toContain('data-workspace-resizable="false"');
  });

  test("sizes island-hosted details from their local content container", () => {
    const navigationCss = readFileSync(resolve(import.meta.dir, "../../styles/utilities-navigation.css"), "utf8");

    expect(navigationCss).toContain('.app-workspace .workspace-content > .workspace-detail[data-workspace-resizable="true"]');
    expect(navigationCss).toContain(".app-workspace .workspace-content > .workspace-resize-handle-detail");
  });
});

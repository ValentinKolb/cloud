import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import {
  appWorkspaceLayoutStyle,
  normalizeAppWorkspaceLayoutState,
  parseAppWorkspaceLayoutState,
  serializeAppWorkspaceLayoutState,
} from "./app-workspace-state";
import { fitFloatingWindowRect } from "./floating-window-geometry";

const root = mkdtempSync(resolve(tmpdir(), "k2b-ui-advanced-layout-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));
const { default: AppWorkspace } = await import("./AppWorkspace");

describe("@k2b/ui complete advanced layout migrations", () => {
  test("renders the complete workspace compound composition", () => {
    const html = renderToString(() =>
      createComponent(AppWorkspace, {
        get children() {
          return [
            createComponent(AppWorkspace.Sidebar, {
              collapsible: true,
              get children() {
                return [
                  createComponent(AppWorkspace.SidebarHeader, {
                    title: "Inventory",
                    subtitle: "12 items",
                    icon: "ti ti-box",
                  }),
                  createComponent(AppWorkspace.SidebarDesktop, {
                    get children() {
                      return createComponent(AppWorkspace.SidebarBody, {
                        get children() {
                          return createComponent(AppWorkspace.SidebarItem, {
                            href: "/items",
                            active: true,
                            get children() {
                              return [
                                createComponent(AppWorkspace.SidebarItemIcon, { icon: "ti ti-list" }),
                                createComponent(AppWorkspace.SidebarItemLabel, { children: "Items" }),
                                createComponent(AppWorkspace.SidebarItemMeta, { children: "12" }),
                                createComponent(AppWorkspace.SidebarItemAction, {
                                  icon: "ti ti-dots",
                                  label: "Row action",
                                }),
                              ];
                            },
                          });
                        },
                      });
                    },
                  }),
                  createComponent(AppWorkspace.SidebarMobile, { children: "Mobile navigation" }),
                ];
              },
            }),
            createComponent(AppWorkspace.Content, {
              get children() {
                return [
                  createComponent(AppWorkspace.Main, {
                    get children() {
                      return createComponent(AppWorkspace.MainPane, {
                        id: "list",
                        label: "Items",
                        children: "Main content",
                      });
                    },
                  }),
                  createComponent(AppWorkspace.Detail, {
                    id: "item",
                    open: true,
                    width: "lg",
                    children: "Detail content",
                  }),
                ];
              },
            }),
          ];
        },
      }),
    );

    expect(html).toContain("data-k2b-app-workspace");
    expect(html).toContain("k2b-app-workspace__sidebar-mobile");
    expect(html).toContain("k2b-app-workspace__sidebar-desktop");
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-label="Items"');
    expect(html).toContain('data-width="lg"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="Row action"');
  });

  test("normalizes and serializes bounded workspace state", () => {
    const normalized = normalizeAppWorkspaceLayoutState({
      version: 2,
      sidebarWidth: 9999,
      paneWidths: { "unsafe id": 10 },
      detailWidths: { primary: 420 },
    });
    expect(normalized).toEqual({
      version: 2,
      sidebarWidth: 360,
      sidebarCollapsed: undefined,
      paneWidths: { unsafe_id: 240 },
      detailWidths: { primary: 420 },
      drawerHeights: undefined,
    });
    const serialized = serializeAppWorkspaceLayoutState(normalized!);
    expect(parseAppWorkspaceLayoutState(serialized)).toEqual(normalized);
    expect(appWorkspaceLayoutStyle(normalized)).toContain("--k2b-workspace-detail-primary-width:420px");
  });

  test("fits utility windows into the viewport", () => {
    expect(
      fitFloatingWindowRect({ x: 900, y: -40, width: 500, height: 700 }, 360, 320, {
        width: 1024,
        height: 768,
      }),
    ).toEqual({ x: 508, y: 16, width: 500, height: 700 });
  });
});

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import {
  APP_WORKSPACE_MAIN_MIN,
  APP_WORKSPACE_MAIN_MIN_HEIGHT,
  appWorkspaceLayoutStyle,
  appWorkspaceResizeLimits,
  fitAppWorkspacePaneSizes,
  normalizeAppWorkspaceLayoutState,
  parseAppWorkspaceLayoutState,
  resolveAppWorkspaceSidebarWidth,
  serializeAppWorkspaceLayoutState,
  shouldCollapseAppWorkspaceSidebar,
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
                          return [
                            createComponent(AppWorkspace.SidebarItem, {
                              href: "/items",
                              active: true,
                              depth: 2,
                              get actions() {
                                return createComponent(AppWorkspace.SidebarItemActions, {
                                  visibility: "hover",
                                  children: "Custom actions",
                                });
                              },
                              get children() {
                                return [
                                  createComponent(AppWorkspace.SidebarItemIcon, { icon: "ti ti-list" }),
                                  createComponent(AppWorkspace.SidebarItemLabel, { children: "Items" }),
                                  createComponent(AppWorkspace.SidebarItemMeta, { children: "12", visibility: "hover" }),
                                  createComponent(AppWorkspace.SidebarItemAction, {
                                    icon: "ti ti-dots",
                                    label: "Row action",
                                    visibility: "hover",
                                  }),
                                ];
                              },
                            }),
                            createComponent(AppWorkspace.NavTree, {
                              ariaLabel: "Inventory navigation",
                              selectedId: "available",
                              expandedIds: ["items"],
                              get children() {
                                return createComponent(AppWorkspace.NavTree.Item, {
                                  id: "items",
                                  label: "Items",
                                  icon: "ti ti-box",
                                  get children() {
                                    return createComponent(AppWorkspace.NavTree.Item, {
                                      id: "available",
                                      label: "Available",
                                      meta: "8",
                                      metaVisibility: "hover",
                                      get actions() {
                                        return createComponent(AppWorkspace.SidebarItemActions, {
                                          visibility: "hover",
                                          children: "Tree actions",
                                        });
                                      },
                                      href: "/items/available",
                                      navigation: "document",
                                    });
                                  },
                                });
                              },
                            }),
                          ];
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
                        surface: "navigation",
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
    expect(html).toContain('data-app-workspace-resize="detail"');
    expect(html).toContain('data-workspace-panel-id="item"');
    expect(html).toContain('data-workspace-resizable="true"');
    expect(html).toContain("--k2b-sidebar-item-depth:2");
    expect(html).toContain('data-surface="navigation"');
    expect(html).toContain("aria-controls=");
    expect(html).toContain('aria-label="Items"');
    expect(html).toContain('data-width="lg"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="Row action"');
    expect(html).toContain('data-action-visibility="hover"');
    expect(html).toContain('data-visibility="hover"');
    expect(html).toContain("k2b-app-workspace__sidebar-item-actions");
    expect(html).toContain("k2b-app-workspace__nav-tree-row-shell");
    expect(html).toContain('role="tree"');
    expect(html).toContain('aria-label="Inventory navigation"');
    expect(html).toContain('role="treeitem"');
    expect(html).toContain('aria-level="2"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-k2b-nav-tree-parent-id="items"');
    expect(html).toContain('class="k2b-app-workspace__sidebar-item-meta k2b-app-workspace__nav-tree-leaf-meta"');
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
      sidebarWidth: 960,
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

  test("keeps utility window resize controlled by component state", async () => {
    const css = await Bun.file(resolve(import.meta.dir, "../styles/index.css")).text();
    const rule = css.match(/\.k2b-ui \.k2b-floating-window \{([^}]*)\}/g)?.at(-1);

    expect(rule).toContain("resize: none");
    expect(rule).not.toContain("resize: both");
  });

  test("reveals hover sidebar actions for pointer and keyboard users without hiding them on touch", async () => {
    const css = await Bun.file(resolve(import.meta.dir, "../styles/index.css")).text();

    expect(css).toContain("@media (hover: hover) and (pointer: fine)");
    expect(css).toContain('.k2b-app-workspace__sidebar-item-action[data-visibility="hover"]');
    expect(css).toContain('.k2b-app-workspace__sidebar-item-meta[data-visibility="hover"]');
    expect(css).toContain('.k2b-app-workspace__sidebar-item-actions[data-visibility="hover"]');
    expect(css).toContain(":is(:hover, :focus-within)");
    expect(css).toContain("gap: 0");
    expect(css).toContain("pointer-events: none");
    expect(css).toContain("pointer-events: auto");
  });

  test("aligns sidebar metadata and actions on one inherited icon line box", async () => {
    const css = await Bun.file(resolve(import.meta.dir, "../styles/index.css")).text();
    const metaRule = css.match(/\.k2b-ui \.k2b-app-workspace__sidebar-item-meta \{([^}]*)\}/)?.[1];
    const actionRule = css.match(/\.k2b-ui \.k2b-app-workspace__sidebar-item-action \{([^}]*)\}/)?.[1];

    expect(metaRule).toContain("inline-flex");
    expect(metaRule).toContain("items-center");
    expect(metaRule).toContain("line-height: 1");
    expect(actionRule).toContain("place-items: center");
    expect(actionRule).toContain("font: inherit");
    expect(actionRule).toContain("line-height: 1");
  });

  // FloatingWindow portals its frame, so SSR yields no markup to assert on.
  test("exposes exactly one keyboard-resizable window corner", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "./FloatingWindow.tsx")).text();
    const handles = source.match(/class="k2b-floating-window__resize"/g) ?? [];

    expect(handles).toHaveLength(2);
    expect(source.match(/aria-label="Resize window\./g) ?? []).toHaveLength(1);
    expect(source).toContain('edge === "bottom-right" ? (');
    expect(source).toContain('aria-hidden="true"');
  });

  test("rejects malformed persisted workspace state", () => {
    expect(normalizeAppWorkspaceLayoutState(null)).toBeNull();
    expect(normalizeAppWorkspaceLayoutState({ version: 3, sidebarWidth: 240 })).toBeNull();
    expect(normalizeAppWorkspaceLayoutState({ version: 2, sidebarWidth: "240" })).toBeNull();
    expect(parseAppWorkspaceLayoutState("not-json")).toBeNull();
    expect(parseAppWorkspaceLayoutState(null)).toBeNull();
  });

  test("migrates a legacy layout without trusting version-2 panel maps", () => {
    expect(
      normalizeAppWorkspaceLayoutState({
        version: 1,
        sidebarWidth: 100,
        detailWidth: 900,
        paneWidths: { list: 420 },
        drawerHeights: { activity: 260 },
      }),
    ).toEqual({
      version: 2,
      sidebarWidth: 176,
      sidebarCollapsed: undefined,
      paneWidths: undefined,
      detailWidths: { primary: 640 },
      drawerHeights: undefined,
    });
  });

  test("clamps and sanitizes keyed panel sizes", () => {
    expect(
      normalizeAppWorkspaceLayoutState({
        version: 2,
        paneWidths: { conversations: 420, "unsafe/pane": 999 },
        detailWidths: { contact: 420, "mail/thread": 999, invalid: "320" },
        drawerHeights: { activity: 120 },
      }),
    ).toEqual({
      version: 2,
      sidebarWidth: undefined,
      sidebarCollapsed: undefined,
      paneWidths: { conversations: 420, unsafe_pane: 640 },
      detailWidths: { contact: 420, mail_thread: 640 },
      drawerHeights: { activity: 160 },
    });
  });

  test("preserves the remembered sidebar width while deriving its collapsed first-paint style", () => {
    const state = normalizeAppWorkspaceLayoutState({ version: 2, sidebarWidth: 248, sidebarCollapsed: true });

    expect(state?.sidebarWidth).toBe(248);
    expect(appWorkspaceLayoutStyle(state)).toBe("--k2b-workspace-sidebar-width:64px");
  });

  test("renders the host-provided collapse state before hydration", () => {
    const html = renderToString(() =>
      createComponent(AppWorkspace.LayoutStateProvider, {
        state: { version: 2, sidebarWidth: 248, sidebarCollapsed: true },
        get children() {
          return createComponent(AppWorkspace, { children: "body" });
        },
      }),
    );

    expect(html).toContain('data-sidebar-collapsed="true"');
    expect(html).toContain("--k2b-workspace-sidebar-width:64px");
  });

  test("renders a direct layoutState prop before hydration", () => {
    const html = renderToString(() =>
      createComponent(AppWorkspace, {
        layoutState: () => ({ version: 2, sidebarWidth: 560 }),
        children: "body",
      }),
    );

    expect(html).toContain("--k2b-workspace-sidebar-width:560px");
  });

  test("inherits a server-rendered sidebar width before controller hydration", () => {
    const css = readFileSync(resolve(import.meta.dir, "../styles/layout-parity.css"), "utf8");
    const rootRule = css.match(/\.k2b-ui \.k2b-app-workspace\s*\{([\s\S]*?)\}/)?.[1];

    expect(rootRule).toBeDefined();
    expect(rootRule).not.toContain("--k2b-workspace-sidebar-width");
    expect(css.match(/var\(--k2b-workspace-sidebar-width, 13rem\)/g)).toHaveLength(3);
    expect(css).not.toContain("var(--k2b-workspace-sidebar-width)");
  });

  test("snaps only opt-in sidebars to the collapsed width", () => {
    expect(resolveAppWorkspaceSidebarWidth(120, 360, true)).toEqual({ width: 64, collapsed: true });
    expect(resolveAppWorkspaceSidebarWidth(140, 360, true)).toEqual({ width: 176, collapsed: false });
    expect(resolveAppWorkspaceSidebarWidth(120, 360, false)).toEqual({ width: 176, collapsed: false });
    expect(shouldCollapseAppWorkspaceSidebar(127, true)).toBe(true);
    expect(shouldCollapseAppWorkspaceSidebar(128, true)).toBe(false);
    expect(shouldCollapseAppWorkspaceSidebar(64, false)).toBe(false);
  });

  test("keeps a usable main region while resizing inline panels", () => {
    expect(appWorkspaceResizeLimits({ kind: "sidebar", workspaceSize: 1000, reservedSize: 384 })).toEqual({
      min: 176,
      max: 296,
    });
    expect(appWorkspaceResizeLimits({ kind: "sidebar", workspaceSize: 1000, reservedSize: 384, sidebarCollapsible: true })).toEqual({
      min: 64,
      max: 296,
    });
    expect(appWorkspaceResizeLimits({ kind: "detail", workspaceSize: 1400, reservedSize: 208 })).toEqual({
      min: 288,
      max: 640,
    });
    expect(appWorkspaceResizeLimits({ kind: "detail", workspaceSize: 900, reservedSize: 500 })).toEqual({
      min: 288,
      max: 288,
    });
    expect(appWorkspaceResizeLimits({ kind: "pane", workspaceSize: 1200, reservedSize: 320 })).toEqual({
      min: 240,
      max: 560,
    });
    expect(appWorkspaceResizeLimits({ kind: "drawer", workspaceSize: 900, reservedSize: 0 })).toEqual({
      min: 160,
      max: 560,
    });
    expect(appWorkspaceResizeLimits({ kind: "drawer", workspaceSize: 360, reservedSize: 0 })).toEqual({
      min: 160,
      max: 160,
    });
    expect(
      fitAppWorkspacePaneSizes(
        [
          { desired: 500, min: 240 },
          { desired: 500, min: 240 },
        ],
        680,
      ),
    ).toEqual([340, 340]);
    expect(fitAppWorkspacePaneSizes([{ desired: 500, min: 240 }], 600)).toEqual([500]);
    expect(fitAppWorkspacePaneSizes([{ desired: 500, min: 240 }], 120)).toEqual([240]);
  });

  test("renders a detail resize handle only for resizable details", () => {
    const renderDetail = (resizable: boolean | undefined) =>
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
                    resizable,
                    children: "Detail",
                  }),
                ];
              },
            });
          },
        }),
      );

    expect(renderDetail(undefined)).toContain('data-app-workspace-resize="detail"');
    expect(renderDetail(undefined)).toContain('data-workspace-resizable="true"');
    expect(renderDetail(false)).not.toContain('data-app-workspace-resize="detail"');
    expect(renderDetail(false)).toContain('data-workspace-resizable="false"');
  });

  test("renders configured sidebar resize limits", () => {
    const html = renderToString(() =>
      createComponent(AppWorkspace, {
        get children() {
          return createComponent(AppWorkspace.Sidebar, {
            defaultSize: 560,
            minSize: 420,
            maxSize: 880,
            children: createComponent(AppWorkspace.SidebarDesktop, { children: "Navigator" }),
          });
        },
      }),
    );

    expect(html).toContain('data-workspace-default-size="560"');
    expect(html).toContain('data-workspace-min-size="420"');
    expect(html).toContain('data-workspace-max-size="880"');
  });

  test("applies view transitions directly to sidebar icon actions", () => {
    const html = renderToString(() =>
      createComponent(AppWorkspace.SidebarIconAction, {
        label: "Search notes",
        icon: "ti ti-search",
        viewTransitionName: "notebook-search",
      }),
    );

    expect(html).toContain("view-transition-name:notebook-search");
  });

  test("keeps the split layout when every main pane is closed", () => {
    const html = renderToString(() =>
      createComponent(AppWorkspace, {
        get children() {
          return createComponent(AppWorkspace.Main, {
            get children() {
              return createComponent(AppWorkspace.MainPane, {
                id: "list",
                label: "Items",
                open: false,
                children: "Hidden pane",
              });
            },
          });
        },
      }),
    );

    expect(html).toContain("has-panes");
    expect(html).not.toContain("Hidden pane");
    expect(html).not.toContain("[object Object]");
    expect(html).not.toContain("Symbol(");
  });

  test("keeps sidebar item semantics faithful to their element type", () => {
    const html = renderToString(() =>
      createComponent(AppWorkspace, {
        get children() {
          return createComponent(AppWorkspace.Sidebar, {
            get children() {
              return createComponent(AppWorkspace.SidebarDesktop, {
                get children() {
                  return [
                    createComponent(AppWorkspace.SidebarItem, {
                      active: true,
                      sidebarMode: "always",
                      children: "Button row",
                    }),
                    createComponent(AppWorkspace.SidebarItem, {
                      disabled: true,
                      actionIcon: "ti ti-dots",
                      actionLabel: "Row action",
                      children: "Disabled row",
                    }),
                  ];
                },
              });
            },
          });
        },
      }),
    );

    // `aria-current` is a link state; the button fallback must not claim it.
    expect(html).not.toContain('aria-current="page"');
    expect(html).not.toContain('data-sidebar-mode="always"');
    expect(html).toContain('data-disabled="true"');
  });

  test("wires the resize controller itself so handles are live by default", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "./AppWorkspace.tsx")).text();

    // Handles are inert markup until something installs the controller. Making
    // the consumer discover a separate install call is not an API choice.
    expect(source).toContain("installAppWorkspaceController({");
    expect(source).toContain("onMount(() => {");
    expect(source).toContain("onCleanup(");
    // Persistence stays app-owned — the package reads and writes nothing.
    expect(source).toContain("readState: () => (props.layoutState ? props.layoutState() : serverLayoutState)");
    expect(source).toContain("writeState: (state) => props.onLayoutChange?.(state)");
    expect(source).toContain('root.closest("[data-k2b-app-workspace-controller]")');
    // `onMount` never runs during SSR, so rendering must stay DOM-free.
    expect(renderToString(() => createComponent(AppWorkspace, { children: "body" }))).toContain("data-k2b-app-workspace");
  });

  test("renders a measurable marquee label that honours marquee={false}", () => {
    const item = (marquee?: boolean) =>
      renderToString(() =>
        createComponent(AppWorkspace.SidebarItem, {
          href: "/items",
          get children() {
            return createComponent(AppWorkspace.SidebarItemLabel, { marquee, children: "A very long row label" });
          },
        }),
      );

    // The controller measures this inner span against its clipping parent.
    expect(item()).toContain('class="k2b-app-workspace__sidebar-item-label-text"');
    expect(item()).toContain('data-marquee="true"');
    expect(item(false)).not.toContain("data-marquee");
    expect(item(false)).toContain('class="k2b-app-workspace__sidebar-item-label-text"');
  });

  test("uses Cloud's default detail widths and drawer heights", () => {
    // These land in `aria-valuenow` and in the `var(…, Npx)` first-paint
    // fallback, so a drifting default is a visible first-paint difference.
    const detail = (width: "lg" | "xl") =>
      renderToString(() => createComponent(AppWorkspace.Detail, { id: "d", open: true, width, children: "x" }));
    const drawer = (height: "sm" | "lg") =>
      renderToString(() => createComponent(AppWorkspace.BottomDrawer, { id: "b", open: true, height, children: "x" }));

    expect(detail("lg")).toContain("480px");
    expect(detail("xl")).toContain("544px");
    expect(drawer("sm")).toContain("192px");
    expect(drawer("lg")).toContain("320px");
  });

  test("reserves Cloud's main-region budget through named constants", () => {
    expect(APP_WORKSPACE_MAIN_MIN).toBe(320);
    expect(APP_WORKSPACE_MAIN_MIN_HEIGHT).toBe(240);
    // 1000 − 0 reserved − 320 main
    expect(appWorkspaceResizeLimits({ kind: "detail", workspaceSize: 1000, reservedSize: 0 }).max).toBe(640);
    // 700 − 0 reserved − 240 main (height budget)
    expect(appWorkspaceResizeLimits({ kind: "drawer", workspaceSize: 700, reservedSize: 0 }).max).toBe(460);
  });

  /**
   * Cloud gets this geometry from inline Tailwind utilities; the package emits
   * none, so every value has to exist as a real declaration. Each assertion
   * below replaces a number the port had invented.
   */
  describe("layout geometry parity", () => {
    const css = readFileSync(resolve(import.meta.dir, "../../dist/styles.css"), "utf8");
    /** Every declaration the cascade applies to `selector`, in source order. */
    const rule = (selector: string) => {
      const matches = [
        ...css.matchAll(new RegExp(`(?:^|[,}])\\s*\\.k2b-ui ${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g")),
      ];
      if (matches.length === 0) throw new Error(`no rule for ${selector}`);
      return matches.map((match) => match[1] ?? "").join(";");
    };

    test("keeps workspace drawers in the content column and resize handles out of layout", () => {
      expect(rule(".k2b-app-workspace")).toContain('grid-template-areas:"mobile" "content" "drawer"');
      expect(rule(".k2b-app-workspace__drawer")).toContain("grid-area:drawer");

      const resize = rule(".k2b-app-workspace__resize");
      expect(resize).toContain("position:absolute");
      expect(resize).toContain("width:var(--k2b-workspace-resize-hit-size)");
      const inlineResize = rule(
        ".k2b-app-workspace__main>.k2b-app-workspace__resize[data-app-workspace-resize=pane],.k2b-ui .k2b-app-workspace__content>.k2b-app-workspace__resize[data-app-workspace-resize=detail]",
      );
      expect(inlineResize).toContain("flex:0 0 var(--k2b-workspace-resize-hit-size)");
      // The detail handle is emitted before its panel. Giving only the handle
      // an order moves it behind the panel and puts the hit target on the
      // trailing edge instead of between main and detail.
      expect(inlineResize).not.toContain("order:");
    });

    test("keeps workspace geometry transparent across Solid island wrappers", () => {
      expect(css).toMatch(/>:is\(solid-island,solid-client\)>\.k2b-app-workspace__content/);
      expect(css).toMatch(/>:is\(solid-island,solid-client\)>\.k2b-app-workspace__sidebar/);
      expect(css).toMatch(/>:is\(solid-island,solid-client\)>\.k2b-app-workspace__detail:not\(\[hidden\]\)/);
      expect(css).toMatch(/>:is\(solid-island,solid-client\)>\.k2b-app-workspace__resize\[data-app-workspace-resize=detail\]/);
      expect(css).toMatch(/>:is\(solid-island,solid-client\)>\.k2b-app-workspace__resize\[data-app-workspace-resize=drawer\]/);
    });

    test("keeps the workspace surface hierarchy aligned with Cloud", () => {
      expect(rule(".k2b-app-workspace")).toContain("--k2b-workspace-resize-hit-size:1.25rem");
      expect(rule(".k2b-app-workspace")).toContain("background:var(--k2b-surface)");
      expect(rule(".k2b-app-workspace__sidebar")).toContain("background:var(--k2b-surface-muted)");
      expect(rule(".k2b-app-workspace__sidebar-desktop")).toContain("display:flex");
      expect(rule(".k2b-app-workspace__sidebar-desktop")).toContain("padding:.5rem");
      expect(rule(".k2b-app-workspace__sidebar-body")).toContain("padding:0");
      expect(rule(".k2b-app-workspace__sidebar-footer")).toContain("padding:0");
      expect(rule(".k2b-app-workspace__sidebar-item")).toContain("--k2b-sidebar-item-depth");
      expect(rule(".k2b-app-workspace__sidebar-heading strong")).toContain("font-size:1rem");
      expect(rule(".k2b-app-workspace__sidebar-icon-action")).toContain("width:100%");
      expect(rule(".k2b-app-workspace__main-pane[data-surface=navigation]")).toContain("background:var(--k2b-surface-muted)");
      expect(rule(".k2b-app-workspace__main-pane[data-surface=navigation]")).toContain("padding:.5rem");
      expect(rule(".k2b-app-workspace__detail")).toContain("background:var(--k2b-surface-muted)");
      expect(rule(".k2b-app-workspace__detail")).toContain("padding:.75rem");
      expect(rule(".k2b-app-workspace__drawer")).toContain("background:var(--k2b-surface-muted)");
    });

    test("reduces a collapsible sidebar to an intentional icon rail", () => {
      expect(css).toMatch(
        /data-sidebar-collapsed=true\][^{]*sidebar-header>:not\(\.k2b-app-workspace__sidebar-header-icon\)\{display:none!important/,
      );
      expect(css).toMatch(/data-sidebar-collapsed=true\][^{]*sidebar-item-label[^}]*\{display:none!important/);
      expect(css).toMatch(/data-sidebar-collapsed=true\][^{]*:is\(\.k2b-app-workspace__sidebar-item,[^{]*\)\{justify-content:center/);
    });

    test("keeps DataPanel on Cloud's px-3 py-2 rhythm", () => {
      // Cloud: `flex flex-col gap-2 px-3 py-2`, with `search` and `filters`
      // stacked as siblings rather than laid side by side.
      expect(rule(".k2b-data-panel__header")).toContain("padding:.5rem .75rem");
      expect(rule(".k2b-data-panel__header")).toContain("flex-direction:column");
      expect(rule(".k2b-data-panel__toolbar")).toContain("flex-direction:column");
      expect(rule(".k2b-data-panel__toolbar")).not.toContain("margin-top");
      expect(rule(".k2b-data-panel__controls")).toContain("flex-direction:column");
      expect(rule(".k2b-data-panel__controls")).toContain("padding:0 .75rem .5rem");
      expect(rule(".k2b-data-panel>.k2b-table-wrap[data-surface=paper]")).toContain("border:0");
      expect(rule(".k2b-data-panel>.k2b-table-wrap[data-surface=paper]")).toContain("border-radius:0");
      expect(rule(".k2b-data-panel>.k2b-table-wrap[data-surface=paper]")).toContain("box-shadow:none");
      // Cloud's footer is a bare `px-3 py-2` box — no muted colour, no shrink.
      expect(rule(".k2b-data-panel__footer")).toContain("padding:.5rem .75rem");
      expect(rule(".k2b-data-panel__footer")).toContain("border-top:1px solid var(--k2b-border)");
      expect(rule(".k2b-data-panel__footer>.k2b-pagination")).toBe("padding-top:0");
      expect(rule(".k2b-data-panel>.k2b-table-wrap[data-has-footer=true]+.k2b-data-panel__footer")).toBe("border-top:0");
      // The compact Placeholder carries its own px-3 py-6.
      expect(css).not.toContain(".k2b-data-panel>.k2b-placeholder");
    });

    test("scales the PanelHeader subtitle with its size, as Cloud does", () => {
      // Cloud: `text-xs font-semibold` / `text-base font-semibold` heading,
      // `text-[10px]` / `mt-1 text-xs` subtitle.
      expect(rule(".k2b-panel-header__title")).toContain("font-size:.75rem");
      expect(rule(".k2b-panel-header__title")).toContain("font-weight:600");
      expect(rule(".k2b-panel-header__title.is-medium")).toContain("font-size:1rem");
      expect(rule(".k2b-panel-header__subtitle")).toContain("font-size:.625rem");
      // The component emits `data-size`; before this it matched no rule at all.
      expect(rule(".k2b-panel-header[data-size=md] .k2b-panel-header__subtitle")).toContain("font-size:.75rem");
    });

    test("gives the settings rail Cloud's sidebar-item affordances", () => {
      const tab = rule(".k2b-settings__tabs button");
      expect(tab).toContain("min-height:2rem");
      expect(tab).toContain("font-size:.75rem");
      expect(tab).toContain("padding:.375rem .5rem");
      // Roving tabindex moves focus programmatically — it must be visible.
      expect(css).toContain(".k2b-settings__tabs button:focus-visible");
      expect(css).toContain(".k2b-settings__tabs button:not([data-active=true]):hover");
      // A single-line label truncates; it is not a flex column.
      expect(rule(".k2b-settings__tabs button>span")).toContain("text-overflow:ellipsis");
      expect(rule(".k2b-settings__tabs button>span")).not.toContain("flex-direction:column");
    });

    test("keeps SettingsField a plain row and scopes its typography", () => {
      const field = rule(".k2b-settings-field");
      // Cloud: `flex flex-col gap-1.5 px-3 py-3` — no fill, no radius.
      expect(field).toContain("gap:.375rem");
      expect(field).not.toContain("background");
      expect(field).not.toContain("border-radius");
      expect(rule(".k2b-settings-field__heading strong")).toContain("font-size:.875rem");
      expect(rule(".k2b-settings-field__heading strong")).toContain("font-weight:500");
      // The description rule must not reach the error line or consumer content.
      expect(css).not.toMatch(/\.k2b-settings-field p\s*\{/);
      expect(rule(".k2b-settings-field__error")).toContain("font-size:.75rem");
      // Cloud's save bar is `z-10`; sticky alone does not raise it.
      expect(rule(".k2b-settings-save-bar")).toContain("z-index:10");
      const pageFooter = rule(".k2b-settings-page__footer");
      expect(pageFooter).toContain("position:sticky");
      expect(pageFooter).toContain("bottom:0");
      expect(pageFooter).toContain("z-index:20");
      expect(pageFooter).not.toContain("background");
      expect(pageFooter).not.toContain("border-top");
    });

    test("does not restyle consumer content inside a settings tab panel", () => {
      // These bare descendant selectors reached every heading and paragraph the
      // consumer rendered as tab children.
      expect(css).not.toMatch(/\.k2b-settings__content h2\s*[,{]/);
      expect(css).not.toMatch(/\.k2b-settings__content p\s*[,{]/);
      expect(css).not.toContain(".k2b-settings__content>header");
      expect(rule(".k2b-settings__section-heading h2")).toContain("font-size:1.25rem");
    });

    test("restores Cloud's pane chrome", () => {
      // Cloud's strip is `h-8` inside a rounded `--ui-radius-control` well with
      // `padding: .125rem` and `items-stretch`; the port made it a 2.25rem
      // square-cornered bar.
      const strip = rule(".k2b-panes__tabs");
      expect(strip).toContain("height:2rem");
      expect(strip).toContain("padding:.125rem");
      expect(strip).toContain("border-radius:var(--k2b-radius-control)");

      // Cloud: `min-w-32` with `flex-1` and no upper bound.
      const tab = rule(".k2b-panes__tab");
      expect(tab).toContain("min-width:8rem");
      expect(tab).not.toContain("max-width");
      // The active chip's inset hairline ring is Cloud's `.panes-tab-active`.
      expect(rule(".k2b-panes__tab[data-active=true]")).toContain("inset 0 0 0 1px var(--k2b-border)");
      // Cloud renders the single-pane header as an active chip, not a bar.
      expect(rule(".k2b-panes__single-header")).toContain("inset 0 0 0 1px var(--k2b-border)");

      // Cloud: `w-2`/`h-2` track with a full-width `rounded-full` indicator.
      expect(rule(".k2b-panes__separator[data-direction=horizontal]")).toContain("width:.5rem");
      expect(rule(".k2b-panes__separator[data-direction=horizontal]>span")).not.toContain("width:1px");
      // Cloud: `inset-y-2 w-2` / `inset-x-2 h-2`, `rounded`.
      expect(rule(".k2b-panes__drop-zone[data-zone=left],.k2b-ui .k2b-panes__drop-zone[data-zone=right]")).toContain("width:.5rem");
      const merge = rule(".k2b-panes__merge-preview");
      expect(merge).toContain("width:.5rem");
      expect(merge).toContain("border-radius:999px");
      expect(merge).not.toContain("min-width:8rem");

      // Cloud has no width-based floors on split children.
      expect(css).not.toContain("min-width:16rem");
    });

    test("never nests a scroll container inside a pane", () => {
      // Cloud's wrapper is `display: contents` — no box, so no second scroller.
      // The role has to survive, so the box stays but must not scroll.
      expect(rule(".k2b-panes__panel")).not.toContain("overflow");
      expect(rule(".k2b-panes__body")).toContain("overflow:hidden");
      // Cloud: `panes-root … overflow-hidden`.
      expect(rule(".k2b-panes")).toContain("overflow:hidden");
    });

    test("drives the sidebar marquee from a measured overflow", () => {
      // The prop used to emit `data-marquee` with nothing behind it.
      expect(css).toContain("@keyframes k2b-sidebar-label-marquee");
      expect(css).toContain(".k2b-app-workspace__sidebar-item-label[data-overflow=true][data-marquee=true]");
      expect(rule(".k2b-app-workspace__sidebar-item-label-text")).toContain("min-width:max-content");
      // Reduced motion must win over the running animation.
      expect(css).toContain("animation:none!important");
    });

    test("mutes a pane separator that cannot be dragged", () => {
      // Cloud paints the highlight only when `canResize()` is true.
      expect(css).toContain(".k2b-panes__separator:not([aria-disabled=true]):hover>span");
      expect(css).not.toMatch(/\.k2b-panes__separator:hover>span/);
      // Cloud's leaf is `flex-col gap-1`.
      expect(rule(".k2b-panes__leaf")).toContain("gap:.25rem");
    });
  });
});

import { describe, expect, test } from "bun:test";
import {
  appWorkspaceCookieName,
  appWorkspaceLayoutStyle,
  appWorkspaceResizeLimits,
  normalizeAppWorkspaceLayoutState,
  parseAppWorkspaceLayoutState,
  readAppWorkspaceLayoutCookie,
  resolveAppWorkspaceSidebarWidth,
  serializeAppWorkspaceLayoutState,
  shouldCollapseAppWorkspaceSidebar,
} from "./app-workspace-state";

describe("AppWorkspace layout state", () => {
  test("migrates legacy detail width and clamps persisted sizes", () => {
    expect(normalizeAppWorkspaceLayoutState({ version: 1, sidebarWidth: 100, detailWidth: 900 })).toEqual({
      version: 2,
      sidebarWidth: 176,
      sidebarCollapsed: undefined,
      detailWidths: { primary: 640 },
      drawerHeights: undefined,
    });
  });

  test("normalizes keyed detail and drawer sizes", () => {
    expect(
      normalizeAppWorkspaceLayoutState({
        version: 2,
        detailWidths: { contact: 420, "mail/thread": 999, invalid: "320" },
        drawerHeights: { activity: 120 },
      }),
    ).toEqual({
      version: 2,
      sidebarWidth: undefined,
      sidebarCollapsed: undefined,
      detailWidths: { contact: 420, mail_thread: 640 },
      drawerHeights: { activity: 160 },
    });
  });

  test("rejects malformed or empty state", () => {
    expect(normalizeAppWorkspaceLayoutState(null)).toBeNull();
    expect(normalizeAppWorkspaceLayoutState({ version: 3, sidebarWidth: 240 })).toBeNull();
    expect(normalizeAppWorkspaceLayoutState({ version: 2, sidebarWidth: "240" })).toBeNull();
    expect(parseAppWorkspaceLayoutState("not-json")).toBeNull();
  });

  test("round-trips a compact cookie value", () => {
    const state = {
      version: 2 as const,
      sidebarWidth: 236,
      sidebarCollapsed: true,
      detailWidths: { contact: 428 },
      drawerHeights: { activity: 260 },
    };
    expect(parseAppWorkspaceLayoutState(serializeAppWorkspaceLayoutState(state))).toEqual(state);
  });

  test("reads the current app cookie and emits SSR variables", () => {
    const value = serializeAppWorkspaceLayoutState({ version: 2, sidebarWidth: 232, detailWidths: { contact: 416 } });
    const state = readAppWorkspaceLayoutCookie(`theme=dark; ${appWorkspaceCookieName("contacts")}=${value}`, "contacts");
    expect(state).toEqual({
      version: 2,
      sidebarWidth: 232,
      sidebarCollapsed: undefined,
      detailWidths: { contact: 416 },
      drawerHeights: undefined,
    });
    expect(appWorkspaceLayoutStyle(state)).toBe("--workspace-sidebar-width:232px;--workspace-detail-contact-width:416px");
  });

  test("keeps the legacy primary detail variable during migration", () => {
    const state = normalizeAppWorkspaceLayoutState({ version: 1, detailWidth: 416 });
    expect(appWorkspaceLayoutStyle(state)).toBe("--workspace-detail-primary-width:416px;--workspace-detail-width:416px");
  });

  test("sanitizes app ids used in cookie names", () => {
    expect(appWorkspaceCookieName("my/app id")).toBe("cloud_workspace_my_app_id");
  });

  test("restores collapsed sidebars during SSR without losing their expanded width", () => {
    const state = normalizeAppWorkspaceLayoutState({ version: 2, sidebarWidth: 248, sidebarCollapsed: true });
    expect(state).toEqual({
      version: 2,
      sidebarWidth: 248,
      sidebarCollapsed: true,
      detailWidths: undefined,
      drawerHeights: undefined,
    });
    expect(appWorkspaceLayoutStyle(state)).toBe("--workspace-sidebar-width:64px");
  });

  test("snaps only opt-in sidebars to the collapsed width", () => {
    expect(resolveAppWorkspaceSidebarWidth(120, 360, true)).toEqual({ width: 64, collapsed: true });
    expect(resolveAppWorkspaceSidebarWidth(140, 360, true)).toEqual({ width: 176, collapsed: false });
    expect(resolveAppWorkspaceSidebarWidth(120, 360, false)).toEqual({ width: 176, collapsed: false });
  });

  test("previews the collapsed content mode at the same drag threshold", () => {
    expect(shouldCollapseAppWorkspaceSidebar(127, true)).toBe(true);
    expect(shouldCollapseAppWorkspaceSidebar(128, true)).toBe(false);
    expect(shouldCollapseAppWorkspaceSidebar(64, false)).toBe(false);
  });

  test("keeps a usable main region while resizing inline panels", () => {
    expect(appWorkspaceResizeLimits({ kind: "sidebar", workspaceSize: 1000, reservedSize: 384, sidebarCollapsible: false })).toEqual({
      min: 176,
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
    expect(appWorkspaceResizeLimits({ kind: "sidebar", workspaceSize: 1000, reservedSize: 384, sidebarCollapsible: true })).toEqual({
      min: 64,
      max: 296,
    });
  });

  test("keeps a usable main region above the bottom drawer", () => {
    expect(appWorkspaceResizeLimits({ kind: "drawer", workspaceSize: 900, reservedSize: 0 })).toEqual({ min: 160, max: 560 });
    expect(appWorkspaceResizeLimits({ kind: "drawer", workspaceSize: 360, reservedSize: 0 })).toEqual({ min: 160, max: 160 });
  });
});

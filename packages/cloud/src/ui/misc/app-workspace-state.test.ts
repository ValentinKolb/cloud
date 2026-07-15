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
} from "./app-workspace-state";

describe("AppWorkspace layout state", () => {
  test("normalizes and clamps persisted widths", () => {
    expect(normalizeAppWorkspaceLayoutState({ version: 1, sidebarWidth: 100, detailWidth: 900 })).toEqual({
      version: 1,
      sidebarWidth: 176,
      detailWidth: 640,
    });
  });

  test("rejects malformed or empty state", () => {
    expect(normalizeAppWorkspaceLayoutState(null)).toBeNull();
    expect(normalizeAppWorkspaceLayoutState({ version: 2, sidebarWidth: 240 })).toBeNull();
    expect(normalizeAppWorkspaceLayoutState({ version: 1, sidebarWidth: "240" })).toBeNull();
    expect(parseAppWorkspaceLayoutState("not-json")).toBeNull();
  });

  test("round-trips a compact cookie value", () => {
    const state = { version: 1 as const, sidebarWidth: 236, sidebarCollapsed: true, detailWidth: 428 };
    expect(parseAppWorkspaceLayoutState(serializeAppWorkspaceLayoutState(state))).toEqual(state);
  });

  test("reads the current app cookie and emits SSR variables", () => {
    const value = serializeAppWorkspaceLayoutState({ version: 1, sidebarWidth: 232, detailWidth: 416 });
    const state = readAppWorkspaceLayoutCookie(`theme=dark; ${appWorkspaceCookieName("assistant")}=${value}`, "assistant");
    expect(state).toEqual({ version: 1, sidebarWidth: 232, detailWidth: 416 });
    expect(appWorkspaceLayoutStyle(state)).toBe("--workspace-sidebar-width:232px;--workspace-detail-width:416px");
  });

  test("sanitizes app ids used in cookie names", () => {
    expect(appWorkspaceCookieName("my/app id")).toBe("cloud_workspace_my_app_id");
  });

  test("restores collapsed sidebars during SSR without losing their expanded width", () => {
    const state = normalizeAppWorkspaceLayoutState({ version: 1, sidebarWidth: 248, sidebarCollapsed: true });
    expect(state).toEqual({ version: 1, sidebarWidth: 248, sidebarCollapsed: true, detailWidth: undefined });
    expect(appWorkspaceLayoutStyle(state)).toBe("--workspace-sidebar-width:64px");
  });

  test("snaps only opt-in sidebars to the collapsed width", () => {
    expect(resolveAppWorkspaceSidebarWidth(120, 360, true)).toEqual({ width: 64, collapsed: true });
    expect(resolveAppWorkspaceSidebarWidth(140, 360, true)).toEqual({ width: 176, collapsed: false });
    expect(resolveAppWorkspaceSidebarWidth(120, 360, false)).toEqual({ width: 176, collapsed: false });
  });

  test("keeps a usable main region while resizing either panel", () => {
    expect(appWorkspaceResizeLimits({ kind: "sidebar", workspaceWidth: 1000, sidebarWidth: 208, detailWidth: 384 })).toEqual({
      min: 176,
      max: 296,
    });
    expect(appWorkspaceResizeLimits({ kind: "detail", workspaceWidth: 1400, sidebarWidth: 208, detailWidth: 384 })).toEqual({
      min: 288,
      max: 640,
    });
    expect(appWorkspaceResizeLimits({ kind: "detail", workspaceWidth: 640, sidebarWidth: 208, detailWidth: 384 })).toEqual({
      min: 288,
      max: 288,
    });
    expect(
      appWorkspaceResizeLimits({
        kind: "sidebar",
        workspaceWidth: 1000,
        sidebarWidth: 208,
        detailWidth: 384,
        sidebarCollapsible: true,
      }),
    ).toEqual({ min: 64, max: 296 });
  });
});

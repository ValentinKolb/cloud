export type AppWorkspaceLayoutState = {
  version: 1;
  sidebarWidth?: number;
  sidebarCollapsed?: boolean;
  detailWidth?: number;
};

export const APP_WORKSPACE_SIDEBAR_DEFAULT = 208;
export const APP_WORKSPACE_SIDEBAR_COLLAPSED = 64;
export const APP_WORKSPACE_SIDEBAR_COLLAPSE_THRESHOLD = 128;
export const APP_WORKSPACE_SIDEBAR_MIN = 176;
export const APP_WORKSPACE_SIDEBAR_MAX = 360;
export const APP_WORKSPACE_DETAIL_DEFAULT = 384;
export const APP_WORKSPACE_DETAIL_MIN = 288;
export const APP_WORKSPACE_DETAIL_MAX = 640;
export const APP_WORKSPACE_MAIN_MIN = 320;

export type AppWorkspaceResizeKind = "sidebar" | "detail";

export const appWorkspaceResizeLimits = (options: {
  kind: AppWorkspaceResizeKind;
  workspaceWidth: number;
  sidebarWidth: number;
  detailWidth: number;
  sidebarCollapsible?: boolean;
}): { min: number; max: number } => {
  const min =
    options.kind === "sidebar"
      ? options.sidebarCollapsible
        ? APP_WORKSPACE_SIDEBAR_COLLAPSED
        : APP_WORKSPACE_SIDEBAR_MIN
      : APP_WORKSPACE_DETAIL_MIN;
  const configuredMax = options.kind === "sidebar" ? APP_WORKSPACE_SIDEBAR_MAX : APP_WORKSPACE_DETAIL_MAX;
  const otherPanelWidth = options.kind === "sidebar" ? options.detailWidth : options.sidebarWidth;
  const availableMax = options.workspaceWidth - otherPanelWidth - APP_WORKSPACE_MAIN_MIN;
  return { min, max: Math.max(min, Math.min(configuredMax, availableMax)) };
};

export const resolveAppWorkspaceSidebarWidth = (
  requestedWidth: number,
  maxWidth: number,
  collapsible: boolean,
): { width: number; collapsed: boolean } => {
  if (collapsible && requestedWidth < APP_WORKSPACE_SIDEBAR_COLLAPSE_THRESHOLD) {
    return { width: APP_WORKSPACE_SIDEBAR_COLLAPSED, collapsed: true };
  }
  return {
    width: Math.round(Math.min(maxWidth, Math.max(APP_WORKSPACE_SIDEBAR_MIN, requestedWidth))),
    collapsed: false,
  };
};

const finiteWidth = (value: unknown, min: number, max: number): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.round(Math.min(max, Math.max(min, value)));
};

const safeAppId = (appId: string): string => appId.replace(/[^A-Za-z0-9_-]/g, "_");

export const appWorkspaceCookieName = (appId: string): string => `cloud_workspace_${safeAppId(appId)}`;

export const normalizeAppWorkspaceLayoutState = (value: unknown): AppWorkspaceLayoutState | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AppWorkspaceLayoutState>;
  if (candidate.version !== 1) return null;

  const sidebarWidth = finiteWidth(candidate.sidebarWidth, APP_WORKSPACE_SIDEBAR_MIN, APP_WORKSPACE_SIDEBAR_MAX);
  const sidebarCollapsed = typeof candidate.sidebarCollapsed === "boolean" ? candidate.sidebarCollapsed : undefined;
  const detailWidth = finiteWidth(candidate.detailWidth, APP_WORKSPACE_DETAIL_MIN, APP_WORKSPACE_DETAIL_MAX);
  if (sidebarWidth === undefined && sidebarCollapsed === undefined && detailWidth === undefined) return null;

  return { version: 1, sidebarWidth, sidebarCollapsed, detailWidth };
};

export const parseAppWorkspaceLayoutState = (value: string | null | undefined): AppWorkspaceLayoutState | null => {
  if (!value) return null;
  try {
    return normalizeAppWorkspaceLayoutState(JSON.parse(decodeURIComponent(value)));
  } catch {
    return null;
  }
};

export const serializeAppWorkspaceLayoutState = (state: AppWorkspaceLayoutState): string =>
  encodeURIComponent(JSON.stringify(normalizeAppWorkspaceLayoutState(state) ?? { version: 1 }));

export const readAppWorkspaceLayoutCookie = (
  cookieHeader: string | null | undefined,
  appId: string | null | undefined,
): AppWorkspaceLayoutState | null => {
  if (!cookieHeader || !appId) return null;
  const name = appWorkspaceCookieName(appId);
  const encoded = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return parseAppWorkspaceLayoutState(encoded);
};

export const appWorkspaceLayoutStyle = (state: AppWorkspaceLayoutState | null | undefined): string | undefined => {
  if (!state) return undefined;
  const declarations = [
    state.sidebarCollapsed
      ? `--workspace-sidebar-width:${APP_WORKSPACE_SIDEBAR_COLLAPSED}px`
      : state.sidebarWidth === undefined
        ? null
        : `--workspace-sidebar-width:${state.sidebarWidth}px`,
    state.detailWidth === undefined ? null : `--workspace-detail-width:${state.detailWidth}px`,
  ].filter(Boolean);
  return declarations.length > 0 ? declarations.join(";") : undefined;
};

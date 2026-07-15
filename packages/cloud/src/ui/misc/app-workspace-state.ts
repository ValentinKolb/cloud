export type AppWorkspaceLayoutState = {
  version: 2;
  sidebarWidth?: number;
  sidebarCollapsed?: boolean;
  detailWidths?: Record<string, number>;
  drawerHeights?: Record<string, number>;
};

export const APP_WORKSPACE_SIDEBAR_DEFAULT = 208;
export const APP_WORKSPACE_SIDEBAR_COLLAPSED = 64;
export const APP_WORKSPACE_SIDEBAR_COLLAPSE_THRESHOLD = 128;
export const APP_WORKSPACE_SIDEBAR_MIN = 176;
export const APP_WORKSPACE_SIDEBAR_MAX = 360;
export const APP_WORKSPACE_DETAIL_DEFAULT = 384;
export const APP_WORKSPACE_DETAIL_MIN = 288;
export const APP_WORKSPACE_DETAIL_MAX = 640;
export const APP_WORKSPACE_DRAWER_DEFAULT = 240;
export const APP_WORKSPACE_DRAWER_MIN = 160;
export const APP_WORKSPACE_DRAWER_MAX = 560;
export const APP_WORKSPACE_MAIN_MIN = 320;
export const APP_WORKSPACE_MAIN_MIN_HEIGHT = 240;

export type AppWorkspaceResizeKind = "sidebar" | "detail" | "drawer";

export const appWorkspaceResizeLimits = (options: {
  kind: AppWorkspaceResizeKind;
  workspaceSize: number;
  reservedSize: number;
  min?: number;
  max?: number;
  sidebarCollapsible?: boolean;
}): { min: number; max: number } => {
  const defaultMin =
    options.kind === "sidebar"
      ? options.sidebarCollapsible
        ? APP_WORKSPACE_SIDEBAR_COLLAPSED
        : APP_WORKSPACE_SIDEBAR_MIN
      : options.kind === "detail"
        ? APP_WORKSPACE_DETAIL_MIN
        : APP_WORKSPACE_DRAWER_MIN;
  const defaultMax =
    options.kind === "sidebar"
      ? APP_WORKSPACE_SIDEBAR_MAX
      : options.kind === "detail"
        ? APP_WORKSPACE_DETAIL_MAX
        : APP_WORKSPACE_DRAWER_MAX;
  const min = options.min ?? defaultMin;
  const configuredMax = options.max ?? defaultMax;
  const mainMinimum = options.kind === "drawer" ? APP_WORKSPACE_MAIN_MIN_HEIGHT : APP_WORKSPACE_MAIN_MIN;
  const availableMax = options.workspaceSize - options.reservedSize - mainMinimum;
  return { min, max: Math.max(min, Math.min(configuredMax, availableMax)) };
};

export const shouldCollapseAppWorkspaceSidebar = (requestedWidth: number, collapsible: boolean): boolean =>
  collapsible && requestedWidth < APP_WORKSPACE_SIDEBAR_COLLAPSE_THRESHOLD;

export const resolveAppWorkspaceSidebarWidth = (
  requestedWidth: number,
  maxWidth: number,
  collapsible: boolean,
): { width: number; collapsed: boolean } => {
  if (shouldCollapseAppWorkspaceSidebar(requestedWidth, collapsible)) {
    return { width: APP_WORKSPACE_SIDEBAR_COLLAPSED, collapsed: true };
  }
  return {
    width: Math.round(Math.min(maxWidth, Math.max(APP_WORKSPACE_SIDEBAR_MIN, requestedWidth))),
    collapsed: false,
  };
};

const finiteSize = (value: unknown, min: number, max: number): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.round(Math.min(max, Math.max(min, value)));
};

export const safeAppWorkspacePanelId = (panelId: string): string => panelId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);

const normalizePanelSizes = (value: unknown, min: number, max: number): Record<string, number> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value)
    .slice(0, 16)
    .flatMap(([key, size]) => {
      const safeKey = safeAppWorkspacePanelId(key);
      const normalized = finiteSize(size, min, max);
      return safeKey && normalized !== undefined ? ([[safeKey, normalized]] as const) : [];
    });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const safeAppId = (appId: string): string => appId.replace(/[^A-Za-z0-9_-]/g, "_");

export const appWorkspaceCookieName = (appId: string): string => `cloud_workspace_${safeAppId(appId)}`;

export const appWorkspacePanelVariable = (kind: "detail" | "drawer", panelId: string): string =>
  `--workspace-${kind}-${safeAppWorkspacePanelId(panelId)}-${kind === "detail" ? "width" : "height"}`;

export const normalizeAppWorkspaceLayoutState = (value: unknown): AppWorkspaceLayoutState | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    version?: unknown;
    sidebarWidth?: unknown;
    sidebarCollapsed?: unknown;
    detailWidth?: unknown;
    detailWidths?: unknown;
    drawerHeights?: unknown;
  };
  if (candidate.version !== 1 && candidate.version !== 2) return null;

  const sidebarWidth = finiteSize(candidate.sidebarWidth, APP_WORKSPACE_SIDEBAR_MIN, APP_WORKSPACE_SIDEBAR_MAX);
  const sidebarCollapsed = typeof candidate.sidebarCollapsed === "boolean" ? candidate.sidebarCollapsed : undefined;
  const legacyDetailWidth =
    candidate.version === 1 ? finiteSize(candidate.detailWidth, APP_WORKSPACE_DETAIL_MIN, APP_WORKSPACE_DETAIL_MAX) : undefined;
  const detailWidths =
    candidate.version === 1
      ? legacyDetailWidth === undefined
        ? undefined
        : { primary: legacyDetailWidth }
      : normalizePanelSizes(candidate.detailWidths, APP_WORKSPACE_DETAIL_MIN, APP_WORKSPACE_DETAIL_MAX);
  const drawerHeights =
    candidate.version === 2 ? normalizePanelSizes(candidate.drawerHeights, APP_WORKSPACE_DRAWER_MIN, APP_WORKSPACE_DRAWER_MAX) : undefined;
  if (sidebarWidth === undefined && sidebarCollapsed === undefined && detailWidths === undefined && drawerHeights === undefined)
    return null;

  return { version: 2, sidebarWidth, sidebarCollapsed, detailWidths, drawerHeights };
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
  encodeURIComponent(JSON.stringify(normalizeAppWorkspaceLayoutState(state) ?? { version: 2 }));

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
    ...Object.entries(state.detailWidths ?? {}).flatMap(([panelId, width]) => [
      `${appWorkspacePanelVariable("detail", panelId)}:${width}px`,
      panelId === "primary" ? `--workspace-detail-width:${width}px` : null,
    ]),
    ...Object.entries(state.drawerHeights ?? {}).map(([panelId, height]) => `${appWorkspacePanelVariable("drawer", panelId)}:${height}px`),
  ].filter(Boolean);
  return declarations.length > 0 ? declarations.join(";") : undefined;
};

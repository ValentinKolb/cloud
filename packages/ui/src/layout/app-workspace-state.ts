export type AppWorkspaceLayoutState = {
  version: 2;
  sidebarWidth?: number;
  sidebarCollapsed?: boolean;
  paneWidths?: Record<string, number>;
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
/** Space `appWorkspaceResizeLimits` always reserves for the main region. */
export const APP_WORKSPACE_MAIN_MIN = 320;
export const APP_WORKSPACE_MAIN_MIN_HEIGHT = 240;
export const APP_WORKSPACE_PANE_DEFAULT = 320;
export const APP_WORKSPACE_PANE_MIN = 240;
export const APP_WORKSPACE_PANE_MAX = 640;

export type AppWorkspaceResizeKind = "sidebar" | "pane" | "detail" | "drawer";

export const appWorkspaceResizeLimits = (options: {
  kind: AppWorkspaceResizeKind;
  workspaceSize: number;
  reservedSize: number;
  min?: number;
  max?: number;
  sidebarCollapsible?: boolean;
}): { min: number; max: number } => {
  const min =
    options.min ??
    (options.kind === "sidebar"
      ? options.sidebarCollapsible
        ? APP_WORKSPACE_SIDEBAR_COLLAPSED
        : APP_WORKSPACE_SIDEBAR_MIN
      : options.kind === "detail"
        ? APP_WORKSPACE_DETAIL_MIN
        : options.kind === "pane"
          ? APP_WORKSPACE_PANE_MIN
          : APP_WORKSPACE_DRAWER_MIN);
  const configuredMax =
    options.max ??
    (options.kind === "sidebar"
      ? APP_WORKSPACE_SIDEBAR_MAX
      : options.kind === "detail"
        ? APP_WORKSPACE_DETAIL_MAX
        : options.kind === "pane"
          ? APP_WORKSPACE_PANE_MAX
          : APP_WORKSPACE_DRAWER_MAX);
  const mainMinimum = options.kind === "drawer" ? APP_WORKSPACE_MAIN_MIN_HEIGHT : APP_WORKSPACE_MAIN_MIN;
  return { min, max: Math.max(min, Math.min(configuredMax, options.workspaceSize - options.reservedSize - mainMinimum)) };
};

export const shouldCollapseAppWorkspaceSidebar = (width: number, collapsible: boolean): boolean =>
  collapsible && width < APP_WORKSPACE_SIDEBAR_COLLAPSE_THRESHOLD;

export const resolveAppWorkspaceSidebarWidth = (
  width: number,
  maxWidth: number,
  collapsible: boolean,
): { width: number; collapsed: boolean } =>
  shouldCollapseAppWorkspaceSidebar(width, collapsible)
    ? { width: APP_WORKSPACE_SIDEBAR_COLLAPSED, collapsed: true }
    : { width: Math.round(Math.min(maxWidth, Math.max(APP_WORKSPACE_SIDEBAR_MIN, width))), collapsed: false };

const finiteSize = (value: unknown, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(Math.min(max, Math.max(min, value))) : undefined;

export const safeAppWorkspacePanelId = (panelId: string): string =>
  panelId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);

const normalizeSizes = (value: unknown, min: number, max: number) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value)
    .slice(0, 16)
    .flatMap(([key, size]) => {
      const safe = safeAppWorkspacePanelId(key);
      const normalized = finiteSize(size, min, max);
      return safe && normalized !== undefined ? [[safe, normalized] as const] : [];
    });
  return entries.length ? Object.fromEntries(entries) : undefined;
};

export const appWorkspacePanelVariable = (kind: "pane" | "detail" | "drawer", panelId: string): string =>
  `--k2b-workspace-${kind}-${safeAppWorkspacePanelId(panelId)}-${kind === "drawer" ? "height" : "width"}`;

export const normalizeAppWorkspaceLayoutState = (value: unknown): AppWorkspaceLayoutState | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 && candidate.version !== 2) return null;
  const sidebarWidth = finiteSize(candidate.sidebarWidth, APP_WORKSPACE_SIDEBAR_MIN, APP_WORKSPACE_SIDEBAR_MAX);
  const sidebarCollapsed = typeof candidate.sidebarCollapsed === "boolean" ? candidate.sidebarCollapsed : undefined;
  // Keyed panel maps only exist from version 2 on; a version-1 payload that
  // carries them was not written by this component and is not trusted.
  const legacy = candidate.version === 1;
  const paneWidths = legacy
    ? undefined
    : normalizeSizes(candidate.paneWidths, APP_WORKSPACE_PANE_MIN, APP_WORKSPACE_PANE_MAX);
  const detailWidths = legacy
    ? (() => {
        const width = finiteSize(candidate.detailWidth, APP_WORKSPACE_DETAIL_MIN, APP_WORKSPACE_DETAIL_MAX);
        return width === undefined ? undefined : { primary: width };
      })()
    : normalizeSizes(candidate.detailWidths, APP_WORKSPACE_DETAIL_MIN, APP_WORKSPACE_DETAIL_MAX);
  const drawerHeights = legacy
    ? undefined
    : normalizeSizes(candidate.drawerHeights, APP_WORKSPACE_DRAWER_MIN, APP_WORKSPACE_DRAWER_MAX);
  return sidebarWidth === undefined &&
    sidebarCollapsed === undefined &&
    !paneWidths &&
    !detailWidths &&
    !drawerHeights
    ? null
    : { version: 2, sidebarWidth, sidebarCollapsed, paneWidths, detailWidths, drawerHeights };
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

export const appWorkspaceLayoutStyle = (state: AppWorkspaceLayoutState | null | undefined): string | undefined => {
  if (!state) return undefined;
  const declarations = [
    state.sidebarCollapsed
      ? `--k2b-workspace-sidebar-width:${APP_WORKSPACE_SIDEBAR_COLLAPSED}px`
      : state.sidebarWidth === undefined
        ? null
        : `--k2b-workspace-sidebar-width:${state.sidebarWidth}px`,
    ...Object.entries(state.paneWidths ?? {}).map(([id, width]) => `${appWorkspacePanelVariable("pane", id)}:${width}px`),
    ...Object.entries(state.detailWidths ?? {}).map(([id, width]) => `${appWorkspacePanelVariable("detail", id)}:${width}px`),
    ...Object.entries(state.drawerHeights ?? {}).map(([id, height]) => `${appWorkspacePanelVariable("drawer", id)}:${height}px`),
  ].filter(Boolean);
  return declarations.length ? declarations.join(";") : undefined;
};

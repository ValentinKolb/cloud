import { type AppWorkspaceLayoutState, parseAppWorkspaceLayoutState } from "@k2b/ui";

const safeAppId = (appId: string): string => appId.replace(/[^A-Za-z0-9_-]/g, "_");

export const appWorkspaceCookieName = (appId: string): string => `cloud_workspace_${safeAppId(appId)}`;

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

export const resolveAppWorkspaceLayoutForSidebar = (
  state: AppWorkspaceLayoutState | null,
  collapsible: boolean | undefined,
): AppWorkspaceLayoutState | null => (collapsible === false && state?.sidebarCollapsed ? { ...state, sidebarCollapsed: false } : state);

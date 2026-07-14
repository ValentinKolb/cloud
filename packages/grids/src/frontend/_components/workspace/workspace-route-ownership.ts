import type { GridsWorkspaceRoute } from "./workspace-state-model";

export const shouldReloadWorkspaceForPopState = (
  routeKind: GridsWorkspaceRoute["kind"],
  renderedPathname: string | null,
  nextLocation: Pick<URL, "pathname" | "search">,
) => routeKind !== "records" || renderedPathname !== nextLocation.pathname;

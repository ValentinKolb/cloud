import type { GridsWorkspaceRoute } from "./workspace-state-model";

type WorkspaceRouteKind = GridsWorkspaceRoute["kind"];
type WorkspaceSurface = "edge-to-edge" | "inset";

const WORKSPACE_SURFACES = {
  dashboard: "edge-to-edge",
  documentTemplate: "edge-to-edge",
  empty: "inset",
  query: "edge-to-edge",
  records: "edge-to-edge",
  workflows: "inset",
} satisfies Record<WorkspaceRouteKind, WorkspaceSurface>;

export const workspaceMainClass = (kind: WorkspaceRouteKind): string | undefined =>
  WORKSPACE_SURFACES[kind] === "inset" ? "p-[var(--ui-space-shell)]" : undefined;

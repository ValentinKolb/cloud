import type { NotebookWorkspaceEvent } from "../../../../lib/workspace-events";

export const WORKSPACE_EVENT = "notebooks.workspace.event";

export type WorkspaceEventDetail = {
  cursor: string | null;
  event: NotebookWorkspaceEvent;
};

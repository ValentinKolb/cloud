import type { PublicNotebookWorkspaceEvent } from "../../../../lib/workspace-events";

export const WORKSPACE_EVENT = "notebooks.workspace.event";

export type WorkspaceEventDetail = {
  cursor: string | null;
  event: PublicNotebookWorkspaceEvent;
  cover: (coverage: Promise<void>) => void;
};

export const dispatchWorkspaceEvent = async (event: PublicNotebookWorkspaceEvent, cursor: string | null): Promise<void> => {
  const coverages: Promise<void>[] = [];
  window.dispatchEvent(
    new CustomEvent<WorkspaceEventDetail>(WORKSPACE_EVENT, {
      detail: {
        cursor,
        event,
        cover: (coverage) => coverages.push(coverage),
      },
    }),
  );
  if (coverages.length === 0) throw new Error("No mounted workspace query covered the event");
  await Promise.all(coverages);
};

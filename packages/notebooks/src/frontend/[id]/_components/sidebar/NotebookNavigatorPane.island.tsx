import { Button } from "@k2b/ui";
import { Show } from "solid-js";
import NotebookNavigator from "./NotebookNavigator";
import type { NotebookContext } from "./types";
import { useNotebookWorkspaceState } from "./useNotebookWorkspaceState";

type Props = {
  ctx: NotebookContext;
};

export default function NotebookNavigatorPane(props: Props) {
  const { notebook, noteTree, favoriteNoteIds, selectedNoteId, tags, workspaceError, workspaceRefreshing, refreshWorkspace } =
    useNotebookWorkspaceState(props.ctx);
  const canWrite = props.ctx.permission === "write" || props.ctx.permission === "admin";

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <Show when={workspaceError()}>
        <div
          role="alert"
          class="m-2 flex items-center justify-between gap-2 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          <span>Notebook updates could not be loaded.</span>
          <Button type="button" variant="ghost" size="xs" loading={workspaceRefreshing()} onClick={() => void refreshWorkspace()}>
            Retry
          </Button>
        </div>
      </Show>
      <NotebookNavigator
        mode="list"
        notebook={notebook()}
        tree={noteTree()}
        selectedNoteId={selectedNoteId()}
        permission={props.ctx.permission}
        canWrite={canWrite}
        favoriteNoteIds={[...favoriteNoteIds()]}
        tags={tags()}
        initialSortMode={props.ctx.settings.navigatorSort}
        dateConfig={props.ctx.dateConfig}
        initialQuery={props.ctx.navigatorQuery}
      />
    </div>
  );
}

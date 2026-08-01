import NotebookNavigator from "./NotebookNavigator";
import type { NotebookContext } from "./types";
import { useNotebookWorkspaceState } from "./useNotebookWorkspaceState";

type Props = {
  ctx: NotebookContext;
};

export default function NotebookNavigatorPane(props: Props) {
  const { notebook, noteTree, favoriteNoteIds, selectedNoteId } = useNotebookWorkspaceState(props.ctx);
  const canWrite = props.ctx.permission === "write" || props.ctx.permission === "admin";

  return (
    <NotebookNavigator
      mode="list"
      notebook={notebook()}
      tree={noteTree()}
      selectedNoteId={selectedNoteId()}
      permission={props.ctx.permission}
      canWrite={canWrite}
      favoriteNoteIds={[...favoriteNoteIds()]}
      tags={props.ctx.tags}
      initialSortMode={props.ctx.settings.navigatorSort}
      dateConfig={props.ctx.dateConfig}
      initialQuery={props.ctx.navigatorQuery}
    />
  );
}

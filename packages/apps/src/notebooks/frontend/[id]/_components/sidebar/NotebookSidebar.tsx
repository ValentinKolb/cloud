import NotebookSwitcher from "./NotebookSwitcher.island";
import NoteTree from "./NoteTree.island";
import type { NotebookContext } from "./types";

type Props = {
  ctx: NotebookContext;
};

/** Mobile navigation - horizontal chips */
function MobileNav({ ctx }: Props) {
  const { notebook, permission } = ctx;
  const settingsUrl = `/app/notebooks/${notebook.id}?mode=settings`;

  return (
    <nav class="lg:hidden flex flex-col gap-3">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center text-white shrink-0">
          <i class={`ti ${notebook.icon || "ti-notebook"} text-sm`} />
        </div>
        <NotebookSwitcher currentNotebook={notebook} variant="compact" />
        <a href={settingsUrl} class="ml-auto p-1.5 text-dimmed hover:text-primary transition-colors" title="Settings">
          <i class="ti ti-settings text-sm" />
        </a>
      </div>

      {/* Mobile note tree (collapsible) */}
      <details class="group">
        <summary class="flex items-center gap-2 cursor-pointer text-xs text-dimmed hover:text-primary transition-colors select-none list-none">
          <i class="ti ti-list-tree text-sm" />
          <span>Notes</span>
          <i class="ti ti-chevron-down text-[10px] transition-transform group-open:rotate-180 ml-auto" />
        </summary>
        <div class="p-2 mt-2 max-h-64 overflow-y-auto">
          <NoteTree
            tree={ctx.tree}
            notebookId={notebook.id}
            selectedNoteId={ctx.selectedNoteId}
            canWrite={permission === "write" || permission === "admin"}
            viewMode={ctx.viewMode}
            showSearch
          />
        </div>
      </details>
    </nav>
  );
}

/** Desktop navigation - vertical sidebar */
function DesktopNav({ ctx }: Props) {
  const { notebook, tree, selectedNoteId, permission } = ctx;
  const canWrite = permission === "write" || permission === "admin";
  const settingsUrl = `/app/notebooks/${notebook.id}?mode=settings`;

  return (
    <aside class="hidden lg:flex flex-col gap-2 w-48 shrink-0 min-h-0">
      {/* Notebook header — compact single row */}
      <div class="flex items-center gap-2">
        <div class="w-6 h-6 rounded bg-blue-500 flex items-center justify-center text-white shrink-0">
          <i class={`ti ${notebook.icon || "ti-notebook"} text-xs`} />
        </div>
        <NotebookSwitcher currentNotebook={notebook} variant="compact" />
        <a href={settingsUrl} class="p-0.5 text-dimmed hover:text-primary transition-colors shrink-0" title="Settings">
          <i class="ti ti-settings text-xs" />
        </a>
      </div>

      {/* Note tree (scrollable) */}
      <div class="flex flex-col gap-0.5 overflow-y-auto min-h-0 flex-1">
        <NoteTree
          tree={tree}
          notebookId={notebook.id}
          selectedNoteId={selectedNoteId}
          canWrite={canWrite}
          viewMode={ctx.viewMode}
          showSearch
        />
      </div>
    </aside>
  );
}

export default function NotebookSidebar(props: Props) {
  return (
    <>
      <MobileNav {...props} />
      <DesktopNav {...props} />
    </>
  );
}

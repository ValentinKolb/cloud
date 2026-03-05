import NotebookSwitcher from "./NotebookSwitcher.island";
import NoteTree from "./NoteTree.island";
import SearchButton from "../search/SearchButton.island";
import CreateNoteButton from "./CreateNoteButton.island";
import type { NotebookContext } from "./types";

type Props = {
  ctx: NotebookContext;
};

export default function NotebookSidebar(props: Props) {
  const canWrite = props.ctx.permission === "write" || props.ctx.permission === "admin";
  const settingsHref = `/app/notebooks/${props.ctx.notebook.id}?mode=settings`;
  const vt = (key: string) => `notebook-sidebar-${props.ctx.notebook.id}-${key}`;

  const tree = (
    <NoteTree
      tree={props.ctx.tree}
      notebookId={props.ctx.notebook.id}
      notebookName={props.ctx.notebook.name}
      selectedNoteId={props.ctx.selectedNoteId}
      canWrite={canWrite}
      viewMode={props.ctx.viewMode}
      showSearch={false}
      showHeaderActions={false}
    />
  );

  return (
    <>
      <nav class="sidebar-container-mobile">
        <details class="group">
          <summary class="sidebar-mobile-toggle">
            <div class="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center text-white shrink-0">
              <i class={`ti ${props.ctx.notebook.icon || "ti-notebook"} text-sm`} />
            </div>
            <NotebookSwitcher currentNotebook={props.ctx.notebook} variant="compact" />
            <span class="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-dimmed transition-transform group-open:rotate-180">
              <i class="ti ti-chevron-down text-sm" />
            </span>
          </summary>
          <div class="sidebar-mobile-actions">
            <a href={settingsHref} class="sidebar-item-mobile" style={`view-transition-name:${vt("settings-mobile")}`}>
              <i class="ti ti-settings" />
              Settings
            </a>
            <div style={`view-transition-name:${vt("search-mobile")}`}>
              <SearchButton notebookId={props.ctx.notebook.id} notebookName={props.ctx.notebook.name} variant="chip" />
            </div>
            {canWrite && (
              <div style={`view-transition-name:${vt("create-mobile")}`}>
                <CreateNoteButton notebookId={props.ctx.notebook.id} variant="chip" />
              </div>
            )}
          </div>
          <div class="mt-2 max-h-64 overflow-y-auto p-2">{tree}</div>
        </details>
      </nav>

      <aside class="sidebar-container">
        <div class="sidebar-header">
          <div class="sidebar-header-icon bg-blue-500">
            <i class={`ti ${props.ctx.notebook.icon || "ti-notebook"} text-xs`} />
          </div>
          <NotebookSwitcher currentNotebook={props.ctx.notebook} variant="compact" />
          <a href={settingsHref} class="sidebar-header-settings" title="Settings" style={`view-transition-name:${vt("settings-desktop")}`}>
            <i class="ti ti-settings text-xs" />
          </a>
        </div>

        <div class="flex flex-col gap-3">
          <section class="sidebar-group">
            <p class="sidebar-section-title">Actions</p>
            <div style={`view-transition-name:${vt("search-desktop")}`}>
              <SearchButton notebookId={props.ctx.notebook.id} notebookName={props.ctx.notebook.name} variant="sidebar" />
            </div>
            {canWrite && (
              <div style={`view-transition-name:${vt("create-desktop")}`}>
                <CreateNoteButton notebookId={props.ctx.notebook.id} variant="sidebar" />
              </div>
            )}
          </section>
        </div>

        <div class="sidebar-body mt-2">
          <section class="sidebar-group">
            <p class="sidebar-section-title">Notes</p>
            {tree}
          </section>
        </div>
      </aside>
    </>
  );
}

import NoteTree from "./NoteTree.island";
import SearchButton from "../search/SearchButton.island";
import NotebookSettingsButton from "../settings/NotebookSettingsButton.island";
import CreateNoteButton from "./CreateNoteButton.island";
import TagsButton from "./TagsButton.island";
import NotebookNavigator from "./NotebookNavigator.island";
import { buildAttachmentsUrl, buildNoteUrl } from "../../../params";
import type { NotebookContext, NoteTreeNode } from "./types";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { AppWorkspace, prompts } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";
import { WORKSPACE_EVENT, type WorkspaceEventDetail } from "./workspace-events";

type Props = {
  ctx: NotebookContext;
};

const findNoteByShortId = (nodes: NoteTreeNode[], shortId: string | null): NoteTreeNode | null => {
  if (!shortId) return null;
  for (const node of nodes) {
    if (node.shortId === shortId) return node;
    const child = findNoteByShortId(node.children, shortId);
    if (child) return child;
  }
  return null;
};

const cloneTree = (nodes: NoteTreeNode[]): NoteTreeNode[] => nodes.map((node) => ({ ...node, children: cloneTree(node.children) }));

const sortNodes = (nodes: NoteTreeNode[]) => {
  nodes.sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
};

const removeNoteFromTree = (nodes: NoteTreeNode[], noteId: string): NoteTreeNode | null => {
  const index = nodes.findIndex((node) => node.id === noteId);
  if (index >= 0) return nodes.splice(index, 1)[0] ?? null;
  for (const node of nodes) {
    const removed = removeNoteFromTree(node.children, noteId);
    if (removed) {
      node.hasChildren = node.children.length > 0;
      return removed;
    }
  }
  return null;
};

const insertNoteIntoTree = (nodes: NoteTreeNode[], note: NoteTreeNode) => {
  if (!note.parentId) {
    nodes.push({ ...note, children: note.children ?? [] });
    sortNodes(nodes);
    return;
  }
  for (const node of nodes) {
    if (node.id === note.parentId) {
      node.children.push({ ...note, children: note.children ?? [] });
      node.hasChildren = true;
      sortNodes(node.children);
      return;
    }
    insertNoteIntoTree(node.children, note);
  }
};

export default function NotebookSidebar(props: Props) {
  const [notebook, setNotebook] = createSignal(props.ctx.notebook);
  const [noteTree, setNoteTree] = createSignal(props.ctx.tree);
  const [favoriteNoteIds, setFavoriteNoteIds] = createSignal(new Set(props.ctx.favoriteNoteIds));
  const canWrite = props.ctx.permission === "write" || props.ctx.permission === "admin";
  const navigatorMode = () => props.ctx.settings.sidebarMode === "navigator";
  const attachmentsHref = () => buildAttachmentsUrl(notebook().shortId);
  const hasTags = props.ctx.tagCount > 0;
  const allNotebooksHref = "/app/notebooks";
  const homepageNote = createMemo(() => findNoteByShortId(noteTree(), notebook().homepageNoteShortId));
  const homepageHref = () => (homepageNote() ? buildNoteUrl(notebook().shortId, homepageNote()!.shortId) : null);
  const homepageIsActive = () => homepageNote()?.id === props.ctx.selectedNoteId;
  const vt = (key: string) => `notebook-sidebar-${notebook().shortId}-${key}`;

  const explainMissingHomepage = () =>
    void prompts.alert(
      "No homepage is selected for this notebook yet. Open notebook settings and choose a homepage in the General tab.",
      { title: "No homepage selected", icon: "ti ti-home" },
    );

  const refetchTree = async () => {
    const response = await apiClient[":id"].tree.$get({ param: { id: notebook().shortId } });
    if (!response.ok) return;
    setNoteTree((await response.json()) as NoteTreeNode[]);
  };

  const applyWorkspaceEvent = (detail: WorkspaceEventDetail) => {
    const event = detail.event;
    if (event.type === "notebook.updated") {
      setNotebook(event.notebook);
      return;
    }
    if (event.type === "workspace.invalidated") {
      if (event.scopes.includes("tree")) void refetchTree();
      return;
    }
    if (event.type === "note.deleted") {
      setNoteTree((current) => {
        const next = cloneTree(current);
        removeNoteFromTree(next, event.noteId);
        return next;
      });
      setFavoriteNoteIds((current) => {
        const next = new Set(current);
        next.delete(event.noteId);
        return next;
      });
      return;
    }
    if (event.type === "note.favorite.changed") {
      if (event.userId !== props.ctx.userId) return;
      setFavoriteNoteIds((current) => {
        const next = new Set(current);
        if (event.favorite) next.add(event.noteId);
        else next.delete(event.noteId);
        return next;
      });
      return;
    }
    if (event.type === "note.created" || event.type === "note.updated") {
      setNoteTree((current) => {
        const next = cloneTree(current);
        const existing = removeNoteFromTree(next, event.note.id);
        insertNoteIntoTree(next, { ...event.note, children: existing?.children ?? [] });
        return next;
      });
    }
  };

  onMount(() => {
    const handler = (raw: Event) => applyWorkspaceEvent((raw as CustomEvent<WorkspaceEventDetail>).detail);
    window.addEventListener(WORKSPACE_EVENT, handler);
    onCleanup(() => window.removeEventListener(WORKSPACE_EVENT, handler));
  });

  const renderTreeView = () => (
    <NoteTree
      tree={noteTree()}
      notebookId={notebook().shortId}
      notebookName={notebook().name}
      selectedNoteId={props.ctx.selectedNoteId}
      canWrite={canWrite}
      viewMode={props.ctx.viewMode}
      showSearch={false}
      showHeaderActions={false}
    />
  );

  return (
    <AppWorkspace.Sidebar class={navigatorMode() ? "lg:!w-[35rem] [&>.paper>div:first-child]:lg:hidden" : ""}>
      <AppWorkspace.SidebarHeader
        title={notebook().name}
        icon={notebook().icon || "ti-notebook"}
        action={
          <NotebookSettingsButton
            notebook={notebook()}
            tree={noteTree()}
            permission={props.ctx.permission}
            variant="desktop"
            viewTransitionName={vt("settings-desktop")}
          />
        }
      />

      <AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarMobileItems>
          <NotebookSettingsButton
            notebook={notebook()}
            tree={noteTree()}
            permission={props.ctx.permission}
            variant="mobile"
            viewTransitionName={vt("settings-mobile")}
          />
          {canWrite && (
            <div style={`view-transition-name:${vt("create-mobile")}`}>
              <CreateNoteButton notebookId={notebook().shortId} variant="chip" />
            </div>
          )}
          {homepageHref() && (
            <AppWorkspace.SidebarItem
              href={homepageHref()!}
              icon="ti ti-home"
              active={homepageIsActive()}
              data={{ "notebooks-homepage-note-id": homepageNote()?.id }}
              viewTransitionName={vt("homepage-mobile")}
            >
              Homepage
            </AppWorkspace.SidebarItem>
          )}
          <AppWorkspace.SidebarItem href={allNotebooksHref} icon="ti ti-notebook" viewTransitionName={vt("all-notebooks-mobile")}>
            All Notebooks
          </AppWorkspace.SidebarItem>
          <div style={`view-transition-name:${vt("search-mobile")}`}>
            <SearchButton notebookId={notebook().shortId} notebookName={notebook().name} variant="sidebar-mobile" />
          </div>
          <AppWorkspace.SidebarItem
            href={attachmentsHref()}
            icon="ti ti-paperclip"
            meta={props.ctx.attachmentCount}
            viewTransitionName={vt("attachments-mobile")}
          >
            Attachments
          </AppWorkspace.SidebarItem>
          {hasTags && (
            <div style={`view-transition-name:${vt("tags-mobile")}`}>
              <TagsButton notebookId={notebook().shortId} tagCount={props.ctx.tagCount} variant="sidebar-mobile" />
            </div>
          )}
        </AppWorkspace.SidebarMobileItems>
        <AppWorkspace.SidebarMobileBody>{renderTreeView()}</AppWorkspace.SidebarMobileBody>
      </AppWorkspace.SidebarMobile>

      <AppWorkspace.SidebarDesktop>
        <Show
          when={navigatorMode()}
          fallback={
            <>
              <div class="flex flex-col gap-3">
                <AppWorkspace.SidebarIconGrid columns={3}>
                  {canWrite && (
                    <div style={`view-transition-name:${vt("create-desktop")}`}>
                      <CreateNoteButton notebookId={notebook().shortId} variant="icon" />
                    </div>
                  )}
                  <div style={`view-transition-name:${vt("search-desktop")}`}>
                    <SearchButton notebookId={notebook().shortId} notebookName={notebook().name} variant="icon" />
                  </div>
                  <AppWorkspace.SidebarIconAction
                    href={homepageHref()}
                    icon="ti ti-home"
                    label={homepageHref() ? "Homepage" : "Set homepage in notebook settings"}
                    active={homepageIsActive()}
                    viewTransitionName={vt("homepage-desktop")}
                    onClick={homepageHref() ? undefined : explainMissingHomepage}
                  />
                  <AppWorkspace.SidebarIconAction
                    href={allNotebooksHref}
                    icon="ti ti-library"
                    label="All Notebooks"
                    viewTransitionName={vt("all-notebooks-desktop")}
                  />
                  <AppWorkspace.SidebarIconAction
                    href={attachmentsHref()}
                    icon="ti ti-paperclip"
                    label={`${props.ctx.attachmentCount} attachment${props.ctx.attachmentCount === 1 ? "" : "s"}`}
                    viewTransitionName={vt("attachments-desktop")}
                  />
                  {hasTags && (
                    <div style={`view-transition-name:${vt("tags-desktop")}`}>
                      <TagsButton notebookId={notebook().shortId} tagCount={props.ctx.tagCount} variant="icon" />
                    </div>
                  )}
                </AppWorkspace.SidebarIconGrid>
              </div>

              <AppWorkspace.SidebarBody>
                <AppWorkspace.SidebarSection title="Notes" class="min-h-0 flex-1">
                  {renderTreeView()}
                </AppWorkspace.SidebarSection>
              </AppWorkspace.SidebarBody>
            </>
          }
        >
          <NotebookNavigator
            notebook={notebook()}
            tree={noteTree()}
            selectedNoteId={props.ctx.selectedNoteId}
            permission={props.ctx.permission}
            canWrite={canWrite}
            favoriteNoteIds={[...favoriteNoteIds()]}
            tags={props.ctx.tags}
          />
        </Show>

      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}

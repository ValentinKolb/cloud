import type { LinkNavigateEvent } from "@k2b/ssr/nav";
import { AppWorkspace, prompts } from "@k2b/ui";
import { createMemo, Show } from "solid-js";
import { hasOnlyNavigatorQuery } from "../../../../lib/navigator-url";
import { requestSoftNoteNavigation } from "../../../lib/soft-navigation";
import { buildAttachmentsUrl, buildNoteUrl } from "../../../params";
import SearchButton from "../search/SearchButton";
import NotebookSettingsButton from "../settings/NotebookSettingsButton";
import CreateNoteButton from "./CreateNoteButton";
import NotebookNavigator from "./NotebookNavigator";
import NoteTree from "./NoteTree";
import TagsButton from "./TagsButton";
import type { NotebookContext, NoteTreeNode } from "./types";
import { useNotebookWorkspaceState } from "./useNotebookWorkspaceState";

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

const resolveSameNotebookNoteHref = (url: URL, notebookShortId: string): string | null => {
  if (url.origin !== window.location.origin || url.hash || !hasOnlyNavigatorQuery(url.searchParams)) return null;
  const match = url.pathname.match(/^\/app\/notebooks\/([^/]+)\/notes\/([^/]+)$/);
  if (!match || decodeURIComponent(match[1]!) !== notebookShortId) return null;
  return `${url.pathname}${url.search}`;
};

export default function NotebookSidebar(props: Props) {
  const { notebook, noteTree, favoriteNoteIds, selectedNoteId } = useNotebookWorkspaceState(props.ctx);
  const canWrite = props.ctx.permission === "write" || props.ctx.permission === "admin";
  const navigatorMode = () => props.ctx.settings.sidebarMode === "navigator";
  const attachmentsHref = () => buildAttachmentsUrl(notebook().shortId);
  const hasTags = props.ctx.tagCount > 0;
  const allNotebooksHref = "/app/notebooks";
  const homepageNote = createMemo(() => findNoteByShortId(noteTree(), notebook().homepageNoteShortId));
  const homepageHref = () => (homepageNote() ? buildNoteUrl(notebook().shortId, homepageNote()!.shortId) : null);
  const homepageIsActive = () => homepageNote()?.id === selectedNoteId();
  const vt = (key: string) => `notebook-sidebar-${notebook().shortId}-${key}`;

  const explainMissingHomepage = () =>
    void prompts.alert("No homepage is selected for this notebook yet. Open notebook settings and choose a homepage in the General tab.", {
      title: "No homepage selected",
      icon: "ti ti-home",
    });

  const handleSameNotebookNoteNavigate = async (nav: LinkNavigateEvent) => {
    const target = resolveSameNotebookNoteHref(nav.url, notebook().shortId);
    if (!target) {
      nav.fallback();
      return;
    }

    if (`${window.location.pathname}${window.location.search}` === target) {
      nav.replaceWith(target);
      return;
    }

    const handled = await requestSoftNoteNavigation(target, { push: false });
    if (!handled) {
      nav.fallback(target);
      return;
    }
    nav.push(target);
  };

  const renderTreeView = (scrollPreserveKey: string) => (
    <NoteTree
      tree={noteTree()}
      notebookId={notebook().shortId}
      notebookName={notebook().name}
      selectedNoteId={selectedNoteId()}
      canWrite={canWrite}
      showSearch={false}
      showHeaderActions={false}
      favoriteNoteIds={[...favoriteNoteIds()]}
      scrollPreserveKey={scrollPreserveKey}
    />
  );

  return (
    <AppWorkspace.Sidebar resizable>
      <AppWorkspace.SidebarMobileTrigger label={notebook().name} />

      <AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarMobileItems>
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
              scroll="top"
              onNavigate={handleSameNotebookNoteNavigate}
              data={{ "notebooks-homepage-note-id": homepageNote()?.id }}
              viewTransitionName={vt("homepage-mobile")}
            >
              Homepage
            </AppWorkspace.SidebarItem>
          )}
          <AppWorkspace.SidebarItem
            href={allNotebooksHref}
            icon="ti ti-notebook"
            navigation="document"
            viewTransitionName={vt("all-notebooks-mobile")}
          >
            All Notebooks
          </AppWorkspace.SidebarItem>
          <div style={`view-transition-name:${vt("search-mobile")}`}>
            <SearchButton notebookId={notebook().shortId} notebookName={notebook().name} variant="sidebar-mobile" />
          </div>
          <AppWorkspace.SidebarItem
            href={attachmentsHref()}
            icon="ti ti-paperclip"
            meta={props.ctx.attachmentCount}
            navigation="document"
            viewTransitionName={vt("attachments-mobile")}
          >
            Attachments
          </AppWorkspace.SidebarItem>
          {hasTags && (
            <div style={`view-transition-name:${vt("tags-mobile")}`}>
              <TagsButton notebookId={notebook().shortId} tagCount={props.ctx.tagCount} variant="sidebar-mobile" />
            </div>
          )}
          <NotebookSettingsButton
            notebook={notebook()}
            tree={noteTree()}
            permission={props.ctx.permission}
            dateConfig={props.ctx.dateConfig}
            viewTransitionName={vt("settings-mobile")}
          />
        </AppWorkspace.SidebarMobileItems>
        <AppWorkspace.SidebarMobileBody scrollPreserveKey={`notebooks-mobile-sidebar-${notebook().shortId}`}>
          {renderTreeView(`notebooks-mobile-tree-${notebook().shortId}`)}
        </AppWorkspace.SidebarMobileBody>
      </AppWorkspace.SidebarMobile>

      <AppWorkspace.SidebarDesktop>
        <Show
          when={navigatorMode()}
          fallback={
            <>
              <div class="flex flex-col gap-2">
                <AppWorkspace.SidebarIconGrid columns={3}>
                  {canWrite && (
                    <CreateNoteButton notebookId={notebook().shortId} variant="icon" viewTransitionName={vt("create-desktop")} />
                  )}
                  <SearchButton
                    notebookId={notebook().shortId}
                    notebookName={notebook().name}
                    variant="workspace-icon"
                    viewTransitionName={vt("search-desktop")}
                  />
                  <AppWorkspace.SidebarIconAction
                    href={homepageHref()}
                    icon="ti ti-home"
                    label={homepageHref() ? "Homepage" : "Set homepage in notebook settings"}
                    active={homepageIsActive()}
                    scroll="top"
                    onNavigate={handleSameNotebookNoteNavigate}
                    viewTransitionName={vt("homepage-desktop")}
                    onClick={homepageHref() ? undefined : explainMissingHomepage}
                  />
                  <AppWorkspace.SidebarIconAction
                    href={allNotebooksHref}
                    icon="ti ti-library"
                    label="All Notebooks"
                    navigation="document"
                    viewTransitionName={vt("all-notebooks-desktop")}
                  />
                  <AppWorkspace.SidebarIconAction
                    href={attachmentsHref()}
                    icon="ti ti-paperclip"
                    label={`${props.ctx.attachmentCount} attachment${props.ctx.attachmentCount === 1 ? "" : "s"}`}
                    navigation="document"
                    viewTransitionName={vt("attachments-desktop")}
                  />
                  {hasTags && (
                    <TagsButton
                      notebookId={notebook().shortId}
                      tagCount={props.ctx.tagCount}
                      variant="icon"
                      viewTransitionName={vt("tags-desktop")}
                    />
                  )}
                </AppWorkspace.SidebarIconGrid>
              </div>

              <AppWorkspace.SidebarBody scrollPreserveKey={`notebooks-simple-sidebar-${notebook().shortId}`}>
                <AppWorkspace.SidebarSection title="Notes" class="min-h-0 flex-1">
                  {renderTreeView(`notebooks-simple-tree-${notebook().shortId}`)}
                </AppWorkspace.SidebarSection>
              </AppWorkspace.SidebarBody>
              <AppWorkspace.SidebarFooter>
                <NotebookSettingsButton
                  notebook={notebook()}
                  tree={noteTree()}
                  permission={props.ctx.permission}
                  dateConfig={props.ctx.dateConfig}
                  viewTransitionName={vt("settings-desktop")}
                />
              </AppWorkspace.SidebarFooter>
            </>
          }
        >
          <NotebookNavigator
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
        </Show>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}

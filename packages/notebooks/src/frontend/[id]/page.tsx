import { AppWorkspace, Placeholder } from "@k2b/ui";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../config";
import NotebookDetailPanel from "./_components/detail/NotebookDetailPanel.island";
import NoteEditor from "./_components/editor/NoteEditor.client";
import NotebookGraph from "./_components/graph/NotebookGraph.island";
import NotebookSettingsPanel from "./_components/settings/NotebookSettingsPanel.island";
import NotebookHotkeys from "./_components/shortcuts/NotebookHotkeys.island";
import NotebookNavigatorPane from "./_components/sidebar/NotebookNavigatorPane.island";
import NotebookSidebar from "./_components/sidebar/NotebookSidebar.island";
import WorkspaceEventBridge from "./_components/sidebar/WorkspaceEventBridge.island";
import VersionHistory from "./_components/versions/VersionHistory.island";
import { loadNotebookPageData } from "./page-data";

export default ssr<AuthContext>(async (c) => {
  const data = await loadNotebookPageData(c);

  if (data.kind === "not_found") {
    return () => (
      <Layout c={c} title="Not Found">
        <div class="max-w-md mx-auto mt-16">
          <Placeholder surface="paper" state="error" icon="ti ti-alert-circle" title="Notebook not found" />
        </div>
      </Layout>
    );
  }

  if (data.kind === "access_denied") {
    return () => (
      <Layout c={c} title="Access Denied">
        <div class="max-w-md mx-auto mt-16">
          <Placeholder
            surface="paper"
            state="error"
            icon="ti ti-lock"
            title="Access denied"
            description="You don't have access to this notebook."
          />
        </div>
      </Layout>
    );
  }

  if (data.kind === "redirect") return c.redirect(data.href);

  const {
    user,
    notebook,
    tree,
    isSettingsMode,
    isVersionsMode,
    isGraphMode,
    accessEntries,
    apiKeys,
    isAdmin,
    canWrite,
    canRunScripts,
    selectedNoteId,
    selectedNote,
    selectedRouteState,
    tocItems,
    namedBlocks,
    readonlyMode,
    graph,
    versionHistory,
    ctx,
    appUrl,
    detailPanelOpen,
    showDetailPanel,
    panelAttachments,
    backlinks,
    dateConfig,
  } = data;
  return () => (
    <Layout
      c={c}
      fullPage
      title={[
        { title: "Start", href: "/" },
        { title: "Notebooks", href: "/app/notebooks" },
        { title: notebook.name, href: `/app/notebooks/${notebook.shortId}` },
        ...(selectedNote ? [{ title: selectedNote.title }] : isSettingsMode ? [{ title: "Settings" }] : []),
      ]}
    >
      <AppWorkspace class="flex-1 min-h-0">
        <NotebookHotkeys notebookId={notebook.shortId} notebookName={notebook.name} canWrite={canWrite} />
        {readonlyMode && <WorkspaceEventBridge notebookId={notebook.shortId} appUrl={appUrl} />}

        <NotebookSidebar ctx={ctx} />

        <AppWorkspace.Content>
          <AppWorkspace.Main>
            {ctx.settings.sidebarMode === "navigator" && (
              <AppWorkspace.MainPane
                id="notebook-notes"
                label="Note list"
                surface="navigation"
                defaultSize={336}
                minSize={280}
                maxSize={520}
              >
                <NotebookNavigatorPane ctx={ctx} />
              </AppWorkspace.MainPane>
            )}
            {isSettingsMode ? (
              <NotebookSettingsPanel
                notebook={notebook}
                tree={tree}
                accessEntries={accessEntries}
                apiKeys={apiKeys}
                isAdmin={isAdmin}
                canWrite={canWrite}
                dateConfig={dateConfig}
              />
            ) : isVersionsMode && selectedNoteId ? (
              <VersionHistory
                notebookId={notebook.shortId}
                noteId={selectedNote?.shortId ?? selectedNoteId}
                noteTitle={selectedNote?.title ?? ""}
                isLocked={!!selectedNote?.lockedAt}
                currentContentMd={selectedNote?.contentMd ?? null}
                dateConfig={dateConfig}
                initialVersions={versionHistory?.versions}
                initialTotal={versionHistory?.total}
              />
            ) : isGraphMode && graph ? (
              <NotebookGraph notebookId={notebook.shortId} selectedNoteId={selectedNoteId} graph={graph} />
            ) : selectedNote ? (
              <NoteEditor
                noteId={selectedNote.id}
                noteTitle={selectedNote.title}
                notebookId={notebook.shortId}
                scriptsEnabled={canRunScripts}
                noteShortId={selectedNote.shortId}
                noteCreatedAt={selectedNote.createdAt}
                noteUpdatedAt={selectedNote.updatedAt}
                noteLockedAt={selectedNote.lockedAt}
                noteParentId={selectedNote.parentId}
                notebookName={notebook.name}
                appUrl={appUrl}
                userId={user.id}
                displayName={user.displayName}
                initialSnapshot={selectedNote.yjsSnapshot}
                initialContent={selectedNote.contentMd}
                initialPanelOpen={detailPanelOpen}
                initialRichMode={ctx.settings.richMode}
                readOnly={readonlyMode}
              />
            ) : (
              <Placeholder
                class="flex-1"
                icon="ti ti-file-text"
                description={tree.length === 0 ? "No notes yet" : "Select a note to collaborate"}
              />
            )}
          </AppWorkspace.Main>

          {showDetailPanel && selectedNote && (
            <NotebookDetailPanel
              mode={readonlyMode ? "read" : "edit"}
              initiallyOpen={readonlyMode ? true : detailPanelOpen}
              tocItems={tocItems}
              taskProgress={selectedRouteState?.taskProgress ?? { done: 0, total: 0 }}
              attachments={panelAttachments}
              backlinks={backlinks}
              namedBlocks={namedBlocks}
              currentNotebookId={notebook.shortId}
              notebookId={notebook.shortId}
              noteId={selectedNote.shortId}
              noteTitle={selectedNote.title}
              contentMd={selectedNote.contentMd}
              createdAt={selectedNote.createdAt}
              updatedAt={selectedNote.updatedAt}
              lockedAt={selectedNote.lockedAt}
              isLocked={!!selectedNote.lockedAt}
            />
          )}
        </AppWorkspace.Content>
      </AppWorkspace>
    </Layout>
  );
});

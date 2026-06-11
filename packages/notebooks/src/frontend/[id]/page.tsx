import { type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { AppWorkspace } from "@valentinkolb/cloud/ui";
import { ssr } from "../../config";
import NotebookDetailPanel from "./_components/detail/NotebookDetailPanel.island";
import NoteEditor from "./_components/editor/NoteEditor.client";
import NotebookGraph from "./_components/graph/NotebookGraph.island";
import NotebookLayoutHelp from "./_components/help/NotebookLayoutHelp.island";
import NotebookSettingsPanel from "./_components/settings/NotebookSettingsPanel.island";
import NotebookHotkeys from "./_components/shortcuts/NotebookHotkeys.island";
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
          <div class="paper p-8 flex items-center justify-center text-dimmed text-xs gap-2">
            <i class="ti ti-alert-circle text-sm" />
            Notebook not found
          </div>
        </div>
      </Layout>
    );
  }

  if (data.kind === "access_denied") {
    return () => (
      <Layout c={c} title="Access Denied">
        <div class="max-w-md mx-auto mt-16">
          <div class="paper p-8 flex items-center justify-center text-dimmed text-xs gap-2">
            <i class="ti ti-lock text-sm" />
            You don't have access to this notebook
          </div>
        </div>
      </Layout>
    );
  }

  if (data.kind === "redirect") return c.redirect(data.href);

  const {
    user,
    sessionToken,
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
    ctx,
    appUrl,
    detailPanelOpen,
    showDetailPanel,
    panelAttachments,
    backlinks,
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
        <NotebookLayoutHelp />
        {readonlyMode && <WorkspaceEventBridge notebookId={notebook.shortId} appUrl={appUrl} sessionToken={sessionToken!} />}

        <NotebookSidebar ctx={ctx} />

        <AppWorkspace.Main>
          {isSettingsMode ? (
            <NotebookSettingsPanel
              notebook={notebook}
              tree={tree}
              accessEntries={accessEntries}
              apiKeys={apiKeys}
              isAdmin={isAdmin}
              canWrite={canWrite}
            />
          ) : isVersionsMode && selectedNoteId ? (
            <VersionHistory
              notebookId={notebook.shortId}
              noteId={selectedNote?.shortId ?? selectedNoteId}
              noteTitle={selectedNote?.title ?? ""}
              isLocked={!!selectedNote?.lockedAt}
              currentContentMd={selectedNote?.contentMd ?? null}
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
              sessionToken={sessionToken!}
              userId={user.id}
              displayName={user.displayName}
              initialSnapshot={selectedNote.yjsSnapshot}
              initialContent={selectedNote.contentMd}
              initialPanelOpen={detailPanelOpen}
              readOnly={readonlyMode}
            />
          ) : (
            <div class="flex-1 flex items-center justify-center">
              <p class="flex items-center gap-1.5 text-xs text-dimmed">
                <i class="ti ti-file-text text-sm" />
                {tree.length === 0 ? "No notes yet" : "Select a note to collaborate"}
              </p>
            </div>
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
      </AppWorkspace>
    </Layout>
  );
});

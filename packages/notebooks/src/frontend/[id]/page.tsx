import { ssr } from "../../config";
import { get } from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { markdown } from "@valentinkolb/cloud/shared";
import { notebooksService } from "@/service";
import { transformNoteLinks } from "@/service/links";
import NotebookDetailPanel from "./_components/detail/NotebookDetailPanel.island";
import { extractTaskProgress } from "./_components/detail/tasks";
import { extractTocFromMarkdown, injectHeadingIds } from "./_components/detail/toc";
import NoteEditor from "./_components/editor/NoteEditor.client";
import ReadonlyNote from "./_components/editor/ReadonlyNote.island";
import NotebookGraph from "./_components/graph/NotebookGraph.island";
import NotebookSettingsPanel from "./_components/settings/NotebookSettingsPanel.island";
import { parseDetailPanelOpen, parseSettings } from "./_components/settings/NotebookSettingsStore";
import NotebookHotkeys from "./_components/shortcuts/NotebookHotkeys.island";
import NotebookSidebar from "./_components/sidebar/NotebookSidebar";
import type { NotebookContext } from "./_components/sidebar/types";
import VersionHistory from "./_components/versions/VersionHistory.island";

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const sessionToken = auth.session.getToken(c);
  const notebookId = c.req.param("id");

  // Get notebook
  const notebook = await notebooksService.notebook.get({ id: notebookId });
  if (!notebook) {
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

  // Check access
  const permission = await notebooksService.notebook.permission.get({
    notebookId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
  });
  if (permission === "none") {
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

  const isAdmin = permission === "admin";
  const canWrite = permission === "write" || isAdmin;

  // Check mode
  const mode = c.req.query("mode");
  const view = c.req.query("view");
  const isSettingsMode = mode === "settings";
  const isVersionsMode = mode === "versions";
  const isGraphMode = mode === "graph";
  const isReadMode = view === "read";

  // Load note tree
  const tree = await notebooksService.note.getTree({ notebookId });

  // Load access entries for settings mode (admin only)
  const accessEntries = isSettingsMode && isAdmin ? (await notebooksService.notebook.access.list({ notebookId })).items : [];

  // Determine selected note: query param > cookie > first note
  const cookieHeader = c.req.header("Cookie");
  const settings = parseSettings(cookieHeader, notebookId);
  const detailPanelOpen = parseDetailPanelOpen(cookieHeader);
  const noteIdParam = c.req.query("note");
  const selectedNoteId = noteIdParam ?? settings.lastNoteId ?? tree[0]?.id ?? null;

  // Load selected note content (Yjs snapshot) for SSR → editor.
  // Also pull metadata used by the detail panel's Info section.
  let selectedNote: {
    id: string;
    title: string;
    yjsSnapshot: string | null;
    contentMd: string | null;
    renderedHtml: string | null;
    lockedAt: string | null;
    createdAt: string;
    updatedAt: string;
    createdBy: string | null;
  } | null = null;

  // TOC items shared by detail panel + read-mode anchor injection.
  // Extracted from `content_md` once and reused.
  let tocItems: ReturnType<typeof extractTocFromMarkdown> = [];

  if (selectedNoteId && !isSettingsMode) {
    if (isVersionsMode) {
      // Only metadata for version history (no Yjs content needed)
      const noteMeta = await notebooksService.note.get({ id: selectedNoteId });
      if (noteMeta) {
        selectedNote = {
          id: noteMeta.id,
          title: noteMeta.title,
          yjsSnapshot: null,
          contentMd: noteMeta.contentMd,
          renderedHtml: null,
          lockedAt: noteMeta.lockedAt,
          createdAt: noteMeta.createdAt,
          updatedAt: noteMeta.updatedAt,
          createdBy: noteMeta.createdBy,
        };
        tocItems = extractTocFromMarkdown(noteMeta.contentMd);
      }
    } else {
      const noteWithContent = await notebooksService.note.getWithContent({
        id: selectedNoteId,
      });
      if (noteWithContent) {
        // Force read mode for locked notes
        const isNoteLocked = !!noteWithContent.lockedAt;
        const shouldRenderHtml = isReadMode || isNoteLocked;

        tocItems = extractTocFromMarkdown(noteWithContent.contentMd);

        // For read mode: rewrite note links + inject heading anchor ids so
        // the TOC `#slug` clicks scroll to the right place natively.
        const renderedHtml = shouldRenderHtml
          ? injectHeadingIds(transformNoteLinks(markdown.render(noteWithContent.contentMd ?? "")), tocItems)
          : null;

        selectedNote = {
          id: noteWithContent.id,
          title: noteWithContent.title,
          yjsSnapshot: noteWithContent.yjsSnapshot, // already base64
          contentMd: noteWithContent.contentMd,
          renderedHtml,
          lockedAt: noteWithContent.lockedAt,
          createdAt: noteWithContent.createdAt,
          updatedAt: noteWithContent.updatedAt,
          createdBy: noteWithContent.createdBy,
        };
      }
    }
  }

  // Determine actual read mode (including locked notes)
  const actualReadMode = isReadMode || !!selectedNote?.lockedAt;

  // Backlinks: only loaded for actual note views (skip settings + versions
  // modes). Cheap query; rendered server-side via SSR — no client fetch.
  const backlinks =
    selectedNoteId && !isSettingsMode && !isVersionsMode && !isGraphMode
      ? await notebooksService.note.backlinks.list({
          noteId: selectedNoteId,
          userId: user.id,
          userGroups: user.memberofGroupIds,
          bypassAccess: hasRole(user, "admin"),
        })
      : [];

  // Graph data: only fetched in graph mode. The whole-notebook payload
  // (nodes + internal edges) is small enough to inline into the SSR
  // response — saves the round-trip a client-fetch would otherwise need.
  const graph = isGraphMode ? await notebooksService.notebook.graph({ notebookId }) : null;

  const ctx: NotebookContext = {
    notebook,
    tree,
    selectedNoteId,
    settings,
    permission,
    viewMode: isReadMode ? "read" : "edit",
  };

  // Read app.url once in the async handler and pass it through closure into the
  // sync render function. The render function MUST stay sync.
  const appUrl = await get<string>("app.url");

  // Detail panel only renders for actual note views (not settings/versions
  // /graph modes — those have their own dedicated layouts).
  const showDetailPanel = !!selectedNote && !isSettingsMode && !isVersionsMode && !isGraphMode;

  return () => (
    <Layout
      c={c}
      fullPage
      title={[
        { title: "Start", href: "/" },
        { title: "Notebooks", href: "/app/notebooks" },
        { title: notebook.name, href: `/app/notebooks/${notebook.id}` },
        ...(selectedNote ? [{ title: selectedNote.title }] : isSettingsMode ? [{ title: "Settings" }] : []),
      ]}
    >
      <div class="app-cols flex-1 min-h-0">
        <NotebookHotkeys notebookId={notebook.id} notebookName={notebook.name} canWrite={canWrite} />

        {/* Sidebar */}
        <NotebookSidebar ctx={ctx} />

        {/* Main Content */}
        <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          {isSettingsMode ? (
            <NotebookSettingsPanel notebook={notebook} accessEntries={accessEntries} isAdmin={isAdmin} canWrite={canWrite} />
          ) : isVersionsMode && selectedNoteId ? (
            <VersionHistory
              notebookId={notebookId}
              noteId={selectedNoteId}
              noteTitle={selectedNote?.title ?? ""}
              isLocked={!!selectedNote?.lockedAt}
              currentContentMd={selectedNote?.contentMd ?? null}
            />
          ) : isGraphMode && graph ? (
            <NotebookGraph notebookId={notebookId} selectedNoteId={selectedNoteId} graph={graph} />
          ) : selectedNote ? (
            actualReadMode ? (
              <ReadonlyNote
                noteId={selectedNote.id}
                noteTitle={selectedNote.title}
                notebookId={notebookId}
                renderedHtml={selectedNote.renderedHtml ?? ""}
                isLocked={!!selectedNote.lockedAt}
              />
            ) : (
              <NoteEditor
                noteId={selectedNote.id}
                noteTitle={selectedNote.title}
                notebookId={notebookId}
                appUrl={appUrl}
                sessionToken={sessionToken!}
                userId={user.id}
                displayName={user.displayName}
                initialSnapshot={selectedNote.yjsSnapshot}
                initialPanelOpen={detailPanelOpen}
              />
            )
          ) : (
            <div class="flex-1 flex items-center justify-center">
              <p class="flex items-center gap-1.5 text-xs text-dimmed">
                <i class="ti ti-file-text text-sm" />
                {tree.length === 0 ? "No notes yet" : "Select a note to collaborate"}
              </p>
            </div>
          )}
        </div>

        {/* Right-side detail panel — TOC, backlinks, online users, info */}
        {showDetailPanel && selectedNote && (
          <NotebookDetailPanel
            mode={actualReadMode ? "read" : "edit"}
            // Read mode has no footer / no in-content actions — the panel is
            // the only UI surface for switching to Edit / opening Version
            // history / etc. Force it open here regardless of cookie.
            initiallyOpen={actualReadMode ? true : detailPanelOpen}
            tocItems={tocItems}
            taskProgress={extractTaskProgress(selectedNote.contentMd)}
            backlinks={backlinks}
            currentNotebookId={notebookId}
            notebookId={notebookId}
            noteId={selectedNote.id}
            noteTitle={selectedNote.title}
            contentMd={selectedNote.contentMd}
            createdAt={selectedNote.createdAt}
            updatedAt={selectedNote.updatedAt}
            lockedAt={selectedNote.lockedAt}
            isLocked={!!selectedNote.lockedAt}
          />
        )}
      </div>
    </Layout>
  );
});

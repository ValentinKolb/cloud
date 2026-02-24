import { ssr, env } from "@valentinkolb/cloud/core/config";
import { type AuthContext, auth } from "@valentinkolb/cloud/lib/server";
import { notebooksService } from "@/notebooks/service";
import { markdown } from "@valentinkolb/cloud/lib/shared";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import NotebookSidebar from "./_components/sidebar/NotebookSidebar";
import NoteEditor from "./_components/editor/NoteEditor.client";
import ReadonlyNote from "./_components/editor/ReadonlyNote.island";
import NotebookSettingsPanel from "./_components/settings/NotebookSettingsPanel.island";
import VersionHistory from "./_components/versions/VersionHistory.island";
import { parseSettings } from "./_components/settings/NotebookSettingsStore";
import type { NotebookContext } from "./_components/sidebar/types";

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const sessionToken = auth.session.getToken(c);
  const notebookId = c.req.param("id");

  // Get notebook
  const notebook = await notebooksService.notebook.get({ id: notebookId });
  if (!notebook) {
    return (
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
    userGroups: user.memberofGroup,
  });
  if (permission === "none") {
    return (
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
  const isReadMode = view === "read";

  // Load note tree
  const tree = await notebooksService.note.getTree({ notebookId });

  // Load access entries for settings mode (admin only)
  const accessEntries = isSettingsMode && isAdmin ? (await notebooksService.notebook.access.list({ notebookId })).items : [];

  // Determine selected note: query param > cookie > first note
  const cookieHeader = c.req.header("Cookie");
  const settings = parseSettings(cookieHeader, notebookId);
  const noteIdParam = c.req.query("note");
  const selectedNoteId = noteIdParam ?? settings.lastNoteId ?? tree[0]?.id ?? null;

  // Load selected note content (Yjs snapshot) for SSR → editor
  let selectedNote: {
    id: string;
    title: string;
    yjsSnapshot: string | null;
    contentMd: string | null;
    renderedHtml: string | null;
    lockedAt: string | null;
  } | null = null;
  if (selectedNoteId && !isSettingsMode) {
    if (isVersionsMode) {
      // Only load metadata for version history (no Yjs content needed)
      const noteMeta = await notebooksService.note.get({ id: selectedNoteId });
      if (noteMeta) {
        selectedNote = {
          id: noteMeta.id,
          title: noteMeta.title,
          yjsSnapshot: null,
          contentMd: noteMeta.contentMd,
          renderedHtml: null,
          lockedAt: noteMeta.lockedAt,
        };
      }
    } else {
      const noteWithContent = await notebooksService.note.getWithContent({
        id: selectedNoteId,
      });
      if (noteWithContent) {
        // Force read mode for locked notes
        const isNoteLocked = !!noteWithContent.lockedAt;
        const shouldRenderHtml = isReadMode || isNoteLocked;
        selectedNote = {
          id: noteWithContent.id,
          title: noteWithContent.title,
          yjsSnapshot: noteWithContent.yjsSnapshot, // already base64
          contentMd: noteWithContent.contentMd,
          renderedHtml: shouldRenderHtml ? markdown.render(noteWithContent.contentMd ?? "") : null,
          lockedAt: noteWithContent.lockedAt,
        };
      }
    }
  }

  // Determine actual read mode (including locked notes)
  const actualReadMode = isReadMode || !!selectedNote?.lockedAt;

  const ctx: NotebookContext = {
    notebook,
    tree,
    selectedNoteId,
    settings,
    permission,
    viewMode: isReadMode ? "read" : "edit",
  };

  return (
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
      <div class="flex flex-col lg:flex-row lg:items-stretch gap-4 flex-1 min-h-0">
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
                appUrl={env.APP_URL}
                sessionToken={sessionToken!}
                displayName={user.displayName}
                initialSnapshot={selectedNote.yjsSnapshot}
              />
            )
          ) : (
            <div class="flex-1 flex items-center justify-center">
              <p class="flex items-center gap-1.5 text-xs text-dimmed">
                <i class="ti ti-file-text text-sm" />
                {tree.length === 0 ? "No pages yet" : "Select a page to start editing"}
              </p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
});

import { ssr } from "../../config";
import { get } from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { markdown } from "@valentinkolb/cloud/shared";
import { notebooksService } from "@/service";
import { transformAttachments } from "@/service/attachments";
import { transformNoteLinks } from "@/service/links";
import { transformTags } from "@/service/tags";
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
  // Route param is the notebook short-id (or, for tolerance, a UUID —
  // resolved via `getByIdOrShortId`). Service layer below the boundary
  // continues to use the canonical UUID `notebookId`.
  const notebookIdOrShort = c.req.param("id");

  // Get notebook
  const notebook = await notebooksService.notebook.getByIdOrShortId({ idOrShortId: notebookIdOrShort });
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
  const notebookId = notebook.id;

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

  // Determine selected note: path param > cookie > first note.
  // Path is `/notebooks/:nbId/notes/:noteId` — `noteId` is a short-id
  // (or, tolerantly, a UUID). We resolve to the canonical UUID once
  // here so everything below stays UUID-driven.
  const cookieHeader = c.req.header("Cookie");
  const settings = parseSettings(cookieHeader, notebookId);
  const detailPanelOpen = parseDetailPanelOpen(cookieHeader);
  const noteParam = c.req.param("noteId");
  const resolvedFromPath = noteParam
    ? (await notebooksService.note.getByIdOrShortId({ idOrShortId: noteParam }))?.id ?? null
    : null;
  const selectedNoteId = resolvedFromPath ?? settings.lastNoteId ?? tree[0]?.id ?? null;

  // Load selected note content (Yjs snapshot) for SSR → editor.
  // Also pull metadata used by the detail panel's Info section.
  let selectedNote: {
    id: string;
    shortId: string;
    title: string;
    yjsSnapshot: string | null;
    contentMd: string | null;
    renderedHtml: string | null;
    lockedAt: string | null;
    parentId: string | null;
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
          shortId: noteMeta.shortId,
          title: noteMeta.title,
          yjsSnapshot: null,
          contentMd: noteMeta.contentMd,
          renderedHtml: null,
          lockedAt: noteMeta.lockedAt,
          parentId: noteMeta.parentId,
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
        const shouldRenderHtml = isReadMode || isNoteLocked || !canWrite;

        tocItems = extractTocFromMarkdown(noteWithContent.contentMd);

        // Hydrate referenced attachments + note links in parallel.
        // Both transformers are sync regex-replacers, so we resolve the
        // short-id → metadata maps upfront (one batched query each)
        // and feed them in. Avoids any per-link N+1.
        const attachmentShortIds = notebooksService.attachment.extractIds(noteWithContent.contentMd);
        const noteLinkShortIds = notebooksService.note.extractLinks(noteWithContent.contentMd);
        const [referencedAttachments, noteLinkResolutions] = await Promise.all([
          attachmentShortIds.length > 0
            ? notebooksService.attachment.listByShortIds({ shortIds: attachmentShortIds })
            : Promise.resolve([]),
          noteLinkShortIds.length > 0
            ? notebooksService.note.resolveShortIdsToNotebookShortIds({ shortIds: noteLinkShortIds })
            : Promise.resolve(new Map<string, { notebookShortId: string; noteShortId: string }>()),
        ]);
        const shortIdToFilename = new Map(referencedAttachments.map((a) => [a.shortId, a.filename]));
        const noteShortIdToHref = new Map<string, string>();
        for (const [shortId, resolved] of noteLinkResolutions) {
          noteShortIdToHref.set(shortId, `/app/notebooks/${resolved.notebookShortId}/notes/${resolved.noteShortId}`);
        }

        // For read mode: pipe markdown.render through link transforms +
        // tag pills + attachment URL rewrite + heading id injection so
        // the rendered HTML mirrors the editor's pill widgets.
        const renderedHtml = shouldRenderHtml
          ? injectHeadingIds(
              transformTags(
                transformAttachments(
                  transformNoteLinks(markdown.render(noteWithContent.contentMd ?? ""), { noteShortIdToHref }),
                  { notebookId, shortIdToFilename },
                ),
                { notebookId },
              ),
              tocItems,
            )
          : null;

        selectedNote = {
          id: noteWithContent.id,
          shortId: noteWithContent.shortId,
          title: noteWithContent.title,
          yjsSnapshot: noteWithContent.yjsSnapshot, // already base64
          contentMd: noteWithContent.contentMd,
          renderedHtml,
          lockedAt: noteWithContent.lockedAt,
          parentId: noteWithContent.parentId,
          createdAt: noteWithContent.createdAt,
          updatedAt: noteWithContent.updatedAt,
          createdBy: noteWithContent.createdBy,
        };
      }
    }
  }

  // Determine actual read mode. Users without write permission must
  // not mount the edit-mode Y.Doc/kit surface.
  const actualReadMode = isReadMode || !canWrite || !!selectedNote?.lockedAt;

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

  // Cheap COUNTs — gate the sidebar's "Attachments" + "Tags" links.
  const [attachmentCount, tagCount] = await Promise.all([
    notebooksService.attachment.count({ notebookId }),
    notebooksService.tag.count({ notebookId }),
  ]);

  const ctx: NotebookContext = {
    notebook,
    tree,
    selectedNoteId,
    settings,
    permission,
    viewMode: isReadMode ? "read" : "edit",
    attachmentCount,
    tagCount,
  };

  // Read app.url once in the async handler and pass it through closure into the
  // sync render function. The render function MUST stay sync.
  const appUrl = await get<string>("app.url");

  // Detail panel only renders for actual note views (not settings/versions
  // /graph modes — those have their own dedicated layouts).
  const showDetailPanel = !!selectedNote && !isSettingsMode && !isVersionsMode && !isGraphMode;

  // Hydrate metadata for attachments referenced in the current note's
  // markdown — feeds the detail panel's "Attachments" section. Live updates
  // flow through `ATTACHMENTS_UPDATE_EVENT` once the editor is mounted.
  // `extractIds` returns short-ids (the form carried in `attach://`).
  const panelAttachmentShortIds = showDetailPanel ? notebooksService.attachment.extractIds(selectedNote!.contentMd) : [];
  const panelAttachments = panelAttachmentShortIds.length > 0
    ? await notebooksService.attachment.listByShortIds({ shortIds: panelAttachmentShortIds })
    : [];

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
      <div class="app-cols flex-1 min-h-0">
        <NotebookHotkeys notebookId={notebook.shortId} notebookName={notebook.name} canWrite={canWrite} />

        {/* Sidebar */}
        <NotebookSidebar ctx={ctx} />

        {/* Main Content */}
        <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          {isSettingsMode ? (
            <NotebookSettingsPanel notebook={notebook} accessEntries={accessEntries} isAdmin={isAdmin} canWrite={canWrite} />
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
            actualReadMode ? (
              <ReadonlyNote
                // Editor + readonly view get the canonical UUID, NOT the
                // short-id. The yjs websocket, presence channel, attachment
                // API, and Y.Doc topic all key on the canonical form
                // internally — passing the UUID end-to-end keeps every
                // payload.noteId comparison on a single value and avoids
                // the dropped-initial-syncPush race that plagued the
                // short-id-everywhere variant. URL-builder + markdown
                // schemes still use short-ids (notebook.shortId etc).
                noteId={selectedNote.id}
                noteTitle={selectedNote.title}
                notebookId={notebook.shortId}
                scriptsEnabled={notebook.scriptsEnabled}
                noteShortId={selectedNote.shortId}
                noteContent={selectedNote.contentMd ?? ""}
                noteCreatedAt={selectedNote.createdAt}
                noteUpdatedAt={selectedNote.updatedAt}
                noteLockedAt={selectedNote.lockedAt}
                noteParentId={selectedNote.parentId}
                notebookName={notebook.name}
                renderedHtml={selectedNote.renderedHtml ?? ""}
                isLocked={!!selectedNote.lockedAt}
              />
            ) : (
              <NoteEditor
                noteId={selectedNote.id}
                noteTitle={selectedNote.title}
                notebookId={notebook.shortId}
                scriptsEnabled={notebook.scriptsEnabled}
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
            attachments={panelAttachments}
            backlinks={backlinks}
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
      </div>
    </Layout>
  );
});

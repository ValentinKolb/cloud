import { ssr } from "../../config";
import { AppWorkspace, type ResourceApiKey } from "@valentinkolb/cloud/ui";
import { get, serviceAccountCredentials } from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { notebooksService } from "@/service";
import { loadSelectedNoteRouteState, type SelectedNoteRouteState } from "@/service/route-state";
import { extractNamedBlockSummaries } from "@/lib/named-blocks";
import NotebookDetailPanel from "./_components/detail/NotebookDetailPanel.island";
import { extractTocFromMarkdown } from "./_components/detail/toc";
import NoteEditor from "./_components/editor/NoteEditor.client";
import NotebookLayoutHelp from "./_components/help/NotebookLayoutHelp.island";
import NotebookGraph from "./_components/graph/NotebookGraph.island";
import NotebookSettingsPanel from "./_components/settings/NotebookSettingsPanel.island";
import { parseDetailPanelOpen, parseSettings } from "./_components/settings/NotebookSettingsStore";
import NotebookHotkeys from "./_components/shortcuts/NotebookHotkeys.island";
import NotebookSidebar from "./_components/sidebar/NotebookSidebar.island";
import WorkspaceEventBridge from "./_components/sidebar/WorkspaceEventBridge.island";
import type { NotebookContext } from "./_components/sidebar/types";
import VersionHistory from "./_components/versions/VersionHistory.island";
import { buildNoteUrl, buildVersionsUrl } from "../params";

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const sessionToken = auth.session.getToken(c);
  // Route param is the notebook short-id (or, for tolerance, a UUID —
  // resolved via `getByIdOrShortId`). Service layer below the boundary
  // continues to use the canonical UUID `notebookId`.
  const notebookIdOrShort = c.req.param("id")!;

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
  const canRunScripts = notebook.scriptsEnabled;

  // Check mode
  const mode = c.req.query("mode");
  const isSettingsMode = mode === "settings";
  const isVersionsMode = mode === "versions";
  const isGraphMode = mode === "graph";

  // Load note tree
  const tree = await notebooksService.note.getTree({ notebookId });

  const resolveNoteInNotebook = async (idOrShortId: string | null | undefined): Promise<string | null> => {
    if (!idOrShortId) return null;
    const note = await notebooksService.note.getByIdOrShortId({ idOrShortId });
    return note?.notebookId === notebookId ? note.id : null;
  };

  // Load settings-only admin data lazily for route-backed settings mode.
  const accessEntries = isSettingsMode && isAdmin ? (await notebooksService.notebook.access.list({ notebookId })).items : [];
  const apiKeys: ResourceApiKey[] =
    isSettingsMode && isAdmin
      ? (
          await serviceAccountCredentials.listOverview({
            pagination: { page: 1, perPage: 500 },
            filter: {
              serviceAccountKind: "resource_bound",
              credentialStatus: "active",
              appId: "notebooks",
              resourceType: "notebook",
              resourceId: notebookId,
            },
          })
        ).items.flatMap((item) => {
          const permission = accessEntries.find(
            (entry) =>
              entry.principal.type === "service_account" &&
              entry.principal.serviceAccountId === item.serviceAccount.id &&
              entry.permission !== "none",
          )?.permission;
          if (!permission || permission === "none") return [];
          const { serviceAccount: _serviceAccount, owner: _owner, ...credential } = item;
          return [{ ...credential, permission }];
        })
      : [];

  // Determine selected note: path param > cookie > homepage > first note.
  // Path is `/notebooks/:nbId/notes/:noteId` — `noteId` is a short-id
  // (or, tolerantly, a UUID). We resolve to the canonical UUID once
  // here so everything below stays UUID-driven.
  const cookieHeader = c.req.header("Cookie");
  const settings = parseSettings(cookieHeader, notebook.shortId);
  const detailPanelOpen = parseDetailPanelOpen(cookieHeader);
  const noteParam = c.req.param("noteId");
  const resolvedFromPath = await resolveNoteInNotebook(noteParam);
  const resolvedFromCookie = await resolveNoteInNotebook(settings.lastNoteId);
  const resolvedHomepage = await resolveNoteInNotebook(notebook.homepageNoteId);
  const selectedNoteId = resolvedFromPath ?? resolvedFromCookie ?? resolvedHomepage ?? tree[0]?.id ?? null;

  // Load selected note content (Yjs snapshot) for SSR → editor.
  // Also pull metadata used by the detail panel's Info section.
  let selectedNote: {
    id: string;
    shortId: string;
    title: string;
    yjsSnapshot: string | null;
    contentMd: string | null;
    lockedAt: string | null;
    parentId: string | null;
    createdAt: string;
    updatedAt: string;
    createdBy: string | null;
  } | null = null;
  let selectedRouteState: SelectedNoteRouteState | null = null;

  // TOC and named-block items feed the detail panel. Extract once from
  // `content_md` and reuse for the initial SSR state.
  let tocItems: ReturnType<typeof extractTocFromMarkdown> = [];
  let namedBlocks: ReturnType<typeof extractNamedBlockSummaries> = [];

  if (selectedNoteId && !isSettingsMode) {
    if (isVersionsMode) {
      // Only metadata for version history (no Yjs content needed)
      const noteMeta = await notebooksService.note.get({ id: selectedNoteId });
      if (noteMeta?.notebookId === notebookId) {
        selectedNote = {
          id: noteMeta.id,
          shortId: noteMeta.shortId,
          title: noteMeta.title,
          yjsSnapshot: null,
          contentMd: noteMeta.contentMd,
          lockedAt: noteMeta.lockedAt,
          parentId: noteMeta.parentId,
          createdAt: noteMeta.createdAt,
          updatedAt: noteMeta.updatedAt,
          createdBy: noteMeta.createdBy,
        };
        tocItems = extractTocFromMarkdown(noteMeta.contentMd);
        namedBlocks = extractNamedBlockSummaries(noteMeta.contentMd);
      }
    } else {
      selectedRouteState = await loadSelectedNoteRouteState({
        notebookId,
        noteIdOrShortId: selectedNoteId,
        canWrite,
        userId: user.id,
        userGroups: user.memberofGroupIds,
        bypassAccess: hasRole(user, "admin"),
      });
      if (selectedRouteState) {
        selectedNote = selectedRouteState.note;
        tocItems = selectedRouteState.tocItems;
        namedBlocks = selectedRouteState.namedBlocks;
      }
    }
  }

  // Resource state policy: the opened note belongs in the URL. A bare
  // notebook URL may use lastNoteId/homepage/first-note fallback, but once SSR
  // resolves a note we canonicalize to `/notes/:noteShortId` so reloads keep
  // the same note instead of re-running fallback selection.
  if (!noteParam && selectedNote && !isSettingsMode && !isGraphMode) {
    const href = isVersionsMode
      ? buildVersionsUrl(notebook.shortId, selectedNote.shortId)
      : buildNoteUrl(notebook.shortId, selectedNote.shortId);
    return c.redirect(href);
  }

  // Determine actual readonly rendering. Users without write permission must
  // not mount the edit-mode Y.Doc/kit surface.
  const readonlyMode = selectedRouteState?.readonlyMode ?? (!canWrite || !!selectedNote?.lockedAt);

  // Graph data: only fetched in graph mode. The whole-notebook payload
  // (nodes + internal edges) is small enough to inline into the SSR
  // response — saves the round-trip a client-fetch would otherwise need.
  const graph = isGraphMode ? await notebooksService.notebook.graph({ notebookId }) : null;

  // Cheap COUNTs — gate the sidebar's "Attachments" + "Tags" links.
  const [attachmentCount, tags, favoriteRows] = await Promise.all([
    notebooksService.attachment.count({ notebookId }),
    notebooksService.tag.listForNotebook({ notebookId }),
    notebooksService.note.favorites.listIds({ notebookId, userId: user.id }),
  ]);
  const tagCount = tags.length;

  const ctx: NotebookContext = {
    notebook,
    tree,
    selectedNoteId,
    userId: user.id,
    settings,
    permission,
    attachmentCount,
    tagCount,
    favoriteNoteIds: favoriteRows.map((row) => row.noteId),
    tags,
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
  const panelAttachments = selectedRouteState?.panelAttachments ?? [];
  const backlinks = selectedRouteState?.backlinks ?? [];

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

        {/* Sidebar */}
        <NotebookSidebar ctx={ctx} />

        {/* Main Content */}
        <AppWorkspace.Main>
          {isSettingsMode ? (
            <NotebookSettingsPanel notebook={notebook} tree={tree} accessEntries={accessEntries} apiKeys={apiKeys} isAdmin={isAdmin} canWrite={canWrite} />
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

        {/* Right-side detail panel — TOC, backlinks, online users, info */}
        {showDetailPanel && selectedNote && (
          <NotebookDetailPanel
            mode={readonlyMode ? "read" : "edit"}
            // Readonly rendering has no footer / no in-content actions. Keep
            // the panel open so readers can still copy/download/open history.
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

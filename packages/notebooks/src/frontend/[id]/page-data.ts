import { hasRole } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, getDateConfig } from "@valentinkolb/cloud/server";
import { get } from "@valentinkolb/cloud/services";
import type { ResourceApiKey } from "@valentinkolb/cloud/ui";
import type { Context } from "hono";
import { expectUserBackedActor } from "@/actor";
import { extractNamedBlockSummaries } from "@/lib/named-blocks";
import { parseNavigatorQuery } from "@/lib/navigator-url";
import { notebooksService } from "@/service";
import { loadSelectedNoteRouteState, type SelectedNoteRouteState } from "@/service/route-state";
import { buildNoteUrl, buildVersionsUrl } from "../params";
import { extractTocFromMarkdown } from "./_components/detail/toc";
import { parseDetailPanelOpen, parseSettings } from "./_components/settings/NotebookSettingsStore";
import type { NotebookContext } from "./_components/sidebar/types";

type SelectedNote = SelectedNoteRouteState["note"];
type PageOptions = {
  title?: string;
  description?: string;
  theme?: "light" | "dark";
};
type NotebookPageContext = Context<AuthContext & { Variables: { page: Partial<PageOptions> } }>;

export async function loadNotebookPageData(c: NotebookPageContext) {
  const user = expectUserBackedActor(c);
  const sessionToken = auth.session.getToken(c);
  const notebookIdOrShort = c.req.param("id")!;

  const notebook = await notebooksService.notebook.getByIdOrShortId({ idOrShortId: notebookIdOrShort });
  if (!notebook) return { kind: "not_found" as const };

  const notebookId = notebook.id;
  const permission = await notebooksService.notebook.permission.get({
    notebookId,
    userId: user.id,
  });
  if (permission === "none") return { kind: "access_denied" as const };

  const isAdmin = permission === "admin";
  const canWrite = permission === "write" || isAdmin;
  const mode = c.req.query("mode");
  const isSettingsMode = mode === "settings";
  const isVersionsMode = mode === "versions";
  const isGraphMode = mode === "graph";
  const tree = await notebooksService.note.getTree({ notebookId });

  const accessEntries = isSettingsMode && isAdmin ? (await notebooksService.notebook.access.list({ notebookId })).items : [];
  const apiKeys = await loadNotebookApiKeys({
    notebookId,
    enabled: isSettingsMode && isAdmin,
  });

  const cookieHeader = c.req.header("Cookie");
  const settings = parseSettings(cookieHeader, notebook.shortId);
  const detailPanelOpen = parseDetailPanelOpen(cookieHeader);
  const noteParam = c.req.param("noteId");
  const selectedNoteId = await resolveSelectedNoteId({
    notebookId,
    noteParam,
    lastNoteId: settings.lastNoteId,
    homepageNoteId: notebook.homepageNoteId,
    firstNoteId: tree[0]?.id ?? null,
  });

  const selected = await loadSelectedNote({
    notebookId,
    selectedNoteId,
    isSettingsMode,
    isVersionsMode,
    canWrite,
    userId: user.id,
    bypassAccess: hasRole(user, "admin"),
  });

  if (!noteParam && selected.note && !isSettingsMode && !isGraphMode) {
    return {
      kind: "redirect" as const,
      href: isVersionsMode
        ? buildVersionsUrl(notebook.shortId, selected.note.shortId)
        : buildNoteUrl(notebook.shortId, selected.note.shortId),
    };
  }

  const readonlyMode = selected.routeState?.readonlyMode ?? (!canWrite || !!selected.note?.lockedAt);
  const graph = isGraphMode ? await notebooksService.notebook.graph({ notebookId }) : null;
  const versionHistory =
    isVersionsMode && selected.note
      ? await notebooksService.note.versions
          .list({
            noteId: selected.note.id,
            pagination: { page: 1, perPage: 20, offset: 0 },
          })
          .catch(() => null)
      : null;
  const [attachmentCount, tags, favoriteRows] = await Promise.all([
    notebooksService.attachment.count({ notebookId }),
    notebooksService.tag.listForNotebook({ notebookId }),
    notebooksService.note.favorites.listIds({ notebookId, userId: user.id }),
  ]);

  const ctx: NotebookContext = {
    notebook,
    tree,
    selectedNoteId,
    userId: user.id,
    settings,
    permission,
    attachmentCount,
    tagCount: tags.length,
    favoriteNoteIds: favoriteRows.map((row) => row.noteId),
    tags,
    dateConfig: getDateConfig(c),
    navigatorQuery: parseNavigatorQuery(new URL(c.req.url).searchParams),
  };

  const appUrl = await get<string>("app.url");

  return {
    kind: "ok" as const,
    user,
    sessionToken,
    notebook,
    tree,
    permission,
    isAdmin,
    canWrite,
    canRunScripts: notebook.scriptsEnabled,
    isSettingsMode,
    isVersionsMode,
    isGraphMode,
    accessEntries,
    apiKeys,
    selectedNoteId,
    selectedNote: selected.note,
    selectedRouteState: selected.routeState,
    tocItems: selected.tocItems,
    namedBlocks: selected.namedBlocks,
    readonlyMode,
    graph,
    versionHistory,
    ctx,
    appUrl,
    detailPanelOpen,
    showDetailPanel: !!selected.note && !isSettingsMode && !isVersionsMode && !isGraphMode,
    panelAttachments: selected.routeState?.panelAttachments ?? [],
    backlinks: selected.routeState?.backlinks ?? [],
    dateConfig: ctx.dateConfig,
  };
}

async function resolveSelectedNoteId(params: {
  notebookId: string;
  noteParam: string | undefined;
  lastNoteId: string | null;
  homepageNoteId: string | null;
  firstNoteId: string | null;
}): Promise<string | null> {
  const resolveNoteInNotebook = async (idOrShortId: string | null | undefined): Promise<string | null> => {
    if (!idOrShortId) return null;
    const note = await notebooksService.note.getByIdOrShortId({ idOrShortId });
    return note?.notebookId === params.notebookId ? note.id : null;
  };

  const resolvedFromPath = await resolveNoteInNotebook(params.noteParam);
  const resolvedFromCookie = await resolveNoteInNotebook(params.lastNoteId);
  const resolvedHomepage = await resolveNoteInNotebook(params.homepageNoteId);
  return resolvedFromPath ?? resolvedFromCookie ?? resolvedHomepage ?? params.firstNoteId;
}

async function loadNotebookApiKeys(params: { notebookId: string; enabled: boolean }): Promise<ResourceApiKey[]> {
  if (!params.enabled) return [];
  return notebooksService.notebook.access.apiKeys.list({ notebookId: params.notebookId });
}

async function loadSelectedNote(params: {
  notebookId: string;
  selectedNoteId: string | null;
  isSettingsMode: boolean;
  isVersionsMode: boolean;
  canWrite: boolean;
  userId: string;
  bypassAccess: boolean;
}): Promise<{
  note: SelectedNote | null;
  routeState: SelectedNoteRouteState | null;
  tocItems: ReturnType<typeof extractTocFromMarkdown>;
  namedBlocks: ReturnType<typeof extractNamedBlockSummaries>;
}> {
  if (!params.selectedNoteId || params.isSettingsMode) {
    return { note: null, routeState: null, tocItems: [], namedBlocks: [] };
  }

  if (params.isVersionsMode) {
    const noteMeta = await notebooksService.note.get({ id: params.selectedNoteId });
    if (noteMeta?.notebookId !== params.notebookId) return { note: null, routeState: null, tocItems: [], namedBlocks: [] };
    const note = {
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
    return {
      note,
      routeState: null,
      tocItems: extractTocFromMarkdown(noteMeta.contentMd),
      namedBlocks: extractNamedBlockSummaries(noteMeta.contentMd),
    };
  }

  const routeState = await loadSelectedNoteRouteState({
    notebookId: params.notebookId,
    noteIdOrShortId: params.selectedNoteId,
    canWrite: params.canWrite,
    userId: params.userId,
    bypassAccess: params.bypassAccess,
  });
  if (!routeState) return { note: null, routeState: null, tocItems: [], namedBlocks: [] };
  return {
    note: routeState.note,
    routeState,
    tocItems: routeState.tocItems,
    namedBlocks: routeState.namedBlocks,
  };
}

import { markdown } from "@valentinkolb/cloud/shared";
import { extractNamedBlockSummaries, renderNamedBlockHandlesMarkdown, type NamedBlockSummary } from "../lib/named-blocks";
import { extractTaskProgress, extractTocFromMarkdown, injectHeadingIds, type TaskProgress, type TocItem } from "../lib/note-insights";
import { transformAttachments, type Attachment } from "./attachments";
import { transformNoteLinks, type Backlink } from "./links";
import { notebooksService } from "./index";
import { transformTags } from "./tags";
import type { NoteWithContent } from "./notes";

export type SelectedNoteRouteState = {
  note: {
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
  };
  readonlyMode: boolean;
  tocItems: TocItem[];
  taskProgress: TaskProgress;
  namedBlocks: NamedBlockSummary[];
  backlinks: Backlink[];
  panelAttachments: Attachment[];
};

export type EditableNoteRouteData = {
  href: string;
  note: {
    id: string;
    shortId: string;
    title: string;
    yjsSnapshot: string | null;
    contentMd: string | null;
    createdAt: string;
    updatedAt: string;
    lockedAt: string | null;
    parentId: string | null;
  };
  detail: {
    canonicalNoteId: string;
    noteId: string;
    noteTitle: string;
    contentMd: string | null;
    createdAt: string;
    updatedAt: string;
    lockedAt: string | null;
    isLocked: boolean;
    tocItems: TocItem[];
    taskProgress: TaskProgress;
    attachments: Attachment[];
    backlinks: Backlink[];
    namedBlocks: NamedBlockSummary[];
  };
};

export type NotebookRouteStateResponse =
  | { kind: "ok"; state: EditableNoteRouteData }
  | { kind: "fallback"; reason: "invalid-target" | "not-found" | "readonly" };

type LoadSelectedNoteParams = {
  notebookId: string;
  noteIdOrShortId: string;
  canWrite: boolean;
  userId: string;
  userGroups: string[];
  bypassAccess: boolean;
};

const toSelectedNote = (note: NoteWithContent, renderedHtml: string | null): SelectedNoteRouteState["note"] => ({
  id: note.id,
  shortId: note.shortId,
  title: note.title,
  yjsSnapshot: note.yjsSnapshot,
  contentMd: note.contentMd,
  renderedHtml,
  lockedAt: note.lockedAt,
  parentId: note.parentId,
  createdAt: note.createdAt,
  updatedAt: note.updatedAt,
  createdBy: note.createdBy,
});

export const loadSelectedNoteRouteState = async (params: LoadSelectedNoteParams): Promise<SelectedNoteRouteState | null> => {
  const note = await notebooksService.note.getWithContentByIdOrShortId({ idOrShortId: params.noteIdOrShortId });
  if (!note || note.notebookId !== params.notebookId) return null;

  const readonlyMode = !params.canWrite || !!note.lockedAt;
  const tocItems = extractTocFromMarkdown(note.contentMd);
  const taskProgress = extractTaskProgress(note.contentMd);
  const namedBlocks = extractNamedBlockSummaries(note.contentMd);

  const attachmentShortIds = notebooksService.attachment.extractIds(note.contentMd);
  const noteLinkShortIds = readonlyMode ? notebooksService.note.extractLinks(note.contentMd) : [];
  const [referencedAttachments, noteLinkResolutions, backlinks] = await Promise.all([
    attachmentShortIds.length > 0
      ? notebooksService.attachment.listByShortIds({ shortIds: attachmentShortIds, notebookId: params.notebookId })
      : Promise.resolve([]),
    noteLinkShortIds.length > 0
      ? notebooksService.note.resolveShortIdsToNotebookShortIds({
          shortIds: noteLinkShortIds,
          userId: params.userId,
          userGroups: params.userGroups,
          bypassAccess: params.bypassAccess,
        })
      : Promise.resolve(new Map<string, { notebookShortId: string; noteShortId: string }>()),
    notebooksService.note.backlinks.list({
      noteId: note.id,
      userId: params.userId,
      userGroups: params.userGroups,
      bypassAccess: params.bypassAccess,
    }),
  ]);

  const renderedHtml = readonlyMode
    ? injectHeadingIds(
        transformTags(
          transformAttachments(
            transformNoteLinks(markdown.render(renderNamedBlockHandlesMarkdown(note.contentMd)), {
              noteShortIdToHref: new Map(
                [...noteLinkResolutions].map(([shortId, resolved]) => [
                  shortId,
                  `/app/notebooks/${resolved.notebookShortId}/notes/${resolved.noteShortId}`,
                ]),
              ),
            }),
            {
              notebookId: params.notebookId,
              shortIdToFilename: new Map(referencedAttachments.map((attachment) => [attachment.shortId, attachment.filename])),
            },
          ),
          { notebookId: params.notebookId },
        ),
        tocItems,
      )
    : null;

  return {
    note: toSelectedNote(note, renderedHtml),
    readonlyMode,
    tocItems,
    taskProgress,
    namedBlocks,
    backlinks,
    panelAttachments: referencedAttachments,
  };
};

type ResolveEditableRouteParams = Omit<LoadSelectedNoteParams, "noteIdOrShortId"> & {
  notebookShortId: string;
  href: string;
  origin: string;
};

const parseSameNotebookNoteHref = (params: ResolveEditableRouteParams): string | null => {
  try {
    const url = new URL(params.href, params.origin);
    if (url.origin !== params.origin || url.search || url.hash) return null;
    const match = url.pathname.match(/^\/app\/notebooks\/([^/]+)\/notes\/([^/]+)$/);
    if (!match || decodeURIComponent(match[1]!) !== params.notebookShortId) return null;
    return decodeURIComponent(match[2]!);
  } catch {
    return null;
  }
};

export const loadEditableNoteRouteData = async (params: ResolveEditableRouteParams): Promise<NotebookRouteStateResponse> => {
  const noteIdOrShortId = parseSameNotebookNoteHref(params);
  if (!noteIdOrShortId) return { kind: "fallback", reason: "invalid-target" };

  const state = await loadSelectedNoteRouteState({ ...params, noteIdOrShortId });
  if (!state) return { kind: "fallback", reason: "not-found" };
  if (state.readonlyMode) return { kind: "fallback", reason: "readonly" };

  const href = `/app/notebooks/${encodeURIComponent(params.notebookShortId)}/notes/${encodeURIComponent(state.note.shortId)}`;
  return {
    kind: "ok",
    state: {
      href,
      note: {
        id: state.note.id,
        shortId: state.note.shortId,
        title: state.note.title,
        yjsSnapshot: state.note.yjsSnapshot,
        contentMd: state.note.contentMd,
        createdAt: state.note.createdAt,
        updatedAt: state.note.updatedAt,
        lockedAt: state.note.lockedAt,
        parentId: state.note.parentId,
      },
      detail: {
        canonicalNoteId: state.note.id,
        noteId: state.note.shortId,
        noteTitle: state.note.title,
        contentMd: state.note.contentMd,
        createdAt: state.note.createdAt,
        updatedAt: state.note.updatedAt,
        lockedAt: state.note.lockedAt,
        isLocked: false,
        tocItems: state.tocItems,
        taskProgress: state.taskProgress,
        attachments: state.panelAttachments,
        backlinks: state.backlinks,
        namedBlocks: state.namedBlocks,
      },
    },
  };
};

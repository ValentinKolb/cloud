import { err, fail, ok, type Result } from "@k2b/stdlib";
import {
  type CapabilityExecutionContext,
  type CapabilityInvocationResult,
  type CloudResourceView,
  defineCapabilities,
  type MutationResult,
  UniversalSearchDataSchema,
  type UniversalSearchInput,
  UniversalSearchInputSchema,
} from "@valentinkolb/cloud/contracts";
import { hasPermission, type PermissionLevel } from "@valentinkolb/cloud/server";
import { type AuditActor, audit } from "@valentinkolb/cloud/services";
import type { z } from "zod";
import {
  NotebookDataSchema,
  NotebookGetInputSchema,
  NotebookListDataSchema,
  NotebookListInputSchema,
  NoteCreateInputSchema,
  NoteDetailDataSchema,
  NoteEditDataSchema,
  NoteEditInputSchema,
  NoteGetInputSchema,
  NoteLinksDataSchema,
  NoteLinksInputSchema,
  NoteMoveInputSchema,
  NoteSummaryDataSchema,
  NoteTreeDataSchema,
  NoteTreeInputSchema,
  TagListDataSchema,
  TagListInputSchema,
  TagNotesDataSchema,
  TagNotesInputSchema,
} from "./capability-contracts";
import { noteContentHash, summarizeNoteEditBlocks } from "./lib/note-edit";
import { NOTEBOOK_RESOURCE_TYPE, NOTEBOOKS_APP_ID } from "./service/access";
import { resolveNotebookApiKeyPermission } from "./service/api-key-permissions";
import * as noteLinks from "./service/links";
import type { Notebook, NotebookWithPermission } from "./service/notebooks";
import * as notebookStore from "./service/notebooks";
import type { Note } from "./service/notes";
import * as noteStore from "./service/notes";
import * as noteSearch from "./service/search";
import * as noteTags from "./service/tags";

const encodePageCursor = (page: number): string => Buffer.from(JSON.stringify({ v: 1, page }), "utf8").toString("base64url");

export const decodeNotebookCapabilityCursor = (cursor: string | undefined): Result<number> => {
  if (!cursor) return ok(1);
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { v?: unknown; page?: unknown };
    return value.v === 1 && Number.isInteger(value.page) && Number(value.page) >= 1
      ? ok(Number(value.page))
      : fail(err.badInput("Invalid cursor"));
  } catch {
    return fail(err.badInput("Invalid cursor"));
  }
};

const encodeTreeCursor = (afterId: string): string => Buffer.from(JSON.stringify({ v: 1, afterId }), "utf8").toString("base64url");

export const decodeNotebookTreeCursor = (cursor: string | undefined): Result<string | undefined> => {
  if (!cursor) return ok(undefined);
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { v?: unknown; afterId?: unknown };
    return value.v === 1 && typeof value.afterId === "string" && zUuid(value.afterId)
      ? ok(value.afterId)
      : fail(err.badInput("Invalid tree cursor"));
  } catch {
    return fail(err.badInput("Invalid tree cursor"));
  }
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const zUuid = (value: string | null | undefined): value is string => Boolean(value && UUID_PATTERN.test(value));

const permissionFromScopes = (scopes: string[]): PermissionLevel => resolveNotebookApiKeyPermission("admin", scopes);

const effectivePermission = (permission: Exclude<PermissionLevel, "none">, context: CapabilityExecutionContext) =>
  context.actor.kind === "service_account" && context.actor.serviceAccount.kind === "resource_bound"
    ? resolveNotebookApiKeyPermission(permission, context.actor.scopes)
    : permission;

const scopedNotebookId = (context: CapabilityExecutionContext, required: PermissionLevel): Result<string | null> => {
  if (context.actor.kind === "user") {
    return context.accessSubject.type === "user" ? ok(null) : fail(err.forbidden("Access denied"));
  }
  const account = context.actor.serviceAccount;
  if (account.kind === "user_delegated") {
    return context.accessSubject.type === "user" && context.user ? ok(null) : fail(err.forbidden("Access denied"));
  }
  if (
    account.appId !== NOTEBOOKS_APP_ID ||
    account.resourceType !== NOTEBOOK_RESOURCE_TYPE ||
    !zUuid(account.resourceId) ||
    context.accessSubject.type !== "service_account" ||
    !hasPermission(permissionFromScopes(context.actor.scopes), required)
  ) {
    return fail(err.forbidden("Access denied"));
  }
  return ok(account.resourceId);
};

const principalIds = (context: CapabilityExecutionContext) => ({
  userId: context.accessSubject.type === "user" ? context.accessSubject.userId : null,
  serviceAccountId: context.accessSubject.type === "service_account" ? context.accessSubject.serviceAccountId : null,
});

const requireNotebook = async (notebookId: string, context: CapabilityExecutionContext, required: PermissionLevel = "read") => {
  const scope = scopedNotebookId(context, required);
  if (!scope.ok) return scope;
  if (scope.data && scope.data !== notebookId) return fail(err.notFound("Notebook"));
  const notebook = await notebookStore.get({ id: notebookId });
  if (!notebook) return fail(err.notFound("Notebook"));
  const ids = principalIds(context);
  const granted = await notebookStore.getPermission({ notebookId, ...ids });
  const permission = granted === "none" ? "none" : effectivePermission(granted, context);
  return hasPermission(permission, required) ? ok({ notebook, permission }) : fail(err.notFound("Notebook"));
};

const requireNote = async (noteId: string, context: CapabilityExecutionContext, required: PermissionLevel = "read") => {
  const note = await noteStore.get({ id: noteId });
  if (!note) return fail(err.notFound("Note"));
  const access = await requireNotebook(note.notebookId, context, required);
  return access.ok ? ok({ note, notebook: access.data.notebook, permission: access.data.permission }) : fail(err.notFound("Note"));
};

const mapNotebook = (notebook: Notebook, permission: Exclude<PermissionLevel, "none">) => ({
  id: notebook.id,
  shortId: notebook.shortId,
  name: notebook.name,
  description: notebook.description,
  icon: notebook.icon,
  homepageNoteId: notebook.homepageNoteId,
  homepageNoteShortId: notebook.homepageNoteShortId,
  permission,
  createdAt: notebook.createdAt,
  updatedAt: notebook.updatedAt,
});

const mapNote = (note: Note) => ({
  id: note.id,
  shortId: note.shortId,
  notebookId: note.notebookId,
  parentId: note.parentId,
  title: note.title,
  position: note.position,
  hasChildren: note.hasChildren,
  locked: note.lockedAt !== null,
  createdAt: note.createdAt,
  updatedAt: note.updatedAt,
});

const notebookHref = (notebook: Pick<Notebook, "shortId">) => `/app/notebooks/${notebook.shortId}`;
const noteHref = (notebook: Pick<Notebook, "shortId">, note: Pick<Note, "shortId">) =>
  `/app/notebooks/${notebook.shortId}/notes/${note.shortId}`;

const cleanSearchSnippet = (value: string | null): string | undefined =>
  value ? value.replaceAll("\uE000", "").replaceAll("\uE001", "").trim() || undefined : undefined;

const compactSnippet = (content: string | null): string | undefined => {
  const value = content?.replace(/\s+/g, " ").trim();
  return value ? value.slice(0, 240) : undefined;
};

const runNotebookSearch = async (input: UniversalSearchInput, context: CapabilityExecutionContext) => {
  const scope = scopedNotebookId(context, "read");
  if (!scope.ok) return ok({ data: [] });
  const page = await notebookStore.listWithPermission({
    ...principalIds(context),
    boundNotebookId: scope.data,
    requiredLevel: "read",
    pagination: { limit: input.limit, offset: 0 },
    query: input.query,
  });
  const data: CloudResourceView[] = page.items.map((notebook) => ({
    ref: { type: "notebooks.notebook", id: notebook.id },
    title: notebook.name,
    preview: notebook.description ?? undefined,
    icon: notebook.icon ?? "ti ti-notebook",
    priority: 7,
    metadata: [{ label: "Type", value: "Notebook" }],
    links: [{ rel: "open", href: notebookHref(notebook) }],
  }));
  return ok({ data });
};

const runNoteSearch = async (input: UniversalSearchInput, context: CapabilityExecutionContext) => {
  const scope = scopedNotebookId(context, "read");
  if (!scope.ok) return ok({ data: [] });
  const hits = await noteSearch.searchAcross({
    ...principalIds(context),
    boundNotebookId: scope.data,
    filters: { query: input.query },
    pagination: { page: 1, perPage: input.limit, offset: 0 },
  });
  const data: CloudResourceView[] = hits.hits.map(({ note, notebook, snippet }) => ({
    ref: { type: "notebooks.note", id: note.id },
    title: note.title,
    preview: cleanSearchSnippet(snippet) ?? compactSnippet(note.contentMd),
    icon: "ti ti-file-text",
    priority: 8,
    metadata: [
      { label: "Type", value: "Note" },
      { label: "Notebook", value: notebook.name },
    ],
    links: [{ rel: "open", href: `/app/notebooks/${notebook.shortId}/notes/${note.shortId}` }],
  }));
  return ok({ data });
};

const runNotebookList = async (input: z.infer<typeof NotebookListInputSchema>, context: CapabilityExecutionContext) => {
  const cursor = decodeNotebookCapabilityCursor(input.cursor);
  if (!cursor.ok) return cursor;
  const scope = scopedNotebookId(context, input.minimumPermission);
  if (!scope.ok) return scope;
  const page = await notebookStore.listWithPermission({
    ...principalIds(context),
    boundNotebookId: scope.data,
    requiredLevel: input.minimumPermission,
    pagination: { limit: input.limit, offset: (cursor.data - 1) * input.limit },
    query: input.query,
  });
  const data = page.items.map((notebook: NotebookWithPermission) =>
    mapNotebook(notebook, effectivePermission(notebook.permission, context) as Exclude<PermissionLevel, "none">),
  );
  return ok({
    data,
    page: {
      hasMore: cursor.data * input.limit < page.total,
      ...(cursor.data * input.limit < page.total ? { nextCursor: encodePageCursor(cursor.data + 1) } : {}),
    },
    refs: data.map((notebook) => ({ type: "notebooks.notebook", id: notebook.id })),
  });
};

const runNotebookGet = async (input: z.infer<typeof NotebookGetInputSchema>, context: CapabilityExecutionContext) => {
  const access = await requireNotebook(input.notebookId, context);
  if (!access.ok) return access;
  return ok({
    data: mapNotebook(access.data.notebook, access.data.permission as Exclude<PermissionLevel, "none">),
    refs: [{ type: "notebooks.notebook", id: access.data.notebook.id }],
    links: [{ rel: "open" as const, href: notebookHref(access.data.notebook) }],
  });
};

const runNoteTree = async (input: z.infer<typeof NoteTreeInputSchema>, context: CapabilityExecutionContext) => {
  const cursor = decodeNotebookTreeCursor(input.cursor);
  if (!cursor.ok) return cursor;
  const access = await requireNotebook(input.notebookId, context);
  if (!access.ok) return access;
  const rows = await noteStore.listTreePage({
    notebookId: input.notebookId,
    afterId: cursor.data,
    limit: input.limit + 1,
  });
  const hasMore = rows.length > input.limit;
  const data = rows.slice(0, input.limit);
  const last = data.at(-1);
  return ok({
    data,
    page: { hasMore, ...(hasMore && last ? { nextCursor: encodeTreeCursor(last.id) } : {}) },
  });
};

const runNoteGet = async (input: z.infer<typeof NoteGetInputSchema>, context: CapabilityExecutionContext) => {
  const resolved = await requireNote(input.noteId, context);
  if (!resolved.ok) return resolved;
  const note = await noteStore.getWithContent({ id: input.noteId });
  if (!note) return fail(err.notFound("Note"));
  const content = note.contentMd ?? "";
  if (input.contentOffset > content.length) return fail(err.badInput("contentOffset is outside the note"));
  const end = Math.min(content.length, input.contentOffset + input.contentLimit);
  const blocks = summarizeNoteEditBlocks(content);
  const tags = noteTags.extractTags(content);
  return ok({
    data: {
      ...mapNote(note),
      content: content.slice(input.contentOffset, end),
      contentOffset: input.contentOffset,
      contentLength: content.length,
      contentHash: noteContentHash(content),
      contentComplete: end >= content.length,
      nextContentOffset: end < content.length ? end : null,
      lineCount: content.split("\n").length,
      tags: tags.slice(0, 500),
      tagsTruncated: tags.length > 500,
      blocks: blocks.slice(0, 500),
      blocksTruncated: blocks.length > 500,
    },
    refs: [
      { type: "notebooks.note", id: note.id },
      { type: "notebooks.notebook", id: note.notebookId },
    ],
    links: [{ rel: "open" as const, href: noteHref(resolved.data.notebook, note) }],
  });
};

const runNoteLinks = async (input: z.infer<typeof NoteLinksInputSchema>, context: CapabilityExecutionContext) => {
  const cursor = decodeNotebookCapabilityCursor(input.cursor);
  if (!cursor.ok) return cursor;
  const resolved = await requireNote(input.noteId, context);
  if (!resolved.ok) return resolved;
  const scope = scopedNotebookId(context, "read");
  if (!scope.ok) return scope;
  const rows = await noteLinks.listNoteRelations({
    noteId: input.noteId,
    ...principalIds(context),
    boundNotebookId: scope.data,
    direction: input.direction,
    pagination: { limit: input.limit + 1, offset: (cursor.data - 1) * input.limit },
  });
  const hasMore = rows.length > input.limit;
  const data = rows.slice(0, input.limit);
  return ok({
    data,
    page: { hasMore, ...(hasMore ? { nextCursor: encodePageCursor(cursor.data + 1) } : {}) },
    refs: data.map((entry) => ({ type: "notebooks.note", id: entry.noteId })),
  });
};

const runTagList = async (input: z.infer<typeof TagListInputSchema>, context: CapabilityExecutionContext) => {
  const cursor = decodeNotebookCapabilityCursor(input.cursor);
  if (!cursor.ok) return cursor;
  const access = await requireNotebook(input.notebookId, context);
  if (!access.ok) return access;
  const rows = await noteTags.listForNotebook({
    notebookId: input.notebookId,
    pagination: { limit: input.limit + 1, offset: (cursor.data - 1) * input.limit },
  });
  const hasMore = rows.length > input.limit;
  return ok({
    data: rows.slice(0, input.limit),
    page: { hasMore, ...(hasMore ? { nextCursor: encodePageCursor(cursor.data + 1) } : {}) },
  });
};

const runTagNotes = async (input: z.infer<typeof TagNotesInputSchema>, context: CapabilityExecutionContext) => {
  const cursor = decodeNotebookCapabilityCursor(input.cursor);
  if (!cursor.ok) return cursor;
  const access = await requireNotebook(input.notebookId, context);
  if (!access.ok) return access;
  const result = await noteTags.listNotesForTag({
    notebookId: input.notebookId,
    tag: input.tag,
    search: input.query,
    pagination: { limit: input.limit, offset: (cursor.data - 1) * input.limit },
  });
  const hasMore = cursor.data * input.limit < result.total;
  return ok({
    data: result.items,
    page: { hasMore, ...(hasMore ? { nextCursor: encodePageCursor(cursor.data + 1) } : {}) },
    refs: result.items.map((note) => ({ type: "notebooks.note", id: note.id })),
  });
};

const capabilityAuditActor = (context: CapabilityExecutionContext): AuditActor =>
  context.actor.kind === "user"
    ? {
        userId: context.actor.user.id,
        uid: context.actor.user.uid,
        provider: context.actor.user.provider,
        roles: context.actor.user.roles,
      }
    : {
        uid: `service-account:${context.actor.serviceAccount.id}`,
        provider: "service_account",
        roles: context.actor.scopes,
      };

const actionAudit = (context: CapabilityExecutionContext, actionId: string, targetType: string, targetId: string) => ({
  action: `notebooks.capability.${actionId}`,
  actor: capabilityAuditActor(context),
  target: { type: targetType, id: targetId },
  metadata: { capability: `notebooks.${actionId}` },
});

const audited = async <T>(
  params: ReturnType<typeof actionAudit>,
  operation: () => Promise<CapabilityInvocationResult<T>>,
): Promise<CapabilityInvocationResult<T>> => {
  const result = await operation();
  return result.ok ? audit.recordResultAfterSideEffect({ ...params, result }) : audit.recordResult({ ...params, result });
};

const mutationError = <T>(result: Exclude<MutationResult<T>, { ok: true }>) => {
  if (result.status === 403) return fail(err.forbidden(result.error));
  if (result.status === 404) return fail(err.notFound(result.error.replace(/ not found.*$/i, "")));
  if (result.status === 409) return fail(err.conflict(result.error));
  if (result.status === 500) return fail(err.internal(result.error));
  return fail(err.badInput(result.error));
};

const noteMutationResult = (result: MutationResult<Note>, notebook: Notebook) => {
  if (!result.ok) return mutationError(result);
  return ok({
    data: mapNote(result.data),
    refs: [
      { type: "notebooks.note", id: result.data.id },
      { type: "notebooks.notebook", id: result.data.notebookId },
    ],
    links: [{ rel: "open" as const, href: noteHref(notebook, result.data) }],
  });
};

const runNoteCreate = async (input: z.infer<typeof NoteCreateInputSchema>, context: CapabilityExecutionContext) =>
  audited(actionAudit(context, "note.create", "notebook", input.notebookId), async () => {
    const access = await requireNotebook(input.notebookId, context, "write");
    if (!access.ok) return access;
    return noteMutationResult(
      await noteStore.create({
        data: {
          notebookId: input.notebookId,
          parentId: input.parentId,
          position: input.position,
          contentMd: input.content,
        },
        creatorId: context.user?.id ?? null,
      }),
      access.data.notebook,
    );
  });

const runNoteEdit = async (input: z.infer<typeof NoteEditInputSchema>, context: CapabilityExecutionContext) =>
  audited(actionAudit(context, "note.edit", "note", input.noteId), async () => {
    const resolved = await requireNote(input.noteId, context, "write");
    if (!resolved.ok) return resolved;
    const { noteId, ...data } = input;
    const result = await noteStore.editContent({ noteId, data, createdBy: context.user?.id ?? null });
    if (!result.ok) return mutationError(result);
    return ok({
      data: {
        note: mapNote(result.data.note),
        changed: result.data.changed,
        beforeHash: result.data.beforeHash,
        afterHash: result.data.afterHash,
        blocks: result.data.blocks.slice(0, 500),
        blocksTruncated: result.data.blocks.length > 500,
      },
      refs: [
        { type: "notebooks.note", id: result.data.note.id },
        { type: "notebooks.notebook", id: result.data.note.notebookId },
      ],
      links: [{ rel: "open" as const, href: noteHref(resolved.data.notebook, result.data.note) }],
    });
  });

const runNoteMove = async (input: z.infer<typeof NoteMoveInputSchema>, context: CapabilityExecutionContext) =>
  audited(actionAudit(context, "note.move", "note", input.noteId), async () => {
    const resolved = await requireNote(input.noteId, context, "write");
    if (!resolved.ok) return resolved;
    return noteMutationResult(
      await noteStore.move({ id: input.noteId, parentId: input.parentId, position: input.position }),
      resolved.data.notebook,
    );
  });

export const notebooksCapabilities = defineCapabilities({
  version: 1,
  types: {
    notebook: { title: "Notebook", description: "A permission-scoped collection of Markdown notes.", icon: "ti ti-notebook" },
    note: { title: "Note", description: "A Markdown note in an accessible notebook.", icon: "ti ti-file-text" },
  },
  queries: {
    "notebook.search": {
      title: "Search notebooks",
      description: "Find accessible notebooks by name or description.",
      input: UniversalSearchInputSchema,
      data: UniversalSearchDataSchema,
      universalSearch: {
        tags: [{ tag: "notebook", title: "Notebooks", description: "Show notebooks only.", aliases: ["notebooks"] }],
      },
      run: runNotebookSearch,
    },
    "note.search": {
      title: "Search notes",
      description: "Find accessible Markdown notes by title or content.",
      input: UniversalSearchInputSchema,
      data: UniversalSearchDataSchema,
      universalSearch: {
        tags: [{ tag: "note", title: "Notes", description: "Show notes only.", aliases: ["notes", "markdown"] }],
      },
      run: runNoteSearch,
    },
    "notebook.list": {
      title: "List notebooks",
      description: "List accessible notebooks with effective permission and bounded pagination.",
      input: NotebookListInputSchema,
      data: NotebookListDataSchema,
      run: runNotebookList,
    },
    "notebook.get": {
      title: "Get notebook",
      description: "Read one accessible notebook and its homepage reference.",
      input: NotebookGetInputSchema,
      data: NotebookDataSchema,
      run: runNotebookGet,
    },
    "note.tree": {
      title: "List note tree",
      description: "Traverse a large notebook as a compact flat adjacency index without loading Markdown.",
      input: NoteTreeInputSchema,
      data: NoteTreeDataSchema,
      run: runNoteTree,
    },
    "note.get": {
      title: "Get note",
      description: "Read a bounded Markdown window plus hashes, tags, and named-block summaries.",
      input: NoteGetInputSchema,
      data: NoteDetailDataSchema,
      run: runNoteGet,
    },
    "note.links": {
      title: "List note links",
      description: "List bounded incoming and outgoing note links without revealing inaccessible targets.",
      input: NoteLinksInputSchema,
      data: NoteLinksDataSchema,
      run: runNoteLinks,
    },
    "tag.list": {
      title: "List notebook tags",
      description: "List the bounded tag vocabulary and note counts of one readable notebook.",
      input: TagListInputSchema,
      data: TagListDataSchema,
      run: runTagList,
    },
    "tag.notes": {
      title: "List notes by tag",
      description: "List a bounded page of notes carrying one dynamic notebook tag.",
      input: TagNotesInputSchema,
      data: TagNotesDataSchema,
      run: runTagNotes,
    },
  },
  actions: {
    "note.create": {
      title: "Create note",
      description: "Create one Markdown note in an explicitly selected writable notebook.",
      input: NoteCreateInputSchema,
      data: NoteSummaryDataSchema,
      destructive: false,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      target: { type: "notebook", inputField: "notebookId" },
      run: runNoteCreate,
    },
    "note.edit": {
      title: "Edit note",
      description: "Apply conflict-aware structural Markdown edits through the collaborative note service.",
      input: NoteEditInputSchema,
      data: NoteEditDataSchema,
      destructive: false,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      target: { type: "note", inputField: "noteId" },
      run: runNoteEdit,
    },
    "note.move": {
      title: "Move note",
      description: "Move one note inside its notebook while rejecting invalid parents and cycles.",
      input: NoteMoveInputSchema,
      data: NoteSummaryDataSchema,
      destructive: false,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      target: { type: "note", inputField: "noteId" },
      run: runNoteMove,
    },
  },
});

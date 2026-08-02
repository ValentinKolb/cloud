import { createHash } from "node:crypto";
import { err, fail, ok, type Paginated, type Result } from "@k2b/stdlib";
import {
  type CapabilityExecutionContext,
  type CapabilityInvocationResult,
  type CapabilityResult,
  type CloudResourceView,
  defineCapabilities,
  UniversalSearchDataSchema,
  type UniversalSearchInput,
  UniversalSearchInputSchema,
} from "@valentinkolb/cloud/contracts";
import { hasPermission, type PermissionLevel } from "@valentinkolb/cloud/server";
import { type AuditActor, audit } from "@valentinkolb/cloud/services";
import type { z } from "zod";
import {
  CalendarDestinationListDataSchema,
  CalendarDestinationListInputSchema,
  CalendarInvitationImportCapabilityDataSchema,
  CalendarInvitationImportCapabilityInputSchema,
  CalendarInvitationPreviewCapabilityDataSchema,
  CalendarInvitationPreviewCapabilityInputSchema,
  CalendarInvitationResponseCommitCapabilityDataSchema,
  CalendarInvitationResponseCommitCapabilityInputSchema,
  CalendarInvitationResponsePrepareDataSchema,
  CalendarInvitationResponsePrepareInputSchema,
  CommentCreateInputSchema,
  CommentDataSchema,
  CommentDeleteDataSchema,
  CommentDeleteInputSchema,
  CommentGetInputSchema,
  CommentListDataSchema,
  CommentListInputSchema,
  CommentUpdateInputSchema,
  EventCreateInputSchema,
  EventDataSchema,
  EventInvitationCommitDataSchema,
  EventInvitationCommitInputSchema,
  EventInvitationPrepareDataSchema,
  EventInvitationPrepareInputSchema,
  EventListDataSchema,
  EventListInputSchema,
  EventUpdateInputSchema,
  ItemDataSchema,
  ItemDeleteDataSchema,
  ItemDeleteInputSchema,
  ItemGetInputSchema,
  SpaceDetailDataSchema,
  SpaceGetInputSchema,
  SpaceListDataSchema,
  SpaceListInputSchema,
  TaskCreateInputSchema,
  TaskDataSchema,
  TaskListDataSchema,
  TaskListInputSchema,
  TaskSetCompletedInputSchema,
  TaskUpdateInputSchema,
} from "./capability-contracts";
import type { MutationResult, SpaceComment, SpaceItem } from "./contracts";
import { buildSpaceItemHref } from "./routes";
import type { ItemAcrossKind, SpaceWithPermission } from "./service";
import { spacesService } from "./service";
import { isSpaceResourceId, resolveSpaceApiKeyPermission, SPACE_RESOURCE_TYPE, SPACES_APP_ID } from "./service/access";

const encodeCursor = (page: number): string => Buffer.from(JSON.stringify({ v: 1, page }), "utf8").toString("base64url");

const stableUuid = (value: string): string => {
  const hex = createHash("sha256").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

export const decodeSpacesCapabilityCursor = (cursor: string | undefined): Result<number> => {
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

const pageResult = <T>(page: Paginated<unknown>, data: T, refs?: CapabilityResult<T>["refs"]): CapabilityInvocationResult<T> =>
  ok({
    data,
    ...(refs ? { refs } : {}),
    page: { hasMore: page.hasNext, ...(page.hasNext ? { nextCursor: encodeCursor(page.page + 1) } : {}) },
  });

const permissionFromScopes = (scopes: string[]): PermissionLevel => resolveSpaceApiKeyPermission("admin", scopes);

const scopedSpaceId = (context: CapabilityExecutionContext, required: PermissionLevel): Result<string | null> => {
  if (context.actor.kind === "user") {
    return context.accessSubject.type === "user" ? ok(null) : fail(err.forbidden("Access denied"));
  }
  const account = context.actor.serviceAccount;
  if (account.kind === "user_delegated") {
    return context.accessSubject.type === "user" && context.user ? ok(null) : fail(err.forbidden("Access denied"));
  }
  if (
    account.appId !== SPACES_APP_ID ||
    account.resourceType !== SPACE_RESOURCE_TYPE ||
    !isSpaceResourceId(account.resourceId) ||
    context.accessSubject.type !== "service_account" ||
    !hasPermission(permissionFromScopes(context.actor.scopes), required)
  ) {
    return fail(err.forbidden("Access denied"));
  }
  return ok(account.resourceId);
};

const effectivePermission = (permission: Exclude<PermissionLevel, "none">, context: CapabilityExecutionContext) =>
  context.actor.kind === "service_account" && context.actor.serviceAccount.kind === "resource_bound"
    ? resolveSpaceApiKeyPermission(permission, context.actor.scopes)
    : permission;

const requireSpace = async (spaceId: string, context: CapabilityExecutionContext, required: PermissionLevel = "read") => {
  const scope = scopedSpaceId(context, required);
  if (!scope.ok) return scope;
  if (scope.data && scope.data !== spaceId) return fail(err.notFound("Space"));
  const space = await spacesService.space.get({ id: spaceId });
  if (!space) return fail(err.notFound("Space"));
  const granted = await spacesService.space.permission.get({ spaceId, subject: context.accessSubject });
  const permission = granted === "none" ? "none" : effectivePermission(granted, context);
  return hasPermission(permission, required) ? ok({ space, permission }) : fail(err.notFound("Space"));
};

const requireItem = async (itemId: string, context: CapabilityExecutionContext, required: PermissionLevel = "read") => {
  const item = await spacesService.item.get({ id: itemId });
  if (!item) return fail(err.notFound("Item"));
  const access = await requireSpace(item.spaceId, context, required);
  return access.ok ? ok({ item, permission: access.data.permission }) : fail(err.notFound("Item"));
};

const isEvent = (item: SpaceItem): item is SpaceItem & { startsAt: string; endsAt: string } => Boolean(item.startsAt && item.endsAt);

const mapRelations = (item: SpaceItem) => ({
  assignees: (item.assignees ?? []).slice(0, 100).map((entry) => ({ id: entry.id, displayName: entry.displayName })),
  tags: (item.tags ?? []).slice(0, 100).map((entry) => ({ id: entry.id, name: entry.name, color: entry.color })),
  relationsTruncated: (item.assignees?.length ?? 0) > 100 || (item.tags?.length ?? 0) > 100,
});

const mapTask = (item: SpaceItem) => ({
  kind: "task" as const,
  id: item.id,
  spaceId: item.spaceId,
  columnId: item.columnId,
  title: item.title,
  description: item.description,
  deadline: item.deadline,
  priority: item.priority,
  completedAt: item.completedAt,
  ...mapRelations(item),
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const mapEvent = (item: SpaceItem & { startsAt: string; endsAt: string }) => ({
  kind: "event" as const,
  id: item.id,
  spaceId: item.spaceId,
  columnId: item.columnId,
  title: item.title,
  description: item.description,
  location: item.location,
  url: item.url,
  startsAt: item.startsAt,
  endsAt: item.endsAt,
  allDay: item.allDay,
  recurrence: item.recurrence ? { ...item.recurrence, exdate: item.recurrence.exdate.slice(0, 1000) } : null,
  recurrenceExceptionsTruncated: (item.recurrence?.exdate.length ?? 0) > 1000,
  completedAt: item.completedAt,
  ...mapRelations(item),
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const mapItem = (item: SpaceItem) => (isEvent(item) ? mapEvent(item) : mapTask(item));

const mapComment = (comment: SpaceComment) => ({
  id: comment.id,
  itemId: comment.itemId,
  recurrenceId: comment.recurrenceId,
  userId: comment.userId,
  userName: comment.userName,
  content: comment.content,
  createdAt: comment.createdAt,
  updatedAt: comment.updatedAt,
  canDelete: comment.canDelete,
});

const mapSpace = (space: SpaceWithPermission, context: CapabilityExecutionContext) => ({
  id: space.id,
  name: space.name,
  description: space.description,
  color: space.color,
  permission: effectivePermission(space.permission, context) as "read" | "write" | "admin",
  createdAt: space.createdAt,
  updatedAt: space.updatedAt,
});

const runSearch = async (input: UniversalSearchInput, context: CapabilityExecutionContext) => {
  const scope = scopedSpaceId(context, "read");
  if (!scope.ok) return ok({ data: [] });

  const tags = new Set(input.tags);
  const wantsSpaces = tags.has("space") || tags.has("spaces");
  const wantsTasks = tags.has("task") || tags.has("tasks") || tags.has("todo") || tags.has("kanban");
  const wantsEvents = tags.has("event") || tags.has("events") || tags.has("calendar");
  const itemFilterActive = tags.has("todo") || tags.has("urgent");
  const kindActive = wantsSpaces || wantsTasks || wantsEvents;
  const includeSpaces = !kindActive && !itemFilterActive ? true : wantsSpaces;
  const includeAllItemKinds = !kindActive || (itemFilterActive && !wantsTasks && !wantsEvents);
  const includeTasks = includeAllItemKinds || wantsTasks;
  const includeEvents = includeAllItemKinds || wantsEvents;
  if (!includeSpaces && !includeTasks && !includeEvents) return ok({ data: [] });

  let kinds: ItemAcrossKind = "all";
  if (includeTasks && !includeEvents) kinds = "task";
  else if (includeEvents && !includeTasks) kinds = "event";

  const [spacesPage, itemHits] = await Promise.all([
    includeSpaces
      ? spacesService.space.listWithPermission({
          subject: context.accessSubject,
          boundSpaceId: scope.data,
          query: input.query,
          pagination: { page: 1, perPage: input.limit },
        })
      : Promise.resolve({ items: [], page: 1, perPage: 0, total: 0, hasNext: false }),
    includeTasks || includeEvents
      ? spacesService.item.searchAcross({
          subject: context.accessSubject,
          boundSpaceId: scope.data,
          query: input.query,
          kinds,
          status: tags.has("todo") ? "open" : undefined,
          priority: tags.has("urgent") ? ["urgent"] : undefined,
          limit: input.limit,
        })
      : Promise.resolve([]),
  ]);

  const spaceItems: CloudResourceView[] = spacesPage.items.map((entry) => ({
    ref: { type: "spaces.space", id: entry.id },
    title: entry.name,
    preview: entry.description ?? undefined,
    icon: "ti ti-layout-kanban",
    priority: 7,
    metadata: [{ label: "Type", value: "Space" }],
    links: [{ rel: "open", href: `/app/spaces/${entry.id}` }],
  }));
  const itemItems: CloudResourceView[] = itemHits.map(({ item, space }) => ({
    ref: { type: "spaces.item", id: item.id },
    title: item.title,
    preview: item.description ?? undefined,
    icon: isEvent(item) ? "ti ti-calendar-event" : "ti ti-checkbox",
    priority: 8,
    metadata: [
      { label: "Type", value: "Space Item" },
      { label: "Space", value: space.name },
      { label: "Item Kind", value: isEvent(item) ? "Event" : "Task" },
    ],
    links: [{ rel: "open", href: buildSpaceItemHref(space.id, item.id) }],
  }));
  return ok({ data: [...itemItems, ...spaceItems].slice(0, input.limit) });
};

const runSpaceList = async (input: z.infer<typeof SpaceListInputSchema>, context: CapabilityExecutionContext) => {
  const cursor = decodeSpacesCapabilityCursor(input.cursor);
  if (!cursor.ok) return cursor;
  const scope = scopedSpaceId(context, input.minimumPermission);
  if (!scope.ok) return scope;
  const page = await spacesService.space.listWithPermission({
    subject: context.accessSubject,
    boundSpaceId: scope.data,
    requiredLevel: input.minimumPermission,
    query: input.query,
    pagination: { page: cursor.data, perPage: input.limit },
  });
  const data = page.items.map((space) => mapSpace(space, context));
  return pageResult(
    page,
    data,
    data.map((space) => ({ type: "spaces.space", id: space.id })),
  );
};

const runSpaceGet = async (input: z.infer<typeof SpaceGetInputSchema>, context: CapabilityExecutionContext) => {
  const access = await requireSpace(input.spaceId, context);
  if (!access.ok) return access;
  const detail = await spacesService.space.getDetail({ id: input.spaceId });
  if (!detail) return fail(err.notFound("Space"));
  return ok({
    data: {
      id: detail.id,
      name: detail.name,
      description: detail.description,
      color: detail.color,
      permission: access.data.permission as "read" | "write" | "admin",
      columns: detail.columns.slice(0, 100).map((column) => ({
        id: column.id,
        name: column.name,
        color: column.color,
        isDone: column.isDone,
      })),
      columnsTruncated: detail.columns.length > 100,
      tags: detail.tags.slice(0, 100).map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
      tagsTruncated: detail.tags.length > 100,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
    },
    refs: [{ type: "spaces.space", id: detail.id }],
    links: [{ rel: "open" as const, href: `/app/spaces/${detail.id}` }],
  });
};

type ItemListInput = z.infer<typeof TaskListInputSchema> | z.infer<typeof EventListInputSchema>;

const runItemList = async (input: ItemListInput, context: CapabilityExecutionContext, kind: "task" | "event") => {
  const cursor = decodeSpacesCapabilityCursor(input.cursor);
  if (!cursor.ok) return cursor;
  if (input.assignedTo === "me" && !context.user) return fail(err.forbidden("The me filter requires a user-backed actor"));
  const access = await requireSpace(input.spaceId, context);
  if (!access.ok) return access;
  const page = await spacesService.item.listFiltered({
    spaceId: input.spaceId,
    currentUserId: context.user?.id,
    filter: {
      type: kind,
      status: input.status,
      priority: input.priority,
      columnIds: input.columnIds,
      tagIds: input.tagIds,
      assigneeIds: input.assigneeIds,
      assignedTo: input.assignedTo,
      deadlineFilter: "all",
      search: input.query,
      sort: input.sort,
      sortDesc: input.sortDesc,
      groupBy: "none",
      page: cursor.data,
      pageSize: input.limit,
    },
  });
  const items = kind === "event" ? page.items.filter(isEvent).map(mapEvent) : page.items.filter((item) => !isEvent(item)).map(mapTask);
  return pageResult(
    { items: page.items, page: page.page, perPage: page.pageSize, total: page.total, hasNext: page.page < page.totalPages },
    items,
    items.map((item) => ({ type: "spaces.item", id: item.id })),
  );
};

const runItemGet = async (input: z.infer<typeof ItemGetInputSchema>, context: CapabilityExecutionContext) => {
  const resolved = await requireItem(input.itemId, context);
  if (!resolved.ok) return resolved;
  return ok({
    data: mapItem(resolved.data.item),
    refs: [{ type: "spaces.item", id: resolved.data.item.id }],
    links: [{ rel: "open" as const, href: buildSpaceItemHref(resolved.data.item.spaceId, resolved.data.item.id) }],
  });
};

const runCommentList = async (input: z.infer<typeof CommentListInputSchema>, context: CapabilityExecutionContext) => {
  const cursor = decodeSpacesCapabilityCursor(input.cursor);
  if (!cursor.ok) return cursor;
  const resolved = await requireItem(input.itemId, context);
  if (!resolved.ok) return resolved;
  const page = await spacesService.comment.list({
    itemId: input.itemId,
    recurrenceId: input.recurrenceId,
    viewerUserId: context.user?.id ?? null,
    pagination: { page: cursor.data, perPage: input.limit },
    filter: { query: input.query },
  });
  const data = page.items.map(mapComment);
  return pageResult(
    page,
    data,
    data.map((comment) => ({ type: "spaces.comment", id: comment.id })),
  );
};

const resolveComment = async (commentId: string, context: CapabilityExecutionContext, required: PermissionLevel = "read") => {
  const comment = await spacesService.comment.get({ id: commentId, viewerUserId: context.user?.id ?? null });
  if (!comment) return fail(err.notFound("Comment"));
  const item = await requireItem(comment.itemId, context, required);
  return item.ok ? ok({ comment, item: item.data.item }) : fail(err.notFound("Comment"));
};

const runCommentGet = async (input: z.infer<typeof CommentGetInputSchema>, context: CapabilityExecutionContext) => {
  const resolved = await resolveComment(input.commentId, context);
  if (!resolved.ok) return resolved;
  return ok({
    data: mapComment(resolved.data.comment),
    refs: [
      { type: "spaces.comment", id: resolved.data.comment.id },
      { type: "spaces.item", id: resolved.data.item.id },
    ],
    links: [{ rel: "open" as const, href: buildSpaceItemHref(resolved.data.item.spaceId, resolved.data.item.id) }],
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
  action: `spaces.capability.${actionId}`,
  actor: capabilityAuditActor(context),
  target: { type: targetType, id: targetId },
  metadata: { capability: `spaces.${actionId}` },
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
  if (result.status === 404) return fail(err.notFound(result.error.replace(/ not found$/i, "")));
  if (result.status === 409) return fail(err.conflict(result.error));
  if (result.status === 500) return fail(err.internal(result.error));
  return fail(err.badInput(result.error));
};

const itemMutationResult = (result: MutationResult<SpaceItem>) => {
  if (!result.ok) return mutationError(result);
  return ok({
    data: mapItem(result.data),
    refs: [{ type: "spaces.item", id: result.data.id }],
    links: [{ rel: "open" as const, href: buildSpaceItemHref(result.data.spaceId, result.data.id) }],
  });
};

const commentMutationResult = (result: MutationResult<SpaceComment>, item: SpaceItem) => {
  if (!result.ok) return mutationError(result);
  return ok({
    data: mapComment(result.data),
    refs: [
      { type: "spaces.comment", id: result.data.id },
      { type: "spaces.item", id: item.id },
    ],
    links: [{ rel: "open" as const, href: buildSpaceItemHref(item.spaceId, item.id) }],
  });
};

const runTaskCreate = async (input: z.infer<typeof TaskCreateInputSchema>, context: CapabilityExecutionContext) =>
  audited(actionAudit(context, "task.create", "space", input.spaceId), async () => {
    const access = await requireSpace(input.spaceId, context, "write");
    if (!access.ok) return access;
    const { spaceId, ...data } = input;
    return itemMutationResult(await spacesService.item.create({ spaceId, data, createdBy: context.user?.id ?? null }));
  });

const runTaskUpdate = async (input: z.infer<typeof TaskUpdateInputSchema>, context: CapabilityExecutionContext) =>
  audited(actionAudit(context, "task.update", "space_item", input.itemId), async () => {
    const resolved = await requireItem(input.itemId, context, "write");
    if (!resolved.ok) return resolved;
    if (isEvent(resolved.data.item)) return fail(err.badInput("Item is not a task"));
    const { itemId, ...data } = input;
    return itemMutationResult(await spacesService.item.update({ id: itemId, data }));
  });

const runTaskSetCompleted = async (input: z.infer<typeof TaskSetCompletedInputSchema>, context: CapabilityExecutionContext) =>
  audited(actionAudit(context, "task.set-completed", "space_item", input.itemId), async () => {
    const resolved = await requireItem(input.itemId, context, "write");
    if (!resolved.ok) return resolved;
    if (isEvent(resolved.data.item)) return fail(err.badInput("Item is not a task"));
    return itemMutationResult(await spacesService.item.setCompleted({ id: input.itemId, completed: input.completed }));
  });

const runEventCreate = async (input: z.infer<typeof EventCreateInputSchema>, context: CapabilityExecutionContext) =>
  audited(actionAudit(context, "event.create", "space", input.spaceId), async () => {
    const access = await requireSpace(input.spaceId, context, "write");
    if (!access.ok) return access;
    const { spaceId, ...data } = input;
    return itemMutationResult(await spacesService.item.create({ spaceId, data, createdBy: context.user?.id ?? null }));
  });

const runEventUpdate = async (input: z.infer<typeof EventUpdateInputSchema>, context: CapabilityExecutionContext) =>
  audited(actionAudit(context, "event.update", "space_item", input.itemId), async () => {
    const resolved = await requireItem(input.itemId, context, "write");
    if (!resolved.ok) return resolved;
    if (!isEvent(resolved.data.item)) return fail(err.badInput("Item is not an event"));
    const { itemId, ...data } = input;
    return itemMutationResult(await spacesService.item.update({ id: itemId, data }));
  });

const runItemDelete = async (input: z.infer<typeof ItemDeleteInputSchema>, context: CapabilityExecutionContext) =>
  audited(actionAudit(context, "item.delete", "space_item", input.itemId), async () => {
    const resolved = await requireItem(input.itemId, context, "write");
    if (!resolved.ok) return resolved;
    const result = await spacesService.item.remove({ id: input.itemId });
    return result.ok ? ok({ data: { itemId: input.itemId, deleted: true as const } }) : mutationError(result);
  });

const runCommentCreate = async (input: z.infer<typeof CommentCreateInputSchema>, context: CapabilityExecutionContext) =>
  audited(actionAudit(context, "comment.create", "space_item", input.itemId), async () => {
    if (!context.user) return fail(err.forbidden("Comments require a user-backed actor"));
    const resolved = await requireItem(input.itemId, context, "write");
    if (!resolved.ok) return resolved;
    return commentMutationResult(
      await spacesService.comment.create({
        itemId: input.itemId,
        recurrenceId: input.recurrenceId,
        userId: context.user.id,
        content: input.content,
      }),
      resolved.data.item,
    );
  });

const runCommentUpdate = async (input: z.infer<typeof CommentUpdateInputSchema>, context: CapabilityExecutionContext) =>
  audited(actionAudit(context, "comment.update", "space_comment", input.commentId), async () => {
    if (!context.user) return fail(err.forbidden("Comments require a user-backed actor"));
    const resolved = await resolveComment(input.commentId, context, "write");
    if (!resolved.ok) return resolved;
    return commentMutationResult(
      await spacesService.comment.update({ id: input.commentId, content: input.content, userId: context.user.id }),
      resolved.data.item,
    );
  });

const runCommentDelete = async (input: z.infer<typeof CommentDeleteInputSchema>, context: CapabilityExecutionContext) =>
  audited(actionAudit(context, "comment.delete", "space_comment", input.commentId), async () => {
    if (!context.user) return fail(err.forbidden("Comments require a user-backed actor"));
    const resolved = await resolveComment(input.commentId, context, "write");
    if (!resolved.ok) return resolved;
    const result = await spacesService.comment.remove({ id: input.commentId, userId: context.user.id });
    return result.ok ? ok({ data: { commentId: input.commentId, deleted: true as const } }) : mutationError(result);
  });

const runCalendarInvitationPreview = async (
  input: z.infer<typeof CalendarInvitationPreviewCapabilityInputSchema>,
  context: CapabilityExecutionContext,
) => {
  const result = await spacesService.calendarInvitations.previewCalendarInvitation(input);
  if (!result.ok || !result.data.existing) return result.ok ? ok({ data: result.data }) : result;
  const access = await requireSpace(result.data.existing.spaceId, context, "read");
  return access.ok ? ok({ data: result.data }) : ok({ data: { ...result.data, existing: null, response: null } });
};

const runCalendarInvitationResponsePrepare = async (
  input: z.infer<typeof CalendarInvitationResponsePrepareInputSchema>,
  context: CapabilityExecutionContext,
) => {
  const result = await spacesService.calendarInvitations.prepareCalendarResponse({ input, subject: context.accessSubject });
  return result.ok ? ok({ data: result.data }) : result;
};

const calendarDestinationContext = async (context: CapabilityExecutionContext) => {
  const scope = scopedSpaceId(context, "write");
  if (!scope.ok) return scope;
  const page = await spacesService.space.list({
    subject: context.accessSubject,
    boundSpaceId: scope.data,
    requiredLevel: "write",
    pagination: { page: 1, perPage: 100 },
  });
  return ok({
    data: page.items.map((space) => ({ id: space.id, name: space.name, color: space.color })),
  });
};

const runCalendarInvitationImport = async (
  input: z.infer<typeof CalendarInvitationImportCapabilityInputSchema>,
  context: CapabilityExecutionContext,
) =>
  audited(actionAudit(context, "calendar-invitation.import", "space", input.spaceId), async () => {
    if (!context.user) return fail(err.forbidden("Importing an invitation requires a user-backed actor"));
    const result = await spacesService.calendarInvitations.importCalendarInvitation({
      input,
      user: context.user,
      subject: context.accessSubject,
    });
    return result.ok
      ? ok({
          data: result.data,
          refs: [{ type: "spaces.item", id: result.data.itemId }],
          links: [{ rel: "open", href: result.data.href }],
        })
      : result;
  });

const runCalendarInvitationResponseCommit = async (
  input: z.infer<typeof CalendarInvitationResponseCommitCapabilityInputSchema>,
  context: CapabilityExecutionContext,
) =>
  audited(actionAudit(context, "calendar-invitation.response.commit", "mail_draft", input.draftId), async () => {
    const result = await spacesService.calendarInvitations.commitCalendarResponse({ input, subject: context.accessSubject });
    return result.ok ? ok({ data: result.data, refs: [{ type: "mail.draft", id: input.draftId }] }) : result;
  });

const runEventInvitationPrepare = async (
  input: z.infer<typeof EventInvitationPrepareInputSchema>,
  context: CapabilityExecutionContext,
) =>
  audited(actionAudit(context, "event.invitation.prepare", "space_item", input.itemId), async () => {
    if (!context.idempotencyKey) return fail(err.badInput("An idempotency key is required"));
    const resolved = await requireItem(input.itemId, context, "write");
    if (!resolved.ok) return resolved;
    if (!isEvent(resolved.data.item)) return fail(err.badInput("Item is not an event"));
    const result = await spacesService.calendarInvitations.prepareEventInvitationAttachment({
      spaceId: resolved.data.item.spaceId,
      ...input,
      deliveryId: stableUuid(context.idempotencyKey),
      subject: context.accessSubject,
    });
    return result.ok
      ? ok({
          data: result.data,
          refs: [
            { type: "spaces.item", id: result.data.itemId },
            { type: "mail.draft", id: result.data.draftId },
          ],
        })
      : result;
  });

const runEventInvitationCommit = async (
  input: z.infer<typeof EventInvitationCommitInputSchema>,
  context: CapabilityExecutionContext,
) =>
  audited(actionAudit(context, "event.invitation.commit", "calendar_invitation_delivery", input.deliveryId), async () => {
    const result = await spacesService.calendarInvitations.commitEventInvitationAttachment({
      deliveryId: input.deliveryId,
      subject: context.accessSubject,
    });
    return result.ok
      ? ok({
          data: result.data,
          refs: [
            { type: "spaces.item", id: result.data.itemId },
            { type: "mail.draft", id: result.data.draftId },
          ],
        })
      : result;
  });

export const spacesCapabilities = defineCapabilities({
  version: 1,
  types: {
    space: { title: "Space", description: "A permission-scoped collaboration space.", icon: "ti ti-layout-kanban" },
    item: { title: "Space item", description: "A task or event inside a space.", icon: "ti ti-checkbox" },
    comment: { title: "Space comment", description: "A user-authored comment attached to a Space item.", icon: "ti ti-message" },
  },
  queries: {
    search: {
      title: "Search spaces",
      description: "Find accessible spaces, tasks, and events with optional workflow facets.",
      input: UniversalSearchInputSchema,
      data: UniversalSearchDataSchema,
      openWorld: false,
      universalSearch: {
        tags: [
          { tag: "space", title: "Spaces", description: "Show spaces only.", aliases: ["spaces"] },
          { tag: "task", title: "Tasks", description: "Show task items only.", aliases: ["tasks", "kanban"] },
          { tag: "todo", title: "Open tasks", description: "Show open tasks only." },
          { tag: "event", title: "Events", description: "Show items with a time range.", aliases: ["events", "calendar"] },
          { tag: "urgent", title: "Urgent", description: "Show urgent items only." },
        ],
      },
      run: runSearch,
    },
    "space.list": {
      title: "List spaces",
      description: "List accessible Spaces with effective permission and bounded SQL pagination.",
      input: SpaceListInputSchema,
      data: SpaceListDataSchema,
      openWorld: false,
      run: runSpaceList,
    },
    "space.get": {
      title: "Get space",
      description: "Read one accessible Space plus its bounded column and tag vocabulary.",
      input: SpaceGetInputSchema,
      data: SpaceDetailDataSchema,
      openWorld: false,
      run: runSpaceGet,
    },
    "task.list": {
      title: "List tasks",
      description: "List task-shaped items in one readable Space with bounded filters and pagination.",
      input: TaskListInputSchema,
      data: TaskListDataSchema,
      openWorld: false,
      run: (input, context) => runItemList(input, context, "task"),
    },
    "event.list": {
      title: "List events",
      description: "List event-shaped items in one readable Space with bounded filters and pagination.",
      input: EventListInputSchema,
      data: EventListDataSchema,
      openWorld: false,
      run: (input, context) => runItemList(input, context, "event"),
    },
    "item.get": {
      title: "Get Space item",
      description: "Read one task or event by stable item UUID with an explicit kind discriminator.",
      input: ItemGetInputSchema,
      data: ItemDataSchema,
      openWorld: false,
      run: runItemGet,
    },
    "comment.list": {
      title: "List comments",
      description: "List one bounded item or recurring-occurrence discussion after checking parent Space access.",
      input: CommentListInputSchema,
      data: CommentListDataSchema,
      openWorld: false,
      run: runCommentList,
    },
    "comment.get": {
      title: "Get comment",
      description: "Read one comment by stable UUID after checking its parent item and Space.",
      input: CommentGetInputSchema,
      data: CommentDataSchema,
      openWorld: false,
      run: runCommentGet,
    },
    "calendar-invitation.preview": {
      title: "Preview calendar invitation",
      description: "Parse a bounded iCalendar invitation and show any linked Space event visible to the actor.",
      input: CalendarInvitationPreviewCapabilityInputSchema,
      data: CalendarInvitationPreviewCapabilityDataSchema,
      openWorld: false,
      run: runCalendarInvitationPreview,
    },
    "calendar-destination.list": {
      title: "List calendar destinations",
      description: "List up to 100 writable Spaces that can receive a calendar invitation.",
      input: CalendarDestinationListInputSchema,
      data: CalendarDestinationListDataSchema,
      openWorld: false,
      run: (_input, context) => calendarDestinationContext(context),
    },
    "calendar-invitation.response.prepare": {
      title: "Prepare calendar response",
      description:
        "Prepare a standards-based response for an invitation already imported into a writable Space. Create the draft with mail.draft.create, then commit it.",
      input: CalendarInvitationResponsePrepareInputSchema,
      data: CalendarInvitationResponsePrepareDataSchema,
      openWorld: false,
      run: runCalendarInvitationResponsePrepare,
    },
  },
  actions: {
    "task.create": {
      title: "Create task",
      description: "Create one task in an explicitly selected writable Space and column.",
      input: TaskCreateInputSchema,
      data: TaskDataSchema,
      destructive: false,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      target: { type: "space", inputField: "spaceId" },
      run: runTaskCreate,
    },
    "task.update": {
      title: "Update task",
      description: "Update selected fields of an existing task without converting its item kind.",
      input: TaskUpdateInputSchema,
      data: TaskDataSchema,
      destructive: true,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      target: { type: "item", inputField: "itemId" },
      run: runTaskUpdate,
    },
    "task.set-completed": {
      title: "Set task completion",
      description: "Complete or reopen one task using the Space workflow columns.",
      input: TaskSetCompletedInputSchema,
      data: TaskDataSchema,
      destructive: true,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      target: { type: "item", inputField: "itemId" },
      run: runTaskSetCompleted,
    },
    "event.create": {
      title: "Create event",
      description: "Create one event with an explicit valid time range in a writable Space.",
      input: EventCreateInputSchema,
      data: EventDataSchema,
      destructive: false,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      target: { type: "space", inputField: "spaceId" },
      run: runEventCreate,
    },
    "event.update": {
      title: "Update event",
      description: "Update selected event fields without converting its item kind.",
      input: EventUpdateInputSchema,
      data: EventDataSchema,
      destructive: true,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      target: { type: "item", inputField: "itemId" },
      run: runEventUpdate,
    },
    "event.invitation.prepare": {
      title: "Prepare event invitation",
      description: "Prepare an idempotent iCalendar invitation for an existing Mail draft without sending it.",
      input: EventInvitationPrepareInputSchema,
      data: EventInvitationPrepareDataSchema,
      destructive: false,
      openWorld: false,
      approval: "once",
      idempotency: "required",
      target: { type: "item", inputField: "itemId" },
      run: runEventInvitationPrepare,
    },
    "event.invitation.commit": {
      title: "Commit event invitation",
      description: "Record that a prepared event invitation was attached to its authorized Mail draft.",
      input: EventInvitationCommitInputSchema,
      data: EventInvitationCommitDataSchema,
      destructive: true,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      run: runEventInvitationCommit,
    },
    "item.delete": {
      title: "Delete Space item",
      description: "Permanently delete one task or event from a writable Space.",
      input: ItemDeleteInputSchema,
      data: ItemDeleteDataSchema,
      destructive: true,
      openWorld: false,
      approval: "always",
      idempotency: "none",
      target: { type: "item", inputField: "itemId" },
      run: runItemDelete,
    },
    "comment.create": {
      title: "Create comment",
      description: "Add a user-authored comment to an item or recurring occurrence in a writable Space.",
      input: CommentCreateInputSchema,
      data: CommentDataSchema,
      destructive: false,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      target: { type: "item", inputField: "itemId" },
      run: runCommentCreate,
    },
    "comment.update": {
      title: "Update comment",
      description: "Update the current user's own comment in a writable Space.",
      input: CommentUpdateInputSchema,
      data: CommentDataSchema,
      destructive: true,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      target: { type: "comment", inputField: "commentId" },
      run: runCommentUpdate,
    },
    "comment.delete": {
      title: "Delete comment",
      description: "Delete the current user's own comment within the existing ten-minute window.",
      input: CommentDeleteInputSchema,
      data: CommentDeleteDataSchema,
      destructive: true,
      openWorld: false,
      approval: "always",
      idempotency: "none",
      target: { type: "comment", inputField: "commentId" },
      run: runCommentDelete,
    },
    "calendar-invitation.import": {
      title: "Import calendar invitation",
      description: "Idempotently create, update, or cancel the matching event in an explicitly selected writable Space.",
      input: CalendarInvitationImportCapabilityInputSchema,
      data: CalendarInvitationImportCapabilityDataSchema,
      destructive: true,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      target: { type: "space", inputField: "spaceId" },
      run: runCalendarInvitationImport,
    },
    "calendar-invitation.response.commit": {
      title: "Commit calendar response draft",
      description: "Record the mail draft created from calendar-invitation.response.prepare after mail.draft.create succeeds.",
      input: CalendarInvitationResponseCommitCapabilityInputSchema,
      data: CalendarInvitationResponseCommitCapabilityDataSchema,
      destructive: true,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      run: runCalendarInvitationResponseCommit,
    },
  },
});

import { ServiceAccountCredentialSchema } from "@valentinkolb/cloud/contracts";
import {
  type AccessSubject,
  type AuthContext,
  auth,
  getDateConfig,
  hasPermission,
  jsonResponse,
  rateLimit,
  requiresAuth,
  respond,
  updateAccess,
  v,
} from "@valentinkolb/cloud/server";
import { coreSettings } from "@valentinkolb/cloud/services";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { type Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import type { MutationResult, PermissionLevel, User } from "@/contracts";
import {
  AccessEntrySchema,
  CalendarItemSchema,
  CalendarQuerySchema,
  CreateColumnSchema,
  CreateCommentSchema,
  CreateItemSchema,
  CreateSpaceSchema,
  CreateTagSchema,
  ErrorResponseSchema,
  GrantAccessSchema,
  hasRole,
  ItemFilterSchema,
  ItemListResultSchema,
  MessageResponseSchema,
  MoveItemSchema,
  OverlapItemSchema,
  OverlapQuerySchema,
  ReorderColumnsSchema,
  SetCompletedSchema,
  SpaceAssignableUserSchema,
  SpaceColumnSchema,
  SpaceCommentSchema,
  SpaceDetailSchema,
  SpaceItemSchema,
  SpaceSchema,
  SpaceTagSchema,
  UpdateAccessSchema,
  UpdateColumnSchema,
  UpdateCommentSchema,
  UpdateItemSchema,
  UpdateSpaceSchema,
  UpdateTagSchema,
} from "@/contracts";
import { loadSpacesWorkspaceState } from "../frontend/[id]/_components/workspace/workspace-state";
import { parseSpacesWorkspaceHref } from "../frontend/[id]/_components/workspace/workspace-types";
import { spacesService } from "../service";
import { isSpaceResourceId, SPACE_RESOURCE_TYPE, SPACES_APP_ID } from "../service/access";
import { latestSpaceEventCursor, liveSpaceEvents } from "../service/events";

// ==========================
// Spaces API
// ==========================

const SpaceListSchema = z.array(SpaceSchema);
const SpaceItemListSchema = z.array(SpaceItemSchema);
const SpaceCommentListSchema = z.array(SpaceCommentSchema);
const SpaceAssignableUserListSchema = z.array(SpaceAssignableUserSchema);
const AssignableUsersQuerySchema = z.object({
  search: z.string().optional(),
  exclude_user_ids: z.string().optional(),
});

const SpaceApiKeySchema = ServiceAccountCredentialSchema.extend({
  permission: z.enum(["none", "read", "write", "admin"]),
});

const CreateSpaceApiKeySchema = z.object({
  name: z.string().trim().min(1).max(120),
  expiresAt: z.string().datetime().nullable().optional(),
  permission: z.enum(["read", "write", "admin"]).default("read"),
});

const CreateSpaceApiKeyResponseSchema = z.object({
  credential: SpaceApiKeySchema,
  token: z.string(),
});

const parseCsv = (value?: string) =>
  value
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean) ?? [];

const parseUuidCsv = (value: string | undefined, label: string): Result<string[]> => {
  const ids = parseCsv(value);
  if (ids.length === 0) return ok([]);
  const parsed = z.array(z.uuid()).safeParse(ids);
  if (!parsed.success) return fail(err.badInput(`Invalid ${label} query parameter.`));
  return ok(parsed.data);
};

const getUserBackedActor = (c: Context<AuthContext>): User | null => {
  const actor = c.get("actor");
  return actor.kind === "user" ? actor.user : actor.delegatedUser;
};

const requireUserBackedActor = (c: Context<AuthContext>): Result<User> => {
  const user = getUserBackedActor(c);
  if (!user) return fail(err.forbidden("This endpoint requires a user-backed actor"));
  return ok(user);
};

const PERMISSION_RANK: Record<PermissionLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
  admin: 3,
};

const permissionFromScopes = (scopes: string[]): PermissionLevel => {
  if (scopes.includes("admin")) return "admin";
  if (scopes.includes("write")) return "write";
  if (scopes.includes("read")) return "read";
  return "none";
};

const minPermission = (a: PermissionLevel, b: PermissionLevel): PermissionLevel => (PERMISSION_RANK[a] <= PERMISSION_RANK[b] ? a : b);

const getSpaceAccessSubject = (c: Context<AuthContext>) => {
  const user = getUserBackedActor(c);
  const accessSubject = c.get("accessSubject");
  const actor = c.get("actor");
  const serviceAccount = actor.kind === "service_account" ? actor.serviceAccount : null;
  return {
    user,
    subject: accessSubject,
    serviceAccount,
    serviceAccountScopes: actor.kind === "service_account" ? actor.scopes : [],
  };
};

type ScopedSpaceAccess = {
  subject: AccessSubject;
  boundSpaceId: string | null;
};

const getScopedSpaceAccess = (c: Context<AuthContext>): Result<ScopedSpaceAccess> => {
  const subject = getSpaceAccessSubject(c);

  if (subject.serviceAccount?.kind === "resource_bound") {
    if (
      subject.serviceAccount.appId !== SPACES_APP_ID ||
      subject.serviceAccount.resourceType !== SPACE_RESOURCE_TYPE ||
      !isSpaceResourceId(subject.serviceAccount.resourceId)
    ) {
      return fail(err.forbidden("Access denied"));
    }

    if (!hasPermission(permissionFromScopes(subject.serviceAccountScopes), "read")) {
      return fail(err.forbidden("Access denied"));
    }

    return ok({
      subject: subject.subject,
      boundSpaceId: subject.serviceAccount.resourceId,
    });
  }

  if (subject.subject.type !== "user") return fail(err.forbidden("Access denied"));

  return ok({
    subject: subject.subject,
    boundSpaceId: null,
  });
};

/**
 * Middleware to check space access with permission level.
 */
const checkSpaceAccess = async (c: Context<AuthContext>, spaceId: string, requiredLevel: PermissionLevel = "read") => {
  const subject = getSpaceAccessSubject(c);
  const space = await spacesService.space.get({ id: spaceId });

  if (!space) {
    return {
      space: null,
      permission: "none" as PermissionLevel,
      error: await respond(c, fail(err.notFound("Space"))),
    };
  }

  if (subject.user && hasRole(subject.user, "admin")) {
    return { space, permission: "admin" as PermissionLevel, user: subject.user };
  }

  if (
    subject.serviceAccount?.kind === "resource_bound" &&
    (subject.serviceAccount.appId !== SPACES_APP_ID ||
      subject.serviceAccount.resourceType !== SPACE_RESOURCE_TYPE ||
      subject.serviceAccount.resourceId !== spaceId)
  ) {
    return {
      space: null,
      permission: "none" as PermissionLevel,
      error: await respond(c, fail(err.forbidden("Access denied"))),
    };
  }

  let permission = await spacesService.space.permission.get({
    spaceId,
    subject: subject.subject,
  });

  if (subject.serviceAccount?.kind === "resource_bound") {
    permission = minPermission(permission, permissionFromScopes(subject.serviceAccountScopes));
  }

  if (!hasPermission(permission, requiredLevel)) {
    return {
      space: null,
      permission: "none" as PermissionLevel,
      error: await respond(c, fail(err.forbidden("Access denied"))),
    };
  }

  return { space, permission, user: subject.user };
};

/**
 * Wraps mutation results and returns a standardized message payload for API handlers.
 */
const respondMessage = async (c: Context, resultPromise: Promise<Result<void> | MutationResult<void>>, message: string) => {
  return respond(c, async () => {
    const result = await resultPromise;
    if (!result.ok) return result;
    return ok({ message });
  });
};

/**
 * Ensures an item exists and belongs to the requested space before mutation handlers run.
 */
const requireItemInSpace = async (spaceId: string, itemId: string) => {
  const item = await spacesService.item.get({ id: itemId });
  if (!item || item.spaceId !== spaceId) {
    return fail(err.notFound("Item"));
  }
  return ok(item);
};

const requireColumnInSpace = async (spaceId: string, columnId: string) => {
  const column = await spacesService.column.get({ id: columnId });
  if (!column || column.spaceId !== spaceId) {
    return fail(err.notFound("Column"));
  }
  return ok(column);
};

const requireTagInSpace = async (spaceId: string, tagId: string) => {
  const tag = await spacesService.tag.get({ id: tagId });
  if (!tag || tag.spaceId !== spaceId) {
    return fail(err.notFound("Tag"));
  }
  return ok(tag);
};

// Widgets mount BEFORE the auth middleware so they keep their own
// `auth.requireRole("*")` gating instead of inheriting `requireRole("user")`.
import widgetRoutes from "./widgets";

const app = new Hono<AuthContext>()
  .route("/widget", widgetRoutes)
  .use(auth.requireRole("authenticated"))

  .get(
    "/workspace/route",
    describeRoute({
      tags: ["Spaces"],
      summary: "Load workspace route state",
      description: "Resolve an enhanced Spaces workspace route into client-renderable state.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(z.any(), "Workspace route state"),
        400: jsonResponse(ErrorResponseSchema, "Unsupported route"),
      },
    }),
    v("query", z.object({ href: z.string().min(1).max(3000) })),
    async (c) => {
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const href = c.req.valid("query").href;
      const target = parseSpacesWorkspaceHref(href);
      if (!target) return respond(c, fail(err.badInput("Unsupported workspace route")));
      const state = await loadSpacesWorkspaceState({
        user: userResult.data,
        spaceId: target.spaceId,
        href,
        cookieHeader: c.req.header("Cookie"),
        settings: target.settings,
        dateConfig: getDateConfig(c),
      });
      return respond(c, ok(state));
    },
  )

  .get(
    "/:id/events",
    describeRoute({
      tags: ["Spaces"],
      summary: "Stream space events",
      description: "Best-effort server-sent event stream for refreshing mounted space workspaces.",
      ...requiresAuth,
      responses: {
        200: {
          description: "Server-sent events",
          content: { "text/event-stream": { schema: { type: "string" } } },
        },
      },
    }),
    async (c) => {
      const spaceId = c.req.param("id") ?? "";
      const { error } = await checkSpaceAccess(c, spaceId);
      if (error) return error;

      const encoder = new TextEncoder();
      let keepalive: ReturnType<typeof setInterval> | undefined;
      const streamAbort = new AbortController();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: string, data: unknown, id?: string) => {
            controller.enqueue(encoder.encode(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };
          const requestedCursor = c.req.query("after") || null;
          const startCursor = requestedCursor ?? (await latestSpaceEventCursor(spaceId)) ?? "0-0";
          send("ready", { spaceId, cursor: startCursor }, startCursor);
          keepalive = setInterval(() => send("ping", { at: new Date().toISOString() }), 25_000);
          try {
            for await (const event of liveSpaceEvents({ spaceId, after: startCursor, signal: streamAbort.signal })) {
              if (streamAbort.signal.aborted) break;
              send(event.data.type, event.data, event.cursor);
            }
          } catch (streamError) {
            if (!streamAbort.signal.aborted) {
              send("error", { message: streamError instanceof Error ? streamError.message : "Space event stream failed" });
            }
          } finally {
            if (keepalive) clearInterval(keepalive);
            try {
              controller.close();
            } catch {
              // Client disconnects are normal for long-lived event streams.
            }
          }
        },
        cancel() {
          streamAbort.abort();
          if (keepalive) clearInterval(keepalive);
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    },
  )

  // ==========================
  // List Spaces
  // ==========================
  .get(
    "/",
    describeRoute({
      tags: ["Spaces"],
      summary: "List spaces",
      description: "List all spaces accessible to the current actor.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(SpaceListSchema, "List of spaces"),
      },
    }),
    async (c) => {
      const access = getScopedSpaceAccess(c);
      if (!access.ok) return respond(c, access);
      const result = await spacesService.space.list({
        subject: access.data.subject,
        boundSpaceId: access.data.boundSpaceId,
      });
      return respond(c, ok(result.items));
    },
  )

  // ==========================
  // Create Space
  // ==========================
  .post(
    "/",
    describeRoute({
      tags: ["Spaces"],
      summary: "Create space",
      description: "Create a new space. Creator automatically gets admin access.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(SpaceSchema, "Created space"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        404: jsonResponse(ErrorResponseSchema, "Group not found"),
      },
    }),
    v("json", CreateSpaceSchema),
    async (c) => {
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const user = userResult.data;
      const data = c.req.valid("json");
      return respond(c, spacesService.space.create({ data, creatorId: user.id }));
    },
  )

  // ==========================
  // Get Space Detail
  // ==========================
  .get(
    "/:id",
    describeRoute({
      tags: ["Spaces"],
      summary: "Get space details",
      description: "Get space with columns and tags.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(SpaceDetailSchema, "Space details"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Space not found"),
      },
    }),
    async (c) => {
      const id = c.req.param("id") ?? "";
      const { error } = await checkSpaceAccess(c, id);
      if (error) return error;

      const space = await spacesService.space.getDetail({ id });
      if (!space) return respond(c, fail(err.notFound("Space")));
      return respond(c, ok(space));
    },
  )

  // ==========================
  // Update Space
  // ==========================
  .patch(
    "/:id",
    describeRoute({
      tags: ["Spaces"],
      summary: "Update space",
      description: "Update a space's name, description, or color. Requires write permission.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(SpaceSchema, "Updated space"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Space not found"),
      },
    }),
    v("json", UpdateSpaceSchema),
    async (c) => {
      const id = c.req.param("id") ?? "";
      const data = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, id, "write");
      if (error) return error;
      return respond(c, spacesService.space.update({ id, data }));
    },
  )

  // ==========================
  // Delete Space
  // ==========================
  .delete(
    "/:id",
    describeRoute({
      tags: ["Spaces"],
      summary: "Delete space",
      description: "Delete a space and all its items. Requires admin permission.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Space deleted"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Space not found"),
      },
    }),
    async (c) => {
      const id = c.req.param("id") ?? "";

      const { error } = await checkSpaceAccess(c, id, "admin");
      if (error) return error;
      return respondMessage(c, spacesService.space.remove({ id }), "Space deleted");
    },
  )

  // ==========================
  // Regenerate iCal Token
  // ==========================
  .post(
    "/:id/regenerate-ical-token",
    describeRoute({
      tags: ["Spaces"],
      summary: "Regenerate iCal token",
      description: "Generate a new iCal subscription token.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(z.object({ icalToken: z.string() }), "New iCal token"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Space not found"),
      },
    }),
    async (c) => {
      const id = c.req.param("id") ?? "";

      const { error } = await checkSpaceAccess(c, id, "admin");
      if (error) return error;
      return respond(c, spacesService.space.regenerateICalToken({ id }));
    },
  )

  // ==========================
  // COLUMNS
  // ==========================

  // Create Column
  .post(
    "/:id/columns",
    describeRoute({
      tags: ["Spaces"],
      summary: "Create column",
      description: "Add a new column to a space.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(SpaceColumnSchema, "Created column"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Space not found"),
      },
    }),
    v("json", CreateColumnSchema),
    async (c) => {
      const spaceId = c.req.param("id") ?? "";
      const data = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId, "write");
      if (error) return error;
      return respond(c, spacesService.column.create({ spaceId, data }));
    },
  )

  // Update Column
  .patch(
    "/:id/columns/:columnId",
    describeRoute({
      tags: ["Spaces"],
      summary: "Update column",
      description: "Update a column's name, color, or done status.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(SpaceColumnSchema, "Updated column"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Column not found"),
      },
    }),
    v("json", UpdateColumnSchema),
    async (c) => {
      const spaceId = c.req.param("id") ?? "";
      const columnId = c.req.param("columnId") ?? "";
      const data = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId, "write");
      if (error) return error;
      const columnCheck = await requireColumnInSpace(spaceId, columnId);
      if (!columnCheck.ok) return respond(c, columnCheck);
      return respond(c, spacesService.column.update({ id: columnId, data }));
    },
  )

  // Delete Column
  .delete(
    "/:id/columns/:columnId",
    describeRoute({
      tags: ["Spaces"],
      summary: "Delete column",
      description: "Delete an empty column.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Column deleted"),
        400: jsonResponse(ErrorResponseSchema, "Column has items"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Column not found"),
      },
    }),
    async (c) => {
      const spaceId = c.req.param("id") ?? "";
      const columnId = c.req.param("columnId") ?? "";

      const { error } = await checkSpaceAccess(c, spaceId, "write");
      if (error) return error;
      const columnCheck = await requireColumnInSpace(spaceId, columnId);
      if (!columnCheck.ok) return respond(c, columnCheck);
      return respondMessage(c, spacesService.column.remove({ id: columnId }), "Column deleted");
    },
  )

  // Reorder Columns
  .put(
    "/:id/columns/order",
    describeRoute({
      tags: ["Spaces"],
      summary: "Reorder columns",
      description: "Set the order of columns in a space.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Columns reordered"),
        400: jsonResponse(ErrorResponseSchema, "Invalid column list"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Space not found"),
      },
    }),
    v("json", ReorderColumnsSchema),
    async (c) => {
      const spaceId = c.req.param("id") ?? "";
      const { columnIds } = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId, "write");
      if (error) return error;
      return respondMessage(c, spacesService.column.reorder({ spaceId, columnIds }), "Columns reordered");
    },
  )

  // ==========================
  // TAGS
  // ==========================

  // Create Tag
  .post(
    "/:id/tags",
    describeRoute({
      tags: ["Spaces"],
      summary: "Create tag",
      description: "Add a new tag to a space.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(SpaceTagSchema, "Created tag"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request or duplicate name"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Space not found"),
      },
    }),
    v("json", CreateTagSchema),
    async (c) => {
      const spaceId = c.req.param("id") ?? "";
      const data = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId, "write");
      if (error) return error;
      return respond(c, spacesService.tag.create({ spaceId, data }));
    },
  )

  // Update Tag
  .patch(
    "/:id/tags/:tagId",
    describeRoute({
      tags: ["Spaces"],
      summary: "Update tag",
      description: "Update a tag's name or color.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(SpaceTagSchema, "Updated tag"),
        400: jsonResponse(ErrorResponseSchema, "Duplicate name"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Tag not found"),
      },
    }),
    v("json", UpdateTagSchema),
    async (c) => {
      const spaceId = c.req.param("id") ?? "";
      const tagId = c.req.param("tagId") ?? "";
      const data = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId, "write");
      if (error) return error;
      const tagCheck = await requireTagInSpace(spaceId, tagId);
      if (!tagCheck.ok) return respond(c, tagCheck);
      return respond(c, spacesService.tag.update({ id: tagId, data }));
    },
  )

  // Delete Tag
  .delete(
    "/:id/tags/:tagId",
    describeRoute({
      tags: ["Spaces"],
      summary: "Delete tag",
      description: "Delete a tag (removes from all items).",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Tag deleted"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Tag not found"),
      },
    }),
    async (c) => {
      const spaceId = c.req.param("id") ?? "";
      const tagId = c.req.param("tagId") ?? "";

      const { error } = await checkSpaceAccess(c, spaceId, "write");
      if (error) return error;
      const tagCheck = await requireTagInSpace(spaceId, tagId);
      if (!tagCheck.ok) return respond(c, tagCheck);
      return respondMessage(c, spacesService.tag.remove({ id: tagId }), "Tag deleted");
    },
  )

  // ==========================
  // ITEMS
  // ==========================

  // List Items (plain board snapshot)
  .get(
    "/:id/items",
    describeRoute({
      tags: ["Spaces"],
      summary: "List items",
      description: "List all items in a space (board view).",
      ...requiresAuth,
      responses: {
        200: jsonResponse(SpaceItemListSchema, "List of items"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Space not found"),
      },
    }),
    async (c) => {
      const spaceId = c.req.param("id") ?? "";
      const includeCompleted = c.req.query("includeCompleted") === "true";

      const { error } = await checkSpaceAccess(c, spaceId);
      if (error) return error;

      const result = await spacesService.item.list({ spaceId, includeCompleted });
      return respond(c, ok(result.items));
    },
  )

  // List Items with filtering, sorting, and pagination
  .post(
    "/:id/items/filter",
    describeRoute({
      tags: ["Spaces"],
      summary: "List items with filters",
      description: "List items with filtering, sorting, and pagination support.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ItemListResultSchema, "Filtered items with pagination"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Space not found"),
      },
    }),
    v("json", ItemFilterSchema),
    async (c) => {
      const user = getUserBackedActor(c);
      const spaceId = c.req.param("id") ?? "";
      const filter = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId);
      if (error) return error;

      const result = await spacesService.item.listFiltered({ spaceId, filter, currentUserId: user?.id, dateConfig: getDateConfig(c) });
      return respond(c, ok(result));
    },
  )

  // List assignable users for assignee pickers
  .get(
    "/:id/assignable-users",
    describeRoute({
      tags: ["Spaces"],
      summary: "List assignable users",
      description: "List concrete users that currently have effective access to this space and can be assigned to items.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(SpaceAssignableUserListSchema, "Assignable users"),
        400: jsonResponse(ErrorResponseSchema, "Invalid query"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Space not found"),
      },
    }),
    v("query", AssignableUsersQuerySchema),
    async (c) => {
      const spaceId = c.req.param("id") ?? "";
      const query = c.req.valid("query");

      const { error } = await checkSpaceAccess(c, spaceId);
      if (error) return error;
      const excludeUserIds = parseUuidCsv(query.exclude_user_ids, "exclude_user_ids");
      if (!excludeUserIds.ok) return respond(c, excludeUserIds);

      const users = await spacesService.item.listAssignableUsers({
        spaceId,
        search: query.search,
        excludeUserIds: excludeUserIds.data,
      });
      return respond(c, ok(users));
    },
  )

  // Create Item
  .post(
    "/:id/items",
    describeRoute({
      tags: ["Spaces"],
      summary: "Create item",
      description: "Create a new item (event, todo, or ticket).",
      ...requiresAuth,
      responses: {
        200: jsonResponse(SpaceItemSchema, "Created item"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Space not found"),
      },
    }),
    v("json", CreateItemSchema),
    async (c) => {
      const spaceId = c.req.param("id") ?? "";
      const data = c.req.valid("json");

      const { user, error } = await checkSpaceAccess(c, spaceId, "write");
      if (error) return error;
      return respond(c, spacesService.item.create({ spaceId, data, createdBy: user?.id ?? null }));
    },
  )

  // Get Item
  .get(
    "/:id/items/:itemId",
    describeRoute({
      tags: ["Spaces"],
      summary: "Get item",
      description: "Get item details with assignees and tags.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(SpaceItemSchema, "Item details"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Item not found"),
      },
    }),
    async (c) => {
      const spaceId = c.req.param("id") ?? "";
      const itemId = c.req.param("itemId") ?? "";

      const { error } = await checkSpaceAccess(c, spaceId);
      if (error) return error;

      const item = await spacesService.item.get({ id: itemId });
      if (!item || item.spaceId !== spaceId) {
        return respond(c, fail(err.notFound("Item")));
      }

      return respond(c, ok(item));
    },
  )

  // Update Item
  .patch(
    "/:id/items/:itemId",
    describeRoute({
      tags: ["Spaces"],
      summary: "Update item",
      description: "Update item properties.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(SpaceItemSchema, "Updated item"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Item not found"),
      },
    }),
    v("json", UpdateItemSchema),
    async (c) => {
      const spaceId = c.req.param("id") ?? "";
      const itemId = c.req.param("itemId") ?? "";
      const data = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId, "write");
      if (error) return error;
      const itemCheck = await requireItemInSpace(spaceId, itemId);
      if (!itemCheck.ok) return respond(c, itemCheck);
      return respond(c, spacesService.item.update({ id: itemId, data }));
    },
  )

  // Delete Item
  .delete(
    "/:id/items/:itemId",
    describeRoute({
      tags: ["Spaces"],
      summary: "Delete item",
      description: "Delete an item.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Item deleted"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Item not found"),
      },
    }),
    async (c) => {
      const spaceId = c.req.param("id") ?? "";
      const itemId = c.req.param("itemId") ?? "";

      const { error } = await checkSpaceAccess(c, spaceId, "write");
      if (error) return error;
      const itemCheck = await requireItemInSpace(spaceId, itemId);
      if (!itemCheck.ok) return respond(c, itemCheck);
      return respondMessage(c, spacesService.item.remove({ id: itemId }), "Item deleted");
    },
  )

  // Move Item
  .post(
    "/:id/items/:itemId/move",
    describeRoute({
      tags: ["Spaces"],
      summary: "Move item",
      description: "Move item to a different column/rank (Kanban drag & drop).",
      ...requiresAuth,
      responses: {
        200: jsonResponse(SpaceItemSchema, "Moved item"),
        400: jsonResponse(ErrorResponseSchema, "Invalid column"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Item not found"),
      },
    }),
    v("json", MoveItemSchema),
    async (c) => {
      const spaceId = c.req.param("id") ?? "";
      const itemId = c.req.param("itemId") ?? "";
      const { columnId, rank, completed } = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId, "write");
      if (error) return error;
      const itemCheck = await requireItemInSpace(spaceId, itemId);
      if (!itemCheck.ok) return respond(c, itemCheck);
      return respond(c, spacesService.item.move({ id: itemId, columnId, rank, completed }));
    },
  )

  // Set Completed
  .post(
    "/:id/items/:itemId/completed",
    describeRoute({
      tags: ["Spaces"],
      summary: "Set completed status",
      description: "Mark an item as completed or reopen it and move it to the first matching workflow status when needed.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(SpaceItemSchema, "Updated item"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Item not found"),
      },
    }),
    v("json", SetCompletedSchema),
    async (c) => {
      const spaceId = c.req.param("id") ?? "";
      const itemId = c.req.param("itemId") ?? "";
      const { completed } = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId, "write");
      if (error) return error;
      const itemCheck = await requireItemInSpace(spaceId, itemId);
      if (!itemCheck.ok) return respond(c, itemCheck);
      return respond(c, spacesService.item.setCompleted({ id: itemId, completed }));
    },
  )

  // ==========================
  // COMMENTS
  // ==========================

  // List Comments
  .get(
    "/:id/items/:itemId/comments",
    describeRoute({
      tags: ["Spaces"],
      summary: "List comments",
      description: "List all comments on an item.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(SpaceCommentListSchema, "List of comments"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Item not found"),
      },
    }),
    async (c) => {
      const spaceId = c.req.param("id") ?? "";
      const itemId = c.req.param("itemId") ?? "";

      const { error } = await checkSpaceAccess(c, spaceId);
      if (error) return error;
      const itemCheck = await requireItemInSpace(spaceId, itemId);
      if (!itemCheck.ok) return respond(c, itemCheck);

      const user = getUserBackedActor(c);
      const result = await spacesService.comment.list({ itemId, viewerUserId: user?.id ?? null });
      return respond(c, ok(result.items));
    },
  )

  // Create Comment
  .post(
    "/:id/items/:itemId/comments",
    describeRoute({
      tags: ["Spaces"],
      summary: "Add comment",
      description: "Add a comment to an item.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(SpaceCommentSchema, "Created comment"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Item not found"),
      },
    }),
    v("json", CreateCommentSchema),
    async (c) => {
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const user = userResult.data;
      const spaceId = c.req.param("id") ?? "";
      const itemId = c.req.param("itemId") ?? "";
      const { content } = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId, "write");
      if (error) return error;
      const itemCheck = await requireItemInSpace(spaceId, itemId);
      if (!itemCheck.ok) return respond(c, itemCheck);
      return respond(
        c,
        spacesService.comment.create({
          itemId,
          userId: user.id,
          content,
        }),
      );
    },
  )

  // Update Comment
  .patch(
    "/:id/items/:itemId/comments/:commentId",
    describeRoute({
      tags: ["Spaces"],
      summary: "Edit comment",
      description: "Edit your own comment.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(SpaceCommentSchema, "Updated comment"),
        403: jsonResponse(ErrorResponseSchema, "Cannot edit another user's comment"),
        404: jsonResponse(ErrorResponseSchema, "Comment not found"),
      },
    }),
    v("json", UpdateCommentSchema),
    async (c) => {
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const user = userResult.data;
      const spaceId = c.req.param("id") ?? "";
      const itemId = c.req.param("itemId") ?? "";
      const commentId = c.req.param("commentId") ?? "";
      const { content } = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId, "write");
      if (error) return error;

      // Cross-check the comment is actually in this space's item — owner-check
      // in the service prevents cross-user mutation, but this stops a user
      // from updating their own comment in space B via space A's URL.
      const itemCheck = await requireItemInSpace(spaceId, itemId);
      if (!itemCheck.ok) return respond(c, itemCheck);
      const existing = await spacesService.comment.get({ id: commentId, viewerUserId: user.id });
      if (!existing || existing.itemId !== itemId) {
        return respond(c, fail(err.notFound("Comment")));
      }

      return respond(
        c,
        spacesService.comment.update({
          id: commentId,
          content,
          userId: user.id,
        }),
      );
    },
  )

  // Delete Comment
  .delete(
    "/:id/items/:itemId/comments/:commentId",
    describeRoute({
      tags: ["Spaces"],
      summary: "Delete comment",
      description: "Delete your own comment within 10 minutes.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Comment deleted"),
        403: jsonResponse(ErrorResponseSchema, "Cannot delete this comment"),
        404: jsonResponse(ErrorResponseSchema, "Comment not found"),
      },
    }),
    async (c) => {
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const user = userResult.data;
      const spaceId = c.req.param("id") ?? "";
      const itemId = c.req.param("itemId") ?? "";
      const commentId = c.req.param("commentId") ?? "";

      const { error } = await checkSpaceAccess(c, spaceId, "write");
      if (error) return error;

      // Cross-check (see Update Comment above for rationale).
      const itemCheck = await requireItemInSpace(spaceId, itemId);
      if (!itemCheck.ok) return respond(c, itemCheck);
      const existing = await spacesService.comment.get({ id: commentId, viewerUserId: user.id });
      if (!existing || existing.itemId !== itemId) {
        return respond(c, fail(err.notFound("Comment")));
      }

      return respondMessage(
        c,
        spacesService.comment.remove({
          id: commentId,
          userId: user.id,
        }),
        "Comment deleted",
      );
    },
  )

  // ==========================
  // RESOURCE API KEYS
  // ==========================

  .get(
    "/:id/api-keys",
    describeRoute({
      tags: ["Spaces"],
      summary: "List space API keys",
      description: "List active resource-bound API keys for this space. Requires admin permission.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(z.object({ items: z.array(SpaceApiKeySchema) }), "Space API keys"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Space not found"),
      },
    }),
    async (c) => {
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);

      const spaceId = c.req.param("id") ?? "";
      const { error } = await checkSpaceAccess(c, spaceId, "admin");
      if (error) return error;

      return respond(c, async () => ok({ items: await spacesService.access.apiKeys.list({ spaceId }) }));
    },
  )

  .post(
    "/:id/api-keys",
    describeRoute({
      tags: ["Spaces"],
      summary: "Create space API key",
      description: "Create a resource-bound API key for this space. The raw token is returned once. Requires admin permission.",
      ...requiresAuth,
      responses: {
        201: jsonResponse(CreateSpaceApiKeyResponseSchema, "Space API key created"),
        400: jsonResponse(ErrorResponseSchema, "Failed to create API key"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Space not found"),
      },
    }),
    v("json", CreateSpaceApiKeySchema),
    async (c) => {
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const user = userResult.data;
      const spaceId = c.req.param("id") ?? "";
      const data = c.req.valid("json");
      const { space, error } = await checkSpaceAccess(c, spaceId, "admin");
      if (error) return error;

      return respond(
        c,
        spacesService.access.apiKeys.create({
          spaceId,
          actor: user,
          spaceName: space?.name ?? "Space",
          data: {
            name: data.name,
            expiresAt: data.expiresAt,
            permission: data.permission,
          },
        }),
        201,
      );
    },
  )

  .delete(
    "/:id/api-keys/:credentialId",
    describeRoute({
      tags: ["Spaces"],
      summary: "Revoke space API key",
      description: "Revoke a resource-bound API key for this space. Requires admin permission.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Space API key revoked"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "API key not found"),
      },
    }),
    async (c) => {
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const user = userResult.data;
      const spaceId = c.req.param("id") ?? "";
      const credentialId = c.req.param("credentialId") ?? "";
      const { error } = await checkSpaceAccess(c, spaceId, "admin");
      if (error) return error;

      return respond(c, spacesService.access.apiKeys.revoke({ spaceId, credentialId, actor: user }));
    },
  )

  // ==========================
  // ACCESS CONTROL
  // ==========================

  // List Access Entries
  .get(
    "/:id/access",
    describeRoute({
      tags: ["Spaces"],
      summary: "List access entries",
      description: "List all access entries for a space. Requires admin permission.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(z.array(AccessEntrySchema), "Access entries"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Space not found"),
      },
    }),
    async (c) => {
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const spaceId = c.req.param("id") ?? "";

      const { error } = await checkSpaceAccess(c, spaceId, "admin");
      if (error) return error;

      const entries = await spacesService.access.list({ spaceId });
      return respond(c, ok(entries.items));
    },
  )

  // Grant Access
  .post(
    "/:id/access",
    describeRoute({
      tags: ["Spaces"],
      summary: "Grant access",
      description: "Grant access to a user, group, or public. Requires admin permission.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(AccessEntrySchema, "Created access entry"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Space, user, or group not found"),
        409: jsonResponse(ErrorResponseSchema, "Principal already has access"),
      },
    }),
    v("json", GrantAccessSchema),
    async (c) => {
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const spaceId = c.req.param("id") ?? "";
      const { principal, permission } = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId, "admin");
      if (error) return error;
      return respond(
        c,
        spacesService.access.grant({
          spaceId,
          principal,
          permission,
        }),
      );
    },
  )

  // Update Access
  .patch(
    "/:id/access/:accessId",
    describeRoute({
      tags: ["Spaces"],
      summary: "Update access permission",
      description: "Update the permission level for an access entry. Requires admin permission.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Access updated"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Access entry not found"),
      },
    }),
    v("json", UpdateAccessSchema),
    async (c) => {
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const spaceId = c.req.param("id") ?? "";
      const accessId = c.req.param("accessId") ?? "";
      const { permission } = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId, "admin");
      if (error) return error;

      const guard = await spacesService.access.guard({ spaceId, accessId });
      if (!guard.currentPermission) {
        return respond(c, fail(err.notFound("Access entry")));
      }

      if (guard.currentPermission === "admin" && permission !== "admin" && guard.otherAdmins <= 0) {
        return respond(c, fail(err.badInput("Cannot remove the last admin")));
      }
      return respondMessage(c, updateAccess({ id: accessId, permission }), "Access updated");
    },
  )

  // Revoke Access
  .delete(
    "/:id/access/:accessId",
    describeRoute({
      tags: ["Spaces"],
      summary: "Revoke access",
      description: "Remove an access entry. Cannot remove the last access entry. Requires admin permission.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Access revoked"),
        400: jsonResponse(ErrorResponseSchema, "Cannot remove last access entry"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Access entry not found"),
      },
    }),
    async (c) => {
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const spaceId = c.req.param("id") ?? "";
      const accessId = c.req.param("accessId") ?? "";

      const { error } = await checkSpaceAccess(c, spaceId, "admin");
      if (error) return error;

      const guard = await spacesService.access.guard({ spaceId, accessId });
      if (!guard.currentPermission) {
        return respond(c, fail(err.notFound("Access entry")));
      }

      if (guard.total <= 1) {
        return respond(c, fail(err.badInput("Cannot remove the last access entry")));
      }

      if (guard.currentPermission === "admin" && guard.otherAdmins <= 0) {
        return respond(c, fail(err.badInput("Cannot remove the last admin")));
      }
      return respondMessage(c, spacesService.access.remove({ spaceId, accessId }), "Access revoked");
    },
  );

// ==========================
// Calendar API (mounted as sub-routes)
// ==========================

const CalendarItemListSchema = z.array(CalendarItemSchema);
const OverlapItemListSchema = z.array(OverlapItemSchema);

const calendarApp = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))

  .get(
    "/",
    describeRoute({
      tags: ["Calendar"],
      summary: "List calendar items",
      description: "List all calendar items across all accessible spaces in a date range.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(CalendarItemListSchema, "List of calendar items"),
        400: jsonResponse(z.object({ message: z.string() }), "Invalid date range"),
      },
    }),
    v("query", CalendarQuerySchema),
    async (c) => {
      const access = getScopedSpaceAccess(c);
      if (!access.ok) return respond(c, access);
      const { from, to } = c.req.valid("query");

      const result = await spacesService.item.calendar.list({
        ...access.data,
        from,
        to,
      });
      return respond(c, ok(result));
    },
  )

  .get(
    "/overlap",
    describeRoute({
      tags: ["Calendar"],
      summary: "Check time overlap",
      description: "Check if a time range overlaps with existing events.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(OverlapItemListSchema, "List of overlapping items"),
        400: jsonResponse(z.object({ message: z.string() }), "Invalid time range"),
      },
    }),
    v("query", OverlapQuerySchema),
    async (c) => {
      const access = getScopedSpaceAccess(c);
      if (!access.ok) return respond(c, access);
      const { from, to, excludeItemId } = c.req.valid("query");

      const result = await spacesService.item.calendar.checkOverlap({
        ...access.data,
        from,
        to,
        excludeItemId,
      });
      return respond(c, ok(result));
    },
  );

// Public iCal feed (no auth required)
const icalApp = new Hono().get(
  "/ical/:filename",
  describeRoute({
    tags: ["Calendar"],
    summary: "iCal feed",
    description: "Public iCal feed for a space (requires valid token).",
    responses: {
      200: {
        description: "iCal content",
        content: {
          "text/calendar": {
            schema: { type: "string" },
          },
        },
      },
      404: jsonResponse(z.object({ message: z.string() }), "Invalid token"),
    },
  }),
  async (c: Context) => {
    const filename = c.req.param("filename");
    const token = filename?.endsWith(".ics") ? filename.slice(0, -4) : filename;

    if (!token) {
      return respond(c, fail(err.notFound("Invalid token")));
    }

    const space = await spacesService.ical.getByToken({ token });
    if (!space) {
      return respond(c, fail(err.notFound("Invalid token")));
    }

    const content = await spacesService.ical.generate({
      spaceId: space.id,
      baseUrl: await coreSettings.get<string>("app.url"),
      dateConfig: getDateConfig(c),
    });

    return c.text(content, 200, {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${space.name}.ics"`,
    });
  },
);

// Combined export: spaces API + calendar sub-routes.
// Calendar is mounted BEFORE the spaces app — `app` has a `/:id` handler that
// would otherwise match the literal path "calendar" and try to parse it as a
// space UUID (causing a 500 from Postgres uuid validation). Hono's router
// honours registration order for overlapping static-vs-dynamic paths.
const combined = new Hono().use(rateLimit()).route("/calendar", calendarApp).route("/calendar", icalApp).route("/", app);

export default combined;
export type ApiType = typeof combined;

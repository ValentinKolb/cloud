import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { v } from "@valentinkolb/cloud/lib/server";
import { jsonResponse, requiresAuth } from "@valentinkolb/cloud/lib/server";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import { rateLimit } from "@valentinkolb/cloud/lib/server";
import { respond } from "@valentinkolb/cloud/lib/server";
import { err, fail, ok, type Result } from "@valentinkolb/cloud/lib/server";
import { spacesService } from "./service";
import { updateAccess } from "@valentinkolb/cloud/lib/server";
import type { MutationResult, Space, PermissionLevel } from "@/spaces/contracts";
import {
  SpaceSchema,
  SpaceDetailSchema,
  SpaceColumnSchema,
  SpaceTagSchema,
  SpaceItemSchema,
  SpaceCommentSchema,
  CreateSpaceSchema,
  UpdateSpaceSchema,
  CreateColumnSchema,
  UpdateColumnSchema,
  ReorderColumnsSchema,
  CreateTagSchema,
  UpdateTagSchema,
  CreateItemSchema,
  UpdateItemSchema,
  MoveItemSchema,
  SetCompletedSchema,
  CreateCommentSchema,
  UpdateCommentSchema,
  ErrorResponseSchema,
  MessageResponseSchema,
  ItemFilterSchema,
  ItemListResultSchema,
  AccessEntrySchema,
  GrantAccessSchema,
  UpdateAccessSchema,
  CalendarItemSchema,
  OverlapItemSchema,
  CalendarQuerySchema,
  OverlapQuerySchema,
  hasRole,
} from "@/spaces/contracts";
import { z } from "zod";
import { env } from "@valentinkolb/cloud/core/config";

// ==========================
// Spaces API
// ==========================

const SpaceListSchema = z.array(SpaceSchema);
const SpaceItemListSchema = z.array(SpaceItemSchema);
const SpaceCommentListSchema = z.array(SpaceCommentSchema);

/**
 * Middleware to check space access with permission level.
 */
const checkSpaceAccess = async (c: Context<AuthContext>, spaceId: string, requiredLevel: PermissionLevel = "read") => {
  const user = c.get("user");
  const space = await spacesService.space.get({ id: spaceId });

  if (!space) {
    return {
      space: null,
      permission: "none" as PermissionLevel,
      error: await respond(c, fail(err.notFound("Space"))),
    };
  }

  if (hasRole(user, "admin")) {
    return { space, permission: "admin" as PermissionLevel };
  }

  const hasAccess = await spacesService.space.permission.canAccess({
    spaceId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
    requiredLevel,
  });

  if (!hasAccess) {
    return {
      space: null,
      permission: "none" as PermissionLevel,
      error: await respond(c, fail(err.forbidden("Access denied"))),
    };
  }

  const permission = await spacesService.space.permission.get({
    spaceId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
  });

  return { space, permission };
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

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))

  // ==========================
  // List Spaces
  // ==========================
  .get(
    "/",
    describeRoute({
      tags: ["Spaces"],
      summary: "List spaces",
      description: "List all spaces accessible to the current user.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(SpaceListSchema, "List of spaces"),
      },
    }),
    async (c) => {
      const user = c.get("user");
      const result = await spacesService.space.list({
        userId: user.id,
        groups: user.memberofGroupIds,
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
      const user = c.get("user");
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
      const id = c.req.param("id");
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
      const id = c.req.param("id");
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
      const id = c.req.param("id");

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
      const id = c.req.param("id");

      const { error } = await checkSpaceAccess(c, id);
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
      const spaceId = c.req.param("id");
      const data = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId);
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
      const spaceId = c.req.param("id");
      const columnId = c.req.param("columnId");
      const data = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId);
      if (error) return error;
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
      const spaceId = c.req.param("id");
      const columnId = c.req.param("columnId");

      const { error } = await checkSpaceAccess(c, spaceId);
      if (error) return error;
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
      const spaceId = c.req.param("id");
      const { columnIds } = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId);
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
      const spaceId = c.req.param("id");
      const data = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId);
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
      const spaceId = c.req.param("id");
      const tagId = c.req.param("tagId");
      const data = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId);
      if (error) return error;
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
      const spaceId = c.req.param("id");
      const tagId = c.req.param("tagId");

      const { error } = await checkSpaceAccess(c, spaceId);
      if (error) return error;
      return respondMessage(c, spacesService.tag.remove({ id: tagId }), "Tag deleted");
    },
  )

  // ==========================
  // ITEMS
  // ==========================

  // List Items (simple, for backwards compatibility)
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
      const spaceId = c.req.param("id");
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
      const user = c.get("user");
      const spaceId = c.req.param("id");
      const filter = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId);
      if (error) return error;

      const result = await spacesService.item.listFiltered({ spaceId, filter, currentUserId: user.id });
      return respond(c, ok(result));
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
      const user = c.get("user");
      const spaceId = c.req.param("id");
      const data = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId);
      if (error) return error;
      return respond(c, spacesService.item.create({ spaceId, data, createdBy: user.id }));
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
      const spaceId = c.req.param("id");
      const itemId = c.req.param("itemId");

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
      const spaceId = c.req.param("id");
      const itemId = c.req.param("itemId");
      const data = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId);
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
      const spaceId = c.req.param("id");
      const itemId = c.req.param("itemId");

      const { error } = await checkSpaceAccess(c, spaceId);
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
      const spaceId = c.req.param("id");
      const itemId = c.req.param("itemId");
      const { columnId, rank, completed } = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId);
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
      description: "Mark item as completed or reopen it.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(SpaceItemSchema, "Updated item"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Item not found"),
      },
    }),
    v("json", SetCompletedSchema),
    async (c) => {
      const spaceId = c.req.param("id");
      const itemId = c.req.param("itemId");
      const { completed } = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId);
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
      const spaceId = c.req.param("id");
      const itemId = c.req.param("itemId");

      const { error } = await checkSpaceAccess(c, spaceId);
      if (error) return error;
      const itemCheck = await requireItemInSpace(spaceId, itemId);
      if (!itemCheck.ok) return respond(c, itemCheck);

      const result = await spacesService.comment.list({ itemId });
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
      const user = c.get("user");
      const spaceId = c.req.param("id");
      const itemId = c.req.param("itemId");
      const { content } = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId);
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
      const user = c.get("user");
      const spaceId = c.req.param("id");
      const commentId = c.req.param("commentId");
      const { content } = c.req.valid("json");

      const { error } = await checkSpaceAccess(c, spaceId);
      if (error) return error;
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
      description: "Delete your own comment (or any comment if admin).",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Comment deleted"),
        403: jsonResponse(ErrorResponseSchema, "Cannot delete another user's comment"),
        404: jsonResponse(ErrorResponseSchema, "Comment not found"),
      },
    }),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("id");
      const commentId = c.req.param("commentId");

      const { error } = await checkSpaceAccess(c, spaceId);
      if (error) return error;

      const isAdmin = user.roles.includes("admin");
      return respondMessage(
        c,
        spacesService.comment.remove({
          id: commentId,
          userId: user.id,
          isAdmin,
        }),
        "Comment deleted",
      );
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
      const spaceId = c.req.param("id");

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
      const spaceId = c.req.param("id");
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
      const spaceId = c.req.param("id");
      const accessId = c.req.param("accessId");
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
      const spaceId = c.req.param("id");
      const accessId = c.req.param("accessId");

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
      const user = c.get("user");
      const { from, to } = c.req.valid("query");

      const result = await spacesService.item.calendar.list({
        userId: user.id,
        groups: user.memberofGroupIds,
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
      const user = c.get("user");
      const { from, to, excludeItemId } = c.req.valid("query");

      const result = await spacesService.item.calendar.checkOverlap({
        groups: user.memberofGroupIds,
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
      baseUrl: env.APP_URL,
    });

    return c.text(content, 200, {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${space.name}.ics"`,
    });
  },
);

// Combined export: spaces API + calendar sub-routes
const combined = new Hono().use(rateLimit()).route("/", app).route("/calendar", calendarApp).route("/calendar", icalApp);

export default combined;
export type ApiType = typeof combined;

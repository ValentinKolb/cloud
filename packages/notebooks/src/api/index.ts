import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { v, jsonResponse, requiresAuth, auth, type AuthContext, rateLimit, respond } from "@valentinkolb/cloud/server";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { notebooksService, reindexRuntime } from "../service";
import { loadEditableNoteRouteData } from "../service/route-state";
import { settings, settingsService } from "@valentinkolb/cloud/services";
import type { MutationResult, PermissionLevel } from "@valentinkolb/cloud/contracts";
import {
  ErrorResponseSchema,
  MessageResponseSchema,
  AccessEntrySchema,
  GrantAccessSchema,
  UpdateAccessSchema,
  PaginationQuerySchema,
  PaginationResponseSchema,
  hasRole,
} from "@valentinkolb/cloud/contracts";
import { parsePagination, createPagination } from "@valentinkolb/cloud/contracts";

// ==========================
// Zod Schemas
// ==========================

const NotebookSchema = z.object({
  id: z.uuid(),
  shortId: z.string().describe("6-char base62 alias for URLs"),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  homepageNoteId: z.uuid().nullable(),
  homepageNoteShortId: z.string().nullable().describe("Homepage note short-id"),
  scriptsEnabled: z.boolean().describe("Per-notebook opt-in for `\`\`\`script` block execution"),
  createdBy: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const CreateNotebookSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  icon: z.string().max(50).optional(),
});

const UpdateNotebookSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
  homepageNoteId: z.string().nullable().optional().describe("Homepage note short-id"),
  // Toggling scripts_enabled is admin-only — see the PATCH handler
  // for the role check. Schema-level it's just a boolean field.
  scriptsEnabled: z.boolean().optional(),
});

const NoteSchema = z.object({
  id: z.uuid(),
  shortId: z.string().describe("6-char base62 alias for URLs and `note://` schemes"),
  notebookId: z.uuid(),
  parentId: z.uuid().nullable(),
  title: z.string(),
  position: z.number().int(),
  hasChildren: z.boolean(),
  yjsSnapshotAt: z.string().nullable(),
  contentMd: z.string().nullable(),
  createdBy: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lockedAt: z.string().nullable(),
});

const NoteWithContentSchema = NoteSchema.extend({
  yjsSnapshot: z.string().nullable().describe("Base64-encoded Yjs snapshot"),
});

const NoteTreeNodeSchema: z.ZodType<unknown> = NoteSchema.extend({
  children: z.lazy(() => z.array(NoteTreeNodeSchema)),
});

const CreateNoteSchema = z.object({
  parentId: z.string().min(1).optional().describe("Parent note UUID or short-id"),
  title: z.string().min(1).max(200),
  position: z.number().int().min(0).optional(),
  contentMd: z.string().optional(),
});

const UpdateNoteSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  parentId: z.uuid().nullable().optional(),
  position: z.number().int().min(0).optional(),
});

const MoveNoteSchema = z.object({
  parentId: z.uuid().nullable(),
  position: z.number().int().min(0),
});

const CopyNoteSchema = z.object({
  targetNotebookId: z.uuid(),
  targetParentId: z.uuid().nullable().optional(),
});

const NoteVersionSchema = z.object({
  id: z.uuid(),
  noteId: z.uuid(),
  title: z.string().nullable(),
  createdBy: z.uuid().nullable(),
  createdAt: z.string(),
});

const BacklinkSchema = z.object({
  noteId: z.uuid(),
  noteShortId: z.string(),
  title: z.string(),
  notebookId: z.uuid(),
  notebookShortId: z.string(),
  notebookName: z.string(),
  updatedAt: z.string(),
});

const GraphNodeSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  inDegree: z.number().int().min(0),
});

const GraphEdgeSchema = z.object({
  source: z.uuid(),
  target: z.uuid(),
});

const NoteGraphSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});

const FavoriteNoteSchema = z.object({
  noteId: z.uuid(),
  createdAt: z.string(),
});

const SetFavoriteSchema = z.object({
  favorite: z.boolean(),
});

const FavoriteStateSchema = z.object({
  favorite: z.boolean(),
});

const AttachmentSchema = z.object({
  id: z.uuid(),
  shortId: z.string().describe("6-char base62 alias for `attach://` schemes"),
  notebookId: z.uuid(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  kind: z.enum(["image", "file"]),
  createdBy: z.uuid().nullable(),
  createdAt: z.string(),
});

const AttachmentUsageSchema = z.object({ count: z.number().int() });

const TocItemSchema = z.object({
  level: z.number().int(),
  text: z.string(),
  id: z.string(),
});

const TaskProgressSchema = z.object({
  done: z.number().int(),
  total: z.number().int(),
});

const NamedBlockSummarySchema = z.object({
  name: z.string(),
  type: z.enum(["table", "list", "data", "section", "script", "unknown"]),
  line: z.number().int(),
});

const EditableNoteRouteStateSchema = z.object({
  href: z.string(),
  note: z.object({
    id: z.uuid(),
    shortId: z.string(),
    title: z.string(),
    yjsSnapshot: z.string().nullable(),
    contentMd: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    lockedAt: z.string().nullable(),
    parentId: z.uuid().nullable(),
  }),
  detail: z.object({
    canonicalNoteId: z.uuid(),
    noteId: z.string(),
    noteTitle: z.string(),
    contentMd: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    lockedAt: z.string().nullable(),
    isLocked: z.boolean(),
    tocItems: z.array(TocItemSchema),
    taskProgress: TaskProgressSchema,
    attachments: z.array(AttachmentSchema),
    backlinks: z.array(BacklinkSchema),
    namedBlocks: z.array(NamedBlockSummarySchema),
  }),
});

const RouteStateQuerySchema = z.object({
  href: z.string().min(1).max(500),
});

const RouteStateResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ok"),
    state: EditableNoteRouteStateSchema,
  }),
  z.object({
    kind: z.literal("fallback"),
    reason: z.enum(["invalid-target", "not-found", "readonly"]),
  }),
]);

/** Per-file upload cap. Default 10 MB, configurable at runtime via
 *  `notebooks.max_attachment_size_mb` (admin settings modal). The
 *  default mirrors the frontend's hardcoded `MAX_ATTACHMENT_SIZE_BYTES`
 *  in attachments-client.ts so a fresh install matches client-side
 *  expectations. Larger files → 413. */
const DEFAULT_MAX_ATTACHMENT_SIZE_MB = 10;
const DEFAULT_MAX_IMAGE_DIMENSION_PX = 2048;

const getMaxAttachmentSizeMb = async (): Promise<number> => {
  const mb = await settings.get<number>("notebooks.max_attachment_size_mb");
  return typeof mb === "number" && Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_MAX_ATTACHMENT_SIZE_MB;
};

const getMaxImageDimensionPx = async (): Promise<number> => {
  const px = await settings.get<number>("notebooks.max_image_dimension_px");
  return typeof px === "number" && Number.isFinite(px) && px > 0 ? px : DEFAULT_MAX_IMAGE_DIMENSION_PX;
};

const getMaxAttachmentSizeBytes = async (): Promise<number> => {
  return (await getMaxAttachmentSizeMb()) * 1024 * 1024;
};

const ListNotebooksQuerySchema = z.object({
  ...PaginationQuerySchema.shape,
  q: z.string().optional(),
});

const ListNotesQuerySchema = z.object({
  ...PaginationQuerySchema.shape,
  q: z.string().optional(),
  parentId: z.uuid().optional(),
});

// ==========================
// Helpers
// ==========================

/**
 * Check notebook access with permission level.
 *
 * `idOrShortId` accepts either the canonical UUID or the 6-char base62
 * `short_id` alias — `getByIdOrShortId` resolves the form on a
 * single-column index and the rest of this helper (and every caller)
 * proceeds with the canonical UUID via `notebook.id`. This is the only
 * boundary where the format ambiguity matters; below this point the
 * service layer is UUID-driven end-to-end.
 */
const checkNotebookAccess = async (c: Context<AuthContext>, idOrShortId: string, requiredLevel: PermissionLevel = "read") => {
  const user = c.get("user");
  const notebook = await notebooksService.notebook.getByIdOrShortId({ idOrShortId });

  if (!notebook) {
    return {
      notebook: null,
      permission: "none" as PermissionLevel,
      error: await respond(c, fail(err.notFound("Notebook"))),
    };
  }

  if (hasRole(user, "admin")) {
    return { notebook, permission: "admin" as PermissionLevel };
  }

  const hasAccess = await notebooksService.notebook.permission.canAccess({
    notebookId: notebook.id,
    userId: user.id,
    userGroups: user.memberofGroupIds,
    requiredLevel,
  });

  if (!hasAccess) {
    return {
      notebook: null,
      permission: "none" as PermissionLevel,
      error: await respond(c, fail(err.forbidden("Access denied"))),
    };
  }

  const permission = await notebooksService.notebook.permission.get({
    notebookId: notebook.id,
    userId: user.id,
    userGroups: user.memberofGroupIds,
  });

  return { notebook, permission };
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
 * Ensures a note belongs to the requested notebook so cross-notebook
 * access is rejected early. Both `notebookId` and `noteIdOrShortId`
 * accept either UUID or short-id — this helper compares against the
 * resolved `note.notebookId` (always UUID) AFTER the service-layer
 * lookup, so callers can pass whichever form the route param arrived
 * in. Returns the note for downstream use.
 */
const requireNoteInNotebook = async (notebookId: string, noteIdOrShortId: string) => {
  const note = await notebooksService.note.getByIdOrShortId({ idOrShortId: noteIdOrShortId });
  if (!note || note.notebookId !== notebookId) {
    return fail(err.notFound("Note"));
  }
  return ok(note);
};

const fileTooLarge = (c: Context, maxBytes: number) =>
  c.json(
    {
      message: `File exceeds ${Math.round(maxBytes / 1024 / 1024)} MB limit`,
      code: "PAYLOAD_TOO_LARGE",
    },
    413,
  );

// ==========================
// Routes
// ==========================
//
// This Hono is mounted at `/api/notebooks`, so its sub-routes become:
//   /api/notebooks/widget/*  — dashboard widget endpoints (own auth)
//   /api/notebooks/ws/*      — Yjs realtime collab WebSocket (own auth)
//   /api/notebooks/...       — CRUD endpoints (auth.requireRole("authenticated"))
//
// Widget + WS mount BEFORE the auth middleware so they keep their own
// permission gating instead of inheriting `requireRole("authenticated")`.

import widgetRoutes from "./widgets";
import templatesRoutes from "./templates";
import wsRoutes from "../ws";

const app = new Hono<AuthContext>()
  .route("/widget", widgetRoutes)
  .route("/ws", wsRoutes)
  .use(rateLimit())
  .use(auth.requireRole("authenticated"))
  .route("/templates", templatesRoutes)

  // ==========================
  // NOTEBOOKS
  // ==========================

  // List Notebooks
  .get(
    "/",
    describeRoute({
      tags: ["Notebooks"],
      summary: "List notebooks",
      description: "List all notebooks accessible to the current user.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(
          z.object({
            data: z.array(NotebookSchema),
            pagination: PaginationResponseSchema,
          }),
          "Paginated list of notebooks",
        ),
      },
    }),
    v("query", ListNotebooksQuerySchema),
    async (c) => {
      const user = c.get("user");
      const query = c.req.valid("query");
      const pagination = parsePagination(query);
      const result = await notebooksService.notebook.list({
        userId: user.id,
        groups: user.memberofGroupIds,
        pagination,
        filter: { query: query.q },
      });
      return respond(
        c,
        ok({
          data: result.items,
          pagination: createPagination(pagination, result.total),
        }),
      );
    },
  )

  // Create Notebook
  .post(
    "/",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Create notebook",
      description: "Create a new notebook. Creator automatically gets admin access.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(NotebookSchema, "Created notebook"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
      },
    }),
    v("json", CreateNotebookSchema),
    async (c) => {
      const user = c.get("user");
      const data = c.req.valid("json");
      return respond(c, notebooksService.notebook.create({ data, creatorId: user.id }));
    },
  )

  // Get Notebook
  .get(
    "/:id",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Get notebook",
      description: "Get notebook details.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(NotebookSchema, "Notebook details"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Notebook not found"),
      },
    }),
    async (c) => {
      const id = c.req.param("id")!;

      const { notebook, error } = await checkNotebookAccess(c, id);
      if (error) return error;

      return respond(c, ok(notebook));
    },
  )

  // Update Notebook
  .patch(
    "/:id",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Update notebook",
      description: "Update notebook name, description, or icon. Requires write permission.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(NotebookSchema, "Updated notebook"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Notebook not found"),
      },
    }),
    v("json", UpdateNotebookSchema),
    async (c) => {
      const data = c.req.valid("json");

      // Toggling `scriptsEnabled` requires admin (it gates execution
      // of arbitrary JS in the editor). Other fields only need write.
      const requiredLevel = data.scriptsEnabled !== undefined ? "admin" : "write";
      const { notebook, error } = await checkNotebookAccess(c, c.req.param("id")!, requiredLevel);
      if (error) return error;

      let homepageNoteId = data.homepageNoteId;
      if (homepageNoteId) {
        const homepage = await requireNoteInNotebook(notebook!.id, homepageNoteId);
        if (!homepage.ok) return respond(c, homepage);
        homepageNoteId = homepage.data.id;
      }

      return respond(c, notebooksService.notebook.update({ id: notebook!.id, data: { ...data, homepageNoteId } }));
    },
  )

  // Delete Notebook
  .delete(
    "/:id",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Delete notebook",
      description: "Delete a notebook and all its notes. Requires admin permission.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Notebook deleted"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Notebook not found"),
      },
    }),
    async (c) => {
      const { notebook, error } = await checkNotebookAccess(c, c.req.param("id")!, "admin");
      if (error) return error;
      return respondMessage(c, notebooksService.notebook.remove({ id: notebook!.id }), "Notebook deleted");
    },
  )

  // ==========================
  // NOTES
  // ==========================

  // Get Note Tree
  .get(
    "/:id/tree",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Get note tree",
      description: "Get the complete hierarchical tree of notes in a notebook.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(z.array(NoteTreeNodeSchema), "Note tree"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Notebook not found"),
      },
    }),
    async (c) => {
      let notebookId = c.req.param("id")!;

      const { notebook, error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
      notebookId = notebook!.id;

      const tree = await notebooksService.note.getTree({ notebookId });
      return respond(c, ok(tree));
    },
  )

  // Server-computed route state for enhanced note navigation
  .get(
    "/:id/route-state",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Resolve notebook route state",
      description:
        "Returns server-computed route state for enhanced navigation inside a mounted notebook workspace. Non-handleable targets return kind=fallback.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(RouteStateResponseSchema, "Route state"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Notebook not found"),
      },
    }),
    v("query", RouteStateQuerySchema),
    async (c) => {
      const user = c.get("user");
      const { notebook, permission, error } = await checkNotebookAccess(c, c.req.param("id")!);
      if (error) return error;

      const data = await loadEditableNoteRouteData({
        notebookId: notebook!.id,
        notebookShortId: notebook!.shortId,
        href: c.req.valid("query").href,
        origin: new URL(c.req.url).origin,
        canWrite: permission === "write" || permission === "admin",
        userId: user.id,
        userGroups: user.memberofGroupIds,
        bypassAccess: hasRole(user, "admin"),
      });

      return respond(c, ok(data));
    },
  )

  // List current user's favorite note ids
  .get(
    "/:id/favorites",
    describeRoute({
      tags: ["Notebooks"],
      summary: "List favorite notes",
      description: "List the current user's favorite notes in a notebook.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(z.array(FavoriteNoteSchema), "Favorite note ids"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Notebook not found"),
      },
    }),
    async (c) => {
      const user = c.get("user");
      let notebookId = c.req.param("id")!;
      const { notebook, error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
      notebookId = notebook!.id;
      return respond(c, ok(await notebooksService.note.favorites.listIds({ notebookId, userId: user.id })));
    },
  )

  // List Notes (flat)
  .get(
    "/:id/notes",
    describeRoute({
      tags: ["Notebooks"],
      summary: "List notes",
      description: "List all notes in a notebook (flat list).",
      ...requiresAuth,
      responses: {
        200: jsonResponse(
          z.object({
            data: z.array(NoteSchema),
            pagination: PaginationResponseSchema,
          }),
          "Paginated list of notes",
        ),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Notebook not found"),
      },
    }),
    v("query", ListNotesQuerySchema),
    async (c) => {
      let notebookId = c.req.param("id")!;
      const query = c.req.valid("query");
      const pagination = parsePagination(query);

      const { notebook, error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
      notebookId = notebook!.id;

      const result = await notebooksService.note.list({
        notebookId,
        pagination,
        filter: {
          query: query.q,
          parentId: query.parentId,
        },
      });
      return respond(
        c,
        ok({
          data: result.items,
          pagination: createPagination(pagination, result.total),
        }),
      );
    },
  )

  // Create Note
  .post(
    "/:id/notes",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Create note",
      description: "Create a new note in a notebook.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(NoteSchema, "Created note"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Notebook not found"),
      },
    }),
    v("json", CreateNoteSchema),
    async (c) => {
      const user = c.get("user");
      let notebookId = c.req.param("id")!;
      const data = c.req.valid("json");

      const { notebook, error } = await checkNotebookAccess(c, notebookId, "write");
      if (error) return error;
      notebookId = notebook!.id;
      let parentId = data.parentId;
      if (parentId) {
        const parentResult = await requireNoteInNotebook(notebookId, parentId);
        if (!parentResult.ok) return respond(c, parentResult);
        parentId = parentResult.data.id;
      }
      return respond(
        c,
        notebooksService.note.create({
          data: { ...data, notebookId, parentId },
          creatorId: user.id,
        }),
      );
    },
  )

  // Get Note
  .get(
    "/:id/notes/:noteId",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Get note",
      description: "Get note details without content.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(NoteSchema, "Note details"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Note not found"),
      },
    }),
    async (c) => {
      let notebookId = c.req.param("id")!;
      let noteId = c.req.param("noteId")!;

      const { notebook, error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
      notebookId = notebook!.id;

      const note = await notebooksService.note.getByIdOrShortId({ idOrShortId: noteId });
      if (!note || note.notebookId !== notebookId) {
        return respond(c, fail(err.notFound("Note")));
      }

      return respond(c, ok(note));
    },
  )

  // Set current user's favorite state for one note
  .put(
    "/:id/notes/:noteId/favorite",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Set note favorite",
      description: "Set whether the current user has favorited a note.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(FavoriteStateSchema, "Favorite state"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Note not found"),
      },
    }),
    v("json", SetFavoriteSchema),
    async (c) => {
      const user = c.get("user");
      let notebookId = c.req.param("id")!;
      let noteId = c.req.param("noteId")!;
      const data = c.req.valid("json");

      const { notebook, error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
      notebookId = notebook!.id;
      const noteCheck = await requireNoteInNotebook(notebookId, noteId);
      if (!noteCheck.ok) return respond(c, noteCheck);
      noteId = noteCheck.data.id;

      return respond(c, notebooksService.note.favorites.set({ notebookId, noteId, userId: user.id, favorite: data.favorite }));
    },
  )

  // Get Note with Content
  .get(
    "/:id/notes/:noteId/content",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Get note with content",
      description: "Get note details with Yjs snapshot (base64 encoded).",
      ...requiresAuth,
      responses: {
        200: jsonResponse(NoteWithContentSchema, "Note with content"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Note not found"),
      },
    }),
    async (c) => {
      let notebookId = c.req.param("id")!;
      let noteId = c.req.param("noteId")!;

      const { notebook, error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
      notebookId = notebook!.id;

      const note = await notebooksService.note.getWithContentByIdOrShortId({ idOrShortId: noteId });
      if (!note || note.notebookId !== notebookId) {
        return respond(c, fail(err.notFound("Note")));
      }

      return respond(c, ok(note));
    },
  )

  // Update Note
  .patch(
    "/:id/notes/:noteId",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Update note",
      description: "Update note metadata (title, position).",
      ...requiresAuth,
      responses: {
        200: jsonResponse(NoteSchema, "Updated note"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Note not found"),
      },
    }),
    v("json", UpdateNoteSchema),
    async (c) => {
      let notebookId = c.req.param("id")!;
      let noteId = c.req.param("noteId")!;
      const data = c.req.valid("json");

      const { notebook, error } = await checkNotebookAccess(c, notebookId, "write");
      if (error) return error;
      notebookId = notebook!.id;
      const noteCheck = await requireNoteInNotebook(notebookId, noteId);
      if (!noteCheck.ok) return respond(c, noteCheck);
      noteId = noteCheck.data.id;
      return respond(c, notebooksService.note.update({ id: noteId, data }));
    },
  )

  // Move Note
  .post(
    "/:id/notes/:noteId/move",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Move note",
      description: "Move note to a new parent and/or position.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(NoteSchema, "Moved note"),
        400: jsonResponse(ErrorResponseSchema, "Invalid move (e.g., to own descendant)"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Note not found"),
      },
    }),
    v("json", MoveNoteSchema),
    async (c) => {
      let notebookId = c.req.param("id")!;
      let noteId = c.req.param("noteId")!;
      const { parentId, position } = c.req.valid("json");

      const { notebook, error } = await checkNotebookAccess(c, notebookId, "write");
      if (error) return error;
      notebookId = notebook!.id;
      const noteCheck = await requireNoteInNotebook(notebookId, noteId);
      if (!noteCheck.ok) return respond(c, noteCheck);
      noteId = noteCheck.data.id;
      return respond(c, notebooksService.note.move({ id: noteId, parentId, position }));
    },
  )

  // Delete Note
  .delete(
    "/:id/notes/:noteId",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Delete note",
      description: "Delete a note and all its children.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Note deleted"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Note not found"),
      },
    }),
    async (c) => {
      let notebookId = c.req.param("id")!;
      let noteId = c.req.param("noteId")!;

      const { notebook, error } = await checkNotebookAccess(c, notebookId, "write");
      if (error) return error;
      notebookId = notebook!.id;
      const noteCheck = await requireNoteInNotebook(notebookId, noteId);
      if (!noteCheck.ok) return respond(c, noteCheck);
      noteId = noteCheck.data.id;
      return respondMessage(c, notebooksService.note.remove({ id: noteId }), "Note deleted");
    },
  )

  // Lock Note
  .post(
    "/:id/notes/:noteId/lock",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Lock note",
      description: "Lock a note permanently. Locked notes cannot be edited or restored from versions. This action cannot be undone.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(NoteSchema, "Locked note"),
        400: jsonResponse(ErrorResponseSchema, "Note already locked"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Note not found"),
      },
    }),
    async (c) => {
      let notebookId = c.req.param("id")!;
      let noteId = c.req.param("noteId")!;

      const { notebook, error } = await checkNotebookAccess(c, notebookId, "write");
      if (error) return error;
      notebookId = notebook!.id;
      const noteCheck = await requireNoteInNotebook(notebookId, noteId);
      if (!noteCheck.ok) return respond(c, noteCheck);
      noteId = noteCheck.data.id;
      return respond(c, notebooksService.note.lock({ id: noteId }));
    },
  )

  // Copy Note to Another Notebook
  .post(
    "/:id/notes/:noteId/copy",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Copy note",
      description: "Copy a note to another notebook.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(NoteSchema, "Copied note"),
        403: jsonResponse(ErrorResponseSchema, "Access denied to source or target"),
        404: jsonResponse(ErrorResponseSchema, "Note or target notebook not found"),
      },
    }),
    v("json", CopyNoteSchema),
    async (c) => {
      const user = c.get("user");
      let notebookId = c.req.param("id")!;
      let noteId = c.req.param("noteId")!;
      const { targetNotebookId, targetParentId } = c.req.valid("json");

      // Check source notebook access (read)
      const { notebook: sourceNotebook, error: sourceError } = await checkNotebookAccess(c, notebookId);
      if (sourceError) return sourceError;
      notebookId = sourceNotebook!.id;

      // Check target notebook access (write)
      const { notebook: targetNotebook, error: targetError } = await checkNotebookAccess(c, targetNotebookId, "write");
      if (targetError) return targetError;

      const noteCheck = await requireNoteInNotebook(notebookId, noteId);
      if (!noteCheck.ok) return respond(c, noteCheck);
      noteId = noteCheck.data.id;
      return respond(
        c,
        notebooksService.note.copyToNotebook({
          noteId,
          targetNotebookId: targetNotebook!.id,
          targetParentId,
          creatorId: user.id,
        }),
      );
    },
  )

  // ==========================
  // VERSIONS
  // ==========================

  // List Note Versions
  .get(
    "/:id/notes/:noteId/versions",
    describeRoute({
      tags: ["Notebooks"],
      summary: "List note versions",
      description: "List version history of a note with pagination.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(
          z.object({
            data: z.array(NoteVersionSchema),
            pagination: PaginationResponseSchema,
          }),
          "Version history",
        ),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Note not found"),
      },
    }),
    v("query", PaginationQuerySchema),
    async (c) => {
      let notebookId = c.req.param("id")!;
      let noteId = c.req.param("noteId")!;
      const pagination = parsePagination(c.req.valid("query"));

      const { notebook, error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
      notebookId = notebook!.id;
      const noteCheck = await requireNoteInNotebook(notebookId, noteId);
      if (!noteCheck.ok) return respond(c, noteCheck);
      noteId = noteCheck.data.id;

      const { versions, total } = await notebooksService.note.versions.list({
        noteId,
        pagination,
      });
      return respond(
        c,
        ok({
          data: versions,
          pagination: createPagination(pagination, total),
        }),
      );
    },
  )

  // Get Version Snapshot
  .get(
    "/:id/notes/:noteId/versions/:versionId",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Get version snapshot",
      description: "Get the Yjs snapshot for a specific version (base64 encoded).",
      ...requiresAuth,
      responses: {
        200: jsonResponse(z.object({ yjsSnapshot: z.string() }), "Version snapshot"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Version not found"),
      },
    }),
    async (c) => {
      let notebookId = c.req.param("id")!;
      let noteId = c.req.param("noteId")!;
      const versionId = c.req.param("versionId")!;

      const { notebook, error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
      notebookId = notebook!.id;
      const noteCheck = await requireNoteInNotebook(notebookId, noteId);
      if (!noteCheck.ok) return respond(c, noteCheck);
      noteId = noteCheck.data.id;

      const snapshot = await notebooksService.note.versions.getSnapshot({
        noteId,
        versionId,
      });
      if (!snapshot) {
        return respond(c, fail(err.notFound("Version")));
      }

      return respond(c, ok({ yjsSnapshot: Buffer.from(snapshot).toString("base64") }));
    },
  )

  // ==========================
  // RESTORE & SEARCH
  // ==========================

  // Restore Note from Snapshot
  .post(
    "/:id/notes/:noteId/restore",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Restore note from snapshot",
      description: "Restore snapshot data into an empty target note (used by Restore as New Note).",
      ...requiresAuth,
      responses: {
        200: jsonResponse(NoteSchema, "Restored note"),
        400: jsonResponse(ErrorResponseSchema, "Target note must be empty"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Note not found"),
      },
    }),
    v("json", z.object({ yjsSnapshot: z.string() })),
    async (c) => {
      const user = c.get("user");
      let notebookId = c.req.param("id")!;
      let noteId = c.req.param("noteId")!;
      const { yjsSnapshot } = c.req.valid("json");

      const { notebook, error } = await checkNotebookAccess(c, notebookId, "write");
      if (error) return error;
      notebookId = notebook!.id;
      const noteCheck = await requireNoteInNotebook(notebookId, noteId);
      if (!noteCheck.ok) return respond(c, noteCheck);
      noteId = noteCheck.data.id;
      return respond(
        c,
        notebooksService.note.versions.restore({
          noteId,
          yjsSnapshot,
          createdBy: user.id,
        }),
      );
    },
  )

  // Search Notes
  .get(
    "/:id/search",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Search notes",
      description: "Search notes by title and content within a notebook with pagination.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(
          z.object({
            data: z.array(NoteSchema),
            pagination: PaginationResponseSchema,
          }),
          "Search results",
        ),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Notebook not found"),
      },
    }),
    v("query", z.object({ q: z.string().min(1) }).merge(PaginationQuerySchema)),
    async (c) => {
      let notebookId = c.req.param("id")!;
      const query = c.req.valid("query");
      const pagination = parsePagination(query);

      const { notebook, error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
      notebookId = notebook!.id;

      const { notes: results, total } = await notebooksService.note.search({
        notebookId,
        query: query.q,
        pagination,
      });
      return respond(
        c,
        ok({
          data: results,
          pagination: createPagination(pagination, total),
        }),
      );
    },
  )

  // Get Version with Content
  .get(
    "/:id/notes/:noteId/versions/:versionId/content",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Get version with content",
      description: "Get the Yjs snapshot and markdown content for a specific version.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(
          z.object({
            yjsSnapshot: z.string(),
            contentMd: z.string().nullable(),
          }),
          "Version with content",
        ),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Version not found"),
      },
    }),
    async (c) => {
      let notebookId = c.req.param("id")!;
      let noteId = c.req.param("noteId")!;
      const versionId = c.req.param("versionId")!;

      const { notebook, error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
      notebookId = notebook!.id;
      const noteCheck = await requireNoteInNotebook(notebookId, noteId);
      if (!noteCheck.ok) return respond(c, noteCheck);
      noteId = noteCheck.data.id;

      const version = await notebooksService.note.versions.getWithContent({
        noteId,
        versionId,
      });
      if (!version) {
        return respond(c, fail(err.notFound("Version")));
      }

      return respond(
        c,
        ok({
          yjsSnapshot: Buffer.from(version.yjsSnapshot).toString("base64"),
          contentMd: version.contentMd,
        }),
      );
    },
  )

  // ==========================
  // BACKLINKS
  // ==========================

  // List Backlinks
  .get(
    "/:id/notes/:noteId/backlinks",
    describeRoute({
      tags: ["Notebooks"],
      summary: "List backlinks",
      description: "List notes that link to this note. Filtered by access on the source notebook.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(z.object({ data: z.array(BacklinkSchema) }), "Backlinks"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Note or notebook not found"),
      },
    }),
    async (c) => {
      let notebookId = c.req.param("id")!;
      let noteId = c.req.param("noteId")!;

      const { notebook, error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
      notebookId = notebook!.id;
      const noteCheck = await requireNoteInNotebook(notebookId, noteId);
      if (!noteCheck.ok) return respond(c, noteCheck);
      noteId = noteCheck.data.id;

      const user = c.get("user");
      const items = await notebooksService.note.backlinks.list({
        noteId,
        userId: user.id,
        userGroups: user.memberofGroupIds,
        bypassAccess: hasRole(user, "admin"),
      });

      return respond(c, ok({ data: items }));
    },
  )

  // ==========================
  // GRAPH
  // ==========================

  // Get notebook link graph
  .get(
    "/:id/graph",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Get link graph",
      description: "Return all notes (nodes) and all internal note-links (edges) for the notebook.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(z.object({ data: NoteGraphSchema }), "Graph data"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Notebook not found"),
      },
    }),
    async (c) => {
      let notebookId = c.req.param("id")!;
      const { notebook, error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
      notebookId = notebook!.id;
      const graph = await notebooksService.notebook.graph({ notebookId });
      return respond(c, ok({ data: graph }));
    },
  )

  // ==========================
  // ACCESS CONTROL
  // ==========================

  // List Access Entries
  .get(
    "/:id/access",
    describeRoute({
      tags: ["Notebooks"],
      summary: "List access entries",
      description: "List all access entries for a notebook. Requires admin permission.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(z.array(AccessEntrySchema), "Access entries"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Notebook not found"),
      },
    }),
    async (c) => {
      let notebookId = c.req.param("id")!;

      const { notebook, error } = await checkNotebookAccess(c, notebookId, "admin");
      if (error) return error;
      notebookId = notebook!.id;

      const entries = await notebooksService.notebook.access.list({ notebookId });
      return respond(c, ok(entries.items));
    },
  )

  // Grant Access
  .post(
    "/:id/access",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Grant access",
      description: "Grant access to a user, group, or public. Requires admin permission.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(AccessEntrySchema, "Created access entry"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Notebook, user, or group not found"),
        409: jsonResponse(ErrorResponseSchema, "Principal already has access"),
      },
    }),
    v("json", GrantAccessSchema),
    async (c) => {
      let notebookId = c.req.param("id")!;
      const { principal, permission } = c.req.valid("json");

      const { notebook, error } = await checkNotebookAccess(c, notebookId, "admin");
      if (error) return error;
      notebookId = notebook!.id;
      return respond(
        c,
        notebooksService.notebook.access.grant({
          notebookId,
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
      tags: ["Notebooks"],
      summary: "Update access permission",
      description: "Update the permission level for an access entry. Requires admin permission.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Access updated"),
        400: jsonResponse(ErrorResponseSchema, "Cannot remove last admin"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Access entry not found"),
      },
    }),
    v("json", UpdateAccessSchema),
    async (c) => {
      let notebookId = c.req.param("id")!;
      const accessId = c.req.param("accessId")!;
      const { permission } = c.req.valid("json");

      const { notebook, error } = await checkNotebookAccess(c, notebookId, "admin");
      if (error) return error;
      notebookId = notebook!.id;

      const guard = await notebooksService.notebook.access.guard({
        notebookId,
        accessId,
      });
      if (!guard.currentPermission) {
        return respond(c, fail(err.notFound("Access entry")));
      }

      if (guard.currentPermission === "admin" && permission !== "admin" && guard.otherAdmins <= 0) {
        return respond(c, fail(err.badInput("Cannot remove the last admin")));
      }
      return respondMessage(c, notebooksService.notebook.access.update({ notebookId, accessId, permission }), "Access updated");
    },
  )

  // Revoke Access
  .delete(
    "/:id/access/:accessId",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Revoke access",
      description: "Remove an access entry. Cannot remove the last admin. Requires admin permission.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Access revoked"),
        400: jsonResponse(ErrorResponseSchema, "Cannot remove last access entry or admin"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Access entry not found"),
      },
    }),
    async (c) => {
      let notebookId = c.req.param("id")!;
      const accessId = c.req.param("accessId")!;

      const { notebook, error } = await checkNotebookAccess(c, notebookId, "admin");
      if (error) return error;
      notebookId = notebook!.id;

      const guard = await notebooksService.notebook.access.guard({
        notebookId,
        accessId,
      });
      if (!guard.currentPermission) {
        return respond(c, fail(err.notFound("Access entry")));
      }

      if (guard.total <= 1) {
        return respond(c, fail(err.badInput("Cannot remove the last access entry")));
      }

      if (guard.currentPermission === "admin" && guard.otherAdmins <= 0) {
        return respond(c, fail(err.badInput("Cannot remove the last admin")));
      }
      return respondMessage(
        c,
        notebooksService.notebook.access.remove({
          notebookId,
          accessId,
        }),
        "Access revoked",
      );
    },
  );

// =============================================================================
// Attachments — file/image blobs stored as bytea, FK to notebook (CASCADE)
// =============================================================================

const appWithAttachments = app
  // Upload — multipart with `file` field
  .post(
    "/:id/attachments",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Upload attachment",
      description: `Upload a file blob (image or any other type) to a notebook. Max size is configurable via the \`notebooks.max_attachment_size_mb\` admin setting (default ${DEFAULT_MAX_ATTACHMENT_SIZE_MB} MB).`,
      ...requiresAuth,
      responses: {
        200: jsonResponse(AttachmentSchema, "Uploaded attachment metadata"),
        400: jsonResponse(ErrorResponseSchema, "No file or invalid form"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        413: jsonResponse(ErrorResponseSchema, "File too large"),
      },
    }),
    async (c) => {
      const user = c.get("user");
      let notebookId = c.req.param("id")!;

      const { notebook, error } = await checkNotebookAccess(c, notebookId, "write");
      if (error) return error;
      notebookId = notebook!.id;

      const maxBytes = await getMaxAttachmentSizeBytes();
      const contentLength = Number(c.req.header("content-length") ?? 0);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        return fileTooLarge(c, maxBytes);
      }

      const form = await c.req.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) return respond(c, fail(err.badInput("Missing 'file' field")));
      if (file.size > maxBytes) {
        return fileTooLarge(c, maxBytes);
      }

      const content = new Uint8Array(await file.arrayBuffer());
      const attachment = await notebooksService.attachment.upload({
        notebookId,
        filename: file.name || "untitled",
        mimeType: file.type || "application/octet-stream",
        content,
        userId: user.id,
      });
      return respond(c, ok(attachment));
    },
  )

  // List
  .get(
    "/:id/attachments",
    describeRoute({
      tags: ["Notebooks"],
      summary: "List attachments",
      ...requiresAuth,
      responses: {
        200: jsonResponse(z.array(AttachmentSchema), "All attachments in this notebook"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
      },
    }),
    async (c) => {
      let notebookId = c.req.param("id")!;
      const { notebook, error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
      notebookId = notebook!.id;
      return respond(c, ok(await notebooksService.attachment.list({ notebookId })));
    },
  )

  // Stream content — used by image widgets, file downloads, read-mode renderer
  .get(
    "/:id/attachments/:attId/content",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Download attachment content",
      ...requiresAuth,
      responses: {
        200: { description: "File content stream" },
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Attachment not found"),
      },
    }),
    async (c) => {
      let notebookId = c.req.param("id")!;
      const attId = c.req.param("attId")!;

      const { notebook, error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
      notebookId = notebook!.id;

      // `attId` may be a UUID or a 6-char short-id (markdown bodies use
      // `attach://<shortId>`). The lookup helper branches on length so
      // each query stays on a single-column index.
      const att = await notebooksService.attachment.getContentByIdOrShortId({ idOrShortId: attId });
      if (!att || att.notebookId !== notebookId) return respond(c, fail(err.notFound("Attachment")));

      const isSafeInline =
        att.mimeType === "application/pdf" ||
        att.mimeType === "text/plain" ||
        (att.mimeType.startsWith("image/") && att.mimeType !== "image/svg+xml");
      // `inline` query → render-in-browser only for inert media; else download.
      const inline = isSafeInline && (c.req.query("inline") === "true" || att.kind === "image");
      const disposition = `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(att.filename)}"`;
      // Wrap bytea in a fresh ArrayBuffer slice — Postgres' returned
      // Uint8Array is typed `<ArrayBufferLike>` which TS rejects for `BlobPart`.
      const buffer = att.content.buffer.slice(att.content.byteOffset, att.content.byteOffset + att.content.byteLength) as ArrayBuffer;
      const contentType = inline ? att.mimeType : "application/octet-stream";
      return new Response(new Blob([buffer], { type: contentType }), {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": disposition,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
      });
    },
  )

  // Usage count — used by destructive-delete confirmation
  .get(
    "/:id/attachments/:attId/usage",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Count notes referencing an attachment",
      ...requiresAuth,
      responses: {
        200: jsonResponse(AttachmentUsageSchema, "Usage count"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
      },
    }),
    async (c) => {
      let notebookId = c.req.param("id")!;
      const attIdOrShort = c.req.param("attId")!;
      const { notebook, error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
      notebookId = notebook!.id;
      const att = await notebooksService.attachment.getByIdOrShortId({ idOrShortId: attIdOrShort });
      if (!att || att.notebookId !== notebookId) return respond(c, ok({ count: 0 }));
      const count = await notebooksService.attachment.usageCount({ notebookId, attachmentId: att.id });
      return respond(c, ok({ count }));
    },
  )

  // Get metadata by id — sibling to the `/content` route, but
  // returns the AttachmentSchema (filename, mimeType, sizeBytes,
  // kind, createdAt) without the blob. Used by kit.attachments.get
  // so scripts can resolve a single shortId in O(1) instead of
  // fetching the whole list and filtering client-side. MUST be
  // registered after `/content` and `/usage` so those more
  // specific paths match first (Hono is first-match wins).
  .get(
    "/:id/attachments/:attId",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Get attachment metadata",
      ...requiresAuth,
      responses: {
        200: jsonResponse(AttachmentSchema, "Attachment metadata"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Attachment not found"),
      },
    }),
    async (c) => {
      let notebookId = c.req.param("id")!;
      const attIdOrShort = c.req.param("attId")!;
      const { notebook, error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
      notebookId = notebook!.id;
      const att = await notebooksService.attachment.getByIdOrShortId({ idOrShortId: attIdOrShort });
      if (!att || att.notebookId !== notebookId) return respond(c, fail(err.notFound("Attachment")));
      return respond(c, ok(att));
    },
  )

  // Delete
  .delete(
    "/:id/attachments/:attId",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Delete attachment",
      description: "Removes the blob. Markdown links pointing to it become broken — by design (KISS, no auto-cleanup).",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Deleted"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Attachment not found"),
      },
    }),
    async (c) => {
      let notebookId = c.req.param("id")!;
      const attIdOrShort = c.req.param("attId")!;
      const { notebook, error } = await checkNotebookAccess(c, notebookId, "write");
      if (error) return error;
      notebookId = notebook!.id;
      const att = await notebooksService.attachment.getByIdOrShortId({ idOrShortId: attIdOrShort });
      if (!att || att.notebookId !== notebookId) return respond(c, fail(err.notFound("Attachment")));
      await notebooksService.attachment.remove({ id: att.id });
      return respond(c, ok({ message: "Attachment deleted" }));
    },
  );

// =============================================================================
// Export — portable ZIP archive for lock-in-free backups
// =============================================================================

const appWithExport = appWithAttachments.get(
  "/:id/export.zip",
  describeRoute({
    tags: ["Notebooks"],
    summary: "Export notebook",
    description: "Download a portable ZIP archive with Markdown notes, raw attachments, and JSON metadata.",
    ...requiresAuth,
    responses: {
      200: { description: "Notebook ZIP archive" },
      403: jsonResponse(ErrorResponseSchema, "Access denied"),
      404: jsonResponse(ErrorResponseSchema, "Notebook not found"),
    },
  }),
  async (c) => {
    let notebookId = c.req.param("id")!;
    const { notebook, error } = await checkNotebookAccess(c, notebookId, "admin");
    if (error) return error;
    notebookId = notebook!.id;

    const exported = await notebooksService.exporter.exportNotebookZip({ notebookId });
    if (!exported) return respond(c, fail(err.notFound("Notebook")));

    const buffer = exported.zip.buffer.slice(exported.zip.byteOffset, exported.zip.byteOffset + exported.zip.byteLength) as ArrayBuffer;
    return new Response(new Blob([buffer], { type: "application/zip" }), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(exported.filename)}"`,
        "Cache-Control": "no-store",
      },
    });
  },
);

// =============================================================================
// Tags — list endpoint used by the `/tag` slash-command picker
// =============================================================================

const TagSummarySchema = z.object({
  tag: z.string(),
  count: z.number().int(),
});

const appWithTags = appWithExport.get(
  "/:id/tags",
  describeRoute({
    tags: ["Notebooks"],
    summary: "List notebook tags with usage counts",
    ...requiresAuth,
    responses: {
      200: jsonResponse(z.array(TagSummarySchema), "Tags"),
      403: jsonResponse(ErrorResponseSchema, "Access denied"),
    },
  }),
  async (c) => {
    let notebookId = c.req.param("id")!;
    // Canonicalize: `checkNotebookAccess` accepts either short-id
    // or UUID; the service layer needs the UUID for the SQL cast.
    // Without this re-assignment, callers passing a short-id (kit
    // scripts and any cross-notebook-tolerant frontend) would get
    // an empty result or a `invalid input syntax for type uuid`
    // error from Postgres.
    const { notebook, error } = await checkNotebookAccess(c, notebookId);
    if (error) return error;
    notebookId = notebook!.id;
    return respond(c, ok(await notebooksService.tag.listForNotebook({ notebookId })));
  },
);

// =============================================================================
// Client-facing limits — read-only echo of the user-visible parts of the
// settings so the Help modal / editor frontend can render the current
// numbers instead of hardcoding mirrors of the defaults. Authenticated
// but not admin-gated: these numbers are non-sensitive and visible to
// every user the moment they try an upload anyway.
// =============================================================================

const LimitsSchema = z.object({
  maxAttachmentSizeMb: z.number().int().positive(),
  maxImageDimensionPx: z.number().int().positive(),
});

const appWithLimits = appWithTags.get(
  "/limits",
  describeRoute({
    tags: ["Notebooks"],
    summary: "Current user-facing limits",
    description:
      "Live values of `notebooks.max_attachment_size_mb` and `notebooks.max_image_dimension_px`. Used by the Help modal and the client-side image shrink pipeline so they stay in sync when an admin tweaks the settings.",
    ...requiresAuth,
    responses: {
      200: jsonResponse(LimitsSchema, "Limits"),
    },
  }),
  async (c) => {
    const [maxAttachmentSizeMb, maxImageDimensionPx] = await Promise.all([getMaxAttachmentSizeMb(), getMaxImageDimensionPx()]);
    return respond(c, ok({ maxAttachmentSizeMb, maxImageDimensionPx }));
  },
);

// =============================================================================
// Admin — notebooks-app-level settings (extensible: any setting whose key
// is in the `notebooks` group is exposed here, so future settings just
// need a `defaults.ts` entry to show up in the admin UI without API
// changes). Plus a manual reindex trigger.
// =============================================================================

const NOTEBOOKS_SETTING_GROUP = "notebooks";
const NOTEBOOKS_SETTING_PREFIX = "notebooks.";

const SettingEntrySchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.string(),
  description: z.string(),
  default: z.unknown(),
  value: z.unknown(),
  isCustom: z.boolean(),
});

const UpdateSettingSchema = z.object({
  value: z.unknown(),
});

const requireAdmin = (c: Context<AuthContext>) => {
  const user = c.get("user");
  if (!hasRole(user, "admin")) {
    return respond(c, fail(err.forbidden("Admin access required")));
  }
  return null;
};

const appWithAdmin = appWithLimits
  // List all notebooks-namespaced settings
  .get(
    "/admin/settings",
    describeRoute({
      tags: ["Notebooks", "Admin"],
      summary: "List notebooks-app settings",
      description: "Returns every setting whose key starts with `notebooks.` Admins can update any of them via PUT /admin/settings/:key.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(z.array(SettingEntrySchema), "Notebook settings"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    async (c) => {
      const denied = requireAdmin(c);
      if (denied) return denied;
      const result = await settingsService.entry.list({ filter: { group: NOTEBOOKS_SETTING_GROUP } });
      return respond(c, ok(result.items));
    },
  )

  // Update one setting — key validated to belong to the notebooks namespace
  .put(
    "/admin/settings/:key",
    describeRoute({
      tags: ["Notebooks", "Admin"],
      summary: "Update a notebooks-app setting",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Updated"),
        400: jsonResponse(ErrorResponseSchema, "Invalid key or value"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    v("json", UpdateSettingSchema),
    async (c) => {
      const denied = requireAdmin(c);
      if (denied) return denied;
      const key = c.req.param("key")!;
      if (!key.startsWith(NOTEBOOKS_SETTING_PREFIX)) {
        return respond(c, fail(err.badInput(`Setting "${key}" is not in the notebooks namespace`)));
      }
      const { value } = c.req.valid("json");
      const result = await settingsService.entry.update({ key, value });
      if (!result.ok) return respond(c, result);
      // If the user changed the reindex cron, reschedule live (no restart
      // needed). Logs go to `notebooks:reindex` for observability.
      if (key === "notebooks.reindex_cron" && typeof value === "string") {
        try {
          await reindexRuntime.updateCron(value);
        } catch (error) {
          return respond(
            c,
            fail(err.badInput(`Setting saved but rescheduling failed: ${error instanceof Error ? error.message : String(error)}`)),
          );
        }
      }
      return respond(c, ok({ message: "Setting updated" }));
    },
  )

  // Manual trigger — for the admin's "Run reindex now" action
  .post(
    "/admin/reindex",
    describeRoute({
      tags: ["Notebooks", "Admin"],
      summary: "Run note-refs reindex now",
      description:
        "Submits an immediate reindex job. Returns once submitted — actual work runs async in the scheduler worker. Watch logs for progress.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Reindex submitted"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    async (c) => {
      const denied = requireAdmin(c);
      if (denied) return denied;
      await reindexRuntime.runNow();
      return respond(c, ok({ message: "Reindex submitted" }));
    },
  );

export default appWithAdmin;
export type ApiType = typeof appWithAdmin;

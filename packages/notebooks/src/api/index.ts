import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { v, jsonResponse, requiresAuth, auth, type AuthContext, rateLimit, respond, updateAccess } from "@valentinkolb/cloud/server";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { notebooksService, reindexRuntime } from "../service";
import { settingsService } from "@valentinkolb/cloud/services";
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
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
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
});

const NoteSchema = z.object({
  id: z.uuid(),
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
  parentId: z.uuid().optional(),
  title: z.string().min(1).max(200),
  position: z.number().int().min(0).optional(),
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
  title: z.string(),
  notebookId: z.uuid(),
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

const AttachmentSchema = z.object({
  id: z.uuid(),
  notebookId: z.uuid(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  kind: z.enum(["image", "file"]),
  createdBy: z.uuid().nullable(),
  createdAt: z.string(),
});

const AttachmentUsageSchema = z.object({ count: z.number().int() });

/** 10 MB per-file upload cap. Larger files → 413. */
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

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
 */
const checkNotebookAccess = async (c: Context<AuthContext>, notebookId: string, requiredLevel: PermissionLevel = "read") => {
  const user = c.get("user");
  const notebook = await notebooksService.notebook.get({ id: notebookId });

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
    notebookId,
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
    notebookId,
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
 * Ensures a note belongs to the requested notebook so cross-notebook access is rejected early.
 */
const requireNoteInNotebook = async (notebookId: string, noteId: string) => {
  const note = await notebooksService.note.get({ id: noteId });
  if (!note || note.notebookId !== notebookId) {
    return fail(err.notFound("Note"));
  }
  return ok(note);
};

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
import wsRoutes from "../ws";

const app = new Hono<AuthContext>()
  .route("/widget", widgetRoutes)
  .route("/ws", wsRoutes)
  .use(rateLimit())
  .use(auth.requireRole("authenticated"))

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
      const id = c.req.param("id");

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
      const id = c.req.param("id");
      const data = c.req.valid("json");

      const { error } = await checkNotebookAccess(c, id, "write");
      if (error) return error;
      return respond(c, notebooksService.notebook.update({ id, data }));
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
      const id = c.req.param("id");

      const { error } = await checkNotebookAccess(c, id, "admin");
      if (error) return error;
      return respondMessage(c, notebooksService.notebook.remove({ id }), "Notebook deleted");
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
      const notebookId = c.req.param("id");

      const { error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;

      const tree = await notebooksService.note.getTree({ notebookId });
      return respond(c, ok(tree));
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
      const notebookId = c.req.param("id");
      const query = c.req.valid("query");
      const pagination = parsePagination(query);

      const { error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;

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
      const notebookId = c.req.param("id");
      const data = c.req.valid("json");

      const { error } = await checkNotebookAccess(c, notebookId, "write");
      if (error) return error;
      return respond(
        c,
        notebooksService.note.create({
          data: { ...data, notebookId },
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
      const notebookId = c.req.param("id");
      const noteId = c.req.param("noteId");

      const { error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;

      const note = await notebooksService.note.get({ id: noteId });
      if (!note || note.notebookId !== notebookId) {
        return respond(c, fail(err.notFound("Note")));
      }

      return respond(c, ok(note));
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
      const notebookId = c.req.param("id");
      const noteId = c.req.param("noteId");

      const { error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;

      const note = await notebooksService.note.getWithContent({ id: noteId });
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
      const notebookId = c.req.param("id");
      const noteId = c.req.param("noteId");
      const data = c.req.valid("json");

      const { error } = await checkNotebookAccess(c, notebookId, "write");
      if (error) return error;
      const noteCheck = await requireNoteInNotebook(notebookId, noteId);
      if (!noteCheck.ok) return respond(c, noteCheck);
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
      const notebookId = c.req.param("id");
      const noteId = c.req.param("noteId");
      const { parentId, position } = c.req.valid("json");

      const { error } = await checkNotebookAccess(c, notebookId, "write");
      if (error) return error;
      const noteCheck = await requireNoteInNotebook(notebookId, noteId);
      if (!noteCheck.ok) return respond(c, noteCheck);
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
      const notebookId = c.req.param("id");
      const noteId = c.req.param("noteId");

      const { error } = await checkNotebookAccess(c, notebookId, "write");
      if (error) return error;
      const noteCheck = await requireNoteInNotebook(notebookId, noteId);
      if (!noteCheck.ok) return respond(c, noteCheck);
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
      const notebookId = c.req.param("id");
      const noteId = c.req.param("noteId");

      const { error } = await checkNotebookAccess(c, notebookId, "write");
      if (error) return error;
      const noteCheck = await requireNoteInNotebook(notebookId, noteId);
      if (!noteCheck.ok) return respond(c, noteCheck);
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
      const notebookId = c.req.param("id");
      const noteId = c.req.param("noteId");
      const { targetNotebookId, targetParentId } = c.req.valid("json");

      // Check source notebook access (read)
      const { error: sourceError } = await checkNotebookAccess(c, notebookId);
      if (sourceError) return sourceError;

      // Check target notebook access (write)
      const { error: targetError } = await checkNotebookAccess(c, targetNotebookId, "write");
      if (targetError) return targetError;

      const noteCheck = await requireNoteInNotebook(notebookId, noteId);
      if (!noteCheck.ok) return respond(c, noteCheck);
      return respond(
        c,
        notebooksService.note.copyToNotebook({
          noteId,
          targetNotebookId,
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
      const notebookId = c.req.param("id");
      const noteId = c.req.param("noteId");
      const pagination = parsePagination(c.req.valid("query"));

      const { error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
      const noteCheck = await requireNoteInNotebook(notebookId, noteId);
      if (!noteCheck.ok) return respond(c, noteCheck);

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
      const notebookId = c.req.param("id");
      const noteId = c.req.param("noteId");
      const versionId = c.req.param("versionId");

      const { error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
      const noteCheck = await requireNoteInNotebook(notebookId, noteId);
      if (!noteCheck.ok) return respond(c, noteCheck);

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
      const notebookId = c.req.param("id");
      const noteId = c.req.param("noteId");
      const { yjsSnapshot } = c.req.valid("json");

      const { error } = await checkNotebookAccess(c, notebookId, "write");
      if (error) return error;
      const noteCheck = await requireNoteInNotebook(notebookId, noteId);
      if (!noteCheck.ok) return respond(c, noteCheck);
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
      const notebookId = c.req.param("id");
      const query = c.req.valid("query");
      const pagination = parsePagination(query);

      const { error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;

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
      const notebookId = c.req.param("id");
      const noteId = c.req.param("noteId");
      const versionId = c.req.param("versionId");

      const { error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
      const noteCheck = await requireNoteInNotebook(notebookId, noteId);
      if (!noteCheck.ok) return respond(c, noteCheck);

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
      const notebookId = c.req.param("id");
      const noteId = c.req.param("noteId");

      const { error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
      const noteCheck = await requireNoteInNotebook(notebookId, noteId);
      if (!noteCheck.ok) return respond(c, noteCheck);

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
      const notebookId = c.req.param("id");
      const { error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
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
      const notebookId = c.req.param("id");

      const { error } = await checkNotebookAccess(c, notebookId, "admin");
      if (error) return error;

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
      const notebookId = c.req.param("id");
      const { principal, permission } = c.req.valid("json");

      const { error } = await checkNotebookAccess(c, notebookId, "admin");
      if (error) return error;
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
      const notebookId = c.req.param("id");
      const accessId = c.req.param("accessId");
      const { permission } = c.req.valid("json");

      const { error } = await checkNotebookAccess(c, notebookId, "admin");
      if (error) return error;

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
      return respondMessage(c, updateAccess({ id: accessId, permission }), "Access updated");
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
      const notebookId = c.req.param("id");
      const accessId = c.req.param("accessId");

      const { error } = await checkNotebookAccess(c, notebookId, "admin");
      if (error) return error;

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

app
  // Upload — multipart with `file` field
  .post(
    "/:id/attachments",
    describeRoute({
      tags: ["Notebooks"],
      summary: "Upload attachment",
      description: `Upload a file blob (image or any other type) to a notebook. Max ${MAX_ATTACHMENT_SIZE / 1024 / 1024} MB.`,
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
      const notebookId = c.req.param("id");

      const { error } = await checkNotebookAccess(c, notebookId, "write");
      if (error) return error;

      const form = await c.req.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) return respond(c, fail(err.badInput("Missing 'file' field")));
      if (file.size > MAX_ATTACHMENT_SIZE) {
        return respond(c, fail(err.badInput(`File exceeds ${MAX_ATTACHMENT_SIZE / 1024 / 1024} MB limit`)));
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
      const notebookId = c.req.param("id");
      const { error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
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
      const notebookId = c.req.param("id");
      const attId = c.req.param("attId");

      const { error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;

      const att = await notebooksService.attachment.getContent({ id: attId });
      if (!att || att.notebookId !== notebookId) return respond(c, fail(err.notFound("Attachment")));

      // `inline` query → render-in-browser (images, pdfs); else attachment download
      const inline = c.req.query("inline") === "true" || att.kind === "image";
      const disposition = `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(att.filename)}"`;
      // Wrap bytea in a fresh ArrayBuffer slice — Postgres' returned
      // Uint8Array is typed `<ArrayBufferLike>` which TS rejects for `BlobPart`.
      const buffer = att.content.buffer.slice(att.content.byteOffset, att.content.byteOffset + att.content.byteLength) as ArrayBuffer;
      return new Response(new Blob([buffer], { type: att.mimeType }), {
        headers: {
          "Content-Type": att.mimeType,
          "Content-Disposition": disposition,
          "Cache-Control": "private, max-age=300",
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
      const notebookId = c.req.param("id");
      const attId = c.req.param("attId");
      const { error } = await checkNotebookAccess(c, notebookId);
      if (error) return error;
      const count = await notebooksService.attachment.usageCount({ notebookId, attachmentId: attId });
      return respond(c, ok({ count }));
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
      const notebookId = c.req.param("id");
      const attId = c.req.param("attId");
      const { error } = await checkNotebookAccess(c, notebookId, "write");
      if (error) return error;
      const att = await notebooksService.attachment.get({ id: attId });
      if (!att || att.notebookId !== notebookId) return respond(c, fail(err.notFound("Attachment")));
      await notebooksService.attachment.remove({ id: attId });
      return respond(c, ok({ message: "Attachment deleted" }));
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

app
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
      const key = c.req.param("key");
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
          return respond(c, fail(err.badInput(`Setting saved but rescheduling failed: ${error instanceof Error ? error.message : String(error)}`)));
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
      description: "Submits an immediate reindex job. Returns once submitted — actual work runs async in the scheduler worker. Watch logs for progress.",
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

export default app;
export type ApiType = typeof app;

import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { v, jsonResponse, requiresAuth, auth, type AuthContext, rateLimit, respond, updateAccess } from "@valentinkolb/cloud/server";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { notebooksService } from "../service";
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

const app = new Hono<AuthContext>()
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

export default app;
export type ApiType = typeof app;

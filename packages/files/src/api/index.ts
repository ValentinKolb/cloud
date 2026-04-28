import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { v, jsonResponse, requiresIpaUser, auth, type AuthContext, respond } from "@valentinkolb/cloud/server";
import { err, fail, ok } from "@valentinkolb/stdlib";
import { filesService } from "../service";
import type { FileBase } from "@/contracts";
import {
  FileInfoResponseSchema,
  FileInfoSchema,
  FileBaseInfoSchema,
  ListFilesQuerySchema,
  FileActionQuerySchema,
  ErrorResponseSchema,
  GlobalSearchQuerySchema,
  GlobalSearchResponseSchema,
  ChunkedUploadStartSchema,
  ChunkedUploadStartResponseSchema,
  ChunkedUploadChunkQuerySchema,
  ChunkedUploadResponseSchema,
  MoveTargetSearchQuerySchema,
  MoveTargetSearchResponseSchema,
  TransferRequestSchema,
  TransferResultSchema,
  DuplicateRequestSchema,
} from "@/contracts";

/**
 * Resolves the requested file base and verifies access for the current user before running file operations.
 */
const requireBaseAccess = async (c: Context<AuthContext>) => {
  const user = c.get("user");
  const baseType = c.req.param("baseType")!;
  const baseId = c.req.param("baseId")!;

  const base = await filesService.base.get({ baseType, baseId });
  if (!base.ok) {
    return {
      base: null,
      error: await respond(c, base),
    };
  }

  const access = await filesService.base.permission.canAccess({
    user,
    base: base.data,
  });
  if (!access.ok) {
    return {
      base: null,
      error: await respond(c, access),
    };
  }

  return { base: base.data };
};

/** File management routes. Only for full IPA users. */
const app = new Hono<AuthContext>()
  .use(auth.requireAccount({ provider: "ipa", profile: "user" }))

  // Get current user's home directory info
  .get(
    "/home",
    describeRoute({
      tags: ["Files"],
      summary: "Get home directory info",
      description: "Returns info about the current user's home directory. Requires a POSIX UID.",
      ...requiresIpaUser,
      responses: {
        200: jsonResponse(FileBaseInfoSchema, "Home directory info"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        404: jsonResponse(ErrorResponseSchema, "No home directory (user has no uidNumber)"),
      },
    }),
    async (c) => {
      const user = c.get("user");

      // User needs uidNumber for home directory
      if (!user.ipa?.uidNumber) {
        return respond(c, fail(err.notFound("No home directory (missing uidNumber)")));
      }

      return respond(
        c,
        ok({
          type: "home" as const,
          id: user.uid,
          name: `Home (${user.displayName})`,
        }),
      );
    },
  )

  // List accessible file bases (home + groups)
  .get(
    "/bases",
    describeRoute({
      tags: ["Files"],
      summary: "List accessible file bases",
      description: "Returns list of file bases the user can access (home directory + group directories).",
      ...requiresIpaUser,
      responses: {
        200: jsonResponse(z.array(FileBaseInfoSchema), "List of accessible bases"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    async (c) => {
      const user = c.get("user");
      const bases = await filesService.base.list({ user });
      return respond(c, ok(bases.items));
    },
  )

  // Global search across all accessible bases
  .get(
    "/search",
    describeRoute({
      tags: ["Files"],
      summary: "Search files globally",
      description:
        "Search for files across all accessible bases (or specific bases if provided). " +
        "Uses glob patterns for matching (e.g. '**/*.pdf', '*.{jpg,png}').",
      ...requiresIpaUser,
      responses: {
        200: jsonResponse(GlobalSearchResponseSchema, "Search results grouped by base"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    v("query", GlobalSearchQuerySchema),
    async (c) => {
      const user = c.get("user");
      const { pattern, showHidden, limit, bases: basesParam } = c.req.valid("query");

      // Get all accessible bases for this user
      const allBases = await filesService.base.listResolved({ user });

      // Filter to specific bases if requested
      let basesToSearch: FileBase[];
      if (basesParam) {
        const requestedBases = basesParam.split(",").map((b) => b.trim());
        basesToSearch = [];

        for (const baseStr of requestedBases) {
          const [type, id] = baseStr.split(":");
          if (!type || !id) continue;

          // Find matching base in user's accessible bases
          const matchingBase = allBases.find((b) => {
            if (type === "home" && b.type === "home") return b.uid === id;
            if (type === "group" && b.type === "group") return b.name === id;
            return false;
          });

          if (matchingBase) {
            basesToSearch.push(matchingBase);
          }
        }

        if (basesToSearch.length === 0) {
          return respond(c, fail(err.badInput("No accessible bases match the provided filter")));
        }
      } else {
        basesToSearch = allBases;
      }

      const result = await filesService.search.list({
        bases: basesToSearch,
        pattern,
        showHidden,
        limit,
      });

      return respond(c, result);
    },
  )

  // Get file/directory info (unified endpoint)
  .get(
    "/:baseType/:baseId",
    describeRoute({
      tags: ["Files"],
      summary: "Get file or directory info",
      description:
        "Returns info about a file or directory. For directories, includes a listing of contents. " +
        "For files, returns only metadata (use /content endpoint to download).",
      ...requiresIpaUser,
      responses: {
        200: jsonResponse(FileInfoResponseSchema, "File info or directory listing"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("query", ListFilesQuerySchema),
    async (c) => {
      const query = c.req.valid("query");

      const { base, error } = await requireBaseAccess(c);
      if (error || !base) return error!;

      const result = await filesService.item.get({
        base,
        path: query.path,
        showHidden: query.showHidden,
      });

      return respond(c, result);
    },
  )

  // Download file content
  .get(
    "/:baseType/:baseId/content",
    describeRoute({
      tags: ["Files"],
      summary: "Download file",
      description: "Download the content of a file. Use inline=true for browser preview (Content-Disposition: inline).",
      ...requiresIpaUser,
      responses: {
        200: { description: "File content stream" },
        400: jsonResponse(ErrorResponseSchema, "Invalid request or path is a directory"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "File not found"),
      },
    }),
    v("query", z.object({ path: z.string(), inline: z.coerce.boolean().optional() })),
    async (c) => {
      const { path, inline } = c.req.valid("query");

      const { base, error } = await requireBaseAccess(c);
      if (error || !base) return error!;

      const result = await filesService.item.download({ base, path, inline });
      if (!result.ok) return respond(c, result);

      const disposition = result.data.inline ? "inline" : "attachment";
      return new Response(result.data.stream, {
        headers: {
          "Content-Type": result.data.contentType,
          "Content-Disposition": `${disposition}; filename="${encodeURIComponent(result.data.filename)}"`,
          "Content-Length": String(result.data.size),
        },
      });
    },
  )

  // Get image thumbnail
  .get(
    "/:baseType/:baseId/thumbnail",
    describeRoute({
      tags: ["Files"],
      summary: "Get image thumbnail",
      description: "Generate a thumbnail for an image file. Returns 200x200 WebP with preserved aspect ratio.",
      ...requiresIpaUser,
      responses: {
        200: { description: "Thumbnail image (WebP)" },
        400: jsonResponse(ErrorResponseSchema, "Not an image or unsupported format"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "File not found"),
      },
    }),
    v("query", z.object({ path: z.string() })),
    async (c) => {
      const { path } = c.req.valid("query");

      const { base, error } = await requireBaseAccess(c);
      if (error || !base) return error!;

      const result = await filesService.item.thumbnail({ base, path });
      if (!result.ok) return respond(c, result);

      return result.data.response;
    },
  )

  // Upload file
  .put(
    "/:baseType/:baseId/content",
    describeRoute({
      tags: ["Files"],
      summary: "Upload file",
      description: "Upload a file to the specified path. The filename is taken from the X-File-Name header.",
      ...requiresIpaUser,
      responses: {
        201: jsonResponse(FileInfoSchema, "File uploaded successfully"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
      },
    }),
    v("query", z.object({ path: z.string().default("/") })),
    v("header", z.object({ "x-file-name": z.string() })),
    async (c) => {
      const { path } = c.req.valid("query");
      const filename = c.req.valid("header")["x-file-name"];

      const { base, error } = await requireBaseAccess(c);
      if (error || !base) return error!;

      const body = await c.req.arrayBuffer();
      const result = await filesService.item.upload({
        base,
        path,
        content: body,
        filename,
      });

      return respond(c, result, 201);
    },
  )

  // File actions: mkdir, move, copy
  .post(
    "/:baseType/:baseId",
    describeRoute({
      tags: ["Files"],
      summary: "Perform file action",
      description: "Create directory, move, or copy files. Use query params: action (mkdir|move|copy), path, to (for move/copy).",
      ...requiresIpaUser,
      responses: {
        200: jsonResponse(FileInfoSchema, "Action completed successfully"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Source not found"),
      },
    }),
    v("query", FileActionQuerySchema),
    async (c) => {
      const { action, path, to } = c.req.valid("query");

      const { base, error } = await requireBaseAccess(c);
      if (error || !base) return error!;

      switch (action) {
        case "mkdir":
          return respond(c, await filesService.item.createDirectory({ base, path }));
        case "move":
          if (!to) return respond(c, fail(err.badInput("Missing 'to' parameter for move action")));
          return respond(c, await filesService.item.move({ base, from: path, to }));
        case "copy":
          if (!to) return respond(c, fail(err.badInput("Missing 'to' parameter for copy action")));
          return respond(c, await filesService.item.copy({ base, from: path, to }));
      }
    },
  )

  // Delete file or directory
  .delete(
    "/:baseType/:baseId",
    describeRoute({
      tags: ["Files"],
      summary: "Delete file or directory",
      description: "Delete a file or directory (recursive for directories).",
      ...requiresIpaUser,
      responses: {
        204: { description: "Successfully deleted" },
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("query", z.object({ path: z.string() })),
    async (c) => {
      const { path } = c.req.valid("query");

      const { base, error } = await requireBaseAccess(c);
      if (error || !base) return error!;

      const result = await filesService.item.remove({ base, path });
      if (!result.ok) return respond(c, result);

      return c.body(null, 204);
    },
  )

  // ==========================================================================
  // Move/Copy Endpoints
  // ==========================================================================

  // Search directories for move/copy target
  .get(
    "/:baseType/:baseId/directories",
    describeRoute({
      tags: ["Files"],
      summary: "Search directories for move target",
      description: "Search for directories within a base to use as move/copy destination.",
      ...requiresIpaUser,
      responses: {
        200: jsonResponse(MoveTargetSearchResponseSchema, "Directory search results"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
      },
    }),
    v("query", MoveTargetSearchQuerySchema),
    async (c) => {
      const user = c.get("user");
      const { query, targetBaseType, targetBaseId, limit } = c.req.valid("query");

      // Parse and verify access to target base
      const targetBase = await filesService.base.get({
        baseType: targetBaseType,
        baseId: targetBaseId,
      });
      if (!targetBase.ok) return respond(c, targetBase);

      const access = await filesService.base.permission.canAccess({
        user,
        base: targetBase.data,
      });
      if (!access.ok) return respond(c, access);

      const result = await filesService.item.searchDirectories({
        base: targetBase.data,
        query,
        limit,
      });

      return respond(c, result);
    },
  )

  // Transfer (move/copy) files
  .post(
    "/:baseType/:baseId/transfer",
    describeRoute({
      tags: ["Files"],
      summary: "Move or copy files",
      description:
        "Transfer files to another location. Same-base transfers use move (preserves permissions), " +
        "cross-base transfers use copy (adjusts permissions for destination).",
      ...requiresIpaUser,
      responses: {
        200: jsonResponse(TransferResultSchema, "Transfer completed"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
      },
    }),
    v("json", TransferRequestSchema),
    async (c) => {
      const user = c.get("user");
      const sourceBaseType = c.req.param("baseType")!;
      const sourceBaseId = c.req.param("baseId")!;
      const { paths: sourcePaths, targetBaseType, targetBaseId, targetPath } = c.req.valid("json");

      // Parse and verify access to source base
      const sourceBase = await filesService.base.get({
        baseType: sourceBaseType,
        baseId: sourceBaseId,
      });
      if (!sourceBase.ok) return respond(c, sourceBase);

      const sourceAccess = await filesService.base.permission.canAccess({
        user,
        base: sourceBase.data,
      });
      if (!sourceAccess.ok) return respond(c, sourceAccess);

      // Parse and verify access to target base
      const targetBase = await filesService.base.get({
        baseType: targetBaseType,
        baseId: targetBaseId,
      });
      if (!targetBase.ok) return respond(c, targetBase);

      const targetAccess = await filesService.base.permission.canAccess({
        user,
        base: targetBase.data,
      });
      if (!targetAccess.ok) return respond(c, targetAccess);

      const result = await filesService.transfer.execute({
        sourceBase: sourceBase.data,
        targetBase: targetBase.data,
        sourcePaths,
        targetPath,
      });

      return respond(c, result);
    },
  )

  // Duplicate file or folder
  .post(
    "/:baseType/:baseId/duplicate",
    describeRoute({
      tags: ["Files"],
      summary: "Duplicate file or folder",
      description: "Create a copy of a file or folder in the same directory with a new name.",
      ...requiresIpaUser,
      responses: {
        200: jsonResponse(FileInfoSchema, "Duplicate created"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Source not found"),
      },
    }),
    v("json", DuplicateRequestSchema),
    async (c) => {
      const { path, newName } = c.req.valid("json");

      const { base, error } = await requireBaseAccess(c);
      if (error || !base) return error!;

      const result = await filesService.item.duplicate({
        base,
        path,
        newName,
      });

      return respond(c, result);
    },
  )

  // ==========================================================================
  // Chunked Upload Endpoints
  // ==========================================================================

  // Start chunked upload
  .post(
    "/:baseType/:baseId/upload",
    describeRoute({
      tags: ["Files"],
      summary: "Start chunked upload",
      description:
        "Initialize a chunked upload session. Returns an uploadId for subsequent chunk uploads. " +
        "The checksum must be the SHA-256 hash of the entire file in format 'sha256:<64 hex chars>'.",
      ...requiresIpaUser,
      responses: {
        200: jsonResponse(ChunkedUploadStartResponseSchema, "Upload session started"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
      },
    }),
    v("query", z.object({ path: z.string().default("/") })),
    v("json", ChunkedUploadStartSchema),
    async (c) => {
      const { path } = c.req.valid("query");
      const body = c.req.valid("json");

      const { base, error } = await requireBaseAccess(c);
      if (error || !base) return error!;

      const result = await filesService.upload.start({
        base,
        path,
        filename: body.filename,
        size: body.size,
        checksum: body.checksum,
        chunkSize: body.chunkSize,
      });

      return respond(c, result);
    },
  )

  // Upload chunk
  .put(
    "/:baseType/:baseId/upload/:uploadId",
    describeRoute({
      tags: ["Files"],
      summary: "Upload chunk",
      description:
        "Upload a single chunk of a chunked upload. The chunk index is specified in the query parameter. " +
        "Returns progress info or completion info when the last chunk is uploaded.",
      ...requiresIpaUser,
      responses: {
        200: jsonResponse(ChunkedUploadResponseSchema, "Chunk uploaded (progress or complete)"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Upload session not found"),
      },
    }),
    v("query", ChunkedUploadChunkQuerySchema),
    v("header", z.object({ "x-chunk-checksum": z.string().optional() })),
    async (c) => {
      const uploadId = c.req.param("uploadId")!;
      const { index } = c.req.valid("query");
      const checksum = c.req.valid("header")["x-chunk-checksum"];

      // Verify access to the base (upload session is tied to a base)
      const { base, error } = await requireBaseAccess(c);
      if (error || !base) return error!;

      const body = await c.req.blob();
      const result = await filesService.upload.chunk({
        uploadId,
        index,
        data: body,
        checksum,
      });

      return respond(c, result);
    },
  );

export default app;
export type ApiType = typeof app;

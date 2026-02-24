import { Hono } from "hono";
import { rateLimit } from "@valentinkolb/cloud/lib/server";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { v } from "@valentinkolb/cloud/lib/server";
import { jsonResponse, requiresAdmin } from "@valentinkolb/cloud/lib/server";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import { respond } from "@valentinkolb/cloud/lib/server";
import { ok } from "@valentinkolb/cloud/lib/server";
import { loggingService } from "./service";
import {
  LogEntrySchema,
  LogLevelSchema,
  ErrorResponseSchema,
  PaginationQuerySchema,
  PaginationResponseSchema,
} from "@/logging/contracts";
import { parsePagination, createPagination } from "@/logging/contracts";

const LogListResponseSchema = z.object({
  entries: z.array(LogEntrySchema),
  pagination: PaginationResponseSchema,
});

const app = new Hono<AuthContext>()
  .use(rateLimit())
  .use(auth.requireRole("admin"))

  // List logs (paginated, filterable)
  .get(
    "/",
    describeRoute({
      tags: ["Logs"],
      summary: "List log entries",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(LogListResponseSchema, "Paginated log entries"),
      },
    }),
    v(
      "query",
      PaginationQuerySchema.extend({
        source: z.string().optional(),
        level: LogLevelSchema.optional(),
        search: z.string().optional(),
      }),
    ),
    async (c) => {
      const query = c.req.valid("query");
      const pagination = parsePagination(query);

      const { items, total } = await loggingService.entry.list({
        pagination,
        filter: {
          source: query.source,
          level: query.level,
          search: query.search,
        },
      });

      return respond(
        c,
        ok({
          entries: items,
          pagination: createPagination(pagination, total),
        }),
      );
    },
  )

  // Get all unique source names
  .get(
    "/sources",
    describeRoute({
      tags: ["Logs"],
      summary: "List log sources",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(z.object({ sources: z.array(z.string()) }), "List of unique source names"),
      },
    }),
    async (c) => {
      const sources = await loggingService.source.list();
      return respond(c, ok({ sources }));
    },
  )

  // Cleanup old logs
  .delete(
    "/cleanup",
    describeRoute({
      tags: ["Logs"],
      summary: "Delete old log entries",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(z.object({ deleted: z.number() }), "Number of deleted entries"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
      },
    }),
    v("query", z.object({ days: z.coerce.number().int().min(1).default(30) })),
    async (c) => {
      const { days } = c.req.valid("query");
      return respond(c, loggingService.entry.cleanup({ days }));
    },
  );

export default app;
export type ApiType = typeof app;

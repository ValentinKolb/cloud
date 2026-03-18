import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { v } from "@valentinkolb/cloud-lib/server";
import { jsonResponse, requiresAdmin } from "@valentinkolb/cloud-lib/server/middleware/openapi";
import { auth, type AuthContext } from "@valentinkolb/cloud-lib/server/middleware/auth";
import { respond } from "@valentinkolb/cloud-lib/server/api";
import { ok } from "@valentinkolb/cloud-lib/server/services";
import { accountLifecycle, lifecycleJobs } from "@valentinkolb/cloud-core/services";
import { ErrorResponseSchema, MessageResponseSchema, PaginationQuerySchema, createPagination, parsePagination } from "@valentinkolb/cloud-contracts/shared";

const DeletedAccountSchema = z.object({
  id: z.uuid(),
  deletedUserId: z.uuid(),
  uid: z.string(),
  mail: z.string().nullable(),
  displayName: z.string().nullable(),
  previousRealm: z.string().nullable(),
  reason: z.string(),
  deletedAt: z.string().datetime(),
  meta: z.record(z.string(), z.unknown()),
});

const ReminderAuditSchema = z.object({
  id: z.uuid(),
  userId: z.uuid().nullable(),
  uid: z.string().nullable(),
  mail: z.string().nullable(),
  displayName: z.string().nullable(),
  kind: z.enum(["account_expiry"]),
  thresholdDays: z.number().int().positive(),
  targetExpiryAt: z.string().datetime(),
  status: z.enum(["pending", "sent", "error"]),
  attemptCount: z.number().int().nonnegative(),
  lastAttemptAt: z.string().datetime().nullable(),
  sentAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime(),
});

const DeletedAccountsResponseSchema = z.object({
  items: z.array(DeletedAccountSchema),
  pagination: z.object({
    page: z.number(),
    per_page: z.number(),
    total: z.number(),
    total_pages: z.number(),
    has_next: z.boolean(),
  }),
});

const ReminderAuditResponseSchema = z.object({
  items: z.array(ReminderAuditSchema),
  pagination: z.object({
    page: z.number(),
    per_page: z.number(),
    total: z.number(),
    total_pages: z.number(),
    has_next: z.boolean(),
  }),
});

const TriggerJobResponseSchema = z.object({
  message: z.string(),
  jobId: z.string(),
});

const app = new Hono<AuthContext>()
  .use(auth.requireRole("admin"))
  .get(
    "/deleted-accounts",
    describeRoute({
      tags: ["Admin Lifecycle"],
      summary: "List deleted account lifecycle entries",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(DeletedAccountsResponseSchema, "Deleted account lifecycle entries"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    v(
      "query",
      z.object({
        ...PaginationQuerySchema.shape,
        reason: z.string().optional(),
        search: z.string().optional(),
      }),
    ),
    async (c) => {
      const query = c.req.valid("query");
      const pagination = parsePagination(query);
      const result = await accountLifecycle.listDeletedAccounts({
        page: pagination.page,
        perPage: pagination.perPage,
        reason: query.reason,
        search: query.search,
      });

      return c.json({
        items: result.items,
        pagination: createPagination(pagination, result.total),
      });
    },
  )
  .get(
    "/reminders",
    describeRoute({
      tags: ["Admin Lifecycle"],
      summary: "List reminder history entries",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(ReminderAuditResponseSchema, "Reminder history entries"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    v(
      "query",
      z.object({
        ...PaginationQuerySchema.shape,
        status: z.enum(["pending", "sent", "error"]).optional(),
        kind: z.enum(["account_expiry"]).optional(),
        search: z.string().optional(),
      }),
    ),
    async (c) => {
      const query = c.req.valid("query");
      const pagination = parsePagination(query);
      const result = await accountLifecycle.listReminderAudit({
        page: pagination.page,
        perPage: pagination.perPage,
        status: query.status,
        kind: query.kind,
        search: query.search,
      });

      return c.json({
        items: result.items,
        pagination: createPagination(pagination, result.total),
      });
    },
  )
  .post(
    "/run-sync",
    describeRoute({
      tags: ["Admin Lifecycle"],
      summary: "Trigger IPA sync now",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(TriggerJobResponseSchema, "Sync job submitted"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    async (c) =>
      respond(c, async () => {
        const jobId = await lifecycleJobs.submitIpaSync();
        return ok({ message: "IPA sync job submitted", jobId });
      }),
  )
  .post(
    "/backfill/ipa",
    describeRoute({
      tags: ["Admin Lifecycle"],
      summary: "Run IPA expiry backfill job",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(TriggerJobResponseSchema, "Backfill job submitted"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    async (c) =>
      respond(c, async () => {
        const jobId = await lifecycleJobs.submitIpaBackfill();
        return ok({ message: "IPA backfill job submitted", jobId });
      }),
  )
  .post(
    "/backfill/local-user",
    describeRoute({
      tags: ["Admin Lifecycle"],
      summary: "Run local user expiry backfill job",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(TriggerJobResponseSchema, "Backfill job submitted"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    async (c) =>
      respond(c, async () => {
        const jobId = await lifecycleJobs.submitLocalUserBackfill();
        return ok({ message: "Local user backfill job submitted", jobId });
      }),
  )
  .post(
    "/backfill/guest",
    describeRoute({
      tags: ["Admin Lifecycle"],
      summary: "Run local guest expiry backfill job",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(TriggerJobResponseSchema, "Backfill job submitted"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    async (c) =>
      respond(c, async () => {
        const jobId = await lifecycleJobs.submitGuestBackfill();
        return ok({ message: "Local guest backfill job submitted", jobId });
      }),
  )
  .post(
    "/run-reminders",
    describeRoute({
      tags: ["Admin Lifecycle"],
      summary: "Trigger reminder run now",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(TriggerJobResponseSchema, "Reminder job submitted"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    async (c) =>
      respond(c, async () => {
        const jobId = await lifecycleJobs.submitReminderRun();
        return ok({ message: "Reminder job submitted", jobId });
      }),
  )
  .get(
    "/health",
    describeRoute({
      tags: ["Admin Lifecycle"],
      summary: "Scheduler health metrics",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(z.object({ metrics: z.record(z.string(), z.unknown()) }), "Scheduler metrics"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    async (c) => c.json({ metrics: lifecycleJobs.metrics() }),
  )
  .get(
    "/",
    describeRoute({
      tags: ["Admin Lifecycle"],
      summary: "Lifecycle API root",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Lifecycle API available"),
      },
    }),
    (c) => c.json({ message: "Account lifecycle admin API" }),
  );

export default app;
export type ApiType = typeof app;

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { v, jsonResponse, requiresAdmin, auth, type AuthContext, respond } from "@valentinkolb/cloud/server";
import { err, fail, ok } from "@valentinkolb/stdlib";
import { accountsAppService as accountsService } from "@valentinkolb/cloud/services";
import {
  ErrorResponseSchema,
  MessageResponseSchema,
  PaginationQuerySchema,
  PaginationResponseSchema,
  createPagination,
  hasRole,
  parsePagination,
} from "@/contracts";

const DenyRequestSchema = z.object({
  reason: z.string().optional().describe("Reason for denial (triggers email if provided)"),
});

const AccountRequestSchema = z.object({
  id: z.uuid(),
  userId: z.uuid().nullable(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  displayName: z.string().nullable(),
  phone: z.string().nullable(),
  comment: z.string().nullable(),
  status: z.enum(["pending", "completed", "denied"]),
  createdAt: z.string().datetime(),
});

const AccountRequestListResponseSchema = z.object({
  requests: z.array(AccountRequestSchema),
  pagination: PaginationResponseSchema,
});

/**
 * Admin-side account request routes. Self-service (submit / withdraw own) is
 * owned by core and lives at /api/me/account-request.
 */
const app = new Hono<AuthContext>()
  .use(auth.requireRole("admin"))

  .get(
    "/",
    describeRoute({
      tags: ["Account Requests"],
      summary: "List account requests",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(AccountRequestListResponseSchema, "List of requests"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    v(
      "query",
      z.object({
        ...PaginationQuerySchema.shape,
        status: z.enum(["pending", "completed", "denied"]).optional(),
        scope: z.enum(["open", "processed", "all"]).optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const query = c.req.valid("query");
      const pagination = parsePagination(query);
      const requestsPage = await accountsService.accountRequest.list({
        access: {
          userId: user.id,
          isAdmin: hasRole(user, "admin"),
        },
        pagination: { page: pagination.page, perPage: pagination.perPage },
        filter: { status: query.status, scope: query.scope },
      });

      return respond(
        c,
        ok({
          requests: requestsPage.items,
          pagination: createPagination(pagination, requestsPage.total),
        }),
      );
    },
  )

  .get(
    "/:id",
    describeRoute({
      tags: ["Account Requests"],
      summary: "Get account request by ID",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(AccountRequestSchema, "Request details"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
        404: jsonResponse(ErrorResponseSchema, "Request not found"),
      },
    }),
    async (c) => {
      const user = c.get("user");
      const id = c.req.param("id");
      if (!id) return respond(c, fail(err.badInput("Missing account request ID")));

      return respond(
        c,
        accountsService.accountRequest.get({
          id,
          access: {
            userId: user.id,
            isAdmin: hasRole(user, "admin"),
          },
        }),
      );
    },
  )

  .post(
    "/:id/deny",
    describeRoute({
      tags: ["Account Requests"],
      summary: "Deny account request",
      description: "Admins can deny pending requests. If reason is provided, an email is sent to the user.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Request denied"),
        400: jsonResponse(ErrorResponseSchema, "Request not pending"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
        404: jsonResponse(ErrorResponseSchema, "Request not found"),
      },
    }),
    v("json", DenyRequestSchema),
    async (c) => {
      const user = c.get("user");
      const id = c.req.param("id");
      if (!id) return respond(c, fail(err.badInput("Missing account request ID")));
      const { reason } = c.req.valid("json");

      return respond(c, async () => {
        const result = await accountsService.accountRequest.deny({
          id,
          reason,
          actor: {
            userId: user.id,
            uid: user.uid,
            roles: user.roles,
            provider: user.provider,
          },
        });
        if (!result.ok) return result;
        return ok({ message: "Request denied" });
      });
    },
  );

export default app;

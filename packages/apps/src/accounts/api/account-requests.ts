import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { v } from "@valentinkolb/cloud/lib/server";
import { jsonResponse, requiresAuth, requiresAdmin } from "@valentinkolb/cloud/lib/server";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import { respond } from "@valentinkolb/cloud/lib/server";
import { ok } from "@valentinkolb/cloud/lib/server";
import { accountsService } from "../service";
import {
  ErrorResponseSchema,
  MessageResponseSchema,
  PaginationQuerySchema,
  PaginationResponseSchema,
  createPagination,
  hasRole,
  parsePagination,
} from "@/accounts/contracts";

const CreateAccountRequestSchema = z.object({
  comment: z.string().optional().describe("Why do you need an account?"),
  acceptedAgb: z.literal(true).describe("Must accept terms of service"),
});

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

const AccountRequestResponseSchema = z.object({
  id: z.uuid(),
  message: z.string(),
});

/** Account request routes */
const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))

  // Create account request (Guest only)
  .post(
    "/",
    describeRoute({
      tags: ["Account Requests"],
      summary: "Create account request",
      description: "Guest users can request an IPA account. Must accept terms of service.",
      ...requiresAuth,
      responses: {
        201: jsonResponse(AccountRequestResponseSchema, "Request created"),
        400: jsonResponse(ErrorResponseSchema, "Validation error"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Only guest users can request accounts"),
        409: jsonResponse(ErrorResponseSchema, "Pending request already exists"),
      },
    }),
    v("json", CreateAccountRequestSchema),
    async (c) => {
      const user = c.get("user");
      const data = c.req.valid("json");

      return respond(
        c,
        accountsService.accountRequest.create({
          user,
          data,
        }),
        201,
      );
    },
  )

  // List account requests (Admin only for all, or own for users)
  .get(
    "/",
    describeRoute({
      tags: ["Account Requests"],
      summary: "List account requests",
      description: "Admins see all requests, users see only their own pending requests.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(AccountRequestListResponseSchema, "List of requests"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
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

  // Get single request by ID
  .get(
    "/:id",
    describeRoute({
      tags: ["Account Requests"],
      summary: "Get account request by ID",
      description: "Get details of a specific account request. Admins can access any, users only their own.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(AccountRequestSchema, "Request details"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Request not found"),
      },
    }),
    async (c) => {
      const user = c.get("user");
      const id = c.req.param("id");

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

  // Withdraw request (Owner only, only if pending)
  .delete(
    "/:id",
    describeRoute({
      tags: ["Account Requests"],
      summary: "Withdraw account request",
      description: "Users can withdraw their own pending requests.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Request withdrawn"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Access denied or request not pending"),
        404: jsonResponse(ErrorResponseSchema, "Request not found"),
      },
    }),
    async (c) => {
      const user = c.get("user");
      const id = c.req.param("id");

      return respond(c, async () => {
        const result = await accountsService.accountRequest.withdraw({
          id,
          userId: user.id,
        });
        if (!result.ok) return result;
        return ok({ message: "Request withdrawn" });
      });
    },
  )

  // Deny request (Admin only)
  .post(
    "/:id/deny",
    auth.requireRole("admin"),
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
      const { reason } = c.req.valid("json");

      return respond(c, async () => {
        const result = await accountsService.accountRequest.deny({
          id,
          reason,
          processedBy: user.id,
        });
        if (!result.ok) return result;
        return ok({ message: "Request denied" });
      });
    },
  );

export default app;

import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { v } from "@valentinkolb/cloud/lib/server";
import { jsonResponse, requiresAdmin, requiresIpa } from "@valentinkolb/cloud/lib/server";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import { respond } from "@valentinkolb/cloud/lib/server";
import { err, fail, ok } from "@valentinkolb/cloud/lib/server";
import { parsePagination, createPagination } from "@/accounts/contracts";
import {
  PaginationQuerySchema,
  PaginationResponseSchema,
  BaseUserSchema,
  SearchQuerySchema,
  ErrorResponseSchema,
  MessageResponseSchema,
  CreateUserSchema,
} from "@/accounts/contracts";
import { accountsService } from "../service";

const AdminUpdateUserSchema = z.object({
  givenname: z.string().min(1).describe("First name"),
  sn: z.string().min(1).describe("Last name"),
  displayName: z.string().min(1).describe("Display name"),
  mail: z.email().optional().describe("Email address"),
  phone: z.string().optional().describe("Phone number"),
});

const UsersListResponseSchema = z.object({
  users: z.array(BaseUserSchema),
  pagination: PaginationResponseSchema,
});

const CreateUserResponseSchema = z.object({
  id: z.string().describe("Created user's UUID"),
  uid: z.string().describe("Created user's UID"),
  accountExpires: z.string().nullable().describe("Account expiration date (ISO timestamp)"),
  notificationSent: z.boolean().describe("Whether the welcome email was sent immediately"),
});

const requireIpaSession = async (c: Context<AuthContext>) => {
  const token = c.get("sessionToken");
  const ipaSession = await auth.session.getIpaSession(token);

  if (!ipaSession) {
    return {
      ipaSession: null,
      error: await respond(c, fail(err.unauthenticated("IPA session expired"))),
    };
  }

  return { ipaSession };
};

/** User management routes. */
const app = new Hono<AuthContext>()
  // List users — accessible by all IPA users
  .get(
    "/",
    auth.requireRole("ipa"),
    describeRoute({
      tags: ["Users"],
      summary: "List users",
      description: "List FreeIPA users with pagination and optional search. Searches uid, display name, first/last name, and email.",
      ...requiresIpa,
      responses: {
        200: jsonResponse(UsersListResponseSchema, "Paginated list of users"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "IPA access required"),
      },
    }),
    v("query", z.object({ ...PaginationQuerySchema.shape, ...SearchQuerySchema.shape })),
    async (c) => {
      const query = c.req.valid("query");
      const pagination = parsePagination(query);

      const usersPage = await accountsService.user.list({
        pagination: {
          page: pagination.page,
          perPage: pagination.perPage,
        },
        filter: { search: query.search },
      });

      return respond(
        c,
        ok({
          users: usersPage.items,
          pagination: createPagination(pagination, usersPage.total),
        }),
      );
    },
  )
  // All routes below require admin role
  .use(auth.requireRole("admin"))
  .post(
    "/",
    describeRoute({
      tags: ["Users"],
      summary: "Create user",
      description:
        "Create a new FreeIPA user. Generates a temporary password that must be changed on first login. Sends welcome email (optionally deferred).",
      ...requiresAdmin,
      responses: {
        201: jsonResponse(CreateUserResponseSchema, "User created successfully"),
        400: jsonResponse(ErrorResponseSchema, "Invalid input or user creation failed"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    v("json", CreateUserSchema),
    async (c) => {
      const data = c.req.valid("json");
      const adminUser = c.get("user");
      const { ipaSession, error } = await requireIpaSession(c);
      if (error || !ipaSession) return error!;

      return respond(
        c,
        accountsService.user.create({
          ipaSession,
          data,
          processedBy: adminUser.id,
        }),
        201,
      );
    },
  )
  .patch(
    "/:id",
    describeRoute({
      tags: ["Users"],
      summary: "Update user",
      description: "Update a FreeIPA user's profile fields (admin only).",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "User updated"),
        400: jsonResponse(ErrorResponseSchema, "Failed to update user"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    v("json", AdminUpdateUserSchema),
    async (c) => {
      const id = c.req.param("id");
      const data = c.req.valid("json");
      const token = c.get("sessionToken");
      const ipaSession = await auth.session.getIpaSession(token);

      return respond(c, async () => {
        const result = await accountsService.user.update({ ipaSession, id, data });
        if (!result.ok) return result;
        return ok({ message: "User updated." });
      });
    },
  )
  .post(
    "/:id/reset-password",
    describeRoute({
      tags: ["Users"],
      summary: "Reset user password",
      description:
        "Reset a FreeIPA user's password to a temporary generated password (admin only). The user will be forced to change it on next login.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Password reset"),
        400: jsonResponse(ErrorResponseSchema, "Failed to reset password"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const { ipaSession, error } = await requireIpaSession(c);
      if (error || !ipaSession) return error!;

      return respond(c, async () => {
        const result = await accountsService.user.resetPassword({
          ipaSession,
          id,
        });
        if (!result.ok) return result;
        return ok({
          message: `Password reset. Temporary password: ${result.data.password}`,
        });
      });
    },
  )
  .post(
    "/:id/set-expiry",
    describeRoute({
      tags: ["Users"],
      summary: "Set account expiry",
      description: "Set or remove the account expiration date for a FreeIPA user (admin only).",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Account expiry updated"),
        400: jsonResponse(ErrorResponseSchema, "Failed to update expiry"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    v(
      "json",
      z.object({
        expiryDate: z.string().nullable().describe("ISO date string or null to remove expiry"),
      }),
    ),
    async (c) => {
      const id = c.req.param("id");
      const { expiryDate } = c.req.valid("json");
      const { ipaSession, error } = await requireIpaSession(c);
      if (error || !ipaSession) return error!;

      return respond(c, async () => {
        const result = await accountsService.user.setExpiry({
          ipaSession,
          id,
          expiryDate,
        });
        if (!result.ok) return result;
        return ok({
          message: expiryDate ? "Account expiry set." : "Account expiry removed.",
        });
      });
    },
  )
  .delete(
    "/:id",
    describeRoute({
      tags: ["Users"],
      summary: "Delete user",
      description:
        "Delete a user. Mode 'demote' converts IPA user to guest (keeps local account). Mode 'destroy' permanently deletes from FreeIPA and local DB.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "User deleted/demoted"),
        400: jsonResponse(ErrorResponseSchema, "Failed to delete user"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
        404: jsonResponse(ErrorResponseSchema, "User not found"),
      },
    }),
    v("query", z.object({ mode: z.enum(["demote", "destroy"]) })),
    async (c) => {
      const id = c.req.param("id");
      const { mode } = c.req.valid("query");
      const token = c.get("sessionToken");
      const ipaSession = await auth.session.getIpaSession(token);

      if (mode === "demote") {
        if (!ipaSession) {
          return respond(c, fail(err.unauthenticated("IPA session expired")));
        }

        return respond(c, async () => {
          const result = await accountsService.user.demoteToGuest({
            ipaSession,
            id,
          });
          if (!result.ok) return result;
          return ok({ message: "User demoted to guest" });
        });
      }

      return respond(c, async () => {
        const result = await accountsService.user.remove({
          ipaSession,
          id,
        });
        if (!result.ok) return result;
        return ok({ message: "User permanently deleted" });
      });
    },
  );

export default app;

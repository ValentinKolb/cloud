import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { v, jsonResponse, requiresAdmin, auth, type AuthContext, respond } from "@valentinkolb/cloud/server";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { accountsAppService as accountsService, logger, notifications, getFreeIpaConfig } from "@valentinkolb/cloud/services";
import { parsePagination, createPagination } from "@/contracts";
import {
  PaginationQuerySchema,
  PaginationResponseSchema,
  BaseUserSchema,
  SearchQuerySchema,
  ErrorResponseSchema,
  MessageResponseSchema,
  CreateUserSchema,
  CreateUserResponseSchema,
} from "@/contracts";
import { UserSchema, IpaProfileFieldsSchema } from "@valentinkolb/cloud/contracts";
const log = logger("accounts:admin:users");

// Admin PATCH accepts the same profile fields plus `mail`. Defined standalone
// rather than `UpdateProfileSchema.extend(...)` so its refinement can treat
// `mail` as a valid sole field — the inherited refine otherwise rejects
// mail-only payloads.
const AdminUpdateUserSchema = z
  .object({
    givenname: z.string().min(1).optional(),
    sn: z.string().min(1).optional(),
    displayName: z.string().min(1).optional(),
    mail: z.email().optional().describe("Email address"),
    ipa: IpaProfileFieldsSchema.optional(),
  })
  .refine(
    (data) =>
      data.givenname !== undefined ||
      data.sn !== undefined ||
      data.displayName !== undefined ||
      data.mail !== undefined ||
      data.ipa !== undefined,
    { message: "At least one profile field must be provided" },
  );

const ExtendAccountResponseSchema = z.object({
  message: z.string(),
  newExpiry: z.string().datetime().optional(),
});

const MeUpdateResponseSchema = MessageResponseSchema;

const AdminUpdateResponseSchema = MessageResponseSchema;

const UsersListResponseSchema = z.object({
  users: z.array(BaseUserSchema),
  pagination: PaginationResponseSchema,
});

type CreateUserResponse = z.infer<typeof CreateUserResponseSchema>;

const toAccountsActor = (actor: AuthContext["Variables"]["user"]) => ({
  userId: actor.id,
  uid: actor.uid,
  roles: actor.roles,
  provider: actor.provider,
});

const ResetPasswordResponseSchema = z.object({
  message: z.string().describe("Human-readable success message"),
  password: z.string().describe("Temporary password"),
});

const CreateLoginTokenResponseSchema = z.object({
  token: z.string().describe("One-time local login token"),
  magicLink: z.string().describe("Direct magic login URL"),
  expiresInSeconds: z.number().int().positive().describe("Token lifetime in seconds"),
});

const SwitchProviderSchema = z.object({
  provider: z.enum(["local", "ipa"]),
});

const SetAdminSchema = z.object({
  admin: z.boolean(),
});

const NotifyUserSchema = z.object({
  subject: z.string().min(1).describe("Notification subject"),
  rawHtml: z.string().min(1).describe("HTML content of the notification"),
});

const requireIpaSession = async (c: Context<AuthContext>) => {
  if (!(await getFreeIpaConfig()).enabled) {
    return {
      ipaSession: null,
      error: await respond(c, fail(err.badInput("FreeIPA is disabled."))),
    };
  }
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

const preventSelfDestructiveAction = async (
  c: Context<AuthContext>,
  params: { targetUserId: string; message: string },
) => {
  const actor = c.get("user");
  if (actor.id !== params.targetUserId) return null;
  return await respond(c, fail(err.forbidden(params.message)));
};

const logLocalAdminMutation = (params: {
  actor: { id: string; uid: string };
  target: { id: string; uid: string; provider: string; profile: string; storedAdmin: boolean };
  nextAdmin: boolean;
  reason: string;
}) => {
  log.warn(params.nextAdmin ? "Local admin granted" : "Local admin revoked", {
    actorUserId: params.actor.id,
    actorUid: params.actor.uid,
    targetUserId: params.target.id,
    targetUid: params.target.uid,
    targetProvider: params.target.provider,
    targetProfile: params.target.profile,
    previousAdmin: params.target.storedAdmin,
    nextAdmin: params.nextAdmin,
    reason: params.reason,
  });
};

// Admin-only user management routes. Self-service (/me) lives in core at
// /api/me/*; this file is strictly third-party administration.
const app = new Hono<AuthContext>()
  .use(auth.requireRole("admin"))
  .get(
    "/",
    describeRoute({
      tags: ["Users"],
      summary: "List users",
      description: "List accounts with pagination and optional search. Searches uid, display name, first/last name, and email.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(UsersListResponseSchema, "Paginated list of users"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    v("query", z.object({
      ...PaginationQuerySchema.shape,
      ...SearchQuerySchema.shape,
      provider: z.enum(["local", "ipa"]).optional(),
      profile: z.enum(["user", "guest"]).optional(),
    })),
    async (c) => {
      const query = c.req.valid("query");
      const pagination = parsePagination(query);

      const usersPage = await accountsService.user.list({
        pagination: {
          page: pagination.page,
          perPage: pagination.perPage,
        },
        filter: { search: query.search },
        scope: { provider: query.provider, profile: query.profile },
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
  .get(
    "/:id",
    describeRoute({
      tags: ["Users"],
      summary: "Get user",
      description: "Return the full user resource including IPA-specific fields and group memberships.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(UserSchema, "User"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
        404: jsonResponse(ErrorResponseSchema, "User not found"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      if (!id) return respond(c, fail(err.badInput("Missing user ID")));
      return respond(c, async () => {
        const user = await accountsService.user.get({ id });
        if (!user) return fail(err.notFound("User not found"));
        return ok(user);
      });
    },
  )
  .post(
    "/",
    describeRoute({
      tags: ["Users"],
      summary: "Create user",
      description:
        "Create a new account. FreeIPA-backed accounts get a temporary password; local accounts use magic-link login.",
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
      const ipaSessionResult = data.provider === "ipa" ? await requireIpaSession(c) : null;
      if (ipaSessionResult && "error" in ipaSessionResult) return ipaSessionResult.error;

      return respond(
        c,
        async () => {
          const result: Result<CreateUserResponse> = await accountsService.user.create({
            actor: toAccountsActor(adminUser),
            ipaSession: ipaSessionResult?.ipaSession ?? null,
            data,
            processedBy: adminUser.id,
          });
          if (!result.ok) return result;
          if (data.provider === "local" && data.profile === "user" && data.admin) {
            log.warn("Local admin created", {
              actorUserId: adminUser.id,
              actorUid: adminUser.uid,
              targetUserId: result.data.id,
              targetUid: result.data.uid,
              targetProvider: "local",
              targetProfile: "user",
              previousAdmin: false,
              nextAdmin: true,
              reason: "create_local_admin",
            });
          }
          return result;
        },
        201,
      );
    },
  )
  .patch(
    "/:id",
    describeRoute({
      tags: ["Users"],
      summary: "Update user",
      description: "Update an account's profile fields (admin only).",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(AdminUpdateResponseSchema, "User updated"),
        400: jsonResponse(ErrorResponseSchema, "Failed to update user"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    v("json", AdminUpdateUserSchema),
    async (c) => {
      const id = c.req.param("id");
      if (!id) return respond(c, fail(err.badInput("Missing user ID")));
      const data = c.req.valid("json");
      const token = c.get("sessionToken");
      const ipaSession = await auth.session.getIpaSession(token);

      return respond(c, async () => {
        const result = await accountsService.user.update({ actor: toAccountsActor(c.get("user")), ipaSession, id, data });
        if (!result.ok) return result;
        return ok({ message: "User updated." });
      });
    },
  )
  .post(
    "/:id/password-reset",
    describeRoute({
      tags: ["Users"],
      summary: "Reset user password",
      description:
        "Reset a FreeIPA user's password to a temporary generated password (admin only). The user will be forced to change it on next login.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(ResetPasswordResponseSchema, "Password reset"),
        400: jsonResponse(ErrorResponseSchema, "Failed to reset password"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      if (!id) return respond(c, fail(err.badInput("Missing user ID")));
      const actor = c.get("user");
      const { ipaSession, error } = await requireIpaSession(c);
      if (error || !ipaSession) return error!;
      const selfActionError = await preventSelfDestructiveAction(c, {
        targetUserId: id,
        message: "You cannot reset your own password from the admin users API.",
      });
      if (selfActionError) return selfActionError;

      return respond(c, async () => {
        const targetUser = await accountsService.user.getMinimal({ id });
        if (!targetUser) return fail(err.notFound("User not found"));
        const result = await accountsService.user.resetPassword({
          actor: toAccountsActor(actor),
          ipaSession,
          id,
        });
        if (!result.ok) return result;
        log.warn("Admin reset FreeIPA password", {
          actorUserId: actor.id,
          actorUid: actor.uid,
          targetUserId: targetUser.id,
          targetUid: targetUser.uid,
          targetProvider: targetUser.provider,
          targetProfile: targetUser.profile,
        });
        return ok({ message: "Password reset.", password: result.data.password });
      });
    },
  )
  .post(
    "/:id/login-token",
    describeRoute({
      tags: ["Users"],
      summary: "Create login token",
      description: "Create a one-time local login token for the target local account without sending an email.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(CreateLoginTokenResponseSchema, "Login token created"),
        400: jsonResponse(ErrorResponseSchema, "Failed to create login token"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
        404: jsonResponse(ErrorResponseSchema, "User not found"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      if (!id) return respond(c, fail(err.badInput("Missing user ID")));
      const actor = c.get("user");
      return respond(c, async () => {
        const targetUser = await accountsService.user.getMinimal({ id });
        if (!targetUser) return fail(err.notFound("User not found"));
        const result = await accountsService.user.createLoginToken({ actor: toAccountsActor(actor), id });
        if (!result.ok) return result;
        log.warn("Admin created local login token", {
          actorUserId: actor.id,
          actorUid: actor.uid,
          targetUserId: targetUser.id,
          targetUid: targetUser.uid,
          targetProvider: targetUser.provider,
          targetProfile: targetUser.profile,
        });
        return ok(result.data);
      });
    },
  )
  .put(
    "/:id/admin",
    describeRoute({
      tags: ["Users"],
      summary: "Set local admin access",
      description: "Grant or revoke admin access for a local full account.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Admin access updated"),
        400: jsonResponse(ErrorResponseSchema, "Failed to update admin access"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    v("json", SetAdminSchema),
    async (c) => {
      const id = c.req.param("id");
      if (!id) return respond(c, fail(err.badInput("Missing user ID")));
      const actor = c.get("user");
      return respond(c, async () => {
        const targetUser = await accountsService.user.getMinimal({ id });
        if (!targetUser) return fail(err.notFound("User not found"));
        const { admin } = c.req.valid("json");
        const result = await accountsService.user.setAdmin({ actor: toAccountsActor(actor), id, admin });
        if (!result.ok) return result;
        logLocalAdminMutation({
          actor,
          target: targetUser,
          nextAdmin: admin,
          reason: "manual_set_admin",
        });
        return ok({ message: admin ? "Local admin granted." : "Local admin revoked." });
      });
    },
  )
  .put(
    "/:id/provider",
    describeRoute({
      tags: ["Users"],
      summary: "Switch account provider",
      description: "Switch an existing account between the local and FreeIPA providers while preserving the local identity row.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Provider switched"),
        400: jsonResponse(ErrorResponseSchema, "Failed to switch provider"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    v("json", SwitchProviderSchema),
    async (c) => {
      const id = c.req.param("id");
      if (!id) return respond(c, fail(err.badInput("Missing user ID")));
      const { provider } = c.req.valid("json");
      const selfActionError = await preventSelfDestructiveAction(c, {
        targetUserId: id,
        message: "You cannot switch your own account provider.",
      });
      if (selfActionError) return selfActionError;
      const { ipaSession, error } = await requireIpaSession(c);
      if (error || !ipaSession) return error!;

      return respond(c, async () => {
        const actor = c.get("user");
        const targetUser = await accountsService.user.getMinimal({ id });
        if (!targetUser) return fail(err.notFound("User not found"));
        const result = await accountsService.user.switchProvider({
          actor: toAccountsActor(actor),
          ipaSession,
          id,
          provider,
        });
        if (!result.ok) return result;
        if (provider === "ipa" && targetUser.provider === "local" && targetUser.storedAdmin) {
          logLocalAdminMutation({
            actor,
            target: targetUser,
            nextAdmin: false,
            reason: "switch_to_ipa",
          });
        }
        return ok({ message: `Account provider switched to ${provider}.` });
      });
    },
  )
  .put(
    "/:id/expiry",
    describeRoute({
      tags: ["Users"],
      summary: "Set account expiry",
      description: "Set or remove the account expiration date for an account (admin only).",
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
        expiryDate: z.string().nullable().describe("ISO date or date-time string, or null to remove expiry"),
      }),
    ),
    async (c) => {
      const id = c.req.param("id");
      if (!id) return respond(c, fail(err.badInput("Missing user ID")));
      const { expiryDate } = c.req.valid("json");
      const actor = c.get("user");
      const token = c.get("sessionToken");
      const ipaSession = await auth.session.getIpaSession(token);

      return respond(c, async () => {
        const result = await accountsService.user.setExpiry({
          actor: toAccountsActor(actor),
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
  .put(
    "/:id/profile",
    describeRoute({
      tags: ["Users"],
      summary: "Set local account profile",
      description: "Switch a local account between the user and guest profiles.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Account profile updated"),
        400: jsonResponse(ErrorResponseSchema, "Failed to update profile"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    v("json", z.object({ profile: z.enum(["user", "guest"]) })),
    async (c) => {
      const id = c.req.param("id");
      if (!id) return respond(c, fail(err.badInput("Missing user ID")));
      const { profile } = c.req.valid("json");
      if (profile === "guest") {
        const selfActionError = await preventSelfDestructiveAction(c, {
          targetUserId: id,
          message: "You cannot demote your own account to guest.",
        });
        if (selfActionError) return selfActionError;
      }
      return respond(c, async () => {
        const actor = c.get("user");
        const targetUser = await accountsService.user.getMinimal({ id });
        if (!targetUser) return fail(err.notFound("User not found"));
        const result = await accountsService.user.setProfile({
          actor: toAccountsActor(actor),
          id,
          profile,
        });
        if (!result.ok) return result;
        if (profile === "guest" && targetUser.provider === "local" && targetUser.storedAdmin) {
          logLocalAdminMutation({
            actor,
            target: targetUser,
            nextAdmin: false,
            reason: "demote_to_guest",
          });
        }
        return ok({ message: `Local account switched to ${profile}.` });
      });
    },
  )
  .post(
    "/:id/notifications",
    describeRoute({
      tags: ["Users"],
      summary: "Send notification to user",
      description: "Send an email notification to the target user (admin only).",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Notification sent"),
        400: jsonResponse(ErrorResponseSchema, "Failed to send notification"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
        404: jsonResponse(ErrorResponseSchema, "User not found"),
      },
    }),
    v("json", NotifyUserSchema),
    async (c) => {
      const id = c.req.param("id");
      if (!id) return respond(c, fail(err.badInput("Missing user ID")));
      const actor = c.get("user");
      const { subject, rawHtml } = c.req.valid("json");
      return respond(c, async () => {
        const result = await notifications.sendToUser({
          userId: id,
          subject,
          rawHtml,
          sentBy: actor.id,
        });
        if (!result.ok) return fail(err.badInput(result.error));
        return ok({ message: "Notification sent." });
      });
    },
  )
  .post(
    "/:id/login-link",
    describeRoute({
      tags: ["Users"],
      summary: "Send login link",
      description: "Send a local magic login link to the target user's email address.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Login link sent"),
        400: jsonResponse(ErrorResponseSchema, "Failed to send login link"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      if (!id) return respond(c, fail(err.badInput("Missing user ID")));
      return respond(c, async () => {
        const result = await accountsService.user.sendLoginLink({ actor: toAccountsActor(c.get("user")), id });
        if (!result.ok) return result;
        return ok({ message: "Login link sent." });
      });
    },
  )
  // Permanent deletion. Demotion (IPA -> local guest) is a separate
  // operation, see POST /:id/demotion below.
  .delete(
    "/:id",
    describeRoute({
      tags: ["Users"],
      summary: "Delete user",
      description: "Permanently delete a user from FreeIPA (if applicable) and local DB.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "User deleted"),
        400: jsonResponse(ErrorResponseSchema, "Failed to delete user"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
        404: jsonResponse(ErrorResponseSchema, "User not found"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      if (!id) return respond(c, fail(err.badInput("Missing user ID")));
      const actor = c.get("user");
      const selfActionError = await preventSelfDestructiveAction(c, {
        targetUserId: id,
        message: "You cannot delete your own account.",
      });
      if (selfActionError) return selfActionError;
      const token = c.get("sessionToken");
      const ipaSession = await auth.session.getIpaSession(token);

      return respond(c, async () => {
        const result = await accountsService.user.remove({
          ipaSession,
          id,
          actor: toAccountsActor(actor),
        });
        if (!result.ok) return result;
        return ok({ message: "User permanently deleted" });
      });
    },
  )
  .post(
    "/:id/demotion",
    describeRoute({
      tags: ["Users"],
      summary: "Demote IPA user to local guest",
      description: "Converts an IPA-backed user into a local guest account, preserving the local identity row. Requires an IPA session.",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(MessageResponseSchema, "User demoted to guest"),
        400: jsonResponse(ErrorResponseSchema, "Failed to demote user"),
        401: jsonResponse(ErrorResponseSchema, "Authentication or IPA session required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
        404: jsonResponse(ErrorResponseSchema, "User not found"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      if (!id) return respond(c, fail(err.badInput("Missing user ID")));
      const actor = c.get("user");
      const selfActionError = await preventSelfDestructiveAction(c, {
        targetUserId: id,
        message: "You cannot demote your own account.",
      });
      if (selfActionError) return selfActionError;
      const token = c.get("sessionToken");
      const ipaSession = await auth.session.getIpaSession(token);
      if (!ipaSession) return respond(c, fail(err.unauthenticated("IPA session expired")));

      return respond(c, async () => {
        const result = await accountsService.user.demoteToGuest({
          ipaSession,
          id,
          actor: toAccountsActor(actor),
        });
        if (!result.ok) return result;
        return ok({ message: "User demoted to guest" });
      });
    },
  );

export default app;

import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { v } from "@valentinkolb/cloud/lib/server";
import { jsonResponse, requiresAdmin, requiresAuth } from "@valentinkolb/cloud/lib/server";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import { respond } from "@valentinkolb/cloud/lib/server";
import { err, fail, ok } from "@valentinkolb/cloud/lib/server";
import { accountsAppService as accountsService } from "@valentinkolb/cloud-core/services";
import { accountLifecycle } from "@valentinkolb/cloud-core/services/account-lifecycle";
import { logger } from "@valentinkolb/cloud-core/services/logging";
import { providers } from "@valentinkolb/cloud-core/services/providers";
import { getFreeIpaConfigSync } from "@valentinkolb/cloud-core/services";
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
import { UserSchema } from "@valentinkolb/cloud-contracts/shared";
import { ChangePasswordSchema, UpdateProfileSchema } from "./me/schemas";
const log = logger("accounts:admin:users");

const AdminUpdateUserSchema = UpdateProfileSchema.extend({
  mail: z.email().optional().describe("Email address"),
});

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

const CreateUserResponseSchema = z.object({
  id: z.string().describe("Created user's UUID"),
  uid: z.string().describe("Created user's UID"),
  accountExpires: z.string().nullable().describe("Account expiration date (ISO timestamp)"),
  notificationSent: z.boolean().describe("Whether the welcome email was sent immediately"),
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

const requireIpaSession = async (c: Context<AuthContext>) => {
  if (!getFreeIpaConfigSync().enabled) {
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

/** User management routes. */
const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))
  .get(
    "/me",
    describeRoute({
      tags: ["Users"],
      summary: "Get current user",
      description: "Return the authenticated user resource.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(UserSchema, "Current user"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    async (c) => respond(c, ok(c.get("user"))),
  )
  .patch(
    "/me",
    describeRoute({
      tags: ["Users"],
      summary: "Update current user",
      description: "Update the authenticated user's canonical profile fields and IPA-only self-service fields.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MeUpdateResponseSchema, "Profile updated"),
        400: jsonResponse(ErrorResponseSchema, "Failed to update profile"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    v("json", UpdateProfileSchema),
    async (c) =>
      respond(c, async () => {
        const user = c.get("user");
        const token = c.get("sessionToken");
        const data = c.req.valid("json");

        const ipaSession = user.provider === "ipa" ? await auth.session.getIpaSession(token) : null;
        const result = await accountsService.user.update({
          ipaSession,
          id: user.id,
          data,
        });
        if (!result.ok) return result;
        return ok({ message: "Profile updated." });
      }),
  )
  .post(
    "/me/change-password",
    describeRoute({
      tags: ["Users"],
      summary: "Change current user password",
      description: "Change the authenticated user's password. Requires the current password for verification.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Password changed"),
        400: jsonResponse(ErrorResponseSchema, "Failed to change password"),
        401: jsonResponse(ErrorResponseSchema, "Current password is incorrect"),
      },
    }),
    v("json", ChangePasswordSchema),
    async (c) =>
      respond(c, async () => {
        const user = c.get("user");
        const { currentPassword, newPassword } = c.req.valid("json");
        if (!getFreeIpaConfigSync().enabled) {
          return fail(err.badInput("FreeIPA is disabled."));
        }

        if (user.provider !== "ipa") {
          return { ok: false, error: "Password change is only available for IPA accounts.", status: 400 };
        }

        const verifyResult = await providers.ipa.auth.login(user.uid, currentPassword);
        if (verifyResult.status !== "success") {
          return { ok: false, error: "Current password is incorrect.", status: 401 };
        }

        const result = await providers.ipa.auth.changePassword({
          ipaSession: verifyResult.session,
          uid: user.uid,
          newPassword,
        });
        if (!result.ok) return result;

        return ok({ message: "Password changed successfully." });
      }),
  )
  .post(
    "/me/extend-account",
    describeRoute({
      tags: ["Users"],
      summary: "Extend current user account",
      description: "Extends the authenticated account according to lifecycle settings.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ExtendAccountResponseSchema, "Account extension result"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        400: jsonResponse(ErrorResponseSchema, "Unable to extend account"),
      },
    }),
    async (c) =>
      respond(c, async () => {
        const user = c.get("user");
        const token = c.get("sessionToken");
        const ipaSession = user.provider === "ipa" ? await auth.session.getIpaSession(token) : null;
        const result = await accountLifecycle.extendCurrentUserAccount({
          user,
          ipaSession,
        });
        return ok(result);
      }),
  )
  .delete(
    "/me",
    describeRoute({
      tags: ["Users"],
      summary: "Delete current user",
      description: "Delete the authenticated user's account. Only available for guest-profile users.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Account deleted"),
        400: jsonResponse(ErrorResponseSchema, "Failed to delete account"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Only guest accounts can be self-deleted"),
      },
    }),
    async (c) =>
      respond(c, async () => {
        const user = c.get("user");
        const token = c.get("sessionToken");

        if (user.profile !== "guest") {
          return { ok: false, error: "Only guest accounts can be self-deleted.", status: 403 };
        }

        const ipaSession = user.provider === "ipa" ? await auth.session.getIpaSession(token) : null;
        if (user.provider === "ipa" && !ipaSession) {
          return { ok: false, error: "IPA session required.", status: 401 };
        }

        const result =
          user.provider === "ipa"
            ? await providers.ipa.users.remove({
                ipaSession,
                id: user.id,
                actor: { userId: user.id, uid: user.uid },
              })
            : await providers.local.users.remove({
                id: user.id,
                actor: { userId: user.id, uid: user.uid },
              });
        if (!result.ok) return result;

        await auth.session.delete(c);
        return ok({ message: "Account deleted." });
      }),
  )
  // List users — admin only
  .get(
    "/",
    auth.requireRole("admin"),
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
  // All routes below require admin role
  .use(auth.requireRole("admin"))
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
          const result = await accountsService.user.create({
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
        200: jsonResponse(ResetPasswordResponseSchema, "Password reset"),
        400: jsonResponse(ErrorResponseSchema, "Failed to reset password"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Admin access required"),
      },
    }),
    async (c) => {
      const id = c.req.param("id");
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
    "/:id/create-login-token",
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
      const actor = c.get("user");
      return respond(c, async () => {
        const targetUser = await accountsService.user.getMinimal({ id });
        if (!targetUser) return fail(err.notFound("User not found"));
        const result = await accountsService.user.createLoginToken({ id });
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
  .post(
    "/:id/set-admin",
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
      const actor = c.get("user");
      return respond(c, async () => {
        const targetUser = await accountsService.user.getMinimal({ id });
        if (!targetUser) return fail(err.notFound("User not found"));
        const { admin } = c.req.valid("json");
        const result = await accountsService.user.setAdmin({ id, admin });
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
  .post(
    "/:id/switch-provider",
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
  .post(
    "/:id/set-expiry",
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
        expiryDate: z.iso.datetime().nullable().describe("ISO date string or null to remove expiry"),
      }),
    ),
    async (c) => {
      const id = c.req.param("id");
      const { expiryDate } = c.req.valid("json");
      if (expiryDate) {
        const selfActionError = await preventSelfDestructiveAction(c, {
          targetUserId: id,
          message: "You cannot change your own account expiry from the admin users API.",
        });
        if (selfActionError) return selfActionError;
      }
      const token = c.get("sessionToken");
      const ipaSession = await auth.session.getIpaSession(token);

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
  .post(
    "/:id/set-profile",
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
    "/:id/send-login-link",
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
      return respond(c, async () => {
        const result = await accountsService.user.sendLoginLink({ id });
        if (!result.ok) return result;
        return ok({ message: "Login link sent." });
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
      const actor = c.get("user");
      const selfActionError = await preventSelfDestructiveAction(c, {
        targetUserId: id,
        message: mode === "demote" ? "You cannot demote your own account." : "You cannot delete your own account.",
      });
      if (selfActionError) return selfActionError;
      const ipaSession = await auth.session.getIpaSession(token);

      if (mode === "demote") {
        if (!ipaSession) {
          return respond(c, fail(err.unauthenticated("IPA session expired")));
        }

        return respond(c, async () => {
          const result = await accountsService.user.demoteToGuest({
            ipaSession,
            id,
            actor: { userId: actor.id, uid: actor.uid },
          });
          if (!result.ok) return result;
          return ok({ message: "User demoted to guest" });
        });
      }

      return respond(c, async () => {
        const result = await accountsService.user.remove({
          ipaSession,
          id,
          actor: { userId: actor.id, uid: actor.uid },
        });
        if (!result.ok) return result;
        return ok({ message: "User permanently deleted" });
      });
    },
  );

export default app;

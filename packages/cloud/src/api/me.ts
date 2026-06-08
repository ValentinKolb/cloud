/**
 * Self-service endpoints — everything a logged-in user does with their OWN
 * account. Owned by core, mounted at /api/me/*. Auth flows live in /auth;
 * third-party management lives in the accounts admin app.
 */
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { auth, jsonResponse, rateLimit, requiresAuth, respond, v, type AuthContext } from "../server";
import { ok } from "@valentinkolb/stdlib";
import {
  ChangePasswordSchema,
  CreateAccountRequestSchema,
  ErrorResponseSchema,
  MessageResponseSchema,
  UpdateProfileSchema,
  UserSchema,
} from "../contracts";
import {
  accountLifecycle,
  accountsAppService as accountsService,
} from "../services";

const toAccountsActor = (user: AuthContext["Variables"]["user"]) => ({
  userId: user.id,
  uid: user.uid,
  roles: user.roles,
  provider: user.provider,
});

const ExtendAccountResponseSchema = z.object({
  message: z.string(),
  newExpiry: z.string().datetime().optional(),
});

const AccountRequestResponseSchema = z.object({
  id: z.uuid(),
  message: z.string(),
});

const app = new Hono<AuthContext>()
  .use(rateLimit())
  .use(auth.requireRole("authenticated"))

  .get(
    "/",
    describeRoute({
      tags: ["Me"],
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
    "/",
    describeRoute({
      tags: ["Me"],
      summary: "Update current user",
      description: "Update the authenticated user's canonical profile fields and IPA-only self-service fields.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Profile updated"),
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
        const result = await accountsService.user.update({ actor: toAccountsActor(user), ipaSession, id: user.id, data });
        if (!result.ok) return result;
        return ok({ message: "Profile updated." });
      }),
  )

  .post(
    "/password",
    describeRoute({
      tags: ["Me"],
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
        const result = await accountsService.user.changeOwnPassword({
          user: c.get("user"),
          currentPassword: c.req.valid("json").currentPassword,
          newPassword: c.req.valid("json").newPassword,
        });
        if (!result.ok) return result;
        return ok({ message: "Password changed successfully." });
      }),
  )

  .post(
    "/account-extension",
    describeRoute({
      tags: ["Me"],
      summary: "Extend current user account",
      description: "Extends the authenticated account according to lifecycle settings.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ExtendAccountResponseSchema, "Account extension result"),
        400: jsonResponse(ErrorResponseSchema, "Unable to extend account"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    async (c) =>
      respond(c, async () => {
        const user = c.get("user");
        const token = c.get("sessionToken");
        const ipaSession = user.provider === "ipa" ? await auth.session.getIpaSession(token) : null;
        const result = await accountLifecycle.extendCurrentUserAccount({ user, ipaSession });
        return result;
      }),
  )

  .delete(
    "/",
    describeRoute({
      tags: ["Me"],
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
        if (user.profile !== "guest") {
          return { ok: false, error: "Only guest accounts can be self-deleted.", status: 403 };
        }
        const token = c.get("sessionToken");
        const ipaSession = user.provider === "ipa" ? await auth.session.getIpaSession(token) : null;
        const result = await accountsService.user.removeSelf({ user, ipaSession });
        if (!result.ok) return result;
        await auth.session.delete(c);
        return ok({ message: "Account deleted." });
      }),
  )

  // Account request: a local user asks for an IPA-backed account. Each user
  // has at most one pending request; `POST` creates it, `DELETE` withdraws
  // the current one. Admin processing of requests lives in the accounts app.
  .post(
    "/account-request",
    describeRoute({
      tags: ["Me"],
      summary: "Submit account request",
      description: "Local accounts can request a centrally managed FreeIPA account. Must accept terms of service.",
      ...requiresAuth,
      responses: {
        201: jsonResponse(AccountRequestResponseSchema, "Request created"),
        400: jsonResponse(ErrorResponseSchema, "FreeIPA is disabled"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Only local accounts can request FreeIPA access"),
        409: jsonResponse(ErrorResponseSchema, "Pending request already exists"),
      },
    }),
    v("json", CreateAccountRequestSchema),
    async (c) =>
      respond(c, accountsService.accountRequest.create({ user: c.get("user"), data: c.req.valid("json") }), 201),
  )

  .delete(
    "/account-request",
    describeRoute({
      tags: ["Me"],
      summary: "Withdraw pending account request",
      description: "Withdraws the current user's pending FreeIPA account request, if any.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Request withdrawn"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        404: jsonResponse(ErrorResponseSchema, "No pending request"),
      },
    }),
    async (c) =>
      respond(c, async () => {
        const user = c.get("user");
        const pending = await accountsService.accountRequest.getPendingForUser({ userId: user.id });
        if (!pending) {
          return { ok: false, error: "No pending request", status: 404 };
        }
        const result = await accountsService.accountRequest.withdraw({ id: pending.id, userId: user.id });
        if (!result.ok) return result;
        return ok({ message: "Request withdrawn" });
      }),
  );

export default app;

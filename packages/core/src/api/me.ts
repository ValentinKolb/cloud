import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { v } from "@valentinkolb/cloud-lib/server";
import { jsonResponse, requiresAuth } from "@valentinkolb/cloud-lib/server/middleware/openapi";
import { auth, type AuthContext } from "@valentinkolb/cloud-lib/server/middleware/auth";
import { rateLimit } from "@valentinkolb/cloud-lib/server/middleware/rate-limit";
import { ipa } from "@valentinkolb/cloud-core/services/ipa";
import {
  UpdateProfileSchema,
  UpdateSshKeysSchema,
  ChangePasswordSchema,
} from "./me/schemas";
import {
  MessageResponseSchema,
  ErrorResponseSchema,
  hasRole,
} from "@valentinkolb/cloud-contracts/shared";

/** Profile routes: edit own profile, delete own account (guests only). */
const app = new Hono<AuthContext>()
  .use(rateLimit())
  .use(auth.requireRole("authenticated"))
  .patch(
    "/",
    describeRoute({
      tags: ["Profile"],
      summary: "Update own profile",
      description: "Update the authenticated user's profile fields (givenname, sn, displayName, phone).",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Profile updated"),
        400: jsonResponse(ErrorResponseSchema, "Failed to update profile"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    v("json", UpdateProfileSchema),
    async (c) => {
      const user = c.get("user");
      const token = c.get("sessionToken");
      const data = c.req.valid("json");

      const ipaSession = await auth.session.getIpaSession(token);

      const result = await ipa.users.updateProfile({
        ipaSession,
        id: user.id,
        data,
      });
      if (!result.ok) {
        return c.json({ message: result.error }, result.status);
      }

      return c.json({ message: "Profile updated." });
    },
  )
  .post(
    "/password",
    describeRoute({
      tags: ["Profile"],
      summary: "Change own password",
      description: "Change the authenticated user's password. Requires the current password for verification.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Password changed"),
        400: jsonResponse(ErrorResponseSchema, "Failed to change password"),
        401: jsonResponse(ErrorResponseSchema, "Current password is incorrect"),
      },
    }),
    v("json", ChangePasswordSchema),
    async (c) => {
      const user = c.get("user");
      const { currentPassword, newPassword } = c.req.valid("json");

      if (!hasRole(user, "ipa", "ipa-limited")) {
        return c.json({ message: "Password change is only available for IPA accounts." }, 400);
      }

      // Verify current password by attempting login
      const verifyResult = await ipa.auth.login(user.uid, currentPassword);
      if (verifyResult.status !== "success") {
        return c.json({ message: "Current password is incorrect." }, 401);
      }

      // Use the verified session to change password
      const result = await ipa.auth.changePassword({
        ipaSession: verifyResult.session,
        uid: user.uid,
        newPassword,
      });
      if (!result.ok) {
        return c.json({ message: result.error }, result.status);
      }

      return c.json({ message: "Password changed successfully." });
    },
  )
  .put(
    "/ssh-keys",
    describeRoute({
      tags: ["Profile"],
      summary: "Update SSH keys",
      description: "Replace all SSH public keys for the authenticated IPA user.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "SSH keys updated"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Only IPA accounts can manage SSH keys"),
        404: jsonResponse(ErrorResponseSchema, "User not found"),
      },
    }),
    v("json", UpdateSshKeysSchema),
    async (c) => {
      const user = c.get("user");
      const token = c.get("sessionToken");
      const { keys } = c.req.valid("json");

      if (!hasRole(user, "ipa", "ipa-limited")) {
        return c.json({ message: "SSH key management is only available for IPA accounts." }, 403);
      }

      const ipaSession = await auth.session.getIpaSession(token);
      if (!ipaSession) {
        return c.json({ message: "IPA session required." }, 401);
      }

      const result = await ipa.users.updateSshKeys({
        ipaSession,
        id: user.id,
        keys,
      });
      if (!result.ok) {
        return c.json({ message: result.error }, result.status);
      }

      return c.json({ message: "SSH keys updated." });
    },
  )
  .delete(
    "/",
    describeRoute({
      tags: ["Profile"],
      summary: "Delete own account",
      description: "Delete the authenticated user's account. Only available for guest-realm users.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Account deleted"),
        400: jsonResponse(ErrorResponseSchema, "Failed to delete account"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
        403: jsonResponse(ErrorResponseSchema, "Only guest accounts can be self-deleted"),
      },
    }),
    async (c) => {
      const user = c.get("user");

      if (!hasRole(user, "guest")) {
        return c.json({ message: "Only guest accounts can be self-deleted." }, 403);
      }

      // Guest users are not in FreeIPA, so we just delete from local DB
      const result = await ipa.users.delete({ ipaSession: null, id: user.id });
      if (!result.ok) {
        return c.json({ message: result.error }, result.status);
      }

      // Destroy session
      await auth.session.delete(c);

      return c.json({ message: "Account deleted." });
    },
  );

export default app;

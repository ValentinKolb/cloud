import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { v } from "../server";
import { jsonResponse } from "../server";
import { auth, type AuthContext } from "../server";
import { rateLimit } from "../server";
import { authFlows, accounts, getFreeIpaConfig, logger } from "../services";
import { sql } from "bun";
import { env } from "../config";
import { ChangeExpiredPasswordSchema } from "../contracts";

const log = logger("auth");
import {
  LoginSchema,
  EmailLoginSchema,
  VerifyTokenSchema,
  AdminLoginSchema,
  AuthResponseSchema,
} from "./auth/schemas";
import { ErrorResponseSchema, MessageResponseSchema } from "../contracts";

const jsonError = (c: Context, message: string, status: 400 | 401 | 500) => c.json({ message }, status);

/** Authentication routes: login, logout. */
const app = new Hono<AuthContext>()
  .use(rateLimit())
  .post(
    "/login",
    describeRoute({
      tags: ["Auth"],
      summary: "Login via FreeIPA",
      description: "Authenticate with FreeIPA username and password. Returns a session token and sets a session cookie.",
      responses: {
        200: jsonResponse(AuthResponseSchema, "Login successful"),
        401: jsonResponse(ErrorResponseSchema, "Invalid username or password"),
      },
    }),
    v("json", LoginSchema),
    async (c) => {
      const { username, password, acceptedAgb: _ } = c.req.valid("json");
      if (!(await getFreeIpaConfig()).enabled) {
        return c.json({ message: "FreeIPA is disabled." }, 400);
      }

      const loginResult = await authFlows.ipa.login({ username, password });
      if (!loginResult.ok && loginResult.reason === "password_expired") {
        log.info("Login failed", { uid: username, reason: "password_expired" });
        return c.json({ message: "Password expired", passwordExpired: true }, 401);
      }
      if (!loginResult.ok) {
        log.info("Login failed", {
          uid: username,
          reason: loginResult.reason,
        });
        return c.json({ message: loginResult.message }, loginResult.status);
      }

      // Store minimal session in Redis
      const sessionToken = await auth.session.create(c, loginResult.userId, loginResult.ipaSession);

      log.info("Login successful", { uid: username });
      return c.json({
        session_token: sessionToken,
        user: loginResult.user,
      });
    },
  )
  .post(
    "/logout",
    describeRoute({
      tags: ["Auth"],
      summary: "Logout",
      description:
        "Idempotent: clears the session cookie and deletes the session key if present. No authentication required — logout must always succeed.",
      responses: {
        200: jsonResponse(MessageResponseSchema, "Session invalidated"),
      },
    }),
    async (c) => {
      await auth.session.delete(c);
      log.info("Logout");
      return c.json({ message: "Logged out" });
    },
  )
  .post(
    "/change-expired-password",
    describeRoute({
      tags: ["Auth"],
      summary: "Change expired password",
      description: "Change an expired or temporary password using FreeIPA's change_password endpoint. No active session required. For regular password changes of a logged-in user, use POST /api/me/password instead.",
      responses: {
        200: jsonResponse(AuthResponseSchema, "Password changed and logged in"),
        400: jsonResponse(ErrorResponseSchema, "Failed to change password"),
      },
    }),
    v("json", ChangeExpiredPasswordSchema),
    async (c) => {
      const { username, currentPassword, newPassword } = c.req.valid("json");
      if (!(await getFreeIpaConfig()).enabled) {
        return c.json({ message: "FreeIPA is disabled." }, 400);
      }

      const changeResult = await authFlows.ipa.changeExpiredPassword({
        username,
        currentPassword,
        newPassword,
      });
      if (!changeResult.ok) {
        if (changeResult.reason === "change_failed") {
          const status = changeResult.status >= 500 ? 500 : 400;
          return jsonError(c, changeResult.message, status);
        }
        if (changeResult.reason === "password_expired") {
          return c.json({ message: "Password expired", passwordExpired: true }, 401);
        }
        return jsonError(c, changeResult.message, changeResult.status === 401 ? 401 : 400);
      }

      const sessionToken = await auth.session.create(c, changeResult.userId, changeResult.ipaSession);

      log.info("Password changed via expired flow", { uid: username });
      return c.json({ session_token: sessionToken, user: changeResult.user });
    },
  )
  .post(
    "/email-login",
    describeRoute({
      tags: ["Auth"],
      summary: "Request magic link login",
      description: "Request a magic link token via email for local account sign-in.",
      responses: {
        200: jsonResponse(MessageResponseSchema, "Request accepted"),
        400: jsonResponse(ErrorResponseSchema, "Email sign-in not available"),
      },
    }),
    v("json", EmailLoginSchema),
    async (c) => {
      const { email } = c.req.valid("json");

      const requestResult = await authFlows.magicLink.request({ email });
      if (!requestResult.ok) {
        return c.json({ message: requestResult.message }, requestResult.status);
      }

      log.info("Magic link requested", { email });
      return c.json({
        message: "If this email can sign in with a login code, a code has been sent.",
      });
    },
  )
  .post(
    "/verify-token",
    describeRoute({
      tags: ["Auth"],
      summary: "Verify magic link token",
      description: "Verify a magic link token and create a session.",
      responses: {
        200: jsonResponse(AuthResponseSchema, "Token verified, session created"),
        401: jsonResponse(ErrorResponseSchema, "Invalid or expired token"),
      },
    }),
    v("json", VerifyTokenSchema),
    async (c) => {
      const { token } = c.req.valid("json");

      const verifyResult = await authFlows.magicLink.verify({ token });
      if (!verifyResult.ok) {
        log.info("Token invalid/expired");
        const status = verifyResult.status >= 500 ? 500 : verifyResult.status === 400 ? 400 : 401;
        return jsonError(c, verifyResult.message, status);
      }

      // Create session (no IPA session for email-only users)
      const sessionToken = await auth.session.create(c, verifyResult.userId, null);

      if (verifyResult.createdGuest) {
        log.info("Guest user created", { email: verifyResult.email, uid: verifyResult.user.uid });
      }
      log.info("Token verified", { email: verifyResult.email });
      return c.json({ session_token: sessionToken, user: verifyResult.user });
    },
  )
  .post(
    "/admin-login",
    describeRoute({
      tags: ["Auth"],
      summary: "Admin token login",
      description: "Hidden emergency login using a static token. Creates/ensures the local admin account.",
      responses: {
        200: jsonResponse(AuthResponseSchema, "Login successful"),
        401: jsonResponse(ErrorResponseSchema, "Invalid token"),
        503: jsonResponse(ErrorResponseSchema, "Admin login not configured"),
      },
    }),
    v("json", AdminLoginSchema),
    async (c) => {
      if (!env.ADMIN_LOGIN_TOKEN) {
        return jsonError(c, "Admin login is not configured.", 500);
      }
      const { token } = c.req.valid("json");
      const a = Buffer.from(token);
      const b = Buffer.from(env.ADMIN_LOGIN_TOKEN);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        log.warn("Admin login failed: invalid token");
        return jsonError(c, "Invalid token.", 401);
      }

      // Ensure the admin user exists and has emergency-admin semantics. The
      // prior `DO NOTHING` could log into a pre-existing `uid='admin'` row that
      // was locally demoted (non-admin local user, or even an IPA row named
      // admin), silently bypassing the intent of the emergency endpoint.
      await sql`
        INSERT INTO auth.users (uid, provider, profile, admin, given_name, sn, display_name)
        VALUES ('admin', 'local', 'user', true, 'Admin', '', 'Admin')
        ON CONFLICT (uid) DO UPDATE SET
          provider = 'local',
          profile = 'user',
          admin = true
      `;

      const user = await accounts.users.get({ uid: "admin" });
      if (!user) return jsonError(c, "Failed to resolve admin user.", 500);

      const sessionToken = await auth.session.create(c, user.id, null);
      log.info("Admin login successful");
      return c.json({ session_token: sessionToken, user });
    },
  );

export default app;

import { Hono } from "hono";
import { sql, redis } from "bun";
import { describeRoute } from "hono-openapi";
import { v } from "@valentinkolb/cloud-lib/server";
import { jsonResponse, requiresAuth } from "@valentinkolb/cloud-lib/server/middleware/openapi";
import { auth, type AuthContext } from "@valentinkolb/cloud-lib/server/middleware/auth";
import { rateLimit } from "@valentinkolb/cloud-lib/server/middleware/rate-limit";
import { env } from "@valentinkolb/cloud-core/config";
import { ipa } from "@valentinkolb/cloud-core/services/ipa";
import { notifications } from "@valentinkolb/cloud-core/services/notifications";
import * as settings from "@valentinkolb/cloud-core/services/settings";
import { renderTemplate } from "@valentinkolb/cloud-core/services/settings/templates";
import { logger } from "@valentinkolb/cloud-core/services/logging";
import { ChangeExpiredPasswordSchema } from "./me/schemas";

const log = logger("auth");
import {
  LoginSchema,
  EmailLoginSchema,
  VerifyTokenSchema,
  AuthResponseSchema,
} from "./auth/schemas";
import { ErrorResponseSchema, MessageResponseSchema } from "@valentinkolb/cloud-contracts/shared";
import { generateUniqueAbbreviation } from "@valentinkolb/cloud-core/services/ipa/users";

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

      // Authenticate against FreeIPA
      const loginResult = await ipa.auth.login(username, password);
      if (loginResult.status === "password_expired") {
        log.info("Login failed", { uid: username, reason: "password_expired" });
        return c.json({ message: "Password expired", passwordExpired: true }, 401);
      }
      if (loginResult.status !== "success") {
        log.info("Login failed", {
          uid: username,
          reason: "invalid_credentials",
        });
        return c.json({ message: "Invalid username or password" }, 401);
      }
      const ipaSession = loginResult.session;

      // Sync user data from FreeIPA on login
      await ipa.sync.user(username);

      // Look up user in DB by uid
      const userRows = await sql`
        SELECT id FROM auth.users
        WHERE realm IN ('ipa', 'ipa-limited')
          AND uid = ${username}`;
      if (userRows.length === 0) {
        log.warn("Login failed: user not synced", { uid: username });
        return c.json(
          {
            message: "Your account is not yet available. Please try again in a few minutes.",
          },
          401,
        );
      }
      const userId = userRows[0]!.id as string;

      // Load full user from DB
      const user = await ipa.users.get({ id: userId });
      if (!user) return c.json({ message: "User not found. Please try again." }, 401);

      // Store minimal session in Redis
      const sessionToken = await auth.session.create(c, userId, ipaSession);

      log.info("Login successful", { uid: username });
      return c.json({
        session_token: sessionToken,
        user,
      });
    },
  )
  .post(
    "/logout",
    describeRoute({
      tags: ["Auth"],
      summary: "Logout",
      description: "Invalidate the current session and clear the session cookie.",
      ...requiresAuth,
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
    "/change-password",
    describeRoute({
      tags: ["Auth"],
      summary: "Change expired password",
      description: "Change an expired or temporary password using FreeIPA's change_password endpoint. No active session required.",
      responses: {
        200: jsonResponse(AuthResponseSchema, "Password changed and logged in"),
        400: jsonResponse(ErrorResponseSchema, "Failed to change password"),
      },
    }),
    v("json", ChangeExpiredPasswordSchema),
    async (c) => {
      const { username, currentPassword, newPassword } = c.req.valid("json");

      // Use service to change expired password
      const changeResult = await ipa.auth.changeExpiredPassword({
        username,
        currentPassword,
        newPassword,
      });
      if (!changeResult.ok) {
        return c.json({ message: changeResult.error }, changeResult.status);
      }

      // Auto-login with new password
      const loginResult = await ipa.auth.login(username, newPassword);
      if (loginResult.status !== "success") {
        return c.json(
          {
            message: "Password changed but auto-login failed. Please log in manually.",
          },
          400,
        );
      }

      // Sync user data from FreeIPA
      await ipa.sync.user(username);

      // Look up user in DB by uid
      const userRows = await sql`
        SELECT id FROM auth.users
        WHERE realm IN ('ipa', 'ipa-limited')
          AND uid = ${username}`;
      if (userRows.length === 0) {
        return c.json(
          {
            message: "Password changed but user not synced yet. Please try logging in.",
          },
          400,
        );
      }
      const userId = userRows[0]!.id as string;

      const user = await ipa.users.get({ id: userId });
      if (!user) {
        return c.json(
          {
            message: "Password changed but user not found. Please try logging in.",
          },
          400,
        );
      }

      const sessionToken = await auth.session.create(c, userId, loginResult.session);

      log.info("Password changed via expired flow", { uid: username });
      return c.json({ session_token: sessionToken, user });
    },
  )
  .post(
    "/email-login",
    describeRoute({
      tags: ["Auth"],
      summary: "Request magic link login",
      description: "Request a magic link token via email. If the email belongs to an IPA user, returns requiresPassword flag.",
      responses: {
        200: jsonResponse(MessageResponseSchema, "Check your email or switch to password login"),
      },
    }),
    v("json", EmailLoginSchema),
    async (c) => {
      const { email } = c.req.valid("json");

      // Look up user by email
      const userRows = await sql`SELECT id, uid, realm FROM auth.users WHERE mail = ${email}`;

      if (userRows.length > 0) {
        const user = userRows[0]!;

        // IPA users must use password login
        if (user.realm === "ipa" || user.realm === "ipa-limited") {
          return c.json({ requiresPassword: true, uid: user.uid });
        }
      }

      // Generate token — store email so user is created on verification
      const token = crypto.randomUUID();
      await redis.set(`email-login:${token}`, JSON.stringify({ email }), "EX", 300);

      // Send email with token
      const appUrl = env.APP_URL.startsWith("http") ? env.APP_URL : `https://${env.APP_URL}`;
      const magicLink = `${appUrl}/auth/login?token=${token}`;

      const appName = await settings.get<string>("app.name");
      const template = await settings.get<string>("user.login.magic_link_email");

      await notifications.send({
        type: "email",
        recipient: email,
        subject: `${appName} Login Code`,
        rawHtml: renderTemplate(template, {
          TOKEN: token,
          MAGIC_LINK: magicLink,
          APP_NAME: appName,
        }),
      });

      log.info("Magic link sent", { email });
      // Always return success (don't leak user existence)
      return c.json({
        message: "If an account with this email exists, a login code has been sent.",
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

      // Look up token in Redis
      const raw = await redis.get(`email-login:${token}`);
      if (!raw) {
        log.info("Token invalid/expired");
        return c.json({ message: "Invalid or expired token" }, 401);
      }

      // Delete token (single-use)
      await redis.del(`email-login:${token}`);

      const { email } = JSON.parse(raw) as { email: string };

      // Find or create user by email
      let userRows = await sql`SELECT id FROM auth.users WHERE mail = ${email} AND realm = 'guest'`;
      let userId: string;

      if (userRows.length > 0) {
        userId = userRows[0]!.id as string;
      } else {
        // Create guest user on first successful login
        const abbrLen = await settings.get<number>("user.abbr_length");
        const guestUid = await generateUniqueAbbreviation(abbrLen);
        const rows = await sql`
          INSERT INTO auth.users (uid, realm, mail, given_name, sn, display_name)
          VALUES (${guestUid}, 'guest', ${email}, '', '', '')
          RETURNING id
        `;
        userId = rows[0]!.id as string;
        log.info("Guest user created", { email, uid: guestUid });
      }

      // Load user
      const user = await ipa.users.get({ id: userId });
      if (!user) {
        return c.json({ message: "User not found" }, 401);
      }

      // Create session (no IPA session for email-only users)
      const sessionToken = await auth.session.create(c, userId, "");

      log.info("Token verified", { email });
      return c.json({ session_token: sessionToken, user });
    },
  );

export default app;

import { redis, sql } from "bun";
import { accounts } from "../accounts";
import { notifications } from "../notifications";
import { providers } from "../providers";
import * as settings from "../settings";
import { renderTemplate } from "../settings/templates";
import type { User } from "../../contracts/shared";
import { createAuthLoginUrl } from "../../shared/redirect";
import { logger } from "../logging";

const log = logger("auth:magic-link");
const IPA_HINT_COOLDOWN_SECONDS = 300;

const normalizeEmail = (email: string): string => email.trim().toLowerCase();
const ipaHintCooldownKey = (email: string): string => `ipa-email-login-hint-cooldown:${email}`;

const getAppUrl = async (): Promise<string> => {
  const rawAppUrl = await settings.get<string>("app.url");
  return rawAppUrl.startsWith("http") ? rawAppUrl : `https://${rawAppUrl}`;
};

const hasIpaAccountForEmail = async (email: string): Promise<boolean> => {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM auth.users
      WHERE provider = 'ipa'
        AND lower(btrim(mail)) = ${email}
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
};

const claimIpaHintCooldown = async (email: string): Promise<boolean> => {
  const result = await redis.send("SET", [
    ipaHintCooldownKey(email),
    "1",
    "EX",
    String(IPA_HINT_COOLDOWN_SECONDS),
    "NX",
  ]);
  return result === "OK";
};

const sendIpaEmailLoginHint = async (params: { email: string; redirectTo?: string }): Promise<void> => {
  const appUrl = await getAppUrl();
  const loginUrl = createAuthLoginUrl(appUrl, {
    method: "ipa",
    redirectTo: params.redirectTo,
  });
  const [appName, contactEmail, template] = await Promise.all([
    settings.get<string>("app.name"),
    settings.get<string>("app.contact_email"),
    settings.get<string>("mail.ipa_email_login_hint"),
  ]);

  await notifications.send({
    type: "email",
    recipient: params.email,
    subject: `${appName} FreeIPA Sign In`,
    rawHtml: renderTemplate(template, {
      EMAIL: params.email,
      LOGIN_URL: loginUrl,
      APP_NAME: appName,
      CONTACT_EMAIL: contactEmail?.trim() ?? "",
    }),
  });
};

export const request = async (params: { email: string; redirectTo?: string }): Promise<
  | { ok: true }
  | { ok: false; status: 400; message: string }
> => {
  const email = normalizeEmail(params.email);
  const hasIpaUser = await hasIpaAccountForEmail(email);
  const userRows = hasIpaUser ? [] : await sql`SELECT uid, provider FROM auth.users WHERE lower(btrim(mail)) = ${email}`;
  const hasLocalUser = userRows.some((row: { provider: string | null }) => row.provider === "local");
  const allowSelfRegistration = await settings.get<boolean>("user.allow_self_registration");

  if (hasIpaUser) {
    if (await claimIpaHintCooldown(email)) {
      void sendIpaEmailLoginHint({ email, redirectTo: params.redirectTo }).catch((error) => {
        log.warn("Failed to send FreeIPA email-login hint", {
          email,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    return { ok: true };
  }

  if (!hasLocalUser && !allowSelfRegistration) {
    return { ok: true };
  }

  const token = await providers.local.auth.createMagicLinkToken({ email, ttlSeconds: 300 });
  const appUrl = await getAppUrl();
  const magicLink = createAuthLoginUrl(appUrl, { token, redirectTo: params.redirectTo });

  const appName = await settings.get<string>("app.name");
  const template = await settings.get<string>("mail.magic_link_login");

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

  return { ok: true };
};

export const verify = async (params: { token: string }): Promise<
  | { ok: true; userId: string; user: User; email: string; createdGuest: boolean }
  | { ok: false; status: 401; message: string }
  | { ok: false; status: number; message: string }
> => {
  const payload = await providers.local.auth.consumeMagicLinkToken(params.token);
  if (!payload) {
    return { ok: false, status: 401, message: "Invalid or expired token" };
  }

  const { email } = payload;
  const normalizedEmail = normalizeEmail(email);
  if (await hasIpaAccountForEmail(normalizedEmail)) {
    return {
      ok: false,
      status: 401,
      message: "This email address belongs to a FreeIPA-managed account. Sign in with FreeIPA.",
    };
  }

  // Reject expired accounts at login time, not just during cleanup. Without
  // this, an expired local user / guest could still authenticate in the
  // window between expiry and the next lifecycle run.
  const userRows = await sql`
    SELECT id, account_expires
    FROM auth.users
    WHERE lower(btrim(mail)) = ${normalizedEmail} AND provider = 'local'
      AND (account_expires IS NULL OR account_expires > now())
    ORDER BY profile = 'user' DESC
    LIMIT 1
  `;

  let userId: string;
  let createdGuest = false;
  if (userRows.length > 0) {
    userId = userRows[0]!.id as string;
  } else {
    // Distinguish "no account" from "account expired" for a better error.
    const expiredRows = await sql`
      SELECT id
      FROM auth.users
      WHERE lower(btrim(mail)) = ${normalizedEmail} AND provider = 'local'
        AND account_expires IS NOT NULL AND account_expires <= now()
      LIMIT 1
    `;
    if (expiredRows.length > 0) {
      return {
        ok: false,
        status: 403,
        message: "Your account has expired. Contact an administrator.",
      };
    }
    const allowSelfRegistration = await settings.get<boolean>("user.allow_self_registration");
    if (!allowSelfRegistration) {
      return {
        ok: false,
        status: 401,
        message: "Only existing local accounts can sign in with email. Contact an administrator if you need access.",
      };
    }
    const guest = await providers.local.users.createGuest({ email });
    if (!guest.ok) {
      return { ok: false, status: guest.status, message: guest.error };
    }
    userId = guest.data.id;
    createdGuest = true;
  }

  const user = await accounts.users.get({ id: userId });
  if (!user) {
    return { ok: false, status: 401, message: "User not found" };
  }

  return { ok: true, userId, user, email, createdGuest };
};

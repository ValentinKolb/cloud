import { sql } from "bun";
import { accounts } from "../accounts";
import { notifications } from "../notifications";
import { providers } from "../providers";
import * as settings from "../settings";
import { renderTemplate } from "../settings/templates";
import type { User } from "../../contracts/shared";
import { createAuthLoginUrl } from "../../shared/redirect";

export const request = async (params: { email: string; redirectTo?: string }): Promise<
  | { ok: true }
  | { ok: false; status: 400; message: string }
> => {
  const userRows = await sql`SELECT uid, provider FROM auth.users WHERE mail = ${params.email}`;
  const hasLocalUser = userRows.some((row: { provider: string | null }) => row.provider === "local");
  const hasIpaUser = userRows.some((row: { provider: string | null }) => row.provider === "ipa");
  const allowSelfRegistration = await settings.get<boolean>("user.allow_self_registration");

  if (!hasLocalUser && !allowSelfRegistration) {
    return {
      ok: false,
      status: 400,
      message: "Only existing local accounts can sign in with email. Contact an administrator if you need access.",
    };
  }

  if (!hasLocalUser && hasIpaUser) {
    // Return ok without sending email to prevent account enumeration.
    // IPA-only users must authenticate via Kerberos, not magic-link.
    return { ok: true };
  }

  const token = await providers.local.auth.createMagicLinkToken({ email: params.email, ttlSeconds: 300 });
  const rawAppUrl = await settings.get<string>("app.url");
  const appUrl = rawAppUrl.startsWith("http") ? rawAppUrl : `https://${rawAppUrl}`;
  const magicLink = createAuthLoginUrl(appUrl, { token, redirectTo: params.redirectTo });

  const appName = await settings.get<string>("app.name");
  const template = await settings.get<string>("mail.magic_link_login");

  await notifications.send({
    type: "email",
    recipient: params.email,
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
  // Reject expired accounts at login time, not just during cleanup. Without
  // this, an expired local user / guest could still authenticate in the
  // window between expiry and the next lifecycle run.
  const userRows = await sql`
    SELECT id, account_expires
    FROM auth.users
    WHERE mail = ${email} AND provider = 'local'
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
      WHERE mail = ${email} AND provider = 'local'
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

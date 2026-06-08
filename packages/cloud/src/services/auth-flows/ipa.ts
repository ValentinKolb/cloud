import { sql } from "bun";
import { accounts } from "../accounts";
import { providers } from "../providers";
import type { User } from "../../contracts/shared";

type IpaLoginFailure =
  | { ok: false; status: 401; reason: "password_expired"; message: string }
  | { ok: false; status: 401; reason: "invalid_credentials"; message: string }
  | { ok: false; status: 400; reason: "user_not_synced"; message: string }
  | { ok: false; status: 400; reason: "user_not_found"; message: string }
  | { ok: false; status: 403; reason: "account_expired"; message: string }
  | { ok: false; status: 403; reason: "account_out_of_scope"; message: string }
  | { ok: false; status: 503; reason: "sync_unavailable"; message: string };

type IpaLoginSuccess = {
  ok: true;
  userId: string;
  user: User;
};

export type IpaLoginFlowResult = IpaLoginSuccess | IpaLoginFailure;

const loadSyncedIpaUser = async (uid: string): Promise<{ ok: true; userId: string; user: User } | IpaLoginFailure> => {
  const userRows = await sql`
    SELECT id FROM auth.users
    WHERE provider = 'ipa'
      AND uid = ${uid}
  `;
  if (userRows.length === 0) {
    return {
      ok: false,
      status: 400,
      reason: "user_not_synced",
      message: "Your account is not yet available. Please try again in a few minutes.",
    };
  }

  const userId = userRows[0]!.id as string;
  const user = await accounts.users.get({ id: userId });
  if (!user) {
    return {
      ok: false,
      status: 400,
      reason: "user_not_found",
      message: "User not found. Please try again.",
    };
  }

  return { ok: true, userId, user };
};

export const login = async (params: { username: string; password: string }): Promise<IpaLoginFlowResult> => {
  const loginResult = await providers.ipa.auth.login(params.username, params.password);
  if (loginResult.status === "password_expired") {
    return { ok: false, status: 401, reason: "password_expired", message: "Password expired" };
  }
  if (loginResult.status !== "success") {
    return { ok: false, status: 401, reason: "invalid_credentials", message: "Invalid username or password" };
  }

  // Must reach a "synced" outcome before granting a session. Stale mirror rows
  // (expired remotely, dropped from sync scope, or fetch failures) must never
  // grant a fresh local session on the back of successful FreeIPA credentials.
  const syncOutcome = await providers.ipa.sync.user(params.username);
  switch (syncOutcome.status) {
    case "synced":
      break;
    case "skipped_disabled":
      break;
    case "expired":
      return {
        ok: false,
        status: 403,
        reason: "account_expired",
        message: "Your FreeIPA account is expired. Contact an administrator.",
      };
    case "out_of_scope":
      return {
        ok: false,
        status: 403,
        reason: "account_out_of_scope",
        message: "Your FreeIPA account is no longer part of the sync scope. Contact an administrator.",
      };
    case "not_found_local":
      return {
        ok: false,
        status: 400,
        reason: "user_not_synced",
        message: "Your account is not yet available. Please try again in a few minutes.",
      };
    case "fetch_failed":
      return {
        ok: false,
        status: 503,
        reason: "sync_unavailable",
        message: "Could not verify your account with FreeIPA. Please try again.",
      };
  }

  const userResult = await loadSyncedIpaUser(params.username);
  if (!userResult.ok) return userResult;

  return {
    ok: true,
    userId: userResult.userId,
    user: userResult.user,
  };
};

export const changeExpiredPassword = async (params: {
  username: string;
  currentPassword: string;
  newPassword: string;
}): Promise<IpaLoginFlowResult | { ok: false; status: number; reason: "change_failed"; message: string }> => {
  const changeResult = await providers.ipa.auth.changeExpiredPassword(params);
  if (!changeResult.ok) {
    return {
      ok: false,
      status: changeResult.status,
      reason: "change_failed",
      message: changeResult.error,
    };
  }

  return login({ username: params.username, password: params.newPassword });
};

import { sql } from "bun";
import { accounts } from "@/services/accounts";
import { providers } from "@/services/providers";
import type { User } from "@valentinkolb/cloud-contracts/shared";

type IpaLoginFailure =
  | { ok: false; status: 401; reason: "password_expired"; message: string }
  | { ok: false; status: 401; reason: "invalid_credentials"; message: string }
  | { ok: false; status: 400; reason: "user_not_synced"; message: string }
  | { ok: false; status: 400; reason: "user_not_found"; message: string };

type IpaLoginSuccess = {
  ok: true;
  ipaSession: string;
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

  await providers.ipa.sync.user(params.username);
  const userResult = await loadSyncedIpaUser(params.username);
  if (!userResult.ok) return userResult;

  return {
    ok: true,
    ipaSession: loginResult.session,
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

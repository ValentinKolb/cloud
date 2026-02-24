import { env } from "@valentinkolb/cloud-core/config/env";
import { baseUrl, call, mapIpaErrorCode } from "./lib";
import type { MutationResult } from "@valentinkolb/cloud-contracts/shared";
import { logger } from "@valentinkolb/cloud-core/services/logging";

const log = logger("auth");

// ==========================
// Login
// ==========================

export type LoginResult = { status: "success"; session: string } | { status: "password_expired" } | { status: "failed" };

/**
 * Authenticates against FreeIPA and returns the session cookie/token string on success.
 */
export const login = async (username: string, password: string): Promise<LoginResult> => {
  const res = await fetch(`${baseUrl()}/ipa/session/login_password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${baseUrl()}/ipa`,
      Accept: "text/plain",
    },
    body: new URLSearchParams({ user: username, password }),
    redirect: "manual",
  });

  // FreeIPA signals password expiry via rejection reason header
  const rejectionReason = res.headers.get("X-IPA-Rejection-Reason");
  if (rejectionReason === "password-expired") {
    return { status: "password_expired" };
  }

  if (!res.ok && res.status !== 303) return { status: "failed" };

  const cookies = res.headers.getSetCookie?.() ?? [];
  for (const cookie of cookies) {
    const match = cookie.match(/ipa_session=([^;]+)/);
    if (match?.[1]) return { status: "success", session: match[1] };
  }

  const single = res.headers.get("set-cookie") ?? "";
  const match = single.match(/ipa_session=([^;]+)/);
  return match?.[1] ? { status: "success", session: match[1] } : { status: "failed" };
};

// ==========================
// Service Session
// ==========================

let svcSession: string | null = null;

/**
 * Returns a cached FreeIPA service session and refreshes it when missing or expired.
 */
export const getServiceSession = async (): Promise<string> => {
  if (svcSession) {
    const check = await call(svcSession, "ping", []);
    if (!check.error) return svcSession;
  }
  const result = await login(env.FREEIPA_SVC_USER, env.FREEIPA_SVC_PASSWORD);
  if (result.status !== "success") {
    log.error("Service account auth failed");
    throw new Error("Failed to authenticate FreeIPA service account. Check FREEIPA_SVC_USER/FREEIPA_SVC_PASSWORD.");
  }
  svcSession = result.session;
  return result.session;
};

// ==========================
// Change Password (for expired passwords, no session required)
// ==========================

/**
 * Change an expired or temporary password using FreeIPA's change_password endpoint.
 * This endpoint works without an active session.
 */
export const changeExpiredPassword = async (params: {
  username: string;
  currentPassword: string;
  newPassword: string;
}): Promise<MutationResult<void>> => {
  const { username, currentPassword, newPassword } = params;

  const res = await fetch(`${baseUrl()}/ipa/session/change_password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${baseUrl()}/ipa`,
      Accept: "text/plain",
    },
    body: new URLSearchParams({
      user: username,
      old_password: currentPassword,
      new_password: newPassword,
    }),
  });

  // FreeIPA returns X-IPA-Pwchange-Result header
  const pwchangeResult = res.headers.get("X-IPA-Pwchange-Result");
  if (pwchangeResult !== "ok") {
    const body = await res.text();
    const policyMatch = body.match(/policy-error[^:]*:\s*(.+)/i);
    const message = policyMatch?.[1] ?? "Failed to change password. Check your current password and try again.";
    return { ok: false, error: message, status: 400 };
  }

  return { ok: true, data: undefined };
};

// ==========================
// Change Password (with session, for authenticated users)
// ==========================

/**
 * Change password for an authenticated user using their session.
 */
export const changePassword = async (params: { ipaSession: string; uid: string; newPassword: string }): Promise<MutationResult<void>> => {
  const { ipaSession, uid, newPassword } = params;

  const response = await call(ipaSession, "user_mod", [uid], {
    userpassword: newPassword,
  });
  if (response.error) {
    return {
      ok: false,
      error: response.error.message ?? "Failed to change password.",
      status: mapIpaErrorCode(response.error.code),
    };
  }

  return { ok: true, data: undefined };
};

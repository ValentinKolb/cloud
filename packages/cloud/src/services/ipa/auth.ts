import type { MutationResult } from "../../contracts/shared";
import { freeipa } from "../../server/services";
import { getFreeIpaTls } from "../../server/services/freeipa/tls";
import { getFreeIpaConfig } from "../freeipa-config";
import { logger } from "../logging";

const log = logger("ipa:auth");

const getEnabledConfig = async (): Promise<MutationResult<{ url: string; serviceUser: string; servicePassword: string }>> => {
  const config = await getFreeIpaConfig();
  if (!config.enabled) {
    return { ok: false, error: "FreeIPA is disabled.", status: 400 };
  }
  if (!config.configured) {
    return { ok: false, error: "FreeIPA is enabled but not fully configured.", status: 500 };
  }
  return {
    ok: true,
    data: {
      url: config.url,
      serviceUser: config.serviceUser,
      servicePassword: config.servicePassword,
    },
  };
};

const normalizePasswordChangeText = (value: string): string =>
  value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractPasswordPolicyMessage = (policyError: string | null, body: string): string | null => {
  const headerMessage = normalizePasswordChangeText(policyError ?? "");
  if (headerMessage) return headerMessage;

  const normalized = normalizePasswordChangeText(body);
  const policyMatch = normalized.match(/policy-error[^:]*:\s*(.+)$/i);
  if (policyMatch?.[1]) return policyMatch[1].trim();

  if (/password|policy|quality|history|complexity|character|length|short|reuse/i.test(normalized)) {
    return normalized.slice(0, 240);
  }
  return null;
};

const isCurrentPasswordFailure = (pwchangeResult: string | null, body: string): boolean => {
  const haystack = `${pwchangeResult ?? ""} ${normalizePasswordChangeText(body)}`.toLowerCase();
  return (
    haystack.includes("invalid credentials") ||
    haystack.includes("authentication failed") ||
    haystack.includes("current password is incorrect") ||
    haystack.includes("old password is incorrect") ||
    haystack.includes("incorrect current password") ||
    haystack.includes("incorrect old password")
  );
};

const mapPasswordChangeFailure = (params: {
  status: number;
  pwchangeResult: string | null;
  policyError: string | null;
  body: string;
}): Extract<MutationResult<void>, { ok: false }> => {
  const policyMessage = extractPasswordPolicyMessage(params.policyError, params.body);
  if (params.pwchangeResult === "policy-error" || normalizePasswordChangeText(params.policyError ?? "")) {
    return {
      ok: false,
      error: policyMessage ?? "FreeIPA rejected the new password. Choose a different password and try again.",
      status: 400,
    };
  }

  if (isCurrentPasswordFailure(params.pwchangeResult, params.body)) {
    return { ok: false, error: "Current password is incorrect.", status: 401 };
  }

  if (policyMessage) {
    return { ok: false, error: policyMessage, status: 400 };
  }

  return {
    ok: false,
    error: "FreeIPA rejected the new password. Choose a different password and try again.",
    status: params.status >= 500 ? 500 : 400,
  };
};

// ==========================
// Login
// ==========================

export type LoginResult = { status: "success"; session: string } | { status: "password_expired" } | { status: "failed" };
export const login = async (username: string, password: string): Promise<LoginResult> => {
  const config = await getEnabledConfig();
  if (!config.ok) return { status: "failed" };
  return freeipa.session.login({ url: config.data.url, username, password });
};

export const getServiceSession = async (): Promise<string> => {
  const config = await getEnabledConfig();
  if (!config.ok) {
    throw new Error(config.error);
  }
  return freeipa.session.getServiceSession({
    url: config.data.url,
    serviceUser: config.data.serviceUser,
    servicePassword: config.data.servicePassword,
  });
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
  const config = await getEnabledConfig();
  if (!config.ok) return config;

  const tls = await getFreeIpaTls();
  const res = await fetch(`${freeipa.client.baseUrl(config.data.url)}/ipa/session/change_password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${freeipa.client.baseUrl(config.data.url)}/ipa`,
      Accept: "text/plain",
    },
    body: new URLSearchParams({
      user: username,
      old_password: currentPassword,
      new_password: newPassword,
    }),
    ...(tls ? { tls } : {}),
  });

  // FreeIPA returns X-IPA-Pwchange-Result header
  const pwchangeResult = res.headers.get("X-IPA-Pwchange-Result");
  if (pwchangeResult !== "ok") {
    const policyError = res.headers.get("X-IPA-Pwchange-Policy-Error");
    const body = await res.text();
    const failure = mapPasswordChangeFailure({ status: res.status, pwchangeResult, policyError, body });
    log.warn("FreeIPA password change failed", {
      status: res.status,
      pwchangeResult,
      mappedStatus: failure.status,
    });
    return failure;
  }

  return { ok: true, data: undefined };
};

export const __ipaAuthTest = {
  mapPasswordChangeFailure,
};

// ==========================
// Change Password (with session, for authenticated users)
// ==========================

/**
 * Change password for an authenticated user using their session.
 */
export const changePassword = async (params: { ipaSession: string; uid: string; newPassword: string }): Promise<MutationResult<void>> => {
  const { ipaSession, uid, newPassword } = params;
  const config = await getEnabledConfig();
  if (!config.ok) return config;

  const response = await freeipa.client.call({
    url: config.data.url,
    ipaSession,
    method: "user_mod",
    args: [uid],
    options: {
      userpassword: newPassword,
    },
  });
  if (response.error) {
    return {
      ok: false,
      error: response.error.message ?? "Failed to change password.",
      status: freeipa.util.mapIpaErrorCode(response.error.code),
    };
  }

  return { ok: true, data: undefined };
};

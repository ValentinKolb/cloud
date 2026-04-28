import { freeipa } from "../../server/services";
import { getFreeIpaTls } from "../../server/services/freeipa/tls";
import type { MutationResult } from "../../contracts/shared";
import { getFreeIpaConfigSync } from "../freeipa-config";

const getEnabledConfig = (): MutationResult<{ url: string; serviceUser: string; servicePassword: string }> => {
  const config = getFreeIpaConfigSync();
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

// ==========================
// Login
// ==========================

export type LoginResult = { status: "success"; session: string } | { status: "password_expired" } | { status: "failed" };
export const login = async (username: string, password: string): Promise<LoginResult> => {
  const config = getEnabledConfig();
  if (!config.ok) return { status: "failed" };
  return freeipa.session.login({ url: config.data.url, username, password });
};

export const getServiceSession = async (): Promise<string> => {
  const config = getEnabledConfig();
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
  const config = getEnabledConfig();
  if (!config.ok) return config;

  const tls = getFreeIpaTls();
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
  const config = getEnabledConfig();
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

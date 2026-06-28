import { baseUrl, call } from "./client";
import { getFreeIpaTls, getFreeIpaTlsFingerprint } from "./tls";

export type LoginResult = { status: "success"; session: string } | { status: "password_expired" } | { status: "failed" };

export const login = async (config: { url: string; username: string; password: string }): Promise<LoginResult> => {
  const tls = await getFreeIpaTls();
  const res = await fetch(`${baseUrl(config.url)}/ipa/session/login_password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${baseUrl(config.url)}/ipa`,
      Accept: "text/plain",
    },
    body: new URLSearchParams({ user: config.username, password: config.password }),
    redirect: "manual",
    ...(tls ? { tls } : {}),
  });

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

let svcSession: string | null = null;
let svcSessionPromise: Promise<string> | null = null;
let svcSessionKey: string | null = null;

export const getServiceSession = async (config: { url: string; serviceUser: string; servicePassword: string }): Promise<string> => {
  // Include TLS fingerprint so toggling allow_insecure or rotating ca_cert
  // forces a re-login (otherwise the cached session keeps using the old TLS
  // trust anchor for fetches that wouldn't have succeeded under it).
  const currentKey = `${config.url}::${config.serviceUser}::${await getFreeIpaTlsFingerprint()}`;
  if (svcSessionKey !== currentKey) {
    svcSession = null;
    svcSessionKey = currentKey;
  }

  if (svcSession) {
    const check = await call({ url: config.url, ipaSession: svcSession, method: "ping", args: [] });
    if (!check.error) return svcSession;
  }
  if (!svcSessionPromise) {
    svcSessionPromise = (async () => {
      const result = await login({
        url: config.url,
        username: config.serviceUser,
        password: config.servicePassword,
      });
      if (result.status !== "success") {
        console.error("[freeipa:session] Service account auth failed");
        throw new Error("Failed to authenticate FreeIPA service account. Check freeipa.url/freeipa.service_user/freeipa.service_password.");
      }
      svcSession = result.session;
      return result.session;
    })().finally(() => {
      svcSessionPromise = null;
    });
  }
  return svcSessionPromise;
};

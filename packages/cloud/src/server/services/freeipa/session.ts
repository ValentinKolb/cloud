import { createHash } from "node:crypto";
import { baseUrl, call } from "./client";
import { getFreeIpaTls, getFreeIpaTlsFingerprint } from "./tls";
import {
  FreeIpaTransportError,
  isFreeIpaUpstreamStatus,
  readFreeIpaErrorBody,
  upstreamFreeIpaError,
  withFreeIpaResponse,
} from "./transport";

export type LoginResult = { status: "success"; session: string } | { status: "password_expired" } | { status: "failed" };

export const login = async (config: { url: string; username: string; password: string; signal?: AbortSignal }): Promise<LoginResult> => {
  const tls = await getFreeIpaTls();
  return withFreeIpaResponse(
    `${baseUrl(config.url)}/ipa/session/login_password`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: `${baseUrl(config.url)}/ipa`,
        Accept: "text/plain",
      },
      body: new URLSearchParams({ user: config.username, password: config.password }),
      redirect: "manual",
      tls,
    },
    async (res): Promise<LoginResult> => {
      const rejectionReason = res.headers.get("X-IPA-Rejection-Reason");
      if (rejectionReason === "password-expired") {
        await readFreeIpaErrorBody(res);
        return { status: "password_expired" };
      }

      if (isFreeIpaUpstreamStatus(res.status)) {
        await readFreeIpaErrorBody(res);
        throw upstreamFreeIpaError(res.status);
      }
      if (!res.ok && res.status !== 303) {
        await readFreeIpaErrorBody(res);
        return { status: "failed" };
      }

      await res.body?.cancel().catch(() => undefined);
      const cookies = res.headers.getSetCookie?.() ?? [];
      for (const cookie of cookies) {
        const match = cookie.match(/ipa_session=([^;]+)/);
        if (match?.[1]) return { status: "success", session: match[1] };
      }

      const single = res.headers.get("set-cookie") ?? "";
      const match = single.match(/ipa_session=([^;]+)/);
      if (match?.[1]) return { status: "success", session: match[1] };
      throw new FreeIpaTransportError("invalid_response", "FreeIPA login succeeded without a session cookie");
    },
    { signal: config.signal },
  );
};

let svcSession: string | null = null;
let svcSessionPending: { key: string; promise: Promise<string> } | null = null;
let svcSessionKey: string | null = null;

const fingerprint = (value: string): string => createHash("sha256").update(value).digest("hex");

const openServiceSession = async (config: {
  url: string;
  serviceUser: string;
  servicePassword: string;
  signal?: AbortSignal;
}): Promise<string> => {
  const result = await login({
    url: config.url,
    username: config.serviceUser,
    password: config.servicePassword,
    signal: config.signal,
  });
  if (result.status !== "success") {
    console.error("[freeipa:session] Service account auth failed");
    throw new Error("Failed to authenticate FreeIPA service account. Check freeipa.url/freeipa.service_user/freeipa.service_password.");
  }
  return result.session;
};

export const getServiceSession = async (config: {
  url: string;
  serviceUser: string;
  servicePassword: string;
  signal?: AbortSignal;
}): Promise<string> => {
  // Include password and TLS fingerprints so credential or trust rotation
  // cannot keep reusing a session opened under the previous configuration.
  const currentKey = `${config.url}::${config.serviceUser}::${fingerprint(config.servicePassword)}::${await getFreeIpaTlsFingerprint()}`;
  if (svcSessionKey !== currentKey) {
    svcSession = null;
    svcSessionKey = currentKey;
  }

  if (svcSession) {
    const check = await call({ url: config.url, ipaSession: svcSession, method: "ping", args: [], signal: config.signal });
    if (!check.error) return svcSession;
  }
  // An abortable caller must not share its signal with unrelated requests via
  // the singleton in-flight login promise.
  if (config.signal) {
    const session = await openServiceSession(config);
    if (svcSessionKey === currentKey) svcSession = session;
    return session;
  }
  if (svcSessionPending?.key !== currentKey) {
    const pending = openServiceSession(config)
      .then((session) => {
        if (svcSessionKey === currentKey) svcSession = session;
        return session;
      })
      .finally(() => {
        if (svcSessionPending?.promise === pending) svcSessionPending = null;
      });
    svcSessionPending = { key: currentKey, promise: pending };
  }
  return svcSessionPending.promise;
};

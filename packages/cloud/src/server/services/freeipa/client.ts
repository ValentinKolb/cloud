import { getFreeIpaTls } from "./tls";

export type IpaRpcResult = {
  result: unknown;
  count: number;
  truncated: boolean;
  summary: string | null;
};

export type IpaRpcResponse = {
  result: IpaRpcResult | null;
  error: { code: number; message: string; name: string } | null;
  id: number;
};

export const baseUrl = (url: string): string => `https://${url}`;

const isNoModificationError = (error: IpaRpcResponse["error"]): boolean =>
  error?.code === 4202 && (error.message ?? "").toLowerCase().includes("no modifications to be performed");

export const call = async (config: {
  url: string;
  ipaSession: string;
  method: string;
  args?: unknown[];
  options?: Record<string, unknown>;
}): Promise<IpaRpcResponse> => {
  const tls = await getFreeIpaTls();
  const res = await fetch(`${baseUrl(config.url)}/ipa/session/json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: `${baseUrl(config.url)}/ipa`,
      Accept: "application/json",
      Cookie: `ipa_session=${config.ipaSession}`,
    },
    body: JSON.stringify({
      method: config.method,
      params: [config.args ?? [], { ...(config.options ?? {}), version: "2.251" }],
      id: 0,
    }),
    ...(tls ? { tls } : {}),
  });

  if (!res.ok || !res.headers.get("content-type")?.includes("json")) {
    const text = await res.text();
    console.error("[freeipa:client] Non-JSON response", {
      method: config.method,
      status: res.status,
      body: text.slice(0, 200),
    });

    if (res.status === 401 || text.includes("Invalid Authentication") || text.includes("GSSAPI Error")) {
      return {
        result: null,
        error: {
          code: 403,
          message: "Your IPA session has expired or is invalid. Please log out and log in again to refresh your session.",
          name: "SessionExpired",
        },
        id: 0,
      };
    }

    return {
      result: null,
      error: {
        code: res.status,
        message: "Non-JSON response from IPA",
        name: "FetchError",
      },
      id: 0,
    };
  }

  const response = (await res.json()) as IpaRpcResponse;
  if (response.error) {
    if (isNoModificationError(response.error)) {
      return {
        result: {
          result: null,
          count: 0,
          truncated: false,
          summary: response.error.message,
        },
        error: null,
        id: response.id,
      };
    }

    console.error("[freeipa:client] RPC failed", {
      method: config.method,
      code: response.error.code,
      message: response.error.message,
    });
  }
  return response;
};

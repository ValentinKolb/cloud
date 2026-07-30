import { getFreeIpaTls } from "./tls";
import { FreeIpaTransportError, isFreeIpaUpstreamStatus, readFreeIpaErrorBody, withFreeIpaResponse } from "./transport";

export type IpaRpcResult = {
  result: unknown;
  count: number;
  truncated: boolean;
  summary: string | null;
};

export type IpaRpcResponse = {
  result: IpaRpcResult | null;
  error: {
    code: number;
    message: string;
    name: string;
    kind: "invalid_response" | "rpc" | "session" | "upstream";
  } | null;
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
  signal?: AbortSignal;
}): Promise<IpaRpcResponse> => {
  const tls = await getFreeIpaTls();
  return withFreeIpaResponse(
    `${baseUrl(config.url)}/ipa/session/json`,
    {
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
      tls,
    },
    async (res) => {
      if (!res.ok || !res.headers.get("content-type")?.includes("json")) {
        const body = await readFreeIpaErrorBody(res);
        const text = body.text;
        console.error("[freeipa:client] Non-JSON response", {
          method: config.method,
          status: res.status,
          bodyTruncated: body.truncated,
        });

        if (res.status === 401 || text.includes("Invalid Authentication") || text.includes("GSSAPI Error")) {
          return {
            result: null,
            error: {
              code: 403,
              message: "Your IPA session has expired or is invalid. Please log out and log in again to refresh your session.",
              name: "SessionExpired",
              kind: "session",
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
            kind: isFreeIpaUpstreamStatus(res.status) ? "upstream" : "invalid_response",
          },
          id: 0,
        };
      }

      const payload: unknown = await res.json().catch((error) => {
        throw new FreeIpaTransportError("invalid_response", "FreeIPA returned invalid JSON", { cause: error });
      });
      if (typeof payload !== "object" || payload === null) {
        throw new FreeIpaTransportError("invalid_response", "FreeIPA returned an invalid RPC response");
      }
      const response = payload as Partial<IpaRpcResponse>;
      if (
        !Object.hasOwn(response, "result") ||
        !Object.hasOwn(response, "error") ||
        typeof response.id !== "number" ||
        !Number.isFinite(response.id) ||
        (response.result === null) === (response.error === null) ||
        (response.result !== null &&
          (typeof response.result !== "object" || response.result === null || !Object.hasOwn(response.result, "result"))) ||
        (response.error !== null &&
          response.error !== undefined &&
          (typeof response.error !== "object" ||
            response.error === null ||
            typeof response.error.code !== "number" ||
            typeof response.error.message !== "string" ||
            typeof response.error.name !== "string"))
      ) {
        throw new FreeIpaTransportError("invalid_response", "FreeIPA returned an invalid RPC response");
      }
      const typedResponse = response as IpaRpcResponse;
      if (typedResponse.error) {
        if (isNoModificationError(typedResponse.error)) {
          return {
            result: {
              result: null,
              count: 0,
              truncated: false,
              summary: typedResponse.error.message,
            },
            error: null,
            id: typedResponse.id,
          };
        }

        console.error("[freeipa:client] RPC failed", {
          method: config.method,
          code: typedResponse.error.code,
          message: typedResponse.error.message,
        });
      }
      return typedResponse.error ? { ...typedResponse, error: { ...typedResponse.error, kind: "rpc" } } : typedResponse;
    },
    { signal: config.signal },
  );
};

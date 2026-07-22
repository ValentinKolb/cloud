import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { createPinnedLookup, EndpointPolicyError, resolvePublicEndpoint } from "./connectors/endpoint-policy";

const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

export const validateOAuthEndpoint = (raw: string): URL => {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) {
    throw new EndpointPolicyError("OAuth endpoint must be a public HTTPS URL without credentials or fragments");
  }
  return url;
};

const oauthRequestError = (message: string, code: string, extra?: Record<string, unknown>): Error =>
  Object.assign(new Error(message), { code, ...extra });

export const classifyOAuthTokenRejection = (value: unknown): Error => {
  const providerCode =
    typeof value === "object" && value !== null && typeof (value as { error?: unknown }).error === "string"
      ? (value as { error: string }).error
      : null;
  if (providerCode === "invalid_grant" || providerCode === "invalid_client") {
    return oauthRequestError("OAuth credential requires reconnection", "CREDENTIAL_EXPIRED", {
      authenticationFailed: true,
      retryable: false,
    });
  }
  return oauthRequestError("OAuth provider rejected the token request", "OAUTH_TOKEN_REJECTED", { retryable: true });
};

const readBoundedJson = (response: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    response.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_RESPONSE_BYTES) {
        rejectOnce(oauthRequestError("OAuth token response is too large", "OAUTH_TOKEN_INVALID"));
        response.destroy();
        return;
      }
      chunks.push(buffer);
    });
    response.on("end", () => {
      if (settled) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        settled = true;
        resolve(value);
      } catch {
        rejectOnce(oauthRequestError("OAuth provider returned invalid JSON", "OAUTH_TOKEN_INVALID"));
      }
    });
    response.on("error", (cause) =>
      rejectOnce(oauthRequestError("OAuth token response could not be read", "OAUTH_TOKEN_UNAVAILABLE", { cause, retryable: true })),
    );
  });

export const postOAuthForm = async (rawUrl: string, form: URLSearchParams): Promise<unknown> => {
  const url = validateOAuthEndpoint(rawUrl);
  const endpoint = await resolvePublicEndpoint({ host: url.hostname, port: 443, tlsMode: "implicit" });
  const body = form.toString();
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        protocol: "https:",
        hostname: endpoint.host,
        servername: endpoint.host,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        lookup: createPinnedLookup(endpoint),
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
          "content-length": Buffer.byteLength(body),
          "user-agent": "Cloud-Mail-OAuth/1",
        },
      },
      async (response) => {
        const status = response.statusCode ?? 500;
        const contentType = response.headers["content-type"]?.toLowerCase() ?? "";
        if (status < 200 || status >= 300) {
          if (status >= 400 && status < 500 && contentType.includes("json")) {
            try {
              reject(classifyOAuthTokenRejection(await readBoundedJson(response)));
            } catch (error) {
              reject(error);
            }
            return;
          }
          response.resume();
          reject(oauthRequestError("OAuth provider could not complete the token request", "OAUTH_TOKEN_UNAVAILABLE", { retryable: true }));
          return;
        }
        if (!contentType.includes("json")) {
          response.resume();
          reject(oauthRequestError("OAuth provider returned an unsupported token response", "OAUTH_TOKEN_INVALID"));
          return;
        }
        try {
          resolve(await readBoundedJson(response));
        } catch (error) {
          reject(error);
        }
      },
    );
    request.on("timeout", () => request.destroy(new Error("OAuth token request timed out")));
    request.on("error", reject);
    request.end(body);
  });
};

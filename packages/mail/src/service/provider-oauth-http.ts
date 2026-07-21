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
      (response) => {
        if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
          response.resume();
          reject(Object.assign(new Error("OAuth provider rejected the token request"), { code: "OAUTH_TOKEN_REJECTED" }));
          return;
        }
        const contentType = response.headers["content-type"]?.toLowerCase() ?? "";
        if (!contentType.includes("json")) {
          response.resume();
          reject(Object.assign(new Error("OAuth provider returned an unsupported token response"), { code: "OAUTH_TOKEN_INVALID" }));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) response.destroy(new Error("OAuth token response is too large"));
          else chunks.push(chunk);
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(Object.assign(new Error("OAuth provider returned invalid JSON"), { code: "OAUTH_TOKEN_INVALID" }));
          }
        });
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new Error("OAuth token request timed out")));
    request.on("error", reject);
    request.end(body);
  });
};

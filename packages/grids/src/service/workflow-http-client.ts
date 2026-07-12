import { lookup as dnsLookup } from "node:dns/promises";
import { type ClientRequest, request as httpRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { get as settingsGet } from "@valentinkolb/cloud/services/settings";
import { isUnsafeNetworkAddress, isUnsafeNetworkHostname, normalizeNetworkHostname } from "@valentinkolb/cloud/shared";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";

const PRIVATE_HTTP_SETTING = "grids.http_request_allow_private_networks";
const ALLOWED_HOSTS_SETTING = "grids.http_request_allowed_hosts";
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 60_000;

type RequestFactory = (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
type LookupAddress = { address: string; family: number };

type WorkflowHttpClientDeps = {
  getSetting?: (key: string) => Promise<unknown>;
  lookup?: (hostname: string, options: { all: true; verbatim: true }) => Promise<LookupAddress[]>;
  request?: RequestFactory;
  tlsCa?: string | Buffer;
};

type WorkflowHttpRequestInput = {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

type WorkflowHttpResponse = {
  status: number;
  ok: boolean;
  body: string;
  host: string;
};

type ResolvedTarget = {
  url: URL;
  address: string;
  family: 4 | 6;
};

export const isUnsafeWorkflowHttpAddress = isUnsafeNetworkAddress;

const normalizeHostname = normalizeNetworkHostname;

const hostMatches = (hostname: string, pattern: string): boolean => {
  const normalized = normalizeHostname(pattern.trim());
  if (!normalized) return false;
  if (!normalized.startsWith("*.")) return hostname === normalized;
  const suffix = normalized.slice(1);
  return hostname.endsWith(suffix) && hostname.length > suffix.length;
};

const isUnsafeHostname = isUnsafeNetworkHostname;

const resolveTarget = async (rawUrl: string, deps: WorkflowHttpClientDeps): Promise<Result<ResolvedTarget>> => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return fail(err.badInput("HTTP request URL is invalid"));
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return fail(err.badInput("HTTP request URL must use http or https"));
  if (url.username || url.password) return fail(err.badInput("HTTP request URL must not contain credentials"));

  const getSetting = deps.getSetting ?? ((key: string) => settingsGet(key));
  const hostname = normalizeHostname(url.hostname);
  const allowedHostsValue = await getSetting(ALLOWED_HOSTS_SETTING);
  const allowedHosts = Array.isArray(allowedHostsValue)
    ? allowedHostsValue.filter((value): value is string => typeof value === "string")
    : [];
  if (allowedHosts.length > 0 && !allowedHosts.some((pattern) => hostMatches(hostname, pattern))) {
    return fail(err.badInput("HTTP request target is not allowed by the configured host allowlist"));
  }

  const allowPrivate = Boolean(await getSetting(PRIVATE_HTTP_SETTING));
  const privateHostname = isUnsafeHostname(hostname);
  if (privateHostname && (!allowPrivate || allowedHosts.length === 0)) {
    return fail(err.badInput("HTTP request target is not allowed"));
  }

  const literalFamily = isIP(hostname);
  const lookupAll = deps.lookup ?? ((host: string) => dnsLookup(host, { all: true, verbatim: true }) as Promise<LookupAddress[]>);
  const addresses: LookupAddress[] = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookupAll(hostname, { all: true, verbatim: true }).catch(() => []);
  if (addresses.length === 0) return fail(err.badInput("HTTP request target could not be resolved"));
  const hasUnsafeAddress = addresses.some((entry) => isUnsafeWorkflowHttpAddress(entry.address));
  if (hasUnsafeAddress && (!allowPrivate || allowedHosts.length === 0)) {
    return fail(err.badInput("HTTP request target is not allowed"));
  }
  const selected = addresses[0];
  if (!selected || (selected.family !== 4 && selected.family !== 6)) return fail(err.badInput("HTTP request target could not be resolved"));
  return ok({ url, address: selected.address, family: selected.family });
};

const BLOCKED_REQUEST_HEADERS = new Set([
  "accept-encoding",
  "connection",
  "content-length",
  "host",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const requestHeaders = (input: WorkflowHttpRequestInput): Result<Record<string, string>> => {
  const headers: Record<string, string> = { "accept-encoding": "identity" };
  for (const [rawName, value] of Object.entries(input.headers ?? {})) {
    const name = rawName.trim().toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || /[\r\n]/.test(value)) {
      return fail(err.badInput(`httpRequest header "${rawName}" is invalid`));
    }
    if (BLOCKED_REQUEST_HEADERS.has(name)) return fail(err.badInput(`httpRequest header "${rawName}" is not allowed`));
    headers[name] = value;
  }
  if (input.body !== undefined) {
    const bodyBytes = Buffer.byteLength(input.body);
    if (bodyBytes > MAX_REQUEST_BYTES) return fail(err.badInput("httpRequest body is too large"));
    headers["content-type"] ??= "application/json";
    headers["content-length"] = String(bodyBytes);
  }
  return ok(headers);
};

const sendPinnedRequest = (
  target: ResolvedTarget,
  input: WorkflowHttpRequestInput,
  headers: Record<string, string>,
  signal: AbortSignal,
  deps: WorkflowHttpClientDeps,
): Promise<WorkflowHttpResponse> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      callback();
    };
    const factory = deps.request ?? (target.url.protocol === "https:" ? httpsRequest : httpRequest);
    const options = {
      protocol: target.url.protocol,
      hostname: normalizeHostname(target.url.hostname),
      port: target.url.port || undefined,
      path: `${target.url.pathname}${target.url.search}`,
      method: input.method,
      headers,
      servername: normalizeHostname(target.url.hostname),
      ca: deps.tlsCa,
      lookup: (_hostname, options, callback) => {
        if (typeof options === "object" && options.all) {
          (callback as (error: Error | null, addresses: LookupAddress[]) => void)(null, [
            { address: target.address, family: target.family },
          ]);
          return;
        }
        (callback as (error: Error | null, address: string, family: number) => void)(null, target.address, target.family);
      },
    } as RequestOptions & { servername: string };
    const request = factory(options, (response) => {
      const declaredLength = Number(response.headers["content-length"] ?? 0);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        response.destroy();
        request.destroy();
        finish(() => reject(new Error("response too large")));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (size + buffer.length > MAX_RESPONSE_BYTES) {
          response.destroy();
          request.destroy();
          finish(() => reject(new Error("response too large")));
          return;
        }
        size += buffer.length;
        chunks.push(buffer);
      });
      response.once("end", () => {
        const status = response.statusCode ?? 0;
        finish(() =>
          resolve({ status, ok: status >= 200 && status < 300, body: Buffer.concat(chunks, size).toString("utf8"), host: target.url.host }),
        );
      });
      response.once("error", (error) => finish(() => reject(error)));
    });
    const abort = () => request.destroy(Object.assign(new Error("request timed out"), { name: "AbortError" }));
    request.once("error", (error) => finish(() => reject(error)));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    request.end(input.body);
  });

export const requestWorkflowHttp = async (
  input: WorkflowHttpRequestInput,
  deps: WorkflowHttpClientDeps = {},
): Promise<Result<WorkflowHttpResponse>> => {
  const headers = requestHeaders(input);
  if (!headers.ok) return headers;
  const timeoutMs = Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const target = await Promise.race([
      resolveTarget(input.url, deps),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => reject(Object.assign(new Error("request timed out"), { name: "AbortError" })), {
          once: true,
        });
      }),
    ]);
    if (!target.ok) return target;
    return ok(await sendPinnedRequest(target.data, input, headers.data, controller.signal, deps));
  } catch (error) {
    if (error instanceof Error && error.message === "response too large") return fail(err.badInput("httpRequest response is too large"));
    if (error instanceof Error && error.name === "AbortError") return fail(err.badInput("httpRequest timed out"));
    return fail(err.badInput("httpRequest failed"));
  } finally {
    clearTimeout(timer);
  }
};

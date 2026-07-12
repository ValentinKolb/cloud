import { lookup as dnsLookup } from "node:dns/promises";
import { type ClientRequest, request as httpRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { get as settingsGet } from "@valentinkolb/cloud/services/settings";
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

const ipv4ToNumber = (address: string): number | null => {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((value, part) => (value * 256 + part) >>> 0, 0);
};

const ipv4InRange = (address: string, base: string, bits: number): boolean => {
  const value = ipv4ToNumber(address);
  const baseValue = ipv4ToNumber(base);
  if (value === null || baseValue === null) return true;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (baseValue & mask);
};

const UNSAFE_IPV4_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const ipv6ToBigInt = (rawAddress: string): bigint | null => {
  let address = rawAddress.toLowerCase().split("%")[0] ?? "";
  if (address.includes(".")) {
    const separator = address.lastIndexOf(":");
    const ipv4 = ipv4ToNumber(address.slice(separator + 1));
    if (separator < 0 || ipv4 === null) return null;
    address = `${address.slice(0, separator)}:${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (missing < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
};

const ipv6InRange = (address: bigint, base: bigint, bits: number): boolean => {
  const shift = BigInt(128 - bits);
  return address >> shift === base >> shift;
};

const UNSAFE_IPV6_RANGES: ReadonlyArray<readonly [bigint, number]> = [
  [ipv6ToBigInt("::")!, 96],
  [ipv6ToBigInt("64:ff9b::")!, 96],
  [ipv6ToBigInt("64:ff9b:1::")!, 48],
  [ipv6ToBigInt("100::")!, 64],
  [ipv6ToBigInt("2001::")!, 32],
  [ipv6ToBigInt("2001:2::")!, 48],
  [ipv6ToBigInt("2001:db8::")!, 32],
  [ipv6ToBigInt("2002::")!, 16],
  [ipv6ToBigInt("fc00::")!, 7],
  [ipv6ToBigInt("fe80::")!, 10],
  [ipv6ToBigInt("fec0::")!, 10],
  [ipv6ToBigInt("ff00::")!, 8],
];

export const isUnsafeWorkflowHttpAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) return UNSAFE_IPV4_RANGES.some(([base, bits]) => ipv4InRange(address, base, bits));
  if (family !== 6) return true;
  const value = ipv6ToBigInt(address);
  if (value === null) return true;
  if (value >> 32n === 0xffffn) {
    const mapped = Number(value & 0xffffffffn);
    const ipv4 = [mapped >>> 24, (mapped >>> 16) & 255, (mapped >>> 8) & 255, mapped & 255].join(".");
    return isUnsafeWorkflowHttpAddress(ipv4);
  }
  return UNSAFE_IPV6_RANGES.some(([base, bits]) => ipv6InRange(value, base, bits));
};

const normalizeHostname = (hostname: string): string =>
  hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");

const hostMatches = (hostname: string, pattern: string): boolean => {
  const normalized = normalizeHostname(pattern.trim());
  if (!normalized) return false;
  if (!normalized.startsWith("*.")) return hostname === normalized;
  const suffix = normalized.slice(1);
  return hostname.endsWith(suffix) && hostname.length > suffix.length;
};

const isUnsafeHostname = (hostname: string): boolean =>
  hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal" || hostname.endsWith(".internal");

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

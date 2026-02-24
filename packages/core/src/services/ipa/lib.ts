import { env } from "@valentinkolb/cloud-core/config/env";
import { logger } from "@valentinkolb/cloud-core/services/logging";

const log = logger("ipa");

// ==========================
// Errors
// ==========================

/**
 * Custom error class for IPA operations.
 * Thrown instead of returning false/null to ensure errors are never silent.
 */
export class IpaError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "IpaError";
  }
}

// ==========================
// Types
// ==========================

export type DbRow = Record<string, unknown>;

export type IpaRpcResult = {
  result: unknown;
  count: number;
  truncated: boolean;
  summary: string | null;
};

type IpaRpcResponse = {
  result: IpaRpcResult | null;
  error: { code: number; message: string; name: string } | null;
  id: number;
};

// ==========================
// Helpers
// ==========================

/**
 * Builds the canonical FreeIPA JSON-RPC base URL from runtime config.
 */
export const baseUrl = (): string => `https://${env.FREEIPA_URL}`;

/**
 * Executes one FreeIPA JSON-RPC call and normalizes transport/protocol errors.
 */
export const call = async (
  ipaSession: string,
  method: string,
  args: unknown[] = [],
  options: Record<string, unknown> = {},
): Promise<IpaRpcResponse> => {
  const res = await fetch(`${baseUrl()}/ipa/session/json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: `${baseUrl()}/ipa`,
      Accept: "application/json",
      Cookie: `ipa_session=${ipaSession}`,
    },
    body: JSON.stringify({
      method,
      params: [args, { ...options, version: "2.251" }],
      id: 0,
    }),
  });

  if (!res.ok || !res.headers.get("content-type")?.includes("json")) {
    const text = await res.text();
    log.error("Non-JSON response", {
      method,
      status: res.status,
      body: text.slice(0, 200),
    });

    // Check for authentication/session errors (401 Unauthorized, GSSAPI errors)
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
    log.error("RPC failed", {
      method,
      code: response.error.code,
      message: response.error.message,
    });
  }
  return response;
};

/**
 * Normalizes IPA values to string form (first element fallback for array payloads).
 */
export const str = (val: unknown): string => {
  if (Array.isArray(val)) return String(val[0] ?? "");
  return String(val ?? "");
};

/**
 * Parses numeric IPA values and returns null for non-numeric payloads.
 */
export const num = (val: unknown): number | null => {
  const raw = Array.isArray(val) ? val[0] : val;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
};

/** Parse FreeIPA generalized time (e.g. "20261231235959Z") to Date or null.
 *  Handles both plain strings and FreeIPA's `{ __datetime__: "..." }` wrapper. */
export const parseGeneralizedTime = (val: unknown): Date | null => {
  // Unwrap: val could be an array like [{ __datetime__: "..." }] or ["20261231235959Z"]
  let raw = Array.isArray(val) ? val[0] : val;
  // Handle FreeIPA's __datetime__ wrapper object
  if (raw && typeof raw === "object" && "__datetime__" in raw) {
    raw = (raw as Record<string, unknown>).__datetime__;
  }
  const s = typeof raw === "string" ? raw : "";
  if (!s || s.length < 14) return null;
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
};

/** Convert a JS string array to a Postgres TEXT[] literal (Bun sql can't serialize empty arrays). */
export const toPgTextArray = (values: string[]): string =>
  `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;

export const excludedGroupsSet = new Set(env.GROUPS_EXCLUDED);

/**
 * Map IPA error codes to HTTP status codes.
 * @param code - IPA error code
 * @returns HTTP status: 401 (unauthorized), 403 (forbidden), or 400 (bad request)
 */
export const mapIpaErrorCode = (code: number): 400 | 401 | 403 => {
  if (code === 4001) return 401;
  if (code === 4301) return 403;
  return 400;
};

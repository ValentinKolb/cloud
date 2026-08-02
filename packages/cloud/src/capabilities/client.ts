import { z } from "zod";
import { CapabilityActionReviewSchema, type CapabilityResult, capabilityResultSchema } from "../contracts/capabilities";
import { readCapabilityResponse } from "./response";
import type {
  CapabilityClientError,
  CapabilityClientResult,
  CapabilityHttpOptions,
  CapabilityInvocation,
  CapabilityReviewClientResult,
} from "./types";

export type {
  CapabilityClientError,
  CapabilityClientResult,
  CapabilityHttpOptions,
  CapabilityInvocation,
  CapabilityKind,
  CapabilityReviewClientResult,
} from "./types";

const capabilityPath = (invocation: Pick<CapabilityInvocation, "appId" | "capabilityId" | "kind">, review = false): string => {
  const kind = invocation.kind === "query" ? "queries" : "actions";
  return `/capabilities/v1/${kind}/${encodeURIComponent(invocation.appId)}/${encodeURIComponent(invocation.capabilityId)}${review ? "/review" : ""}`;
};

const requestUrl = (baseUrl: string, path: string): string => `${baseUrl.replace(/\/$/, "")}${path}`;

const unavailable = (cause: unknown): { ok: false; error: CapabilityClientError } => ({
  ok: false,
  error: {
    code: "APP_UNAVAILABLE",
    message: cause instanceof Error && cause.name === "AbortError" ? "Capability request was cancelled" : "Cloud is unavailable",
    status: 503,
  },
});

export const invokeCapability = async <TData, TInput = unknown>(
  invocation: CapabilityInvocation<TInput>,
  options: CapabilityHttpOptions = {},
): Promise<CapabilityClientResult<TData>> => {
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  headers.set("content-type", "application/json");
  if (invocation.idempotencyKey) headers.set("idempotency-key", invocation.idempotencyKey);
  try {
    const response = await (options.fetch ?? globalThis.fetch)(requestUrl(options.baseUrl ?? "/api", capabilityPath(invocation)), {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify({ input: invocation.input }),
      signal: invocation.signal,
    });
    return readCapabilityResponse(response, capabilityResultSchema(z.unknown()) as z.ZodType<CapabilityResult<TData>>);
  } catch (cause) {
    return unavailable(cause);
  }
};

export const reviewCapabilityAction = async <TInput = unknown>(
  invocation: Omit<CapabilityInvocation<TInput>, "kind" | "idempotencyKey">,
  options: CapabilityHttpOptions = {},
): Promise<CapabilityReviewClientResult> => {
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  headers.set("content-type", "application/json");
  const action = { ...invocation, kind: "action" as const };
  try {
    const response = await (options.fetch ?? globalThis.fetch)(requestUrl(options.baseUrl ?? "/api", capabilityPath(action, true)), {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify({ input: invocation.input }),
      signal: invocation.signal,
    });
    return readCapabilityResponse(response, CapabilityActionReviewSchema);
  } catch (cause) {
    return unavailable(cause);
  }
};

import { z } from "zod";
import { dispatchCapability } from "../api/capabilities";
import { CapabilityActionReviewSchema, type CapabilityResult, capabilityResultSchema } from "../contracts/capabilities";
import { readCapabilityResponse } from "./response";
import type { CapabilityClientResult, CapabilityInvocation, CapabilityReviewClientResult } from "./types";

export type { CapabilityClientResult, CapabilityInvocation, CapabilityReviewClientResult } from "./types";

export type CapabilityCaller = {
  authorization?: string | null;
  cookie?: string | null;
  requestId?: string | null;
  traceparent?: string | null;
  tracestate?: string | null;
  signal?: AbortSignal;
};

const callerRequest = (caller: CapabilityCaller, idempotencyKey?: string): Request => {
  const headers = new Headers();
  if (caller.authorization) headers.set("authorization", caller.authorization);
  if (caller.cookie) headers.set("cookie", caller.cookie);
  if (caller.requestId) headers.set("x-request-id", caller.requestId);
  if (caller.traceparent) headers.set("traceparent", caller.traceparent);
  if (caller.tracestate) headers.set("tracestate", caller.tracestate);
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  return new Request("http://cloud.internal/api/capabilities/v1", { headers, signal: caller.signal });
};

export const invokeCapability = async <TData, TInput = unknown>(
  invocation: CapabilityInvocation<TInput>,
  caller: CapabilityCaller,
): Promise<CapabilityClientResult<TData>> => {
  try {
    const response = await dispatchCapability({
      request: callerRequest(caller, invocation.idempotencyKey),
      kind: invocation.kind === "query" ? "queries" : "actions",
      appId: invocation.appId,
      capabilityId: invocation.capabilityId,
      input: invocation.input,
    });
    return readCapabilityResponse(response, capabilityResultSchema(z.unknown()) as z.ZodType<CapabilityResult<TData>>);
  } catch {
    return { ok: false, error: { code: "APP_UNAVAILABLE", message: "Cloud is unavailable", status: 503 } };
  }
};

export const reviewCapabilityAction = async <TInput = unknown>(
  invocation: Omit<CapabilityInvocation<TInput>, "kind" | "idempotencyKey">,
  caller: CapabilityCaller,
): Promise<CapabilityReviewClientResult> => {
  try {
    const response = await dispatchCapability({
      request: callerRequest(caller),
      kind: "actions",
      review: true,
      appId: invocation.appId,
      capabilityId: invocation.capabilityId,
      input: invocation.input,
    });
    return readCapabilityResponse(response, CapabilityActionReviewSchema);
  } catch {
    return { ok: false, error: { code: "APP_UNAVAILABLE", message: "Cloud is unavailable", status: 503 } };
  }
};

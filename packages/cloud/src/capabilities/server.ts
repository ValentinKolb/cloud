import { z } from "zod";
import { getCapability } from "../_internal/registry";
import { dispatchCapability, loadCapabilityCatalogPage } from "../api/capabilities";
import { CapabilityActionReviewSchema, capabilityResultSchema } from "../contracts/capabilities";
import { readCapabilityResponse } from "./response";
import type {
  CapabilityCatalogApp,
  CapabilityCatalogAppClientResult,
  CapabilityCatalogClientResult,
  CapabilityClientResult,
  CapabilityInvocation,
  CapabilityReviewClientResult,
} from "./types";

export type {
  CapabilityCatalogApp,
  CapabilityCatalogAppClientResult,
  CapabilityCatalogClientResult,
  CapabilityClientResult,
  CapabilityInvocation,
  CapabilityReviewClientResult,
} from "./types";

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

const invokeCapabilityWithResultSchema = async <TDataSchema extends z.ZodType, TInput = unknown>(
  invocation: CapabilityInvocation<TInput>,
  dataSchema: TDataSchema,
  caller: CapabilityCaller,
): Promise<CapabilityClientResult<z.output<TDataSchema>>> => {
  try {
    const response = await dispatchCapability({
      request: callerRequest(caller, invocation.idempotencyKey),
      kind: invocation.kind === "query" ? "queries" : "actions",
      appId: invocation.appId,
      capabilityId: invocation.capabilityId,
      input: invocation.input,
    });
    return readCapabilityResponse(response, capabilityResultSchema(dataSchema));
  } catch {
    return { ok: false, error: { code: "APP_UNAVAILABLE", message: "Cloud is unavailable", status: 503 } };
  }
};

export const invokeCapability = <TInput = unknown>(
  invocation: CapabilityInvocation<TInput>,
  caller: CapabilityCaller,
): Promise<CapabilityClientResult<unknown>> => invokeCapabilityWithResultSchema(invocation, z.unknown(), caller);

export const invokeCapabilityWithDataSchema = <TDataSchema extends z.ZodType, TInput = unknown>(
  invocation: CapabilityInvocation<TInput>,
  dataSchema: TDataSchema,
  caller: CapabilityCaller,
): Promise<CapabilityClientResult<z.output<TDataSchema>>> => invokeCapabilityWithResultSchema(invocation, dataSchema, caller);

export const listCapabilityCatalog = async (options: { cursor?: string; limit?: number } = {}): Promise<CapabilityCatalogClientResult> => {
  try {
    return {
      ok: true,
      data: await loadCapabilityCatalogPage({ cursor: options.cursor, limit: options.limit ?? 25 }),
    };
  } catch {
    return { ok: false, error: { code: "APP_UNAVAILABLE", message: "Cloud is unavailable", status: 503 } };
  }
};

export const getCapabilityCatalogApp = async (appId: string): Promise<CapabilityCatalogAppClientResult> => {
  try {
    const capability = await getCapability(appId);
    return {
      ok: true,
      data: capability
        ? {
            appId: capability.appId,
            appName: capability.appName,
            appIcon: capability.appIcon,
            appDescription: capability.appDescription,
            manifest: capability.manifest,
          }
        : null,
    };
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

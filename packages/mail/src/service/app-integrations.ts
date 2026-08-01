import { getCapability, listApps } from "@valentinkolb/cloud";
import {
  ContactResolveDataSchema,
  ContactResolveInputSchema,
} from "@valentinkolb/cloud-app-contacts/capability-contracts";
import { type CapabilityResult, capabilityResultSchema } from "@valentinkolb/cloud/contracts";
import {
  type CalendarInvitationImportInput,
  CalendarInvitationImportInputSchema,
  type CalendarInvitationImportResult,
  CalendarInvitationImportResultSchema,
  type CalendarInvitationPreview,
  type CalendarInvitationPreviewInput,
  CalendarInvitationPreviewInputSchema,
  CalendarInvitationPreviewSchema,
  type CalendarInvitationResponse,
  type CalendarInvitationResponseCommitInput,
  CalendarInvitationResponseCommitInputSchema,
  type CalendarInvitationResponseInput,
  CalendarInvitationResponseInputSchema,
  CalendarInvitationResponseSchema,
  type CalendarInvitationResponseState,
  CalendarInvitationResponseStateSchema,
  SPACES_MAIL_DEFAULT_PATH,
  SPACES_MAIL_DESTINATIONS_PATH,
  SPACES_MAIL_IMPORT_PATH,
  SPACES_MAIL_PREVIEW_PATH,
  SPACES_MAIL_RESPONSE_COMMIT_PATH,
  SPACES_MAIL_RESPONSE_PATH,
  type SpacesMailDefaultInput,
  SpacesMailDefaultInputSchema,
  type SpacesMailDestinationContext,
  SpacesMailDestinationContextSchema,
} from "@valentinkolb/cloud-app-spaces/integration";
import { z } from "zod";

const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 3_000;

export type AppIntegrationRequest = {
  cookie?: string | null;
  authorization?: string | null;
  requestId?: string | null;
  signal?: AbortSignal;
};

type AppIntegrationResult<T> = { ok: true; data: T } | { ok: false; code: "unavailable" | "rejected"; message: string; status: number };
type BoundedJsonResponse = { ok: true; body: unknown; status: number } | { ok: false; result: AppIntegrationResult<never> };

const integrationErrorSchema = z.object({ message: z.string().min(1).max(2_000) }).passthrough();

const unavailable = (message = "The connected app is temporarily unavailable"): AppIntegrationResult<never> => ({
  ok: false,
  code: "unavailable",
  message,
  status: 503,
});

const fetchBoundedJson = async (params: {
  url: string | URL;
  request: AppIntegrationRequest;
  headers: Record<string, string>;
  body?: unknown;
  method?: "GET" | "POST" | "PUT";
}): Promise<BoundedJsonResponse> => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = params.request.signal ? AbortSignal.any([params.request.signal, timeout]) : timeout;
  const response = await fetch(params.url, {
    method: params.method ?? "POST",
    signal,
    headers: params.headers,
    ...(params.body === undefined ? {} : { body: JSON.stringify(params.body) }),
  });
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    return { ok: false, result: unavailable("The connected app returned too much data") };
  }
  return { ok: true, body: text ? JSON.parse(text) : null, status: response.status };
};

const appRequestHeaders = (
  request: AppIntegrationRequest,
  extra: Record<string, string | undefined> = {},
): Record<string, string> => {
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  if (request.cookie) headers.Cookie = request.cookie;
  if (request.authorization) headers.Authorization = request.authorization;
  if (request.requestId) headers["X-Request-Id"] = request.requestId;
  for (const [name, value] of Object.entries(extra)) {
    if (value) headers[name] = value;
  }
  return headers;
};

const parseBoundedResponse = <T>(response: BoundedJsonResponse, schema: z.ZodType<T>): AppIntegrationResult<T> => {
  if (!response.ok) return response.result;
  if (response.status < 200 || response.status >= 300) {
    const parsed = integrationErrorSchema.safeParse(response.body);
    return {
      ok: false,
      code: "rejected",
      message: parsed.success ? parsed.data.message : "The connected app rejected the request",
      status: response.status,
    };
  }
  const parsed = schema.safeParse(response.body);
  return parsed.success ? { ok: true, data: parsed.data } : unavailable("The connected app returned an invalid response");
};

const fetchAppIntegration = async <T>(params: {
  appId: string;
  path: string;
  request: AppIntegrationRequest;
  responseSchema: z.ZodType<T>;
  body?: unknown;
  method?: "GET" | "POST" | "PUT";
}): Promise<AppIntegrationResult<T>> => {
  try {
    const app = (await listApps()).find((entry) => entry.id === params.appId);
    if (!app) return unavailable();
    const url = new URL(`${app.baseUrl.replace(/\/$/, "")}${params.path}`);
    const response = await fetchBoundedJson({
      url,
      request: params.request,
      method: params.method ?? "POST",
      headers: appRequestHeaders(params.request),
      body: params.body,
    });
    return parseBoundedResponse(response, params.responseSchema);
  } catch {
    return unavailable();
  }
};

const fetchAppCapability = async <T>(params: {
  appId: string;
  kind: "queries" | "actions";
  capabilityId: string;
  request: AppIntegrationRequest;
  dataSchema: z.ZodType<T>;
  input: unknown;
  idempotencyKey?: string;
}): Promise<AppIntegrationResult<CapabilityResult<T>>> => {
  try {
    const app = await getCapability(params.appId);
    if (!app) return unavailable();
    const operations = params.kind === "queries" ? app.manifest.queries : app.manifest.actions;
    const operation = operations.find((candidate) => candidate.localId === params.capabilityId);
    if (!operation) return unavailable("The connected app does not provide the required capability");
    const response = await fetchBoundedJson({
      url: `${app.endpoint}/${params.kind}/${encodeURIComponent(params.capabilityId)}`,
      request: params.request,
      headers: appRequestHeaders(params.request, {
        "x-cloud-capability-schema-hash": operation.schemaHash,
        "Idempotency-Key": params.idempotencyKey,
      }),
      body: { input: params.input },
    });
    return parseBoundedResponse(response, capabilityResultSchema(params.dataSchema));
  } catch {
    return unavailable();
  }
};

export const resolveContacts = async (input: z.input<typeof ContactResolveInputSchema>, request: AppIntegrationRequest) => {
  const parsed = ContactResolveInputSchema.parse(input);
  const result = await fetchAppCapability({
    appId: "contacts",
    kind: "queries",
    capabilityId: "contact.resolve",
    request,
    dataSchema: ContactResolveDataSchema,
    input: parsed,
  });
  if (!result.ok) return result;
  return {
    ok: true as const,
    data: {
      ...result.data.data,
      nextCursor: result.data.page?.nextCursor ?? null,
    },
  };
};

export const listCalendarDestinations = (mailboxId: string, request: AppIntegrationRequest) =>
  fetchAppIntegration<SpacesMailDestinationContext>({
    appId: "spaces",
    path: `${SPACES_MAIL_DESTINATIONS_PATH}?mailboxId=${encodeURIComponent(mailboxId)}`,
    method: "GET",
    request,
    responseSchema: SpacesMailDestinationContextSchema,
  });

export const setCalendarDefault = (input: SpacesMailDefaultInput, request: AppIntegrationRequest) =>
  fetchAppIntegration<SpacesMailDestinationContext>({
    appId: "spaces",
    path: SPACES_MAIL_DEFAULT_PATH,
    method: "PUT",
    request,
    responseSchema: SpacesMailDestinationContextSchema,
    body: SpacesMailDefaultInputSchema.parse(input),
  });

export const previewCalendarInvitation = (input: CalendarInvitationPreviewInput, request: AppIntegrationRequest) =>
  fetchAppIntegration<CalendarInvitationPreview>({
    appId: "spaces",
    path: SPACES_MAIL_PREVIEW_PATH,
    request,
    responseSchema: CalendarInvitationPreviewSchema,
    body: CalendarInvitationPreviewInputSchema.parse(input),
  });

export const importCalendarInvitation = (input: CalendarInvitationImportInput, request: AppIntegrationRequest) =>
  fetchAppIntegration<CalendarInvitationImportResult>({
    appId: "spaces",
    path: SPACES_MAIL_IMPORT_PATH,
    request,
    responseSchema: CalendarInvitationImportResultSchema,
    body: CalendarInvitationImportInputSchema.parse(input),
  });

export const buildCalendarInvitationResponse = (input: CalendarInvitationResponseInput, request: AppIntegrationRequest) =>
  fetchAppIntegration<CalendarInvitationResponse>({
    appId: "spaces",
    path: SPACES_MAIL_RESPONSE_PATH,
    request,
    responseSchema: CalendarInvitationResponseSchema,
    body: CalendarInvitationResponseInputSchema.parse(input),
  });

export const commitCalendarInvitationResponse = (input: CalendarInvitationResponseCommitInput, request: AppIntegrationRequest) =>
  fetchAppIntegration<CalendarInvitationResponseState>({
    appId: "spaces",
    path: SPACES_MAIL_RESPONSE_COMMIT_PATH,
    request,
    responseSchema: CalendarInvitationResponseStateSchema,
    body: CalendarInvitationResponseCommitInputSchema.parse(input),
  });

import { getCapability } from "@valentinkolb/cloud";
import { type CapabilityResult, capabilityResultSchema } from "@valentinkolb/cloud/contracts";
import { ContactResolveDataSchema, ContactResolveInputSchema } from "@valentinkolb/cloud-app-contacts/capability-contracts";
import {
  CalendarDestinationListDataSchema,
  CalendarDestinationListInputSchema,
  CalendarInvitationImportCapabilityDataSchema,
  CalendarInvitationImportCapabilityInputSchema,
  CalendarInvitationPreviewCapabilityDataSchema,
  CalendarInvitationPreviewCapabilityInputSchema,
  CalendarInvitationResponseCommitCapabilityDataSchema,
  CalendarInvitationResponseCommitCapabilityInputSchema,
  CalendarInvitationResponsePrepareDataSchema,
  CalendarInvitationResponsePrepareInputSchema,
  EventCreateInputSchema,
  EventDataSchema,
  EventInvitationCommitDataSchema,
  EventInvitationCommitInputSchema,
  EventInvitationPrepareDataSchema,
  EventInvitationPrepareInputSchema,
  EventListDataSchema,
  EventListInputSchema,
  SpaceDetailDataSchema,
  SpaceGetInputSchema,
} from "@valentinkolb/cloud-app-spaces/capability-contracts";
import type {
  CalendarInvitationImportInput,
  CalendarInvitationPreviewInput,
  CalendarInvitationResponseCommitInput,
  CalendarInvitationResponseInput,
} from "@valentinkolb/cloud-app-spaces/integration";
import { z } from "zod";

const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 3_000;
const REQUIRED_SPACES_INVITATION_QUERIES = [
  "calendar-destination.list",
  "calendar-invitation.preview",
  "calendar-invitation.response.prepare",
] as const;
const REQUIRED_SPACES_INVITATION_ACTIONS = ["calendar-invitation.import", "calendar-invitation.response.commit"] as const;
const REQUIRED_SPACES_SETTINGS_QUERIES = ["calendar-destination.list"] as const;
const REQUIRED_SPACES_COMPOSER_QUERIES = ["calendar-destination.list", "space.get", "event.list"] as const;
const REQUIRED_SPACES_COMPOSER_ACTIONS = ["event.create", "event.invitation.prepare", "event.invitation.commit"] as const;

export type AppIntegrationRequest = {
  cookie?: string | null;
  authorization?: string | null;
  requestId?: string | null;
  signal?: AbortSignal;
};

type AppIntegrationResult<T> = { ok: true; data: T } | { ok: false; code: "unavailable" | "rejected"; message: string; status: number };
type BoundedJsonResponse = { ok: true; body: unknown; status: number } | { ok: false; result: AppIntegrationResult<never> };

const readBoundedText = async (response: Response): Promise<string | null> => {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) return null;
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  ).toString("utf8");
};

export const getSpacesMailIntegrationAvailability = async (): Promise<{ invitations: boolean; settings: boolean; composer: boolean }> => {
  try {
    const app = await getCapability("spaces");
    if (!app) return { invitations: false, settings: false, composer: false };
    const queries = new Set(app.manifest.queries.map((operation) => operation.localId));
    const actions = new Set(app.manifest.actions.map((operation) => operation.localId));
    const invitations =
      REQUIRED_SPACES_INVITATION_QUERIES.every((id) => queries.has(id)) &&
      REQUIRED_SPACES_INVITATION_ACTIONS.every((id) => actions.has(id));
    return {
      invitations,
      settings: REQUIRED_SPACES_SETTINGS_QUERIES.every((id) => queries.has(id)),
      composer:
        REQUIRED_SPACES_COMPOSER_QUERIES.every((id) => queries.has(id)) &&
        REQUIRED_SPACES_COMPOSER_ACTIONS.every((id) => actions.has(id)),
    };
  } catch {
    return { invitations: false, settings: false, composer: false };
  }
};

const integrationErrorSchema = z
  .object({
    message: z.string().min(1).max(2_000).optional(),
    error: z
      .object({ message: z.string().min(1).max(2_000) })
      .passthrough()
      .optional(),
  })
  .passthrough();

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
  const text = await readBoundedText(response);
  if (text === null) {
    return { ok: false, result: unavailable("The connected app returned too much data") };
  }
  return { ok: true, body: text ? JSON.parse(text) : null, status: response.status };
};

const appRequestHeaders = (request: AppIntegrationRequest, extra: Record<string, string | undefined> = {}): Record<string, string> => {
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
      message: parsed.success
        ? (parsed.data.error?.message ?? parsed.data.message ?? "The connected app rejected the request")
        : "The connected app rejected the request",
      status: response.status,
    };
  }
  const parsed = schema.safeParse(response.body);
  return parsed.success ? { ok: true, data: parsed.data } : unavailable("The connected app returned an invalid response");
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

export const listCalendarDestinations = (request: AppIntegrationRequest) =>
  fetchAppCapability({
    appId: "spaces",
    kind: "queries",
    capabilityId: "calendar-destination.list",
    request,
    dataSchema: CalendarDestinationListDataSchema,
    input: CalendarDestinationListInputSchema.parse({}),
  }).then((result) => (result.ok ? { ok: true as const, data: result.data.data } : result));

export const getCalendarSpace = (spaceId: string, request: AppIntegrationRequest) =>
  fetchAppCapability({
    appId: "spaces",
    kind: "queries",
    capabilityId: "space.get",
    request,
    dataSchema: SpaceDetailDataSchema,
    input: SpaceGetInputSchema.parse({ spaceId }),
  }).then((result) => (result.ok ? { ok: true as const, data: result.data.data } : result));

export const listCalendarEvents = (spaceId: string, request: AppIntegrationRequest, query?: string) =>
  fetchAppCapability({
    appId: "spaces",
    kind: "queries",
    capabilityId: "event.list",
    request,
    dataSchema: EventListDataSchema,
    input: EventListInputSchema.parse({
      spaceId,
      query: query?.trim() || undefined,
      status: "active",
      assignedTo: "all",
      sort: "updated",
      sortDesc: true,
      limit: 100,
    }),
  }).then((result) => (result.ok ? { ok: true as const, data: result.data.data } : result));

export const createCalendarEvent = (input: z.input<typeof EventCreateInputSchema>, request: AppIntegrationRequest) =>
  fetchAppCapability({
    appId: "spaces",
    kind: "actions",
    capabilityId: "event.create",
    request,
    dataSchema: EventDataSchema,
    input: EventCreateInputSchema.parse(input),
  }).then((result) => (result.ok ? { ok: true as const, data: result.data.data } : result));

export const prepareEventInvitation = (
  input: z.input<typeof EventInvitationPrepareInputSchema>,
  request: AppIntegrationRequest,
  idempotencyKey: string,
) =>
  fetchAppCapability({
    appId: "spaces",
    kind: "actions",
    capabilityId: "event.invitation.prepare",
    request,
    dataSchema: EventInvitationPrepareDataSchema,
    input: EventInvitationPrepareInputSchema.parse(input),
    idempotencyKey,
  }).then((result) => (result.ok ? { ok: true as const, data: result.data.data } : result));

export const commitEventInvitation = (
  input: z.input<typeof EventInvitationCommitInputSchema>,
  request: AppIntegrationRequest,
) =>
  fetchAppCapability({
    appId: "spaces",
    kind: "actions",
    capabilityId: "event.invitation.commit",
    request,
    dataSchema: EventInvitationCommitDataSchema,
    input: EventInvitationCommitInputSchema.parse(input),
  }).then((result) => (result.ok ? { ok: true as const, data: result.data.data } : result));

export const previewCalendarInvitation = (input: CalendarInvitationPreviewInput, request: AppIntegrationRequest) =>
  fetchAppCapability({
    appId: "spaces",
    kind: "queries",
    capabilityId: "calendar-invitation.preview",
    request,
    dataSchema: CalendarInvitationPreviewCapabilityDataSchema,
    input: CalendarInvitationPreviewCapabilityInputSchema.parse(input),
  }).then((result) => (result.ok ? { ok: true as const, data: result.data.data } : result));

export const importCalendarInvitation = (input: CalendarInvitationImportInput, request: AppIntegrationRequest) =>
  fetchAppCapability({
    appId: "spaces",
    kind: "actions",
    capabilityId: "calendar-invitation.import",
    request,
    dataSchema: CalendarInvitationImportCapabilityDataSchema,
    input: CalendarInvitationImportCapabilityInputSchema.parse(input),
  }).then((result) => (result.ok ? { ok: true as const, data: result.data.data } : result));

export const buildCalendarInvitationResponse = (input: CalendarInvitationResponseInput, request: AppIntegrationRequest) =>
  fetchAppCapability({
    appId: "spaces",
    kind: "queries",
    capabilityId: "calendar-invitation.response.prepare",
    request,
    dataSchema: CalendarInvitationResponsePrepareDataSchema,
    input: CalendarInvitationResponsePrepareInputSchema.parse(input),
  }).then((result) => (result.ok ? { ok: true as const, data: result.data.data } : result));

export const commitCalendarInvitationResponse = (input: CalendarInvitationResponseCommitInput, request: AppIntegrationRequest) =>
  fetchAppCapability({
    appId: "spaces",
    kind: "actions",
    capabilityId: "calendar-invitation.response.commit",
    request,
    dataSchema: CalendarInvitationResponseCommitCapabilityDataSchema,
    input: CalendarInvitationResponseCommitCapabilityInputSchema.parse(input),
  }).then((result) => (result.ok ? { ok: true as const, data: result.data.data } : result));

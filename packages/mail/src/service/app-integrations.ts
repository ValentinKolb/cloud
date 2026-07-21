import { listApps } from "@valentinkolb/cloud";
import {
  CONTACTS_MAIL_RESOLVE_PATH,
  type ResolveMailParticipantsInput,
  ResolveMailParticipantsInputSchema,
  type ResolveMailParticipantsResponse,
  ResolveMailParticipantsResponseSchema,
} from "@valentinkolb/cloud-app-contacts/integration";
import {
  type MailSpaceCandidatesQuery,
  MailSpaceCandidatesQuerySchema,
  type MailSpaceCandidatesResponse,
  MailSpaceCandidatesResponseSchema,
  ResolveMailSpacesInputSchema,
  type ResolveMailSpacesResponse,
  ResolveMailSpacesResponseSchema,
  SPACES_MAIL_CANDIDATES_PATH,
  SPACES_MAIL_RESOLVE_PATH,
} from "@valentinkolb/cloud-app-spaces/integration";
import type { z } from "zod";

const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 3_000;

export type AppIntegrationRequest = {
  cookie?: string | null;
  authorization?: string | null;
  requestId?: string | null;
  signal?: AbortSignal;
};

export type AppIntegrationResult<T> = { ok: true; data: T } | { ok: false; code: "unavailable" };

const fetchIntegration = async <T>(params: {
  appId: "contacts" | "spaces";
  path: string;
  method: "GET" | "POST";
  request: AppIntegrationRequest;
  responseSchema: z.ZodType<T>;
  body?: unknown;
  query?: URLSearchParams;
}): Promise<AppIntegrationResult<T>> => {
  try {
    const app = (await listApps()).find((entry) => entry.id === params.appId);
    if (!app) return { ok: false, code: "unavailable" };
    const url = new URL(`${app.baseUrl.replace(/\/$/, "")}${params.path}`);
    if (params.query) url.search = params.query.toString();
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = params.request.signal ? AbortSignal.any([params.request.signal, timeout]) : timeout;
    const response = await fetch(url, {
      method: params.method,
      signal,
      headers: {
        Accept: "application/json",
        ...(params.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(params.request.cookie ? { Cookie: params.request.cookie } : {}),
        ...(params.request.authorization ? { Authorization: params.request.authorization } : {}),
        ...(params.request.requestId ? { "X-Request-Id": params.request.requestId } : {}),
      },
      ...(params.body === undefined ? {} : { body: JSON.stringify(params.body) }),
    });
    if (!response.ok) return { ok: false, code: "unavailable" };
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) return { ok: false, code: "unavailable" };
    const parsed = params.responseSchema.safeParse(JSON.parse(text));
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, code: "unavailable" };
  } catch {
    return { ok: false, code: "unavailable" };
  }
};

export const resolveContacts = (input: ResolveMailParticipantsInput, request: AppIntegrationRequest) => {
  const parsed = ResolveMailParticipantsInputSchema.parse(input);
  return fetchIntegration<ResolveMailParticipantsResponse>({
    appId: "contacts",
    path: CONTACTS_MAIL_RESOLVE_PATH,
    method: "POST",
    request,
    responseSchema: ResolveMailParticipantsResponseSchema,
    body: parsed,
  });
};

export const resolveSpaces = (spaceIds: string[], request: AppIntegrationRequest) => {
  const input = ResolveMailSpacesInputSchema.parse({ spaceIds });
  return fetchIntegration<ResolveMailSpacesResponse>({
    appId: "spaces",
    path: SPACES_MAIL_RESOLVE_PATH,
    method: "POST",
    request,
    responseSchema: ResolveMailSpacesResponseSchema,
    body: input,
  });
};

export const listSpaceCandidates = (query: MailSpaceCandidatesQuery, request: AppIntegrationRequest) => {
  const parsed = MailSpaceCandidatesQuerySchema.parse(query);
  const search = new URLSearchParams();
  if (parsed.q) search.set("q", parsed.q);
  if (parsed.cursor) search.set("cursor", parsed.cursor);
  search.set("limit", String(parsed.limit));
  return fetchIntegration<MailSpaceCandidatesResponse>({
    appId: "spaces",
    path: SPACES_MAIL_CANDIDATES_PATH,
    method: "GET",
    request,
    responseSchema: MailSpaceCandidatesResponseSchema,
    query: search,
  });
};

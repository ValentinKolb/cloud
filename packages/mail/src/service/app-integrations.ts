import { listApps } from "@valentinkolb/cloud";
import {
  CONTACTS_MAIL_RESOLVE_PATH,
  type ResolveMailParticipantsInput,
  ResolveMailParticipantsInputSchema,
  type ResolveMailParticipantsResponse,
  ResolveMailParticipantsResponseSchema,
} from "@valentinkolb/cloud-app-contacts/integration";
import type { z } from "zod";

const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 3_000;

export type AppIntegrationRequest = {
  cookie?: string | null;
  authorization?: string | null;
  requestId?: string | null;
  signal?: AbortSignal;
};

type AppIntegrationResult<T> = { ok: true; data: T } | { ok: false; code: "unavailable" };

const fetchContactsIntegration = async <T>(params: {
  request: AppIntegrationRequest;
  responseSchema: z.ZodType<T>;
  body: unknown;
}): Promise<AppIntegrationResult<T>> => {
  try {
    const app = (await listApps()).find((entry) => entry.id === "contacts");
    if (!app) return { ok: false, code: "unavailable" };
    const url = new URL(`${app.baseUrl.replace(/\/$/, "")}${CONTACTS_MAIL_RESOLVE_PATH}`);
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = params.request.signal ? AbortSignal.any([params.request.signal, timeout]) : timeout;
    const response = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(params.request.cookie ? { Cookie: params.request.cookie } : {}),
        ...(params.request.authorization ? { Authorization: params.request.authorization } : {}),
        ...(params.request.requestId ? { "X-Request-Id": params.request.requestId } : {}),
      },
      body: JSON.stringify(params.body),
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
  return fetchContactsIntegration<ResolveMailParticipantsResponse>({
    request,
    responseSchema: ResolveMailParticipantsResponseSchema,
    body: parsed,
  });
};

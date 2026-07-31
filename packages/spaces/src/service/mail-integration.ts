import { listApps } from "@valentinkolb/cloud";
import type { z } from "zod";
import {
  MAIL_SPACES_DRAFT_PATH,
  MAIL_SPACES_EVENT_SOURCE_PATH,
  MAIL_SPACES_MAILBOXES_PATH,
  type MailEventInvitationDraft,
  type MailEventInvitationDraftInput,
  MailEventInvitationDraftInputSchema,
  MailEventInvitationDraftSchema,
  type MailEventSource,
  type MailEventSourceInput,
  MailEventSourceInputSchema,
  MailEventSourceSchema,
  type MailInvitationMailbox,
  MailInvitationMailboxesSchema,
} from "../integration";

const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 3_000;

export type MailIntegrationRequest = {
  cookie?: string | null;
  authorization?: string | null;
  requestId?: string | null;
  signal?: AbortSignal;
};

type IntegrationResult<T> = { ok: true; data: T } | { ok: false; message: string; status: number };

const callMail = async <T>(params: {
  path: string;
  request: MailIntegrationRequest;
  schema: z.ZodType<T>;
  method?: "GET" | "POST";
  body?: unknown;
}): Promise<IntegrationResult<T>> => {
  try {
    const app = (await listApps()).find((entry) => entry.id === "mail");
    if (!app) return { ok: false, message: "Mail is unavailable", status: 503 };
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = params.request.signal ? AbortSignal.any([params.request.signal, timeout]) : timeout;
    const response = await fetch(new URL(`${app.baseUrl.replace(/\/$/u, "")}${params.path}`), {
      method: params.method ?? "GET",
      signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(params.request.cookie ? { Cookie: params.request.cookie } : {}),
        ...(params.request.authorization ? { Authorization: params.request.authorization } : {}),
        ...(params.request.requestId ? { "X-Request-Id": params.request.requestId } : {}),
      },
      ...(params.body === undefined ? {} : { body: JSON.stringify(params.body) }),
    });
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) return { ok: false, message: "Mail returned too much data", status: 502 };
    if (!response.ok) {
      const parsed = text ? (JSON.parse(text) as { error?: { message?: string }; message?: string }) : null;
      return { ok: false, message: parsed?.error?.message ?? parsed?.message ?? "Mail rejected the invitation", status: response.status };
    }
    const parsed = params.schema.safeParse(JSON.parse(text));
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, message: "Mail returned an invalid response", status: 502 };
  } catch {
    return { ok: false, message: "Mail is temporarily unavailable", status: 503 };
  }
};

export const listInvitationMailboxes = (request: MailIntegrationRequest) =>
  callMail<MailInvitationMailbox[]>({
    path: MAIL_SPACES_MAILBOXES_PATH,
    request,
    schema: MailInvitationMailboxesSchema,
  });

export const createInvitationDraft = (input: MailEventInvitationDraftInput, request: MailIntegrationRequest) =>
  callMail<MailEventInvitationDraft>({
    path: MAIL_SPACES_DRAFT_PATH,
    request,
    schema: MailEventInvitationDraftSchema,
    method: "POST",
    body: MailEventInvitationDraftInputSchema.parse(input),
  });

export const getEventSource = (input: MailEventSourceInput, request: MailIntegrationRequest) =>
  callMail<MailEventSource>({
    path: MAIL_SPACES_EVENT_SOURCE_PATH,
    request,
    schema: MailEventSourceSchema,
    method: "POST",
    body: MailEventSourceInputSchema.parse(input),
  });

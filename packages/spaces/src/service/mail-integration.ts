import { getCapability } from "@valentinkolb/cloud";
import { type CapabilityResult, capabilityResultSchema } from "@valentinkolb/cloud/contracts";
import {
  DraftCreateInputSchema,
  DraftDataSchema,
  MailboxListDataSchema,
  MailboxListInputSchema,
  SenderIdentityListDataSchema,
  SenderIdentityListInputSchema,
} from "@valentinkolb/cloud-app-mail/capability-contracts";
import type { z } from "zod";
import {
  type MailEventInvitationDraft,
  type MailEventInvitationDraftInput,
  MailEventInvitationDraftInputSchema,
  type MailInvitationMailbox,
} from "../integration";

const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 3_000;

const REQUIRED_MAIL_QUERIES = ["mailbox.list", "mailbox.identity.list"] as const;
const REQUIRED_MAIL_ACTIONS = ["draft.create"] as const;

export type MailIntegrationRequest = {
  cookie?: string | null;
  authorization?: string | null;
  requestId?: string | null;
  signal?: AbortSignal;
};

type IntegrationResult<T> = { ok: true; data: T } | { ok: false; message: string; status: number };

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

export const isMailInvitationIntegrationAvailable = async (): Promise<boolean> => {
  try {
    const app = await getCapability("mail");
    if (!app) return false;
    const queries = new Set(app.manifest.queries.map((operation) => operation.localId));
    const actions = new Set(app.manifest.actions.map((operation) => operation.localId));
    return REQUIRED_MAIL_QUERIES.every((id) => queries.has(id)) && REQUIRED_MAIL_ACTIONS.every((id) => actions.has(id));
  } catch {
    return false;
  }
};

const capabilityHeaders = (request: MailIntegrationRequest, schemaHash: string, idempotencyKey?: string): Record<string, string> => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  "x-cloud-capability-schema-hash": schemaHash,
  ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  ...(request.cookie ? { Cookie: request.cookie } : {}),
  ...(request.authorization ? { Authorization: request.authorization } : {}),
  ...(request.requestId ? { "X-Request-Id": request.requestId } : {}),
});

const callMailCapability = async <T>(params: {
  kind: "queries" | "actions";
  capabilityId: string;
  request: MailIntegrationRequest;
  dataSchema: z.ZodType<T>;
  input: unknown;
  idempotencyKey?: string;
}): Promise<IntegrationResult<CapabilityResult<T>>> => {
  try {
    const app = await getCapability("mail");
    if (!app) return { ok: false, message: "Mail is unavailable", status: 503 };
    const operation = (params.kind === "queries" ? app.manifest.queries : app.manifest.actions).find(
      (candidate) => candidate.localId === params.capabilityId,
    );
    if (!operation) return { ok: false, message: "Mail does not provide the required capability", status: 503 };
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = params.request.signal ? AbortSignal.any([params.request.signal, timeout]) : timeout;
    const response = await fetch(`${app.endpoint}/${params.kind}/${encodeURIComponent(params.capabilityId)}`, {
      method: "POST",
      signal,
      headers: capabilityHeaders(params.request, operation.schemaHash, params.idempotencyKey),
      body: JSON.stringify({ input: params.input }),
    });
    const text = await readBoundedText(response);
    if (text === null) return { ok: false, message: "Mail returned too much data", status: 502 };
    if (!response.ok) {
      const parsed = text ? (JSON.parse(text) as { error?: { message?: string }; message?: string }) : null;
      return { ok: false, message: parsed?.error?.message ?? parsed?.message ?? "Mail rejected the request", status: response.status };
    }
    const parsed = capabilityResultSchema(params.dataSchema).safeParse(JSON.parse(text));
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, message: "Mail returned an invalid response", status: 502 };
  } catch {
    return { ok: false, message: "Mail is temporarily unavailable", status: 503 };
  }
};

const listIdentities = (mailboxId: string, request: MailIntegrationRequest) =>
  callMailCapability({
    kind: "queries",
    capabilityId: "mailbox.identity.list",
    request,
    dataSchema: SenderIdentityListDataSchema,
    input: SenderIdentityListInputSchema.parse({ mailboxId }),
  });

export const listInvitationMailboxes = async (request: MailIntegrationRequest): Promise<IntegrationResult<MailInvitationMailbox[]>> => {
  const mailboxes = await callMailCapability({
    kind: "queries",
    capabilityId: "mailbox.list",
    request,
    dataSchema: MailboxListDataSchema,
    input: MailboxListInputSchema.parse({ minimumPermission: "write", limit: 100 }),
  });
  if (!mailboxes.ok) return mailboxes;
  const resolved: MailInvitationMailbox[] = [];
  let firstIdentityFailure: IntegrationResult<never> | null = null;
  const identityLookupConcurrency = 8;
  for (let offset = 0; offset < mailboxes.data.data.length; offset += identityLookupConcurrency) {
    const group = await Promise.all(
      mailboxes.data.data.slice(offset, offset + identityLookupConcurrency).map(async (mailbox) => {
        const identities = await listIdentities(mailbox.id, request);
        if (!identities.ok) {
          firstIdentityFailure ??= identities;
          return null;
        }
        const verified = identities.data.data.filter((candidate) => candidate.status === "verified");
        return verified.length > 0
          ? {
              id: mailbox.id,
              name: mailbox.name,
              identities: verified.map((identity) => ({
                id: identity.id,
                label: identity.label,
                from: { name: identity.displayName || null, address: identity.fromAddress },
                isDefault: identity.isDefault,
              })),
            }
          : null;
      }),
    );
    resolved.push(...group.filter((item): item is MailInvitationMailbox => item !== null));
  }
  if (resolved.length === 0 && firstIdentityFailure) return firstIdentityFailure;
  return { ok: true, data: resolved };
};

export const createInvitationDraft = async (
  rawInput: MailEventInvitationDraftInput,
  request: MailIntegrationRequest,
): Promise<IntegrationResult<MailEventInvitationDraft>> => {
  const input = MailEventInvitationDraftInputSchema.parse(rawInput);
  const identities = await listIdentities(input.mailboxId, request);
  if (!identities.ok) return identities;
  const identity = identities.data.data.find((candidate) => candidate.id === input.senderIdentityId && candidate.status === "verified");
  if (!identity) return { ok: false, message: "The selected verified sender identity is unavailable", status: 403 };
  const created = await callMailCapability({
    kind: "actions",
    capabilityId: "draft.create",
    request,
    dataSchema: DraftDataSchema,
    idempotencyKey: input.idempotencyKey,
    input: DraftCreateInputSchema.parse({
      mailboxId: input.mailboxId,
      senderIdentityId: input.senderIdentityId,
      to: input.to,
      subject: input.subject,
      body: input.body,
      format: "plain",
      attachments: [
        {
          filename: "invitation.ics",
          contentType: `text/calendar; method=${input.calendar.includes("METHOD:CANCEL") ? "CANCEL" : "REQUEST"}; charset=utf-8`,
          base64: Buffer.from(input.calendar, "utf8").toString("base64"),
        },
      ],
    }),
  });
  return created.ok ? { ok: true, data: { mailboxId: input.mailboxId, draftId: created.data.data.id } } : created;
};

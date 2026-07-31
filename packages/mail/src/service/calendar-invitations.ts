import { Readable } from "node:stream";
import { err, fail, ok, type Result } from "@k2b/stdlib";
import type {
  CalendarAddress,
  CalendarParticipationStatus,
  MailEventInvitationDraft,
  MailEventInvitationDraftInput,
  MailEventSource,
  MailEventSourceInput,
  MailInvitationMailbox,
} from "@valentinkolb/cloud-app-spaces/integration";
import { sql } from "bun";
import type { MailDraft } from "../contracts";
import { requireMailboxPermission } from "./access";
import {
  type AppIntegrationRequest,
  buildCalendarInvitationResponse,
  commitCalendarInvitationResponse,
  importCalendarInvitation,
  listCalendarDestinations,
  previewCalendarInvitation,
  setCalendarDefault,
} from "./app-integrations";
import type { MailRequestContext } from "./auth";
import { enqueueDraftProjection } from "./draft-provider-projection";
import * as drafts from "./drafts";
import * as mailboxes from "./mailboxes";
import { storeReadableBlob } from "./message-blobs";
import * as messages from "./messages";
import * as senderIdentities from "./sender-identities";

const MAX_CALENDAR_BYTES = 1_000_000;
const MAX_EVENT_SOURCE_DESCRIPTION = 20_000;

type IntegrationFailure = { message: string; status: number };

const integrationFailure = (result: IntegrationFailure) => {
  if (result.status === 400) return fail(err.badInput(result.message));
  if (result.status === 403) return fail(err.forbidden(result.message));
  if (result.status === 404) return fail(err.notFound(result.message));
  if (result.status === 409) return fail(err.conflict(result.message));
  return fail(err.internal(result.message));
};

const verifiedIdentity = async (context: MailRequestContext, mailboxId: string) => {
  const identities = await senderIdentities.listSenderIdentities(context, mailboxId);
  if (!identities.ok) return identities;
  const identity =
    identities.data.find((candidate) => candidate.isDefault && candidate.status === "verified") ??
    identities.data.find((candidate) => candidate.status === "verified");
  return identity ? ok(identity) : fail(err.badInput("Verify a sending identity before creating a calendar message"));
};

const attachCalendar = async (params: {
  draftId: string;
  filename: string;
  method: "REQUEST" | "REPLY" | "CANCEL";
  calendar: string;
}): Promise<Result<void>> => {
  const bytes = Buffer.from(params.calendar, "utf8");
  const blob = await storeReadableBlob(Readable.from(bytes), bytes.byteLength);
  let inserted = false;
  try {
    inserted = await sql.begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        INSERT INTO mail.draft_attachments (draft_id, blob_id, filename, content_type, byte_length, content_hash, position)
        VALUES (
          ${params.draftId}::uuid, ${blob.id}::uuid, ${params.filename},
          ${`text/calendar; method=${params.method}; charset=utf-8`}, ${bytes.byteLength}, ${blob.contentHash}, 0
        )
        ON CONFLICT (draft_id, position) DO NOTHING
        RETURNING id
      `;
      if (rows.length > 0) {
        await tx`UPDATE mail.drafts SET revision = revision + 1 WHERE id = ${params.draftId}::uuid`;
        return true;
      }
      return false;
    });
  } catch {
    await sql`DELETE FROM mail.message_part_blobs WHERE id = ${blob.id}::uuid AND NOT EXISTS (
      SELECT 1 FROM mail.draft_attachments WHERE blob_id = ${blob.id}::uuid
    )`;
    return fail(err.internal("Failed to attach the calendar payload"));
  }
  if (!inserted) {
    await sql`DELETE FROM mail.message_part_blobs WHERE id = ${blob.id}::uuid AND NOT EXISTS (
      SELECT 1 FROM mail.draft_attachments WHERE blob_id = ${blob.id}::uuid
    )`;
  }
  await enqueueDraftProjection(params.draftId);
  return ok(undefined);
};

const createCalendarDraft = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  idempotencyKey: string;
  to: CalendarAddress[];
  subject: string;
  body: string;
  calendar: string;
  filename: string;
  method: "REQUEST" | "REPLY" | "CANCEL";
}): Promise<Result<MailDraft>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "write");
  if (!allowed.ok) return allowed;
  const identity = await verifiedIdentity(params.context, params.mailboxId);
  if (!identity.ok) return identity;
  const input = {
    senderIdentityId: identity.data.id,
    to: params.to,
    cc: [],
    bcc: [],
    subject: params.subject,
    body: params.body,
    format: "plain" as const,
    priority: "normal" as const,
    requestDeliveryReceipt: false,
    requestReadReceipt: false,
  };
  const created = await drafts.materializeDraftSeed({
    context: params.context,
    mailboxId: params.mailboxId,
    input: {
      idempotencyKey: params.idempotencyKey,
      origin: { kind: "compose", input: { ...input, intent: "new" } },
      draft: input,
    },
  });
  if (!created.ok) return created;
  if (!created.data.attachments.some((attachment) => attachment.contentType.startsWith("text/calendar"))) {
    const attached = await attachCalendar({ ...params, draftId: created.data.id });
    if (!attached.ok) return attached;
  }
  return drafts.getDraft(params.context, params.mailboxId, created.data.id);
};

export const listInvitationMailboxes = async (context: MailRequestContext): Promise<Result<MailInvitationMailbox[]>> => {
  const listed = await mailboxes.listMailboxes(context, 200);
  if (!listed.ok) return listed;
  const writable = listed.data.filter((mailbox) => mailbox.permission === "write" || mailbox.permission === "admin");
  const resolved = await Promise.all(
    writable.map(async (mailbox) => {
      const identity = await verifiedIdentity(context, mailbox.id);
      return identity.ok
        ? { id: mailbox.id, name: mailbox.name, from: { name: identity.data.displayName || null, address: identity.data.fromAddress } }
        : null;
    }),
  );
  return ok(resolved.filter((mailbox): mailbox is MailInvitationMailbox => mailbox !== null));
};

export const getEventSource = async (params: {
  context: MailRequestContext;
  input: MailEventSourceInput;
}): Promise<Result<MailEventSource>> => {
  const message = await messages.getMessage({
    context: params.context,
    mailboxId: params.input.mailboxId,
    messageId: params.input.messageId,
  });
  if (!message.ok) return message;
  const subject = message.data.subject.trim() || "Event from mail";
  return ok({
    ...params.input,
    title: subject.slice(0, 200),
    description: message.data.forwardText.slice(0, MAX_EVENT_SOURCE_DESCRIPTION),
    sender: message.data.from[0] ?? null,
    receivedAt: message.data.internalDate,
  });
};

export const createInvitationDraft = async (params: {
  context: MailRequestContext;
  input: MailEventInvitationDraftInput;
}): Promise<Result<MailEventInvitationDraft>> => {
  const created = await createCalendarDraft({
    context: params.context,
    mailboxId: params.input.mailboxId,
    idempotencyKey: params.input.idempotencyKey,
    to: params.input.to,
    subject: params.input.subject,
    body: params.input.body,
    calendar: params.input.calendar,
    filename: "invitation.ics",
    method: params.input.calendar.includes("METHOD:CANCEL") ? "CANCEL" : "REQUEST",
  });
  return created.ok ? ok({ mailboxId: params.input.mailboxId, draftId: created.data.id }) : created;
};

const loadCalendarAttachment = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  messageId: string;
}): Promise<Result<{ calendar: string; attachmentId: string }>> => {
  const message = await messages.getMessage({ context: params.context, mailboxId: params.mailboxId, messageId: params.messageId });
  if (!message.ok) return message;
  const attachment = message.data.attachments.find(
    (candidate) =>
      candidate.contentType.split(";", 1)[0]?.trim().toLowerCase() === "text/calendar" ||
      candidate.filename?.toLowerCase().endsWith(".ics"),
  );
  if (!attachment) return fail(err.notFound("Calendar invitation"));
  if (attachment.sizeBytes > MAX_CALENDAR_BYTES) return fail(err.badInput("Calendar attachment is too large"));
  const opened = await messages.openAttachment({ ...params, attachmentId: attachment.id });
  if (!opened.ok) return opened;
  const chunks = await sql<{ position: number; bytes: Uint8Array }[]>`
    SELECT position, bytes
    FROM mail.message_part_chunks
    WHERE blob_id = ${opened.data.blobId}::uuid
    ORDER BY position
  `;
  if (chunks.length !== opened.data.chunkCount || chunks.some((chunk, index) => chunk.position !== index)) {
    return fail(err.internal("Calendar attachment is incomplete"));
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.bytes)));
  if (bytes.byteLength !== opened.data.total) return fail(err.internal("Calendar attachment length is invalid"));
  return ok({ calendar: new TextDecoder("utf-8", { fatal: false }).decode(bytes), attachmentId: attachment.id });
};

export const listDestinations = async (params: { context: MailRequestContext; mailboxId: string; request: AppIntegrationRequest }) => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "write");
  if (!allowed.ok) return allowed;
  const result = await listCalendarDestinations(params.mailboxId, params.request);
  return result.ok ? ok(result.data) : integrationFailure(result);
};

export const setDefaultDestination = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  spaceId: string | null;
  request: AppIntegrationRequest;
}) => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "admin");
  if (!allowed.ok) return allowed;
  const result = await setCalendarDefault({ mailboxId: params.mailboxId, spaceId: params.spaceId }, params.request);
  return result.ok ? ok(result.data) : integrationFailure(result);
};

export const preview = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  messageId: string;
  request: AppIntegrationRequest;
}) => {
  const loaded = await loadCalendarAttachment(params);
  if (!loaded.ok) return loaded;
  const result = await previewCalendarInvitation(
    { mailboxId: params.mailboxId, messageId: params.messageId, calendar: loaded.data.calendar },
    params.request,
  );
  return result.ok ? ok(result.data) : integrationFailure(result);
};

export const importToSpace = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  messageId: string;
  spaceId?: string;
  request: AppIntegrationRequest;
}) => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "write");
  if (!allowed.ok) return allowed;
  const destinations = await listCalendarDestinations(params.mailboxId, params.request);
  if (!destinations.ok) return integrationFailure(destinations);
  const destination = params.spaceId ?? destinations.data.selectedSpaceId;
  if (!destination) return fail(err.badInput("Choose a destination Space first"));
  const loaded = await loadCalendarAttachment(params);
  if (!loaded.ok) return loaded;
  const result = await importCalendarInvitation(
    {
      mailboxId: params.mailboxId,
      messageId: params.messageId,
      spaceId: destination,
      calendar: loaded.data.calendar,
    },
    params.request,
  );
  return result.ok ? ok(result.data) : integrationFailure(result);
};

export const createResponseDraft = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  messageId: string;
  participationStatus: CalendarParticipationStatus;
  idempotencyKey: string;
  request: AppIntegrationRequest;
}): Promise<Result<MailDraft>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, "write");
  if (!allowed.ok) return allowed;
  const [loaded, identity] = await Promise.all([loadCalendarAttachment(params), verifiedIdentity(params.context, params.mailboxId)]);
  if (!loaded.ok) return loaded;
  if (!identity.ok) return identity;
  const response = await buildCalendarInvitationResponse(
    {
      mailboxId: params.mailboxId,
      messageId: params.messageId,
      calendar: loaded.data.calendar,
      participationStatus: params.participationStatus,
      attendee: { name: identity.data.displayName || null, address: identity.data.fromAddress },
    },
    params.request,
  );
  if (!response.ok) return integrationFailure(response);
  const draft = await createCalendarDraft({
    context: params.context,
    mailboxId: params.mailboxId,
    idempotencyKey: params.idempotencyKey,
    to: [response.data.to],
    subject: response.data.subject,
    body: response.data.body,
    calendar: response.data.calendar,
    filename: "invite-response.ics",
    method: "REPLY",
  });
  if (!draft.ok) return draft;
  const committed = await commitCalendarInvitationResponse(
    {
      mailboxId: params.mailboxId,
      messageId: params.messageId,
      participationStatus: params.participationStatus,
      draftId: draft.data.id,
    },
    params.request,
  );
  return committed.ok ? draft : integrationFailure(committed);
};

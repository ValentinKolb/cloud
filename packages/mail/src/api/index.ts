import { Readable } from "node:stream";
import { err, fail, ok, type Result } from "@k2b/stdlib";
import { ErrorResponseSchema, GrantAccessSchema, UpdateAccessSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, jsonResponse, rateLimit, requiresAuth, respond, v } from "@valentinkolb/cloud/server";
import { EventDataSchema, EventListDataSchema } from "@valentinkolb/cloud-app-spaces/capability-contracts";
import {
  CalendarInvitationImportResultSchema,
  CalendarInvitationPreviewSchema,
  CalendarParticipationStatusSchema,
  SpacesMailDestinationsSchema,
} from "@valentinkolb/cloud-app-spaces/integration";
import { type Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { attachmentPreviewKind, attachmentPreviewSignatureMatches, baseAttachmentContentType } from "../attachment-preview-policy";
import {
  archiveComposeTemplateInputSchema,
  automaticReplyManagementPermissionSchema,
  cancelConversationReminderSchema,
  cancelScheduledSendInputSchema,
  composePreviewInputSchema,
  composeSafetyConfigSchema,
  composeSafetyReviewInputSchema,
  composeSuggestionsInputSchema,
  configurableFolderRoleSchema,
  conversationPresenceHeartbeatSchema,
  conversationPresenceLeaveSchema,
  conversationTriageInputSchema,
  conversationViewSchema,
  createAttachmentLinkInputSchema,
  createComposeTemplateInputSchema,
  createConversationCommentSchema,
  createDraftAttachmentUploadSchema,
  createMailboxInputSchema,
  createSavedConversationViewSchema,
  createSenderIdentityInputSchema,
  defaultSenderSetupInputSchema,
  deleteConversationCommentSchema,
  deleteSavedConversationViewSchema,
  deleteSenderIdentityTransportInputSchema,
  deriveDraftFromMessageInputSchema,
  draftContentInputSchema,
  draftEditableContentInputSchema,
  draftLeaseTokenSchema,
  draftSchema,
  mailCommandInputSchema,
  mailConversationContextQuerySchema,
  mailConversationContextSchema,
  mailingListDispositionInputSchema,
  maintenanceCommandInputSchema,
  materializeDraftSeedInputSchema,
  mergeConversationsInputSchema,
  prepareDraftSeedInputSchema,
  providerConnectionInputSchema,
  reassignConversationMessageInputSchema,
  relatedMailPageSchema,
  relatedMailQuerySchema,
  renderComposeSnippetInputSchema,
  searchBackendSchema,
  searchRequestSchema,
  setComposeSignatureDefaultInputSchema,
  setConversationReminderSchema,
  splitConversationInputSchema,
  unsubscribeMailingListInputSchema,
  updateComposeTemplateInputSchema,
  updateConversationCollaborationSchema,
  updateConversationCommentSchema,
  updateMailboxComposeStyleInputSchema,
  updateSavedConversationViewSchema,
  updateSenderIdentityInputSchema,
  updateSenderIdentityTransportInputSchema,
} from "../contracts";
import {
  attachmentLinks,
  bindings,
  calendarInvitations,
  cancelSendCommand,
  collaboration,
  commands,
  composeSafety,
  composeTemplates,
  conversationContext,
  conversations,
  draftLeases,
  drafts,
  draftUploads,
  folders,
  health,
  listSubscriptions,
  type MailRequestContext,
  mailboxAccess,
  mailboxes,
  messageInspector,
  messages,
  notificationTargets,
  operations,
  presence,
  providerConnections,
  reminders,
  savedViews,
  scheduledSends,
  search,
  senderIdentities,
  senderIdentityTransports,
  settingsContext,
  storageObservability,
  triage,
} from "../service";
import { resolveByteRange } from "../service/byte-range";
import type { AttachmentDownload } from "../service/messages";
import { discoverMailConfigurations } from "../service/onboarding-discovery";
import { loadMailboxConversationDetail, loadMailboxPageData } from "../service/workspace";
import wsRoutes from "../ws";
import { providerOAuthApi } from "./provider-oauth";
import resourceRoutes from "./resources";
import workflowRoutes from "./workflows";

const uuidParamSchema = z.object({ mailboxId: z.string().uuid() });
const mailboxAndIdParamSchema = (name: string) => z.object({ mailboxId: z.string().uuid(), [name]: z.string().uuid() });
const mailboxAndTwoIdsParamSchema = (first: string, second: string) =>
  z.object({ mailboxId: z.string().uuid(), [first]: z.string().uuid(), [second]: z.string().uuid() });
const limitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const mailboxListQuerySchema = limitQuerySchema.extend({
  name: z.string().trim().min(1).max(160).optional(),
  q: z.string().trim().min(1).max(200).optional(),
});
const conversationDraftsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const cursorQuerySchema = z.object({
  cursor: z.string().max(2_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const subscriptionQuerySchema = cursorQuerySchema.extend({
  listKey: z.string().trim().toLowerCase().min(1).max(4096).optional(),
});
const platformOperationsQuerySchema = z.object({
  cursor: z.string().max(2_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).optional(),
});
const mailboxOperationsQuerySchema = z.object({
  attentionCursor: z.string().max(2_000).optional(),
  attentionLimit: z.coerce.number().int().min(1).max(200).default(100),
});
const conversationQuerySchema = cursorQuerySchema.extend({
  folderId: z.string().uuid().optional(),
  status: z.enum(["needs_action", "waiting", "done"]).optional(),
  view: conversationViewSchema.optional(),
});
const collaboratorQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const activityQuerySchema = cursorQuerySchema.extend({
  conversationId: z.string().uuid().optional(),
});
const workspaceRouteQuerySchema = z.object({
  href: z.string().trim().min(1).max(4_000),
  listMode: z.enum(["conversations", "messages"]).default("conversations"),
});
const attachmentQuerySchema = z.object({
  inline: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  length: z.coerce
    .number()
    .int()
    .min(1)
    .max(4 * 1024 * 1024)
    .optional(),
});
const messageSourceQuerySchema = z.object({
  offset: z.coerce.number().int().nonnegative().optional(),
  length: z.coerce
    .number()
    .int()
    .min(1)
    .max(4 * 1024 * 1024)
    .optional(),
});
const updateMailboxSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    syncEnabled: z.boolean().optional(),
    searchBackend: searchBackendSchema.optional(),
    automaticReplyManagementPermission: automaticReplyManagementPermissionSchema.optional(),
    composeSafety: composeSafetyConfigSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");
const calendarDestinationInputSchema = z.object({ spaceId: z.string().uuid().nullable() }).strict();
const calendarDestinationsResponseSchema = z.object({
  selectedSpaceId: z.string().uuid().nullable(),
  items: SpacesMailDestinationsSchema,
});
const calendarImportInputSchema = z.object({ spaceId: z.string().uuid().optional() }).strict();
const calendarEventsQuerySchema = z
  .object({ spaceId: z.uuid(), query: z.string().trim().max(500).optional() })
  .strict();
const createCalendarEventInputSchema = z
  .object({
    spaceId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    location: z.string().trim().max(500).optional(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: "End time must be after start time",
    path: ["endsAt"],
  });
const attachCalendarEventInputSchema = z
  .object({ itemId: z.uuid(), idempotencyKey: z.uuid() })
  .strict();
const calendarResponseInputSchema = z
  .object({
    participationStatus: CalendarParticipationStatusSchema,
    idempotencyKey: z.string().uuid(),
    spaceId: z.string().uuid().optional(),
  })
  .strict();
const attachBindingSchema = z.object({ connectionId: z.string().uuid() });
const verifyIdentitySchema = z.object({
  bindingId: z.string().uuid(),
  verificationRecipient: z.string().email().max(320),
  savesSentAutomatically: z.boolean(),
});
const updateDraftSchema = z.object({
  expectedRevision: z.number().int().positive(),
  draft: draftEditableContentInputSchema,
});
const roleParamSchema = z.object({
  mailboxId: z.string().uuid(),
  role: configurableFolderRoleSchema,
});
const folderRoleInputSchema = z.object({ folderId: z.string().uuid() });
const folderVisibilityInputSchema = z.object({ showInSidebar: z.boolean() }).strict();
const draftRevisionSchema = z.object({
  expectedRevision: z.coerce.number().int().positive(),
});
const draftRecoveryRestoreSchema = draftRevisionSchema.extend({
  leaseToken: z.string().uuid(),
});
const attachmentUploadQuerySchema = draftRevisionSchema.extend({
  filename: z.string().trim().min(1).max(255),
});
const attachmentChunkQuerySchema = z.object({
  offset: z.coerce.number().int().nonnegative(),
});
const acquireDraftLeaseSchema = z.object({ takeover: z.boolean().default(false) }).strict();
const notificationTargetParamSchema = z.object({
  mailboxId: z.string().uuid(),
  kind: z.literal("reminder"),
  sourceId: z.string().uuid(),
});
const providerDiscoveryQuerySchema = z.object({
  email: z.string().email().max(320),
});

const parseWorkspaceRouteUrl = (mailboxId: string, href: string): URL | null => {
  try {
    const base = new URL("https://cloud.invalid");
    const url = new URL(href, base);
    if (url.origin !== base.origin || url.pathname !== `/app/mail/${mailboxId}`) return null;
    return url;
  } catch {
    return null;
  }
};

const attachmentContentDisposition = (value: string | null, inline: boolean): string => {
  const filename = [...(value?.normalize("NFC") || "attachment")].slice(0, 255).join("");
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, "_") || "attachment";
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};

const safeAttachmentContentType = (value: string): string =>
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(baseAttachmentContentType(value))
    ? baseAttachmentContentType(value)
    : "application/octet-stream";

const requestContext = (c: Context<AuthContext>): MailRequestContext => ({
  actor: c.get("actor"),
  accessSubject: c.get("accessSubject"),
  requestId: c.req.header("x-request-id") ?? null,
});

const integrationRequest = (c: Context<AuthContext>) => ({
  cookie: c.req.header("Cookie"),
  authorization: c.req.header("Authorization"),
  requestId: c.req.header("X-Request-Id") ?? requestContext(c).requestId,
  signal: c.req.raw.signal,
});

const readBoundedBody = async (body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Result<Uint8Array>> => {
  if (!body) return fail(err.badInput("Request body is required"));
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("body-too-large");
        return fail(err.badInput(`Request body cannot exceed ${maxBytes} bytes`));
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, data: bytes };
};

const attachmentDownloadResponse = async (
  c: Context<AuthContext>,
  result: Result<AttachmentDownload>,
  query: z.infer<typeof attachmentQuerySchema>,
  assertCurrentAccess?: (blobId: string) => Promise<void>,
) => {
  if (!result.ok) return respond(c, result);
  const rangeHeader = c.req.header("range");
  const hasQueryRange = query.offset !== undefined || query.length !== undefined;
  if (rangeHeader && hasQueryRange)
    return respond(c, fail(err.badInput("Use either the Range header or offset and length query parameters")));
  const { blobId, total, chunkSize, chunkCount, contentHash, contentType, filename } = result.data;
  const responseType = safeAttachmentContentType(contentType).toLowerCase();
  const previewKind = attachmentPreviewKind(responseType, total);
  if (query.inline === true && !previewKind) {
    return respond(c, fail(err.badInput("This attachment type or size cannot be previewed safely")));
  }
  const inline = query.inline === true;
  if (inline) {
    const prefix = await messages.readAttachmentPrefix(blobId);
    if (!attachmentPreviewSignatureMatches(responseType, prefix)) {
      return respond(c, fail(err.badInput("The attachment content does not match its declared preview type")));
    }
  }
  const requestedRange =
    rangeHeader ?? (hasQueryRange ? `bytes=${query.offset ?? 0}-${(query.offset ?? 0) + (query.length ?? 1024 * 1024) - 1}` : null);
  const range = resolveByteRange(requestedRange, total);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${total}`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  const selectedRange = range ?? { start: 0, endExclusive: total };
  const partial = range !== null;
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Length": String(selectedRange.endExclusive - selectedRange.start),
    "Content-Type": responseType,
    "Content-Disposition": attachmentContentDisposition(filename, inline),
    ETag: `"${contentHash}"`,
    "Cache-Control": "private, no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  });
  if (inline) headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  if (partial) headers.set("Content-Range", `bytes ${selectedRange.start}-${selectedRange.endExclusive - 1}/${total}`);
  return new Response(
    messages.createAttachmentStream({
      blobId,
      chunkSize,
      chunkCount,
      start: selectedRange.start,
      endExclusive: selectedRange.endExclusive,
      assertCurrentAccess: assertCurrentAccess ? () => assertCurrentAccess(blobId) : undefined,
    }),
    { status: partial ? 206 : 200, headers },
  );
};

const mailOperationsApi = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))
  .get("/mailboxes/:mailboxId/provider-discovery", v("param", uuidParamSchema), v("query", providerDiscoveryQuerySchema), async (c) => {
    const mailboxId = c.req.valid("param").mailboxId;
    const allowed = await mailboxAccess.requireMailboxPermission(requestContext(c), mailboxId, "admin");
    if (!allowed.ok) return respond(c, allowed);
    return respond(c, ok(await discoverMailConfigurations(c.req.valid("query").email)));
  })
  .get("/mailboxes", v("query", mailboxListQuerySchema), async (c) => {
    const query = c.req.valid("query");
    return respond(c, mailboxes.listMailboxes(requestContext(c), query.limit, query.name, query.q));
  })
  .post("/mailboxes", v("json", createMailboxInputSchema), async (c) =>
    respond(c, mailboxes.createMailbox(requestContext(c), c.req.valid("json"))),
  )
  .get("/mailboxes/:mailboxId", v("param", uuidParamSchema), async (c) =>
    respond(c, mailboxes.getMailbox(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .get("/mailboxes/:mailboxId/workspace-route", v("param", uuidParamSchema), v("query", workspaceRouteQuerySchema), async (c) => {
    const mailboxId = c.req.valid("param").mailboxId;
    const query = c.req.valid("query");
    const requestUrl = parseWorkspaceRouteUrl(mailboxId, query.href);
    if (!requestUrl) return respond(c, fail(err.badInput("Workspace route must target this mailbox")));
    const data = await loadMailboxPageData({
      context: requestContext(c),
      mailboxId,
      requestUrl,
      listMode: query.listMode,
    });
    return respond(c, data ? { ok: true, data } : fail(err.notFound("Mailbox")));
  })
  .get(
    "/mailboxes/:mailboxId/workspace-detail/:conversationId",
    v(
      "param",
      z.object({
        mailboxId: z.string().uuid(),
        conversationId: z.string().uuid(),
      }),
    ),
    async (c) => {
      const params = c.req.valid("param");
      const detail = await loadMailboxConversationDetail({
        context: requestContext(c),
        ...params,
      });
      return respond(c, detail ? { ok: true, data: detail } : fail(err.notFound("Conversation")));
    },
  )
  .get(
    "/mailboxes/:mailboxId/conversations/:conversationId/context",
    describeRoute({
      tags: ["Mail:Context"],
      summary: "Get permission-scoped Contacts context",
      description: "Resolves current conversation participants through Contacts without storing foreign contact metadata.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(mailConversationContextSchema, "Conversation context"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Conversation not found"),
      },
    }),
    v("param", mailboxAndIdParamSchema("conversationId")),
    v("query", mailConversationContextQuerySchema),
    async (c) =>
      respond(
        c,
        conversationContext.getConversationContext({
          context: requestContext(c),
          request: integrationRequest(c),
          ...(c.req.valid("param") as { mailboxId: string; conversationId: string }),
          query: c.req.valid("query"),
        }),
      ),
  )
  .get(
    "/mailboxes/:mailboxId/conversations/:conversationId/contacts/:bookId/:contactId/history",
    describeRoute({
      tags: ["Mail:Context"],
      summary: "List related Mail for a currently readable participant contact",
      description: "Rechecks the Contact match and returns keyset-paginated conversations from the current mailbox only.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(relatedMailPageSchema, "Related conversations"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Contact or conversation not found"),
      },
    }),
    v(
      "param",
      z.object({
        mailboxId: z.uuid(),
        conversationId: z.uuid(),
        bookId: z.union([z.uuid(), z.literal("system")]),
        contactId: z.uuid(),
      }),
    ),
    v("query", relatedMailQuerySchema),
    async (c) =>
      respond(
        c,
        conversationContext.listRelatedMail({
          context: requestContext(c),
          request: integrationRequest(c),
          ...c.req.valid("param"),
          ...c.req.valid("query"),
        }),
      ),
  )
  .get("/mailboxes/:mailboxId/settings-context", v("param", uuidParamSchema), async (c) =>
    respond(c, settingsContext.loadMailboxSettingsContext(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .get(
    "/mailboxes/:mailboxId/calendar-destinations",
    describeRoute({
      tags: ["Mail:Calendar"],
      summary: "List writable Spaces calendar destinations",
      ...requiresAuth,
      responses: { 200: jsonResponse(calendarDestinationsResponseSchema, "Mailbox calendar destinations") },
    }),
    v("param", uuidParamSchema),
    async (c) => {
      const mailboxId = c.req.valid("param").mailboxId;
      const destinations = await calendarInvitations.listDestinations({
        context: requestContext(c),
        mailboxId,
        request: integrationRequest(c),
      });
      if (!destinations.ok) return respond(c, destinations);
      return respond(c, destinations);
    },
  )
  .put(
    "/mailboxes/:mailboxId/calendar-destination",
    describeRoute({
      tags: ["Mail:Calendar"],
      summary: "Set the mailbox's default Space",
      description: "Validates current write access before saving the optional default calendar destination.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(calendarDestinationsResponseSchema, "Updated calendar destination"),
        400: jsonResponse(ErrorResponseSchema, "Destination is unavailable"),
        403: jsonResponse(ErrorResponseSchema, "Mailbox admin required"),
      },
    }),
    v("param", uuidParamSchema),
    v("json", calendarDestinationInputSchema),
    async (c) => {
      const mailboxId = c.req.valid("param").mailboxId;
      const input = c.req.valid("json");
      const updated = await calendarInvitations.setDefaultDestination({
        context: requestContext(c),
        mailboxId,
        spaceId: input.spaceId,
        request: integrationRequest(c),
      });
      return respond(c, updated);
    },
  )
  .get(
    "/mailboxes/:mailboxId/calendar-events",
    describeRoute({
      tags: ["Mail:Calendar"],
      summary: "List writable Space events for the composer",
      ...requiresAuth,
      responses: {
        200: jsonResponse(EventListDataSchema, "Calendar events"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
      },
    }),
    v("param", uuidParamSchema),
    v("query", calendarEventsQuerySchema),
    async (c) => {
      const { mailboxId } = c.req.valid("param");
      const query = c.req.valid("query");
      return respond(
        c,
        calendarInvitations.listComposerEvents({
          context: requestContext(c),
          mailboxId,
          spaceId: query.spaceId,
          query: query.query,
          request: integrationRequest(c),
        }),
      );
    },
  )
  .post(
    "/mailboxes/:mailboxId/calendar-events",
    describeRoute({
      tags: ["Mail:Calendar"],
      summary: "Create a Space event for the current composer",
      ...requiresAuth,
      responses: {
        200: jsonResponse(EventDataSchema, "Created calendar event"),
        400: jsonResponse(ErrorResponseSchema, "Invalid event"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
      },
    }),
    v("param", uuidParamSchema),
    v("json", createCalendarEventInputSchema),
    async (c) => {
      const { mailboxId } = c.req.valid("param");
      return respond(
        c,
        calendarInvitations.createComposerEvent({
          context: requestContext(c),
          mailboxId,
          ...c.req.valid("json"),
          request: integrationRequest(c),
        }),
      );
    },
  )
  .post(
    "/mailboxes/:mailboxId/drafts/:draftId/calendar-invitation",
    describeRoute({
      tags: ["Mail:Calendar"],
      summary: "Attach an idempotent Space event invitation to a draft",
      description: "Derives organizer and visible attendees from the authorized Mail draft; Bcc recipients are never disclosed.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(draftSchema, "Draft with calendar invitation"),
        400: jsonResponse(ErrorResponseSchema, "Invitation cannot be attached"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        409: jsonResponse(ErrorResponseSchema, "Draft changed"),
      },
    }),
    v("param", mailboxAndIdParamSchema("draftId")),
    v("json", attachCalendarEventInputSchema),
    async (c) => {
      const params = c.req.valid("param") as { mailboxId: string; draftId: string };
      return respond(
        c,
        calendarInvitations.attachEventInvitation({
          context: requestContext(c),
          ...params,
          ...c.req.valid("json"),
          request: integrationRequest(c),
        }),
      );
    },
  )
  .get(
    "/mailboxes/:mailboxId/messages/:messageId/calendar-invitation",
    describeRoute({
      tags: ["Mail:Calendar"],
      summary: "Preview a message calendar invitation",
      ...requiresAuth,
      responses: {
        200: jsonResponse(CalendarInvitationPreviewSchema, "Calendar invitation"),
        404: jsonResponse(ErrorResponseSchema, "No calendar invitation"),
      },
    }),
    v("param", mailboxAndIdParamSchema("messageId")),
    async (c) =>
      respond(
        c,
        calendarInvitations.preview({
          context: requestContext(c),
          ...(c.req.valid("param") as { mailboxId: string; messageId: string }),
          request: integrationRequest(c),
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/messages/:messageId/calendar-invitation/import",
    describeRoute({
      tags: ["Mail:Calendar"],
      summary: "Add or update an invitation in Spaces",
      ...requiresAuth,
      responses: { 200: jsonResponse(CalendarInvitationImportResultSchema, "Imported event") },
    }),
    v("param", mailboxAndIdParamSchema("messageId")),
    v("json", calendarImportInputSchema),
    async (c) =>
      respond(
        c,
        calendarInvitations.importToSpace({
          context: requestContext(c),
          ...(c.req.valid("param") as { mailboxId: string; messageId: string }),
          ...c.req.valid("json"),
          request: integrationRequest(c),
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/messages/:messageId/calendar-invitation/respond",
    describeRoute({
      tags: ["Mail:Calendar"],
      summary: "Create a calendar response draft",
      description: "Creates a normal editable Mail draft with a standards-based iTIP REPLY attachment.",
      ...requiresAuth,
      responses: { 200: jsonResponse(draftSchema, "Calendar response draft") },
    }),
    v("param", mailboxAndIdParamSchema("messageId")),
    v("json", calendarResponseInputSchema),
    async (c) =>
      respond(
        c,
        calendarInvitations.createResponseDraft({
          context: requestContext(c),
          ...(c.req.valid("param") as { mailboxId: string; messageId: string }),
          participationStatus: c.req.valid("json").participationStatus,
          idempotencyKey: c.req.valid("json").idempotencyKey,
          spaceId: c.req.valid("json").spaceId,
          request: integrationRequest(c),
        }),
      ),
  )
  .get("/mailboxes/:mailboxId/health", v("param", uuidParamSchema), async (c) =>
    respond(c, health.getMailboxOperationalHealth(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .get("/mailboxes/:mailboxId/subscriptions", v("param", uuidParamSchema), v("query", subscriptionQuerySchema), async (c) => {
    const params = c.req.valid("param");
    const query = c.req.valid("query");
    return respond(
      c,
      listSubscriptions.listSubscriptions({
        context: requestContext(c),
        mailboxId: params.mailboxId,
        cursor: query.cursor,
        limit: query.limit,
        focusedListKey: query.listKey,
      }),
    );
  })
  .post(
    "/mailboxes/:mailboxId/subscriptions/unsubscribe",
    v("param", uuidParamSchema),
    v("json", unsubscribeMailingListInputSchema),
    async (c) =>
      respond(
        c,
        listSubscriptions.requestUnsubscribe({
          context: requestContext(c),
          mailboxId: c.req.valid("param").mailboxId,
          input: c.req.valid("json"),
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/subscriptions/disposition",
    v("param", uuidParamSchema),
    v("json", mailingListDispositionInputSchema),
    async (c) =>
      respond(
        c,
        listSubscriptions.applyMailingListDisposition({
          context: requestContext(c),
          mailboxId: c.req.valid("param").mailboxId,
          input: c.req.valid("json"),
        }),
      ),
  )
  .get("/mailboxes/:mailboxId/operations", v("param", uuidParamSchema), v("query", mailboxOperationsQuerySchema), async (c) =>
    respond(c, operations.getMailboxOperations(requestContext(c), c.req.valid("param").mailboxId, c.req.valid("query"))),
  )
  .patch("/mailboxes/:mailboxId", v("param", uuidParamSchema), v("json", updateMailboxSchema), async (c) =>
    respond(
      c,
      mailboxes.updateMailbox({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        ...c.req.valid("json"),
      }),
    ),
  )
  .delete("/mailboxes/:mailboxId", v("param", uuidParamSchema), async (c) =>
    respond(c, mailboxes.deleteMailbox(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .get("/mailboxes/:mailboxId/access", v("param", uuidParamSchema), async (c) =>
    respond(c, mailboxAccess.listMailboxAccess(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .post("/mailboxes/:mailboxId/access", v("param", uuidParamSchema), v("json", GrantAccessSchema), async (c) => {
    const input = c.req.valid("json");
    if (input.permission === "none") return respond(c, fail(err.badInput("Access permission cannot be none")));
    return respond(
      c,
      mailboxAccess.grantMailboxAccess({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        principal: input.principal,
        permission: input.permission,
      }),
    );
  })
  .patch(
    "/mailboxes/:mailboxId/access/:accessId",
    v("param", mailboxAndIdParamSchema("accessId")),
    v("json", UpdateAccessSchema),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        accessId: string;
      };
      const { permission } = c.req.valid("json");
      if (permission === "none") return respond(c, fail(err.badInput("Use DELETE to revoke access")));
      return respond(
        c,
        mailboxAccess.updateMailboxAccess({
          context: requestContext(c),
          ...params,
          permission,
        }),
      );
    },
  )
  .delete("/mailboxes/:mailboxId/access/:accessId", v("param", mailboxAndIdParamSchema("accessId")), async (c) => {
    const params = c.req.valid("param") as {
      mailboxId: string;
      accessId: string;
    };
    return respond(
      c,
      mailboxAccess.revokeMailboxAccess({
        context: requestContext(c),
        ...params,
      }),
    );
  })
  .get("/mailboxes/:mailboxId/connections", v("param", uuidParamSchema), async (c) =>
    respond(c, providerConnections.listProviderConnections(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .post("/mailboxes/:mailboxId/connections", v("param", uuidParamSchema), v("json", providerConnectionInputSchema), async (c) =>
    respond(
      c,
      providerConnections.createProviderConnection({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        input: c.req.valid("json"),
      }),
    ),
  )
  .put(
    "/mailboxes/:mailboxId/connections/:connectionId",
    v("param", mailboxAndIdParamSchema("connectionId")),
    v("json", providerConnectionInputSchema),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        connectionId: string;
      };
      const current = await providerConnections.getProviderConnection(requestContext(c), params.connectionId);
      if (!current.ok) return respond(c, current);
      if (current.data.mailboxId !== params.mailboxId) return respond(c, fail(err.notFound("Provider connection")));
      return respond(
        c,
        providerConnections.replaceProviderConnection({
          context: requestContext(c),
          connectionId: params.connectionId,
          input: c.req.valid("json"),
        }),
      );
    },
  )
  .delete("/mailboxes/:mailboxId/connections/:connectionId", v("param", mailboxAndIdParamSchema("connectionId")), async (c) => {
    const params = c.req.valid("param") as {
      mailboxId: string;
      connectionId: string;
    };
    const current = await providerConnections.getProviderConnection(requestContext(c), params.connectionId);
    if (!current.ok) return respond(c, current);
    if (current.data.mailboxId !== params.mailboxId) return respond(c, fail(err.notFound("Provider connection")));
    return respond(c, providerConnections.revokeProviderConnection(requestContext(c), params.connectionId));
  })
  .post(
    "/mailboxes/:mailboxId/connections/:connectionId/limits/refresh",
    v("param", mailboxAndIdParamSchema("connectionId")),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        connectionId: string;
      };
      return respond(
        c,
        providerConnections.refreshProviderConnectionLimits({
          context: requestContext(c),
          ...params,
        }),
      );
    },
  )
  .get("/mailboxes/:mailboxId/bindings", v("param", uuidParamSchema), async (c) =>
    respond(c, bindings.listProviderBindings(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .post("/mailboxes/:mailboxId/bindings", v("param", uuidParamSchema), v("json", attachBindingSchema), async (c) =>
    respond(
      c,
      bindings.attachProviderBinding({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        ...c.req.valid("json"),
      }),
    ),
  )
  .post("/mailboxes/:mailboxId/sync", v("param", uuidParamSchema), async (c) => {
    const mailboxId = c.req.valid("param").mailboxId;
    return respond(
      c,
      commands.createMaintenanceCommand({
        context: requestContext(c),
        mailboxId,
        input: {
          kind: "sync_mailbox",
          idempotencyKey: c.req.header("idempotency-key")?.trim() || `manual-sync:${crypto.randomUUID()}`,
        },
      }),
    );
  })
  .get("/mailboxes/:mailboxId/folders", v("param", uuidParamSchema), async (c) =>
    respond(c, messages.listFolders(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .patch(
    "/mailboxes/:mailboxId/folders/:folderId",
    v("param", mailboxAndIdParamSchema("folderId")),
    v("json", folderVisibilityInputSchema),
    async (c) => {
      const params = c.req.valid("param") as { mailboxId: string; folderId: string };
      return respond(
        c,
        folders.setFolderSidebarVisibility({
          context: requestContext(c),
          ...params,
          showInSidebar: c.req.valid("json").showInSidebar,
        }),
      );
    },
  )
  .delete("/mailboxes/:mailboxId/folders/:folderId", v("param", mailboxAndIdParamSchema("folderId")), async (c) => {
    const params = c.req.valid("param") as { mailboxId: string; folderId: string };
    return respond(
      c,
      folders.dismissUnavailableFolder({
        context: requestContext(c),
        ...params,
      }),
    );
  })
  .get("/mailboxes/:mailboxId/notification-targets/:kind/:sourceId", v("param", notificationTargetParamSchema), async (c) => {
    const resolved = await notificationTargets.resolveMailNotificationTarget({
      context: requestContext(c),
      ...c.req.valid("param"),
    });
    return resolved.ok ? c.redirect(resolved.data.href, 302) : respond(c, resolved);
  })
  .get("/mailboxes/:mailboxId/assignable-users", v("param", uuidParamSchema), v("query", collaboratorQuerySchema), async (c) =>
    respond(
      c,
      collaboration.listAssignableUsers({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        ...c.req.valid("query"),
      }),
    ),
  )
  .get("/mailboxes/:mailboxId/conversation-view-counts", v("param", uuidParamSchema), async (c) =>
    respond(
      c,
      messages.getConversationViewCounts({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
      }),
    ),
  )
  .get("/mailboxes/:mailboxId/activity", v("param", uuidParamSchema), v("query", activityQuerySchema), async (c) =>
    respond(
      c,
      collaboration.listActivity({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        ...c.req.valid("query"),
      }),
    ),
  )
  .put("/mailboxes/:mailboxId/folder-roles/:role", v("param", roleParamSchema), v("json", folderRoleInputSchema), async (c) =>
    respond(
      c,
      folders.setFolderRole({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        role: c.req.valid("param").role,
        folderId: c.req.valid("json").folderId,
      }),
    ),
  )
  .delete("/mailboxes/:mailboxId/folder-roles/:role", v("param", roleParamSchema), async (c) =>
    respond(
      c,
      folders.clearFolderRole({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        role: c.req.valid("param").role,
      }),
    ),
  )
  .get("/mailboxes/:mailboxId/conversations", v("param", uuidParamSchema), v("query", conversationQuerySchema), async (c) =>
    respond(
      c,
      messages.listConversations({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        ...c.req.valid("query"),
      }),
    ),
  )
  .get("/mailboxes/:mailboxId/saved-views", v("param", uuidParamSchema), async (c) =>
    respond(
      c,
      savedViews.listSavedConversationViews({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
      }),
    ),
  )
  .post("/mailboxes/:mailboxId/saved-views", v("param", uuidParamSchema), v("json", createSavedConversationViewSchema), async (c) =>
    respond(
      c,
      savedViews.createSavedConversationView({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        input: c.req.valid("json"),
      }),
    ),
  )
  .get("/mailboxes/:mailboxId/saved-views/:viewId", v("param", mailboxAndIdParamSchema("viewId")), async (c) =>
    respond(
      c,
      savedViews.getSavedConversationView({
        context: requestContext(c),
        ...(c.req.valid("param") as { mailboxId: string; viewId: string }),
      }),
    ),
  )
  .patch(
    "/mailboxes/:mailboxId/saved-views/:viewId",
    v("param", mailboxAndIdParamSchema("viewId")),
    v("json", updateSavedConversationViewSchema),
    async (c) =>
      respond(
        c,
        savedViews.updateSavedConversationView({
          context: requestContext(c),
          ...(c.req.valid("param") as { mailboxId: string; viewId: string }),
          input: c.req.valid("json"),
        }),
      ),
  )
  .put(
    "/mailboxes/:mailboxId/sender-identities/:senderIdentityId/transport",
    v("param", mailboxAndIdParamSchema("senderIdentityId")),
    v("json", updateSenderIdentityTransportInputSchema),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        senderIdentityId: string;
      };
      return respond(
        c,
        senderIdentityTransports.upsertSenderIdentityTransport({
          context: requestContext(c),
          ...params,
          input: c.req.valid("json"),
        }),
      );
    },
  )
  .delete(
    "/mailboxes/:mailboxId/sender-identities/:senderIdentityId/transport",
    v("param", mailboxAndIdParamSchema("senderIdentityId")),
    v("json", deleteSenderIdentityTransportInputSchema),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        senderIdentityId: string;
      };
      return respond(
        c,
        senderIdentityTransports.deleteSenderIdentityTransport({
          context: requestContext(c),
          ...params,
          expectedRevision: c.req.valid("json").expectedRevision,
        }),
      );
    },
  )
  .delete(
    "/mailboxes/:mailboxId/saved-views/:viewId",
    v("param", mailboxAndIdParamSchema("viewId")),
    v("json", deleteSavedConversationViewSchema),
    async (c) =>
      respond(
        c,
        savedViews.deleteSavedConversationView({
          context: requestContext(c),
          ...(c.req.valid("param") as { mailboxId: string; viewId: string }),
          expectedRevision: c.req.valid("json").expectedRevision,
        }),
      ),
  )
  .get(
    "/mailboxes/:mailboxId/saved-views/:viewId/conversations",
    v("param", mailboxAndIdParamSchema("viewId")),
    v("query", cursorQuerySchema),
    async (c) =>
      respond(
        c,
        savedViews.listSavedViewConversations({
          context: requestContext(c),
          ...(c.req.valid("param") as { mailboxId: string; viewId: string }),
          ...c.req.valid("query"),
        }),
      ),
  )
  .get(
    "/mailboxes/:mailboxId/conversations/:conversationId/messages",
    v("param", mailboxAndIdParamSchema("conversationId")),
    v("query", cursorQuerySchema),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        conversationId: string;
      };
      return respond(
        c,
        messages.listConversationMessages({
          context: requestContext(c),
          ...params,
          ...c.req.valid("query"),
        }),
      );
    },
  )
  .get(
    "/mailboxes/:mailboxId/conversations/:conversationId/drafts",
    v("param", mailboxAndIdParamSchema("conversationId")),
    v("query", conversationDraftsQuerySchema),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        conversationId: string;
      };
      return respond(
        c,
        drafts.listConversationDrafts({
          context: requestContext(c),
          ...params,
          limit: c.req.valid("query").limit,
        }),
      );
    },
  )
  .post(
    "/mailboxes/:mailboxId/conversations/:conversationId/merge",
    v("param", mailboxAndIdParamSchema("conversationId")),
    v("json", mergeConversationsInputSchema),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        conversationId: string;
      };
      return respond(
        c,
        conversations.mergeConversations({
          context: requestContext(c),
          mailboxId: params.mailboxId,
          targetConversationId: params.conversationId,
          input: c.req.valid("json"),
        }),
      );
    },
  )
  .post(
    "/mailboxes/:mailboxId/conversations/:conversationId/split",
    v("param", mailboxAndIdParamSchema("conversationId")),
    v("json", splitConversationInputSchema),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        conversationId: string;
      };
      return respond(
        c,
        conversations.splitConversation({
          context: requestContext(c),
          mailboxId: params.mailboxId,
          conversationId: params.conversationId,
          input: c.req.valid("json"),
        }),
      );
    },
  )
  .post(
    "/mailboxes/:mailboxId/conversations/:conversationId/messages/:messageId/reassign",
    v("param", mailboxAndTwoIdsParamSchema("conversationId", "messageId")),
    v("json", reassignConversationMessageInputSchema),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        conversationId: string;
        messageId: string;
      };
      return respond(
        c,
        conversations.reassignConversationMessage({
          context: requestContext(c),
          mailboxId: params.mailboxId,
          sourceConversationId: params.conversationId,
          messageId: params.messageId,
          input: c.req.valid("json"),
        }),
      );
    },
  )
  .get(
    "/mailboxes/:mailboxId/conversations/:conversationId/collaboration",
    v("param", mailboxAndIdParamSchema("conversationId")),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        conversationId: string;
      };
      return respond(
        c,
        collaboration.getConversationCollaboration({
          context: requestContext(c),
          ...params,
        }),
      );
    },
  )
  .patch(
    "/mailboxes/:mailboxId/conversations/:conversationId/collaboration",
    v("param", mailboxAndIdParamSchema("conversationId")),
    v("json", updateConversationCollaborationSchema),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        conversationId: string;
      };
      return respond(
        c,
        collaboration.updateConversationCollaboration({
          context: requestContext(c),
          ...params,
          input: c.req.valid("json"),
        }),
      );
    },
  )
  .get("/mailboxes/:mailboxId/conversations/:conversationId/reminder", v("param", mailboxAndIdParamSchema("conversationId")), async (c) =>
    respond(
      c,
      reminders.getConversationReminder({
        context: requestContext(c),
        ...(c.req.valid("param") as {
          mailboxId: string;
          conversationId: string;
        }),
      }),
    ),
  )
  .put(
    "/mailboxes/:mailboxId/conversations/:conversationId/reminder",
    v("param", mailboxAndIdParamSchema("conversationId")),
    v("json", setConversationReminderSchema),
    async (c) =>
      respond(
        c,
        reminders.setConversationReminder({
          context: requestContext(c),
          ...(c.req.valid("param") as {
            mailboxId: string;
            conversationId: string;
          }),
          input: c.req.valid("json"),
        }),
      ),
  )
  .delete(
    "/mailboxes/:mailboxId/conversations/:conversationId/reminder",
    v("param", mailboxAndIdParamSchema("conversationId")),
    v("json", cancelConversationReminderSchema),
    async (c) =>
      respond(
        c,
        reminders.cancelConversationReminder({
          context: requestContext(c),
          ...(c.req.valid("param") as {
            mailboxId: string;
            conversationId: string;
          }),
          input: c.req.valid("json"),
        }),
      ),
  )
  .get("/mailboxes/:mailboxId/conversations/:conversationId/presence", v("param", mailboxAndIdParamSchema("conversationId")), async (c) =>
    respond(
      c,
      presence.getConversationPresence({
        context: requestContext(c),
        ...(c.req.valid("param") as {
          mailboxId: string;
          conversationId: string;
        }),
      }),
    ),
  )
  .put(
    "/mailboxes/:mailboxId/conversations/:conversationId/presence",
    v("param", mailboxAndIdParamSchema("conversationId")),
    v("json", conversationPresenceHeartbeatSchema),
    async (c) =>
      respond(
        c,
        presence.heartbeatConversationPresence({
          context: requestContext(c),
          ...(c.req.valid("param") as {
            mailboxId: string;
            conversationId: string;
          }),
          input: c.req.valid("json"),
        }),
      ),
  )
  .delete(
    "/mailboxes/:mailboxId/conversations/:conversationId/presence",
    v("param", mailboxAndIdParamSchema("conversationId")),
    v("json", conversationPresenceLeaveSchema),
    async (c) =>
      respond(
        c,
        presence.leaveConversationPresence({
          context: requestContext(c),
          ...(c.req.valid("param") as {
            mailboxId: string;
            conversationId: string;
          }),
          peerId: c.req.valid("json").peerId,
        }),
      ),
  )
  .get(
    "/mailboxes/:mailboxId/conversations/:conversationId/comments",
    v("param", mailboxAndIdParamSchema("conversationId")),
    v("query", cursorQuerySchema),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        conversationId: string;
      };
      return respond(
        c,
        collaboration.listConversationComments({
          context: requestContext(c),
          ...params,
          ...c.req.valid("query"),
        }),
      );
    },
  )
  .post(
    "/mailboxes/:mailboxId/conversations/:conversationId/comments",
    v("param", mailboxAndIdParamSchema("conversationId")),
    v("json", createConversationCommentSchema),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        conversationId: string;
      };
      return respond(
        c,
        collaboration.createConversationComment({
          context: requestContext(c),
          ...params,
          input: c.req.valid("json"),
        }),
      );
    },
  )
  .patch(
    "/mailboxes/:mailboxId/conversations/:conversationId/comments/:commentId",
    v(
      "param",
      z.object({
        mailboxId: z.string().uuid(),
        conversationId: z.string().uuid(),
        commentId: z.string().uuid(),
      }),
    ),
    v("json", updateConversationCommentSchema),
    async (c) =>
      respond(
        c,
        collaboration.updateConversationComment({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  )
  .delete(
    "/mailboxes/:mailboxId/conversations/:conversationId/comments/:commentId",
    v(
      "param",
      z.object({
        mailboxId: z.string().uuid(),
        conversationId: z.string().uuid(),
        commentId: z.string().uuid(),
      }),
    ),
    v("json", deleteConversationCommentSchema),
    async (c) =>
      respond(
        c,
        collaboration.deleteConversationComment({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/conversations/:conversationId/actions",
    v("param", mailboxAndIdParamSchema("conversationId")),
    v("json", conversationTriageInputSchema),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        conversationId: string;
      };
      return respond(
        c,
        triage.createConversationTriageCommands({
          context: requestContext(c),
          ...params,
          input: c.req.valid("json"),
        }),
      );
    },
  )
  .get("/mailboxes/:mailboxId/messages/:messageId", v("param", mailboxAndIdParamSchema("messageId")), async (c) => {
    const params = c.req.valid("param") as {
      mailboxId: string;
      messageId: string;
    };
    return respond(c, messages.getMessage({ context: requestContext(c), ...params }));
  })
  .post(
    "/mailboxes/:mailboxId/messages/:messageId/derive-draft",
    v("param", mailboxAndIdParamSchema("messageId")),
    v("json", deriveDraftFromMessageInputSchema),
    async (c) => {
      const params = c.req.valid("param") as { mailboxId: string; messageId: string };
      return respond(
        c,
        drafts.deriveDraftFromMessage({
          context: requestContext(c),
          ...params,
          input: c.req.valid("json"),
        }),
      );
    },
  )
  .get("/mailboxes/:mailboxId/messages/:messageId/inspector", v("param", mailboxAndIdParamSchema("messageId")), async (c) => {
    const params = c.req.valid("param") as {
      mailboxId: string;
      messageId: string;
    };
    return respond(c, messageInspector.inspectMessage({ context: requestContext(c), ...params }));
  })
  .get("/mailboxes/:mailboxId/messages/:messageId/source-preview", v("param", mailboxAndIdParamSchema("messageId")), async (c) => {
    const params = c.req.valid("param") as {
      mailboxId: string;
      messageId: string;
    };
    return respond(c, messageInspector.previewMessageSource({ context: requestContext(c), ...params }));
  })
  .get(
    "/mailboxes/:mailboxId/messages/:messageId/source",
    v("param", mailboxAndIdParamSchema("messageId")),
    v("query", messageSourceQuerySchema),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        messageId: string;
      };
      const query = c.req.valid("query");
      return attachmentDownloadResponse(
        c,
        await messageInspector.openMessageSource({ context: requestContext(c), ...params }),
        { ...query, inline: false },
        async (expectedBlobId) => {
          const current = await messageInspector.openMessageSource({ context: requestContext(c), ...params });
          if (!current.ok || current.data.blobId !== expectedBlobId) {
            throw Object.assign(new Error("Message source access was revoked during transfer"), { code: "ACCESS_REVOKED" });
          }
        },
      );
    },
  )
  .get(
    "/mailboxes/:mailboxId/messages/:messageId/attachments/:attachmentId",
    v(
      "param",
      z.object({
        mailboxId: z.string().uuid(),
        messageId: z.string().uuid(),
        attachmentId: z.string().uuid(),
      }),
    ),
    v("query", attachmentQuerySchema),
    async (c) => {
      const context = requestContext(c);
      const params = c.req.valid("param");
      return attachmentDownloadResponse(
        c,
        await messages.openAttachment({ context, ...params }),
        c.req.valid("query"),
        async (expectedBlobId) => {
          const current = await messages.openAttachment({ context, ...params });
          if (!current.ok || current.data.blobId !== expectedBlobId) {
            throw Object.assign(new Error("Attachment access was revoked during transfer"), { code: "ACCESS_REVOKED" });
          }
        },
      );
    },
  )
  .post(
    "/mailboxes/:mailboxId/messages/:messageId/attachments/:attachmentId/links",
    v(
      "param",
      z.object({
        mailboxId: z.string().uuid(),
        messageId: z.string().uuid(),
        attachmentId: z.string().uuid(),
      }),
    ),
    v("json", createAttachmentLinkInputSchema),
    async (c) => {
      const params = c.req.valid("param");
      return respond(
        c,
        attachmentLinks.createPublicAttachmentLink({
          context: requestContext(c),
          mailboxId: params.mailboxId,
          sourceKind: "message",
          sourceId: params.messageId,
          attachmentId: params.attachmentId,
          input: c.req.valid("json"),
        }),
      );
    },
  )
  .get("/mailboxes/:mailboxId/attachment-links", v("param", uuidParamSchema), v("query", cursorQuerySchema), async (c) =>
    respond(c, attachmentLinks.listPublicAttachmentLinks(requestContext(c), c.req.valid("param").mailboxId, c.req.valid("query"))),
  )
  .delete("/mailboxes/:mailboxId/attachment-links/:linkId", v("param", mailboxAndIdParamSchema("linkId")), async (c) => {
    const params = c.req.valid("param") as {
      mailboxId: string;
      linkId: string;
    };
    return respond(
      c,
      attachmentLinks.revokePublicAttachmentLink({
        context: requestContext(c),
        ...params,
      }),
    );
  })
  .post("/mailboxes/:mailboxId/search", v("param", uuidParamSchema), v("json", searchRequestSchema), async (c) =>
    respond(
      c,
      search.searchMessages({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        request: c.req.valid("json"),
      }),
    ),
  )
  .get("/mailboxes/:mailboxId/sender-identities", v("param", uuidParamSchema), async (c) =>
    respond(c, senderIdentities.listSenderIdentities(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .get("/mailboxes/:mailboxId/compose-templates", v("param", uuidParamSchema), async (c) =>
    respond(c, composeTemplates.listComposeTemplates(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .post("/mailboxes/:mailboxId/compose-templates", v("param", uuidParamSchema), v("json", createComposeTemplateInputSchema), async (c) =>
    respond(
      c,
      composeTemplates.createComposeTemplate({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        input: c.req.valid("json"),
      }),
    ),
  )
  .patch(
    "/mailboxes/:mailboxId/compose-templates/:templateId",
    v("param", mailboxAndIdParamSchema("templateId")),
    v("json", updateComposeTemplateInputSchema),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        templateId: string;
      };
      return respond(
        c,
        composeTemplates.updateComposeTemplate({
          context: requestContext(c),
          ...params,
          input: c.req.valid("json"),
        }),
      );
    },
  )
  .delete(
    "/mailboxes/:mailboxId/compose-templates/:templateId",
    v("param", mailboxAndIdParamSchema("templateId")),
    v("json", archiveComposeTemplateInputSchema),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        templateId: string;
      };
      return respond(
        c,
        composeTemplates.archiveComposeTemplate({
          context: requestContext(c),
          ...params,
          input: c.req.valid("json"),
        }),
      );
    },
  )
  .get("/mailboxes/:mailboxId/compose-signature-defaults", v("param", uuidParamSchema), async (c) =>
    respond(c, composeTemplates.listComposeSignatureDefaults(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .put(
    "/mailboxes/:mailboxId/sender-identities/:senderIdentityId/compose-signature-default",
    v("param", mailboxAndIdParamSchema("senderIdentityId")),
    v("json", setComposeSignatureDefaultInputSchema),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        senderIdentityId: string;
      };
      return respond(
        c,
        composeTemplates.setComposeSignatureDefault({
          context: requestContext(c),
          ...params,
          input: c.req.valid("json"),
        }),
      );
    },
  )
  .get("/mailboxes/:mailboxId/compose-style", v("param", uuidParamSchema), async (c) =>
    respond(c, composeTemplates.getMailboxComposeStyle(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .put("/mailboxes/:mailboxId/compose-style", v("param", uuidParamSchema), v("json", updateMailboxComposeStyleInputSchema), async (c) =>
    respond(
      c,
      composeTemplates.updateMailboxComposeStyle({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        input: c.req.valid("json"),
      }),
    ),
  )
  .post("/mailboxes/:mailboxId/compose-preview", v("param", uuidParamSchema), v("json", composePreviewInputSchema), async (c) =>
    respond(
      c,
      composeTemplates.previewComposeDraft({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        input: c.req.valid("json"),
      }),
    ),
  )
  .post("/mailboxes/:mailboxId/compose-snippet", v("param", uuidParamSchema), v("json", renderComposeSnippetInputSchema), async (c) =>
    respond(
      c,
      composeTemplates.renderComposeSnippet({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        input: c.req.valid("json"),
      }),
    ),
  )
  .post("/mailboxes/:mailboxId/compose-suggestions", v("param", uuidParamSchema), v("json", composeSuggestionsInputSchema), async (c) =>
    respond(
      c,
      composeTemplates.renderComposeSuggestions({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        input: c.req.valid("json"),
      }),
    ),
  )
  .post("/mailboxes/:mailboxId/sender-identities", v("param", uuidParamSchema), v("json", createSenderIdentityInputSchema), async (c) =>
    respond(
      c,
      senderIdentities.createSenderIdentity({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        input: c.req.valid("json"),
      }),
    ),
  )
  .post(
    "/mailboxes/:mailboxId/sender-identities/default/setup",
    v("param", uuidParamSchema),
    v("json", defaultSenderSetupInputSchema),
    async (c) =>
      respond(
        c,
        senderIdentities.setupDefaultSender({
          context: requestContext(c),
          mailboxId: c.req.valid("param").mailboxId,
          input: c.req.valid("json"),
        }),
      ),
  )
  .patch(
    "/mailboxes/:mailboxId/sender-identities/:senderIdentityId",
    v("param", mailboxAndIdParamSchema("senderIdentityId")),
    v("json", updateSenderIdentityInputSchema),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        senderIdentityId: string;
      };
      return respond(
        c,
        senderIdentities.updateSenderIdentity({
          context: requestContext(c),
          ...params,
          input: c.req.valid("json"),
        }),
      );
    },
  )
  .delete(
    "/mailboxes/:mailboxId/sender-identities/:senderIdentityId",
    v("param", mailboxAndIdParamSchema("senderIdentityId")),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        senderIdentityId: string;
      };
      return respond(
        c,
        senderIdentities.disableSenderIdentity({
          context: requestContext(c),
          ...params,
        }),
      );
    },
  )
  .post(
    "/mailboxes/:mailboxId/sender-identities/:senderIdentityId/verify",
    v("param", mailboxAndIdParamSchema("senderIdentityId")),
    v("json", verifyIdentitySchema),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        senderIdentityId: string;
      };
      return respond(
        c,
        senderIdentities.verifySenderIdentity({
          context: requestContext(c),
          ...params,
          ...c.req.valid("json"),
        }),
      );
    },
  )
  .get("/mailboxes/:mailboxId/drafts", v("param", uuidParamSchema), v("query", limitQuerySchema), async (c) =>
    respond(c, drafts.listDrafts(requestContext(c), c.req.valid("param").mailboxId, c.req.valid("query").limit)),
  )
  .get("/mailboxes/:mailboxId/drafts/:draftId", v("param", mailboxAndIdParamSchema("draftId")), async (c) => {
    const params = c.req.valid("param") as {
      mailboxId: string;
      draftId: string;
    };
    return respond(c, drafts.getDraft(requestContext(c), params.mailboxId, params.draftId));
  })
  .post("/mailboxes/:mailboxId/draft-seeds", v("param", uuidParamSchema), v("json", prepareDraftSeedInputSchema), async (c) =>
    respond(
      c,
      drafts.prepareDraftSeed({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        origin: c.req.valid("json").origin,
      }),
    ),
  )
  .post(
    "/mailboxes/:mailboxId/draft-seeds/materialize",
    v("param", uuidParamSchema),
    v("json", materializeDraftSeedInputSchema),
    async (c) =>
      respond(
        c,
        drafts.materializeDraftSeed({
          context: requestContext(c),
          mailboxId: c.req.valid("param").mailboxId,
          input: c.req.valid("json"),
        }),
      ),
  )
  .post("/mailboxes/:mailboxId/drafts", v("param", uuidParamSchema), v("json", draftContentInputSchema), async (c) =>
    respond(
      c,
      drafts.createDraft({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        input: c.req.valid("json"),
      }),
    ),
  )
  .put("/mailboxes/:mailboxId/drafts/:draftId", v("param", mailboxAndIdParamSchema("draftId")), v("json", updateDraftSchema), async (c) => {
    const params = c.req.valid("param") as {
      mailboxId: string;
      draftId: string;
    };
    const input = c.req.valid("json");
    return respond(
      c,
      drafts.updateDraft({
        context: requestContext(c),
        ...params,
        expectedRevision: input.expectedRevision,
        input: input.draft,
      }),
    );
  })
  .post(
    "/mailboxes/:mailboxId/drafts/:draftId/safety-review",
    v("param", mailboxAndIdParamSchema("draftId")),
    v("json", composeSafetyReviewInputSchema),
    async (c) => {
      const params = c.req.valid("param") as { mailboxId: string; draftId: string };
      return respond(
        c,
        composeSafety.reviewDraftComposeSafety({
          context: requestContext(c),
          ...params,
          expectedRevision: c.req.valid("json").expectedRevision,
        }),
      );
    },
  )
  .get("/mailboxes/:mailboxId/drafts/:draftId/recovery-copies", v("param", mailboxAndIdParamSchema("draftId")), async (c) =>
    respond(
      c,
      drafts.listDraftRecoveryCopies({
        context: requestContext(c),
        ...(c.req.valid("param") as { mailboxId: string; draftId: string }),
      }),
    ),
  )
  .post(
    "/mailboxes/:mailboxId/drafts/:draftId/recovery-copies/:recoveryCopyId/restore",
    v(
      "param",
      z.object({
        mailboxId: z.string().uuid(),
        draftId: z.string().uuid(),
        recoveryCopyId: z.string().uuid(),
      }),
    ),
    v("json", draftRecoveryRestoreSchema),
    async (c) =>
      respond(
        c,
        drafts.restoreDraftRecoveryCopy({
          context: requestContext(c),
          ...c.req.valid("param"),
          expectedRevision: c.req.valid("json").expectedRevision,
          leaseToken: c.req.valid("json").leaseToken,
        }),
      ),
  )
  .get("/mailboxes/:mailboxId/drafts/:draftId/lease", v("param", mailboxAndIdParamSchema("draftId")), async (c) =>
    respond(
      c,
      draftLeases.getDraftLease({
        context: requestContext(c),
        ...(c.req.valid("param") as { mailboxId: string; draftId: string }),
      }),
    ),
  )
  .post(
    "/mailboxes/:mailboxId/drafts/:draftId/lease",
    v("param", mailboxAndIdParamSchema("draftId")),
    v("json", acquireDraftLeaseSchema),
    async (c) =>
      respond(
        c,
        draftLeases.acquireDraftLease({
          context: requestContext(c),
          ...(c.req.valid("param") as { mailboxId: string; draftId: string }),
          takeover: c.req.valid("json").takeover,
        }),
      ),
  )
  .put(
    "/mailboxes/:mailboxId/drafts/:draftId/lease",
    v("param", mailboxAndIdParamSchema("draftId")),
    v("json", draftLeaseTokenSchema),
    async (c) =>
      respond(
        c,
        draftLeases.heartbeatDraftLease({
          context: requestContext(c),
          ...(c.req.valid("param") as { mailboxId: string; draftId: string }),
          token: c.req.valid("json").token,
        }),
      ),
  )
  .delete(
    "/mailboxes/:mailboxId/drafts/:draftId/lease",
    v("param", mailboxAndIdParamSchema("draftId")),
    v("json", draftLeaseTokenSchema),
    async (c) =>
      respond(
        c,
        draftLeases.releaseDraftLease({
          context: requestContext(c),
          ...(c.req.valid("param") as { mailboxId: string; draftId: string }),
          token: c.req.valid("json").token,
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/drafts/:draftId/discard",
    v("param", mailboxAndIdParamSchema("draftId")),
    v("json", draftRevisionSchema),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        draftId: string;
      };
      return respond(
        c,
        drafts.discardDraft({
          context: requestContext(c),
          ...params,
          expectedRevision: c.req.valid("json").expectedRevision,
        }),
      );
    },
  )
  .post(
    "/mailboxes/:mailboxId/drafts/:draftId/attachments",
    v("param", mailboxAndIdParamSchema("draftId")),
    v("query", attachmentUploadQuerySchema),
    async (c) => {
      const params = c.req.valid("param") as {
        mailboxId: string;
        draftId: string;
      };
      const query = c.req.valid("query");
      const contentLength = c.req.header("content-length");
      if (contentLength == null) return respond(c, fail(err.badInput("Attachment Content-Length is required")));
      const expectedSize = Number(contentLength);
      if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) {
        return respond(c, fail(err.badInput("Invalid attachment Content-Length")));
      }
      const body = c.req.raw.body;
      if (!body && expectedSize > 0) return respond(c, fail(err.badInput("Attachment body is required")));
      return respond(
        c,
        draftUploads.uploadDraftAttachmentStream({
          context: requestContext(c),
          ...params,
          expectedRevision: query.expectedRevision,
          filename: query.filename,
          contentType: c.req.header("content-type") || "application/octet-stream",
          byteLength: expectedSize,
          stream: body ? Readable.fromWeb(body as never) : Readable.from([]),
        }),
      );
    },
  )
  .get(
    "/mailboxes/:mailboxId/drafts/:draftId/attachments/:attachmentId",
    v(
      "param",
      z.object({
        mailboxId: z.string().uuid(),
        draftId: z.string().uuid(),
        attachmentId: z.string().uuid(),
      }),
    ),
    v("query", attachmentQuerySchema),
    async (c) => {
      const context = requestContext(c);
      const params = c.req.valid("param");
      return attachmentDownloadResponse(
        c,
        await drafts.openDraftAttachment({ context, ...params }),
        c.req.valid("query"),
        async (expectedBlobId) => {
          const current = await drafts.openDraftAttachment({
            context,
            ...params,
          });
          if (!current.ok || current.data.blobId !== expectedBlobId) {
            throw Object.assign(new Error("Draft attachment access was revoked during transfer"), { code: "ACCESS_REVOKED" });
          }
        },
      );
    },
  )
  .delete(
    "/mailboxes/:mailboxId/drafts/:draftId/attachments/:attachmentId",
    v(
      "param",
      z.object({
        mailboxId: z.string().uuid(),
        draftId: z.string().uuid(),
        attachmentId: z.string().uuid(),
      }),
    ),
    v("query", draftRevisionSchema),
    async (c) =>
      respond(
        c,
        drafts.removeDraftAttachment({
          context: requestContext(c),
          ...c.req.valid("param"),
          expectedRevision: c.req.valid("query").expectedRevision,
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/drafts/:draftId/attachments/:attachmentId/links",
    v(
      "param",
      z.object({
        mailboxId: z.string().uuid(),
        draftId: z.string().uuid(),
        attachmentId: z.string().uuid(),
      }),
    ),
    v("json", createAttachmentLinkInputSchema),
    async (c) => {
      const params = c.req.valid("param");
      return respond(
        c,
        attachmentLinks.createPublicAttachmentLink({
          context: requestContext(c),
          mailboxId: params.mailboxId,
          sourceKind: "draft",
          sourceId: params.draftId,
          attachmentId: params.attachmentId,
          input: c.req.valid("json"),
        }),
      );
    },
  )
  .get("/mailboxes/:mailboxId/drafts/:draftId/attachment-uploads", v("param", mailboxAndIdParamSchema("draftId")), async (c) =>
    respond(
      c,
      draftUploads.listDraftAttachmentUploads({
        context: requestContext(c),
        ...(c.req.valid("param") as { mailboxId: string; draftId: string }),
      }),
    ),
  )
  .post(
    "/mailboxes/:mailboxId/drafts/:draftId/attachment-uploads",
    v("param", mailboxAndIdParamSchema("draftId")),
    v("json", createDraftAttachmentUploadSchema),
    async (c) =>
      respond(
        c,
        draftUploads.createDraftAttachmentUpload({
          context: requestContext(c),
          ...(c.req.valid("param") as { mailboxId: string; draftId: string }),
          input: c.req.valid("json"),
        }),
      ),
  )
  .get(
    "/mailboxes/:mailboxId/drafts/:draftId/attachment-uploads/:uploadId",
    v(
      "param",
      z.object({
        mailboxId: z.string().uuid(),
        draftId: z.string().uuid(),
        uploadId: z.string().uuid(),
      }),
    ),
    async (c) =>
      respond(
        c,
        draftUploads.getDraftAttachmentUpload({
          context: requestContext(c),
          ...c.req.valid("param"),
        }),
      ),
  )
  .patch(
    "/mailboxes/:mailboxId/drafts/:draftId/attachment-uploads/:uploadId",
    v(
      "param",
      z.object({
        mailboxId: z.string().uuid(),
        draftId: z.string().uuid(),
        uploadId: z.string().uuid(),
      }),
    ),
    v("query", attachmentChunkQuerySchema),
    async (c) => {
      const body = await readBoundedBody(c.req.raw.body, draftUploads.DRAFT_UPLOAD_CHUNK_BYTES);
      if (!body.ok) return respond(c, body);
      return respond(
        c,
        draftUploads.appendDraftAttachmentUpload({
          context: requestContext(c),
          ...c.req.valid("param"),
          offset: c.req.valid("query").offset,
          bytes: body.data,
        }),
      );
    },
  )
  .post(
    "/mailboxes/:mailboxId/drafts/:draftId/attachment-uploads/:uploadId/finalize",
    v(
      "param",
      z.object({
        mailboxId: z.string().uuid(),
        draftId: z.string().uuid(),
        uploadId: z.string().uuid(),
      }),
    ),
    v("json", draftRevisionSchema),
    async (c) =>
      respond(
        c,
        draftUploads.finalizeDraftAttachmentUpload({
          context: requestContext(c),
          ...c.req.valid("param"),
          expectedRevision: c.req.valid("json").expectedRevision,
        }),
      ),
  )
  .delete(
    "/mailboxes/:mailboxId/drafts/:draftId/attachment-uploads/:uploadId",
    v(
      "param",
      z.object({
        mailboxId: z.string().uuid(),
        draftId: z.string().uuid(),
        uploadId: z.string().uuid(),
      }),
    ),
    async (c) =>
      respond(
        c,
        draftUploads.cancelDraftAttachmentUpload({
          context: requestContext(c),
          ...c.req.valid("param"),
        }),
      ),
  )
  .post("/mailboxes/:mailboxId/commands", v("param", uuidParamSchema), v("json", mailCommandInputSchema), async (c) =>
    respond(
      c,
      commands.createMailCommand({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        input: c.req.valid("json"),
      }),
    ),
  )
  .post("/mailboxes/:mailboxId/operator-actions", v("param", uuidParamSchema), v("json", maintenanceCommandInputSchema), async (c) =>
    respond(
      c,
      commands.createMaintenanceCommand({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        input: c.req.valid("json"),
      }),
    ),
  )
  .get("/mailboxes/:mailboxId/commands", v("param", uuidParamSchema), v("query", limitQuerySchema), async (c) =>
    respond(c, commands.listCommands(requestContext(c), c.req.valid("param").mailboxId, c.req.valid("query").limit)),
  )
  .get("/mailboxes/:mailboxId/commands/:commandId", v("param", mailboxAndIdParamSchema("commandId")), async (c) => {
    const params = c.req.valid("param") as {
      mailboxId: string;
      commandId: string;
    };
    return respond(c, commands.getCommand(requestContext(c), params.mailboxId, params.commandId));
  })
  .post("/mailboxes/:mailboxId/commands/:commandId/cancel", v("param", mailboxAndIdParamSchema("commandId")), async (c) => {
    const params = c.req.valid("param") as {
      mailboxId: string;
      commandId: string;
    };
    return respond(c, cancelSendCommand({ context: requestContext(c), ...params }));
  })
  .get("/mailboxes/:mailboxId/scheduled-sends", v("param", uuidParamSchema), v("query", cursorQuerySchema), async (c) =>
    respond(
      c,
      scheduledSends.listScheduledSends({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        ...c.req.valid("query"),
      }),
    ),
  )
  .post(
    "/mailboxes/:mailboxId/scheduled-sends/:scheduledSendId/cancel",
    v("param", mailboxAndIdParamSchema("scheduledSendId")),
    v("json", cancelScheduledSendInputSchema),
    async (c) =>
      respond(
        c,
        scheduledSends.cancelScheduledSend({
          context: requestContext(c),
          ...(c.req.valid("param") as {
            mailboxId: string;
            scheduledSendId: string;
          }),
          input: c.req.valid("json"),
        }),
      ),
  )
  .route("/", workflowRoutes);

const adminApi = new Hono<AuthContext>()
  .use("/admin/*", auth.requireRole("admin"))
  .get("/admin/operations", v("query", platformOperationsQuerySchema), async (c) =>
    respond(c, operations.getPlatformMailOperations(requestContext(c), c.req.valid("query"))),
  )
  .get("/admin/mailboxes/:mailboxId/operations", v("param", uuidParamSchema), async (c) =>
    respond(c, operations.getPlatformMailboxOperation(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .get("/admin/mailboxes/:mailboxId/access", v("param", uuidParamSchema), async (c) =>
    respond(c, mailboxAccess.listMailboxAccessAsPlatformAdmin(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .post("/admin/mailboxes/:mailboxId/access", v("param", uuidParamSchema), v("json", GrantAccessSchema), async (c) => {
    const input = c.req.valid("json");
    if (input.permission === "none") return respond(c, fail(err.badInput("Access permission cannot be none")));
    return respond(
      c,
      mailboxAccess.grantMailboxAccessAsPlatformAdmin({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        principal: input.principal,
        permission: input.permission,
      }),
    );
  })
  .patch(
    "/admin/mailboxes/:mailboxId/access/:accessId",
    v("param", mailboxAndIdParamSchema("accessId")),
    v("json", UpdateAccessSchema),
    async (c) => {
      const params = c.req.valid("param") as { mailboxId: string; accessId: string };
      const { permission } = c.req.valid("json");
      if (permission === "none") return respond(c, fail(err.badInput("Use DELETE to revoke access")));
      return respond(
        c,
        mailboxAccess.updateMailboxAccessAsPlatformAdmin({
          context: requestContext(c),
          ...params,
          permission,
        }),
      );
    },
  )
  .delete("/admin/mailboxes/:mailboxId/access/:accessId", v("param", mailboxAndIdParamSchema("accessId")), async (c) => {
    const params = c.req.valid("param") as { mailboxId: string; accessId: string };
    return respond(
      c,
      mailboxAccess.revokeMailboxAccessAsPlatformAdmin({
        context: requestContext(c),
        ...params,
      }),
    );
  })
  .get("/admin/storage", async (c) => respond(c, storageObservability.getMailStorageSummary(requestContext(c))))
  .post("/admin/storage/reconcile", async (c) => respond(c, storageObservability.requestMailStorageReconciliation(requestContext(c))));

const authenticatedApi = new Hono<AuthContext>()
  .route("/", providerOAuthApi)
  .route("/", resourceRoutes)
  .route("/", adminApi)
  .route("/", mailOperationsApi);

const api = new Hono<AuthContext>()
  .use(rateLimit())
  .route("/ws", wsRoutes)
  .use(auth.requireRole("authenticated"))
  .route("/", authenticatedApi);

export default api;
export type ApiType = typeof api;

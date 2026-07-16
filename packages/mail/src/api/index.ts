import { Readable } from "node:stream";
import { GrantAccessSchema, UpdateAccessSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, rateLimit, respond, v } from "@valentinkolb/cloud/server";
import { err, fail, type Result } from "@valentinkolb/stdlib";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  cancelConversationReminderSchema,
  configurableFolderRoleSchema,
  connectionOwnerSchema,
  conversationPresenceHeartbeatSchema,
  conversationPresenceLeaveSchema,
  conversationTriageInputSchema,
  conversationViewSchema,
  createConversationCommentSchema,
  createDraftAttachmentUploadSchema,
  createMailboxInputSchema,
  createSavedConversationViewSchema,
  createSenderIdentityInputSchema,
  defaultSenderSetupInputSchema,
  deleteConversationCommentSchema,
  deleteSavedConversationViewSchema,
  draftContentInputSchema,
  draftEditableContentInputSchema,
  draftLeaseTokenSchema,
  mailCommandInputSchema,
  mergeConversationsInputSchema,
  providerConnectionInputSchema,
  searchBackendSchema,
  searchRequestSchema,
  setConversationReminderSchema,
  splitConversationInputSchema,
  updateConversationCollaborationSchema,
  updateConversationCommentSchema,
  updateSavedConversationViewSchema,
  updateSenderIdentityInputSchema,
} from "../contracts";
import {
  bindings,
  cancelSendCommand,
  collaboration,
  commands,
  conversations,
  draftLeases,
  drafts,
  draftUploads,
  events,
  folders,
  health,
  type MailRequestContext,
  mailboxAccess,
  mailboxes,
  messages,
  notificationTargets,
  presence,
  providerConnections,
  reminders,
  savedViews,
  search,
  senderIdentities,
  settingsContext,
  triage,
} from "../service";
import { resolveByteRange } from "../service/byte-range";
import type { AttachmentDownload } from "../service/messages";
import { loadMailboxPageData } from "../service/workspace";
import workflowRoutes from "./workflows";

const uuidParamSchema = z.object({ mailboxId: z.string().uuid() });
const mailboxAndIdParamSchema = (name: string) => z.object({ mailboxId: z.string().uuid(), [name]: z.string().uuid() });
const limitQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) });
const cursorQuerySchema = z.object({
  cursor: z.string().max(2_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const conversationQuerySchema = cursorQuerySchema.extend({
  folderId: z.string().uuid().optional(),
  status: z.enum(["open", "waiting", "done"]).optional(),
  view: conversationViewSchema.optional(),
});
const collaboratorQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const activityQuerySchema = cursorQuerySchema.extend({ conversationId: z.string().uuid().optional() });
const eventQuerySchema = z.object({ after: z.string().max(200).optional() });
const workspaceRouteQuerySchema = z.object({ href: z.string().trim().min(1).max(4_000) });
const attachmentQuerySchema = z.object({
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
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");
const attachBindingSchema = z.object({ connectionId: z.string().uuid(), rootPath: z.string().max(4_000).nullable().optional() });
const verifyIdentitySchema = z.object({
  bindingId: z.string().uuid(),
  verificationRecipient: z.string().email().max(320),
  savesSentAutomatically: z.boolean(),
});
const updateDraftSchema = z.object({ expectedRevision: z.number().int().positive(), draft: draftEditableContentInputSchema });
const connectionListQuerySchema = z.object({ mailboxId: z.string().uuid().optional() });
const roleParamSchema = z.object({ mailboxId: z.string().uuid(), role: configurableFolderRoleSchema });
const folderRoleInputSchema = z.object({ folderId: z.string().uuid() });
const draftRevisionSchema = z.object({ expectedRevision: z.coerce.number().int().positive() });
const attachmentUploadQuerySchema = draftRevisionSchema.extend({ filename: z.string().trim().min(1).max(255) });
const attachmentChunkQuerySchema = z.object({ offset: z.coerce.number().int().nonnegative() });
const acquireDraftLeaseSchema = z.object({ takeover: z.boolean().default(false) }).strict();
const notificationTargetParamSchema = z.object({
  mailboxId: z.string().uuid(),
  kind: z.enum(["mention", "reminder"]),
  sourceId: z.string().uuid(),
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

const attachmentContentDisposition = (value: string | null): string => {
  const filename = [...(value?.normalize("NFC") || "attachment")].slice(0, 255).join("");
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, "_") || "attachment";
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};

const safeAttachmentContentType = (value: string): string =>
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value) ? value : "application/octet-stream";

const requestContext = (c: Context<AuthContext>): MailRequestContext => ({
  actor: c.get("actor"),
  accessSubject: c.get("accessSubject"),
  requestId: c.req.header("x-request-id") ?? null,
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
) => {
  if (!result.ok) return respond(c, result);
  const rangeHeader = c.req.header("range");
  const hasQueryRange = query.offset !== undefined || query.length !== undefined;
  if (rangeHeader && hasQueryRange)
    return respond(c, fail(err.badInput("Use either the Range header or offset and length query parameters")));
  const { blobId, total, chunkSize, chunkCount, contentHash, contentType, filename } = result.data;
  const requestedRange =
    rangeHeader ?? (hasQueryRange ? `bytes=${query.offset ?? 0}-${(query.offset ?? 0) + (query.length ?? 1024 * 1024) - 1}` : null);
  const range = resolveByteRange(requestedRange, total);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${total}`, "Cache-Control": "private, no-store" },
    });
  }
  const selectedRange = range ?? { start: 0, endExclusive: total };
  const partial = range !== null;
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Length": String(selectedRange.endExclusive - selectedRange.start),
    "Content-Type": safeAttachmentContentType(contentType),
    "Content-Disposition": attachmentContentDisposition(filename),
    ETag: `"${contentHash}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (partial) headers.set("Content-Range", `bytes ${selectedRange.start}-${selectedRange.endExclusive - 1}/${total}`);
  return new Response(
    messages.createAttachmentStream({
      blobId,
      chunkSize,
      chunkCount,
      start: selectedRange.start,
      endExclusive: selectedRange.endExclusive,
    }),
    { status: partial ? 206 : 200, headers },
  );
};

const api = new Hono<AuthContext>()
  .use(rateLimit())
  .use(auth.requireRole("authenticated"))
  .get("/mailboxes", v("query", limitQuerySchema), async (c) =>
    respond(c, mailboxes.listMailboxes(requestContext(c), c.req.valid("query").limit)),
  )
  .post("/mailboxes", v("json", createMailboxInputSchema), async (c) =>
    respond(c, mailboxes.createMailbox(requestContext(c), c.req.valid("json"))),
  )
  .get("/mailboxes/:mailboxId", v("param", uuidParamSchema), async (c) =>
    respond(c, mailboxes.getMailbox(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .get("/mailboxes/:mailboxId/workspace-route", v("param", uuidParamSchema), v("query", workspaceRouteQuerySchema), async (c) => {
    const mailboxId = c.req.valid("param").mailboxId;
    const requestUrl = parseWorkspaceRouteUrl(mailboxId, c.req.valid("query").href);
    if (!requestUrl) return respond(c, fail(err.badInput("Workspace route must target this mailbox")));
    const data = await loadMailboxPageData({ context: requestContext(c), mailboxId, requestUrl });
    return respond(c, data ? { ok: true, data } : fail(err.notFound("Mailbox")));
  })
  .get("/mailboxes/:mailboxId/settings-context", v("param", uuidParamSchema), async (c) =>
    respond(c, settingsContext.loadMailboxSettingsContext(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .get("/mailboxes/:mailboxId/health", v("param", uuidParamSchema), async (c) =>
    respond(c, health.getMailboxOperationalHealth(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .patch("/mailboxes/:mailboxId", v("param", uuidParamSchema), v("json", updateMailboxSchema), async (c) =>
    respond(c, mailboxes.updateMailbox({ context: requestContext(c), mailboxId: c.req.valid("param").mailboxId, ...c.req.valid("json") })),
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
      const params = c.req.valid("param") as { mailboxId: string; accessId: string };
      const { permission } = c.req.valid("json");
      if (permission === "none") return respond(c, fail(err.badInput("Use DELETE to revoke access")));
      return respond(c, mailboxAccess.updateMailboxAccess({ context: requestContext(c), ...params, permission }));
    },
  )
  .delete("/mailboxes/:mailboxId/access/:accessId", v("param", mailboxAndIdParamSchema("accessId")), async (c) => {
    const params = c.req.valid("param") as { mailboxId: string; accessId: string };
    return respond(c, mailboxAccess.revokeMailboxAccess({ context: requestContext(c), ...params }));
  })
  .get("/connections", v("query", connectionListQuerySchema), async (c) =>
    respond(c, providerConnections.listProviderConnections(requestContext(c), c.req.valid("query").mailboxId)),
  )
  .post("/connections", v("json", z.object({ owner: connectionOwnerSchema, connection: providerConnectionInputSchema })), async (c) => {
    const input = c.req.valid("json");
    return respond(
      c,
      providerConnections.createProviderConnection({ context: requestContext(c), owner: input.owner, input: input.connection }),
    );
  })
  .put(
    "/connections/:connectionId",
    v("param", z.object({ connectionId: z.string().uuid() })),
    v("json", providerConnectionInputSchema),
    async (c) =>
      respond(
        c,
        providerConnections.replaceProviderConnection({
          context: requestContext(c),
          connectionId: c.req.valid("param").connectionId,
          input: c.req.valid("json"),
        }),
      ),
  )
  .delete("/connections/:connectionId", v("param", z.object({ connectionId: z.string().uuid() })), async (c) =>
    respond(c, providerConnections.revokeProviderConnection(requestContext(c), c.req.valid("param").connectionId)),
  )
  .get("/mailboxes/:mailboxId/bindings", v("param", uuidParamSchema), async (c) =>
    respond(c, bindings.listProviderBindings(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .post("/mailboxes/:mailboxId/bindings", v("param", uuidParamSchema), v("json", attachBindingSchema), async (c) =>
    respond(
      c,
      bindings.attachProviderBinding({ context: requestContext(c), mailboxId: c.req.valid("param").mailboxId, ...c.req.valid("json") }),
    ),
  )
  .post("/mailboxes/:mailboxId/bindings/:bindingId/confirm", v("param", mailboxAndIdParamSchema("bindingId")), async (c) => {
    const params = c.req.valid("param") as { mailboxId: string; bindingId: string };
    return respond(c, bindings.confirmProviderBinding({ context: requestContext(c), ...params }));
  })
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
  .get("/mailboxes/:mailboxId/mentionable-users", v("param", uuidParamSchema), v("query", collaboratorQuerySchema), async (c) =>
    respond(
      c,
      collaboration.listMentionableUsers({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        ...c.req.valid("query"),
      }),
    ),
  )
  .get("/mailboxes/:mailboxId/conversation-view-counts", v("param", uuidParamSchema), async (c) =>
    respond(c, messages.getConversationViewCounts({ context: requestContext(c), mailboxId: c.req.valid("param").mailboxId })),
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
  .get("/mailboxes/:mailboxId/events", v("param", uuidParamSchema), v("query", eventQuerySchema), async (c) => {
    const mailboxId = c.req.valid("param").mailboxId;
    const context = requestContext(c);
    const allowed = await collaboration.requireMailboxCollaborationPermission(context, mailboxId, "read");
    if (!allowed.ok) return respond(c, allowed);

    const encoder = new TextEncoder();
    const streamAbort = new AbortController();
    let keepalive: ReturnType<typeof setInterval> | undefined;
    let closed = false;
    let checkingAccess = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown, id?: string) => {
          if (closed) return;
          controller.enqueue(encoder.encode(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        const close = () => {
          if (closed) return;
          closed = true;
          streamAbort.abort();
          if (keepalive) clearInterval(keepalive);
          try {
            controller.close();
          } catch {
            // Client disconnects race with server-side access revocation.
          }
        };
        try {
          const requestedCursor = c.req.valid("query").after ?? c.req.header("last-event-id") ?? null;
          const startCursor = requestedCursor ?? (await events.latestMailCollaborationEventCursor(mailboxId)) ?? "0-0";
          send("ready", { mailboxId, cursor: startCursor }, startCursor);
          keepalive = setInterval(() => {
            if (checkingAccess || closed) return;
            checkingAccess = true;
            void collaboration
              .requireMailboxCollaborationPermission(context, mailboxId, "read")
              .then((permission) => {
                if (!permission.ok) close();
                else send("ping", { at: new Date().toISOString() });
              })
              .catch(() => close())
              .finally(() => {
                checkingAccess = false;
              });
          }, 8_000);
          for await (const event of events.liveMailCollaborationEvents({ mailboxId, after: startCursor, signal: streamAbort.signal })) {
            if (closed || streamAbort.signal.aborted) break;
            const currentPermission = await collaboration.requireMailboxCollaborationPermission(context, mailboxId, "read");
            if (!currentPermission.ok) break;
            send(event.data.type, event.data, event.cursor);
          }
        } catch {
          if (!closed && !streamAbort.signal.aborted) {
            send("error", { message: "Mail event stream failed" });
          }
        } finally {
          close();
        }
      },
      cancel() {
        closed = true;
        streamAbort.abort();
        if (keepalive) clearInterval(keepalive);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  })
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
    respond(c, savedViews.listSavedConversationViews({ context: requestContext(c), mailboxId: c.req.valid("param").mailboxId })),
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
      const params = c.req.valid("param") as { mailboxId: string; conversationId: string };
      return respond(c, messages.listConversationMessages({ context: requestContext(c), ...params, ...c.req.valid("query") }));
    },
  )
  .post(
    "/mailboxes/:mailboxId/conversations/:conversationId/merge",
    v("param", mailboxAndIdParamSchema("conversationId")),
    v("json", mergeConversationsInputSchema),
    async (c) => {
      const params = c.req.valid("param") as { mailboxId: string; conversationId: string };
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
      const params = c.req.valid("param") as { mailboxId: string; conversationId: string };
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
  .get(
    "/mailboxes/:mailboxId/conversations/:conversationId/collaboration",
    v("param", mailboxAndIdParamSchema("conversationId")),
    async (c) => {
      const params = c.req.valid("param") as { mailboxId: string; conversationId: string };
      return respond(c, collaboration.getConversationCollaboration({ context: requestContext(c), ...params }));
    },
  )
  .patch(
    "/mailboxes/:mailboxId/conversations/:conversationId/collaboration",
    v("param", mailboxAndIdParamSchema("conversationId")),
    v("json", updateConversationCollaborationSchema),
    async (c) => {
      const params = c.req.valid("param") as { mailboxId: string; conversationId: string };
      return respond(
        c,
        collaboration.updateConversationCollaboration({ context: requestContext(c), ...params, input: c.req.valid("json") }),
      );
    },
  )
  .put(
    "/mailboxes/:mailboxId/conversations/:conversationId/watchers/:userId",
    v("param", z.object({ mailboxId: z.string().uuid(), conversationId: z.string().uuid(), userId: z.string().uuid() })),
    async (c) => respond(c, collaboration.setConversationWatcher({ context: requestContext(c), ...c.req.valid("param"), watching: true })),
  )
  .delete(
    "/mailboxes/:mailboxId/conversations/:conversationId/watchers/:userId",
    v("param", z.object({ mailboxId: z.string().uuid(), conversationId: z.string().uuid(), userId: z.string().uuid() })),
    async (c) => respond(c, collaboration.setConversationWatcher({ context: requestContext(c), ...c.req.valid("param"), watching: false })),
  )
  .get("/mailboxes/:mailboxId/conversations/:conversationId/reminder", v("param", mailboxAndIdParamSchema("conversationId")), async (c) =>
    respond(
      c,
      reminders.getConversationReminder({
        context: requestContext(c),
        ...(c.req.valid("param") as { mailboxId: string; conversationId: string }),
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
          ...(c.req.valid("param") as { mailboxId: string; conversationId: string }),
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
          ...(c.req.valid("param") as { mailboxId: string; conversationId: string }),
          input: c.req.valid("json"),
        }),
      ),
  )
  .get("/mailboxes/:mailboxId/conversations/:conversationId/presence", v("param", mailboxAndIdParamSchema("conversationId")), async (c) =>
    respond(
      c,
      presence.getConversationPresence({
        context: requestContext(c),
        ...(c.req.valid("param") as { mailboxId: string; conversationId: string }),
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
          ...(c.req.valid("param") as { mailboxId: string; conversationId: string }),
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
          ...(c.req.valid("param") as { mailboxId: string; conversationId: string }),
          peerId: c.req.valid("json").peerId,
        }),
      ),
  )
  .get(
    "/mailboxes/:mailboxId/conversations/:conversationId/comments",
    v("param", mailboxAndIdParamSchema("conversationId")),
    v("query", cursorQuerySchema),
    async (c) => {
      const params = c.req.valid("param") as { mailboxId: string; conversationId: string };
      return respond(c, collaboration.listConversationComments({ context: requestContext(c), ...params, ...c.req.valid("query") }));
    },
  )
  .post(
    "/mailboxes/:mailboxId/conversations/:conversationId/comments",
    v("param", mailboxAndIdParamSchema("conversationId")),
    v("json", createConversationCommentSchema),
    async (c) => {
      const params = c.req.valid("param") as { mailboxId: string; conversationId: string };
      return respond(c, collaboration.createConversationComment({ context: requestContext(c), ...params, input: c.req.valid("json") }));
    },
  )
  .patch(
    "/mailboxes/:mailboxId/conversations/:conversationId/comments/:commentId",
    v("param", z.object({ mailboxId: z.string().uuid(), conversationId: z.string().uuid(), commentId: z.string().uuid() })),
    v("json", updateConversationCommentSchema),
    async (c) =>
      respond(
        c,
        collaboration.updateConversationComment({ context: requestContext(c), ...c.req.valid("param"), input: c.req.valid("json") }),
      ),
  )
  .delete(
    "/mailboxes/:mailboxId/conversations/:conversationId/comments/:commentId",
    v("param", z.object({ mailboxId: z.string().uuid(), conversationId: z.string().uuid(), commentId: z.string().uuid() })),
    v("json", deleteConversationCommentSchema),
    async (c) =>
      respond(
        c,
        collaboration.deleteConversationComment({ context: requestContext(c), ...c.req.valid("param"), input: c.req.valid("json") }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/conversations/:conversationId/actions",
    v("param", mailboxAndIdParamSchema("conversationId")),
    v("json", conversationTriageInputSchema),
    async (c) => {
      const params = c.req.valid("param") as { mailboxId: string; conversationId: string };
      return respond(c, triage.createConversationTriageCommands({ context: requestContext(c), ...params, input: c.req.valid("json") }));
    },
  )
  .get("/mailboxes/:mailboxId/messages/:messageId", v("param", mailboxAndIdParamSchema("messageId")), async (c) => {
    const params = c.req.valid("param") as { mailboxId: string; messageId: string };
    return respond(c, messages.getMessage({ context: requestContext(c), ...params }));
  })
  .get(
    "/mailboxes/:mailboxId/messages/:messageId/attachments/:attachmentId",
    v("param", z.object({ mailboxId: z.string().uuid(), messageId: z.string().uuid(), attachmentId: z.string().uuid() })),
    v("query", attachmentQuerySchema),
    async (c) =>
      attachmentDownloadResponse(
        c,
        await messages.openAttachment({ context: requestContext(c), ...c.req.valid("param") }),
        c.req.valid("query"),
      ),
  )
  .post("/mailboxes/:mailboxId/search", v("param", uuidParamSchema), v("json", searchRequestSchema), async (c) =>
    respond(
      c,
      search.searchMessages({ context: requestContext(c), mailboxId: c.req.valid("param").mailboxId, request: c.req.valid("json") }),
    ),
  )
  .get("/mailboxes/:mailboxId/sender-identities", v("param", uuidParamSchema), async (c) =>
    respond(c, senderIdentities.listSenderIdentities(requestContext(c), c.req.valid("param").mailboxId)),
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
      const params = c.req.valid("param") as { mailboxId: string; senderIdentityId: string };
      return respond(c, senderIdentities.updateSenderIdentity({ context: requestContext(c), ...params, input: c.req.valid("json") }));
    },
  )
  .delete(
    "/mailboxes/:mailboxId/sender-identities/:senderIdentityId",
    v("param", mailboxAndIdParamSchema("senderIdentityId")),
    async (c) => {
      const params = c.req.valid("param") as { mailboxId: string; senderIdentityId: string };
      return respond(c, senderIdentities.disableSenderIdentity({ context: requestContext(c), ...params }));
    },
  )
  .post(
    "/mailboxes/:mailboxId/sender-identities/:senderIdentityId/verify",
    v("param", mailboxAndIdParamSchema("senderIdentityId")),
    v("json", verifyIdentitySchema),
    async (c) => {
      const params = c.req.valid("param") as { mailboxId: string; senderIdentityId: string };
      return respond(c, senderIdentities.verifySenderIdentity({ context: requestContext(c), ...params, ...c.req.valid("json") }));
    },
  )
  .get("/mailboxes/:mailboxId/drafts", v("param", uuidParamSchema), v("query", limitQuerySchema), async (c) =>
    respond(c, drafts.listDrafts(requestContext(c), c.req.valid("param").mailboxId, c.req.valid("query").limit)),
  )
  .get("/mailboxes/:mailboxId/drafts/:draftId", v("param", mailboxAndIdParamSchema("draftId")), async (c) => {
    const params = c.req.valid("param") as { mailboxId: string; draftId: string };
    return respond(c, drafts.getDraft(requestContext(c), params.mailboxId, params.draftId));
  })
  .post("/mailboxes/:mailboxId/drafts", v("param", uuidParamSchema), v("json", draftContentInputSchema), async (c) =>
    respond(c, drafts.createDraft({ context: requestContext(c), mailboxId: c.req.valid("param").mailboxId, input: c.req.valid("json") })),
  )
  .put("/mailboxes/:mailboxId/drafts/:draftId", v("param", mailboxAndIdParamSchema("draftId")), v("json", updateDraftSchema), async (c) => {
    const params = c.req.valid("param") as { mailboxId: string; draftId: string };
    const input = c.req.valid("json");
    return respond(
      c,
      drafts.updateDraft({ context: requestContext(c), ...params, expectedRevision: input.expectedRevision, input: input.draft }),
    );
  })
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
    v("param", z.object({ mailboxId: z.string().uuid(), draftId: z.string().uuid(), recoveryCopyId: z.string().uuid() })),
    v("json", draftRevisionSchema),
    async (c) =>
      respond(
        c,
        drafts.restoreDraftRecoveryCopy({
          context: requestContext(c),
          ...c.req.valid("param"),
          expectedRevision: c.req.valid("json").expectedRevision,
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
      const params = c.req.valid("param") as { mailboxId: string; draftId: string };
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
      const params = c.req.valid("param") as { mailboxId: string; draftId: string };
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
    v("param", z.object({ mailboxId: z.string().uuid(), draftId: z.string().uuid(), attachmentId: z.string().uuid() })),
    v("query", attachmentQuerySchema),
    async (c) =>
      attachmentDownloadResponse(
        c,
        await drafts.openDraftAttachment({ context: requestContext(c), ...c.req.valid("param") }),
        c.req.valid("query"),
      ),
  )
  .delete(
    "/mailboxes/:mailboxId/drafts/:draftId/attachments/:attachmentId",
    v("param", z.object({ mailboxId: z.string().uuid(), draftId: z.string().uuid(), attachmentId: z.string().uuid() })),
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
    v("param", z.object({ mailboxId: z.string().uuid(), draftId: z.string().uuid(), uploadId: z.string().uuid() })),
    async (c) => respond(c, draftUploads.getDraftAttachmentUpload({ context: requestContext(c), ...c.req.valid("param") })),
  )
  .patch(
    "/mailboxes/:mailboxId/drafts/:draftId/attachment-uploads/:uploadId",
    v("param", z.object({ mailboxId: z.string().uuid(), draftId: z.string().uuid(), uploadId: z.string().uuid() })),
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
    v("param", z.object({ mailboxId: z.string().uuid(), draftId: z.string().uuid(), uploadId: z.string().uuid() })),
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
    v("param", z.object({ mailboxId: z.string().uuid(), draftId: z.string().uuid(), uploadId: z.string().uuid() })),
    async (c) => respond(c, draftUploads.cancelDraftAttachmentUpload({ context: requestContext(c), ...c.req.valid("param") })),
  )
  .post("/mailboxes/:mailboxId/commands", v("param", uuidParamSchema), v("json", mailCommandInputSchema), async (c) =>
    respond(
      c,
      commands.createMailCommand({ context: requestContext(c), mailboxId: c.req.valid("param").mailboxId, input: c.req.valid("json") }),
    ),
  )
  .get("/mailboxes/:mailboxId/commands", v("param", uuidParamSchema), v("query", limitQuerySchema), async (c) =>
    respond(c, commands.listCommands(requestContext(c), c.req.valid("param").mailboxId, c.req.valid("query").limit)),
  )
  .get("/mailboxes/:mailboxId/commands/:commandId", v("param", mailboxAndIdParamSchema("commandId")), async (c) => {
    const params = c.req.valid("param") as { mailboxId: string; commandId: string };
    return respond(c, commands.getCommand(requestContext(c), params.mailboxId, params.commandId));
  })
  .post("/mailboxes/:mailboxId/commands/:commandId/cancel", v("param", mailboxAndIdParamSchema("commandId")), async (c) => {
    const params = c.req.valid("param") as { mailboxId: string; commandId: string };
    return respond(c, cancelSendCommand({ context: requestContext(c), ...params }));
  })
  .route("/", workflowRoutes);

export default api;
export type ApiType = typeof api;

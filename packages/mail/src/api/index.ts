import { GrantAccessSchema, UpdateAccessSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, rateLimit, respond, v } from "@valentinkolb/cloud/server";
import { err, fail } from "@valentinkolb/stdlib";
import { type Context, Hono } from "hono";
import { Readable } from "node:stream";
import { z } from "zod";
import {
  connectionOwnerSchema,
  configurableFolderRoleSchema,
  conversationViewSchema,
  conversationTriageInputSchema,
  createConversationCommentSchema,
  createMailboxInputSchema,
  createSenderIdentityInputSchema,
  defaultSenderSetupInputSchema,
  deleteConversationCommentSchema,
  draftContentInputSchema,
  mailCommandInputSchema,
  providerConnectionInputSchema,
  searchBackendSchema,
  searchRequestSchema,
  updateConversationCollaborationSchema,
  updateConversationCommentSchema,
  updateSenderIdentityInputSchema,
} from "../contracts";
import {
  bindings,
  cancelSendCommand,
  commands,
  collaboration,
  drafts,
  events,
  folders,
  health,
  type MailRequestContext,
  mailboxAccess,
  mailboxes,
  messages,
  providerConnections,
  search,
  senderIdentities,
  triage,
} from "../service";
import { resolveByteRange } from "../service/byte-range";

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
const updateDraftSchema = z.object({ expectedRevision: z.number().int().positive(), draft: draftContentInputSchema });
const connectionListQuerySchema = z.object({ mailboxId: z.string().uuid().optional() });
const roleParamSchema = z.object({ mailboxId: z.string().uuid(), role: configurableFolderRoleSchema });
const folderRoleInputSchema = z.object({ folderId: z.string().uuid() });
const draftRevisionSchema = z.object({ expectedRevision: z.coerce.number().int().positive() });
const attachmentUploadQuerySchema = draftRevisionSchema.extend({ filename: z.string().trim().min(1).max(255) });

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
    const allowed = await mailboxAccess.requireMailboxPermission(context, mailboxId, "read");
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
            void mailboxAccess
              .requireMailboxPermission(context, mailboxId, "read")
              .then((permission) => {
                if (!permission.ok) close();
                else send("ping", { at: new Date().toISOString() });
              })
              .catch(() => close())
              .finally(() => {
                checkingAccess = false;
              });
          }, 25_000);
          for await (const event of events.liveMailCollaborationEvents({ mailboxId, after: startCursor, signal: streamAbort.signal })) {
            if (closed || streamAbort.signal.aborted) break;
            const currentPermission = await mailboxAccess.requireMailboxPermission(context, mailboxId, "read");
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
  .put(
    "/mailboxes/:mailboxId/folder-roles/:role",
    v("param", roleParamSchema),
    v("json", folderRoleInputSchema),
    async (c) =>
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
  .get(
    "/mailboxes/:mailboxId/conversations/:conversationId/messages",
    v("param", mailboxAndIdParamSchema("conversationId")),
    v("query", cursorQuerySchema),
    async (c) => {
      const params = c.req.valid("param") as { mailboxId: string; conversationId: string };
      return respond(c, messages.listConversationMessages({ context: requestContext(c), ...params, ...c.req.valid("query") }));
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
    async (c) =>
      respond(
        c,
        collaboration.setConversationWatcher({ context: requestContext(c), ...c.req.valid("param"), watching: true }),
      ),
  )
  .delete(
    "/mailboxes/:mailboxId/conversations/:conversationId/watchers/:userId",
    v("param", z.object({ mailboxId: z.string().uuid(), conversationId: z.string().uuid(), userId: z.string().uuid() })),
    async (c) =>
      respond(
        c,
        collaboration.setConversationWatcher({ context: requestContext(c), ...c.req.valid("param"), watching: false }),
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
    async (c) => {
      const query = c.req.valid("query");
      const rangeHeader = c.req.header("range");
      const hasQueryRange = query.offset !== undefined || query.length !== undefined;
      if (rangeHeader && hasQueryRange) {
        return respond(c, fail(err.badInput("Use either the Range header or offset and length query parameters")));
      }

      const result = await messages.openAttachment({ context: requestContext(c), ...c.req.valid("param") });
      if (!result.ok) return respond(c, result);
      const { blobId, total, chunkSize, chunkCount, contentHash, contentType, filename } = result.data;
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
      const contentLength = selectedRange.endExclusive - selectedRange.start;
      const headers = new Headers({
        "Accept-Ranges": "bytes",
        "Content-Length": String(contentLength),
        "Content-Type": safeAttachmentContentType(contentType),
        "Content-Disposition": attachmentContentDisposition(filename),
        ETag: `"${contentHash}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      if (partial) {
        headers.set("Content-Range", `bytes ${selectedRange.start}-${selectedRange.endExclusive - 1}/${total}`);
      }
      const body = messages.createAttachmentStream({
        blobId,
        chunkSize,
        chunkCount,
        start: selectedRange.start,
        endExclusive: selectedRange.endExclusive,
      });
      return new Response(body, {
        status: partial ? 206 : 200,
        headers,
      });
    },
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
      const body = c.req.raw.body;
      if (!body) return respond(c, fail(err.badInput("Attachment body is required")));
      const contentLength = c.req.header("content-length");
      const expectedSize = contentLength == null ? null : Number(contentLength);
      if (expectedSize != null && (!Number.isSafeInteger(expectedSize) || expectedSize < 0)) {
        return respond(c, fail(err.badInput("Invalid attachment Content-Length")));
      }
      return respond(
        c,
        drafts.addDraftAttachment({
          context: requestContext(c),
          ...params,
          expectedRevision: query.expectedRevision,
          filename: query.filename,
          contentType: c.req.header("content-type") || "application/octet-stream",
          stream: Readable.fromWeb(body as never),
          expectedSize,
        }),
      );
    },
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
  });

export default api;
export type ApiType = typeof api;

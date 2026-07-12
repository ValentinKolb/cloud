import { GrantAccessSchema, UpdateAccessSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, rateLimit, respond, v } from "@valentinkolb/cloud/server";
import { err, fail } from "@valentinkolb/stdlib";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  connectionOwnerSchema,
  createMailboxInputSchema,
  createSenderIdentityInputSchema,
  draftContentInputSchema,
  mailCommandInputSchema,
  providerConnectionInputSchema,
  searchBackendSchema,
  searchRequestSchema,
} from "../contracts";
import {
  bindings,
  cancelSendCommand,
  commands,
  drafts,
  health,
  type MailRequestContext,
  mailboxAccess,
  mailboxes,
  messages,
  providerConnections,
  search,
  senderIdentities,
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
});
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

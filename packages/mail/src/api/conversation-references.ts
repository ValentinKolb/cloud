import { type AuthContext, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  createConversationReferenceSchemeSchema,
  ensureConversationReferenceSchema,
  updateConversationReferenceSchemeSchema,
} from "../contracts";
import { conversationReferences, type MailRequestContext } from "../service";

const mailboxParamSchema = z.object({ mailboxId: z.string().uuid() });
const schemeParamSchema = z.object({ mailboxId: z.string().uuid(), schemeId: z.string().uuid() });
const conversationParamSchema = z.object({ mailboxId: z.string().uuid(), conversationId: z.string().uuid() });
const referenceLookupSchema = z.object({ value: z.string().trim().min(1).max(160) });
const requestContext = (c: Context<AuthContext>): MailRequestContext => ({
  actor: c.get("actor"),
  accessSubject: c.get("accessSubject"),
  requestId: c.req.header("x-request-id") ?? null,
});

export default new Hono<AuthContext>()
  .get("/mailboxes/:mailboxId/reference-schemes", v("param", mailboxParamSchema), async (c) =>
    respond(c, conversationReferences.listConversationReferenceSchemes(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .post(
    "/mailboxes/:mailboxId/reference-schemes",
    v("param", mailboxParamSchema),
    v("json", createConversationReferenceSchemeSchema),
    async (c) =>
      respond(
        c,
        conversationReferences.createConversationReferenceScheme({
          context: requestContext(c),
          mailboxId: c.req.valid("param").mailboxId,
          input: c.req.valid("json"),
        }),
      ),
  )
  .patch(
    "/mailboxes/:mailboxId/reference-schemes/:schemeId",
    v("param", schemeParamSchema),
    v("json", updateConversationReferenceSchemeSchema),
    async (c) =>
      respond(
        c,
        conversationReferences.updateConversationReferenceScheme({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  )
  .get(
    "/mailboxes/:mailboxId/conversations/by-reference",
    v("param", mailboxParamSchema),
    v("query", referenceLookupSchema),
    async (c) =>
      respond(
        c,
        conversationReferences.findConversationByReference({
          context: requestContext(c),
          mailboxId: c.req.valid("param").mailboxId,
          value: c.req.valid("query").value,
        }),
      ),
  )
  .get("/mailboxes/:mailboxId/conversations/:conversationId/references", v("param", conversationParamSchema), async (c) =>
    respond(c, conversationReferences.listConversationReferences({ context: requestContext(c), ...c.req.valid("param") })),
  )
  .post(
    "/mailboxes/:mailboxId/conversations/:conversationId/references",
    v("param", conversationParamSchema),
    v("json", ensureConversationReferenceSchema),
    async (c) =>
      respond(
        c,
        conversationReferences.ensureConversationReference({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  );

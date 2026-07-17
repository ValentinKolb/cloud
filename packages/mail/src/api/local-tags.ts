import { type AuthContext, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  createLocalTagSchema,
  deleteLocalTagSchema,
  setConversationLocalTagsSchema,
  updateLocalTagSchema,
} from "../contracts";
import { localTags, type MailRequestContext } from "../service";

const mailboxParamSchema = z.object({ mailboxId: z.string().uuid() });
const tagParamSchema = z.object({ mailboxId: z.string().uuid(), tagId: z.string().uuid() });
const conversationParamSchema = z.object({ mailboxId: z.string().uuid(), conversationId: z.string().uuid() });
const requestContext = (c: Context<AuthContext>): MailRequestContext => ({
  actor: c.get("actor"),
  accessSubject: c.get("accessSubject"),
  requestId: c.req.header("x-request-id") ?? null,
});

const localTagRoutes = new Hono<AuthContext>()
  .get("/mailboxes/:mailboxId/local-tags", v("param", mailboxParamSchema), async (c) =>
    respond(c, localTags.listLocalTags(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .post("/mailboxes/:mailboxId/local-tags", v("param", mailboxParamSchema), v("json", createLocalTagSchema), async (c) =>
    respond(
      c,
      localTags.createLocalTag({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        input: c.req.valid("json"),
      }),
    ),
  )
  .patch("/mailboxes/:mailboxId/local-tags/:tagId", v("param", tagParamSchema), v("json", updateLocalTagSchema), async (c) =>
    respond(c, localTags.updateLocalTag({ context: requestContext(c), ...c.req.valid("param"), input: c.req.valid("json") })),
  )
  .delete("/mailboxes/:mailboxId/local-tags/:tagId", v("param", tagParamSchema), v("json", deleteLocalTagSchema), async (c) =>
    respond(c, localTags.deleteLocalTag({ context: requestContext(c), ...c.req.valid("param"), input: c.req.valid("json") })),
  )
  .get("/mailboxes/:mailboxId/conversations/:conversationId/local-tags", v("param", conversationParamSchema), async (c) =>
    respond(c, localTags.getConversationLocalTags({ context: requestContext(c), ...c.req.valid("param") })),
  )
  .put(
    "/mailboxes/:mailboxId/conversations/:conversationId/local-tags",
    v("param", conversationParamSchema),
    v("json", setConversationLocalTagsSchema),
    async (c) =>
      respond(c, localTags.setConversationLocalTags({ context: requestContext(c), ...c.req.valid("param"), input: c.req.valid("json") })),
  );

export default localTagRoutes;

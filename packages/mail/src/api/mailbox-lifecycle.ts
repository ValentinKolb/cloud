import { type AuthContext, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { type MailRequestContext, mailboxes } from "../service";

const uuidParamSchema = z.object({ mailboxId: z.string().uuid() });
const deletedMailboxQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().min(1).max(1_000).optional(),
});

const requestContext = (c: Context<AuthContext>): MailRequestContext => ({
  actor: c.get("actor"),
  accessSubject: c.get("accessSubject"),
  requestId: c.req.header("x-request-id") ?? null,
});

export default new Hono<AuthContext>()
  .get("/mailboxes/deleted", v("query", deletedMailboxQuerySchema), async (c) => {
    const query = c.req.valid("query");
    return respond(c, mailboxes.listDeletedMailboxes(requestContext(c), query));
  })
  .get("/mailboxes/:mailboxId/deleted", v("param", uuidParamSchema), async (c) =>
    respond(c, mailboxes.getDeletedMailbox(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .post("/mailboxes/:mailboxId/restore", v("param", uuidParamSchema), async (c) =>
    respond(c, mailboxes.restoreMailbox(requestContext(c), c.req.valid("param").mailboxId)),
  );

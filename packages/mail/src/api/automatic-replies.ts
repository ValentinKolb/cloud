import { type AuthContext, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { automaticReplyPreviewInputSchema, createAutomaticReplySetupSchema, updateAutomaticReplySetupSchema } from "../contracts";
import { automaticReplyConfigurations, type MailRequestContext } from "../service";

const mailboxParamSchema = z.object({ mailboxId: z.string().uuid() });
const automaticReplyParamSchema = z.object({ mailboxId: z.string().uuid(), configurationId: z.string().uuid() });
const requestContext = (c: Context<AuthContext>): MailRequestContext => ({
  actor: c.get("actor"),
  accessSubject: c.get("accessSubject"),
  requestId: c.req.header("x-request-id") ?? null,
});

export default new Hono<AuthContext>()
  .get("/mailboxes/:mailboxId/automatic-replies", v("param", mailboxParamSchema), async (c) =>
    respond(c, automaticReplyConfigurations.listAutomaticReplyConfigurations(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .post("/mailboxes/:mailboxId/automatic-replies", v("param", mailboxParamSchema), v("json", createAutomaticReplySetupSchema), async (c) =>
    respond(
      c,
      automaticReplyConfigurations.createAutomaticReplySetup({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        input: c.req.valid("json"),
      }),
    ),
  )
  .post(
    "/mailboxes/:mailboxId/automatic-replies/preview",
    v("param", mailboxParamSchema),
    v("json", automaticReplyPreviewInputSchema),
    async (c) =>
      respond(
        c,
        automaticReplyConfigurations.previewAutomaticReply({
          context: requestContext(c),
          mailboxId: c.req.valid("param").mailboxId,
          input: c.req.valid("json"),
        }),
      ),
  )
  .patch(
    "/mailboxes/:mailboxId/automatic-replies/:configurationId",
    v("param", automaticReplyParamSchema),
    v("json", updateAutomaticReplySetupSchema),
    async (c) =>
      respond(
        c,
        automaticReplyConfigurations.updateAutomaticReplySetup({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  );

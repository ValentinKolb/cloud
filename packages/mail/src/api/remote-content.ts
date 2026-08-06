import { type AuthContext, rateLimit, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { remoteContentRuleInputSchema } from "../contracts";
import { type MailRequestContext, remoteContent } from "../service";

const mailboxParamSchema = z.object({ mailboxId: z.string().uuid() });
const ruleParamSchema = z.object({ mailboxId: z.string().uuid(), ruleId: z.string().uuid() });
const imageParamSchema = z.object({
  mailboxId: z.string().uuid(),
  messageId: z.string().uuid(),
  imageId: z.string().uuid(),
});
const requestContext = (c: Context<AuthContext>): MailRequestContext => ({
  actor: c.get("actor"),
  accessSubject: c.get("accessSubject"),
  requestId: c.req.header("x-request-id") ?? null,
});

export default new Hono<AuthContext>()
  .get("/mailboxes/:mailboxId/remote-content-rules", v("param", mailboxParamSchema), async (c) =>
    respond(c, remoteContent.listRemoteContentRules(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .post("/mailboxes/:mailboxId/remote-content-rules", v("param", mailboxParamSchema), v("json", remoteContentRuleInputSchema), async (c) =>
    respond(
      c,
      remoteContent.createRemoteContentRule({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        input: c.req.valid("json"),
      }),
    ),
  )
  .delete("/mailboxes/:mailboxId/remote-content-rules/:ruleId", v("param", ruleParamSchema), async (c) =>
    respond(c, remoteContent.deleteRemoteContentRule({ context: requestContext(c), ...c.req.valid("param") })),
  )
  .get(
    "/mailboxes/:mailboxId/messages/:messageId/remote-images/:imageId",
    rateLimit({ keyBy: "user", limitPerSecond: 8 }),
    v("param", imageParamSchema),
    async (c) => {
      const image = await remoteContent.loadRemoteImage({
        context: requestContext(c),
        ...c.req.valid("param"),
      });
      if (!image.ok) return respond(c, image);
      return new Response(Uint8Array.from(image.data.bytes).buffer, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Length": String(image.data.bytes.byteLength),
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Content-Type": image.data.contentType,
          "Cross-Origin-Resource-Policy": "same-origin",
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  );

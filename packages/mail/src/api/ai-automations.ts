import { type AuthContext, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  createMailAiAutomationSchema,
  deleteMailAiAutomationSchema,
  setMailAiAutomationEnabledSchema,
  updateMailAiAutomationSchema,
} from "../contracts";
import { aiAutomations, type MailRequestContext } from "../service";

const mailboxParamSchema = z.object({ mailboxId: z.string().uuid() });
const automationParamSchema = mailboxParamSchema.extend({ automationId: z.string().uuid() });
const requestContext = (c: Context<AuthContext>): MailRequestContext => ({
  actor: c.get("actor"),
  accessSubject: c.get("accessSubject"),
  requestId: c.req.header("x-request-id") ?? null,
});

export default new Hono<AuthContext>()
  .get("/mailboxes/:mailboxId/ai-automations", v("param", mailboxParamSchema), async (c) =>
    respond(c, aiAutomations.listMailAiAutomations(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .get("/mailboxes/:mailboxId/ai-automations/:automationId", v("param", automationParamSchema), async (c) =>
    respond(c, aiAutomations.getMailAiAutomation(requestContext(c), c.req.valid("param").mailboxId, c.req.valid("param").automationId)),
  )
  .post("/mailboxes/:mailboxId/ai-automations", v("param", mailboxParamSchema), v("json", createMailAiAutomationSchema), async (c) =>
    respond(
      c,
      aiAutomations.createMailAiAutomation({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        input: c.req.valid("json"),
      }),
    ),
  )
  .put(
    "/mailboxes/:mailboxId/ai-automations/:automationId",
    v("param", automationParamSchema),
    v("json", updateMailAiAutomationSchema),
    async (c) =>
      respond(
        c,
        aiAutomations.updateMailAiAutomation({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  )
  .patch(
    "/mailboxes/:mailboxId/ai-automations/:automationId/enabled",
    v("param", automationParamSchema),
    v("json", setMailAiAutomationEnabledSchema),
    async (c) =>
      respond(
        c,
        aiAutomations.setMailAiAutomationEnabled({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  )
  .delete(
    "/mailboxes/:mailboxId/ai-automations/:automationId",
    v("param", automationParamSchema),
    v("json", deleteMailAiAutomationSchema),
    async (c) =>
      respond(
        c,
        aiAutomations.deleteMailAiAutomation({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  );

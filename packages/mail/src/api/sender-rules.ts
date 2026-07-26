import { type AuthContext, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  applySenderRuleToExistingInputSchema,
  createSenderRuleSchema,
  deleteSenderRuleSchema,
  markSenderMessagesReadInputSchema,
  previewSenderRuleMatchesInputSchema,
  setSenderRuleEnabledSchema,
  updateSenderRuleSchema,
} from "../contracts";
import { type MailRequestContext, senderRules } from "../service";

const mailboxParamSchema = z.object({ mailboxId: z.string().uuid() });
const senderRuleParamSchema = mailboxParamSchema.extend({ ruleId: z.string().uuid() });
const requestContext = (c: Context<AuthContext>): MailRequestContext => ({
  actor: c.get("actor"),
  accessSubject: c.get("accessSubject"),
  requestId: c.req.header("x-request-id") ?? null,
});

export default new Hono<AuthContext>()
  .get("/mailboxes/:mailboxId/sender-rules", v("param", mailboxParamSchema), async (c) =>
    respond(c, senderRules.listSenderRules(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .get("/mailboxes/:mailboxId/sender-rules/:ruleId", v("param", senderRuleParamSchema), async (c) =>
    respond(c, senderRules.getSenderRule(requestContext(c), c.req.valid("param").mailboxId, c.req.valid("param").ruleId)),
  )
  .post("/mailboxes/:mailboxId/sender-rules", v("param", mailboxParamSchema), v("json", createSenderRuleSchema), async (c) =>
    respond(
      c,
      senderRules.createSenderRule({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        input: c.req.valid("json"),
      }),
    ),
  )
  .post(
    "/mailboxes/:mailboxId/sender-rules/preview",
    v("param", mailboxParamSchema),
    v("json", previewSenderRuleMatchesInputSchema),
    async (c) =>
      respond(
        c,
        senderRules.previewSenderRuleMatches({
          context: requestContext(c),
          mailboxId: c.req.valid("param").mailboxId,
          input: c.req.valid("json"),
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/sender-rules/mark-read",
    v("param", mailboxParamSchema),
    v("json", markSenderMessagesReadInputSchema),
    async (c) =>
      respond(
        c,
        senderRules.markSenderMessagesRead({
          context: requestContext(c),
          mailboxId: c.req.valid("param").mailboxId,
          input: c.req.valid("json"),
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/sender-rules/:ruleId/apply-existing",
    v("param", senderRuleParamSchema),
    v("json", applySenderRuleToExistingInputSchema),
    async (c) =>
      respond(
        c,
        senderRules.applySenderRuleToExisting({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  )
  .put("/mailboxes/:mailboxId/sender-rules/:ruleId", v("param", senderRuleParamSchema), v("json", updateSenderRuleSchema), async (c) =>
    respond(
      c,
      senderRules.updateSenderRule({
        context: requestContext(c),
        ...c.req.valid("param"),
        input: c.req.valid("json"),
      }),
    ),
  )
  .patch(
    "/mailboxes/:mailboxId/sender-rules/:ruleId/enabled",
    v("param", senderRuleParamSchema),
    v("json", setSenderRuleEnabledSchema),
    async (c) =>
      respond(
        c,
        senderRules.setSenderRuleEnabled({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  )
  .delete("/mailboxes/:mailboxId/sender-rules/:ruleId", v("param", senderRuleParamSchema), v("json", deleteSenderRuleSchema), async (c) =>
    respond(
      c,
      senderRules.deleteSenderRule({
        context: requestContext(c),
        ...c.req.valid("param"),
        input: c.req.valid("json"),
      }),
    ),
  );

import { type AuthContext, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  createMailRuleSchema,
  deleteMailRuleSchema,
  markSenderMessagesReadInputSchema,
  previewMailRuleMatchesInputSchema,
  setMailRuleEnabledSchema,
  startMailRuleBackfillInputSchema,
  updateMailRuleSchema,
} from "../contracts";
import { type MailRequestContext, mailRules } from "../service";

const mailboxParamSchema = z.object({ mailboxId: z.string().uuid() });
const mailRuleParamSchema = mailboxParamSchema.extend({ ruleId: z.string().uuid() });
const requestContext = (c: Context<AuthContext>): MailRequestContext => ({
  actor: c.get("actor"),
  accessSubject: c.get("accessSubject"),
  requestId: c.req.header("x-request-id") ?? null,
});

export default new Hono<AuthContext>()
  .get("/mailboxes/:mailboxId/mail-rules", v("param", mailboxParamSchema), async (c) =>
    respond(c, mailRules.listMailRules(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .get("/mailboxes/:mailboxId/mail-rules/catalog", v("param", mailboxParamSchema), async (c) =>
    respond(c, mailRules.getMailRuleCatalog(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .get("/mailboxes/:mailboxId/mail-rules/:ruleId", v("param", mailRuleParamSchema), async (c) =>
    respond(c, mailRules.getMailRule(requestContext(c), c.req.valid("param").mailboxId, c.req.valid("param").ruleId)),
  )
  .post("/mailboxes/:mailboxId/mail-rules", v("param", mailboxParamSchema), v("json", createMailRuleSchema), async (c) =>
    respond(
      c,
      mailRules.createMailRule({
        context: requestContext(c),
        mailboxId: c.req.valid("param").mailboxId,
        input: c.req.valid("json"),
      }),
    ),
  )
  .post(
    "/mailboxes/:mailboxId/mail-rules/preview",
    v("param", mailboxParamSchema),
    v("json", previewMailRuleMatchesInputSchema),
    async (c) =>
      respond(
        c,
        mailRules.previewMailRuleMatches({
          context: requestContext(c),
          mailboxId: c.req.valid("param").mailboxId,
          input: c.req.valid("json"),
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/mail-rules/mark-read",
    v("param", mailboxParamSchema),
    v("json", markSenderMessagesReadInputSchema),
    async (c) =>
      respond(
        c,
        mailRules.markSenderMessagesRead({
          context: requestContext(c),
          mailboxId: c.req.valid("param").mailboxId,
          input: c.req.valid("json"),
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/mail-rules/:ruleId/backfills",
    v("param", mailRuleParamSchema),
    v("json", startMailRuleBackfillInputSchema),
    async (c) =>
      respond(
        c,
        mailRules.startMailRuleBackfill({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  )
  .get(
    "/mailboxes/:mailboxId/mail-rules/:ruleId/backfills/:operationId",
    v("param", mailRuleParamSchema.extend({ operationId: z.string().uuid() })),
    async (c) =>
      respond(
        c,
        mailRules.getMailRuleBackfill({
          context: requestContext(c),
          ...c.req.valid("param"),
        }),
      ),
  )
  .delete(
    "/mailboxes/:mailboxId/mail-rules/:ruleId/backfills/:operationId",
    v("param", mailRuleParamSchema.extend({ operationId: z.string().uuid() })),
    async (c) =>
      respond(
        c,
        mailRules.cancelMailRuleBackfill({
          context: requestContext(c),
          ...c.req.valid("param"),
        }),
      ),
  )
  .put("/mailboxes/:mailboxId/mail-rules/:ruleId", v("param", mailRuleParamSchema), v("json", updateMailRuleSchema), async (c) =>
    respond(
      c,
      mailRules.updateMailRule({
        context: requestContext(c),
        ...c.req.valid("param"),
        input: c.req.valid("json"),
      }),
    ),
  )
  .patch(
    "/mailboxes/:mailboxId/mail-rules/:ruleId/enabled",
    v("param", mailRuleParamSchema),
    v("json", setMailRuleEnabledSchema),
    async (c) =>
      respond(
        c,
        mailRules.setMailRuleEnabled({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  )
  .delete("/mailboxes/:mailboxId/mail-rules/:ruleId", v("param", mailRuleParamSchema), v("json", deleteMailRuleSchema), async (c) =>
    respond(
      c,
      mailRules.deleteMailRule({
        context: requestContext(c),
        ...c.req.valid("param"),
        input: c.req.valid("json"),
      }),
    ),
  );

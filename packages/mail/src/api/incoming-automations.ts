import { type AuthContext, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  createIncomingAutomationSchema,
  deleteIncomingAutomationSchema,
  markSenderMessagesReadInputSchema,
  previewIncomingAutomationMatchesInputSchema,
  setIncomingAutomationEnabledSchema,
  startIncomingAutomationBackfillInputSchema,
  updateIncomingAutomationSchema,
} from "../contracts";
import { incomingAutomations, type MailRequestContext } from "../service";

const mailboxParamSchema = z.object({ mailboxId: z.string().uuid() });
const automationParamSchema = mailboxParamSchema.extend({ automationId: z.string().uuid() });
const requestContext = (c: Context<AuthContext>): MailRequestContext => ({
  actor: c.get("actor"),
  accessSubject: c.get("accessSubject"),
  requestId: c.req.header("x-request-id") ?? null,
});

export default new Hono<AuthContext>()
  .get("/mailboxes/:mailboxId/incoming-automations", v("param", mailboxParamSchema), async (c) =>
    respond(c, incomingAutomations.listIncomingAutomations(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .get("/mailboxes/:mailboxId/incoming-automations/catalog", v("param", mailboxParamSchema), async (c) =>
    respond(c, incomingAutomations.getIncomingAutomationCatalog(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .get("/mailboxes/:mailboxId/incoming-automations/:automationId", v("param", automationParamSchema), async (c) =>
    respond(
      c,
      incomingAutomations.getIncomingAutomation(requestContext(c), c.req.valid("param").mailboxId, c.req.valid("param").automationId),
    ),
  )
  .post(
    "/mailboxes/:mailboxId/incoming-automations",
    v("param", mailboxParamSchema),
    v("json", createIncomingAutomationSchema),
    async (c) =>
      respond(
        c,
        incomingAutomations.createIncomingAutomation({
          context: requestContext(c),
          mailboxId: c.req.valid("param").mailboxId,
          input: c.req.valid("json"),
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/incoming-automations/preview",
    v("param", mailboxParamSchema),
    v("json", previewIncomingAutomationMatchesInputSchema),
    async (c) =>
      respond(
        c,
        incomingAutomations.previewIncomingAutomationMatches({
          context: requestContext(c),
          mailboxId: c.req.valid("param").mailboxId,
          input: c.req.valid("json"),
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/incoming-automations/mark-read",
    v("param", mailboxParamSchema),
    v("json", markSenderMessagesReadInputSchema),
    async (c) =>
      respond(
        c,
        incomingAutomations.markSenderMessagesRead({
          context: requestContext(c),
          mailboxId: c.req.valid("param").mailboxId,
          input: c.req.valid("json"),
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/incoming-automations/:automationId/backfills",
    v("param", automationParamSchema),
    v("json", startIncomingAutomationBackfillInputSchema),
    async (c) =>
      respond(
        c,
        incomingAutomations.startIncomingAutomationBackfill({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  )
  .get(
    "/mailboxes/:mailboxId/incoming-automations/:automationId/backfills/:operationId",
    v("param", automationParamSchema.extend({ operationId: z.string().uuid() })),
    async (c) =>
      respond(
        c,
        incomingAutomations.getIncomingAutomationBackfill({
          context: requestContext(c),
          ...c.req.valid("param"),
        }),
      ),
  )
  .delete(
    "/mailboxes/:mailboxId/incoming-automations/:automationId/backfills/:operationId",
    v("param", automationParamSchema.extend({ operationId: z.string().uuid() })),
    async (c) =>
      respond(
        c,
        incomingAutomations.cancelIncomingAutomationBackfill({
          context: requestContext(c),
          ...c.req.valid("param"),
        }),
      ),
  )
  .put(
    "/mailboxes/:mailboxId/incoming-automations/:automationId",
    v("param", automationParamSchema),
    v("json", updateIncomingAutomationSchema),
    async (c) =>
      respond(
        c,
        incomingAutomations.updateIncomingAutomation({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  )
  .patch(
    "/mailboxes/:mailboxId/incoming-automations/:automationId/enabled",
    v("param", automationParamSchema),
    v("json", setIncomingAutomationEnabledSchema),
    async (c) =>
      respond(
        c,
        incomingAutomations.setIncomingAutomationEnabled({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  )
  .delete(
    "/mailboxes/:mailboxId/incoming-automations/:automationId",
    v("param", automationParamSchema),
    v("json", deleteIncomingAutomationSchema),
    async (c) =>
      respond(
        c,
        incomingAutomations.deleteIncomingAutomation({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  );

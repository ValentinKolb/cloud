import { err, fail } from "@k2b/stdlib";
import { v } from "@valentinkolb/cloud/server";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  createIncomingAutomationSchema,
  deleteIncomingAutomationSchema,
  markSenderMessagesReadInputSchema,
  previewIncomingAutomationMatchesInputSchema,
  ResourceShortIdSchema,
  setIncomingAutomationEnabledSchema,
  startIncomingAutomationBackfillInputSchema,
  updateIncomingAutomationSchema,
} from "../contracts";
import { incomingAutomations, type MailRequestContext, publicResources } from "../service";
import {
  internalMailboxId,
  internalParams,
  type MailApiContext,
  mailboxParamSchema,
  resolveMailboxResourceParam,
  resolvePublicRelations,
  respondPublic,
} from "./public-resource-boundary";

const automationParamSchema = mailboxParamSchema.extend({ automationId: ResourceShortIdSchema });
const requestContext = (c: Context<MailApiContext>): MailRequestContext => ({
  actor: c.get("actor"),
  accessSubject: c.get("accessSubject"),
  requestId: c.req.header("x-request-id") ?? null,
});

const resolveAutomationParam = resolveMailboxResourceParam("incomingAutomations", "automationId", "Incoming automation");

export const projectIncomingAutomationCatalog = async (
  resultPromise: ReturnType<typeof incomingAutomations.getIncomingAutomationCatalog>,
) => {
  const result = await resultPromise;
  if (!result.ok) return result;
  const [folders, senderIdentities, localTags] = await Promise.all([
    publicResources.publicIds(
      "folders",
      result.data.folders.map((entry) => entry.id),
    ),
    publicResources.publicIds(
      "senderIdentities",
      (result.data.senderIdentities ?? []).map((entry) => entry.id),
    ),
    publicResources.publicIds(
      "tags",
      (result.data.localTags ?? []).map((entry) => entry.id),
    ),
  ]);
  return {
    ok: true as const,
    data: {
      ...result.data,
      folders: result.data.folders.map((entry) => ({ ...entry, id: publicResources.requirePublicId(folders, entry.id) })),
      senderIdentities: (result.data.senderIdentities ?? []).map((entry) => ({
        ...entry,
        id: publicResources.requirePublicId(senderIdentities, entry.id),
      })),
      localTags: (result.data.localTags ?? []).map((entry) => ({
        ...entry,
        id: publicResources.requirePublicId(localTags, entry.id),
      })),
    },
  };
};

export default new Hono<MailApiContext>()
  .get("/mailboxes/:mailboxId/incoming-automations", v("param", mailboxParamSchema), async (c) =>
    respondPublic(c, incomingAutomations.listIncomingAutomations(requestContext(c), internalMailboxId(c)), "incomingAutomations"),
  )
  .get("/mailboxes/:mailboxId/incoming-automations/catalog", v("param", mailboxParamSchema), async (c) =>
    respondPublic(
      c,
      projectIncomingAutomationCatalog(incomingAutomations.getIncomingAutomationCatalog(requestContext(c), internalMailboxId(c))),
    ),
  )
  .get("/mailboxes/:mailboxId/incoming-automations/:automationId", resolveAutomationParam, v("param", automationParamSchema), async (c) =>
    respondPublic(
      c,
      incomingAutomations.getIncomingAutomation(
        requestContext(c),
        internalMailboxId(c),
        internalParams(c, c.req.valid("param")).automationId,
      ),
      "incomingAutomations",
    ),
  )
  .post(
    "/mailboxes/:mailboxId/incoming-automations",
    v("param", mailboxParamSchema),
    v("json", createIncomingAutomationSchema),
    async (c) => {
      const input = await resolvePublicRelations(internalMailboxId(c), c.req.valid("json"));
      if (!input) return respondPublic(c, fail(err.notFound("Mail resource")));
      return respondPublic(
        c,
        incomingAutomations.createIncomingAutomation({
          context: requestContext(c),
          mailboxId: internalMailboxId(c),
          input,
        }),
        "incomingAutomations",
      );
    },
  )
  .post(
    "/mailboxes/:mailboxId/incoming-automations/preview",
    v("param", mailboxParamSchema),
    v("json", previewIncomingAutomationMatchesInputSchema),
    async (c) => {
      const input = await resolvePublicRelations(internalMailboxId(c), c.req.valid("json"));
      if (!input) return respondPublic(c, fail(err.notFound("Mail resource")));
      return respondPublic(
        c,
        incomingAutomations.previewIncomingAutomationMatches({
          context: requestContext(c),
          mailboxId: internalMailboxId(c),
          input,
        }),
      );
    },
  )
  .post(
    "/mailboxes/:mailboxId/incoming-automations/mark-read",
    v("param", mailboxParamSchema),
    v("json", markSenderMessagesReadInputSchema),
    async (c) =>
      respondPublic(
        c,
        incomingAutomations.markSenderMessagesRead({
          context: requestContext(c),
          mailboxId: internalMailboxId(c),
          input: c.req.valid("json"),
        }),
      ),
  )
  .post(
    "/mailboxes/:mailboxId/incoming-automations/:automationId/backfills",
    resolveAutomationParam,
    v("param", automationParamSchema),
    v("json", startIncomingAutomationBackfillInputSchema),
    async (c) =>
      respondPublic(
        c,
        incomingAutomations.startIncomingAutomationBackfill({
          context: requestContext(c),
          ...internalParams(c, c.req.valid("param")),
          input: c.req.valid("json"),
        }),
      ),
  )
  .get(
    "/mailboxes/:mailboxId/incoming-automations/:automationId/backfills/:operationId",
    resolveAutomationParam,
    v("param", automationParamSchema.extend({ operationId: z.string().uuid() })),
    async (c) =>
      respondPublic(
        c,
        incomingAutomations.getIncomingAutomationBackfill({
          context: requestContext(c),
          ...internalParams(c, c.req.valid("param")),
        }),
      ),
  )
  .delete(
    "/mailboxes/:mailboxId/incoming-automations/:automationId/backfills/:operationId",
    resolveAutomationParam,
    v("param", automationParamSchema.extend({ operationId: z.string().uuid() })),
    async (c) =>
      respondPublic(
        c,
        incomingAutomations.cancelIncomingAutomationBackfill({
          context: requestContext(c),
          ...internalParams(c, c.req.valid("param")),
        }),
      ),
  )
  .put(
    "/mailboxes/:mailboxId/incoming-automations/:automationId",
    resolveAutomationParam,
    v("param", automationParamSchema),
    v("json", updateIncomingAutomationSchema),
    async (c) => {
      const input = await resolvePublicRelations(internalMailboxId(c), c.req.valid("json"));
      if (!input) return respondPublic(c, fail(err.notFound("Mail resource")));
      return respondPublic(
        c,
        incomingAutomations.updateIncomingAutomation({
          context: requestContext(c),
          ...internalParams(c, c.req.valid("param")),
          input,
        }),
        "incomingAutomations",
      );
    },
  )
  .patch(
    "/mailboxes/:mailboxId/incoming-automations/:automationId/enabled",
    resolveAutomationParam,
    v("param", automationParamSchema),
    v("json", setIncomingAutomationEnabledSchema),
    async (c) =>
      respondPublic(
        c,
        incomingAutomations.setIncomingAutomationEnabled({
          context: requestContext(c),
          ...internalParams(c, c.req.valid("param")),
          input: c.req.valid("json"),
        }),
        "incomingAutomations",
      ),
  )
  .delete(
    "/mailboxes/:mailboxId/incoming-automations/:automationId",
    resolveAutomationParam,
    v("param", automationParamSchema),
    v("json", deleteIncomingAutomationSchema),
    async (c) =>
      respondPublic(
        c,
        incomingAutomations.deleteIncomingAutomation({
          context: requestContext(c),
          ...internalParams(c, c.req.valid("param")),
          input: c.req.valid("json"),
        }),
        "incomingAutomations",
      ),
  );

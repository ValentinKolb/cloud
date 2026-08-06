import { type AuthContext, auth, getDateConfig, respond, v } from "@valentinkolb/cloud/server";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { CUSTOM_APP_REFERENCE, CustomAppDefinitionInputSchema } from "../custom-apps/contracts";
import { customAppFormMatchesPublishedCapability } from "../custom-apps/form-runtime";
import { customAppFormSuccessHref, resolveCustomAppPage, resolveCustomAppPageParams } from "../custom-apps/routing";
import { gridsService } from "../service";
import { FormSubmitSchema, parseFormSubmission } from "./form-api-shared";
import {
  actorViewerFor,
  currentActorUserId,
  gateAt,
  gridsAccessContext,
  hasExplicitGrant,
  resolveRecordAccessForAccess,
  resolveWithGrantsForAccess,
} from "./permissions";
import { requireUuidParam } from "./route-params";

const DefinitionBaseSchema = z.object({ baseId: z.string().uuid() });
const RecordCommentBodySchema = z.object({ body: z.string().max(10_000) }).strict();
const RecordCommentListQuerySchema = z
  .object({
    cursor: z.string().max(2_000).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .passthrough();

const gateDefinitionAdmin = async (c: Parameters<typeof gateAt>[0], input: unknown) => {
  const parsed = DefinitionBaseSchema.safeParse(input);
  if (!parsed.success) return c.json({ diagnostics: parsed.error.issues }, 400);
  const gate = await gateAt(c, { baseId: parsed.data.baseId }, "admin");
  return gate.ok ? null : respond(c, () => Promise.resolve(gate));
};

const resolveRuntimeComments = async (c: Context<AuthContext>, required: "read" | "write") => {
  const app = await gridsService.customApp.getPublishedByShortId(c.req.param("shortId") ?? "");
  if (!app?.publishedDefinition || !app.publishedCapabilities) return null;
  const accessContext = gridsAccessContext(c);
  const appAccess = await resolveWithGrantsForAccess(accessContext, { baseId: app.baseId, customAppId: app.id });
  if (!hasExplicitGrant(appAccess.grants, "customApp", app.id) || !gridsService.permission.hasAtLeast(appAccess.level, "read")) return null;

  const page = resolveCustomAppPage(app.publishedDefinition, c.req.param("pageId"));
  const pageParams = page ? resolveCustomAppPageParams(page, c.req.query()) : null;
  const block = page?.rows
    .flatMap((row) => row.columns.flatMap((column) => column.blocks))
    .find((candidate) => candidate.id === c.req.param("blockId") && candidate.type === "comments");
  if (!page?.record || !pageParams || !block || block.type !== "comments") return null;
  const capability = app.publishedCapabilities.comments.find(
    (candidate) => candidate.pageId === page.id && candidate.blockId === block.id && candidate.tableId === page.record!.tableId,
  );
  if (!capability) return null;

  const recordId = pageParams[page.record.id.path];
  if (!recordId) return null;
  const recordAccess = await resolveRecordAccessForAccess(
    accessContext,
    { baseId: app.baseId, tableId: page.record.tableId },
    required,
  );
  if (!recordAccess.ok) return { denied: recordAccess } as const;
  const record = await gridsService.record.get(page.record.tableId, recordId, {
    viewer: actorViewerFor(accessContext),
    recordAccess: recordAccess.data.recordAccess,
  });
  if (!record) return null;
  return { app, page, block, recordId, recordAccess, accessContext } as const;
};

export const createCustomAppsApi = (deps: { requireAuthenticated?: MiddlewareHandler<AuthContext> } = {}) =>
  new Hono<AuthContext>()
    .use(deps.requireAuthenticated ?? auth.requireRole("authenticated"))
    .get("/reference", (c) => c.json(CUSTOM_APP_REFERENCE))
    .get("/runtime/:shortId/:pageId/:blockId/comments", v("query", RecordCommentListQuerySchema), async (c) => {
      const resolved = await resolveRuntimeComments(c, "read");
      if (!resolved) return c.json({ message: "Comments not found" }, 404);
      if ("denied" in resolved && resolved.denied) return respond(c, () => Promise.resolve(resolved.denied));
      const result = await gridsService.record.comments.list({
        baseId: resolved.app.baseId,
        tableId: resolved.page.record!.tableId,
        recordId: resolved.recordId,
        recordAccess: resolved.recordAccess.data.recordAccess,
        ...c.req.valid("query"),
      });
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      return c.json({
        ...result.data,
        permissions: {
          actorUserId: currentActorUserId(c),
          canWrite: gridsService.permission.hasAtLeast(resolved.recordAccess.data.level, "write"),
          canModerate: resolved.recordAccess.data.level === "admin",
        },
      });
    })
    .post("/runtime/:shortId/:pageId/:blockId/comments", v("json", RecordCommentBodySchema), async (c) => {
      const resolved = await resolveRuntimeComments(c, "write");
      if (!resolved) return c.json({ message: "Comments not found" }, 404);
      if ("denied" in resolved && resolved.denied) return respond(c, () => Promise.resolve(resolved.denied));
      const result = await gridsService.record.comments.create({
        baseId: resolved.app.baseId,
        tableId: resolved.page.record!.tableId,
        recordId: resolved.recordId,
        actorUserId: currentActorUserId(c),
        body: c.req.valid("json").body,
        recordAccess: resolved.recordAccess.data.recordAccess,
      });
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      return c.json(result.data, 201);
    })
    .patch(
      "/runtime/:shortId/:pageId/:blockId/comments/:commentId",
      requireUuidParam("commentId", "Comment"),
      v("json", RecordCommentBodySchema),
      async (c) => {
        const resolved = await resolveRuntimeComments(c, "write");
        if (!resolved) return c.json({ message: "Comments not found" }, 404);
        if ("denied" in resolved && resolved.denied) return respond(c, () => Promise.resolve(resolved.denied));
        return respond(c, () =>
          gridsService.record.comments.update({
            baseId: resolved.app.baseId,
            tableId: resolved.page.record!.tableId,
            recordId: resolved.recordId,
            commentId: c.req.param("commentId")!,
            actorUserId: currentActorUserId(c),
            canModerate: resolved.recordAccess.data.level === "admin",
            body: c.req.valid("json").body,
            recordAccess: resolved.recordAccess.data.recordAccess,
          }),
        );
      },
    )
    .delete("/runtime/:shortId/:pageId/:blockId/comments/:commentId", requireUuidParam("commentId", "Comment"), async (c) => {
      const resolved = await resolveRuntimeComments(c, "write");
      if (!resolved) return c.json({ message: "Comments not found" }, 404);
      if ("denied" in resolved && resolved.denied) return respond(c, () => Promise.resolve(resolved.denied));
      const result = await gridsService.record.comments.remove({
        baseId: resolved.app.baseId,
        tableId: resolved.page.record!.tableId,
        recordId: resolved.recordId,
        commentId: c.req.param("commentId")!,
        actorUserId: currentActorUserId(c),
        canModerate: resolved.recordAccess.data.level === "admin",
        recordAccess: resolved.recordAccess.data.recordAccess,
      });
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      return c.body(null, 204);
    })
    .post("/runtime/:shortId/:pageId/:blockId/submit", v("json", FormSubmitSchema), async (c) => {
      const app = await gridsService.customApp.getPublishedByShortId(c.req.param("shortId") ?? "");
      if (!app?.publishedDefinition || !app.publishedCapabilities) return c.json({ message: "Form not found" }, 404);

      const accessContext = gridsAccessContext(c);
      const appAccess = await resolveWithGrantsForAccess(accessContext, { baseId: app.baseId, customAppId: app.id });
      if (!hasExplicitGrant(appAccess.grants, "customApp", app.id) || !gridsService.permission.hasAtLeast(appAccess.level, "read")) {
        return c.json({ message: "Form not found" }, 404);
      }

      const page = resolveCustomAppPage(app.publishedDefinition, c.req.param("pageId"));
      const pageParams = page ? resolveCustomAppPageParams(page, c.req.query()) : null;
      const block = page?.rows
        .flatMap((row) => row.columns.flatMap((column) => column.blocks))
        .find((candidate) => candidate.id === c.req.param("blockId") && candidate.type === "form");
      if (!page || !pageParams || !block || block.type !== "form") return c.json({ message: "Form not found" }, 404);

      const capability = app.publishedCapabilities.forms.find(
        (candidate) => candidate.pageId === page.id && candidate.blockId === block.id && candidate.formId === block.formId,
      );
      const form = capability ? await gridsService.form.get(block.formId) : null;
      const fields = form ? await gridsService.field.listByTable(form.tableId) : [];
      if (!capability || !form || !customAppFormMatchesPublishedCapability({ block, page, form, fields, capability })) {
        return c.json({ message: "Form not found" }, 404);
      }

      const formAccess = await resolveRecordAccessForAccess(
        accessContext,
        { baseId: app.baseId, tableId: form.tableId, formId: form.id },
        "write",
      );
      if (!formAccess.ok) return respond(c, () => Promise.resolve(formAccess));

      const viewer = actorViewerFor(accessContext);
      const dateConfig = await getDateConfig(c);
      for (const [parameterId, parameter] of Object.entries(page.parameters)) {
        const sourceAccess = await resolveRecordAccessForAccess(accessContext, { baseId: app.baseId, tableId: parameter.tableId }, "read");
        if (!sourceAccess.ok) return c.json({ message: "Form not found" }, 404);
        const sourceRecord = await gridsService.record.get(parameter.tableId, pageParams[parameterId]!, {
          viewer,
          recordAccess: sourceAccess.data.recordAccess,
          dateConfig,
        });
        if (!sourceRecord) return c.json({ message: "Form not found" }, 404);
      }

      const submission = parseFormSubmission(c.req.valid("json"));
      if (!submission) return c.json({ message: "Invalid form submission" }, 400);
      const fixedValues = Object.fromEntries(
        Object.entries(block.fixedValues).map(([fieldId, value]) => [fieldId, pageParams[value.path]!]),
      );
      const result = await gridsService.form.submit({
        form,
        submission,
        actorId: currentActorUserId(c),
        dateConfig,
        fixedValues,
        recordAccess: formAccess.data.recordAccess,
        viewer,
      });
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      const navigateTo = block.onSuccessNavigate
        ? customAppFormSuccessHref(app.shortId, block.onSuccessNavigate, pageParams, result.data.recordId)
        : undefined;
      return c.json({ recordId: result.data.recordId, navigateTo }, 201);
    })
    .get("/by-base/:baseId", requireUuidParam("baseId", "Base"), async (c) => {
      const baseId = c.req.param("baseId")!;
      const gate = await gateAt(c, { baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return c.json(await gridsService.customApp.listByBase(baseId));
    })
    .post("/validate", v("json", CustomAppDefinitionInputSchema), async (c) => {
      const input = c.req.valid("json").definition;
      const denied = await gateDefinitionAdmin(c, input);
      if (denied) return denied;
      const compilation = await gridsService.customApp.compile(input);
      return c.json(
        compilation.ok
          ? { valid: true, diagnostics: [], capabilities: compilation.compiled.capabilities }
          : { valid: false, diagnostics: compilation.diagnostics },
      );
    })
    .post("/plan", v("json", CustomAppDefinitionInputSchema), async (c) => {
      const input = c.req.valid("json").definition;
      const denied = await gateDefinitionAdmin(c, input);
      if (denied) return denied;
      return c.json(await gridsService.customApp.plan(input));
    })
    .post("/apply", v("json", CustomAppDefinitionInputSchema), async (c) => {
      const input = c.req.valid("json").definition;
      const denied = await gateDefinitionAdmin(c, input);
      if (denied) return denied;
      return respond(c, () => gridsService.customApp.apply(input, currentActorUserId(c)));
    })
    .get("/:appId", requireUuidParam("appId", "Custom App"), async (c) => {
      const app = await gridsService.customApp.get(c.req.param("appId")!);
      if (!app) return c.json({ message: "Custom App not found" }, 404);
      const gate = await gateAt(c, { baseId: app.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return c.json(app);
    })
    .get("/:appId/export", requireUuidParam("appId", "Custom App"), async (c) => {
      const app = await gridsService.customApp.get(c.req.param("appId")!);
      if (!app) return c.json({ message: "Custom App not found" }, 404);
      const gate = await gateAt(c, { baseId: app.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return c.json(app.draftDefinition);
    })
    .post("/:appId/publish", requireUuidParam("appId", "Custom App"), async (c) => {
      const app = await gridsService.customApp.get(c.req.param("appId")!);
      if (!app) return c.json({ message: "Custom App not found" }, 404);
      const gate = await gateAt(c, { baseId: app.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(c, () => gridsService.customApp.publish(app.id, currentActorUserId(c)));
    });

export default createCustomAppsApi();

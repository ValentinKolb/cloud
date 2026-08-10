import { type AuthContext, auth, getDateConfig, rateLimit, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { type GridRecord, RecordUpdateBodySchema } from "../contracts";
import { customAppPageRecordFieldIds } from "../custom-apps/conditions";
import { CUSTOM_APP_REFERENCE, CustomAppDefinitionInputSchema } from "../custom-apps/contracts";
import { customAppFormInlineTargetTableIds } from "../custom-apps/form-capability";
import { customAppFormMatchesPublishedCapability } from "../custom-apps/form-runtime";
import { customAppFormSuccessHref, customAppPageHref, resolveCustomAppPage, resolveCustomAppPageParams } from "../custom-apps/routing";
import { buildCustomAppRuntimeContext } from "../custom-apps/runtime-context";
import { isRecordWritableFieldType } from "../field-types";
import { gridsService } from "../service";
import { publishedCustomAppAvailability } from "../service/custom-app-runtime-query";
import { ALL_RECORD_ACCESS } from "../service/record-access";
import { FormSubmitSchema, parseFormSubmission } from "./form-api-shared";
import {
  actorViewerFor,
  currentActorUserId,
  currentWorkflowPrincipal,
  gateAt,
  gateCustomAppAtAccess,
  gridsAccessContext,
} from "./permissions";
import { requireUuidParam } from "./route-params";

const DefinitionBaseSchema = z.object({ baseId: z.string().uuid() });
const CustomAppCreateSchema = z.object({ name: z.string().trim().min(1).max(200) }).strict();
const RecordCommentBodySchema = z.object({ body: z.string().max(10_000) }).strict();
const CustomAppActionInvocationSchema = z.object({ operationId: z.string().uuid() }).strict();
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

const resolvePublishedRuntime = async (c: Context<AuthContext>) => {
  const app = await gridsService.customApp.getPublishedByShortId(c.req.param("shortId") ?? "");
  if (!app?.publishedDefinition || !app.publishedCapabilities) return null;
  const definition = app.publishedDefinition;
  const capabilities = app.publishedCapabilities;
  const access = gridsAccessContext(c);
  if (!(await gateCustomAppAtAccess(access, app.id)).ok) return null;
  const page = resolveCustomAppPage(definition, c.req.param("pageId"));
  if (!page) return null;
  const pageParams = resolveCustomAppPageParams(page, c.req.query());
  if (!pageParams) return null;
  const base = await gridsService.base.get(app.baseId);
  if (!base) return null;
  const dateConfig = getDateConfig(c);
  const runtimeContext = buildCustomAppRuntimeContext({
    access,
    app,
    base,
    page,
    pageUrl: customAppPageHref(app.shortId, page.id, pageParams),
    pageParams,
    dateConfig,
  });
  const viewer = { ...actorViewerFor(access), isAdmin: true };
  const available = async (target: "page" | "block" | "action", query: string | undefined, blockId?: string, actionId?: string) => {
    if (!query) return true;
    const capability = capabilities.availability.find(
      (candidate) =>
        candidate.target === target &&
        candidate.pageId === page.id &&
        (target === "page" || (candidate.target !== "page" && candidate.blockId === blockId)) &&
        (target !== "action" || (candidate.target === "action" && candidate.actionId === actionId)),
    );
    if (!capability) return false;
    return publishedCustomAppAvailability({
      baseId: app.baseId,
      source: query,
      capability,
      context: runtimeContext.query,
      signal: c.req.raw.signal,
      timeZone: runtimeContext.query["time.timeZone"],
      viewer,
    });
  };
  if (!(await available("page", page.availableWhen?.query))) return null;
  return { app, capabilities, access, page, pageParams, dateConfig, runtimeContext, viewer, available };
};

const resolveRuntimeComments = async (c: Context<AuthContext>) => {
  const runtime = await resolvePublishedRuntime(c);
  if (!runtime) return null;
  const { app, capabilities, page, pageParams } = runtime;
  const block = page?.rows
    .flatMap((row) => row.columns.flatMap((column) => column.blocks))
    .find((candidate) => candidate.id === c.req.param("blockId") && candidate.type === "comments");
  if (!page?.record || !pageParams || !block || block.type !== "comments") return null;
  if (!(await runtime.available("block", block.availableWhen?.query, block.id))) return null;
  const capability = capabilities.comments.find(
    (candidate) => candidate.pageId === page.id && candidate.blockId === block.id && candidate.tableId === page.record!.tableId,
  );
  if (!capability) return null;

  const recordId = pageParams[page.record.id.path];
  if (!recordId) return null;
  const record = await gridsService.record.get(page.record.tableId, recordId, {
    viewer: runtime.viewer,
    recordAccess: ALL_RECORD_ACCESS,
  });
  if (!record) return null;
  const canModerate = (await gateAt(c, { baseId: app.baseId }, "admin")).ok;
  return { app, page, block, recordId, canModerate } as const;
};

const resolveRuntimeRecordEdit = async (c: Context<AuthContext>) => {
  const runtime = await resolvePublishedRuntime(c);
  if (!runtime) return null;
  const { app, capabilities, page, pageParams } = runtime;
  const block = page?.rows
    .flatMap((row) => row.columns.flatMap((column) => column.blocks))
    .find((candidate) => candidate.id === c.req.param("blockId") && candidate.type === "record");
  if (!page?.record || !pageParams || !block || block.type !== "record" || block.editableFieldIds.length === 0) return null;
  if (!(await runtime.available("block", block.availableWhen?.query, block.id))) return null;

  const capability = capabilities.records.find((candidate) => candidate.pageId === page.id && candidate.tableId === page.record!.tableId);
  const recordBlocks = page.rows.flatMap((row) =>
    row.columns.flatMap((column) => column.blocks.filter((candidate) => candidate.type === "record")),
  );
  const expectedFieldIds = customAppPageRecordFieldIds(page);
  const expectedEditableFieldIds = [...new Set(recordBlocks.flatMap((candidate) => candidate.editableFieldIds))].sort();
  if (
    !capability ||
    capability.fieldIds.join("\0") !== expectedFieldIds.join("\0") ||
    capability.editableFieldIds.join("\0") !== expectedEditableFieldIds.join("\0")
  ) {
    return null;
  }

  const recordId = pageParams[page.record.id.path];
  if (!recordId) return null;
  const record = await gridsService.record.get(page.record.tableId, recordId, {
    viewer: runtime.viewer,
    recordAccess: ALL_RECORD_ACCESS,
  });
  if (!record) return null;
  return { app, page, block, capability, record, viewer: runtime.viewer } as const;
};

const submitPublishedCustomAppForm = async (c: Context<AuthContext>, submitted: Record<string, unknown>) => {
  const runtime = await resolvePublishedRuntime(c);
  if (!runtime) return c.json({ message: "Form not found" }, 404);
  const { app, capabilities, page, pageParams, dateConfig, viewer } = runtime;
  const block = page.rows
    .flatMap((row) => row.columns.flatMap((column) => column.blocks))
    .find((candidate) => candidate.id === c.req.param("blockId") && candidate.type === "form");
  if (!block || block.type !== "form" || !(await runtime.available("block", block.availableWhen?.query, block.id))) {
    return c.json({ message: "Form not found" }, 404);
  }

  const capability = capabilities.forms.find(
    (candidate) => candidate.pageId === page.id && candidate.blockId === block.id && candidate.formId === block.formId,
  );
  const form = capability ? await gridsService.form.get(block.formId) : null;
  const fields = form ? await gridsService.field.listByTable(form.tableId, true) : [];
  const inlineTargetFields = form
    ? (
        await Promise.all(
          customAppFormInlineTargetTableIds(form.config, fields).map((tableId) => gridsService.field.listByTable(tableId, true)),
        )
      ).flat()
    : [];
  if (!capability || !form || !customAppFormMatchesPublishedCapability({ block, page, form, fields, inlineTargetFields, capability })) {
    return c.json({ message: "Form not found" }, 404);
  }

  for (const [parameterId, parameter] of Object.entries(page.parameters)) {
    const sourceRecord = await gridsService.record.get(parameter.tableId, pageParams[parameterId]!, {
      viewer,
      recordAccess: ALL_RECORD_ACCESS,
      dateConfig,
    });
    if (!sourceRecord) return c.json({ message: "Form not found" }, 404);
  }

  const submission = parseFormSubmission(submitted);
  if (!submission) return c.json({ message: "Invalid form submission" }, 400);
  const fixedValues = Object.fromEntries(Object.entries(block.fixedValues).map(([fieldId, value]) => [fieldId, pageParams[value.path]!]));
  const result = await gridsService.form.submit({
    form,
    submission,
    actorId: currentActorUserId(c),
    dateConfig,
    fixedValues,
    recordAccess: ALL_RECORD_ACCESS,
    viewer,
  });
  if (!result.ok) return respond(c, () => Promise.resolve(result));
  const navigateTo = block.onSuccessNavigate
    ? customAppFormSuccessHref(app.shortId, block.onSuccessNavigate, pageParams, result.data.recordId)
    : undefined;
  return c.json({ recordId: result.data.recordId, navigateTo }, 201);
};

export const createCustomAppsApi = (
  deps: {
    requireAuthenticated?: MiddlewareHandler<AuthContext>;
    invokeCustomAppLauncher?: typeof gridsService.workflow.launcher.invokeCustomApp;
  } = {},
) => {
  const invokeCustomAppLauncher = deps.invokeCustomAppLauncher ?? gridsService.workflow.launcher.invokeCustomApp;
  return new Hono<AuthContext>()
    .post(
      "/runtime/:shortId/:pageId/:blockId/submit",
      rateLimit({ keyBy: "ip", limitPerSecond: 3, windowSecs: 60 }),
      v("json", FormSubmitSchema),
      (c) => submitPublishedCustomAppForm(c, c.req.valid("json")),
    )
    .use(deps.requireAuthenticated ?? auth.requireRole("authenticated"))
    .get("/reference", (c) => c.json(CUSTOM_APP_REFERENCE))
    .get("/runtime/:shortId/:pageId/:blockId/comments", v("query", RecordCommentListQuerySchema), async (c) => {
      const resolved = await resolveRuntimeComments(c);
      if (!resolved) return c.json({ message: "Comments not found" }, 404);
      const result = await gridsService.record.comments.list({
        baseId: resolved.app.baseId,
        tableId: resolved.page.record!.tableId,
        recordId: resolved.recordId,
        recordAccess: ALL_RECORD_ACCESS,
        ...c.req.valid("query"),
      });
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      return c.json({
        ...result.data,
        permissions: {
          actorUserId: currentActorUserId(c),
          canWrite: true,
          canModerate: resolved.canModerate,
        },
      });
    })
    .post("/runtime/:shortId/:pageId/:blockId/comments", v("json", RecordCommentBodySchema), async (c) => {
      const resolved = await resolveRuntimeComments(c);
      if (!resolved) return c.json({ message: "Comments not found" }, 404);
      const result = await gridsService.record.comments.create({
        baseId: resolved.app.baseId,
        tableId: resolved.page.record!.tableId,
        recordId: resolved.recordId,
        actorUserId: currentActorUserId(c),
        body: c.req.valid("json").body,
        recordAccess: ALL_RECORD_ACCESS,
      });
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      return c.json(result.data, 201);
    })
    .patch(
      "/runtime/:shortId/:pageId/:blockId/comments/:commentId",
      requireUuidParam("commentId", "Comment"),
      v("json", RecordCommentBodySchema),
      async (c) => {
        const resolved = await resolveRuntimeComments(c);
        if (!resolved) return c.json({ message: "Comments not found" }, 404);
        return respond(c, () =>
          gridsService.record.comments.update({
            baseId: resolved.app.baseId,
            tableId: resolved.page.record!.tableId,
            recordId: resolved.recordId,
            commentId: c.req.param("commentId")!,
            actorUserId: currentActorUserId(c),
            canModerate: resolved.canModerate,
            body: c.req.valid("json").body,
            recordAccess: ALL_RECORD_ACCESS,
          }),
        );
      },
    )
    .delete("/runtime/:shortId/:pageId/:blockId/comments/:commentId", requireUuidParam("commentId", "Comment"), async (c) => {
      const resolved = await resolveRuntimeComments(c);
      if (!resolved) return c.json({ message: "Comments not found" }, 404);
      const result = await gridsService.record.comments.remove({
        baseId: resolved.app.baseId,
        tableId: resolved.page.record!.tableId,
        recordId: resolved.recordId,
        commentId: c.req.param("commentId")!,
        actorUserId: currentActorUserId(c),
        canModerate: resolved.canModerate,
        recordAccess: ALL_RECORD_ACCESS,
      });
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      return c.body(null, 204);
    })
    .patch("/runtime/:shortId/:pageId/:blockId/record", v("json", RecordUpdateBodySchema), async (c) => {
      const resolved = await resolveRuntimeRecordEdit(c);
      if (!resolved) return c.json({ message: "Record editor not found" }, 404);

      const ifMatch = Number(c.req.header("If-Match"));
      if (!Number.isInteger(ifMatch) || ifMatch < 1) return c.json({ message: "If-Match must contain the current record version" }, 400);
      const body = c.req.valid("json");
      const allowed = new Set(resolved.block.editableFieldIds);
      const submittedFieldIds = Object.keys(body.values);
      if (submittedFieldIds.some((fieldId) => !allowed.has(fieldId))) {
        return c.json({ message: "Record update contains a field outside this published editor" }, 400);
      }

      const fields = await gridsService.field.listByTable(resolved.page.record!.tableId);
      const fieldsById = new Map(fields.map((field) => [field.id, field]));
      if (
        resolved.block.editableFieldIds.some((fieldId) => {
          const field = fieldsById.get(fieldId);
          return !field || field.deletedAt !== null || !isRecordWritableFieldType(field.type);
        })
      ) {
        return c.json({ message: "This record editor changed after the app was published" }, 409);
      }

      return respond(c, () =>
        gridsService.record.update(resolved.page.record!.tableId, resolved.record.id, body.values, currentActorUserId(c), ifMatch, {
          dateConfig: getDateConfig(c),
          viewer: resolved.viewer,
          audit: body.audit,
          recordAccess: ALL_RECORD_ACCESS,
        }),
      );
    })
    .post("/runtime/:shortId/:pageId/:blockId/actions/:actionId", v("json", CustomAppActionInvocationSchema), async (c) => {
      const runtime = await resolvePublishedRuntime(c);
      if (!runtime) return c.json({ message: "Action not found" }, 404);
      const { app, capabilities, page, pageParams, viewer } = runtime;
      const block = page?.rows
        .flatMap((row) => row.columns.flatMap((column) => column.blocks))
        .find((candidate) => candidate.id === c.req.param("blockId") && candidate.type === "actions");
      const action = block?.type === "actions" ? block.actions.find((candidate) => candidate.id === c.req.param("actionId")) : null;
      if (!page || !pageParams || !block || block.type !== "actions" || !action || action.kind !== "workflow") {
        return c.json({ message: "Action not found" }, 404);
      }
      if (
        !(await runtime.available("block", block.availableWhen?.query, block.id)) ||
        !(await runtime.available("action", action.availableWhen?.query, block.id, action.id))
      ) {
        return c.json({ message: "Action not found" }, 404);
      }

      const capability = capabilities.workflowLaunchers.find(
        (candidate) =>
          candidate.pageId === page.id &&
          candidate.blockId === block.id &&
          candidate.actionId === action.id &&
          candidate.launcherId === action.launcherId,
      );
      if (!capability) return c.json({ message: "Action not found" }, 404);

      const records = new Map<string, GridRecord>();
      for (const [parameterId, parameter] of Object.entries(page.parameters)) {
        const recordId = pageParams[parameterId]!;
        const record = await gridsService.record.get(parameter.tableId, recordId, {
          viewer,
          recordAccess: ALL_RECORD_ACCESS,
        });
        if (!record) return c.json({ message: "Action not found" }, 404);
        records.set(parameterId, record);
      }
      const pageRecord = page.record ? records.get(page.record.id.path) : undefined;
      if (page.record && !pageRecord) return c.json({ message: "Action not found" }, 404);
      const inputs: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(action.inputs)) {
        const resolved =
          value.source === "LITERAL" ? value.value : value.source === "PARAMS" ? records.get(value.path)?.id : pageRecord?.id;
        if (resolved === undefined) return c.json({ message: "Action not found" }, 404);
        inputs[name] = resolved;
      }
      const result = await invokeCustomAppLauncher({
        launcherId: action.launcherId,
        operationId: c.req.valid("json").operationId,
        mode: "execute",
        expectedRevision: capability.revision,
        principal: currentWorkflowPrincipal(c),
        inputs,
        authorization: {
          kind: "custom-app-action",
          customAppId: app.id,
          pageId: page.id,
          blockId: block.id,
          actionId: action.id,
          revision: capability.revision,
        },
      });
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      return c.json({ runId: result.data.runId, workflowId: result.data.workflowId, status: result.data.status }, 202);
    })
    .get("/by-base/:baseId", requireUuidParam("baseId", "Base"), async (c) => {
      const baseId = c.req.param("baseId")!;
      const gate = await gateAt(c, { baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return c.json(await gridsService.customApp.listByBase(baseId));
    })
    .post("/by-base/:baseId", requireUuidParam("baseId", "Base"), v("json", CustomAppCreateSchema), async (c) => {
      const baseId = c.req.param("baseId")!;
      const gate = await gateAt(c, { baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(c, () => gridsService.customApp.createBlank(baseId, c.req.valid("json").name, currentActorUserId(c)));
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
    .put("/:appId/draft", requireUuidParam("appId", "Custom App"), v("json", CustomAppDefinitionInputSchema), async (c) => {
      const app = await gridsService.customApp.get(c.req.param("appId")!);
      if (!app) return c.json({ message: "Custom App not found" }, 404);
      const gate = await gateAt(c, { baseId: app.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(c, () => gridsService.customApp.saveDraft(app.id, c.req.valid("json").definition));
    })
    .post("/:appId/restore", requireUuidParam("appId", "Custom App"), async (c) => {
      const app = await gridsService.customApp.get(c.req.param("appId")!);
      if (!app) return c.json({ message: "Custom App not found" }, 404);
      const gate = await gateAt(c, { baseId: app.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(c, () => gridsService.customApp.restoreDraft(app.id, currentActorUserId(c)));
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
    })
    .post("/:appId/unpublish", requireUuidParam("appId", "Custom App"), async (c) => {
      const app = await gridsService.customApp.get(c.req.param("appId")!);
      if (!app) return c.json({ message: "Custom App not found" }, 404);
      const gate = await gateAt(c, { baseId: app.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(c, () => gridsService.customApp.unpublish(app.id, currentActorUserId(c)));
    })
    .delete("/:appId", requireUuidParam("appId", "Custom App"), async (c) => {
      const app = await gridsService.customApp.get(c.req.param("appId")!);
      if (!app) return c.json({ message: "Custom App not found" }, 404);
      const gate = await gateAt(c, { baseId: app.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const result = await gridsService.customApp.remove(app.id, currentActorUserId(c));
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.json({ id: app.id });
    });
};

export default createCustomAppsApi();

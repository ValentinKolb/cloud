import { type AuthContext, auth, getDateConfig, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { type GridRecord, RecordUpdateBodySchema } from "../contracts";
import { customAppPageRecordFieldIds } from "../custom-apps/conditions";
import { CUSTOM_APP_REFERENCE, CustomAppDefinitionInputSchema } from "../custom-apps/contracts";
import { customAppFileTokenMatchesContext, verifyCustomAppFileToken } from "../custom-apps/file-token";
import { projectCustomAppRecord } from "../custom-apps/record-projection";
import { customAppRecordsDisplayFieldHash, isSafeInlineCardImageMimeType } from "../custom-apps/records-display-capability";
import {
  customAppActionStatusUrl,
  customAppFormSuccessHref,
  customAppScannerRunUrl,
  customAppSidebarFormSuccessHref,
} from "../custom-apps/routing";
import { resolveCustomAppValueBinding } from "../custom-apps/value-bindings";
import { isRecordWritableFieldType } from "../field-types";
import { toWorkflowRunEventSummary } from "../lib/workflow-run-events";
import { gridsService } from "../service";
import { resolvePublishedCustomAppForm } from "../service/custom-app-published-form";
import { buildCustomAppRecordLabelCache } from "../service/custom-app-record-relations";
import { executePublishedCustomAppRecords } from "../service/custom-app-records-query";
import { ALL_RECORD_ACCESS } from "../service/record-access";
import { getWorkflowRunScope } from "../service/workflow-runs";
import { resolvePublishedCustomAppGlobalRuntime, resolvePublishedCustomAppRuntime } from "./custom-app-published-runtime";
import { encodeHeaderValue, pdfResponse } from "./download-response";
import { FormSubmitSchema, parseFormSubmission } from "./form-api-shared";
import { accessActorUser, currentActorUserId, currentWorkflowPrincipal, gateAt, gridsAccessContext } from "./permissions";
import { requireUuidParam } from "./route-params";
import { ScannerLauncherRequestSchema } from "./workflow-api-shared";

const DefinitionBaseSchema = z.object({ baseId: z.string().uuid() });
const CustomAppCreateSchema = z.object({ name: z.string().trim().min(1).max(200) }).strict();
const RecordCommentBodySchema = z.object({ body: z.string().max(10_000) }).strict();
const CustomAppActionInvocationSchema = z.object({ operationId: z.string().uuid() }).strict();
const CustomAppRowActionInvocationSchema = CustomAppActionInvocationSchema.extend({
  rowId: z.string().uuid(),
  search: z.string().max(200).optional(),
  cursor: z.string().max(16_384).optional(),
}).strict();
const CustomAppRecordsQuerySchema = z
  .object({ q: z.string().max(200).optional(), cursor: z.string().max(16_384).optional() })
  .passthrough();
const RecordCommentListQuerySchema = z
  .object({
    cursor: z.string().max(2_000).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .passthrough();

const sameStringRecord = (left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean => {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value], index) => rightEntries[index]?.[0] === key && rightEntries[index]?.[1] === value)
  );
};

const gateDefinitionAdmin = async (c: Parameters<typeof gateAt>[0], input: unknown) => {
  const parsed = DefinitionBaseSchema.safeParse(input);
  if (!parsed.success) return c.json({ diagnostics: parsed.error.issues }, 400);
  const gate = await gateAt(c, { baseId: parsed.data.baseId }, "admin");
  return gate.ok ? null : respond(c, () => Promise.resolve(gate));
};

const resolvePublishedRuntime = async (c: Context<AuthContext>) => {
  const access = gridsAccessContext(c);
  return resolvePublishedCustomAppRuntime({
    access,
    shortId: c.req.param("shortId") ?? "",
    pageId: c.req.param("pageId"),
    query: c.req.query(),
    dateConfig: getDateConfig(c),
    signal: c.req.raw.signal,
  });
};

type PublishedRuntime = NonNullable<Awaited<ReturnType<typeof resolvePublishedRuntime>>>;

const runtimeTimeZone = (runtime: { runtimeContext: { query: Record<string, unknown> } }): string => {
  const value = runtime.runtimeContext.query["time.timeZone"];
  return typeof value === "string" ? value : "UTC";
};

const resolvePublishedPageRun = async (c: Context<AuthContext>) => {
  // A page remains a current access boundary. Block/action visibility and
  // workflow executability are start/effect concerns and must not hide a run
  // after it has changed the state that originally made it available.
  return resolvePublishedRuntime(c);
};

const resolvePublishedSidebarRuntime = async (c: Context<AuthContext>) => {
  const access = gridsAccessContext(c);
  const runtime = await resolvePublishedCustomAppGlobalRuntime({
    access,
    shortId: c.req.param("shortId") ?? "",
    query: c.req.query(),
    dateConfig: getDateConfig(c),
    signal: c.req.raw.signal,
  });
  if (!runtime) return null;
  const action = runtime.definition.sidebar?.actions.find((candidate) => candidate.id === c.req.param("actionId"));
  if (!action) return null;
  if (!(await runtime.availableSidebarAction(action.id, action.availableWhen?.query))) return null;
  return { ...runtime, action, runtimeContext: runtime.globalRuntimeContext } as const;
};

const loadRuntimeBindingContext = async (runtime: PublishedRuntime) => {
  const parameterRecords = new Map<string, GridRecord>();
  for (const [parameterId, parameter] of Object.entries(runtime.page.parameters)) {
    const record = await gridsService.record.get(parameter.tableId, runtime.pageParams[parameterId]!, {
      viewer: runtime.viewer,
      recordAccess: ALL_RECORD_ACCESS,
      dateConfig: runtime.dateConfig,
    });
    if (!record) return null;
    parameterRecords.set(parameterId, record);
  }
  const pageRecord = runtime.page.record ? parameterRecords.get(runtime.page.record.id.path) : undefined;
  if (runtime.page.record && !pageRecord) return null;
  return { parameterRecords, pageRecord, currentUserId: accessActorUser(runtime.access)?.id };
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
  const block = runtime.blocks.get(c.req.param("blockId") ?? "");
  if (!block || block.type !== "form" || !(await runtime.available("block", block.availableWhen?.query, block.id))) {
    return c.json({ message: "Form not found" }, 404);
  }

  const resolvedForm = await resolvePublishedCustomAppForm({ surface: block, page, capabilities });
  if (!resolvedForm) return c.json({ message: "Form not found" }, 404);
  const { form } = resolvedForm;

  const bindingContext = await loadRuntimeBindingContext(runtime);
  if (!bindingContext) return c.json({ message: "Form not found" }, 404);

  const submission = parseFormSubmission(submitted);
  if (!submission) return c.json({ message: "Invalid form submission" }, 400);
  const fixedValues: Record<string, unknown> = {};
  for (const [fieldId, binding] of Object.entries(block.fixedValues)) {
    const resolved = resolveCustomAppValueBinding(binding, bindingContext);
    if (!resolved.ok) return c.json({ message: "Form not found" }, 404);
    fixedValues[fieldId] = resolved.value;
  }
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

const submitPublishedSidebarForm = async (c: Context<AuthContext>, submitted: Record<string, unknown>) => {
  const runtime = await resolvePublishedSidebarRuntime(c);
  if (!runtime || runtime.action.kind !== "form") return c.json({ message: "Form not found" }, 404);
  const { app, action, dateConfig, viewer } = runtime;
  const resolvedForm = await resolvePublishedCustomAppForm({ surface: action, capabilities: runtime.capabilities });
  if (!resolvedForm) return c.json({ message: "Form not found" }, 404);
  const { form } = resolvedForm;
  const submission = parseFormSubmission(submitted);
  if (!submission) return c.json({ message: "Invalid form submission" }, 400);
  const fixedValues: Record<string, unknown> = {};
  for (const [fieldId, binding] of Object.entries(action.fixedValues)) {
    const resolved = resolveCustomAppValueBinding(binding, {
      parameterRecords: new Map(),
      currentUserId: accessActorUser(runtime.access)?.id,
    });
    if (!resolved.ok) return c.json({ message: "Form not found" }, 404);
    fixedValues[fieldId] = resolved.value;
  }
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
  const navigateTo = action.onSuccessNavigate
    ? customAppSidebarFormSuccessHref(app.shortId, action.onSuccessNavigate, result.data.recordId)
    : undefined;
  return c.json({ recordId: result.data.recordId, navigateTo }, 201);
};

const resolveRuntimeScanner = async (c: Context<AuthContext>) => {
  const runtime = await resolvePublishedRuntime(c);
  if (!runtime) return null;
  const block = runtime.blocks.get(c.req.param("blockId") ?? "");
  if (!block || block.type !== "scanner" || !(await runtime.available("block", block.availableWhen?.query, block.id))) return null;
  const capability = runtime.capabilities.scannerLaunchers.find(
    (candidate) => candidate.pageId === runtime.page.id && candidate.blockId === block.id && candidate.launcherId === block.launcherId,
  );
  return capability ? { runtime, block, capability } : null;
};

export const createCustomAppsApi = (
  deps: {
    loadOptionalActor?: MiddlewareHandler<AuthContext>;
    requireAuthenticated?: MiddlewareHandler<AuthContext>;
    invokeCustomAppLauncher?: typeof gridsService.workflow.launcher.invokeCustomApp;
    invokeScannerLauncher?: typeof gridsService.workflow.launcher.invokeScanner;
    renderDocumentRunPdf?: typeof gridsService.document.renderRunPdf;
    getWorkflowRunScope?: typeof getWorkflowRunScope;
    getWorkflowRun?: typeof gridsService.workflow.getRun;
  } = {},
) => {
  const loadOptionalActor = deps.loadOptionalActor ?? auth.requireRole("*");
  const invokeCustomAppLauncher = deps.invokeCustomAppLauncher ?? gridsService.workflow.launcher.invokeCustomApp;
  const invokeScannerLauncher = deps.invokeScannerLauncher ?? gridsService.workflow.launcher.invokeScanner;
  const renderDocumentRunPdf = deps.renderDocumentRunPdf ?? gridsService.document.renderRunPdf;
  const loadWorkflowRunScope = deps.getWorkflowRunScope ?? getWorkflowRunScope;
  const getWorkflowRun = deps.getWorkflowRun ?? gridsService.workflow.getRun;
  return new Hono<AuthContext>()
    .get("/runtime/:shortId/:pageId/:blockId/records", loadOptionalActor, v("query", CustomAppRecordsQuerySchema), async (c) => {
      const runtime = await resolvePublishedRuntime(c);
      if (!runtime) return c.json({ message: "Records not found" }, 404);
      const block = runtime.blocks.get(c.req.param("blockId") ?? "");
      if (!block || block.type !== "records" || !(await runtime.available("block", block.availableWhen?.query, block.id))) {
        return c.json({ message: "Records not found" }, 404);
      }
      const query = c.req.valid("query");
      const published = await executePublishedCustomAppRecords({
        baseId: runtime.app.baseId,
        customAppId: runtime.app.id,
        publishedAt: runtime.app.publishedAt!,
        page: runtime.page,
        pageParams: runtime.pageParams,
        block,
        capabilities: runtime.capabilities,
        context: runtime.runtimeContext.query,
        signal: c.req.raw.signal,
        timeZone: runtime.runtimeContext.query["time.timeZone"],
        viewer: runtime.viewer,
        viewerUserId: runtime.viewer.userId,
        viewerServiceAccountId: runtime.viewer.serviceAccountId ?? null,
        search: query.q,
        cursor: query.cursor,
      }).catch(() => null);
      if (!published) return c.json({ message: "Records not found" }, 404);
      const payload = published.response.ok
        ? {
            ...published.response,
            ...(published.presentation ? { presentation: published.presentation } : {}),
            ...(published.cards ? { cards: published.cards } : {}),
          }
        : published.response;
      return c.json(payload, published.response.ok ? 200 : 400);
    })
    .post("/runtime/:shortId/:pageId/:blockId/submit", loadOptionalActor, v("json", FormSubmitSchema), (c) =>
      submitPublishedCustomAppForm(c, c.req.valid("json")),
    )
    .post("/runtime/:shortId/sidebar/forms/:actionId/submit", loadOptionalActor, v("json", FormSubmitSchema), (c) =>
      submitPublishedSidebarForm(c, c.req.valid("json")),
    )
    .get(
      "/runtime/:shortId/:pageId/:blockId/documents/:runId/download",
      loadOptionalActor,
      requireUuidParam("runId", "Document run"),
      async (c) => {
        const runtime = await resolvePublishedRuntime(c);
        if (!runtime) return c.json({ message: "Document not found" }, 404);
        const block = runtime.blocks.get(c.req.param("blockId") ?? "");
        if (!runtime.page.record || !block || block.type !== "record" || !block.documents) {
          return c.json({ message: "Document not found" }, 404);
        }
        if (!(await runtime.available("block", block.availableWhen?.query, block.id))) {
          return c.json({ message: "Document not found" }, 404);
        }
        const templateIds = [...block.documents.templateIds].sort();
        const capability = runtime.capabilities.documents.find(
          (candidate) =>
            candidate.pageId === runtime.page.id &&
            candidate.blockId === block.id &&
            candidate.tableId === runtime.page.record!.tableId &&
            candidate.templateIds.join("\0") === templateIds.join("\0"),
        );
        const bindingContext = capability ? await loadRuntimeBindingContext(runtime) : null;
        const record = bindingContext?.pageRecord;
        const run = record ? await gridsService.document.getRun(c.req.param("runId")!) : null;
        if (
          !capability ||
          !record ||
          !run ||
          run.baseId !== runtime.app.baseId ||
          run.tableId !== runtime.page.record.tableId ||
          run.recordId !== record.id ||
          !run.templateId ||
          !templateIds.includes(run.templateId)
        ) {
          return c.json({ message: "Document not found" }, 404);
        }
        const pdf = await renderDocumentRunPdf(run);
        if (!pdf.ok) return c.json({ message: pdf.error.message }, pdf.error.status);
        return pdfResponse(pdf.data.pdf, run.filename, {
          "X-Grids-Document-Run-Id": run.id,
          "X-Grids-Document-Number": run.documentNumber,
          "X-Grids-Document-Filename": encodeHeaderValue(run.filename),
        });
      },
    )
    .get("/runtime/:shortId/:pageId/:blockId/files/:token", loadOptionalActor, async (c) => {
      const runtime = await resolvePublishedRuntime(c);
      const secret = process.env.APP_SECRET?.trim();
      const token = secret ? verifyCustomAppFileToken(c.req.param("token") ?? "", secret) : null;
      if (
        !runtime ||
        !token ||
        !customAppFileTokenMatchesContext(token, {
          appId: runtime.app.id,
          publishedAt: runtime.app.publishedAt!,
          pageId: runtime.page.id,
          blockId: c.req.param("blockId") ?? "",
          pageParams: runtime.pageParams,
          viewerUserId: runtime.viewer.userId,
          viewerServiceAccountId: runtime.viewer.serviceAccountId ?? null,
        })
      ) {
        return c.json({ message: "File not found" }, 404);
      }
      const block = runtime.blocks.get(token.blockId);
      if (!block || block.type !== "records" || block.display.kind !== "cards" || block.source.kind !== "view") {
        return c.json({ message: "File not found" }, 404);
      }
      if (!(await runtime.available("block", block.availableWhen?.query, block.id))) {
        return c.json({ message: "File not found" }, 404);
      }
      const currentRecords = await executePublishedCustomAppRecords({
        baseId: runtime.app.baseId,
        customAppId: runtime.app.id,
        publishedAt: runtime.app.publishedAt!,
        page: runtime.page,
        pageParams: runtime.pageParams,
        block,
        capabilities: runtime.capabilities,
        context: runtime.runtimeContext.query,
        signal: c.req.raw.signal,
        timeZone: runtimeTimeZone(runtime),
        viewer: runtime.viewer,
        viewerUserId: runtime.viewer.userId,
        viewerServiceAccountId: runtime.viewer.serviceAccountId ?? null,
        search: token.search ?? undefined,
        cursor: token.cursor ?? undefined,
      }).catch(() => null);
      if (!currentRecords?.response.ok || !currentRecords.response.rows.some((row) => row.recordId === token.recordId)) {
        return c.json({ message: "File not found" }, 404);
      }
      const viewId = block.source.viewId;
      const capability = runtime.capabilities.views.find((candidate) => candidate.viewId === viewId && candidate.tableId === token.tableId);
      if (!capability?.displayConfig || !capability.displayFieldHash || capability.displayConfig.cards?.imageFieldId !== token.fieldId) {
        return c.json({ message: "File not found" }, 404);
      }
      const fields = await gridsService.field.listByTable(token.tableId, true);
      if (customAppRecordsDisplayFieldHash(capability.displayConfig, fields) !== capability.displayFieldHash) {
        return c.json({ message: "File not found" }, 404);
      }
      // The token is minted only for an authorized preview returned by this
      // exact published source. App access and display drift are rechecked.
      const result = await gridsService.file.getContent({
        tableId: token.tableId,
        recordId: token.recordId,
        fieldId: token.fieldId,
        fileId: token.fileId,
      });
      if (!result.ok) return c.json({ message: "File not found" }, 404);
      const file = result.data;
      if (!isSafeInlineCardImageMimeType(file.mimeType)) return c.json({ message: "File not found" }, 404);
      const buffer = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer;
      return new Response(new Blob([buffer], { type: file.mimeType }), {
        headers: {
          "Content-Type": file.mimeType,
          "Content-Disposition": `inline; filename="${encodeURIComponent(file.filename)}"`,
          "Cache-Control": "private, max-age=300",
          "X-Content-Type-Options": "nosniff",
        },
      });
    })
    .use(deps.requireAuthenticated ?? auth.requireRole("authenticated"))
    .post("/runtime/:shortId/:pageId/:blockId/scanner", v("json", ScannerLauncherRequestSchema), async (c) => {
      const resolved = await resolveRuntimeScanner(c);
      if (!resolved) return c.json({ message: "Scanner not found" }, 404);
      const { runtime, block, capability } = resolved;
      const result = await invokeScannerLauncher({
        ...c.req.valid("json"),
        launcherId: block.launcherId,
        expectedRevision: capability.revision,
        principal: currentWorkflowPrincipal(c),
        authorization: {
          kind: "custom-app-scanner",
          customAppId: runtime.app.id,
          publishedAt: runtime.app.publishedAt,
          pageId: runtime.page.id,
          pageParams: runtime.pageParams,
          timeZone: runtimeTimeZone(runtime),
          blockId: block.id,
          revision: capability.revision,
          configHash: capability.configHash,
        },
      });
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      return c.json(
        {
          ...result.data,
          statusUrl: customAppScannerRunUrl(runtime.app.shortId, runtime.page.id, block.id, result.data.runId, runtime.pageParams),
        },
        202,
      );
    })
    .get("/runtime/:shortId/:pageId/:blockId/scanner/runs/:runId", requireUuidParam("runId", "Workflow run"), async (c) => {
      const resolved = await resolveRuntimeScanner(c);
      if (!resolved) return c.json({ message: "Workflow run not found" }, 404);
      const { runtime, block, capability } = resolved;
      const principal = currentWorkflowPrincipal(c);
      const [scope, run] = await Promise.all([loadWorkflowRunScope(c.req.param("runId")!), getWorkflowRun(c.req.param("runId")!)]);
      if (
        !scope ||
        !run ||
        scope.principal.userId !== principal.userId ||
        scope.principal.serviceAccountId !== principal.serviceAccountId ||
        (scope.principal.actorServiceAccountId ?? null) !== (principal.actorServiceAccountId ?? null) ||
        scope.launcherId !== capability.launcherId ||
        scope.workflow.id !== capability.workflowId ||
        run.workflowRevision !== capability.revision ||
        scope.authorization.kind !== "custom-app-scanner" ||
        scope.authorization.customAppId !== runtime.app.id ||
        scope.authorization.publishedAt !== runtime.app.publishedAt ||
        scope.authorization.pageId !== runtime.page.id ||
        !sameStringRecord(scope.authorization.pageParams, runtime.pageParams) ||
        scope.authorization.blockId !== block.id ||
        scope.authorization.revision !== capability.revision ||
        scope.authorization.configHash !== capability.configHash
      ) {
        return c.json({ message: "Workflow run not found" }, 404);
      }
      return c.json(toWorkflowRunEventSummary(run));
    })
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

      const result = await gridsService.record.update(
        resolved.page.record!.tableId,
        resolved.record.id,
        body.values,
        currentActorUserId(c),
        ifMatch,
        {
          dateConfig: getDateConfig(c),
          viewer: resolved.viewer,
          audit: body.audit,
          recordAccess: ALL_RECORD_ACCESS,
        },
      );
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      const visibleFieldIds = new Set(resolved.block.fieldIds);
      const visibleFields = fields.filter((field) => visibleFieldIds.has(field.id));
      const visibleRelations = resolved.capability.relationLabels.filter((relation) => visibleFieldIds.has(relation.fieldId));
      const relationTableIds = [
        resolved.page.record!.tableId,
        ...new Set(resolved.capability.relationLabels.map((relation) => relation.targetTableId)),
      ];
      const relationViewer = {
        ...resolved.viewer,
        isAdmin: false,
        readableTableIds: new Set(relationTableIds),
        recordAccessByTableId: new Map(relationTableIds.map((tableId) => [tableId, ALL_RECORD_ACCESS])),
      };
      const relationLabels = await buildCustomAppRecordLabelCache({
        records: [result.data],
        fields: visibleFields,
        relations: visibleRelations,
        viewer: relationViewer,
        actorUserId: currentActorUserId(c),
      }).catch(() => ({}));
      return c.json({ ...projectCustomAppRecord(result.data, resolved.block.fieldIds), relationLabels });
    })
    .post("/runtime/:shortId/:pageId/:blockId/actions/:actionId", v("json", CustomAppActionInvocationSchema), async (c) => {
      const runtime = await resolvePublishedRuntime(c);
      if (!runtime) return c.json({ message: "Action not found" }, 404);
      const { app, capabilities, page, pageParams } = runtime;
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
          "pageId" in candidate &&
          candidate.pageId === page.id &&
          candidate.blockId === block.id &&
          candidate.actionId === action.id &&
          candidate.launcherId === action.launcherId,
      );
      if (!capability) return c.json({ message: "Action not found" }, 404);

      const bindingContext = await loadRuntimeBindingContext(runtime);
      if (!bindingContext) return c.json({ message: "Action not found" }, 404);
      const inputs: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(action.inputs)) {
        const resolved = resolveCustomAppValueBinding(value, bindingContext);
        if (!resolved.ok) return c.json({ message: "Action not found" }, 404);
        inputs[name] = resolved.value;
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
          publishedAt: app.publishedAt,
          pageId: page.id,
          pageParams,
          timeZone: runtimeTimeZone(runtime),
          blockId: block.id,
          actionId: action.id,
          revision: capability.revision,
        },
      });
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      return c.json(
        {
          runId: result.data.runId,
          workflowId: result.data.workflowId,
          status: result.data.status,
          statusUrl: customAppActionStatusUrl(app.shortId, page.id, block.id, action.id, result.data.runId, pageParams),
        },
        202,
      );
    })
    .post("/runtime/:shortId/:pageId/:blockId/row-actions/:actionId", v("json", CustomAppRowActionInvocationSchema), async (c) => {
      const runtime = await resolvePublishedRuntime(c);
      if (!runtime) return c.json({ message: "Action not found" }, 404);
      const { app, capabilities, page, pageParams } = runtime;
      const block = runtime.blocks.get(c.req.param("blockId") ?? "");
      const action = block?.type === "records" ? block.rowActions?.find((candidate) => candidate.id === c.req.param("actionId")) : null;
      if (!block || block.type !== "records" || !action) return c.json({ message: "Action not found" }, 404);
      if (
        !(await runtime.available("block", block.availableWhen?.query, block.id)) ||
        !(await runtime.available("action", action.availableWhen?.query, block.id, action.id))
      ) {
        return c.json({ message: "Action not found" }, 404);
      }
      const capability = capabilities.workflowLaunchers.find(
        (candidate) =>
          "pageId" in candidate &&
          candidate.pageId === page.id &&
          candidate.blockId === block.id &&
          candidate.actionId === action.id &&
          candidate.launcherId === action.launcherId,
      );
      if (!capability) return c.json({ message: "Action not found" }, 404);

      const published = await executePublishedCustomAppRecords({
        baseId: app.baseId,
        customAppId: app.id,
        publishedAt: app.publishedAt!,
        page,
        pageParams,
        block,
        capabilities,
        context: runtime.runtimeContext.query,
        signal: c.req.raw.signal,
        timeZone: runtime.runtimeContext.query["time.timeZone"],
        viewer: runtime.viewer,
        viewerUserId: runtime.viewer.userId,
        viewerServiceAccountId: runtime.viewer.serviceAccountId ?? null,
        search: c.req.valid("json").search,
        cursor: c.req.valid("json").cursor,
      }).catch(() => null);
      const rowId = c.req.valid("json").rowId;
      if (!published?.response.ok || !published.response.rows.some((row) => row.recordId === rowId)) {
        return c.json({ message: "Action not found" }, 404);
      }

      const bindingContext = await loadRuntimeBindingContext(runtime);
      if (!bindingContext) return c.json({ message: "Action not found" }, 404);
      const inputs: Record<string, unknown> = {};
      for (const [name, binding] of Object.entries(action.inputs)) {
        const resolved = resolveCustomAppValueBinding(binding, { ...bindingContext, rowRecordId: rowId });
        if (!resolved.ok) return c.json({ message: "Action not found" }, 404);
        inputs[name] = resolved.value;
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
          publishedAt: app.publishedAt,
          pageId: page.id,
          pageParams,
          timeZone: runtimeTimeZone(runtime),
          blockId: block.id,
          actionId: action.id,
          recordId: rowId,
          search: c.req.valid("json").search,
          cursor: c.req.valid("json").cursor,
          revision: capability.revision,
        },
      });
      if (!result.ok) return respond(c, () => Promise.resolve(result));
      return c.json(
        {
          runId: result.data.runId,
          workflowId: result.data.workflowId,
          status: result.data.status,
          statusUrl: customAppActionStatusUrl(app.shortId, page.id, block.id, action.id, result.data.runId, pageParams),
        },
        202,
      );
    })
    .get("/runtime/:shortId/:pageId/:blockId/actions/:actionId/runs/:runId", requireUuidParam("runId", "Workflow run"), async (c) => {
      const runtime = await resolvePublishedPageRun(c);
      if (!runtime) return c.json({ message: "Workflow run not found" }, 404);
      const block = runtime.blocks.get(c.req.param("blockId") ?? "");
      const action =
        block?.type === "actions"
          ? block.actions.find((candidate) => candidate.id === c.req.param("actionId") && candidate.kind === "workflow")
          : block?.type === "records"
            ? block.rowActions?.find((candidate) => candidate.id === c.req.param("actionId"))
            : null;
      const workflowAction = action && "launcherId" in action ? action : null;
      if (!block || !workflowAction) {
        return c.json({ message: "Workflow run not found" }, 404);
      }
      const capability = workflowAction
        ? runtime.capabilities.workflowLaunchers.find(
            (candidate) =>
              "pageId" in candidate &&
              candidate.pageId === runtime.page.id &&
              candidate.blockId === block!.id &&
              candidate.actionId === workflowAction.id &&
              candidate.launcherId === workflowAction.launcherId,
          )
        : null;
      const principal = currentWorkflowPrincipal(c);
      const [scope, run] = capability
        ? await Promise.all([loadWorkflowRunScope(c.req.param("runId")!), getWorkflowRun(c.req.param("runId")!)])
        : [null, null];
      const authorization = scope?.authorization;
      if (
        !block ||
        !workflowAction ||
        !capability ||
        !scope ||
        !run ||
        scope.principal.userId !== principal.userId ||
        scope.principal.serviceAccountId !== principal.serviceAccountId ||
        (scope.principal.actorServiceAccountId ?? null) !== (principal.actorServiceAccountId ?? null) ||
        scope.launcherId !== capability.launcherId ||
        scope.workflow.id !== capability.workflowId ||
        run.workflowRevision !== capability.revision ||
        authorization?.kind !== "custom-app-action" ||
        authorization.customAppId !== runtime.app.id ||
        authorization.publishedAt !== runtime.app.publishedAt ||
        authorization.pageId !== runtime.page.id ||
        !sameStringRecord(authorization.pageParams, runtime.pageParams) ||
        authorization.blockId !== block.id ||
        authorization.actionId !== workflowAction.id ||
        authorization.revision !== capability.revision
      ) {
        return c.json({ message: "Workflow run not found" }, 404);
      }
      const status =
        run.status === "succeeded" ? "succeeded" : ["failed", "canceled", "needs_attention"].includes(run.status) ? "failed" : "running";
      return c.json({ status, message: run.resultMessage });
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
    .get("/:appId", requireUuidParam("appId", "Grids App"), async (c) => {
      const app = await gridsService.customApp.get(c.req.param("appId")!);
      if (!app) return c.json({ message: "Grids App not found" }, 404);
      const gate = await gateAt(c, { baseId: app.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return c.json(app);
    })
    .put("/:appId/draft", requireUuidParam("appId", "Grids App"), v("json", CustomAppDefinitionInputSchema), async (c) => {
      const app = await gridsService.customApp.get(c.req.param("appId")!);
      if (!app) return c.json({ message: "Grids App not found" }, 404);
      const gate = await gateAt(c, { baseId: app.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(c, () => gridsService.customApp.saveDraft(app.id, c.req.valid("json").definition));
    })
    .post("/:appId/restore", requireUuidParam("appId", "Grids App"), async (c) => {
      const app = await gridsService.customApp.get(c.req.param("appId")!);
      if (!app) return c.json({ message: "Grids App not found" }, 404);
      const gate = await gateAt(c, { baseId: app.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(c, () => gridsService.customApp.restoreDraft(app.id, currentActorUserId(c)));
    })
    .get("/:appId/export", requireUuidParam("appId", "Grids App"), async (c) => {
      const app = await gridsService.customApp.get(c.req.param("appId")!);
      if (!app) return c.json({ message: "Grids App not found" }, 404);
      const gate = await gateAt(c, { baseId: app.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return c.json(app.draftDefinition);
    })
    .post("/:appId/publish", requireUuidParam("appId", "Grids App"), async (c) => {
      const app = await gridsService.customApp.get(c.req.param("appId")!);
      if (!app) return c.json({ message: "Grids App not found" }, 404);
      const gate = await gateAt(c, { baseId: app.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(c, () => gridsService.customApp.publish(app.id, currentActorUserId(c)));
    })
    .post("/:appId/unpublish", requireUuidParam("appId", "Grids App"), async (c) => {
      const app = await gridsService.customApp.get(c.req.param("appId")!);
      if (!app) return c.json({ message: "Grids App not found" }, 404);
      const gate = await gateAt(c, { baseId: app.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      return respond(c, () => gridsService.customApp.unpublish(app.id, currentActorUserId(c)));
    })
    .delete("/:appId", requireUuidParam("appId", "Grids App"), async (c) => {
      const app = await gridsService.customApp.get(c.req.param("appId")!);
      if (!app) return c.json({ message: "Grids App not found" }, 404);
      const gate = await gateAt(c, { baseId: app.baseId }, "admin");
      if (!gate.ok) return respond(c, () => Promise.resolve(gate));
      const result = await gridsService.customApp.remove(app.id, currentActorUserId(c));
      if (!result.ok) return c.json({ message: result.error.message }, result.error.status);
      return c.json({ id: app.id });
    });
};

export default createCustomAppsApi();

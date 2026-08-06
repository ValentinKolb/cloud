import { MarkdownView } from "@k2b/ui";
import { type AuthContext, getDateConfig } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { executeSavedViewSourceForContext } from "../../api/gql-runtime";
import {
  actorViewerFor,
  gridsAccessContext,
  hasExplicitGrant,
  resolveRecordAccessForAccess,
  resolveWithGrantsForAccess,
} from "../../api/permissions";
import { ssr } from "../../config";
import type { DslQueryPreviewResponse, Field, GridRecord } from "../../contracts";
import type { CustomAppBlock, CustomAppDefinition, CustomAppPage } from "../../custom-apps/contracts";
import { customAppFormMatchesPublishedCapability } from "../../custom-apps/form-runtime";
import {
  customAppCommentsUrl,
  customAppActionHref,
  customAppActionUrl,
  customAppFormSubmitUrl,
  customAppPageHref,
  customAppRecordUpdateUrl,
  resolveCustomAppPage,
  resolveCustomAppPageParams,
} from "../../custom-apps/routing";
import { gridsService } from "../../service";
import type { PublicRenderableForm } from "../../service/forms";
import FormSubmit from "../_components/forms/PublicFormSubmit.island";
import RecordComments from "../_components/records/RecordComments.island";
import RecordsTable from "./RecordsTable.island";
import Actions, { type CustomAppRenderedAction } from "./Actions.island";
import RecordDetails from "./RecordDetails.island";

type RecordsBlock = Extract<CustomAppBlock, { type: "records" }>;
type RecordBlock = Extract<CustomAppBlock, { type: "record" }>;
type FormBlock = Extract<CustomAppBlock, { type: "form" }>;
type CommentsBlock = Extract<CustomAppBlock, { type: "comments" }>;
type ActionsBlock = Extract<CustomAppBlock, { type: "actions" }>;
type QuerySuccess = Extract<DslQueryPreviewResponse, { ok: true }>;
type BlockResult = { ok: true; result: QuerySuccess } | { ok: false; message: string };
type PageRecord = {
  record: GridRecord;
  fields: Field[];
  relationLabels: Record<string, string>;
  tableName: string;
  auditPolicy: NonNullable<Awaited<ReturnType<typeof gridsService.table.get>>>["auditPolicy"];
};
type FormBlockData =
  | {
      ok: true;
      form: PublicRenderableForm;
      fields: Field[];
      inlineTargetFields: Record<string, Field[]>;
      submitUrl: string;
    }
  | { ok: false; message: string };

const Records = (props: { block: RecordsBlock; data: BlockResult; shortId: string }) => {
  if (!props.data.ok) {
    return <div class="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{props.data.message}</div>;
  }
  return (
    <RecordsTable
      title={props.block.title ?? "Records"}
      emptyText={props.block.emptyText ?? "No records found."}
      shortId={props.shortId}
      selectedColumnIds={props.block.display.columnIds}
      result={props.data.result}
      rowNavigate={props.block.rowNavigate}
    />
  );
};

const Record = (props: {
  block: RecordBlock;
  pageRecord: PageRecord | null;
  baseId: string;
  updateEndpoint?: string;
  dateConfig: ReturnType<typeof getDateConfig>;
}) => {
  if (!props.pageRecord) {
    return <div class="rounded-xl border p-4 text-sm text-secondary">{props.block.emptyText ?? "Record not found."}</div>;
  }
  return (
    <RecordDetails
      block={props.block}
      baseId={props.baseId}
      tableName={props.pageRecord.tableName}
      auditPolicy={props.pageRecord.auditPolicy}
      record={props.pageRecord.record}
      fields={props.pageRecord.fields}
      relationLabels={props.pageRecord.relationLabels}
      updateEndpoint={props.updateEndpoint}
      dateConfig={props.dateConfig}
    />
  );
};

const Form = (props: { block: FormBlock; data: FormBlockData; dateConfig: ReturnType<typeof getDateConfig> }) => {
  if (!props.data.ok) {
    return <div class="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{props.data.message}</div>;
  }
  return (
    <FormSubmit
      submitUrl={props.data.submitUrl}
      form={props.data.form}
      fields={props.data.fields}
      inlineTargetFields={props.data.inlineTargetFields}
      dateConfig={props.dateConfig}
      surface="bare"
    />
  );
};

const CustomAppPage = (props: {
  definition: CustomAppDefinition;
  page: CustomAppPage;
  shortId: string;
  results: Map<string, BlockResult>;
  forms: Map<string, FormBlockData>;
  commentEndpoints: Map<string, string>;
  actions: Map<string, CustomAppRenderedAction[]>;
  recordUpdateEndpoints: Map<string, string>;
  pageRecord: PageRecord | null;
  dateConfig: ReturnType<typeof getDateConfig>;
}) => {
  const navigation = props.definition.pages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) => page.navigation.visible)
    .sort((left, right) => left.page.navigation.order - right.page.navigation.order || left.index - right.index);
  return (
    <main class="mx-auto flex w-full max-w-[96rem] flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <header class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          {props.definition.icon ? <i class={`ti ti-${props.definition.icon} text-2xl text-accent`} aria-hidden="true" /> : null}
          <div>
            <p class="text-sm text-secondary">{props.definition.name}</p>
            <h1 class="text-2xl font-semibold">{props.page.title}</h1>
          </div>
        </div>
        {navigation.length > 1 ? (
          <nav aria-label="App pages" class="flex flex-wrap items-center gap-1 rounded-xl bg-subtle p-1">
            {navigation.map(({ page }) => (
              <a
                href={customAppPageHref(props.shortId, page.id)}
                aria-current={page.id === props.page.id ? "page" : undefined}
                class={`rounded-lg px-3 py-1.5 text-sm font-medium ${page.id === props.page.id ? "bg-surface text-primary shadow-sm" : "text-secondary hover:text-primary"}`}
              >
                {page.title}
              </a>
            ))}
          </nav>
        ) : null}
      </header>
      {props.page.rows.map((row) => (
        <div class="flex flex-wrap gap-4">
          {row.columns.map((column) => (
            <section class="min-w-0 basis-80" style={{ flex: `${column.span} 1 20rem` }}>
              <div class="flex flex-col gap-4">
                {column.blocks.map((block) => (
                  <article class="paper p-4 sm:p-5">
                    {block.title && block.type !== "comments" ? <h2 class="mb-3 text-base font-semibold">{block.title}</h2> : null}
                    {block.type === "markdown" ? (
                      <MarkdownView markdown={block.markdown} smallHeadings />
                    ) : block.type === "records" ? (
                      <Records
                        block={block}
                        data={props.results.get(block.id) ?? { ok: false, message: "Records are unavailable." }}
                        shortId={props.shortId}
                      />
                    ) : block.type === "record" ? (
                      <Record
                        block={block}
                        pageRecord={props.pageRecord}
                        baseId={props.definition.baseId}
                        updateEndpoint={props.recordUpdateEndpoints.get(block.id)}
                        dateConfig={props.dateConfig}
                      />
                    ) : block.type === "comments" ? (
                      <RecordComments
                        endpoint={props.commentEndpoints.get(block.id) ?? ""}
                        title={block.title}
                        emptyText={block.emptyText}
                        dateConfig={props.dateConfig}
                      />
                    ) : block.type === "actions" ? (
                      <Actions actions={props.actions.get(block.id) ?? []} />
                    ) : (
                      <Form
                        block={block}
                        data={props.forms.get(block.id) ?? { ok: false, message: "This form is unavailable." }}
                        dateConfig={props.dateConfig}
                      />
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ))}
    </main>
  );
};

export default ssr<AuthContext>(async (c) => {
  const app = await gridsService.customApp.getPublishedByShortId(c.req.param("shortId") ?? "");
  if (!app?.publishedDefinition || !app.publishedCapabilities) return c.notFound();

  const requestAccess = gridsAccessContext(c);
  const access = await resolveWithGrantsForAccess(requestAccess, { baseId: app.baseId, customAppId: app.id });
  if (!hasExplicitGrant(access.grants, "customApp", app.id) || !gridsService.permission.hasAtLeast(access.level, "read")) {
    return c.notFound();
  }

  const definition = app.publishedDefinition;
  const page = resolveCustomAppPage(definition, c.req.param("pageId"));
  if (!page) return c.notFound();
  const dateConfig = getDateConfig(c);
  const pageParams = resolveCustomAppPageParams(page, c.req.query());
  if (!pageParams) return c.notFound();
  const viewer = actorViewerFor(requestAccess);
  const parameterRecords = new Map<string, GridRecord>();
  for (const [parameterId, parameter] of Object.entries(page.parameters)) {
    const parameterAccess = await resolveRecordAccessForAccess(requestAccess, { baseId: app.baseId, tableId: parameter.tableId }, "read");
    if (!parameterAccess.ok) return c.notFound();
    const record = await gridsService.record.get(parameter.tableId, pageParams[parameterId]!, {
      viewer,
      recordAccess: parameterAccess.data.recordAccess,
      dateConfig,
    });
    if (!record) return c.notFound();
    parameterRecords.set(parameterId, record);
  }

  let pageRecord: PageRecord | null = null;
  const recordUpdateEndpoints = new Map<string, string>();
  if (page.record) {
    const capability = app.publishedCapabilities.records.find(
      (candidate) => candidate.pageId === page.id && candidate.tableId === page.record!.tableId,
    );
    const expectedFieldIds = [
      ...new Set(
        page.rows.flatMap((row) =>
          row.columns.flatMap((column) => column.blocks.flatMap((block) => (block.type === "record" ? block.fieldIds : []))),
        ),
      ),
    ].sort();
    const expectedEditableFieldIds = [
      ...new Set(
        page.rows.flatMap((row) =>
          row.columns.flatMap((column) =>
            column.blocks.flatMap((block) => (block.type === "record" ? block.editableFieldIds : [])),
          ),
        ),
      ),
    ].sort();
    if (
      !capability ||
      capability.fieldIds.join("\0") !== expectedFieldIds.join("\0") ||
      capability.editableFieldIds.join("\0") !== expectedEditableFieldIds.join("\0")
    ) {
      return c.notFound();
    }
    const record = parameterRecords.get(page.record.id.path);
    if (!record) return c.notFound();
    const allowed = new Set(capability.fieldIds);
    const fields = (await gridsService.field.listByTable(page.record.tableId)).filter((field) => allowed.has(field.id));
    if (fields.length !== allowed.size) return c.notFound();
    const table = await gridsService.table.get(page.record.tableId);
    if (!table) return c.notFound();
    const relationLabels = await gridsService.relations.buildLabelCache([record], fields, viewer);
    pageRecord = { record, fields, relationLabels, tableName: table.name, auditPolicy: table.auditPolicy };

    if (expectedEditableFieldIds.length > 0) {
      const writeAccess = await resolveRecordAccessForAccess(requestAccess, { baseId: app.baseId, tableId: page.record.tableId }, "write");
      const writableRecord = writeAccess.ok
        ? await gridsService.record.get(page.record.tableId, record.id, {
            viewer,
            recordAccess: writeAccess.data.recordAccess,
            dateConfig,
          })
        : null;
      if (writableRecord) {
        for (const block of page.rows.flatMap((row) =>
          row.columns.flatMap((column) => column.blocks.filter((candidate): candidate is RecordBlock => candidate.type === "record")),
        )) {
          if (block.editableFieldIds.length > 0) {
            recordUpdateEndpoints.set(block.id, customAppRecordUpdateUrl(app.shortId, page.id, block.id, pageParams));
          }
        }
      }
    }
  }

  const allowedViews = new Set(app.publishedCapabilities.views.map((view) => view.viewId));
  const blocks = page.rows.flatMap((row) =>
    row.columns.flatMap((column) => column.blocks.filter((block): block is RecordsBlock => block.type === "records")),
  );
  const entries = await Promise.all(
    blocks.map(async (block): Promise<[string, BlockResult]> => {
      if (!allowedViews.has(block.source.viewId)) return [block.id, { ok: false, message: "This view is not part of the published app." }];
      const result = await executeSavedViewSourceForContext(
        { access: requestAccess, dateConfig, signal: c.req.raw.signal },
        app.baseId,
        block.source.viewId,
        { maxRows: 100, operation: "execute" },
      );
      return result.ok
        ? [block.id, { ok: true, result }]
        : [block.id, { ok: false, message: result.diagnostics[0]?.message ?? "This view is unavailable." }];
    }),
  );
  const results = new Map(entries);
  const commentBlocks = page.rows.flatMap((row) =>
    row.columns.flatMap((column) => column.blocks.filter((block): block is CommentsBlock => block.type === "comments")),
  );
  const commentEndpoints = new Map<string, string>();
  for (const block of commentBlocks) {
    const capability = app.publishedCapabilities.comments.find(
      (candidate) => candidate.pageId === page.id && candidate.blockId === block.id && candidate.tableId === page.record?.tableId,
    );
    if (!capability || !page.record || !pageRecord) return c.notFound();
    commentEndpoints.set(block.id, customAppCommentsUrl(app.shortId, page.id, block.id, pageParams));
  }
  const formBlocks = page.rows.flatMap((row) =>
    row.columns.flatMap((column) => column.blocks.filter((block): block is FormBlock => block.type === "form")),
  );
  const formEntries = await Promise.all(
    formBlocks.map(async (block): Promise<[string, FormBlockData]> => {
      const capability = app.publishedCapabilities!.forms.find(
        (candidate) => candidate.pageId === page.id && candidate.blockId === block.id && candidate.formId === block.formId,
      );
      const form = capability ? await gridsService.form.get(block.formId) : null;
      const liveFields = form ? await gridsService.field.listByTable(form.tableId) : [];
      if (!capability || !form || !customAppFormMatchesPublishedCapability({ block, page, form, fields: liveFields, capability })) {
        return [block.id, { ok: false, message: "This form is unavailable." }];
      }
      const fixedFieldIds = Object.keys(block.fixedValues).sort();
      const formAccess = await resolveRecordAccessForAccess(
        requestAccess,
        { baseId: app.baseId, tableId: form.tableId, formId: form.id },
        "write",
      );
      if (!formAccess.ok) return [block.id, { ok: false, message: "You cannot submit this form." }];

      const fixed = new Set(fixedFieldIds);
      const renderable = gridsService.form.toPublicRenderableForm(form);
      renderable.config = {
        ...renderable.config,
        redirectUrl: null,
        fields: renderable.config.fields.filter((entry) => !fixed.has(entry.fieldId)),
      };
      const visibleFieldIds = new Set(renderable.config.fields.map((entry) => entry.fieldId));
      const fields = liveFields.filter((field) => visibleFieldIds.has(field.id));
      if (fields.length !== visibleFieldIds.size) {
        return [block.id, { ok: false, message: "This form changed after the app was published." }];
      }
      const fieldsById = new Map(liveFields.map((field) => [field.id, field]));
      const inlineTargetFields: Record<string, Field[]> = {};
      for (const entry of renderable.config.fields) {
        if (entry.kind !== "user_input" || !entry.inlineCreate?.enabled) continue;
        const relationField = fieldsById.get(entry.fieldId);
        if (relationField?.type !== "relation") continue;
        const targetTableId = (relationField.config as { targetTableId?: unknown }).targetTableId;
        if (typeof targetTableId !== "string") continue;
        const allowedIds = new Set((entry.inlineCreate.fields ?? []).map((inlineField) => inlineField.fieldId));
        inlineTargetFields[targetTableId] = (await gridsService.field.listByTable(targetTableId)).filter((field) =>
          allowedIds.has(field.id),
        );
      }
      return [
        block.id,
        {
          ok: true,
          form: renderable,
          fields,
          inlineTargetFields,
          submitUrl: customAppFormSubmitUrl(app.shortId, page.id, block.id, pageParams),
        },
      ];
    }),
  );
  const forms = new Map(formEntries);
  const actionBlocks = page.rows.flatMap((row) =>
    row.columns.flatMap((column) => column.blocks.filter((block): block is ActionsBlock => block.type === "actions")),
  );
  const actions = new Map<string, CustomAppRenderedAction[]>();
  for (const block of actionBlocks) {
    const rendered = block.actions.flatMap((action): CustomAppRenderedAction[] => {
      if (action.kind === "navigate") {
        const href = customAppActionHref(app.shortId, action, pageParams, pageRecord?.record.id);
        return href ? [{ id: action.id, kind: "navigate", label: action.label, icon: action.icon, href, history: action.history }] : [];
      }
      const capability = app.publishedCapabilities!.workflowLaunchers.find(
        (candidate) =>
          candidate.pageId === page.id &&
          candidate.blockId === block.id &&
          candidate.actionId === action.id &&
          candidate.launcherId === action.launcherId,
      );
      return capability
        ? [
            {
              id: action.id,
              kind: "workflow",
              label: action.label,
              icon: action.icon,
              endpoint: customAppActionUrl(app.shortId, page.id, block.id, action.id, pageParams),
              confirm: action.confirm,
            },
          ]
        : [];
    });
    actions.set(block.id, rendered);
  }
  return () => (
    <Layout c={c} title={[{ title: definition.name, href: `/apps/${app.shortId}` }, { title: page.title }]}>
      <CustomAppPage
        definition={definition}
        page={page}
        shortId={app.shortId}
        results={results}
        forms={forms}
        commentEndpoints={commentEndpoints}
        actions={actions}
        recordUpdateEndpoints={recordUpdateEndpoints}
        pageRecord={pageRecord}
        dateConfig={dateConfig}
      />
    </Layout>
  );
});

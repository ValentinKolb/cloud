import { MarkdownView, StatCell, StatGrid } from "@k2b/ui";
import { type AuthContext, getDateConfig } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { executeGqlSourceForContext, executeSavedViewSourceForContext } from "../../api/gql-runtime";
import {
  actorViewerFor,
  gateAtAccess,
  gridsAccessContext,
  hasExplicitGrant,
  resolveRecordAccessForAccess,
  resolveWithGrantsForAccess,
} from "../../api/permissions";
import { ssr } from "../../config";
import type { DocumentRunSummary, DslQueryPreviewResponse, Field, GridRecord } from "../../contracts";
import type { CustomAppBlock, CustomAppDefinition, CustomAppPage } from "../../custom-apps/contracts";
import { customAppPageRecordFieldIds, visibleCustomAppPage } from "../../custom-apps/conditions";
import { customAppFormMatchesPublishedCapability } from "../../custom-apps/form-runtime";
import { customAppViewSourceHash } from "../../custom-apps/insight-source";
import {
  customAppActionHref,
  customAppActionUrl,
  customAppCommentsUrl,
  customAppFormSubmitUrl,
  customAppPageHref,
  customAppRecordUpdateUrl,
  resolveCustomAppPage,
  resolveCustomAppPageParams,
} from "../../custom-apps/routing";
import { gridsService } from "../../service";
import {
  chartDataFromPreview,
  type CustomAppChartData,
  type CustomAppMetricCell,
  metricCellsFromPreview,
} from "../../service/custom-app-insights";
import type { PublicRenderableForm } from "../../service/forms";
import FormSubmit from "../_components/forms/PublicFormSubmit.island";
import RecordComments from "../_components/records/RecordComments.island";
import Actions, { type CustomAppRenderedAction } from "./Actions.island";
import CustomAppChart from "./Chart";
import RecordDetails from "./RecordDetails.island";
import RecordsTable from "./RecordsTable.island";
import { formatCustomAppValue } from "./value-format";

type RecordsBlock = Extract<CustomAppBlock, { type: "records" }>;
type MetricsBlock = Extract<CustomAppBlock, { type: "metrics" }>;
type ChartBlock = Extract<CustomAppBlock, { type: "chart" }>;
type InsightBlock = MetricsBlock | ChartBlock;
type RecordBlock = Extract<CustomAppBlock, { type: "record" }>;
type FormBlock = Extract<CustomAppBlock, { type: "form" }>;
type CommentsBlock = Extract<CustomAppBlock, { type: "comments" }>;
type ActionsBlock = Extract<CustomAppBlock, { type: "actions" }>;
type QuerySuccess = Extract<DslQueryPreviewResponse, { ok: true }>;
type BlockResult = { ok: true; result: QuerySuccess } | { ok: false; message: string };
type MetricsBlockData = { ok: true; cells: CustomAppMetricCell[] } | { ok: false; message: string };
type ChartBlockData = { ok: true; chart: CustomAppChartData } | { ok: false; message: string };
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

const Metrics = (props: { data: MetricsBlockData; dateConfig: ReturnType<typeof getDateConfig> }) => {
  if (!props.data.ok) {
    return <div class="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{props.data.message}</div>;
  }
  if (props.data.cells.length === 0) return <div class="rounded-xl border p-4 text-sm text-secondary">No metrics found.</div>;
  return (
    <StatGrid columns={props.data.cells.length === 1 ? 1 : props.data.cells.length === 2 ? 2 : 3}>
      {props.data.cells.map((cell) => {
        const value = formatCustomAppValue(cell.value, cell.valueFormat, props.dateConfig);
        return <StatCell label={cell.label} value={value} title={value} />;
      })}
    </StatGrid>
  );
};

const AppChart = (props: { block: ChartBlock; data: ChartBlockData; dateConfig: ReturnType<typeof getDateConfig> }) => {
  if (!props.data.ok) {
    return <div class="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{props.data.message}</div>;
  }
  return (
    <div class="flex h-72 min-h-0 flex-col">
      {props.block.subtitle ? <p class="mb-3 text-sm text-secondary">{props.block.subtitle}</p> : null}
      <CustomAppChart
        chartType={props.block.chartType}
        data={props.data.chart}
        valueFormat={props.block.valueFormat}
        dateConfig={props.dateConfig}
      />
    </div>
  );
};

const Record = (props: {
  block: RecordBlock;
  pageRecord: PageRecord | null;
  baseId: string;
  updateEndpoint?: string;
  documentRuns: DocumentRunSummary[];
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
      documentRuns={props.documentRuns}
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
  metrics: Map<string, MetricsBlockData>;
  charts: Map<string, ChartBlockData>;
  forms: Map<string, FormBlockData>;
  commentEndpoints: Map<string, string>;
  actions: Map<string, CustomAppRenderedAction[]>;
  recordUpdateEndpoints: Map<string, string>;
  documentRuns: Map<string, DocumentRunSummary[]>;
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
                    ) : block.type === "metrics" ? (
                      <Metrics
                        data={props.metrics.get(block.id) ?? { ok: false, message: "Metrics are unavailable." }}
                        dateConfig={props.dateConfig}
                      />
                    ) : block.type === "chart" ? (
                      <AppChart
                        block={block}
                        data={props.charts.get(block.id) ?? { ok: false, message: "Chart data is unavailable." }}
                        dateConfig={props.dateConfig}
                      />
                    ) : block.type === "record" ? (
                      <Record
                        block={block}
                        pageRecord={props.pageRecord}
                        baseId={props.definition.baseId}
                        updateEndpoint={props.recordUpdateEndpoints.get(block.id)}
                        documentRuns={props.documentRuns.get(block.id) ?? []}
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
  let runtimePage = visibleCustomAppPage(page, { params: pageParams, record: null });
  const recordUpdateEndpoints = new Map<string, string>();
  const documentRuns = new Map<string, DocumentRunSummary[]>();
  if (page.record) {
    const capability = app.publishedCapabilities.records.find(
      (candidate) => candidate.pageId === page.id && candidate.tableId === page.record!.tableId,
    );
    const expectedFieldIds = customAppPageRecordFieldIds(page);
    const expectedEditableFieldIds = [
      ...new Set(
        page.rows.flatMap((row) =>
          row.columns.flatMap((column) => column.blocks.flatMap((block) => (block.type === "record" ? block.editableFieldIds : []))),
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
    runtimePage = visibleCustomAppPage(page, { params: pageParams, record });

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
        for (const block of runtimePage.rows.flatMap((row) =>
          row.columns.flatMap((column) => column.blocks.filter((candidate): candidate is RecordBlock => candidate.type === "record")),
        )) {
          if (block.editableFieldIds.length > 0) {
            recordUpdateEndpoints.set(block.id, customAppRecordUpdateUrl(app.shortId, page.id, block.id, pageParams));
          }
        }
      }
    }

    const documentBlocks = runtimePage.rows.flatMap((row) =>
      row.columns.flatMap((column) =>
        column.blocks.filter((candidate): candidate is RecordBlock => candidate.type === "record" && Boolean(candidate.documents)),
      ),
    );
    const configuredTemplateIds = new Set<string>();
    for (const block of documentBlocks) {
      const expectedTemplateIds = [...(block.documents?.templateIds ?? [])].sort();
      const capability = app.publishedCapabilities.documents.find(
        (candidate) => candidate.pageId === page.id && candidate.blockId === block.id && candidate.tableId === page.record!.tableId,
      );
      if (!capability || capability.templateIds.join("\0") !== expectedTemplateIds.join("\0")) return c.notFound();
      for (const templateId of expectedTemplateIds) configuredTemplateIds.add(templateId);
    }
    const readableTemplateIds: string[] = [];
    for (const templateId of configuredTemplateIds) {
      const template = await gridsService.document.getTemplate(templateId);
      if (!template || template.tableId !== page.record.tableId) continue;
      const templateAccess = await gateAtAccess(
        requestAccess,
        { baseId: app.baseId, tableId: page.record.tableId, documentTemplateId: templateId },
        "read",
      );
      if (templateAccess.ok) readableTemplateIds.push(templateId);
    }
    const runs = await gridsService.document.listRunSummariesForRecordByTemplates(page.record.tableId, record.id, readableTemplateIds);
    for (const block of documentBlocks) {
      const allowed = new Set(block.documents?.templateIds ?? []);
      documentRuns.set(
        block.id,
        runs.filter((run) => run.templateId && allowed.has(run.templateId)),
      );
    }
  }

  const allowedViews = new Set(app.publishedCapabilities.views.map((view) => view.viewId));
  const blocks = runtimePage.rows.flatMap((row) =>
    row.columns.flatMap((column) => column.blocks.filter((block): block is RecordsBlock => block.type === "records")),
  );
  const entries = await Promise.all(
    blocks.map(async (block): Promise<[string, BlockResult]> => {
      const maxRows = block.source.kind === "gql" ? block.source.maxRows : 100;
      const queryCapability =
        block.source.kind === "gql"
          ? app.publishedCapabilities!.recordQueries.find((candidate) => candidate.pageId === page.id && candidate.blockId === block.id)
          : undefined;
      if (block.source.kind === "gql" && !queryCapability) {
        return [block.id, { ok: false, message: "This data source is not part of the published app." }];
      }
      try {
        const result =
          block.source.kind === "view"
            ? allowedViews.has(block.source.viewId)
              ? await executeSavedViewSourceForContext(
                  { access: requestAccess, dateConfig, signal: c.req.raw.signal },
                  app.baseId,
                  block.source.viewId,
                  { maxRows, pageSize: maxRows, maxResultBytes: 512_000, operation: "execute", surface: "ssr" },
                )
              : null
            : (
                await executeGqlSourceForContext(
                  { access: requestAccess, dateConfig, signal: c.req.raw.signal },
                  app.baseId,
                  { query: block.source.query, limit: maxRows, pageSize: maxRows, surface: "ssr" },
                  {
                    maxRows,
                    maxResultBytes: 512_000,
                    operation: "execute",
                    labelRelationValues: true,
                    parameters: Object.fromEntries(
                      Object.entries(block.source.inputs ?? {}).map(([name, value]) => [name, pageParams[value.path]!]),
                    ),
                  },
                )
              ).response;
        if (!result) return [block.id, { ok: false, message: "This view is not part of the published app." }];
        if (!result.ok) return [block.id, { ok: false, message: result.diagnostics[0]?.message ?? "This data source is unavailable." }];
        if (block.source.kind === "gql") {
          const allowedTableIds = new Set(queryCapability!.tableIds);
          const outputTableIds = [...new Set(result.columns.flatMap((column) => (column.tableId ? [column.tableId] : [])))];
          if (outputTableIds.some((tableId) => !allowedTableIds.has(tableId))) {
            return [block.id, { ok: false, message: "This data source changed after the app was published." }];
          }
        }
        return [block.id, { ok: true, result }];
      } catch {
        return [block.id, { ok: false, message: "This data source is temporarily unavailable." }];
      }
    }),
  );
  const results = new Map(entries);
  const insightBlocks = runtimePage.rows.flatMap((row) =>
    row.columns.flatMap((column) =>
      column.blocks.filter((block): block is InsightBlock => block.type === "metrics" || block.type === "chart"),
    ),
  );
  const insightEntries = await Promise.all(
    insightBlocks.map(async (block): Promise<[string, MetricsBlockData | ChartBlockData]> => {
      const capability = app.publishedCapabilities!.insights.find(
        (candidate) =>
          candidate.pageId === page.id &&
          candidate.blockId === block.id &&
          candidate.blockType === block.type &&
          candidate.source.kind === block.source.kind &&
          (candidate.source.kind !== "view" || (block.source.kind === "view" && candidate.source.viewId === block.source.viewId)),
      );
      if (!capability) return [block.id, { ok: false, message: "This data source is not part of the published app." }];
      const maxRows = block.type === "metrics" ? 1 : Math.min(block.limit, block.source.kind === "gql" ? block.source.maxRows : 100);
      try {
        if (block.source.kind === "view") {
          const view = await gridsService.view.get(block.source.viewId);
          if (
            !view ||
            capability.source.kind !== "view" ||
            customAppViewSourceHash(view.tableId, view.source) !== capability.source.sourceHash
          ) {
            return [block.id, { ok: false, message: "This saved view changed after the app was published. Republish the app." }];
          }
        }
        const response =
          block.source.kind === "view"
            ? await executeSavedViewSourceForContext(
                { access: requestAccess, dateConfig, signal: c.req.raw.signal },
                app.baseId,
                block.source.viewId,
                { maxRows, pageSize: maxRows, maxResultBytes: 512_000, operation: "execute", surface: "ssr" },
              )
            : (
                await executeGqlSourceForContext(
                  { access: requestAccess, dateConfig, signal: c.req.raw.signal },
                  app.baseId,
                  { query: block.source.query, limit: maxRows, pageSize: maxRows, surface: "ssr" },
                  {
                    maxRows,
                    maxResultBytes: 512_000,
                    operation: "execute",
                    labelRelationValues: true,
                    parameters: Object.fromEntries(
                      Object.entries(block.source.inputs ?? {}).map(([name, value]) => [name, pageParams[value.path]!]),
                    ),
                  },
                )
              ).response;
        if (!response.ok) {
          return [block.id, { ok: false, message: response.diagnostics[0]?.message ?? "This data source is unavailable." }];
        }
        const allowedTableIds = new Set(capability.source.tableIds);
        const outputTableIds = [...new Set(response.columns.flatMap((column) => (column.tableId ? [column.tableId] : [])))];
        if (outputTableIds.some((tableId) => !allowedTableIds.has(tableId))) {
          return [block.id, { ok: false, message: "This data source changed after the app was published." }];
        }
        const fieldGroups = await gridsService.field.listByTables(outputTableIds);
        const sourceFields = outputTableIds.flatMap((tableId) => fieldGroups.get(tableId) ?? []);
        if (block.type === "metrics") return [block.id, { ok: true, cells: metricCellsFromPreview(response, sourceFields) }];
        const chart = chartDataFromPreview(response, sourceFields);
        if (chart.kind === "error" || (block.chartType === "scatter" && chart.viewQuery.aggregations.length < 2)) {
          return [block.id, { ok: false, message: chart.kind === "error" ? chart.reason : "Scatter charts need two value series." }];
        }
        return [block.id, { ok: true, chart }];
      } catch {
        return [block.id, { ok: false, message: "This data source is temporarily unavailable." }];
      }
    }),
  );
  const metrics = new Map<string, MetricsBlockData>();
  const charts = new Map<string, ChartBlockData>();
  for (const [blockId, data] of insightEntries) {
    const block = insightBlocks.find((candidate) => candidate.id === blockId);
    if (block?.type === "metrics") metrics.set(blockId, data as MetricsBlockData);
    if (block?.type === "chart") charts.set(blockId, data as ChartBlockData);
  }
  const commentBlocks = runtimePage.rows.flatMap((row) =>
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
  const formBlocks = runtimePage.rows.flatMap((row) =>
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
  const actionBlocks = runtimePage.rows.flatMap((row) =>
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
        page={runtimePage}
        shortId={app.shortId}
        results={results}
        metrics={metrics}
        charts={charts}
        forms={forms}
        commentEndpoints={commentEndpoints}
        actions={actions}
        recordUpdateEndpoints={recordUpdateEndpoints}
        documentRuns={documentRuns}
        pageRecord={pageRecord}
        dateConfig={dateConfig}
      />
    </Layout>
  );
});

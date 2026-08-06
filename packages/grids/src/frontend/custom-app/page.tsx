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
import { customAppPageHref, resolveCustomAppPage, resolvePageRecordId } from "../../custom-apps/routing";
import { gridsService } from "../../service";
import { formatFieldValueText } from "../_components/table/field-value-format";
import RecordsTable from "./RecordsTable.island";

type RecordsBlock = Extract<CustomAppBlock, { type: "records" }>;
type RecordBlock = Extract<CustomAppBlock, { type: "record" }>;
type QuerySuccess = Extract<DslQueryPreviewResponse, { ok: true }>;
type BlockResult = { ok: true; result: QuerySuccess } | { ok: false; message: string };
type PageRecord = { record: GridRecord; fields: Field[] };

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

const RecordDetails = (props: { block: RecordBlock; pageRecord: PageRecord | null; dateConfig: ReturnType<typeof getDateConfig> }) => {
  if (!props.pageRecord) {
    return <div class="rounded-xl border p-4 text-sm text-secondary">{props.block.emptyText ?? "Record not found."}</div>;
  }
  const fieldsById = new Map(props.pageRecord.fields.map((field) => [field.id, field]));
  const fields = props.block.fieldIds.map((fieldId) => fieldsById.get(fieldId)).filter((field): field is Field => Boolean(field));
  return (
    <dl class="divide-y rounded-xl border">
      {fields.map((field) => (
        <div class="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(8rem,0.35fr)_minmax(0,1fr)] sm:gap-4">
          <dt class="text-sm font-medium text-secondary">{field.name}</dt>
          <dd class="min-w-0 whitespace-pre-wrap break-words text-sm text-primary">
            {formatFieldValueText({
              field,
              value: props.pageRecord!.record.data[field.id],
              record: props.pageRecord!.record,
              dateConfig: props.dateConfig,
            }) || "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
};

const CustomAppPage = (props: {
  definition: CustomAppDefinition;
  page: CustomAppPage;
  shortId: string;
  results: Map<string, BlockResult>;
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
                    {block.title ? <h2 class="mb-3 text-base font-semibold">{block.title}</h2> : null}
                    {block.type === "markdown" ? (
                      <MarkdownView markdown={block.markdown} smallHeadings />
                    ) : block.type === "records" ? (
                      <Records
                        block={block}
                        data={props.results.get(block.id) ?? { ok: false, message: "Records are unavailable." }}
                        shortId={props.shortId}
                      />
                    ) : (
                      <RecordDetails block={block} pageRecord={props.pageRecord} dateConfig={props.dateConfig} />
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

  let pageRecord: PageRecord | null = null;
  const recordId = resolvePageRecordId(page, c.req.query());
  if (recordId === null) return c.notFound();
  if (page.record && recordId) {
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
    if (!capability || capability.fieldIds.join("\0") !== expectedFieldIds.join("\0")) return c.notFound();
    const recordAccess = await resolveRecordAccessForAccess(requestAccess, { baseId: app.baseId, tableId: page.record.tableId }, "read");
    if (!recordAccess.ok) return c.notFound();
    const record = await gridsService.record.get(page.record.tableId, recordId, {
      viewer: actorViewerFor(requestAccess),
      recordAccess: recordAccess.data.recordAccess,
      dateConfig,
    });
    if (!record) return c.notFound();
    const allowed = new Set(capability.fieldIds);
    const fields = (await gridsService.field.listByTable(page.record.tableId)).filter((field) => allowed.has(field.id));
    if (fields.length !== allowed.size) return c.notFound();
    pageRecord = { record, fields };
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
  return () => (
    <Layout c={c} title={[{ title: definition.name, href: `/apps/${app.shortId}` }, { title: page.title }]}>
      <CustomAppPage
        definition={definition}
        page={page}
        shortId={app.shortId}
        results={results}
        pageRecord={pageRecord}
        dateConfig={dateConfig}
      />
    </Layout>
  );
});

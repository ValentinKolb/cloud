import { DataTable, type DataTableColumn, MarkdownView } from "@k2b/ui";
import { type AuthContext, getDateConfig } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { executeSavedViewSourceForContext } from "../../api/gql-runtime";
import { gridsAccessContext, hasExplicitGrant, resolveWithGrantsForAccess } from "../../api/permissions";
import { ssr } from "../../config";
import type { DslQueryPreviewResponse } from "../../contracts";
import type { CustomAppBlock, CustomAppDefinition } from "../../custom-apps/contracts";
import { gridsService } from "../../service";

type RecordsBlock = Extract<CustomAppBlock, { type: "records" }>;
type QuerySuccess = Extract<DslQueryPreviewResponse, { ok: true }>;
type BlockResult = { ok: true; result: QuerySuccess } | { ok: false; message: string };

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  return JSON.stringify(value);
};

const Records = (props: { block: RecordsBlock; data: BlockResult }) => {
  if (!props.data.ok) {
    return <div class="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{props.data.message}</div>;
  }
  const selected = new Set(props.block.display.columnIds);
  const result = props.data.result;
  const resultColumns = result.columns.filter((column) => column.fieldId && selected.has(column.fieldId));
  const rows = result.rows.map((row, index) => ({ ...row, rowKey: row.recordId ? `${row.recordId}:${index}` : `row-${index}` }));
  const columns: DataTableColumn<(typeof rows)[number]>[] = resultColumns.map((column) => ({
    id: column.key,
    header: column.label,
    subtitle: column.type,
    value: (row) => row.values[column.key],
  }));
  if (columns.length === 0) {
    return <div class="rounded-xl border p-4 text-sm text-secondary">The selected fields are not part of this view result.</div>;
  }
  return (
    <div class="overflow-hidden rounded-xl border">
      <DataTable
        ariaLabel={props.block.title ?? "Records"}
        rows={rows}
        columns={columns}
        getRowId={(row) => row.rowKey}
        density="compact"
        hoverRows={false}
        empty={<span>{props.block.emptyText ?? "No records found."}</span>}
        renderCell={({ value }) => <span class="whitespace-pre-wrap break-words">{displayValue(value)}</span>}
      />
    </div>
  );
};

const CustomAppPage = (props: { definition: CustomAppDefinition; results: Map<string, BlockResult> }) => {
  const page = props.definition.pages[0]!;
  return (
    <main class="mx-auto flex w-full max-w-[96rem] flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <header class="flex items-center gap-3">
        {props.definition.icon ? <i class={`ti ti-${props.definition.icon} text-2xl text-accent`} aria-hidden="true" /> : null}
        <div>
          <p class="text-sm text-secondary">{props.definition.name}</p>
          <h1 class="text-2xl font-semibold">{page.title}</h1>
        </div>
      </header>
      {page.rows.map((row) => (
        <div class="flex flex-wrap gap-4">
          {row.columns.map((column) => (
            <section class="min-w-0 basis-80" style={{ flex: `${column.span} 1 20rem` }}>
              <div class="flex flex-col gap-4">
                {column.blocks.map((block) => (
                  <article class="paper p-4 sm:p-5">
                    {block.title ? <h2 class="mb-3 text-base font-semibold">{block.title}</h2> : null}
                    {block.type === "markdown" ? (
                      <MarkdownView markdown={block.markdown} smallHeadings />
                    ) : (
                      <Records block={block} data={props.results.get(block.id) ?? { ok: false, message: "Records are unavailable." }} />
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

  const allowedViews = new Set(app.publishedCapabilities.views.map((view) => view.viewId));
  const blocks = app.publishedDefinition.pages[0]!.rows.flatMap((row) =>
    row.columns.flatMap((column) => column.blocks.filter((block): block is RecordsBlock => block.type === "records")),
  );
  const entries = await Promise.all(
    blocks.map(async (block): Promise<[string, BlockResult]> => {
      if (!allowedViews.has(block.source.viewId)) return [block.id, { ok: false, message: "This view is not part of the published app." }];
      const result = await executeSavedViewSourceForContext(
        { access: requestAccess, dateConfig: getDateConfig(c), signal: c.req.raw.signal },
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
  const definition = app.publishedDefinition;
  return () => (
    <Layout c={c} title={[{ title: definition.name, href: `/apps/${app.shortId}` }]}>
      <CustomAppPage definition={definition} results={results} />
    </Layout>
  );
});

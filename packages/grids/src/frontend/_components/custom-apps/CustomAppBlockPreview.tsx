import type { DateContext } from "@k2b/stdlib";
import { Button, MarkdownView, Placeholder, StatCell, StatGrid } from "@k2b/ui";
import { createEffect, createMemo, createResource, For, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { DslQueryPreviewResponse } from "../../../contracts";
import type { CustomAppBlock } from "../../../custom-apps/contracts";
import type { Form } from "../../../service";
import { chartDataFromPreview, metricCellsFromPreview } from "../../../service/custom-app-insights";
import CustomAppChart from "../../custom-app/Chart";
import RecordsTable from "../../custom-app/RecordsTable.island";
import { formatCustomAppValue } from "../../custom-app/value-format";
import FormSubmit from "../forms/PublicFormSubmit.island";
import { errorMessage } from "../utils/api-helpers";
import type { WorkspaceCatalog } from "../workspace/workspace-state-model";

type SourceBlock = Extract<CustomAppBlock, { type: "records" | "metrics" | "chart" }>;

const loadSource = async (baseId: string, block: SourceBlock): Promise<DslQueryPreviewResponse> => {
  const response =
    block.source.kind === "view"
      ? await apiClient.gql["by-base"][":baseId"].views[":viewId"].execute.$post({
          param: { baseId, viewId: block.source.viewId },
          json: { pageSize: block.type === "chart" ? block.limit : 100, surface: "custom-app" },
        })
      : await apiClient.gql["by-base"][":baseId"].execute.$post({
          param: { baseId },
          json: {
            query: block.source.query,
            pageSize: block.type === "records" ? block.pageSize : block.type === "metrics" ? 1 : block.limit,
            limit: block.type === "records" ? block.pageSize : block.type === "metrics" ? 1 : block.limit,
            surface: "custom-app",
          },
        });
  if (!response.ok) throw new Error(await errorMessage(response, "Could not load the data preview."));
  return response.json();
};

const renderableForm = (form: Form, fixedFieldIds: string[]) => ({
  id: form.id,
  name: form.name,
  config: {
    ...form.config,
    redirectUrl: null,
    fields: form.config.fields.filter((entry) => entry.kind === "user_input" && !fixedFieldIds.includes(entry.fieldId)),
  },
});

function SourcePreview(props: {
  baseId: string;
  shortId: string;
  block: SourceBlock;
  catalog: WorkspaceCatalog;
  dateConfig?: DateContext;
  initialResult?: DslQueryPreviewResponse;
  onPreviewResult?: (blockId: string, result: DslQueryPreviewResponse) => void;
}) {
  const initialSource = JSON.stringify([props.baseId, props.block.source]);
  const source = () => JSON.stringify([props.baseId, props.block.source]);
  const [preview] = createResource(
    () => (props.initialResult && source() === initialSource ? false : source()),
    () => loadSource(props.baseId, props.block),
    { initialValue: props.initialResult },
  );
  const sourceFields = () => {
    const result = preview();
    const tableIds = new Set((result?.ok ? result.columns : []).flatMap((column) => (column.tableId ? [column.tableId] : [])));
    return [...tableIds].flatMap((tableId) => props.catalog.fieldsByTable[tableId] ?? []);
  };
  createEffect(() => {
    const result = preview();
    if (result) props.onPreviewResult?.(props.block.id, result);
  });
  return (
    <Show
      when={!preview.loading}
      fallback={<Placeholder state="loading" align="left" title="Loading preview" description="Running this block's data source." />}
    >
      <Show
        when={preview()}
        fallback={<Placeholder align="left" title="Records unavailable" description="The preview could not be loaded." />}
      >
        {(result) => {
          const resolved = result();
          if (!resolved.ok)
            return (
              <Placeholder
                align="left"
                title="Data unavailable"
                description={resolved.diagnostics[0]?.message ?? "The data source could not be previewed."}
              />
            );
          return props.block.type === "records" ? (
            <RecordsTable
              title={props.block.title ?? "Records"}
              emptyText={props.block.emptyText ?? "No records found."}
              shortId={props.shortId}
              selectedColumnIds={props.block.source.kind === "view" ? props.block.display.columnIds : undefined}
              result={resolved}
              rowActions={(props.block.rowActions ?? []).map((action) => ({
                id: action.id,
                label: action.label,
                icon: action.icon,
                showLabel: action.showLabel,
                endpoint: "",
              }))}
              preview
            />
          ) : props.block.type === "metrics" ? (
            <StatGrid columns={3}>
              <For each={metricCellsFromPreview(resolved, sourceFields())}>
                {(cell) => {
                  const value = formatCustomAppValue(cell.value, cell.valueFormat, props.dateConfig);
                  return <StatCell label={cell.label} value={value} title={value} />;
                }}
              </For>
            </StatGrid>
          ) : props.dateConfig ? (
            <CustomAppChart
              chartType={props.block.chartType}
              data={chartDataFromPreview(resolved, sourceFields())}
              valueFormat={props.block.valueFormat}
              dateConfig={props.dateConfig}
            />
          ) : (
            <Placeholder align="left" title="Chart preview unavailable" description="Date formatting context is missing." />
          );
        }}
      </Show>
    </Show>
  );
}

export default function CustomAppBlockPreview(props: {
  block: CustomAppBlock;
  baseId: string;
  shortId: string;
  catalog: WorkspaceCatalog;
  dateConfig?: DateContext;
  initialResult?: DslQueryPreviewResponse;
  onPreviewResult?: (blockId: string, result: DslQueryPreviewResponse) => void;
}) {
  const form = createMemo(() => {
    const block = props.block;
    if (block.type !== "form") return null;
    return (
      Object.values(props.catalog.formsByTable)
        .flat()
        .find((candidate) => candidate.id === block.formId && candidate.deletedAt === null && candidate.isActive) ?? null
    );
  });
  const formFields = createMemo(() => {
    const selected = form();
    if (!selected) return [];
    const visible = new Set(selected.config.fields.map((entry) => entry.fieldId));
    return (props.catalog.fieldsByTable[selected.tableId] ?? []).filter((field) => visible.has(field.id) && field.deletedAt === null);
  });

  return props.block.type === "markdown" ? (
    <Show
      when={props.block.markdown.trim()}
      fallback={
        <Placeholder
          state="empty"
          variant="compact"
          align="left"
          title="Empty Markdown block"
          description="Select this block to add text or context placeholders."
        />
      }
    >
      <MarkdownView markdown={props.block.markdown} smallHeadings />
    </Show>
  ) : props.block.type === "records" || props.block.type === "metrics" || props.block.type === "chart" ? (
    <SourcePreview
      baseId={props.baseId}
      shortId={props.shortId}
      block={props.block}
      catalog={props.catalog}
      dateConfig={props.dateConfig}
      initialResult={props.initialResult}
      onPreviewResult={props.onPreviewResult}
    />
  ) : props.block.type === "form" ? (
    <Show when={form()} fallback={<Placeholder align="left" title="Form unavailable" description="Choose an active Form in this Base." />}>
      {(selected) => (
        <FormSubmit
          preview
          form={renderableForm(selected(), Object.keys(props.block.type === "form" ? props.block.fixedValues : {}))}
          fields={formFields()}
          dateConfig={props.dateConfig}
          surface="bare"
          showTitle={!props.block.title}
          titleAs="h2"
        />
      )}
    </Show>
  ) : props.block.type === "actions" ? (
    <div class="flex flex-wrap items-center gap-2">
      <For each={props.block.actions}>
        {(action) => (
          <Button type="button" size="sm" variant={action.kind === "workflow" ? "primary" : "secondary"} disabled>
            <Show when={action.icon}>{(icon) => <i class={`ti ti-${icon()}`} aria-hidden="true" />}</Show>
            {action.label}
          </Button>
        )}
      </For>
    </div>
  ) : props.block.type === "scanner" ? (
    <Placeholder
      align="left"
      icon="ti ti-scan"
      title={props.block.title ? undefined : "Scanner"}
      description="Signed-in readers can scan codes here. Open the published app to use the camera."
    />
  ) : (
    <Placeholder
      align="left"
      title={`${props.block.type[0]?.toUpperCase()}${props.block.type.slice(1)}`}
      description="Preview data is unavailable for the current page context."
    />
  );
}

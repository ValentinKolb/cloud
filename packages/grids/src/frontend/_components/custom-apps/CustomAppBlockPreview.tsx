import type { DateContext } from "@k2b/stdlib";
import { Button, MarkdownView, Placeholder } from "@k2b/ui";
import { createMemo, createResource, For, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { DslQueryPreviewResponse } from "../../../contracts";
import type { CustomAppBlock } from "../../../custom-apps/contracts";
import type { Form } from "../../../service";
import RecordsTable from "../../custom-app/RecordsTable.island";
import FormSubmit from "../forms/PublicFormSubmit.island";
import { errorMessage } from "../utils/api-helpers";
import type { WorkspaceCatalog } from "../workspace/workspace-state-model";

type RecordsBlock = Extract<CustomAppBlock, { type: "records" }>;

const loadRecords = async (baseId: string, block: RecordsBlock): Promise<DslQueryPreviewResponse> => {
  if (block.source.kind === "gql" && Object.keys(block.source.inputs ?? {}).length > 0) {
    return { ok: false, diagnostics: [{ message: "Page parameters are required to preview this query." }] };
  }
  const response =
    block.source.kind === "view"
      ? await apiClient.gql["by-base"][":baseId"].views[":viewId"].execute.$post({
          param: { baseId, viewId: block.source.viewId },
          json: { pageSize: 100, surface: "custom-app" },
        })
      : await apiClient.gql["by-base"][":baseId"].execute.$post({
          param: { baseId },
          json: { query: block.source.query, pageSize: block.source.maxRows, limit: block.source.maxRows, surface: "custom-app" },
        });
  if (!response.ok) throw new Error(await errorMessage(response, "Could not load Records preview."));
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

function RecordsPreview(props: { baseId: string; shortId: string; block: RecordsBlock }) {
  const source = () => JSON.stringify([props.baseId, props.block.source]);
  const [preview] = createResource(source, () => loadRecords(props.baseId, props.block));
  return (
    <Show
      when={!preview.loading}
      fallback={<Placeholder state="loading" align="left" title="Loading records" description="Running the saved data source." />}
    >
      <Show
        when={preview()}
        fallback={<Placeholder align="left" title="Records unavailable" description="The preview could not be loaded." />}
      >
        {(result) => {
          const resolved = result();
          return resolved.ok ? (
            <RecordsTable
              title={props.block.title ?? "Records"}
              emptyText={props.block.emptyText ?? "No records found."}
              shortId={props.shortId}
              selectedColumnIds={props.block.display.columnIds}
              result={resolved}
            />
          ) : (
            <Placeholder
              align="left"
              title="Records unavailable"
              description={resolved.diagnostics[0]?.message ?? "The data source could not be previewed."}
            />
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
    <MarkdownView markdown={props.block.markdown} smallHeadings />
  ) : props.block.type === "records" ? (
    <RecordsPreview baseId={props.baseId} shortId={props.shortId} block={props.block} />
  ) : props.block.type === "form" ? (
    <Show when={form()} fallback={<Placeholder align="left" title="Form unavailable" description="Choose an active Form in this Base." />}>
      {(selected) => (
        <FormSubmit
          preview
          form={renderableForm(selected(), Object.keys(props.block.type === "form" ? props.block.fixedValues : {}))}
          fields={formFields()}
          dateConfig={props.dateConfig}
          surface="bare"
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
  ) : (
    <Placeholder
      align="left"
      title={`${props.block.type[0]?.toUpperCase()}${props.block.type.slice(1)}`}
      description="Preview data is unavailable for the current page context."
    />
  );
}

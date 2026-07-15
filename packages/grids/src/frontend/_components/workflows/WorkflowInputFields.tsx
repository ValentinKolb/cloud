import { DatePicker, DateTimePicker, MultiSelectInput, NumberInput, SelectInput, TextInput } from "@valentinkolb/cloud/ui";
import type { WorkflowIrInput } from "@valentinkolb/cloud/workflows";
import { For, Match, Show, Switch } from "solid-js";
import type { Table, Workflow } from "../../../service";
import RecordPicker from "../records/RecordPicker";
import { fetchRecordLookup } from "../records/record-lookup";
import {
  type WorkflowRunInputDraft,
  type WorkflowRunInputDraftValue,
  workflowInputDescription,
  workflowInputLabel,
  workflowInputOptions,
  workflowInputRequired,
} from "./workflow-trigger-actions";

type Props = {
  workflow: Workflow;
  tables: Table[];
  draft: () => WorkflowRunInputDraft;
  onValueChange: (name: string, value: WorkflowRunInputDraftValue) => void;
  errors?: () => Record<string, string>;
  emptyText?: string;
};

const resolveInputTable = (workflow: Workflow, input: WorkflowIrInput, tables: Table[]): Table | null => {
  const bound = workflow.plan.bindings[`inputs.${input.name}.table`];
  const reference = (typeof bound === "string" ? bound : input.config.table)?.toString().trim().toLowerCase();
  if (!reference) return null;
  return tables.find((table) => [table.id, table.shortId, table.name].some((value) => value.toLowerCase() === reference)) ?? null;
};

export function WorkflowInputFields(props: Props) {
  const inputs = () => props.workflow.plan.inputs;
  const value = (name: string) => props.draft()[name];
  const errorFor = (name: string) => () => props.errors?.()[name];

  return (
    <div class="flex flex-col gap-3">
      <For each={inputs()}>
        {(input) => {
          const name = input.name;
          const label = workflowInputLabel(input);
          const description = workflowInputDescription(input);
          const required = workflowInputRequired(input);
          const table = resolveInputTable(props.workflow, input, props.tables);
          return (
            <Switch>
              <Match when={input.type === "record" && table}>
                <RecordPicker
                  tableId={table!.id}
                  label={label}
                  description={description}
                  placeholder="Choose a record..."
                  clearable={!required}
                  value={() => (typeof value(name) === "string" ? (value(name) as string) : "")}
                  onChange={(recordId) => props.onValueChange(name, recordId)}
                />
              </Match>
              <Match when={input.type === "recordList" && table}>
                <MultiSelectInput
                  label={label}
                  description={description}
                  placeholder="Choose records..."
                  required={required}
                  clearable={!required}
                  value={() => (Array.isArray(value(name)) ? (value(name) as string[]) : [])}
                  onChange={(recordIds) => props.onValueChange(name, recordIds)}
                  fetchData={async (query, signal) =>
                    (await fetchRecordLookup({ tableId: table!.id, query, signal })).map((record) => ({
                      id: record.id,
                      label: record.label,
                      icon: "ti ti-database",
                    }))
                  }
                />
              </Match>
              <Match when={(input.type === "record" || input.type === "recordList") && !table}>
                <div class="info-block-danger text-sm">The table for {label} is unavailable.</div>
              </Match>
              <Match when={input.type === "number"}>
                <NumberInput
                  label={label}
                  description={description}
                  required={required}
                  decimalPlaces={10}
                  value={() => (typeof value(name) === "number" ? (value(name) as number) : null)}
                  onInput={(next) => props.onValueChange(name, next)}
                  error={errorFor(name)}
                />
              </Match>
              <Match when={input.type === "boolean"}>
                <SelectInput
                  label={label}
                  description={description}
                  required={required}
                  clearable={!required}
                  options={[
                    { id: "true", label: "Yes" },
                    { id: "false", label: "No" },
                  ]}
                  value={() => (typeof value(name) === "boolean" ? String(value(name)) : "")}
                  onChange={(next) => props.onValueChange(name, next === "" ? undefined : next === "true")}
                  error={errorFor(name)}
                />
              </Match>
              <Match when={input.type === "date"}>
                <DatePicker
                  label={label}
                  description={description}
                  required={required}
                  clearable={!required}
                  value={() => (typeof value(name) === "string" ? (value(name) as string) : null)}
                  onChange={(next) => props.onValueChange(name, next)}
                  error={errorFor(name)}
                />
              </Match>
              <Match when={input.type === "dateTime"}>
                <DateTimePicker
                  label={label}
                  description={description}
                  required={required}
                  clearable={!required}
                  value={() => (typeof value(name) === "string" ? (value(name) as string) : null)}
                  onChange={(next) => props.onValueChange(name, next)}
                  error={errorFor(name)}
                />
              </Match>
              <Match when={input.type === "select"}>
                <SelectInput
                  label={label}
                  description={description}
                  required={required}
                  clearable={!required}
                  options={workflowInputOptions(input)}
                  value={() => (typeof value(name) === "string" ? (value(name) as string) : "")}
                  onChange={(next) => props.onValueChange(name, next)}
                  error={errorFor(name)}
                />
              </Match>
              <Match when={input.type === "text"}>
                <TextInput
                  label={label}
                  description={description}
                  required={required}
                  clearable={!required}
                  value={() => (typeof value(name) === "string" ? (value(name) as string) : "")}
                  onInput={(next) => props.onValueChange(name, next)}
                  error={errorFor(name)}
                />
              </Match>
            </Switch>
          );
        }}
      </For>
      <Show when={inputs().length === 0}>
        <p class="text-sm text-dimmed">{props.emptyText ?? "This workflow does not require input."}</p>
      </Show>
    </div>
  );
}

import {
  DatePicker,
  DateTimePicker,
  dialogCore,
  MultiSelectInput,
  NumberInput,
  PanelDialog,
  panelDialogOptions,
  SelectInput,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import type { Workflow, WorkflowInput, WorkflowTriggerKind } from "../../../contracts";
import type { Table } from "../../../service";
import RecordPicker from "../records/RecordPicker";
import { fetchRecordLookup } from "../records/record-lookup";
import { triggerLabels } from "./workflow-display";
import { buildWorkflowRunInput, type WorkflowRunInputDraft, type WorkflowRunInputDraftValue } from "./workflow-trigger-actions";

type Props = {
  workflow: Workflow;
  triggerKind: WorkflowTriggerKind;
  tables: Table[];
  close: (input?: Record<string, unknown>) => void;
};

const resolveInputTable = (input: WorkflowInput, tables: Table[]): Table | null => {
  const reference = input.table?.trim().toLowerCase();
  if (!reference) return null;
  return tables.find((table) => [table.id, table.shortId, table.name].some((value) => value.toLowerCase() === reference)) ?? null;
};

function WorkflowRunInputDialog(props: Props) {
  const [draft, setDraft] = createSignal<WorkflowRunInputDraft>({});
  const inputs = () => Object.entries(props.workflow.compiled.inputs ?? {});
  const validation = createMemo(() => buildWorkflowRunInput(props.workflow.compiled.inputs ?? {}, draft()));
  const value = (name: string) => draft()[name];
  const setValue = (name: string, next: WorkflowRunInputDraftValue) => setDraft((current) => ({ ...current, [name]: next }));
  const errorFor = (name: string) => () => {
    const current = validation();
    return current.ok ? undefined : current.errors[name];
  };
  const submit = () => {
    const current = validation();
    if (current.ok) props.close(current.input);
  };

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={`Run ${props.workflow.name}`}
        subtitle={`${triggerLabels[props.triggerKind] ?? props.triggerKind} input`}
        icon="ti ti-player-play"
        close={() => props.close()}
      />
      <PanelDialog.Body>
        <div class="flex flex-col gap-3 p-4">
          <For each={inputs()}>
            {([name, input]) => {
              const label = input.label ?? name;
              const table = resolveInputTable(input, props.tables);
              return (
                <Switch>
                  <Match when={input.type === "record" && table}>
                    <RecordPicker
                      tableId={table!.id}
                      label={label}
                      description={input.description}
                      placeholder="Choose a record..."
                      clearable={!input.required}
                      value={() => (typeof value(name) === "string" ? (value(name) as string) : "")}
                      onChange={(recordId) => setValue(name, recordId)}
                    />
                  </Match>
                  <Match when={input.type === "recordList" && table}>
                    <MultiSelectInput
                      label={label}
                      description={input.description}
                      placeholder="Choose records..."
                      required={input.required}
                      clearable={!input.required}
                      value={() => (Array.isArray(value(name)) ? (value(name) as string[]) : [])}
                      onChange={(recordIds) => setValue(name, recordIds)}
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
                      description={input.description}
                      required={input.required}
                      decimalPlaces={10}
                      value={() => (typeof value(name) === "number" ? (value(name) as number) : null)}
                      onInput={(next) => setValue(name, next)}
                      error={errorFor(name)}
                    />
                  </Match>
                  <Match when={input.type === "boolean"}>
                    <SelectInput
                      label={label}
                      description={input.description}
                      required={input.required}
                      clearable={!input.required}
                      options={[
                        { id: "true", label: "Yes" },
                        { id: "false", label: "No" },
                      ]}
                      value={() => (typeof value(name) === "boolean" ? String(value(name)) : "")}
                      onChange={(next) => setValue(name, next === "" ? undefined : next === "true")}
                      error={errorFor(name)}
                    />
                  </Match>
                  <Match when={input.type === "date"}>
                    <DatePicker
                      label={label}
                      description={input.description}
                      required={input.required}
                      clearable={!input.required}
                      value={() => (typeof value(name) === "string" ? (value(name) as string) : null)}
                      onChange={(next) => setValue(name, next)}
                      error={errorFor(name)}
                    />
                  </Match>
                  <Match when={input.type === "dateTime"}>
                    <DateTimePicker
                      label={label}
                      description={input.description}
                      required={input.required}
                      clearable={!input.required}
                      value={() => (typeof value(name) === "string" ? (value(name) as string) : null)}
                      onChange={(next) => setValue(name, next)}
                      error={errorFor(name)}
                    />
                  </Match>
                  <Match when={input.type === "select"}>
                    <SelectInput
                      label={label}
                      description={input.description}
                      required={input.required}
                      clearable={!input.required}
                      options={input.options ?? []}
                      value={() => (typeof value(name) === "string" ? (value(name) as string) : "")}
                      onChange={(next) => setValue(name, next)}
                      error={errorFor(name)}
                    />
                  </Match>
                  <Match when={input.type === "text"}>
                    <TextInput
                      label={label}
                      description={input.description}
                      required={input.required}
                      clearable={!input.required}
                      value={() => (typeof value(name) === "string" ? (value(name) as string) : "")}
                      onInput={(next) => setValue(name, next)}
                      error={errorFor(name)}
                    />
                  </Match>
                </Switch>
              );
            }}
          </For>
          <Show when={inputs().length === 0}>
            <p class="text-sm text-dimmed">This workflow does not require input.</p>
          </Show>
        </div>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span />
        <div class="flex items-center gap-2">
          <button type="button" class="btn-input btn-sm" onClick={() => props.close()}>
            Cancel
          </button>
          <button type="button" class="btn-primary btn-sm" disabled={!validation().ok} onClick={submit}>
            <i class="ti ti-player-play" /> Run workflow
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export const requestWorkflowRunInput = async (args: {
  workflow: Workflow;
  triggerKind: WorkflowTriggerKind;
  tables: Table[];
}): Promise<Record<string, unknown> | undefined> => {
  if (Object.keys(args.workflow.compiled.inputs ?? {}).length === 0) return {};
  return dialogCore.open<Record<string, unknown>>((close) => <WorkflowRunInputDialog {...args} close={close} />, panelDialogOptions);
};

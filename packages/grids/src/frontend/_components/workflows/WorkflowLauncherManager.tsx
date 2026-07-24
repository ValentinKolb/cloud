import {
  CheckboxCard,
  dialogCore,
  PanelDialog,
  Placeholder,
  panelDialogOptions,
  prompts,
  SelectInput,
  TextInput,
  Tooltip,
} from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { Table } from "../../../service";
import type {
  CreateGridsWorkflowLauncherInput,
  GridsWorkflow,
  GridsWorkflowLauncher,
  GridsWorkflowLauncherKind,
} from "../../../workflows/contracts";
import { errorMessage } from "../utils/api-helpers";
import { WorkflowInputFields } from "./WorkflowInputFields";
import { dashboardLauncherConfigForSave, missingLauncherRequiredInputs } from "./workflow-launcher-draft";
import {
  buildWorkflowRunInput,
  type WorkflowRunInputDraft,
  type WorkflowRunInputDraftValue,
  workflowInputDraftFromValues,
} from "./workflow-trigger-actions";

type WorkflowLauncherApi = {
  ":workflowId": {
    launchers: {
      $get: (input: { param: { workflowId: string } }, options?: { init?: RequestInit }) => Promise<Response>;
      $post: (input: { param: { workflowId: string }; json: unknown }, options?: { init?: RequestInit }) => Promise<Response>;
    };
  };
  launchers: {
    ":launcherId": {
      $patch: (input: { param: { launcherId: string }; json: unknown }, options?: { init?: RequestInit }) => Promise<Response>;
      $delete: (input: { param: { launcherId: string } }, options?: { init?: RequestInit }) => Promise<Response>;
    };
  };
};

const workflowLauncherApi = apiClient.workflows as unknown as WorkflowLauncherApi;

type LauncherDraft = CreateGridsWorkflowLauncherInput;

const launcherKindOptions = [
  { id: "scanner", label: "Scanner" },
  { id: "bulk", label: "Bulk selection" },
  { id: "dashboard", label: "Dashboard button" },
];

const launcherKindLabel = (kind: GridsWorkflowLauncherKind) => launcherKindOptions.find((option) => option.id === kind)?.label ?? kind;

const launcherConfigurationSummary = (launcher: GridsWorkflowLauncher): string => {
  if (launcher.config.kind === "scanner") {
    return `${launcher.config.input} · ${launcher.config.resolve.by === "field" ? `field ${launcher.config.resolve.field}` : "generated scan code"}`;
  }
  if (launcher.config.kind === "bulk") return `Supplies ${launcher.config.input}`;
  return launcher.config.inputMode === "prompt" ? "Asks for input when run" : "Uses fixed input values";
};

const defaultDraft = (workflow: GridsWorkflow): LauncherDraft => {
  const recordInput = workflow.plan.inputs.find((input) => input.type === "record")?.name ?? "";
  return { name: "", enabled: true, config: { kind: "scanner", input: recordInput, resolve: { by: "scanCode" } } };
};

function LauncherEditor(props: {
  workflow: GridsWorkflow;
  tables: Table[];
  launcher?: GridsWorkflowLauncher;
  close: (draft?: LauncherDraft) => void;
}) {
  const initial = props.launcher ?? defaultDraft(props.workflow);
  const [name, setName] = createSignal(initial.name);
  const [enabled, setEnabled] = createSignal(initial.enabled ?? true);
  const [kind, setKind] = createSignal<GridsWorkflowLauncherKind>(initial.config.kind);
  const [input, setInput] = createSignal("input" in initial.config ? initial.config.input : "");
  const [resolveBy, setResolveBy] = createSignal<"scanCode" | "field">(
    initial.config.kind === "scanner" ? initial.config.resolve.by : "scanCode",
  );
  const [field, setField] = createSignal(
    initial.config.kind === "scanner" && initial.config.resolve.by === "field" ? (initial.config.resolve.field ?? "") : "",
  );
  const [dashboardInputMode, setDashboardInputMode] = createSignal<"fixed" | "prompt">(
    initial.config.kind === "dashboard" ? initial.config.inputMode : "fixed",
  );
  const [dashboardBindings, setDashboardBindings] = createSignal<WorkflowRunInputDraft>(
    workflowInputDraftFromValues(
      props.workflow.plan.inputs,
      initial.config.kind === "dashboard" ? initial.config.inputBindings : undefined,
    ),
  );
  const inputOptions = createMemo(() =>
    props.workflow.plan.inputs
      .filter((candidate) => candidate.type === (kind() === "scanner" ? "record" : "recordList"))
      .map((candidate) => ({ id: candidate.name, label: candidate.config.label?.toString() || candidate.name })),
  );
  const missingRequiredInputs = createMemo(() => missingLauncherRequiredInputs(props.workflow.plan.inputs, kind(), input()));
  const dashboardValidation = createMemo(() => buildWorkflowRunInput(props.workflow.plan.inputs, dashboardBindings()));
  const valid = createMemo(
    () =>
      name().trim().length > 0 &&
      (kind() === "dashboard"
        ? dashboardInputMode() === "prompt" || dashboardValidation().ok
        : input().length > 0 &&
          missingRequiredInputs().length === 0 &&
          (kind() !== "scanner" || resolveBy() !== "field" || field().trim().length > 0)),
  );
  const dashboardErrors = () => {
    const validation = dashboardValidation();
    return validation.ok ? {} : validation.errors;
  };
  const setDashboardBinding = (name: string, value: WorkflowRunInputDraftValue) =>
    setDashboardBindings((current) => ({ ...current, [name]: value }));

  const submit = () => {
    if (!valid()) return;
    const bindings = dashboardValidation();
    const config: LauncherDraft["config"] =
      kind() === "dashboard"
        ? dashboardLauncherConfigForSave(
            props.launcher,
            dashboardInputMode(),
            dashboardInputMode() === "fixed" && bindings.ok ? bindings.input : undefined,
          )
        : kind() === "bulk"
          ? { kind: "bulk", input: input() }
          : {
              kind: "scanner",
              input: input(),
              resolve: resolveBy() === "field" ? { by: "field", field: field().trim() } : { by: "scanCode" },
            };
    props.close({ name: name().trim(), enabled: enabled(), config });
  };

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={props.launcher ? "Edit run option" : "Add run option"}
        subtitle={props.workflow.name}
        icon="ti ti-rocket"
        close={() => props.close()}
      />
      <PanelDialog.Body>
        <div class="flex flex-col gap-3">
          <TextInput label="Name" required value={name} onInput={setName} icon="ti ti-letter-case" />
          <SelectInput
            label="Surface"
            required
            options={launcherKindOptions}
            value={() => kind()}
            onChange={(value) => {
              const next = value as GridsWorkflowLauncherKind;
              setKind(next);
              if (next !== "dashboard") {
                setInput(
                  props.workflow.plan.inputs.find((candidate) => candidate.type === (next === "scanner" ? "record" : "recordList"))?.name ??
                    "",
                );
              }
            }}
          />
          <Show when={kind() !== "dashboard"}>
            <SelectInput
              label={kind() === "scanner" ? "Record input" : "Record-list input"}
              description="The launcher supplies this workflow input."
              required
              options={inputOptions()}
              value={input}
              onChange={setInput}
            />
            <Show when={missingRequiredInputs().length > 0}>
              <div class="info-block-danger text-sm" role="alert">
                This surface cannot supply the required {missingRequiredInputs().length === 1 ? "input" : "inputs"}:{" "}
                {missingRequiredInputs().join(", ")}. Use a dashboard launcher or make the inputs optional.
              </div>
            </Show>
          </Show>
          <Show when={kind() === "dashboard"}>
            <SelectInput
              label="Inputs"
              description="Use fixed values for a one-click action, or ask the user when the button runs."
              required
              options={[
                { id: "fixed", label: "Fixed values" },
                { id: "prompt", label: "Ask when run" },
              ]}
              value={dashboardInputMode}
              onChange={(value) => setDashboardInputMode(value as "fixed" | "prompt")}
            />
            <Show when={dashboardInputMode() === "fixed"}>
              <WorkflowInputFields
                workflow={props.workflow}
                tables={props.tables}
                draft={dashboardBindings}
                onValueChange={setDashboardBinding}
                errors={dashboardErrors}
                emptyText="This workflow does not need input."
              />
              <Show when={!dashboardValidation().ok}>
                <div class="info-block-danger text-sm" role="alert">
                  Provide valid fixed values for every required workflow input.
                </div>
              </Show>
            </Show>
          </Show>
          <Show when={kind() === "scanner"}>
            <SelectInput
              label="Resolve scanned values by"
              required
              options={[
                { id: "scanCode", label: "Generated scan code" },
                { id: "field", label: "Unique field" },
              ]}
              value={resolveBy}
              onChange={(value) => setResolveBy(value as "scanCode" | "field")}
            />
            <Show when={resolveBy() === "field"}>
              <TextInput
                label="Unique field"
                description="Use a field name, short ID, or UUID from the bound table."
                required
                value={field}
                onInput={setField}
                icon="ti ti-columns"
              />
            </Show>
          </Show>
          <CheckboxCard
            label="Enabled"
            description="Enabled run options are available on their scanner, table, or dashboard surface."
            value={enabled}
            onChange={setEnabled}
          />
        </div>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span />
        <div class="flex items-center gap-2">
          <button type="button" class="btn-input btn-sm" onClick={() => props.close()}>
            Cancel
          </button>
          <button type="button" class="btn-primary btn-sm" disabled={!valid()} onClick={submit}>
            <i class="ti ti-check" /> {props.launcher ? "Save run option" : "Add run option"}
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

const requestLauncherDraft = (workflow: GridsWorkflow, tables: Table[], launcher?: GridsWorkflowLauncher) =>
  dialogCore.open<LauncherDraft>(
    (close) => <LauncherEditor workflow={workflow} tables={tables} launcher={launcher} close={close} />,
    panelDialogOptions,
  );

export function WorkflowLauncherManager(props: { workflow: GridsWorkflow; tables: Table[]; onChanged: () => void; onClose: () => void }) {
  const [launchers, setLaunchers] = createSignal<GridsWorkflowLauncher[]>([]);
  const [loaded, setLoaded] = createSignal(false);

  const loadMut = mutations.create<void, void>({
    onBefore: () => setLoaded(false),
    mutation: async (_, { abortSignal }) => {
      const res = await workflowLauncherApi[":workflowId"].launchers.$get(
        { param: { workflowId: props.workflow.id } },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Could not load run options."));
      setLaunchers(((await res.json()) as { items: GridsWorkflowLauncher[] }).items);
    },
    onSuccess: () => setLoaded(true),
  });

  const saveMut = mutations.create<GridsWorkflowLauncher, { launcher?: GridsWorkflowLauncher; draft: LauncherDraft }>({
    mutation: async ({ launcher, draft }, { abortSignal }) => {
      const res = launcher
        ? await workflowLauncherApi.launchers[":launcherId"].$patch(
            { param: { launcherId: launcher.id }, json: draft },
            { init: { signal: abortSignal } },
          )
        : await workflowLauncherApi[":workflowId"].launchers.$post(
            { param: { workflowId: props.workflow.id }, json: draft },
            { init: { signal: abortSignal } },
          );
      if (!res.ok) throw new Error(await errorMessage(res, "Could not save run option."));
      return (await res.json()) as GridsWorkflowLauncher;
    },
    onSuccess: () => {
      loadMut.mutate();
      props.onChanged();
    },
    onError: (error) => prompts.error(error.message),
  });

  const removeMut = mutations.create<void, GridsWorkflowLauncher>({
    mutation: async (launcher, { abortSignal }) => {
      const confirmed = await prompts.confirm(`Delete run option "${launcher.name}"?`, {
        title: "Delete run option?",
        variant: "danger",
        confirmText: "Delete",
      });
      if (!confirmed) return;
      const res = await workflowLauncherApi.launchers[":launcherId"].$delete(
        { param: { launcherId: launcher.id } },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Could not delete run option."));
    },
    onSuccess: () => {
      loadMut.mutate();
      props.onChanged();
    },
    onError: (error) => prompts.error(error.message),
  });

  const edit = async (launcher?: GridsWorkflowLauncher) => {
    if (!loaded() || loadMut.loading() || saveMut.loading() || removeMut.loading()) return;
    const draft = await requestLauncherDraft(props.workflow, props.tables, launcher);
    if (draft) saveMut.mutate({ launcher, draft });
  };

  const mutationsBlocked = () => !loaded() || loadMut.loading() || saveMut.loading() || removeMut.loading();

  onMount(() => loadMut.mutate());

  return (
    <PanelDialog>
      <PanelDialog.Header title="Run options" subtitle={props.workflow.name} icon="ti ti-rocket" close={props.onClose} />
      <PanelDialog.Body>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm text-dimmed">Make this workflow available as a scanner, bulk action, or dashboard button.</p>
            <button type="button" class="btn-primary btn-sm" disabled={mutationsBlocked()} onClick={() => void edit()}>
              <i class="ti ti-plus" /> Add run option
            </button>
          </div>
          <Show
            when={!loadMut.error()}
            fallback={
              <Placeholder
                state="error"
                surface="paper"
                align="left"
                title="Could not load run options"
                description={loadMut.error()?.message}
                action={
                  <button type="button" class="btn-input btn-input-sm" disabled={loadMut.loading()} onClick={() => loadMut.retry()}>
                    <i class="ti ti-refresh" aria-hidden="true" /> Retry
                  </button>
                }
              />
            }
          >
            <Show when={loaded()} fallback={<Placeholder state="loading" align="left" description="Loading run options..." />}>
              <For each={launchers()} fallback={<Placeholder align="left">No run options configured.</Placeholder>}>
                {(launcher) => {
                  const stale = () => launcher.validatedRevision !== props.workflow.revision;
                  const invalid = () => launcher.diagnostics.some((diagnostic) => diagnostic.severity === "error");
                  return (
                    <div class="paper flex items-start gap-3 px-3 py-2">
                      <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] text-secondary">
                        <i
                          class={`ti ${launcher.config.kind === "scanner" ? "ti-barcode" : launcher.config.kind === "bulk" ? "ti-list-check" : "ti-layout-dashboard"}`}
                        />
                      </span>
                      <span class="min-w-0 flex-1">
                        <span class="flex min-w-0 items-center gap-2">
                          <span class="truncate text-sm font-medium text-primary">{launcher.name}</span>
                          <span class={`badge ${launcher.enabled && !stale() && !invalid() ? "badge-success" : "badge-neutral"}`}>
                            {launcher.enabled && !stale() && !invalid() ? "available" : "unavailable"}
                          </span>
                        </span>
                        <span class="mt-0.5 block text-xs text-dimmed">
                          {launcherKindLabel(launcher.config.kind)} · {launcherConfigurationSummary(launcher)}
                        </span>
                        <Show when={stale()}>
                          <span class="mt-1 block text-xs text-amber-700 dark:text-amber-300">
                            Workflow changed. Review and save this run option before enabling it.
                          </span>
                        </Show>
                        <For each={launcher.diagnostics}>
                          {(diagnostic) => <span class="mt-1 block text-xs text-red-600 dark:text-red-400">{diagnostic.message}</span>}
                        </For>
                      </span>
                      <Tooltip content="Edit run option">
                        <button
                          type="button"
                          class="icon-btn"
                          disabled={mutationsBlocked()}
                          aria-label={`Edit ${launcher.name}`}
                          onClick={() => void edit(launcher)}
                        >
                          <i class="ti ti-pencil" />
                        </button>
                      </Tooltip>
                      <Tooltip content="Delete run option">
                        <button
                          type="button"
                          class="icon-btn text-red-600 dark:text-red-400"
                          disabled={mutationsBlocked()}
                          aria-label={`Delete ${launcher.name}`}
                          onClick={() => removeMut.mutate(launcher)}
                        >
                          <i class="ti ti-trash" />
                        </button>
                      </Tooltip>
                    </div>
                  );
                }}
              </For>
            </Show>
          </Show>
        </div>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span />
        <button type="button" class="btn-input btn-sm" onClick={props.onClose}>
          Done
        </button>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

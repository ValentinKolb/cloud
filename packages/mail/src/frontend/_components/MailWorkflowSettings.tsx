import {
  dialogCore,
  NumberInput,
  PanelDialog,
  Placeholder,
  panelDialogWorkspaceOptions,
  prompts,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { MailWorkflow, MailWorkflowDetail, MailWorkflowVersion, WorkflowEffectBudget, WorkflowValidation } from "../../contracts";
import { readApiError } from "./api-response";

const DEFAULT_BUDGET: WorkflowEffectBudget = {
  maxTargets: 1_000,
  maxMoves: 1_000,
  maxCopies: 1_000,
  maxSends: 1_000,
  maxDrafts: 1_000,
  maxFlagChanges: 2_000,
  maxNotifications: 1_000,
  maxKeywordChanges: 2_000,
  maxCollaborationChanges: 2_000,
};

const STARTER_SOURCE = `inputs:
  message:
    type: mailMessage
    required: true
steps:
  - addKeyword:
      message: "\${{ inputs.message }}"
      keyword: Review
`;

const asSummary = (workflow: MailWorkflowDetail): MailWorkflow => ({
  id: workflow.id,
  mailboxId: workflow.mailboxId,
  name: workflow.name,
  description: workflow.description,
  priority: workflow.priority,
  currentVersionId: workflow.currentVersionId,
  activeVersionId: workflow.activeVersionId,
  enabled: workflow.enabled,
  createdAt: workflow.createdAt,
  updatedAt: workflow.updatedAt,
});

function WorkflowEditor(props: {
  mailboxId: string;
  workflow: MailWorkflowDetail | null;
  close: () => void;
  onSaved: (workflow: MailWorkflowDetail) => void;
}) {
  const [name, setName] = createSignal(props.workflow?.name ?? "");
  const [description, setDescription] = createSignal(props.workflow?.description ?? "");
  const [priority, setPriority] = createSignal(props.workflow?.priority ?? 100);
  const [source, setSource] = createSignal(props.workflow?.currentVersion.source ?? STARTER_SOURCE);
  const initialBudget = props.workflow?.currentVersion.effectBudget ?? DEFAULT_BUDGET;
  const [maxTargets, setMaxTargets] = createSignal(initialBudget.maxTargets);
  const [maxMoves, setMaxMoves] = createSignal(initialBudget.maxMoves);
  const [maxCopies, setMaxCopies] = createSignal(initialBudget.maxCopies ?? DEFAULT_BUDGET.maxCopies ?? 1_000);
  const [maxSends, setMaxSends] = createSignal(initialBudget.maxSends ?? DEFAULT_BUDGET.maxSends ?? 1_000);
  const [maxDrafts, setMaxDrafts] = createSignal(initialBudget.maxDrafts ?? DEFAULT_BUDGET.maxDrafts ?? 1_000);
  const [maxFlagChanges, setMaxFlagChanges] = createSignal(initialBudget.maxFlagChanges ?? DEFAULT_BUDGET.maxFlagChanges ?? 2_000);
  const [maxNotifications, setMaxNotifications] = createSignal(initialBudget.maxNotifications ?? DEFAULT_BUDGET.maxNotifications ?? 1_000);
  const [maxKeywordChanges, setMaxKeywordChanges] = createSignal(initialBudget.maxKeywordChanges);
  const [maxCollaborationChanges, setMaxCollaborationChanges] = createSignal(initialBudget.maxCollaborationChanges);
  const [validation, setValidation] = createSignal<WorkflowValidation | null>(null);

  const budget = (): WorkflowEffectBudget => ({
    maxTargets: maxTargets(),
    maxMoves: maxMoves(),
    maxCopies: maxCopies(),
    maxSends: maxSends(),
    maxDrafts: maxDrafts(),
    maxFlagChanges: maxFlagChanges(),
    maxNotifications: maxNotifications(),
    maxKeywordChanges: maxKeywordChanges(),
    maxCollaborationChanges: maxCollaborationChanges(),
  });

  const validate = mutations.create<WorkflowValidation, void>({
    mutation: async () => {
      const response = await apiClient.mailboxes[":mailboxId"].workflows.validate.$post({
        param: { mailboxId: props.mailboxId },
        json: { source: source() },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Workflow validation failed"));
      return await response.json();
    },
    onSuccess: (result) => {
      setValidation(result);
      if (result.valid) toast.success("Workflow is valid");
    },
    onError: (error) => prompts.error(error.message),
  });

  const save = mutations.create<MailWorkflowDetail, void>({
    mutation: async () => {
      const existing = props.workflow;
      const response = existing
        ? await apiClient.mailboxes[":mailboxId"].workflows[":workflowId"].versions.$post({
            param: { mailboxId: props.mailboxId, workflowId: existing.id },
            json: { source: source(), effectBudget: budget() },
          })
        : await apiClient.mailboxes[":mailboxId"].workflows.$post({
            param: { mailboxId: props.mailboxId },
            json: {
              name: name().trim(),
              description: description().trim() || null,
              priority: priority(),
              source: source(),
              effectBudget: budget(),
            },
          });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to save workflow"));
      return await response.json();
    },
    onSuccess: (workflow) => {
      toast.success(props.workflow ? "Workflow version saved" : "Workflow created");
      props.onSaved(workflow);
      props.close();
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={props.workflow ? props.workflow.name : "New workflow"}
        subtitle="Canonical YAML with immutable saved versions"
        icon="ti ti-route"
        close={props.close}
      />
      <PanelDialog.Body>
        <Show when={!props.workflow}>
          <PanelDialog.Section title="Identity" subtitle="Shown to mailbox administrators." icon="ti ti-id">
            <TextInput label="Name" value={name} onInput={setName} required />
            <TextInput label="Description" value={description} onInput={setDescription} multiline lines={2} />
            <NumberInput label="Priority" value={priority} onInput={(value) => setPriority(value ?? 100)} min={-1_000} max={1_000} />
          </PanelDialog.Section>
        </Show>
        <PanelDialog.Section
          title="Workflow YAML"
          subtitle="Save creates a new immutable version; activation remains explicit."
          icon="ti ti-code"
        >
          <TextInput
            ariaLabel="Workflow YAML"
            value={source}
            onInput={(value) => {
              setSource(value);
              setValidation(null);
            }}
            multiline
            monospace
            lines={24}
            spellcheck={false}
            autocapitalize="off"
          />
          <Show when={validation()}>
            {(result) => (
              <div class={result().valid ? "info-block-success" : "info-block-danger"} role="status">
                <p class="text-sm font-medium">{result().valid ? "YAML is valid" : "Fix validation errors before saving"}</p>
                <For each={result().diagnostics}>
                  {(diagnostic) => (
                    <p class="mt-1 font-mono text-xs">
                      {diagnostic.location ? `Line ${diagnostic.location.line}, column ${diagnostic.location.column}: ` : ""}
                      {diagnostic.message}
                    </p>
                  )}
                </For>
              </div>
            )}
          </Show>
        </PanelDialog.Section>
        <PanelDialog.Section title="Effect budget" subtitle="Hard limits bound each workflow execution." icon="ti ti-gauge">
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <NumberInput label="Targets" value={maxTargets} onInput={(value) => setMaxTargets(value ?? 1)} min={1} max={50_000} />
            <NumberInput label="Moves" value={maxMoves} onInput={(value) => setMaxMoves(value ?? 0)} min={0} max={50_000} />
            <NumberInput label="Copies" value={maxCopies} onInput={(value) => setMaxCopies(value ?? 0)} min={0} max={50_000} />
            <NumberInput label="Sends" value={maxSends} onInput={(value) => setMaxSends(value ?? 0)} min={0} max={50_000} />
            <NumberInput label="Drafts" value={maxDrafts} onInput={(value) => setMaxDrafts(value ?? 0)} min={0} max={50_000} />
            <NumberInput
              label="Flag changes"
              value={maxFlagChanges}
              onInput={(value) => setMaxFlagChanges(value ?? 0)}
              min={0}
              max={100_000}
            />
            <NumberInput
              label="Notifications"
              value={maxNotifications}
              onInput={(value) => setMaxNotifications(value ?? 0)}
              min={0}
              max={50_000}
            />
            <NumberInput
              label="Keyword changes"
              value={maxKeywordChanges}
              onInput={(value) => setMaxKeywordChanges(value ?? 0)}
              min={0}
              max={100_000}
            />
            <NumberInput
              label="Collaboration changes"
              value={maxCollaborationChanges}
              onInput={(value) => setMaxCollaborationChanges(value ?? 0)}
              min={0}
              max={100_000}
            />
          </div>
        </PanelDialog.Section>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <button type="button" class="btn-secondary btn-sm" disabled={validate.loading()} onClick={() => validate.mutate()}>
          <i class={`ti ${validate.loading() ? "ti-loader-2 animate-spin" : "ti-shield-check"}`} aria-hidden="true" /> Validate
        </button>
        <div class="flex items-center gap-2">
          <button type="button" class="btn-simple btn-sm" onClick={props.close}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary btn-sm"
            disabled={save.loading() || !source().trim() || (!props.workflow && !name().trim())}
            onClick={() => save.mutate()}
          >
            <i class={`ti ${save.loading() ? "ti-loader-2 animate-spin" : "ti-device-floppy"}`} aria-hidden="true" />
            {props.workflow ? "Save version" : "Create workflow"}
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export default function MailWorkflowSettings(props: {
  mailboxId: string;
  initialWorkflows: MailWorkflow[];
  onWorkflowsChange?: (workflows: MailWorkflow[]) => void;
}) {
  const [workflows, setWorkflows] = createSignal(props.initialWorkflows);
  const [versions, setVersions] = createSignal<Record<string, MailWorkflowVersion[]>>({});
  const [expandedWorkflowId, setExpandedWorkflowId] = createSignal<string | null>(null);

  const replaceWorkflow = (workflow: MailWorkflowDetail) => {
    setVersions((current) => {
      if (!current[workflow.id]) return current;
      const next = { ...current };
      delete next[workflow.id];
      return next;
    });
    const next = (() => {
      const current = workflows();
      const summary = asSummary(workflow);
      return current.some((item) => item.id === workflow.id)
        ? current.map((item) => (item.id === workflow.id ? summary : item))
        : [...current, summary];
    })();
    setWorkflows(next);
    props.onWorkflowsChange?.(next);
  };

  const openEditor = async (workflow?: MailWorkflow) => {
    let detail: MailWorkflowDetail | null = null;
    if (workflow) {
      const response = await apiClient.mailboxes[":mailboxId"].workflows[":workflowId"].$get({
        param: { mailboxId: props.mailboxId, workflowId: workflow.id },
      });
      if (!response.ok) return await prompts.error(await readApiError(response, "Failed to load workflow"));
      detail = await response.json();
    }
    await dialogCore.open<void>(
      (close) => <WorkflowEditor mailboxId={props.mailboxId} workflow={detail} close={() => close()} onSaved={replaceWorkflow} />,
      panelDialogWorkspaceOptions,
    );
  };

  const activate = mutations.create<MailWorkflowDetail, MailWorkflow>({
    mutation: async (workflow) => {
      const response = await apiClient.mailboxes[":mailboxId"].workflows[":workflowId"].activate.$post({
        param: { mailboxId: props.mailboxId, workflowId: workflow.id },
        json: { expectedVersionId: workflow.currentVersionId },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to activate workflow"));
      return await response.json();
    },
    onSuccess: (workflow) => {
      replaceWorkflow(workflow);
      toast.success("Workflow activated");
    },
    onError: (error) => prompts.error(error.message),
  });

  const deactivate = mutations.create<MailWorkflowDetail, MailWorkflow>({
    mutation: async (workflow) => {
      if (!workflow.activeVersionId) throw new Error("Workflow is not active");
      const response = await apiClient.mailboxes[":mailboxId"].workflows[":workflowId"].deactivate.$post({
        param: { mailboxId: props.mailboxId, workflowId: workflow.id },
        json: { expectedVersionId: workflow.activeVersionId },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to deactivate workflow"));
      return await response.json();
    },
    onSuccess: (workflow) => {
      replaceWorkflow(workflow);
      toast.success("Workflow deactivated");
    },
    onError: (error) => prompts.error(error.message),
  });

  const toggleVersions = async (workflow: MailWorkflow) => {
    if (expandedWorkflowId() === workflow.id) return setExpandedWorkflowId(null);
    setExpandedWorkflowId(workflow.id);
    if (versions()[workflow.id]) return;
    const response = await apiClient.mailboxes[":mailboxId"].workflows[":workflowId"].versions.$get({
      param: { mailboxId: props.mailboxId, workflowId: workflow.id },
    });
    if (!response.ok) {
      setExpandedWorkflowId(null);
      return prompts.error(await readApiError(response, "Failed to load workflow versions"));
    }
    const loaded = await response.json();
    setVersions((current) => ({ ...current, [workflow.id]: loaded }));
  };

  return (
    <div class="flex flex-col gap-2">
      <div class="flex justify-end">
        <button type="button" class="btn-primary btn-sm" onClick={() => void openEditor()}>
          <i class="ti ti-plus" aria-hidden="true" /> New workflow
        </button>
      </div>
      <Show
        when={workflows().length > 0}
        fallback={
          <Placeholder title="No workflows" description="Create a deterministic workflow from canonical YAML." icon="ti ti-route-off" />
        }
      >
        <For each={workflows()}>
          {(workflow) => (
            <div class="paper flex flex-col gap-2 p-3">
              <div class="flex items-center gap-3">
                <span class="thumbnail flex h-9 w-9 shrink-0 items-center justify-center">
                  <i class="ti ti-route" aria-hidden="true" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium text-primary">{workflow.name}</span>
                  <span class="block truncate text-xs text-dimmed">{workflow.description || `Priority ${workflow.priority}`}</span>
                </span>
                <span class={`badge ${workflow.enabled ? "badge-success" : ""}`}>{workflow.enabled ? "Active" : "Inactive"}</span>
                <Show when={workflow.enabled && workflow.activeVersionId !== workflow.currentVersionId}>
                  <span class="badge badge-warning">Update available</span>
                </Show>
                <button type="button" class="btn-simple btn-sm" onClick={() => void toggleVersions(workflow)}>
                  <i class="ti ti-history" aria-hidden="true" /> Versions
                </button>
                <button type="button" class="btn-simple btn-sm" onClick={() => void openEditor(workflow)}>
                  <i class="ti ti-code" aria-hidden="true" /> Edit YAML
                </button>
                <Show
                  when={workflow.enabled && workflow.activeVersionId === workflow.currentVersionId}
                  fallback={
                    <button
                      type="button"
                      class="btn-secondary btn-sm"
                      disabled={activate.loading()}
                      onClick={() => activate.mutate(workflow)}
                    >
                      {workflow.enabled ? "Activate current version" : "Activate"}
                    </button>
                  }
                >
                  <button
                    type="button"
                    class="btn-secondary btn-sm"
                    disabled={deactivate.loading()}
                    onClick={() => deactivate.mutate(workflow)}
                  >
                    Deactivate
                  </button>
                </Show>
              </div>
              <Show when={expandedWorkflowId() === workflow.id}>
                <div class="flex flex-col gap-1 pl-12">
                  <For each={versions()[workflow.id] ?? []}>
                    {(version) => (
                      <div class="flex items-center gap-2 text-xs text-dimmed">
                        <i
                          class={`ti ${version.id === workflow.activeVersionId ? "ti-circle-check text-green-600" : "ti-git-commit"}`}
                          aria-hidden="true"
                        />
                        <span class="min-w-0 flex-1 truncate font-mono">{version.identity}</span>
                        <Show when={version.id === workflow.currentVersionId}>
                          <span class="badge">Current</span>
                        </Show>
                        <Show when={version.id === workflow.activeVersionId}>
                          <span class="badge badge-success">Active</span>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}

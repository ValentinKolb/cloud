import { mutation, query } from "@k2b/stdlib/solid";
import {
  Button,
  CheckboxCard,
  confirmDiscardIfDirty,
  dialogCore,
  NoticeCard,
  PanelDialog,
  Placeholder,
  panelDialogOptions,
  prompts,
} from "@k2b/ui";
import { createMemo, createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { MutationSource, TableMutationPolicy } from "../../../contracts";
import { errorMessage } from "../utils/api-helpers";

export type MutationPolicyImpactItem = {
  kind: "form" | "workflow" | "action";
  id: string;
  name: string;
};

export type MutationPolicyImpact = {
  items: MutationPolicyImpactItem[];
  total: number;
  limit: number;
  truncated: boolean;
  complete: boolean;
};

const SOURCE_OPTIONS: Array<{
  id: MutationSource;
  label: string;
  description: string;
  icon: string;
}> = [
  {
    id: "direct",
    label: "Direct editing and record API",
    description: "Editing in the Base or a Grids App, Record Editor, API, CLI, and imports.",
    icon: "ti ti-edit",
  },
  {
    id: "form",
    label: "Forms",
    description: "Active Forms, including Forms published in a Grids App.",
    icon: "ti ti-forms",
  },
  {
    id: "workflow",
    label: "Workflows and actions",
    description: "Enabled Workflows, run options, and published Grids App actions.",
    icon: "ti ti-route",
  },
];

const ALL_SOURCES = SOURCE_OPTIONS.map((option) => option.id);

const selectedSources = (policy: TableMutationPolicy): MutationSource[] => (policy.mode === "all" ? [...ALL_SOURCES] : policy.sources);

const canonicalPolicy = (policy: TableMutationPolicy): TableMutationPolicy => {
  if (policy.mode === "all") return policy;
  const sources = ALL_SOURCES.filter((source) => policy.sources.includes(source));
  return sources.length === ALL_SOURCES.length ? { mode: "all" } : { mode: "selected", sources };
};

export const mutationPolicySummary = (policy: TableMutationPolicy): string => {
  const canonical = canonicalPolicy(policy);
  if (canonical.mode === "all") return "All record change sources are allowed.";
  if (canonical.sources.length === 0) return "Record changes are frozen.";
  return canonical.sources.map((source) => SOURCE_OPTIONS.find((option) => option.id === source)!.label).join(", ");
};

const removedSources = (saved: TableMutationPolicy, draft: TableMutationPolicy): MutationSource[] => {
  const next = new Set(selectedSources(canonicalPolicy(draft)));
  return selectedSources(canonicalPolicy(saved)).filter((source) => !next.has(source));
};

const IMPACT_KIND = {
  form: { label: "Form", icon: "ti ti-forms" },
  workflow: { label: "Workflow", icon: "ti ti-route" },
  action: { label: "Action", icon: "ti ti-bolt" },
} as const;

export const openMutationPolicyDialog = (args: {
  tableId: string;
  tableName: string;
  value: TableMutationPolicy;
}): Promise<TableMutationPolicy | null> =>
  dialogCore
    .open<TableMutationPolicy | null>((close) => <MutationPolicyDialog args={args} close={close} />, panelDialogOptions)
    .then((result) => result ?? null);

function MutationPolicyDialog(props: {
  args: { tableId: string; tableName: string; value: TableMutationPolicy };
  close: (value: TableMutationPolicy | null) => void;
}) {
  const saved = canonicalPolicy(props.args.value);
  const [policy, setPolicy] = createSignal<TableMutationPolicy>(saved);
  const normalized = createMemo(() => canonicalPolicy(policy()));
  const dirty = () => JSON.stringify(normalized()) !== JSON.stringify(saved);
  const removed = createMemo(() => removedSources(saved, normalized()));
  const policyKey = () => JSON.stringify(normalized());
  const hasRemovedSources = () => removed().length > 0;
  const isFrozen = () => {
    const target = normalized();
    return target.mode === "selected" && target.sources.length === 0;
  };

  const impactQuery = query.create({
    source: policyKey,
    enabled: hasRemovedSources,
    load: async (key, { abortSignal }) => {
      const target = JSON.parse(key) as TableMutationPolicy;
      const response = await apiClient.tables[":tableId"]["mutation-policy"].impact.$post(
        { param: { tableId: props.args.tableId }, json: { policy: target } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await errorMessage(response, "Could not check affected entry points"));
      return { key, impact: (await response.json()) as MutationPolicyImpact };
    },
  });

  const currentImpact = () => {
    const result = impactQuery.data();
    return result?.key === policyKey() ? result.impact : null;
  };
  const impactReady = () => !hasRemovedSources() || (!impactQuery.loading() && !impactQuery.error() && currentImpact() !== null);

  const saveMutation = mutation.create<{ policy: TableMutationPolicy }, void>({
    mutation: async () => {
      const response = await apiClient.tables[":tableId"]["mutation-policy"].$put({
        param: { tableId: props.args.tableId },
        json: { policy: normalized(), ...(isFrozen() ? { confirmFreeze: true as const } : {}) },
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not save record change sources"));
      return response.json();
    },
    onSuccess: (result) => props.close(result.policy),
    onError: (error) => prompts.error(error.message),
  });

  const closeIfClean = async () => {
    if (await confirmDiscardIfDirty(dirty)) props.close(null);
  };

  const save = async () => {
    if (!dirty() || !impactReady()) return;
    if (isFrozen() && selectedSources(saved).length > 0) {
      const confirmed = await prompts.confirm(
        `No one will be able to create, edit, trash, restore, relate, or attach files in “${props.args.tableName}” until an admin allows a source again. Existing records remain readable.`,
        {
          title: "Freeze record changes?",
          confirmText: "Freeze changes",
          variant: "danger",
          confirmationPhrase: props.args.tableName,
        },
      );
      if (!confirmed) return;
    }
    saveMutation.mutate(undefined);
  };

  const setAll = (allowed: boolean) => {
    setPolicy(allowed ? { mode: "all" } : { mode: "selected", sources: [...ALL_SOURCES] });
  };

  const setSource = (source: MutationSource, allowed: boolean) => {
    const current = selectedSources(policy());
    const sources = ALL_SOURCES.filter((candidate) => (candidate === source ? allowed : current.includes(candidate)));
    setPolicy(sources.length === ALL_SOURCES.length ? { mode: "all" } : { mode: "selected", sources });
  };

  return (
    <PanelDialog>
      <PanelDialog.Header title="Record changes" subtitle={props.args.tableName} icon="ti ti-route" close={closeIfClean} />
      <PanelDialog.Body>
        <NoticeCard
          tone="info"
          title="Choose where record changes can start"
          detail="Keep All on for normal Grids behavior. Turn it off only when this table should accept changes from selected entry points. Permissions, field rules, audit requirements, history, and finalization still apply. This setting does not by itself provide a legal or regulatory guarantee."
        />

        <PanelDialog.Section title="Allowed sources" subtitle="Applies to records, Relations, and Files." icon="ti ti-route">
          <CheckboxCard
            label="All"
            description="Allow direct changes, Forms, and Workflows. This is the default for existing tables."
            icon="ti ti-arrows-exchange"
            value={() => policy().mode === "all"}
            onValueChange={setAll}
          />
          <Show when={policy().mode === "selected"}>
            <div class="grid gap-2">
              <For each={SOURCE_OPTIONS}>
                {(option) => (
                  <CheckboxCard
                    label={option.label}
                    description={option.description}
                    icon={option.icon}
                    variant="input"
                    value={() => selectedSources(policy()).includes(option.id)}
                    onValueChange={(allowed) => setSource(option.id, allowed)}
                  />
                )}
              </For>
            </div>
          </Show>
          <Show when={isFrozen()}>
            <NoticeCard
              tone="warning"
              title="This will freeze record changes"
              detail="No source will be able to create, edit, trash, restore, relate, or attach files in this table. Existing records remain readable."
            />
          </Show>
        </PanelDialog.Section>

        <Show when={hasRemovedSources()}>
          <PanelDialog.Section
            title="What will stop working"
            subtitle="Active entry points that use a source you are removing."
            icon="ti ti-alert-triangle"
          >
            <Show
              when={!impactQuery.loading()}
              fallback={<Placeholder state="loading" align="left" title="Checking active entry points…" />}
            >
              <Show
                when={!impactQuery.error()}
                fallback={
                  <Placeholder
                    state="error"
                    align="left"
                    title="Affected entry points are unavailable"
                    description={impactQuery.error()?.message}
                    action={
                      <Button variant="secondary" size="sm" type="button" onClick={() => void impactQuery.refresh()}>
                        Retry
                      </Button>
                    }
                  />
                }
              >
                <Show when={currentImpact()}>
                  {(impact) => (
                    <Show
                      when={impact().total > 0 || !impact().complete}
                      fallback={
                        <NoticeCard
                          tone="neutral"
                          title="No active configured entry points were found"
                          detail="The preview found no active Form, Action, or Workflow for the sources you are removing. The policy still applies to every matching request."
                        />
                      }
                    >
                      <NoticeCard
                        tone="warning"
                        title={
                          !impact().complete && impact().total === 0
                            ? "More active entry points may be affected"
                            : `${impact().complete ? "" : "At least "}${impact().total} active entry point${impact().total === 1 ? "" : "s"} will stop changing this table`
                        }
                        detail={
                          !impact().complete
                            ? "This table is used by many Workflows, so the preview is limited. More active entry points may be affected."
                            : impact().truncated
                              ? `Showing ${impact().items.length} of ${impact().total}. More active entry points are affected.`
                              : "Review these entry points before saving."
                        }
                      />
                      <ul class="paper divide-y divide-[var(--ui-border)]" aria-label="Affected entry points">
                        <For each={impact().items}>
                          {(item) => (
                            <li class="flex items-center gap-3 px-3 py-2">
                              <i class={`${IMPACT_KIND[item.kind].icon} text-base text-dimmed`} aria-hidden="true" />
                              <span class="min-w-0 flex-1 truncate text-sm font-medium text-primary">{item.name}</span>
                              <span class="text-xs text-dimmed">{IMPACT_KIND[item.kind].label}</span>
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>
                  )}
                </Show>
              </Show>
            </Show>
          </PanelDialog.Section>
        </Show>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span />
        <div class="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={closeIfClean}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="button"
            onClick={() => void save()}
            disabled={!dirty() || !impactReady()}
            loading={saveMutation.loading()}
            loadingLabel="Saving record change sources"
          >
            Save
          </Button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

import { CheckboxCard, dialogCore, PanelDialog, Placeholder, panelDialogOptions, prompts, Select, TextInput, Button } from "@k2b/ui";
import { mutation as mutations, timed } from "@k2b/stdlib/solid";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { FederatedDiagnostic, FederatedRevisionView, FederatedSourceCandidate, FederatedTableConfig, Field } from "../../../contracts";
import { errorMessage } from "../utils/api-helpers";

type MappingDraft = FederatedRevisionView["mappings"][number];
type SelectOption = { id: string; label: string };
const MAX_SOURCES = 50;

const selectOptions = (field: Field | undefined): SelectOption[] => {
  if (!field || field.type !== "select") return [];
  const options = (field.config as { options?: unknown }).options;
  if (!Array.isArray(options)) return [];
  return options.flatMap((option) => {
    if (!option || typeof option !== "object") return [];
    const { id, label } = option as { id?: unknown; label?: unknown };
    return typeof id === "string" && typeof label === "string" ? [{ id, label }] : [];
  });
};

export const openFederatedTableDialog = (args: { tableId: string; tableName: string; targetFields: Field[] }) =>
  dialogCore.open<void>((close) => <FederatedTableDialog {...args} close={close} />, panelDialogOptions);

function FederatedTableDialog(props: { tableId: string; tableName: string; targetFields: Field[]; close: () => void }) {
  const [config, setConfig] = createSignal<FederatedTableConfig | null>(null);
  const [candidates, setCandidates] = createSignal<FederatedSourceCandidate[]>([]);
  const [candidateCache, setCandidateCache] = createSignal<Record<string, FederatedSourceCandidate>>({});
  const [candidateQuery, setCandidateQuery] = createSignal("");
  const [candidateTotal, setCandidateTotal] = createSignal(0);
  const [candidateLoading, setCandidateLoading] = createSignal(false);
  const [sourceFields, setSourceFields] = createSignal<Record<string, Field[]>>({});
  const [selectedSources, setSelectedSources] = createSignal<string[]>([]);
  const [opaqueSourceIds, setOpaqueSourceIds] = createSignal<string[]>([]);
  const [retainedSourceIds, setRetainedSourceIds] = createSignal<string[]>([]);
  const [mappingSourceId, setMappingSourceId] = createSignal("");
  const [mappings, setMappings] = createSignal<MappingDraft[]>([]);
  const [validationDiagnostics, setValidationDiagnostics] = createSignal<FederatedDiagnostic[]>([]);
  const [loading, setLoading] = createSignal(true);

  let candidateRequest: AbortController | null = null;
  const sourceTables = createMemo(() => Object.values(candidateCache()).map((candidate) => ({ ...candidate.table, base: candidate.base })));
  const selectedTables = createMemo(() =>
    selectedSources().flatMap((sourceId) => {
      const table = sourceTables().find((candidate) => candidate.id === sourceId);
      return table ? [table] : [];
    }),
  );
  const mappingTable = createMemo(() => selectedTables().find((table) => table.id === mappingSourceId()) ?? selectedTables()[0]);
  const candidateGroups = createMemo(() => {
    const groups = new Map<string, { base: FederatedSourceCandidate["base"]; items: FederatedSourceCandidate[] }>();
    for (const candidate of candidates()) {
      const group = groups.get(candidate.base.id) ?? { base: candidate.base, items: [] };
      group.items.push(candidate);
      groups.set(candidate.base.id, group);
    }
    return [...groups.values()];
  });
  const canonicalFields = createMemo(() =>
    props.targetFields.filter((field) => !field.deletedAt && !["formula", "lookup", "rollup"].includes(field.type)),
  );

  const loadFields = async (tableId: string) => {
    if (sourceFields()[tableId]) return;
    const response = await apiClient.fields["by-table"][":tableId"].$get({ param: { tableId } });
    if (!response.ok) throw new Error(await errorMessage(response, "Could not load source fields"));
    const fields = await response.json();
    setSourceFields((current) => ({ ...current, [tableId]: fields }));
  };

  const loadCandidates = async (params: { reset: boolean; query?: string } = { reset: false }) => {
    candidateRequest?.abort();
    candidateRequest = new AbortController();
    const query = params.query ?? candidateQuery();
    const offset = params.reset ? 0 : candidates().length;
    setCandidateLoading(true);
    try {
      const response = await apiClient.tables[":tableId"].federation["source-candidates"].$get(
        {
          param: { tableId: props.tableId },
          query: { q: query.trim(), limit: "50", offset: String(offset) },
        },
        { init: { signal: candidateRequest.signal } },
      );
      if (!response.ok) throw new Error(await errorMessage(response, "Could not load source tables"));
      const page = await response.json();
      setCandidateTotal(page.total);
      setCandidates((current) => {
        const next = params.reset ? page.items : [...current, ...page.items];
        return [...new Map(next.map((candidate) => [candidate.table.id, candidate])).values()];
      });
      setCandidateCache((current) => ({
        ...current,
        ...Object.fromEntries(page.items.map((candidate) => [candidate.table.id, candidate])),
      }));
    } finally {
      setCandidateLoading(false);
    }
  };

  const searchCandidates = timed.debounce((value: string) => {
    void loadCandidates({ reset: true, query: value }).catch((error) => {
      if ((error as Error).name !== "AbortError") prompts.error((error as Error).message);
    });
  }, 250);
  onCleanup(() => {
    searchCandidates.cancel();
    candidateRequest?.abort();
  });

  const load = async () => {
    setLoading(true);
    try {
      searchCandidates.cancel();
      setCandidates([]);
      setCandidateCache({});
      const configResponse = await apiClient.tables[":tableId"].federation.$get({ param: { tableId: props.tableId } });
      if (!configResponse.ok) throw new Error(await errorMessage(configResponse, "Could not load combined table configuration"));
      const nextConfig = await configResponse.json();
      const sourceIds = nextConfig.draft.sources.flatMap((source) => (source.sourceTableId ? [source.sourceTableId] : []));
      const retainedIds = nextConfig.draft.sources.flatMap((source) => (source.sourceTableId ? [] : [source.id]));
      setConfig(nextConfig);
      setSelectedSources(sourceIds);
      setMappingSourceId(sourceIds[0] ?? "");
      setOpaqueSourceIds(retainedIds);
      setRetainedSourceIds(retainedIds);
      setMappings(nextConfig.draft.mappings);
      setValidationDiagnostics(nextConfig.draft.diagnostics);
      await loadCandidates({ reset: true, query: candidateQuery() });
      const accessibleSourceIds = sourceIds.filter((sourceId) => candidateCache()[sourceId] !== undefined);
      await Promise.all(accessibleSourceIds.map(loadFields));
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Could not load combined table configuration");
    } finally {
      setLoading(false);
    }
  };

  const toggleRetainedSources = (enabled: boolean) => {
    setRetainedSourceIds(enabled ? opaqueSourceIds() : []);
    setValidationDiagnostics([]);
  };
  onMount(() => void load());

  const toggleSource = async (tableId: string, enabled: boolean) => {
    if (enabled) {
      if (selectedSources().length + retainedSourceIds().length >= MAX_SOURCES) {
        prompts.error(`Combined tables support at most ${MAX_SOURCES} source tables.`);
        return;
      }
      setSelectedSources((current) => [...current, tableId]);
      setMappingSourceId(tableId);
      setValidationDiagnostics([]);
      try {
        await loadFields(tableId);
      } catch (error) {
        setSelectedSources((current) => current.filter((id) => id !== tableId));
        prompts.error(error instanceof Error ? error.message : "Could not load source fields");
      }
      return;
    }
    setSelectedSources((current) => current.filter((id) => id !== tableId));
    if (mappingSourceId() === tableId) {
      setMappingSourceId(selectedSources().find((id) => id !== tableId) ?? "");
    }
    setMappings((current) => current.filter((mapping) => mapping.sourceTableId !== tableId));
    setValidationDiagnostics([]);
  };

  const mappingFor = (sourceTableId: string, targetFieldId: string) =>
    mappings().find((mapping) => mapping.sourceTableId === sourceTableId && mapping.targetFieldId === targetFieldId);

  const setMapping = (sourceTableId: string, targetFieldId: string, sourceFieldId: string) => {
    setValidationDiagnostics([]);
    setMappings((current) => {
      const rest = current.filter((mapping) => !(mapping.sourceTableId === sourceTableId && mapping.targetFieldId === targetFieldId));
      return sourceFieldId ? [...rest, { sourceTableId, targetFieldId, sourceFieldId, config: {} }] : rest;
    });
  };

  const selectedSourceField = (sourceTableId: string, targetFieldId: string) => {
    const sourceFieldId = mappingFor(sourceTableId, targetFieldId)?.sourceFieldId;
    return sourceFields()[sourceTableId]?.find((field) => field.id === sourceFieldId);
  };

  const setOptionMapping = (sourceTableId: string, targetFieldId: string, sourceOptionId: string, targetOptionId: string) => {
    setValidationDiagnostics([]);
    setMappings((current) =>
      current.map((mapping) => {
        if (mapping.sourceTableId !== sourceTableId || mapping.targetFieldId !== targetFieldId) return mapping;
        const previous = (mapping.config?.optionMap ?? {}) as Record<string, string>;
        const optionMap = { ...previous };
        if (targetOptionId) optionMap[sourceOptionId] = targetOptionId;
        else delete optionMap[sourceOptionId];
        return { ...mapping, config: { ...mapping.config, optionMap } };
      }),
    );
  };

  const compatibleOptions = (sourceTableId: string, target: Field) =>
    (sourceFields()[sourceTableId] ?? [])
      .filter((field) => !field.deletedAt && (field.type === target.type || ["formula", "lookup", "rollup"].includes(field.type)))
      .map((field) => ({ id: field.id, label: `${field.name} · ${field.type}`, icon: "ti ti-columns" }));

  const draftInput = () => ({
    sourceTableIds: selectedSources(),
    retainedSourceIds: retainedSourceIds(),
    mappings: mappings(),
  });

  const saveDraft = async (): Promise<FederatedRevisionView> => {
    const draftToken = config()?.draft.revisionToken;
    if (!draftToken) throw new Error("Combined table configuration is not loaded.");
    const response = await apiClient.tables[":tableId"].federation.draft.$put({
      param: { tableId: props.tableId },
      json: { ...draftInput(), draftToken },
    });
    if (!response.ok) throw new Error(await errorMessage(response, "Could not save combined table draft"));
    const draft = await response.json();
    setConfig((current) => (current ? { ...current, draft } : current));
    setValidationDiagnostics(draft.diagnostics);
    return draft;
  };

  const validateMutation = mutations.create<{ valid: boolean; diagnostics: FederatedDiagnostic[] }, void>({
    mutation: async () => {
      const response = await apiClient.tables[":tableId"].federation.validate.$post({
        param: { tableId: props.tableId },
        json: draftInput(),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not validate combined table"));
      return response.json();
    },
    onSuccess: (result) => {
      setValidationDiagnostics(result.diagnostics);
      if (result.valid) prompts.success("Combined table configuration is valid.");
    },
    onError: (error) => prompts.error(error.message),
  });

  const saveMutation = mutations.create<FederatedRevisionView, void>({
    mutation: saveDraft,
    onSuccess: () => prompts.success("Combined table draft saved."),
    onError: (error) => prompts.error(error.message),
  });
  const publishMutation = mutations.create<FederatedRevisionView, void>({
    mutation: async () => {
      await saveDraft();
      const response = await apiClient.tables[":tableId"].federation.publish.$post({ param: { tableId: props.tableId } });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not publish combined table"));
      return response.json();
    },
    onSuccess: () => {
      prompts.success("Combined table published.");
      void load();
    },
    onError: (error) => prompts.error(error.message),
  });

  const revoke = async (sourceTableId: string) => {
    const confirmed = await prompts.confirm(
      "Revoke this source? The combined table will fail closed until a new configuration is published.",
      {
        title: "Revoke source access?",
        variant: "danger",
        confirmText: "Revoke",
      },
    );
    if (!confirmed) return;
    const response = await apiClient.tables[":tableId"].federation.sources[":sourceTableId"].revoke.$post({
      param: { tableId: props.tableId, sourceTableId },
    });
    if (!response.ok) return prompts.error(await errorMessage(response, "Could not revoke source"));
    await load();
  };

  return (
    <PanelDialog>
      <PanelDialog.Header title={`Combined data — ${props.tableName}`} icon="ti ti-table-share" close={props.close} />
      <PanelDialog.Body>
        <Show
          when={!loading()}
          fallback={
            <Placeholder icon="ti ti-loader-2 animate-spin" title="Loading combined table" description="Reading sources and mappings." />
          }
        >
          <PanelDialog.Section title="Sources" subtitle="Only tables where you are an admin can be published." icon="ti ti-database-share">
            <TextInput
              value={candidateQuery}
              onValueChange={(value) => {
                setCandidateQuery(value);
                searchCandidates.debouncedFn(value);
              }}
              icon="ti ti-search"
              placeholder="Search source bases and tables..."
            />
            <Show
              when={candidates().length > 0}
              fallback={
                <Placeholder
                  icon={candidateLoading() ? "ti ti-loader-2 animate-spin" : "ti ti-database-off"}
                  title={candidateLoading() ? "Loading source tables" : "No source tables available"}
                  description={
                    candidateQuery().trim()
                      ? "No administered source matches this search."
                      : "You need admin access to a stored table before you can add it."
                  }
                />
              }
            >
              <For each={candidateGroups()}>
                {(group) => (
                  <div class="space-y-2">
                    <div class="text-xs font-semibold text-dimmed">{group.base.name}</div>
                    <For each={group.items}>
                      {(candidate) => (
                        <CheckboxCard
                          label={candidate.table.name}
                          description={`${candidate.fieldCount} fields`}
                          icon={candidate.table.icon ?? "ti ti-table"}
                          variant="input"
                          value={() => selectedSources().includes(candidate.table.id)}
                          onValueChange={(enabled) => void toggleSource(candidate.table.id, enabled)}
                        />
                      )}
                    </For>
                  </div>
                )}
              </For>
              <Show when={candidates().length < candidateTotal()}>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  class="self-center"
                  disabled={candidateLoading()}
                  onClick={() => void loadCandidates().catch((error) => prompts.error((error as Error).message))}
                >
                  {candidateLoading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-dots" />} Load more sources
                </Button>
              </Show>
            </Show>
            <Show when={opaqueSourceIds().length > 0}>
              <CheckboxCard
                label={`Retain ${opaqueSourceIds().length} inaccessible published source${opaqueSourceIds().length === 1 ? "" : "s"}`}
                description="Their physical schema stays private. Clear this option to remove all of them from the next publication."
                icon="ti ti-lock"
                variant="input"
                value={() => retainedSourceIds().length > 0}
                onValueChange={toggleRetainedSources}
              />
            </Show>
          </PanelDialog.Section>

          <PanelDialog.Section
            title="Field mappings"
            subtitle="Choose the physical field used for each canonical field."
            icon="ti ti-arrows-join-2"
          >
            <Show
              when={selectedTables().length > 0 && canonicalFields().length > 0}
              fallback={
                <Placeholder
                  icon="ti ti-columns"
                  title="No editable mappings"
                  description={
                    retainedSourceIds().length > 0
                      ? "Existing inaccessible publications can be retained or removed, but their physical schema stays private."
                      : "Add a source and canonical fields first."
                  }
                />
              }
            >
              <Select
                label="Source to map"
                description={`${selectedTables().length} selected source${selectedTables().length === 1 ? "" : "s"}`}
                value={() => mappingTable()?.id ?? ""}
                onValueChange={setMappingSourceId}
                options={selectedTables().map((table) => ({
                  id: table.id,
                  label: `${table.name} · ${table.base.name}`,
                  icon: table.icon ?? "ti ti-table",
                }))}
              />
              <Show when={mappingTable()} keyed>
                {(table) => (
                  <div class="paper space-y-2 p-3">
                    <div>
                      <div class="text-sm font-semibold text-primary">{table.name}</div>
                      <div class="text-xs text-dimmed">{table.base.name}</div>
                    </div>
                    <For each={canonicalFields()}>
                      {(target) => {
                        const sourceSelectOptions = () => selectOptions(selectedSourceField(table.id, target.id));
                        const targetSelectOptions = () =>
                          selectOptions(target).map((option) => ({ id: option.id, label: option.label, icon: "ti ti-tag" }));
                        return (
                          <div class="space-y-2">
                            <Select
                              label={target.name}
                              description={`${target.type} · leave empty when this source has no value`}
                              value={() => mappingFor(table.id, target.id)?.sourceFieldId ?? ""}
                              onValueChange={(sourceFieldId) => setMapping(table.id, target.id, sourceFieldId ?? "")}
                              options={compatibleOptions(table.id, target)}
                              placeholder="Not mapped"
                              clearable
                            />
                            <Show when={target.type === "select" && sourceSelectOptions().length > 0}>
                              <div class="space-y-2 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] p-2">
                                <div class="text-xs font-medium text-secondary">Option mapping</div>
                                <For each={sourceSelectOptions()}>
                                  {(sourceOption) => (
                                    <Select
                                      label={sourceOption.label}
                                      value={() => {
                                        const optionMap = (mappingFor(table.id, target.id)?.config?.optionMap ?? {}) as Record<
                                          string,
                                          string
                                        >;
                                        return optionMap[sourceOption.id] ?? "";
                                      }}
                                      onValueChange={(targetOptionId) =>
                                        setOptionMapping(table.id, target.id, sourceOption.id, targetOptionId ?? "")
                                      }
                                      options={targetSelectOptions()}
                                      placeholder="Choose canonical option"
                                      clearable
                                    />
                                  )}
                                </For>
                              </div>
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                )}
              </Show>
            </Show>
          </PanelDialog.Section>

          <Show when={validationDiagnostics().length > 0}>
            <PanelDialog.Section title="Validation" subtitle="Resolve every issue before publishing." icon="ti ti-alert-triangle">
              <div class="paper p-3">
                <ul class="space-y-1 text-sm text-danger">
                  <For each={validationDiagnostics()}>{(diagnostic) => <li>{diagnostic.message}</li>}</For>
                </ul>
              </div>
            </PanelDialog.Section>
          </Show>

          <Show when={config()?.current} keyed>
            {(current) => (
              <PanelDialog.Section
                title="Published revision"
                subtitle={`Revision ${current.revision} · ${current.status === "active" ? "Active" : "Action required"}`}
                icon="ti ti-cloud-check"
              >
                <For each={current.sources}>
                  {(source) => {
                    const table = () => sourceTables().find((candidate) => candidate.id === source.sourceTableId);
                    return (
                      <div class="flex items-center gap-2 py-1">
                        <span class="min-w-0 flex-1 truncate text-sm text-primary">{table()?.name ?? "Unavailable source"}</span>
                        <Show when={table() && source.sourceTableId} keyed>
                          {(sourceTableId) => (
                            <Button variant="ghost" size="sm" type="button" class="text-danger" onClick={() => void revoke(sourceTableId)}>
                              <i class="ti ti-unlink" /> Revoke
                            </Button>
                          )}
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </PanelDialog.Section>
            )}
          </Show>
        </Show>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <Button variant="secondary" size="sm" type="button" onClick={props.close}>
          Close
        </Button>
        <div class="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={validateMutation.loading() || selectedSources().length + retainedSourceIds().length === 0}
            onClick={() => validateMutation.mutate(undefined)}
          >
            {validateMutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-checkup-list" />} Validate
          </Button>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={saveMutation.loading()}
            onClick={() => saveMutation.mutate(undefined)}
          >
            Save draft
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="button"
            disabled={publishMutation.loading() || selectedSources().length + retainedSourceIds().length === 0}
            onClick={() => publishMutation.mutate(undefined)}
          >
            {publishMutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-cloud-upload" />} Publish
          </Button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

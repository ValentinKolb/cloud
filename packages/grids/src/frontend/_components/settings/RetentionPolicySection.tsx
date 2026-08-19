import { mutation as mutations, query } from "@k2b/stdlib/solid";
import { Button, NoticeCard, NumberInput, Placeholder, prompts, SettingsGroup, SettingsModal, SettingsPanelFooter, toast } from "@k2b/ui";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "@/api/client";
import { RETENTION_MAX_DAYS, RETENTION_MIN_DAYS, type RetentionPolicy, type RetentionPreview } from "../../../retention-policy-contracts";
import { errorMessage } from "../utils/api-helpers";

export function RetentionPolicySection(props: {
  baseId: string;
  onDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const policy = query.create({
    source: () => props.baseId,
    load: async (baseId, { abortSignal }) => {
      const response = await apiClient.bases[":baseId"]["retention-policy"].$get({ param: { baseId } }, { init: { signal: abortSignal } });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not load retention policy"));
      return (await response.json()).policy as RetentionPolicy | null;
    },
  });
  const [days, setDays] = createSignal<number | null>(null);
  const [savedDays, setSavedDays] = createSignal<number | null>(null);
  const [initialized, setInitialized] = createSignal(false);
  createEffect(() => {
    if (!policy.loading() && !policy.error() && !initialized()) {
      setDays(policy.data()?.minimumDays ?? null);
      setSavedDays(policy.data()?.minimumDays ?? null);
      setInitialized(true);
    }
  });
  const validDays = () => days() !== null && days()! >= RETENTION_MIN_DAYS && days()! <= RETENTION_MAX_DAYS;
  const changed = createMemo(() => initialized() && days() !== savedDays());
  createEffect(() => props.onDirtyChange(changed()));
  onCleanup(() => props.onDirtyChange(false));

  const preview = query.create({
    source: () => (validDays() ? days() : null),
    load: async (minimumDays, { abortSignal }) => {
      if (minimumDays === null) return null;
      const response = await apiClient.bases[":baseId"]["retention-policy"].preview.$post(
        { param: { baseId: props.baseId }, json: { minimumDays } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await errorMessage(response, "Could not preview retention floor"));
      return { minimumDays, value: (await response.json()) as RetentionPreview };
    },
  });
  const currentPreview = () => {
    const loaded = preview.data();
    return loaded?.minimumDays === days() ? loaded.value : null;
  };

  const save = mutations.create<RetentionPolicy, void>({
    mutation: async (_, { abortSignal }) => {
      const minimumDays = days();
      if (minimumDays === null) throw new Error("Enter a minimum number of days");
      if (savedDays() !== null && minimumDays < savedDays()!) {
        const confirmed = await prompts.confirm(
          "This shorter floor may let future controlled destruction become eligible earlier. Nothing is deleted now.",
          { title: "Shorten minimum retention?", confirmText: "Shorten floor" },
        );
        if (!confirmed) throw new DOMException("Canceled", "AbortError");
      }
      const response = await apiClient.bases[":baseId"]["retention-policy"].$put(
        { param: { baseId: props.baseId }, json: { minimumDays } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await errorMessage(response, "Could not save retention policy"));
      return (await response.json()).policy as RetentionPolicy;
    },
    onSuccess: (next) => {
      setSavedDays(next.minimumDays);
      setDays(next.minimumDays);
      void policy.invalidate();
      toast.success("Minimum retention saved");
    },
    onError: (error) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) prompts.error(error.message);
    },
  });

  const remove = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const confirmed = await prompts.confirm(
        "Removing the floor does not delete anything, but future controlled destruction may become eligible earlier.",
        { title: "Remove minimum retention?", confirmText: "Remove floor" },
      );
      if (!confirmed) throw new DOMException("Canceled", "AbortError");
      const response = await apiClient.bases[":baseId"]["retention-policy"].$delete(
        { param: { baseId: props.baseId } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await errorMessage(response, "Could not remove retention policy"));
    },
    onSuccess: () => {
      setSavedDays(null);
      setDays(null);
      void policy.invalidate();
      toast.success("Minimum retention removed");
    },
    onError: (error) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) prompts.error(error.message);
    },
  });
  const saving = () => save.loading() || remove.loading();
  createEffect(() => props.onSavingChange(saving()));
  onCleanup(() => props.onSavingChange(false));

  return (
    <>
      <SettingsGroup
        title="Record retention floor"
        description="Prevent future controlled destruction until a trashed Record has remained in trash for the configured minimum time."
      >
        <SettingsGroup.Action>
          <Show when={savedDays() !== null}>
            <Button variant="danger" size="sm" disabled={saving()} onClick={() => remove.mutate(undefined)}>
              Remove floor
            </Button>
          </Show>
        </SettingsGroup.Action>
        <NoticeCard
          tone="info"
          title="Preservation only"
          detail="This setting never deletes Records, starts no cleanup job, and is not a legal or compliance assessment."
        />
        <Show when={!policy.loading()} fallback={<Placeholder state="loading" variant="compact" title="Loading retention policy" />}>
          <Show
            when={!policy.error()}
            fallback={
              <Placeholder
                state="error"
                variant="compact"
                title="Retention policy is unavailable"
                description={policy.error() instanceof Error ? policy.error()!.message : "Could not load retention policy"}
                action={
                  <Button size="sm" variant="secondary" onClick={() => void policy.invalidate()}>
                    Retry
                  </Button>
                }
              />
            }
          >
            <NumberInput
              label="Minimum days in trash"
              description="Applies to trashed Records in this Base. Finalized Records remain protected independently."
              min={RETENTION_MIN_DAYS}
              max={RETENTION_MAX_DAYS}
              step={1}
              clearable
              value={days}
              onValueChange={setDays}
              disabled={saving()}
            />
            <Show when={days() === null}>
              <p class="text-sm text-muted">
                {savedDays() === null
                  ? "No minimum retention configured. Existing behavior is unchanged."
                  : "An empty value cannot replace the saved floor. Discard the draft or use Remove floor."}
              </p>
            </Show>
            <Show when={validDays() && preview.loading()}>
              <Placeholder state="loading" variant="compact" title="Calculating impact" />
            </Show>
            <Show when={preview.error()}>
              <Placeholder
                state="error"
                variant="compact"
                title="Impact could not be calculated"
                description={preview.error() instanceof Error ? preview.error()!.message : "Preview failed"}
                action={
                  <Button size="sm" variant="secondary" onClick={() => void preview.invalidate()}>
                    Retry
                  </Button>
                }
              />
            </Show>
            <Show when={currentPreview()} keyed>
              {(impact) => (
                <>
                  <NoticeCard
                    tone="neutral"
                    title={`${impact.counts.retainedUntilLater} retained until later · ${impact.counts.floorReached} reached the floor`}
                    detail={`${impact.counts.protectedFinalized} finalized Records stay protected · ${impact.counts.trashedRecords} total in trash${impact.truncated ? " · example list is bounded" : ""}. Calculated ${new Date(impact.observedAt).toLocaleString()}. Reaching the floor does not itself permit or perform destruction.`}
                  />
                  <Show when={impact.examples.length > 0}>
                    <details class="text-sm">
                      <summary class="cursor-pointer font-medium">Example Record dates ({impact.examples.length})</summary>
                      <ul class="mt-2 space-y-1 text-xs text-muted">
                        <For each={impact.examples}>
                          {(item) => (
                            <li>
                              Record {item.recordId} · table {item.tableId} · not before {new Date(item.notBefore).toLocaleString()}
                            </li>
                          )}
                        </For>
                      </ul>
                    </details>
                  </Show>
                </>
              )}
            </Show>
          </Show>
        </Show>
      </SettingsGroup>
      <SettingsModal.Footer>
        <SettingsPanelFooter
          changeCount={() => (changed() ? 1 : 0)}
          loading={saving}
          saveDisabled={() => !validDays()}
          onDiscard={() => setDays(savedDays())}
          onSave={() => save.mutate(undefined)}
        />
      </SettingsModal.Footer>
    </>
  );
}

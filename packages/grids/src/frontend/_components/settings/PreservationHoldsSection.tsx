import { mutation as mutations, query } from "@k2b/stdlib/solid";
import { Button, Placeholder, prompts, SettingsCollection, SettingsGroup, StatusBadge, toast } from "@k2b/ui";
import { createEffect, For, onCleanup, Show } from "solid-js";
import { apiClient } from "@/api/client";
import {
  PRESERVATION_HOLD_REASON_MAX_LENGTH,
  type PreservationHold,
  type PreservationHoldsResponse,
} from "../../../preservation-hold-contracts";
import { errorMessage } from "../utils/api-helpers";

const askReason = (mode: "create" | "release") =>
  prompts.form({
    title: mode === "create" ? "Create preservation hold" : "Release preservation hold",
    icon: mode === "create" ? "ti ti-lock" : "ti ti-lock-open",
    fields: {
      explanation: {
        type: "info" as const,
        content:
          mode === "create"
            ? "This blocks future controlled destruction across the Base. Records remain editable and access does not change."
            : "This releases only the selected hold. Other active holds continue to block controlled destruction.",
      },
      reason: {
        type: "text" as const,
        label: "Reason",
        description: mode === "create" ? "Why must this Base be preserved?" : "Why can this hold be released?",
        required: true,
        multiline: true,
        lines: 3,
        maxLength: PRESERVATION_HOLD_REASON_MAX_LENGTH,
      },
    },
    confirmText: mode === "create" ? "Create hold" : "Release hold",
    variant: mode === "release" ? "danger" : "primary",
  });

export function PreservationHoldsSection(props: { baseId: string; onSavingChange: (saving: boolean) => void }) {
  const holds = query.create({
    source: () => props.baseId,
    load: async (baseId, { abortSignal }) => {
      const response = await apiClient.bases[":baseId"]["preservation-holds"].$get(
        { param: { baseId }, query: { status: "active", page: "1", per_page: "100" } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await errorMessage(response, "Could not load preservation holds"));
      return (await response.json()) as PreservationHoldsResponse;
    },
  });

  const createHold = mutations.create<PreservationHold, string>({
    mutation: async (reason, { abortSignal }) => {
      const response = await apiClient.bases[":baseId"]["preservation-holds"].$post(
        { param: { baseId: props.baseId }, json: { reason } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await errorMessage(response, "Could not create preservation hold"));
      return response.json();
    },
    onSuccess: () => {
      toast.success("Preservation hold created");
      void holds.invalidate();
    },
    onError: (error) => prompts.error(error.message),
  });

  const releaseHold = mutations.create<PreservationHold, { holdId: string; reason: string }>({
    mutation: async ({ holdId, reason }, { abortSignal }) => {
      const response = await apiClient.bases[":baseId"]["preservation-holds"][":holdId"].release.$post(
        { param: { baseId: props.baseId, holdId }, json: { reason } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await errorMessage(response, "Could not release preservation hold"));
      return response.json();
    },
    onSuccess: () => {
      toast.success("Preservation hold released");
      void holds.invalidate();
    },
    onError: (error) => prompts.error(error.message),
  });

  const busy = () => createHold.loading() || releaseHold.loading();
  createEffect(() => props.onSavingChange(busy()));
  const create = async () => {
    const result = await askReason("create");
    const reason = result?.reason.trim();
    if (reason) createHold.mutate(reason);
  };
  const release = async (holdId: string) => {
    const result = await askReason("release");
    const reason = result?.reason.trim();
    if (reason) releaseHold.mutate({ holdId, reason });
  };
  onCleanup(() => {
    createHold.abort();
    releaseHold.abort();
    props.onSavingChange(false);
  });

  return (
    <SettingsGroup
      title="Base-wide preservation holds"
      description="Active holds block future controlled destruction across this Base. They do not lock Records or change access."
    >
      <Show when={!holds.loading()} fallback={<Placeholder state="loading" variant="compact" title="Loading preservation holds" />}>
        <Show
          when={!holds.error()}
          fallback={
            <Placeholder
              state="error"
              variant="compact"
              title="Preservation holds are unavailable"
              description={holds.error() instanceof Error ? holds.error()!.message : "Could not load preservation holds"}
              action={
                <Button size="sm" variant="secondary" onClick={() => void holds.invalidate()}>
                  Retry
                </Button>
              }
            />
          }
        >
          <SettingsCollection
            title="Active holds"
            description="Every active hold must be released separately."
            empty="No active preservation holds."
          >
            <SettingsCollection.Action>
              <Button size="sm" variant="secondary" disabled={busy()} onClick={() => void create()}>
                <i class="ti ti-lock-plus" aria-hidden="true" /> Create hold
              </Button>
            </SettingsCollection.Action>
            <For each={holds.data()?.items ?? []}>
              {(hold) => (
                <SettingsCollection.Item
                  title={hold.reason}
                  description={`Created ${new Date(hold.createdAt).toLocaleString()}${hold.createdByDisplayName ? ` by ${hold.createdByDisplayName}` : ""} · ${hold.id}`}
                  icon={<i class="ti ti-lock" aria-hidden="true" />}
                >
                  <SettingsCollection.Item.Status>
                    <StatusBadge tone="warning" label="Active" icon={null} />
                  </SettingsCollection.Item.Status>
                  <SettingsCollection.Item.Actions>
                    <Button size="sm" variant="secondary" disabled={busy()} onClick={() => void release(hold.id)}>
                      Release
                    </Button>
                  </SettingsCollection.Item.Actions>
                </SettingsCollection.Item>
              )}
            </For>
          </SettingsCollection>
          <Show when={(holds.data()?.pagination.total ?? 0) > 100}>
            <p class="text-xs text-dimmed">Showing the newest 100 active holds. Use the CLI to page through the complete list.</p>
          </Show>
        </Show>
      </Show>
    </SettingsGroup>
  );
}

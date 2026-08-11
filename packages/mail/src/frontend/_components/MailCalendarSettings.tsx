import { mutation, query } from "@k2b/stdlib/solid";
import { Button, Placeholder, prompts, Select, SettingsField, SettingsGroup, SettingsSaveBar, toast } from "@k2b/ui";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import { readApiError } from "./api-response";

export default function MailCalendarSettings(props: { mailboxId: string; onDirtyChange?: (dirty: boolean) => void }) {
  const [savedSpaceId, setSavedSpaceId] = createSignal<string | null>(null);
  const [spaceId, setSpaceId] = createSignal<string | null>(null);
  const [items, setItems] = createSignal<Array<{ id: string; name: string; color: string }>>([]);

  const destinations = query.create({
    source: () => props.mailboxId,
    load: async (mailboxId: string, { abortSignal }: { abortSignal: AbortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["calendar-destinations"].$get(
        { param: { mailboxId } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to load calendar destinations"));
      return response.json();
    },
  });

  const save = mutation.create<void, void>({
    mutation: async (_input, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["calendar-destination"].$put(
        { param: { mailboxId: props.mailboxId }, json: { spaceId: spaceId() } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to save the calendar destination"));
      const data = await response.json();
      setSavedSpaceId(data.selectedSpaceId);
      setSpaceId(data.selectedSpaceId);
      setItems(data.items);
      toast.success(data.selectedSpaceId ? "Default calendar saved" : "Default calendar cleared");
    },
    onError: (error) => prompts.error(error.message),
  });

  createEffect(() => {
    const data = destinations.data();
    if (!data) return;
    setItems(data.items);
    const selected = data.items.some((item) => item.id === data.selectedSpaceId) ? data.selectedSpaceId : null;
    setSavedSpaceId(selected);
    setSpaceId(selected);
  });
  createEffect(() => props.onDirtyChange?.(spaceId() !== savedSpaceId()));
  onCleanup(() => {
    save.abort();
    props.onDirtyChange?.(false);
  });

  return (
    <SettingsGroup
      title="Default destination"
      description="Choose the Space suggested when you add an invitation. Mail never imports events automatically."
    >
      <Show when={!destinations.loading()} fallback={<Placeholder state="loading" variant="compact" title="Loading Spaces" />}>
        <Show
          when={!destinations.error()}
          fallback={
            <Placeholder
              state="error"
              variant="compact"
              title="Spaces is unavailable"
              description={destinations.error()?.message}
              action={
                <Button variant="secondary" size="sm" type="button" onClick={() => void destinations.refresh()}>
                  Retry
                </Button>
              }
            />
          }
        >
          <Show
            when={items().length > 0}
            fallback={
              <Placeholder
                state="empty"
                variant="compact"
                icon="ti ti-calendar-off"
                title="No writable Spaces"
                description="Ask a Space owner for write access before choosing a default calendar."
              />
            }
          >
            <SettingsField
              label="Default Space"
              description="Writers can choose another writable Space for each invitation."
              error={() => undefined}
              changed={() => spaceId() !== savedSpaceId()}
            >
              {(control) => (
                <Select
                  aria-label="Default Space"
                  aria-describedby={control.describedBy()}
                  icon="ti ti-calendar-event"
                  value={() => spaceId() ?? null}
                  onValueChange={setSpaceId}
                  clearable
                  placeholder="No default Space"
                  disabled={save.loading()}
                  options={items().map((item) => ({ id: item.id, label: item.name, color: item.color, icon: "ti ti-calendar-event" }))}
                />
              )}
            </SettingsField>
            <SettingsSaveBar
              changeCount={() => (spaceId() === savedSpaceId() ? 0 : 1)}
              loading={save.loading}
              onDiscard={() => setSpaceId(savedSpaceId())}
              onSave={() => save.mutate()}
              saveLabel="Save calendar"
            />
          </Show>
        </Show>
      </Show>
    </SettingsGroup>
  );
}

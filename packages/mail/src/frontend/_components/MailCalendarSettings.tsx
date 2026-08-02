import { mutation } from "@k2b/stdlib/solid";
import { Button, Placeholder, Select, toast } from "@k2b/ui";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../../api/client";
import { readApiError } from "./api-response";

export default function MailCalendarSettings(props: { mailboxId: string }) {
  const [savedSpaceId, setSavedSpaceId] = createSignal<string | null>(null);
  const [spaceId, setSpaceId] = createSignal<string | null>(null);
  const [items, setItems] = createSignal<Array<{ id: string; name: string; color: string }>>([]);

  const load = mutation.create<void, void>({
    mutation: async (_input, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["calendar-destinations"].$get(
        { param: { mailboxId: props.mailboxId } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to load calendar destinations"));
      const data = await response.json();
      setItems(data.items);
      const selected = data.items.some((item) => item.id === data.selectedSpaceId) ? data.selectedSpaceId : null;
      setSavedSpaceId(selected);
      setSpaceId(selected);
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
  });

  onMount(() => load.mutate());
  onCleanup(() => {
    load.abort();
    save.abort();
  });

  return (
    <section class="flex flex-col gap-2 border-t border-subtle pt-4">
      <div>
        <h3 class="text-sm font-semibold text-primary">Calendar invitations</h3>
        <p class="text-xs text-dimmed">Choose the Space suggested when you add an invitation. Mail never imports events automatically.</p>
      </div>
      <Show when={!load.loading()} fallback={<Placeholder state="loading" variant="compact" title="Loading Spaces" />}>
        <Show
          when={!load.error()}
          fallback={
            <Placeholder
              state="error"
              variant="compact"
              title="Spaces is unavailable"
              description={load.error()?.message}
              action={
                <Button variant="secondary" size="sm" type="button" onClick={() => load.mutate()}>
                  Retry
                </Button>
              }
            />
          }
        >
          <Show when={items().length === 0}>
            <Placeholder
              state="empty"
              variant="compact"
              icon="ti ti-calendar-off"
              title="No writable Spaces"
              description="Ask a Space owner for write access before choosing a default calendar."
            />
          </Show>
          <Select
            label="Default Space"
            description="Writers can choose another writable Space for each invitation. Removing access hides an unavailable default safely."
            icon="ti ti-calendar-event"
            value={() => spaceId() ?? undefined}
            onValueChange={setSpaceId}
            clearable
            placeholder={items().length > 0 ? "No default Space" : "No writable Spaces"}
            disabled={items().length === 0}
            options={items().map((item) => ({ id: item.id, label: item.name, color: item.color, icon: "ti ti-calendar-event" }))}
          />
          <Show when={items().length > 0}>
            <div class="flex justify-end pt-1">
              <Button
                variant="secondary"
                size="sm"
                type="button"
                disabled={save.loading() || spaceId() === savedSpaceId()}
                onClick={() => save.mutate()}
              >
                <i class={save.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-device-floppy"} aria-hidden="true" />
                Save calendar
              </Button>
            </div>
          </Show>
        </Show>
      </Show>
    </section>
  );
}

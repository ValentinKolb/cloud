import { Dropdown, type DropdownItem } from "@valentinkolb/cloud/ui";
import { createSignal, For, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { ContactTag } from "../../service";
import { safeTagColor } from "../../shared";
import ContactTagChip from "./ContactTagChip";

type Props = {
  bookId: string;
  /** Tag ids currently assigned. Picker keeps selection in sync. */
  selectedIds: string[];
  /** Called when the user changes the selection. The picker batches edits and
   *  fires this on dropdown close. */
  onChange: (ids: string[]) => void;
  loading?: boolean;
  /** Compact trigger when used inside a contact editor row — hides the
   *  outer label, just renders the trigger pill. */
  compact?: boolean;
  /** URL of the tag-management settings page, shown as a link when there are
   *  no tags yet so users can create their first one. */
  manageUrl?: string;
};

/**
 * Multi-select tag picker. Tags themselves are managed in the book settings
 * page — here we only assign / unassign existing ones to the current contact.
 */
export default function ContactTagsPicker(props: Props) {
  const [available, setAvailable] = createSignal<ContactTag[]>([]);
  const [local, setLocal] = createSignal<string[]>([...props.selectedIds]);
  // `loaded` guards against the close-handler running before the initial GET
  // resolves: with `available()` still empty, filtering selected ids by it
  // would clear the contact's tags on save.
  const [loaded, setLoaded] = createSignal(false);

  const refresh = async () => {
    const res = await apiClient.books[":bookId"].tags.$get({ param: { bookId: props.bookId } });
    if (res.ok) {
      const data = await res.json();
      setAvailable(data);
      setLoaded(true);
    }
  };

  onMount(() => {
    void refresh();
  });

  const selected = () => available().filter((t) => local().includes(t.id));

  const toggle = (id: string) => {
    setLocal((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleClose = () => {
    // If the tags request hasn't resolved yet, don't drop selections we can't
    // verify. Once loaded, ids that don't match a known tag are stale (deleted
    // by another user) and may be filtered out.
    const desired = loaded() ? local().filter((id) => available().some((t) => t.id === id)) : local();
    const original = props.selectedIds;
    const changed = desired.length !== original.length || desired.some((v) => !original.includes(v));
    if (changed) props.onChange(desired);
  };

  const dropdownItems = (): DropdownItem[] => {
    if (available().length === 0) {
      return [
        {
          element: (
            <div class="flex flex-col gap-2 px-3 py-3 text-xs text-dimmed">
              <span>No tags in this book yet.</span>
              <Show when={props.manageUrl}>
                <a
                  href={props.manageUrl!}
                  class="inline-flex items-center gap-1 text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  <i class="ti ti-settings" /> Manage tags in book settings
                </a>
              </Show>
            </div>
          ),
        },
      ];
    }

    return available().map((tag) => ({
      element: (
        <button
          type="button"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggle(tag.id);
          }}
        >
          <div
            class={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors ${
              local().includes(tag.id) ? "border-blue-500 bg-blue-500 text-white" : "border-zinc-300 dark:border-zinc-600"
            }`}
          >
            <Show when={local().includes(tag.id)}>
              <i class="ti ti-check text-[10px]" />
            </Show>
          </div>
          <span class="h-3 w-3 shrink-0 rounded-full" style={`background-color: ${safeTagColor(tag.color)}`} />
          <span class="truncate text-primary">{tag.name}</span>
        </button>
      ),
    }));
  };

  const triggerClass =
    "inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2 py-1 text-xs transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50";

  const trigger = (
    <div class={triggerClass}>
      <Show when={props.loading}>
        <i class="ti ti-loader-2 animate-spin text-zinc-400" />
      </Show>
      <Show when={!props.loading}>
        <i class="ti ti-tags text-zinc-400" />
      </Show>
      <span class={selected().length > 0 ? "text-primary" : "text-dimmed"}>
        {selected().length > 0 ? `${selected().length} ${selected().length === 1 ? "tag" : "tags"}` : "No tags"}
      </span>
      <i class="ti ti-chevron-down text-[10px] text-zinc-400" />
    </div>
  );

  return (
    <div>
      <Show when={!props.compact}>
        <h3 class="section-label mb-1">Tags</h3>
      </Show>
      <div class="flex flex-wrap items-center gap-1.5">
        <Dropdown trigger={trigger} elements={dropdownItems()} position="bottom-right" width="w-64" onClose={handleClose} />
        <For each={selected()}>
          {(tag) => (
            <ContactTagChip name={tag.name} color={tag.color} size="sm" />
          )}
        </For>
      </div>
    </div>
  );
}

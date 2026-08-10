import { mutation as mutations } from "@k2b/stdlib/solid";
import { Button, MultiSelectInput } from "@k2b/ui";
import { createSignal, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { ContactTag } from "../../service";
import { safeTagColor } from "../../shared";

type Props = {
  bookId: string;
  /** Tag ids currently assigned. */
  selectedIds: string[];
  /** Called with the complete selected id list after each change. */
  onChange: (ids: string[]) => void;
  loading?: boolean;
  /** Compact trigger when used inside a contact editor row — hides the
   *  outer label, just renders the trigger pill. */
  compact?: boolean;
  /** Opens tag management when the book has no tags. Return true to reload. */
  onManage?: () => boolean | void | Promise<boolean | void>;
};

/**
 * Multi-select tag picker. Tags themselves are managed in the book settings
 * dialog — here we only assign / unassign existing ones to the current contact.
 */
export default function ContactTagsPicker(props: Props) {
  const [available, setAvailable] = createSignal<ContactTag[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [managing, setManaging] = createSignal(false);

  const loadMutation = mutations.create<ContactTag[], void>({
    mutation: async (_input, ctx) => {
      const res = await apiClient.books[":bookId"].tags.$get({ param: { bookId: props.bookId } }, { init: { signal: ctx.abortSignal } });
      if (!res.ok) throw new Error("Could not load contact tags");
      return await res.json();
    },
    onSuccess: (tags) => {
      setAvailable(tags);
      setLoaded(true);
    },
  });

  onMount(() => {
    loadMutation.mutate(undefined);
  });

  const manageTags = async () => {
    if (!props.onManage || managing()) return;
    setManaging(true);
    try {
      if (await props.onManage()) {
        loadMutation.abort();
        await loadMutation.mutate(undefined);
      }
    } finally {
      setManaging(false);
    }
  };

  const selectedIds = () => (loaded() ? props.selectedIds.filter((id) => available().some((tag) => tag.id === id)) : []);
  const options = () =>
    available().map((tag) => ({
      id: tag.id,
      label: tag.name,
      icon: "ti ti-tag",
      color: safeTagColor(tag.color),
    }));

  return (
    <div class="flex flex-col gap-1.5">
      <MultiSelectInput
        label={props.compact ? undefined : "Tags"}
        aria-label={props.compact ? "Tags" : undefined}
        value={selectedIds}
        options={options()}
        placeholder={loadMutation.loading() ? "Loading tags..." : "No tags"}
        searchPlaceholder="Search tags..."
        emptyLabel="No tags in this book"
        disabled={props.loading || loadMutation.loading()}
        clearable
        onValueChange={props.onChange}
      />
      <Show when={loaded() && available().length === 0 && props.onManage}>
        <Button type="button" variant="ghost" size="xs" class="w-fit" loading={managing()} onClick={() => void manageTags()}>
          <i class="ti ti-settings" aria-hidden="true" />
          Manage tags in book settings
        </Button>
      </Show>
    </div>
  );
}

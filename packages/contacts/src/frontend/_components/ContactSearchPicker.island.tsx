import { TextInput } from "@valentinkolb/cloud/ui";
import { timed } from "@valentinkolb/stdlib/solid";
import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Contact } from "../../service";
import { resolveContactName } from "../../shared";

type Props = {
  /** Restricts results to one book — picker never crosses book boundaries. */
  bookId: string;
  /** Hide these contacts (e.g. self, current parent) from results. */
  excludeIds?: string[];
  /** Called when the user clicks a result. */
  onSelect: (contact: Contact) => void;
  placeholder?: string;
  /** Override the default empty/initial placeholder list size. */
  perPage?: number;
};

/**
 * Compact contact picker: search input + clickable result list. Used by the
 * editor's "Belongs to" field and the detail panel's "Add member" dialog.
 *
 * The query is debounced server-side so typing remains responsive on books
 * with thousands of contacts.
 */
export default function ContactSearchPicker(props: Props) {
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<Contact[]>([]);
  const [loading, setLoading] = createSignal(false);

  const fetchResults = async (q: string) => {
    setLoading(true);
    try {
      const res = await apiClient.books[":bookId"].contacts.$get({
        param: { bookId: props.bookId },
        query: { q: q || undefined, per_page: String(props.perPage ?? 20) },
      });
      if (!res.ok) {
        setResults([]);
        return;
      }
      const payload = (await res.json()) as { data?: Contact[] };
      const items = payload.data ?? [];
      const excludeSet = new Set(props.excludeIds ?? []);
      setResults(items.filter((c) => !excludeSet.has(c.id)));
    } finally {
      setLoading(false);
    }
  };

  const { debouncedFn: debouncedFetch } = timed.debounce(fetchResults, 200);

  onMount(() => {
    void fetchResults("");
  });

  createEffect(() => {
    const q = query();
    void debouncedFetch(q);
  });

  const subtitle = (contact: Contact) => {
    const parts = [contact.companyName, contact.jobTitle].filter(Boolean) as string[];
    return parts.join(" · ");
  };

  return (
    <div class="flex flex-col gap-2">
      <TextInput
        ariaLabel="Search contacts"
        placeholder={props.placeholder ?? "Search by name, email, company…"}
        icon="ti ti-search"
        value={query}
        onInput={setQuery}
      />
      <div class="-mx-1 flex max-h-72 flex-col overflow-y-auto px-1">
        <Show
          when={results().length > 0}
          fallback={<p class="px-2 py-6 text-center text-xs text-dimmed">{loading() ? "Searching…" : "No matches"}</p>}
        >
          <For each={results()}>
            {(contact) => (
              <button
                type="button"
                onClick={() => props.onSelect(contact)}
                class="flex items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-medium dark:bg-zinc-700">
                  {resolveContactName(contact).charAt(0).toUpperCase()}
                </div>
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm text-primary">{resolveContactName(contact)}</div>
                  <Show when={subtitle(contact)}>
                    <div class="truncate text-xs text-dimmed">{subtitle(contact)}</div>
                  </Show>
                </div>
              </button>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

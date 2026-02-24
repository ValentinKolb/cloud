import { createSignal, For, Show } from "solid-js";
import { apiClient } from "@/notebooks/client";
import { TextInput } from "@valentinkolb/cloud/lib/ui";

type NoteResult = {
  id: string;
  title: string;
  contentMd: string | null;
};

type PaginationInfo = {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
};

type Props = {
  notebookId: string;
  close: (noteId?: string) => void;
};

/** Truncate content_md to a short snippet around the match */
function getSnippet(content: string | null, query: string): string | null {
  if (!content) return null;
  const lower = content.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return content.slice(0, 120);
  const start = Math.max(0, idx - 40);
  const end = Math.min(content.length, idx + query.length + 80);
  let snippet = content.slice(start, end).replace(/\n/g, " ");
  if (start > 0) snippet = "..." + snippet;
  if (end < content.length) snippet = snippet + "...";
  return snippet;
}

const PER_PAGE = 20;

export default function NoteSearch(props: Props) {
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<NoteResult[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [searched, setSearched] = createSignal(false);
  const [pagination, setPagination] = createSignal<PaginationInfo | null>(null);

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const fetchResults = async (q: string, page: number, append = false) => {
    try {
      const res = await apiClient[":id"].search.$get({
        param: { id: props.notebookId },
        query: { q: q.trim(), page: String(page), per_page: String(PER_PAGE) },
      });
      if (res.ok) {
        const data = (await res.json()) as {
          data: NoteResult[];
          pagination: PaginationInfo;
        };
        setResults(append ? [...results(), ...data.data] : data.data);
        setPagination(data.pagination);
      }
    } catch {
      /* ignore */
    }
  };

  const doSearch = async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      setPagination(null);
      return;
    }

    setLoading(true);
    setSearched(true);
    await fetchResults(q, 1);
    setLoading(false);
  };

  const loadMore = async () => {
    const p = pagination();
    if (!p || !p.has_next) return;
    setLoadingMore(true);
    await fetchResults(query(), p.page + 1, true);
    setLoadingMore(false);
  };

  const handleInput = (value: string) => {
    setQuery(value);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => doSearch(value), 300);
  };

  return (
    <div class="flex flex-col gap-4">
      <TextInput placeholder="Search pages..." icon="ti ti-search" value={() => query()} onInput={handleInput} />

      {/* Loading */}
      <Show when={loading()}>
        <div class="flex items-center justify-center py-4">
          <i class="ti ti-loader-2 animate-spin text-dimmed" />
        </div>
      </Show>

      {/* Results */}
      <Show when={!loading() && results().length > 0}>
        <div class="flex flex-col gap-1 max-h-72 overflow-y-auto">
          <For each={results()}>
            {(note) => (
              <button
                type="button"
                onClick={() => props.close(note.id)}
                class="text-left px-3 py-2.5 rounded-lg text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 flex flex-col gap-0.5"
              >
                <div class="flex items-center gap-2">
                  <i class="ti ti-file-text text-xs text-dimmed" />
                  <span class="font-medium truncate">{note.title}</span>
                </div>
                <Show when={getSnippet(note.contentMd, query())}>
                  {(snippet) => <p class="text-xs text-dimmed truncate pl-5">{snippet()}</p>}
                </Show>
              </button>
            )}
          </For>

          {/* Load more */}
          <Show when={pagination()?.has_next}>
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore()}
              class="text-xs text-dimmed hover:text-primary transition-colors py-2 text-center"
            >
              {loadingMore() ? <i class="ti ti-loader-2 animate-spin" /> : "Load more..."}
            </button>
          </Show>
        </div>
      </Show>

      {/* Empty state */}
      <Show when={!loading() && searched() && results().length === 0}>
        <p class="flex items-center justify-center gap-1.5 py-6 text-xs text-dimmed">
          <i class="ti ti-search-off text-sm" />
          No pages found
        </p>
      </Show>
    </div>
  );
}

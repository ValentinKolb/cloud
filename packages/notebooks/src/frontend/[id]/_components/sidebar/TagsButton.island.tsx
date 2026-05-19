/**
 * Sidebar entry for tags — clicking opens a modal with the full tag
 * list (compact floating grid + live search). Each tag is a link to
 * `/app/notebooks/<id>/tags/<tag>`.
 *
 * Live-search uses `timed.debounce` from stdlib so we don't re-filter
 * on every keystroke. The list itself is fully client-side because the
 * tag-count is bounded — even a notebook with thousands of tags fits
 * in one fetch and a memo-based filter.
 */
import { prompts } from "@valentinkolb/cloud/ui";
import { timed } from "@valentinkolb/stdlib/solid";
import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import { buildTagPageUrl } from "../../../params";

type TagSummary = {
  tag: string;
  count: number;
};

type Variant = "sidebar" | "sidebar-mobile" | "icon";

type Props = {
  notebookId: string;
  tagCount: number;
  variant: Variant;
};

const fetchTags = async (notebookId: string): Promise<TagSummary[]> => {
  const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/tags`);
  if (!res.ok) throw new Error(`Failed to load tags (${res.status})`);
  return (await res.json()) as TagSummary[];
};

const TagsModal = (props: { notebookId: string; close: () => void }) => {
  const [tags] = createResource(() => props.notebookId, fetchTags);

  // Two signals: `query` is the live input (immediate UI feedback),
  // `debouncedQuery` is what drives the filter — updated 150ms after
  // typing pause so the memo doesn't churn on every keystroke.
  const [query, setQuery] = createSignal("");
  const [debouncedQuery, setDebouncedQuery] = createSignal("");
  const { debouncedFn: setQueryDebounced } = timed.debounce((v: string) => setDebouncedQuery(v), 150);

  const filtered = createMemo(() => {
    const q = debouncedQuery().trim().toLowerCase();
    const list = tags() ?? [];
    if (q.length === 0) return list;
    return list.filter((t) => t.tag.includes(q));
  });

  const onInput = (e: Event) => {
    const v = (e.currentTarget as HTMLInputElement).value;
    setQuery(v);
    setQueryDebounced(v);
  };

  return (
    <div class="w-full max-w-full flex flex-col gap-3 min-w-[24rem]">
      <input
        type="text"
        class="input"
        placeholder="Search tags..."
        autofocus
        value={query()}
        onInput={onInput}
      />

      <Show when={!tags.loading} fallback={<p class="text-xs text-dimmed">Loading tags…</p>}>
        <Show
          when={filtered().length > 0}
          fallback={
            <p class="text-xs text-dimmed py-2">
              {(tags() ?? []).length === 0 ? "No tags yet." : `No tags match "${query()}".`}
            </p>
          }
        >
          {/* Compact floating grid — flex-wrap pills so many tags fit
              into the same modal without per-tag rows. Same visual as
              the read-mode pills + the editor pills. */}
          <ul class="flex flex-wrap gap-2 max-h-[60vh] overflow-y-auto content-start">
            <For each={filtered()}>
              {(t) => (
                <li>
                  <a
                    href={buildTagPageUrl(props.notebookId, t.tag)}
                    class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 no-underline transition-colors"
                  >
                    <i class="ti ti-hash text-sm" />
                    <span>{t.tag}</span>
                    <span class="text-emerald-500/80 dark:text-emerald-400/80 tabular-nums">{t.count}</span>
                  </a>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </div>
  );
};

const openTagsModal = (notebookId: string) =>
  prompts.dialog<void>(
    (close) => <TagsModal notebookId={notebookId} close={() => close(undefined)} />,
    { title: "Tags", icon: "ti ti-hash" },
  );

export default function TagsButton(props: Props) {
  if (props.variant === "icon") {
    return (
      <button
        type="button"
        class="sidebar-icon-action"
        onClick={() => void openTagsModal(props.notebookId)}
        title={`${props.tagCount} tag${props.tagCount === 1 ? "" : "s"}`}
        aria-label="Tags"
      >
        <i class="ti ti-hash text-base" />
      </button>
    );
  }

  if (props.variant === "sidebar-mobile") {
    return (
      <button type="button" class="sidebar-item-mobile w-full" onClick={() => void openTagsModal(props.notebookId)}>
        <i class="ti ti-hash" />
        Tags ({props.tagCount})
      </button>
    );
  }
  return (
    <button
      type="button"
      class="sidebar-item text-xs w-full"
      onClick={() => void openTagsModal(props.notebookId)}
      title={`${props.tagCount} tag${props.tagCount === 1 ? "" : "s"}`}
    >
      <i class="ti ti-hash text-sm" />
      <span class="flex-1 text-left">Tags</span>
      <span class="text-dimmed tabular-nums">{props.tagCount}</span>
    </button>
  );
}

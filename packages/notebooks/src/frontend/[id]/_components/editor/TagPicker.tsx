/**
 * Tag picker modal — opened by the `/tag` slash command. Lists every
 * tag in the current notebook (with note counts) so the user can pick
 * an existing tag for re-use, or type a brand-new tag inline.
 *
 * KISS: the picker only inserts text. The editor decoration in
 * `tag-pill.ts` then renders the inserted `#tag` as a coloured pill on
 * the next state-update tick.
 */
import type { EditorView } from "@codemirror/view";
import { prompts } from "@valentinkolb/cloud/ui";
import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import { insertAtCursor } from "./editor-actions";

type TagSummary = {
  tag: string;
  count: number;
};

const fetchTags = async (notebookId: string): Promise<TagSummary[]> => {
  const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/tags`);
  if (!res.ok) return [];
  return (await res.json()) as TagSummary[];
};

type Props = {
  notebookId: string;
  view: EditorView;
  close: (picked: string | null) => void;
};

const sanitizeTag = (raw: string): string =>
  raw
    .trim()
    .replace(/^#+/, "") // strip leading #s the user might type
    .replace(/[^\w/-]/g, "") // strip any chars not allowed in tags
    .toLowerCase();

const TagPicker = (props: Props) => {
  const [tags] = createResource(() => props.notebookId, fetchTags);
  const [query, setQuery] = createSignal("");

  const visible = createMemo(() => {
    const q = sanitizeTag(query());
    const list = tags() ?? [];
    if (q.length === 0) return list;
    return list.filter((t) => t.tag.includes(q));
  });

  const exactMatch = createMemo(() => {
    const q = sanitizeTag(query());
    return q.length > 0 && visible().some((t) => t.tag === q);
  });

  const showCreate = createMemo(() => {
    const q = sanitizeTag(query());
    return q.length > 0 && !exactMatch();
  });

  const insert = (tag: string) => {
    insertAtCursor(props.view, `#${tag} `);
    props.close(tag);
  };

  let inputEl: HTMLInputElement | undefined;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    // Enter inserts the first visible tag, OR creates the typed-but-
    // unrecognised one. Mirrors the slash-command UX.
    const first = visible()[0];
    if (first) insert(first.tag);
    else if (showCreate()) insert(sanitizeTag(query()));
  };

  return (
    <div class="w-full max-w-full flex flex-col gap-2 min-w-[20rem]">
      <input
        ref={inputEl}
        type="text"
        class="input"
        placeholder="Search or create tag..."
        autofocus
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={onKeyDown}
      />

      <Show when={!tags.loading} fallback={<p class="text-xs text-dimmed">Loading tags…</p>}>
        <ul class="flex flex-col gap-0.5 max-h-72 overflow-y-auto">
          <Show when={showCreate()}>
            <li>
              <button
                type="button"
                onClick={() => insert(sanitizeTag(query()))}
                class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left text-emerald-700 dark:text-emerald-300"
              >
                <i class="ti ti-plus text-sm shrink-0" />
                <span class="flex-1 truncate">Create #{sanitizeTag(query())}</span>
              </button>
            </li>
          </Show>
          <For each={visible()}>
            {(t) => (
              <li>
                <button
                  type="button"
                  onClick={() => insert(t.tag)}
                  class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left"
                >
                  <i class="ti ti-hash text-sm shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span class="flex-1 truncate">{t.tag}</span>
                  <span class="text-dimmed tabular-nums">{t.count}</span>
                </button>
              </li>
            )}
          </For>
          <Show when={(tags() ?? []).length === 0 && !showCreate()}>
            <li class="text-xs text-dimmed px-2 py-1.5">No tags yet — type one to create your first.</li>
          </Show>
        </ul>
      </Show>
    </div>
  );
};

export const openTagPicker = (notebookId: string, view: EditorView): Promise<void> =>
  prompts.dialog<void>(
    (close) => <TagPicker notebookId={notebookId} view={view} close={() => close(undefined)} />,
    { title: "Insert tag", icon: "ti ti-hash" },
  ).then(() => undefined);

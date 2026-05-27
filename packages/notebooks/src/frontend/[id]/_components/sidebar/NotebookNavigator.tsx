import { apiClient } from "@/api/client";
import { Dropdown, SelectChip, prompts } from "@valentinkolb/cloud/ui";
import { dates } from "@valentinkolb/stdlib";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { buildAttachmentsUrl, buildNoteUrl } from "../../../params";
import { navigateToNotebookNote } from "../../../lib/soft-navigation";
import type { NoteTreeNode, Notebook, TagSummary } from "./types";
import { NOTE_SOFT_NAVIGATED_EVENT } from "../detail/events";
import NotebookSettingsButton from "../settings/NotebookSettingsButton";
import SearchButton from "../search/SearchButton";
import { noteActionItems, useNoteActions } from "./NoteTree";

type SortMode = "updated" | "created" | "title";
type TreeMode = "deep" | "level";
type RootMode = "favorites" | "recents";

type Props = {
  notebook: Notebook;
  tree: NoteTreeNode[];
  selectedNoteId: string | null;
  permission: string;
  canWrite: boolean;
  favoriteNoteIds: string[];
  tags: TagSummary[];
};

type Selection =
  | { root: "favorites" }
  | { root: "recents" }
  | { root: "notes"; noteId: string | null }
  | { root: "tags"; tag: string | null };

const ROOTS: { id: RootMode; label: string; icon: string }[] = [
  { id: "favorites", label: "Favorites", icon: "ti ti-star" },
  { id: "recents", label: "Recents", icon: "ti ti-clock" },
];

const SORT_OPTIONS = [
  { value: "updated", label: "Updated" },
  { value: "created", label: "Created" },
  { value: "title", label: "Name" },
] satisfies { value: SortMode; label: string }[];

const TREE_MODE_OPTIONS = [
  { value: "deep", label: "Descendants" },
  { value: "level", label: "Children" },
] satisfies { value: TreeMode; label: string }[];

const flattenTree = (nodes: NoteTreeNode[]): NoteTreeNode[] => {
  const result: NoteTreeNode[] = [];
  const visit = (list: NoteTreeNode[]) => {
    for (const node of list) {
      result.push(node);
      visit(node.children);
    }
  };
  visit(nodes);
  return result;
};

const directChildren = (nodes: NoteTreeNode[], parentId: string | null): NoteTreeNode[] => {
  if (!parentId) return nodes;
  for (const node of flattenTree(nodes)) {
    if (node.id === parentId) return node.children;
  }
  return [];
};

const subtree = (nodes: NoteTreeNode[], noteId: string | null): NoteTreeNode[] => {
  if (!noteId) return flattenTree(nodes);
  const start = flattenTree(nodes).find((note) => note.id === noteId);
  return start ? [start, ...flattenTree(start.children)] : [];
};

const branchNodes = (nodes: NoteTreeNode[]): NoteTreeNode[] =>
  nodes.filter((note) => note.children.length > 0).map((note) => ({ ...note, children: branchNodes(note.children) }));

const noteFolderContext = (nodes: NoteTreeNode[], selectedNoteId: string | null): string | null => {
  if (!selectedNoteId) return null;
  const selected = flattenTree(nodes).find((note) => note.id === selectedNoteId);
  if (!selected) return null;
  return selected.children.length > 0 ? selected.id : selected.parentId;
};

const tagsFromMarkdown = (md: string | null): string[] => {
  if (!md) return [];
  const tags = new Set<string>();
  for (const match of md.replace(/```[\s\S]*?```/g, "").matchAll(/(?:^|\s)#([a-zA-Z][\w-]*(?:\/[\w-]+)*)/g)) {
    tags.add(match[1]!.toLowerCase());
  }
  return [...tags];
};

const plainPreview = (md: string | null): string => {
  if (!md) return "";
  const text = md
    .replace(/^---[\s\S]*?\n---\n/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/:::[\s\S]*?:::/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[[^\]]+]\([^)]+\)/g, (value) => value.match(/^\[([^\]]+)]/)?.[1] ?? " ")
    .replace(/[#*_`>\-[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 140 ? `${text.slice(0, 139)}…` : text;
};

const NoteBranchPicker = (props: {
  nodes: NoteTreeNode[];
  selectedId: string | null;
  collapsedIds: Set<string>;
  onSelect: (id: string | null) => void;
  onToggle: (id: string) => void;
  depth?: number;
}) => (
  <div class="flex flex-col gap-0.5">
    <For each={props.nodes}>
      {(note) => (
        <>
          <button
            type="button"
            class={`flex min-h-7 items-center gap-2 rounded-md px-2 text-left text-xs transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/80 ${
              props.selectedId === note.id ? "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200" : "text-dimmed"
            }`}
            style={`padding-left:${1.25 + (props.depth ?? 0) * 0.75}rem`}
            onClick={() => props.onSelect(note.id)}
          >
            <Show when={note.children.length > 0} fallback={<span class="h-4 w-4 shrink-0" />}>
              <span
                class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-dimmed hover:bg-zinc-200/70 hover:text-secondary dark:hover:bg-zinc-700"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onToggle(note.id);
                }}
              >
                <i class={`ti ti-chevron-down text-[10px] transition-transform ${props.collapsedIds.has(note.id) ? "-rotate-90" : ""}`} />
              </span>
            </Show>
            <span class="min-w-0 flex-1 truncate">{note.title || "Untitled"}</span>
          </button>
          <Show when={!props.collapsedIds.has(note.id)}>
            <NoteBranchPicker
              nodes={note.children}
              selectedId={props.selectedId}
              collapsedIds={props.collapsedIds}
              onSelect={props.onSelect}
              onToggle={props.onToggle}
              depth={(props.depth ?? 0) + 1}
            />
          </Show>
        </>
      )}
    </For>
  </div>
);

export default function NotebookNavigator(props: Props) {
  const [selection, setSelection] = createSignal<Selection>({ root: "notes", noteId: noteFolderContext(props.tree, props.selectedNoteId) });
  const [sortMode, setSortMode] = createSignal<SortMode>("updated");
  const [treeMode, setTreeMode] = createSignal<TreeMode>("deep");
  const [favoriteIds, setFavoriteIds] = createSignal(new Set(props.favoriteNoteIds));
  const [activeNoteId, setActiveNoteId] = createSignal(props.selectedNoteId);
  const [notesExpanded, setNotesExpanded] = createSignal(true);
  const [tagsExpanded, setTagsExpanded] = createSignal(true);
  const [collapsedNoteIds, setCollapsedNoteIds] = createSignal(new Set<string>());
  const actions = useNoteActions(props.notebook.shortId, () => props.tree);

  const allNotes = createMemo(() => flattenTree(props.tree));
  const notesById = createMemo(() => new Map(allNotes().map((note) => [note.id, note])));
  const branchTree = createMemo(() => branchNodes(props.tree));
  const homepageNote = createMemo(() => (props.notebook.homepageNoteId ? (notesById().get(props.notebook.homepageNoteId) ?? null) : null));
  const selectedRoot = () => selection().root;
  const selectedNoteRootId = () => {
    const current = selection();
    return current.root === "notes" ? current.noteId : null;
  };
  const selectedTag = () => {
    const current = selection();
    return current.root === "tags" ? current.tag : null;
  };
  const attachmentsHref = () => buildAttachmentsUrl(props.notebook.shortId);
  const noteHref = (note: NoteTreeNode) => buildNoteUrl(props.notebook.shortId, note.shortId);

  const noteTags = (note: NoteTreeNode) => tagsFromMarkdown(note.contentMd);

  const visibleNotes = createMemo(() => {
    const current = selection();
    let notes: NoteTreeNode[] = [];
    if (current.root === "favorites") notes = allNotes().filter((note) => favoriteIds().has(note.id));
    if (current.root === "recents") notes = allNotes();
    if (current.root === "notes") {
      notes = treeMode() === "deep" ? subtree(props.tree, current.noteId) : directChildren(props.tree, current.noteId);
      if (current.noteId) notes = notes.filter((note) => note.id !== current.noteId);
      else if (homepageNote()) notes = notes.filter((note) => note.id !== homepageNote()!.id);
    }
    if (current.root === "tags") {
      const tag = current.tag;
      notes = tag ? allNotes().filter((note) => noteTags(note).includes(tag)) : [];
    }

    return [...notes].sort((left, right) => {
      if (sortMode() === "title") return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
      const leftDate = sortMode() === "created" ? left.createdAt : left.updatedAt;
      const rightDate = sortMode() === "created" ? right.createdAt : right.updatedAt;
      return rightDate.localeCompare(leftDate) || left.title.localeCompare(right.title);
    });
  });

  const pinnedNote = createMemo(() => {
    const current = selection();
    if (current.root !== "notes") return null;
    if (current.noteId) return notesById().get(current.noteId) ?? null;
    return homepageNote();
  });

  const vt = (key: string) => `notebook-navigator-${props.notebook.shortId}-${key}`;

  createEffect(() => setFavoriteIds(new Set(props.favoriteNoteIds)));
  createEffect(() => {
    if (props.selectedNoteId) setActiveNoteId(props.selectedNoteId);
  });

  const toggleNoteExpanded = (noteId: string) =>
    setCollapsedNoteIds((current) => {
      const next = new Set(current);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });

  const toggleFavorite = async (note: NoteTreeNode, event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const next = !favoriteIds().has(note.id);
    setFavoriteIds((current) => {
      const copy = new Set(current);
      if (next) copy.add(note.id);
      else copy.delete(note.id);
      return copy;
    });

    const response = await apiClient[":id"].notes[":noteId"].favorite.$put({
      param: { id: props.notebook.shortId, noteId: note.shortId },
      json: { favorite: next },
    });
    if (!response.ok) {
      setFavoriteIds((current) => {
        const copy = new Set(current);
        if (next) copy.delete(note.id);
        else copy.add(note.id);
        return copy;
      });
      void prompts.error("Failed to update favorite.");
    }
  };

  onMount(() => {
    const onSoftNavigated = (event: Event) => {
      const detail = (event as CustomEvent<{ canonicalNoteId?: string }>).detail;
      if (!detail?.canonicalNoteId) return;
      setActiveNoteId(detail.canonicalNoteId);
      const noteVisibleInCurrentRoot =
        visibleNotes().some((note) => note.id === detail.canonicalNoteId) || pinnedNote()?.id === detail.canonicalNoteId;
      if (!noteVisibleInCurrentRoot) {
        setSelection({ root: "notes", noteId: noteFolderContext(props.tree, detail.canonicalNoteId) });
      }
    };
    window.addEventListener(NOTE_SOFT_NAVIGATED_EVENT, onSoftNavigated);
    onCleanup(() => window.removeEventListener(NOTE_SOFT_NAVIGATED_EVENT, onSoftNavigated));
  });

  const openHomepage = () => {
    const home = homepageNote();
    if (!home) {
      void prompts.alert(
        "No homepage is selected for this notebook yet. Open notebook settings and choose a homepage in the General tab.",
        { title: "No homepage selected", icon: "ti ti-home" },
      );
      return;
    }
    setActiveNoteId(home.id);
    void navigateToNotebookNote(noteHref(home));
  };

  return (
    <div class="grid min-h-0 flex-1 grid-cols-[11rem_minmax(0,1fr)] gap-2.5">
      <div class="flex min-h-0 flex-col pr-1">
        <div class="min-h-0 flex-1 overflow-y-auto">
          <div class="relative mb-4 flex items-center gap-3 pr-7">
            <div class="sidebar-header-icon flex shrink-0 items-center justify-center bg-blue-500 text-white">
              <i class={`ti ${props.notebook.icon || "ti-notebook"} text-xs`} />
            </div>
            <div class="min-w-0 flex-1">
              <p class="sidebar-header-title">{props.notebook.name}</p>
            </div>
            <NotebookSettingsButton
              notebook={props.notebook}
              tree={props.tree}
              permission={props.permission}
              variant="desktop"
              viewTransitionName={vt("settings-desktop")}
            />
          </div>

          <div class="flex flex-col gap-1">
            <For each={ROOTS}>
              {(root) => (
                <button
                  type="button"
                  class={`sidebar-item text-xs ${selectedRoot() === root.id ? "sidebar-item-active" : ""}`}
                  onClick={() => setSelection({ root: root.id })}
                >
                  <i class={`${root.icon} text-sm`} />
                  <span class="min-w-0 flex-1 truncate text-left">{root.label}</span>
                  <Show when={root.id === "favorites"}>{favoriteIds().size}</Show>
                </button>
              )}
            </For>
            <button
              type="button"
              class={`sidebar-item text-xs ${homepageNote()?.id === activeNoteId() ? "sidebar-item-active" : ""}`}
              onClick={openHomepage}
            >
              <i class="ti ti-home text-sm" />
              <span class="min-w-0 flex-1 truncate text-left">Homepage</span>
            </button>
            <SearchButton notebookId={props.notebook.shortId} notebookName={props.notebook.name} variant="sidebar" />
          </div>

          <div class="mt-3">
            <button
              type="button"
              class={`mb-1 flex min-h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/80 ${
                selectedRoot() === "notes" && selectedNoteRootId() === null
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200"
                  : "text-dimmed"
              }`}
              onClick={() => setSelection({ root: "notes", noteId: null })}
            >
              <span
                class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-dimmed hover:bg-zinc-200/70 hover:text-secondary dark:hover:bg-zinc-700"
                onClick={(event) => {
                  event.stopPropagation();
                  setNotesExpanded((value) => !value);
                }}
              >
                <i class={`ti ti-chevron-down text-[10px] transition-transform ${notesExpanded() ? "" : "-rotate-90"}`} />
              </span>
              <i class="ti ti-folder text-sm" />
              <span class="min-w-0 flex-1 truncate">All notes</span>
            </button>
            <Show when={notesExpanded()}>
              <NoteBranchPicker
                nodes={branchTree()}
                selectedId={selectedNoteRootId()}
                collapsedIds={collapsedNoteIds()}
                onSelect={(noteId) => setSelection({ root: "notes", noteId })}
                onToggle={toggleNoteExpanded}
              />
            </Show>
          </div>

          <div class="mt-3">
            <button
              type="button"
              class="mb-1 flex min-h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-dimmed transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
              onClick={() => setTagsExpanded((value) => !value)}
            >
              <span class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-dimmed">
                <i class={`ti ti-chevron-down text-[10px] transition-transform ${tagsExpanded() ? "" : "-rotate-90"}`} />
              </span>
              <i class="ti ti-tags text-sm" />
              <span class="min-w-0 flex-1 truncate">Tags</span>
            </button>
            <Show when={tagsExpanded()}>
              <div class="flex flex-col gap-0.5">
                <For each={props.tags}>
                  {(tag) => (
                    <button
                      type="button"
                      class={`flex min-h-7 items-center gap-2 rounded-md px-2 pl-8 text-left text-xs transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/80 ${
                        selectedTag() === tag.tag ? "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200" : "text-dimmed"
                      }`}
                      onClick={() => setSelection({ root: "tags", tag: tag.tag })}
                    >
                      <i class="ti ti-tag text-sm" />
                      <span class="min-w-0 flex-1 truncate">#{tag.tag}</span>
                      <span class="tabular-nums">{tag.count}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>

        <div class="mt-3 flex shrink-0 flex-col gap-1">
          <a href="/app/notebooks" class="sidebar-item text-xs">
            <i class="ti ti-library text-sm" />
            <span class="min-w-0 flex-1 truncate text-left">All Notebooks</span>
          </a>
          <a href={attachmentsHref()} class="sidebar-item text-xs">
            <i class="ti ti-paperclip text-sm" />
            <span class="min-w-0 flex-1 truncate text-left">Attachments</span>
          </a>
        </div>
      </div>

      <div class="flex min-h-0 min-w-0 flex-col">
        <div class="flex shrink-0 flex-wrap items-center gap-1.5 pb-2">
          <SelectChip value={treeMode()} options={TREE_MODE_OPTIONS} onChange={setTreeMode} icon="ti ti-list-tree" />
          <SelectChip value={sortMode()} options={SORT_OPTIONS} onChange={setSortMode} icon="ti ti-sort-descending" />
          <Show when={props.canWrite}>
            <button
              type="button"
              class="icon-btn ml-auto text-green-600 dark:text-green-400"
              title="New note"
              aria-label="New note"
              onClick={() => actions.handleCreateNote()}
            >
              <i class="ti ti-plus" />
            </button>
          </Show>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto pr-1">
          <Show
            when={visibleNotes().length > 0 || pinnedNote()}
            fallback={<p class="rounded-lg bg-zinc-50 px-3 py-3 text-xs text-dimmed dark:bg-zinc-900/60">No notes here yet.</p>}
          >
            <div class="flex flex-col gap-1.5">
              <Show when={pinnedNote()}>
                {(note) => (
                  <a
                    href={noteHref(note())}
                    class={`group rounded-lg px-3 py-2 transition-colors ${"bg-zinc-50/80 hover:bg-zinc-100 dark:bg-zinc-900/45 dark:hover:bg-zinc-800/70"}`}
                    onClick={(event) => {
                      event.preventDefault();
                      setActiveNoteId(note().id);
                      void navigateToNotebookNote(noteHref(note()));
                    }}
                  >
                    <div class="flex items-center gap-2">
                      <div class="min-w-0 flex-1">
                        <p class="flex min-w-0 items-center gap-2 truncate text-sm font-semibold text-primary">
                          <i
                            class={`ti ${selectedNoteRootId() ? "ti-folder" : "ti-home"} shrink-0 text-sm text-zinc-500 dark:text-zinc-400`}
                          />
                          <span class="min-w-0 truncate">{note().title || "Untitled"}</span>
                        </p>
                      </div>
                      <Show when={props.canWrite}>
                        <Dropdown
                          trigger={
                            <span class="sidebar-item-action opacity-70 group-hover:opacity-100">
                              <i class="ti ti-dots text-xs" />
                            </span>
                          }
                          position="bottom-right"
                          width="w-48"
                          elements={noteActionItems(note(), actions)}
                        />
                      </Show>
                    </div>
                  </a>
                )}
              </Show>
              <For each={visibleNotes()}>
                {(note) => {
                  const href = () => noteHref(note);
                  const active = () => note.id === activeNoteId();
                  const tags = () => noteTags(note).slice(0, 3);
                  return (
                    <a
                      href={href()}
                      class={`group rounded-lg px-3 py-2 transition-colors ${
                        active()
                          ? "bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-100"
                          : "bg-zinc-50/70 hover:bg-zinc-100 dark:bg-zinc-900/60 dark:hover:bg-zinc-800/80"
                      }`}
                      onClick={(event) => {
                        event.preventDefault();
                        setActiveNoteId(note.id);
                        void navigateToNotebookNote(href());
                      }}
                    >
                      <div class="flex items-start gap-2">
                        <div class="min-w-0 flex-1">
                          <p class="truncate text-xs font-semibold text-primary">{note.title || "Untitled"}</p>
                          <Show when={plainPreview(note.contentMd)}>
                            <p class="mt-0.5 line-clamp-2 text-[11px] leading-snug text-dimmed">{plainPreview(note.contentMd)}</p>
                          </Show>
                        </div>
                        <button
                          type="button"
                          class={`sidebar-item-action opacity-70 group-hover:opacity-100 ${
                            favoriteIds().has(note.id) ? "!text-amber-500 hover:!text-amber-500" : ""
                          }`}
                          title={favoriteIds().has(note.id) ? "Remove favorite" : "Add favorite"}
                          aria-label={favoriteIds().has(note.id) ? "Remove favorite" : "Add favorite"}
                          onClick={(event) => void toggleFavorite(note, event)}
                        >
                          <i class="ti ti-star" />
                        </button>
                        <Show when={props.canWrite}>
                          <Dropdown
                            trigger={
                              <span class="sidebar-item-action opacity-70 group-hover:opacity-100">
                                <i class="ti ti-dots text-xs" />
                              </span>
                            }
                            position="bottom-right"
                            width="w-48"
                            elements={noteActionItems(note, actions)}
                          />
                        </Show>
                      </div>
                      <div class="mt-1.5 flex items-center gap-1.5">
                        <For each={tags()}>
                          {(tag) => (
                            <span class="truncate rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                              #{tag}
                            </span>
                          )}
                        </For>
                        <span class="ml-auto shrink-0 text-[10px] text-dimmed">{dates.formatDateTimeRelative(note.updatedAt)}</span>
                      </div>
                    </a>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

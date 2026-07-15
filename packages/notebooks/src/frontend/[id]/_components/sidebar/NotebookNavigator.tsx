import { Dropdown, Placeholder, prompts, SelectChip } from "@valentinkolb/cloud/ui";
import { dates, searchParams, type DateContext } from "@valentinkolb/stdlib";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { parseNavigatorQuery, type NavigatorQuery, withNavigatorQuery } from "../../../../lib/navigator-url";
import { navigateToNotebookNote } from "../../../lib/soft-navigation";
import { buildAttachmentsUrl, buildNoteUrl } from "../../../params";
import { NOTE_SOFT_NAVIGATED_EVENT } from "../detail/events";
import SearchButton from "../search/SearchButton";
import NotebookSettingsButton from "../settings/NotebookSettingsButton";
import { type NotebookSettings, writeSettings } from "../settings/NotebookSettingsStore";
import { noteActionItems, useNoteActions } from "./NoteTree";
import { flattenTree } from "./tree-utils";
import type { Notebook, NoteTreeNode, TagSummary } from "./types";
import { useFavoriteNotes } from "./useFavoriteNotes";

type SortMode = NotebookSettings["navigatorSort"];
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
  initialSortMode: SortMode;
  dateConfig: DateContext;
  initialQuery: NavigatorQuery;
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

const navigatorRowClass = (active: boolean, extra = "") =>
  `sidebar-item h-8 min-h-8 w-full py-0 text-xs ${active ? "sidebar-item-active" : ""} ${extra}`;

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

const selectionFromQuery = (query: NavigatorQuery, nodes: NoteTreeNode[], selectedNoteId: string | null): Selection => {
  if (query.view === "favorites" || query.view === "recents") return { root: query.view };
  if (query.view === "tag") return { root: "tags", tag: query.tag };
  if (query.view === "folder") {
    const folder = flattenTree(nodes).find((note) => note.shortId === query.folder);
    if (folder) return { root: "notes", noteId: folder.id };
  }
  return { root: "notes", noteId: noteFolderContext(nodes, selectedNoteId) };
};

const queryFromSelection = (selection: Selection, nodes: NoteTreeNode[]): NavigatorQuery => {
  if (selection.root === "favorites" || selection.root === "recents") return { view: selection.root };
  if (selection.root === "tags" && selection.tag) return { view: "tag", tag: selection.tag };
  if (selection.root === "notes" && selection.noteId) {
    const folder = flattenTree(nodes).find((note) => note.id === selection.noteId);
    if (folder) return { view: "folder", folder: folder.shortId };
  }
  return {};
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
          <div class={navigatorRowClass(props.selectedId === note.id)} style={`padding-left:${1.25 + (props.depth ?? 0) * 0.75}rem`}>
            <Show when={note.children.length > 0} fallback={<span class="h-4 w-4 shrink-0" />}>
              <button
                type="button"
                class="sidebar-item-action h-4 w-4 shrink-0"
                aria-label={`${props.collapsedIds.has(note.id) ? "Expand" : "Collapse"} ${note.title || "Untitled"}`}
                onClick={() => props.onToggle(note.id)}
              >
                <i class={`ti ti-chevron-down text-[10px] transition-transform ${props.collapsedIds.has(note.id) ? "-rotate-90" : ""}`} />
              </button>
            </Show>
            <button type="button" class="min-w-0 flex-1 truncate text-left" onClick={() => props.onSelect(note.id)}>
              {note.title || "Untitled"}
            </button>
          </div>
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
  const [selection, setSelection] = createSignal<Selection>(selectionFromQuery(props.initialQuery, props.tree, props.selectedNoteId));
  const [sortMode, setSortMode] = createSignal<SortMode>(props.initialSortMode);
  const [treeMode, setTreeMode] = createSignal<TreeMode>("deep");
  const [activeNoteId, setActiveNoteId] = createSignal(props.selectedNoteId);
  const [notesExpanded, setNotesExpanded] = createSignal(true);
  const [tagsExpanded, setTagsExpanded] = createSignal(true);
  const [collapsedNoteIds, setCollapsedNoteIds] = createSignal(new Set<string>());
  const actions = useNoteActions(props.notebook.shortId, () => props.tree);
  const { favoriteNoteIds: favoriteIds, toggleFavorite } = useFavoriteNotes({
    notebookId: props.notebook.shortId,
    initialFavoriteNoteIds: () => props.favoriteNoteIds,
  });

  const allNotes = createMemo(() => flattenTree(props.tree));
  const notesById = createMemo(() => new Map(allNotes().map((note) => [note.id, note])));
  const branchTree = createMemo(() => branchNodes(props.tree));
  const hasBranches = createMemo(() => branchTree().length > 0);
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
  const noteHref = (note: NoteTreeNode) =>
    withNavigatorQuery(buildNoteUrl(props.notebook.shortId, note.shortId), queryFromSelection(selection(), props.tree));

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

  const changeSortMode = (mode: SortMode) => {
    setSortMode(mode);
    writeSettings(props.notebook.shortId, { navigatorSort: mode });
  };

  const select = (next: Selection, history: "push" | "replace" = "push") => {
    setSelection(next);
    const href = withNavigatorQuery(window.location.pathname + window.location.search, queryFromSelection(next, props.tree));
    if (href === window.location.pathname + window.location.search) return;
    window.history[history === "push" ? "pushState" : "replaceState"]({}, "", href);
  };

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

  onMount(() => {
    const onSoftNavigated = (event: Event) => {
      const detail = (event as CustomEvent<{ canonicalNoteId?: string }>).detail;
      if (!detail?.canonicalNoteId) return;
      setActiveNoteId(detail.canonicalNoteId);
      const noteVisibleInCurrentRoot =
        visibleNotes().some((note) => note.id === detail.canonicalNoteId) || pinnedNote()?.id === detail.canonicalNoteId;
      if (!noteVisibleInCurrentRoot) {
        select({ root: "notes", noteId: noteFolderContext(props.tree, detail.canonicalNoteId) }, "replace");
      }
    };
    const offSearchParams = searchParams.onChange(() => {
      setSelection(selectionFromQuery(parseNavigatorQuery(new URLSearchParams(window.location.search)), props.tree, activeNoteId()));
    });
    window.addEventListener(NOTE_SOFT_NAVIGATED_EVENT, onSoftNavigated);
    onCleanup(() => {
      offSearchParams();
      window.removeEventListener(NOTE_SOFT_NAVIGATED_EVENT, onSoftNavigated);
    });
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
    <div class="grid min-h-0 flex-1 grid-cols-[11rem_minmax(0,1fr)] gap-2">
      <div class="flex min-h-0 flex-col pr-1">
        <div class="min-h-0 flex-1 overflow-y-auto" data-scroll-preserve={`notebooks-navigator-roots-${props.notebook.shortId}`}>
          <div class="relative mb-2 flex items-center gap-2 pr-7">
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
              dateConfig={props.dateConfig}
              viewTransitionName={vt("settings-desktop")}
            />
          </div>

          <div class="flex flex-col gap-0.5">
            <For each={ROOTS}>
              {(root) => (
                <button type="button" class={navigatorRowClass(selectedRoot() === root.id)} onClick={() => select({ root: root.id })}>
                  <i class={`${root.icon} text-sm`} />
                  <span class="min-w-0 flex-1 truncate text-left">{root.label}</span>
                  <Show when={root.id === "favorites"}>{favoriteIds().size}</Show>
                </button>
              )}
            </For>
            <button
              type="button"
              class={navigatorRowClass(false)}
              aria-current={homepageNote()?.id === activeNoteId() ? "page" : undefined}
              onClick={openHomepage}
            >
              <i class={`ti ti-home text-sm ${homepageNote()?.id === activeNoteId() ? "app-accent-text" : ""}`} />
              <span class={`min-w-0 flex-1 truncate text-left ${homepageNote()?.id === activeNoteId() ? "app-accent-text" : ""}`}>
                Homepage
              </span>
            </button>
            <SearchButton notebookId={props.notebook.shortId} notebookName={props.notebook.name} variant="sidebar" />
          </div>

          <div class="mt-2">
            <div class={navigatorRowClass(selectedRoot() === "notes" && selectedNoteRootId() === null, "mb-1")}>
              <Show when={hasBranches()}>
                <button
                  type="button"
                  class="sidebar-item-action h-4 w-4 shrink-0"
                  aria-label={`${notesExpanded() ? "Collapse" : "Expand"} all notes`}
                  onClick={() => setNotesExpanded((value) => !value)}
                >
                  <i class={`ti ti-chevron-down text-[10px] transition-transform ${notesExpanded() ? "" : "-rotate-90"}`} />
                </button>
              </Show>
              <i class="ti ti-folder text-sm" />
              <button type="button" class="min-w-0 flex-1 truncate text-left" onClick={() => select({ root: "notes", noteId: null })}>
                All notes
              </button>
            </div>
            <Show when={hasBranches() && notesExpanded()}>
              <NoteBranchPicker
                nodes={branchTree()}
                selectedId={selectedNoteRootId()}
                collapsedIds={collapsedNoteIds()}
                onSelect={(noteId) => select({ root: "notes", noteId })}
                onToggle={toggleNoteExpanded}
              />
            </Show>
          </div>

          <div class="mt-2">
            <button type="button" class={navigatorRowClass(false, "mb-1 font-medium")} onClick={() => setTagsExpanded((value) => !value)}>
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
                      class={navigatorRowClass(selectedTag() === tag.tag, "pl-8")}
                      onClick={() => select({ root: "tags", tag: tag.tag })}
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

        <div class="mt-2 flex shrink-0 flex-col gap-0.5">
          <a href="/app/notebooks" class="sidebar-item w-full text-xs">
            <i class="ti ti-library text-sm" />
            <span class="min-w-0 flex-1 truncate text-left">All Notebooks</span>
          </a>
          <a href={attachmentsHref()} class="sidebar-item w-full text-xs">
            <i class="ti ti-paperclip text-sm" />
            <span class="min-w-0 flex-1 truncate text-left">Attachments</span>
          </a>
        </div>
      </div>

      <div class="flex min-h-0 min-w-0 flex-col">
        <div class="flex shrink-0 flex-wrap items-center gap-2 pb-2">
          <SelectChip value={treeMode()} options={TREE_MODE_OPTIONS} onChange={setTreeMode} icon="ti ti-list-tree" />
          <SelectChip value={sortMode()} options={SORT_OPTIONS} onChange={changeSortMode} icon="ti ti-sort-descending" />
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

        <div class="min-h-0 flex-1 overflow-y-auto pr-1" data-scroll-preserve={`notebooks-navigator-list-${props.notebook.shortId}`}>
          <Show
            when={visibleNotes().length > 0 || pinnedNote()}
            fallback={
              <Placeholder surface="paper" align="left">
                No notes here yet.
              </Placeholder>
            }
          >
            <div class="flex flex-col gap-2">
              <Show when={pinnedNote()}>
                {(note) => {
                  const active = () => note().id === activeNoteId();
                  return (
                    <div
                      class={`paper group relative transition-all hover:paper-highlighted ${active() ? "paper-highlighted" : ""}`}
                      style={{ "border-color": active() ? "var(--ui-app-accent-border)" : undefined }}
                    >
                      <a
                        href={noteHref(note())}
                        class="block p-3 pr-10 no-underline"
                        onClick={(event) => {
                          event.preventDefault();
                          setActiveNoteId(note().id);
                          void navigateToNotebookNote(noteHref(note()));
                        }}
                      >
                        <div class="min-w-0">
                          <p class="flex min-w-0 items-center gap-2 truncate text-sm font-semibold text-primary">
                            <i
                              class={`ti ${selectedNoteRootId() ? "ti-folder" : "ti-home"} shrink-0 text-sm text-zinc-500 dark:text-zinc-400`}
                            />
                            <span class={`min-w-0 truncate ${active() ? "app-accent-text" : "text-dimmed dark:text-primary"}`}>
                              {note().title || "Untitled"}
                            </span>
                            <Show when={note().lockedAt}>
                              <i class="ti ti-lock shrink-0 text-xs text-amber-500" title="Locked" />
                            </Show>
                          </p>
                        </div>
                      </a>
                      <div class="absolute right-2 top-2">
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
                    </div>
                  );
                }}
              </Show>
              <For each={visibleNotes()}>
                {(note) => {
                  const href = () => noteHref(note);
                  const active = () => note.id === activeNoteId();
                  const tags = () => noteTags(note).slice(0, 3);
                  return (
                    <div
                      class={`paper group relative transition-all hover:paper-highlighted ${active() ? "paper-highlighted" : ""}`}
                      style={{ "border-color": active() ? "var(--ui-app-accent-border)" : undefined }}
                    >
                      <a
                        href={href()}
                        class="block p-3 pr-16 no-underline"
                        onClick={(event) => {
                          event.preventDefault();
                          setActiveNoteId(note.id);
                          void navigateToNotebookNote(href());
                        }}
                      >
                        <div class="min-w-0">
                          <p class="flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold text-primary">
                            <span class={`min-w-0 truncate ${active() ? "app-accent-text" : "text-dimmed dark:text-primary"}`}>
                              {note.title || "Untitled"}
                            </span>
                            <Show when={note.lockedAt}>
                              <i class="ti ti-lock shrink-0 text-xs text-amber-500" title="Locked" />
                            </Show>
                          </p>
                          <Show when={plainPreview(note.contentMd)}>
                            <p class="mt-0.5 line-clamp-2 text-[11px] leading-snug text-dimmed">{plainPreview(note.contentMd)}</p>
                          </Show>
                        </div>
                        <div class="mt-2 flex items-center gap-1.5">
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
                      <div class="absolute right-2 top-2 flex items-center gap-0.5">
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
                    </div>
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

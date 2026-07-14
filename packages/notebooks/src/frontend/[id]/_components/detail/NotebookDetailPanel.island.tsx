import type { NotebookPresenceParticipant } from "@valentinkolb/cloud/contracts";
import { AppWorkspace, Tooltip, toast } from "@valentinkolb/cloud/ui";
import { dates, fileIcons } from "@valentinkolb/stdlib";
import { clipboard, files } from "@valentinkolb/stdlib/browser";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { NamedBlockSummary } from "../../../../lib/named-blocks";
import type { Backlink } from "../../../../service/links";
import { buildVersionsUrl } from "../../../params";
import type { Attachment } from "../editor/attachments-client";
import { buildAttachmentContentUrl, confirmAndDownload, formatBytes } from "../editor/attachments-client";
import { setDetailPanelOpen } from "../settings/NotebookSettingsStore";
import {
  ATTACHMENTS_UPDATE_EVENT,
  DETAIL_PANEL_STATE_EVENT,
  DETAIL_PANEL_TOGGLE_EVENT,
  EDITOR_COPY_EVENT,
  EDITOR_DOWNLOAD_EVENT,
  NAMED_BLOCK_SCROLL_EVENT,
  NAMED_BLOCKS_UPDATE_EVENT,
  NOTE_SOFT_NAVIGATED_EVENT,
  PRESENCE_EVENT,
  RICH_MODE_CHANGED_EVENT,
  TASKS_UPDATE_EVENT,
  TOC_SCROLL_EVENT,
  TOC_UPDATE_EVENT,
  TOGGLE_RICH_MODE_EVENT,
} from "./events";
import type { TaskProgress } from "./tasks";
import type { TocItem } from "./toc";

type Props = {
  mode: "edit" | "read";
  initiallyOpen: boolean;
  tocItems: TocItem[];
  taskProgress: TaskProgress;
  /** Attachments referenced from the current note's markdown — initial SSR
   *  hydration. Live updates flow through `ATTACHMENTS_UPDATE_EVENT`. */
  attachments: Attachment[];
  backlinks: Backlink[];
  currentNotebookId: string;
  notebookId: string;
  noteId: string;
  noteTitle: string;
  contentMd: string | null;
  createdAt: string;
  updatedAt: string;
  lockedAt: string | null;
  isLocked: boolean;
  namedBlocks: NamedBlockSummary[];
};

type SoftNavigatedDetail = {
  noteId: string;
  noteTitle: string;
  contentMd: string | null;
  createdAt: string;
  updatedAt: string;
  lockedAt: string | null;
  isLocked: boolean;
  tocItems: TocItem[];
  taskProgress: TaskProgress;
  attachments: Attachment[];
  backlinks: Backlink[];
  namedBlocks: NamedBlockSummary[];
};

const namedBlockSnippet = (block: NamedBlockSummary): string => {
  const name = JSON.stringify(block.name);
  switch (block.type) {
    case "table":
      return `const rows = current.table(${name})?.rows ?? [];`;
    case "list":
      return `const items = current.list(${name})?.items ?? [];`;
    case "data":
      return `const data = current.data(${name})?.value ?? {};`;
    case "section":
      return `const markdown = current.section(${name})?.markdown ?? "";`;
    case "script":
      return `// @${block.name} marks a script block. Script blocks are not readable through current.* yet.`;
    default:
      return `// @${block.name} has no typed script helper yet.`;
  }
};

/**
 * Right-side detail panel — outline + backlinks + (edit-mode) online users +
 * actions + note metadata. Single island so the inner sections stay direct
 * children of the same `detail-stack` container; the stack owns inter-section
 * spacing so per-section wrappers do not fight margins.
 *
 * Visibility is controlled via the toolbar's panel-toggle button and the
 * mobile-only "Close panel" action inside the panel.
 *
 * Event flow (all through window CustomEvents, see `events.ts`):
 *  - editor toolbar / readonly footer → DETAIL_PANEL_TOGGLE_EVENT → toggles open
 *  - editor → TOC_UPDATE_EVENT → refresh outline
 *  - editor → PRESENCE_EVENT → refresh online list
 *  - panel → TOC_SCROLL_EVENT → editor scrolls to heading line
 *  - panel → TOGGLE_RICH_MODE_EVENT → editor flips its `richMode` signal
 *  - panel → EDITOR_COPY_EVENT / EDITOR_DOWNLOAD_EVENT → editor uses its
 *    current `ytext` rather than the SSR-time `contentMd` snapshot
 *  - readonly rendering falls back to `contentMd` prop directly (no editor present)
 */
export default function NotebookDetailPanel(props: Props) {
  const [open, setOpen] = createSignal(props.initiallyOpen);
  const [tocItems, setTocItems] = createSignal<TocItem[]>(props.tocItems);
  const [tasks, setTasks] = createSignal<TaskProgress>(props.taskProgress);
  const [noteId, setNoteId] = createSignal(props.noteId);
  const [noteTitle, setNoteTitle] = createSignal(props.noteTitle);
  const [contentMd, setContentMd] = createSignal(props.contentMd);
  const [backlinks, setBacklinks] = createSignal<Backlink[]>(props.backlinks);
  const [createdAt, setCreatedAt] = createSignal(props.createdAt);
  const [updatedAt, setUpdatedAt] = createSignal(props.updatedAt);
  const [lockedAt, setLockedAt] = createSignal(props.lockedAt);
  const [, setIsLocked] = createSignal(props.isLocked);
  const [namedBlocks, setNamedBlocks] = createSignal<NamedBlockSummary[]>(props.namedBlocks);

  // Attachment state: a cache (shortId → Attachment) plus the ordered
  // shortId list of what's currently referenced in the doc. The
  // displayed list is computed from cache ⨯ ids — broken refs (cache
  // miss) are silently dropped. Cache is refreshed lazily when an
  // unknown ID appears in an update event. We key by shortId because
  // that's what `extractAttachmentIds` carries from the markdown body.
  const [attachmentCache, setAttachmentCache] = createSignal<Map<string, Attachment>>(
    new Map(props.attachments.map((a) => [a.shortId, a])),
  );
  const [attachmentIds, setAttachmentIds] = createSignal<string[]>(props.attachments.map((a) => a.shortId));
  const visibleAttachments = (): Attachment[] => {
    const c = attachmentCache();
    const out: Attachment[] = [];
    for (const id of attachmentIds()) {
      const att = c.get(id);
      if (att) out.push(att);
    }
    return out;
  };

  const refetchAttachments = async () => {
    const res = await apiClient[":id"].attachments.$get({ param: { id: props.notebookId } });
    if (!res.ok) return;
    const list = await res.json();
    setAttachmentCache(new Map(list.map((a) => [a.shortId, a])));
  };
  const [participants, setParticipants] = createSignal<NotebookPresenceParticipant[]>([]);
  // Mirrors the editor's richMode signal — kept in sync via window events.
  // Default `true` matches the editor's initial state, so SSR and the first
  // client render agree even if the editor's broadcast hasn't arrived yet.
  const [isRich, setIsRich] = createSignal(true);

  const downloadFilename = () => `${(noteTitle() || "note").trim() || "note"}.md`;

  const toggleOpen = () => {
    const next = !open();
    setOpen(next);
    setDetailPanelOpen(next);
  };

  const closePanel = () => {
    setOpen(false);
    setDetailPanelOpen(false);
  };

  // Broadcast open state so the editor toolbar's toggle button can flip its
  // expand/collapse icon. Fires once on hydration with the initial value, then
  // on every toggle.
  createEffect(() => {
    window.dispatchEvent(new CustomEvent(DETAIL_PANEL_STATE_EVENT, { detail: { isOpen: open() } }));
  });

  const toggleRichMode = () => {
    window.dispatchEvent(new CustomEvent(TOGGLE_RICH_MODE_EVENT));
  };

  const copyContent = () => {
    if (props.mode === "edit") {
      window.dispatchEvent(new CustomEvent(EDITOR_COPY_EVENT));
    } else {
      void clipboard.copy(contentMd() ?? "");
    }
  };

  const downloadContent = () => {
    if (props.mode === "edit") {
      window.dispatchEvent(new CustomEvent(EDITOR_DOWNLOAD_EVENT));
    } else {
      files.downloadFileFromContent(contentMd() ?? "", downloadFilename(), "text/markdown");
    }
  };

  const onTocItemClick = (event: MouseEvent, id: string) => {
    if (props.mode === "read") return;
    event.preventDefault();
    window.dispatchEvent(new CustomEvent(TOC_SCROLL_EVENT, { detail: { id } }));
  };

  const scrollToNamedBlock = (block: NamedBlockSummary) => {
    window.dispatchEvent(new CustomEvent(NAMED_BLOCK_SCROLL_EVENT, { detail: block }));
  };

  const copyNamedBlockSnippet = async (event: MouseEvent, block: NamedBlockSummary) => {
    event.stopPropagation();
    await clipboard.copy(namedBlockSnippet(block));
    toast.success("Reference snippet copied", { title: "Copied", iconClass: "ti ti-clipboard-check" });
  };

  onMount(() => {
    const onTocUpdate = (event: Event) => {
      const detail = (event as CustomEvent<TocItem[]>).detail;
      if (Array.isArray(detail)) setTocItems(detail);
    };
    const onTasksUpdate = (event: Event) => {
      const detail = (event as CustomEvent<TaskProgress>).detail;
      if (detail && typeof detail.done === "number" && typeof detail.total === "number") {
        setTasks(detail);
      }
    };
    const onPresenceUpdate = (event: Event) => {
      const detail = (event as CustomEvent<NotebookPresenceParticipant[]>).detail;
      if (Array.isArray(detail)) setParticipants(detail);
    };
    const onToggle = () => toggleOpen();
    const onRichChange = (event: Event) => {
      const detail = (event as CustomEvent<{ isRich: boolean }>).detail;
      if (typeof detail?.isRich === "boolean") setIsRich(detail.isRich);
    };

    const onAttachmentsUpdate = (event: Event) => {
      const ids = (event as CustomEvent<string[]>).detail ?? [];
      setAttachmentIds(ids);
      // Lazy cache fill: refetch whenever the doc references an id we have
      // no metadata for (e.g. fresh upload, or another client added it).
      if (ids.some((id) => !attachmentCache().has(id))) void refetchAttachments();
    };
    const onNamedBlocksUpdate = (event: Event) => {
      const detail = (event as CustomEvent<NamedBlockSummary[]>).detail;
      if (Array.isArray(detail)) setNamedBlocks(detail);
    };
    const onSoftNavigated = (event: Event) => {
      const detail = (event as CustomEvent<SoftNavigatedDetail>).detail;
      if (!detail?.noteId) return;
      setNoteId(detail.noteId);
      setNoteTitle(detail.noteTitle);
      setContentMd(detail.contentMd);
      setCreatedAt(detail.createdAt);
      setUpdatedAt(detail.updatedAt);
      setLockedAt(detail.lockedAt);
      setIsLocked(detail.isLocked);
      setTocItems(detail.tocItems);
      setTasks(detail.taskProgress);
      setBacklinks(detail.backlinks);
      setAttachmentCache(new Map(detail.attachments.map((a) => [a.shortId, a])));
      setAttachmentIds(detail.attachments.map((a) => a.shortId));
      setNamedBlocks(detail.namedBlocks);
    };

    window.addEventListener(TOC_UPDATE_EVENT, onTocUpdate);
    window.addEventListener(TASKS_UPDATE_EVENT, onTasksUpdate);
    window.addEventListener(ATTACHMENTS_UPDATE_EVENT, onAttachmentsUpdate);
    window.addEventListener(NAMED_BLOCKS_UPDATE_EVENT, onNamedBlocksUpdate);
    window.addEventListener(PRESENCE_EVENT, onPresenceUpdate);
    window.addEventListener(DETAIL_PANEL_TOGGLE_EVENT, onToggle);
    window.addEventListener(RICH_MODE_CHANGED_EVENT, onRichChange);
    window.addEventListener(NOTE_SOFT_NAVIGATED_EVENT, onSoftNavigated);

    onCleanup(() => {
      window.removeEventListener(TOC_UPDATE_EVENT, onTocUpdate);
      window.removeEventListener(TASKS_UPDATE_EVENT, onTasksUpdate);
      window.removeEventListener(ATTACHMENTS_UPDATE_EVENT, onAttachmentsUpdate);
      window.removeEventListener(NAMED_BLOCKS_UPDATE_EVENT, onNamedBlocksUpdate);
      window.removeEventListener(PRESENCE_EVENT, onPresenceUpdate);
      window.removeEventListener(DETAIL_PANEL_TOGGLE_EVENT, onToggle);
      window.removeEventListener(RICH_MODE_CHANGED_EVENT, onRichChange);
      window.removeEventListener(NOTE_SOFT_NAVIGATED_EVENT, onSoftNavigated);
    });
  });

  return (
    <AppWorkspace.Detail open={open()} class="!p-[var(--ui-space-section)]">
      <div class="flex h-full min-h-0 flex-col">
        <header class="detail-header" style="view-transition-name: notebook-detail-panel">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-semibold text-secondary">Note details</span>
            <Tooltip content="Close details">
              <button type="button" class="icon-btn" aria-label="Close note details" onClick={closePanel}>
                <i class="ti ti-x" />
              </button>
            </Tooltip>
          </div>

          <div class="mt-4 flex min-w-0 items-start gap-3">
            <div class="app-accent-text flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--ui-radius-surface)] bg-[var(--ui-selected)]">
              <i class={`ti ${lockedAt() ? "ti-lock" : "ti-file-text"} text-base`} />
            </div>
            <div class="min-w-0 flex-1">
              <h2 class="truncate text-base font-semibold leading-5 text-primary">{noteTitle() || "Untitled"}</h2>
              <p class="mt-1 truncate text-xs text-dimmed">
                {lockedAt() ? "Locked note" : props.mode === "edit" ? "Collaborative note" : "Read-only note"}
              </p>
            </div>
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-1">
            <Show when={props.mode === "edit"}>
              <Tooltip content={isRich() ? "Show Markdown source" : "Show rich text"}>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label={isRich() ? "Show Markdown source" : "Show rich text"}
                  onClick={toggleRichMode}
                >
                  <i class={`ti ${isRich() ? "ti-markdown" : "ti-typography"}`} />
                </button>
              </Tooltip>
            </Show>
            <Tooltip content="Copy content">
              <button type="button" class="icon-btn" aria-label="Copy note content" onClick={copyContent}>
                <i class="ti ti-copy" />
              </button>
            </Tooltip>
            <Tooltip content="Download Markdown">
              <button type="button" class="icon-btn" aria-label="Download note as Markdown" onClick={downloadContent}>
                <i class="ti ti-download" />
              </button>
            </Tooltip>
            <Tooltip content="Version history">
              <a href={buildVersionsUrl(props.notebookId, noteId())} class="icon-btn" aria-label="Open version history">
                <i class="ti ti-history" />
              </a>
            </Tooltip>
            <Tooltip content="Graph view">
              <a href={`/app/notebooks/${props.notebookId}?mode=graph&note=${noteId()}`} class="icon-btn" aria-label="Open graph view">
                <i class="ti ti-affiliate" />
              </a>
            </Tooltip>
          </div>
        </header>

        <div class="detail-stack">
          {/* Contents */}
          <Show when={tocItems().length >= 1}>
            <section class="detail-section">
              <h3 class="detail-section-label">Contents</h3>
              <ul class="flex flex-col">
                <For each={tocItems()}>
                  {(item) => (
                    <li>
                      <a
                        href={`#${item.id}`}
                        class="detail-row hover:text-blue-500 truncate"
                        style={`padding-left:${(item.level - 1) * 0.75}rem`}
                        onClick={(event) => onTocItemClick(event, item.id)}
                      >
                        <span class="shrink-0 text-dimmed font-mono text-[10px]">H{item.level}</span>
                        <span class="truncate">{item.text || "Untitled"}</span>
                      </a>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          </Show>

          {/* Tasks — checklist progress, hidden when the note has no tasks. */}
          <Show when={tasks().total > 0}>
            <section class="detail-section">
              <h3 class="detail-section-label">Tasks</h3>
              <div class="flex items-center justify-between text-xs">
                <span>
                  <span class="text-primary tabular-nums">{tasks().done}</span>
                  <span class="text-dimmed"> of </span>
                  <span class="text-primary tabular-nums">{tasks().total}</span>
                  <span class="text-dimmed"> done</span>
                </span>
                <span class="text-dimmed tabular-nums">{Math.round((tasks().done / Math.max(1, tasks().total)) * 100)}%</span>
              </div>
              <div class="mt-2 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                <div
                  class="h-full bg-emerald-500 dark:bg-emerald-400 transition-[width] duration-200"
                  style={`width: ${(tasks().done / Math.max(1, tasks().total)) * 100}%`}
                />
              </div>
            </section>
          </Show>

          {/* References */}
          <Show when={namedBlocks().length > 0}>
            <section class="detail-section">
              <h3 class="detail-section-label">References</h3>
              <ul class="flex flex-col gap-1">
                <For each={namedBlocks()}>
                  {(block) => (
                    <li class="group flex items-center gap-1 text-xs">
                      <button
                        type="button"
                        class="detail-row min-w-0 flex-1 justify-between hover:text-blue-500"
                        onClick={() => scrollToNamedBlock(block)}
                        title={`Jump to @${block.name}`}
                      >
                        <span class="inline-flex min-w-0 items-center gap-1">
                          <i class="ti ti-at detail-row-icon" />
                          <code class="truncate">{block.name}</code>
                        </span>
                        <span class="text-dimmed capitalize">{block.type}</span>
                      </button>
                      <button
                        type="button"
                        class="icon-btn h-6 w-6 shrink-0 text-dimmed opacity-0 transition-opacity hover:text-primary focus:opacity-100 group-hover:opacity-100"
                        onClick={(event) => void copyNamedBlockSnippet(event, block)}
                        title={`Copy script snippet for @${block.name}`}
                        aria-label={`Copy script snippet for ${block.name}`}
                      >
                        <i class="ti ti-copy text-xs" />
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          </Show>

          {/* Attachments — files & images referenced from this note. Click a
          row → download confirm modal. Deletion lives on the dedicated
          attachments overview page. */}
          <Show when={visibleAttachments().length > 0}>
            <section class="detail-section">
              <h3 class="detail-section-label">Attachments</h3>
              <ul class="flex flex-col">
                <For each={visibleAttachments()}>
                  {(att) => (
                    <li>
                      <button
                        type="button"
                        onClick={() => void confirmAndDownload(att.filename, buildAttachmentContentUrl(props.notebookId, att.shortId))}
                        class="list-item w-full !px-2 !py-1.5 text-left text-xs"
                        title={att.filename}
                      >
                        <i
                          class={`ti ${fileIcons.getFileIcon({ name: att.filename, type: "file", mimeType: att.mimeType })} text-sm shrink-0`}
                        />
                        <span class="flex-1 truncate">{att.filename}</span>
                        <span class="text-dimmed tabular-nums shrink-0">{formatBytes(att.sizeBytes)}</span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          </Show>

          {/* Backlinks */}
          <Show when={backlinks().length > 0}>
            <section class="detail-section">
              <h3 class="detail-section-label">Linked by</h3>
              <ul class="flex flex-col">
                <For each={backlinks()}>
                  {(bl) => {
                    const showNotebook = bl.notebookShortId !== props.currentNotebookId;
                    return (
                      <li>
                        <a href={`/app/notebooks/${bl.notebookShortId}/notes/${bl.noteShortId}`} class="detail-row hover:text-blue-500">
                          <i class="ti ti-file-text detail-row-icon" />
                          <span class="truncate">{bl.title || "Untitled"}</span>
                          {showNotebook && (
                            <span class="text-dimmed text-[11px] ml-auto truncate flex items-center gap-1">
                              <i class="ti ti-notebook" />
                              {bl.notebookName}
                            </span>
                          )}
                        </a>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </section>
          </Show>

          {/* Online (edit mode only — readonly rendering has no presence connection) */}
          <Show when={props.mode === "edit" && participants().length > 0}>
            <section class="detail-section">
              <h3 class="detail-section-label">Online · {participants().length}</h3>
              <ul class="flex flex-col">
                <For each={participants()}>
                  {(p) => (
                    <li class="detail-row">
                      <span class="w-2 h-2 rounded-full shrink-0 detail-row-icon" style={`background:${p.color}`} />
                      <span class="truncate">{p.displayName}</span>
                      {p.peerCount > 1 && <span class="text-dimmed text-[11px] ml-auto">{p.peerCount} tabs</span>}
                    </li>
                  )}
                </For>
              </ul>
            </section>
          </Show>

          {/* Info — always renders (a note always has created/updated). */}
          <section class="detail-section">
            <h3 class="detail-section-label">Info</h3>
            <dl class="detail-facts">
              <dt class="detail-fact-key">Created</dt>
              <dd>{dates.formatDateTimeRelative(createdAt())}</dd>
              <dt class="detail-fact-key">Updated</dt>
              <dd>{dates.formatDateTimeRelative(updatedAt())}</dd>
              {lockedAt() && (
                <>
                  <dt class="detail-fact-key">Locked</dt>
                  <dd class="text-amber-600 dark:text-amber-400">{dates.formatDateTimeRelative(lockedAt()!)}</dd>
                </>
              )}
            </dl>
          </section>
        </div>
      </div>
    </AppWorkspace.Detail>
  );
}

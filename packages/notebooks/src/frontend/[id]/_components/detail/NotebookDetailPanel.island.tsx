import { dates } from "@valentinkolb/stdlib";
import { clipboard, files } from "@valentinkolb/stdlib/browser";
import type { NotebookPresenceParticipant } from "@valentinkolb/cloud/contracts";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Backlink } from "../../../../service/links";
import { buildNoteUrl, buildReadUrl, buildVersionsUrl } from "../../../params";
import { setDetailPanelOpen } from "../settings/NotebookSettingsStore";
import {
  DETAIL_PANEL_STATE_EVENT,
  DETAIL_PANEL_TOGGLE_EVENT,
  EDITOR_COPY_EVENT,
  EDITOR_DOWNLOAD_EVENT,
  PRESENCE_EVENT,
  RICH_MODE_CHANGED_EVENT,
  TOC_SCROLL_EVENT,
  TOC_UPDATE_EVENT,
  TOGGLE_RICH_MODE_EVENT,
} from "./events";
import type { TocItem } from "./toc";

type Props = {
  mode: "edit" | "read";
  initiallyOpen: boolean;
  tocItems: TocItem[];
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
};

const ACTION_BTN = "btn-simple btn-sm justify-start gap-2 px-2 text-xs text-dimmed hover:text-primary";

/**
 * Right-side detail panel — outline + backlinks + (edit-mode) online users +
 * actions + note metadata. Single island so the inner sections stay direct
 * children of the same flex container; `detail-section`'s `mt-2 first:mt-0`
 * convention then handles inter-section spacing the way `frontend.md`
 * documents (no `gap-*` needed, no per-section `<solid-island>` wrappers
 * fighting `:first-child`).
 *
 * Visibility is closed via the toolbar's panel-toggle button; there is no
 * close button inside the panel itself — that's intentional and lets the
 * sections live edge-to-edge without a header bar.
 *
 * Event flow (all through window CustomEvents, see `events.ts`):
 *  - editor toolbar / readonly footer → DETAIL_PANEL_TOGGLE_EVENT → toggles open
 *  - editor → TOC_UPDATE_EVENT → refresh outline
 *  - editor → PRESENCE_EVENT → refresh online list
 *  - panel → TOC_SCROLL_EVENT → editor scrolls to heading line
 *  - panel → TOGGLE_RICH_MODE_EVENT → editor flips its `richMode` signal
 *  - panel → EDITOR_COPY_EVENT / EDITOR_DOWNLOAD_EVENT → editor uses its
 *    current `ytext` rather than the SSR-time `contentMd` snapshot
 *  - read mode falls back to `contentMd` prop directly (no editor present)
 */
export default function NotebookDetailPanel(props: Props) {
  const [open, setOpen] = createSignal(props.initiallyOpen);
  const [tocItems, setTocItems] = createSignal<TocItem[]>(props.tocItems);
  const [participants, setParticipants] = createSignal<NotebookPresenceParticipant[]>([]);
  // Mirrors the editor's richMode signal — kept in sync via window events.
  // Default `true` matches the editor's initial state, so SSR and the first
  // client render agree even if the editor's broadcast hasn't arrived yet.
  const [isRich, setIsRich] = createSignal(true);

  const downloadFilename = () => `${(props.noteTitle || "note").trim() || "note"}.md`;

  const toggleOpen = () => {
    const next = !open();
    setOpen(next);
    setDetailPanelOpen(next);
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
      void clipboard.copy(props.contentMd ?? "");
    }
  };

  const downloadContent = () => {
    if (props.mode === "edit") {
      window.dispatchEvent(new CustomEvent(EDITOR_DOWNLOAD_EVENT));
    } else {
      files.downloadFileFromContent(props.contentMd ?? "", downloadFilename(), "text/markdown");
    }
  };

  const onTocItemClick = (event: MouseEvent, id: string) => {
    if (props.mode === "read") return;
    event.preventDefault();
    window.dispatchEvent(new CustomEvent(TOC_SCROLL_EVENT, { detail: { id } }));
  };

  onMount(() => {
    const onTocUpdate = (event: Event) => {
      const detail = (event as CustomEvent<TocItem[]>).detail;
      if (Array.isArray(detail)) setTocItems(detail);
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

    window.addEventListener(TOC_UPDATE_EVENT, onTocUpdate);
    window.addEventListener(PRESENCE_EVENT, onPresenceUpdate);
    window.addEventListener(DETAIL_PANEL_TOGGLE_EVENT, onToggle);
    window.addEventListener(RICH_MODE_CHANGED_EVENT, onRichChange);

    onCleanup(() => {
      window.removeEventListener(TOC_UPDATE_EVENT, onTocUpdate);
      window.removeEventListener(PRESENCE_EVENT, onPresenceUpdate);
      window.removeEventListener(DETAIL_PANEL_TOGGLE_EVENT, onToggle);
      window.removeEventListener(RICH_MODE_CHANGED_EVENT, onRichChange);
    });
  });

  return (
    <aside
      class={`${open() ? "flex" : "hidden"} order-3 flex-col min-h-0 overflow-y-auto w-full shrink-0 lg:h-full lg:w-[20rem] xl:w-[24rem]`}
    >
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

      {/* Backlinks */}
      <Show when={props.backlinks.length > 0}>
        <section class="detail-section">
          <h3 class="detail-section-label">Linked by</h3>
          <ul class="flex flex-col">
            <For each={props.backlinks}>
              {(bl) => {
                const showNotebook = bl.notebookId !== props.currentNotebookId;
                return (
                  <li>
                    <a href={`/app/notebooks/${bl.notebookId}?note=${bl.noteId}`} class="detail-row hover:text-blue-500">
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

      {/* Online (edit mode only — read mode has no presence connection) */}
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

      {/* Actions */}
      <section class="detail-section">
        <h3 class="detail-section-label">Actions</h3>
        <div class="flex flex-col gap-0.5">
          <Show when={props.mode === "edit"}>
            <button type="button" class={ACTION_BTN} onClick={toggleRichMode}>
              <i class={`ti ${isRich() ? "ti-markdown" : "ti-typography"}`} />
              <span>{isRich() ? "Markdown source" : "Rich text mode"}</span>
            </button>
          </Show>

          {props.mode === "edit" ? (
            <a href={buildReadUrl(props.notebookId, props.noteId)} class={ACTION_BTN}>
              <i class="ti ti-eye" />
              <span>Read view</span>
            </a>
          ) : !props.isLocked ? (
            <a href={buildNoteUrl(props.notebookId, props.noteId)} class={ACTION_BTN}>
              <i class="ti ti-pencil" />
              <span>Edit</span>
            </a>
          ) : null}

          <button type="button" class={ACTION_BTN} onClick={copyContent}>
            <i class="ti ti-clipboard" />
            <span>Copy content</span>
          </button>

          <button type="button" class={ACTION_BTN} onClick={downloadContent}>
            <i class="ti ti-download" />
            <span>Download as .md</span>
          </button>

          <a href={buildVersionsUrl(props.notebookId, props.noteId)} class={ACTION_BTN}>
            <i class="ti ti-history" />
            <span>Version history</span>
          </a>
        </div>
      </section>

      {/* Info — always renders (a note always has created/updated). */}
      <section class="detail-section">
        <h3 class="detail-section-label">Info</h3>
        <dl class="detail-facts">
          <dt class="detail-fact-key">Created</dt>
          <dd>{dates.formatDateTimeRelative(props.createdAt)}</dd>
          <dt class="detail-fact-key">Updated</dt>
          <dd>{dates.formatDateTimeRelative(props.updatedAt)}</dd>
          {props.lockedAt && (
            <>
              <dt class="detail-fact-key">Locked</dt>
              <dd class="text-amber-600 dark:text-amber-400">{dates.formatDateTimeRelative(props.lockedAt)}</dd>
            </>
          )}
        </dl>
      </section>
    </aside>
  );
}

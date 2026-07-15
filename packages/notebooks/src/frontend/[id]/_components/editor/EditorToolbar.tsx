import { Prec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { keymap } from "@codemirror/view";
import { Dropdown } from "@valentinkolb/cloud/ui";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { requestNotebookSearch } from "../../../lib/hotkeys";
import { DETAIL_PANEL_STATE_EVENT, DETAIL_PANEL_TOGGLE_EVENT } from "../detail/events";
import { openAttachmentPicker } from "./AttachmentPicker";
import { cycleHeading, insertCallout, insertLinePrefix, insertLink, insertNoteLink, insertTable, wrapSelection } from "./editor-actions";

type Props = {
  connected: boolean;
  editorView: EditorView | undefined;
  notebookId: string;
  /** Initial open state for the detail panel — kept in sync at runtime via
   *  `DETAIL_PANEL_STATE_EVENT`. Used to seed the toggle button's icon so SSR
   *  output matches the eventual hydrated state (no flicker). */
  initialPanelOpen: boolean;
};

/* ── Formatting keymap (Ctrl/Cmd shortcuts) ────────────── */

export function formattingKeymap(opts: { notebookId: string }) {
  return Prec.high(
    keymap.of([
      {
        key: "Mod-Shift-k",
        run: () => {
          requestNotebookSearch();
          return true;
        },
      },
      {
        key: "Mod-b",
        run: (view) => {
          wrapSelection(view, "**");
          return true;
        },
      },
      {
        key: "Mod-i",
        run: (view) => {
          wrapSelection(view, "_");
          return true;
        },
      },
      {
        key: "Mod-Shift-s",
        run: (view) => {
          wrapSelection(view, "~~");
          return true;
        },
      },
      {
        key: "Mod-e",
        run: (view) => {
          wrapSelection(view, "`");
          return true;
        },
      },
      {
        key: "Mod-k",
        run: (view) => {
          insertLink(view);
          return true;
        },
      },
      {
        key: "Mod-Alt-k",
        run: (view) => {
          void insertNoteLink(view, opts.notebookId);
          return true;
        },
      },
      {
        key: "Mod-Shift-h",
        run: (view) => {
          cycleHeading(view);
          return true;
        },
      },
    ]),
  );
}

/* ── Component ─────────────────────────────────────────── */

export default function EditorToolbar(props: Props) {
  const withView = (action: (view: EditorView) => void) => () => {
    if (props.editorView) action(props.editorView);
  };

  const bold = withView((v) => wrapSelection(v, "**"));
  const italic = withView((v) => wrapSelection(v, "_"));
  const strikethrough = withView((v) => wrapSelection(v, "~~"));
  const inlineCode = withView((v) => wrapSelection(v, "`"));
  const heading = withView(cycleHeading);
  const link = withView(insertLink);
  const linkToNote = withView((v) => void insertNoteLink(v, props.notebookId));
  const bulletList = withView((v) => insertLinePrefix(v, "- "));
  const numberedList = withView((v) => insertLinePrefix(v, "1. "));
  const checkbox = withView((v) => insertLinePrefix(v, "- [ ] "));
  const callout = (type: string) => withView((v) => insertCallout(v, type));
  const table = withView((v) => void insertTable(v));

  const [panelOpen, setPanelOpen] = createSignal(props.initialPanelOpen);
  const [showDisconnected, setShowDisconnected] = createSignal(false);
  let disconnectedTimer: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    clearTimeout(disconnectedTimer);
    if (props.connected) {
      setShowDisconnected(false);
      return;
    }
    disconnectedTimer = setTimeout(() => setShowDisconnected(true), 1_000);
  });

  onMount(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ isOpen: boolean }>).detail;
      if (typeof detail?.isOpen === "boolean") setPanelOpen(detail.isOpen);
    };
    window.addEventListener(DETAIL_PANEL_STATE_EVENT, handler);
    onCleanup(() => {
      clearTimeout(disconnectedTimer);
      window.removeEventListener(DETAIL_PANEL_STATE_EVENT, handler);
    });
  });

  const toggleDetailPanel = () => window.dispatchEvent(new CustomEvent(DETAIL_PANEL_TOGGLE_EVENT));

  const Btn = (p: { icon: string; title: string; onClick: () => void }) => (
    <button type="button" title={p.title} aria-label={p.title} onClick={p.onClick} class="icon-btn h-7 w-7 text-dimmed">
      <i class={`ti ${p.icon}`} />
    </button>
  );

  return (
    <div class="mt-1 flex min-w-0 items-center gap-2 px-2 py-2 text-base text-dimmed">
      <div class="no-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
        <Btn icon="ti-bold" title="Bold" onClick={bold} />
        <Btn icon="ti-italic" title="Italic" onClick={italic} />
        <Btn icon="ti-strikethrough" title="Strikethrough" onClick={strikethrough} />
        <Btn icon="ti-heading" title="Heading" onClick={heading} />
        <Btn icon="ti-link" title="Link" onClick={link} />
        <Btn icon="ti-file-symlink" title="Link to note (Mod+Alt+K)" onClick={linkToNote} />
        <Btn icon="ti-paperclip" title="Attach file or image" onClick={() => void openAttachmentPicker(props.notebookId)} />

        <Dropdown
          trigger={
            <span title="Insert" class="icon-btn flex h-7 w-7 items-center gap-0.5 text-dimmed">
              <i class="ti ti-layout-grid-add" />
              <i class="ti ti-chevron-down text-[10px]" />
            </span>
          }
          position="top-right"
          width="w-52"
          elements={[
            {
              sectionLabel: "Lists",
              items: [
                { icon: "ti ti-list", label: "Bullet List", action: bulletList },
                { icon: "ti ti-list-numbers", label: "Numbered List", action: numberedList },
                { icon: "ti ti-checkbox", label: "Checkbox", action: checkbox },
              ],
            },
            {
              sectionLabel: "Blocks",
              items: [
                { icon: "ti ti-chevron-right", label: "Note", action: callout("note") },
                { icon: "ti ti-info-circle", label: "Info", action: callout("info") },
                { icon: "ti ti-check", label: "Success", action: callout("success") },
                { icon: "ti ti-alert-circle", label: "Warning", action: callout("warning") },
                { icon: "ti ti-alert-hexagon", label: "Danger", action: callout("danger") },
              ],
            },
            {
              sectionLabel: "Misc",
              items: [
                { icon: "ti ti-table", label: "Table", action: table },
                { icon: "ti ti-code", label: "Inline Code", action: inlineCode },
              ],
            },
          ]}
        />
      </div>

      <Show when={showDisconnected()}>
        <span class="flex shrink-0 items-center gap-1 text-xs" role="status">
          <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
          Reconnecting...
        </span>
      </Show>

      {/* Detail panel toggle */}
      <Btn
        icon={panelOpen() ? "ti-layout-sidebar-right-collapse" : "ti-layout-sidebar-right-expand"}
        title={panelOpen() ? "Collapse detail panel" : "Expand detail panel"}
        onClick={toggleDetailPanel}
      />
    </div>
  );
}

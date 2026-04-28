import { Prec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { keymap } from "@codemirror/view";
import type { NotebookPresenceParticipant } from "@valentinkolb/cloud/contracts";
import { Dropdown, prompts } from "@valentinkolb/cloud/ui";
import { createSignal, For } from "solid-js";
import { requestNotebookSearch } from "../../../lib/hotkeys";
import { navigateTo } from "@valentinkolb/cloud/ui";
import { buildReadUrl, buildVersionsUrl } from "../../../params";

type Props = {
  connected: boolean;
  participants: NotebookPresenceParticipant[];
  editorView: EditorView | undefined;
  richMode: boolean;
  onToggleRichMode: () => void;
  notebookId: string;
  noteId: string;
};

/* ── Markdown helpers ──────────────────────────────────── */

function wrapSelection(view: EditorView, mark: string) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const ml = mark.length;

  // Case 1: selected text itself starts and ends with the mark → unwrap inside
  if (selected.startsWith(mark) && selected.endsWith(mark) && selected.length >= ml * 2) {
    view.dispatch({
      changes: { from, to, insert: selected.slice(ml, -ml) },
    });
    view.focus();
    return;
  }

  // Case 2: marks exist around the selection in the document → unwrap outside
  const before = view.state.sliceDoc(Math.max(0, from - ml), from);
  const after = view.state.sliceDoc(to, to + ml);
  if (before === mark && after === mark) {
    view.dispatch({
      changes: { from: from - ml, to: to + ml, insert: selected },
      selection: { anchor: from - ml, head: to - ml },
    });
    view.focus();
    return;
  }

  // Default: wrap selection with marks
  view.dispatch({
    changes: { from, to, insert: `${mark}${selected}${mark}` },
    selection: { anchor: from + ml, head: to + ml },
  });
  view.focus();
}

function insertLinePrefix(view: EditorView, prefix: string) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  view.dispatch({
    changes: { from: line.from, to: line.from, insert: prefix },
  });
  view.focus();
}

function cycleHeading(view: EditorView) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const match = line.text.match(/^(#{1,4})\s/);

  if (match) {
    const level = match[1]!.length;
    const replacement = level < 4 ? "#".repeat(level + 1) + " " : "";
    view.dispatch({
      changes: {
        from: line.from,
        to: line.from + level + 1,
        insert: replacement,
      },
    });
  } else {
    view.dispatch({
      changes: { from: line.from, to: line.from, insert: "# " },
    });
  }
  view.focus();
}

function insertBlock(view: EditorView, block: string) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const prefix = line.text.trim() ? "\n\n" : "";
  view.dispatch({ changes: { from: line.to, insert: prefix + block + "\n" } });
  view.focus();
}

function buildTable(rows: number, cols: number): string {
  const header = "| " + Array.from({ length: cols }, (_, i) => `Header ${i + 1}`).join(" | ") + " |";
  const sep = "| " + Array.from({ length: cols }, () => "---").join(" | ") + " |";
  const body = Array.from({ length: rows }, () => "| " + Array.from({ length: cols }, () => "   ").join(" | ") + " |").join("\n");
  return `${header}\n${sep}\n${body}`;
}

function insertLink(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const insert = `[${selected || "Text"}](url)`;
  view.dispatch({
    changes: { from, to, insert },
    selection: {
      anchor: from + (selected || "Text").length + 2,
      head: from + insert.length - 1,
    },
  });
  view.focus();
}

/* ── Formatting keymap (Ctrl/Cmd shortcuts) ────────────── */

export function formattingKeymap() {
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
  const [copied, setCopied] = createSignal(false);

  const getContent = () => props.editorView?.state.doc.toString() ?? "";

  const copyContent = () => {
    navigator.clipboard.writeText(getContent()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const downloadContent = () => {
    const blob = new Blob([getContent()], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "note.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  const bold = () => props.editorView && wrapSelection(props.editorView, "**");
  const italic = () => props.editorView && wrapSelection(props.editorView, "_");
  const strikethrough = () => props.editorView && wrapSelection(props.editorView, "~~");
  const inlineCode = () => props.editorView && wrapSelection(props.editorView, "`");
  const heading = () => props.editorView && cycleHeading(props.editorView);
  const link = () => props.editorView && insertLink(props.editorView);
  const bulletList = () => props.editorView && insertLinePrefix(props.editorView, "- ");
  const numberedList = () => props.editorView && insertLinePrefix(props.editorView, "1. ");
  const checkbox = () => props.editorView && insertLinePrefix(props.editorView, "- [ ] ");

  const insertInfoBlock = (type: string) => {
    if (!props.editorView) return;
    insertBlock(props.editorView, `:::${type}\n\n:::`);
  };

  const insertTable = async () => {
    const view = props.editorView;
    if (!view) return;

    const result = await prompts.form({
      title: "Insert Table",
      icon: "ti ti-table",
      fields: {
        rows: {
          type: "number",
          label: "Rows",
          default: 3,
          min: 1,
          max: 50,
          required: true,
        },
        cols: {
          type: "number",
          label: "Columns",
          default: 3,
          min: 1,
          max: 20,
          required: true,
        },
      },
    });

    if (!result) return;
    insertBlock(view, buildTable(result.rows, result.cols));
  };

  const Btn = (p: { icon: string; title: string; onClick: () => void }) => (
    <button title={p.title} onClick={p.onClick} class="hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">
      <i class={`ti ${p.icon}`} />
    </button>
  );

  const showOnlineParticipants = async () => {
    if (props.participants.length === 0) return;

    await prompts.dialog(
      () => (
        <div class="flex flex-col gap-3">
          <div class="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            <For each={props.participants}>
              {(participant) => (
                <div class="flex items-center justify-between gap-3 py-2">
                  <span class="text-sm text-primary">{participant.displayName}</span>
                  <span class="text-xs text-dimmed">{participant.peerCount > 1 ? `${participant.peerCount} tabs` : "1 tab"}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      ),
      {
        title: `${props.participants.length} Participants`,
        icon: props.participants.length > 1 ? "ti ti-users" : "ti ti-user",
      },
    );
  };

  return (
    <div class="mt-1 flex items-center gap-3 px-2 py-2 text-base text-dimmed">
      {/* Text formatting */}
      <Btn icon="ti-bold" title="Bold" onClick={bold} />
      <Btn icon="ti-italic" title="Italic" onClick={italic} />
      <Btn icon="ti-strikethrough" title="Strikethrough" onClick={strikethrough} />
      <Btn icon="ti-heading" title="Heading" onClick={heading} />
      <Btn icon="ti-link" title="Link" onClick={link} />

      {/* Insert dropdown — Lists, Info Blocks, Table */}
      <Dropdown
        trigger={
          <span title="Insert" class="hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors flex items-center gap-1">
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
              {
                icon: "ti ti-list-numbers",
                label: "Numbered List",
                action: numberedList,
              },
              { icon: "ti ti-checkbox", label: "Checkbox", action: checkbox },
            ],
          },
          {
            sectionLabel: "Blocks",
            items: [
              {
                icon: "ti ti-chevron-right",
                label: "Note",
                action: () => insertInfoBlock("note"),
              },
              {
                icon: "ti ti-info-circle",
                label: "Info",
                action: () => insertInfoBlock("info"),
              },
              {
                icon: "ti ti-check",
                label: "Success",
                action: () => insertInfoBlock("success"),
              },
              {
                icon: "ti ti-alert-circle",
                label: "Warning",
                action: () => insertInfoBlock("warning"),
              },
              {
                icon: "ti ti-alert-hexagon",
                label: "Danger",
                action: () => insertInfoBlock("danger"),
              },
            ],
          },
          {
            sectionLabel: "Misc",
            items: [
              { icon: "ti ti-table", label: "Table", action: insertTable },
              { icon: "ti ti-code", label: "Inline Code", action: inlineCode },
            ],
          },
        ]}
      />

      {/* Rich/Markdown toggle */}
      <Btn
        icon={props.richMode ? "ti-markdown" : "ti-pencil"}
        title={props.richMode ? "Show Markdown" : "Show Formatted"}
        onClick={props.onToggleRichMode}
      />

      {/* Read Mode button */}
      <a
        href={buildReadUrl(props.notebookId, props.noteId)}
        title="Read Mode"
        class="hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
      >
        <i class="ti ti-eye" />
      </a>

      {/* Spacer */}
      <div class="flex-1" />

      {/* Status */}
      <span class="flex items-center gap-1 text-xs">
        <span class={`w-1.5 h-1.5 rounded-full ${props.connected ? "bg-emerald-500" : "bg-amber-500 animate-pulse"}`} />
        {props.connected ? "Connected" : "Reconnecting..."}
      </span>

      {props.participants.length > 0 && (
        <button
          type="button"
          onClick={showOnlineParticipants}
          class="flex items-center gap-1 text-xs hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
          title="Show online participants"
        >
          <span class="flex items-center gap-1">
            <i class={`ti ${props.participants.length > 1 ? "ti-users" : "ti-user"}`} />
            {props.participants.length}
          </span>
        </button>
      )}

      {/* Actions dropdown — far right */}
      <Dropdown
        trigger={
          <span title="Actions" class="hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">
            <i class="ti ti-dots-vertical" />
          </span>
        }
        position="top-left"
        width="w-48"
        elements={[
          {
            icon: copied() ? "ti ti-check" : "ti ti-clipboard",
            label: "Copy Content",
            action: copyContent,
          },
          {
            icon: "ti ti-download",
            label: "Download as .md",
            action: downloadContent,
          },
          {
            icon: "ti ti-history",
            label: "Version History",
            action: () => {
              navigateTo(buildVersionsUrl(props.notebookId, props.noteId));
            },
          },
        ]}
      />
    </div>
  );
}

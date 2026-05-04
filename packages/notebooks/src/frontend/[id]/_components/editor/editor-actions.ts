import type { EditorView } from "@codemirror/view";
import { prompts } from "@valentinkolb/cloud/ui";
import { openNoteLinkPrompt } from "../search/openNoteSearchPrompt";

/**
 * Editor-level actions used by the toolbar AND the slash-command palette.
 *
 * Pure DOM-aware operations on a `EditorView` — no SolidJS state. Some
 * actions open prompts (`prompts.form`, `openNoteLinkPrompt`) which are
 * async; the editor stays non-modal while a prompt is open, so callers
 * should treat the editor's selection as a snapshot from before the prompt.
 */

// ==========================
// Inline marks
// ==========================

/**
 * Toggle a markdown wrap mark (e.g. `**`, `_`, `~~`, `` ` ``) around the
 * current selection. Detects an already-wrapped selection (inside or outside
 * the marks) and unwraps in that case.
 */
export const wrapSelection = (view: EditorView, mark: string): void => {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const markLen = mark.length;

  // Case 1: selected text itself starts and ends with the mark → unwrap inside
  if (selected.startsWith(mark) && selected.endsWith(mark) && selected.length >= markLen * 2) {
    view.dispatch({ changes: { from, to, insert: selected.slice(markLen, -markLen) } });
    view.focus();
    return;
  }

  // Case 2: marks exist around the selection in the document → unwrap outside
  const before = view.state.sliceDoc(Math.max(0, from - markLen), from);
  const after = view.state.sliceDoc(to, to + markLen);
  if (before === mark && after === mark) {
    view.dispatch({
      changes: { from: from - markLen, to: to + markLen, insert: selected },
      selection: { anchor: from - markLen, head: to - markLen },
    });
    view.focus();
    return;
  }

  // Default: wrap selection
  view.dispatch({
    changes: { from, to, insert: `${mark}${selected}${mark}` },
    selection: { anchor: from + markLen, head: to + markLen },
  });
  view.focus();
};

// ==========================
// Headings
// ==========================

const HEADING_PREFIX_REGEX = /^(#{1,6})\s/;

/**
 * Cycle the current line's heading level (no heading → H1 → H2 → H3 → H4 →
 * no heading). Used by the toolbar's heading button.
 */
export const cycleHeading = (view: EditorView): void => {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const match = line.text.match(/^(#{1,4})\s/);

  if (match) {
    const level = match[1]!.length;
    const replacement = level < 4 ? "#".repeat(level + 1) + " " : "";
    view.dispatch({ changes: { from: line.from, to: line.from + level + 1, insert: replacement } });
  } else {
    view.dispatch({ changes: { from: line.from, to: line.from, insert: "# " } });
  }
  view.focus();
};

/**
 * Set the current line's heading to a specific level (1–6). Replaces any
 * existing heading prefix; inserts at line start otherwise. Used by slash
 * commands where the user picked a specific level (`/h1`, `/h2`, …).
 */
export const setHeading = (view: EditorView, level: number): void => {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const prefix = `${"#".repeat(level)} `;
  const match = line.text.match(HEADING_PREFIX_REGEX);
  const replaceTo = match ? line.from + match[0].length : line.from;

  view.dispatch({
    changes: { from: line.from, to: replaceTo, insert: prefix },
    selection: { anchor: line.from + prefix.length },
  });
  view.focus();
};

// ==========================
// Line prefixes (lists, quotes)
// ==========================

/**
 * Insert a per-line prefix (`- `, `1. `, `- [ ] `, `> `) at the current
 * line start. Existing line content is preserved; cursor stays where it was
 * (CodeMirror remaps it through the change).
 *
 * Toolbar-oriented: the user clicked while editing mid-line and wants the
 * caret to remain on the same word. For empty-line cases (slash commands)
 * use `insertAtCursor` instead, which explicitly advances the caret past
 * the inserted text.
 */
export const insertLinePrefix = (view: EditorView, prefix: string): void => {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  view.dispatch({ changes: { from: line.from, to: line.from, insert: prefix } });
  view.focus();
};

/**
 * Insert plain text AT the current caret and place the caret right after
 * the inserted text. Use this from slash commands where the line is empty
 * (the `/<name>` was just stripped by the apply handler) and the caret
 * must end up *past* the new content — CM's default cursor mapping leaves
 * the caret BEFORE an at-cursor insertion.
 */
export const insertAtCursor = (view: EditorView, text: string): void => {
  const { from } = view.state.selection.main;
  view.dispatch({
    changes: { from, insert: text },
    selection: { anchor: from + text.length },
  });
  view.focus();
};

// ==========================
// Block insertion
// ==========================

/**
 * Append a multi-line block after the current line. Adds a blank-line
 * separator if the current line is non-empty so the block doesn't fuse into
 * the preceding paragraph.
 */
export const insertBlock = (view: EditorView, block: string): void => {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const separator = line.text.trim() ? "\n\n" : "";
  view.dispatch({ changes: { from: line.to, insert: separator + block + "\n" } });
  view.focus();
};

/**
 * Insert a fenced code block at the current line and place the cursor on
 * the empty line between the fences, ready for typing.
 */
export const insertCodeBlock = (view: EditorView): void => {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const separator = line.text.trim() ? "\n\n" : "";
  const opening = "```\n";
  const closing = "\n```";
  const insert = `${separator}${opening}${closing}\n`;
  view.dispatch({
    changes: { from: line.to, insert },
    selection: { anchor: line.to + separator.length + opening.length },
  });
  view.focus();
};

/**
 * Insert a `:::<type>` callout / info block and place the cursor on the
 * empty line between the markers.
 */
export const insertCallout = (view: EditorView, type: string): void => {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const separator = line.text.trim() ? "\n\n" : "";
  const opening = `:::${type}\n`;
  const closing = "\n:::";
  const insert = `${separator}${opening}${closing}\n`;
  view.dispatch({
    changes: { from: line.to, insert },
    selection: { anchor: line.to + separator.length + opening.length },
  });
  view.focus();
};

// ==========================
// Tables
// ==========================

/** Build a markdown table skeleton with placeholder headers. */
export const buildTable = (rows: number, cols: number): string => {
  const header = `| ${Array.from({ length: cols }, (_, i) => `Header ${i + 1}`).join(" | ")} |`;
  const sep = `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`;
  const body = Array.from(
    { length: rows },
    () => `| ${Array.from({ length: cols }, () => "   ").join(" | ")} |`,
  ).join("\n");
  return `${header}\n${sep}\n${body}`;
};

/**
 * Prompt the user for table dimensions, then insert.
 *
 * After the table is in the document, the caret pre-selects the first
 * header cell's placeholder text (`Header 1`) so the user can start
 * typing immediately to replace it.
 */
export const insertTable = async (view: EditorView): Promise<void> => {
  const result = await prompts.form({
    title: "Insert Table",
    icon: "ti ti-table",
    fields: {
      rows: { type: "number", label: "Rows", default: 3, min: 1, max: 50, required: true },
      cols: { type: "number", label: "Columns", default: 3, min: 1, max: 20, required: true },
    },
  });
  if (!result) return;

  const block = buildTable(result.rows, result.cols);
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const separator = line.text.trim() ? "\n\n" : "";
  const insert = `${separator}${block}\n`;
  const insertStart = line.to;
  const header1 = "Header 1";
  const header1Offset = insert.indexOf(header1);

  view.dispatch({
    changes: { from: insertStart, insert },
    selection:
      header1Offset >= 0
        ? {
            anchor: insertStart + header1Offset,
            head: insertStart + header1Offset + header1.length,
          }
        : { anchor: insertStart + insert.length },
  });
  view.focus();
};

// ==========================
// Links
// ==========================

/**
 * Insert a `[Text](url)` template at the cursor (or wrap the current
 * selection as link text). Selects the URL placeholder so the user can type
 * over it directly.
 */
export const insertLink = (view: EditorView): void => {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const linkText = selected || "Text";
  const insert = `[${linkText}](url)`;
  view.dispatch({
    changes: { from, to, insert },
    selection: {
      anchor: from + linkText.length + 2,
      head: from + insert.length - 1,
    },
  });
  view.focus();
};

/**
 * Open the note picker and insert a markdown link to the chosen note.
 * Selected text becomes the link text; otherwise the picked note's title is
 * used.
 *
 * Yjs collab note: while the picker is open the editor is non-modal — a
 * concurrent edit by another peer could shift the captured selection by
 * the time we dispatch. Accepted tradeoff for KISS (user can ctrl+z).
 */
export const insertNoteLink = async (view: EditorView, notebookId: string): Promise<void> => {
  const sel = view.state.selection.main;
  const selectedText = view.state.sliceDoc(sel.from, sel.to);

  const picked = await openNoteLinkPrompt(notebookId);
  if (!picked) return;

  const linkText = selectedText.length > 0 ? selectedText : picked.title;
  const url = `/app/notebooks/${notebookId}?note=${picked.id}`;
  const insert = `[${linkText}](${url})`;

  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: { anchor: sel.from + insert.length },
  });
  view.focus();
};

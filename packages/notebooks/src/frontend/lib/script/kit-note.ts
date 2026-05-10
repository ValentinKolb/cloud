/**
 * `kit.note` — the current note. Read getters reflect live state in
 * edit-mode (via Y.Text) and the snapshot in read-mode. Write methods
 * mutate Y.Text directly when available; in read-mode they throw.
 *
 * Tag + task extraction reuses the same regexes as the rest of the
 * platform (notebook tag pills, sidebar task counter) so what
 * `kit.note.tags` returns matches what the user sees in the UI.
 */
import { apiClient } from "../../../api/client";
import { extractTags } from "../tag-extract";
import type { KitContext, KitCurrentNote, KitTask } from "./kit-types";

// =============================================================================
// Task extraction
// =============================================================================

/** Markdown task checkbox: optional indent + bullet (`-` or `*`) +
 *  space + `[ ]` or `[x]` + space + body. */
const TASK_REGEX = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/;

const extractTasks = (content: string): KitTask[] => {
  if (!content) return [];
  const lines = content.split("\n");
  const tasks: KitTask[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(TASK_REGEX);
    if (match) {
      tasks.push({
        text: match[3]!,
        done: match[2]!.toLowerCase() === "x",
        line: i,
      });
    }
  }
  return tasks;
};

// =============================================================================
// Y.Text helpers — minimal-diff mutations
// =============================================================================

/** Position a (line, col) pair to a Y.Text offset. Clamps gracefully:
 *  line past EOF goes to last line; col past EOL goes to end of line. */
const lineColToOffset = (text: string, line: number, col: number): number => {
  const lines = text.split("\n");
  const targetLine = Math.max(0, Math.min(line, lines.length - 1));
  const lineText = lines[targetLine] ?? "";
  const targetCol = Math.max(0, Math.min(col, lineText.length));
  let offset = 0;
  for (let i = 0; i < targetLine; i++) offset += (lines[i]?.length ?? 0) + 1; // +1 for \n
  return offset + targetCol;
};

/** Range covering a full line (start … end-of-line, NOT including the
 *  trailing \n). Returns null when `line` is out of range. */
const lineRange = (text: string, line: number): { start: number; end: number } | null => {
  const lines = text.split("\n");
  if (line < 0 || line >= lines.length) return null;
  let start = 0;
  for (let i = 0; i < line; i++) start += (lines[i]?.length ?? 0) + 1;
  return { start, end: start + (lines[line]?.length ?? 0) };
};

// =============================================================================
// Factory
// =============================================================================

/** Sentinel error message — keep verbatim with the readMode kit's
 *  caller so users searching for it find every site. */
const READ_MODE_WRITE_ERROR = "kit.note.* writes are only available in edit mode";

export const createKitCurrentNote = (ctx: KitContext): KitCurrentNote => {
  // Live content reader: ytext in edit mode, snapshot in read mode.
  // Wrapping in a function (not a stored value) so getters always
  // hit the latest Y.Text state.
  const liveContent = (): string => (ctx.ytext ? ctx.ytext.toString() : ctx.note.content);

  const requireWrite = () => {
    if (ctx.mode !== "edit" || !ctx.ytext) throw new Error(READ_MODE_WRITE_ERROR);
  };

  // ----- writes -----

  const setTitle = async (title: string) => {
    requireWrite();
    const res = await apiClient[":id"].notes[":noteId"].$patch({
      param: { id: ctx.notebookId, noteId: ctx.note.shortId },
      json: { title },
    });
    if (!res.ok) throw new Error("Failed to update note title");
    // The title change won't be reflected in `kit.note.title` until
    // the script re-runs — the snapshot is captured at run time.
    // Phase 3+ may wire a live notebook-meta channel.
  };

  const setContent = async (content: string) => {
    requireWrite();
    const ytext = ctx.ytext!;
    // Replace the whole text in one transaction so collaborators see
    // it as a single change. `delete + insert` over the full range.
    ytext.doc?.transact(() => {
      if (ytext.length > 0) ytext.delete(0, ytext.length);
      if (content.length > 0) ytext.insert(0, content);
    });
  };

  const appendContent = async (markdown: string) => {
    requireWrite();
    const ytext = ctx.ytext!;
    const current = ytext.toString();
    const sep = current.length === 0 ? "" : current.endsWith("\n") ? "" : "\n\n";
    ytext.insert(ytext.length, sep + markdown);
  };

  const prependContent = async (markdown: string) => {
    requireWrite();
    const ytext = ctx.ytext!;
    const current = ytext.toString();
    const sep = current.length === 0 ? "" : current.startsWith("\n") ? "" : "\n\n";
    ytext.insert(0, markdown + sep);
  };

  const insertContentAt = async (position: { line: number; col?: number }, markdown: string) => {
    requireWrite();
    const ytext = ctx.ytext!;
    const offset = lineColToOffset(ytext.toString(), position.line, position.col ?? 0);
    ytext.insert(offset, markdown);
  };

  const replaceLine = async (line: number, text: string) => {
    requireWrite();
    const ytext = ctx.ytext!;
    const range = lineRange(ytext.toString(), line);
    if (!range) throw new Error(`kit.note.replaceLine: line ${line} is out of range`);
    ytext.doc?.transact(() => {
      ytext.delete(range.start, range.end - range.start);
      if (text.length > 0) ytext.insert(range.start, text);
    });
  };

  const toggleTask = async (line: number) => {
    requireWrite();
    const ytext = ctx.ytext!;
    const current = ytext.toString();
    const range = lineRange(current, line);
    if (!range) throw new Error(`kit.note.toggleTask: line ${line} is out of range`);
    const lineText = current.slice(range.start, range.end);
    const match = lineText.match(TASK_REGEX);
    if (!match) throw new Error(`kit.note.toggleTask: line ${line} doesn't contain a task checkbox`);
    // Position of the checkbox char inside the line: indent length + bullet (`-`/`*`) + space + `[`.
    const indent = match[1]!.length;
    const checkboxCharOffset = range.start + indent + 2 + 1; // `[ ` or `[x` — char at idx `indent+2+1`
    const newChar = match[2]!.toLowerCase() === "x" ? " " : "x";
    // Single-character flip — minimal-diff so remote cursors don't shift.
    ytext.doc?.transact(() => {
      ytext.delete(checkboxCharOffset, 1);
      ytext.insert(checkboxCharOffset, newChar);
    });
  };

  // ----- read getters -----

  return {
    // Snapshot fields — these don't live in the doc.
    get id() {
      return ctx.note.shortId;
    },
    get title() {
      return ctx.note.title;
    },
    get content() {
      return liveContent();
    },
    get tags() {
      return extractTags(liveContent());
    },
    get tasks() {
      return extractTasks(liveContent());
    },
    get notebook() {
      return { id: ctx.notebookId, name: ctx.note.notebookName };
    },
    get createdAt() {
      return ctx.note.createdAt;
    },
    get updatedAt() {
      return ctx.note.updatedAt;
    },
    get lockedAt() {
      return ctx.note.lockedAt;
    },
    setTitle,
    setContent,
    appendContent,
    prependContent,
    insertContentAt,
    replaceLine,
    toggleTask,
  };
};

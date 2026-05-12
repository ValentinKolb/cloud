/**
 * `kit.note` — the current note. Read getters reflect live state in
 * edit-mode (via Y.Text) and the snapshot in read-mode. Write methods
 * mutate Y.Text directly when available; in read-mode they throw.
 *
 * Tag + task extraction reuses the same markdown semantics as the
 * platform (notebook tag pills, sidebar task counter) so what
 * `kit.note.tags` returns matches what the user sees in the UI.
 */
import { apiClient } from "../../../api/client";
import { extractTags } from "../tag-extract";
import type { KitContext, KitCurrentNote, KitTask } from "./kit-types";

// =============================================================================
// Task extraction
// =============================================================================

const WHITESPACE_REGEX = /\s/;

const isWhitespace = (char: string): boolean => WHITESPACE_REGEX.test(char);

const parseTaskLine = (
  line: string,
): { text: string; done: boolean; checkboxIndex: number } | null => {
  let i = 0;
  while (i < line.length && isWhitespace(line[i]!)) i++;

  const bullet = line[i];
  if (bullet !== "-" && bullet !== "*") return null;
  i++;

  const afterBullet = i;
  while (i < line.length && isWhitespace(line[i]!)) i++;
  if (i === afterBullet) return null;

  if (line[i] !== "[") return null;
  const checkboxIndex = i + 1;
  const checkbox = line[checkboxIndex];
  if (checkbox !== " " && checkbox !== "x" && checkbox !== "X") return null;
  if (line[i + 2] !== "]") return null;
  i += 3;

  const afterCheckbox = i;
  while (i < line.length && isWhitespace(line[i]!)) i++;
  if (i === afterCheckbox) return null;

  return { text: line.slice(i), done: checkbox.toLowerCase() === "x", checkboxIndex };
};

const extractTasks = (content: string): KitTask[] => {
  if (!content) return [];
  const tasks: KitTask[] = [];
  let line = 0;
  let start = 0;
  while (start <= content.length) {
    const next = content.indexOf("\n", start);
    const end = next === -1 ? content.length : next;
    const task = parseTaskLine(content.slice(start, end));
    if (task) {
      tasks.push({
        text: task.text,
        done: task.done,
        line,
      });
    }
    if (next === -1) break;
    start = next + 1;
    line++;
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

type YTextItemLike = {
  deleted?: boolean;
  countable?: boolean;
  content?: { str?: unknown };
  right?: YTextItemLike | null;
};

type YTextWithInternals = {
  _start?: YTextItemLike | null;
  length: number;
  toString(): string;
};

/** Hard cap for content read by sync getters (`kit.note.content`,
 *  `kit.note.tags`, `kit.note.tasks`). For pathologically large notes
 *  the synchronous regex passes in `extractTags` / `extractTasks`
 *  could block the JS thread visibly. Truncating at 256K chars gives a
 *  predictable upper bound on the parse work — users with notes
 *  bigger than that should be querying via `kit.notes` etc. instead. */
const LIVE_CONTENT_HARD_CAP_CHARS = 256 * 1024;

const readYTextPrefix = (ytext: NonNullable<KitContext["ytext"]>, maxChars: number): string => {
  const internal = ytext as unknown as YTextWithInternals;
  if (internal.length <= maxChars || !internal._start) return ytext.toString();

  const chunks: string[] = [];
  let remaining = maxChars;
  let item: YTextItemLike | null = internal._start;
  while (item && remaining > 0) {
    if (!item.deleted && item.countable && typeof item.content?.str === "string") {
      const chunk = item.content.str;
      const take = Math.min(chunk.length, remaining);
      chunks.push(chunk.slice(0, take));
      remaining -= take;
    }
    item = item.right ?? null;
  }
  return chunks.join("");
};

export const createKitCurrentNote = (ctx: KitContext): KitCurrentNote => {
  // Live content reader: ytext in edit mode, snapshot in read mode.
  // Wrapping in a function (not a stored value) so getters always
  // hit the latest Y.Text state.
  const liveContent = (): string => {
    const raw = ctx.ytext
      ? readYTextPrefix(ctx.ytext, LIVE_CONTENT_HARD_CAP_CHARS)
      : ctx.note.content;
    if (!raw) return raw ?? "";
    if (raw.length > LIVE_CONTENT_HARD_CAP_CHARS) {
      return raw.slice(0, LIVE_CONTENT_HARD_CAP_CHARS);
    }
    return raw;
  };

  const requireWrite = () => {
    if (ctx.isActive && !ctx.isActive()) throw new Error("Script run is no longer active");
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
    const task = parseTaskLine(lineText);
    if (!task) throw new Error(`kit.note.toggleTask: line ${line} doesn't contain a task checkbox`);
    const checkboxCharOffset = range.start + task.checkboxIndex;
    const newChar = task.done ? " " : "x";
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

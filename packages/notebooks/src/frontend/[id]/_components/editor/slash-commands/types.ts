import type { EditorView } from "@codemirror/view";

/** Per-editor context made available to every slash command at runtime. */
export type SlashCommandContext = {
  notebookId: string;
  noteId: string;
};

/**
 * One entry in the slash-command registry. Adding a new command = appending
 * one of these to the registry array; no plumbing needed.
 *
 * `run` is invoked AFTER the typed `/<name>` text has been removed from the
 * document, so commands can treat the line as empty (or as whatever it was
 * before the user started typing the slash invocation).
 */
export type SlashCommand = {
  /** Match key — what the user types after `/`. Lowercase, no spaces. */
  name: string;
  /** Display label in the autocomplete popup. */
  label: string;
  /** Tabler-icons class without the leading `ti `, e.g. `ti-h-1`. */
  icon: string;
  /** Section heading in the popup; commands sharing one section group together. */
  section: SlashCommandSection;
  /** Optional one-liner shown after the label. */
  description?: string;
  /**
   * Extra match keys — typing any of these (substring, case-insensitive)
   * surfaces this command. Useful for synonyms (`/img` → "Attach") and
   * naming-convention variants (`/h1` ↔ `/heading1`). Pick aliases that
   * cannot reasonably belong to another future command.
   */
  aliases?: string[];
  /** What the command does. May be async (e.g. opens a picker dialog). */
  run: (view: EditorView, ctx: SlashCommandContext) => void | Promise<void>;
};

export type SlashCommandSection = "Formatting" | "Lists" | "Insert" | "Callouts" | "Navigation";

import { navigateTo } from "@valentinkolb/cloud/ui";
import { buildNoteUrl } from "../../../../params";
import { openNoteSwitchPrompt } from "../../search/openNoteSearchPrompt";
import {
  insertAtCursor,
  insertCallout,
  insertCodeBlock,
  insertLink,
  insertNoteLink,
  insertTable,
  setHeading,
} from "../editor-actions";
import type { SlashCommand } from "./types";

/**
 * Slash-command registry. Order in this array = display order in the
 * autocomplete popup (commands are filtered + grouped by `section`, but
 * within a section the array order is preserved).
 *
 * Adding a new command:
 *   1. Drop a `SlashCommand` object into the right section below.
 *   2. Pick a `name` that is unique and short — that's what the user types.
 *   3. Implement `run(view, ctx)` using helpers from `editor-actions.ts`
 *      where possible so the toolbar and slash command stay in lockstep.
 */
export const slashCommands: SlashCommand[] = [
  // ── Formatting ───────────────────────────────────────────
  {
    name: "h1",
    label: "Heading 1",
    icon: "ti-h-1",
    section: "Formatting",
    run: (view) => setHeading(view, 1),
  },
  {
    name: "h2",
    label: "Heading 2",
    icon: "ti-h-2",
    section: "Formatting",
    run: (view) => setHeading(view, 2),
  },
  {
    name: "h3",
    label: "Heading 3",
    icon: "ti-h-3",
    section: "Formatting",
    run: (view) => setHeading(view, 3),
  },
  {
    name: "quote",
    label: "Quote",
    icon: "ti-quote",
    section: "Formatting",
    run: (view) => insertAtCursor(view, "> "),
  },
  {
    name: "divider",
    label: "Divider",
    icon: "ti-minus",
    section: "Formatting",
    description: "Horizontal rule",
    run: (view) => insertAtCursor(view, "---\n"),
  },

  // ── Lists ────────────────────────────────────────────────
  {
    name: "list",
    label: "Bullet list",
    icon: "ti-list",
    section: "Lists",
    run: (view) => insertAtCursor(view, "- "),
  },
  {
    name: "numbered",
    label: "Numbered list",
    icon: "ti-list-numbers",
    section: "Lists",
    run: (view) => insertAtCursor(view, "1. "),
  },
  {
    name: "todo",
    label: "Checklist",
    icon: "ti-checkbox",
    section: "Lists",
    run: (view) => insertAtCursor(view, "- [ ] "),
  },

  // ── Insert ───────────────────────────────────────────────
  {
    name: "code",
    label: "Code block",
    icon: "ti-code",
    section: "Insert",
    run: (view) => insertCodeBlock(view),
  },
  {
    name: "table",
    label: "Table",
    icon: "ti-table",
    section: "Insert",
    run: (view) => insertTable(view),
  },
  {
    name: "link",
    label: "Link",
    icon: "ti-link",
    section: "Insert",
    description: "Insert a `[text](url)` template",
    run: (view) => insertLink(view),
  },
  {
    name: "note",
    label: "Link to note",
    icon: "ti-connection",
    section: "Insert",
    description: "Pick a note to link to",
    run: (view, ctx) => insertNoteLink(view, ctx.notebookId),
  },

  // ── Callouts (info blocks) ───────────────────────────────
  {
    name: "callout",
    label: "Callout",
    icon: "ti-chevron-right",
    section: "Callouts",
    description: ":::note",
    run: (view) => insertCallout(view, "note"),
  },
  {
    name: "info",
    label: "Info",
    icon: "ti-info-circle",
    section: "Callouts",
    description: ":::info",
    run: (view) => insertCallout(view, "info"),
  },
  {
    name: "success",
    label: "Success",
    icon: "ti-check",
    section: "Callouts",
    description: ":::success",
    run: (view) => insertCallout(view, "success"),
  },
  {
    name: "warning",
    label: "Warning",
    icon: "ti-alert-circle",
    section: "Callouts",
    description: ":::warning",
    run: (view) => insertCallout(view, "warning"),
  },
  {
    name: "danger",
    label: "Danger",
    icon: "ti-alert-hexagon",
    section: "Callouts",
    description: ":::danger",
    run: (view) => insertCallout(view, "danger"),
  },

  // ── Navigation ───────────────────────────────────────────
  {
    name: "switch",
    label: "Switch to note",
    icon: "ti-arrows-right-left",
    section: "Navigation",
    description: "Open a different note in this notebook",
    run: async (_view, ctx) => {
      const picked = await openNoteSwitchPrompt(ctx.notebookId);
      if (!picked) return;
      navigateTo(buildNoteUrl(ctx.notebookId, picked.id));
    },
  },
];

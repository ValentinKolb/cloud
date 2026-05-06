import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  pickedCompletion,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { slashCommands } from "./commands";
import type { SlashCommand, SlashCommandContext } from "./types";

/**
 * CodeMirror autocomplete adapter that turns `/<name>` typed at line start
 * into a command palette. Keyboard nav (↑↓ ⏎ ⎋) and filter-as-you-type are
 * inherited from `@codemirror/autocomplete`; we only add the trigger pattern
 * and a per-option icon.
 *
 * Section grouping and the per-option `description` (would render on the
 * right) are intentionally NOT passed to CodeMirror — KISS UX: a flat list
 * of icon + label, ordered by the registry's array order.
 */

/** Trigger: `/` followed by zero+ word chars, anchored to line start. */
const SLASH_TRIGGER_REGEX = /^\/(\w*)$/;

/** `Completion` extended with the originating command — used by the icon
 *  renderer below to look up which Tabler icon to draw. */
type SlashCompletion = Completion & { slashCommand: SlashCommand };

const buildCompletion = (cmd: SlashCommand, ctx: SlashCommandContext): SlashCompletion => ({
  label: `/${cmd.name}`,
  displayLabel: cmd.label,
  slashCommand: cmd,
  apply: (view, completion, from, to) => {
    // 1. Strip the typed `/<name>` and tag the transaction with the
    //    `pickedCompletion` annotation so CM autocomplete recognises
    //    this dispatch as the apply (and tears the popup down cleanly
    //    instead of re-running the source against the in-flight state).
    view.dispatch({
      changes: { from, to, insert: "" },
      annotations: pickedCompletion.of(completion),
      userEvent: "input.complete",
    });
    // 2. Defer the command's own dispatch(es) to the next microtask.
    //    Running them inline causes CM's autocomplete update + our
    //    `cmd.run` to interleave; for commands that open a modal
    //    (`/note`, `/switch`, `/table`) the resulting re-entrancy
    //    can pin the main thread long enough to trip the browser's
    //    "page unresponsive" warning.
    queueMicrotask(() => {
      void cmd.run(view, ctx);
    });
  },
});

const buildSlashSource = (ctx: SlashCommandContext) => {
  // Completions are immutable per editor instance — build them once.
  // Stable identity helps CM autocomplete's diffing avoid re-rendering
  // option DOM when the user is just narrowing the filter (otherwise
  // every keystroke would allocate fresh option objects + fresh
  // `apply` closures and force a full popup rerender).
  const allCompletions = slashCommands.map((cmd) => buildCompletion(cmd, ctx));

  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const match = SLASH_TRIGGER_REGEX.exec(before);
    if (!match) return null;

    const q = match[1]!.toLowerCase();
    const options =
      q.length === 0
        ? allCompletions
        : allCompletions.filter((c) => {
            const cmd = (c as SlashCompletion).slashCommand;
            if (cmd.name.toLowerCase().includes(q)) return true;
            if (cmd.label.toLowerCase().includes(q)) return true;
            return cmd.aliases?.some((a) => a.toLowerCase().includes(q)) ?? false;
          });

    return {
      from: line.from,
      to: context.pos,
      filter: false, // we hand back already-filtered options above
      options,
    };
  };
};

/** Per-option icon renderer. CM merges this into the default option layout
 *  at the configured `position` slot (label sits at 50). */
const iconRenderer = {
  position: 20,
  render: (completion: Completion): Node => {
    const cmd = (completion as SlashCompletion).slashCommand;
    const el = document.createElement("i");
    el.className = `ti ${cmd?.icon ?? "ti-command"} cm-slash-icon`;
    return el;
  },
};

/**
 * Public extension factory. Wire it into the editor with the per-note
 * context so commands like `/note` and `/switch` know which notebook /
 * note they're operating on.
 */
export const slashCommandsExtension = (ctx: SlashCommandContext): Extension =>
  autocompletion({
    override: [buildSlashSource(ctx)],
    activateOnTyping: true,
    selectOnOpen: true,
    closeOnBlur: true,
    icons: false, // we render our own icon via addToOptions
    addToOptions: [iconRenderer],
  });

export type { SlashCommand, SlashCommandContext, SlashCommandSection } from "./types";

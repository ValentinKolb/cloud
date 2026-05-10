/**
 * Kit — the user-facing API surface exposed to ```script blocks.
 *
 * Phase 2: full surface across `kit.note`, `kit.notes`,
 * `kit.attachments`, `kit.tags`, `kit.state`, `kit.localState`,
 * `kit.ui`. Each sub-module lives in its own file (`kit-note.ts`,
 * `kit-notes.ts`, …) — this factory just assembles them.
 *
 * Why "kit" and not the lodash `_`:
 *  - `_` shadowed by the JS throwaway-variable convention
 *  - Stack traces / tooltips read better with a semantic name
 *  - Continuity with the existing `kit` API on the homepage app
 *
 * Hard boundaries enforced by the kit:
 *  - Notebook-scoped — every cross-note query / mutation runs
 *    against `ctx.notebookId`. There is no parameter to reach
 *    other notebooks.
 *  - Edit vs. read mode — `kit.note.set*` / `kit.attachments.insertIntoContent`
 *    throw in read-mode (no Y.Text); `kit.state.*` becomes a no-op.
 *
 * Phase 3+ may add `kit.std` (re-exports from stdlib),
 * `kit.ui.prompt.{form,confirm,...}`, and CodeMirror autocomplete
 * for the `kit.*` paths.
 */
import { toast } from "@valentinkolb/cloud/ui";
import { createKitAttachmentsAPI } from "./kit-attachments";
import { createKitCurrentNote } from "./kit-note";
import { createKitNotesAPI } from "./kit-notes";
import { createKitLocalStateAPI } from "./kit-localstate";
import { createKitStateAPI } from "./kit-state";
import { createKitTagsAPI } from "./kit-tags";
import type { Kit, KitContext, KitUI } from "./kit-types";

export type { Kit, KitContext, KitNoteSnapshot, KitMode } from "./kit-types";
// Re-export the common Kit* types so script-side typings can
// reference them without reaching into the internal module.
export type {
  KitCurrentNote,
  KitNote,
  KitTask,
  KitQuery,
  KitNotesAPI,
  KitAttachment,
  KitAttachmentsAPI,
  KitTagSummary,
  KitTagsAPI,
  KitStateAPI,
  KitLocalStateAPI,
  KitToastOptions,
  KitUI,
} from "./kit-types";

const createKitUI = (ctx: KitContext): KitUI => ({
  // Pass-through to the platform toast. Description is positional;
  // options forwarded as-is so script authors can use `title`,
  // `variant`, `duration`, `iconClass`. Phase 2 doesn't expose
  // `success` / `error` shorthands on `kit.ui.toast` — variants
  // come through `options.variant`.
  toast: (description, options) => {
    toast(description, options);
  },
  button: (label, onClick) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.className =
      "md-script-button inline-flex items-center gap-1 px-2 py-1 mr-1 mb-1 rounded text-xs font-medium " +
      "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 " +
      "hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors cursor-pointer";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const result = onClick();
        if (result && typeof (result as Promise<void>).then === "function") {
          (result as Promise<void>).catch((err) =>
            console.error("[kit.ui.button] onClick threw:", err),
          );
        }
      } catch (err) {
        console.error("[kit.ui.button] onClick threw:", err);
      }
    });
    ctx.outputEl.appendChild(btn);
  },
});

/**
 * Build a fresh `kit` instance for one script run. Each ```script
 * block gets its own kit — sub-modules are recreated per script
 * because they capture `ctx.outputEl` / `ctx.ytext` references that
 * differ per block.
 *
 * Cheap to call — no I/O. The actual API calls happen lazily when
 * the script invokes a method.
 */
export const createKit = (ctx: KitContext): Kit => ({
  note: createKitCurrentNote(ctx),
  notes: createKitNotesAPI(ctx),
  attachments: createKitAttachmentsAPI(ctx),
  tags: createKitTagsAPI(ctx),
  state: createKitStateAPI(ctx),
  localState: createKitLocalStateAPI(ctx),
  ui: createKitUI(ctx),
});

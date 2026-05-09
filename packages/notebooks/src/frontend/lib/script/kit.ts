/**
 * Kit — the user-facing API surface exposed to ```script blocks.
 *
 * Phase 1 stub: only enough surface to validate the engine end-to-end.
 * `kit.note.title` (read-only), `kit.ui.toast`, `kit.ui.button`.
 *
 * Phase 2+ will fill out:
 *   - `kit.note.body/tasks/attachments/tags`
 *   - `kit.notes.find/get/create/update`     (notebook-scoped — hard boundary)
 *   - `kit.attachments.find/get/upload`
 *   - `kit.tags.list/notesForTag`
 *   - `kit.state.get/set/observe`            (collaborative via Y.Map)
 *   - `kit.ui.prompt.{form,confirm,alert,search}`
 *   - `kit.ui.html(string)` / `kit.ui.markdown(string)`
 *   - `kit.std.*`                            (re-exports from @valentinkolb/stdlib)
 *
 * Why a single `kit` namespace and not the lodash `_`:
 *  - `_` shadowed by the JS throwaway-variable convention
 *  - Stack traces / tooltips read better with a semantic name
 *  - Continuity with the existing `kit` API on the homepage app
 */
import { toast } from "@valentinkolb/cloud/ui";

/** Read-only handle on the current note. */
export type KitNote = {
  /** Title of the note this script is embedded in (live string). */
  readonly title: string;
};

/** Options forwarded to `kit.ui.toast`. Mirrors `ToastOptions` in
 *  `cloud/ui/toast.ts` — the first positional arg is the
 *  description (the body line); `title` is an optional override
 *  on top of the variant-default ("Info" / "Success" / "Error"). */
export type KitToastOptions = {
  variant?: "default" | "success" | "error";
  duration?: number;
  iconClass?: string;
  /** Override the variant-default title. Pass `""` for an empty
   *  title row. */
  title?: string;
};

/** UI helpers — every method mounts to the script block's output slot.
 *  Multiple ```script blocks in a note each have their own slot. */
export type KitUI = {
  /** Show a transient toast notification. The first arg is the
   *  description (body line); the title defaults to the variant
   *  name and can be overridden via `options.title`. */
  toast: (description: string, options?: KitToastOptions) => void;
  /**
   * Append a button to the script's output slot. The button persists
   * across re-runs only if the source is unchanged; on source-change
   * the slot is cleared and the button gets recreated. Local state
   * (counters etc.) doesn't survive — use `kit.state.*` for that
   * (Phase 2).
   */
  button: (label: string, onClick: () => void | Promise<void>) => void;
};

export type Kit = {
  note: KitNote;
  ui: KitUI;
};

/**
 * Inputs the host (CM6 extension or read-mode renderer) gives us so
 * the kit factory can build the surface for one specific block.
 */
export type KitContext = {
  /** The note this script lives in. */
  noteTitle: string;
  /** The DOM container `kit.ui.*` mounts into. */
  outputEl: HTMLElement;
};

/**
 * Build a fresh `kit` instance for one script run. Each ```script
 * block gets its own kit; the shared engine lives at the API/state
 * layer (Phase 2). Cheap to call — no I/O.
 */
export const createKit = (ctx: KitContext): Kit => ({
  note: {
    get title() {
      return ctx.noteTitle;
    },
  },
  ui: {
    // Pass-through to the platform toast. Description is positional;
    // options forwarded as-is so script authors can use `title`,
    // `variant`, `duration`, `iconClass` (anything `cloud/ui` exposes).
    // Phase 2/3 may add `kit.ui.toast.success/error` shorthands if
    // scripts need them.
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
          // Surface async errors via the same console path so authors
          // see them; we don't rerun the whole script on click failures.
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
  },
});

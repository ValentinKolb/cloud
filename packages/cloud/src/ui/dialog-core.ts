import type { JSX } from "solid-js";
import { render } from "solid-js/web";

export type DialogClose<T> = (result?: T) => void;

export type OpenDialogOptions = {
  panelClassName?: string;
  contentClassName?: string;
  initialFocus?: "first-input" | "none" | ((dialog: HTMLDialogElement) => HTMLElement | null);
  cancelBehavior?: "resolve-undefined" | "ignore";
};

export type DialogRender<T> = (
  close: DialogClose<T>,
  ctx: {
    dialog: HTMLDialogElement;
  },
) => JSX.Element;

export type DialogCore = {
  open: <T>(view: DialogRender<T>, options?: OpenDialogOptions) => Promise<T | undefined>;
  close: (result?: unknown) => void;
  isOpen: () => boolean;
};

/**
 * One level on the dialog stack. Multiple levels can coexist (a deeper
 * dialog opens on top of a shallower one — e.g. a `prompts.confirm`
 * called from inside a `prompts.dialog`'s view), but only the topmost
 * level is visible. Lower levels stay mounted (`display:none`) so their
 * SolidJS state survives across the round-trip.
 */
type DialogStackEntry = {
  /** Container `<div>` inside the shared `<dialog>`; one per level. */
  container: HTMLDivElement;
  /** SolidJS `render` disposer. Called only when this level is popped
   *  off the stack — NOT when it's merely hidden by a deeper level. */
  dispose?: () => void;
  /** Promise resolver for this level's `open()` call. */
  resolve?: (value: unknown) => void;
  panelClassName: string;
  cancelBehavior: NonNullable<OpenDialogOptions["cancelBehavior"]>;
  initialFocus: NonNullable<OpenDialogOptions["initialFocus"]>;
};

type DialogState = {
  /** Shared `<dialog>` element. One on the page, regardless of stack
   *  depth — only the topmost level's container is visible. */
  element?: HTMLDialogElement;
  /** Active stack of dialog levels. Top of stack is the visible one.
   *  Empty means no dialog is shown; `<dialog>.close()` has been called
   *  and scroll is unlocked. */
  stack: DialogStackEntry[];
  scrollLocked?: boolean;
  previousBodyOverflow?: string;
  previousHtmlOverflow?: string;
  /** Tracks whether the most recent `mousedown` had `event.target ===
   *  dialog` (i.e. on the backdrop itself, not on dialog content).
   *  Used by the click handler to distinguish a real backdrop click
   *  from a phantom one — e.g. when an option in an open `popover`
   *  is mousedown'd, the popover hides synchronously, and the
   *  subsequent click event gets retargeted to the dialog because the
   *  option is now `display:none`. We only close on a click whose
   *  mousedown was ALSO on the backdrop. */
  mouseDownOnDialog?: boolean;
};

const DEFAULT_PANEL_CLASS = "dialog-panel";
const DEFAULT_CONTENT_CLASS = "text-base text-zinc-800 dark:text-zinc-200";

const resolveInitialFocusTarget = (dialog: HTMLDialogElement, initialFocus: OpenDialogOptions["initialFocus"]) => {
  if (initialFocus === "none") return null;
  if (typeof initialFocus === "function") return initialFocus(dialog);
  return dialog.querySelector<HTMLElement>("input:not([type='hidden']), textarea, select, button");
};

export const createDialogCore = (): DialogCore => {
  const state: DialogState = { stack: [] };

  /**
   * Wires up Esc-cancel + backdrop-click behaviour to the dialog. Re-
   * called whenever the topmost level changes (push/pop) so the
   * handlers always reflect the current top's `cancelBehavior` and
   * `close` callback.
   *
   * Backdrop-click detection guards against phantom clicks: it only
   * fires when BOTH `mousedown` AND `click` target the dialog element
   * itself. A click whose `mousedown` was on a child (and got
   * retargeted to the dialog because the child went `display:none`
   * mid-gesture — e.g. a popover hiding from inside its own option's
   * onMouseDown) is rejected as not a real backdrop click.
   */
  const applyCancelBehavior = (dialog: HTMLDialogElement, close: () => void, behavior: OpenDialogOptions["cancelBehavior"]) => {
    dialog.oncancel = (event) => {
      if (behavior === "ignore") {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      close();
    };

    dialog.onmousedown = (event) => {
      state.mouseDownOnDialog = event.target === dialog;
    };

    dialog.onclick = (event) => {
      const wasRealBackdropClick = state.mouseDownOnDialog === true;
      state.mouseDownOnDialog = false;
      if (event.target !== dialog) return;
      if (!wasRealBackdropClick) return;
      if (behavior === "ignore") return;
      close();
    };
  };

  const ensureDialogElement = () => {
    if (typeof document === "undefined") throw new Error("Dialog core is browser-only");
    if (state.element && document.body.contains(state.element)) return state.element;

    const element = document.createElement("dialog");
    document.body.appendChild(element);
    state.element = element;
    return element;
  };

  const lockPageScroll = () => {
    if (typeof document === "undefined" || state.scrollLocked) return;

    state.previousBodyOverflow = document.body.style.overflow;
    state.previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    state.scrollLocked = true;
  };

  const unlockPageScroll = () => {
    if (typeof document === "undefined" || !state.scrollLocked) return;

    document.body.style.overflow = state.previousBodyOverflow ?? "";
    document.documentElement.style.overflow = state.previousHtmlOverflow ?? "";
    state.scrollLocked = false;
    state.previousBodyOverflow = undefined;
    state.previousHtmlOverflow = undefined;
  };

  /**
   * Pop the topmost level off the stack. Disposes its SolidJS render,
   * removes its container, resolves its promise. If this empties the
   * stack the underlying `<dialog>` is closed and scroll unlocked;
   * otherwise the previous level is unhidden and its dialog chrome
   * (className, cancel handlers, initial focus) is restored.
   */
  const popTop = (result?: unknown) => {
    const top = state.stack.pop();
    if (!top) return;

    top.dispose?.();
    top.container.remove();

    const dialog = state.element;
    const previous = state.stack[state.stack.length - 1];

    if (previous && dialog) {
      // Restore the level that was hidden when this one opened — it
      // was never disposed, so its SolidJS state is still live.
      previous.container.style.display = "";
      dialog.className = previous.panelClassName;
      applyCancelBehavior(dialog, () => popTop(undefined), previous.cancelBehavior);

      // Re-run the previous level's initial focus resolver. The
      // browser's modal focus trap would otherwise pick the first
      // focusable in DOM order, which can be wrong if the previous
      // view declared a custom `initialFocus` function.
      requestAnimationFrame(() => {
        resolveInitialFocusTarget(dialog, previous.initialFocus)?.focus();
      });
    } else if (dialog) {
      // Stack is empty — close the underlying dialog for real.
      if (dialog.open) dialog.close();
      unlockPageScroll();
    }

    // Resolve LAST so the awaiting caller observes the unmounted state.
    top.resolve?.(result);
  };

  const open = <T>(view: DialogRender<T>, options: OpenDialogOptions = {}): Promise<T | undefined> => {
    const dialog = ensureDialogElement();

    // Hide the currently-visible level (if any). We don't dispose —
    // its SolidJS render keeps running so its signals, scroll, focus
    // intent, etc. all survive the round-trip.
    const previousTop = state.stack[state.stack.length - 1];
    if (previousTop) {
      previousTop.container.style.display = "none";
    }

    const panelClassName = options.panelClassName ?? DEFAULT_PANEL_CLASS;
    const cancelBehavior = options.cancelBehavior ?? "resolve-undefined";
    const initialFocus = options.initialFocus ?? "first-input";

    dialog.className = panelClassName;

    const container = document.createElement("div");
    container.className = options.contentClassName ?? DEFAULT_CONTENT_CLASS;
    dialog.appendChild(container);

    const entry: DialogStackEntry = {
      container,
      panelClassName,
      cancelBehavior,
      initialFocus,
    };

    return new Promise((resolve) => {
      entry.resolve = (value) => resolve(value as T | undefined);

      // Per-entry close callback. Idempotent and safe to call from a
      // stale closure — if this entry has already been popped (or a
      // deeper level is now on top), the call no-ops instead of
      // accidentally popping someone else's level.
      const closeTyped: DialogClose<T> = (result) => {
        if (state.stack[state.stack.length - 1] !== entry) return;
        popTop(result);
      };

      entry.dispose = render(() => view(closeTyped, { dialog }), container);

      applyCancelBehavior(dialog, () => closeTyped(undefined), cancelBehavior);

      // Push only after dispose is set so a synchronous close from the
      // view's render path still finds itself on top.
      state.stack.push(entry);

      const wasFirstLevel = state.stack.length === 1;
      if (wasFirstLevel) {
        dialog.showModal();
        lockPageScroll();
      }

      requestAnimationFrame(() => {
        resolveInitialFocusTarget(dialog, initialFocus)?.focus();
      });
    });
  };

  /**
   * Close ALL levels on the stack. The first pop receives `result`,
   * the rest get `undefined`. Used by external callers that want to
   * dismiss the dialog system entirely (e.g. in cleanup / route
   * change). Internal per-level closing goes through the `close`
   * callback passed to each view, which only pops its own level.
   */
  const close: DialogCore["close"] = (result) => {
    let first = true;
    while (state.stack.length > 0) {
      popTop(first ? result : undefined);
      first = false;
    }
  };

  return {
    open,
    close,
    isOpen: () => state.stack.length > 0,
  };
};

export const dialogCore = createDialogCore();

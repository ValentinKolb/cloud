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

type DialogState = {
  element?: HTMLDialogElement;
  dispose?: () => void;
  resolve?: (value: unknown) => void;
  scrollLocked?: boolean;
  previousBodyOverflow?: string;
  previousHtmlOverflow?: string;
};

const DEFAULT_PANEL_CLASS = "dialog-panel";
const DEFAULT_CONTENT_CLASS = "text-base text-zinc-800 dark:text-zinc-200";

const resolveInitialFocusTarget = (dialog: HTMLDialogElement, initialFocus: OpenDialogOptions["initialFocus"]) => {
  if (initialFocus === "none") return null;
  if (typeof initialFocus === "function") return initialFocus(dialog);
  return dialog.querySelector<HTMLElement>("input:not([type='hidden']), textarea, select, button");
};

const applyCancelBehavior = <T>(dialog: HTMLDialogElement, close: DialogClose<T>, behavior: OpenDialogOptions["cancelBehavior"]) => {
  dialog.oncancel = (event) => {
    if (behavior === "ignore") {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    close(undefined);
  };

  dialog.onclick = (event) => {
    if (event.target !== dialog) return;
    if (behavior === "ignore") return;
    close(undefined);
  };
};

export const createDialogCore = (): DialogCore => {
  const state: DialogState = {};

  const ensureDialogElement = () => {
    if (typeof document === "undefined") throw new Error("Dialog core is browser-only");
    if (state.element && document.body.contains(state.element)) return state.element;

    const element = document.createElement("dialog");
    document.body.appendChild(element);
    state.element = element;
    return element;
  };

  const clearRenderedContent = () => {
    state.dispose?.();
    state.dispose = undefined;
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

  const close: DialogCore["close"] = (result) => {
    const dialog = state.element;
    if (!dialog) return;

    clearRenderedContent();
    if (dialog.open) dialog.close();
    unlockPageScroll();

    const resolve = state.resolve;
    state.resolve = undefined;
    resolve?.(result);
  };

  const open = <T>(view: DialogRender<T>, options: OpenDialogOptions = {}): Promise<T | undefined> => {
    const dialog = ensureDialogElement();
    if (dialog.open) close(undefined);

    dialog.className = options.panelClassName ?? DEFAULT_PANEL_CLASS;
    dialog.innerHTML = "";

    const content = document.createElement("div");
    content.className = options.contentClassName ?? DEFAULT_CONTENT_CLASS;
    dialog.appendChild(content);

    return new Promise((resolve) => {
      state.resolve = (value) => resolve(value as T | undefined);

      const closeTyped: DialogClose<T> = (result) => close(result);
      state.dispose = render(() => view(closeTyped, { dialog }), content);

      applyCancelBehavior(dialog, closeTyped, options.cancelBehavior ?? "resolve-undefined");
      dialog.showModal();
      lockPageScroll();

      requestAnimationFrame(() => {
        resolveInitialFocusTarget(dialog, options.initialFocus ?? "first-input")?.focus();
      });
    });
  };

  return {
    open,
    close,
    isOpen: () => !!state.element?.open,
  };
};

export const dialogCore = createDialogCore();

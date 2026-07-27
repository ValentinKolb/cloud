import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { getK2bPortalRoot } from "../internal/portal";
import { isPointInsideToast } from "./toast";

export type DialogClose<T> = (result?: T) => void;

export type OpenDialogOptions = {
  panelClassName?: string;
  contentClassName?: string;
  initialFocus?: "first-input" | "none" | ((dialog: HTMLDialogElement) => HTMLElement | null);
  cancelBehavior?: "resolve-undefined" | "close" | "ignore";
  class?: string;
  ariaLabel?: string;
  resolveScope?: () => HTMLElement | null | undefined;
};

export type DialogRender<T> = (
  close: DialogClose<T>,
  context: {
    dialog: HTMLDialogElement;
  },
) => JSX.Element;

export type DialogCore = {
  open: <T>(view: DialogRender<T>, options?: OpenDialogOptions) => Promise<T | undefined>;
  close: (result?: unknown) => void;
  isOpen: () => boolean;
  getDialogElement: () => HTMLDialogElement | undefined;
};

type DialogStackEntry = {
  container: HTMLDivElement;
  dispose?: () => void;
  resolve?: (value: unknown) => void;
  panelClassName: string;
  cancelBehavior: NonNullable<OpenDialogOptions["cancelBehavior"]>;
  initialFocus: NonNullable<OpenDialogOptions["initialFocus"]>;
  ariaLabel?: string;
};

type DialogState = {
  element?: HTMLDialogElement;
  stack: DialogStackEntry[];
  root?: HTMLElement;
  scrollLocked: boolean;
  previousBodyOverflow?: string;
  previousHtmlOverflow?: string;
  mouseDownOnDialog: boolean;
};

const DEFAULT_PANEL_CLASS = "k2b-dialog";
const DEFAULT_CONTENT_CLASS = "k2b-dialog__viewport";
let nextDialogTitleId = 0;

const applyAccessibleName = (dialog: HTMLDialogElement, entry: DialogStackEntry) => {
  dialog.removeAttribute("aria-label");
  dialog.removeAttribute("aria-labelledby");
  if (entry.ariaLabel) {
    dialog.setAttribute("aria-label", entry.ariaLabel);
    return;
  }
  const heading = entry.container.querySelector<HTMLElement>("h1, h2, h3");
  if (!heading) {
    dialog.setAttribute("aria-label", "Dialog");
    return;
  }
  heading.id ||= `k2b-dialog-title-${++nextDialogTitleId}`;
  dialog.setAttribute("aria-labelledby", heading.id);
};

const focusTarget = (
  dialog: HTMLDialogElement,
  initialFocus: NonNullable<OpenDialogOptions["initialFocus"]>,
): HTMLElement | null => {
  if (initialFocus === "none") return null;
  if (typeof initialFocus === "function") return initialFocus(dialog);
  return dialog.querySelector<HTMLElement>(
    "input:not([type='hidden']):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
  );
};

const scheduleFocus = (dialog: HTMLDialogElement, initialFocus: NonNullable<OpenDialogOptions["initialFocus"]>) => {
  const run = () => focusTarget(dialog, initialFocus)?.focus();
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else queueMicrotask(run);
};

export const createDialogCore = (): DialogCore => {
  const state: DialogState = {
    stack: [],
    scrollLocked: false,
    mouseDownOnDialog: false,
  };

  const ensureDialog = (scope?: HTMLElement | null): HTMLDialogElement => {
    if (typeof document === "undefined") throw new Error("@k2b/ui dialogs can only be opened in the browser");
    const root = getK2bPortalRoot(scope);
    if (state.element?.isConnected && state.root === root) return state.element;
    if (state.stack.length > 0) return state.element!;

    state.element?.remove();
    const dialog = document.createElement("dialog");
    root.appendChild(dialog);
    state.element = dialog;
    state.root = root;
    return dialog;
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
    state.previousBodyOverflow = undefined;
    state.previousHtmlOverflow = undefined;
    state.scrollLocked = false;
  };

  const applyCancelBehavior = (
    dialog: HTMLDialogElement,
    close: () => void,
    behavior: NonNullable<OpenDialogOptions["cancelBehavior"]>,
  ) => {
    dialog.oncancel = (event) => {
      event.preventDefault();
      if (behavior !== "ignore") close();
    };
    dialog.onmousedown = (event) => {
      state.mouseDownOnDialog = event.target === dialog;
    };
    dialog.onclick = (event) => {
      const realBackdropClick = state.mouseDownOnDialog;
      state.mouseDownOnDialog = false;
      if (event.target !== dialog || !realBackdropClick || behavior === "ignore") return;
      if (isPointInsideToast(event.clientX, event.clientY)) return;
      close();
    };
  };

  const popTop = (result?: unknown) => {
    const top = state.stack.pop();
    if (!top) return;
    top.dispose?.();
    top.container.remove();

    const dialog = state.element;
    const previous = state.stack[state.stack.length - 1];
    if (dialog && previous) {
      previous.container.hidden = false;
      dialog.className = previous.panelClassName;
      applyAccessibleName(dialog, previous);
      applyCancelBehavior(dialog, () => popTop(undefined), previous.cancelBehavior);
      scheduleFocus(dialog, previous.initialFocus);
    } else if (dialog) {
      dialog.oncancel = null;
      dialog.onmousedown = null;
      dialog.onclick = null;
      dialog.removeAttribute("aria-label");
      dialog.removeAttribute("aria-labelledby");
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
      unlockPageScroll();
    }

    top.resolve?.(result);
  };

  const open = <T>(view: DialogRender<T>, options: OpenDialogOptions = {}): Promise<T | undefined> => {
    if (typeof document === "undefined") {
      return Promise.reject(new Error("@k2b/ui dialogs can only be opened in the browser"));
    }

    const dialog = ensureDialog(options.resolveScope?.());
    const previous = state.stack[state.stack.length - 1];
    if (previous) previous.container.hidden = true;

    const panelClassName = options.panelClassName ?? `${DEFAULT_PANEL_CLASS} ${options.class ?? ""}`.trim();
    const cancelBehavior = options.cancelBehavior ?? "resolve-undefined";
    const initialFocus = options.initialFocus ?? "first-input";
    const container = document.createElement("div");
    container.className = options.contentClassName ?? DEFAULT_CONTENT_CLASS;
    dialog.className = panelClassName;
    dialog.appendChild(container);

    const entry: DialogStackEntry = {
      container,
      panelClassName,
      cancelBehavior,
      initialFocus,
      ariaLabel: options.ariaLabel,
    };
    state.stack.push(entry);

    return new Promise<T | undefined>((resolve, reject) => {
      entry.resolve = (value) => resolve(value as T | undefined);
      const close: DialogClose<T> = (result) => {
        if (state.stack[state.stack.length - 1] === entry) popTop(result);
      };

      try {
        entry.dispose = render(() => view(close, { dialog }), container);
        applyAccessibleName(dialog, entry);
        applyCancelBehavior(dialog, () => close(undefined), cancelBehavior);

        if (state.stack.length === 1) {
          if (typeof dialog.showModal === "function") dialog.showModal();
          else dialog.setAttribute("open", "");
          lockPageScroll();
        }
        scheduleFocus(dialog, initialFocus);
      } catch (error) {
        entry.resolve = undefined;
        if (state.stack[state.stack.length - 1] === entry) popTop(undefined);
        reject(error);
      }
    });
  };

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
    getDialogElement: () => state.element,
  };
};

export const dialogCore = createDialogCore();

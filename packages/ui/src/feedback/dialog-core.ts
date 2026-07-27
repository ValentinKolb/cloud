import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { getK2bPortalRoot } from "../internal/portal";

export type DialogClose<T> = (result?: T) => void;
export type DialogRender<T> = (close: DialogClose<T>) => JSX.Element;

export type OpenDialogOptions = {
  class?: string;
  cancelBehavior?: "close" | "ignore";
  resolveScope?: () => HTMLElement | null | undefined;
};

export type DialogCore = {
  open: <T>(content: DialogRender<T>, options?: OpenDialogOptions) => Promise<T | undefined>;
  getDialogElement: () => HTMLDialogElement | undefined;
};

let openModalCount = 0;
let previousDocumentOverflow = "";

const lockDocument = () => {
  if (openModalCount === 0) {
    previousDocumentOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
  }
  openModalCount += 1;
};

const unlockDocument = () => {
  openModalCount = Math.max(0, openModalCount - 1);
  if (openModalCount === 0) document.documentElement.style.overflow = previousDocumentOverflow;
};

export const createDialogCore = (): DialogCore => {
  let current: HTMLDialogElement | undefined;

  return {
    open: <T>(content: DialogRender<T>, options: OpenDialogOptions = {}) => {
      if (typeof document === "undefined") {
        return Promise.reject(new Error("@k2b/ui dialogs can only be opened in the browser"));
      }

      return new Promise<T | undefined>((resolve, reject) => {
        const portal = getK2bPortalRoot(options.resolveScope?.());
        const dialog = document.createElement("dialog");
        const contentRoot = document.createElement("div");
        dialog.className = `k2b-dialog ${options.class ?? ""}`.trim();
        dialog.appendChild(contentRoot);
        portal.appendChild(dialog);
        current = dialog;

        let settled = false;
        let dispose: (() => void) | undefined;

        const cleanup = () => {
          dispose?.();
          dialog.remove();
          if (current === dialog) current = undefined;
          unlockDocument();
        };

        const close: DialogClose<T> = (result) => {
          if (settled) return;
          settled = true;
          try {
            if (dialog.open && typeof dialog.close === "function") dialog.close();
          } finally {
            cleanup();
            resolve(result);
          }
        };

        dialog.addEventListener("cancel", (event) => {
          event.preventDefault();
          if (options.cancelBehavior !== "ignore") close(undefined);
        });
        dialog.addEventListener("click", (event) => {
          if (event.target === dialog && options.cancelBehavior !== "ignore") close(undefined);
        });

        lockDocument();
        try {
          dispose = render(() => content(close), contentRoot);
          if (typeof dialog.showModal === "function") dialog.showModal();
          else dialog.setAttribute("open", "");
        } catch (error) {
          settled = true;
          cleanup();
          reject(error);
        }
      });
    },
    getDialogElement: () => current,
  };
};

export const dialogCore = createDialogCore();

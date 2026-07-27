import { type JSX, Show } from "solid-js";
import { dialogCore, type OpenDialogOptions } from "./dialog-core";

export type DialogOptions = {
  title?: string;
  icon?: string;
  confirmText?: string;
  cancelText?: string | false;
  variant?: "danger" | "primary" | "success";
  size?: "small" | "medium" | "large" | "wide";
  header?: false;
  cancelBehavior?: OpenDialogOptions["cancelBehavior"];
};

export type PromptContent = string | JSX.Element;

export const DialogHeader = (props: { close: () => void; title?: string; icon?: string }): JSX.Element => (
  <Show when={props.title || props.icon}>
    <header class="k2b-dialog__header">
      <Show when={props.icon}>{(icon) => <i class={icon()} aria-hidden="true" />}</Show>
      <Show when={props.title}>
        <h2>{props.title}</h2>
      </Show>
      <button type="button" class="k2b-dialog__close" aria-label="Close" onClick={props.close}>
        <span aria-hidden="true">×</span>
      </button>
    </header>
  </Show>
);

const contentNode = (content: PromptContent): JSX.Element =>
  typeof content === "string" ? <p class="k2b-dialog__message">{content}</p> : content;

const dialogClass = (options?: DialogOptions): string =>
  `k2b-dialog--${options?.size ?? "medium"} k2b-dialog--${options?.variant ?? "primary"}`;

export const prompts = {
  alert: async (content: PromptContent, options?: DialogOptions): Promise<void> => {
    await dialogCore.open<void>(
      (close) => (
        <div class="k2b-dialog__panel">
          <Show when={options?.header !== false}>
            <DialogHeader title={options?.title} icon={options?.icon} close={() => close()} />
          </Show>
          <div class="k2b-dialog__body">{contentNode(content)}</div>
          <footer class="k2b-dialog__actions">
            <button type="button" class="k2b-button k2b-button--primary" onClick={() => close()}>
              {options?.confirmText ?? "OK"}
            </button>
          </footer>
        </div>
      ),
      { class: dialogClass(options), cancelBehavior: options?.cancelBehavior },
    );
  },

  confirm: async (content: PromptContent, options?: DialogOptions): Promise<boolean> =>
    (await dialogCore.open<boolean>(
      (close) => (
        <div class="k2b-dialog__panel">
          <Show when={options?.header !== false}>
            <DialogHeader title={options?.title} icon={options?.icon} close={() => close(false)} />
          </Show>
          <div class="k2b-dialog__body">{contentNode(content)}</div>
          <footer class="k2b-dialog__actions">
            <Show when={options?.cancelText !== false}>
              <button type="button" class="k2b-button k2b-button--secondary" onClick={() => close(false)}>
                {options?.cancelText ?? "Cancel"}
              </button>
            </Show>
            <button type="button" class="k2b-button" data-variant={options?.variant ?? "primary"} onClick={() => close(true)}>
              {options?.confirmText ?? "Confirm"}
            </button>
          </footer>
        </div>
      ),
      { class: dialogClass(options), cancelBehavior: options?.cancelBehavior },
    )) ?? false,

  dialog: <T,>(component: (close: (result?: T) => void) => JSX.Element, options?: DialogOptions): Promise<T | undefined> =>
    dialogCore.open<T>(
      (close) => (
        <div class="k2b-dialog__panel">
          <Show when={options?.header !== false}>
            <DialogHeader title={options?.title} icon={options?.icon} close={() => close(undefined)} />
          </Show>
          <div class="k2b-dialog__body">{component(close)}</div>
        </div>
      ),
      { class: dialogClass(options), cancelBehavior: options?.cancelBehavior },
    ),

  getDialogElement: (): HTMLDialogElement | undefined => dialogCore.getDialogElement(),
};

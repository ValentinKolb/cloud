import { createContext, For, type JSX, Show, useContext } from "solid-js";
import { IconButton } from "../actions/Button";
import type { OpenDialogOptions } from "../feedback/dialog-core";

export type PanelDialogSurface = "contained" | "floating";

export type PanelDialogProps = {
  children: JSX.Element;
  surface?: PanelDialogSurface;
};

export type PanelDialogHeaderProps = {
  title: JSX.Element;
  subtitle?: JSX.Element;
  icon?: string;
  actions?: JSX.Element;
  close?: () => void;
  closeDisabled?: boolean;
  closeLabel?: string;
};

export type PanelDialogBodyProps = {
  children: JSX.Element;
  scrollPreserveKey?: string;
};

export type PanelDialogFooterProps = {
  children: JSX.Element;
};

export type PanelDialogSectionProps = {
  title: JSX.Element;
  subtitle?: JSX.Element;
  icon?: string;
  actions?: JSX.Element;
  children: JSX.Element;
};

export type PanelDialogTabOption<T extends string = string> = {
  value: T;
  label: JSX.Element;
  icon?: string;
  disabled?: boolean;
};

export type PanelDialogTabsProps<T extends string = string> = {
  options: readonly PanelDialogTabOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  label?: string;
};

type PanelDialogComponent = ((props: PanelDialogProps) => JSX.Element) & {
  Header: (props: PanelDialogHeaderProps) => JSX.Element;
  Body: (props: PanelDialogBodyProps) => JSX.Element;
  Footer: (props: PanelDialogFooterProps) => JSX.Element;
  Section: (props: PanelDialogSectionProps) => JSX.Element;
  Tabs: <T extends string>(props: PanelDialogTabsProps<T>) => JSX.Element;
};

const PanelDialogSurfaceContext = createContext<PanelDialogSurface>("contained");
const usePanelDialogSurface = () => useContext(PanelDialogSurfaceContext);

export const panelDialogOptions = {
  class: "k2b-dialog--large k2b-panel-dialog-frame",
} satisfies OpenDialogOptions;

export const panelDialogFixedOptions = {
  class: "k2b-dialog--large k2b-panel-dialog-frame is-fixed",
} satisfies OpenDialogOptions;

export const panelDialogWorkspaceOptions = {
  class: "k2b-dialog--wide k2b-panel-dialog-frame is-workspace",
} satisfies OpenDialogOptions;

const PanelDialogHeader = (props: PanelDialogHeaderProps): JSX.Element => (
  <header class="k2b-panel-dialog__header">
    <Show when={props.icon}>{(icon) => <i class={icon()} aria-hidden="true" />}</Show>
    <div class="k2b-panel-dialog__heading">
      <h2>{props.title}</h2>
      <Show when={props.subtitle}>
        <p>{props.subtitle}</p>
      </Show>
    </div>
    <Show when={props.actions}>
      <div class="k2b-panel-dialog__actions">{props.actions}</div>
    </Show>
    <Show when={props.close}>
      {(close) => (
        <IconButton label={props.closeLabel ?? "Close dialog"} variant="ghost" disabled={props.closeDisabled} onClick={close()}>
          <i class="ti ti-x" aria-hidden="true" />
        </IconButton>
      )}
    </Show>
  </header>
);

const PanelDialogBody = (props: PanelDialogBodyProps): JSX.Element => (
  <main class="k2b-panel-dialog__body" data-scroll-preserve={props.scrollPreserveKey} data-surface={usePanelDialogSurface()}>
    {props.children}
  </main>
);

const PanelDialogFooter = (props: PanelDialogFooterProps): JSX.Element => (
  <footer class="k2b-panel-dialog__footer">{props.children}</footer>
);

const PanelDialogSection = (props: PanelDialogSectionProps): JSX.Element => (
  <section class="k2b-panel-dialog__section">
    <header>
      <Show when={props.icon}>
        {(icon) => (
          <span class="k2b-panel-dialog__section-icon">
            <i class={icon()} aria-hidden="true" />
          </span>
        )}
      </Show>
      <div>
        <h3>{props.title}</h3>
        <Show when={props.subtitle}>
          <p>{props.subtitle}</p>
        </Show>
      </div>
      <Show when={props.actions}>
        <div class="k2b-panel-dialog__actions">{props.actions}</div>
      </Show>
    </header>
    <div class="k2b-panel-dialog__section-body">{props.children}</div>
  </section>
);

const PanelDialogTabs = <T extends string>(props: PanelDialogTabsProps<T>): JSX.Element => (
  <div class="k2b-panel-dialog__tabs" role="tablist" aria-label={props.label ?? "Dialog sections"}>
    <For each={props.options}>
      {(option) => (
        <button
          type="button"
          role="tab"
          aria-selected={props.value === option.value}
          disabled={option.disabled}
          data-active={props.value === option.value ? "true" : undefined}
          onClick={() => props.onValueChange(option.value)}
        >
          <Show when={option.icon}>{(icon) => <i class={icon()} aria-hidden="true" />}</Show>
          {option.label}
        </button>
      )}
    </For>
  </div>
);

const PanelDialog = ((props: PanelDialogProps): JSX.Element => {
  const surface = props.surface ?? "contained";
  return (
    <PanelDialogSurfaceContext.Provider value={surface}>
      <div class="k2b-panel-dialog" data-surface={surface}>
        {props.children}
      </div>
    </PanelDialogSurfaceContext.Provider>
  );
}) as PanelDialogComponent;

PanelDialog.Header = PanelDialogHeader;
PanelDialog.Body = PanelDialogBody;
PanelDialog.Footer = PanelDialogFooter;
PanelDialog.Section = PanelDialogSection;
PanelDialog.Tabs = PanelDialogTabs;

export default PanelDialog;

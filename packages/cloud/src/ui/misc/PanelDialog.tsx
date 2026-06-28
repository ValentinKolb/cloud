import { For, type JSX } from "solid-js";
import type { OpenDialogOptions } from "../dialog-core";
import { prompts } from "../prompts";

export type PanelDialogProps = {
  children: JSX.Element;
};

export type PanelDialogHeaderProps = {
  title: string;
  subtitle?: string;
  icon: string;
  actions?: JSX.Element;
  close?: () => void;
};

export type PanelDialogBodyProps = {
  children: JSX.Element;
};

export type PanelDialogFooterProps = {
  children: JSX.Element;
};

export type PanelDialogSectionProps = {
  title: string;
  subtitle?: string;
  icon: string;
  actions?: JSX.Element;
  children: JSX.Element;
};

export type PanelDialogTabOption<T extends string = string> = {
  value: T;
  label: string;
  icon?: string;
};

export type PanelDialogTabsProps<T extends string = string> = {
  options: readonly PanelDialogTabOption<T>[];
  value: () => T;
  onChange: (value: T) => void;
  ariaLabel?: string;
};

type PanelDialogComponent = ((props: PanelDialogProps) => JSX.Element) & {
  Header: (props: PanelDialogHeaderProps) => JSX.Element;
  Body: (props: PanelDialogBodyProps) => JSX.Element;
  Footer: (props: PanelDialogFooterProps) => JSX.Element;
  Section: (props: PanelDialogSectionProps) => JSX.Element;
  Tabs: <T extends string>(props: PanelDialogTabsProps<T>) => JSX.Element;
};

export const panelDialogPanelClass =
  "fixed left-1/2 top-1/2 m-0 max-h-[86vh] w-[min(96vw,48rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-none backdrop:bg-black/45 backdrop:backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:backdrop:bg-black/35";

export const panelDialogOptions = {
  panelClassName: panelDialogPanelClass,
  contentClassName: "min-h-0 p-0",
} satisfies OpenDialogOptions;

export const confirmDiscardIfDirty = async (dirty: boolean | (() => boolean)) => {
  const hasChanges = typeof dirty === "function" ? dirty() : dirty;
  if (!hasChanges) return true;
  return prompts.confirm("Discard unsaved changes?", {
    title: "Unsaved changes",
    variant: "danger",
    confirmText: "Discard",
  });
};

function PanelDialogHeader(props: PanelDialogHeaderProps) {
  return (
    <header class="flex min-h-16 shrink-0 items-center gap-4 border-b border-zinc-200 px-5 dark:border-zinc-800">
      <i class={`${props.icon} shrink-0`} />
      <div class="min-w-0 flex-1">
        <p class="truncate font-semibold">{props.title}</p>
        {props.subtitle && <p class="truncate text-xs text-dimmed">{props.subtitle}</p>}
      </div>
      {props.actions && <div class="flex shrink-0 items-center gap-2">{props.actions}</div>}
      {props.close && (
        <button type="button" onClick={props.close} class="icon-btn shrink-0" aria-label="close dialog">
          <i class="ti ti-x" />
        </button>
      )}
    </header>
  );
}

function PanelDialogBody(props: PanelDialogBodyProps) {
  return <main class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">{props.children}</main>;
}

function PanelDialogFooter(props: PanelDialogFooterProps) {
  return (
    <footer class="flex shrink-0 items-center justify-between gap-2 border-t border-zinc-200 bg-white/95 p-4 dark:border-zinc-800 dark:bg-zinc-950/95">
      {props.children}
    </footer>
  );
}

function PanelDialogSection(props: PanelDialogSectionProps) {
  return (
    <section class="paper border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
      <header class="mb-2 flex items-start gap-2">
        <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-dimmed dark:bg-zinc-800">
          <i class={`${props.icon} text-sm`} />
        </span>
        <div class="min-w-0 flex-1">
          <h3 class="text-xs font-semibold uppercase tracking-[0.12em] text-secondary">{props.title}</h3>
          {props.subtitle && <p class="mt-0.5 text-[11px] leading-snug text-dimmed">{props.subtitle}</p>}
        </div>
        {props.actions && <div class="flex shrink-0 items-center gap-2">{props.actions}</div>}
      </header>
      <div class="flex flex-col gap-3">{props.children}</div>
    </section>
  );
}

function PanelDialogTabs<T extends string>(props: PanelDialogTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={props.ariaLabel ?? "Dialog tabs"}
      class="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800"
    >
      <For each={props.options}>
        {(option) => {
          const active = () => props.value() === option.value;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={active()}
              class={`flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                active()
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-950/35 dark:text-blue-200"
                  : "text-dimmed hover:bg-zinc-100 hover:text-primary dark:hover:bg-zinc-900"
              }`}
              onClick={() => props.onChange(option.value)}
            >
              {option.icon && <i class={`${option.icon} text-sm`} />}
              {option.label}
            </button>
          );
        }}
      </For>
    </div>
  );
}

const PanelDialog = ((props: PanelDialogProps) => (
  <div class="flex h-full w-full max-h-[inherit] min-h-0 flex-col overflow-hidden">{props.children}</div>
)) as PanelDialogComponent;

PanelDialog.Header = PanelDialogHeader;
PanelDialog.Body = PanelDialogBody;
PanelDialog.Footer = PanelDialogFooter;
PanelDialog.Section = PanelDialogSection;
PanelDialog.Tabs = PanelDialogTabs;

export default PanelDialog;

import type { JSX } from "solid-js";
import type { OpenDialogOptions } from "../dialog-core";
import { prompts } from "../prompts";

export type PanelDialogProps = {
  children: JSX.Element;
};

export type PanelDialogHeaderProps = {
  title: string;
  subtitle?: string;
  icon: string;
  close: () => void;
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
  children: JSX.Element;
};

type PanelDialogComponent = ((props: PanelDialogProps) => JSX.Element) & {
  Header: (props: PanelDialogHeaderProps) => JSX.Element;
  Body: (props: PanelDialogBodyProps) => JSX.Element;
  Footer: (props: PanelDialogFooterProps) => JSX.Element;
  Section: (props: PanelDialogSectionProps) => JSX.Element;
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
      <div class="min-w-0">
        <p class="truncate font-semibold">{props.title}</p>
        {props.subtitle && <p class="truncate text-xs text-dimmed">{props.subtitle}</p>}
      </div>
      <button type="button" onClick={props.close} class="icon-btn ml-auto shrink-0" aria-label="close dialog">
        <i class="ti ti-x" />
      </button>
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
        <div class="min-w-0">
          <h3 class="text-xs font-semibold uppercase tracking-[0.12em] text-secondary">{props.title}</h3>
          {props.subtitle && <p class="mt-0.5 text-[11px] leading-snug text-dimmed">{props.subtitle}</p>}
        </div>
      </header>
      <div class="flex flex-col gap-3">{props.children}</div>
    </section>
  );
}

const PanelDialog = ((props: PanelDialogProps) => (
  <div class="flex max-h-[86vh] min-h-0 flex-col overflow-hidden">{props.children}</div>
)) as PanelDialogComponent;

PanelDialog.Header = PanelDialogHeader;
PanelDialog.Body = PanelDialogBody;
PanelDialog.Footer = PanelDialogFooter;
PanelDialog.Section = PanelDialogSection;

export default PanelDialog;

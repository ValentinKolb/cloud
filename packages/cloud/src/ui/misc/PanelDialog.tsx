import { createContext, For, type JSX, useContext } from "solid-js";
import type { OpenDialogOptions } from "../dialog-core";
import { prompts } from "../prompts";

export type PanelDialogSurface = "contained" | "floating";

export type PanelDialogProps = {
  children: JSX.Element;
  surface?: PanelDialogSurface;
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
  scrollPreserveKey?: string;
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

const PanelDialogSurfaceContext = createContext<PanelDialogSurface>("contained");

const usePanelDialogSurface = () => useContext(PanelDialogSurfaceContext);

const panelDialogBasePanelClass =
  "panel-dialog-shell fixed left-1/2 top-1/2 m-0 -translate-x-1/2 -translate-y-1/2 overflow-hidden p-0 text-zinc-900 shadow-none backdrop:bg-black/45 backdrop:backdrop-blur-sm dark:text-zinc-100 dark:backdrop:bg-black/35";

export const panelDialogPanelClass = `${panelDialogBasePanelClass} max-h-[86vh] w-[min(96vw,48rem)]`;

export const panelDialogOptions = {
  panelClassName: panelDialogPanelClass,
  // The content wrapper must carry the panel's max-height EXPLICITLY (same
  // 86vh as the panel class — `max-h-[inherit]` proved unreliable across
  // browser dialog UA styles) and be a flex column, otherwise
  // PanelDialog.Body can never scroll and long content gets clipped by the
  // panel's overflow-hidden.
  contentClassName: "flex max-h-[86vh] min-h-0 flex-col p-0",
} satisfies OpenDialogOptions;

export const panelDialogWorkspacePanelClass = `${panelDialogBasePanelClass} h-[80vh] max-h-[80vh] w-[80vw] max-w-[80vw]`;

export const panelDialogWorkspaceOptions = {
  panelClassName: panelDialogWorkspacePanelClass,
  contentClassName: "flex h-full min-h-0 p-0",
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
  const surface = usePanelDialogSurface();
  return (
    <header
      class={
        surface === "floating"
          ? "paper flex min-h-16 shrink-0 items-center gap-4 px-5"
          : "panel-dialog-divider flex min-h-16 shrink-0 items-center gap-4 border-b px-5"
      }
    >
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
  const surface = usePanelDialogSurface();
  return (
    <main
      data-scroll-preserve={props.scrollPreserveKey}
      class={
        surface === "floating"
          ? "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-0"
          : "panel-dialog-body flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
      }
    >
      {props.children}
    </main>
  );
}

function PanelDialogFooter(props: PanelDialogFooterProps) {
  const surface = usePanelDialogSurface();
  return (
    <footer
      class={
        surface === "floating"
          ? "paper flex shrink-0 items-center justify-between gap-2 p-4"
          : "panel-dialog-divider flex shrink-0 items-center justify-between gap-2 border-t p-4"
      }
    >
      {props.children}
    </footer>
  );
}

function PanelDialogSection(props: PanelDialogSectionProps) {
  const surface = usePanelDialogSurface();
  return (
    <section class={surface === "floating" ? "paper p-4" : "panel-dialog-section paper p-4"}>
      <header class="mb-2 flex items-start gap-2">
        <span class="panel-dialog-section-icon mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] text-dimmed">
          <i class={`${props.icon} text-sm`} />
        </span>
        <div class="min-w-0 flex-1">
          <h3 class="text-xs font-semibold uppercase tracking-[0.12em] text-secondary">{props.title}</h3>
          {props.subtitle && <p class="mt-0.5 text-[11px] leading-snug text-dimmed">{props.subtitle}</p>}
        </div>
        {props.actions && <div class="flex shrink-0 items-center gap-2">{props.actions}</div>}
      </header>
      <div class={surface === "floating" ? "flex flex-col gap-2" : "flex flex-col gap-3"}>{props.children}</div>
    </section>
  );
}

function PanelDialogTabs<T extends string>(props: PanelDialogTabsProps<T>) {
  const surface = usePanelDialogSurface();
  return (
    <div
      role="tablist"
      aria-label={props.ariaLabel ?? "Dialog tabs"}
      class={
        surface === "floating"
          ? "paper flex shrink-0 items-center gap-1 overflow-x-auto p-1.5"
          : // No divider line — the active-tab tint and spacing carry the separation.
            "flex shrink-0 items-center gap-1 overflow-x-auto px-2 py-1.5"
      }
    >
      <For each={props.options}>
        {(option) => {
          const active = () => props.value() === option.value;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={active()}
              class={`flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--ui-radius-control)] px-2.5 text-xs font-medium transition-colors ${
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

const PanelDialog = ((props: PanelDialogProps) => {
  const surface = props.surface ?? "contained";
  return (
    <PanelDialogSurfaceContext.Provider value={surface}>
      {/* As a flex child (dialog content / page shell), min-h-0 + flex-1 lets the
          parent's height/max-height cap this root — Body then scrolls inside. */}
      <div
        class={
          surface === "floating"
            ? "flex min-h-0 w-full flex-1 flex-col gap-2 overflow-hidden"
            : "flex min-h-0 w-full flex-1 flex-col overflow-hidden"
        }
      >
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

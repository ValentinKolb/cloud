import { prompts, type OpenDialogOptions } from "@valentinkolb/cloud/ui";
import type { JSX } from "solid-js";

const gridsPanelDialogPanelClass =
  "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 m-0 max-h-[86vh] w-[min(96vw,48rem)] overflow-hidden rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-none backdrop:bg-black/45 dark:border-zinc-800 dark:bg-zinc-950 dark:backdrop:bg-black/35 backdrop:backdrop-blur-sm dark:text-zinc-100";

export const gridsPanelDialogOptions = {
  panelClassName: gridsPanelDialogPanelClass,
  contentClassName: "min-h-0 p-0",
} satisfies OpenDialogOptions;

export const gridsBareDialogOptions = gridsPanelDialogOptions;

export function GridsPanelDialog(props: { children: JSX.Element }) {
  return <div class="flex max-h-[86vh] min-h-0 flex-col overflow-hidden">{props.children}</div>;
}

export function GridsPanelDialogHeader(props: { title: string; icon: string; close: () => void }) {
  return (
    <header class="flex min-h-16 shrink-0 items-center gap-4 border-b border-zinc-200 px-5 dark:border-zinc-800">
      <i class={`${props.icon} shrink-0`} />
      <p class="min-w-0 truncate font-semibold">{props.title}</p>
      <button type="button" onClick={props.close} class="icon-btn ml-auto shrink-0" aria-label="close dialog">
        <i class="ti ti-x" />
      </button>
    </header>
  );
}

export function GridsPanelDialogBody(props: { children: JSX.Element }) {
  return <main class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">{props.children}</main>;
}

export function GridsPanelDialogFooter(props: { children: JSX.Element }) {
  return (
    <footer class="flex shrink-0 items-center justify-between gap-2 border-t border-zinc-200 bg-white/95 p-4 dark:border-zinc-800 dark:bg-zinc-950/95">
      {props.children}
    </footer>
  );
}

export function BareModalFrame(props: { children: JSX.Element }) {
  return <div class="flex h-full min-h-0 flex-col gap-2 overflow-hidden">{props.children}</div>;
}

export function BareModalFrameHeader(props: { title: string; icon: string; close: () => void }) {
  return (
    <section class="paper shrink-0 p-4">
      <div class="flex min-h-9 items-center gap-4">
        <i class={`${props.icon} shrink-0`} />
        <p class="min-w-0 truncate font-semibold">{props.title}</p>
        <button type="button" onClick={props.close} class="icon-btn ml-auto shrink-0" aria-label="close dialog">
          <i class="ti ti-x" />
        </button>
      </div>
    </section>
  );
}

export function GridsBareDialog(props: { title: string; icon: string; close: () => void; children: JSX.Element }) {
  return (
    <GridsPanelDialog>
      <GridsPanelDialogHeader title={props.title} icon={props.icon} close={props.close} />
      <GridsPanelDialogBody>{props.children}</GridsPanelDialogBody>
    </GridsPanelDialog>
  );
}

export const confirmDiscardIfDirty = async (dirty: boolean | (() => boolean)) => {
  const hasChanges = typeof dirty === "function" ? dirty() : dirty;
  if (!hasChanges) return true;
  return prompts.confirm("Discard unsaved changes?", {
    title: "Unsaved changes",
    variant: "danger",
    confirmText: "Discard",
  });
};

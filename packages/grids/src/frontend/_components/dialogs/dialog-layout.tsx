import type { OpenDialogOptions } from "@valentinkolb/cloud/ui";
import type { JSX } from "solid-js";

export const gridsBareDialogPanelClass =
  "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 m-0 h-[86vh] max-h-[86vh] w-[min(96vw,48rem)] overflow-hidden border-0 bg-transparent p-0 text-zinc-900 shadow-none backdrop:bg-black/45 dark:backdrop:bg-black/35 backdrop:backdrop-blur-sm dark:text-zinc-100";

export const gridsBareDialogOptions = {
  panelClassName: gridsBareDialogPanelClass,
  contentClassName: "h-full min-h-0 p-0",
} satisfies OpenDialogOptions;

export function GridsBareDialog(props: { title: string; icon: string; close: () => void; children: JSX.Element }) {
  return (
    <div class="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <section class="paper shrink-0 p-4">
        <div class="flex min-h-9 items-center gap-4">
          <i class={`${props.icon} shrink-0`} />
          <p class="min-w-0 truncate font-semibold">{props.title}</p>
          <button type="button" onClick={props.close} class="icon-btn ml-auto shrink-0" aria-label="close dialog">
            <i class="ti ti-x" />
          </button>
        </div>
      </section>
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">{props.children}</div>
    </div>
  );
}

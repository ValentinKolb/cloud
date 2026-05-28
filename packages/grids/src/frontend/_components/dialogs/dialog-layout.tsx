import { panelDialogOptions } from "@valentinkolb/cloud/ui";
import type { JSX } from "solid-js";

export const gridsBareDialogOptions = panelDialogOptions;

function GridsBareDialogHeader(props: { title: string; icon: string; close: () => void }) {
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

function GridsBareDialogBody(props: { children: JSX.Element }) {
  return <main class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">{props.children}</main>;
}

export function GridsBareDialog(props: { title: string; icon: string; close: () => void; children: JSX.Element }) {
  return (
    <div class="flex max-h-[86vh] min-h-0 flex-col overflow-hidden">
      <GridsBareDialogHeader title={props.title} icon={props.icon} close={props.close} />
      <GridsBareDialogBody>{props.children}</GridsBareDialogBody>
    </div>
  );
}

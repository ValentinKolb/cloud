import { Dropdown, TextInput } from "@valentinkolb/cloud/ui";
import type { Accessor, Setter } from "solid-js";
import { Show } from "solid-js";

type ViewMode = "list" | "folders" | "custom";

type Props = {
  canWrite: boolean;
  searchDraft: Accessor<string>;
  setSearchDraft: Setter<string>;
  clearSearch: () => void;
  activeMode: "list" | "folders";
  searching: boolean;
  countLabel: string;
  onGenerate: () => void;
  onMode: (mode: ViewMode) => void;
};

function DisabledItem(props: { icon: string; label: string; title: string }) {
  return (
    <button
      type="button"
      class="flex w-full cursor-not-allowed items-center gap-3 px-4 py-2 text-sm text-zinc-400 opacity-70 dark:text-zinc-500"
      disabled
      title={props.title}
    >
      <i class={props.icon} />
      {props.label}
    </button>
  );
}

export default function DocumentBrowserToolbar(props: Props) {
  const activeLabel = () => (props.activeMode === "folders" ? "Folders" : "Table");
  const activeIcon = () => (props.activeMode === "folders" ? "ti ti-folder" : "ti ti-table");
  const modeElements = () => [
    { icon: "ti ti-table", label: "Table", action: () => props.onMode("list") },
    props.searching
      ? { element: <DisabledItem icon="ti ti-folder" label="Folders" title="Folder view is disabled while searching." /> }
      : { icon: "ti ti-folder", label: "Folders", action: () => props.onMode("folders") },
    { element: <DisabledItem icon="ti ti-folder-cog" label="Custom" title="Custom folders are not configured yet." /> },
  ];

  return (
    <div class="flex shrink-0 flex-wrap items-center gap-2">
      <Show when={props.canWrite}>
        <button type="button" class="btn-input-primary btn-input-sm" onClick={props.onGenerate}>
          <i class="ti ti-plus" />
          Add new
        </button>
      </Show>
      <div class="min-w-64 flex-1">
        <TextInput
          type="search"
          icon="ti ti-search"
          placeholder="Search documents..."
          value={props.searchDraft}
          onInput={props.setSearchDraft}
          clearable
          onClear={props.clearSearch}
        />
      </div>
      <Dropdown
        position="bottom-left"
        trigger={
          <span class="btn-input btn-input-sm">
            <i class={activeIcon()} />
            {activeLabel()}
            <i class="ti ti-chevron-down text-[10px] opacity-60" />
          </span>
        }
        elements={modeElements()}
      />
      <span class="whitespace-nowrap text-xs text-dimmed">{props.countLabel}</span>
    </div>
  );
}

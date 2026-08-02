import { Button, Dropdown, DropdownItem, TextInput, Tooltip } from "@k2b/ui";
import type { Accessor, Setter } from "solid-js";
import { Show } from "solid-js";

type ViewMode = "list" | "folders";

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
    <Tooltip content={props.title} class="w-full">
      <DropdownItem icon={props.icon} disabled>
        {props.label}
      </DropdownItem>
    </Tooltip>
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
  ];

  return (
    <div class="flex shrink-0 flex-wrap items-center gap-2">
      <Show when={props.canWrite}>
        <Button variant="primary" size="sm" type="button" onClick={props.onGenerate}>
          <i class="ti ti-plus" />
          Add new
        </Button>
      </Show>
      <div class="min-w-64 flex-1">
        <TextInput
          type="search"
          icon="ti ti-search"
          placeholder="Search documents..."
          value={props.searchDraft}
          onValueChange={props.setSearchDraft}
          clearable
          onClear={props.clearSearch}
        />
      </div>
      <Dropdown
        position="bottom-left"
        trigger={
          <Button variant="secondary" size="sm">
            <i class={activeIcon()} />
            {activeLabel()}
            <i class="ti ti-chevron-down text-[10px] opacity-60" />
          </Button>
        }
        elements={modeElements()}
      />
      <span class="whitespace-nowrap text-xs text-dimmed">{props.countLabel}</span>
    </div>
  );
}

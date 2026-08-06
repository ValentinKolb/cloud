import { hotkeys } from "@k2b/stdlib/solid";
import { IconButton } from "@k2b/ui";
import { openGlobalSearchDialog } from "./GlobalSearchDialog";
import type { GlobalSearchHelpApp } from "./GlobalSearchHelpDialog";

type GlobalSearchTriggerProps = {
  variant: "header" | "rail";
  class?: string;
  registerHotkey?: boolean;
  searchHelpApps?: GlobalSearchHelpApp[];
};

/** Opens the spotlight-style global search dialog from nav/header trigger points. */
export default function GlobalSearchTrigger(props: GlobalSearchTriggerProps) {
  const searchHelpApps = props.searchHelpApps ?? [];

  if (props.registerHotkey) {
    hotkeys.create(() => ({
      "mod+k": {
        label: "Open global search",
        desc: "Search across apps, pages, files, and items.",
        run: () => openGlobalSearchDialog(searchHelpApps),
      },
    }));
  }

  if (props.variant === "rail")
    return (
      <button
        type="button"
        class={`rail-item text-blue-500 hover:bg-blue-500/10 hover:text-blue-600 dark:text-blue-400 dark:hover:bg-blue-500/15 dark:hover:text-blue-300 ${props.class ?? ""}`}
        onClick={() => openGlobalSearchDialog(searchHelpApps)}
        aria-label="Open global search"
        title="Search (Mod+K)"
      >
        <i class="ti ti-search text-base" />
      </button>
    );

  return (
    <IconButton
      class={props.class}
      onClick={() => openGlobalSearchDialog(searchHelpApps)}
      label="Open global search"
      title="Search (Mod+K)"
    >
      <i class="ti ti-search text-base" />
    </IconButton>
  );
}

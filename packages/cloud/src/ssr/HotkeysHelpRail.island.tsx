import { hotkeys } from "@valentinkolb/stdlib/solid";
import type { GlobalSearchHelpApp } from "./GlobalSearchHelpDialog";
import { openLayoutHelpDialog } from "./LayoutHelp";

/** Help action in rail nav: opens a modal with all currently registered hotkeys. */
export default function HotkeysHelpRail(props: { searchHelpApps?: GlobalSearchHelpApp[] }) {
  const searchHelpApps = props.searchHelpApps ?? [];

  const openHelp = () => {
    openLayoutHelpDialog(searchHelpApps);
  };

  hotkeys.create(() => ({
    "shift+/": {
      label: "Open shortcut help",
      desc: "Show all currently registered keyboard shortcuts.",
      run: openHelp,
    },
  }));

  return (
    <button
      type="button"
      class="rail-item text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-500/10 dark:hover:bg-blue-500/15"
      onClick={openHelp}
      aria-label="Open keyboard shortcuts help"
      title="Keyboard shortcuts (Shift+/)"
    >
      <i class="ti ti-help-circle text-base" />
    </button>
  );
}

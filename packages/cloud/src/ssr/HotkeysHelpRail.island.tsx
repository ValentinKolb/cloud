import { hotkeys } from "@valentinkolb/stdlib/solid";
import type { GlobalSearchHelpApp } from "./GlobalSearchHelpDialog";
import { openLayoutHelpDialog } from "./LayoutHelp";

type HotkeysHelpTriggerProps = {
  variant: "header" | "rail";
  class?: string;
  registerHotkey?: boolean;
  searchHelpApps?: GlobalSearchHelpApp[];
  accent?: string;
};

/** Opens end-user help from either the desktop rail or the compact header. */
export default function HotkeysHelpRail(props: HotkeysHelpTriggerProps) {
  const searchHelpApps = props.searchHelpApps ?? [];

  const openHelp = () => {
    openLayoutHelpDialog(searchHelpApps, props.accent);
  };

  if (props.registerHotkey) {
    hotkeys.create(() => ({
      "shift+/": {
        label: "Open shortcut help",
        desc: "Open end-user help, guides, and keyboard shortcuts.",
        run: openHelp,
      },
    }));
  }

  const triggerClass =
    props.variant === "rail"
      ? `rail-item text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-500/10 dark:hover:bg-blue-500/15 ${props.class ?? ""}`
      : `icon-btn inline ${props.class ?? ""}`;

  return (
    <button type="button" class={triggerClass} onClick={openHelp} aria-label="Open help" title="Help (Shift+/)">
      <i class="ti ti-help-circle text-base" />
    </button>
  );
}

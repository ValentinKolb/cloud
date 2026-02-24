import type { JSX } from "solid-js/jsx-runtime";
import { SearchBar } from "@valentinkolb/cloud/lib/islands";

type Props = {
  /** URL to toggle indirect/recursive mode (omit to hide the button) */
  indirectToggleUrl?: string;
  /** Whether indirect mode is currently active */
  indirect?: boolean;
  /** Slot for action buttons (e.g. AddMember) */
  actions?: JSX.Element;
};

/**
 * Shared toolbar for group detail tabs.
 * Renders: SearchBar + optional indirect toggle + optional action buttons.
 */
export default function TabToolbar(props: Props) {
  return (
    <div class="flex gap-2 items-stretch">
      <div class="flex-1">
        <SearchBar />
      </div>
      {props.indirectToggleUrl && (
        <a
          href={props.indirectToggleUrl}
          class={`btn-secondary shrink-0 self-stretch px-3 text-xs ${props.indirect ? "bg-zinc-200! dark:bg-zinc-700!" : ""}`}
          title={props.indirect ? "Show direct members only" : "Show all members (including indirect)"}
        >
          <i class="ti ti-hierarchy text-sm" />
        </a>
      )}
      {props.actions}
    </div>
  );
}

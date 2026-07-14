import type { JSX } from "solid-js/jsx-runtime";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";

type Props = {
  /** URL to toggle indirect/recursive mode (omit to hide the button) */
  indirectToggleUrl?: string;
  /** Whether indirect mode is currently active */
  indirect?: boolean;
  /** URL to toggle service-account memberships (omit to hide the button) */
  serviceAccountsToggleUrl?: string;
  /** Whether service-account memberships are currently visible */
  showServiceAccounts?: boolean;
  /** Slot for action buttons (e.g. AddMember) */
  actions?: JSX.Element;
};

/**
 * Shared toolbar for group detail tabs.
 * Renders: SearchBar + optional indirect toggle + optional action buttons.
 */
export default function TabToolbar(props: Props) {
  return (
    <div class="flex flex-wrap gap-2 items-stretch">
      <div class="flex-1">
        <SearchBar />
      </div>
      {props.indirectToggleUrl && (
        <a
          href={props.indirectToggleUrl}
          class={`btn-input btn-input-sm shrink-0 self-stretch ${props.indirect ? "!bg-violet-100 dark:!bg-violet-900/50 !text-violet-700 dark:!text-violet-300" : ""}`}
          title={props.indirect ? "Show direct members only" : "Show all members (including indirect)"}
        >
          <i class="ti ti-hierarchy text-sm" />
          {props.indirect ? "All members" : "Direct only"}
        </a>
      )}
      {props.serviceAccountsToggleUrl && (
        <a
          href={props.serviceAccountsToggleUrl}
          class={`btn-input btn-input-sm shrink-0 self-stretch ${props.showServiceAccounts ? "btn-input-active" : ""}`}
          title={props.showServiceAccounts ? "Hide service account memberships" : "Show service account memberships"}
          aria-pressed={props.showServiceAccounts}
        >
          <i class="ti ti-user-key text-sm" />
          Service accounts
        </a>
      )}
      {props.actions}
    </div>
  );
}

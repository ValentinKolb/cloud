import { Dropdown, Tooltip } from "@valentinkolb/cloud/ui";
import { Show } from "solid-js";
import { getMailAction, type MailActionId } from "./mail-actions";

const primaryActions: readonly MailActionId[] = ["archive", "mark_read", "flag", "move", "trash"];
const overflowActions: readonly MailActionId[] = ["mark_unread", "unflag", "junk"];

export default function MailBulkActionBar(props: {
  selectedCount: number;
  busy: boolean;
  onClear: () => void;
  onAddTags: () => void | Promise<void>;
  onAction: (actionId: MailActionId) => void | Promise<void>;
}) {
  return (
    <div class="flex min-w-0 items-center gap-1" role="toolbar" aria-label="Selected conversation actions">
      <span class="min-w-0 flex-1 truncate text-sm font-medium text-primary" aria-live="polite">
        {props.selectedCount > 0 ? `${props.selectedCount} selected` : "Select conversations"}
      </span>
      <Show when={props.selectedCount > 0}>
        <Tooltip content="Add tags">
          <button
            type="button"
            class="icon-btn"
            aria-label={`Add tags to ${props.selectedCount} selected conversations`}
            disabled={props.busy}
            onClick={() => void props.onAddTags()}
          >
            <i class="ti ti-tags" aria-hidden="true" />
          </button>
        </Tooltip>
        {primaryActions.map((actionId) => {
          const action = getMailAction(actionId);
          return (
            <Tooltip content={action.label}>
              <button
                type="button"
                class="icon-btn"
                aria-label={`${action.label} ${props.selectedCount} selected conversations`}
                disabled={props.busy}
                onClick={() => void props.onAction(actionId)}
              >
                <i class={action.icon} aria-hidden="true" />
              </button>
            </Tooltip>
          );
        })}
        <Dropdown
          trigger={
            <button type="button" class="icon-btn" aria-label="More selected conversation actions" disabled={props.busy}>
              <i class="ti ti-dots" aria-hidden="true" />
            </button>
          }
          position="bottom-left"
          width="w-56"
          elements={[
            ...overflowActions.map((actionId) => {
              const action = getMailAction(actionId);
              return {
                label: action.label,
                icon: action.icon,
                action: () => props.onAction(actionId),
              };
            }),
          ]}
        />
      </Show>
      <Tooltip content="Exit selection">
        <button type="button" class="icon-btn" aria-label="Exit conversation selection" disabled={props.busy} onClick={props.onClear}>
          <i class="ti ti-x" aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  );
}

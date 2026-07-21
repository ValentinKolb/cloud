import { Dropdown, Tooltip } from "@valentinkolb/cloud/ui";
import { Show } from "solid-js";
import { getMailCommand, type MailTriageCommandId } from "./mail-command-registry";

const primaryCommands: readonly MailTriageCommandId[] = ["archive", "mark_read", "flag", "move", "trash"];
const overflowCommands: readonly MailTriageCommandId[] = ["mark_unread", "unflag", "junk"];

export default function MailBulkActionBar(props: {
  selectedCount: number;
  busy: boolean;
  onClear: () => void;
  onAddTags: () => void | Promise<void>;
  onCommand: (commandId: MailTriageCommandId) => void | Promise<void>;
  onOpenCommands: () => void | Promise<void>;
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
        {primaryCommands.map((commandId) => {
          const command = getMailCommand(commandId);
          return (
            <Tooltip content={command.label}>
              <button
                type="button"
                class="icon-btn"
                aria-label={`${command.label} ${props.selectedCount} selected conversations`}
                disabled={props.busy}
                onClick={() => void props.onCommand(commandId)}
              >
                <i class={command.icon} aria-hidden="true" />
              </button>
            </Tooltip>
          );
        })}
        <Dropdown
          trigger={
            <button
              type="button"
              class="icon-btn"
              aria-label="More selected conversation actions"
              disabled={props.busy}
            >
              <i class="ti ti-dots" aria-hidden="true" />
            </button>
          }
          position="bottom-left"
          width="w-56"
          elements={[
            ...overflowCommands.map((commandId) => {
              const command = getMailCommand(commandId);
              return {
                label: command.label,
                icon: command.icon,
                action: () => props.onCommand(commandId),
              };
            }),
            {
              label: "Search all Mail commands",
              icon: "ti ti-command",
              action: props.onOpenCommands,
            },
          ]}
        />
      </Show>
      <Tooltip content="Exit selection">
        <button
          type="button"
          class="icon-btn"
          aria-label="Exit conversation selection"
          disabled={props.busy}
          onClick={props.onClear}
        >
          <i class="ti ti-x" aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  );
}

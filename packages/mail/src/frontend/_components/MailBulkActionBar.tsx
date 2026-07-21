import { Dropdown, Tooltip } from "@valentinkolb/cloud/ui";
import { getMailCommand, type MailTriageCommandId } from "./mail-command-registry";

const primaryCommands: readonly MailTriageCommandId[] = ["archive", "mark_read", "flag", "move", "trash"];
const overflowCommands: readonly MailTriageCommandId[] = ["mark_unread", "unflag", "junk"];

export default function MailBulkActionBar(props: {
  selectedCount: number;
  selectableCount: number;
  allSelected: boolean;
  busy: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onCommand: (commandId: MailTriageCommandId) => void | Promise<void>;
  onOpenCommands: () => void | Promise<void>;
}) {
  return (
    <div class="flex min-w-0 items-center gap-1" role="toolbar" aria-label="Selected conversation actions">
      <input
        type="checkbox"
        class="h-4 w-4 shrink-0"
        checked={props.allSelected}
        aria-label={props.allSelected ? "Clear selected conversations" : "Select all visible conversations"}
        onChange={() => (props.allSelected ? props.onClear() : props.onSelectAll())}
      />
      <span class="min-w-0 flex-1 truncate text-sm font-medium text-primary" aria-live="polite">
        {props.selectedCount} selected
        <span class="sr-only">, up to {props.selectableCount} conversations visible</span>
      </span>
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
          <button type="button" class="icon-btn" aria-label="More selected conversation actions" disabled={props.busy}>
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
          { label: "Clear selection", icon: "ti ti-x", action: props.onClear },
        ]}
      />
    </div>
  );
}

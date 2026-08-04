import { Dropdown, Tooltip, IconButton } from "@k2b/ui";
import { Show } from "solid-js";
import { getMailAction, type MailActionId } from "./mail-actions";

const primaryActions: readonly MailActionId[] = ["archive", "mark_read", "flag", "move", "trash"];
export default function MailBulkActionBar(props: {
  selectedCount: number;
  selectedInJunk: boolean;
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
        <Tooltip.Anchor content="Add tags">
          <IconButton
            type="button"
            label={`Add tags to ${props.selectedCount} selected conversations`}
            disabled={props.busy}
            onClick={() => void props.onAddTags()}
          >
            <i class="ti ti-tags" aria-hidden="true" />
          </IconButton>
        </Tooltip.Anchor>
        {primaryActions.map((actionId) => {
          const action = getMailAction(actionId);
          return (
            <Tooltip.Anchor content={action.label}>
              <IconButton
                type="button"
                label={`${action.label} ${props.selectedCount} selected conversations`}
                disabled={props.busy}
                onClick={() => void props.onAction(actionId)}
              >
                <i class={action.icon} aria-hidden="true" />
              </IconButton>
            </Tooltip.Anchor>
          );
        })}
        <Dropdown.Root
          position="bottom-left"
          width="14rem"
          items={[
            ...(["mark_unread", "unflag", props.selectedInJunk ? "not_spam" : "junk"] as const).map((actionId) => {
              const action = getMailAction(actionId);
              return {
                label: action.label,
                icon: action.icon,
                action: () => props.onAction(actionId),
              };
            }),
          ]}
        >
          <Dropdown.Trigger iconOnly type="button" variant="ghost" label="More selected conversation actions" disabled={props.busy}>
            <i class="ti ti-dots" aria-hidden="true" />
          </Dropdown.Trigger>
        </Dropdown.Root>
      </Show>
      <Tooltip.Anchor content="Exit selection">
        <IconButton type="button" label="Exit conversation selection" disabled={props.busy} onClick={props.onClear}>
          <i class="ti ti-x" aria-hidden="true" />
        </IconButton>
      </Tooltip.Anchor>
    </div>
  );
}

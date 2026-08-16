import { IconButton, MarkdownView, Paper, Tooltip } from "@k2b/ui";
import { Show } from "solid-js";

export default function MailConversationSummaryCard(props: {
  summary: string;
  canEdit: boolean;
  editDisabled?: boolean;
  onEdit: () => void;
}) {
  return (
    <Paper
      as="section"
      class="relative mx-auto my-3 w-full max-w-4xl overflow-hidden p-4 pl-5"
      aria-labelledby="mail-conversation-summary-title"
      data-mail-conversation-summary
    >
      <div class="mb-2 flex items-center gap-2">
        <h2 id="mail-conversation-summary-title" class="min-w-0 flex-1 text-sm font-semibold text-[var(--app-accent)]">
          Conversation summary
        </h2>
        <Show when={props.canEdit}>
          <Tooltip.Anchor content="Edit summary">
            <IconButton type="button" size="sm" variant="ghost" label="Edit summary" disabled={props.editDisabled} onClick={props.onEdit}>
              <i class="ti ti-pencil" aria-hidden="true" />
            </IconButton>
          </Tooltip.Anchor>
        </Show>
      </div>
      <div data-mail-conversation-summary-body>
        <MarkdownView markdown={props.summary} headingScale="compact" class="text-sm text-primary" />
      </div>
    </Paper>
  );
}

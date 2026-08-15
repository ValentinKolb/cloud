import { Dropdown } from "@k2b/ui";
import { For, Show } from "solid-js";

export type AssistantQueuedMessage = {
  id: string;
  text: string;
  failed?: boolean;
};

export default function AssistantQueuedMessages(props: {
  messages: readonly AssistantQueuedMessage[];
  sendingId?: string | null;
  onSendNow: (message: AssistantQueuedMessage) => void;
  onEdit: (message: AssistantQueuedMessage) => void;
  onDelete: (message: AssistantQueuedMessage) => void;
}) {
  return (
    <Show when={props.messages.length > 0}>
      <ol class="flex flex-col gap-2" aria-label="Queued messages" aria-live="polite">
        <For each={props.messages}>
          {(message) => (
            <li
              class="group flex min-h-10 min-w-0 items-center gap-2 rounded-xl border border-[var(--k2b-border)] bg-[var(--k2b-surface)] px-3 py-2 text-xs text-[var(--k2b-text-secondary)]"
              data-failed={message.failed ? "true" : undefined}
            >
              <i
                class={
                  message.failed
                    ? "ti ti-alert-circle shrink-0 text-[var(--k2b-danger-text)]"
                    : "ti ti-corner-down-right shrink-0 text-[var(--k2b-text-muted)]"
                }
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1 truncate" title={message.text}>
                {message.text}
              </span>
              <button
                type="button"
                class="shrink-0 rounded-md px-1.5 py-1 text-[0.6875rem] font-medium text-[var(--k2b-text-muted)] transition-colors hover:text-[var(--k2b-ai-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--k2b-focus-ring)] disabled:cursor-wait disabled:opacity-50"
                disabled={props.sendingId === message.id}
                onClick={() => props.onSendNow(message)}
              >
                {props.sendingId === message.id ? "Sending…" : "Send now"}
              </button>
              <Dropdown.Root
                position="bottom-left"
                width="10rem"
                label="Queued message actions"
                items={[
                  { label: "Edit", icon: "ti ti-pencil", action: () => props.onEdit(message) },
                  { label: "Delete", icon: "ti ti-trash", variant: "danger", action: () => props.onDelete(message) },
                ]}
              >
                <Dropdown.Trigger
                  appearance="plain"
                  class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--k2b-text-muted)] transition-colors hover:text-[var(--k2b-text)]"
                  iconOnly
                  label="Queued message actions"
                  title="Queued message actions"
                >
                  <i class="ti ti-dots" aria-hidden="true" />
                </Dropdown.Trigger>
              </Dropdown.Root>
            </li>
          )}
        </For>
      </ol>
    </Show>
  );
}

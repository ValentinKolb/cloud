import { CheckboxCard, prompts } from "@valentinkolb/cloud/ui";
import { createSignal, For } from "solid-js";
import {
  MAIL_CONVERSATION_TOOLBAR_ACTION_OPTIONS,
  MAX_MAIL_CONVERSATION_TOOLBAR_ACTIONS,
  type MailConversationToolbarActionId,
  normalizeMailConversationToolbarActions,
} from "./mail-conversation-toolbar";

export const openMailConversationToolbarDialog = (
  current: readonly MailConversationToolbarActionId[],
): Promise<MailConversationToolbarActionId[] | undefined> =>
  prompts.dialog<MailConversationToolbarActionId[]>(
    (close) => {
      const [selected, setSelected] = createSignal(normalizeMailConversationToolbarActions(current));
      const toggle = (actionId: MailConversationToolbarActionId, enabled: boolean) => {
        setSelected((existing) =>
          enabled
            ? normalizeMailConversationToolbarActions([...existing, actionId])
            : existing.filter((candidate) => candidate !== actionId),
        );
      };

      return (
        <div class="flex min-h-0 flex-col gap-4">
          <div>
            <p class="text-sm text-secondary">
              Choose up to {MAX_MAIL_CONVERSATION_TOOLBAR_ACTIONS} direct actions. Every action remains available in the overflow menu.
            </p>
            <p class="mt-1 text-xs text-dimmed">
              Actions appear in the order shown here. Unavailable actions stay hidden for the current conversation.
            </p>
          </div>
          <div class="grid min-h-0 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
            <For each={MAIL_CONVERSATION_TOOLBAR_ACTION_OPTIONS}>
              {(option) => {
                const checked = () => selected().includes(option.id);
                return (
                  <CheckboxCard
                    label={option.label}
                    description={option.description}
                    icon={option.icon}
                    value={checked}
                    disabled={!checked() && selected().length >= MAX_MAIL_CONVERSATION_TOOLBAR_ACTIONS}
                    onChange={(enabled) => toggle(option.id, enabled)}
                  />
                );
              }}
            </For>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs tabular-nums text-dimmed">
              {selected().length} of {MAX_MAIL_CONVERSATION_TOOLBAR_ACTIONS} selected
            </span>
            <div class="flex items-center gap-2">
              <button type="button" class="btn-secondary btn-sm" onClick={() => close(undefined)}>
                Cancel
              </button>
              <button type="button" class="btn-primary btn-sm" onClick={() => close(selected())}>
                Save toolbar
              </button>
            </div>
          </div>
        </div>
      );
    },
    { title: "Customize toolbar", icon: "ti ti-adjustments-horizontal", size: "large" },
  );
